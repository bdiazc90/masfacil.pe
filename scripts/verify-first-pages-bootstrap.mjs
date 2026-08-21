#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
const data = path.join(web, 'data', 'gasolina');
const legacyData = path.join(web, 'data');
const requiredShell = ['index.html', 'app.js', 'service-worker-ready.js', 'sw.js', '_headers', 'manifest.webmanifest'];
for (const file of requiredShell) if (!fs.existsSync(path.join(web, file))) throw new Error(`Bootstrap Pages incompleto: falta web/${file}`);
for (const legacy of ['manifest.json', 'refresh-state.json']) if (fs.existsSync(path.join(legacyData, legacy))) throw new Error(`Bootstrap Pages rechaza artefacto público legacy: web/data/${legacy}`);
const legacySnapshots = path.join(legacyData, 'snapshots'); if (fs.existsSync(legacySnapshots) && fs.readdirSync(legacySnapshots).length) throw new Error('Bootstrap Pages rechaza artefactos públicos legacy: web/data/snapshots/');
const manifestFile = path.join(data, 'manifest.json');
const refreshFile = path.join(data, 'refresh-state.json');
if (!fs.existsSync(manifestFile) || !fs.existsSync(refreshFile)) throw new Error('Bootstrap Pages incompleto: ejecuta npm run project:gasolina y npm run verify:web antes del primer Direct Upload');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const manifestErrors = validateGasolinaManifest(manifest);
if (manifestErrors.length) throw new Error(`Bootstrap Pages incompleto: manifest inválido: ${manifestErrors.join('; ')}`);
const bundleErrors = GASOLINA_KEYS.flatMap((key) => { const snapshot = path.join(web, manifest.products[key].dataset_url); return fs.existsSync(snapshot) ? validateGasolinaBundle(manifest, key, fs.readFileSync(snapshot, 'utf8')) : [`falta ${manifest.products[key].dataset_url}`]; });
const refresh = JSON.parse(fs.readFileSync(refreshFile, 'utf8')); const refreshErrors = validateGasolinaRefreshState(refresh, manifest);
if (bundleErrors.length || refreshErrors.length) throw new Error(`Bootstrap Pages incompleto: ${[...bundleErrors, ...refreshErrors].join('; ')}`);
process.stdout.write(`${JSON.stringify({ ready: true, pages_project_recommendation: 'masfacil-pe', public_url_after_upload: 'https://masfacil-pe.pages.dev/gasolina/', revision_id: manifest.revision_id, products: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, manifest.products[key].bytes])), required_upload_root: 'web/' })}\n`);
