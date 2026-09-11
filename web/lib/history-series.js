/**
 * Modelo de vista del histórico: ventana, escalas y tramos. Sin DOM.
 *
 * Aquí vive todo lo que se puede equivocar sin que se note: reencuadrar la
 * ventana contra hoy, decidir qué es un hueco y no rellenarlo, y elegir un eje
 * que no invente máximos. El dibujo se limita a traducir esto a coordenadas.
 */

import { HISTORY_CURRENCY, HISTORY_SCHEMA_VERSION, HISTORY_SCOPE, HISTORY_TIMEZONE, HISTORY_UNIT, addDays, windowDates } from './history-contract.js';

const HORA_MS = 3_600_000;
export const HISTORY_WINDOWS = Object.freeze([7, 14, 30]);
/** Treinta por defecto: es la ventana de frescura de la app y la serie entera que viaja. */
export const DEFAULT_WINDOW = 30;
/** Cuatro observaciones al día: pasadas 36 h faltan seis, y eso ya es visible. */
export const STALE_HOURS = 36;

const medida = (producto) => (producto && Number.isFinite(producto.mean) ? { mean: producto.mean, n: producto.n } : null);

/**
 * Recorta el resumen a la ventana pedida, terminando en HOY.
 *
 * La ventana la manda el reloj de quien mira, no `generated_at` del resumen: si
 * el resumen quedó viejo, los días posteriores a su última fecha son HUECOS. Un
 * punto repetido diría que ese día hubo esa media, y no se sabe.
 *
 * @param {object|null} summary
 * @param {{today: string, days: number}} entrada
 */
export function frameWindow(summary, { today, days = DEFAULT_WINDOW } = {}) {
  const porFecha = new Map((summary?.series ?? []).map((dia) => [dia.date, dia.observation]));
  const points = windowDates(today, days).map((date, index) => {
    const observation = porFecha.get(date) ?? null;
    return {
      date,
      index,
      isToday: date === today,
      observation,
      regular: medida(observation?.products?.regular),
      premium: medida(observation?.products?.premium),
    };
  });
  const observados = points.filter((punto) => punto.observation);
  const lastObservedAt = observados.map((punto) => punto.observation.observed_at).sort().at(-1) ?? null;
  return { points, days, daysWithObservation: observados.length, lastObservedAt };
}

/**
 * El `n` del último punto con dato de cada producto: la leyenda lo muestra
 * siempre, para que la media nunca viaje sin su denominador.
 *
 * @returns {{regular: number|null, premium: number|null}}
 */
export function lastCounts(points) {
  const ultimo = (key) => [...points].reverse().find((punto) => punto[key])?.[key].n ?? null;
  return { regular: ultimo('regular'), premium: ultimo('premium') };
}

/** Horas desde la última observación; `null` si no hay ninguna. */
export function staleHours(lastObservedAt, now) {
  if (!lastObservedAt) return null;
  const transcurrido = (new Date(now).getTime() - Date.parse(lastObservedAt)) / HORA_MS;
  return Number.isFinite(transcurrido) ? Math.max(0, transcurrido) : null;
}

/** Tres o cuatro marcas legibles dentro del rango. */
function niceTicks(min, max, objetivo = 4) {
  const bruto = (max - min) / (objetivo - 1);
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitud).find((candidato) => candidato >= bruto) ?? magnitud * 10;
  const marcas = [];
  for (let valor = Math.ceil(min / paso) * paso; valor <= max + paso / 1000; valor += paso) marcas.push(Number(valor.toFixed(4)));
  return marcas;
}

/**
 * Escala Y compartida por las dos series.
 *
 * No fuerza el cero: entre S/ 20 y S/ 23 la diferencia se vería como una raya
 * plana. Y si todos los valores son iguales, se abre un rango mínimo para que la
 * línea sea visible en vez de pegarse al borde.
 */
export function sharedScale(points) {
  const valores = points.flatMap((punto) => [punto.regular?.mean, punto.premium?.mean]).filter((valor) => Number.isFinite(valor));
  if (!valores.length) return { min: 0, max: 1, ticks: [], empty: true };
  const bajo = Math.min(...valores);
  const alto = Math.max(...valores);
  if (alto === bajo) return { min: bajo - 0.25, max: alto + 0.25, ticks: niceTicks(bajo - 0.25, alto + 0.25), empty: false };
  const margen = (alto - bajo) * 0.08;
  const min = bajo - margen;
  const max = alto + margen;
  return { min, max, ticks: niceTicks(min, max), empty: false };
}

/**
 * Tramos contiguos con dato de una serie.
 *
 * Un hueco CORTA la línea. No se interpola, no se arrastra el último valor y no
 * se comprime el calendario: unir dos días separados por un hueco dibujaría una
 * pendiente que nadie midió. Un tramo de un solo punto se pinta como punto.
 */
export function segments(points, key) {
  const tramos = [];
  let actual = null;
  for (const punto of points) {
    const valor = punto[key]?.mean;
    if (!Number.isFinite(valor)) { actual = null; continue; }
    if (!actual) { actual = []; tramos.push(actual); }
    actual.push({ index: punto.index, mean: valor, date: punto.date, n: punto[key].n });
  }
  return tramos;
}

/**
 * Serie sintética para `?history-demo=1`.
 *
 * Existe para poder revisar el gráfico —tema oscuro, teclado, 360 px— sin
 * esperar días reales ni pedir credenciales. Nunca sale a la red y nunca se
 * guarda: es evidentemente una demostración, no un dato.
 */
export function demoSummary({ today, days = 30 } = {}) {
  const fechas = windowDates(today, days);
  const generated_at = `${today}T18:00:00.000Z`;
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    method_version: 'daily-mean-1',
    timezone: HISTORY_TIMEZONE,
    scope: { ...HISTORY_SCOPE },
    currency: HISTORY_CURRENCY,
    unit: HISTORY_UNIT,
    generated_at,
    days,
    series: fechas.map((date, indice) => {
      // Un par de huecos a propósito: el estado normal de una fuente semanal no
      // es una línea continua, y la demostración no debe sugerir que sí.
      if (indice === days - 9 || indice === days - 8) return { date, observation: null };
      const escalon = Math.floor(indice / 7) * 0.18;
      const regular = Number((20.4 + escalon + Math.sin(indice / 3) * 0.06).toFixed(4));
      const premium = Number((22.1 + escalon + Math.cos(indice / 4) * 0.05).toFixed(4));
      return {
        date,
        observation: {
          observation_id: `obs_demo${String(indice).padStart(18, '0')}`,
          observed_at: `${date}T23:37:00.000Z`,
          revision_id: `gasolina-demo-${date}`,
          archive_hash: 'd'.repeat(64),
          cutoff_at: `${addDays(date, -1)}T22:00:00.000Z`,
          source_max_reported_at: `${addDays(date, -2)}T04:54:46.000Z`,
          products: { regular: { mean: regular, n: 700 + indice }, premium: { mean: premium, n: 680 + indice } },
        },
      };
    }),
  };
}
