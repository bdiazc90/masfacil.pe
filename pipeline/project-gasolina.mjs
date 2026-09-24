#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSeed } from '../app/bootstrap-seed.mjs';
import { readActivePointer } from '../app/snapshot-manifest.mjs';
import { buildGasolinaProducts, GASOLINA_PRODUCTS } from './gasolina-products.mjs';
import { GASOLINA_KEYS, GASOLINA_MANIFEST_VERSION, GASOLINA_SCOPE, sha256, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from './gasolina-contract.mjs';
import { buildCommercialCatalogIndex, staleBrandEvidence } from '../app/commercial-catalog.mjs';
import { brandAccreditationGroups } from '../app/commercial-audit.mjs';
import { absentCommercialResolution, commercialIdentityReport, resolveCommercialIdentity } from '../app/commercial-resolution.mjs';
import { brandAssetFor } from '../web/brand-logos.js';
import { GASOLINA } from '../web/lib/catalog.js';
import { filterFreshOffers } from '../web/lib/freshness.js';
import { selectOfferPrice } from '../web/lib/price-source.js';
import { resolveFacilitoLayer } from './facilito/link.mjs';
import { facilitoRunCounts, facilitoStateForProducts, facilitoStateId, facilitoUnitInstants, readFacilitoState, writeFacilitoRevision } from './facilito/state.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stable = (value) => `${JSON.stringify(value)}\n`;

// Cuántos precios saldrían de cada fuente ahora mismo. Es una foto del momento
// de componer, no un guardrail: el cliente vuelve a decidir con su propio reloj
// y puede llegar a otra respuesta perfectamente válida horas después.
function preciosEfectivos(offers, cutoffAt, now) {
  const reloj = () => new Date(Math.max(now, Date.parse(cutoffAt)));
  const cuenta = { facilito: 0, csv: 0, none: 0 };
  for (const offer of offers) cuenta[selectOfferPrice(offer, { now: reloj, cutoffAt }).source ?? 'none'] += 1;
  return cuenta;
}

function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o644, flag: 'wx' });
  fs.renameSync(temp, file);
}

function active(root) {
  const pointer = readActivePointer(root);
  if (!pointer) throw new Error('No hay pointer de snapshot activo; no hay nada que proyectar');
  return pointer;
}

/**
 * Los dos campos temporales que el bundle público publica.
 *
 * Un snapshot nuevo los declara en su pointer. Uno anterior a este cambio los
 * lleva en su dataset legado y se leen de ahí tal cual, sin validarlos contra
 * un schema que ya no existe: el objetivo es poder revertir a él, no revivir el
 * experimento.
 */
export function temporalContextForPointer(root = rootFromModule, pointer) {
  const declarado = pointer?.temporal_context;
  if (declarado?.cutoff_at && declarado?.source_max_reported_at) {
    return { cutoff_at: declarado.cutoff_at, source_max_reported_at: declarado.source_max_reported_at, snapshot_date: declarado.snapshot_date ?? pointer.snapshot_date };
  }
  if (!pointer?.dataset_path) throw new Error(`Snapshot ${pointer?.snapshot_id ?? 'sin identificador'} sin temporal_context ni dataset legado`);
  const legado = JSON.parse(fs.readFileSync(path.join(root, pointer.dataset_path), 'utf8'))?.temporal_context ?? {};
  if (!legado.cutoff_at || !legado.source_max_reported_at) throw new Error(`Dataset legado de ${pointer.snapshot_id} sin contexto temporal utilizable`);
  return { cutoff_at: legado.cutoff_at, source_max_reported_at: legado.source_max_reported_at, snapshot_date: legado.snapshot_date ?? pointer.snapshot_date };
}

