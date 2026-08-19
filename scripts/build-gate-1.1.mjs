#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { officialAnchorFromRegistration } from '../app/official-anchor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = process.env.GATE_SNAPSHOT_DATE ?? '2026-08-14';
const minimizedRoot = process.env.GATE_MINIMIZED_ROOT ? path.resolve(root, process.env.GATE_MINIMIZED_ROOT) : path.join(root, 'data', 'minimized', snapshot);
const provenanceRoot = process.env.GATE_PROVENANCE_ROOT ? path.resolve(root, process.env.GATE_PROVENANCE_ROOT) : path.join(root, 'data', 'provenance', snapshot);
const localOutput = process.env.GATE_LOCAL_OUTPUT ? path.resolve(root, process.env.GATE_LOCAL_OUTPUT) : path.join(root, '.local-cache', 'gate-1.1', snapshot, 'experiment-dataset-lima-province.json');
const evidenceOutput = process.env.GATE_EVIDENCE_OUTPUT ? path.resolve(root, process.env.GATE_EVIDENCE_OUTPUT) : path.join(root, 'evidence', `gate-1.1-lima-province-${snapshot}.json`);
const schemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const fixturePath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const sep = '\u001f';

const target = {
  journey: 'J1',
  department: 'LIMA',
  province: 'LIMA',
  population: 'todas las ofertas frescas de Lima provincia; sin límite distrital',
  originPolicy: 'ubicación actual real o simulada; idéntica en A y B',
  sourceProduct: 'GASOHOL REGULAR',
  product: 'Gasohol Regular',
  sourceUnit: 'Galones',
  unit: 'galón',
  displayUnit: 'S/ por galón',
};
const activityToRegistry = {
  'ESTACIÓN DE SERVICIOS / GRIFOS': '01',
  'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP': '02',
  'EE.SS con GNV': '05',
  'EE.SS con GLP y GNV': '06',
};
const exactScopeActivities = Object.keys(activityToRegistry);
const warnings = [
  'IDENTIDAD PROVISIONAL: la razón social y la dirección no equivalen a nombre comercial.',
  'El precio reportado no demuestra stock.',
  'Uso exclusivo del experimento privado; no publicar.',
];
const minimizedLiquidSchema = ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'];
const rawLiquidSchema = ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','RUC','RAZON_SOCIAL','DEPARTAMENTO','PROVINCIA','DISTRITO','DIRECCION','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'];
const registrySchema = ['SOURCE_ACTIVITY','REGISTRO','CODIGO_OSINERGMIN','CODIGO','DEPARTAMENTO','PROVINCIA','DISTRITO','ACTIVIDAD'];
const gisSchema = ['LAYER','OBJECTID','N','COD_OSINERGMIN','CODIGO_DGH','DEPARTAMENTO','PROVINCIA','DISTRITO','LONGITUDE','LATITUDE'];

const clean = (value) => String(value ?? '').replace(/\r/g, '').trim();
const normalizeHeader = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const percentage = (numerator, denominator) => denominator ? Number((numerator / denominator * 100).toFixed(3)) : null;
const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const territory = (row) => ({
  department: row.DEPARTAMENTO ?? row.department,
  province: row.PROVINCIA ?? row.province,
  district: row.DISTRITO ?? row.district,
});
const isPopulationTerritory = (row) => territory(row).department === target.department && territory(row).province === target.province;
const sameTerritory = (left, right) => JSON.stringify(territory(left)) === JSON.stringify(territory(right));
const uniqueEstablishments = (items) => new Set(items.map((item) => item.registro)).size;
const stableHash = (kind, value) => crypto.createHash('sha256').update(`facilito-ux-lab|gate-1.1|v1|${kind}|${value}`).digest('hex').slice(0, 24);
const digestBuffer = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseTimestamp(value) {
  const match = clean(value).match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}-05:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function* csvRows(file, onFileChunk = null) {
  let source = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  if (onFileChunk) {
    source = source.pipe(new Transform({
      transform(chunk, encoding, callback) { onFileChunk(chunk); callback(null, chunk); },
    }));
  }
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
      if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) throw new Error(`${relative}: schema inesperado`);
    } else {
      if (row.length !== header.length) throw new Error(`${relative}: fila de ancho inesperado`);
      rows.push(Object.fromEntries(header.map((field, index) => [field, clean(row[index])])));
    }
  }
  return rows;
}

function offerKey(row) {
  return ['REGISTRO_DE_HIDROCARBUROS','ACTIVIDAD','PRODUCTO','UNIDAD'].map((field) => row[field]).join(sep);
}

