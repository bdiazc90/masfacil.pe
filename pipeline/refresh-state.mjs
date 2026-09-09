const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);
const MAX_OFFER_DROP = 0.2;
const MAX_COVERAGE_DROP_POINTS = 5;

function number(value) { return typeof value === 'number' && Number.isFinite(value); }

// Solo para refresh-states anteriores a 2.6.0, que no declaraban `snapshot_id`.
// Nunca quitó el sufijo del identificador, así que su resultado no es fiable:
// existe para no romper un bundle viejo, no para confiar en él.
export function snapshotIdFromGasolinaRevision(revisionId) {
  if (typeof revisionId !== 'string' || !revisionId.startsWith('gasolina-') || revisionId.length === 'gasolina-'.length) throw new Error('Revisión gasolina inválida');
  return revisionId.slice('gasolina-'.length);
}

function productQuality(previous, candidate, key) {
  const reasons = [];
  const fresh = candidate?.fresh_0_30_days?.offers;
  const ready = candidate?.contract_ready?.offers;
  const districts = candidate?.contract_ready?.districts;
  const coverage = candidate?.coverage_percent;
  if (!Number.isInteger(fresh) || fresh < 1) reasons.push(`${key}: no hay ofertas frescas`);
  if (!Number.isInteger(ready) || ready < 1) reasons.push(`${key}: no hay ofertas publicables`);
  if (!Number.isInteger(districts) || districts < 1) reasons.push(`${key}: no hay distritos publicables`);
  if (!number(coverage) || coverage <= 0 || coverage > 100) reasons.push(`${key}: cobertura inválida`);
  if (candidate?.conflicts?.latest_price_conflicts !== 0) reasons.push(`${key}: conflictos de precio más reciente`);
  if (candidate?.conflicts?.latest_territory_conflicts !== 0) reasons.push(`${key}: conflictos territoriales más recientes`);
  const previousFresh = previous?.fresh_0_30_days?.offers;
  const previousCoverage = previous?.coverage_percent;
  if (Number.isInteger(previousFresh) && previousFresh > 0 && Number.isInteger(fresh) && fresh < previousFresh * (1 - MAX_OFFER_DROP)) reasons.push(`${key}: caída de ofertas frescas superior a 20%`);
  if (number(previousCoverage) && number(coverage) && coverage < previousCoverage - MAX_COVERAGE_DROP_POINTS) reasons.push(`${key}: caída de cobertura superior a 5 puntos`);
  return { status: reasons.length ? 'needs_review' : 'ready', reasons, previous: previous ?? null, candidate };
}

export function compareGasolinaQuality({ previousProducts = null, candidateProducts, previousSourceMaxReportedAt = null, candidateSourceMaxReportedAt, forcedReprojection = false }) {
  const products = Object.fromEntries(GASOLINA_KEYS.map((key) => [key, productQuality(previousProducts?.[key], candidateProducts?.[key], key)]));
  const reasons = GASOLINA_KEYS.flatMap((key) => products[key].reasons);
  if (!Number.isFinite(Date.parse(candidateSourceMaxReportedAt ?? ''))) reasons.push('máximo temporal del candidato inválido');
  // Este guardrail existe para no publicar una fuente que retrocedió. En una
  // reproyección forzada la fuente es idéntica por definición —lo que cambió es
  // el código o el catálogo—, así que exigir que avance impediría justo lo que
  // se pidió. Se omite solo esta comprobación; el resto sigue aplicando.
  const retrocede = previousSourceMaxReportedAt && Date.parse(candidateSourceMaxReportedAt) < Date.parse(previousSourceMaxReportedAt);
  const noAvanza = previousSourceMaxReportedAt && Date.parse(candidateSourceMaxReportedAt) === Date.parse(previousSourceMaxReportedAt);
  if (retrocede) reasons.push('el máximo temporal de la fuente retrocedió');
  if (noAvanza && !forcedReprojection) reasons.push('el máximo temporal de la fuente no avanzó');
  return { status: reasons.length ? 'needs_review' : 'ready', reasons, products, forced_reprojection: forcedReprojection, source_max_reported_at: { previous: previousSourceMaxReportedAt, candidate: candidateSourceMaxReportedAt } };
}
