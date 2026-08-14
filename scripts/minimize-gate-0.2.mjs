#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = '2026-08-14';
const cacheRoot = path.join(root, '.local-cache', 'gate-0.2', snapshot);
const acquiredRoot = path.join(cacheRoot, 'acquired');
const legacyRoot = fs.existsSync(path.join(root, 'data', 'raw', snapshot))
  ? path.join(root, 'data', 'raw', snapshot)
  : path.join(cacheRoot, 'legacy-raw');
const outputRoot = path.join(root, 'data', 'minimized', snapshot);
const stageRoot = path.join(cacheRoot, 'minimize-stage');
const provenanceRoot = path.join(root, 'data', 'provenance', snapshot);
const transformationsPath = path.join(provenanceRoot, 'transformations.json');

if (!fs.existsSync(legacyRoot)) throw new Error('No existe la caché de originales legacy');
if (fs.existsSync(outputRoot) || fs.existsSync(stageRoot) || fs.existsSync(transformationsPath)) {
  throw new Error('La minimización ya existe o quedó incompleta; se rechaza sobrescribirla');
}
fs.mkdirSync(stageRoot, { recursive: true });

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
const clean = (value) => String(value ?? '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
const csvCell = (value) => /[";\n\r]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
const csvLine = (row) => `${row.map(csvCell).join(';')}\n`;

async function* csvRows(file, delimiter = ';') {
  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  let row = [], value = '', quoted = false, quoteAtChunkEnd = false, first = true;
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i += 1) {
      let char = chunk[i];
      if (first) { first = false; if (char === '\uFEFF') continue; }
      if (quoteAtChunkEnd) {
        quoteAtChunkEnd = false;
        if (char === '"') { value += '"'; continue; }
        quoted = false;
      }
      if (quoted) {
        if (char === '"') {
          if (i === chunk.length - 1) quoteAtChunkEnd = true;
          else if (chunk[i + 1] === '"') { value += '"'; i += 1; }
          else quoted = false;
        } else value += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) { row.push(value); value = ''; }
      else if (char === '\n') { row.push(value.replace(/\r$/, '')); yield row; row = []; value = ''; }
      else value += char;
    }
  }
  if (quoteAtChunkEnd) quoted = false;
  if (quoted) throw new Error(`CSV termina dentro de comillas: ${file}`);
  if (value || row.length) { row.push(value.replace(/\r$/, '')); yield row; }
}

async function writeRow(stream, row) {
  if (!stream.write(csvLine(row))) await once(stream, 'drain');
}

async function minimizeCsv({ input, output, delimiter = ';', keep, expectedHeader }) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const writer = fs.createWriteStream(output, { flags: 'wx' });
  let header, indices, rows = 0, malformed = 0;
  for await (const row of csvRows(input, delimiter)) {
    if (!header) {
      header = row.map(clean);
      const keys = header.map(normalize);
      if (expectedHeader && JSON.stringify(keys) !== JSON.stringify(expectedHeader)) {
        throw new Error(`Schema inesperado en ${input}: ${JSON.stringify(keys)}`);
      }
      indices = keep.map((field) => {
        const index = keys.indexOf(field);
        if (index < 0) throw new Error(`Falta ${field} en ${input}`);
        return index;
      });
      await writeRow(writer, keep);
      continue;
    }
    if (row.length !== header.length) malformed += 1;
    await writeRow(writer, indices.map((index) => clean(row[index] ?? '')));
    rows += 1;
    if (rows % 250000 === 0) process.stdout.write(`${path.basename(input)}: ${rows} filas minimizadas\n`);
  }
  writer.end(); await once(writer, 'close');
  if (malformed) throw new Error(`${input}: ${malformed} filas de ancho inválido`);
  return { rows, source_columns: header.length, retained_columns: keep.length, retained_fields: keep };
}

function decodeHtml(buffer) { return new TextDecoder('windows-1252').decode(buffer); }
function htmlText(value) {
  return clean(value.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))));
}
function parseHtmlTable(file) {
  const html = decodeHtml(fs.readFileSync(file));
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((cell) => htmlText(cell[1]))
  ).filter((row) => row.length);
  return { header: rows[0], rows: rows.slice(1).filter((row) => row.some(Boolean)) };
}

