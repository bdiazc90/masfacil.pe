// Lo que dice una tarjeta de resultados y su detalle, sin pintarlo: la
// identidad y su fallback, la marca solo desde el registro, el estado de cada
// precio, la tarjeta muda, el detalle y los textos de la lista. Los componentes
// de React solo ponen esto en su sitio.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { safeGoogleMapsDirectionsUrl } from '../web/lib/directions.js';
import { UNVERIFIED_STATION_LABEL, offerCardView, offerDetailView, resultsCopy } from '../ui/offer-view.js';

const fila = (extra = {}) => ({
  establishment_id: 'est_1',
  commercial_identity: { brand: 'Primax', public_site_name: 'Primax Granada', confidence: 'verified' },
  address: 'AV. PRUEBA 100',
  district: 'SAN JUAN DE LURIGANCHO',
  latitude: -12.0123456,
  longitude: -77.0123456,
  distance_km: 1.234,
  prices: { regular: { price: 21.4, source: 'facilito', at: '2026-09-27T15:00:00.000Z' }, premium: { price: 23.99, source: 'csv', reported_at: '2026-09-25T15:00:00.000Z' } },
  has_price: true,
  age_days: 0.1,
  age_source: 'facilito',
  ...extra,
});

test('la identidad: sede sin repetir la marca, marcada si solo es cercana, y fallback neutral', () => {
  assert.equal(offerCardView(fila()).identity, 'Primax Granada');
  assert.equal(offerCardView(fila({ commercial_identity: { brand: 'Repsol', public_site_name: 'Grifo Central' } })).identity, 'Repsol · Grifo Central');
  assert.equal(offerCardView(fila({ commercial_identity: { brand: 'Repsol', public_site_name: null, confidence: 'nearby' } })).unconfirmed, true);
  for (const identidad of [null, { brand: '  ', public_site_name: '' }]) assert.equal(offerCardView(fila({ commercial_identity: identidad })).identity, UNVERIFIED_STATION_LABEL);
});

test('la marca sale del registro, nunca de los datos publicados', () => {
  assert.deepEqual(offerCardView(fila()).brand, { key: 'primax', src: '/icons/brands/primax-mark.svg', width: 58, height: 57 });
  assert.equal(offerCardView(fila({ commercial_identity: { brand: 'Marca Nueva', public_site_name: 'Otra' } })).brand, null, 'una marca sin variante registrada no pinta nada');
  assert.equal(offerCardView(fila({ commercial_identity: null })).brand, null);
});

test('cada precio dice su estado: el que ordena, el otro y el ausente; la unidad solo con cifra', () => {
  const conOrden = offerCardView(fila(), { activeProduct: 'premium' });
  assert.deepEqual(conOrden.prices.map((celda) => [celda.key, celda.state, celda.amount]), [['regular', 'muted', '21.40'], ['premium', 'on', '23.99']]);
  assert.deepEqual(offerCardView(fila()).prices.map((celda) => celda.state), [null, null], 'en «Más cerca» no hay énfasis');
  const sinPremium = offerCardView(fila({ prices: { regular: { price: 21.4, source: 'csv', reported_at: '2026-09-25T15:00:00.000Z' } } }), { activeProduct: 'regular', priceUnit: 'por galón' });
  assert.deepEqual(sinPremium.prices[1], { key: 'premium', state: 'absent', chip: 'PRE', label: 'Premium', amount: null, unit: null });
  assert.equal(sinPremium.prices[0].unit, 'por galón');
  assert.equal(offerCardView(fila()).distance, '1.2 km');
  assert.equal(offerCardView(fila(), { withDistance: false }).distance, null);
});

