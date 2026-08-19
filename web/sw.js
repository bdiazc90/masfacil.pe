import { SHELL_CACHE, DATA_CACHE, cacheFirst, networkFirst } from './sw-cache-policy.js';
import { validBundle, validateManifest } from './public-contract.js';

const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/data-client.js', '/public-contract.js', '/sw-cache-policy.js', '/lib/haversine.js', '/lib/freshness.js', '/lib/directions.js', '/manifest.webmanifest', '/icons/icon-192.svg', '/icons/icon-512.svg'];
const manifestRequest = new Request('/data/manifest.json');
const tagged = (response, mode) => { const headers = new Headers(response.headers); headers.set('X-Facilito-Data-Mode', mode); return new Response(response.body, { status: response.status, statusText: response.statusText, headers }); };
async function cachedBundle(cache) {
  const manifestResponse = await cache.match(manifestRequest); if (!manifestResponse) return null;
  let manifest; try { manifest = await manifestResponse.clone().json(); } catch { return null; }
  if (!validateManifest(manifest)) return null;
  const snapshot = await cache.match(new Request(`/${manifest.dataset_url}`)); if (!snapshot) return null;
  const body = await snapshot.clone().text(); if (!(await validBundle(manifest, body))) return null;
  return { manifestResponse, manifest };
}
async function fetchAndCacheBundle() {
  const data = await caches.open(DATA_CACHE);
  const manifestResponse = await fetch(manifestRequest, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.clone().json(); if (!validateManifest(manifest)) throw new Error('manifest inválido');
  const snapshotRequest = new Request(`/${manifest.dataset_url}`);
  const snapshotResponse = await fetch(snapshotRequest, { cache: 'no-store' });
  if (!snapshotResponse.ok) throw new Error(`snapshot HTTP ${snapshotResponse.status}`);
  const body = await snapshotResponse.clone().text(); if (!(await validBundle(manifest, body))) throw new Error('bundle inválido');
  await data.put(snapshotRequest, snapshotResponse.clone()); await data.put(manifestRequest, manifestResponse.clone());
  return manifestResponse;
}
self.addEventListener('install', (event) => event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith('facilito-') && ![SHELL_CACHE, DATA_CACHE].includes(name)).map((name) => caches.delete(name)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url); if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/data/manifest.json') {
    event.respondWith(networkFirst({ request: event.request, cache: { match: (request) => cachedBundle(caches.open(DATA_CACHE).then((cache) => cache)).then((bundle) => bundle?.manifestResponse) }, fetchImpl: async () => fetchAndCacheBundle(), fallback: async () => { const cache = await caches.open(DATA_CACHE); const bundle = await cachedBundle(cache); return bundle ? tagged(bundle.manifestResponse, 'saved') : null; } }).then(({ response, source }) => source === 'network' ? tagged(response, 'network') : response)); return;
  }
  if (url.pathname.startsWith('/data/snapshots/')) {
    event.respondWith(networkFirst({ request: event.request, cache: { match: async (request) => (await caches.open(DATA_CACHE)).match(request) }, fetchImpl: (request) => fetch(request, { cache: 'no-store' }), fallback: async (cache, request) => cache.match(request) }).then(({ response, source }) => tagged(response, source === 'network' ? 'network' : 'saved'))); return;
  }
  event.respondWith(cacheFirst({ request: event.request, cache: { match: async (request) => (await caches.open(SHELL_CACHE)).match(request), put: async (request, response) => (await caches.open(SHELL_CACHE)).put(request, response) }, fetchImpl: (request) => fetch(request) }).then(({ response }) => response));
});
