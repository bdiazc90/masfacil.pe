export const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);
const offerFields = ['id', 'price', 'reported_at', 'district', 'longitude', 'latitude'];
const same = (value, fields) => value && !Array.isArray(value) && JSON.stringify(Object.keys(value)) === JSON.stringify(fields);
const text = (value) => typeof value === 'string' && value.length > 0;

export function validateGasolinaManifest(manifest) {
  if (!same(manifest, ['schema_version', 'revision_id', 'scope', 'products', 'generated_at']) || manifest.schema_version !== '2.0.0' || !text(manifest.revision_id) || manifest.scope?.department !== 'LIMA' || manifest.scope?.province !== 'LIMA' || JSON.stringify(Object.keys(manifest.products ?? {})) !== JSON.stringify(GASOLINA_KEYS)) return false;
  return GASOLINA_KEYS.every((key) => { const item = manifest.products[key]; return same(item, ['canonical_product', 'label', 'dataset_url', 'bytes', 'sha256', 'cutoff_at']) && /^data\/gasolina\/snapshots\/[^/]+\/(regular|premium)\.json$/.test(item.dataset_url) && Number.isInteger(item.bytes) && /^[a-f0-9]{64}$/.test(item.sha256); });
}
export function validateGasolinaDataset(dataset, key, revision) {
  return same(dataset, ['schema_version', 'revision_id', 'product', 'scope', 'snapshot_date', 'cutoff_at', 'source_max_reported_at', 'provenance', 'offers']) && dataset.schema_version === '2.0.0' && dataset.revision_id === revision && dataset.product?.key === key && dataset.product?.display_unit === 'Galones' && dataset.scope?.department === 'LIMA' && dataset.scope?.province === 'LIMA' && Array.isArray(dataset.offers) && dataset.offers.every((offer) => same(offer, offerFields) && /^g2_[a-f0-9]{24}$/.test(offer.id) && Number.isFinite(offer.price) && text(offer.reported_at) && text(offer.district) && Number.isFinite(offer.longitude) && Number.isFinite(offer.latitude));
}
export async function validGasolinaBundle(manifest, key, body) {
  const descriptor = manifest.products?.[key]; if (!validateGasolinaManifest(manifest) || !descriptor || new TextEncoder().encode(body).length !== descriptor.bytes) return false;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== descriptor.sha256) return false;
  try { const dataset = JSON.parse(body); return dataset.cutoff_at === descriptor.cutoff_at && validateGasolinaDataset(dataset, key, manifest.revision_id); } catch { return false; }
}
