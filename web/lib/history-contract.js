/**
 * Contrato del resumen histórico: fechas de Lima y validación del formato que
 * viaja del observador al navegador.
 *
 * Este módulo es ISOMÓRFICO: lo importan Node —el observador y las sondas— y el
 * navegador, sin duplicarse. El contrato de precios sí está duplicado
 * (`pipeline/gasolina-contract.mjs` usa `node:crypto`, `web/gasolina-contract.js`
 * usa `crypto.subtle`) porque valida por hash. Aquí no hay hash que calcular: el
 * resumen se valida por su ESTRUCTURA —fechas reales, orden, alcance, unidades,
 * finitud, coherencia entre `mean` y `n`, tamaño—, así que un solo archivo sirve
 * a los dos entornos. Cero criptografía, cero `fs`, cero red.
 *
 * El resumen NO repite las ofertas ni el expediente comercial: solo dos medias y
 * dos conteos por día, más la traza de qué observación los produjo.
 */

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const HISTORY_SCHEMA_VERSION = 'history-daily-1';
export const HISTORY_SCHEMA_VERSIONS = Object.freeze(['history-daily-1']);
export const HISTORY_TIMEZONE = 'America/Lima';
export const HISTORY_CURRENCY = 'PEN';
export const HISTORY_UNIT = 'Galones';
export const HISTORY_MAX_DAYS = 30;
/** Un resumen de 30 días pesa ~7 KB; este tope solo descarta un cuerpo absurdo. */
export const HISTORY_MAX_BYTES = 64 * 1024;

/**
 * Origen del resumen: la URL pública del bucket, en Neon Object Storage. Es un
 * valor público ligado a la rama del bucket, no un secreto; si cambia, cambia
 * aquí y en `connect-src` de `web/_headers`, y se publica un release de shell.
 *
 * Vive en otro origen a propósito: así el service worker —que ignora todo lo
 * cross-origin— no puede cachear como shell un JSON que cambia cada pocas
 * horas, y publicar el resumen no exige redesplegar la PWA.
 * `scripts/verify-web.mjs` cruza esta constante con `connect-src`.
 *
 * La ruta es `/<bucket>/<prefijo><clave>`: el bucket es único para todos los
 * utilitarios y el histórico vive bajo `gasolina/`.
 */
export const HISTORY_ORIGIN = 'https://br-winter-flower-axp7ynzb.storage.c-4.us-east-2.aws.neon.tech';
export const HISTORY_SUMMARY_PATH = '/masfacil-datos/gasolina/series/daily-v1.json';

// El alcance y los productos se declaran aquí en vez de importarse del contrato
// de precios: este formato es independiente y no debe romperse porque aquel
// cambie. La sonda cruza ambas listas, que es como el proyecto ya protege la
// duplicación deliberada entre `web/` y `pipeline/`.
export const HISTORY_SCOPE = Object.freeze({ department: 'LIMA', province: 'LIMA' });
export const HISTORY_PRODUCTS = Object.freeze(['regular', 'premium']);

const SUMMARY_FIELDS = Object.freeze(['schema_version', 'method_version', 'timezone', 'scope', 'currency', 'unit', 'generated_at', 'days', 'series']);
const DAY_FIELDS = Object.freeze(['date', 'observation']);
const OBSERVATION_FIELDS = Object.freeze(['observation_id', 'observed_at', 'revision_id', 'archive_hash', 'cutoff_at', 'source_max_reported_at', 'products']);
const PRODUCT_FIELDS = Object.freeze(['mean', 'n']);

const sameKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
const text = (value) => typeof value === 'string' && value.length > 0;
const timestamp = (value) => text(value) && Number.isFinite(Date.parse(value));

/**
 * Fecha local de Lima de un instante, como `AAAA-MM-DD`.
 *
 * El calendario del histórico es siempre el de Lima, también para quien abre la
 * app desde otro huso: un reporte de las 21:37 de Lima es del día 9 aunque en
 * UTC ya sea el 10. `en-CA` produce exactamente el formato ISO de fecha.
 */
