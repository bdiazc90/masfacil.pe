// Reglas estructurales de los bundles de cada grupo, compartidas por el
// productor y el navegador.
//
// Antes había dos copias a mano —`pipeline/gasolina-contract.mjs` y
// `web/gasolina-contract.js`— y no decían lo mismo: la del navegador no miraba
// rangos de coordenadas, precios positivos, fechas legibles ni procedencia. Aquí
// vive una sola versión, la del productor, que ya era la más estricta: el
// navegador rechaza exactamente lo que el productor nunca habría publicado.
//
// Cada grupo declara sus reglas con `groupRules`: sus productos, su raíz de
// datos, sus versiones y el prefijo de sus IDs. Gasolina conserva sus versiones
// 2.0.0–2.7.0 tal cual; un grupo nuevo empieza en su propia 1.0.0 y no acepta
// nada de otro grupo.
//
// La huella no se calcula aquí. Cada entorno tiene la suya —`node:crypto` en la
// proyección, `crypto.subtle` en la página y el service worker— y la entrega ya
// calculada a `bundleErrors`. Sin imports salvo el catálogo, sin E/S.

import { DIESEL, GASOLINA, GASOLINA_KEYS, GLP, PRODUCTS } from './catalog.js';

export { GASOLINA_KEYS };
export const GASOLINA_MANIFEST_VERSION = '2.7.0';
export const LEGACY_GASOLINA_MANIFEST_VERSION = '2.0.0';
export const GASOLINA_VERSIONS = Object.freeze(['2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0']);
export const DIESEL_MANIFEST_VERSION = '1.0.0';
export const GLP_MANIFEST_VERSION = '1.0.0';
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

// Qué trae la oferta en cada versión de Gasolina. Una tabla en vez de listas
// repetidas en cada comprobación, para que un grupo nuevo declare las suyas con
// las mismas banderas.
//
// - `identity`: desde 2.1.0 la oferta trae `establishment_id` e identidad comercial.
// - `address`: desde 2.2.0, la dirección acotada para la tarjeta.
// - `confidence`: desde 2.3.0, `verified` o `nearby`.
// - `accredited`: 2.4.0 y 2.5.0 llevaban `brand_accredited`, una segunda puerta
//   que solo servía para pintar el logo. Desde 2.6.0 no existe: la marca y su
//   logo son la misma afirmación, así que el dato vuelve a describir identidad
//   y nada más.
// - `snapshot`: desde 2.6.0 el estado declara su `snapshot_id`.
// - `facilito`: desde 2.7.0, la capa de la consulta web: el precio leído y la
//   hora en que se leyó. `reported_at` es SIEMPRE null porque la tabla no declara
//   cuándo el operador registró ese precio, y una consulta no hereda la fecha
//   del CSV aunque el importe coincida. El precio y la fecha del CSV viajan
//   intactos al lado: el respaldo tiene que funcionar offline, sin otra descarga.
//
// 2.5.0 no cambia la FORMA de la oferta: cambia su POBLACIÓN. Hasta 2.4.0 toda
// oferta del bundle tenía menos de 30 días; desde 2.5.0 también viajan las
// vencidas, con su fecha real, para que la tarjeta del grifo no desaparezca. La
// versión sube para que un cliente viejo rechace el bundle y siga con su copia
// guardada, en vez de pintar un precio vencido como si fuera de hoy.
const flags = (identity, address, confidence, accredited, snapshot, facilito) => Object.freeze({ identity, address, confidence, accredited, snapshot, facilito });
const GASOLINA_FLAGS = Object.freeze({
  '2.0.0': flags(false, false, false, false, false, false),
  '2.1.0': flags(true, false, false, false, false, false),
  '2.2.0': flags(true, true, false, false, false, false),
  '2.3.0': flags(true, true, true, false, false, false),
  '2.4.0': flags(true, true, true, true, false, false),
  '2.5.0': flags(true, true, true, true, false, false),
  '2.6.0': flags(true, true, true, false, true, false),
  '2.7.0': flags(true, true, true, false, true, true),
});
// Una versión desconocida ya es un error por sí misma; sus ofertas se revisan
// como se revisaban antes de esta tabla, para que los mensajes no cambien.
const UNKNOWN_FLAGS = flags(true, false, false, false, false, false);

