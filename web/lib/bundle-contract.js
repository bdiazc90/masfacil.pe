// Reglas estructurales del bundle de gasolina, compartidas por el productor y el
// navegador.
//
// Antes había dos copias a mano —`pipeline/gasolina-contract.mjs` y
// `web/gasolina-contract.js`— y no decían lo mismo: la del navegador no miraba
// rangos de coordenadas, precios positivos, fechas legibles ni procedencia. Aquí
// vive una sola versión, la del productor, que ya era la más estricta: el
// navegador rechaza exactamente lo que el productor nunca habría publicado.
//
// La huella no se calcula aquí. Cada entorno tiene la suya —`node:crypto` en la
// proyección, `crypto.subtle` en la página y el service worker— y la entrega ya
// calculada a `bundleErrors`. Sin imports salvo el catálogo, sin E/S.

import { GASOLINA, GASOLINA_KEYS, PRODUCTS } from './catalog.js';

export { GASOLINA_KEYS };
export const GASOLINA_MANIFEST_VERSION = '2.7.0';
export const LEGACY_GASOLINA_MANIFEST_VERSION = '2.0.0';
export const GASOLINA_VERSIONS = Object.freeze(['2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0']);
export const CONFIDENCE_LEVELS = Object.freeze(['verified', 'nearby']);
export const GASOLINA_SCOPE = GASOLINA.scope;
export const PUBLIC_OFFER_FIELDS = Object.freeze(['id', 'establishment_id', 'commercial_identity', 'address', 'price', 'reported_at', 'facilito', 'district', 'longitude', 'latitude']);
export const FACILITO_FIELDS = Object.freeze(['price', 'observed_at', 'reported_at']);
const DATASET_FIELDS = Object.freeze(['schema_version', 'revision_id', 'product', 'scope', 'snapshot_date', 'cutoff_at', 'source_max_reported_at', 'provenance', 'offers']);
const MANIFEST_FIELDS = Object.freeze(['schema_version', 'revision_id', 'scope', 'products', 'generated_at']);
const DESCRIPTOR_FIELDS = Object.freeze(['canonical_product', 'label', 'dataset_url', 'bytes', 'sha256', 'cutoff_at']);
const LEGACY_OFFER_FIELDS = Object.freeze(['id', 'price', 'reported_at', 'district', 'longitude', 'latitude']);

export const sameKeys = (value, keys) => value && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
export const text = (value) => typeof value === 'string' && value.length > 0;
export const timestamp = (value) => text(value) && Number.isFinite(Date.parse(value));

/**
 * Cotas del Perú, inclusivas. Las usan el cruce con el GIS, que descarta una
 * coordenada fuera de ellas, y el contrato, que rechaza un bundle que la traiga.
 */
export const withinPeru = (longitude, latitude) => Number.isFinite(longitude) && longitude >= -82 && longitude <= -68
  && Number.isFinite(latitude) && latitude >= -19 && latitude <= 1;

// Una clave ajena al grupo no tiene metadatos que comparar, aunque exista en el
// catálogo: Gasolina solo publica sus dos productos.
const gasolinaProduct = (key) => (GASOLINA_KEYS.includes(key) ? PRODUCTS[key] : null);
const datasetUrlPattern = (key) => new RegExp(`^${GASOLINA.dataRoot}/snapshots/[^/]+/${key}\\.json$`);

