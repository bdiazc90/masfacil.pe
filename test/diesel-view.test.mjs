// La vista de Diésel con las mismas reglas que Gasolina, pero de un solo
// producto: sin selector Regular/Premium, orden por su propio precio, etiqueta
// que concuerda y tarjeta que dice la unidad. La tarjeta de Gasolina no cambia.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GASOLINA_KEYS, VIEWS } from '../web/lib/catalog.js';
import { createSearch, evaluateRows, resultsView, withDistances } from '../web/lib/search.js';
import { mergeProducts } from '../web/lib/merge-products.js';
import { orderOffers } from '../web/lib/haversine.js';
import { decisionTag } from '../web/lib/decision-view.js';
import { renderOfferCard, renderOfferDetail } from '../web/offer-card.js';

const AHORA = new Date('2026-09-24T12:00:00.000Z');
const oferta = (letra, precio, distrito, dLat = 0) => ({ id: `d1_${letra.repeat(24)}`, establishment_id: `est_${letra.repeat(24)}`, commercial_identity: null, address: 'Av. Larco 123', price: precio, reported_at: '2026-09-23T12:00:00.000Z', facilito: null, district: distrito, longitude: -77.03, latitude: -12.12 + dLat });
const conjunto = (ofertas) => mergeProducts({ key: 'diesel', manifest: { revision_id: 'diesel-x' }, dataset: { scope: {}, snapshot_date: '2026-09-24', cutoff_at: '2026-09-24T06:00:00.000Z', provenance: {}, offers: ofertas }, dataMode: 'network' });

test('el conjunto de una vista declara sus productos y las filas los respetan', () => {
  const dataset = conjunto([oferta('a', 25.49, 'MIRAFLORES'), oferta('b', 24.99, 'MIRAFLORES')]);
  assert.deepEqual(dataset.products, ['diesel']);
  const { rows } = evaluateRows(dataset, AHORA);
  assert.deepEqual(Object.keys(rows[0].prices), ['diesel']);
  assert.equal(rows.every((row) => row.has_price), true);
});

test('Diésel ordena por su precio, sin selector de producto y con su etiqueta', () => {
  const dataset = conjunto([oferta('a', 25.49, 'MIRAFLORES'), oferta('b', 24.99, 'MIRAFLORES', 0.01), oferta('c', 26.1, 'SURQUILLO', 0.02)]);
  const { rows } = evaluateRows(dataset, AHORA);
  const search = { ...createSearch('diesel'), origin: { latitude: -12.12, longitude: -77.03 }, radiusKm: 5, sort: 'price' };
  assert.equal(search.priceProduct, 'diesel');
  const vista = resultsView({ rows, located: withDistances(rows, search.origin), search });
  assert.deepEqual(vista.items.map((item) => item.prices.diesel.price), [24.99, 25.49, 26.1]);
  assert.equal(vista.productToggle, false, 'un solo producto: nada que elegir');
  assert.match(vista.tags.find(Boolean), /^Diésel más barato/);
  assert.equal(decisionTag(vista.items[0], vista.pool, 5, 'diesel'), 'Diésel más barato en 5 km');
});

test('un distrito sin grifos del combustible elegido es un vacío propio', () => {
  const dataset = conjunto([oferta('a', 25.49, 'MIRAFLORES')]);
  const { rows } = evaluateRows(dataset, AHORA);
  const vista = resultsView({ rows, located: [], search: { ...createSearch('diesel'), district: 'PUCUSANA', sort: 'price' } });
  assert.deepEqual([vista.districtEmpty, vista.items.length, vista.radiusEmpty], [true, 0, false]);
});

test('ordenar por un producto que no existe es un error, no un orden silencioso', () => {
  assert.throws(() => orderOffers([], 'price:glp'), /Criterio de orden desconocido/);
  assert.throws(() => orderOffers([], 'price:constructor'), /Criterio de orden desconocido/);
  assert.deepEqual(orderOffers([], 'price:regular'), []);
});

test('la tarjeta de Diésel dice el nombre preciso y la unidad; la de Gasolina no cambia', () => {
  const [fila] = evaluateRows(conjunto([oferta('a', 25.49, 'MIRAFLORES')]), AHORA).rows;
  const tarjeta = renderOfferCard(fila, { includeDetail: false, withDistance: false, directionsUrl: 'https://example.test/ruta', products: VIEWS.diesel.products, priceUnit: VIEWS.diesel.priceUnit });
  assert.match(tarjeta, /aria-label="Diésel B5 S-50 UV">B5 S-50 UV<\/span><b><small>S\/<\/small>25\.49<\/b><small class="offer__unit">por galón<\/small>/);
  assert.match(tarjeta, /aria-label="Cómo llegar a [^"]*, Diésel B5 S-50 UV S\/\s?25\.49"/);
  assert.match(renderOfferDetail(fila, { prices: fila.prices, products: VIEWS.diesel.products, priceUnit: VIEWS.diesel.priceUnit }), /por galón/);
  // Gasolina: con sus productos explícitos o sin decirlos, el mismo marcado.
  const gasolina = { ...fila, prices: { regular: fila.prices.diesel, premium: null } };
  assert.equal(renderOfferCard(gasolina, { withDistance: false }), renderOfferCard(gasolina, { withDistance: false, products: GASOLINA_KEYS, priceUnit: VIEWS.gasolina.priceUnit }));
  assert.doesNotMatch(renderOfferCard(gasolina, { withDistance: false }), /offer__unit/);
});
