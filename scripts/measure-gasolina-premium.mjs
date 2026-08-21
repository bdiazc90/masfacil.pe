#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGasolinaProduct } from '../pipeline/gasolina-products.mjs';
import { decodeSeed } from '../app/gate-4.3-bootstrap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotId = '2026-08-18-20260819T003213952Z-7928-71e6ba'; const snapshot = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', snapshotId);
const privateDataset = JSON.parse(fs.readFileSync(path.join(snapshot, 'dataset', 'experiment-dataset-lima-province.json'), 'utf8'));
const pointer = JSON.parse(fs.readFileSync(path.join(root, '.local-cache', 'gate-3.3', 'active.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap', 'gate-4.3-seed.manifest.json'), 'utf8'));
const bootstrapSeed = decodeSeed(fs.readFileSync(path.join(root, '.local-cache', 'gate-4.3', 'bootstrap-seed.b64'), 'utf8'), manifest);
const rawPath = fs.readdirSync(path.join(root, '.local-cache', 'gate-3.3', 'snapshots'), { recursive: true })
  .map((entry) => path.join(root, '.local-cache', 'gate-3.3', 'snapshots', entry))
  .find((entry) => entry.endsWith('CL-Registro-precios-DMA-V-CCA-CCE.csv') && fs.statSync(entry).isFile());
if (!rawPath) throw new Error('No existe raw privado autorizado para medir Premium');
const result = await buildGasolinaProduct({ productKey: 'premium', minimizedRoot: path.join(snapshot, 'minimized'), rawPath, cutoffAt: privateDataset.temporal_context.cutoff_at, snapshotId, sourceMaxReportedAt: privateDataset.temporal_context.source_max_reported_at, sourceUrl: pointer.source_url, bootstrapSeed });
process.stdout.write(`${JSON.stringify({ product: result.product, ...result.metrics, context: result.context }, null, 2)}\n`);
