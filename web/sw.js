// La lista de la precache y su versión son generadas: salen de las referencias
// del árbol y de la huella de esos bytes. El navegador reinstala el service
// worker cuando cambian los bytes de sus imports, así que importar el módulo
// generado ES el mecanismo de actualización.
import { SHELL, SHELL_CACHE } from './shell-manifest.js';
import { DATA_CACHE, cacheFirst } from './sw-cache-policy.js';
import { GASOLINA_KEYS, validGasolinaBundle, validateGasolinaManifest } from './gasolina-contract.js';
import { resolvePath } from './lib/routes.js';

const active = new Map();
const pairRequest = (key) => new Request(`/__masfacil-gasolina-pair/${key}`);
const tagged = (response, mode) => { const headers = new Headers(response.headers); headers.set('X-Masfacil-Data-Mode', mode); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); };
const requestedKey = (request) => { const key = new URL(request.url).searchParams.get('product'); return GASOLINA_KEYS.includes(key) ? key : null; };

async function cachedPair(key) {
  const cache = await caches.open(DATA_CACHE); const manifestResponse = await cache.match(pairRequest(key));
  if (!manifestResponse) return null;
  try {
    const manifest = await manifestResponse.clone().json(); if (!validateGasolinaManifest(manifest)) return null;
    const descriptor = manifest.products[key]; const snapshot = await cache.match(new Request(`/${descriptor.dataset_url}`));
    if (!snapshot || !(await validGasolinaBundle(manifest, key, await snapshot.clone().text()))) return null;
    return { manifestResponse, manifest, snapshot };
  } catch { return null; }
}
async function networkManifest(request, key) {
  const response = await fetch(request, { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest gasolina HTTP ${response.status}`);
  const manifest = await response.clone().json(); if (!validateGasolinaManifest(manifest)) throw new Error('manifest gasolina inválido');
  active.set(key, { manifest, response: response.clone() }); return response;
}
async function networkSnapshot(request, key) {
  let entry = active.get(key);
  if (!entry || entry.manifest.products[key].dataset_url !== new URL(request.url).pathname.slice(1)) {
    const manifestRequest = new Request(`/data/gasolina/manifest.json?product=${key}`);
    await networkManifest(manifestRequest, key); entry = active.get(key);
  }
  const response = await fetch(request, { cache: 'no-store' });
  if (!response.ok) throw new Error(`snapshot gasolina HTTP ${response.status}`);
  if (!(await validGasolinaBundle(entry.manifest, key, await response.clone().text()))) throw new Error('snapshot gasolina de otra revisión o inválido');
  const cache = await caches.open(DATA_CACHE); await cache.put(request, response.clone()); await cache.put(pairRequest(key), entry.response.clone());
  return response;
}
// La 404 propia se guarda aparte. En Pages `/404.html` responde con un 308 a
// `/404`, y una respuesta redirigida no se puede servir a una navegación: se
// guarda una copia limpia, que es la que se devuelve sin red, con estado 404.
const NOT_FOUND = '/404.html';
async function guardarNotFound(cache) {
  const response = await fetch(NOT_FOUND);
  if (!response.ok) throw new Error(`404 propia HTTP ${response.status}`);
  await cache.put(NOT_FOUND, new Response(await response.blob(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
}
self.addEventListener('install', (event) => event.waitUntil(caches.open(SHELL_CACHE).then((cache) => Promise.all([cache.addAll(SHELL.filter((entry) => entry !== NOT_FOUND)), guardarNotFound(cache)])).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => /^(?:masfacil|facilito)-/.test(name) && ![SHELL_CACHE, DATA_CACHE].includes(name)).map((name) => caches.delete(name)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url); if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/data/gasolina/manifest.json') {
    const key = requestedKey(event.request); if (!key) { event.respondWith(new Response('Producto requerido', { status: 400 })); return; }
    event.respondWith(networkManifest(event.request, key).then((response) => tagged(response, 'network')).catch(async (error) => { const pair = await cachedPair(key); if (!pair) throw error; return tagged(pair.manifestResponse, 'saved'); })); return;
  }
  if (/^\/data\/gasolina\/snapshots\/[^/]+\/(regular|premium)\.json$/.test(url.pathname)) {
    event.respondWith((async () => {
      let resolved = GASOLINA_KEYS.find((item) => active.get(item)?.manifest.products[item].dataset_url === url.pathname.slice(1));
      if (!resolved) for (const item of GASOLINA_KEYS) { const pair = await cachedPair(item); if (pair?.manifest.products[item].dataset_url === url.pathname.slice(1)) { resolved = item; break; } }
      if (!resolved) return fetch(event.request);
      try { return tagged(await networkSnapshot(event.request, resolved), 'network'); }
      catch (error) { const pair = await cachedPair(resolved); if (!pair || pair.manifest.products[resolved].dataset_url !== url.pathname.slice(1)) throw error; return tagged(pair.snapshot, 'saved'); }
    })()); return;
  }
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
