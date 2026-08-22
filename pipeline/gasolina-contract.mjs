import crypto from 'node:crypto';

export const GASOLINA_MANIFEST_VERSION = '2.1.0';
export const LEGACY_GASOLINA_MANIFEST_VERSION = '2.0.0';
export const GASOLINA_SCOPE = Object.freeze({ department: 'LIMA', province: 'LIMA' });
export const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);
export const PUBLIC_OFFER_FIELDS = Object.freeze(['id', 'establishment_id', 'commercial_identity', 'price', 'reported_at', 'district', 'longitude', 'latitude']);
const PRODUCT_META = Object.freeze({ regular: Object.freeze({ canonical: 'GASOHOL REGULAR', label: 'Gasohol Regular' }), premium: Object.freeze({ canonical: 'GASOHOL PREMIUM', label: 'Gasohol Premium' }) });

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sameKeys = (value, keys) => value && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = (value) => typeof value === 'string' && value.length > 0;
const timestamp = (value) => text(value) && Number.isFinite(Date.parse(value));

export function validateGasolinaDataset(dataset) {
  const errors = [];
  const version = dataset?.schema_version;
  if (!sameKeys(dataset, ['schema_version', 'revision_id', 'product', 'scope', 'snapshot_date', 'cutoff_at', 'source_max_reported_at', 'provenance', 'offers'])) errors.push('campos del dataset gasolina inválidos');
  if (![LEGACY_GASOLINA_MANIFEST_VERSION, GASOLINA_MANIFEST_VERSION].includes(version) || !text(dataset?.revision_id)) errors.push('versión o revisión inválida');
  const expected = PRODUCT_META[dataset?.product?.key]; if (!expected || dataset?.product?.canonical !== expected.canonical || dataset?.product?.label !== expected.label || dataset?.product?.display_unit !== 'Galones') errors.push('producto inválido');
  if (JSON.stringify(dataset?.scope) !== JSON.stringify(GASOLINA_SCOPE)) errors.push('ámbito LIMA/LIMA inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset?.snapshot_date ?? '') || !timestamp(dataset?.cutoff_at) || !timestamp(dataset?.source_max_reported_at)) errors.push('corte inválido');
  if (!text(dataset?.provenance?.source_url) || !text(dataset?.provenance?.attribution)) errors.push('procedencia inválida');
  if (!Array.isArray(dataset?.offers)) errors.push('ofertas inválidas');
  for (const offer of dataset?.offers ?? []) {
    const expectedFields = version === LEGACY_GASOLINA_MANIFEST_VERSION ? ['id', 'price', 'reported_at', 'district', 'longitude', 'latitude'] : PUBLIC_OFFER_FIELDS;
    if (!sameKeys(offer, expectedFields)) { errors.push('allowlist de oferta inválida'); continue; }
    const identity = offer.commercial_identity;
    const identityValid = version === LEGACY_GASOLINA_MANIFEST_VERSION || (identity === null || (sameKeys(identity, ['brand', 'public_site_name']) && (identity.brand === null || text(identity.brand)) && (identity.public_site_name === null || text(identity.public_site_name)) && (identity.brand !== null || identity.public_site_name !== null)));
    if (!/^g2_[a-f0-9]{24}$/.test(offer.id) || (version !== LEGACY_GASOLINA_MANIFEST_VERSION && !/^est_[a-f0-9]{24}$/.test(offer.establishment_id)) || !identityValid || !Number.isFinite(offer.price) || offer.price <= 0 || !timestamp(offer.reported_at) || !text(offer.district) || !Number.isFinite(offer.longitude) || offer.longitude < -82 || offer.longitude > -68 || !Number.isFinite(offer.latitude) || offer.latitude < -19 || offer.latitude > 1) errors.push('valor de oferta inválido');
  }
  return errors;
}

export function validateGasolinaManifest(manifest) {
  const errors = [];
  if (!sameKeys(manifest, ['schema_version', 'revision_id', 'scope', 'products', 'generated_at'])) errors.push('campos del manifest gasolina inválidos');
  if (![LEGACY_GASOLINA_MANIFEST_VERSION, GASOLINA_MANIFEST_VERSION].includes(manifest?.schema_version) || !text(manifest?.revision_id)) errors.push('versión o revisión de manifest inválida');
  if (JSON.stringify(manifest?.scope) !== JSON.stringify(GASOLINA_SCOPE)) errors.push('ámbito de manifest inválido');
  if (!manifest?.products || JSON.stringify(Object.keys(manifest.products)) !== JSON.stringify(GASOLINA_KEYS)) errors.push('descriptores de producto inválidos');
  for (const key of GASOLINA_KEYS) {
    const item = manifest?.products?.[key];
    if (!sameKeys(item, ['canonical_product', 'label', 'dataset_url', 'bytes', 'sha256', 'cutoff_at'])) { errors.push(`descriptor ${key} inválido`); continue; }
    const expected = PRODUCT_META[key]; if (item.canonical_product !== expected.canonical || item.label !== expected.label || !new RegExp(`^data/gasolina/snapshots/[^/]+/${key}\\.json$`).test(item.dataset_url) || !Number.isInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256) || !timestamp(item.cutoff_at)) errors.push(`descriptor ${key} incompleto`);
  }
  return errors;
}

