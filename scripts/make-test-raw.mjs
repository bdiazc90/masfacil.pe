#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
const output = path.join(root, '.local-cache', 'publish', 'clean-runner-liquid.csv');
const schema = ['ID3', 'ACTIVIDAD', 'REGISTRO_DE_HIDROCARBUROS', 'RUC', 'RAZON_SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCION', 'FECHA_DE_REGISTRO', 'PRODUCTO', 'PRECIO_DE_VENTA_SOLES', 'UNIDAD'];
const activities = new Set(['ESTACIÓN DE SERVICIOS / GRIFOS', 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP', 'EE.SS con GNV', 'EE.SS con GLP y GNV']);
const products = new Set(['GASOHOL REGULAR', 'GASOHOL PREMIUM']);
const cutoff = Date.parse('2026-08-18T23:59:59-05:00');
const oldest = cutoff - 30 * 86400000;
const candidateReportedAt = '2026-08-20 12:00:00';
if (process.env.TEST_MODE !== '1') throw new Error('Este generador solo se ejecuta con TEST_MODE=1');
if (!input || !fs.existsSync(input)) throw new Error('Uso: TEST_MODE=1 node scripts/make-test-raw.mjs <raw-autorizado.csv>');

function clean(value) { return String(value ?? '').replace(/\r/g, '').trim(); }
function normalizeHeader(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase(); }
function time(value) {
  const match = clean(value).match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/);
  return match ? Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}-05:00`) : NaN;
}
async function* csvRows(file) {
  const source = fs.createReadStream(file, { highWaterMark: 1024 * 1024 }).pipe(new Transform({ transform(chunk, encoding, callback) { callback(null, chunk); } })).setEncoding('utf8');
  let row = []; let value = ''; let quoted = false; let quoteAtEnd = false; let first = true;
  for await (const chunk of source) for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk[index];
    if (first) { first = false; if (char === '\uFEFF') continue; }
    if (quoteAtEnd) { quoteAtEnd = false; if (char === '"') { value += '"'; continue; } quoted = false; }
    if (quoted) { if (char === '"') { if (index === chunk.length - 1) quoteAtEnd = true; else if (chunk[index + 1] === '"') { value += '"'; index += 1; } else quoted = false; } else value += char; }
    else if (char === '"') quoted = true;
    else if (char === ';') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); yield row; row = []; value = ''; }
    else value += char;
  }
  if (quoted || quoteAtEnd) throw new Error('CSV incompleto');
  if (value || row.length) { row.push(value.replace(/\r$/, '')); yield row; }
}
function line(values) { return `${values.map((value) => { const text = String(value ?? ''); return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }).join(';')}\n`; }

let header = null;
const latest = new Map();
for await (const row of csvRows(input)) {
  if (!header) { header = row.map(normalizeHeader); if (JSON.stringify(header) !== JSON.stringify(schema)) throw new Error('Header raw inesperado'); continue; }
  if (row.length !== schema.length) throw new Error('Fila raw con ancho inválido');
  const item = Object.fromEntries(schema.map((key, index) => [key, clean(row[index])]));
  if (!activities.has(item.ACTIVIDAD) || !products.has(item.PRODUCTO) || item.UNIDAD !== 'Galones') continue;
  const key = [item.REGISTRO_DE_HIDROCARBUROS, item.ACTIVIDAD, item.PRODUCTO, item.UNIDAD].join('\u001f'); const reported = time(item.FECHA_DE_REGISTRO);
  if (!Number.isFinite(reported)) continue;
  const current = latest.get(key);
  if (!current || reported > current.reported) latest.set(key, { reported, rows: [row] });
  else if (reported === current.reported) current.rows.push(row);
}
const selected = [...latest.values()].flatMap((entry) => entry.rows).filter((row) => {
  const item = Object.fromEntries(schema.map((key, index) => [key, clean(row[index])])); const reported = time(item.FECHA_DE_REGISTRO);
  return item.DEPARTAMENTO === 'LIMA' && item.PROVINCIA === 'LIMA' && reported >= oldest && reported <= cutoff;
});
const selectedByProduct = Object.fromEntries([...products].map((product) => [product, selected.filter((row) => clean(row[schema.indexOf('PRODUCTO')]) === product).length]));
if (selectedByProduct['GASOHOL REGULAR'] !== 740 || selectedByProduct['GASOHOL PREMIUM'] !== 726) throw new Error(`Fixture privado no reproduce Regular 740 / Premium 726: ${JSON.stringify(selectedByProduct)}`);
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
const temporary = `${output}.${process.pid}.tmp`; const hash = crypto.createHash('sha256'); const writer = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
const shifted = selected.map((row) => { const copy = [...row]; copy[schema.indexOf('FECHA_DE_REGISTRO')] = candidateReportedAt; return copy; });
for (const row of [schema, ...shifted]) { const bytes = line(row); hash.update(bytes); writer.write(bytes); }
await new Promise((resolve, reject) => { writer.once('error', reject); writer.end(resolve); });
fs.renameSync(temporary, output); fs.chmodSync(output, 0o600);
process.stdout.write(`${JSON.stringify({ clean_runner_fixture: true, fresh_offers: { regular: 740, premium: 726 }, candidate_reported_at: candidateReportedAt, bytes: fs.statSync(output).size, sha256: hash.digest('hex'), private: true })}\n`);