/**
 * Las reglas de un grupo.
 *
 * @param {object} grupo
 * @param {string} grupo.key            clave del grupo, igual a su vista
 * @param {string[]} grupo.products     productos, en el orden del manifest
 * @param {string} grupo.dataRoot       raíz pública de sus datos
 * @param {object} grupo.scope          ámbito territorial
 * @param {Record<string, object>} grupo.versions  versión → banderas
 * @param {string} grupo.current        la versión que produce la proyección
 * @param {RegExp} grupo.idPattern      forma de los IDs de oferta
 * @param {string|null} [grupo.revisionPrefix]  prefijo exigido a la revisión
 */
export function groupRules({ key, products, dataRoot, scope, versions, current, idPattern, revisionPrefix = null }) {
  const versionList = Object.freeze(Object.keys(versions));
  const flagsFor = (version) => versions[version] ?? UNKNOWN_FLAGS;
  // Una clave ajena al grupo no tiene metadatos que comparar, aunque exista en el
  // catálogo: cada grupo publica solo sus productos.
  const productOf = (productKey) => (products.includes(productKey) ? PRODUCTS[productKey] : null);
  const datasetUrlPattern = (productKey) => new RegExp(`^${dataRoot}/snapshots/[^/]+/${productKey}\\.json$`);
  const revisionValid = (revision) => text(revision) && (!revisionPrefix || (revision.startsWith(revisionPrefix) && revision.length > revisionPrefix.length));

  function datasetErrors(dataset) {
    const errors = [];
    const version = dataset?.schema_version;
    const f = flagsFor(version);
    if (!sameKeys(dataset, DATASET_FIELDS)) errors.push(`campos del dataset ${key} inválidos`);
    if (!versionList.includes(version) || !revisionValid(dataset?.revision_id)) errors.push('versión o revisión inválida');
    const expected = productOf(dataset?.product?.key);
    if (!expected || dataset?.product?.canonical !== expected.canonical || dataset?.product?.label !== expected.label || dataset?.product?.display_unit !== expected.unit) errors.push('producto inválido');
    if (JSON.stringify(dataset?.scope) !== JSON.stringify(scope)) errors.push('ámbito LIMA/LIMA inválido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset?.snapshot_date ?? '') || !timestamp(dataset?.cutoff_at) || !timestamp(dataset?.source_max_reported_at)) errors.push('corte inválido');
    if (!text(dataset?.provenance?.source_url) || !text(dataset?.provenance?.attribution)) errors.push('procedencia inválida');
    if (!Array.isArray(dataset?.offers)) errors.push('ofertas inválidas');
    const expectedFields = f.facilito ? PUBLIC_OFFER_FIELDS
      : f.address ? PUBLIC_OFFER_FIELDS.filter((field) => field !== 'facilito')
        : f.identity ? PUBLIC_OFFER_FIELDS.filter((field) => field !== 'facilito' && field !== 'address')
          : LEGACY_OFFER_FIELDS;
    const identityFields = f.accredited ? ['brand', 'public_site_name', 'confidence', 'brand_accredited'] : f.confidence ? ['brand', 'public_site_name', 'confidence'] : ['brand', 'public_site_name'];
    for (const offer of dataset?.offers ?? []) {
      if (!sameKeys(offer, expectedFields)) { errors.push('allowlist de oferta inválida'); continue; }
      const identity = offer.commercial_identity;
      const identityValid = !f.identity || (identity === null || (sameKeys(identity, identityFields) && (identity.brand === null || text(identity.brand)) && (identity.public_site_name === null || text(identity.public_site_name)) && (identity.brand !== null || identity.public_site_name !== null) && (!f.confidence || CONFIDENCE_LEVELS.includes(identity.confidence)) && (!f.accredited || (typeof identity.brand_accredited === 'boolean' && (identity.brand !== null || identity.brand_accredited === false)))));
      // La dirección es opcional: hay establecimientos cuyo Registro no expone una
      // vía utilizable. Cuando existe, debe ser texto acotado para la tarjeta.
      const addressValid = !f.address || offer.address === null || (text(offer.address) && offer.address.length <= 48);
      const facilitoValid = !f.facilito || offer.facilito === null || (sameKeys(offer.facilito, FACILITO_FIELDS) && Number.isFinite(offer.facilito.price) && offer.facilito.price > 0 && timestamp(offer.facilito.observed_at) && offer.facilito.reported_at === null);
      if (!idPattern.test(offer.id) || (f.identity && !/^est_[a-f0-9]{24}$/.test(offer.establishment_id)) || !identityValid || !addressValid || !facilitoValid || !Number.isFinite(offer.price) || offer.price <= 0 || !timestamp(offer.reported_at) || !text(offer.district) || !withinPeru(offer.longitude, offer.latitude)) errors.push('valor de oferta inválido');
    }
    return errors;
  }

  function manifestErrors(manifest) {
    const errors = [];
    if (!sameKeys(manifest, MANIFEST_FIELDS)) errors.push(`campos del manifest ${key} inválidos`);
    if (!versionList.includes(manifest?.schema_version) || !revisionValid(manifest?.revision_id)) errors.push('versión o revisión de manifest inválida');
    if (JSON.stringify(manifest?.scope) !== JSON.stringify(scope)) errors.push('ámbito de manifest inválido');
    if (!manifest?.products || JSON.stringify(Object.keys(manifest.products)) !== JSON.stringify(products)) errors.push('descriptores de producto inválidos');
    for (const productKey of products) {
      const item = manifest?.products?.[productKey];
      if (!sameKeys(item, DESCRIPTOR_FIELDS)) { errors.push(`descriptor ${productKey} inválido`); continue; }
      const expected = PRODUCTS[productKey];
      if (item.canonical_product !== expected.canonical || item.label !== expected.label || !datasetUrlPattern(productKey).test(item.dataset_url) || !Number.isInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256) || !timestamp(item.cutoff_at)) errors.push(`descriptor ${productKey} incompleto`);
    }
    return errors;
  }

  /**
   * Errores de un snapshot frente a su manifest.
   *
   * @param {object} manifest
   * @param {string} productKey  producto del snapshot
   * @param {string} body        bytes del snapshot, como texto
   * @param {{bytes: number, sha256: string|null}|null} digest  medidos por quien llama
   */
  function bundleErrors(manifest, productKey, body, digest) {
    const errors = manifestErrors(manifest);
    const descriptor = manifest?.products?.[productKey];
    if (!descriptor) return [...errors, 'producto no declarado'];
    if (digest?.bytes !== descriptor.bytes || digest?.sha256 !== descriptor.sha256) return [...errors, 'hash o bytes del snapshot no coinciden'];
    try {
      const dataset = JSON.parse(body); errors.push(...datasetErrors(dataset));
      if (dataset.schema_version !== manifest.schema_version || dataset.revision_id !== manifest.revision_id || dataset.product.key !== productKey || dataset.cutoff_at !== descriptor.cutoff_at) errors.push('snapshot no coincide con descriptor');
    } catch { errors.push('snapshot JSON inválido'); }
    return errors;
  }

  return Object.freeze({ key, products, dataRoot, scope, versions: versionList, current, revisionPrefix, flagsFor, datasetErrors, manifestErrors, bundleErrors });
}

