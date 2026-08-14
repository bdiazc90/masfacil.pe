#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = '2026-08-14';
const minimizedRoot = path.join(root, 'data', 'minimized', snapshot);
const provenanceRoot = path.join(root, 'data', 'provenance', snapshot);
const outputRoot = path.join(root, 'data', 'derived', snapshot);
const outputPath = path.join(outputRoot, 'profile.json');
const clean = (value) => String(value ?? '').replace(/\r/g, '').trim();

async function* csvRows(file, delimiter = ';') {
  const source = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  const stream = file.endsWith('.gz') ? source.pipe(createGunzip()).setEncoding('utf8') : source.setEncoding('utf8');
  let row = [], value = '', quoted = false, quoteAtChunkEnd = false, first = true;
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i += 1) {
      const char = chunk[i];
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
  if (quoted) throw new Error(`CSV incompleto: ${file}`);
  if (value || row.length) { row.push(value.replace(/\r$/, '')); yield row; }
}

function parseDate(value) {
  const text = clean(value); let match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/), match = match ? [match[0], match[3], match[2], match[1]] : null;
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
}
function countMap(values) { const out = {}; for (const value of values) out[value] = (out[value] ?? 0) + 1; return out; }
function cardinality(values, total) {
  const nonblank = values.filter(Boolean); const counts = countMap(nonblank);
  return { rows: total, non_blank: nonblank.length, blank: total - nonblank.length, distinct: Object.keys(counts).length, repeated_values: Object.values(counts).filter((n) => n > 1).length, rows_in_repeated_values: Object.values(counts).filter((n) => n > 1).reduce((a, b) => a + b, 0) };
}

async function profilePrice(name, expectedHeader, options) {
  const file = path.join(minimizedRoot, 'prices', name); let header, rows = 0, malformed = 0;
  const nulls = {}, maxLength = {}, distinct = {}, values = {}, dates = {}, prices = {};
  for (const field of options.distinctFields) distinct[field] = new Set();
  for (const field of options.valueFields) values[field] = new Set();
  for (const field of options.dateFields) dates[field] = { non_blank: 0, invalid: 0, min: null, max: null, by_year: {}, by_month: {} };
  for (const field of options.priceFields) prices[field] = { non_blank: 0, invalid: 0, zero_or_negative: 0, over_100: 0, over_1000: 0, min: null, max: null };
  let idDistinct = new Set(), idBlank = 0;
  const brandByRegistro = new Map();
  for await (const row of csvRows(file)) {
    if (!header) {
      header = row.map(clean);
      if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) throw new Error(`${name}: schema inesperado ${JSON.stringify(header)}`);
      for (const field of header) { nulls[field] = 0; maxLength[field] = 0; }
      continue;
    }
    rows += 1; if (row.length !== header.length) malformed += 1;
    const item = Object.fromEntries(header.map((field, index) => [field, clean(row[index])]));
    for (const field of header) { if (!item[field]) nulls[field] += 1; maxLength[field] = Math.max(maxLength[field], item[field].length); }
    for (const field of options.distinctFields) if (item[field]) distinct[field].add(item[field]);
    for (const field of options.valueFields) if (item[field]) values[field].add(item[field]);
    const id = item[options.idField]; if (id) idDistinct.add(id); else idBlank += 1;
    for (const field of options.dateFields) {
      if (!item[field]) continue; dates[field].non_blank += 1; const parsed = parseDate(item[field]);
      if (!parsed) { dates[field].invalid += 1; continue; }
      dates[field].min = dates[field].min === null || parsed < dates[field].min ? parsed : dates[field].min;
      dates[field].max = dates[field].max === null || parsed > dates[field].max ? parsed : dates[field].max;
      dates[field].by_year[parsed.slice(0, 4)] = (dates[field].by_year[parsed.slice(0, 4)] ?? 0) + 1;
      dates[field].by_month[parsed.slice(0, 7)] = (dates[field].by_month[parsed.slice(0, 7)] ?? 0) + 1;
    }
    for (const field of options.priceFields) {
      if (!item[field]) continue; const metric = prices[field]; metric.non_blank += 1;
      const number = Number(item[field].replace(',', '.')); if (!Number.isFinite(number)) { metric.invalid += 1; continue; }
      if (number <= 0) metric.zero_or_negative += 1; if (number > 100) metric.over_100 += 1; if (number > 1000) metric.over_1000 += 1;
      metric.min = metric.min === null || number < metric.min ? number : metric.min; metric.max = metric.max === null || number > metric.max ? number : metric.max;
    }
    if (options.brandField && item[options.registroField] && item[options.brandField]) {
      if (!brandByRegistro.has(item[options.registroField])) brandByRegistro.set(item[options.registroField], new Set());
      brandByRegistro.get(item[options.registroField]).add(item[options.brandField]);
    }
  }
  const identifiers = { [options.idField]: { rows, non_blank: rows - idBlank, blank: idBlank, distinct: idDistinct.size, repeated_rows: rows - idBlank - idDistinct.size } };
  for (const field of options.distinctFields) identifiers[field] = { rows, non_blank: rows - nulls[field], blank: nulls[field], distinct: distinct[field].size };
  const result = { rows, columns: header.length, header, malformed_width_rows: malformed, nulls, max_length: maxLength, exact_duplicate_rows: idBlank === 0 && idDistinct.size === rows ? 0 : null, duplicate_method: idBlank === 0 && idDistinct.size === rows ? `${options.idField} es único y no nulo; por tanto no puede existir una fila exacta duplicada` : 'No determinado por unicidad', identifiers, categories: Object.fromEntries(options.valueFields.map((field) => [field, { distinct: values[field].size, values: [...values[field]].sort() }])), dates, prices };
  if (options.brandField) {
    const brandCounts = [...brandByRegistro.values()].map((set) => set.size);
    result.brand = { field: options.brandField, non_blank: rows - nulls[options.brandField], blank: nulls[options.brandField], coverage_percent: Number((((rows - nulls[options.brandField]) / rows) * 100).toFixed(3)), distinct: distinct[options.brandField].size, registros_with_brand: brandByRegistro.size, brands_per_registro: { min: brandCounts.length ? Math.min(...brandCounts) : null, max: brandCounts.length ? Math.max(...brandCounts) : null, one: brandCounts.filter((n) => n === 1).length, multiple: brandCounts.filter((n) => n > 1).length } };
  }
  return result;
}

