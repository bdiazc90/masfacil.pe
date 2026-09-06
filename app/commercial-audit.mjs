import fs from 'node:fs';
import crypto from 'node:crypto';
import { BRAND_EVIDENCE_METHODS, CONFIDENCE_LEVELS, hasBrandEvidenceContract, isPublicCommercialEntry } from './commercial-catalog.mjs';

// v2: la auditoría deja de exigir una revisión por entrada y pasa a exigir una
// MUESTRA MEDIDA por tier. Revisar 614 identidades a mano no escala y tampoco
// aporta: lo que decide si un tier se publica no es corregirlas una por una,
// sino conocer su tasa de acierto con una cota estadística.
// v3: la auditoría deja de hablar de «la entrada» y pasa a hablar de la
// AFIRMACIÓN revisada. Un veredicto de nombre no acredita una bandera nueva, y
// añadir una marca no puede reutilizar la aprobación del nombre: cada veredicto
// lleva `claim` y su hash cubre solo los campos de esa afirmación.
export const AUDIT_SCHEMA_VERSION = '3.0.0';
// 2.0.0 sigue siendo válido mientras el secret en CI no se recargue: sus
// veredictos hablan solo del nombre y se comparan con la semántica de hash
// antigua. Sin veredictos de marca no hay grupo aprobado, así que tampoco logo.
export const LEGACY_AUDIT_SCHEMA_VERSION = '2.0.0';
export const AUDIT_SCHEMA_VERSIONS = Object.freeze([LEGACY_AUDIT_SCHEMA_VERSION, AUDIT_SCHEMA_VERSION]);
export const MIN_SAMPLE = 20;
// Con cero errores, 35 revisiones son las que llevan la cota de Wilson al 90 %.
// Un grupo más pequeño que eso se revisa entero.
export const BRAND_MIN_SAMPLE = 35;
export const BRAND_THRESHOLD = 0.90;
export const CLAIMS = Object.freeze(['name', 'brand']);

const legacyTop = ['schema_version', 'audit_id', 'catalog_id', 'tiers', 'entries'];
const top = [...legacyTop, 'brand_tiers'];
const tierKeys = ['confidence', 'population', 'sampled', 'correct', 'lower_bound_95', 'threshold', 'reviewer', 'reviewed_at'];
const brandTierKeys = ['method', 'population', 'sampled', 'correct', 'lower_bound_95', 'threshold', 'reviewer', 'reviewed_at'];
const legacyEntry = ['establishment_id', 'entry_sha256', 'confidence', 'selection_reason', 'reviewer', 'reviewed_at', 'result'];
const entry = [...legacyEntry, 'claim'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const iso = (value) => text(value) && Number.isFinite(Date.parse(value));
const ratio = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

export function canonicalizeCommercialEntry(value) { if (Array.isArray(value)) return value.map(canonicalizeCommercialEntry); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeCommercialEntry(value[key])])); return value; }
export function commercialEntrySha256(value) { return crypto.createHash('sha256').update(JSON.stringify(canonicalizeCommercialEntry(value))).digest('hex'); }

// El hash cubre exactamente lo revisado. Así, incorporar una marca no hereda el
// veredicto del nombre, y corregir un nombre no invalida una bandera aprobada.
const CLAIM_FIELDS = Object.freeze({
  name: ['establishment_id', 'public_site_name', 'confidence'],
  brand: ['establishment_id', 'brand', 'brand_evidence'],
});
export function commercialClaimSha256(entryValue, claim) {
  const fields = CLAIM_FIELDS[claim];
  if (!fields) throw new Error(`Afirmación desconocida: ${claim}`);
  return commercialEntrySha256(Object.fromEntries(fields.map((field) => [field, entryValue?.[field] ?? null])));
}

/** Cota inferior de Wilson: el peor caso razonable dado el tamaño de muestra. */
export function wilsonLowerBound(correct, sampled, z = 1.96) {
  if (!Number.isInteger(sampled) || sampled < 1) return 0;
  const p = correct / sampled;
  const denominador = 1 + (z * z) / sampled;
  const centro = p + (z * z) / (2 * sampled);
  const margen = z * Math.sqrt((p * (1 - p)) / sampled + (z * z) / (4 * sampled * sampled));
  return Math.max(0, (centro - margen) / denominador);
}

