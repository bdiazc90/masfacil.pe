// La lista de la precache y su versión son generadas: salen de las referencias
// del árbol y de la huella de esos bytes. El navegador reinstala el service
// worker cuando cambian los bytes de sus imports, así que importar el módulo
// generado ES el mecanismo de actualización.
import { SHELL, SHELL_CACHE } from './shell-manifest.js';
import { DATA_CACHE, cacheFirst } from './sw-cache-policy.js';
import { ACTIVE_VIEWS, VIEWS } from './lib/catalog.js';
import { GROUP_CONTRACTS } from './group-contracts.js';
import { resolvePath } from './lib/routes.js';

// Datos por grupo. Cada grupo activo guarda UN conjunto completo —su manifest y
// todos sus snapshots de esa revisión— bajo `/__masfacil-pair/<grupo>`, y sin red
// solo se entrega ese conjunto, entero: nunca un producto de una revisión con otro
// de otra. Refrescar un grupo no toca las claves de ningún otro.
const GRUPOS = Object.freeze(Object.fromEntries(ACTIVE_VIEWS.map((key) => {
  if (!GROUP_CONTRACTS[key]) throw new Error(`Vista activa sin contrato: ${key}`);
  return [key, Object.freeze({ key, dataRoot: VIEWS[key].dataRoot, products: VIEWS[key].products, ...GROUP_CONTRACTS[key] })];
})));
const conjuntoRequest = (group) => new Request(`/__masfacil-pair/${group}`);
// Pares por producto del service worker anterior. Para Gasolina se siguen
// escribiendo, siempre iguales al conjunto, para que volver a la versión
// anterior conserve la copia guardada.
const parAntiguoRequest = (key) => new Request(`/__masfacil-gasolina-pair/${key}`);
const snapshotRequest = (manifest, key) => new Request(`/${manifest.products[key].dataset_url}`);
const active = new Map();
const tagged = (response, mode) => { const headers = new Headers(response.headers); headers.set('X-Masfacil-Data-Mode', mode); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); };

function rutaDeDatos(url) {
  for (const grupo of Object.values(GRUPOS)) {
    const raiz = `/${grupo.dataRoot}/`;
    if (!url.pathname.startsWith(raiz)) continue;
    const resto = url.pathname.slice(raiz.length);
    // `?product=` lo manda la app de antes y la de ahora; el manifest es del grupo.
    if (resto === 'manifest.json') return { grupo, tipo: 'manifest', deCopia: url.searchParams.get('guardado') === '1' };
    const key = /^snapshots\/[^/]+\/([a-z]+)\.json$/.exec(resto)?.[1];
    if (key && grupo.products.includes(key)) return { grupo, tipo: 'snapshot', key };
  }
  return null;
}

