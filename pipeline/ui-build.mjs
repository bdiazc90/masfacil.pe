/**
 * La interfaz compilada: de `ui/` a `web/` con Vite, sin que Vite escriba en
 * `web/`.
 *
 * Tres pasos que no se mezclan:
 *   1. compilar en un staging propio, fuera de `web/`;
 *   2. comprobar lo compilado: solo `index.html`, `404.html` y `assets/`; cada
 *      recurso de las dos páginas es absoluto, existe y no va en línea; sin carga
 *      diferida de código;
 *   3. instalarlo reemplazando SOLO lo que este build instaló antes, según su
 *      inventario. `web/data/`, las marcas y los módulos compartidos no son suyos.
 *
 * La constancia (`.local-cache/ui-build/build.json`) vive fuera del árbol
 * público. Dice de qué entradas salió cada byte instalado: la verificación la usa
 * para rechazar un build viejo aunque sea coherente consigo mismo, y la precache
 * la usa como manifiesto de lo emitido. No lleva hora: las mismas fuentes escriben
 * la misma constancia y los mismos bytes.
 *
 * Vite se importa al compilar, no al cargar este módulo: la proyección, el
 * verificador y las pruebas siguen sin necesitar `node_modules`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlResourceProblems, htmlResources, inlineProblems } from '../app/shell-assets.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Las fuentes que se compilan. */
export const UI_SOURCES = 'ui';
/** La constancia del último build, fuera de `web/`. */
export const UI_BUILD_STATE = '.local-cache/ui-build/build.json';
/** Lo que decide los bytes además de las fuentes: la configuración, este módulo y las versiones exactas. */
export const UI_BUILD_TOOLING = Object.freeze(['vite.config.mjs', 'pipeline/ui-build.mjs', 'package.json', 'pnpm-lock.yaml']);
/** Las páginas que emite Vite; el resto de su salida vive en `assets/`. */
export const UI_PAGES = Object.freeze(['index.html', '404.html']);
const ASSETS = 'assets/';

/** ¿Es un destino de este build? Solo esos se escriben o se retiran en `web/`. */
export const isUiOutput = (relativo) => UI_PAGES.includes(relativo)
  || (relativo.startsWith(ASSETS) && relativo.length > ASSETS.length && !relativo.split('/').some((parte) => parte === '..' || parte === '.' || parte === ''));

// Orden por unidades de código, no por idioma: la huella no puede depender de la
// versión de ICU de cada Node.
const porCodigo = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const huella = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const huellaDe = (archivo) => huella(fs.readFileSync(archivo));
const esArchivo = (archivo) => fs.existsSync(archivo) && fs.statSync(archivo).isFile();

/** Archivos bajo `dir`, relativos y con `/`, ordenados. Sin ocultos (`.DS_Store`). Un directorio ausente no tiene ninguno. */
function archivosDe(dir, prefijo = '') {
  if (!fs.existsSync(dir)) return [];
  const salida = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name.startsWith('.')) continue;
    const relativo = `${prefijo}${entrada.name}`;
    if (entrada.isDirectory()) salida.push(...archivosDe(path.join(dir, entrada.name), `${relativo}/`));
    else if (entrada.isFile()) salida.push(relativo);
  }
  return salida.sort(porCodigo);
}

/** ¿Existe `relativo` con estas mayúsculas exactas? macOS perdona la diferencia; Linux, donde compila CI, no. */
function rutaExacta(root, relativo) {
  let dir = root;
  for (const parte of relativo.split('/')) {
    if (!fs.readdirSync(dir).includes(parte)) return false;
    dir = path.join(dir, parte);
  }
  return true;
}

