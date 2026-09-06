import fs from 'node:fs';
import { OFFICIAL_ANCHOR_SCHEME } from './official-anchor.mjs';

export const CATALOG_SCHEMA_VERSION = '1.3.0';
// 1.2.0 sigue siendo válido: es el formato del secret que hoy está en CI. Sin
// `brand_evidence` una marca se publica como texto y nunca obtiene logo, que es
// exactamente el comportamiento actual. Así el contrato nuevo no obliga a
// recargar el secret para seguir publicando precios.
export const CATALOG_SCHEMA_VERSIONS = Object.freeze(['1.2.0', CATALOG_SCHEMA_VERSION]);

// Dos niveles de evidencia sobre el NOMBRE, no sobre el vínculo con la entidad:
// el anchor siempre deriva exacto del Registro. `verified` tiene corroboración
// ajena a la distancia —número de puerta, razón social o marca del operador—;
// `nearby` solo tiene cercanía comprobada, y la interfaz lo marca como tal.
export const CONFIDENCE_LEVELS = Object.freeze(['verified', 'nearby']);

// Evidencia de BANDERA, distinta de la evidencia del nombre. Solo dos vías la
// acreditan: el directorio oficial vigente de la propia cadena o el letrero
// observado. La razón social, el proveedor o una compra empresarial no bastan.
// `brand_evidence` es opcional: una marca sin ella se sigue publicando como
// texto —es lo que ya está en producción— pero no obtiene logo.
export const BRAND_EVIDENCE_METHODS = Object.freeze(['official_directory', 'storefront_observation']);
export const BRAND_EVIDENCE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const topKeys =['schema_version', 'catalog_id', 'anchor_scheme', 'entries'];
const legacyEntryKeys = ['establishment_id', 'brand', 'public_site_name', 'confidence', 'source', 'entity_link', 'identity_freshness', 'publication'];
const entryKeys = [...legacyEntryKeys, 'brand_evidence'];
const brandEvidenceKeys = ['method', 'reference', 'evidenced_at', 'consulted_at'];
const sourceKeys = ['kind', 'source_or_description', 'acquisition_method', 'observed_at', 'responsible'];
const linkKeys = ['method', 'status', 'verified_at'];
const publicationKeys = ['status', 'reviewed_at', 'responsible'];
const sourceMethods = Object.freeze({ owner_verified: 'direct_observation', first_party: 'first_party_publication', public_web_observed: 'public_web_review', open_reusable: 'open_dataset', known_contributor: 'contributor_submission' });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const meaningful = (value) => typeof value === 'string' && value.trim().length > 0;
const nullableText = (value) => value === null || meaningful(value);
const iso = (value) => meaningful(value) && Number.isFinite(Date.parse(value));
const listado = (ids, maximo = 10) => (ids.length > maximo ? `${ids.slice(0, maximo).join(', ')} y ${ids.length - maximo} más` : ids.join(', '));

