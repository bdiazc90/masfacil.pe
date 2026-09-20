// La lectura de la tabla y lo que hace la corrida cuando algo sale mal.
//
// El navegador se simula: lo que importa comprobar no es que agent-browser
// funcione, sino que una tabla a medias no se publique como si estuviera
// entera, que un producto roto no se lleve por delante a su distrito, y que un
// bloqueo pare la adquisición en vez de seguir golpeando el mismo muro.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { capturarLima, parseTabla } from '../pipeline/facilito/capture.mjs';
import { applyFacilitoRun, facilitoStateId } from '../pipeline/facilito/state.mjs';

const CABECERAS = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles por galón)'];
const fila = (nombre, precio = 'S/ 19,49', distrito = 'ATE') => [distrito, nombre, `AV. ${nombre} 1`, '999999999', precio];
const tabla = (filas, extra = {}) => ({ estado: 'ok', completo: true, total: filas.length, firma: 'x', cabeceras: CABECERAS, filas, ...extra });

test('una tabla completa de más de 50 filas se lee entera', () => {
  const filas = Array.from({ length: 63 }, (_, i) => fila(`GRIFO ${i}`));
  const leido = parseTabla(tabla(filas), 'ATE');
  assert.equal(leido.ok, true);
  assert.equal(leido.filas.length, 63);
  assert.equal(leido.total, 63);
});

test('un total cero explícito es un resultado válido, no un fallo', () => {
  const leido = parseTabla(tabla([]), 'SAN LUIS');
  assert.equal(leido.ok, true);
  assert.deepEqual(leido.filas, []);
});

test('una tabla truncada no publica las filas que sí llegaron', () => {
  // 50 filas leídas de 120 son 50 precios ciertos y 70 grifos que parecerían no
  // existir. La unidad se cae entera.
  const filas = Array.from({ length: 50 }, (_, i) => fila(`GRIFO ${i}`));
  assert.equal(parseTabla(tabla(filas, { completo: false, total: 120 }), 'ATE').razon, 'extraccion_incompleta');
  assert.equal(parseTabla(tabla(filas, { total: 120 }), 'ATE').razon, 'total_no_coincide');
});

test('una tabla de otro distrito o con otras cabeceras no se interpreta', () => {
  assert.equal(parseTabla(tabla([fila('GRIFO X')]), 'SAN LUIS').razon, 'distrito_no_coincide');
  assert.equal(parseTabla(tabla([fila('GRIFO X')], { cabeceras: [...CABECERAS.slice(0, 4), 'Precio'] }), 'ATE').razon, 'cabeceras_desconocidas');
  assert.equal(parseTabla(tabla([fila('GRIFO X').slice(0, 4)]), 'ATE').razon, 'fila_con_forma_inesperada');
  assert.equal(parseTabla(tabla([fila('GRIFO X', '0')]), 'ATE').razon, 'precio_ilegible');
  assert.equal(parseTabla(tabla([fila('GRIFO X', 'consultar')]), 'ATE').razon, 'precio_ilegible');
});

test('el teléfono se valida por posición y no sale de la lectura', () => {
  const leido = parseTabla(tabla([fila('GRIFO X')]), 'ATE');
  assert.deepEqual(Object.keys(leido.filas[0]).sort(), ['key_hash', 'precio']);
});

// --- Corrida completa contra un navegador simulado -------------------------

/**
 * Un navegador de mentira. Responde a `open`, `wait`, `select`, `eval` y
 * `close`, y deja que cada caso decida qué tabla devuelve cada unidad.
 */
function navegadorFalso({ distritos, tablaDe }) {
  let distritoActual = null;
  let productoActual = null;
  let reloj = 1000;
  return (args) => {
    if (args[0] === 'select') {
      if (args[1].includes('distrito')) distritoActual = distritos.find((d) => d.codigo === args[2]);
      if (args[1].includes('producto')) productoActual = args[2];
      reloj += 1;
      return '';
    }
    if (args[0] === '--json' && args[1] === 'eval') {
      const script = Buffer.from(args[3], 'base64').toString('utf8');
      const respuesta = script.includes('page.info')
        ? tablaDe(distritoActual, productoActual)
        : { t: (reloj += 1), distritos };
      return JSON.stringify({ result: respuesta });
    }
    return '';
  };
}