export function resolveGasolinaRaw(root, pointer) {
  const declared = pointer.lineage?.raw?.sha256;
  const declaredPath = pointer.lineage?.paths?.raw_path && path.join(root, pointer.lineage.paths.raw_path);
  if (declaredPath && fs.existsSync(declaredPath) && fs.statSync(declaredPath).isFile()) return declaredPath;
  if (!declared) throw new Error('Pointer sin lineage raw verificable para gasolina');
  const snapshots = path.join(root, '.local-cache', 'snapshots');
  for (const entry of fs.readdirSync(snapshots, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(snapshots, entry.name, 'snapshot-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const candidate = path.join(snapshots, entry.name, 'acquired', 'price-liquid', 'CL-Registro-precios-DMA-V-CCA-CCE.csv');
    if (manifest.lineage?.raw?.sha256 === declared && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error('No existe raw cuyo lineage coincida con el pointer');
}

function optionalSeed(root) {
  const encoded = path.join(root, '.local-cache', 'publish', 'bootstrap-seed.b64');
  if (!fs.existsSync(encoded)) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap', 'seed.manifest.json'), 'utf8'));
  return decodeSeed(fs.readFileSync(encoded, 'utf8'), manifest);
}

export async function buildGasolinaProjectionCandidate({ pointer, temporalContext, sources = null, minimizedRoot, rawPath, bootstrapSeed = null, commercialResolution = absentCommercialResolution(), facilitoState = null, now = Date.now() }) {
  // La identidad comercial ya no es una puerta: llega resuelta, con lo que tiene
  // respaldo y lo que no. Antes esta función empezaba comprobando la auditoría y
  // un nombre pendiente impedía construir un solo precio.
  const commercialCatalog = commercialResolution.catalog;
  const commercialAudit = commercialResolution.audit;
  const input = {
    cutoffAt: temporalContext.cutoff_at,
    snapshotId: pointer.snapshot_id,
    sourceMaxReportedAt: temporalContext.source_max_reported_at,
    sourceUrl: pointer.source_url,
  };
  // Regular y Premium salen de las mismas tablas y de UNA sola pasada por el
  // original de 1,2 GB: la identidad de un ID3 no depende del producto.
  const { results } = await buildGasolinaProducts({ ...input, sources, minimizedRoot, rawPath, bootstrapSeed, productKeys: GASOLINA_KEYS });
  const brandGroups = brandAccreditationGroups(commercialCatalog, commercialAudit);
  const catalogIndex = buildCommercialCatalogIndex(commercialCatalog, {
    registryIds: GASOLINA_KEYS.flatMap((key) => [...results[key].registryAnchors]),
    offerIds: GASOLINA_KEYS.flatMap((key) => results[key].offers.map((offer) => offer.establishment_id)),
  });
  // La consulta web se resuelve aquí, con el vínculo exacto que salió de la
  // misma fila del original que dio el precio publicado. Es una CAPA: el precio
  // y la fecha del CSV viajan intactos al lado, porque el respaldo tiene que
  // funcionar cuando la consulta venza y el cliente esté sin red.
  const facilitoLayers = Object.fromEntries(GASOLINA_KEYS.map((key) => [key, resolveFacilitoLayer({ state: facilitoState, linkKeys: results[key].linkKeys, product: key, now })]));
  // La revisión sale del contenido, no de un sufijo que había que subir a mano y
  // que se olvidaba: mismo contenido, misma revisión; contenido distinto,
  // revisión nueva, y los snapshots siguen siendo inmutables porque un contenido
  // distinto aterriza en otra ruta.
  //
  // Del hash se excluye solo `revision_id`, que es el único campo circular. No
  // se excluye nada más: un campo fuera del hash pero variable en el body daría
  // misma revisión con bytes distintos, y esa ruta la cachean los clientes un
  // año como inmutable.
  const contenido = (key) => ({
    schema_version: GASOLINA_MANIFEST_VERSION,
    product: { key, canonical: GASOLINA_PRODUCTS[key].canonical, label: GASOLINA_PRODUCTS[key].label, display_unit: GASOLINA_PRODUCTS[key].unit },
    scope: GASOLINA_SCOPE,
    snapshot_date: pointer.snapshot_date,
    cutoff_at: input.cutoffAt,
    source_max_reported_at: input.sourceMaxReportedAt,
    provenance: { source: 'Osinergmin', source_url: pointer.source_url, attribution: 'Datos de precios y coordenadas: Osinergmin.' },
    offers: results[key].offers.map((offer) => ({ ...offer, commercial_identity: catalogIndex.byAnchor.get(offer.establishment_id) ?? null, facilito: facilitoLayers[key].byOfferId.get(offer.id) ?? null })),
  });
  // Una sola huella para los dos productos: el contrato exige que regular y
  // premium declaren la misma revisión.
  const revisionId = `gasolina-${pointer.snapshot_id}-${sha256(GASOLINA_KEYS.map((key) => stable(contenido(key))).join('')).slice(0, 12)}`;
  const datasets = {};
  const bodies = {};
  const descriptors = {};
  for (const key of GASOLINA_KEYS) {
    const data = {
      schema_version: GASOLINA_MANIFEST_VERSION,
      revision_id: revisionId,
      ...contenido(key),
    };
    const body = stable(data);
    const relative = `${GASOLINA.dataRoot}/snapshots/${revisionId}/${key}.json`;
    datasets[key] = data;
    bodies[key] = body;
    descriptors[key] = { canonical_product: GASOLINA_PRODUCTS[key].canonical, label: GASOLINA_PRODUCTS[key].label, dataset_url: relative, bytes: Buffer.byteLength(body), sha256: sha256(body), cutoff_at: input.cutoffAt };
  }
  const manifest = { schema_version: GASOLINA_MANIFEST_VERSION, revision_id: revisionId, scope: GASOLINA_SCOPE, products: descriptors, generated_at: pointer.promoted_at };
  // El expediente guarda también otros combustibles; el estado de Gasolina
  // cuenta solo sus unidades, para que el preflight no compare las ajenas.
  const facilitoPropio = facilitoStateForProducts(facilitoState, GASOLINA_KEYS);
  const refreshState = {
    schema_version: GASOLINA_MANIFEST_VERSION,
    revision_id: revisionId,
    // Declarado, no deducido del identificador: recortarlo nunca funcionó y
    // apagaba en silencio los guardrails de caída.
    snapshot_id: pointer.snapshot_id,
    validators: pointer.validators,
    source_max_reported_at: input.sourceMaxReportedAt,
    products: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, { ...results[key].metrics, cutoff_at: input.cutoffAt }])),
    // Captura, vínculos y precios efectivos se miden por separado a propósito:
    // un respaldo CSV que funciona no es un scraping que funcionó, y mezclarlos
    // haría que una corrida sin una sola consulta pareciera exitosa. El embudo
    // de arriba sigue midiendo lo mismo de siempre, con el reloj del snapshot,
    // para que los guardrails de caída comparen manzanas con manzanas.
    facilito: {
      contract: facilitoState?.contract ?? 'sin-captura',
      state_id: facilitoStateId(facilitoPropio),
      // La hora de CADA unidad, no solo la más reciente: es lo que permite al
      // preflight ver que un distrito retrocede aunque el máximo suba.
      units_observed: facilitoUnitInstants(facilitoPropio),
      units: facilitoRunCounts(facilitoPropio),
      districts: new Set(Object.values(facilitoPropio?.units ?? {}).map((unidad) => unidad.district_code)).size,
      linked: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, facilitoLayers[key].counts.linked])),
      ambiguous: GASOLINA_KEYS.reduce((total, key) => total + facilitoLayers[key].counts.ambiguous, 0),
      unlinked: GASOLINA_KEYS.reduce((total, key) => total + facilitoLayers[key].counts.unlinked, 0),
      effective: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, preciosEfectivos(contenido(key).offers, input.cutoffAt, now)])),
    },
  };
  const errors = [...validateGasolinaManifest(manifest), ...validateGasolinaRefreshState(refreshState, manifest)];
  for (const key of GASOLINA_KEYS) errors.push(...validateGasolinaBundle(manifest, key, bodies[key]));
  if (errors.length) throw new Error(`Contrato gasolina inválido: ${[...new Set(errors)].join('; ')}`);
  // Cada identidad sin oferta viene con la etapa en la que se perdió por producto:
  // Regular y Premium pueden caerse por motivos distintos, así que se anotan los dos.
  const catalogWithoutOffer = catalogIndex.withoutOffer.map((id) => Object.fromEntries([['id', id], ...GASOLINA_KEYS.map((key) => [key, results[key].exclusions.get(id) ?? 'fuera_del_registro_del_producto'])]));
  return { manifest, refreshState, datasets, bodies, results, facilitoState, facilitoLayers, composedAt: now, identity: commercialIdentityReport(commercialResolution), isolatedEntries: commercialResolution.isolated ?? [], catalog: catalogIndex.metrics, catalogWithoutOffer, catalogUnknownAnchors: catalogIndex.unknownAnchors, brandGroups: brandGroups.groups, brandEvidenceQueue: staleBrandEvidence(commercialCatalog), bytes: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, descriptors[key].bytes])) };
}

