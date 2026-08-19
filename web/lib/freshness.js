const DAY_MS = 86_400_000;
export const MAX_OFFER_AGE_DAYS = 30;
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
export function filterFreshOffers(offers, { now, cutoffAt }) {
  if (!Array.isArray(offers)) throw new TypeError('La colección de ofertas debe ser un arreglo');
  const queried_at = new Date(clock(now)).toISOString(); const cutoff_at = new Date(timestamp(cutoffAt, 'El corte del snapshot')).toISOString();
  if (Date.parse(queried_at) < Date.parse(cutoff_at)) throw new FreshnessVerificationError('No se puede verificar la vigencia: el reloj es anterior al corte del snapshot');
  const evaluated = offers.map((offer) => ({ offer, freshness: evaluateOfferFreshness(offer, { now: () => queried_at, cutoffAt }) }));
  const fresh = evaluated.filter(({ freshness }) => freshness.visible).map(({ offer, freshness }) => ({ ...offer, age_days: freshness.age_days }));
  return { offers: fresh, queried_at, cutoff_at, total_offers: offers.length, fresh_offers: fresh.length };
}
