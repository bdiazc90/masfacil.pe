export const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);
export const GASOLINA_VERSIONS = Object.freeze(['2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0']);
const CONFIDENCE_LEVELS = ['verified', 'nearby'];
const PRODUCT_META = Object.freeze({ regular: Object.freeze({ canonical: 'GASOHOL REGULAR', label: 'Gasohol Regular' }), premium: Object.freeze({ canonical: 'GASOHOL PREMIUM', label: 'Gasohol Premium' }) });
const legacyOfferFields = ['id', 'price', 'reported_at', 'district', 'longitude', 'latitude'];
const identityOfferFields = ['id', 'establishment_id', 'commercial_identity', 'price', 'reported_at', 'district', 'longitude', 'latitude'];
const addressOfferFields = ['id', 'establishment_id', 'commercial_identity', 'address', 'price', 'reported_at', 'district', 'longitude', 'latitude'];
const facilitoOfferFields = [...addressOfferFields, 'facilito'];
const address = (value) => value === null || (text(value) && value.length <= 48);
// La consulta web nunca trae fecha de reporte: `reported_at: null` es parte del
// contrato, no un hueco. Un bundle que afirmara lo contrario se rechaza.
const facilito = (value) => value === null || (same(value, ['price', 'observed_at', 'reported_at']) && Number.isFinite(value.price) && text(value.observed_at) && value.reported_at === null);
const same = (value, fields) => value && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
const text = (value) => typeof value === 'string' && value.length > 0;
const identityFields = (conConfianza, conMarcaAcreditada) => conMarcaAcreditada ? ['brand', 'public_site_name', 'confidence', 'brand_accredited'] : conConfianza ? ['brand', 'public_site_name', 'confidence'] : ['brand', 'public_site_name'];
const identity = (value, conConfianza, conMarcaAcreditada) => value === null || (same(value, identityFields(conConfianza, conMarcaAcreditada)) && (value.brand === null || text(value.brand)) && (value.public_site_name === null || text(value.public_site_name)) && (value.brand !== null || value.public_site_name !== null) && (!conConfianza || CONFIDENCE_LEVELS.includes(value.confidence)) && (!conMarcaAcreditada || (typeof value.brand_accredited === 'boolean' && (value.brand !== null || value.brand_accredited === false))));

export function validateGasolinaManifest(manifest) {
  if (!same(manifest, ['schema_version', 'revision_id', 'scope', 'products', 'generated_at']) || !GASOLINA_VERSIONS.includes(manifest.schema_version) || !text(manifest.revision_id) || manifest.scope?.department !== 'LIMA' || manifest.scope?.province !== 'LIMA' || JSON.stringify(Object.keys(manifest.products ?? {})) !== JSON.stringify(GASOLINA_KEYS)) return false;
  return GASOLINA_KEYS.every((key) => { const item = manifest.products[key]; const product = PRODUCT_META[key]; return same(item, ['canonical_product', 'label', 'dataset_url', 'bytes', 'sha256', 'cutoff_at']) && item.canonical_product === product.canonical && item.label === product.label && new RegExp(`^data/gasolina/snapshots/[^/]+/${key}\\.json$`).test(item.dataset_url) && Number.isInteger(item.bytes) && /^[a-f0-9]{64}$/.test(item.sha256); });
}
export function validateGasolinaDataset(dataset, key, revision) {
  const version = dataset?.schema_version;
  const conDireccion = ['2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0'].includes(version);
  const conConfianza = ['2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0'].includes(version);
  const conMarcaAcreditada = ['2.4.0', '2.5.0'].includes(version);
  const conFacilito = version === '2.7.0';
  const fields = version === '2.0.0' ? legacyOfferFields : conFacilito ? facilitoOfferFields : conDireccion ? addressOfferFields : identityOfferFields;
  const product = PRODUCT_META[key];
  return same(dataset, ['schema_version', 'revision_id', 'product', 'scope', 'snapshot_date', 'cutoff_at', 'source_max_reported_at', 'provenance', 'offers']) && GASOLINA_VERSIONS.includes(version) && dataset.revision_id === revision && dataset.product?.key === key && dataset.product?.canonical === product?.canonical && dataset.product?.label === product?.label && dataset.product?.display_unit === 'Galones' && dataset.scope?.department === 'LIMA' && dataset.scope?.province === 'LIMA' && Array.isArray(dataset.offers) && dataset.offers.every((offer) => same(offer, fields) && /^g2_[a-f0-9]{24}$/.test(offer.id) && (version === '2.0.0' || (/^est_[a-f0-9]{24}$/.test(offer.establishment_id) && identity(offer.commercial_identity, conConfianza, conMarcaAcreditada) && (!conDireccion || address(offer.address)) && (!conFacilito || facilito(offer.facilito)))) && Number.isFinite(offer.price) && text(offer.reported_at) && text(offer.district) && Number.isFinite(offer.longitude) && Number.isFinite(offer.latitude));
}
export async function validGasolinaBundle(manifest, key, body) {
  const descriptor = manifest.products?.[key]; if (!validateGasolinaManifest(manifest) || !descriptor || new TextEncoder().encode(body).length !== descriptor.bytes) return false;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== descriptor.sha256) return false;
  try { const dataset = JSON.parse(body); return dataset.schema_version === manifest.schema_version && dataset.cutoff_at === descriptor.cutoff_at && validateGasolinaDataset(dataset, key, manifest.revision_id); } catch { return false; }
}