async function conjuntoGuardado(grupo) {
  const cache = await caches.open(DATA_CACHE);
  const manifestResponse = await cache.match(conjuntoRequest(grupo.key));
  if (!manifestResponse) return null;
  try {
    const manifest = await manifestResponse.clone().json();
    if (!grupo.validManifest(manifest)) return null;
    const snapshots = {};
    for (const key of grupo.products) {
      const snapshot = await cache.match(snapshotRequest(manifest, key));
      if (!snapshot || !(await grupo.validBundle(manifest, key, await snapshot.clone().text()))) return null;
      snapshots[key] = snapshot;
    }
    return { manifest, manifestResponse, snapshots };
  } catch { return null; }
}
async function manifestDeRed(grupo) {
  const response = await fetch(`/${grupo.dataRoot}/manifest.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest ${grupo.key} HTTP ${response.status}`);
  const manifest = await response.clone().json();
  if (!grupo.validManifest(manifest)) throw new Error(`manifest ${grupo.key} inválido`);
  active.set(grupo.key, { manifest, response: response.clone() });
  return response;
}
// Un conjunto pasa a ser la copia guardada solo cuando todos sus productos están
// en caché y validados. Entonces se retiran los snapshots que ya nadie
// referencia, y solo los de este grupo.
async function guardarSiCompleto(grupo, { manifest, response }) {
  const cache = await caches.open(DATA_CACHE);
  for (const key of grupo.products) if (!(await cache.match(snapshotRequest(manifest, key)))) return;
  await cache.put(conjuntoRequest(grupo.key), response.clone());
  if (grupo.key === 'gasolina') for (const key of grupo.products) await cache.put(parAntiguoRequest(key), response.clone());
  const vigentes = new Set(grupo.products.map((key) => `/${manifest.products[key].dataset_url}`));
  const prefijo = `/${grupo.dataRoot}/snapshots/`;
  for (const request of await cache.keys()) {
    const ruta = new URL(request.url).pathname;
    if (ruta.startsWith(prefijo) && !vigentes.has(ruta)) await cache.delete(request);
  }
}
async function snapshotDeRed(request, grupo, key) {
  const ruta = new URL(request.url).pathname.slice(1);
  let entrada = active.get(grupo.key);
  if (entrada?.manifest.products[key].dataset_url !== ruta) { await manifestDeRed(grupo); entrada = active.get(grupo.key); }
  // Un snapshot que no es de la revisión vigente solo puede salir de la copia guardada.
  if (entrada.manifest.products[key].dataset_url !== ruta) throw new Error(`snapshot ${grupo.key}/${key} fuera de la revisión vigente`);
  const response = await fetch(request, { cache: 'no-store' });
  if (!response.ok) throw new Error(`snapshot ${grupo.key}/${key} HTTP ${response.status}`);
  if (!(await grupo.validBundle(entrada.manifest, key, await response.clone().text()))) throw new Error(`snapshot ${grupo.key}/${key} de otra revisión o inválido`);
  const cache = await caches.open(DATA_CACHE);
  await cache.put(request, response.clone());
  await guardarSiCompleto(grupo, entrada);
  return response;
}
async function responderManifest({ grupo, deCopia }) {
  let fallo = new Error(`sin copia guardada de ${grupo.key}`);
  if (!deCopia) {
    try { return tagged(await manifestDeRed(grupo), 'network'); } catch (error) { fallo = error; }
  }
  const conjunto = await conjuntoGuardado(grupo);
  if (!conjunto) throw fallo;
  return tagged(conjunto.manifestResponse, 'saved');
}
async function responderSnapshot(request, { grupo, key }) {
  try { return tagged(await snapshotDeRed(request, grupo, key), 'network'); }
  catch (error) {
    const conjunto = await conjuntoGuardado(grupo);
    if (conjunto && `/${conjunto.manifest.products[key].dataset_url}` === new URL(request.url).pathname) return tagged(conjunto.snapshots[key], 'saved');
    throw error;
  }
}
// Una instalación anterior guardaba un par por producto. Si los pares forman un
// conjunto coherente —la misma revisión y los dos snapshots válidos— pasan a ser
// el conjunto guardado del grupo; si no, no se usan como copia. Los pares se
// conservan: volver a la versión anterior los necesita.
async function migrarParesAntiguos() {
  const grupo = GRUPOS.gasolina;
  if (!grupo) return;
  const cache = await caches.open(DATA_CACHE);
  if (await cache.match(conjuntoRequest(grupo.key))) return;
  const pares = await Promise.all(grupo.products.map((key) => cache.match(parAntiguoRequest(key))));
  if (pares.some((par) => !par)) return;
  const manifiestos = await Promise.all(pares.map((par) => par.clone().json()));
  if (manifiestos.some((manifest) => manifest.revision_id !== manifiestos[0].revision_id)) return;
  const manifest = manifiestos[0];
  if (!grupo.validManifest(manifest)) return;
  for (const key of grupo.products) {
    const snapshot = await cache.match(snapshotRequest(manifest, key));
    if (!snapshot || !(await grupo.validBundle(manifest, key, await snapshot.clone().text()))) return;
  }
  await cache.put(conjuntoRequest(grupo.key), pares[0].clone());
}
// La 404 propia se guarda aparte. En Pages `/404.html` responde con un 308 a
// `/404`, y una respuesta redirigida no se puede servir a una navegación: se
// guarda una copia limpia, que es la que se devuelve sin red, con estado 404.
const NOT_FOUND = '/404.html';
async function guardarNotFound(cache) {
  const response = await fetch(NOT_FOUND, { cache: 'reload' });
  if (!response.ok) throw new Error(`404 propia HTTP ${response.status}`);
  await cache.put(NOT_FOUND, new Response(await response.blob(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}
// La precache va a la red sin pasar por la caché HTTP: en producción JS, CSS e
// imágenes llegan con `max-age=14400`, y una copia todavía fresca del deploy
// anterior quedaría guardada en el shell nuevo junto al HTML nuevo.
self.addEventListener('install', (event) => event.waitUntil(caches.open(SHELL_CACHE).then((cache) => Promise.all([cache.addAll(SHELL.filter((entry) => entry !== NOT_FOUND).map((entry) => new Request(entry, { cache: 'reload' }))), guardarNotFound(cache)])).then(() => self.skipWaiting())));
// Migrar va antes de limpiar, y un fallo al migrar no impide activar.
self.addEventListener('activate', (event) => event.waitUntil(migrarParesAntiguos().catch(() => {}).then(() => caches.keys()).then((names) => Promise.all(names.filter((name) => /^(?:masfacil|facilito)-/.test(name) && ![SHELL_CACHE, DATA_CACHE].includes(name)).map((name) => caches.delete(name)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url); if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const datos = rutaDeDatos(url);
  if (datos?.tipo === 'manifest') { event.respondWith(responderManifest(datos)); return; }
  if (datos?.tipo === 'snapshot') { event.respondWith(responderSnapshot(event.request, datos)); return; }
  if (event.request.mode === 'navigate') { event.respondWith(navegar(event.request, url)); return; }
  event.respondWith(cacheFirst({ request: event.request, cache: { match: async (request) => (await caches.open(SHELL_CACHE)).match(request), put: async (request, response) => (await caches.open(SHELL_CACHE)).put(request, response) }, fetchImpl: (request) => fetch(request) }).then(({ response }) => response));
});
// Navegaciones con la misma tabla de rutas que el hosting y el servidor local.
async function navegar(request, url) {
  const ruta = resolvePath(url.pathname);
  // Un enlace antiguo o con barra final redirige también sin red.
  if (ruta.kind === 'redirect') return Response.redirect(new URL(`${ruta.to}${url.search}`, url.origin).href, 301);
  const shell = await caches.open(SHELL_CACHE);
  // Cada vista es la misma portada: se sirve la `/` precacheada, también sin red
  // y sin guardar una copia por URL.
  if (ruta.kind === 'view') return (await cacheFirst({ request: new Request('/'), cache: shell, fetchImpl: (pedido) => fetch(pedido) })).response;
  // Lo que no es una vista no se disfraza de portada: un archivo del shell abierto
  // directamente sale del caché, lo demás de la red y, sin red, la 404 guardada
  // con su estado.
  const guardado = await shell.match(request);
  if (guardado) return guardado;
  try { return await fetch(request); }
  catch (error) {
    const pagina = await shell.match(NOT_FOUND);
    if (!pagina) throw error;
    return new Response(await pagina.blob(), { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
