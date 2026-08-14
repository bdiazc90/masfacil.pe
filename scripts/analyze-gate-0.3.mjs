#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = '2026-08-14';
const minimizedRoot = path.join(root, 'data', 'minimized', snapshot);
const derivedRoot = path.join(root, 'data', 'derived', snapshot);
const evidenceRoot = path.join(root, 'evidence');
const outputPath = path.join(evidenceRoot, 'feasibility-2026-08-14.json');
const contrastPath = path.join(evidenceRoot, 'facilito-contrast-2026-08-14.json');
const acquisitionsPath = path.join(root, 'data', 'provenance', snapshot, 'acquisitions.jsonl');
const acquisitions = fs.readFileSync(acquisitionsPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const currentAcquisitions = acquisitions.filter((item) => ['glp-current','liquid-current'].includes(item.source_id));
if (currentAcquisitions.length !== 2) throw new Error('Se esperaban dos adquisiciones de precios vigentes');
const asOf = new Date(Math.max(...currentAcquisitions.map((item) => Date.parse(item.completed_at))));
const thresholds = [1, 7, 30, 90, 365];
const sep = '\u001f';
const clean = (value) => String(value ?? '').replace(/\r/g, '').trim();

async function* csvRows(file) {
  const source = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  const stream = file.endsWith('.gz') ? source.pipe(createGunzip()).setEncoding('utf8') : source.setEncoding('utf8');
  let row = [], value = '', quoted = false, quoteAtChunkEnd = false, first = true;
  for await (const chunk of stream) {
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (first) { first = false; if (char === '\uFEFF') continue; }
      if (quoteAtChunkEnd) {
        quoteAtChunkEnd = false;
        if (char === '"') { value += '"'; continue; }
        quoted = false;
      }
      if (quoted) {
        if (char === '"') {
          if (index === chunk.length - 1) quoteAtChunkEnd = true;
          else if (chunk[index + 1] === '"') { value += '"'; index += 1; }
          else quoted = false;
        } else value += char;
      } else if (char === '"') quoted = true;
      else if (char === ';') { row.push(value); value = ''; }
      else if (char === '\n') { row.push(value.replace(/\r$/, '')); yield row; row = []; value = ''; }
      else value += char;
    }
  }
  if (quoteAtChunkEnd) quoted = false;
  if (quoted) throw new Error(`CSV incompleto: ${file}`);
  if (value || row.length) { row.push(value.replace(/\r$/, '')); yield row; }
}

async function readTable(relative, expectedHeader) {
  let header; const rows = [];
  for await (const row of csvRows(path.join(minimizedRoot, relative))) {
    if (!header) {
      header = row.map(clean);
      if (expectedHeader && JSON.stringify(header) !== JSON.stringify(expectedHeader)) throw new Error(`${relative}: schema inesperado`);
    } else rows.push(Object.fromEntries(header.map((field, index) => [field, clean(row[index])])));
  }
  return { header, rows };
}