/** Dónde vive el expediente. `IDENTITY_ROOT` permite trabajar sobre una copia. */
export function commercialIdentityRoot(root, identityRoot = process.env.IDENTITY_ROOT) {
  return identityRoot ? path.resolve(root, identityRoot) : path.join(root, '.local-cache', 'identity');
}

export function loadCommercialPublicationInputs(root, { identityRoot } = {}) {
  const identidad = commercialIdentityRoot(root, identityRoot);
  return {
    commercialResolution: resolveCommercialIdentity({
      catalogPath: path.join(identidad, 'commercial-identity-catalog.json'),
      auditPath: path.join(identidad, 'commercial-identity-audit.json'),
    }),
  };
}

/**
 * ¿Hay un snapshot privado con el que reproyectar sin consultar la fuente?
 *
 * Una reproyección forzada —cambio de contrato, de catálogo o de código— no
 * necesita precios nuevos. Antes pagaba igual el sondeo a Osinergmin y, sin
 * caché, la descarga completa. Si falta un input se dice cuál, y quien llama
 * cae al refresco. No se reproyecta un snapshot más viejo que el publicado.
 */
export function usablePrivateSnapshot(root = rootFromModule, { publishedSnapshotId = null } = {}) {
  let pointer;
  try { pointer = readActivePointer(root); } catch (error) { return { ok: false, snapshot_id: null, missing: [`pointer activo: ${error.message}`] }; }
  if (!pointer) return { ok: false, snapshot_id: null, missing: ['pointer activo ausente (.local-cache/snapshots/active.json)'] };
  const missing = [];
  const dir = path.join(root, '.local-cache', 'snapshots', pointer.snapshot_id);
  if (!fs.existsSync(path.join(dir, 'snapshot-manifest.json'))) missing.push('snapshot-manifest.json');
  if (!fs.existsSync(path.join(dir, 'minimized'))) missing.push('minimized/');
  try { resolveGasolinaRaw(root, pointer); } catch (error) { missing.push(`raw: ${error.message}`); }
  if (publishedSnapshotId && pointer.snapshot_id < publishedSnapshotId) missing.push(`snapshot ${pointer.snapshot_id} anterior al publicado ${publishedSnapshotId}`);
  return { ok: !missing.length, snapshot_id: pointer.snapshot_id, missing };
}

