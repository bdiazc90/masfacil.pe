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
 * dentro de `web/` no viaja por estar ahí. Un SVG de marca entra solo si es una
 * variante registrada en `BRAND_LOGOS` —el mismo recorrido `brandAssets()` que
 * usan el verificador y la tarjeta—, y un icono solo si lo referencia
 * `index.html` o el manifiesto de la PWA.
 *
 * El mismo paso genera `web/sw.js`, el script que registra el navegador: un
 * import de la lógica (`sw-main.js`) y la versión. Chrome no reinstala un
 * service worker de módulos cuando cambia solo un import, así que la versión
 * tiene que vivir en los bytes del script registrado.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_LOGOS, brandAssets } from '../web/brand-logos.js';
import { moduleGraph, shellEntryFile, svgProblems } from '../app/shell-assets.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SHELL_MANIFEST_RELATIVE = 'web/shell-manifest.js';
export const SERVICE_WORKER_RELATIVE = 'web/sw.js';
export const SHELL_CACHE_PREFIX = 'masfacil-shell-';
/** La lógica del service worker; `sw.js` solo la importa. */
export const SERVICE_WORKER_MAIN = 'sw-main.js';
/** Generados por este módulo (rutas relativas a `web/`): nunca entran en la huella. */
const GENERADOS = Object.freeze(['shell-manifest.js', 'sw.js']);
/** El worker se sirve aparte y el manifest se importa desde él: ninguno se precachea. */
const FUERA_DE_LA_PRECACHE = new Set([...GENERADOS, SERVICE_WORKER_MAIN]);

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
 * La huella cubre la lista ordenada, los bytes de cada archivo listado y los de
 * `web/_headers`. Los precios (`web/data/`) no entran porque no están en la
 * lista: la versión del shell no se mueve cuando cambian los datos.
 */
export function deriveShell({ root = rootFromModule } = {}) {
  const webRoot = path.join(root, 'web');
  const problems = [];
  const marcas = [];
  for (const { key, role, path: ruta } of brandAssets(BRAND_LOGOS)) {
    const archivo = path.join(root, shellEntryFile(ruta));
    if (!fs.existsSync(archivo)) { problems.push(`${key}.${role}: ${ruta} está registrado y no existe en el árbol`); continue; }
    for (const motivo of svgProblems(fs.readFileSync(archivo, 'utf8'))) problems.push(`${key}.${role}: ${ruta} ${motivo}`);
    marcas.push(ruta);
  }
  // La 404 propia viaja en la precache: sin red, el service worker la devuelve
  // con su estado para cualquier dirección que no sea una vista.
  const entries = ['/', '/404.html', '/styles.css', '/manifest.webmanifest', ...modulosDelCliente(webRoot), ...iconosReferenciados(webRoot), ...ordenar(marcas)];

  const hash = crypto.createHash('sha256').update(`${JSON.stringify(entries)}\n`);
  for (const entry of entries) {
    const archivo = path.join(root, shellEntryFile(entry));
    if (!fs.existsSync(archivo)) { problems.push(`${entry} está en la precache derivada y no existe en el árbol`); continue; }
    hash.update(fs.readFileSync(archivo));
  }
  // Las cabeceras también son versión del shell: el service worker guarda cada
  // respuesta con las suyas —la portada con su CSP— y la sirve así, sin volver a
  // pedirla. Si cambiar `_headers` no reinstalara el service worker, quien ya
  // tiene la app seguiría con la cabecera vieja. `_headers` no se precachea.
  const cabeceras = path.join(webRoot, '_headers');
  if (fs.existsSync(cabeceras)) hash.update(fs.readFileSync(cabeceras));
  // Y el grafo entero del worker, recorrido desde su lógica: un cambio en un
  // módulo que solo importa el service worker, también en una subcarpeta, cambia
  // la versión y con ella los bytes de `/sw.js`. Los generados están en el grafo
  // pero no en la huella: salen de ella.
  const leer = (relativo) => {
    const archivo = path.join(webRoot, relativo);
    return fs.existsSync(archivo) && fs.statSync(archivo).isFile() ? fs.readFileSync(archivo, 'utf8') : null;
  };
  const worker = moduleGraph({ entry: SERVICE_WORKER_MAIN, read: leer, generated: GENERADOS });
  problems.push(...worker.problems);
  const propios = worker.modules.filter((relativo) => !GENERADOS.includes(relativo));
  hash.update(`\n${JSON.stringify(propios)}\n`);
  for (const relativo of propios) hash.update(fs.readFileSync(path.join(webRoot, relativo)));
  const digest = hash.digest('hex').slice(0, 12);
  return { entries, worker: worker.modules, digest, cache: `${SHELL_CACHE_PREFIX}${digest}`, problems };
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

/** El script que registra el navegador: la versión y el import de la lógica. */
export function renderServiceWorker({ cache }) {
  return [
    '// GENERADO por pipeline/shell-manifest.mjs. No editar a mano ni versionar.',
    '// Chrome no reinstala un service worker de módulos cuando cambia solo un',
    '// import: la versión va aquí para que cada cambio del shell, de `_headers` o',
    '// del grafo del worker cambie los bytes de este script.',
    `// ${cache}`,
    `import './${SERVICE_WORKER_MAIN}';`,
    '',
  ].join('\n');
}

function escribir(destino, contenido) {
  const temporal = `${destino}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporal, contenido, { mode: 0o644, flag: 'wx' });
  fs.renameSync(temporal, destino);
}

/** Genera `web/shell-manifest.js` y `web/sw.js`. Lanza si la derivación tiene problemas. */
export function writeShellManifest({ root = rootFromModule } = {}) {
  const derived = deriveShell({ root });
  if (derived.problems.length) throw new Error(`No se puede derivar la precache: ${derived.problems.join('; ')}`);
  const destino = path.join(root, SHELL_MANIFEST_RELATIVE);
  const contenido = renderShellManifest(derived);
  escribir(destino, contenido);
  escribir(path.join(root, SERVICE_WORKER_RELATIVE), renderServiceWorker(derived));
  return { ...derived, path: destino, content: contenido };
}

/**
 * Problemas de los generados en disco frente a lo derivado. Vacío si están al
 * día. Verificar no genera: publicar con un manifest viejo es publicar un
 * `addAll` que no corresponde al árbol, y con un `sw.js` viejo el navegador no
 * vería la versión nueva.
 */
export function shellManifestProblems({ root = rootFromModule } = {}) {
  const derived = deriveShell({ root });
  if (derived.problems.length) return { derived, problems: derived.problems };
  const problems = [];
  for (const [relativo, esperado] of [[SHELL_MANIFEST_RELATIVE, renderShellManifest(derived)], [SERVICE_WORKER_RELATIVE, renderServiceWorker(derived)]]) {
    const destino = path.join(root, relativo);
    if (!fs.existsSync(destino)) problems.push(`falta ${relativo}; ejecuta npm run serve o npm run publish para generarlo`);
    else if (fs.readFileSync(destino, 'utf8') !== esperado) problems.push(`${relativo} no coincide con el árbol; la precache derivada es ${derived.cache}`);
  }
  return { derived, problems };
}
