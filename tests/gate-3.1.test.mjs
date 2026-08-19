import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { filterFreshOffers, FreshnessVerificationError, evaluateOfferFreshness } from '../app/public/freshness.js';
import { loadValidatedDataset, toClientDataset } from '../app/contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = path.join(root, '.local-cache', 'gate-1.1', '2026-08-14', 'experiment-dataset-lima-province.json');
const hasPrivateSnapshot = fs.existsSync(datasetPath);
const schemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const appSource = fs.readFileSync(path.join(root, 'app', 'public', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'app', 'public', 'index.html'), 'utf8');
const fixedNow = '2026-08-18T12:00:00.000Z';
const cutoffAt = '2026-08-14T12:00:00.000Z';
const offer = (reported_at) => ({ id: `offer-${reported_at}`, reported_at });

test('la vigencia es inclusiva a 30 días y excluye lo que excede el límite', () => {
  const at = new Date(fixedNow).getTime();
  const timestamp = (days) => new Date(at - days * 86_400_000).toISOString();
  assert.equal(evaluateOfferFreshness(offer(timestamp(29.999)), { now: () => fixedNow, cutoffAt }).visible, true);
  assert.equal(evaluateOfferFreshness(offer(timestamp(30)), { now: () => fixedNow, cutoffAt }).visible, true);
  assert.equal(evaluateOfferFreshness(offer(timestamp(30.001)), { now: () => fixedNow, cutoffAt }).visible, false);
});

test('fechas futuras o inválidas se excluyen sin inventar edad', () => {
  assert.equal(evaluateOfferFreshness(offer('2026-08-18T12:00:01.000Z'), { now: () => fixedNow, cutoffAt }).reason, 'future_reported_at');
  assert.equal(evaluateOfferFreshness(offer('fecha ilegible'), { now: () => fixedNow, cutoffAt }).reason, 'invalid_reported_at');
});

test('un reloj inválido o anterior al corte impide verificar y falla de forma conservadora', () => {
  assert.throws(() => filterFreshOffers([offer(fixedNow)], { now: () => 'no es fecha', cutoffAt }), FreshnessVerificationError);
  assert.throws(() => filterFreshOffers([offer(fixedNow)], { now: () => '2026-08-13T12:00:00.000Z', cutoffAt }), /anterior al corte/);
  assert.throws(() => filterFreshOffers([offer(fixedNow)], { cutoffAt }), /reloj inyectado/);
});

test('el filtrado recalcula edad y ocurre antes del pool y de los tres órdenes', () => {
  const result = filterFreshOffers([
    { ...offer('2026-08-18T11:00:00.000Z'), price: 30 },
    { ...offer('2026-08-17T12:00:00.000Z'), price: 10 },
    { ...offer('2026-07-18T11:59:59.000Z'), price: 1 },
  ], { now: () => fixedNow, cutoffAt });
  assert.equal(result.offers.length, 2);
  assert.deepEqual(result.offers.map(({ id }) => id), ['offer-2026-08-18T11:00:00.000Z', 'offer-2026-08-17T12:00:00.000Z']);
  assert.match(appSource, /filterFreshOffers[\s\S]*?state\.offers = prepareOffers[\s\S]*?nearestPool/);
  assert.match(appSource, /visibleOffers\(state\.offers, state\.sort/);
  assert.match(appSource, /orderOffers\(state\.pool, state\.sort/);
});

test('el estado vacío y la frescura visible están cableados en la interfaz', () => {
  assert.match(indexSource, /id="freshness-summary"/);
  assert.match(indexSource, /id="empty-state"/);
  assert.match(indexSource, /No quedan ofertas dentro de los últimos 30 días/);
  assert.match(appSource, /freshness\.queried_at/);
  assert.match(appSource, /offer\.age_days/);
  assert.match(appSource, /DEBUG_ALL_EXPIRED/);
});

test('la medición fija del snapshot real conserva el contrato y sobrevive con reloj 2026-08-18', { skip: !hasPrivateSnapshot }, () => {
  const dataset = loadValidatedDataset(datasetPath, schemaPath);
  const client = toClientDataset(dataset, 'real');
  const result = filterFreshOffers(client.offers, { now: () => fixedNow, cutoffAt: client.cutoff_at });
  assert.equal(result.total_offers, 714);
  assert.equal(result.fresh_offers, 714);
  assert.equal(result.offers.every((item) => item.age_days >= 0 && item.age_days <= 30), true);
});