/**
 * @param {object} [entrada]
 * @param {object|null} [entrada.facilitoState]  estado a usar; `undefined` lee el
 *   activo. El rollback pasa el de SU revisión: recuperar una entrega de ayer y
 *   pintarle los precios de hoy sería inventar una revisión que nunca existió.
 */
export async function buildGasolinaProjectionForPointer({ root = rootFromModule, pointer, bootstrapSeed, identityRoot, facilitoState, facilitoRoot, now } = {}) {
  return buildGasolinaProjectionCandidate({
    pointer,
    temporalContext: temporalContextForPointer(root, pointer),
    minimizedRoot: path.join(root, '.local-cache', 'snapshots', pointer.snapshot_id, 'minimized'),
    rawPath: resolveGasolinaRaw(root, pointer),
    bootstrapSeed: bootstrapSeed === undefined ? optionalSeed(root) : bootstrapSeed,
    facilitoState: facilitoState === undefined ? readFacilitoState(root, { facilitoRoot }) : facilitoState,
    ...(now === undefined ? {} : { now }),
    ...loadCommercialPublicationInputs(root, { identityRoot }),
  });
}

export function writeGasolinaProjection(candidate, { root = rootFromModule, outputRoot = path.join(root, 'web', 'data', 'gasolina'), identityRoot, facilitoRoot } = {}) {
  for (const key of GASOLINA_KEYS) {
    const target = path.join(root, 'web', candidate.manifest.products[key].dataset_url);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== candidate.bodies[key]) throw new Error(`Snapshot inmutable ya existe con bytes distintos: ${target}`);
    if (!fs.existsSync(target)) atomic(target, candidate.bodies[key]);
  }
  // El estado que compuso esta revisión se sella antes del manifest, junto a
  // los snapshots inmutables: es la referencia privada inequívoca y recuperable
  // que el rollback necesita para no mezclar la captura de otra entrega.
  if (candidate.facilitoState) writeFacilitoRevision(root, candidate.manifest.revision_id, candidate.facilitoState, { facilitoRoot, composedAt: candidate.composedAt });
  atomic(path.join(outputRoot, 'refresh-state.json'), stable(candidate.refreshState));
  atomic(path.join(outputRoot, 'manifest.json'), stable(candidate.manifest));
  writeCommercialCoverage(candidate, root, identityRoot);
  return candidate;
}

