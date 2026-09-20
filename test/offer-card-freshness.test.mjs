// Lo que la tarjeta AFIRMA sobre la edad de su precio.
//
// El riesgo no es que se vea feo: es decir «reportado» de un precio que solo
// consultamos, o presentar un fallo nuestro como silencio del operador. Las dos
// cosas serían afirmar una fecha que nadie nos dio.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { filterFreshOffers } from '../web/lib/freshness.js';
import { mergeOfferRows } from '../web/lib/merge-products.js';
import { renderOfferCard, renderOfferDetail } from '../web/offer-card.js';

const CORTE = '2026-09-20T12:00:00.000Z';
const HORA = 3_600_000;
const DIA = 86_400_000;
const corte = Date.parse(CORTE);
const iso = (ms) => new Date(ms).toISOString();

const oferta = (key, { price, reported_at, facilito = null }) => ({
  id: `g2_${key.padEnd(24, '0')}`,
  establishment_id: 'est_0123456789abcdef01234567',
  commercial_identity: { brand: null, public_site_name: 'Grifo de Prueba', confidence: 'verified' },
  address: 'AV. PRUEBA 100',
  price,
  reported_at,
  facilito,
  district: 'ATE',
  longitude: -76.9,
  latitude: -12.0,
});

const consulta = (price, observed_at) => ({ price, observed_at, reported_at: null });

/** Una fila fusionada, por el mismo camino que recorre la app. */
function fila({ regular, premium }, ahora) {
  const now = () => iso(ahora);
  const porProducto = { regular: filterFreshOffers([regular], { now, cutoffAt: CORTE }), premium: filterFreshOffers([premium], { now, cutoffAt: CORTE }) };
  return mergeOfferRows(
    { regular: porProducto.regular.offers, premium: porProducto.premium.offers },
    { regular: porProducto.regular.expired, premium: porProducto.premium.expired },
  )[0];
}

test('con los dos precios de la consulta, la etiqueta dice «Consultado»', () => {
  const ahora = corte + 3 * HORA;
  const row = fila({
    regular: oferta('a', { price: 22.99, reported_at: iso(corte - 5 * DIA), facilito: consulta(22.39, iso(ahora - 2 * HORA)) }),
    premium: oferta('b', { price: 24.99, reported_at: iso(corte - 5 * DIA), facilito: consulta(24.49, iso(ahora - 2 * HORA)) }),
  }, ahora);
  assert.equal(row.age_source, 'facilito');
  assert.match(renderOfferCard(row, { includeDetail: false, withDistance: false }), /Consultado hace 2 h/);
});

test('con los dos del CSV, sigue diciendo «Reportado»', () => {
  const ahora = corte + 3 * HORA;
  const row = fila({
    regular: oferta('a', { price: 22.99, reported_at: iso(corte - 5 * DIA) }),
    premium: oferta('b', { price: 24.99, reported_at: iso(corte - 5 * DIA) }),
  }, ahora);
  assert.equal(row.age_source, 'csv');
  assert.match(renderOfferCard(row, { includeDetail: false, withDistance: false }), /Reportado hace 5 días/);
});

test('con fuentes mezcladas, la etiqueta nombra la del precio más reciente y el detalle desglosa las dos', () => {
  // Regular consultado hace dos horas, Premium reportado hace cinco días. La
  // etiqueta habla del más reciente con SU verbo; lo que no puede pasar es que
  // el detalle llame «reportado» a la consulta o al revés.
  const ahora = corte + 3 * HORA;
  const row = fila({
    regular: oferta('a', { price: 22.99, reported_at: iso(corte - 5 * DIA), facilito: consulta(22.39, iso(ahora - 2 * HORA)) }),
    premium: oferta('b', { price: 24.99, reported_at: iso(corte - 5 * DIA) }),
  }, ahora);
  assert.equal(row.age_source, 'facilito');
  assert.match(renderOfferCard(row, { includeDetail: false, withDistance: false }), /Consultado hace 2 h/);

  const detalle = renderOfferDetail(row, { prices: row.prices });
  assert.match(detalle, /consultado/);
  assert.match(detalle, /reportado/);
  assert.equal(row.prices.regular.source, 'facilito');
  assert.equal(row.prices.premium.source, 'csv');
});

test('un fallo de nuestra consulta no se presenta como silencio del operador', () => {
  // El CSV de este grifo tiene 40 días y su consulta venció hace horas. La
  // tarjeta queda muda, pero el silencio que anuncia es el del operador —40
  // días— y no las horas que llevamos sin poder leer la tabla.
  const ahora = corte + 40 * DIA;
  const reportado = iso(corte - 5 * DIA);
  const row = fila({
    regular: oferta('a', { price: 22.99, reported_at: reportado, facilito: consulta(22.39, iso(ahora - 30 * HORA)) }),
    premium: oferta('b', { price: 24.99, reported_at: reportado }),
  }, ahora);
  assert.equal(row.has_price, false);
  assert.ok(row.silent_days > 44, `el silencio mide el reporte del CSV, no la consulta: ${row.silent_days}`);
  assert.equal(row.last_reported_at, reportado);
  assert.equal(row.last_observed_at, iso(ahora - 30 * HORA), 'la última consulta se conserva aparte');
  const tarjeta = renderOfferCard(row, { includeDetail: false, withDistance: false });
  assert.match(tarjeta, /Sin precio hace 45 días/);
  assert.doesNotMatch(tarjeta, /Consultado/);
});
