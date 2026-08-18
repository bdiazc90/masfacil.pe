import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCommercialIdentityIndex } from '../app/commercial-overlay.mjs';
import { loadValidatedDataset, toClientDataset } from '../app/contract.mjs';
import { pickIdentityProbeOrigin } from '../app/public/debug-identity-probe.js';
import { nearestPool } from '../app/public/haversine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const datasetSchemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const overlayPath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-overlay.synthetic.json');
const dataset = loadValidatedDataset(datasetPath, datasetSchemaPath);
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));

test('la sonda elige la coordenada exacta de la primera oferta con identidad comercial proyectada', () => {
  const commercial = buildCommercialIdentityIndex(dataset, overlay, { projectionPolicy: 'private_preview' });
  const client = toClientDataset(dataset, 'demo', commercial.byAnchor, 'private_preview');
  const withIdentity = client.offers.find((offer) => offer.commercial_identity !== null);
  assert.ok(withIdentity, 'el fixture sintético debe proyectar al menos una identidad en private_preview');

  const origin = pickIdentityProbeOrigin(client.offers);
  assert.deepEqual(origin, { latitude: withIdentity.latitude, longitude: withIdentity.longitude });
});

test('sin ofertas con identidad comercial, la sonda declara ausencia sin lanzar ni fabricar una identidad', () => {
  const client = toClientDataset(dataset, 'demo', new Map(), 'public_safe');
  assert.ok(client.offers.every((offer) => offer.commercial_identity === null));
  assert.doesNotThrow(() => pickIdentityProbeOrigin(client.offers));
  assert.equal(pickIdentityProbeOrigin(client.offers), null);
});

test('la sonda nunca lanza una excepción no controlada ante entradas inválidas', () => {
  assert.equal(pickIdentityProbeOrigin([]), null);
  assert.equal(pickIdentityProbeOrigin(undefined), null);
  assert.equal(pickIdentityProbeOrigin(null), null);
  assert.equal(pickIdentityProbeOrigin('no-es-un-arreglo'), null);
  assert.equal(pickIdentityProbeOrigin([null, undefined, { commercial_identity: { brand: 'X' }, latitude: 'no-numero', longitude: -77 }]), null);
});

test('la sonda no muta el dataset servido ni las ofertas individuales', () => {
  const commercial = buildCommercialIdentityIndex(dataset, overlay, { projectionPolicy: 'private_preview' });
  const client = toClientDataset(dataset, 'demo', commercial.byAnchor, 'private_preview');
  const officialBefore = structuredClone(dataset);
  const clientBefore = structuredClone(client);

  pickIdentityProbeOrigin(client.offers);

  assert.deepEqual(dataset, officialBefore);
  assert.deepEqual(client, clientBefore);
});

test('el pool/orden del origen normal no se ve afectado por la existencia de la sonda', () => {
  const commercial = buildCommercialIdentityIndex(dataset, overlay, { projectionPolicy: 'private_preview' });
  const client = toClientDataset(dataset, 'demo', commercial.byAnchor, 'private_preview');
  const offersFromNormalOrigin = client.offers.map((offer, index) => ({ ...offer, distance_km: index + 1 }));

  const poolBefore = nearestPool(offersFromNormalOrigin, 20);
  const probedOrigin = pickIdentityProbeOrigin(client.offers);
  assert.ok(probedOrigin);
  const poolAfter = nearestPool(offersFromNormalOrigin, 20);

  assert.deepEqual(poolBefore, poolAfter);
});