function escribirAtomico(destino, contenido) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporal = `${destino}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporal, contenido, { mode: 0o644, flag: 'wx' });
  fs.renameSync(temporal, destino);
}

/** La constancia del último build, o `null` si nunca hubo uno. */
export function readUiBuild({ root = rootFromModule } = {}) {
  const archivo = path.join(root, UI_BUILD_STATE);
  if (!fs.existsSync(archivo)) return null;
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return { status: 'ilegible' }; }
}

/** Fuentes de `ui/` y herramientas: entran siempre en la constancia. */
const candidatas = (root) => [...archivosDe(path.join(root, UI_SOURCES)).map((relativo) => `${UI_SOURCES}/${relativo}`), ...UI_BUILD_TOOLING];

/** Lo que el build puede leer: las candidatas y los módulos de `web/` que el bundle puede incluir. */
const vigiladas = (root) => [
  ...candidatas(root),
  ...archivosDe(path.join(root, 'web')).filter((relativo) => relativo.endsWith('.js') && !relativo.startsWith('data/') && !relativo.startsWith(ASSETS)).map((relativo) => `web/${relativo}`),
];

/**
 * Las entradas del build con su huella: `ui/` entero, las herramientas y cada
 * módulo del grafo que compiló Vite fuera de `node_modules` —los de `web/lib/`,
 * por ejemplo, que viajan dentro del bundle—. Las dependencias las fija el
 * lockfile, que también es entrada.
 */
function entradas(root, modulos) {
  const rutas = new Set(candidatas(root));
  // Vite da rutas reales: `/tmp` en macOS es `/private/tmp`.
  const raizReal = fs.realpathSync(root);
  for (const id of modulos) {
    if (id.startsWith('\0')) continue;
    const archivo = id.replace(/[?#].*$/, '');
    if (!path.isAbsolute(archivo) || archivo.split(path.sep).includes('node_modules')) continue;
    const relativo = path.relative(raizReal, archivo).split(path.sep).join('/');
    if (relativo.startsWith('../') || path.isAbsolute(relativo)) throw new Error(`el build lee ${archivo}, fuera del repositorio`);
    if (!esArchivo(archivo)) continue;
    if (!rutaExacta(root, relativo)) throw new Error(`el build importa ${relativo} con otras mayúsculas; en Linux, donde compila CI, no existe`);
    rutas.add(relativo);
  }
  return Object.fromEntries([...rutas].sort(porCodigo).map((relativo) => [relativo, huellaDe(path.join(root, relativo))]));
}

/** La versión de Rolldown que fija el lockfile; Vite solo declara un rango. */
function rolldownDelLockfile(root) {
  const lockfile = path.join(root, 'pnpm-lock.yaml');
  if (!esArchivo(lockfile)) return null;
  return /^ {2}rolldown@(\d+\.\d+\.\d+[^:\s]*):$/m.exec(fs.readFileSync(lockfile, 'utf8'))?.[1] ?? null;
}

/**
 * Vite con la configuración del repositorio, hacia `stagingDir`. Exige las
 * versiones exactas del lockfile y trata cualquier aviso como fallo: «no se
 * resolvió al compilar» o un `node:` sustituido por un módulo vacío son avisos
 * para Vite y una página rota para quien la abre.
 */
async function compilar({ root, stagingDir }) {
  const vite = await import('vite');
  const fijada = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies?.vite;
  if (vite.version !== fijada) throw new Error(`vite ${vite.version} instalada no es la fijada en package.json (${fijada}); ejecuta pnpm install --frozen-lockfile`);
  const rolldown = rolldownDelLockfile(root);
  if (rolldown && vite.rolldownVersion !== rolldown) throw new Error(`rolldown ${vite.rolldownVersion} instalado no es el del lockfile (${rolldown}); ejecuta pnpm install --frozen-lockfile`);
  const avisos = [];
  const logger = vite.createLogger('warn');
  const anotar = (metodo) => (mensaje, opciones) => { avisos.push(String(mensaje)); logger[metodo](mensaje, opciones); };
  const modulos = new Set();
  await vite.build({
    configFile: path.join(root, 'vite.config.mjs'),
    configLoader: 'native',
    logLevel: 'warn',
    customLogger: { ...logger, warn: anotar('warn'), warnOnce: anotar('warnOnce') },
    // El staging es nuevo y vacío: no hay nada que vaciar, y así ningún error de
    // configuración puede vaciar otra carpeta.
    build: { outDir: stagingDir, emptyOutDir: false },
    plugins: [{ name: 'masfacil:grafo', generateBundle() { for (const id of this.getModuleIds()) modulos.add(id); } }],
  });
  if (avisos.length) throw new Error(`Vite avisó al compilar la interfaz: ${avisos.join(' | ')}`);
  return { modulos, versiones: { vite: vite.version, rolldown: vite.rolldownVersion } };
}

/**
 * Lo compilado, comprobado antes de tocar `web/`. Lanza si no es publicable.
 * El manifiesto de Vite se lee aquí y no se instala.
 */
export function inspectStaging({ stagingDir, webRoot }) {
  const manifestPath = path.join(stagingDir, '.vite', 'manifest.json');
  if (!esArchivo(manifestPath)) throw new Error('El build de la interfaz no dejó su manifiesto (.vite/manifest.json)');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const archivos = archivosDe(stagingDir).filter((relativo) => !relativo.startsWith('.vite/'));
  const problemas = archivos.filter((relativo) => !isUiOutput(relativo)).map((relativo) => `salida inesperada: ${relativo}`);
  // Sin carga diferida: un chunk pedido después del deploy siguiente ya no existiría.
  for (const [clave, chunk] of Object.entries(manifest)) {
    if (chunk.isDynamicEntry || chunk.dynamicImports?.length) problemas.push(`${clave} introduce carga diferida de código`);
  }
  const emitidos = new Set(archivos.map((relativo) => `/${relativo}`));
  // Lo que no es de `assets/` sale del árbol publicado: iconos y manifiesto.
  const existe = (ruta) => (ruta.startsWith(`/${ASSETS}`) ? emitidos.has(ruta) : !ruta.split('/').includes('..') && esArchivo(path.join(webRoot, ruta)));
  for (const pagina of UI_PAGES) {
    if (!archivos.includes(pagina)) { problemas.push(`falta ${pagina}`); continue; }
    const html = fs.readFileSync(path.join(stagingDir, pagina), 'utf8');
    problemas.push(...inlineProblems(pagina, html), ...htmlResourceProblems(pagina, html, { exists: existe }));
    const modulo = manifest[pagina]?.file;
    if (!modulo || !htmlResources(html).some(({ tag, type, url }) => tag === 'script' && type === 'module' && url === `/${modulo}`)) problemas.push(`${pagina} no carga su módulo compilado`);
  }
  // Una hoja que cargara algo fuera del build lo pediría sin que viaje en la precache.
  for (const hoja of archivos.filter((relativo) => relativo.endsWith('.css'))) {
    for (const [, url] of fs.readFileSync(path.join(stagingDir, hoja), 'utf8').matchAll(/url\(\s*['"]?([^'")\s]+)/g)) {
      if (url.startsWith('data:') || url.startsWith('#')) continue;
      const ruta = (url.startsWith('/') ? url : path.posix.join('/', path.posix.dirname(hoja), url)).replace(/[?#].*$/, '');
      if (!emitidos.has(ruta)) problemas.push(`${hoja} carga ${url}, que no salió del build: sin red faltaría`);
    }
  }
  if (problemas.length) throw new Error(`El build de la interfaz no es publicable: ${problemas.join('; ')}`);
  return { archivos, manifest };
}

/**
 * Instala lo compilado en `web/` por inventario.
 *
 * La constancia pasa a `installing`, con todo lo que puede quedar en disco,
 * antes de escribir nada: si el proceso muere a mitad, la verificación la rechaza
 * y el siguiente build sabe qué retirar. Primero los assets —con hash, no pisan a
 * los vigentes—, después las páginas que los cargan y al final se retira solo lo
 * que este build instaló antes y ya no emite.
 */
export function installUiBuild({ root = rootFromModule, stagingDir, archivos, inputs, manifest, versiones, copiar = (origen, destino) => escribirAtomico(destino, fs.readFileSync(origen)) }) {
  const webRoot = path.join(root, 'web');
  const estadoPath = path.join(root, UI_BUILD_STATE);
  const anterior = readUiBuild({ root });
  const propios = (Array.isArray(anterior?.owned) ? anterior.owned : []).filter(isUiOutput);
  for (const relativo of archivos) if (!isUiOutput(relativo)) throw new Error(`destino ajeno al build: ${relativo}`);
  const outputs = Object.fromEntries(archivos.map((relativo) => [relativo, huellaDe(path.join(stagingDir, relativo))]));
  escribirAtomico(estadoPath, `${JSON.stringify({ schema: 1, status: 'installing', owned: [...new Set([...propios, ...archivos])].sort(porCodigo) }, null, 2)}\n`);
  const orden = [...archivos].sort((a, b) => (Number(UI_PAGES.includes(a)) - Number(UI_PAGES.includes(b))) || porCodigo(a, b));
  for (const relativo of orden) copiar(path.join(stagingDir, relativo), path.join(webRoot, relativo));
  for (const relativo of propios) if (!(relativo in outputs)) fs.rmSync(path.join(webRoot, relativo), { force: true });
  const estado = { schema: 1, status: 'complete', versions: versiones, inputs, outputs, owned: Object.keys(outputs).sort(porCodigo), manifest };
  escribirAtomico(estadoPath, `${JSON.stringify(estado, null, 2)}\n`);
  return estado;
}

/**
 * Compila `ui/` y la instala en `web/`. Un fallo de compilación o de la
 * comprobación ocurre antes de tocar `web/`. Si una fuente cambia mientras se
 * compila, el build no se instala: su constancia afirmaría bytes que no salieron
 * de esas fuentes.
 */
export async function buildUi({ root = rootFromModule, compile = compilar } = {}) {
  const base = path.join(root, path.dirname(UI_BUILD_STATE));
  fs.mkdirSync(base, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(base, 'staging-'));
  try {
    const antes = Object.fromEntries(vigiladas(root).filter((relativo) => esArchivo(path.join(root, relativo))).map((relativo) => [relativo, huellaDe(path.join(root, relativo))]));
    const { modulos, versiones } = await compile({ root, stagingDir });
    // Carga diferida, un `node:` sustituido por un módulo vacío o una librería en
    // su build de desarrollo (React con sus avisos) no se publican.
    const motivo = (id) => (id.includes('preload-helper') ? 'hay carga diferida de código'
      : id.includes('__vite-browser-external') ? `un módulo del navegador importa uno de Node (${id.replace(/^\0/, '')})`
        : `entra un build de desarrollo (${path.basename(id)})`);
    const ajenos = [...modulos].filter((id) => /vite\/preload-helper|__vite-browser-external|\.development\.js$/.test(id.replace(/[?#].*$/, '')));
    if (ajenos.length) throw new Error(`El build de la interfaz no es publicable: ${ajenos.map(motivo).join('; ')}`);
    const { archivos, manifest } = inspectStaging({ stagingDir, webRoot: path.join(root, 'web') });
    const inputs = entradas(root, modulos);
    // Un módulo de `web/` fuera del grafo no es entrada; una fuente de `ui/` o una
    // herramienta sí, así que su ausencia después de compilar también cuenta.
    const movidas = Object.keys(antes).filter((relativo) => (relativo in inputs ? inputs[relativo] !== antes[relativo] : !relativo.startsWith('web/')));
    if (movidas.length) throw new Error(`las fuentes cambiaron durante el build (${movidas.join(', ')}); vuelve a compilar`);
    return installUiBuild({ root, stagingDir, archivos, inputs, manifest, versiones });
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Por qué lo que hay en `web/` no es un build válido de las fuentes actuales.
 * Vacío si lo es. Solo lee: verificar no compila ni repara.
 */
export function uiBuildProblems({ root = rootFromModule } = {}) {
  const estado = readUiBuild({ root });
  if (!estado) return [`falta la constancia del build (${UI_BUILD_STATE}); ejecuta npm run build`];
  if (estado.status !== 'complete') return [`el último build de la interfaz no terminó (${estado.status}); ejecuta npm run build`];
  const problemas = [];
  const registradas = estado.inputs ?? {};
  const distintas = Object.entries(registradas).filter(([relativo, esperada]) => !esArchivo(path.join(root, relativo)) || huellaDe(path.join(root, relativo)) !== esperada).map(([relativo]) => relativo);
  const nuevas = candidatas(root).filter((relativo) => !(relativo in registradas));
  const cambios = [...new Set([...distintas, ...nuevas])].sort(porCodigo);
  if (cambios.length) problemas.push(`el build no corresponde a las fuentes actuales (${cambios.slice(0, 5).join(', ')}${cambios.length > 5 ? ', …' : ''}); ejecuta npm run build`);
  for (const [relativo, esperada] of Object.entries(estado.outputs ?? {})) {
    const archivo = path.join(root, 'web', relativo);
    if (!esArchivo(archivo)) problemas.push(`falta web/${relativo}, salida del build`);
    else if (huellaDe(archivo) !== esperada) problemas.push(`web/${relativo} no es la salida del build`);
  }
  // `web/assets/` es solo del build: nada ajeno se publica por estar ahí.
  for (const relativo of archivosDe(path.join(root, 'web', 'assets'))) {
    if (!estado.outputs?.[`${ASSETS}${relativo}`]) problemas.push(`web/${ASSETS}${relativo} no salió de este build; retíralo o vuelve a compilar`);
  }
  return problemas;
}
