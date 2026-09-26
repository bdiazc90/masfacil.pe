// La vista de GLP con las reglas de Diésel: un solo producto, sin selector de
// producto, etiqueta que concuerda, tarjeta con su nombre preciso y la unidad.
// Sus establecimientos son los suyos —los gasocentros no están en Gasolina—, y
// al cambiar de combustible el radio que nadie eligió se recalcula con sus
// precios, mientras que uno elegido se conserva aunque deje un vacío.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIVE_VIEWS, VIEWS } from '../web/lib/catalog.js';
import { createSearch, evaluateRows, resultsView, startResults, withDistances } from '../web/lib/search.js';
import { mergeProducts } from '../web/lib/merge-products.js';
import { decisionTag } from '../web/lib/decision-view.js';
import { renderOfferCard, renderOfferDetail } from '../web/offer-card.js';

const AHORA = new Date('2026-09-24T12:00:00.000Z');
const ORIGEN = { latitude: -12.12, longitude: -77.03 };
const oferta = (prefijo, letra, precio, distrito, dLat = 0) => ({ id: `${prefijo}${letra.repeat(24)}`, establishment_id: `est_${letra.repeat(24)}`, commercial_identity: null, address: 'Av. Larco 123', price: precio, reported_at: '2026-09-23T12:00:00.000Z', facilito: null, district: distrito, longitude: -77.03, latitude: -12.12 + dLat });
const glp = (letra, precio, distrito, dLat) => oferta('glp1_', letra, precio, distrito, dLat);
const conjunto = (key, ofertas) => mergeProducts({ key, manifest: { revision_id: `${key}-x` }, dataset: { scope: {}, snapshot_date: '2026-09-24', cutoff_at: '2026-09-24T06:00:00.000Z', provenance: {}, offers: ofertas }, dataMode: 'network' });
const filas = (key, ofertas) => evaluateRows(conjunto(key, ofertas), AHORA).rows;

test('GLP es la tercera vista, sin histórico y con la unidad en la tarjeta', () => {
  assert.deepEqual(ACTIVE_VIEWS, ['gasolina', 'diesel', 'glp']);
  assert.deepEqual([VIEWS.glp.label, VIEWS.glp.history, VIEWS.glp.priceUnit, VIEWS.glp.dataRoot], ['GLP', false, 'por galón', 'data/glp']);
});

test('GLP ordena por su precio, sin selector de producto y con su etiqueta', () => {
  const rows = filas('glp', [glp('a', 7.49, 'MIRAFLORES'), glp('b', 7.29, 'MIRAFLORES', 0.01), glp('c', 7.59, 'SURQUILLO', 0.02)]);
  const search = { ...createSearch('glp'), origin: ORIGEN, radiusKm: 5, sort: 'price' };
  assert.equal(search.priceProduct, 'glp');
  const vista = resultsView({ rows, located: withDistances(rows, search.origin), search });
  assert.deepEqual(vista.items.map((item) => item.prices.glp.price), [7.29, 7.49, 7.59]);
  assert.equal(vista.productToggle, false, 'un solo producto: nada que elegir');
  assert.equal(decisionTag(vista.items[0], vista.pool, 5, 'glp'), 'GLP más barato en 5 km');
});

test('la tarjeta de GLP dice su nombre preciso para lectores, su chip y la unidad', () => {
  const [fila] = filas('glp', [glp('a', 7.49, 'MIRAFLORES')]);
  const tarjeta = renderOfferCard(fila, { includeDetail: false, withDistance: false, directionsUrl: 'https://example.test/ruta', products: VIEWS.glp.products, priceUnit: VIEWS.glp.priceUnit });
  assert.match(tarjeta, /data-key="glp"><span class="chip" role="img" aria-label="GLP automotor">GLP<\/span><b><small>S\/<\/small>7\.49<\/b><small class="offer__unit">por galón<\/small>/);
  assert.match(tarjeta, /aria-label="Cómo llegar a [^"]*, GLP automotor S\/\s?7\.49"/);
  assert.match(renderOfferDetail(fila, { prices: fila.prices, products: VIEWS.glp.products, priceUnit: VIEWS.glp.priceUnit }), /por galón/);
});

