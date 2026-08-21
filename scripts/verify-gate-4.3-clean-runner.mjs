#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.argv[2];
const seedPath = path.join(root, '.local-cache', 'gate-4.3', 'bootstrap-seed.b64');
const statePath = path.join(root, 'web', 'data', 'gasolina', 'refresh-state.json');
if (process.env.GATE_4_3_TEST_MODE !== '1') throw new Error('Esta simulación solo se ejecuta con GATE_4_3_TEST_MODE=1');
if (!raw || !fs.existsSync(raw) || !fs.statSync(raw).isFile()) throw new Error('Uso: GATE_4_3_TEST_MODE=1 node scripts/verify-gate-4.3-clean-runner.mjs <raw-autorizado.csv>');
if (!fs.existsSync(seedPath) || !fs.existsSync(statePath)) throw new Error('Faltan seed autorizado o refresh-state público local para la simulación');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-4.3-clean-runner-'));
const rawBytes = fs.statSync(raw).size;
let requests = 0;

function copyCleanRunner() {
  const generatedData = path.join(root, 'web', 'data');
  fs.cpSync(root, temp, {
    recursive: true,
    filter: (source) => !['.local-cache', 'data'].includes(path.basename(source)) && source !== generatedData && !source.startsWith(`${generatedData}${path.sep}`),
  });
}
function startRawServer({ etag, lastModified }) {
  const server = http.createServer((request, response) => {
    requests += 1;
    const headers = { ETag: etag, 'Last-Modified': lastModified, 'Content-Length': String(rawBytes), 'Content-Type': 'text/csv' };
    if (request.method === 'HEAD') { response.writeHead(200, headers); response.end(); return; }
    if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
    response.writeHead(200, headers); fs.createReadStream(raw).pipe(response);
  });
  server.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => ({ server, url: `http://127.0.0.1:${server.address().port}/liquid.csv` }));
}
function runRefresh(environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/refresh-gate-3.3.mjs'], { cwd: temp, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject); child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}
function parseJson(result) {
  if (!result.stdout) throw new Error(`Refresco sin salida JSON: ${result.stderr}`);
  return JSON.parse(result.stdout);
}
function runNode(args) {
  const result = spawnSync(process.execPath, args, { cwd: temp, env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${args.join(' ')} falló: ${result.stderr || result.stdout}`);
  return result;
}

try {
  process.stderr.write('clean-runner: preparando clon temporal\n');
  copyCleanRunner();
  process.stderr.write('clean-runner: suite sin caché ni bundle generado\n');
  runNode(['--test']);
  const reference = path.join(temp, 'reference');
  const seed = fs.readFileSync(seedPath, 'utf8');
  const installed = spawnSync(process.execPath, ['scripts/install-gate-4.3-bootstrap-seed.mjs', '--target', reference], { cwd: temp, env: { ...process.env, GATE_4_3_BOOTSTRAP_SEED_B64: seed }, encoding: 'utf8' });
  if (installed.status !== 0) throw new Error(`No se instaló el seed: ${installed.stderr}`);
  const publicState = path.join(temp, 'refresh-state.json');
  fs.copyFileSync(statePath, publicState);
  process.stderr.write('clean-runner: changed descarga y valida el raw completo\n');
  const { server, url } = await startRawServer({ etag: '"gate-4.3-changed"', lastModified: 'Wed, 20 Aug 2026 12:28:58 GMT' });
  try {
    const changed = await runRefresh({ GATE_4_3_TEST_MODE: '1', GATE_4_3_TEST_SOURCE_URL: url, GATE_4_3_REFRESH_STATE_PATH: publicState, GATE_4_3_REFERENCE_MINIMIZED_ROOT: reference });
    const changedResult = parseJson(changed);
    if (changed.status !== 0 || changedResult.status !== 'promoted' || changedResult.public_projection_validated !== true) throw new Error(`Changed no promovió el par validado: ${changed.status} / ${changedResult.status}`);
    if (changedResult.gasolina?.products?.regular?.offers !== 714 || changedResult.gasolina?.products?.premium?.offers !== 700) throw new Error('Changed no construyó el par esperado Regular 714 / Premium 700');
    if (changedResult.download?.bytes !== rawBytes) throw new Error('Changed no verificó los bytes completos del raw');
  } finally { server.close(); await once(server, 'close'); }
  runNode(['pipeline/project-gasolina.mjs']);
  runNode(['scripts/verify-web.mjs']);
  const projectedState = path.join(temp, 'web', 'data', 'gasolina', 'refresh-state.json');
  const projectedManifest = path.join(temp, 'web', 'data', 'gasolina', 'manifest.json');
  const state = JSON.parse(fs.readFileSync(projectedState, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(projectedManifest, 'utf8'));
  if (state.revision_id !== manifest.revision_id || !state.products.regular || !state.products.premium) throw new Error('Manifest y refresh-state no publican el mismo par');
  const beforeUnchanged = requests;
  process.stderr.write('clean-runner: unchanged valida solo HEAD\n');
  const validators = state.validators;
  const { server: unchangedServer, url: unchangedUrl } = await startRawServer({ etag: validators.etag, lastModified: validators.last_modified });
  try {
    const unchanged = await runRefresh({ GATE_4_3_TEST_MODE: '1', GATE_4_3_TEST_SOURCE_URL: unchangedUrl, GATE_4_3_REFRESH_STATE_PATH: projectedState, GATE_4_3_REFERENCE_MINIMIZED_ROOT: reference });
    const unchangedResult = parseJson(unchanged);
    if (unchanged.status !== 0 || unchangedResult.status !== 'unchanged' || unchangedResult.downloaded !== false) throw new Error(`Unchanged no conservó cero descarga: exit=${unchanged.status}; status=${unchangedResult.status}; downloaded=${unchangedResult.downloaded}`);
  } finally { unchangedServer.close(); await once(unchangedServer, 'close'); }
  if (requests - beforeUnchanged !== 1) throw new Error('Unchanged hizo más de un HEAD o descargó un cuerpo');
  const rejected = await runRefresh({ GATE_4_3_TEST_MODE: '1', GATE_4_3_TEST_SOURCE_URL: 'http://127.0.0.1:9/unreachable', GATE_4_3_REFRESH_STATE_PATH: path.join(temp, 'missing-state.json'), GATE_4_3_REFERENCE_MINIMIZED_ROOT: reference });
  if (rejected.status !== 1 || !/refresh-state público para bootstrap limpio/.test(rejected.stderr)) throw new Error('Ausencia de refresh-state no falló cerrado');
  process.stdout.write(`${JSON.stringify({ clean_runner: true, clean_tests: true, changed: { regular: 714, premium: 700, raw_bytes: rawBytes, pair_promoted: true, deploy_ready: true }, unchanged: { source_requests: 1, raw_bytes: 0, deploy: false }, rejected: { deploy: false }, private_seed_logged: false })}\n`);
} finally {
  process.stderr.write('clean-runner: eliminando temporal\n');
  fs.rmSync(temp, { recursive: true, force: true });
}
