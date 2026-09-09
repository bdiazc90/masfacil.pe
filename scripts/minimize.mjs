#!/usr/bin/env node

// Minimiza el original de precios: quita RUC, razón social y dirección, y deja
// un CSV comprimido con las diez columnas que el pipeline público necesita.
//
// Dos pasadas a propósito: la primera valida y mide el original entero, la
// segunda escribe. Escribir mientras se valida dejaría un archivo a medias
// cuando la fuente trae una fila rota.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { MINIMIZED_FIELDS, RAW_FIELDS, assertHeader, clean, csvLine, csvRows, normalizeHeader, parseTimestamp } from '../pipeline/csv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.RAW_INPUT || !process.env.MINIMIZED_OUTPUT) throw new Error('RAW_INPUT y MINIMIZED_OUTPUT son obligatorios');
const rawPath = path.resolve(root, process.env.RAW_INPUT);
const outputRoot = path.resolve(root, process.env.MINIMIZED_OUTPUT);

if (!fs.existsSync(rawPath)) throw new Error(`No existe raw para minimizar: ${rawPath}`);
fs.mkdirSync(path.join(outputRoot, 'prices'), { recursive: true, mode: 0o700 });
const destination = path.join(outputRoot, 'prices', 'liquid-current.csv.gz');
const temporary = `${destination}.part`;
if (fs.existsSync(destination) || fs.existsSync(temporary)) throw new Error(`La minimización ya existe: ${destination}`);
let bytes = 0; let header; let rows = 0; let malformed = 0; let maxReported = null;
const rawDigest = crypto.createHash('sha256');
for await (const row of csvRows(rawPath, { onChunk: (chunk) => { rawDigest.update(chunk); bytes += chunk.length; } })) {
  if (!header) {
    header = row.map(normalizeHeader);
    assertHeader(header, RAW_FIELDS, rawPath);
    continue;
  }
  if (row.length !== header.length) { malformed += 1; continue; }
  rows += 1;
  const reportedAt = parseTimestamp(clean(row[RAW_FIELDS.indexOf('FECHA_DE_REGISTRO')]));
  if (reportedAt && (!maxReported || reportedAt > maxReported)) maxReported = reportedAt;
}
if (malformed) throw new Error(`raw contiene ${malformed} filas con ancho inválido`);
const outputStream = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
const gzip = createGzip();
const outputHash = crypto.createHash('sha256');
const outputMeter = new Transform({ transform(chunk, encoding, callback) { outputHash.update(chunk); callback(null, chunk); } });
const writer = pipeline(gzip, outputMeter, outputStream);
gzip.write(csvLine([...MINIMIZED_FIELDS]));
let outputRows = 0;
let secondHeader = true;
for await (const row of csvRows(rawPath)) {
  if (secondHeader) { secondHeader = false; assertHeader(row.map(normalizeHeader), RAW_FIELDS, `${rawPath} (segunda pasada)`); continue; }
  if (!row.length || row.length !== RAW_FIELDS.length) continue;
  const item = Object.fromEntries(RAW_FIELDS.map((field, index) => [field, clean(row[index])]));
  gzip.write(csvLine(MINIMIZED_FIELDS.map((field) => item[field])));
  outputRows += 1;
}
gzip.end();
await writer;
if (outputRows !== rows) throw new Error(`filas de salida ${outputRows} no coinciden con filas válidas de entrada ${rows}`);
const outputSha256 = outputHash.digest('hex');
fs.renameSync(temporary, destination);
process.stdout.write(`${JSON.stringify({ raw_bytes: bytes, raw_sha256: rawDigest.digest('hex'), raw_header: [...RAW_FIELDS], minimized_path: path.relative(root, destination), minimized_bytes: fs.statSync(destination).size, minimized_sha256: outputSha256, minimized_rows: rows, source_max_reported_at: maxReported?.toISOString() ?? null }, null, 2)}\n`);
