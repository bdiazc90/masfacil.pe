/**
 * La precache del service worker, DERIVADA del contenido.
 *
 * Antes eran dos cosas que había que recordar a mano: una lista de 27 rutas
 * dentro de `web/sw.js` y un número de versión dentro de `web/sw-cache-policy.js`.
 * Olvidar el número dejaba al visitante con el shell anterior para siempre,
 * porque la estrategia es cache-first y nunca revalida. El olvido era
 * estructural: el verificador tuvo que exigir el bump a mano en el ciclo FIX.
 *
 * Aquí la lista sale de las referencias reales del árbol y la versión sale de
 * la huella de esos bytes. Registrar un logo una vez, con su procedencia, ya
 * mete su SVG en la precache; cambiar un byte de `styles.css` ya cambia la
 * versión. No hay segundo paso que olvidar.
 *
 * Se deriva de REFERENCIAS y de REGLAS, nunca del directorio: un archivo suelto
 * dentro de `web/` no viaja por estar ahí. Un SVG de marca entra solo si su
 * slug está en `BRAND_LOGOS`, y un icono solo si lo referencia `index.html` o
 * el manifiesto de la PWA.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_LOGOS, brandLogoPath } from '../web/brand-logos.js';
import { shellEntryFile, svgProblems } from '../app/shell-assets.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SHELL_MANIFEST_RELATIVE = 'web/shell-manifest.js';
export const SHELL_CACHE_PREFIX = 'masfacil-shell-';
/** `sw.js` se sirve aparte y el manifest se importa desde él: ninguno se precachea. */
const FUERA_DE_LA_PRECACHE = new Set(['sw.js', 'shell-manifest.js']);

const ordenar = (valores) => [...new Set(valores)].sort((a, b) => a.localeCompare(b, 'en'));

/** `.js` sí, `.mjs` no: una herramienta suelta en `web/` no sería shell. */
function modulosDelCliente(webRoot) {
  const raiz = fs.readdirSync(webRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js') && !FUERA_DE_LA_PRECACHE.has(entry.name))
    .map((entry) => `/${entry.name}`);
  const libDir = path.join(webRoot, 'lib');
  const lib = fs.existsSync(libDir)
    ? fs.readdirSync(libDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => `/lib/${entry.name}`)
    : [];
  return [...ordenar(raiz), ...ordenar(lib)];
}

/** Iconos referenciados por el HTML y por el manifiesto de la PWA. */
function iconosReferenciados(webRoot) {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const desdeLinks = [...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const manifiesto = JSON.parse(fs.readFileSync(path.join(webRoot, 'manifest.webmanifest'), 'utf8'));
  const desdeManifiesto = (manifiesto.icons ?? []).map((icon) => icon.src);
  return ordenar([...desdeLinks, ...desdeManifiesto].filter((ruta) => ruta.startsWith('/icons/')));
}

/**
 * Lista de la precache y huella de su contenido.
 *
 * La huella cubre la lista ordenada MÁS los bytes de cada archivo listado. Los
 * precios (`web/data/`) no entran porque no están en la lista: la versión del
 * shell no se mueve cuando cambian los datos.
 */
export function deriveShell({ root = rootFromModule } = {}) {
  const webRoot = path.join(root, 'web');
  const problems = [];
  const marcas = [];
  for (const [clave, entry] of Object.entries(BRAND_LOGOS)) {
    const ruta = brandLogoPath(entry.slug);
    const archivo = path.join(root, shellEntryFile(ruta));
    if (!fs.existsSync(archivo)) { problems.push(`${clave}: ${ruta} está registrado y no existe en el árbol`); continue; }
    for (const motivo of svgProblems(fs.readFileSync(archivo, 'utf8'))) problems.push(`${clave}: ${ruta} ${motivo}`);
    marcas.push(ruta);
  }
  const entries = ['/', '/styles.css', '/manifest.webmanifest', ...modulosDelCliente(webRoot), ...iconosReferenciados(webRoot), ...ordenar(marcas)];

  const hash = crypto.createHash('sha256').update(`${JSON.stringify(entries)}\n`);
  for (const entry of entries) {
    const archivo = path.join(root, shellEntryFile(entry));
    if (!fs.existsSync(archivo)) { problems.push(`${entry} está en la precache derivada y no existe en el árbol`); continue; }
    hash.update(fs.readFileSync(archivo));
  }
  const digest = hash.digest('hex').slice(0, 12);
  return { entries, digest, cache: `${SHELL_CACHE_PREFIX}${digest}`, problems };
}

/** El módulo generado: dos constantes y de dónde salieron. */
export function renderShellManifest({ entries, cache }) {
  return [
    '// GENERADO por pipeline/shell-manifest.mjs. No editar a mano ni versionar.',
    '// La lista sale de las referencias del árbol y del registro de marcas; la',
    '// versión sale de la huella de esos bytes. Cambiar un archivo del shell',
    '// cambia SHELL_CACHE y reinstala el service worker.',
    `export const SHELL = ${JSON.stringify(entries)};`,
    `export const SHELL_CACHE = '${cache}';`,
    '',
  ].join('\n');
}

/** Genera `web/shell-manifest.js`. Lanza si la derivación tiene problemas. */
export function writeShellManifest({ root = rootFromModule } = {}) {
  const derived = deriveShell({ root });
  if (derived.problems.length) throw new Error(`No se puede derivar la precache: ${derived.problems.join('; ')}`);
  const destino = path.join(root, SHELL_MANIFEST_RELATIVE);
  const contenido = renderShellManifest(derived);
  const temporal = `${destino}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporal, contenido, { mode: 0o644, flag: 'wx' });
  fs.renameSync(temporal, destino);
  return { ...derived, path: destino, content: contenido };
}

/**
 * Problemas del manifest en disco frente al derivado. Vacío si está al día.
 * Verificar no genera: publicar con un manifest viejo es publicar un `addAll`
 * que no corresponde al árbol.
 */
export function shellManifestProblems({ root = rootFromModule } = {}) {
  const derived = deriveShell({ root });
  if (derived.problems.length) return { derived, problems: derived.problems };
  const destino = path.join(root, SHELL_MANIFEST_RELATIVE);
  if (!fs.existsSync(destino)) return { derived, problems: [`falta ${SHELL_MANIFEST_RELATIVE}; ejecuta npm run serve o npm run publish para generarlo`] };
  const actual = fs.readFileSync(destino, 'utf8');
  if (actual !== renderShellManifest(derived)) return { derived, problems: [`${SHELL_MANIFEST_RELATIVE} no coincide con el árbol; la precache derivada es ${derived.cache}`] };
  return { derived, problems: [] };
}
