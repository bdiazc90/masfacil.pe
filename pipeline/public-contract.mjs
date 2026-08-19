import crypto from 'node:crypto';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_SNAPSHOT = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9-]+$/;
const PUBLIC_ID = /^pub_[a-f0-9]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const PUBLIC_OFFER_FIELDS = Object.freeze(['id', 'price', 'reported_at', 'district', 'longitude', 'latitude']);

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validTime(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validCoordinate(offer) {
  return Number.isFinite(offer.longitude) && offer.longitude >= -82 && offer.longitude <= -68
    && Number.isFinite(offer.latitude) && offer.latitude >= -19 && offer.latitude <= 1;
}

export function validatePublicDataset(dataset) {
  const errors = [];
  const fields = ['schema_version', 'snapshot_id', 'dataset_id', 'product', 'display_unit', 'snapshot_date', 'cutoff_at', 'source_max_reported_at', 'provenance', 'offers'];
  if (!exactKeys(dataset, fields)) errors.push('dataset: campos inesperados o ausentes');
  if (dataset?.schema_version !== '1.0.0') errors.push('dataset.schema_version: fuera del contrato');
  if (!ISO_SNAPSHOT.test(dataset?.snapshot_id ?? '')) errors.push('dataset.snapshot_id: inválido');
  if (!/^public-gasohol-regular-lima-\d{4}-\d{2}-\d{2}$/.test(dataset?.dataset_id ?? '')) errors.push('dataset.dataset_id: inválido');
  if (dataset?.product !== 'Gasohol Regular' || dataset?.display_unit !== 'S/ por galón') errors.push('dataset: producto o unidad fuera del contrato');
  if (!ISO_DATE.test(dataset?.snapshot_date ?? '') || !validTime(dataset?.cutoff_at) || !validTime(dataset?.source_max_reported_at)) errors.push('dataset: contexto temporal inválido');
  const provenance = dataset?.provenance;
  if (!exactKeys(provenance, ['source', 'source_dataset', 'source_url', 'attribution']) || provenance.source !== 'Osinergmin' || provenance.source_dataset !== 'liquid-current' || !validTime(dataset?.cutoff_at) || !/^https:\/\//.test(provenance.source_url ?? '') || provenance.attribution !== 'Datos de precios y coordenadas: Osinergmin.') errors.push('dataset.provenance: inválida');
  if (!Array.isArray(dataset?.offers) || dataset.offers.length === 0) errors.push('dataset.offers: no puede estar vacío');
  const seen = new Set();
  for (const [index, offer] of (dataset?.offers ?? []).entries()) {
    if (!exactKeys(offer, PUBLIC_OFFER_FIELDS)) errors.push(`dataset.offers[${index}]: allowlist inválida`);
    if (!PUBLIC_ID.test(offer?.id ?? '') || seen.has(offer?.id)) errors.push(`dataset.offers[${index}].id: inválido o duplicado`);
    seen.add(offer?.id);
    if (!Number.isFinite(offer?.price) || offer.price <= 0 || !validTime(offer?.reported_at) || typeof offer?.district !== 'string' || !offer.district.trim() || !validCoordinate(offer ?? {})) errors.push(`dataset.offers[${index}]: valores inválidos`);
  }
  return errors;
}

export function validatePublicManifest(manifest) {
  const errors = [];
  if (!exactKeys(manifest, ['schema_version', 'snapshot_id', 'dataset_url', 'sha256', 'bytes', 'cutoff_at', 'generated_at'])) errors.push('manifest: campos inesperados o ausentes');
  if (manifest?.schema_version !== '1.0.0' || !ISO_SNAPSHOT.test(manifest?.snapshot_id ?? '')) errors.push('manifest: versión o snapshot inválido');
  if (manifest?.dataset_url !== `data/snapshots/${manifest?.snapshot_id}.json`) errors.push('manifest.dataset_url: no apunta al snapshot declarado');
  if (!SHA256.test(manifest?.sha256 ?? '') || !Number.isInteger(manifest?.bytes) || manifest.bytes < 1 || !validTime(manifest?.cutoff_at) || !validTime(manifest?.generated_at)) errors.push('manifest: integridad o tiempo inválido');
  return errors;
}

export function validatePublicBundle(manifest, datasetBytes) {
  const errors = validatePublicManifest(manifest);
  if (Buffer.byteLength(datasetBytes) !== manifest?.bytes) errors.push('manifest.bytes: no coincide');
  if (sha256(datasetBytes) !== manifest?.sha256) errors.push('manifest.sha256: no coincide');
  let dataset;
  try { dataset = JSON.parse(datasetBytes); } catch { errors.push('dataset: JSON inválido'); return errors; }
  errors.push(...validatePublicDataset(dataset));
  if (dataset.snapshot_id !== manifest.snapshot_id || dataset.cutoff_at !== manifest.cutoff_at) errors.push('manifest: no corresponde al dataset');
  return errors;
}