export function validateCommercialCatalog(catalog) {
  const errors = [];
  if (!exactKeys(catalog, topKeys)) errors.push('catalog: campos inesperados o ausentes');
  if (!CATALOG_SCHEMA_VERSIONS.includes(catalog?.schema_version)) errors.push('catalog.schema_version: fuera del contrato');
  const conEvidenciaDeMarca = catalog?.schema_version === CATALOG_SCHEMA_VERSION;
  const camposEntrada = conEvidenciaDeMarca ? entryKeys : legacyEntryKeys;
  if (!/^commercial-identity-catalog-[a-z0-9.-]+$/.test(catalog?.catalog_id ?? '')) errors.push('catalog.catalog_id: formato inválido');
  if (catalog?.anchor_scheme !== OFFICIAL_ANCHOR_SCHEME) errors.push('catalog.anchor_scheme: fuera del contrato');
  if (!Array.isArray(catalog?.entries)) { errors.push('catalog.entries: debe ser arreglo'); return [...new Set(errors)]; }
  const seen = new Set();
  for (const [index, entry] of catalog.entries.entries()) {
    const where = `catalog.entries[${index}]`;
    if (!exactKeys(entry, camposEntrada)) { errors.push(`${where}: campos inesperados o ausentes`); continue; }
    if (!/^est_[a-f0-9]{24}$/.test(entry.establishment_id ?? '')) errors.push(`${where}.establishment_id: formato inválido`);
    if (seen.has(entry.establishment_id)) errors.push(`${where}.establishment_id: duplicado o conflicto`); seen.add(entry.establishment_id);
    if (!nullableText(entry.brand) || !nullableText(entry.public_site_name) || (entry.brand === null && entry.public_site_name === null)) errors.push(`${where}: requiere marca, sede pública o ambas`);
    if (!CONFIDENCE_LEVELS.includes(entry.confidence)) errors.push(`${where}.confidence: fuera del catálogo`);
    if (!exactKeys(entry.source, sourceKeys)) { errors.push(`${where}.source: campos inesperados o ausentes`); continue; }
    if (!Object.hasOwn(sourceMethods, entry.source.kind)) errors.push(`${where}.source.kind: fuera del catálogo`);
    if (sourceMethods[entry.source.kind] !== entry.source.acquisition_method) errors.push(`${where}.source.acquisition_method: no corresponde a la procedencia`);
    for (const key of ['source_or_description', 'responsible']) if (!meaningful(entry.source[key])) errors.push(`${where}.source.${key}: texto significativo requerido`);
    if (!iso(entry.source.observed_at)) errors.push(`${where}.source.observed_at: fecha/hora inválida`);
    if (!exactKeys(entry.entity_link, linkKeys)) { errors.push(`${where}.entity_link: campos inesperados o ausentes`); continue; }
    if (!['official_registration_code_exact', 'official_establishment_id_exact'].includes(entry.entity_link.method)) errors.push(`${where}.entity_link.method: no es un vínculo oficial exacto`);
    if (!['verified', 'pending', 'conflict'].includes(entry.entity_link.status)) errors.push(`${where}.entity_link.status: fuera del catálogo`);
    if (entry.entity_link.status === 'verified' && !iso(entry.entity_link.verified_at)) errors.push(`${where}.entity_link.verified_at: requerido para vínculo verificado`);
    if (entry.entity_link.status !== 'verified' && entry.entity_link.verified_at !== null) errors.push(`${where}.entity_link.verified_at: solo aplica a vínculo verificado`);
    if (iso(entry.entity_link.verified_at) && iso(entry.source.observed_at) && Date.parse(entry.entity_link.verified_at) < Date.parse(entry.source.observed_at)) errors.push(`${where}.entity_link.verified_at: anterior a observed_at`);
    if (!['current', 'stale', 'unknown'].includes(entry.identity_freshness)) errors.push(`${where}.identity_freshness: fuera del catálogo`);
    if (!exactKeys(entry.publication, publicationKeys)) { errors.push(`${where}.publication: campos inesperados o ausentes`); continue; }
    if (!['publishable', 'pending', 'not_publishable'].includes(entry.publication.status)) errors.push(`${where}.publication.status: fuera del catálogo`);
    if (entry.publication.status === 'publishable' && entry.entity_link.status !== 'verified') errors.push(`${where}.publication: no se publica vínculo no verificado`);
    if (entry.publication.status === 'pending' && entry.publication.reviewed_at !== null) errors.push(`${where}.publication.reviewed_at: pending no tiene revisión final`);
    if (entry.publication.status !== 'pending' && !iso(entry.publication.reviewed_at)) errors.push(`${where}.publication.reviewed_at: requerido tras revisión`);
    if (!meaningful(entry.publication.responsible)) errors.push(`${where}.publication.responsible: texto significativo requerido`);
    if (conEvidenciaDeMarca && entry.brand_evidence !== null) {
      if (!exactKeys(entry.brand_evidence, brandEvidenceKeys)) { errors.push(`${where}.brand_evidence: campos inesperados o ausentes`); continue; }
      if (entry.brand === null) errors.push(`${where}.brand_evidence: no hay marca que acreditar`);
      if (!BRAND_EVIDENCE_METHODS.includes(entry.brand_evidence.method)) errors.push(`${where}.brand_evidence.method: fuera del catálogo`);
      if (!meaningful(entry.brand_evidence.reference)) errors.push(`${where}.brand_evidence.reference: texto significativo requerido`);
      if (!iso(entry.brand_evidence.evidenced_at) || !iso(entry.brand_evidence.consulted_at)) errors.push(`${where}.brand_evidence: fecha/hora inválida`);
      // Consultar hoy una fuente histórica no la vuelve evidencia actual: la
      // fecha que cuenta es la de la imagen o la vigencia, no la de la consulta.
      if (iso(entry.brand_evidence.evidenced_at) && iso(entry.brand_evidence.consulted_at) && Date.parse(entry.brand_evidence.consulted_at) < Date.parse(entry.brand_evidence.evidenced_at)) errors.push(`${where}.brand_evidence.consulted_at: anterior a la evidencia`);
      // Los 12 meses son requisito de INCORPORACIÓN: se miden contra la revisión
      // que la incorporó, no contra hoy, así que el paso del tiempo no retira
      // sola una marca ya publicada.
      if (iso(entry.brand_evidence.evidenced_at) && iso(entry.publication.reviewed_at) && Date.parse(entry.publication.reviewed_at) - Date.parse(entry.brand_evidence.evidenced_at) > BRAND_EVIDENCE_MAX_AGE_MS) errors.push(`${where}.brand_evidence.evidenced_at: más de 12 meses al incorporarla`);
    }
  }
  return [...new Set(errors)];
}

