#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = '2026-08-14';
const dataRoot = path.join(root, 'data');
const provenanceRoot = path.join(dataRoot, 'provenance', snapshot);
const manifestPath = path.join(provenanceRoot, 'integrity-manifest.json');
const cacheRoot = path.join(root, '.local-cache', 'gate-0.2', snapshot);
const expectedSources = ['daily-catalog','dmin-catalog','glp-catalog','glp-current','liquid-catalog','liquid-current','price-documents','ubigeo-catalog','ubigeo-current'];
const evidenceRoots = ['minimized', 'derived', 'provenance'].map((name) => path.join(dataRoot, name, snapshot));

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
async function digest(file) {
  const hash = crypto.createHash('sha256'); let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}
function evidenceFiles() { return evidenceRoots.flatMap(listFiles).filter((file) => file !== manifestPath).sort(); }
function relative(file) { return path.relative(root, file); }
function fail(message) { throw new Error(message); }

async function scanMinimized() {
  const forbiddenHeaders = /(?:^|;)(?:RUC|RAZON_SOCIAL|DIRECCION|REPRESENTANTE|TELEFONO|E_MAIL|PLACA)(?:;|$)/;
  const valuePatterns = { email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, ruc_11_digits: /(?:^|\D)\d{11}(?:\D|$)/ };
  const findings = { forbidden_headers: 0, email: 0, ruc_11_digits: 0 };
  for (const file of listFiles(path.join(dataRoot, 'minimized', snapshot))) {
    if (!/\.csv\.gz$/.test(file)) continue;
    const stream = fs.createReadStream(file).pipe(createGunzip()).setEncoding('utf8'); let carry = '', firstLine = true;
    for await (const chunk of stream) {
      const text = carry + chunk; const lines = text.split('\n'); carry = lines.pop() ?? '';
      for (const line of lines) {
        if (firstLine) { if (forbiddenHeaders.test(line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase())) findings.forbidden_headers += 1; firstLine = false; }
        if (valuePatterns.email.test(line)) findings.email += 1;
        if (valuePatterns.ruc_11_digits.test(line)) findings.ruc_11_digits += 1;
      }
    }
    if (carry) { if (valuePatterns.email.test(carry)) findings.email += 1; if (valuePatterns.ruc_11_digits.test(carry)) findings.ruc_11_digits += 1; }
  }
  return findings;
}

if (process.argv.includes('--seal')) {
  if (fs.existsSync(manifestPath)) fail('El manifiesto ya existe; no se regenera ni sobrescribe');
  if (fs.existsSync(path.join(dataRoot, 'raw', snapshot))) fail('Persisten originales dentro de data/raw');
  const files = [];
  for (const file of evidenceFiles()) files.push({ path: relative(file), ...(await digest(file)) });
  const manifest = { snapshot_date: snapshot, sealed_at: new Date().toISOString(), policy: 'Lista exacta previa; el profiler no escribe ni modifica este manifiesto.', expected_acquisition_sources: expectedSources, files };
  fs.mkdirSync(provenanceRoot, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ sealed: relative(manifestPath), files: files.length })}\n`);
  process.exit(0);
}

if (!fs.existsSync(manifestPath)) fail('Falta el manifiesto previo; use --seal una única vez después de validar las salidas');
if (fs.existsSync(path.join(dataRoot, 'raw', snapshot))) fail('Persisten originales dentro de data/raw');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedPaths = manifest.files.map((item) => item.path).sort(); const actualPaths = evidenceFiles().map(relative).sort();
const missing = expectedPaths.filter((item) => !actualPaths.includes(item)); const unexpected = actualPaths.filter((item) => !expectedPaths.includes(item));
if (missing.length || unexpected.length) fail(`Lista de archivos distinta: faltan=${JSON.stringify(missing)}, inesperados=${JSON.stringify(unexpected)}`);
for (const item of manifest.files) {
  const observed = await digest(path.join(root, item.path));
  if (observed.bytes !== item.bytes || observed.sha256 !== item.sha256) fail(`Integridad inválida: ${item.path}`);
}
const acquisitions = fs.readFileSync(path.join(provenanceRoot, 'acquisitions.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const observedSources = acquisitions.map((item) => item.source_id).sort();
if (JSON.stringify(observedSources) !== JSON.stringify(manifest.expected_acquisition_sources)) fail(`Fuentes distintas: ${JSON.stringify(observedSources)}`);
let cacheVerified = 0;
if (fs.existsSync(cacheRoot)) {
  for (const record of acquisitions) {
    const file = path.join(root, record.cache_path); if (!fs.existsSync(file)) fail(`Falta caché adquirida: ${record.source_id}`);
    const observed = await digest(file); if (observed.bytes !== record.bytes || observed.sha256 !== record.sha256) fail(`Caché alterada: ${record.source_id}`); cacheVerified += 1;
  }
}
const privacy = await scanMinimized();
if (Object.values(privacy).some(Boolean)) fail(`Escaneo de privacidad falló: ${JSON.stringify(privacy)}`);
process.stdout.write(`${JSON.stringify({ manifest: relative(manifestPath), files: manifest.files.length, acquisition_sources: observedSources.length, cache_verified: cacheVerified, privacy })}\n`);
