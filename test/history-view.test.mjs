// El pulso de precios sin pintarlo: el plano, las etiquetas y los estados del
// resumen (`ui/history-view.js`), y la carga que nunca falla hacia fuera
// (`ui/history/cargar-historial.js`).
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_WINDOW, demoSummary, frameWindow } from '../web/lib/history-series.js';
import { H, W, diaEnX, evaluarResumen, lectura, lecturas, listaDias, plano, seleccionVista } from '../ui/history-view.js';
import { cargarHistorial } from '../ui/history/cargar-historial.js';

const HOY = '2026-09-28';
const AHORA = new Date('2026-09-28T15:00:00Z');
const resumen = demoSummary({ today: HOY });
const marco = frameWindow(resumen, { today: HOY, days: DEFAULT_WINDOW });

test('el plano: una escala, las dos series de premium a regular y sus referencias', () => {
  const vista = plano(marco);
  assert.equal(W, 320);
  assert.ok(H > 200);
  assert.deepEqual(vista.series.map((serie) => serie.key), ['premium', 'regular'], 'la de abajo se pinta encima');
  assert.deepEqual(vista.gradientes.map((gradiente) => gradiente.key), ['premium', 'regular']);
  for (const gradiente of vista.gradientes) assert.equal(Number((gradiente.y2 - gradiente.y1).toFixed(2)), 56, 'el faldón muere 56 unidades bajo el techo de su curva');
  assert.ok(vista.series.every((serie) => serie.ultimo && serie.lineas.length), 'cada serie lleva curva y último punto');
  assert.equal(vista.fechas.length, DEFAULT_WINDOW, 'con siete días se etiquetan todos');
  assert.equal(vista.fechas.at(-1).arriba.texto, 'Hoy');
  assert.match(vista.ariaLabel, /^Precio promedio diario en Lima\. .*Usa las flechas para recorrer los días\.$/);
  // Una cifra del eje que choca con un promedio se calla.
  const promedios = vista.series.filter((serie) => serie.promedio).map((serie) => serie.promedio.y);
  for (const tick of vista.ticks) if (promedios.some((y) => Math.abs(tick.y - y) < 7)) assert.equal(tick.texto, null);
});

test('elegir un día: guía y un marcador por producto, sin tocar el resto', () => {
  assert.deepEqual(seleccionVista(marco, null), { guia: null, activos: [] });
  const elegido = seleccionVista(marco, 2);
  assert.equal(elegido.guia.x, plano(marco).fechas[2].x);
  assert.deepEqual(elegido.activos.map((activo) => activo.key), ['regular', 'premium']);
  assert.equal(diaEnX(50, 7), 0);
  assert.equal(diaEnX(310, 7), 6);
});

test('lecturas y textos accesibles: cifra, fecha, población y un renglón por día', () => {
  const [regular, premium] = lecturas(marco);
  assert.deepEqual([regular.key, premium.key], ['regular', 'premium']);
  assert.match(regular.valor, /^\d+\.\d{2}$/);
  assert.ok(regular.n > 0);
  const dias = listaDias(marco.points);
  assert.equal(dias.length, DEFAULT_WINDOW);
  assert.match(dias.at(-1), /\(hoy, en curso\): Regular S\/ \d+\.\d{2} con \d+ estaciones; Premium/);
  assert.match(lectura(marco.points.at(-1)), /\(en curso\): Regular S\/ /);
  assert.equal(lectura(null), '');
});

test('el resumen se valida entero y dice su estado: al día, viejo, copia o vacío', () => {
  const texto = JSON.stringify(resumen);
  assert.equal(evaluarResumen(texto, { hoy: HOY, now: AHORA }).estado, 'ready');
  assert.equal(evaluarResumen(texto, { hoy: HOY, now: new Date('2026-10-05T15:00:00Z') }).estado, 'stale');
  assert.match(evaluarResumen(texto, { hoy: HOY, now: AHORA, desdeCopia: true, savedAt: '2026-09-27T10:00:00Z' }).nota, /^Copia guardada del .*: puede no estar al día\.$/);
  assert.throws(() => evaluarResumen('{"schema_version":99}', { hoy: HOY, now: AHORA }));
  assert.throws(() => evaluarResumen('x'.repeat(3_000_000), { hoy: HOY, now: AHORA }), /desmesurado/);
});

test('la carga nunca falla hacia fuera: red, copia guardada o estado de error, y un solo pedido a la vez', async () => {
  const guardado = new Map();
  const storage = { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v) };
  let pedidos = 0;
  const bien = async () => { pedidos += 1; return new Response(JSON.stringify(resumen), { status: 200 }); };
  const [a, b] = await Promise.all([cargarHistorial({ origin: 'https://h.test', fetchImpl: bien, storage, now: () => AHORA }), cargarHistorial({ origin: 'https://h.test', fetchImpl: bien, storage, now: () => AHORA })]);
  assert.equal(pedidos, 1, 'dos montajes esperan la misma promesa');
  assert.deepEqual([a.estado, b.estado], ['ready', 'ready']);
  const caida = async () => { throw new Error('sin red'); };
  assert.equal((await cargarHistorial({ origin: 'https://h.test', fetchImpl: caida, storage, now: () => AHORA })).estado, 'saved', 'sin red, la copia guardada y revalidada');
  const vacio = { getItem: () => null, setItem() {} };
  const error = await cargarHistorial({ origin: 'https://h.test', fetchImpl: caida, storage: vacio, now: () => AHORA });
  assert.deepEqual([error.estado, error.resumen], ['error', null]);
  assert.match(error.nota, /Los precios de arriba no dependen de esto/);
});
