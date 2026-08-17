import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadValidatedDataset, toClientDataset, validateDataset } from '../app/contract.mjs';
import { haversineKm, nearestPool, orderOffers, visibleOffers } from '../app/public/haversine.js';
import { buildSanitizedMeasurement } from '../app/public/measurement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const fixturePath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('Haversine devuelve cero para el mismo punto y una distancia conocida', () => {
  assert.equal(haversineKm({ latitude: -12.1, longitude: -77.03 }, { latitude: -12.1, longitude: -77.03 }), 0);
  const limaToCallao = haversineKm({ latitude: -12.0464, longitude: -77.0428 }, { latitude: -12.0566, longitude: -77.1181 });
  assert.ok(limaToCallao > 8 && limaToCallao < 9);
});

test('Haversine rechaza coordenadas inválidas', () => {
  assert.throws(() => haversineKm({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }), /fuera de rango/);
  assert.throws(() => haversineKm({}, { latitude: 0, longitude: 0 }), /numéricas/);
});

test('el orden usa el criterio explícito y desempata de forma estable por ID', () => {
  const offers = [
    { id: 'offer_c', distance_km: 2, price: 17, age_days: 3 },
    { id: 'offer_b', distance_km: 1, price: 18, age_days: 1 },
    { id: 'offer_a', distance_km: 1, price: 16, age_days: 2 },
  ];
  assert.deepEqual(orderOffers(offers, 'distance').map(({ id }) => id), ['offer_a', 'offer_b', 'offer_c']);
  assert.deepEqual(orderOffers(offers, 'price').map(({ id }) => id), ['offer_a', 'offer_c', 'offer_b']);
  assert.deepEqual(orderOffers(offers, 'freshness').map(({ id }) => id), ['offer_b', 'offer_a', 'offer_c']);
});

test('el pool excluye una estación remota aunque sea la más barata', () => {
  const nearby = Array.from({ length: 20 }, (_, index) => ({
    id: `offer_${String(index).padStart(2, '0')}`,
    distance_km: index + 1,
    price: 18 + index / 100,
    age_days: index,
  }));
  const remoteBargain = { id: 'offer_remote', distance_km: 80, price: 1, age_days: 0 };
  const offers = [remoteBargain, ...nearby].reverse();
  assert.equal(nearestPool(offers, 20).some(({ id }) => id === remoteBargain.id), false);
  assert.equal(visibleOffers(offers, 'price', 20, 6).some(({ id }) => id === remoteBargain.id), false);
});

test('los tres órdenes del pool son deterministas y estables', () => {
  const offers = [
    { id: 'offer_d', distance_km: 4, price: 14, age_days: 4 },
    { id: 'offer_c', distance_km: 1, price: 16, age_days: 2 },
    { id: 'offer_b', distance_km: 1, price: 15, age_days: 2 },
    { id: 'offer_a', distance_km: 1, price: 15, age_days: 1 },
  ];
  const expected = {
    distance: ['offer_a', 'offer_b', 'offer_c', 'offer_d'],
    price: ['offer_d', 'offer_a', 'offer_b', 'offer_c'],
    freshness: ['offer_a', 'offer_b', 'offer_c', 'offer_d'],
  };
  for (const criterion of Object.keys(expected)) {
    const first = visibleOffers(offers, criterion, 20, 6).map(({ id }) => id);
    const second = visibleOffers([...offers].reverse(), criterion, 20, 6).map(({ id }) => id);
    assert.deepEqual(first, expected[criterion]);
    assert.deepEqual(second, expected[criterion]);
  }
});

test('el fixture demo cumple el contrato y contiene alternativas comparables', () => {
  assert.deepEqual(validateDataset(fixture, schema), []);
  assert.ok(fixture.offers.length >= 3);
  assert.ok(new Set(fixture.offers.map((offer) => offer.price)).size >= 3);
});

test('el validador rechaza campos inferidos y datasets vacíos', () => {
  const withBrand = structuredClone(fixture);
  withBrand.offers[0].brand = 'INFERIDA';
  assert.ok(validateDataset(withBrand, schema).some((error) => error.includes('campos inesperados')));
  const empty = structuredClone(fixture);
  empty.offers = [];
  assert.ok(validateDataset(empty, schema).some((error) => error.includes('no puede estar vacío')));
});

test('la proyección al navegador expone solo campos requeridos', () => {
  const dataset = loadValidatedDataset(fixturePath, schemaPath);
  const client = toClientDataset(dataset, 'demo');
  assert.equal(client.mode, 'demo');
  assert.deepEqual(Object.keys(client.offers[0]).sort(), ['address','age_days','district','id','identity_label','latitude','legal_name','longitude','price','reported_at'].sort());
  assert.equal(JSON.stringify(client).includes('source_row_id'), false);
  assert.equal(JSON.stringify(client).includes('establishment_id'), false);
});

test('la medición conserva acciones y elección sin coordenadas ni identidad', () => {
  const measurement = buildSanitizedMeasurement({
    dataset: { mode: 'demo', dataset_id: 'dataset-demo' },
    session: { startedAt: 100, originKind: 'browser', actions: [{ at_ms: 0, type: 'origin_requested', value: 'browser' }] },
    selected: { completedAt: 925, rank: 2, sort: 'price', offer: { id: 'offer_demo', latitude: -12.1, longitude: -77.1, legal_name: 'NO EXPORTAR' } },
  });
  assert.equal(measurement.duration_ms, 825);
  assert.equal(measurement.choice.offer_id, 'offer_demo');
  assert.equal(JSON.stringify(measurement).includes('-12.1'), false);
  assert.equal(JSON.stringify(measurement).includes('NO EXPORTAR'), false);
});