async function readTable(relative) {
  const rows = []; let header;
  for await (const row of csvRows(path.join(minimizedRoot, relative))) { if (!header) header = row.map(clean); else rows.push(Object.fromEntries(header.map((field, i) => [field, clean(row[i])]))); }
  return { header, rows };
}
function uniqueness(rows, field) { return cardinality(rows.map((row) => row[field]), rows.length); }
function exactOverlap(leftRows, leftField, rightRows, rightField) {
  const leftCounts = countMap(leftRows.map((r) => r[leftField]).filter(Boolean)); const rightCounts = countMap(rightRows.map((r) => r[rightField]).filter(Boolean));
  const matchedKeys = Object.keys(leftCounts).filter((key) => rightCounts[key]);
  const cardinalities = { one_to_one: 0, one_to_many: 0, many_to_one: 0, many_to_many: 0 };
  for (const key of matchedKeys) {
    const a = leftCounts[key], b = rightCounts[key];
    if (a === 1 && b === 1) cardinalities.one_to_one += 1; else if (a === 1) cardinalities.one_to_many += 1; else if (b === 1) cardinalities.many_to_one += 1; else cardinalities.many_to_many += 1;
  }
  const matchedLeft = matchedKeys.reduce((sum, key) => sum + leftCounts[key], 0);
  return { left_rows: leftRows.length, left_non_blank: Object.values(leftCounts).reduce((a, b) => a + b, 0), left_distinct: Object.keys(leftCounts).length, right_rows: rightRows.length, right_non_blank: Object.values(rightCounts).reduce((a, b) => a + b, 0), right_distinct: Object.keys(rightCounts).length, matched_left_rows: matchedLeft, unmatched_left_rows: leftRows.length - matchedLeft, coverage_percent: Number((matchedLeft / leftRows.length * 100).toFixed(3)), matched_distinct_keys: matchedKeys.length, cardinalities };
}
function assertion(id, pass, observed) { return { id, pass: Boolean(pass), observed }; }