const DISTRITOS = [{ nombre: 'ATE', codigo: '150103' }, { nombre: 'SAN LUIS', codigo: '150134' }];

test('un producto roto no se lleva por delante al distrito ni a los demás', () => {
  const resultado = capturarLima({
    ejecutar: navegadorFalso({
      distritos: DISTRITOS,
      // Solo Premium de Ate llega truncado; los otros tres pares están enteros.
      tablaDe: (distrito, producto) => (distrito?.codigo === '150103' && producto === '127'
        ? tabla([fila('GRIFO A', 'S/ 21,40')], { completo: false, total: 9 })
        : tabla([fila(`GRIFO ${distrito?.nombre}`, 'S/ 19,49', distrito?.nombre)])),
    }),
  });
  assert.equal(resultado.blocked, null);
  const estados = Object.fromEntries(resultado.units.map((u) => [`${u.district_name}:${u.product}`, u.status]));
  assert.deepEqual(estados, {
    'ATE:regular': 'ok',
    'ATE:premium': 'extraccion_incompleta',
    'SAN LUIS:regular': 'ok',
    'SAN LUIS:premium': 'ok',
  });
});

test('un bloqueo explícito detiene la adquisición entera', () => {
  const resultado = capturarLima({
    ejecutar: navegadorFalso({
      distritos: DISTRITOS,
      tablaDe: (distrito) => (distrito?.codigo === '150103' ? { rechazo: 'desafio_o_rechazo' } : tabla([fila('GRIFO B', 'S/ 19,49', 'SAN LUIS')])),
    }),
  });
  assert.equal(resultado.blocked?.codigo, 'desafio_o_rechazo');
  // San Luis nunca se intenta: seguir sería golpear el mismo muro con otra puerta.
  assert.equal(resultado.units.some((u) => u.district_name === 'SAN LUIS'), false);
});

test('una corrida fallida conserva la captura anterior con su hora original', () => {
  const anterior = applyFacilitoRun(null, [{
    district_code: '150103', district_name: 'ATE', product: 'regular', status: 'ok',
    observed_at: '2026-09-20T10:00:00.000Z', announced_total: 1, rows: [{ key_hash: 'abc', price: 19.49 }],
  }], { attemptedAt: '2026-09-20T10:00:00.000Z' });

  const despues = applyFacilitoRun(anterior, [{ district_code: '150103', district_name: 'ATE', product: 'regular', status: 'timeout_de_comando' }], { attemptedAt: '2026-09-20T16:00:00.000Z' });
  const unidad = despues.units['150103:regular'];
  assert.equal(unidad.observed_at, '2026-09-20T10:00:00.000Z', 'no se rejuvenece porque el proceso se ejecutó');
  assert.deepEqual(unidad.rows, [{ key_hash: 'abc', price: 19.49 }]);
  assert.equal(unidad.last_attempt.status, 'timeout_de_comando');
  assert.equal(facilitoStateId(despues), '2026-09-20T10:00:00.000Z');
});

test('ver otra vez el mismo precio acredita una observación nueva, no un reporte nuevo', () => {
  const primera = applyFacilitoRun(null, [{
    district_code: '150103', district_name: 'ATE', product: 'regular', status: 'ok',
    observed_at: '2026-09-20T10:00:00.000Z', announced_total: 1, rows: [{ key_hash: 'abc', price: 19.49 }],
  }], { attemptedAt: '2026-09-20T10:00:00.000Z' });
  const segunda = applyFacilitoRun(primera, [{
    district_code: '150103', district_name: 'ATE', product: 'regular', status: 'ok',
    observed_at: '2026-09-20T16:00:00.000Z', announced_total: 1, rows: [{ key_hash: 'abc', price: 19.49 }],
  }], { attemptedAt: '2026-09-20T16:00:00.000Z' });
  assert.equal(segunda.units['150103:regular'].observed_at, '2026-09-20T16:00:00.000Z');
  assert.equal(facilitoStateId(segunda), '2026-09-20T16:00:00.000Z', 'y el estado avanza, que es lo que ordena dos corridas del mismo CSV');
});
