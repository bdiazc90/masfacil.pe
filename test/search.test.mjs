// Las reglas de la lista de resultados, sin navegador.
//
// Lo que fijan estas comprobaciones es lo que no se ve mirando una pantalla:
// que la regla no lea el reloj del sistema ni la página, qué filas entran en el
// radio y en qué orden, cuándo aparece cada control y qué dice el tag cuando la
// lista no ordena por precio.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { mock } from 'node:test';

import { createSearch, districtsFrom, evaluateRows, resultsView, startResults, withDistances } from '../web/lib/search.js';

const CORTE = '2026-09-20T12:00:00.000Z';
const HORA = 3_600_000;
const DIA = 86_400_000;
const corte = Date.parse(CORTE);
const iso = (ms) => new Date(ms).toISOString();
const ORIGEN = Object.freeze({ latitude: -12.12, longitude: -77.03 });
// Sobre un meridiano, un kilómetro es siempre la misma fracción de grado.
const GRADOS_POR_KM = 360 / (2 * Math.PI * 6371.0088);
const id = (letra) => letra.repeat(24);

let serie = 0;
function oferta(letra, { km, distrito = 'SURQUILLO', precio, reportado = corte - 2 * DIA, consulta = null }) {
  serie += 1;
  return { id: `g2_${String(serie).padStart(24, '0')}`, establishment_id: `est_${id(letra)}`, commercial_identity: null, address: null, price: precio, reported_at: iso(reportado), facilito: consulta, district: distrito, longitude: ORIGEN.longitude, latitude: ORIGEN.latitude - km * GRADOS_POR_KM };
}

// Siete grifos dentro de 3,5 km y seis más lejos. B solo vende Regular y C solo
// Premium; D tiene una consulta de hace una hora que vence antes que todo lo
// demás; E calla desde hace 40 días.
const callado = corte - 40 * DIA;
const DATASET = Object.freeze({
  cutoff_at: CORTE,
  offers: {
    regular: [
      oferta('a', { km: 0.3, distrito: 'MIRAFLORES', precio: 20.5 }),
      oferta('b', { km: 0.8, distrito: 'MIRAFLORES', precio: 20.1 }),
      oferta('d', { km: 2.2, distrito: 'SAN ISIDRO', precio: 20.9, consulta: { price: 20.7, observed_at: iso(corte - HORA), reported_at: null } }),
      oferta('e', { km: 3.0, distrito: 'SAN BORJA', precio: 20.4, reportado: callado }),
      oferta('f', { km: 2.6, precio: 20.3 }),
      oferta('g', { km: 3.1, precio: 20.6 }),
      oferta('h', { km: 3.6, precio: 20.4 }),
      oferta('i', { km: 4.2, precio: 20.2 }),
      oferta('j', { km: 4.6, precio: 20.8 }),
      oferta('l', { km: 4.8, precio: 20.95 }),
      oferta('m', { km: 4.9, precio: 21.0 }),
      oferta('k', { km: 5.5, precio: 20.0 }),
    ],
    premium: [
      oferta('a', { km: 0.3, distrito: 'MIRAFLORES', precio: 22.5 }),
      oferta('c', { km: 1.4, distrito: 'MIRAFLORES', precio: 22.1 }),
      oferta('d', { km: 2.2, distrito: 'SAN ISIDRO', precio: 22.9 }),
      oferta('e', { km: 3.0, distrito: 'SAN BORJA', precio: 22.4, reportado: callado }),
      oferta('g', { km: 3.1, precio: 22.6 }),
    ],
  },
});
const INSTANTE = new Date(corte + 2 * HORA);
const letras = (filas) => filas.map((fila) => fila.establishment_id.slice(4, 5)).join('');

/** Búsqueda con ubicación ya abierta, como la deja la pantalla de resultados. */
function conUbicacion(cambios = {}, instante = INSTANTE) {
  const { rows } = evaluateRows(DATASET, instante);
  const located = withDistances(rows, ORIGEN);
  const search = { ...startResults({ ...createSearch(), origin: ORIGEN }, located), ...cambios };
  return { rows, located, search, view: resultsView({ rows, located, search }) };
}

