// La vista de GNV: un solo producto por metro cúbico. Su precio nunca se
// compara con uno por galón: la etiqueta, el orden y la tarjeta solo miran GNV,
// y en su vista no aparece «galón» en ninguna parte.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIVE_VIEWS, PRODUCTS, VIEWS } from '../web/lib/catalog.js';
import { createSearch, evaluateRows, resultsView, withDistances } from '../web/lib/search.js';
import { mergeProducts } from '../web/lib/merge-products.js';
import { decisionTag } from '../web/lib/decision-view.js';
import { offerCardView, offerDetailView } from '../ui/offer-view.js';

const AHORA = new Date('2026-09-24T12:00:00.000Z');
const ORIGEN = { latitude: -12.12, longitude: -77.03 };
const oferta = (letra, precio, distrito, dLat = 0) => ({ id: `gnv1_${letra.repeat(24)}`, establishment_id: `est_${letra.repeat(24)}`, commercial_identity: null, address: 'Av. Larco 123', price: precio, reported_at: '2026-09-23T12:00:00.000Z', facilito: null, district: distrito, longitude: -77.03, latitude: -12.12 + dLat });
const filas = (ofertas) => evaluateRows(mergeProducts({ key: 'gnv', manifest: { revision_id: 'gnv-x' }, dataset: { scope: {}, snapshot_date: '2026-09-24', cutoff_at: '2026-09-24T06:00:00.000Z', provenance: {}, offers: ofertas }, dataMode: 'network' }), AHORA).rows;

test('GNV es la cuarta vista, en metros cúbicos y sin histórico', () => {
  assert.deepEqual(ACTIVE_VIEWS, ['gasolina', 'diesel', 'glp', 'gnv']);
  assert.deepEqual([VIEWS.gnv.label, VIEWS.gnv.history, VIEWS.gnv.priceUnit, VIEWS.gnv.dataRoot], ['GNV', false, 'por m³', 'data/gnv']);
  assert.deepEqual([PRODUCTS.gnv.unit, PRODUCTS.regular.unit, PRODUCTS.glp.unit], ['Metros Cúbicos', 'Galones', 'Galones']);
});

test('GNV ordena por su precio, sin selector de producto y con su etiqueta', () => {
  const rows = filas([oferta('a', 1.79, 'MIRAFLORES'), oferta('b', 1.69, 'MIRAFLORES', 0.01), oferta('c', 1.73, 'SURQUILLO', 0.02)]);
  const search = { ...createSearch('gnv'), origin: ORIGEN, radiusKm: 5, sort: 'price' };
  assert.equal(search.priceProduct, 'gnv');
  const vista = resultsView({ rows, located: withDistances(rows, search.origin), search });
  assert.deepEqual(vista.items.map((item) => item.prices.gnv.price), [1.69, 1.73, 1.79]);
  assert.equal(vista.productToggle, false);
  assert.equal(decisionTag(vista.items[0], vista.pool, 5, 'gnv'), 'GNV más barato en 5 km');
});

test('la tarjeta de GNV dice «por m³» y nunca «galón»', () => {
  const [fila] = filas([oferta('a', 1.77, 'MIRAFLORES')]);
  const tarjeta = offerCardView(fila, { includeDetail: false, withDistance: false, directionsUrl: 'https://example.test/ruta', products: VIEWS.gnv.products, priceUnit: VIEWS.gnv.priceUnit });
  assert.deepEqual(tarjeta.prices, [{ key: 'gnv', state: null, chip: 'GNV', label: 'GNV comprimido', amount: '1.77', unit: 'por m³' }]);
  const detalle = offerDetailView(fila, { prices: fila.prices, products: VIEWS.gnv.products, priceUnit: VIEWS.gnv.priceUnit });
  assert.equal(detalle.rows[0].unit, 'por m³');
  for (const vista of [tarjeta, detalle]) assert.doesNotMatch(JSON.stringify(vista), /gal[oó]n/i);
});

test('un distrito sin GNV es un vacío propio', () => {
  const vista = resultsView({ rows: filas([oferta('a', 1.77, 'MIRAFLORES')]), located: [], search: { ...createSearch('gnv'), district: 'SANTA ROSA', sort: 'price' } });
  assert.deepEqual([vista.districtEmpty, vista.items.length], [true, 0]);
});