export function validateCommercialAudit(audit) {
  const errors = [];
  const conMarca = audit?.schema_version === AUDIT_SCHEMA_VERSION;
  if (!exact(audit, conMarca ? top : legacyTop)) errors.push('audit: campos inesperados o ausentes');
  if (!AUDIT_SCHEMA_VERSIONS.includes(audit?.schema_version)) errors.push('audit.schema_version: fuera del contrato');
  if (!/^commercial-identity-audit-[a-z0-9.-]+$/.test(audit?.audit_id ?? '')) errors.push('audit.audit_id: formato inválido');
  if (!/^commercial-identity-catalog-[a-z0-9.-]+$/.test(audit?.catalog_id ?? '')) errors.push('audit.catalog_id: formato inválido');

  if (!Array.isArray(audit?.tiers)) errors.push('audit.tiers: debe ser arreglo');
  else {
    const vistos = new Set();
    for (const [index, tier] of audit.tiers.entries()) {
      const at = `audit.tiers[${index}]`;
      if (!exact(tier, tierKeys)) { errors.push(`${at}: campos inesperados o ausentes`); continue; }
      if (!CONFIDENCE_LEVELS.includes(tier.confidence)) errors.push(`${at}.confidence: fuera del catálogo`);
      if (vistos.has(tier.confidence)) errors.push(`${at}.confidence: duplicado`); vistos.add(tier.confidence);
      if (!Number.isInteger(tier.population) || tier.population < 1) errors.push(`${at}.population: inválida`);
      if (!Number.isInteger(tier.sampled) || tier.sampled < MIN_SAMPLE) errors.push(`${at}.sampled: se exigen al menos ${MIN_SAMPLE} revisiones`);
      if (!Number.isInteger(tier.correct) || tier.correct < 0 || tier.correct > tier.sampled) errors.push(`${at}.correct: fuera de rango`);
      if (tier.sampled > tier.population) errors.push(`${at}: la muestra no puede superar la población`);
      if (!ratio(tier.lower_bound_95) || !ratio(tier.threshold)) errors.push(`${at}: cota o umbral fuera de [0,1]`);
      // La cota se recalcula: no se acepta la que venga escrita en el archivo.
      const esperada = wilsonLowerBound(tier.correct, tier.sampled);
      if (Math.abs(esperada - tier.lower_bound_95) > 0.001) errors.push(`${at}.lower_bound_95: no coincide con ${esperada.toFixed(3)}`);
      if (!text(tier.reviewer) || !iso(tier.reviewed_at)) errors.push(`${at}: reviewer o fecha inválidos`);
    }
  }

  if (conMarca && !Array.isArray(audit?.brand_tiers)) errors.push('audit.brand_tiers: debe ser arreglo');
  else if (conMarca) {
    const vistos = new Set();
    for (const [index, tier] of audit.brand_tiers.entries()) {
      const at = `audit.brand_tiers[${index}]`;
      if (!exact(tier, brandTierKeys)) { errors.push(`${at}: campos inesperados o ausentes`); continue; }
      if (!BRAND_EVIDENCE_METHODS.includes(tier.method)) errors.push(`${at}.method: fuera del catálogo`);
      if (vistos.has(tier.method)) errors.push(`${at}.method: duplicado`); vistos.add(tier.method);
      if (!Number.isInteger(tier.population) || tier.population < 1) errors.push(`${at}.population: inválida`);
      if (!Number.isInteger(tier.sampled) || tier.sampled < Math.min(BRAND_MIN_SAMPLE, tier.population ?? 0)) errors.push(`${at}.sampled: se exigen ${BRAND_MIN_SAMPLE} revisiones, o el grupo entero si es menor`);
      if (!Number.isInteger(tier.correct) || tier.correct < 0 || tier.correct > tier.sampled) errors.push(`${at}.correct: fuera de rango`);
      if (tier.sampled > tier.population) errors.push(`${at}: la muestra no puede superar la población`);
      if (!ratio(tier.lower_bound_95) || tier.threshold !== BRAND_THRESHOLD) errors.push(`${at}: cota fuera de [0,1] o umbral distinto de ${BRAND_THRESHOLD}`);
      const esperada = wilsonLowerBound(tier.correct, tier.sampled);
      if (Math.abs(esperada - tier.lower_bound_95) > 0.001) errors.push(`${at}.lower_bound_95: no coincide con ${esperada.toFixed(3)}`);
      if (!text(tier.reviewer) || !iso(tier.reviewed_at)) errors.push(`${at}: reviewer o fecha inválidos`);
    }
  }

  if (!Array.isArray(audit?.entries)) { errors.push('audit.entries: debe ser arreglo'); return [...new Set(errors)]; }
  const seen = new Set();
  for (const [index, value] of audit.entries.entries()) {
    const at = `audit.entries[${index}]`;
    if (!exact(value, conMarca ? entry : legacyEntry)) { errors.push(`${at}: campos inesperados o ausentes`); continue; }
    if (!/^est_[a-f0-9]{24}$/.test(value.establishment_id ?? '')) errors.push(`${at}.establishment_id: formato inválido`);
    if (!/^[a-f0-9]{64}$/.test(value.entry_sha256 ?? '')) errors.push(`${at}.entry_sha256: hash inválido`);
    if (conMarca && !CLAIMS.includes(value.claim)) errors.push(`${at}.claim: fuera del catálogo`);
    // Una misma identidad puede tener un veredicto de nombre y otro de marca:
    // lo que no puede repetirse es la pareja.
    const clave = `${value.establishment_id}|${value.claim ?? 'name'}`;
    if (seen.has(clave)) errors.push(`${at}: veredicto duplicado para esa afirmación`); seen.add(clave);
    if (!CONFIDENCE_LEVELS.includes(value.confidence)) errors.push(`${at}.confidence: fuera del catálogo`);
    if (!['publishable_candidate', 'random_sample', 'risk_sample'].includes(value.selection_reason)) errors.push(`${at}.selection_reason: fuera del catálogo`);
    if (!text(value.reviewer) || !iso(value.reviewed_at) || !['verified', 'incorrect', 'pending'].includes(value.result)) errors.push(`${at}: reviewer, fecha o resultado inválido`);
  }
  return [...new Set(errors)];
}

