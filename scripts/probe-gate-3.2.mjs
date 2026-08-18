#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SOURCE_URLS } from '../app/source-catalog.mjs';
import { probeSnapshotValidators } from '../app/http-validator-probe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = '2026-08-14';
const sourceId = process.argv[2] ?? 'liquid-current';
const outputPath = process.argv.includes('--output') ? path.resolve(process.argv[process.argv.indexOf('--output') + 1]) : null;
const url = CANONICAL_SOURCE_URLS[sourceId.replaceAll('-', '_')];
const recordsPath = path.join(root, 'data', 'provenance', snapshot, 'acquisitions.jsonl');

if (!url) throw new Error(`Fuente no soportada: ${sourceId}`);
const records = fs.readFileSync(recordsPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const record = records.find((item) => item.source_id === sourceId);
if (!record) throw new Error(`No hay snapshot local last-known-good para ${sourceId}`);
const local = {
  etag: record.response_headers?.etag ?? null,
  last_modified: record.response_headers?.['last-modified'] ?? null,
};
const result = await probeSnapshotValidators({ url, local });
const report = { source_id: sourceId, snapshot_date: snapshot, canonical_url: url, ...result };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