export const GROUP_RULES = Object.freeze({
  gasolina: groupRules({ key: GASOLINA.key, products: GASOLINA.products, dataRoot: GASOLINA.dataRoot, scope: GASOLINA.scope, versions: GASOLINA_FLAGS, current: GASOLINA_MANIFEST_VERSION, idPattern: /^g2_[a-f0-9]{24}$/ }),
  // Diésel nace con la forma de oferta de Gasolina 2.7.0, en su propia 1.0.0: un
  // bundle de Gasolina no puede pasar por uno de Diésel ni al revés.
  diesel: groupRules({ key: DIESEL.key, products: DIESEL.products, dataRoot: DIESEL.dataRoot, scope: DIESEL.scope, versions: { [DIESEL_MANIFEST_VERSION]: GASOLINA_FLAGS['2.7.0'] }, current: DIESEL_MANIFEST_VERSION, idPattern: /^d1_[a-f0-9]{24}$/, revisionPrefix: 'diesel-' }),
  // GLP, igual que Diésel: la forma de 2.7.0 en su propia 1.0.0, sus IDs y su
  // prefijo de revisión.
  glp: groupRules({ key: GLP.key, products: GLP.products, dataRoot: GLP.dataRoot, scope: GLP.scope, versions: { [GLP_MANIFEST_VERSION]: GASOLINA_FLAGS['2.7.0'] }, current: GLP_MANIFEST_VERSION, idPattern: /^glp1_[a-f0-9]{24}$/, revisionPrefix: 'glp-' }),
});

// Los nombres de siempre, atados a Gasolina: la proyección, el refresco, el
// histórico y las pruebas los importan tal cual.
export const datasetErrors = GROUP_RULES.gasolina.datasetErrors;
export const manifestErrors = GROUP_RULES.gasolina.manifestErrors;
export const bundleErrors = GROUP_RULES.gasolina.bundleErrors;