async function minimizeRegistry() {
  const directory = path.join(legacyRoot, 'registry');
  const files = fs.readdirSync(directory).filter((name) => /^activity-.*\.html$/.test(name)).sort();
  const output = path.join(stageRoot, 'registry', 'authorizations.csv');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const fields = ['SOURCE_ACTIVITY', 'REGISTRO', 'CODIGO_OSINERGMIN', 'CODIGO', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'ACTIVIDAD'];
  const writer = fs.createWriteStream(output, { flags: 'wx' }); await writeRow(writer, fields);
  let total = 0;
  for (const name of files) {
    const sourceActivity = name.match(/^activity-(\d+)/)[1];
    const { header, rows } = parseHtmlTable(path.join(directory, name));
    const keys = header.map(normalize);
    const find = (...patterns) => keys.findIndex((key) => patterns.some((pattern) => pattern.test(key)));
    const indexes = {
      REGISTRO: find(/^REGISTRO$/, /REGISTRO.*HIDROCARBUROS/, /REGISTRO/),
      CODIGO_OSINERGMIN: find(/CODIGO.*OSINERGMIN/), CODIGO: find(/^CODIGO$/),
      DEPARTAMENTO: find(/^DEPARTAMENTO$/), PROVINCIA: find(/^PROVINCIA$/), DISTRITO: find(/^DISTRITO$/),
      ACTIVIDAD: find(/^ACTIVIDAD$/, /^TIPO_DE_ESTABLECIMIENTO$/),
    };
    if (indexes.REGISTRO < 0) throw new Error(`${name}: falta Registro`);
    for (const row of rows) await writeRow(writer, [sourceActivity, ...fields.slice(1).map((field) => indexes[field] < 0 ? '' : clean(row[indexes[field]]))]);
    total += rows.length;
  }
  writer.end(); await once(writer, 'close');
  return { rows: total, files: files.length, retained_fields: fields };
}

async function minimizeGis() {
  const directory = path.join(legacyRoot, 'gis');
  const fields = ['LAYER', 'OBJECTID', 'N', 'COD_OSINERGMIN', 'CODIGO_DGH', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'LONGITUDE', 'LATITUDE'];
  const output = path.join(stageRoot, 'gis', 'features.csv'); fs.mkdirSync(path.dirname(output), { recursive: true });
  const writer = fs.createWriteStream(output, { flags: 'wx' }); await writeRow(writer, fields);
  const counts = {};
  for (const layer of [28, 34, 35, 36]) {
    const names = fs.readdirSync(directory).filter((name) => name.startsWith(`layer-${layer}-features`) && !name.includes('unordered')).sort();
    let count = 0;
    for (const name of names) {
      const collection = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      for (const feature of collection.features ?? []) {
        const p = feature.properties ?? {}, [longitude = '', latitude = ''] = feature.geometry?.coordinates ?? [];
        await writeRow(writer, [layer, p.OBJECTID, p.N, p.COD_OSINERGMIN, p.CODIGO_DGH, p.DEPARTAMENTO, p.PROVINCIA, p.DISTRITO, longitude, latitude].map(clean));
        count += 1;
      }
    }
    counts[layer] = count;
  }
  writer.end(); await once(writer, 'close');
  return { rows: Object.values(counts).reduce((a, b) => a + b, 0), counts, retained_fields: fields };
}