export function loadValidatedCommercialAudit(path) { const audit = JSON.parse(fs.readFileSync(path, 'utf8')); const errors = validateCommercialAudit(audit); if (errors.length) throw new Error(`Auditoría comercial fuera de contrato:\n- ${errors.join('\n- ')}`); return audit; }

export function commercialPublicationCheck(catalog, audit) {
  const targets = catalog.entries.filter(isPublicCommercialEntry);
  const resumen = { required: targets.length, tiers: 0, sampled: 0, incorrect_links: null };
  if (!targets.length) return Object.freeze({ status: 'not_required', reason: 'catalog_empty_or_pending', ...resumen });
  if (!audit || audit.catalog_id !== catalog.catalog_id) return Object.freeze({ status: 'pending', reason: 'audit_missing_or_catalog_mismatch', ...resumen });

  const porTier = new Map(audit.tiers.map((tier) => [tier.confidence, tier]));
  const poblaciones = new Map();
  // Solo las entradas que publican NOMBRE entran en la población del tier de
  // nombre: una entrada que solo publica bandera no tiene nombre que medir.
  for (const target of targets) if (target.public_site_name) poblaciones.set(target.confidence, (poblaciones.get(target.confidence) ?? 0) + 1);

  const base = { ...resumen, tiers: poblaciones.size, sampled: audit.entries.length };
  // Un catálogo con contrato de evidencia de marca exige una auditoría que sepa
  // hablar de afirmaciones: mezclarlos compararía hashes de semánticas distintas.
  const legado = audit.schema_version === LEGACY_AUDIT_SCHEMA_VERSION;
  if (legado && hasBrandEvidenceContract(catalog)) return Object.freeze({ status: 'pending', reason: 'audit_schema_behind_catalog', ...base });
  const soloNombre = audit.entries.filter((row) => (row.claim ?? 'name') === 'name');
  const hashDeNombre = legado ? (target) => commercialEntrySha256(target) : (target) => commercialClaimSha256(target, 'name');
  for (const [confidence, poblacion] of poblaciones) {
    const tier = porTier.get(confidence);
    if (!tier) return Object.freeze({ status: 'pending', reason: `audit_missing_tier_${confidence}`, ...base });
    if (tier.population !== poblacion) return Object.freeze({ status: 'pending', reason: `audit_population_mismatch_${confidence}`, ...base });
    if (tier.lower_bound_95 < tier.threshold) return Object.freeze({ status: 'pending', reason: `audit_below_threshold_${confidence}`, ...base });
  }

  // Cada entrada revisada debe seguir describiendo lo mismo que se revisó: si el
  // catálogo cambió, su hash deja de coincidir y la auditoría queda obsoleta.
  const porAnchor = new Map(catalog.entries.map((item) => [item.establishment_id, item]));
  const revisadas = soloNombre.map((row) => ({ row, target: porAnchor.get(row.establishment_id) }));
  const huerfanas = revisadas.filter(({ target }) => !target);
  if (huerfanas.length) return Object.freeze({ status: 'pending', reason: 'audit_entry_outside_catalog', ...base });
  const rancias = revisadas.filter(({ row, target }) => hashDeNombre(target) !== row.entry_sha256);
  if (rancias.length) return Object.freeze({ status: 'pending', reason: 'audit_stale', ...base, incorrect_links: 0 });
  const incorrectas = revisadas.filter(({ row }) => row.result === 'incorrect');
  const pendientes = revisadas.filter(({ row }) => row.result === 'pending');
  if (pendientes.length) return Object.freeze({ status: 'pending', reason: 'audit_pending', ...base, incorrect_links: incorrectas.length });

  return Object.freeze({ status: 'ready', reason: 'all_tiers_sampled_and_above_threshold', ...base, incorrect_links: incorrectas.length });
}