function parseTimestamp(value) {
  const match = clean(value).match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}-05:00`);
}
function ageDays(date) { return (asOf.getTime() - date.getTime()) / 86400000; }
function pct(numerator, denominator) { return denominator ? Number((numerator / denominator * 100).toFixed(3)) : null; }
function histogram(values) { const result = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))); }
function percentile(sorted, probability) {
  if (!sorted.length) return null; const position = (sorted.length - 1) * probability; const lower = Math.floor(position); const fraction = position - lower;
  return sorted[lower] + (sorted[lower + 1] === undefined ? 0 : fraction * (sorted[lower + 1] - sorted[lower]));
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0] ?? null, p25: percentile(sorted, 0.25), median: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), max: sorted.at(-1) ?? null };
}

const activity = {
  eess: 'ESTACIÓN DE SERVICIOS / GRIFOS', eessGlp: 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP', eessBoth: 'EE.SS con GLP y GNV',
  eessGnv: 'EE.SS con GNV', evpGnv: 'ESTABLECIMIENTO DE VENTA AL PUBLICO DE GNV', comboGnv: 'GASOCENTRO DE GLP CON ESTABLECIMIENTO DE VENTA AL PUBLICO DE GNV',
  gasocentro: 'GASOCENTROS DE GLP', floating: 'GRIFOS FLOTANTES', rural: 'GRIFOS RURALES CON ALMACENAMIENTO EN CILINDROS',
  localSmall: 'LOCALES DE VENTA DE GLP EN CILINDROS CON CAPACIDAD MENOR O IGUAL A 5,000 KG', localLarge: 'LOCALES DE VENTA DE GLP EN CILINDROS CON CAPACIDAD MAYOR A 5,000 KG',
  plant: 'PLANTAS ENVASADORAS GLP', distributor: 'DISTRIBUIDOR DE GLP EN CILINDROS',
};
const cylinderProducts = ['Cilindros de 3 Kg de GLP','Cilindros de 5 Kg de GLP','Cilindros de 10 Kg de GLP','Cilindros de 15 Kg de GLP','Cilindros de 45 Kg de GLP'];
const definitions = {
  J1: { dataset: 'liquid', activities: [activity.eess,activity.eessGlp,activity.eessBoth,activity.floating,activity.rural], products: ['GASOHOL REGULAR','GASOHOL PREMIUM','Diesel B5 S-50 UV'], registry: ['01','02','05','06'], geo: { kind: 'by_activity' }, value: 'Diesel y gasolinas retail' },
  J2: { dataset: 'liquid', activities: [activity.eessGnv,activity.eessBoth,activity.evpGnv,activity.comboGnv], products: ['GAS NATURAL VEHICULAR COMPRIMIDO','GAS NATURAL VEHICULAR LICUEFACTADO'], registry: ['05','06','15','59'], geo: { kind: 'by_activity' }, value: 'GNV' },
  J3: { dataset: 'glp', activities: [activity.eessGlp,activity.eessBoth,activity.gasocentro,activity.comboGnv], products: ['GLP - G'], clients: ['Usuario Final'], registry: ['02','06','15'], geo: { kind: 'by_activity' }, value: 'GLP automotor' },
  J4: { dataset: 'glp', activities: [activity.localSmall,activity.localLarge], products: cylinderProducts, clients: ['Usuario Final','Consumidor Final - En local de venta'], registry: ['16'], geo: { kind: 'by_activity' }, value: 'Cilindros en locales de venta' },
  J5: { dataset: 'glp', activities: [activity.eess,activity.eessGlp,activity.eessBoth], products: cylinderProducts, clients: ['Usuario Final'], registry: ['01','02','06'], geo: { kind: 'by_activity' }, value: 'Cilindros en estaciones' },
  J6: { dataset: 'glp', activities: [activity.plant], products: cylinderProducts, clients: ['Usuario Final','Agentes con RHO'], registry: ['20'], geo: { kind: 'bridge28' }, value: 'Cilindros en plantas envasadoras' },
  J7: { dataset: 'glp', activities: [activity.distributor], products: cylinderProducts, clients: ['Usuario Final'], registry: ['13'], geo: { kind: 'none' }, value: 'Distribuidores en cilindros' },
};
const gisLayerByActivity = {
  [activity.eess]: '35',
  [activity.eessGlp]: '35',
  [activity.eessBoth]: '35',
  [activity.eessGnv]: '35',
  [activity.evpGnv]: '36',
  [activity.comboGnv]: '36',
  [activity.gasocentro]: '36',
  [activity.localSmall]: '34',
  [activity.localLarge]: '34',
};
const datasetSchemas = {
  liquid: ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'],
  glp: ['ID4','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','FECHA_DE_REGISTRO','PRODUCTO','TIPO_DE_CLIENTE','MARCA','PRECIO_DE_VENTA_SOLES','UNIDAD'],
};
function belongs(row, definition) {
  return definition.activities.includes(row.ACTIVIDAD) && definition.products.includes(row.PRODUCTO) && (!definition.clients || definition.clients.includes(row.TIPO_DE_CLIENTE));
}
function offerKey(row, dataset) {
  const fields = dataset === 'glp'
    ? ['REGISTRO_DE_HIDROCARBUROS','ACTIVIDAD','PRODUCTO','TIPO_DE_CLIENTE','MARCA','UNIDAD']
    : ['REGISTRO_DE_HIDROCARBUROS','ACTIVIDAD','PRODUCTO','UNIDAD'];
  return fields.map((field) => row[field]).join(sep);
}
function updateOffer(map, row, dataset) {
  const key = offerKey(row, dataset); const timestamp = parseTimestamp(row.FECHA_DE_REGISTRO); const time = timestamp?.getTime() ?? null;
  const price = Number(row.PRECIO_DE_VENTA_SOLES.replace(',', '.'));
  let item = map.get(key);
  if (!item) {
    item = { key, rows: 0, minTime: null, maxTime: null, latestRows: 0, latestPrices: new Set(), territories: new Set(), registro: row.REGISTRO_DE_HIDROCARBUROS, activity: row.ACTIVIDAD, product: row.PRODUCTO, client: row.TIPO_DE_CLIENTE ?? '', brandPresent: Boolean(row.MARCA), unit: row.UNIDAD, department: row.DEPARTAMENTO, province: row.PROVINCIA, district: row.DISTRITO };
    map.set(key, item);
  }
  item.rows += 1; item.territories.add([row.DEPARTAMENTO,row.PROVINCIA,row.DISTRITO].join('|'));
  if (time !== null) item.minTime = item.minTime === null ? time : Math.min(item.minTime, time);
  if (time !== null && (item.maxTime === null || time > item.maxTime)) {
    item.maxTime = time; item.latestRows = 1; item.latestPrices = new Set([Number.isFinite(price) ? price : 'invalid']);
    item.department = row.DEPARTAMENTO; item.province = row.PROVINCIA; item.district = row.DISTRITO; item.brandPresent = Boolean(row.MARCA);
  } else if (time !== null && time === item.maxTime) { item.latestRows += 1; item.latestPrices.add(Number.isFinite(price) ? price : 'invalid'); }
}

const registry = await readTable('registry/authorizations.csv.gz', ['SOURCE_ACTIVITY','REGISTRO','CODIGO_OSINERGMIN','CODIGO','DEPARTAMENTO','PROVINCIA','DISTRITO','ACTIVIDAD']);
const gis = await readTable('gis/features.csv.gz', ['LAYER','OBJECTID','N','COD_OSINERGMIN','CODIGO_DGH','DEPARTAMENTO','PROVINCIA','DISTRITO','LONGITUDE','LATITUDE']);
const registryCounts = new Map();
for (const row of registry.rows) {
  const key = `${row.SOURCE_ACTIVITY}${sep}${row.REGISTRO}`; registryCounts.set(key, (registryCounts.get(key) ?? 0) + 1);
}
const gisN = Object.fromEntries(['34','35','36'].map((layer) => [layer, new Set(gis.rows.filter((row) => row.LAYER === layer).map((row) => row.N).filter(Boolean))]));
const gis28Codes = new Set(gis.rows.filter((row) => row.LAYER === '28').map((row) => row.COD_OSINERGMIN).filter(Boolean));
const registry20Bridge = new Map(registry.rows.filter((row) => row.SOURCE_ACTIVITY === '20').map((row) => [row.REGISTRO, row.CODIGO_OSINERGMIN]));

function registryMatches(registro, activities) { return activities.reduce((sum, sourceActivity) => sum + (registryCounts.get(`${sourceActivity}${sep}${registro}`) ?? 0), 0); }
function geoMatches(item, definition) {
  if (definition.geo.kind === 'none') return false;
  if (definition.geo.kind === 'by_activity') {
    const layer = gisLayerByActivity[item.activity];
    return Boolean(layer && gisN[layer].has(item.registro));
  }
  const code = registry20Bridge.get(item.registro); return Boolean(code && gis28Codes.has(code));
}
function stageRecord(item, definition) {
  const date = item.maxTime === null ? null : new Date(item.maxTime); const age = date ? ageDays(date) : null;
  const conflict = item.latestPrices.size > 1; const price = !conflict && item.latestPrices.size === 1 ? [...item.latestPrices][0] : null;
  const priceUsable = typeof price === 'number' && Number.isFinite(price) && price > 0;
  const registrationMatches = registryMatches(item.registro, definition.registry);
  return { ...item, age, conflict, price, priceUsable, dateInterpretable: Boolean(date), registrationMatches, registrationExact: registrationMatches === 1, registrationAmbiguous: registrationMatches > 1, geoSafe: geoMatches(item, definition) };
}
function summarize(records, withSensitivity = false) {
  const unique = (items) => new Set(items.map((item) => item.registro)).size;
  const price = records.filter((item) => item.priceUsable && !item.conflict);
  const dated = price.filter((item) => item.dateInterpretable);
  const fresh30 = dated.filter((item) => item.age >= 0 && item.age <= 30);
  const registered = fresh30.filter((item) => item.registrationExact);
  const geocoded = registered.filter((item) => item.geoSafe);
  const freshness = Object.fromEntries(thresholds.map((days) => {
    const count = dated.filter((item) => item.age >= 0 && item.age <= days).length;
    return [`within_${days}d`, { offers: count, percent: pct(count, dated.length) }];
  }));
  const result = {
    offers: records.length, establishments: unique(records),
    funnel: {
      price_usable: { offers: price.length, establishments: unique(price), percent_of_offers: pct(price.length, records.length) },
      date_interpretable: { offers: dated.length, establishments: unique(dated), percent_of_offers: pct(dated.length, records.length) },
      within_30d: { offers: fresh30.length, establishments: unique(fresh30), percent_of_offers: pct(fresh30.length, records.length) },
      exact_unambiguous_registry: { offers: registered.length, establishments: unique(registered), percent_of_offers: pct(registered.length, records.length) },
      safe_coordinate: { offers: geocoded.length, establishments: unique(geocoded), percent_of_offers: pct(geocoded.length, records.length) },
      recognizable_establishment_identity: { classification: 'CONSTANTE DE POLÍTICA: ausencia estructural de fuente oficial observada', measured: false, offers: 0, establishments: 0, percent_of_offers: 0 },
    },
    freshness: { ...freshness, over_30d: { offers: dated.filter((item) => item.age > 30).length, percent: pct(dated.filter((item) => item.age > 30).length, dated.length) }, future: dated.filter((item) => item.age < 0).length, age_days: distribution(dated.filter((item) => item.age >= 0).map((item) => item.age)) },
    exceptions: {
      latest_timestamp_ties: records.filter((item) => item.latestRows > 1).length,
      latest_price_conflicts: records.filter((item) => item.conflict).length,
      invalid_or_nonpositive_unconflicted_latest_price: records.filter((item) => !item.conflict && !item.priceUsable).length,
      missing_or_invalid_date: records.filter((item) => !item.dateInterpretable).length,
      registry_no_match_after_freshness: fresh30.filter((item) => item.registrationMatches === 0).length,
      registry_ambiguous_after_freshness: fresh30.filter((item) => item.registrationAmbiguous).length,
      coordinate_no_match_after_registry: registered.filter((item) => !item.geoSafe).length,
      multiple_declared_territories: records.filter((item) => item.territories.size > 1).length,
      price_over_100: price.filter((item) => item.price > 100).length,
      price_over_1000: price.filter((item) => item.price > 1000).length,
    },
  };
  if (withSensitivity) {
    result.funnel_sensitivity = Object.fromEntries([30, 90, null].map((days) => {
      const eligible = dated.filter((item) => item.age >= 0 && (days === null || item.age <= days));
      const exact = eligible.filter((item) => item.registrationExact);
      const safe = exact.filter((item) => item.geoSafe);
      return [days === null ? 'no_age_limit' : `within_${days}d`, {
        eligible_offers: eligible.length,
        exact_registry_offers: exact.length,
        safe_coordinate_offers: safe.length,
        safe_coordinate_percent_of_price_usable: pct(safe.length, price.length),
      }];
    }));
  }
  return result;
}
function breakdown(records, field) {
  const groups = new Map(); for (const item of records) { const value = item[field] || '(vacío)'; if (!groups.has(value)) groups.set(value, []); groups.get(value).push(item); }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, items]) => [value, summarize(items)]));
}
function grain(records) {
  const historyRows = records.map((item) => item.rows).sort((a, b) => a - b);
  return { offer_keys: records.length, source_rows: historyRows.reduce((a, b) => a + b, 0), rows_per_offer: distribution(historyRows), one_row_keys: historyRows.filter((n) => n === 1).length, history_keys_multiple_timestamps: records.filter((item) => item.minTime !== item.maxTime).length, latest_timestamp_ties: records.filter((item) => item.latestRows > 1).length, latest_price_conflicts: records.filter((item) => item.latestPrices.size > 1).length };
}

const maps = Object.fromEntries(Object.keys(definitions).map((journey) => [journey, new Map()]));
const datasetRows = { liquid: 0, glp: 0 };
for (const dataset of ['liquid','glp']) {
  const file = path.join(minimizedRoot, 'prices', `${dataset}-current.csv.gz`); let header;
  for await (const row of csvRows(file)) {
    if (!header) { header = row.map(clean); if (JSON.stringify(header) !== JSON.stringify(datasetSchemas[dataset])) throw new Error(`${dataset}: schema inesperado`); continue; }
    datasetRows[dataset] += 1; const item = Object.fromEntries(header.map((field, index) => [field, clean(row[index])]));
    for (const [journey, definition] of Object.entries(definitions)) if (definition.dataset === dataset && belongs(item, definition)) updateOffer(maps[journey], item, dataset);
  }
}

const journeys = {};
for (const [journey, definition] of Object.entries(definitions)) {
  const records = [...maps[journey].values()].map((item) => stageRecord(item, definition));
  const controlled = records.filter((item) => item.department === 'LIMA' && item.province === 'LIMA' && (
    (journey === 'J1' && item.product === 'GASOHOL REGULAR') ||
    journey === 'J2' ||
    (journey === 'J3' && item.product === 'GLP - G') ||
    (['J4','J5','J6','J7'].includes(journey) && item.product === 'Cilindros de 10 Kg de GLP')
  ));
  const controlledFilter = journey === 'J1' ? 'GASOHOL REGULAR / S/ por galón'
    : journey === 'J2' ? 'J2 GNV completo / unidades observadas separadas'
      : journey === 'J3' ? 'GLP - G / Galones'
        : 'Cilindros de 10 Kg de GLP / S/ por cilindro';
  const controlledFresh = controlled.filter((item) => item.priceUsable && !item.conflict && item.dateInterpretable && item.age >= 0 && item.age <= 30);
  journeys[journey] = {
    definition: { value: definition.value, dataset: definition.dataset, activities: definition.activities, products: definition.products, clients: definition.clients ?? null, registry_activities: definition.registry, geography: definition.geo },
    offer_key: definition.dataset === 'glp' ? ['REGISTRO','ACTIVIDAD','PRODUCTO','TIPO_DE_CLIENTE','MARCA','UNIDAD'] : ['REGISTRO','ACTIVIDAD','PRODUCTO','UNIDAD'],
    selection_policy: 'Máxima FECHA_DE_REGISTRO por clave; si el máximo tiene precios distintos, no se elige y se clasifica conflicto. Precio positivo y fecha interpretable; publicable solo con antigüedad <=30 días.',
    grain: grain(records), summary: summarize(records, true),
    by_activity: breakdown(records, 'activity'), by_product: breakdown(records, 'product'), by_department: breakdown(records, 'department'),
    controlled_lima_province_lima: controlled.length ? { filter: controlledFilter, comparison_unit: definition.dataset === 'glp' && journey !== 'J3' ? 'oferta establecimiento×marca' : 'oferta de establecimiento para producto/unidad', units_all_latest: histogram(controlled.map((item) => item.unit)), units_within_30d: histogram(controlledFresh.map((item) => item.unit)), ...summarize(controlled) } : null,
    special_categories: journey === 'J1' ? Object.fromEntries([activity.floating,activity.rural].map((name) => [name, summarize(records.filter((item) => item.activity === name))])) : undefined,
  };
}

const large = currentAcquisitions.map((item) => ({ source_id: item.source_id, bytes: item.bytes, duration_seconds: Number(((Date.parse(item.completed_at) - Date.parse(item.requested_at)) / 1000).toFixed(3)), throughput_mib_s: Number((item.bytes / 1048576 / ((Date.parse(item.completed_at) - Date.parse(item.requested_at)) / 1000)).toFixed(3)), status: item.response_status, accepts_ranges: item.response_headers['accept-ranges'] ?? null, etag: item.response_headers.etag ?? null, last_modified: item.response_headers['last-modified'] ?? null }));
const totalLargeBytes = large.reduce((sum, item) => sum + item.bytes, 0); const totalLargeSeconds = large.reduce((sum, item) => sum + item.duration_seconds, 0);
const catalogs = JSON.parse(fs.readFileSync(path.join(minimizedRoot, 'knowledge', 'catalogs.json'), 'utf8'));
const gate02Profile = JSON.parse(fs.readFileSync(path.join(derivedRoot, 'profile.json'), 'utf8'));
const facilitoContrast = fs.existsSync(contrastPath) ? JSON.parse(fs.readFileSync(contrastPath, 'utf8')) : null;
const ownerVerified = {
  classification: 'OWNER-VERIFIED / TRUSTED INPUT; no recalculado en este repositorio', snapshot_date: '2026-08-12',
  scope: { price_rows: 17472, establishments: 5685, unit: 'aprox. establecimiento × producto × último precio reportado; particiones J1–J6 no entregadas' },
  freshness: { within_24h_percent: 55, within_7d_percent: 91, within_30d_percent: 97, over_30d_raw_rows: 506, publication_rule: 'Facilito publica el último precio reportado por máximo 30 días; el Art. 18 no define qué ocurre después. >30d no es automáticamente mostrable ni equivale a precio falso.' },
  chain: { registry_exact: { numerator: 5659, denominator: 5685, percent: 99.54 }, gis_n_exact: { numerator: 5279, denominator: 5685, percent: 92.86 }, safe_geography: { numerator: 5345, denominator: 5685, percent: 94.02 }, urban_road_excluding_144_floating_and_101_rural: { establishments: { numerator: 5345, denominator: 5440, percent: 98.25 }, price_rows: { numerator: 16728, denominator: 16994, percent: 98.43 } }, surco: { numerator: 28, denominator: 28 } },
  identity: { marca_blank: { numerator: 17472, denominator: 17472 }, recognizable_commercial_name_available: false },
  limits: ['No hay artefacto EVPC local para particionar por journey.', 'PRODUCTO_ACTIVO y ULT_PRECIO_DIF_CERO no demuestran stock.', 'No se repiten joins EVPC↔Registro↔GIS.'],
};
const assertions = [];
function assert(id, pass, observed) { assertions.push({ id, pass: Boolean(pass), observed }); }
assert('gate02-integrity-baseline', gate02Profile.assertion_summary.failed === 0, gate02Profile.assertion_summary);
assert('current-source-rows', datasetRows.liquid === 1319922 && datasetRows.glp === 522380, datasetRows);
assert('no-future-selected-offers', Object.values(journeys).every((item) => item.summary.freshness.future === 0), Object.fromEntries(Object.entries(journeys).map(([id, item]) => [id, item.summary.freshness.future])));
const gisIntersections = {};
for (const [left, right] of [['34','35'],['34','36'],['35','36']]) gisIntersections[`${left}∩${right}`] = [...gisN[left]].filter((value) => gisN[right].has(value)).length;
assert('gis-direct-layers-disjoint', Object.values(gisIntersections).every((count) => count === 0), gisIntersections);
const activityGeoRegression = {
  J2: Object.fromEntries(Object.entries(journeys.J2.by_activity).map(([name, item]) => [name, { registered: item.funnel.exact_unambiguous_registry.offers, safe: item.funnel.safe_coordinate.offers }])),
  J3: Object.fromEntries(Object.entries(journeys.J3.by_activity).map(([name, item]) => [name, { registered: item.funnel.exact_unambiguous_registry.offers, safe: item.funnel.safe_coordinate.offers }])),
};
const expectedActivityGeoRegression = {
  J2: {
    [activity.eessBoth]: { registered: 229, safe: 227 }, [activity.eessGnv]: { registered: 38, safe: 38 },
    [activity.comboGnv]: { registered: 11, safe: 11 }, [activity.evpGnv]: { registered: 5, safe: 5 },
  },
  J3: {
    [activity.eessGlp]: { registered: 1402, safe: 1385 }, [activity.eessBoth]: { registered: 227, safe: 224 },
    [activity.gasocentro]: { registered: 70, safe: 68 }, [activity.comboGnv]: { registered: 12, safe: 12 },
  },
};
assert('activity-level-geography-regression', Object.entries(expectedActivityGeoRegression).every(([journey, activities]) => Object.entries(activities).every(([name, expected]) => activityGeoRegression[journey]?.[name]?.registered === expected.registered && activityGeoRegression[journey]?.[name]?.safe === expected.safe)), activityGeoRegression);
const journeyGeoCoverage = Object.fromEntries(['J1','J2','J3','J4','J5','J6'].map((id) => {
  const funnel = journeys[id].summary.funnel;
  return [id, { safe: funnel.safe_coordinate.offers, registered: funnel.exact_unambiguous_registry.offers, percent: pct(funnel.safe_coordinate.offers, funnel.exact_unambiguous_registry.offers) }];
}));
assert('journey-geography-plausibility', Object.values(journeyGeoCoverage).every((item) => item.percent >= 90), journeyGeoCoverage);
assert('j2-j3-geography-regression', journeyGeoCoverage.J2.safe === 281 && journeyGeoCoverage.J2.registered === 283 && journeyGeoCoverage.J3.safe === 1689 && journeyGeoCoverage.J3.registered === 1711, { J2: journeyGeoCoverage.J2, J3: journeyGeoCoverage.J3 });
const sensitivityRegression = Object.fromEntries(Object.entries(journeys).map(([id, item]) => [id, Object.fromEntries(Object.entries(item.summary.funnel_sensitivity).map(([threshold, value]) => [threshold, value.safe_coordinate_percent_of_price_usable]))]));
const expectedSensitivityRegression = {
  J1: { within_30d: 82.826, within_90d: 83.465, no_age_limit: 84.079 },
  J2: { within_30d: 75.335, within_90d: 77.748, no_age_limit: 86.059 },
  J3: { within_30d: 86.13, within_90d: 86.741, no_age_limit: 87.455 },
  J4: { within_30d: 56.817, within_90d: 74.692, no_age_limit: 91.78 },
  J5: { within_30d: 71.858, within_90d: 74.941, no_age_limit: 87.589 },
  J6: { within_30d: 61.373, within_90d: 82.546, no_age_limit: 91.559 },
  J7: { within_30d: 0, within_90d: 0, no_age_limit: 0 },
};
assert('funnel-sensitivity-regression', JSON.stringify(sensitivityRegression) === JSON.stringify(expectedSensitivityRegression), sensitivityRegression);
const priceValidity = Object.fromEntries(Object.entries(journeys).map(([id, item]) => [id, item.summary.exceptions.invalid_or_nonpositive_unconflicted_latest_price]));
assert('latest-unconflicted-prices-valid', Object.values(priceValidity).every((count) => count === 0), priceValidity);
assert('j2-controlled-unit-mix', JSON.stringify(journeys.J2.controlled_lima_province_lima.units_within_30d) === JSON.stringify({ Kilogramos: 1, 'Metros Cúbicos': 232 }), journeys.J2.controlled_lima_province_lima.units_within_30d);
const identityClassification = Object.fromEntries(Object.entries(journeys).map(([id, item]) => [id, item.summary.funnel.recognizable_establishment_identity]));
assert('identity-stage-explicitly-unmeasured', Object.values(identityClassification).every((item) => item.measured === false && item.offers === 0 && item.classification.startsWith('CONSTANTE DE POLÍTICA')), identityClassification);
if (facilitoContrast) {
  const discoveryRows = Object.fromEntries(fs.readFileSync(path.join(root, 'docs', 'descubrimiento.md'), 'utf8').split('\n').map((line) => line.match(/^\| (J[1-7]) \|.*\| ([\d,]+) filas \|/)).filter(Boolean).map((match) => [match[1], Number(match[2].replace(/,/g, ''))]));
  const publicObserved = Object.fromEntries(facilitoContrast.public_observation.cases.map((item) => [item.journey, item.public_rows]));
  assert('facilito-public-baseline-complete', Object.keys(publicObserved).length === 7 && JSON.stringify(publicObserved) === JSON.stringify(discoveryRows), { artifact: publicObserved, discovery: discoveryRows });
  const observed = facilitoContrast.repo_reconstruction.cases.map((item) => {
    const controlled = journeys[item.journey].controlled_lima_province_lima;
    return { journey: item.journey, expected_all: controlled?.offers ?? 0, observed_all: item.all_latest_offers, expected_fresh: controlled?.funnel.within_30d.offers ?? 0, observed_fresh: item.within_30d_offers, expected_establishments: controlled?.funnel.within_30d.establishments ?? 0, observed_establishments: item.within_30d_establishments };
  });
  assert('facilito-contrast-reconstruction', observed.length === 7 && observed.every((item) => item.expected_all === item.observed_all && item.expected_fresh === item.observed_fresh && item.expected_establishments === item.observed_establishments), observed);
  assert('facilito-contrast-comparison-units', facilitoContrast.repo_reconstruction.cases.every((item) => item.comparison_unit && item.assumption), facilitoContrast.repo_reconstruction.cases.map((item) => ({ journey: item.journey, comparison_unit: item.comparison_unit, assumption: item.assumption })));
}
const output = {
  schema_version: 1, snapshot_date: snapshot, as_of: asOf.toISOString(), generated_by: 'scripts/analyze-gate-0.3.mjs',
  evidence_classes: { reproduced: 'Cálculos sobre snapshots minimizados e íntegros del repo.', owner_verified: 'Input externo aceptado; no recalculado ni presentado como permanente.', public_contrast: fs.existsSync(contrastPath) ? 'Resultados públicos cerrados en Gate 0.1 reutilizados y control de acceso actual, ambos sanitizados.' : 'Pendiente.' },
  offer_model: { liquid_key: ['REGISTRO','ACTIVIDAD','PRODUCTO','UNIDAD'], glp_key: ['REGISTRO','ACTIVIDAD','PRODUCTO','TIPO_DE_CLIENTE','MARCA','UNIDAD'], time_field: 'FECHA_DE_REGISTRO', policy: 'Seleccionar máximo timestamp por clave; conflicto de precios en el máximo queda excluido; no interpretar actividad ni precio distinto de cero como stock.' },
  geography_model: { activity_to_layer: gisLayerByActivity, direct_layer_n_intersections: gisIntersections, plant_bridge: 'Registro actividad 20 CODIGO_OSINERGMIN → GIS 28 COD_OSINERGMIN', distributor_layer: null },
  journeys, owner_verified_baseline: ownerVerified,
  external_review_limits: {
    classification: 'EVIDENCIA EXTERNA DE REVISIÓN / 2026-08-14; no recalculada por este script',
    identity_bulk: 'El formulario RHO y el schema público del Padrón Reducido SUNAT no contienen nombre comercial; la consulta SUNAT individual requiere CAPTCHA y queda fuera de alcance.',
    regulation: { article_4: 'PRICE se acopla funcionalmente con SCOP y la publicación en Facilito; no demuestra linaje técnico CSV→journey.', article_18: 'Fija hasta 30 días de publicación en Facilito y no define el estado posterior; una observación >30d es antigua, no necesariamente falsa.' },
    reuse: 'Los catálogos CSV de precios declaran ODC-By. GIS expone copyrightText OSINERGMIN sin licencia explícita y la licencia de EVPC no se verificó: su reutilización pública permanece ambigua.',
  },
  other_sources: { daily_anonymized: { rows: gate02Profile.prices.daily_anonymized.rows, last_evaluation: gate02Profile.prices.daily_anonymized.dates.FE_EVAL.max, usable_for_current_named_offer: false }, dmin: { rows: gate02Profile.prices.dmin.rows, last_report: gate02Profile.prices.dmin.dates.FECHA_DE_REGISTRO.max, journey_mapping: null } },
  operations: { full_downloads: large, total_bytes: totalLargeBytes, total_duration_seconds: Number(totalLargeSeconds.toFixed(3)), aggregate_throughput_mib_s: Number((totalLargeBytes / 1048576 / totalLargeSeconds).toFixed(3)), projected_full_download_gib_30_daily_runs: Number((totalLargeBytes * 30 / 1073741824).toFixed(3)), mechanism: 'Dos descargas completas seriales; Range/ETag/Last-Modified observados, sin API incremental ni conditional GET verificado.', licenses: { price_catalogs: { status: 'confirmada en fichas', values: Object.fromEntries(catalogs.filter((item) => ['dmin','daily-anonymized','glp','liquid'].includes(item.id)).map((item) => [item.id, item.license])) }, registry: { status: 'ambigua', declared_license: null }, gis: { status: 'ambigua', declared_license: null, copyright_text: 'OSINERGMIN' }, evpc: { status: 'ambigua', declared_license: null, evidence_classification: 'OWNER-VERIFIED' } } },
  facilito_contrast: facilitoContrast,
  assertions, assertion_summary: { passed: assertions.filter((item) => item.pass).length, failed: assertions.filter((item) => !item.pass).length },
};
fs.mkdirSync(evidenceRoot, { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: path.relative(root, outputPath), journeys: Object.fromEntries(Object.entries(journeys).map(([id, item]) => [id, item.summary.funnel])), assertions: output.assertion_summary })}\n`);
if (output.assertion_summary.failed) process.exitCode = 1;
