#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSeed } from '../app/bootstrap-seed.mjs';
import { buildGasolinaProduct, GASOLINA_PRODUCTS } from './gasolina-products.mjs';
import { GASOLINA_KEYS, GASOLINA_MANIFEST_VERSION, GASOLINA_SCOPE, sha256, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from './gasolina-contract.mjs';
import { buildCommercialCatalogIndex, emptyCommercialCatalog, loadValidatedCommercialCatalog } from '../app/commercial-catalog.mjs';
import { assertCommercialPublicationReady, loadValidatedCommercialAudit } from '../app/commercial-audit.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stable = (value) => `${JSON.stringify(value)}\n`;

function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o644, flag: 'wx' });
  fs.renameSync(temp, file);
}

function active(root) {
  const pointer = JSON.parse(fs.readFileSync(path.join(root, '.local-cache', 'gate-3.3', 'active.json'), 'utf8'));
  if (!pointer?.snapshot_id || !pointer.dataset_path) throw new Error('Pointer Gate 3.3 inválido; no se publica fixture');
  return pointer;
}

export function resolveGasolinaRaw(root, pointer) {
  const declared = pointer.lineage?.raw?.sha256;
  const declaredPath = pointer.lineage?.paths?.raw_path && path.join(root, pointer.lineage.paths.raw_path);
  if (declaredPath && fs.existsSync(declaredPath) && fs.statSync(declaredPath).isFile()) return declaredPath;
  if (!declared) throw new Error('Pointer sin lineage raw verificable para gasolina');
  const snapshots = path.join(root, '.local-cache', 'gate-3.3', 'snapshots');
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
  const encoded = path.join(root, '.local-cache', 'gate-4.3', 'bootstrap-seed.b64');
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
  const catalogIndex = buildCommercialCatalogIndex(commercialCatalog, GASOLINA_KEYS.flatMap((key) => results[key].offers.map((offer) => offer.establishment_id)));
  const revisionId = `gasolina-${pointer.snapshot_id}-identity-v1`;
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
  return { manifest, refreshState, datasets, bodies, results, catalog: catalogIndex.metrics, bytes: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, descriptors[key].bytes])) };
}

export function loadCommercialPublicationInputs(root) {
  const catalogPath = path.join(root, '.local-cache', 'gate-2.3', 'commercial-identity-catalog.json');
  const auditPath = path.join(root, '.local-cache', 'gate-2.3', 'commercial-identity-audit.json');
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
    minimizedRoot: path.join(root, '.local-cache', 'gate-3.3', 'snapshots', pointer.snapshot_id, 'minimized'),
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
  return candidate;
}

export async function projectGasolina({ root = rootFromModule, outputRoot = path.join(root, 'web', 'data', 'gasolina') } = {}) {
  const candidate = await buildGasolinaProjectionForPointer({ root, pointer: active(root) });
  return writeGasolinaProjection(candidate, { root, outputRoot });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) projectGasolina()
  .then((result) => process.stdout.write(`Proyección gasolina: Regular ${result.datasets.regular.offers.length} · Premium ${result.datasets.premium.offers.length} · ${result.bytes.regular}/${result.bytes.premium} bytes\n`))
  .catch((error) => { process.stderr.write(`No se publicó gasolina: ${error.message}\n`); process.exitCode = 1; });