// Qué grupos de bandera pueden salir con logo. Cada método se decide solo: un
// grupo por debajo del umbral no arrastra a los demás, y su marca se sigue
// publicando como texto —solo pierde el logo—, sin bloquear la proyección.
export function brandAccreditationGroups(catalog, audit) {
  const grupos = new Map();
  for (const item of catalog.entries) {
    if (!isPublicCommercialEntry(item) || !item.brand || !item.brand_evidence) continue;
    const actual = grupos.get(item.brand_evidence.method) ?? { method: item.brand_evidence.method, population: 0, sampled: 0, status: 'pending', reason: 'audit_missing_brand_tier' };
    actual.population += 1;
    grupos.set(actual.method, actual);
  }
  if (!grupos.size) return Object.freeze({ approved: new Set(), groups: [] });
  const porMetodo = new Map((audit?.brand_tiers ?? []).map((tier) => [tier.method, tier]));
  const porAnchor = new Map(catalog.entries.map((item) => [item.establishment_id, item]));
  const veredictos = (audit?.entries ?? []).filter((row) => row.claim === 'brand');
  const approved = new Set();
  for (const grupo of grupos.values()) {
    const tier = porMetodo.get(grupo.method);
    if (!audit || audit.catalog_id !== catalog.catalog_id) { grupo.reason = 'audit_missing_or_catalog_mismatch'; continue; }
    if (!tier) continue;
    grupo.sampled = tier.sampled;
    if (tier.population !== grupo.population) { grupo.reason = 'brand_population_mismatch'; continue; }
    if (tier.lower_bound_95 < tier.threshold) { grupo.reason = 'brand_below_threshold'; continue; }
    const delGrupo = veredictos.filter((row) => porAnchor.get(row.establishment_id)?.brand_evidence?.method === grupo.method);
    if (delGrupo.length !== tier.sampled) { grupo.reason = 'brand_sample_mismatch'; continue; }
    // El hash cubre solo la afirmación de marca: si la bandera o su evidencia
    // cambiaron, el veredicto deja de valer y el grupo vuelve a pendiente.
    if (delGrupo.some((row) => commercialClaimSha256(porAnchor.get(row.establishment_id), 'brand') !== row.entry_sha256)) { grupo.reason = 'brand_audit_stale'; continue; }
    if (delGrupo.some((row) => row.result === 'pending')) { grupo.reason = 'brand_audit_pending'; continue; }
    grupo.status = 'approved';
    grupo.reason = 'brand_sample_above_threshold';
    approved.add(grupo.method);
  }
  return Object.freeze({ approved, groups: [...grupos.values()].map((grupo) => Object.freeze({ ...grupo })) });
}

export function assertCommercialPublicationReady(catalog, audit) {
  const check = commercialPublicationCheck(catalog, audit);
  if (check.status === 'ready' || check.status === 'not_required') return check;
  throw new Error(`Auditoría comercial impide proyectar (${check.reason})`);
}

export function auditCommercialCatalog(catalog, audit) { return commercialPublicationCheck(catalog, audit); }
