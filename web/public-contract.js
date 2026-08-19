const PUBLIC_ID = /^pub_[a-f0-9]{24}$/;
const SNAPSHOT = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...names].sort());
const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validateManifest(value) {
  if (!keys(value, ['schema_version', 'snapshot_id', 'dataset_url', 'sha256', 'bytes', 'cutoff_at', 'generated_at'])) return false;
  return value.schema_version === '1.0.0' && SNAPSHOT.test(value.snapshot_id) && value.dataset_url === `data/snapshots/${value.snapshot_id}.json` && HASH.test(value.sha256) && Number.isInteger(value.bytes) && value.bytes > 0 && time(value.cutoff_at) && time(value.generated_at);
}
export function validateDataset(value) {
  if (!keys(value, ['schema_version', 'snapshot_id', 'dataset_id', 'product', 'display_unit', 'snapshot_date', 'cutoff_at', 'source_max_reported_at', 'provenance', 'offers'])) return false;
  if (value.schema_version !== '1.0.0' || !SNAPSHOT.test(value.snapshot_id) || value.product !== 'Gasohol Regular' || value.display_unit !== 'S/ por galón' || !time(value.cutoff_at) || !Array.isArray(value.offers) || !value.offers.length) return false;
  const provenance = value.provenance;
  if (!keys(provenance, ['source', 'source_dataset', 'source_url', 'attribution']) || provenance.source !== 'Osinergmin' || provenance.source_dataset !== 'liquid-current' || !/^https:\/\//.test(provenance.source_url) || provenance.attribution !== 'Datos de precios y coordenadas: Osinergmin.') return false;
  return value.offers.every((offer) => keys(offer, ['id', 'price', 'reported_at', 'district', 'longitude', 'latitude']) && PUBLIC_ID.test(offer.id) && Number.isFinite(offer.price) && offer.price > 0 && time(offer.reported_at) && typeof offer.district === 'string' && offer.district.trim() && Number.isFinite(offer.longitude) && offer.longitude >= -82 && offer.longitude <= -68 && Number.isFinite(offer.latitude) && offer.latitude >= -19 && offer.latitude <= 1);
}
export async function validBundle(manifest, body) {
  if (!validateManifest(manifest) || new TextEncoder().encode(body).byteLength !== manifest.bytes) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  try { const dataset = JSON.parse(body); return hash === manifest.sha256 && validateDataset(dataset) && dataset.snapshot_id === manifest.snapshot_id && dataset.cutoff_at === manifest.cutoff_at; } catch { return false; }
}
