#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.GATE_RAW_INPUT || !process.env.GATE_MINIMIZED_OUTPUT) throw new Error('GATE_RAW_INPUT y GATE_MINIMIZED_OUTPUT son obligatorios');
const rawPath = path.resolve(root, process.env.GATE_RAW_INPUT);
const outputRoot = path.resolve(root, process.env.GATE_MINIMIZED_OUTPUT);
const rawSchema = ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','RUC','RAZON_SOCIAL','DEPARTAMENTO','PROVINCIA','DISTRITO','DIRECCION','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'];
const minimizedSchema = ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'];
const clean = (value) => String(value ?? '').replace(/\r/g, '').trim();
const normalizeHeader = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();

async function* csvRows(file, onChunk) {
  const source = fs.createReadStream(file, { highWaterMark: 1024 * 1024 }).pipe(new Transform({ transform(chunk, encoding, callback) { onChunk(chunk); callback(null, chunk); } })).setEncoding('utf8');
  let row = [], value = '', quoted = false, quoteAtChunkEnd = false, first = true;
  for await (const chunk of source) for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk[index];
    if (first) { first = false; if (char === '\uFEFF') continue; }
    if (quoteAtChunkEnd) { quoteAtChunkEnd = false; if (char === '"') { value += '"'; continue; } quoted = false; }
    if (quoted) {
      if (char === '"') { if (index === chunk.length - 1) quoteAtChunkEnd = true; else if (chunk[index + 1] === '"') { value += '"'; index += 1; } else quoted = false; }
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); yield row; row = []; value = ''; }
    else value += char;
  }
  if (quoted || quoteAtChunkEnd) throw new Error('CSV incompleto durante minimización');
  if (value || row.length) { row.push(value.replace(/\r$/, '')); yield row; }
}

function csvLine(values) { return `${values.map((value) => { const text = String(value ?? ''); return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }).join(';')}\n`; }

if (!fs.existsSync(rawPath)) throw new Error(`No existe raw para minimizar: ${rawPath}`);
fs.mkdirSync(path.join(outputRoot, 'prices'), { recursive: true, mode: 0o700 });
const destination = path.join(outputRoot, 'prices', 'liquid-current.csv.gz');
const temporary = `${destination}.part`;
if (fs.existsSync(destination) || fs.existsSync(temporary)) throw new Error(`La minimización ya existe: ${destination}`);
let bytes = 0; let header; let rows = 0; let malformed = 0; let maxReported = null;
const rawDigest = crypto.createHash('sha256');
for await (const row of csvRows(rawPath, (chunk) => { rawDigest.update(chunk); bytes += chunk.length; })) {
  if (!header) {
    header = row.map(normalizeHeader);
    if (JSON.stringify(header) !== JSON.stringify(rawSchema)) throw new Error(`schema/header raw inválido: ${JSON.stringify(header)}`);
    continue;
  }
  if (row.length !== header.length) { malformed += 1; continue; }
  rows += 1;
  const item = Object.fromEntries(header.map((field, index) => [field, clean(row[index])]));
  const parsed = Date.parse(item.FECHA_DE_REGISTRO);
  if (Number.isFinite(parsed) && (!maxReported || parsed > maxReported.getTime())) maxReported = new Date(parsed);
}
if (malformed) throw new Error(`raw contiene ${malformed} filas con ancho inválido`);
const secondPass = csvRows(rawPath, () => {});
const outputStream = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
const gzip = createGzip();
const outputHash = crypto.createHash('sha256');
const outputMeter = new Transform({ transform(chunk, encoding, callback) { outputHash.update(chunk); callback(null, chunk); } });
const writer = pipeline(gzip, outputMeter, outputStream);
gzip.write(csvLine(minimizedSchema));
let outputRows = 0;
let secondHeader = true;
for await (const row of secondPass) {
  if (secondHeader) { secondHeader = false; if (JSON.stringify(row.map(normalizeHeader)) !== JSON.stringify(rawSchema)) throw new Error('schema/header raw cambió entre pasadas'); continue; }
  if (!row.length || row.length !== rawSchema.length) continue;
  const item = Object.fromEntries(rawSchema.map((field, index) => [field, clean(row[index])]));
  gzip.write(csvLine(minimizedSchema.map((field) => item[field])));
  outputRows += 1;
}
gzip.end();
await writer;
if (outputRows !== rows) throw new Error(`filas de salida ${outputRows} no coinciden con filas válidas de entrada ${rows}`);
const outputSha256 = outputHash.digest('hex');
fs.renameSync(temporary, destination);
process.stdout.write(`${JSON.stringify({ raw_bytes: bytes, raw_sha256: rawDigest.digest('hex'), raw_header: rawSchema, minimized_path: path.relative(root, destination), minimized_bytes: fs.statSync(destination).size, minimized_sha256: outputSha256, minimized_rows: rows, source_max_reported_at: maxReported?.toISOString() ?? null }, null, 2)}\n`);
