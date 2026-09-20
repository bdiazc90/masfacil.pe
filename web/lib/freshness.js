// Las dos ventanas viven juntas en `price-source.js`, que es quien decide la
// fuente; aquí se reexporta la del CSV porque es la que este módulo aplica y la
// que ya consultan sus importadores.
import { MAX_OFFER_AGE_DAYS, selectOfferPrice } from './price-source.js';

const DAY_MS = 86_400_000;
export { MAX_OFFER_AGE_DAYS };
export class FreshnessVerificationError extends Error { constructor(message) { super(message); this.name = 'FreshnessVerificationError'; } }
function timestamp(value, label) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new FreshnessVerificationError(`${label} inválido`); return parsed; }
function clock(now) { if (typeof now !== 'function') throw new FreshnessVerificationError('No se puede verificar la vigencia: falta un reloj inyectado'); const value = now(); const parsed = value instanceof Date ? value.getTime() : Date.parse(value); if (!Number.isFinite(parsed)) throw new FreshnessVerificationError('No se puede verificar la vigencia: el reloj es inválido'); return parsed; }
export function evaluateOfferFreshness(offer, { now, cutoffAt }) {
  const current = clock(now); const cutoff = timestamp(cutoffAt, 'El corte del snapshot');
  if (current < cutoff) throw new FreshnessVerificationError('No se puede verificar la vigencia: el reloj es anterior al corte del snapshot');
  const reported = Date.parse(offer?.reported_at);
  if (!Number.isFinite(reported)) return { visible: false, age_days: null, reason: 'invalid_reported_at' };
  const age_days = (current - reported) / DAY_MS;
  if (age_days < 0) return { visible: false, age_days, reason: 'future_reported_at' };
  return age_days <= MAX_OFFER_AGE_DAYS ? { visible: true, age_days, reason: 'recent' } : { visible: false, age_days, reason: 'expired' };
}
// La ventana de 30 días sigue decidiendo qué PRECIO se pinta, no qué grifo
// existe. Por eso lo vencido ya no se tira: se devuelve aparte, para que la
// tarjeta permanezca sin precio en vez de desaparecer. Lo que nunca se muestra
// es un reporte del futuro o con fecha ilegible: eso sí se descarta.
//
// Desde el contrato 2.7.0 una oferta puede traer además la consulta web, así
// que aquí ya no se mira solo `reported_at`: `selectOfferPrice` decide qué
// importe vale y de dónde viene, y esta función entrega la oferta con ese
// precio ya resuelto. Es el único paso antes de filtrar, ordenar y contar, de
// modo que nadie aguas abajo pueda ordenar por un precio y pintar otro.
//
// Lo vencido conserva su precio y su fecha del CSV: el silencio de la tarjeta
// muda mide cuánto lleva el operador sin reportar, nunca un fallo o un
// vencimiento de nuestra consulta.
export function filterFreshOffers(offers, { now, cutoffAt }) {
  if (!Array.isArray(offers)) throw new TypeError('La colección de ofertas debe ser un arreglo');
  const queried_at = new Date(clock(now)).toISOString(); const cutoff_at = new Date(timestamp(cutoffAt, 'El corte del snapshot')).toISOString();
  if (Date.parse(queried_at) < Date.parse(cutoff_at)) throw new FreshnessVerificationError('No se puede verificar la vigencia: el reloj es anterior al corte del snapshot');
  const reloj = () => queried_at;
  const evaluated = offers.map((offer) => ({ offer, elegido: selectOfferPrice(offer, { now: reloj, cutoffAt }), freshness: evaluateOfferFreshness(offer, { now: reloj, cutoffAt }) }));
  // `reported_age_days` viaja siempre y mide SOLO el reporte del CSV: es lo que
  // contesta «desde cuándo calla este grifo», y esa respuesta no puede depender
  // de que nuestra consulta funcionara o no.
  const fresh = evaluated.filter(({ elegido }) => elegido.price !== null)
    .map(({ offer, elegido, freshness }) => ({ ...offer, price: elegido.price, age_days: elegido.age_days, price_source: elegido.source, price_at: elegido.at, reported_age_days: freshness.age_days }));
  const expired = evaluated.filter(({ elegido, freshness }) => elegido.price === null && freshness.reason === 'expired')
    .map(({ offer, freshness }) => ({ ...offer, age_days: freshness.age_days, price_source: null, price_at: null, reported_age_days: freshness.age_days }));
  return { offers: fresh, expired, queried_at, cutoff_at, total_offers: offers.length, fresh_offers: fresh.length, expired_offers: expired.length };
}
