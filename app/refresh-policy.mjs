export function canUseCurlFallback(attempts = []) {
  return !attempts.some((attempt) => attempt.status !== null && Number.isFinite(attempt.status));
}

export function sourceMaxAdvances(active, candidate) {
  const previous = Date.parse(active);
  const next = Date.parse(candidate);
  return Number.isFinite(previous) && Number.isFinite(next) && next > previous;
}

export function hasNumericQuality(quality) {
  return [quality?.candidate?.fresh_offers, quality?.candidate?.contract_ready, quality?.candidate?.coverage_percent].every(Number.isFinite);
}
