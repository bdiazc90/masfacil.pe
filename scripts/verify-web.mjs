#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const dataRoot = path.join(root, 'web', 'data', 'gasolina'); const manifestPath = path.join(dataRoot, 'manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error('Falta web/data/gasolina/manifest.json; ejecuta npm run project:gasolina');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); const errors = validateGasolinaManifest(manifest); const refreshPath = path.join(dataRoot, 'refresh-state.json');
if (!fs.existsSync(refreshPath)) errors.push('falta refresh-state gasolina'); else errors.push(...validateGasolinaRefreshState(JSON.parse(fs.readFileSync(refreshPath, 'utf8')), manifest));
for (const key of GASOLINA_KEYS) { const descriptor = manifest.products?.[key]; const snapshot = descriptor && path.join(root, 'web', descriptor.dataset_url); if (!snapshot || !fs.existsSync(snapshot)) errors.push(`falta snapshot ${key}`); else errors.push(...validateGasolinaBundle(manifest, key, fs.readFileSync(snapshot, 'utf8'))); }
if (errors.length) throw new Error([...new Set(errors)].join('; ')); process.stdout.write(`Bundles gasolina válidos: ${manifest.revision_id} · Regular ${manifest.products.regular.bytes} bytes · Premium ${manifest.products.premium.bytes} bytes\n`);
