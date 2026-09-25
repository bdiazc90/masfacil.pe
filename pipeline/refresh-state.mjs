import { GROUP_CONFIG, configuredGroup } from './groups.mjs';

function number(value) { return typeof value === 'number' && Number.isFinite(value); }

// Solo para refresh-states anteriores a 2.6.0, que no declaraban `snapshot_id`.
// Nunca quitó el sufijo del identificador, así que su resultado no es fiable:
// existe para no romper un bundle viejo, no para confiar en él.
export function snapshotIdFromGasolinaRevision(revisionId) {
  if (typeof revisionId !== 'string' || !revisionId.startsWith('gasolina-') || revisionId.length === 'gasolina-'.length) throw new Error('Revisión gasolina inválida');
  return revisionId.slice('gasolina-'.length);
}

function productQuality(previous, candidate, key, { maxOfferDrop, maxCoverageDropPoints }) {
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
  if (Number.isInteger(previousFresh) && previousFresh > 0 && Number.isInteger(fresh) && fresh < previousFresh * (1 - maxOfferDrop)) reasons.push(`${key}: caída de ofertas frescas superior a ${Math.round(maxOfferDrop * 100)}%`);
  if (number(previousCoverage) && number(coverage) && coverage < previousCoverage - maxCoverageDropPoints) reasons.push(`${key}: caída de cobertura superior a ${maxCoverageDropPoints} puntos`);
  return { status: reasons.length ? 'needs_review' : 'ready', reasons, previous: previous ?? null, candidate };
}

/**
 * ¿La versión candidata de un grupo se puede publicar frente a la anterior?
 *
 * Cada grupo se compara solo consigo mismo y con sus tolerancias. Sin versión
 * publicada, un grupo con `firstActivation` se compara con la base auditada
 * antes de activarlo: las mismas caídas máximas, ningún distrito perdido más
 * allá de lo declarado y una fuente que no sea anterior a la auditada —igual no
 * hace falta que avance: la auditoría y la activación pueden usar el mismo CSV—.
 */
export function compareGroupQuality({ group, previousProducts = null, candidateProducts, previousSourceMaxReportedAt = null, candidateSourceMaxReportedAt, forcedReprojection = false }) {
  const keys = configuredGroup(group).products;
  const guardrails = GROUP_CONFIG[group].guardrails;
  const primera = !previousProducts && guardrails.firstActivation ? guardrails.firstActivation : null;
  const previos = previousProducts ?? primera?.audited.products ?? null;
  const products = Object.fromEntries(keys.map((key) => [key, productQuality(previos?.[key], candidateProducts?.[key], key, guardrails)]));
  const reasons = keys.flatMap((key) => products[key].reasons);
  if (!Number.isFinite(Date.parse(candidateSourceMaxReportedAt ?? ''))) reasons.push('máximo temporal del candidato inválido');
  if (primera) {
    if (Date.parse(candidateSourceMaxReportedAt) < Date.parse(primera.audited.source_max_reported_at)) reasons.push('la fuente es anterior a la base auditada');
    for (const key of keys) {
      const minimo = primera.audited.products[key].published.districts - primera.maxDistrictLoss;
      const distritos = candidateProducts?.[key]?.published?.districts;
      if (!Number.isInteger(distritos) || distritos < minimo) reasons.push(`${key}: pierde más de ${primera.maxDistrictLoss} distritos frente a la base auditada`);
    }
    return { status: reasons.length ? 'needs_review' : 'ready', reasons, products, forced_reprojection: forcedReprojection, first_activation: true, source_max_reported_at: { previous: primera.audited.source_max_reported_at, candidate: candidateSourceMaxReportedAt } };
  }
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

export const compareGasolinaQuality = (entrada) => compareGroupQuality({ ...entrada, group: 'gasolina' });