function xmlText(value) { return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function xlsxRows(file) {
  const unzip = (entry) => {
    const result = spawnSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`No se pudo leer ${entry}`);
    return result.stdout;
  };
  const shared = [...unzip('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => clean(xmlText(match[1])));
  const rows = [];
  for (const match of unzip('xl/worksheets/sheet1.xml').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cell of match[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = cell[1].match(/\br="([A-Z]+)\d+"/)?.[1]; if (!ref) continue;
      const index = [...ref].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const raw = cell[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
      row[index] = /\bt="s"/.test(cell[1]) ? shared[Number(raw)] : clean(xmlText(raw));
    }
    rows.push(row);
  }
  return rows;
}

async function minimizeUbigeo() {
  const source = path.join(acquiredRoot, 'ubigeo', 'UBIGEO-2022-1891-distritos.xlsx');
  const rows = xlsxRows(source); const header = rows.shift().map(normalize);
  const expected = ['IDDIST', 'NOMBDEP', 'NOMBPROV', 'NOMBDIST', 'NOM_CAPITAL_LEGAL', 'COD_REG_NAT', 'REGION_NATURAL'];
  if (JSON.stringify(header) !== JSON.stringify(expected)) throw new Error(`Schema UBIGEO inesperado: ${header}`);
  const valid = rows.filter((row) => /^\d{6}$/.test(clean(row[0])));
  const output = path.join(stageRoot, 'ubigeo', 'districts.csv'); fs.mkdirSync(path.dirname(output), { recursive: true });
  const writer = fs.createWriteStream(output, { flags: 'wx' }); await writeRow(writer, expected);
  for (const row of valid) await writeRow(writer, expected.map((_, index) => clean(row[index])));
  writer.end(); await once(writer, 'close');
  return { rows: valid.length, source_rows: rows.length, retained_fields: expected };
}

function packageResult(file) { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value.result) ? value.result[0] : value.result; }
function writeKnowledgeSnapshots() {
  const ids = ['dmin', 'daily-anonymized', 'glp', 'liquid'];
  const catalogs = ids.map((id) => {
    const item = packageResult(path.join(acquiredRoot, 'catalogs', `${id}.json`));
    return { id, title: clean(item.title), publisher: item.groups?.[0]?.title ?? null, license: item.license_title, private_api_flag: item.private, metadata_created: item.metadata_created, metadata_modified: item.metadata_modified, catalog_url: item.url, resources: item.resources.map((r) => ({ name: clean(r.name), url: r.url, format: r.format, last_modified: r.last_modified })) };
  });
  const ubigeo = packageResult(path.join(acquiredRoot, 'ubigeo', 'catalog.json'));
  catalogs.push({ id: 'ubigeo-inei', title: clean(ubigeo.title), publisher: ubigeo.groups?.[0]?.title ?? 'Instituto Nacional de Estadística e Informática - INEI', license: ubigeo.license_title, private_api_flag: ubigeo.private, metadata_created: ubigeo.metadata_created, metadata_modified: ubigeo.metadata_modified, catalog_url: ubigeo.url, resources: ubigeo.resources.map((r) => ({ name: clean(r.name), url: r.url, format: r.format, last_modified: r.last_modified })) });
  fs.mkdirSync(path.join(stageRoot, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(stageRoot, 'knowledge', 'catalogs.json'), `${JSON.stringify(catalogs, null, 2)}\n`, { flag: 'wx' });

  const stub = fs.readFileSync(path.join(legacyRoot, 'surfaces', 'price-scop-docs.html'), 'utf8');
  const destination = fs.readFileSync(path.join(acquiredRoot, 'surfaces', 'price-documents.html'), 'utf8');
  const hrefs = [...destination.matchAll(/href=["']([^"']+)/gi)].map((match) => match[1]);
  const summary = { stub_bytes: Buffer.byteLength(stub), refresh_target: stub.match(/url=([^"'>\s]+)/i)?.[1] ?? null, destination_bytes: Buffer.byteLength(destination), hrefs: hrefs.length, distinct_hrefs: new Set(hrefs).size, structured_csv_links: hrefs.filter((href) => /\.csv(?:$|[?#])/i.test(href)).length, report_daily_links: hrefs.filter((href) => /Reporte-Diario/i.test(href)).length, document_file_links: new Set(hrefs.filter((href) => /\.(?:pdf|xls|xlsx|zip)(?:$|[?#])/i.test(href))).size };
  fs.writeFileSync(path.join(stageRoot, 'knowledge', 'price-surface.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  return { catalogs: catalogs.length, price_surface: summary };
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256'); let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}
function listFiles(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? listFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]); }

const schemas = {
  dmin: ['ID1','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','RUC','RAZON_SOCIAL','DEPARTAMENTO','PROVINCIA','DISTRITO','DIRECCION','DEPARTAMENTO_REPARTO','PROVINCIA_REPARTO','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_MIN_SOLES','PRECIO_MAX_SOLES','UNIDAD'],
  daily: ['FECHA_EMISION','FECHA_CORTE','ID','FE_EVAL','G_PREMIUM','G_REGULAR','DIESEL','GNV','GLP_G','GLP_E','ANON_CO_LOCAL_VENTA'],
  glp: ['ID4','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','RUC','RAZON_SOCIAL','DEPARTAMENTO','PROVINCIA','DISTRITO','DIRECCION','FECHA_DE_REGISTRO','PRODUCTO','TIPO_DE_CLIENTE','MARCA','PRECIO_DE_VENTA_SOLES','UNIDAD'],
  liquid: ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','RUC','RAZON_SOCIAL','DEPARTAMENTO','PROVINCIA','DISTRITO','DIRECCION','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'],
};
const keep = {
  dmin: schemas.dmin.filter((f) => !['RUC','RAZON_SOCIAL','DIRECCION'].includes(f)),
  daily: schemas.daily,
  glp: schemas.glp.filter((f) => !['RUC','RAZON_SOCIAL','DIRECCION'].includes(f)),
  liquid: schemas.liquid.filter((f) => !['RUC','RAZON_SOCIAL','DIRECCION'].includes(f)),
};

const results = {};
results.dmin = await minimizeCsv({ input: path.join(legacyRoot, 'price-dmin', 'data.csv'), output: path.join(stageRoot, 'prices', 'dmin.csv'), keep: keep.dmin, expectedHeader: schemas.dmin });
results.daily = await minimizeCsv({ input: path.join(legacyRoot, 'price-daily-anonymized', 'data.csv'), output: path.join(stageRoot, 'prices', 'daily-anonymized.csv'), delimiter: ',', keep: keep.daily, expectedHeader: schemas.daily });
results.glp = await minimizeCsv({ input: path.join(acquiredRoot, 'price-glp', 'GLP-Registro-precios-PIC-PE-V.csv'), output: path.join(stageRoot, 'prices', 'glp-current.csv'), keep: keep.glp, expectedHeader: schemas.glp });
results.liquid = await minimizeCsv({ input: path.join(acquiredRoot, 'price-liquid', 'CL-Registro-precios-DMA-V-CCA-CCE.csv'), output: path.join(stageRoot, 'prices', 'liquid-current.csv'), keep: keep.liquid, expectedHeader: schemas.liquid });
results.registry = await minimizeRegistry();
results.gis = await minimizeGis();
results.ubigeo = await minimizeUbigeo();
results.knowledge = writeKnowledgeSnapshots();

for (const file of listFiles(stageRoot).filter((item) => item.endsWith('.csv'))) {
  const compressed = spawnSync('gzip', ['-9', '-n', file], { encoding: 'utf8' });
  if (compressed.status !== 0) throw new Error(`No se pudo comprimir ${file}: ${compressed.stderr}`);
}

const outputFiles = [];
for (const file of listFiles(stageRoot).sort()) outputFiles.push({ path: path.relative(stageRoot, file), ...(await sha256File(file)) });
const acquisitionRecords = fs.readFileSync(path.join(provenanceRoot, 'acquisitions.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const legacyInputs = [
  'price-dmin/data.csv', 'price-daily-anonymized/data.csv', 'surfaces/price-scop-docs.html',
  ...fs.readdirSync(path.join(legacyRoot, 'registry')).filter((name) => /^activity-.*\.html$/.test(name)).map((name) => `registry/${name}`),
  ...fs.readdirSync(path.join(legacyRoot, 'gis')).filter((name) => /^(?:service-metadata|layer-(?:28|34|35|36)-(?:count|metadata)|layer-(?:28|34|35|36)-features(?!.*unordered)).*/.test(name)).map((name) => `gis/${name}`),
].sort();
const legacy = [];
for (const relative of legacyInputs) legacy.push({ path: relative, ...(await sha256File(path.join(legacyRoot, relative))), acquisition_provenance: 'legacy_no_verificable; hash observado antes de retirar raw del árbol' });
const transformation = {
  snapshot_date: snapshot, created_at: new Date().toISOString(), script: 'scripts/minimize-gate-0.2.mjs',
  classification: 'derivado_minimizado',
  policy: 'Se excluyen RUC, razón social, dirección, representante, teléfono, correo y placa. MARCA se conserva como atributo documentado de producto o envasadora.',
  new_acquisitions: acquisitionRecords.map((r) => ({ source_id: r.source_id, sha256: r.sha256, bytes: r.bytes })),
  legacy_inputs: legacy, transformations: results, outputs: outputFiles,
};
fs.mkdirSync(provenanceRoot, { recursive: true });
fs.writeFileSync(transformationsPath, `${JSON.stringify(transformation, null, 2)}\n`, { flag: 'wx' });
fs.mkdirSync(path.dirname(outputRoot), { recursive: true });
fs.renameSync(stageRoot, outputRoot);
process.stdout.write(`${JSON.stringify({ output: path.relative(root, outputRoot), results, files: outputFiles.length })}\n`);
