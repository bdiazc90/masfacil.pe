const DAY_MS = 86_400_000;

export const MAX_OFFER_AGE_DAYS = 30;

export class FreshnessVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FreshnessVerificationError';
  }
}

function parseTimestamp(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new FreshnessVerificationError(`${label} inválido`);
  return timestamp;
}

function readClock(now) {
  if (typeof now !== 'function') throw new FreshnessVerificationError('No se puede verificar la vigencia: falta un reloj inyectado');
  const value = now();
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new FreshnessVerificationError('No se puede verificar la vigencia: el reloj es inválido');
  return timestamp;
}

export function evaluateOfferFreshness(offer, { now, cutoffAt }) {
  const nowTimestamp = readClock(now);
  const cutoffTimestamp = parseTimestamp(cutoffAt, 'El corte del snapshot');
  if (nowTimestamp < cutoffTimestamp) {
    throw new FreshnessVerificationError('No se puede verificar la vigencia: el reloj es anterior al corte del snapshot');
  }
  const reportedTimestamp = Date.parse(offer?.reported_at);
  if (!Number.isFinite(reportedTimestamp)) return { visible: false, age_days: null, reason: 'invalid_reported_at' };
  const ageDays = (nowTimestamp - reportedTimestamp) / DAY_MS;
  if (!Number.isFinite(ageDays) || ageDays < 0) return { visible: false, age_days: ageDays, reason: 'future_reported_at' };
  if (ageDays > MAX_OFFER_AGE_DAYS) return { visible: false, age_days: ageDays, reason: 'expired' };
  return { visible: true, age_days: ageDays, reason: 'recent' };
}

export function filterFreshOffers(offers, { now, cutoffAt }) {
  if (!Array.isArray(offers)) throw new TypeError('La colección de ofertas debe ser un arreglo');
  const queriedAt = new Date(readClock(now)).toISOString();
  const cutoffTimestamp = parseTimestamp(cutoffAt, 'El corte del snapshot');
  if (Date.parse(queriedAt) < cutoffTimestamp) {
    throw new FreshnessVerificationError('No se puede verificar la vigencia: el reloj es anterior al corte del snapshot');
  }
  const evaluated = offers.map((offer) => ({
    offer,
    freshness: evaluateOfferFreshness(offer, { now: () => queriedAt, cutoffAt }),
  }));
  const freshOffers = evaluated
    .filter(({ freshness }) => freshness.visible)
    .map(({ offer, freshness }) => ({ ...offer, age_days: freshness.age_days }));
  return {
    offers: freshOffers,
    queried_at: queriedAt,
    cutoff_at: new Date(cutoffTimestamp).toISOString(),
    total_offers: offers.length,
    fresh_offers: freshOffers.length,
  };
}