/**
 * La marca tal como llega a la tarjeta, contada por establecimiento único
 * —Regular y Premium no son dos grifos— y por producto. El precio vigente y el
 * vencido se separan con el reloj del propio snapshot (`cutoff_at`), así que dos
 * proyecciones del mismo snapshot se comparan sin que el día de la corrida
 * mueva nada. `svg` dice si el registro del cliente tiene con qué pintarla.
 */
export function brandCoverage(datasets) {
  const universo = new Set();
  const conMarca = new Set();
  const porMarca = new Map();
  for (const key of GASOLINA_KEYS) {
    const { offers, cutoff_at: cutoffAt } = datasets[key];
    const { offers: vigentes, expired: vencidas } = filterFreshOffers(offers, { now: () => cutoffAt, cutoffAt });
    for (const [estado, lista] of [['vigentes', vigentes], ['vencidas', vencidas]]) {
      for (const offer of lista) {
        universo.add(offer.establishment_id);
        const brand = offer.commercial_identity?.brand;
        if (!brand) continue;
        conMarca.add(offer.establishment_id);
        const grupo = porMarca.get(brand) ?? { brand, svg: Boolean(brandAssetFor({ brand })), ids: new Set(), vigentes: new Set(), productos: Object.fromEntries(GASOLINA_KEYS.map((k) => [k, { vigentes: 0, vencidas: 0 }])) };
        grupo.ids.add(offer.establishment_id);
        if (estado === 'vigentes') grupo.vigentes.add(offer.establishment_id);
        grupo.productos[key][estado] += 1;
        porMarca.set(brand, grupo);
      }
    }
  }
  const marcas = [...porMarca.values()].sort((a, b) => b.ids.size - a.ids.size || a.brand.localeCompare(b.brand));
  return {
    clock: 'cutoff_at',
    establishments: universo.size,
    with_brand: conMarca.size,
    without_brand: universo.size - conMarca.size,
    brands_with_svg: marcas.filter((m) => m.svg).length,
    brands_without_svg: marcas.filter((m) => !m.svg).map((m) => m.brand),
    by_brand: marcas.map((m) => ({ brand: m.brand, svg: m.svg, establishments: m.ids.size, with_current_price: m.vigentes.size, only_expired_price: m.ids.size - m.vigentes.size, ...m.productos })),
  };
}

