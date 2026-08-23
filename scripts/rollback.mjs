#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollbackSnapshot } from '../app/snapshot-refresh.mjs';
import { writeActivePointer } from '../app/snapshot-manifest.mjs';
import { buildGasolinaProjectionForPointer, writeGasolinaProjection } from '../pipeline/project-gasolina.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotId = process.argv[2];
if (!snapshotId) throw new Error('Uso: npm run rollback -- <snapshot-id>');

const activePath = path.join(root, '.local-cache', 'gate-3.3', 'active.json');
if (!fs.existsSync(activePath)) throw new Error('No existe pointer activo para rollback');
const activeBefore = JSON.parse(fs.readFileSync(activePath, 'utf8'));
const manifestPath = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', snapshotId, 'snapshot-manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Gate 4.3 solo revierte snapshots completos: ${snapshotId}`);
const target = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Ambos productos se reconstruyen y validan antes de mover el pointer privado.
const projection = await buildGasolinaProjectionForPointer({ root, pointer: target });
let rolledBack;
try {
  rolledBack = rollbackSnapshot(root, snapshotId);
  writeGasolinaProjection(projection, { root });
} catch (error) {
  if (rolledBack) writeActivePointer(root, activeBefore);
  throw new Error(`Rollback gasolina abortado sin dejar pointer parcial: ${error.message}`);
}

process.stdout.write(`${JSON.stringify({ status: 'rolled_back', active_before: activeBefore.snapshot_id, active_after: rolledBack.snapshot_id, revision_id: projection.manifest.revision_id, products: Object.fromEntries(Object.entries(projection.datasets).map(([key, value]) => [key, value.offers.length])) })}\n`);
