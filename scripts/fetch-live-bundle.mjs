#!/usr/bin/env node

// Recupera el bundle público ya publicado en Pages (manifest, refresh-state y
// los dos snapshots, ~500 KB) y lo deja en web/data/gasolina/ verificado por
// bytes y SHA-256. Así un cambio de shell se despliega reusando los datos
// vigentes sin proyectar ni descargar el raw de Osinergmin.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.argv[2];
const dataRoot = path.join(root, 'web', 'data', 'gasolina');
const localHttp = process.env.TEST_MODE === '1' && /^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/.test(baseUrl ?? '');
if (!baseUrl || (!/^https:\/\//.test(baseUrl) && !localHttp)) throw new Error('Se requiere URL HTTPS de Pages (HTTP solo en test local)');

const base = new URL(baseUrl);
if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;

async function get(relative) {
  const response = await fetch(new URL(relative, base), { redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new Error(`Bundle público ausente en Pages (${relative}): el workflow requiere manifest, refresh-state y snapshots ya publicados`);
  if (!response.ok) throw new Error(`No se pudo descargar ${relative}: HTTP ${response.status}`);
  return response.text();
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

function snapshotTarget(datasetUrl) {
  // El contrato ya restringe dataset_url a data/gasolina/snapshots/<revisión>/<producto>.json;
  // se rechaza además cualquier segmento relativo para que el destino quede dentro de web/.
  if (datasetUrl.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error(`dataset_url con segmentos relativos: ${datasetUrl}`);
  return path.join(root, 'web', datasetUrl);
}

const manifestText = await get('data/gasolina/manifest.json');
const manifest = JSON.parse(manifestText);
const manifestErrors = validateGasolinaManifest(manifest);
if (manifestErrors.length) throw new Error(`Manifest remoto inválido: ${manifestErrors.join('; ')}`);

const stateText = await get('data/gasolina/refresh-state.json');
const stateErrors = validateGasolinaRefreshState(JSON.parse(stateText), manifest);
if (stateErrors.length) throw new Error(`Refresh-state remoto inválido: ${stateErrors.join('; ')}`);

const snapshots = {};
for (const key of GASOLINA_KEYS) {
  const descriptor = manifest.products[key];
  const body = await get(descriptor.dataset_url);
  const errors = validateGasolinaBundle(manifest, key, body);
  if (errors.length) throw new Error(`Snapshot remoto ${key} inválido: ${errors.join('; ')}`);
  snapshots[key] = { target: snapshotTarget(descriptor.dataset_url), body, bytes: descriptor.bytes };
}

// Mismo orden que la proyección: primero snapshots inmutables, el manifest al
// final, para que nunca quede un manifest apuntando a snapshots ausentes.
for (const { target, body } of Object.values(snapshots)) {
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== body) throw new Error(`Snapshot inmutable ya existe con bytes distintos: ${path.relative(root, target)}`);
  if (!fs.existsSync(target)) atomicWrite(target, body);
}
atomicWrite(path.join(dataRoot, 'refresh-state.json'), stateText);
atomicWrite(path.join(dataRoot, 'manifest.json'), manifestText);

process.stdout.write(`${JSON.stringify({
  revision_id: manifest.revision_id,
  refresh_state: true,
  snapshots: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, snapshots[key].bytes])),
  raw_downloaded: false,
})}\n`);