// Lo que el expediente dejó sin acreditar: conteos por motivo. Solo existe
// donde se construye el catálogo; en CI no hay expediente y queda en null.
function brandPending(identidad) {
  const leer = (nombre) => { const file = path.join(identidad, nombre); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; };
  const evidencia = leer('brand-evidence.json');
  const catalogo = leer('brand-conflicts.json');
  if (!evidencia && !catalogo) return null;
  const porMotivo = {};
  for (const fila of evidencia?.resumen ?? []) {
    for (const [motivo, n] of Object.entries(fila.pendientes ?? { conflicto: fila.conflictos ?? 0, sin_corroborar: fila.sin_corroborar ?? 0 })) porMotivo[motivo] = (porMotivo[motivo] ?? 0) + n;
  }
  return {
    by_reason: porMotivo,
    directory_conflicts: evidencia?.conflictos?.length ?? 0,
    catalog_conflicts: catalogo?.conflictos?.length ?? 0,
  };
}

// Las identidades acreditadas que hoy no tienen oferta vigente no se borran ni
// se publican: quedan anotadas en la caché privada para poder revisarlas.
export function writeCommercialCoverage(candidate, root = rootFromModule, identityRoot) {
  const file = path.join(root, '.local-cache', 'publish', 'commercial-identity-coverage.json');
  const report = {
    revision_id: candidate.manifest.revision_id,
    generated_at: candidate.manifest.generated_at,
    identity: candidate.identity ?? null,
    isolated_entries: candidate.isolatedEntries ?? [],
    metrics: candidate.catalog,
    without_current_offer: candidate.catalogWithoutOffer ?? [],
    unknown_anchors: candidate.catalogUnknownAnchors ?? [],
    brand_groups: candidate.brandGroups ?? [],
    brand_evidence_review_queue: candidate.brandEvidenceQueue ?? [],
    brand_coverage: candidate.datasets ? brandCoverage(candidate.datasets) : null,
    brand_pending: brandPending(commercialIdentityRoot(root, identityRoot)),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return file;
}

/**
 * Compone sin escribir.
 *
 * Existe porque desde el contrato 2.7.0 hay que mirar la composición ANTES de
 * decidir si se publica: con el CSV sin cambios, lo único que puede justificar
 * una entrega nueva es que la consulta web mueva algún precio efectivo, y eso
 * no se sabe hasta haberla compuesto.
 */
export async function composeGasolinaProjection({ root = rootFromModule, identityRoot, facilitoRoot } = {}) {
  return buildGasolinaProjectionForPointer({ root, pointer: active(root), identityRoot, facilitoRoot });
}

export async function projectGasolina({ root = rootFromModule, outputRoot = path.join(root, 'web', 'data', 'gasolina'), identityRoot, facilitoRoot } = {}) {
  const candidate = await composeGasolinaProjection({ root, identityRoot, facilitoRoot });
  return writeGasolinaProjection(candidate, { root, outputRoot, identityRoot, facilitoRoot });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) projectGasolina()
  .then((result) => process.stdout.write(`Proyección gasolina: Regular ${result.datasets.regular.offers.length} · Premium ${result.datasets.premium.offers.length} · ${result.bytes.regular}/${result.bytes.premium} bytes · identidad ${result.catalog.projected}/${result.catalog.entries} publicadas, ${result.catalog.projected_with_brand} con marca (${result.catalog.with_brand_evidence} con expediente), ${result.catalog.without_current_offer} sin reporte en el Registro\n`))
  .catch((error) => { process.stderr.write(`No se publicó gasolina: ${error.message}\n`); process.exitCode = 1; });