export function limaDate(instant) {
  const parsed = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (!Number.isFinite(parsed)) throw new Error(`Instante inválido para derivar la fecha local: ${instant}`);
  return new Intl.DateTimeFormat('en-CA', { timeZone: HISTORY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(parsed));
}

/**
 * Milisegundos UTC de una fecha `AAAA-MM-DD`. Rechaza fechas que no existen.
 *
 * El ida y vuelta no es adorno: `Date.parse('2026-02-30T00:00:00Z')` no falla,
 * DESBORDA al 2 de marzo. Sin volver a formatear, un 30 de febrero entraría en
 * la serie convertido en otra fecha y nadie lo notaría.
 */
function dateToUtc(date, label = 'fecha') {
  if (!DATE_PATTERN.test(String(date ?? ''))) throw new Error(`${label} fuera de formato AAAA-MM-DD: ${date}`);
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) throw new Error(`${label} inexistente en el calendario: ${date}`);
  return parsed;
}

/** Aritmética de días sobre `AAAA-MM-DD`, en UTC puro: no depende del huso del proceso. */
export function addDays(date, delta) {
  return new Date(dateToUtc(date) + delta * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((dateToUtc(to, 'fecha final') - dateToUtc(from, 'fecha inicial')) / DAY_MS);
}

/** Las `days` fechas consecutivas que terminan en `endDate`, ascendentes. */
export function windowDates(endDate, days) {
  if (!Number.isInteger(days) || days < 1 || days > HISTORY_MAX_DAYS) throw new Error(`Ventana fuera de rango: ${days}`);
  return Array.from({ length: days }, (_, index) => addDays(endDate, index - days + 1));
}

/** Una fecha real, sin lanzar. */
export function isRealDate(date) {
  try { dateToUtc(date); return true; } catch { return false; }
}

function productProblems(value, where, problems) {
  if (!sameKeys(value, PRODUCT_FIELDS)) { problems.push(`${where}: campos inesperados o ausentes`); return; }
  const { mean, n } = value;
  if (!Number.isInteger(n) || n < 0) problems.push(`${where}.n: debe ser un entero no negativo`);
  if (mean !== null && (!Number.isFinite(mean) || mean <= 0)) problems.push(`${where}.mean: debe ser null o un número positivo`);
  // Un día observado sin precios elegibles es `{mean: null, n: 0}`, nunca un
  // precio cero. La equivalencia se exige en los dos sentidos para que ningún
  // productor pueda publicar una media sin denominador ni al revés.
  if ((mean === null) !== (n === 0)) problems.push(`${where}: mean null y n cero tienen que ir juntos`);
}

function observationProblems(observation, where, problems) {
  if (!sameKeys(observation, OBSERVATION_FIELDS)) { problems.push(`${where}: campos inesperados o ausentes`); return; }
  if (!text(observation.observation_id)) problems.push(`${where}.observation_id: inválido`);
  if (!timestamp(observation.observed_at)) problems.push(`${where}.observed_at: inválido`);
  if (!text(observation.revision_id)) problems.push(`${where}.revision_id: inválido`);
  if (!/^[a-f0-9]{64}$/.test(observation.archive_hash ?? '')) problems.push(`${where}.archive_hash: inválido`);
  if (!timestamp(observation.cutoff_at)) problems.push(`${where}.cutoff_at: inválido`);
  if (!timestamp(observation.source_max_reported_at)) problems.push(`${where}.source_max_reported_at: inválido`);
  // El instante de observación nunca puede ser anterior al corte del snapshot
  // que observó: sería medir la vigencia contra un futuro que no existía.
  if (timestamp(observation.observed_at) && timestamp(observation.cutoff_at)
    && Date.parse(observation.observed_at) < Date.parse(observation.cutoff_at)) problems.push(`${where}: observed_at anterior al corte del snapshot`);
  if (!observation.products || JSON.stringify(Object.keys(observation.products)) !== JSON.stringify([...HISTORY_PRODUCTS])) {
    problems.push(`${where}.products: productos inválidos`);
    return;
  }
  for (const key of HISTORY_PRODUCTS) productProblems(observation.products[key], `${where}.products.${key}`, problems);
}

/**
 * Errores del resumen diario. Vacío significa publicable.
 *
 * @param {object} summary  el resumen ya parseado
 * @param {{bytes?: number|null}} [opciones]  tamaño del cuerpo recibido, si se conoce
 * @returns {string[]}
 */
export function validateDailySummary(summary, { bytes = null } = {}) {
  const problems = [];
  if (Number.isFinite(bytes) && bytes > HISTORY_MAX_BYTES) problems.push(`resumen de ${bytes} bytes; el tope es ${HISTORY_MAX_BYTES}`);
  if (!sameKeys(summary, SUMMARY_FIELDS)) return [...problems, 'resumen: campos inesperados o ausentes'];
  if (!HISTORY_SCHEMA_VERSIONS.includes(summary.schema_version)) problems.push(`resumen: versión de esquema desconocida (${summary.schema_version})`);
  if (!text(summary.method_version)) problems.push('resumen: method_version inválido');
  if (summary.timezone !== HISTORY_TIMEZONE) problems.push(`resumen: el calendario debe ser ${HISTORY_TIMEZONE}`);
  if (JSON.stringify(summary.scope) !== JSON.stringify(HISTORY_SCOPE)) problems.push('resumen: ámbito distinto de LIMA/LIMA');
  if (summary.currency !== HISTORY_CURRENCY) problems.push(`resumen: moneda distinta de ${HISTORY_CURRENCY}`);
  if (summary.unit !== HISTORY_UNIT) problems.push(`resumen: unidad distinta de ${HISTORY_UNIT}`);
  if (!timestamp(summary.generated_at)) problems.push('resumen: generated_at inválido');
  if (!Number.isInteger(summary.days) || summary.days < 1 || summary.days > HISTORY_MAX_DAYS) problems.push(`resumen: days fuera de 1..${HISTORY_MAX_DAYS}`);
  if (!Array.isArray(summary.series)) return [...problems, 'resumen: series debe ser un arreglo'];
  if (summary.series.length !== summary.days) problems.push(`resumen: ${summary.series.length} fechas para days=${summary.days}`);

  let previa = null;
  for (const [indice, dia] of summary.series.entries()) {
    const where = `resumen.series[${indice}]`;
    if (!sameKeys(dia, DAY_FIELDS)) { problems.push(`${where}: campos inesperados o ausentes`); continue; }
    if (!isRealDate(dia.date)) { problems.push(`${where}.date: fecha inexistente o fuera de formato`); previa = null; continue; }
    // Consecutivas y ascendentes: un hueco en el eje X tiene que ser un día con
    // `observation: null`, nunca una fecha que falta. Comprimir el calendario
    // dibujaría una tendencia que el dato no afirma.
    if (previa !== null && daysBetween(previa, dia.date) !== 1) problems.push(`${where}.date: ${dia.date} no sigue a ${previa}`);
    previa = dia.date;
    if (dia.observation === null) continue;
    observationProblems(dia.observation, `${where}.observation`, problems);
  }

  // La última fecha ancla la serie al día en que se generó; sin eso, la UI no
  // podría distinguir un resumen viejo de uno al día.
  if (timestamp(summary.generated_at) && summary.series.length) {
    const ultima = summary.series.at(-1)?.date;
    const esperada = limaDate(summary.generated_at);
    if (ultima !== esperada) problems.push(`resumen: la última fecha es ${ultima} y la generación fue el ${esperada} en Lima`);
  }
  return [...new Set(problems)];
}