const priceConfigs = {
  dmin: { file: 'dmin.csv.gz', header: ['ID1','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','DEPARTAMENTO_REPARTO','PROVINCIA_REPARTO','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_MIN_SOLES','PRECIO_MAX_SOLES','UNIDAD'], idField: 'ID1', distinctFields: ['REGISTRO_DE_HIDROCARBUROS'], valueFields: ['ACTIVIDAD','PRODUCTO','UNIDAD','DEPARTAMENTO','PROVINCIA','DISTRITO'], dateFields: ['FECHA_DE_REGISTRO'], priceFields: ['PRECIO_MIN_SOLES','PRECIO_MAX_SOLES'] },
  daily_anonymized: { file: 'daily-anonymized.csv.gz', header: ['FECHA_EMISION','FECHA_CORTE','ID','FE_EVAL','G_PREMIUM','G_REGULAR','DIESEL','GNV','GLP_G','GLP_E','ANON_CO_LOCAL_VENTA'], idField: 'ID', distinctFields: ['ANON_CO_LOCAL_VENTA'], valueFields: [], dateFields: ['FECHA_EMISION','FECHA_CORTE','FE_EVAL'], priceFields: ['G_PREMIUM','G_REGULAR','DIESEL','GNV','GLP_G','GLP_E'] },
  glp_current: { file: 'glp-current.csv.gz', header: ['ID4','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','FECHA_DE_REGISTRO','PRODUCTO','TIPO_DE_CLIENTE','MARCA','PRECIO_DE_VENTA_SOLES','UNIDAD'], idField: 'ID4', registroField: 'REGISTRO_DE_HIDROCARBUROS', brandField: 'MARCA', distinctFields: ['REGISTRO_DE_HIDROCARBUROS','MARCA'], valueFields: ['ACTIVIDAD','PRODUCTO','TIPO_DE_CLIENTE','UNIDAD','DEPARTAMENTO','PROVINCIA','DISTRITO'], dateFields: ['FECHA_DE_REGISTRO'], priceFields: ['PRECIO_DE_VENTA_SOLES'] },
  liquid_current: { file: 'liquid-current.csv.gz', header: ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'], idField: 'ID3', distinctFields: ['REGISTRO_DE_HIDROCARBUROS'], valueFields: ['ACTIVIDAD','PRODUCTO','UNIDAD','DEPARTAMENTO','PROVINCIA','DISTRITO'], dateFields: ['FECHA_DE_REGISTRO'], priceFields: ['PRECIO_DE_VENTA_SOLES'] },
};
const prices = {};
for (const [id, config] of Object.entries(priceConfigs)) prices[id] = await profilePrice(config.file, config.header, config);

const registry = await readTable('registry/authorizations.csv.gz'); const gis = await readTable('gis/features.csv.gz'); const ubigeo = await readTable('ubigeo/districts.csv.gz');
const registryByActivity = Object.fromEntries(['01','02','05','06','13','15','16','20','24','59'].map((activity) => {
  const rows = registry.rows.filter((row) => row.SOURCE_ACTIVITY === activity);
  return [activity, { rows: rows.length, registro: uniqueness(rows, 'REGISTRO'), codigo_osinergmin: uniqueness(rows, 'CODIGO_OSINERGMIN'), codigo: uniqueness(rows, 'CODIGO') }];
}));
const gisByLayer = Object.fromEntries(['28','34','35','36'].map((layer) => {
  const rows = gis.rows.filter((row) => row.LAYER === layer);
  return [layer, { rows: rows.length, objectid: uniqueness(rows, 'OBJECTID'), n: uniqueness(rows, 'N'), cod_osinergmin: uniqueness(rows, 'COD_OSINERGMIN'), codigo_dgh: uniqueness(rows, 'CODIGO_DGH'), null_geometry: rows.filter((r) => !r.LONGITUDE || !r.LATITUDE).length, outside_conservative_peru_box: rows.filter((r) => Number(r.LONGITUDE) < -82 || Number(r.LONGITUDE) > -68 || Number(r.LATITUDE) < -19 || Number(r.LATITUDE) > 1).length }];
}));
const reg = (...activities) => registry.rows.filter((row) => activities.includes(row.SOURCE_ACTIVITY));
const layer = (id) => gis.rows.filter((row) => row.LAYER === id);
const identity = {
  gis34_n_to_registry16_registro: exactOverlap(layer('34'), 'N', reg('16'), 'REGISTRO'),
  gis35_n_to_registry_1_2_5_6_registro: exactOverlap(layer('35'), 'N', reg('01','02','05','06'), 'REGISTRO'),
  gis36_n_to_registry_5_6_15_59_registro: exactOverlap(layer('36'), 'N', reg('05','06','15','59'), 'REGISTRO'),
  gis28_cod_osinergmin_to_registry20_codigo: exactOverlap(layer('28'), 'COD_OSINERGMIN', reg('20'), 'CODIGO_OSINERGMIN'),
  negative_gis34_n_to_registry13_registro: exactOverlap(layer('34'), 'N', reg('13'), 'REGISTRO'),
};
const ubigeoProfile = { rows: ubigeo.rows.length, schema: ubigeo.header, iddist: uniqueness(ubigeo.rows, 'IDDIST'), departments: new Set(ubigeo.rows.map((r) => r.NOMBDEP)).size, provinces: new Set(ubigeo.rows.map((r) => `${r.NOMBDEP}|${r.NOMBPROV}`)).size, exact_code_fields_in_observed_price_registry_gis_sources: 0, relation: 'CANDIDATA semántica; las fuentes observadas expresan territorio como texto y no se ejecuta join textual/fuzzy.' };
const acquisitions = fs.readFileSync(path.join(provenanceRoot, 'acquisitions.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const expectedSources = ['daily-catalog','dmin-catalog','glp-catalog','glp-current','liquid-catalog','liquid-current','price-documents','ubigeo-catalog','ubigeo-current'];
const observedSources = acquisitions.map((r) => r.source_id).sort();
const transformations = JSON.parse(fs.readFileSync(path.join(provenanceRoot, 'transformations.json'), 'utf8'));
const assertions = [
  assertion('exact-acquisition-source-list', JSON.stringify(observedSources) === JSON.stringify(expectedSources), observedSources),
  ...Object.entries(priceConfigs).flatMap(([id, config]) => [
    assertion(`${id}-schema`, JSON.stringify(prices[id].header) === JSON.stringify(config.header), prices[id].header),
    assertion(`${id}-width`, prices[id].malformed_width_rows === 0, prices[id].malformed_width_rows),
    assertion(`${id}-id`, prices[id].identifiers[config.idField].blank === 0 && prices[id].identifiers[config.idField].distinct === prices[id].rows, prices[id].identifiers[config.idField]),
  ]),
  assertion('registry-schema', JSON.stringify(registry.header) === JSON.stringify(['SOURCE_ACTIVITY','REGISTRO','CODIGO_OSINERGMIN','CODIGO','DEPARTAMENTO','PROVINCIA','DISTRITO','ACTIVIDAD']), registry.header),
  assertion('registry-activities', Object.keys(registryByActivity).length === 10 && ['01','02','05','06','13','15','16','20','24','59'].every((id) => registryByActivity[id]), Object.keys(registryByActivity)),
  assertion('gis-schema', JSON.stringify(gis.header) === JSON.stringify(['LAYER','OBJECTID','N','COD_OSINERGMIN','CODIGO_DGH','DEPARTAMENTO','PROVINCIA','DISTRITO','LONGITUDE','LATITUDE']), gis.header),
  ...Object.entries(gisByLayer).map(([id, item]) => assertion(`gis-${id}-objectid`, item.objectid.blank === 0 && item.objectid.distinct === item.rows, item.objectid)),
  assertion('ubigeo-schema', JSON.stringify(ubigeo.header) === JSON.stringify(['IDDIST','NOMBDEP','NOMBPROV','NOMBDIST','NOM_CAPITAL_LEGAL','COD_REG_NAT','REGION_NATURAL']), ubigeo.header),
  assertion('ubigeo-iddist', ubigeoProfile.iddist.blank === 0 && ubigeoProfile.iddist.distinct === ubigeoProfile.rows, ubigeoProfile.iddist),
  assertion('transformation-output-list', transformations.outputs.length === 9, transformations.outputs.map((o) => o.path)),
];
const profile = { snapshot_date: snapshot, generated_by: 'scripts/profile-gate-0.2.mjs', classification: 'métricas derivadas sanitizadas', totals: { price_rows: Object.values(prices).reduce((sum, item) => sum + item.rows, 0), registry_rows: registry.rows.length, gis_features: gis.rows.length, ubigeo_districts: ubigeo.rows.length }, prices, registry: { total_rows: registry.rows.length, by_activity: registryByActivity }, gis: { total_features: gis.rows.length, service_layer_count_observed: 27, layer_31_present_in_service_metadata: false, by_layer: gisByLayer }, identity_candidates: identity, ubigeo: ubigeoProfile, price_surface: JSON.parse(fs.readFileSync(path.join(minimizedRoot, 'knowledge', 'price-surface.json'), 'utf8')), assertions, assertion_summary: { passed: assertions.filter((a) => a.pass).length, failed: assertions.filter((a) => !a.pass).length } };
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(profile, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: path.relative(root, outputPath), totals: profile.totals, assertions: profile.assertion_summary })}\n`);
if (profile.assertion_summary.failed) process.exitCode = 1;
