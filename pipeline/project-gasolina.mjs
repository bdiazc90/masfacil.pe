#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSeed } from '../app/bootstrap-seed.mjs';
import { buildGasolinaProduct, GASOLINA_PRODUCTS } from './gasolina-products.mjs';
import { GASOLINA_KEYS, GASOLINA_MANIFEST_VERSION, GASOLINA_SCOPE, sha256, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from './gasolina-contract.mjs';
import { buildCommercialCatalogIndex, emptyCommercialCatalog, loadValidatedCommercialCatalog, staleBrandEvidence } from '../app/commercial-catalog.mjs';
import { assertCommercialPublicationReady, brandAccreditationGroups, loadValidatedCommercialAudit } from '../app/commercial-audit.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stable = (value) => `${JSON.stringify(value)}\n`;

function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o644, flag: 'wx' });
  fs.renameSync(temp, file);
}

function active(root) {
  const pointer = JSON.parse(fs.readFileSync(path.join(root, '.local-cache', 'snapshots', 'active.json'), 'utf8'));
  if (!pointer?.snapshot_id || !pointer.dataset_path) throw new Error('Pointer de snapshot inválido; no se publica fixture');
  return pointer;
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

export async function buildGasolinaProjectionCandidate({ pointer, privateDataset, minimizedRoot, rawPath, bootstrapSeed = null, commercialCatalog = emptyCommercialCatalog(), commercialAudit = null }) {
  assertCommercialPublicationReady(commercialCatalog, commercialAudit);
  const input = {
    minimizedRoot,
    rawPath,
    cutoffAt: privateDataset.temporal_context.cutoff_at,
    snapshotId: pointer.snapshot_id,
    sourceMaxReportedAt: privateDataset.temporal_context.source_max_reported_at,
    sourceUrl: pointer.source_url,
    bootstrapSeed,
  };
  const results = Object.fromEntries(await Promise.all(GASOLINA_KEYS.map(async (key) => [key, await buildGasolinaProduct({ ...input, productKey: key })])));
  const brandGroups = brandAccreditationGroups(commercialCatalog, commercialAudit);
  const catalogIndex = buildCommercialCatalogIndex(commercialCatalog, {
    registryIds: GASOLINA_KEYS.flatMap((key) => [...results[key].registryAnchors]),
    offerIds: GASOLINA_KEYS.flatMap((key) => results[key].offers.map((offer) => offer.establishment_id)),
    approvedBrandMethods: brandGroups.approved,
  });
  const revisionId = `gasolina-${pointer.snapshot_id}-identity-v4`;
  const datasets = {};
  const bodies = {};
  const descriptors = {};
  for (const key of GASOLINA_KEYS) {
    const result = results[key];
    const data = {
      schema_version: GASOLINA_MANIFEST_VERSION,
      revision_id: revisionId,
      product: { key, canonical: GASOLINA_PRODUCTS[key].canonical, label: GASOLINA_PRODUCTS[key].label, display_unit: 'Galones' },
      scope: GASOLINA_SCOPE,
      snapshot_date: pointer.snapshot_date,
      cutoff_at: input.cutoffAt,
      source_max_reported_at: input.sourceMaxReportedAt,
      provenance: { source: 'Osinergmin', source_url: pointer.source_url, attribution: 'Datos de precios y coordenadas: Osinergmin.' },
      offers: result.offers.map((offer) => ({ ...offer, commercial_identity: catalogIndex.byAnchor.get(offer.establishment_id) ?? null })),
    };
    const body = stable(data);
    const relative = `data/gasolina/snapshots/${revisionId}/${key}.json`;
    datasets[key] = data;
    bodies[key] = body;
    descriptors[key] = { canonical_product: GASOLINA_PRODUCTS[key].canonical, label: GASOLINA_PRODUCTS[key].label, dataset_url: relative, bytes: Buffer.byteLength(body), sha256: sha256(body), cutoff_at: input.cutoffAt };
  }
  const manifest = { schema_version: GASOLINA_MANIFEST_VERSION, revision_id: revisionId, scope: GASOLINA_SCOPE, products: descriptors, generated_at: pointer.promoted_at };
  const refreshState = {
    schema_version: GASOLINA_MANIFEST_VERSION,
    revision_id: revisionId,
    validators: pointer.validators,
    source_max_reported_at: input.sourceMaxReportedAt,
    products: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, { ...results[key].metrics, cutoff_at: input.cutoffAt }])),
  };
  const errors = [...validateGasolinaManifest(manifest), ...validateGasolinaRefreshState(refreshState, manifest)];
  for (const key of GASOLINA_KEYS) errors.push(...validateGasolinaBundle(manifest, key, bodies[key]));
  if (errors.length) throw new Error(`Contrato gasolina inválido: ${[...new Set(errors)].join('; ')}`);
  // Cada identidad sin oferta viene con la etapa en la que se perdió por producto:
  // Regular y Premium pueden caerse por motivos distintos, así que se anotan los dos.
  const catalogWithoutOffer = catalogIndex.withoutOffer.map((id) => Object.fromEntries([['id', id], ...GASOLINA_KEYS.map((key) => [key, results[key].exclusions.get(id) ?? 'fuera_del_registro_del_producto'])]));
  return { manifest, refreshState, datasets, bodies, results, catalog: catalogIndex.metrics, catalogWithoutOffer, brandGroups: brandGroups.groups, brandEvidenceQueue: staleBrandEvidence(commercialCatalog), bytes: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, descriptors[key].bytes])) };
}

