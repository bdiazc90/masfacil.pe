#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidatedDataset, toClientDataset } from '../app/contract.mjs';
import { filterFreshOffers } from '../app/public/freshness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = path.join(root, '.local-cache', 'gate-1.1', '2026-08-14', 'experiment-dataset-lima-province.json');
const schemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const dataset = loadValidatedDataset(datasetPath, schemaPath);
const client = toClientDataset(dataset, 'real');
const result = filterFreshOffers(client.offers, {
  now: () => '2026-08-18T12:00:00.000Z',
  cutoffAt: client.cutoff_at,
});

process.stdout.write(JSON.stringify({
  queried_at: result.queried_at,
  cutoff_at: result.cutoff_at,
  total_offers: result.total_offers,
  fresh_offers: result.fresh_offers,
}, null, 2) + '\n');
