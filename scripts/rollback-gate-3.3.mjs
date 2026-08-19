#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollbackSnapshot } from '../app/snapshot-refresh.mjs';
import { loadValidatedDataset } from '../app/contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotId = process.argv[2];
if (!snapshotId) throw new Error('Uso: node scripts/rollback-gate-3.3.mjs <snapshot-id>');
const pointer = rollbackSnapshot(root, snapshotId, undefined, (candidate) => {
  loadValidatedDataset(candidate.dataset_absolute_path ?? path.join(root, candidate.dataset_path), path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json'));
});
process.stdout.write(`${JSON.stringify({ status: 'rolled_back', active_snapshot: pointer.snapshot_id, dataset_path: pointer.dataset_path }, null, 2)}\n`);
