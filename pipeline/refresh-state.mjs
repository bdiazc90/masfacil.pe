const SHA256 = /^[a-f0-9]{64}$/;
const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);
const MAX_OFFER_DROP = 0.2;
const MAX_COVERAGE_DROP_POINTS = 5;
const EXCEPTIONS = Object.freeze(['latest_price_conflicts', 'latest_territory_conflicts', 'registry_ambiguous_after_freshness', 'registry_territory_mismatch_after_exact_join', 'gis_ambiguous_after_registry', 'gis_unsafe_coordinate_after_exact_join', 'gis_territory_mismatch_after_exact_join', 'missing_or_ambiguous_provisional_identity']);
const fields = Object.freeze(['schema_version', 'snapshot_id', 'source_id', 'validators', 'guardrails']);

function exactKeys(value, expected) { return value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()); }
function number(value) { return typeof value === 'number' && Number.isFinite(value); }
function nullableString(value) { return value === null || typeof value === 'string'; }

export function buildRefreshState(pointer, evidence) {
  const metrics = evidence?.metrics;
  return {
    schema_version: 1,
    snapshot_id: pointer.snapshot_id,
    source_id: pointer.source_id,
    validators: { etag: pointer.validators?.etag ?? null, last_modified: pointer.validators?.last_modified ?? null },
    guardrails: {
      fresh_offers: metrics?.funnel?.within_30_days?.offers,
      contract_ready: metrics?.funnel?.contract_ready_with_provisional_identity?.offers,
      coverage_percent: metrics?.coverage?.offers?.percent,
      source_max_reported_at: evidence?.temporal_semantics?.values?.source_max_reported_at,
      exceptions: Object.fromEntries(EXCEPTIONS.map((key) => [key, metrics?.exceptions?.[key]])),
    },
  };
}

export function validateRefreshState(state, manifest) {
  const errors = [];
  if (!exactKeys(state, fields) || state?.schema_version !== 1 || state?.snapshot_id !== manifest?.snapshot_id || state?.source_id !== 'liquid-current') errors.push('refresh-state: identidad inválida');
  if (!exactKeys(state?.validators, ['etag', 'last_modified']) || !nullableString(state?.validators?.etag) || !nullableString(state?.validators?.last_modified) || (!state?.validators?.etag && !state?.validators?.last_modified)) errors.push('refresh-state: validadores inválidos');
  const guardrails = state?.guardrails;
  if (!exactKeys(guardrails, ['fresh_offers', 'contract_ready', 'coverage_percent', 'source_max_reported_at', 'exceptions']) || !number(guardrails?.fresh_offers) || !number(guardrails?.contract_ready) || !number(guardrails?.coverage_percent) || !Number.isFinite(Date.parse(guardrails?.source_max_reported_at ?? '')) || !exactKeys(guardrails?.exceptions, EXCEPTIONS)) errors.push('refresh-state: guardrails inválidos');
  for (const key of EXCEPTIONS) if (!number(guardrails?.exceptions?.[key])) errors.push(`refresh-state: excepción inválida ${key}`);
  return errors;
}

export function evidenceFromRefreshState(state) {
  return { metrics: { funnel: { within_30_days: { offers: state.guardrails.fresh_offers }, contract_ready_with_provisional_identity: { offers: state.guardrails.contract_ready } }, coverage: { offers: { percent: state.guardrails.coverage_percent } }, exceptions: state.guardrails.exceptions }, temporal_semantics: { values: { source_max_reported_at: state.guardrails.source_max_reported_at } } };
}

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
