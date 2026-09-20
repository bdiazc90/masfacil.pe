import crypto from 'node:crypto';

export const GASOLINA_MANIFEST_VERSION = '2.7.0';
export const LEGACY_GASOLINA_MANIFEST_VERSION = '2.0.0';
export const GASOLINA_VERSIONS = Object.freeze(['2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0', '2.5.0', '2.6.0', '2.7.0']);
export const CONFIDENCE_LEVELS = Object.freeze(['verified', 'nearby']);
export const GASOLINA_SCOPE = Object.freeze({ department: 'LIMA', province: 'LIMA' });
export const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);
export const PUBLIC_OFFER_FIELDS = Object.freeze(['id', 'establishment_id', 'commercial_identity', 'address', 'price', 'reported_at', 'facilito', 'district', 'longitude', 'latitude']);
export const FACILITO_FIELDS = Object.freeze(['price', 'observed_at', 'reported_at']);
const PRODUCT_META = Object.freeze({ regular: Object.freeze({ canonical: 'GASOHOL REGULAR', label: 'Gasohol Regular' }), premium: Object.freeze({ canonical: 'GASOHOL PREMIUM', label: 'Gasohol Premium' }) });

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sameKeys = (value, keys) => value && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = (value) => typeof value === 'string' && value.length > 0;
const timestamp = (value) => text(value) && Number.isFinite(Date.parse(value));

export function validateGasolinaDataset(dataset) {
  const errors = [];
  const version = dataset?.schema_version;
  if (!sameKeys(dataset, ['schema_version', 'revision_id', 'product', 'scope', 'snapshot_date', 'cutoff_at', 'source_max_reported_at', 'provenance', 'offers'])) errors.push('campos del dataset gasolina inválidos');
  if (!GASOLINA_VERSIONS.includes(version) || !text(dataset?.revision_id)) errors.push('versión o revisión inválida');
  const expected = PRODUCT_META[dataset?.product?.key]; if (!expected || dataset?.product?.canonical !== expected.canonical || dataset?.product?.label !== expected.label || dataset?.product?.display_unit !== 'Galones') errors.push('producto inválido');
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
        : ['id', 'price', 'reported_at', 'district', 'longitude', 'latitude'];
  for (const offer of dataset?.offers ?? []) {
    if (!sameKeys(offer, expectedFields)) { errors.push('allowlist de oferta inválida'); continue; }
    const identity = offer.commercial_identity;
    const identityFields = conMarcaAcreditada ? ['brand', 'public_site_name', 'confidence', 'brand_accredited'] : conConfianza ? ['brand', 'public_site_name', 'confidence'] : ['brand', 'public_site_name'];
    const identityValid = !conIdentidad || (identity === null || (sameKeys(identity, identityFields) && (identity.brand === null || text(identity.brand)) && (identity.public_site_name === null || text(identity.public_site_name)) && (identity.brand !== null || identity.public_site_name !== null) && (!conConfianza || CONFIDENCE_LEVELS.includes(identity.confidence)) && (!conMarcaAcreditada || (typeof identity.brand_accredited === 'boolean' && (identity.brand !== null || identity.brand_accredited === false)))));
    // La dirección es opcional: hay establecimientos cuyo Registro no expone una
    // vía utilizable. Cuando existe, debe ser texto acotado para la tarjeta.
    const addressValid = !conDireccion || offer.address === null || (text(offer.address) && offer.address.length <= 48);
    const facilitoValid = !conFacilito || offer.facilito === null || (sameKeys(offer.facilito, FACILITO_FIELDS) && Number.isFinite(offer.facilito.price) && offer.facilito.price > 0 && timestamp(offer.facilito.observed_at) && offer.facilito.reported_at === null);
    if (!/^g2_[a-f0-9]{24}$/.test(offer.id) || (conIdentidad && !/^est_[a-f0-9]{24}$/.test(offer.establishment_id)) || !identityValid || !addressValid || !facilitoValid || !Number.isFinite(offer.price) || offer.price <= 0 || !timestamp(offer.reported_at) || !text(offer.district) || !Number.isFinite(offer.longitude) || offer.longitude < -82 || offer.longitude > -68 || !Number.isFinite(offer.latitude) || offer.latitude < -19 || offer.latitude > 1) errors.push('valor de oferta inválido');
  }
  return errors;
}

export function validateGasolinaManifest(manifest) {
  const errors = [];
  if (!sameKeys(manifest, ['schema_version', 'revision_id', 'scope', 'products', 'generated_at'])) errors.push('campos del manifest gasolina inválidos');
  if (!GASOLINA_VERSIONS.includes(manifest?.schema_version) || !text(manifest?.revision_id)) errors.push('versión o revisión de manifest inválida');
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
  // Desde 2.6.0 el snapshot se declara; antes se deducía recortando el
  // `revision_id`, y ese recorte nunca quitó el sufijo, así que la comparación
  // que apagaba o encendía los guardrails de caída era siempre falsa.
  const conSnapshot = ['2.6.0', '2.7.0'].includes(state?.schema_version);
  // Desde 2.7.0 el estado de datos no es solo el CSV. `facilito.state_id` es el
  // `observed_at` más reciente que guarda el expediente privado, y ordena dos
  // composiciones sobre el MISMO snapshot: sin él, dos capturas del mismo CSV
  // empatan y la corrida que termina tarde pisa a la que vio la tabla después.
  const conFacilito = ['2.7.0'].includes(state?.schema_version);
  const raiz = ['schema_version', 'revision_id', 'snapshot_id', 'validators', 'source_max_reported_at', 'products'];
  if (!sameKeys(state, conFacilito ? [...raiz, 'facilito'] : conSnapshot ? raiz : raiz.filter((field) => field !== 'snapshot_id'))) errors.push('campos refresh-state inválidos');
  if (conSnapshot && !text(state?.snapshot_id)) errors.push('snapshot_id refresh-state inválido');
  if (conFacilito) {
    const capa = state?.facilito;
    const entero = (value) => Number.isInteger(value) && value >= 0;
    if (!sameKeys(capa, ['contract', 'state_id', 'units_observed', 'units', 'districts', 'linked', 'ambiguous', 'unlinked', 'effective'])
      || !text(capa.contract)
      || (capa.state_id !== null && !timestamp(capa.state_id))
      || !capa.units_observed || typeof capa.units_observed !== 'object' || Array.isArray(capa.units_observed)
      || !Object.values(capa.units_observed).every((valor) => timestamp(valor))
      || !sameKeys(capa.units, ['fresh', 'reused', 'failed']) || !Object.values(capa.units).every(entero)
      || !entero(capa.districts) || !entero(capa.ambiguous) || !entero(capa.unlinked)
      || !GASOLINA_KEYS.every((key) => entero(capa.linked?.[key]) && sameKeys(capa.effective?.[key], ['facilito', 'csv', 'none']) && Object.values(capa.effective[key]).every(entero))) errors.push('capa facilito refresh-state inválida');
  }
  if (!GASOLINA_VERSIONS.includes(state?.schema_version) || (manifest?.schema_version && state?.schema_version !== manifest.schema_version) || state?.revision_id !== manifest?.revision_id) errors.push('revisión refresh-state inválida');
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