export function validateGasolinaRefreshState(state, manifest) {
  const errors = [];
  if (!sameKeys(state, ['schema_version', 'revision_id', 'validators', 'source_max_reported_at', 'products'])) errors.push('campos refresh-state inválidos');
  if (![LEGACY_GASOLINA_MANIFEST_VERSION, GASOLINA_MANIFEST_VERSION].includes(state?.schema_version) || (manifest?.schema_version && state?.schema_version !== manifest.schema_version) || state?.revision_id !== manifest?.revision_id) errors.push('revisión refresh-state inválida');
  if (!timestamp(state?.source_max_reported_at)) errors.push('máximo temporal refresh-state inválido');
  if (!state?.validators || !Object.hasOwn(state.validators, 'etag') || !Object.hasOwn(state.validators, 'last_modified')) errors.push('validadores refresh-state inválidos');
  if (JSON.stringify(Object.keys(state?.products ?? {})) !== JSON.stringify(GASOLINA_KEYS)) errors.push('productos refresh-state inválidos');
  for (const key of GASOLINA_KEYS) {
    const value = state?.products?.[key];
    const ready = value?.contract_ready;
    const fresh = value?.fresh_0_30_days;
    const conflicts = value?.conflicts;
    if (!value
      || !Number.isInteger(ready?.offers) || ready.offers < 1
      || !Number.isInteger(ready?.districts) || ready.districts < 1
      || !Number.isInteger(fresh?.offers) || fresh.offers < ready.offers
      || !Number.isInteger(fresh?.districts) || fresh.districts < ready.districts
      || !Number.isFinite(value.coverage_percent) || value.coverage_percent <= 0 || value.coverage_percent > 100
      || !conflicts
      || !Number.isInteger(conflicts.latest_price_conflicts) || conflicts.latest_price_conflicts < 0
      || !Number.isInteger(conflicts.latest_territory_conflicts) || conflicts.latest_territory_conflicts < 0
      || !timestamp(value.cutoff_at)) errors.push(`guardrails ${key} inválidos`);
  }
  return errors;
}

export function validateGasolinaBundle(manifest, key, body) {
  const errors = validateGasolinaManifest(manifest);
  const descriptor = manifest?.products?.[key];
  if (!descriptor) return [...errors, 'producto no declarado'];
  if (Buffer.byteLength(body) !== descriptor.bytes || sha256(body) !== descriptor.sha256) return [...errors, 'hash o bytes del snapshot no coinciden'];
  try {
    const dataset = JSON.parse(body); errors.push(...validateGasolinaDataset(dataset));
    if (dataset.schema_version !== manifest.schema_version || dataset.revision_id !== manifest.revision_id || dataset.product.key !== key || dataset.cutoff_at !== descriptor.cutoff_at) errors.push('snapshot no coincide con descriptor');
  } catch { errors.push('snapshot JSON inválido'); }
  return errors;
}
