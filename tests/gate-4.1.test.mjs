import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectActiveSnapshot } from '../pipeline/project.mjs';
import { validatePublicBundle, validatePublicDataset, validatePublicManifest } from '../pipeline/public-contract.mjs';
import { cacheFirst, networkFirst } from '../web/sw-cache-policy.js';
import { loadPublicDataset } from '../web/data-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activeId = '2026-08-18-20260819T003213952Z-7928-71e6ba';
const privateSnapshotPath = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', activeId, 'dataset', 'experiment-dataset-lima-province.json');
const hasPrivateSnapshot = fs.existsSync(privateSnapshotPath);

function temporaryRoot() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-4.1-'));
  const snapshot = path.join(temp, '.local-cache', 'gate-3.3', 'snapshots', activeId, 'dataset', 'experiment-dataset-lima-province.json');
  fs.mkdirSync(path.dirname(snapshot), { recursive: true });
  fs.copyFileSync(privateSnapshotPath, snapshot);
  fs.mkdirSync(path.join(temp, 'contracts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json'), path.join(temp, 'contracts', 'gate-1.1-experiment-dataset.schema.json'));
  const pointer = { schema_version: 1, snapshot_id: activeId, snapshot_date: '2026-08-18', dataset_path: path.relative(temp, snapshot), source_url: 'https://www.osinergmin.gob.pe/example.csv', promoted_at: '2026-08-19T00:33:28.712Z' };
  const pointerPath = path.join(temp, '.local-cache', 'gate-3.3', 'active.json'); fs.writeFileSync(pointerPath, JSON.stringify(pointer));
  return temp;
}

test('la proyección pública real conserva 714 ofertas, 42 distritos y una allowlist exacta', { skip: !hasPrivateSnapshot }, () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-4.1-real-')); const result = projectActiveSnapshot({ root, outputRoot });
  assert.equal(result.dataset.offers.length, 714); assert.equal(result.districts, 42);
  assert.deepEqual(Object.keys(result.dataset.offers[0]).sort(), ['district', 'id', 'latitude', 'longitude', 'price', 'reported_at']);
  assert.equal(JSON.stringify(result.dataset).match(/RUC|legal_name|address|establishment_id|source_row_id|raw_path|lineage/), null);
  assert.ok(result.dataset.offers.every((offer) => Number.isFinite(offer.longitude) && Number.isFinite(offer.latitude)));
});

test('dos proyecciones del mismo pointer son deterministas, idempotentes y sellan bytes/hash', { skip: !hasPrivateSnapshot }, () => {
  const temp = temporaryRoot(); const output = path.join(temp, 'web', 'data'); const first = projectActiveSnapshot({ root: temp, outputRoot: output }); const before = fs.readFileSync(first.manifestPath, 'utf8'); const second = projectActiveSnapshot({ root: temp, outputRoot: output });
  assert.equal(before, fs.readFileSync(second.manifestPath, 'utf8')); assert.equal(first.manifest.sha256, second.manifest.sha256); assert.equal(first.bytes, second.bytes);
  assert.deepEqual(validatePublicBundle(first.manifest, fs.readFileSync(first.snapshotPath, 'utf8')), []);
});

test('un input inválido no reemplaza el manifest bueno', { skip: !hasPrivateSnapshot }, () => {
  const temp = temporaryRoot(); const output = path.join(temp, 'web', 'data'); const first = projectActiveSnapshot({ root: temp, outputRoot: output }); const manifest = fs.readFileSync(first.manifestPath, 'utf8'); const privatePath = path.join(temp, '.local-cache', 'gate-3.3', 'snapshots', activeId, 'dataset', 'experiment-dataset-lima-province.json'); const privateDataset = JSON.parse(fs.readFileSync(privatePath, 'utf8')); privateDataset.offers[0].coordinate.longitude = 0; fs.writeFileSync(privatePath, JSON.stringify(privateDataset));
  assert.throws(() => projectActiveSnapshot({ root: temp, outputRoot: output }), /Dataset fuera del contrato/); assert.equal(fs.readFileSync(first.manifestPath, 'utf8'), manifest);
});

