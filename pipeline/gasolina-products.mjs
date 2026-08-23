import crypto from 'node:crypto';
import fs from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { officialAnchorFromRegistration } from '../app/official-anchor.mjs';

export const GASOLINA_PRODUCTS = Object.freeze({
  regular: Object.freeze({ canonical: 'GASOHOL REGULAR', label: 'Gasohol Regular' }),
  premium: Object.freeze({ canonical: 'GASOHOL PREMIUM', label: 'Gasohol Premium' }),
});
const activities = Object.freeze({ 'ESTACIÓN DE SERVICIOS / GRIFOS': '01', 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP': '02', 'EE.SS con GNV': '05', 'EE.SS con GLP y GNV': '06' });
const sep = '\u001f';

const clean = (value) => String(value ?? '').replace(/\r/g, '').trim();

// La dirección del Registro viene en mayúsculas y mezcla la vía con la
// descripción del predio: manzana, lote, urbanización, referencias. Para la
// tarjeta se conserva solo el tramo que ubica —vía y número— con mayúsculas de
// nombre propio. El original nunca sale de la caché privada.
const MINUSCULAS = new Set(['de', 'del', 'y', 'con', 'en', 'a']);
const PREFIJO_RUIDO = /^\s*(?:ESQUINA|ESQ\.?|FRENTE\s+A|ALTURA\s+DE|INTERSECCION\s+DE)\s*(?:DE\s+)?(?:LA\s+|EL\s+|LOS\s+|LAS\s+)?/i;
const CORTE_DESCRIPCION = /\s*(?:,|\(|\bESQ\b|\bESQUINA\b|\bURB\b|\bURBANIZACI[OÓ]N\b|\bASOC\b|\bAA\.?HH\b|\bSUB\s*LOTE\b|\bDENOMINADO\b|\bANTES\b|\bSECTOR\b|\bETAPA\b|\bCON\s+FRENTE\b|\bFRENTE\s+A\b|\bCOMITE\b|\bAGRUPAMIENTO\b|\bPARCELA\b|\bCENTRO\s+POBLADO\b)/i;
const ABREVIATURAS = /^(av|jr|mz|mza|lt|km|ca)\.?$/;

export function direccionParaPantalla(bruta) {
  let texto = String(bruta ?? '').replace(/\s+/g, ' ').trim().replace(PREFIJO_RUIDO, '');
  if (!texto) return null;
  const cortado = texto.split(CORTE_DESCRIPCION)[0].trim();
  texto = cortado.length >= 6 ? cortado : texto;
  texto = texto.replace(/\bN[°º¿]\s*/gi, '').replace(/\bNRO\.?\s*/gi, '');
  texto = texto.replace(/(\d+)\s*[-–]\s*[\dA-Z]+(?:\s*[-–]\s*[\dA-Z]+)*/gi, '$1'); // 3810-A y 1294-1298-1302
  // Si ya hay vía con número, la manzana y el lote sobran para ubicarse.
  if (/\d/.test(texto.split(/\bMZ|\bLOTE|\bLT\b/i)[0])) texto = texto.split(/\s*\bMZ\b|\s*\bMZA\b|\s*\bLOTE\b|\s*\bLT\b/i)[0];
  texto = texto.replace(/\bKM\.?\s*/i, 'Km. ').replace(/[-–.,;\s]+$/, '').trim();
  if (!texto) return null;
  const palabras = texto.toLocaleLowerCase('es-PE').split(' ').filter(Boolean).map((palabra, indice, todas) => {
    const previa = indice > 0 ? todas[indice - 1] : null;
    if (indice > 0 && MINUSCULAS.has(palabra)) return palabra;
    // El artículo va en minúscula solo cuando sigue a "de" o "del".
    if (previa && /^del?$/.test(previa) && ['la', 'las', 'los', 'el'].includes(palabra)) return palabra;
    if (/^a{2}\.?h{2}\.?$/.test(palabra)) return 'AA.HH.';
    if (ABREVIATURAS.test(palabra)) return `${palabra[0].toLocaleUpperCase('es-PE')}${palabra.slice(1).replace('.', '')}.`;
    return `${palabra[0].toLocaleUpperCase('es-PE')}${palabra.slice(1)}`;
  });
  let salida = palabras.join(' ').replace(/[-–.,;\s]+$/, '');
  if (salida.length > 46) salida = `${salida.slice(0, 45).replace(/[\s,]+\S*$/, '')}…`;
  return salida || null;
}
function timestamp(value) {
  const match = clean(value).match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/);
  return match ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}-05:00`) : null;
}
export async function* csvRows(file) {
  let source = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  if (file.endsWith('.gz')) source = source.pipe(createGunzip());
  source = source.pipe(new Transform({ transform(chunk, encoding, callback) { callback(null, chunk); } })).setEncoding('utf8');
  let row = []; let value = ''; let quoted = false; let quoteAtEnd = false; let first = true;
  for await (const chunk of source) for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk[index]; if (first) { first = false; if (char === '\uFEFF') continue; }
    if (quoteAtEnd) { quoteAtEnd = false; if (char === '"') { value += '"'; continue; } quoted = false; }
    if (quoted) { if (char === '"') { if (index === chunk.length - 1) quoteAtEnd = true; else if (chunk[index + 1] === '"') { value += '"'; index += 1; } else quoted = false; } else value += char; }
    else if (char === '"') quoted = true;
    else if (char === ';') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); yield row; row = []; value = ''; }
    else value += char;
  }
  if (quoted || quoteAtEnd) throw new Error(`CSV incompleto: ${file}`);
  if (value || row.length) { row.push(value.replace(/\r$/, '')); yield row; }
}
async function table(file, expected) {
  let header; const rows = [];
  for await (const row of csvRows(file)) { if (!header) { header = row.map(clean); if (JSON.stringify(header) !== JSON.stringify(expected)) throw new Error(`Schema inesperado: ${file}`); } else { if (row.length !== header.length) throw new Error(`Fila inválida: ${file}`); rows.push(Object.fromEntries(header.map((key, index) => [key, clean(row[index])]))); } }
  return rows;
}
const priceFields = ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','DEPARTAMENTO','PROVINCIA','DISTRITO','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'];
const registryFields = ['SOURCE_ACTIVITY','REGISTRO','CODIGO_OSINERGMIN','CODIGO','DEPARTAMENTO','PROVINCIA','DISTRITO','ACTIVIDAD'];
const gisFields = ['LAYER','OBJECTID','N','COD_OSINERGMIN','CODIGO_DGH','DEPARTAMENTO','PROVINCIA','DISTRITO','LONGITUDE','LATITUDE'];
const rawFields = ['ID3','ACTIVIDAD','REGISTRO_DE_HIDROCARBUROS','RUC','RAZON_SOCIAL','DEPARTAMENTO','PROVINCIA','DISTRITO','DIRECCION','FECHA_DE_REGISTRO','PRODUCTO','PRECIO_DE_VENTA_SOLES','UNIDAD'];
const lima = (row) => row.DEPARTAMENTO === 'LIMA' && row.PROVINCIA === 'LIMA';
const rawHeaderName = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll(' ', '_').replace(/[^A-Z0-9_]/g, '').replace('PRECIO_DE_VENTA_SOLES', 'PRECIO_DE_VENTA_SOLES').replace('PRECIO_DE_VENTA_SOLES', 'PRECIO_DE_VENTA_SOLES');

function seedRows(seed, name, fields, mapRow) {
  if (!seed || !Array.isArray(seed[name])) return null;
  const declared = seed[`${name}_fields`];
  const expected = name === 'registry'
    ? ['source_activity', 'registro', 'department', 'province', 'district']
    : ['n', 'department', 'province', 'district', 'longitude', 'latitude'];
  if (JSON.stringify(declared) !== JSON.stringify(expected)) throw new Error(`Seed ${name} fuera de contrato`);
  return seed[name].map((row) => {
    if (!Array.isArray(row) || row.length !== expected.length) throw new Error(`Fila seed ${name} inválida`);
    return Object.fromEntries(fields.map((field, index) => [field, mapRow(row, index)]));
  });
}

export async function buildGasolinaProduct({ productKey, minimizedRoot, rawPath, cutoffAt, snapshotId, sourceMaxReportedAt, sourceUrl, bootstrapSeed = null }) {
  const product = GASOLINA_PRODUCTS[productKey]; if (!product) throw new Error(`Producto gasolina no permitido: ${productKey}`);
  const prices = await table(`${minimizedRoot}/prices/liquid-current.csv.gz`, priceFields);
  const registry = seedRows(bootstrapSeed, 'registry', registryFields, (row, index) => {
    const values = [row[0], row[1], '', '', row[2], row[3], row[4], ''];
    return values[index];
  }) ?? await table(`${minimizedRoot}/registry/authorizations.csv.gz`, registryFields);
  const gis = seedRows(bootstrapSeed, 'gis', gisFields, (row, index) => {
    const values = ['35', '', row[0], '', '', row[1], row[2], row[3], row[4], row[5]];
    return values[index];
  }) ?? await table(`${minimizedRoot}/gis/features.csv.gz`, gisFields);
  const byRegistry = new Map(); for (const row of registry) { const key = `${row.SOURCE_ACTIVITY}${sep}${row.REGISTRO}`; byRegistry.set(key, [...(byRegistry.get(key) ?? []), row]); }
  const byGis = new Map(); for (const row of gis.filter((item) => item.LAYER === '35')) byGis.set(row.N, [...(byGis.get(row.N) ?? []), row]);
  const grouped = new Map(); let sourceRows = 0;
  for (const row of prices) {
    if (!Object.hasOwn(activities, row.ACTIVIDAD) || row.PRODUCTO !== product.canonical || row.UNIDAD !== 'Galones') continue;
    sourceRows += 1; const time = timestamp(row.FECHA_DE_REGISTRO); const key = [row.REGISTRO_DE_HIDROCARBUROS, row.ACTIVIDAD, row.PRODUCTO, row.UNIDAD].join(sep); const current = grouped.get(key) ?? { rows: [], max: null };
    const numericPrice = Number(row.PRECIO_DE_VENTA_SOLES.replace(',', '.')); const candidate = { ...row, time, numericPrice };
    if (time && (!current.max || time > current.max)) { current.max = time; current.rows = [candidate]; } else if (time && current.max && time.getTime() === current.max.getTime()) current.rows.push(candidate);
    grouped.set(key, current);
  }
  const latest = [...grouped.values()].map((group) => {
    const selected = [...group.rows].sort((a, b) => a.ID3.localeCompare(b.ID3))[0] ?? null;
    const pricesAtLatest = new Set(group.rows.map((row) => row.numericPrice)); const territories = new Set(group.rows.map((row) => `${row.DEPARTAMENTO}|${row.PROVINCIA}|${row.DISTRITO}`));
    return { selected, priceConflict: pricesAtLatest.size !== 1, territoryConflict: territories.size !== 1 };
  }).filter((item) => item.selected);
  const latestLima = latest.filter((item) => lima(item.selected));
  const cutoff = new Date(cutoffAt); const fresh = latestLima.filter((item) => item.selected.time && item.selected.time <= cutoff && item.selected.time >= new Date(cutoff.getTime() - 30 * 86400000) && !item.priceConflict && !item.territoryConflict && item.selected.numericPrice > 0);
  const registered = fresh.map((item) => ({ ...item, matches: byRegistry.get(`${activities[item.selected.ACTIVIDAD]}${sep}${item.selected.REGISTRO_DE_HIDROCARBUROS}`) ?? [] })).filter((item) => item.matches.length === 1 && lima(item.matches[0]) && item.matches[0].DISTRITO === item.selected.DISTRITO);
  const geo = registered.map((item) => { const matches = byGis.get(item.selected.REGISTRO_DE_HIDROCARBUROS) ?? []; const coordinate = matches.length === 1 ? matches[0] : null; const longitude = Number(coordinate?.LONGITUDE); const latitude = Number(coordinate?.LATITUDE); return { ...item, coordinate, longitude, latitude }; }).filter((item) => item.coordinate && lima(item.coordinate) && item.coordinate.DISTRITO === item.selected.DISTRITO && Number.isFinite(item.longitude) && item.longitude >= -82 && item.longitude <= -68 && Number.isFinite(item.latitude) && item.latitude >= -19 && item.latitude <= 1);
  const targetIds = new Set(geo.map((item) => item.selected.ID3)); const identities = new Map(); let rawHeader;
  for await (const row of csvRows(rawPath)) {
    if (!rawHeader) {
      rawHeader = row.map(rawHeaderName);
      if (JSON.stringify(rawHeader) !== JSON.stringify(rawFields)) throw new Error('Schema raw inesperado');
      continue;
    }
    if (!targetIds.has(clean(row[0]))) continue; const item = Object.fromEntries(rawFields.map((key, index) => [key, clean(row[index])])); identities.set(item.ID3, item);
  }
  const ready = geo.filter((item) => { const identity = identities.get(item.selected.ID3); return identity?.RAZON_SOCIAL && identity?.DIRECCION; });
  const offers = ready.map((item) => ({
    id: `g2_${crypto.createHash('sha256').update(`masfacil-pe|gasolina-v2|${snapshotId}|${productKey}|${item.selected.REGISTRO_DE_HIDROCARBUROS}|${item.selected.ACTIVIDAD}`).digest('hex').slice(0, 24)}`,
    establishment_id: officialAnchorFromRegistration(item.selected.REGISTRO_DE_HIDROCARBUROS),
    address: direccionParaPantalla(identities.get(item.selected.ID3).DIRECCION),
    price: item.selected.numericPrice,
    reported_at: item.selected.time.toISOString(),
    district: item.selected.DISTRITO,
    longitude: item.longitude,
    latitude: item.latitude,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const metric = (items) => ({ offers: items.length, districts: new Set(items.map((item) => item.selected?.DISTRITO ?? item.district)).size });
  return { product, offers, metrics: { exact_scope_source_rows: sourceRows, latest_offers: metric(latest), latest_lima_lima: metric(latestLima), fresh_0_30_days: metric(fresh), registry_exact: metric(registered), gis_safe: metric(geo), contract_ready: metric(ready), coverage_percent: fresh.length ? Number((ready.length / fresh.length * 100).toFixed(3)) : 0, conflicts: { latest_price_conflicts: latestLima.filter((item) => item.priceConflict).length, latest_territory_conflicts: latestLima.filter((item) => item.territoryConflict).length, registry_excluded: fresh.length - registered.length, gis_excluded: registered.length - geo.length, identity_excluded: geo.length - ready.length } }, context: { snapshot_id: snapshotId, cutoff_at: cutoffAt, source_max_reported_at: sourceMaxReportedAt, source_url: sourceUrl } };
}
