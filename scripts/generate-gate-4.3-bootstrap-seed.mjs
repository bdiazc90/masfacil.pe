#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipCanonical, sha256, stableJson, validateSeed } from '../app/gate-4.3-bootstrap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap', 'gate-4.3-seed.manifest.json'), 'utf8'));
const inputRoot = path.join(root, '.local-cache', 'gate-0.2', manifest.reference_snapshot_date, 'superseded-uncompressed', 'minimized');
const outputRoot = path.join(root, '.local-cache', 'gate-4.3');

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8'); const rows = []; let row = []; let value = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) { if (char === '"' && text[index + 1] === '"') { value += char; index += 1; } else if (char === '"') quoted = false; else value += char; }
    else if (char === '"') quoted = true;
    else if (char === ';') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += char;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((field, index) => [field, cells[index] ?? ''])));
}
function privateWrite(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, content, { mode: 0o600 }); fs.chmodSync(file, 0o600); }

const registry = parseCsv(path.join(inputRoot, 'registry', 'authorizations.csv'))
  .filter((row) => manifest.filters.source_activity.includes(row.SOURCE_ACTIVITY) && row.DEPARTAMENTO === 'LIMA' && row.PROVINCIA === 'LIMA')
  .map((row) => [row.SOURCE_ACTIVITY, row.REGISTRO, row.DEPARTAMENTO, row.PROVINCIA, row.DISTRITO]);
const gis = parseCsv(path.join(inputRoot, 'gis', 'features.csv'))
  .filter((row) => row.LAYER === '35' && row.DEPARTAMENTO === 'LIMA' && row.PROVINCIA === 'LIMA')
  .map((row) => [row.N, row.DEPARTAMENTO, row.PROVINCIA, row.DISTRITO, Number(row.LONGITUDE), Number(row.LATITUDE)]);
const payload = { schema_version: 1, reference_snapshot_date: manifest.reference_snapshot_date, registry_fields: manifest.registry_fields, gis_fields: manifest.gis_fields, registry, gis };
const errors = validateSeed(payload, manifest);
if (errors.length) throw new Error(`Generación de seed rechazada: ${errors.join('; ')}`);
const serialized = stableJson(payload); const gzip = gzipCanonical(payload); const encoded = gzip.toString('base64');
if (sha256(gzip) !== manifest.hashes.gzip_sha256 || sha256(encoded) !== manifest.hashes.base64_sha256) throw new Error('El seed generado no coincide con los hashes autorizados');
privateWrite(path.join(outputRoot, 'bootstrap-seed.json.gz'), gzip);
privateWrite(path.join(outputRoot, 'bootstrap-seed.b64'), encoded);
process.stdout.write(`${JSON.stringify({ seed_id: manifest.seed_id, json_bytes: Buffer.byteLength(serialized), gzip_bytes: gzip.length, base64_bytes: encoded.length, registry_rows: registry.length, gis_rows: gis.length })}\n`);
