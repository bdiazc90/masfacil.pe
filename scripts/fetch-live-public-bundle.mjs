#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const baseUrl = process.argv[2]; const output = path.join(root, 'web', 'data', 'gasolina');
const allowed = (url) => /^https:\/\//.test(url ?? '') || (process.env.GATE_4_3_TEST_MODE === '1' && /^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/.test(url ?? ''));
if (!allowed(baseUrl)) throw new Error('Uso: fetch-live-public-bundle.mjs https://<proyecto>.pages.dev (HTTP solo en test local)');
const base = new URL(baseUrl); if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
async function read(relative) { const response = await fetch(new URL(relative, base), { redirect: 'error', headers: { Accept: 'application/json' } }); if (response.status === 404) throw new Error('Bootstrap público de Pages ausente: faltan manifest, refresh-state o snapshots gasolina v2.'); if (!response.ok) throw new Error(`No se pudo descargar ${relative}: HTTP ${response.status}`); return response.text(); }
function atomic(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
const manifestText = await read('data/gasolina/manifest.json'); const manifest = JSON.parse(manifestText); const errors = validateGasolinaManifest(manifest);
const refreshText = await read('data/gasolina/refresh-state.json'); const refresh = JSON.parse(refreshText); errors.push(...validateGasolinaRefreshState(refresh, manifest));
const snapshots = {};
for (const key of GASOLINA_KEYS) { const body = await read(manifest.products[key].dataset_url); errors.push(...validateGasolinaBundle(manifest, key, body)); snapshots[key] = body; }
if (errors.length) throw new Error(`Bundle remoto gasolina inválido: ${[...new Set(errors)].join('; ')}`);
for (const key of GASOLINA_KEYS) { const file = path.join(root, 'web', manifest.products[key].dataset_url); if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== snapshots[key]) throw new Error(`Snapshot inmutable existente no coincide: ${key}`); if (!fs.existsSync(file)) atomic(file, snapshots[key]); }
atomic(path.join(output, 'refresh-state.json'), refreshText); atomic(path.join(output, 'manifest.json'), manifestText);
process.stdout.write(`${JSON.stringify({ revision_id: manifest.revision_id, products: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, manifest.products[key].bytes])), refresh_state: true })}\n`);