export function loadValidatedCommercialCatalog(catalogPath) { const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); const errors = validateCommercialCatalog(catalog); if (errors.length) throw new Error(`Catálogo comercial fuera de contrato:\n- ${errors.join('\n- ')}`); return catalog; }
export function emptyCommercialCatalog() { return { schema_version: CATALOG_SCHEMA_VERSION, catalog_id: 'commercial-identity-catalog-pending', anchor_scheme: OFFICIAL_ANCHOR_SCHEME, entries: [] }; }
export function hasBrandEvidenceContract(catalog) { return catalog?.schema_version === CATALOG_SCHEMA_VERSION; }
export function isPublicCommercialEntry(entry) { return entry.entity_link.status === 'verified' && entry.publication.status === 'publishable'; }
// El universo del Registro y el conjunto de ofertas vigentes son cosas
// distintas. Una identidad se VALIDA contra el Registro —ahí un ID desconocido
// sigue siendo un error que bloquea— y se PROYECTA solo sobre las ofertas que
// hoy existen. Una estación registrada que dejó de reportar precio no es un
// fallo del catálogo: se conserva en privado y no se publica.
// Cola privada de revisión: evidencia que ya pasó los 12 meses DESPUÉS de
// incorporada. La marca sigue visible —decisión explícita de Bruno—; esto solo
// dice qué conviene volver a mirar, y se obtiene operando el catálogo, sin
// backend.
export function staleBrandEvidence(catalog, now = new Date()) {
  const limite = now.getTime() - BRAND_EVIDENCE_MAX_AGE_MS;
  return catalog.entries
    .filter((entry) => entry.brand_evidence && Date.parse(entry.brand_evidence.evidenced_at) < limite)
    .map((entry) => ({ establishment_id: entry.establishment_id, brand: entry.brand, method: entry.brand_evidence.method, reference: entry.brand_evidence.reference, evidenced_at: entry.brand_evidence.evidenced_at }))
    .sort((left, right) => left.evidenced_at.localeCompare(right.evidenced_at));
}

export function buildCommercialCatalogIndex(catalog, { registryIds, offerIds, approvedBrandMethods = new Set() }) {
  const registry = registryIds instanceof Set ? registryIds : new Set(registryIds);
  const offers = offerIds instanceof Set ? offerIds : new Set(offerIds);
  if (!registry.size) throw new Error('Universo del Registro vacío: no se valida identidad comercial sin referencia oficial');
  const unknown = catalog.entries.filter((entry) => !registry.has(entry.establishment_id));
  // Un conteo no se puede investigar. El anchor es público —viaja en cada oferta
  // del bundle— así que nombrarlo en el error convierte un fallo de CI en una
  // pista accionable sin reproducir la corrida.
  if (unknown.length) throw new Error(`Catálogo comercial contiene establishment_id fuera del Registro oficial: ${unknown.length} (${listado(unknown.map((entry) => entry.establishment_id))})`);
  const approved = approvedBrandMethods instanceof Set ? approvedBrandMethods : new Set(approvedBrandMethods);
  const byAnchor = new Map(); let pending = 0; let withBrand = 0; let accredited = 0; const withoutOffer = [];
  for (const entry of catalog.entries) {
    if (!isPublicCommercialEntry(entry)) { pending += 1; continue; }
    if (!offers.has(entry.establishment_id)) { withoutOffer.push(entry.establishment_id); continue; }
    // Marca identificada y marca acreditada son dos cosas: la primera se publica
    // como texto igual que hasta ahora; solo la segunda —evidencia de bandera con
    // su grupo auditado por encima del umbral— habilita el logo.
    const brandAccredited = Boolean(entry.brand) && Boolean(entry.brand_evidence) && approved.has(entry.brand_evidence.method);
    if (entry.brand) withBrand += 1;
    if (brandAccredited) accredited += 1;
    byAnchor.set(entry.establishment_id, Object.freeze({ brand: entry.brand, public_site_name: entry.public_site_name, confidence: entry.confidence, brand_accredited: brandAccredited }));
  }
  return Object.freeze({
    byAnchor,
    withoutOffer: Object.freeze(withoutOffer.sort()),
    metrics: Object.freeze({ entries: catalog.entries.length, registry_universe: registry.size, offer_universe: offers.size, projected: byAnchor.size, pending, without_current_offer: withoutOffer.length, unknown_anchors: 0, projected_with_brand: withBrand, projected_with_accredited_brand: accredited }),
  });
}