export function datasetErrors(dataset) {
  const errors = [];
  const version = dataset?.schema_version;
  if (!sameKeys(dataset, DATASET_FIELDS)) errors.push('campos del dataset gasolina inválidos');
  if (!GASOLINA_VERSIONS.includes(version) || !text(dataset?.revision_id)) errors.push('versión o revisión inválida');
  const expected = gasolinaProduct(dataset?.product?.key);
  if (!expected || dataset?.product?.canonical !== expected.canonical || dataset?.product?.label !== expected.label || dataset?.product?.display_unit !== expected.unit) errors.push('producto inválido');
  if (JSON.stringify(dataset?.scope) !== JSON.stringify(GASOLINA_SCOPE)) errors.push('ámbito LIMA/LIMA inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset?.snapshot_date ?? '') || !timestamp(dataset?.cutoff_at) || !timestamp(dataset?.source_max_reported_at)) errors.push('corte inválido');
  if (!text(dataset?.provenance?.source_url) || !text(dataset?.provenance?.attribution)) errors.push('procedencia inválida');
  if (!Array.isArray(dataset?.offers)) errors.push('ofertas inválidas');
  const conIdentidad = version !== LEGACY_GASOLINA_MANIFEST_VERSION;
  const conDireccion = ['2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0'].includes(version);
  const conConfianza = ['2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0'].includes(version);
  // 2.7.0 añade la capa `facilito`: el precio leído de la consulta web y la hora
  // en que se leyó. `reported_at` es SIEMPRE null porque la tabla no declara
  // cuándo el operador registró ese precio, y una consulta no hereda la fecha
  // del CSV aunque el importe coincida. El precio y la fecha del CSV viajan
  // intactos al lado: el respaldo tiene que funcionar offline, sin otra descarga.
  const conFacilito = ['2.7.0'].includes(version);
  // 2.4.0 y 2.5.0 llevaban `brand_accredited`, una segunda puerta que solo
  // servía para pintar el logo. Desde 2.6.0 no existe: la marca y su logo son la
  // misma afirmación, así que el dato vuelve a describir identidad y nada más.
  const conMarcaAcreditada = ['2.4.0', '2.5.0'].includes(version);
  // 2.5.0 no cambia la FORMA de la oferta: cambia su POBLACIÓN. Hasta 2.4.0 toda
  // oferta del bundle tenía menos de 30 días; desde 2.5.0 también viajan las
  // vencidas, con su fecha real, para que la tarjeta del grifo no desaparezca.
  // La versión sube para que un cliente viejo rechace el bundle y siga con su
  // copia guardada, en vez de pintar un precio vencido como si fuera de hoy.
  const expectedFields = conFacilito ? PUBLIC_OFFER_FIELDS
    : conDireccion ? PUBLIC_OFFER_FIELDS.filter((field) => field !== 'facilito')
      : conIdentidad ? PUBLIC_OFFER_FIELDS.filter((field) => field !== 'facilito' && field !== 'address')
        : LEGACY_OFFER_FIELDS;
  const identityFields = conMarcaAcreditada ? ['brand', 'public_site_name', 'confidence', 'brand_accredited'] : conConfianza ? ['brand', 'public_site_name', 'confidence'] : ['brand', 'public_site_name'];
  for (const offer of dataset?.offers ?? []) {
    if (!sameKeys(offer, expectedFields)) { errors.push('allowlist de oferta inválida'); continue; }
    const identity = offer.commercial_identity;
    const identityValid = !conIdentidad || (identity === null || (sameKeys(identity, identityFields) && (identity.brand === null || text(identity.brand)) && (identity.public_site_name === null || text(identity.public_site_name)) && (identity.brand !== null || identity.public_site_name !== null) && (!conConfianza || CONFIDENCE_LEVELS.includes(identity.confidence)) && (!conMarcaAcreditada || (typeof identity.brand_accredited === 'boolean' && (identity.brand !== null || identity.brand_accredited === false)))));
    // La dirección es opcional: hay establecimientos cuyo Registro no expone una
    // vía utilizable. Cuando existe, debe ser texto acotado para la tarjeta.
    const addressValid = !conDireccion || offer.address === null || (text(offer.address) && offer.address.length <= 48);
    const facilitoValid = !conFacilito || offer.facilito === null || (sameKeys(offer.facilito, FACILITO_FIELDS) && Number.isFinite(offer.facilito.price) && offer.facilito.price > 0 && timestamp(offer.facilito.observed_at) && offer.facilito.reported_at === null);
    if (!/^g2_[a-f0-9]{24}$/.test(offer.id) || (conIdentidad && !/^est_[a-f0-9]{24}$/.test(offer.establishment_id)) || !identityValid || !addressValid || !facilitoValid || !Number.isFinite(offer.price) || offer.price <= 0 || !timestamp(offer.reported_at) || !text(offer.district) || !withinPeru(offer.longitude, offer.latitude)) errors.push('valor de oferta inválido');
  }
  return errors;
}

export function manifestErrors(manifest) {
  const errors = [];
  if (!sameKeys(manifest, MANIFEST_FIELDS)) errors.push('campos del manifest gasolina inválidos');
  if (!GASOLINA_VERSIONS.includes(manifest?.schema_version) || !text(manifest?.revision_id)) errors.push('versión o revisión de manifest inválida');
  if (JSON.stringify(manifest?.scope) !== JSON.stringify(GASOLINA_SCOPE)) errors.push('ámbito de manifest inválido');
  if (!manifest?.products || JSON.stringify(Object.keys(manifest.products)) !== JSON.stringify(GASOLINA_KEYS)) errors.push('descriptores de producto inválidos');
  for (const key of GASOLINA_KEYS) {
    const item = manifest?.products?.[key];
    if (!sameKeys(item, DESCRIPTOR_FIELDS)) { errors.push(`descriptor ${key} inválido`); continue; }
    const expected = PRODUCTS[key];
    if (item.canonical_product !== expected.canonical || item.label !== expected.label || !datasetUrlPattern(key).test(item.dataset_url) || !Number.isInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256) || !timestamp(item.cutoff_at)) errors.push(`descriptor ${key} incompleto`);
  }
  return errors;
}

/**
 * Errores de un snapshot frente a su manifest.
 *
 * @param {object} manifest
 * @param {string} key      producto del snapshot
 * @param {string} body     bytes del snapshot, como texto
 * @param {{bytes: number, sha256: string|null}|null} digest  medidos por quien llama
 */
export function bundleErrors(manifest, key, body, digest) {
  const errors = manifestErrors(manifest);
  const descriptor = manifest?.products?.[key];
  if (!descriptor) return [...errors, 'producto no declarado'];
  if (digest?.bytes !== descriptor.bytes || digest?.sha256 !== descriptor.sha256) return [...errors, 'hash o bytes del snapshot no coinciden'];
  try {
    const dataset = JSON.parse(body); errors.push(...datasetErrors(dataset));
    if (dataset.schema_version !== manifest.schema_version || dataset.revision_id !== manifest.revision_id || dataset.product.key !== key || dataset.cutoff_at !== descriptor.cutoff_at) errors.push('snapshot no coincide con descriptor');
  } catch { errors.push('snapshot JSON inválido'); }
  return errors;
}
