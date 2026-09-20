// Qué precio vale, de dónde viene y cuándo deja de valer.
//
// Estas comprobaciones existen porque el error que importa no se ve en
// pantalla: la lista puede ordenar por un precio y la tarjeta pintar otro, o
// una consulta de anteayer puede seguir desplazando al reporte oficial sin que
// nadie lo note hasta que alguien maneje hasta el grifo equivocado.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { filterFreshOffers } from '../web/lib/freshness.js';
import { MAX_QUERY_AGE_HOURS, msUntilSourceChange, selectOfferPrice } from '../web/lib/price-source.js';

const CORTE = '2026-09-20T12:00:00.000Z';
const HORA = 3_600_000;
const DIA = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const corte = Date.parse(CORTE);

const oferta = ({ price = 22.99, reported_at = iso(corte - 2 * DIA), facilito = null } = {}) => ({
  id: 'g2_0123456789abcdef01234567',
  establishment_id: 'est_0123456789abcdef01234567',
  commercial_identity: null,
  address: 'AV. 28 DE JULIO 2200',
  price,
  reported_at,
  facilito,
  district: 'LA VICTORIA',
  longitude: -77.019,
  latitude: -12.061,
});

const consulta = (price, observed_at) => ({ price, observed_at, reported_at: null });
const elegir = (offer, ahora) => selectOfferPrice(offer, { now: () => iso(ahora), cutoffAt: CORTE });

test('el caso de Bruno: la consulta de hoy desplaza al reporte del CSV', () => {
  // Mismo grifo y producto, CSV S/22,99 del lunes y consulta S/22,39 de hace
  // dos horas. Lo que se usa es la consulta, y se llama consulta.
  const ahora = corte + 3 * HORA;
  const elegido = elegir(oferta({ price: 22.99, facilito: consulta(22.39, iso(ahora - 2 * HORA)) }), ahora);
  assert.equal(elegido.price, 22.39);
  assert.equal(elegido.source, 'facilito');
  assert.equal(elegido.reason, 'consulta_vigente');
  assert.equal(elegido.at, iso(ahora - 2 * HORA));
});

test('un reporte del CSV posterior a la consulta gana, aunque la consulta siga vigente', () => {
  // El archivo llegó con un precio registrado DESPUÉS de que leyéramos la
  // tabla: sabemos de un cambio más nuevo que lo que alcanzamos a ver.
  const ahora = corte + 3 * HORA;
  const elegido = elegir(oferta({ price: 22.99, reported_at: iso(ahora - HORA), facilito: consulta(22.39, iso(ahora - 5 * HORA)) }), ahora);
  assert.equal(elegido.price, 22.99);
  assert.equal(elegido.source, 'csv');
  assert.equal(elegido.reason, 'csv_posterior_a_la_consulta');
});

test('los dos límites incluyen su extremo y al cruzarse cambia la fuente', () => {
  const observed_at = iso(corte);
  const enLimite = corte + MAX_QUERY_AGE_HOURS * HORA;
  const item = oferta({ price: 22.99, reported_at: iso(corte - 2 * DIA), facilito: consulta(22.39, observed_at) });
  assert.equal(elegir(item, enLimite).source, 'facilito', 'a las 24 h exactas la consulta todavía vale');
  assert.equal(elegir(item, enLimite + 1).source, 'csv', 'un milisegundo después manda el respaldo');
  // Y el respaldo dura hasta los 30 días del reporte, también con su extremo.
  const treinta = Date.parse(item.reported_at) + 30 * DIA;
  assert.equal(elegir(item, treinta).source, 'csv');
  assert.equal(elegir(item, treinta + 1).price, null);
  assert.equal(elegir(item, treinta + 1).reason, 'reporte_vencido');
});

test('una consulta del futuro o sin precio no hace elegible nada', () => {
  const ahora = corte + HORA;
  const futura = elegir(oferta({ facilito: consulta(22.39, iso(ahora + HORA)) }), ahora);
  assert.equal(futura.source, 'csv', 'un reloj adelantado no inventa frescura');
  const ilegible = elegir(oferta({ facilito: consulta(22.39, 'ayer por la tarde') }), ahora);
  assert.equal(ilegible.source, 'csv');
  const sinImporte = elegir(oferta({ facilito: consulta(0, iso(ahora - HORA)) }), ahora);
  assert.equal(sinImporte.source, 'csv');
});

test('sin ningún precio elegible la oferta se queda sin precio, no desaparece', () => {
  const ahora = corte + 40 * DIA;
  const elegido = elegir(oferta({ reported_at: iso(corte - 35 * DIA), facilito: consulta(22.39, iso(corte)) }), ahora);
  assert.equal(elegido.price, null);
  assert.equal(elegido.source, null);
  assert.equal(elegido.at, null);
});

test('la consulta no hereda la fecha del CSV aunque el importe sea igual', () => {
  // Mismo precio observado otra vez: es una observación nueva, no un reporte
  // nuevo. La fecha que se muestra tiene que ser la de la consulta.
  const ahora = corte + 2 * HORA;
  const elegido = elegir(oferta({ price: 22.99, facilito: consulta(22.99, iso(ahora - HORA)) }), ahora);
  assert.equal(elegido.source, 'facilito');
  assert.equal(elegido.at, iso(ahora - HORA));
  assert.notEqual(elegido.at, oferta().reported_at);
});

test('filterFreshOffers entrega el precio ya elegido, y lo vencido conserva el del CSV', () => {
  // Es el único paso antes de filtrar, ordenar y contar: si aquí saliera el
  // precio del CSV, la lista ordenaría por uno y la tarjeta pintaría otro.
  const ahora = corte + 3 * HORA;
  const barato = { ...oferta({ price: 22.99, facilito: consulta(19.49, iso(ahora - HORA)) }), id: 'g2_aaaaaaaaaaaaaaaaaaaaaaaa' };
  const callado = { ...oferta({ price: 21.10, reported_at: iso(corte - 45 * DIA) }), id: 'g2_bbbbbbbbbbbbbbbbbbbbbbbb' };
  const { offers, expired } = filterFreshOffers([barato, callado], { now: () => iso(ahora), cutoffAt: CORTE });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].price, 19.49);
  assert.equal(offers[0].price_source, 'facilito');
  assert.ok(offers[0].age_days < 1);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].price, 21.10, 'el precio vencido sigue siendo el del CSV');
  assert.ok(expired[0].age_days > 44, 'y su edad mide el silencio del operador, no nuestra consulta');
});

test('el próximo vencimiento es el de la consulta, para que el respaldo entre sin red', () => {
  // La app guarda el bundle y sigue funcionando offline: cruzar las 24 horas
  // tiene que activar el CSV por el paso del tiempo, no por una descarga.
  const ahora = corte + 2 * HORA;
  const item = oferta({ price: 22.99, reported_at: iso(corte - 2 * DIA), facilito: consulta(22.39, iso(corte)) });
  const faltan = msUntilSourceChange(item, { now: () => iso(ahora), cutoffAt: CORTE });
  assert.equal(faltan, MAX_QUERY_AGE_HOURS * HORA - 2 * HORA);
  // Sin capa web, el que manda es el vencimiento de los 30 días.
  const soloCsv = msUntilSourceChange(oferta({ reported_at: iso(corte - 2 * DIA) }), { now: () => iso(ahora), cutoffAt: CORTE });
  assert.equal(soloCsv, Date.parse(iso(corte - 2 * DIA)) + 30 * DIA - ahora);
});