test('las reglas no leen el reloj del sistema ni la página', () => {
  // Con el reloj global en 1970, cualquier lectura de `Date` dentro de las
  // reglas caería antes del corte y lanzaría. Tienen que usar el instante dado.
  mock.timers.enable({ apis: ['Date'], now: 0 });
  try {
    const { view } = conUbicacion();
    assert.equal(view.items.length, 7);
  } finally { mock.timers.reset(); }
  const fuente = fs.readFileSync(new URL('../web/lib/search.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /\b(?:document|window|navigator|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(fuente, /\bDate\.now\b|new Date\(\s*\)/);
});

test('las filas valen hasta que vence la consulta más próxima', () => {
  const { rows, refreshAt } = evaluateRows(DATASET, INSTANTE);
  assert.equal(rows.length, 13);
  assert.equal(refreshAt, corte - HORA + 24 * HORA, 'la consulta de D vence antes que cualquier reporte');
  const e = rows.find((fila) => fila.establishment_id === `est_${id('e')}`);
  assert.equal(e.has_price, false, 'el grifo callado sigue en la lista, mudo');
  assert.deepEqual(districtsFrom(rows), ['MIRAFLORES', 'SAN BORJA', 'SAN ISIDRO', 'SURQUILLO']);
});

test('con ubicación: radio inicial sobre precios, pool, orden y tags', () => {
  const { search, view } = conUbicacion();
  // El sexto precio más cercano está a 3,1 km: el radio sube al siguiente paso.
  assert.equal(search.radiusKm, 3.5);
  assert.equal(search.sort, 'distance');
  assert.equal(letras(view.items), 'abcdfeg');
  assert.equal(view.remaining, 0);
  assert.equal(view.paged, false);
  assert.deepEqual(view.radius, { inert: false, total: 7 });
  assert.equal(view.criterion, 'distance');
  assert.equal(view.activeProduct, null);
  assert.equal(view.sortToggle, true);
  assert.equal(view.productToggle, false, 'en «Más cerca» el producto no ordena nada');
  assert.deepEqual(view.tags.filter(Boolean), ['Regular más barata en 3.5 km']);
  assert.equal(view.tags[1], 'Regular más barata en 3.5 km', 'B tiene el Regular más barato');
});

test('en «Más cerca» el tag sigue el producto elegido', () => {
  const { view } = conUbicacion({ priceProduct: 'premium' });
  assert.equal(letras(view.items), 'abcdfeg', 'el orden sigue siendo por cercanía');
  assert.equal(view.tags[2], 'Premium más barata en 3.5 km', 'C tiene el Premium más barato');
  assert.equal(view.tags.filter(Boolean).length, 1);
});

test('por precio: quien no vende el producto va al final', () => {
  const { view } = conUbicacion({ sort: 'price', priceProduct: 'premium' });
  assert.equal(view.byPrice, true);
  assert.equal(view.activeProduct, 'premium');
  assert.equal(view.productToggle, true);
  assert.equal(letras(view.items), 'cagdbef');
  assert.equal(view.criterion, 'price');
});

test('paginación: el salto duplica y el cierre cuenta «N de N»', () => {
  const primera = conUbicacion({ radiusKm: 5 }).view;
  assert.equal(primera.ordered.length, 12);
  assert.equal(primera.items.length, 6);
  assert.equal(primera.remaining, 6);
  assert.equal(primera.nextCount, 12);
  assert.equal(primera.paged, true);
  const todas = conUbicacion({ radiusKm: 5, visibleCount: primera.nextCount }).view;
  assert.equal(todas.items.length, 12);
  assert.equal(todas.remaining, 0);
  assert.equal(todas.paged, true, 'tras paginar, la lista entera sigue contándose');
});

test('lejos de todo: radio inerte y vacío del radio', () => {
  const { rows } = evaluateRows(DATASET, INSTANTE);
  const lejos = { latitude: -13, longitude: -77.03 };
  const located = withDistances(rows, lejos);
  const search = { ...startResults({ ...createSearch(), origin: lejos }, located) };
  const view = resultsView({ rows, located, search });
  assert.equal(search.radiusKm, 5, 'sin seis precios cerca, el radio se abre al máximo');
  assert.deepEqual(view.radius, { inert: true, total: 0 });
  assert.equal(view.radiusEmpty, true);
  assert.equal(view.items.length, 0);
});

test('una preferencia tocada sobrevive a volver a abrir resultados', () => {
  const { located } = conUbicacion();
  const tocada = { ...createSearch(), origin: ORIGEN, radiusKm: 2, sort: 'price', preferencesTouched: true, visibleCount: 12 };
  assert.deepEqual(startResults(tocada, located), { ...tocada, visibleCount: 6 });
});

test('por distrito: sin radio, por precio y sin tags', () => {
  const { rows } = evaluateRows(DATASET, INSTANTE);
  const search = startResults({ ...createSearch(), district: 'MIRAFLORES' }, []);
  const view = resultsView({ rows, located: [], search });
  assert.equal(letras(view.items), 'bac', 'C no vende Regular y va al final');
  assert.equal(view.radius, null);
  assert.equal(view.radiusEmpty, false);
  assert.equal(view.sortToggle, false);
  assert.equal(view.productToggle, true);
  assert.equal(view.activeProduct, 'regular');
  assert.equal(view.criterion, 'price', 'sin origen, el resumen siempre dice precio');
  assert.deepEqual(view.tags, [null, null, null]);
});

test('el vacío de precios es global, no del distrito', () => {
  const { rows } = evaluateRows(DATASET, INSTANTE);
  const view = resultsView({ rows, located: [], search: { ...createSearch(), district: 'SAN BORJA' } });
  assert.equal(letras(view.items), 'e');
  assert.equal(view.hasPrices, true, 'otro distrito tiene precios: no se anuncia el vacío');
  assert.equal(view.comparables, 0);
  assert.equal(view.productToggle, false);
});

test('sin un solo precio vigente no se ordena por precio', () => {
  const { view } = conUbicacion({ sort: 'price' }, new Date(corte + 40 * DIA));
  assert.equal(view.hasPrices, false);
  assert.equal(view.byPrice, false);
  assert.equal(view.criterion, 'none');
  assert.equal(letras(view.items), letras([...view.items].sort((a, b) => a.distance_km - b.distance_km)));
  assert.ok(view.tags.every((tag) => tag === null));
});

test('el tag cuenta los precios de lo que se muestra, no del radio entero', () => {
  // Cinco grifos mudos delante, uno con precio y cinco más con precio detrás:
  // la primera página solo trae un precio y no hay nada que comparar.
  const fila = (letra, km, precio) => ({ establishment_id: `est_${id(letra)}`, district: 'SURQUILLO', latitude: 0, longitude: 0, distance_km: km, prices: { regular: precio ? { price: precio } : null, premium: null }, has_price: Boolean(precio) });
  const located = [fila('a', 0.1), fila('b', 0.2), fila('c', 0.3), fila('d', 0.4), fila('e', 0.5), fila('f', 0.6, 20.5), fila('g', 0.7, 20.1), fila('h', 0.8, 20.2), fila('i', 0.9, 20.3), fila('j', 1.0, 20.4), fila('k', 1.1, 20.6)];
  const search = { ...createSearch(), origin: ORIGEN, radiusKm: 5 };
  const primera = resultsView({ rows: located, located, search });
  assert.equal(primera.items.length, 6);
  assert.equal(primera.comparables, 1);
  assert.ok(primera.tags.every((tag) => tag === null));
  const todas = resultsView({ rows: located, located, search: { ...search, visibleCount: 11 } });
  assert.equal(todas.tags.filter(Boolean).length, 1);
  assert.match(todas.tags[6], /^Regular más barata/);
});
