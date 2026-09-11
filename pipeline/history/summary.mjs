/**
 * El resumen que consume el navegador: 30 días, dos medias y dos conteos.
 *
 * Se reconstruye SIEMPRE desde las observaciones, nunca incrementando el
 * anterior: así una corrida atrasada, un reintento o una reparación producen el
 * mismo resultado y no hay estado que se desincronice.
 *
 * Para reconstruir la ventana se listan las observaciones por prefijo de fecha,
 * treinta listados acotados. No se recorre `bundles/` ni se descarga un solo
 * snapshot: los agregados ya están en las observaciones, que para eso existen.
 */

import { HISTORY_CURRENCY, HISTORY_MAX_DAYS, HISTORY_SCHEMA_VERSION, HISTORY_SCOPE, HISTORY_TIMEZONE, HISTORY_UNIT, limaDate, validateDailySummary, windowDates } from '../../web/lib/history-contract.js';
import { METHOD_VERSION } from './daily-mean.mjs';
import { SUMMARY_CACHE_CONTROL, JSON_CONTENT_TYPE, listAll, putMutable, sha256 } from './store.mjs';

export const SUMMARY_KEY = 'series/daily-v1.json';
/** Cuántas observaciones se leen por listado; el bucle de cursor las agota igual. */
const PAGINA = 200;

const observacionesDe = (dia) => `observations/${dia}/`;

/** Los campos de la observación que viajan al navegador, y solo esos. */
function paraElResumen(observation) {
  return {
    observation_id: observation.observation_id,
    observed_at: observation.observed_at,
    revision_id: observation.revision_id,
    archive_hash: observation.archive_hash,
    cutoff_at: observation.cutoff_at,
    source_max_reported_at: observation.source_max_reported_at,
    products: observation.products,
  };
}

/**
 * La observación que representa un día: la ÚLTIMA por `observed_at`.
 *
 * No se promedian observaciones: hacerlo daría una media de medias con pesos
 * distintos y dejaría de significar «al último corte de ese día». El desempate
 * por identificador existe para que dos corridas den el mismo resultado.
 */
export function lastObservationOfDay(observations) {
  return [...observations].sort((izquierda, derecha) => {
    const orden = Date.parse(izquierda.observed_at) - Date.parse(derecha.observed_at);
    return orden !== 0 ? orden : String(izquierda.observation_id).localeCompare(String(derecha.observation_id), 'en');
  }).at(-1) ?? null;
}

/**
 * Reconstruye el resumen desde las observaciones guardadas.
 *
 * @returns {Promise<{summary: object, observations: number, daysWithObservation: number, problems: string[]}>}
 */
export async function buildDailySummary(store, { generatedAt, days = HISTORY_MAX_DAYS } = {}) {
  const problems = [];
  const fechas = windowDates(limaDate(generatedAt), days);
  const series = [];
  let observations = 0;

  for (const date of fechas) {
    const claves = await listAll(store, observacionesDe(date), { limit: PAGINA });
    const leidas = [];
    for (const { key } of claves) {
      const objeto = await store.get(key);
      if (!objeto) { problems.push(`observación listada y ausente: ${key}`); continue; }
      try { leidas.push(JSON.parse(objeto.body)); }
      catch { problems.push(`observación ilegible: ${key}`); }
    }
    observations += leidas.length;
    const elegida = lastObservationOfDay(leidas);
    series.push({ date, observation: elegida ? paraElResumen(elegida) : null });
  }

  const summary = {
    schema_version: HISTORY_SCHEMA_VERSION,
    method_version: METHOD_VERSION,
    timezone: HISTORY_TIMEZONE,
    scope: { ...HISTORY_SCOPE },
    currency: HISTORY_CURRENCY,
    unit: HISTORY_UNIT,
    generated_at: generatedAt,
    days,
    series,
  };
  // El productor se valida con el mismo contrato que el navegador: si no pasa,
  // no se publica un resumen que la app iba a rechazar.
  problems.push(...validateDailySummary(summary).map((motivo) => `resumen inválido · ${motivo}`));
  return { summary, observations, daysWithObservation: series.filter((dia) => dia.observation).length, problems };
}

/** El resumen sin su sello de generación: lo que de verdad puede cambiar. */
const sinSello = (summary) => (summary ? JSON.stringify({ ...summary, generated_at: null }) : null);

/** Identificadores de observación presentes en un resumen, por fecha. */
function porFecha(summary) {
  return new Map((summary?.series ?? []).filter((dia) => dia.observation).map((dia) => [dia.date, dia.observation.observation_id]));
}

/**
 * Escribe el resumen solo si no empeora lo que ya está publicado.
 *
 * Cuatro guardas, en orden. El escritor único lo garantiza el grupo de
 * concurrencia del workflow; estas tres protegen de lo que la cola no cubre:
 * una corrida atrasada, un listado incompleto y el churn inútil.
 *
 * @returns {Promise<{write: string, reason: string, bytes: number|null}>}
 */
export async function publishDailySummary(store, summary, { key = SUMMARY_KEY } = {}) {
  const cuerpo = `${JSON.stringify(summary)}\n`;
  const anterior = await store.get(key);
  const previo = (() => { try { return anterior ? JSON.parse(anterior.body) : null; } catch { return null; } })();
  const previoValido = previo && validateDailySummary(previo).length === 0 ? previo : null;

  if (previoValido) {
    // 1. No retroceder en el tiempo. Que una corrida vieja llegue después que
    // una nueva es normal —hacen cola, no terminan en orden—, y que no escriba
    // es la guarda funcionando, no un fallo.
    const nuevoEsAnterior = Date.parse(summary.generated_at) < Date.parse(previoValido.generated_at)
      || String(summary.series.at(-1)?.date) < String(previoValido.series.at(-1)?.date);
    if (nuevoEsAnterior) return { write: 'skipped_stale', reason: `lo publicado (${previoValido.generated_at}) es más nuevo que esta corrida (${summary.generated_at})`, bytes: null };

    // 2. No perder observaciones. Si una fecha que ya tenía observación llega
    // ahora vacía, o con otra distinta hacia atrás, es que el listado devolvió
    // menos de lo que hay. Se prefiere no escribir y que la corrida se vea roja.
    const antes = porFecha(previoValido);
    const ahora = porFecha(summary);
    const fechasNuevas = new Set(summary.series.map((dia) => dia.date));
    const perdidas = [...antes.keys()].filter((fecha) => fechasNuevas.has(fecha) && !ahora.has(fecha));
    if (perdidas.length) return { write: 'blocked_missing_observations', reason: `faltan observaciones que sí estaban publicadas: ${perdidas.join(', ')}`, bytes: null };
  }

  // 3. Sin cambios, sin escritura: evita invalidar la caché de borde por nada.
  // Se compara TODO menos `generated_at`, que cambia en cada corrida por
  // definición: sin excluirlo, cuatro corridas diarias reescribirían el mismo
  // contenido cuatro veces. Si la ventana se movió de día, la serie cambia y sí
  // se escribe, así que la última fecha nunca queda desalineada del sello.
  if (anterior && sinSello(previo) === sinSello(summary)) return { write: 'skipped_unchanged', reason: 'el contenido del resumen no cambió', bytes: Buffer.byteLength(cuerpo) };

  await putMutable(store, key, cuerpo, { contentType: JSON_CONTENT_TYPE, cacheControl: SUMMARY_CACHE_CONTROL });
  return { write: 'written', reason: `resumen de ${summary.days} días publicado (${sha256(cuerpo).slice(0, 12)})`, bytes: Buffer.byteLength(cuerpo) };
}