function updateOffer(map, row) {
  const key = offerKey(row);
  const timestamp = parseTimestamp(row.FECHA_DE_REGISTRO);
  const time = timestamp?.getTime() ?? null;
  const numericPrice = Number(row.PRECIO_DE_VENTA_SOLES.replace(',', '.'));
  const candidate = {
    id: row.ID3,
    registro: row.REGISTRO_DE_HIDROCARBUROS,
    activity: row.ACTIVIDAD,
    product: row.PRODUCTO,
    unit: row.UNIDAD,
    department: row.DEPARTAMENTO,
    province: row.PROVINCIA,
    district: row.DISTRITO,
    timestamp,
    time,
    price: Number.isFinite(numericPrice) ? numericPrice : null,
  };
  let item = map.get(key);
  if (!item) {
    item = { key, registro: candidate.registro, activity: candidate.activity, sourceRows: 0, territories: new Set(), maxTime: null, latest: [] };
    map.set(key, item);
  }
  item.sourceRows += 1;
  item.territories.add([candidate.department, candidate.province, candidate.district].join('|'));
  if (time !== null && (item.maxTime === null || time > item.maxTime)) {
    item.maxTime = time;
    item.latest = [candidate];
  } else if (time !== null && time === item.maxTime) item.latest.push(candidate);
}

function selectedOffer(item, cutoff) {
  const latestPrices = new Set(item.latest.map((row) => row.price === null ? 'invalid' : row.price));
  const latestTerritories = new Set(item.latest.map((row) => [row.department, row.province, row.district].join('|')));
  const selected = [...item.latest].sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
  const ageDays = selected?.timestamp ? (cutoff.getTime() - selected.timestamp.getTime()) / 86400000 : null;
  return {
    ...item,
    selected,
    ageDays,
    priceConflict: latestPrices.size > 1,
    territoryConflict: latestTerritories.size > 1,
    latestRows: item.latest.length,
    priceUsable: selected?.price !== null && selected?.price > 0,
  };
}

