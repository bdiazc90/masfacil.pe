/**
 * Modelo de vista del histórico: ventana, valores, escalas y trazos. Sin DOM.
 *
 * Aquí vive todo lo que se puede equivocar sin que se note: reencuadrar la
 * ventana contra hoy, decidir qué es un hueco y no rellenarlo, promediar los
 * días que de verdad hay y elegir un eje que no invente máximos. El dibujo se
 * limita a traducir esto a coordenadas.
 *
 * Es una función pura del resumen y del reloj: no depende de GPS, distrito,
 * marca, DOM ni almacén.
 */

import { HISTORY_CURRENCY, HISTORY_MAX_DAYS, HISTORY_SCHEMA_VERSION, HISTORY_SCOPE, HISTORY_TIMEZONE, HISTORY_UNIT, addDays, windowDates } from './history-contract.js';

const HORA_MS = 3_600_000;

/**
 * Ventana que muestra la interfaz. El contrato, el resumen y el almacén siguen
 * admitiendo `HISTORY_MAX_DAYS`: aquí solo se recorta lo que ya viajó.
 *
 * Siete días caben en el eje con las siete fechas etiquetadas, que es lo que
 * permite leer el calendario sin tocar nada. No hay selector: una ventana que
 * no se elige no necesita un control.
 */
export const DEFAULT_WINDOW = 7;
/** Cuatro observaciones al día: pasadas 36 h faltan seis, y eso ya es visible. */
export const STALE_HOURS = 36;
/**
 * Piso de amplitud del trazado, en soles por galón.
 *
 * Regla de DIBUJO, no umbral de precio: sin ella una diferencia de milésimas
 * ocuparía toda la altura y una serie constante se pegaría al borde. Con los dos
 * combustibles en el mismo plano el rango observado casi siempre lo supera; el
 * piso sigue mandando cuando solo hay un producto con datos.
 */
export const MIN_SPAN = 0.5;

// Un día cuenta si tiene media finita Y denominador. El contrato exige que
// `mean: null` y `n: 0` viajen juntos, pero el dibujo no depende de esa promesa:
// lo comprueba, porque un cero disfrazado de media es justo lo que no se puede
// pintar.
const medida = (producto) => (producto && Number.isFinite(producto.mean) && producto.n > 0 ? { mean: producto.mean, n: producto.n } : null);

const numero = (valor) => (Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0);

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
 * El último día con dato de un producto, con su fecha real.
 *
 * No se supone que los dos productos terminen el mismo día ni que el último dato
 * sea el de hoy: si hoy no se registró, el valor conserva la fecha en que se
 * midió y el hueco se queda donde está.
 *
 * @returns {{mean: number, n: number, date: string, index: number, observedAt: string|null, isToday: boolean}|null}
 */
export function lastPoint(points, key) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const dato = points[i][key];
    if (dato) return { mean: dato.mean, n: dato.n, date: points[i].date, index: i, observedAt: points[i].observation?.observed_at ?? null, isToday: points[i].isToday };
  }
  return null;
}

/**
 * Media de las medias diarias de la ventana, por producto.
 *
 * Cada día disponible pesa UNA vez: no se pondera por el `n` de cada día, no se
 * promedian capturas intradía, un hueco no entra como cero y no se divide por la
 * ventana cuando faltan días. `k` dice sobre cuántas fechas se calculó.
 *
 * @returns {{mean: number, k: number, window: number}|null}
 */
export function periodAverage(points, key) {
  const validos = points.filter((punto) => punto[key]);
  if (!validos.length) return null;
  const suma = validos.reduce((total, punto) => total + punto[key].mean, 0);
  return { mean: suma / validos.length, k: validos.length, window: points.length };
}

/** Horas desde la última observación; `null` si no hay ninguna. */
export function staleHours(lastObservedAt, now) {
  if (!lastObservedAt) return null;
  const transcurrido = (new Date(now).getTime() - Date.parse(lastObservedAt)) / HORA_MS;
  return Number.isFinite(transcurrido) ? Math.max(0, transcurrido) : null;
}

/**
 * Marcas legibles dentro del rango, en soles.
 *
 * Sube por la escalera de pasos redondos y se queda con el mayor que todavía
 * deje al menos dos marcas: con una sola referencia no se puede leer una escala.
 */
function niceTicks(min, max, objetivo = 6) {
  const span = max - min;
  if (!(span > 0)) return [];
  const base = 10 ** Math.floor(Math.log10(span));
  const pasos = [];
  for (const escala of [base / 10, base, base * 10]) for (const factor of [1, 2, 2.5, 5]) pasos.push(factor * escala);
  pasos.sort((izquierda, derecha) => izquierda - derecha);
  let mejor = [];
  for (const paso of pasos) {
    const marcas = [];
    for (let valor = Math.ceil(min / paso) * paso; valor <= max + paso / 1000; valor += paso) marcas.push(Number(valor.toFixed(4)));
    if (marcas.length < 2) break;
    mejor = marcas;
    if (marcas.length <= objetivo) break;
  }
  return mejor;
}

