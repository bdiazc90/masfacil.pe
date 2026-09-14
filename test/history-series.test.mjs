// Comprobaciones puntuales del modelo de vista del histórico.
//
// No es una suite ni una cuota: son los cálculos donde equivocarse no se nota
// mirando la pantalla —una media ponderada por error, un hueco convertido en
// cero, una curva que inventa un mínimo— y que por eso conviene fijar.
//
//   node --test test/
//
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';
import { areaPath, frameWindow, lastPoint, monotonePath, periodAverage, planeScale, segments, MIN_SPAN } from '../web/lib/history-series.js';
import { addDays, windowDates } from '../web/lib/history-contract.js';

const HOY = '2026-09-13';

/** Resumen mínimo de 30 días; `valores` mapea fecha a `[regular, premium]` o null. */
function resumen(valores) {
  const fechas = windowDates(HOY, 30);
  return {
    schema_version: 'history-daily-1', method_version: 'daily-mean-1', timezone: 'America/Lima',
    scope: { department: 'LIMA', province: 'LIMA' }, currency: 'PEN', unit: 'Galones',
    generated_at: `${HOY}T20:00:00.000Z`, days: 30,
    series: fechas.map((date) => {
      const dato = valores[date];
      if (!dato) return { date, observation: null };
      const [regular, premium, nRegular = 700, nPremium = 690] = dato;
      return {
        date,
        observation: {
          observation_id: `obs_${date.replace(/-/g, '')}`,
          observed_at: `${date}T20:00:00.000Z`,
          revision_id: `rev-${date}`,
          archive_hash: 'a'.repeat(64),
          cutoff_at: `${addDays(date, -1)}T12:00:00.000Z`,
          source_max_reported_at: `${addDays(date, -2)}T05:00:00.000Z`,
          products: {
            regular: regular === null ? { mean: null, n: 0 } : { mean: regular, n: nRegular },
            premium: premium === null ? { mean: null, n: 0 } : { mean: premium, n: nPremium },
          },
        },
      };
    }),
  };
}

const puntos = (valores, days = 14) => frameWindow(resumen(valores), { today: HOY, days }).points;

test('la media del periodo no pondera por el n de cada día', () => {
  // Dos días con medias 20 y 22 y poblaciones muy distintas: la referencia es 21.
  // Ponderar por `n` daría 20.18, que describiría otra cosa.
  const media = periodAverage(puntos({ '2026-09-12': [20, 30, 900], '2026-09-13': [22, 30, 100] }), 'regular');
  assert.equal(media.mean, 21);
  assert.equal(media.k, 2);
  assert.equal(media.window, 14);
});

test('un día sin precio de ese producto no entra como cero ni cuenta en k', () => {
  // `{mean: null, n: 0}` es un día observado sin precios elegibles de ese
  // producto. Si contara, la media caería a la mitad y la cobertura mentiría.
  const p = puntos({ '2026-09-11': [20, 22], '2026-09-12': [null, 22], '2026-09-13': [22, 22] });
  const media = periodAverage(p, 'regular');
  assert.equal(media.mean, 21);
  assert.equal(media.k, 2);
  assert.equal(periodAverage(p, 'premium').k, 3);
});

test('la ventana se recorta a 7 o a 14 días terminando en hoy', () => {
  const valores = Object.fromEntries(windowDates(HOY, 30).map((date, i) => [date, [20 + i / 100, 22]]));
  for (const days of [7, 14]) {
    const p = puntos(valores, days);
    assert.equal(p.length, days);
    assert.equal(p.at(-1).date, HOY);
    assert.equal(p.at(-1).isToday, true);
    assert.equal(p[0].date, addDays(HOY, -(days - 1)));
  }
});

test('un hueco corta la serie: ni la curva ni el área lo atraviesan', () => {
  const p = puntos({ '2026-09-09': [20.5, 22], '2026-09-10': [20.6, 22], '2026-09-12': [20.9, 22], '2026-09-13': [21, 22] });
  const tramos = segments(p, 'regular');
  assert.equal(tramos.length, 2, 'el día 11 sin dato parte la serie en dos tramos');
  assert.deepEqual(tramos.map((t) => t.length), [2, 2]);
  const x = (i) => i * 10;
  const y = (v) => 100 - v;
  // Ningún trazo arranca ni termina sobre el día ausente (índice 11 de 14 → x 110).
  for (const tramo of tramos) {
    assert.ok(!monotonePath(tramo, x, y).includes('M110 '), 'ningún tramo empieza en el hueco');
    assert.ok(!areaPath(tramo, x, y, 100).includes(' 110 '), 'el relleno no cruza el hueco');
  }
});

test('el último valor conserva su fecha aunque hoy no tenga dato', () => {
  const p = puntos({ '2026-09-10': [20.76, 22.19], '2026-09-12': [20.83, 22.24] });
  const ultimo = lastPoint(p, 'regular');
  assert.equal(ultimo.date, '2026-09-12');
  assert.equal(ultimo.isToday, false);
  assert.equal(ultimo.mean, 20.83);
  assert.equal(ultimo.n, 700);
  assert.equal(p.at(-1).isToday, true, 'hoy sigue en el calendario, vacío');
});

/** Las ordenadas de un trazo `M…C…`, en orden. */
function ordenadas(d) {
  const numeros = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return numeros.filter((_, indice) => indice % 2 === 1);
}

test('una serie constante conserva el piso de amplitud y queda plana', () => {
  // Con un solo producto en el plano, el piso es lo único que abre la escala.
  const valores = Object.fromEntries(windowDates(HOY, 14).map((date) => [date, [20.5, 22.1]]));
  const p = puntos(valores);
  const escala = planeScale(p, [{ key: 'regular', average: 20.5 }]);
  assert.ok(escala.max - escala.min >= MIN_SPAN, `amplitud ${escala.max - escala.min} bajo el piso`);
  assert.ok(escala.min < 20.5 && escala.max > 20.5, 'el valor no se pega a un borde');
  assert.ok(escala.ticks.length >= 2, 'una escala con una sola referencia no se puede leer');
  // Sin variación no se fabrican ondas: toda la curva, controles incluidos, a la
  // misma altura.
  const d = monotonePath(segments(p, 'regular')[0], (i) => i * 10, (v) => 100 - v);
  assert.deepEqual([...new Set(ordenadas(d))], [79.5], 'la curva se ondula sin que el dato lo diga');
});

test('el suavizado no crea valores fuera del par de días contiguos', () => {
  // Serie con picos y valles seguidos: un spline libre inventaría un mínimo por
  // debajo del día más barato. La interpolación monótona acotada no puede.
  const serie = [20.4, 21.6, 20.5, 21.9, 20.3, 21.2, 20.8];
  const valores = Object.fromEntries(windowDates(HOY, 7).map((date, i) => [date, [serie[i], 22]]));
  const tramo = segments(puntos(valores, 7), 'regular')[0];
  assert.equal(tramo.length, 7);
  const d = monotonePath(tramo, (i) => i, (v) => v);
  const cubicas = [...d.matchAll(/C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number));
  assert.equal(cubicas.length, 6);
  let origen = Number(d.match(/^M-?[\d.]+ (-?[\d.]+)/)[1]);
  for (const [, c1y, , c2y, , fin] of cubicas) {
    const bajo = Math.min(origen, fin) - 1e-9;
    const alto = Math.max(origen, fin) + 1e-9;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = 1 - t;
      const valor = u ** 3 * origen + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * fin;
      assert.ok(valor >= bajo && valor <= alto, `la curva se sale a ${valor.toFixed(4)} entre ${origen} y ${fin}`);
    }
    origen = fin;
  }
});
