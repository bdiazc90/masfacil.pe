import fs from 'node:fs';
import { OFFICIAL_ANCHOR_SCHEME } from './official-anchor.mjs';

const topKeys = ['schema_version', 'catalog_id', 'anchor_scheme', 'entries'];
const entryKeys = ['establishment_id', 'brand', 'public_site_name', 'source', 'entity_link', 'identity_freshness', 'publication'];
const sourceKeys = ['kind', 'source_or_description', 'acquisition_method', 'observed_at', 'responsible'];
const linkKeys = ['method', 'status', 'verified_at'];
const publicationKeys = ['status', 'reviewed_at', 'responsible'];
const sourceMethods = Object.freeze({ owner_verified: 'direct_observation', first_party: 'first_party_publication', public_web_observed: 'public_web_review', open_reusable: 'open_dataset', known_contributor: 'contributor_submission' });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const meaningful = (value) => typeof value === 'string' && value.trim().length > 0;
const nullableText = (value) => value === null || meaningful(value);
const iso = (value) => meaningful(value) && Number.isFinite(Date.parse(value));

export function validateCommercialCatalog(catalog, schema) {
  const errors = [];
  if (!exactKeys(catalog, topKeys)) errors.push('catalog: campos inesperados o ausentes');
  if (catalog?.schema_version !== schema?.properties?.schema_version?.const) errors.push('catalog.schema_version: fuera del contrato');
  if (!/^commercial-identity-catalog-[a-z0-9.-]+$/.test(catalog?.catalog_id ?? '')) errors.push('catalog.catalog_id: formato inválido');
  if (catalog?.anchor_scheme !== OFFICIAL_ANCHOR_SCHEME) errors.push('catalog.anchor_scheme: fuera del contrato');
  if (!Array.isArray(catalog?.entries)) { errors.push('catalog.entries: debe ser arreglo'); return [...new Set(errors)]; }
  const seen = new Set();
  for (const [index, entry] of catalog.entries.entries()) {
    const where = `catalog.entries[${index}]`;
    if (!exactKeys(entry, entryKeys)) { errors.push(`${where}: campos inesperados o ausentes`); continue; }
    if (!/^est_[a-f0-9]{24}$/.test(entry.establishment_id ?? '')) errors.push(`${where}.establishment_id: formato inválido`);
    if (seen.has(entry.establishment_id)) errors.push(`${where}.establishment_id: duplicado o conflicto`); seen.add(entry.establishment_id);
    if (!nullableText(entry.brand) || !nullableText(entry.public_site_name) || (entry.brand === null && entry.public_site_name === null)) errors.push(`${where}: requiere marca, sede pública o ambas`);
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
  }
  return [...new Set(errors)];
}

export function loadValidatedCommercialCatalog(catalogPath, schemaPath) { const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')); const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')); const errors = validateCommercialCatalog(catalog, schema); if (errors.length) throw new Error(`Catálogo comercial fuera del contrato Gate 2.3:\n- ${errors.join('\n- ')}`); return catalog; }
export function emptyCommercialCatalog() { return { schema_version: '1.1.0', catalog_id: 'commercial-identity-catalog-pending', anchor_scheme: OFFICIAL_ANCHOR_SCHEME, entries: [] }; }
export function isPublicCommercialEntry(entry) { return entry.entity_link.status === 'verified' && entry.publication.status === 'publishable'; }
export function buildCommercialCatalogIndex(catalog, establishmentIds) {
  const universe = new Set(establishmentIds); const byAnchor = new Map(); let pending = 0;
  const unknown = catalog.entries.filter((entry) => !universe.has(entry.establishment_id)); if (unknown.length) throw new Error(`Catálogo comercial contiene establishment_id fuera de la unión contractual: ${unknown.length}`);
  for (const entry of catalog.entries) if (isPublicCommercialEntry(entry)) byAnchor.set(entry.establishment_id, Object.freeze({ brand: entry.brand, public_site_name: entry.public_site_name })); else pending += 1;
  return Object.freeze({ byAnchor, metrics: Object.freeze({ entries: catalog.entries.length, projected: byAnchor.size, pending, unknown_anchors: 0 }) });
}