/**
 * Escala Y del plano, en soles reales y compartida por los dos combustibles.
 *
 * Un solo eje para las dos series: es el precio que de verdad tienen, así que la
 * brecha entre Regular y Premium se ve tal cual y nada queda normalizado. El
 * coste está declarado: con los dos productos dentro, cada curva recorre menos
 * altura que cuando tenía su propio eje. Dos ejes lo devolverían, pero pondrían
 * dos escalas distintas en el mismo plano.
 *
 * Entra también el promedio de cada producto, para que su recta nunca caiga
 * fuera del trazado. Si un producto no tiene datos, la escala sale del otro.
 *
 * @param {Array} points
 * @param {Array<{key: string, average?: number|null}>} series
 * @param {{minSpan?: number}} [opciones]
 */
export function planeScale(points, series, { minSpan = MIN_SPAN } = {}) {
  const valores = [];
  for (const { key, average } of series) {
    for (const punto of points) if (Number.isFinite(punto[key]?.mean)) valores.push(punto[key].mean);
    if (Number.isFinite(average)) valores.push(average);
  }
  if (!valores.length) return { min: 0, max: 1, ticks: [], empty: true };
  const bajo = Math.min(...valores);
  const alto = Math.max(...valores);
  const amplitud = Math.max(alto - bajo, minSpan);
  const centro = (alto + bajo) / 2;
  // El margen deja sitio al marcador del último punto y a su etiqueta, que se
  // dibujan sobre el trazado y no deben salirse por arriba ni por abajo.
  const margen = amplitud * 0.14;
  const min = centro - amplitud / 2 - margen;
  const max = centro + amplitud / 2 + margen;
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
 * Tangentes de Fritsch–Carlson: interpolación monótona ACOTADA.
 *
 * Un spline libre inventa picos entre dos días —un mínimo por debajo del día más
 * barato— y eso sería un precio que nadie observó. Aquí la tangente se anula en
 * cada extremo local y se limita al círculo de radio 3, de modo que la curva de
 * cada par contiguo se queda dentro de los valores de ese par.
 */
function monotoneTangents(tramo) {
  const n = tramo.length;
  const delta = [];
  for (let i = 0; i < n - 1; i += 1) delta.push((tramo[i + 1].mean - tramo[i].mean) / (tramo[i + 1].index - tramo[i].index));
  const m = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = (delta[i - 1] + delta[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    // Tramo plano: los dos extremos se aplanan. Una serie constante queda recta.
    if (delta[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    // Cambio de sentido: el día es un máximo o un mínimo local y su tangente es
    // cero, o la curva se pasaría de largo.
    if (m[i] / delta[i] < 0) m[i] = 0;
    if (m[i + 1] / delta[i] < 0) m[i + 1] = 0;
    const alfa = m[i] / delta[i];
    const beta = m[i + 1] / delta[i];
    const radio = alfa * alfa + beta * beta;
    if (radio > 9) {
      const tau = 3 / Math.sqrt(radio);
      m[i] = tau * alfa * delta[i];
      m[i + 1] = tau * beta * delta[i];
    }
  }
  return m;
}

/**
 * Curva suave de un tramo, en coordenadas de pantalla.
 *
 * `x` e `y` son mapeos AFINES de índice y soles a píxeles, así que basta con
 * pasarles también los puntos de control: la curva resultante es la misma que se
 * calculó en el espacio del dato. Dos puntos degeneran en recta.
 *
 * La curva es presentación: ni la media ni la consulta de un día se leen de ella.
 */
export function monotonePath(tramo, x, y) {
  if (tramo.length < 2) return '';
  const m = monotoneTangents(tramo);
  let d = `M${numero(x(tramo[0].index))} ${numero(y(tramo[0].mean))}`;
  for (let i = 0; i < tramo.length - 1; i += 1) {
    const h = tramo[i + 1].index - tramo[i].index;
    const c1 = [tramo[i].index + h / 3, tramo[i].mean + (m[i] * h) / 3];
    const c2 = [tramo[i + 1].index - h / 3, tramo[i + 1].mean - (m[i + 1] * h) / 3];
    d += `C${numero(x(c1[0]))} ${numero(y(c1[1]))} ${numero(x(c2[0]))} ${numero(y(c2[1]))} ${numero(x(tramo[i + 1].index))} ${numero(y(tramo[i + 1].mean))}`;
  }
  return d;
}

/**
 * Área bajo la curva de un tramo, cerrada contra el borde inferior de su franja.
 *
 * Se cierra por tramo y nunca a través de un hueco: el relleno describe los días
 * observados, no un periodo continuo. No es un área apilada entre productos.
 */
export function areaPath(tramo, x, y, baseY) {
  const curva = monotonePath(tramo, x, y);
  if (!curva) return '';
  const base = numero(baseY);
  return `M${numero(x(tramo[0].index))} ${base}L${curva.slice(1)}L${numero(x(tramo.at(-1).index))} ${base}Z`;
}

/**
 * Serie sintética para `?history-demo=1`.
 *
 * Existe para poder revisar el gráfico —tema oscuro, teclado, 320 px— sin
 * esperar días reales ni pedir credenciales. Nunca sale a la red y nunca se
 * guarda: es evidentemente una demostración, no un dato.
 */
export function demoSummary({ today, days = HISTORY_MAX_DAYS } = {}) {
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
