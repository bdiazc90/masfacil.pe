#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.argv[2];
const output = path.join(root, 'web', 'data', 'gasolina', 'refresh-state.json');
const localHttp = process.env.GATE_4_3_TEST_MODE === '1' && /^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/.test(baseUrl ?? '');
if (!baseUrl || (!/^https:\/\//.test(baseUrl) && !localHttp)) throw new Error('Se requiere URL HTTPS de Pages (HTTP solo en test local)');

const base = new URL(baseUrl);
if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
async function get(relative) {
  const response = await fetch(new URL(relative, base), { redirect: 'error', headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new Error('Bootstrap público de Pages ausente: el workflow posterior requiere manifest.json, snapshot y refresh-state.json ya publicados. Ejecuta el bootstrap manual verificado de README antes de activar este workflow.');
  if (!response.ok) throw new Error(`No se pudo descargar ${relative}: HTTP ${response.status}`);
  return response.text();
}
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

const manifest = JSON.parse(await get('data/gasolina/manifest.json'));
const manifestErrors = validateGasolinaManifest(manifest);
if (manifestErrors.length) throw new Error(`Manifest remoto inválido: ${manifestErrors.join('; ')}`);
const stateText = await get('data/gasolina/refresh-state.json'); const state = JSON.parse(stateText); const stateErrors = validateGasolinaRefreshState(state, manifest);
if (stateErrors.length) throw new Error(`Refresh-state remoto inválido: ${stateErrors.join('; ')}`);
atomicWrite(output, stateText);
process.stdout.write(`${JSON.stringify({ revision_id: manifest.revision_id, refresh_state: true, snapshot_downloaded: false })}\n`);