test('«Cómo llegar» solo existe con una URL de la regla; el detalle, solo si se pide', () => {
  assert.equal(offerCardView(fila(), { directionsUrl: safeGoogleMapsDirectionsUrl({ latitude: Number.NaN, longitude: 0 }) }).directions, null);
  const url = safeGoogleMapsDirectionsUrl(fila());
  const tarjeta = offerCardView(fila(), { directionsUrl: url });
  assert.equal(tarjeta.directions.url, url);
  assert.match(tarjeta.directions.label, /^Cómo llegar a Primax Granada en San Juan de Lurigancho, Regular S\/\s?21\.40, Premium S\/\s?23\.99, a 1\.2 km$/);
  assert.equal(tarjeta.detail.label, 'Ver detalle de Primax Granada en San Juan de Lurigancho');
  assert.equal(offerCardView(fila(), { includeDetail: false }).detail, null);
});

test('sin precio vigente la tarjeta se encoge: quién es, dónde está y desde cuándo calla', () => {
  const muda = offerCardView(fila({ has_price: false, prices: {}, silent_days: 95, last_reported_at: '2026-06-24T15:00:00.000Z', address: '' }));
  assert.equal(muda.silent, true);
  assert.deepEqual(muda.prices, []);
  assert.deepEqual(muda.silence, { text: 'Sin precio hace 3 meses', dateTime: '2026-06-24T15:00:00.000Z' });
  assert.equal(muda.district, '1.2 km · San Juan de Lurigancho');
  assert.equal(muda.address, '');
  assert.equal(muda.freshness, null);
  assert.ok(muda.detail, 'conserva «Ver detalle»: el Street View dice si sigue abierto');
});

test('el detalle desglosa fuente y fecha por producto y solo usa lo que viaja en la fila', () => {
  const detalle = offerDetailView(fila(), { attribution: 'Fuente: Osinergmin.', priceUnit: null });
  assert.deepEqual(detalle.rows.map((fila) => [fila.key, fila.amount, fila.when.split(' ')[0]]), [['regular', '21.40', 'consultado'], ['premium', '23.99', 'reportado']]);
  assert.equal(detalle.coordinate, '-12.01235, -77.01235');
  assert.equal(detalle.streetViewUrl, 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-12.0123456,-77.0123456');
  assert.equal(detalle.attribution, 'Fuente: Osinergmin.');
  assert.deepEqual([detalle.lastReported, detalle.lastObserved], [null, null], 'con precio vigente no hay «último»');
  const muda = offerDetailView(fila({ has_price: false, prices: {}, last_reported_at: '2026-06-24T15:00:00.000Z', last_observed_at: '2026-09-26T15:00:00.000Z' }));
  assert.deepEqual(muda.rows.map((fila) => [fila.amount, fila.when]), [[null, ''], [null, '']]);
  assert.ok(muda.lastReported && muda.lastObserved && muda.lastReported !== muda.lastObserved);
});

test('los textos de la lista salen del mismo número que usa la paginación', () => {
  const vista = (extra) => ({ items: [1, 2, 3, 4, 5, 6], ordered: Array(20), remaining: 14, nextCount: 12, paged: true, radius: { inert: false, total: 20 }, ...extra });
  assert.equal(resultsCopy(vista(), 'gasolina').loadMore, 'Ver 6 más (14 restantes)');
  assert.equal(resultsCopy(vista({ nextCount: 20, remaining: 4, ordered: Array(10) }), 'gasolina').loadMore, 'Ver las 4 restantes');
  assert.equal(resultsCopy(vista(), 'gasolina').status, 'Se muestran 6 de 20 estaciones.');
  assert.equal(resultsCopy(vista({ paged: false }), 'gasolina').status, '');
  assert.equal(resultsCopy(vista({ radius: { inert: true, total: 0 } }), 'glp').radiusEmpty.text, 'No hay estaciones de GLP cerca de ti. Busca por distrito o elige otro combustible.');
  assert.equal(resultsCopy(vista(), 'glp').radiusEmpty.title, 'Ningún grifo en este radio');
  assert.deepEqual(resultsCopy(null, null), { loadMore: '', status: '', radiusEmpty: { title: 'Ningún grifo en este radio', text: 'Amplía el radio de búsqueda para encontrar estaciones más lejanas.' } });
});