test('los contratos públicos rechazan manifest o snapshot incoherentes', { skip: !hasPrivateSnapshot }, () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-4.1-contract-')); const result = projectActiveSnapshot({ root, outputRoot: output }); const bytes = fs.readFileSync(result.snapshotPath, 'utf8');
  assert.deepEqual(validatePublicManifest(result.manifest), []); assert.deepEqual(validatePublicDataset(result.dataset), []); assert.ok(validatePublicBundle({ ...result.manifest, sha256: crypto.createHash('sha256').update('otro').digest('hex') }, bytes).length > 0);
});

test('la política de caché usa shell cache-first, datos network-first y jamás guarda respuestas fallidas', async () => {
  const stored = new Map(); const cache = { match: async (request) => stored.get(request), put: async (request, response) => stored.set(request, response) }; const successful = { ok: true, clone() { return this; } }; const failed = { ok: false, clone() { return this; } };
  assert.equal((await cacheFirst({ request: 'shell', cache, fetchImpl: async () => successful })).source, 'network'); assert.equal((await cacheFirst({ request: 'shell', cache, fetchImpl: async () => { throw new Error('no debería pedir red'); } })).source, 'cache');
  const fallback = { saved: true }; assert.deepEqual((await networkFirst({ request: 'data', cache, fetchImpl: async () => { throw new Error('offline'); }, fallback: async () => fallback })).response, fallback);
  await assert.rejects(networkFirst({ request: 'bad', cache, fetchImpl: async () => failed, fallback: async () => null })); assert.equal(stored.has('bad'), false);
});

test('el cliente rechaza un manifest/snapshot incoherente y un cold-offline no fabrica lista vacía', { skip: !hasPrivateSnapshot }, async () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-4.1-client-')); const result = projectActiveSnapshot({ root, outputRoot: output }); const body = fs.readFileSync(result.snapshotPath, 'utf8');
  const responses = [new Response(JSON.stringify(result.manifest), { status: 200 }), new Response(body, { status: 200 })]; const loaded = await loadPublicDataset(async () => responses.shift()); assert.equal(loaded.dataset.offers.length, 714);
  const mismatch = { ...result.manifest, sha256: crypto.createHash('sha256').update('mismatch').digest('hex') }; const broken = [new Response(JSON.stringify(mismatch), { status: 200 }), new Response(body, { status: 200 })]; await assert.rejects(loadPublicDataset(async () => broken.shift()), /no coincide/);
  await assert.rejects(loadPublicDataset(async () => { throw new Error('offline'); }), /offline/);
});

test('la PWA declara manifest, iconos maskable, shell independiente y no consume /api/dataset', () => {
  const index = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8'); const manifest = JSON.parse(fs.readFileSync(path.join(root, 'web', 'manifest.webmanifest'), 'utf8')); const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8'); const worker = fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8');
  assert.match(index, /rel="manifest"/); assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ['192x192', '512x512']); assert.ok(manifest.icons.every((icon) => icon.purpose.includes('maskable'))); assert.ok(manifest.icons.every((icon) => fs.existsSync(path.join(root, 'web', icon.src)))); assert.doesNotMatch(app, /\/api\/dataset/); assert.match(app, /await prepareServiceWorker\(\);[\s\S]*?loadPublicDataset\(\)/); assert.match(worker, /cache\.addAll\(SHELL\)/); assert.match(worker, /skipWaiting/); assert.doesNotMatch(worker.match(/const SHELL = \[[\s\S]*?\];/)?.[0] ?? '', /data\/manifest/); assert.match(worker, /fetchAndCacheBundle/); assert.match(worker, /cachedBundle/);
});

test('el preview legado sirve la implementación compartida y reporta la política vigente', () => {
  const server = fs.readFileSync(path.join(root, 'app', 'server.mjs'), 'utf8');
  assert.match(server, /route\.startsWith\('\/web\/lib\/'\)/);
  assert.match(server, /\$\{subset\.locatable\}\/\$\{subset\.total\} ubicables/);
  assert.doesNotMatch(server, /Ubicables y listas para decidir son 0/);
});

test('la UI conserva filtro inclusivo antes del pool, órdenes, atribución y handoff solo con destino', () => {
  const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8'); assert.match(app, /filterFreshOffers[\s\S]*?state\.offers=[\s\S]*?nearestPool/); assert.match(app, /visibleOffers\(state\.offers,state\.sort,20,6\)/); assert.match(app, /safeGoogleMapsDirectionsUrl\(offer\)/); assert.match(app, /No hay datos guardados todavía/); assert.match(app, /Ver fuente de Osinergmin/); assert.match(app, /provenance\.source_url/);
});
