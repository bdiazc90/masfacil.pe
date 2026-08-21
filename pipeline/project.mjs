#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidatedDataset } from '../app/contract.mjs';
import { readActivePointer } from '../app/snapshot-manifest.mjs';
import { sha256, validatePublicBundle, validatePublicDataset, validatePublicManifest } from './public-contract.mjs';
import { buildRefreshState, validateRefreshState } from './refresh-state.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateSchemaRelative = 'contracts/gate-1.1-experiment-dataset.schema.json';

function stableJson(value) { return `${JSON.stringify(value)}\n`; }
function atomicWrite(file, content, fsModule = fs) {
  fsModule.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fsModule.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
  fsModule.renameSync(temporary, file);
}

function publicOfferId(snapshotId, experimentalId) { return `pub_${sha256(`${snapshotId}:${experimentalId}`).slice(0, 24)}`; }

export function buildPublicDataset(pointer, dataset) {
  const publicDataset = {
    schema_version: '1.0.0',
    snapshot_id: pointer.snapshot_id,
    dataset_id: `public-gasohol-regular-lima-${pointer.snapshot_date}`,
    product: dataset.scope.product,
    display_unit: dataset.scope.display_unit,
    snapshot_date: dataset.temporal_context.snapshot_date,
    cutoff_at: dataset.temporal_context.cutoff_at,
    source_max_reported_at: dataset.temporal_context.source_max_reported_at,
    provenance: {
      source: 'Osinergmin',
      source_dataset: dataset.offers[0].source.dataset_id,
      source_url: pointer.source_url,
      attribution: 'Datos de precios y coordenadas: Osinergmin.',
    },
    offers: dataset.offers.map((offer) => ({
      id: publicOfferId(pointer.snapshot_id, offer.experimental_id),
      price: offer.price,
      reported_at: offer.price_reported_at,
      district: offer.territory.district,
      longitude: offer.coordinate.longitude,
      latitude: offer.coordinate.latitude,
    })).sort((left, right) => left.id.localeCompare(right.id)),
  };
  const errors = validatePublicDataset(publicDataset);
  if (errors.length) throw new Error(`Proyección pública fuera del contrato:\n- ${errors.join('\n- ')}`);
  return publicDataset;
}

export function projectActiveSnapshot({ root = rootFromModule, outputRoot = path.join(root, 'web', 'data'), fsModule = fs } = {}) {
  const pointer = readActivePointer(root);
  if (!pointer) throw new Error('No existe el pointer activo Gate 3.3; no se publicará un fixture sintético');
  const dataset = loadValidatedDataset(pointer.dataset_absolute_path, path.join(root, privateSchemaRelative));
  if (dataset.temporal_context.snapshot_date !== pointer.snapshot_date) throw new Error('El pointer activo no coincide con el corte del dataset');
  const publicDataset = buildPublicDataset(pointer, dataset);
  const bytes = stableJson(publicDataset);
  const snapshotRelative = `data/snapshots/${pointer.snapshot_id}.json`;
  const snapshotPath = path.join(outputRoot, 'snapshots', `${pointer.snapshot_id}.json`);
  const manifestPath = path.join(outputRoot, 'manifest.json');
  const refreshStatePath = path.join(outputRoot, 'refresh-state.json');
  const manifest = {
    schema_version: '1.0.0', snapshot_id: pointer.snapshot_id, dataset_url: snapshotRelative,
    sha256: sha256(bytes), bytes: Buffer.byteLength(bytes), cutoff_at: publicDataset.cutoff_at,
    generated_at: pointer.promoted_at ?? dataset.temporal_context.acquisition_completed_at,
  };
  const manifestErrors = validatePublicManifest(manifest);
  if (manifestErrors.length) throw new Error(`Manifest público fuera del contrato:\n- ${manifestErrors.join('\n- ')}`);
  if (fsModule.existsSync(snapshotPath)) {
    if (fsModule.readFileSync(snapshotPath, 'utf8') !== bytes) throw new Error(`Snapshot público inmutable ya existe con bytes distintos: ${snapshotPath}`);
  } else atomicWrite(snapshotPath, bytes, fsModule);
  const bundleErrors = validatePublicBundle(manifest, fsModule.readFileSync(snapshotPath, 'utf8'));
  if (bundleErrors.length) throw new Error(`Snapshot público inválido; manifest preservado:\n- ${bundleErrors.join('\n- ')}`);
  const evidencePath = pointer.evidence_path ? path.join(root, pointer.evidence_path) : null;
  if (!evidencePath || !fsModule.existsSync(evidencePath)) throw new Error('Falta evidencia agregada para refresh-state');
  const refreshState = buildRefreshState(pointer, JSON.parse(fsModule.readFileSync(evidencePath, 'utf8')));
  const refreshErrors = validateRefreshState(refreshState, manifest);
  if (refreshErrors.length) throw new Error(`Refresh-state público inválido; manifest preservado:\n- ${refreshErrors.join('\n- ')}`);
  atomicWrite(refreshStatePath, stableJson(refreshState), fsModule);
  atomicWrite(manifestPath, stableJson(manifest), fsModule);
  return Object.freeze({ pointer, dataset: publicDataset, manifest, refreshState, snapshotPath, manifestPath, refreshStatePath, bytes: manifest.bytes, districts: new Set(publicDataset.offers.map((offer) => offer.district)).size });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = projectActiveSnapshot();
    process.stdout.write(`Proyección pública: ${result.dataset.offers.length} ofertas · ${result.districts} distritos · ${result.bytes} bytes\n${result.manifestPath}\n`);
  } catch (error) {
    process.stderr.write(`No se publicó la proyección: ${error.message}\n`);
    process.exitCode = 1;
  }
}
