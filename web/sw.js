import { SHELL_CACHE, DATA_CACHE, cacheFirst } from './sw-cache-policy.js';
import { GASOLINA_KEYS, validGasolinaBundle, validateGasolinaManifest } from './gasolina-contract.js';

const SHELL = ['/', '/styles.css', '/app.js', '/theme.js', '/controls-card.js', '/service-worker-ready.js', '/data-client.js', '/gasolina-contract.js', '/district-list.js', '/offer-card.js', '/sw-cache-policy.js', '/lib/haversine.js', '/lib/decision-view.js', '/lib/freshness.js', '/lib/directions.js', '/lib/merge-products.js', '/manifest.webmanifest', '/icons/logo.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png', '/icons/apple-touch-icon.png', '/icons/icon-512.svg'];
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
self.addEventListener('install', (event) => event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
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
  event.respondWith(cacheFirst({ request: event.request, cache: { match: async (request) => (await caches.open(SHELL_CACHE)).match(request), put: async (request, response) => (await caches.open(SHELL_CACHE)).put(request, response) }, fetchImpl: (request) => fetch(request) }).then(({ response }) => response));
});