export function loadCommercialPublicationInputs(root) {
  const catalogPath = path.join(root, '.local-cache', 'identity', 'commercial-identity-catalog.json');
  const auditPath = path.join(root, '.local-cache', 'identity', 'commercial-identity-audit.json');
  return {
    commercialCatalog: fs.existsSync(catalogPath) ? loadValidatedCommercialCatalog(catalogPath) : emptyCommercialCatalog(),
    commercialAudit: fs.existsSync(auditPath) ? loadValidatedCommercialAudit(auditPath) : null,
  };
}

export async function buildGasolinaProjectionForPointer({ root = rootFromModule, pointer, bootstrapSeed } = {}) {
  const privateDataset = JSON.parse(fs.readFileSync(path.join(root, pointer.dataset_path), 'utf8'));
  return buildGasolinaProjectionCandidate({
    pointer,
    privateDataset,
    minimizedRoot: path.join(root, '.local-cache', 'snapshots', pointer.snapshot_id, 'minimized'),
    rawPath: resolveGasolinaRaw(root, pointer),
    bootstrapSeed: bootstrapSeed === undefined ? optionalSeed(root) : bootstrapSeed,
    ...loadCommercialPublicationInputs(root),
  });
}

export function writeGasolinaProjection(candidate, { root = rootFromModule, outputRoot = path.join(root, 'web', 'data', 'gasolina') } = {}) {
  for (const key of GASOLINA_KEYS) {
    const target = path.join(root, 'web', candidate.manifest.products[key].dataset_url);
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== candidate.bodies[key]) throw new Error(`Snapshot inmutable ya existe con bytes distintos: ${target}`);
    if (!fs.existsSync(target)) atomic(target, candidate.bodies[key]);
  }
  atomic(path.join(outputRoot, 'refresh-state.json'), stable(candidate.refreshState));
  atomic(path.join(outputRoot, 'manifest.json'), stable(candidate.manifest));
  writeCommercialCoverage(candidate, root);
  return candidate;
}

// Las identidades acreditadas que hoy no tienen oferta vigente no se borran ni
// se publican: quedan anotadas en la caché privada para poder revisarlas.
export function writeCommercialCoverage(candidate, root = rootFromModule) {
  const file = path.join(root, '.local-cache', 'publish', 'commercial-identity-coverage.json');
  const report = {
    revision_id: candidate.manifest.revision_id,
    generated_at: candidate.manifest.generated_at,
    metrics: candidate.catalog,
    without_current_offer: candidate.catalogWithoutOffer ?? [],
    brand_groups: candidate.brandGroups ?? [],
    brand_evidence_review_queue: candidate.brandEvidenceQueue ?? [],
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return file;
}

export async function projectGasolina({ root = rootFromModule, outputRoot = path.join(root, 'web', 'data', 'gasolina') } = {}) {
  const candidate = await buildGasolinaProjectionForPointer({ root, pointer: active(root) });
  return writeGasolinaProjection(candidate, { root, outputRoot });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) projectGasolina()
  .then((result) => process.stdout.write(`Proyección gasolina: Regular ${result.datasets.regular.offers.length} · Premium ${result.datasets.premium.offers.length} · ${result.bytes.regular}/${result.bytes.premium} bytes · identidad ${result.catalog.projected}/${result.catalog.entries} publicadas, ${result.catalog.projected_with_brand} con marca, ${result.catalog.projected_with_accredited_brand} con logo, ${result.catalog.without_current_offer} sin reporte en el Registro\n`))
  .catch((error) => { process.stderr.write(`No se publicó gasolina: ${error.message}\n`); process.exitCode = 1; });
