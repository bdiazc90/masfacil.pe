// Qué precio vale hoy, y de dónde salió.
//
// Una oferta puede llevar dos importes para el mismo grifo y producto: el del
// CSV oficial, con la fecha en que el operador lo registró, y el de la consulta
// web, con la hora en que leímos la tabla. Son afirmaciones distintas y no se
// mezclan: `reported_at` dice desde cuándo rige un precio, `observed_at` dice
// cuándo lo vimos. Esta función es el ÚNICO lugar que decide cuál se usa, y la
// consultan la tarjeta, el orden, los contadores y el histórico. Mientras haya
// una sola, no puede pasar que la lista ordene por un precio y la tarjeta pinte
// otro.
//
// El reloj se inyecta siempre, como en `freshness.js`: el navegador usa el del
// dispositivo, el histórico el instante de su observación, y la proyección el
// corte del snapshot. Un precio no cambia de fuente porque el proceso se haya
// ejecutado.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Un reporte del CSV se muestra y compite durante 30 días desde su fecha. */
export const MAX_OFFER_AGE_DAYS = 30;
/** Una consulta web sirve durante un día desde que se leyó la tabla. */
export const MAX_QUERY_AGE_HOURS = 24;

export class PriceSourceError extends Error { constructor(message) { super(message); this.name = 'PriceSourceError'; } }

function clock(now) {
  if (typeof now !== 'function') throw new PriceSourceError('No se puede elegir la fuente: falta un reloj inyectado');
  const value = now();
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new PriceSourceError('No se puede elegir la fuente: el reloj es inválido');
  return parsed;
}

/** Un instante legible, o null. Una fecha ilegible nunca hace elegible un precio. */
const instante = (value) => { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };

/**
 * El precio efectivo de una oferta y su procedencia real.
 *
 * Orden, tal cual lo decidió Bruno:
 *
 * 1. Si el CSV trae un reporte válido POSTERIOR a la consulta, gana el CSV: una
 *    consulta anterior no desplaza un reporte posterior conocido, aunque la
 *    consulta sea «más reciente» en el sentido de haberse hecho después de que
 *    el archivo se publicara.
 * 2. Si no, gana la consulta, siempre que tenga entre cero y 24 horas.
 * 3. Si no, gana el CSV, siempre que su reporte tenga entre cero y 30 días.
 * 4. Si ninguno es elegible, no hay precio. La tarjeta se queda; el precio no.
 *
 * Los dos límites incluyen sus extremos. Una fecha futura no es elegible por
 * ninguna vía: un reloj adelantado no debe inventar frescura.
 *
 * @param {object} offer  oferta del bundle, con `price`/`reported_at` y `facilito`
 * @param {{now: () => (Date|string), cutoffAt: string}} contexto
 * @returns {{price: number|null, source: 'facilito'|'csv'|null, at: string|null, age_days: number|null, reason: string}}
 */
export function selectOfferPrice(offer, { now, cutoffAt }) {
  const current = clock(now);
  const cutoff = instante(cutoffAt);
  if (cutoff === null) throw new PriceSourceError('No se puede elegir la fuente: el corte del snapshot es inválido');
  if (current < cutoff) throw new PriceSourceError('No se puede elegir la fuente: el reloj es anterior al corte del snapshot');

  const reportado = instante(offer?.reported_at);
  const csvPrecio = Number.isFinite(offer?.price) && offer.price > 0 ? offer.price : null;
  const csvEdad = reportado === null || csvPrecio === null ? null : (current - reportado) / DAY_MS;
  const csvElegible = csvEdad !== null && csvEdad >= 0 && csvEdad <= MAX_OFFER_AGE_DAYS;

  const capa = offer?.facilito ?? null;
  const consultado = capa === null ? null : instante(capa.observed_at);
  const webPrecio = capa !== null && Number.isFinite(capa.price) && capa.price > 0 ? capa.price : null;
  const webEdad = consultado === null || webPrecio === null ? null : (current - consultado) / DAY_MS;
  const webElegible = webEdad !== null && webEdad >= 0 && webEdad * 24 <= MAX_QUERY_AGE_HOURS;

  const sinPrecio = (reason) => ({ price: null, source: null, at: null, age_days: null, reason });
  const conCsv = (reason) => ({ price: csvPrecio, source: 'csv', at: offer.reported_at, age_days: csvEdad, reason });

  // El CSV posterior gana aunque la consulta siga dentro de su ventana: sabemos
  // de un cambio de precio más nuevo que lo que llegamos a ver en la tabla.
  if (csvElegible && consultado !== null && reportado > consultado) return conCsv('csv_posterior_a_la_consulta');
  if (webElegible) return { price: webPrecio, source: 'facilito', at: capa.observed_at, age_days: webEdad, reason: 'consulta_vigente' };
  if (csvElegible) return conCsv('reporte_vigente');
  if (csvEdad !== null && csvEdad < 0) return sinPrecio('reporte_futuro');
  if (csvEdad !== null) return sinPrecio('reporte_vencido');
  return sinPrecio('sin_precio_utilizable');
}

/**
 * Cuándo deja de valer lo que la pantalla muestra ahora mismo.
 *
 * El cliente guarda el bundle y sigue funcionando sin red, así que el cambio de
 * fuente tiene que ocurrir por el paso del tiempo, no por una descarga. Esto
 * devuelve los milisegundos que faltan para que una oferta cambie de respuesta:
 * una consulta que cruza las 24 horas activa el respaldo CSV, y un reporte que
 * cruza los 30 días apaga el precio. Sin nada que vencer, `Infinity`.
 */
export function msUntilSourceChange(offer, { now, cutoffAt }) {
  const current = clock(now);
  const elegido = selectOfferPrice(offer, { now, cutoffAt });
  const restante = [];
  const consultado = instante(offer?.facilito?.observed_at);
  const reportado = instante(offer?.reported_at);
  if (elegido.source === 'facilito' && consultado !== null) restante.push(consultado + MAX_QUERY_AGE_HOURS * HOUR_MS - current);
  if (reportado !== null && reportado <= current) restante.push(reportado + MAX_OFFER_AGE_DAYS * DAY_MS - current);
  const positivos = restante.filter((ms) => Number.isFinite(ms) && ms > 0);
  return positivos.length ? Math.min(...positivos) : Infinity;
}