test('un gasocentro que solo vende GLP aparece en GLP aunque no esté en Gasolina, y un distrito sin GLP es un vacío propio', () => {
  const gasolina = filas('gasolina', [oferta('g2_', 'a', 15.49, 'MIRAFLORES')]).map((fila) => fila.establishment_id);
  const soloGlp = filas('glp', [glp('z', 7.19, 'MIRAFLORES')]);
  assert.equal(gasolina.includes(soloGlp[0].establishment_id), false);
  // El distrito que se trae desde Gasolina se conserva; si no tiene GLP, se dice.
  const enMiraflores = resultsView({ rows: soloGlp, located: [], search: { ...createSearch('glp'), district: 'MIRAFLORES', sort: 'price' } });
  assert.deepEqual(enMiraflores.items.map((item) => item.establishment_id), [`est_${'z'.repeat(24)}`]);
  const enPucusana = resultsView({ rows: soloGlp, located: [], search: { ...createSearch('glp'), district: 'PUCUSANA', sort: 'price' } });
  assert.deepEqual([enPucusana.districtEmpty, enPucusana.items.length, enPucusana.radiusEmpty], [true, 0, false]);
});

// Seis gasolineras en 1 km; los gasocentros, entre 2 y 3 km.
const cercaGasolina = Array.from({ length: 6 }, (_, i) => oferta('g2_', String.fromCharCode(97 + i), 15 + i / 10, 'MIRAFLORES', 0.001 * (i + 1)));
const lejosGlp = Array.from({ length: 6 }, (_, i) => glp(String.fromCharCode(107 + i), 7 + i / 10, 'SURQUILLO', 0.02 + 0.001 * i));

test('al cambiar a GLP, un radio que nadie eligió se recalcula con sus precios', () => {
  const rowsGasolina = filas('gasolina', cercaGasolina);
  const enGasolina = startResults({ ...createSearch('gasolina'), origin: ORIGEN }, withDistances(rowsGasolina, ORIGEN));
  assert.equal(enGasolina.radiusKm, 1);
  const rowsGlp = filas('glp', lejosGlp);
  const locatedGlp = withDistances(rowsGlp, ORIGEN);
  const enGlp = startResults({ ...enGasolina, view: 'glp', priceProduct: 'glp' }, locatedGlp);
  assert.equal(enGlp.radiusKm, 3);
  assert.equal(resultsView({ rows: rowsGlp, located: locatedGlp, search: enGlp }).items.length, 6);
});

test('al cambiar a GLP, un radio elegido se conserva y el vacío se dice', () => {
  const rowsGlp = filas('glp', lejosGlp);
  const locatedGlp = withDistances(rowsGlp, ORIGEN);
  const elegido = { ...createSearch('glp'), origin: ORIGEN, radiusKm: 1, sort: 'price', preferencesTouched: true };
  const enGlp = startResults(elegido, locatedGlp);
  assert.deepEqual([enGlp.radiusKm, enGlp.sort], [1, 'price']);
  const vista = resultsView({ rows: rowsGlp, located: locatedGlp, search: enGlp });
  assert.deepEqual([vista.radiusEmpty, vista.radius.inert], [true, false], 'ampliar el radio sí sirve');
});

test('sin ninguna estación de GLP en todo el rango, el control es inerte con cero', () => {
  const rowsGlp = filas('glp', [glp('a', 7.49, 'LURIN', 0.3)]);
  const located = withDistances(rowsGlp, ORIGEN);
  const vista = resultsView({ rows: rowsGlp, located, search: startResults({ ...createSearch('glp'), origin: ORIGEN }, located) });
  assert.deepEqual([vista.radiusEmpty, vista.radius], [true, { inert: true, total: 0 }]);
});
