import fs from 'node:fs';
import { OFFICIAL_ANCHOR_SCHEME } from './official-anchor.mjs';

const TOP_LEVEL_KEYS = ['schema_version', 'overlay_id', 'official_dataset_id', 'anchor_scheme', 'entries'];
const ENTRY_KEYS = ['official_anchor', 'brand', 'public_site_name', 'source', 'observed_at', 'source_last_modified_at', 'discovery_method', 'integration_method', 'identity_freshness', 'verification_status', 'publication_status'];
const SOURCE_KEYS = ['kind', 'url'];
export const PROJECTION_POLICIES = Object.freeze(['public_safe', 'private_preview']);

const clean = (value) => String(value ?? '').trim();
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function resolveDefinition(definition, schema) {
  if (!definition?.$ref) return definition;
  const name = definition.$ref.match(/^#\/\$defs\/(.+)$/)?.[1];
  return name ? schema.$defs?.[name] : undefined;
}

function validateShape(value, definition, location, errors, schema) {
  const resolved = resolveDefinition(definition, schema);
  if (!resolved) {
    errors.push(`${location}: referencia de schema desconocida`);
    return;
  }
  if (resolved.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${location}: debe ser objeto`);
      return;
    }
    if (resolved.additionalProperties === false) {
      const allowed = Object.keys(resolved.properties ?? {});
      if (!exactKeys(value, allowed)) errors.push(`${location}: campos inesperados o ausentes`);
    }
    for (const required of resolved.required ?? []) if (!Object.hasOwn(value, required)) errors.push(`${location}.${required}: requerido`);
    for (const [key, child] of Object.entries(resolved.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateShape(value[key], child, `${location}.${key}`, errors, schema);
    }
  }
  if (resolved.type === 'array') {
    if (!Array.isArray(value)) errors.push(`${location}: debe ser arreglo`);
    else value.forEach((item, index) => validateShape(item, resolved.items, `${location}[${index}]`, errors, schema));
  }
  if (Array.isArray(resolved.type)) {
    const valid = resolved.type.some((type) => (type === 'null' ? value === null : type === 'string' ? typeof value === 'string' : false));
    if (!valid) errors.push(`${location}: tipo inválido`);
  }
  if (resolved.type === 'string' && typeof value !== 'string') errors.push(`${location}: debe ser texto`);
  if (Object.hasOwn(resolved, 'const') && JSON.stringify(value) !== JSON.stringify(resolved.const)) errors.push(`${location}: valor fuera del contrato`);
  if (resolved.enum && !resolved.enum.includes(value)) errors.push(`${location}: valor fuera del catálogo`);
  if (resolved.pattern && typeof value === 'string' && !(new RegExp(resolved.pattern).test(value))) errors.push(`${location}: formato inválido`);
  if (resolved.minLength && typeof value === 'string' && value.length < resolved.minLength) errors.push(`${location}: texto vacío`);
  if (resolved.format === 'date-time' && value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) errors.push(`${location}: fecha/hora inválida`);
  if (resolved.format === 'uri' && typeof value === 'string') {
    try { new URL(value); } catch { errors.push(`${location}: URI inválida`); }
  }
}

export function validateCommercialOverlay(overlay, schema) {
  const errors = [];
  validateShape(overlay, schema, 'overlay', errors, schema);
  if (!exactKeys(overlay, TOP_LEVEL_KEYS)) return [...new Set(errors)];
  if (!Array.isArray(overlay.entries)) return [...new Set(errors)];

  const seen = new Map();
  for (const [index, entry] of overlay.entries.entries()) {
    if (!exactKeys(entry, ENTRY_KEYS)) continue;
    const prefix = `overlay.entries[${index}]`;
    if (!clean(entry.brand)) errors.push(`${prefix}.brand: texto significativo requerido`);
    if (!clean(entry.public_site_name)) errors.push(`${prefix}.public_site_name: texto significativo requerido`);
    if (!exactKeys(entry.source, SOURCE_KEYS)) continue;
    const prior = seen.get(entry.official_anchor);
    if (prior) {
      const sameIdentity = prior.brand === entry.brand && prior.public_site_name === entry.public_site_name;
      errors.push(`${prefix}.official_anchor: ${sameIdentity ? 'duplicado' : 'conflicto'} para ${entry.official_anchor}`);
    } else seen.set(entry.official_anchor, entry);
  }
  return [...new Set(errors)];
}

export function loadValidatedCommercialOverlay(overlayPath, schemaPath) {
  let overlay;
  let schema;
  try {
    overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer el overlay comercial o su contrato: ${error.message}`);
  }
  const errors = validateCommercialOverlay(overlay, schema);
  if (errors.length) throw new Error(`Overlay comercial fuera del contrato Gate 2.1:\n- ${errors.join('\n- ')}`);
  return overlay;
}

export function emptyCommercialOverlay(officialDatasetId) {
  return {
    schema_version: '1.1.0',
    overlay_id: 'commercial-identity-overlay-empty',
    official_dataset_id: officialDatasetId,
    anchor_scheme: OFFICIAL_ANCHOR_SCHEME,
    entries: [],
  };
}

export function buildCommercialIdentityIndex(dataset, overlay, { projectionPolicy = 'public_safe' } = {}) {
  if (!PROJECTION_POLICIES.includes(projectionPolicy)) throw new Error(`Política de proyección desconocida: ${projectionPolicy}`);
  if (overlay.official_dataset_id !== dataset.dataset_id) {
    throw new Error(`Overlay comercial apunta a ${overlay.official_dataset_id}, no a ${dataset.dataset_id}`);
  }
  const officialAnchors = new Set(dataset.offers.map((offer) => offer.establishment_id));
  const seen = new Set();
  for (const entry of overlay.entries) {
    if (seen.has(entry.official_anchor)) throw new Error(`Overlay comercial contiene anchor duplicado o conflictivo: ${entry.official_anchor}`);
    seen.add(entry.official_anchor);
  }
  const unknown = overlay.entries.filter((entry) => !officialAnchors.has(entry.official_anchor)).map((entry) => entry.official_anchor);
  if (unknown.length) throw new Error(`Overlay comercial contiene anchors sin entidad oficial: ${unknown.join(', ')}`);

  const byAnchor = new Map();
  for (const entry of overlay.entries) {
    const publicSafe = entry.verification_status === 'verified'
      && entry.identity_freshness === 'current'
      && entry.publication_status === 'publishable';
    const privatePreview = entry.verification_status === 'verified'
      && entry.publication_status !== 'not_publishable';
    if (projectionPolicy === 'public_safe' ? publicSafe : privatePreview) {
      byAnchor.set(entry.official_anchor, Object.freeze({ brand: entry.brand, public_site_name: entry.public_site_name }));
    }
  }
  return {
    byAnchor,
    metrics: Object.freeze({
      entries: overlay.entries.length,
      matched: overlay.entries.length,
      projected: byAnchor.size,
      suppressed: overlay.entries.length - byAnchor.size,
      projection_policy: projectionPolicy,
    }),
  };
}