function validateDataset(dataset, expectedSnapshot = snapshot) {
  const errors = [];
  const rootKeys = ['schema_version','dataset_id','scope','temporal_context','offers'];
  const scopeKeys = ['journey','department','province','population','origin_policy','product','display_unit','usage'];
  const temporalKeys = ['snapshot_date','source_max_reported_at','cutoff_at','acquisition_started_at','acquisition_completed_at','source_last_modified_at'];
  const offerKeys = ['experimental_id','establishment_id','source_row_id','product','currency','unit','display_unit','price','price_reported_at','age_days_at_cutoff','territory','coordinate','provisional_identity','source','warnings'];
  if (!exactKeys(dataset, rootKeys)) errors.push('root-keys');
  if (dataset.schema_version !== '1.1.0') errors.push('schema-version');
  if (!/^gate-1\.1-lima-province-gasohol-regular-\d{4}-\d{2}-\d{2}$/.test(dataset.dataset_id ?? '')) errors.push('dataset-id');
  if (!exactKeys(dataset.scope, scopeKeys)) errors.push('scope-keys');
  const expectedScope = { journey: 'J1', department: target.department, province: target.province, population: target.population, origin_policy: target.originPolicy, product: target.product, display_unit: target.displayUnit, usage: 'experimento privado; no publicar' };
  if (JSON.stringify(dataset.scope) !== JSON.stringify(expectedScope)) errors.push('scope-values');
  if (!exactKeys(dataset.temporal_context, temporalKeys)) errors.push('temporal-keys');
  for (const field of temporalKeys.filter((field) => field !== 'snapshot_date')) if (!isIso(dataset.temporal_context?.[field])) errors.push(`temporal-${field}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.temporal_context?.snapshot_date ?? '')) errors.push('snapshot-date');
  if (isIso(dataset.temporal_context?.acquisition_started_at) && isIso(dataset.temporal_context?.acquisition_completed_at)
    && Date.parse(dataset.temporal_context.acquisition_started_at) > Date.parse(dataset.temporal_context.acquisition_completed_at)) errors.push('acquisition-order');
  if (dataset.temporal_context?.cutoff_at !== dataset.temporal_context?.acquisition_completed_at) errors.push('cutoff-semantics');
  if (isIso(dataset.temporal_context?.source_max_reported_at) && isIso(dataset.temporal_context?.cutoff_at)
    && Date.parse(dataset.temporal_context.source_max_reported_at) > Date.parse(dataset.temporal_context.cutoff_at)) errors.push('source-max-after-cutoff');
  if (!Array.isArray(dataset.offers)) errors.push('offers-array');
  const ids = { offer: new Set(), establishment: new Set(), row: new Set() };
  for (const [index, offer] of (dataset.offers ?? []).entries()) {
    const prefix = `offer-${index}`;
    if (!exactKeys(offer, offerKeys)) errors.push(`${prefix}-keys`);
    if (!/^offer_[a-f0-9]{24}$/.test(offer.experimental_id ?? '')) errors.push(`${prefix}-id`);
    if (!/^est_[a-f0-9]{24}$/.test(offer.establishment_id ?? '')) errors.push(`${prefix}-establishment-id`);
    if (!/^row_[a-f0-9]{24}$/.test(offer.source_row_id ?? '')) errors.push(`${prefix}-row-id`);
    if (ids.offer.has(offer.experimental_id)) errors.push(`${prefix}-duplicate-id`); ids.offer.add(offer.experimental_id);
    if (ids.row.has(offer.source_row_id)) errors.push(`${prefix}-duplicate-row-id`); ids.row.add(offer.source_row_id);
    ids.establishment.add(offer.establishment_id);
    if (offer.product !== target.product || offer.currency !== 'PEN' || offer.unit !== target.unit || offer.display_unit !== target.displayUnit) errors.push(`${prefix}-product-unit`);
    if (!(typeof offer.price === 'number' && offer.price > 0)) errors.push(`${prefix}-price`);
    if (!isIso(offer.price_reported_at)) errors.push(`${prefix}-reported-at`);
    if (!(typeof offer.age_days_at_cutoff === 'number' && offer.age_days_at_cutoff >= 0 && offer.age_days_at_cutoff <= 30)) errors.push(`${prefix}-age`);
    if (isIso(offer.price_reported_at) && isIso(dataset.temporal_context?.cutoff_at)) {
      const expectedAge = Number(((Date.parse(dataset.temporal_context.cutoff_at) - Date.parse(offer.price_reported_at)) / 86400000).toFixed(3));
      if (offer.age_days_at_cutoff !== expectedAge) errors.push(`${prefix}-age-consistency`);
    }
    if (!exactKeys(offer.territory, ['department','province','district'])) errors.push(`${prefix}-territory-keys`);
    if (offer.territory?.department !== target.department || offer.territory?.province !== target.province || !clean(offer.territory?.district)) errors.push(`${prefix}-territory`);
    if (!exactKeys(offer.coordinate, ['longitude','latitude','classification'])) errors.push(`${prefix}-coordinate-keys`);
    if (!(offer.coordinate?.longitude >= -82 && offer.coordinate?.longitude <= -68 && offer.coordinate?.latitude >= -19 && offer.coordinate?.latitude <= 1)) errors.push(`${prefix}-coordinate`);
    if (offer.coordinate?.classification !== 'coordenada oficial exacta; reutilización pública no autorizada') errors.push(`${prefix}-coordinate-classification`);
    if (!exactKeys(offer.provisional_identity, ['label','legal_name','address'])) errors.push(`${prefix}-identity-keys`);
    if (offer.provisional_identity?.label !== 'IDENTIDAD PROVISIONAL — razón social/dirección' || !clean(offer.provisional_identity?.legal_name) || !clean(offer.provisional_identity?.address)) errors.push(`${prefix}-identity`);
    if (!exactKeys(offer.source, ['dataset_id','snapshot_date','acquired_at','cutoff_at'])) errors.push(`${prefix}-source-keys`);
    if (offer.source?.dataset_id !== 'liquid-current' || offer.source?.snapshot_date !== expectedSnapshot || !isIso(offer.source?.acquired_at) || !isIso(offer.source?.cutoff_at)) errors.push(`${prefix}-source`);
    if (offer.source?.acquired_at !== dataset.temporal_context?.acquisition_completed_at || offer.source?.cutoff_at !== dataset.temporal_context?.cutoff_at) errors.push(`${prefix}-source-temporal-context`);
    if (JSON.stringify(offer.warnings) !== JSON.stringify(warnings)) errors.push(`${prefix}-warnings`);
  }
  return errors;
}

function writeAtomic(file, value, mode = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, value, mode === null ? undefined : { mode });
  if (mode !== null) fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, file);
}

const acquisitions = fs.readFileSync(path.join(provenanceRoot, 'acquisitions.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const acquisition = acquisitions.find((item) => item.source_id === 'liquid-current');
if (!acquisition) throw new Error('Falta procedencia de liquid-current');
const cutoff = new Date(acquisition.completed_at);
if (!Number.isFinite(cutoff.getTime())) throw new Error('Corte inválido en procedencia');
const rawPath = path.join(root, acquisition.cache_path);
if (!fs.existsSync(rawPath)) throw new Error('Falta el CSV original de líquidos en caché ignorada');

const registryRows = await readTable('registry/authorizations.csv.gz', registrySchema);
const gisRows = await readTable('gis/features.csv.gz', gisSchema);
const registryByExactKey = new Map();
for (const row of registryRows) {
  const key = `${row.SOURCE_ACTIVITY}${sep}${row.REGISTRO}`;
  if (!registryByExactKey.has(key)) registryByExactKey.set(key, []);
  registryByExactKey.get(key).push(row);
}
const gis35ByN = new Map();
for (const row of gisRows.filter((item) => item.LAYER === '35')) {
  if (!gis35ByN.has(row.N)) gis35ByN.set(row.N, []);
  gis35ByN.get(row.N).push(row);
}

let minimizedHeader;
let liquidSourceRows = 0;
let sourceMaxReportedAt = null;
let exactScopeSourceRows = 0;
let duplicateScopeSourceIds = 0;
const scopeSourceIds = new Set();
const offerMap = new Map();
for await (const row of csvRows(path.join(minimizedRoot, 'prices', 'liquid-current.csv.gz'))) {
  if (!minimizedHeader) {
    minimizedHeader = row.map(clean);
    if (JSON.stringify(minimizedHeader) !== JSON.stringify(minimizedLiquidSchema)) throw new Error('Schema minimizado de líquidos inesperado');
    continue;
  }
  if (row.length !== minimizedHeader.length) throw new Error('Fila minimizada de ancho inesperado');
  liquidSourceRows += 1;
  const item = Object.fromEntries(minimizedHeader.map((field, index) => [field, clean(row[index])]));
  const timestamp = parseTimestamp(item.FECHA_DE_REGISTRO);
  if (timestamp && (!sourceMaxReportedAt || timestamp > sourceMaxReportedAt)) sourceMaxReportedAt = timestamp;
  if (!exactScopeActivities.includes(item.ACTIVIDAD) || item.PRODUCTO !== target.sourceProduct || item.UNIDAD !== target.sourceUnit) continue;
  exactScopeSourceRows += 1;
  if (scopeSourceIds.has(item.ID3)) duplicateScopeSourceIds += 1;
  scopeSourceIds.add(item.ID3);
  updateOffer(offerMap, item);
}

const latestOffers = [...offerMap.values()].map((item) => selectedOffer(item, cutoff));
const priceTerritoryLimaProvince = latestOffers.filter((item) => item.latest.length > 0 && item.latest.every(isPopulationTerritory) && !item.territoryConflict);
const freshLimaProvince = priceTerritoryLimaProvince.filter((item) => !item.priceConflict && item.priceUsable && item.ageDays >= 0 && item.ageDays <= 30);
for (const item of freshLimaProvince) {
  const registryActivity = activityToRegistry[item.activity];
  item.registryMatches = registryByExactKey.get(`${registryActivity}${sep}${item.registro}`) ?? [];
  item.registryExact = item.registryMatches.length === 1;
  item.registryTerritoryExact = item.registryExact && isPopulationTerritory(item.registryMatches[0]) && sameTerritory(item.selected, item.registryMatches[0]);
  item.gisMatches = gis35ByN.get(item.registro) ?? [];
  item.gisExact = item.gisMatches.length === 1;
  const longitude = Number(item.gisMatches[0]?.LONGITUDE);
  const latitude = Number(item.gisMatches[0]?.LATITUDE);
  item.coordinateSafe = item.gisExact && Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -82 && longitude <= -68 && latitude >= -19 && latitude <= 1;
  item.gisTerritoryExact = item.gisExact && isPopulationTerritory(item.gisMatches[0]) && sameTerritory(item.selected, item.gisMatches[0]);
  item.longitude = longitude;
  item.latitude = latitude;
}
const registryExact = freshLimaProvince.filter((item) => item.registryExact);
const gisExact = registryExact.filter((item) => item.gisExact);
const geospatiallyEligible = gisExact.filter((item) => item.registryTerritoryExact && item.gisTerritoryExact && item.coordinateSafe);

const targetRawIds = new Set(geospatiallyEligible.map((item) => item.selected.id));
const rawIdentities = new Map();
let rawHeader;
let rawBytes = 0;
const rawHash = crypto.createHash('sha256');
for await (const row of csvRows(rawPath, (chunk) => { rawHash.update(chunk); rawBytes += chunk.length; })) {
  if (!rawHeader) {
    rawHeader = row.map(normalizeHeader);
    if (JSON.stringify(rawHeader) !== JSON.stringify(rawLiquidSchema)) throw new Error(`Schema original de líquidos inesperado: ${JSON.stringify(rawHeader)}`);
    continue;
  }
  if (row.length !== rawHeader.length) throw new Error('Fila original de ancho inesperado');
  const id = clean(row[0]);
  if (!targetRawIds.has(id)) continue;
  if (!rawIdentities.has(id)) rawIdentities.set(id, []);
  const item = Object.fromEntries(rawHeader.map((field, index) => [field, clean(row[index])]));
  rawIdentities.get(id).push({
    id: item.ID3,
    activity: item.ACTIVIDAD,
    registro: item.REGISTRO_DE_HIDROCARBUROS,
    department: item.DEPARTAMENTO,
    province: item.PROVINCIA,
    district: item.DISTRITO,
    reportedAt: item.FECHA_DE_REGISTRO,
    product: item.PRODUCTO,
    price: item.PRECIO_DE_VENTA_SOLES,
    unit: item.UNIDAD,
    legalName: item.RAZON_SOCIAL,
    address: item.DIRECCION,
  });
}
const observedRawSha256 = rawHash.digest('hex');

const contractReady = geospatiallyEligible.filter((item) => {
  const identities = rawIdentities.get(item.selected.id) ?? [];
  item.rawIdentityRows = identities;
  item.identity = identities.length === 1 ? identities[0] : null;
  return item.identity && item.identity.legalName && item.identity.address;
});
const temporalContext = {
  snapshot_date: snapshot,
  source_max_reported_at: sourceMaxReportedAt.toISOString(),
  cutoff_at: cutoff.toISOString(),
  acquisition_started_at: new Date(acquisition.requested_at).toISOString(),
  acquisition_completed_at: new Date(acquisition.completed_at).toISOString(),
  source_last_modified_at: new Date(acquisition.response_headers['last-modified']).toISOString(),
};
const dataset = {
  schema_version: '1.1.0',
  dataset_id: `gate-1.1-lima-province-gasohol-regular-${snapshot}`,
  scope: { journey: target.journey, department: target.department, province: target.province, population: target.population, origin_policy: target.originPolicy, product: target.product, display_unit: target.displayUnit, usage: 'experimento privado; no publicar' },
  temporal_context: temporalContext,
  offers: contractReady.map((item) => ({
    experimental_id: `offer_${stableHash('offer', item.key)}`,
    establishment_id: officialAnchorFromRegistration(item.registro),
    source_row_id: `row_${stableHash('source-row', item.selected.id)}`,
    product: target.product,
    currency: 'PEN',
    unit: target.unit,
    display_unit: target.displayUnit,
    price: item.selected.price,
    price_reported_at: item.selected.timestamp.toISOString(),
    age_days_at_cutoff: Number(item.ageDays.toFixed(3)),
    territory: { department: item.selected.department, province: item.selected.province, district: item.selected.district },
    coordinate: { longitude: item.longitude, latitude: item.latitude, classification: 'coordenada oficial exacta; reutilización pública no autorizada' },
    provisional_identity: { label: 'IDENTIDAD PROVISIONAL — razón social/dirección', legal_name: item.identity.legalName, address: item.identity.address },
    source: { dataset_id: 'liquid-current', snapshot_date: snapshot, acquired_at: temporalContext.acquisition_completed_at, cutoff_at: temporalContext.cutoff_at },
    warnings,
  })).sort((left, right) => left.experimental_id.localeCompare(right.experimental_id)),
};

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const datasetText = `${JSON.stringify(dataset, null, 2)}\n`;
writeAtomic(localOutput, datasetText, 0o600);

const stage = (items) => ({ offers: items.length, establishments: uniqueEstablishments(items) });
const districtHistogram = (items) => Object.fromEntries([...items.reduce((counts, item) => counts.set(item.selected.district, (counts.get(item.selected.district) ?? 0) + 1), new Map())].sort(([left], [right]) => left.localeCompare(right)));
const metrics = {
  grain: {
    source_row: 'ID3 del CSV; se conserva solo como hash local source_row_id',
    offer: 'REGISTRO × ACTIVIDAD × PRODUCTO × UNIDAD; máximo FECHA_DE_REGISTRO',
    establishment: 'REGISTRO; se conserva solo como hash local establishment_id',
  },
  funnel: {
    exact_scope_source_rows: exactScopeSourceRows,
    latest_offers_national: stage(latestOffers),
    latest_offers_price_territory_lima_province: stage(priceTerritoryLimaProvince),
    within_30_days: stage(freshLimaProvince),
    exact_activity_registry: stage(registryExact),
    exact_layer_35_gis: stage(gisExact),
    coordinate_and_three_source_territory_agreement: stage(geospatiallyEligible),
    contract_ready_with_provisional_identity: stage(contractReady),
  },
  coverage: {
    denominator: 'todas las ofertas/establecimientos con precio último válido, territorio de precio exactamente Lima provincia y antigüedad <=30 días en el snapshot reproducible',
    offers: { numerator: contractReady.length, denominator: freshLimaProvince.length, percent: percentage(contractReady.length, freshLimaProvince.length) },
    establishments: { numerator: uniqueEstablishments(contractReady), denominator: uniqueEstablishments(freshLimaProvince), percent: percentage(uniqueEstablishments(contractReady), uniqueEstablishments(freshLimaProvince)) },
  },
  territory: {
    fresh_districts: new Set(freshLimaProvince.map((item) => item.selected.district)).size,
    contract_ready_districts: new Set(contractReady.map((item) => item.selected.district)).size,
    contract_ready_by_district: districtHistogram(contractReady),
  },
  by_activity: Object.fromEntries(exactScopeActivities.map((activity) => [activity, {
    within_30_days: stage(freshLimaProvince.filter((item) => item.activity === activity)),
    registry_no_match: freshLimaProvince.filter((item) => item.activity === activity && item.registryMatches.length === 0).length,
    registry_ambiguous: freshLimaProvince.filter((item) => item.activity === activity && item.registryMatches.length > 1).length,
    gis_no_match_after_registry: registryExact.filter((item) => item.activity === activity && item.gisMatches.length === 0).length,
    contract_ready: stage(contractReady.filter((item) => item.activity === activity)),
  }])),
  exceptions: {
    duplicate_source_row_ids_in_exact_scope: duplicateScopeSourceIds,
    offer_keys_with_multiple_source_rows: latestOffers.filter((item) => item.sourceRows > 1).length,
    latest_timestamp_ties: latestOffers.filter((item) => item.latestRows > 1).length,
    latest_price_conflicts: latestOffers.filter((item) => item.priceConflict).length,
    latest_territory_conflicts: latestOffers.filter((item) => item.territoryConflict).length,
    lima_province_latest_invalid_or_nonpositive_price: priceTerritoryLimaProvince.filter((item) => !item.priceUsable).length,
    lima_province_latest_missing_date: priceTerritoryLimaProvince.filter((item) => !item.selected?.timestamp).length,
    lima_province_over_30_days: priceTerritoryLimaProvince.filter((item) => item.ageDays > 30).length,
    registry_no_match_after_freshness: freshLimaProvince.filter((item) => item.registryMatches.length === 0).length,
    registry_ambiguous_after_freshness: freshLimaProvince.filter((item) => item.registryMatches.length > 1).length,
    registry_territory_mismatch_after_exact_join: registryExact.filter((item) => !item.registryTerritoryExact).length,
    gis_no_match_after_registry: registryExact.filter((item) => item.gisMatches.length === 0).length,
    gis_ambiguous_after_registry: registryExact.filter((item) => item.gisMatches.length > 1).length,
    gis_unsafe_coordinate_after_exact_join: gisExact.filter((item) => !item.coordinateSafe).length,
    gis_territory_mismatch_after_exact_join: gisExact.filter((item) => !item.gisTerritoryExact).length,
    missing_or_ambiguous_provisional_identity: geospatiallyEligible.filter((item) => !item.identity || !item.identity.legalName || !item.identity.address).length,
    multiple_offers_per_establishment: contractReady.length - uniqueEstablishments(contractReady),
  },
};
const failedSurcoPopulation = {
  classification: 'MEDICIÓN PREVIA CONSERVADA; población fallida distinta de la prospectiva',
  scope: { department: 'LIMA', province: 'LIMA', district: 'SANTIAGO DE SURCO', product: 'Gasohol Regular', display_unit: 'S/ por galón' },
  funnel: { latest_offers: 33, within_30_days: 30, registry_exact: 28, gis_exact_and_safe: 26, contract_ready: 26 },
  coverage: { numerator: 26, denominator: 30, percent: 86.667 },
  frozen_abandonment_threshold_percent: 90,
  decision: 'NO-GO para la población Surco; denominador y umbral no se reinterpretan',
};
const frozenAbandonmentThresholdPercent = 90;
const prospectiveDecision = metrics.coverage.offers.percent !== null && metrics.coverage.offers.percent >= frozenAbandonmentThresholdPercent ? 'GO CON LÍMITES' : 'NO-GO';
const ownerVerifiedControl = {
  classification: 'OWNER-VERIFIED / TRUSTED INPUT; no recalculable en este repositorio',
  snapshot_date: '2026-08-12',
  safe_geography: { numerator: 28, denominator: 28 },
  reconciliation: 'Control externo con EVPC y reglas adicionales; no es denominador ni se fuerza igualdad con el universo CSV reproducido de Gate 1.1.',
};
const evidenceBase = {
  schema_version: 2,
  snapshot_date: snapshot,
  generated_by: 'scripts/build-gate-1.1.mjs',
  classification: 'métricas agregadas sanitizadas; no contiene filas ni identidades reales',
  scope: dataset.scope,
  temporal_semantics: {
    price_reported_at: 'FECHA_DE_REGISTRO de la fila fuente seleccionada',
    cutoff_at: 'instante de fin de la adquisición usado para calcular antigüedad',
    acquisition_started_at: 'instante real de inicio registrado durante la descarga',
    acquisition_completed_at: 'instante real de fin registrado durante la descarga; comparte valor con cutoff_at pero no semántica',
    source_last_modified_at: 'cabecera HTTP del recurso adquirido',
    values: temporalContext,
  },
  exact_pipeline: [
    'ACTIVIDAD en lista cerrada J1 urbana + PRODUCTO=GASOHOL REGULAR + UNIDAD=Galones',
    'máximo FECHA_DE_REGISTRO por REGISTRO×ACTIVIDAD×PRODUCTO×UNIDAD; conflicto de precio excluido',
    'territorio de precio LIMA/LIMA exacto, cualquier distrito, y antigüedad 0..30 días',
    'ACTIVIDAD→SOURCE_ACTIVITY y REGISTRO exactos; cardinalidad 1',
    'REGISTRO→GIS layer 35.N exacto; cardinalidad 1 y coordenada segura',
    'departamento, provincia y distrito exactos y concordantes en precio, Registro y GIS',
    'razón social/dirección de la misma fila raw seleccionada, solo en salida ignorada y rotuladas identidad provisional',
  ],
  source_integrity: { liquid_minimized_rows: liquidSourceRows, raw_bytes: rawBytes, raw_sha256: observedRawSha256, acquisition_record_bytes: acquisition.bytes, acquisition_record_sha256: acquisition.sha256 },
  failed_surco_population: failedSurcoPopulation,
  metrics,
  prospective_decision: { status: prospectiveDecision, frozen_abandonment_threshold_percent: frozenAbandonmentThresholdPercent, rule: 'coverage_percent < 90 => NO-GO' },
  owner_verified_control: ownerVerifiedControl,
  local_dataset: { path: path.relative(root, localOutput), offers: dataset.offers.length, sha256: digestBuffer(datasetText), git_classification: 'ignorado; contiene identidad provisional real y coordenadas de reutilización ambigua' },
  gate_1_2_boundary: { schema: path.relative(root, schemaPath), synthetic_fixture: path.relative(root, fixturePath), transport: 'archivo JSON local validado; solo lectura; sin API, database ni red productiva', origin: target.originPolicy, observable_convenience: ['precio','distancia desde el origen','frescura'], excluded: ['marca','descuentos','convenios','scoring de conveniencia'] },
};

const assertions = [];
function assert(id, pass, observed) { assertions.push({ id, pass: Boolean(pass), observed }); }
assert('source-minimized-schema-exact', JSON.stringify(minimizedHeader) === JSON.stringify(minimizedLiquidSchema), minimizedHeader);
assert('source-raw-schema-exact', JSON.stringify(rawHeader) === JSON.stringify(rawLiquidSchema), rawHeader);
assert('source-raw-integrity', rawBytes === acquisition.bytes && observedRawSha256 === acquisition.sha256, { rawBytes, observedRawSha256, expectedBytes: acquisition.bytes, expectedSha256: acquisition.sha256 });
assert('exact-filter-frozen', exactScopeActivities.length === 4 && target.sourceProduct === 'GASOHOL REGULAR' && target.sourceUnit === 'Galones' && target.department === 'LIMA' && target.province === 'LIMA' && !Object.hasOwn(target, 'district'), { activities: exactScopeActivities, product: target.sourceProduct, source_unit: target.sourceUnit, display_unit: target.displayUnit, territory: [target.department,target.province], population: target.population });
assert('scope-source-row-ids-unique', duplicateScopeSourceIds === 0, duplicateScopeSourceIds);
assert('latest-offers-have-selected-row', latestOffers.every((item) => item.selected), latestOffers.filter((item) => !item.selected).length);
assert('lima-province-freshness-conservative', freshLimaProvince.every((item) => item.ageDays >= 0 && item.ageDays <= 30 && item.priceUsable && !item.priceConflict), { offers: freshLimaProvince.length });
assert('joins-exact-and-unambiguous', geospatiallyEligible.every((item) => item.registryMatches.length === 1 && item.gisMatches.length === 1), { registry_exact: registryExact.length, gis_exact: gisExact.length });
assert('territory-agrees-in-three-sources', geospatiallyEligible.every((item) => isPopulationTerritory(item.selected) && sameTerritory(item.selected, item.registryMatches[0]) && sameTerritory(item.selected, item.gisMatches[0])), { eligible: geospatiallyEligible.length });
assert('population-is-not-district-filtered', metrics.territory.fresh_districts > 1 && metrics.territory.contract_ready_districts > 1 && contractReady.every((item) => isPopulationTerritory(item.selected)), metrics.territory);
assert('raw-identity-row-reconciles-with-selected-source-row', contractReady.every((item) => item.rawIdentityRows.length === 1 && item.identity.id === item.selected.id && item.identity.activity === item.selected.activity && item.identity.registro === item.registro && item.identity.product === target.sourceProduct && item.identity.unit === target.sourceUnit && parseTimestamp(item.identity.reportedAt)?.getTime() === item.selected.time && Number(item.identity.price.replace(',', '.')) === item.selected.price && isPopulationTerritory(item.identity) && sameTerritory(item.identity, item.selected)), { selected: geospatiallyEligible.length, ready: contractReady.length });
assert('real-dataset-contract-valid', validateDataset(dataset, snapshot).length === 0, validateDataset(dataset, snapshot));
assert('synthetic-fixture-contract-valid', validateDataset(fixture, '2026-08-14').length === 0, validateDataset(fixture, '2026-08-14'));
const negativeStock = structuredClone(fixture); negativeStock.offers[0].stock = true;
const negativeIdentity = structuredClone(fixture); negativeIdentity.offers[0].provisional_identity.label = 'Nombre comercial';
const negativeAge = structuredClone(fixture); negativeAge.offers[0].age_days_at_cutoff = 31;
const negativeTime = structuredClone(fixture); negativeTime.offers[0].price_reported_at = negativeTime.temporal_context.cutoff_at;
assert('contract-negative-controls', validateDataset(negativeStock, '2026-08-14').includes('offer-0-keys') && validateDataset(negativeIdentity, '2026-08-14').includes('offer-0-identity') && validateDataset(negativeAge, '2026-08-14').includes('offer-0-age') && validateDataset(negativeTime, '2026-08-14').includes('offer-0-age-consistency'), { stock: validateDataset(negativeStock, '2026-08-14'), identity: validateDataset(negativeIdentity, '2026-08-14'), age: validateDataset(negativeAge, '2026-08-14'), time: validateDataset(negativeTime, '2026-08-14') });
const schemaOfferProperties = Object.keys(schema.$defs.offer.properties);
const forbiddenBoundaryFields = ['RUC','ruc','REGISTRO','registro','MARCA','marca','brand','stock','nombre_comercial','commercial_name','discount','descuento','convenio','score','convenience_score'];
assert('boundary-excludes-identity-stock-and-convenience-inference', forbiddenBoundaryFields.every((field) => !schemaOfferProperties.includes(field)) && schema.$defs.offer.additionalProperties === false, schemaOfferProperties);
const ignored = spawnSync('git', ['check-ignore', '-q', path.relative(root, localOutput)], { cwd: root });
assert('real-dataset-path-is-git-ignored', ignored.status === 0, path.relative(root, localOutput));
assert('real-dataset-owner-only-permissions', (fs.statSync(localOutput).mode & 0o077) === 0, (fs.statSync(localOutput).mode & 0o777).toString(8));
const identityValues = dataset.offers.flatMap((item) => [item.provisional_identity.legal_name, item.provisional_identity.address]).filter(Boolean);
const aggregateText = JSON.stringify(evidenceBase);
assert('aggregate-evidence-does-not-propagate-real-identities', identityValues.every((value) => !aggregateText.includes(value)), { checked_values: identityValues.length });
assert('experimental-identifiers-unique', new Set(dataset.offers.map((item) => item.experimental_id)).size === dataset.offers.length && new Set(dataset.offers.map((item) => item.source_row_id)).size === dataset.offers.length, { offers: dataset.offers.length, experimental_ids: new Set(dataset.offers.map((item) => item.experimental_id)).size, source_row_ids: new Set(dataset.offers.map((item) => item.source_row_id)).size });
assert('owner-control-kept-separate', ownerVerifiedControl.safe_geography.numerator === 28 && ownerVerifiedControl.safe_geography.denominator === 28 && ownerVerifiedControl.reconciliation.includes('no es denominador'), ownerVerifiedControl);
assert('failed-surco-population-preserved', failedSurcoPopulation.coverage.numerator === 26 && failedSurcoPopulation.coverage.denominator === 30 && failedSurcoPopulation.coverage.percent === 86.667 && failedSurcoPopulation.frozen_abandonment_threshold_percent === 90, failedSurcoPopulation);
assert('prospective-decision-follows-frozen-threshold', prospectiveDecision === (metrics.coverage.offers.percent >= 90 ? 'GO CON LÍMITES' : 'NO-GO'), { coverage_percent: metrics.coverage.offers.percent, threshold_percent: 90, decision: prospectiveDecision });
assert('price-cutoff-acquisition-semantics-consistent', dataset.temporal_context.cutoff_at === dataset.temporal_context.acquisition_completed_at && dataset.temporal_context.acquisition_started_at !== dataset.temporal_context.acquisition_completed_at && dataset.offers.every((item) => item.price_reported_at !== dataset.temporal_context.cutoff_at && item.source.acquired_at === dataset.temporal_context.acquisition_completed_at && item.source.cutoff_at === dataset.temporal_context.cutoff_at), dataset.temporal_context);
const snapshotRegression = {
  exact_scope_source_rows: metrics.funnel.exact_scope_source_rows,
  latest_lima_province: metrics.funnel.latest_offers_price_territory_lima_province.offers,
  within_30_days: metrics.funnel.within_30_days.offers,
  registry_exact: metrics.funnel.exact_activity_registry.offers,
  gis_exact: metrics.funnel.exact_layer_35_gis.offers,
  contract_ready: metrics.funnel.contract_ready_with_provisional_identity.offers,
  registry_no_match: metrics.exceptions.registry_no_match_after_freshness,
  registry_ambiguous: metrics.exceptions.registry_ambiguous_after_freshness,
  gis_no_match: metrics.exceptions.gis_no_match_after_registry,
  latest_price_conflicts: metrics.exceptions.latest_price_conflicts,
  coverage_percent: metrics.coverage.offers.percent,
  contract_ready_districts: metrics.territory.contract_ready_districts,
  decision: prospectiveDecision,
};
const expectedSnapshotRegression = { exact_scope_source_rows: 386447, latest_lima_province: 821, within_30_days: 741, registry_exact: 722, gis_exact: 714, contract_ready: 714, registry_no_match: 19, registry_ambiguous: 0, gis_no_match: 8, latest_price_conflicts: 0, coverage_percent: 96.356, contract_ready_districts: 42, decision: 'GO CON LÍMITES' };
assert('sealed-snapshot-regression', snapshot !== '2026-08-14' || JSON.stringify(snapshotRegression) === JSON.stringify(expectedSnapshotRegression), snapshotRegression);

const evidence = { ...evidenceBase, assertions, assertion_summary: { passed: assertions.filter((item) => item.pass).length, failed: assertions.filter((item) => !item.pass).length } };
writeAtomic(evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ evidence: path.relative(root, evidenceOutput), local_dataset: path.relative(root, localOutput), metrics, assertions: evidence.assertion_summary })}\n`);
if (evidence.assertion_summary.failed) process.exitCode = 1;
