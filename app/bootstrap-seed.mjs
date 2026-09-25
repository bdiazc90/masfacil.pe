import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { GIS_FIELDS as GIS_HEADER, REGISTRY_FIELDS as REGISTRY_HEADER, csvLine } from '../pipeline/csv.mjs';

// La semilla de Registro y GIS que viaja como secret. La versión 1 solo traía
// la capa 35 de estaciones de servicio, así que sus filas GIS no decían capa;
// la 2 añade los gasocentros (Registro 15, capa 36) y cada fila GIS lleva la
// suya. Las dos se validan contra su manifest: el secret y el manifest del
// commit tienen que ser de la misma versión.
export const ROOT_FIELDS = Object.freeze(['schema_version', 'reference_snapshot_date', 'registry_fields', 'gis_fields', 'registry', 'gis']);
export const REGISTRY_FIELDS = Object.freeze(['source_activity', 'registro', 'department', 'province', 'district']);
export const GIS_FIELDS = Object.freeze(['n', 'department', 'province', 'district', 'longitude', 'latitude']);
export const GIS_FIELDS_V2 = Object.freeze(['layer', ...GIS_FIELDS]);
const LIMA = Object.freeze({ department: 'LIMA', province: 'LIMA' });

export function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
export function stableJson(value) { return JSON.stringify(value); }
export function gzipCanonical(value) { return gzipSync(Buffer.from(stableJson(value), 'utf8'), { level: 9 }); }

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }

/** Las capas GIS que admite un manifest: la 1 declaraba una sola. */
export const seedLayers = (manifest) => (manifest.schema_version === 2 ? manifest.filters.layers : [manifest.filters.layer]);
const gisFieldsOf = (version) => (version === 2 ? GIS_FIELDS_V2 : GIS_FIELDS);

export function validateSeed(payload, manifest) {
  const errors = [];
  const version = manifest.schema_version;
  const capas = seedLayers(manifest);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !same(Object.keys(payload), ROOT_FIELDS)) errors.push('campos raíz o su orden inválidos');
  if (![1, 2].includes(version) || payload?.schema_version !== version || payload?.reference_snapshot_date !== manifest.reference_snapshot_date) errors.push('versión o fecha de referencia inválida');
  if (!same(payload?.registry_fields, manifest.registry_fields) || !same(payload?.gis_fields, manifest.gis_fields) || !same(manifest.gis_fields, gisFieldsOf(version))) errors.push('listas de campos inválidas');
  const registryKeys = new Set();
  for (const row of payload?.registry ?? []) {
    if (!Array.isArray(row) || row.length !== REGISTRY_FIELDS.length || !row.every(text) || row[2] !== LIMA.department || row[3] !== LIMA.province || !manifest.filters.source_activity.includes(row[0])) { errors.push('fila Registro fuera de contrato'); continue; }
    const key = `${row[0]}\u001f${row[1]}`;
    if (registryKeys.has(key)) errors.push('clave Registro duplicada');
    registryKeys.add(key);
  }
  // En la 2 la capa abre la fila y forma parte de la clave: un mismo N puede
  // repetirse entre capas, nunca dentro de una.
  const gisKeys = new Set();
  for (const row of payload?.gis ?? []) {
    const [capa, ...resto] = version === 2 ? row : ['35', ...(Array.isArray(row) ? row : [])];
    if (!Array.isArray(row) || row.length !== gisFieldsOf(version).length || !capas.includes(capa) || !text(resto[0]) || !text(resto[1]) || !text(resto[2]) || !text(resto[3]) || resto[1] !== LIMA.department || resto[2] !== LIMA.province || !Number.isFinite(resto[4]) || !Number.isFinite(resto[5]) || resto[4] < -82 || resto[4] > -68 || resto[5] < -19 || resto[5] > 1) { errors.push('fila GIS fuera de contrato'); continue; }
    const key = version === 2 ? `${capa}\u001f${resto[0]}` : resto[0];
    if (gisKeys.has(key)) errors.push(version === 2 ? 'capa y N GIS duplicados' : 'N GIS duplicado');
    gisKeys.add(key);
  }
  if (!Array.isArray(payload?.registry) || payload.registry.length !== manifest.counts.registry_rows || registryKeys.size !== manifest.counts.registry_unique_keys) errors.push('conteo Registro inválido');
  const gisUnicos = version === 2 ? manifest.counts.gis_unique_keys : manifest.counts.gis_unique_n;
  if (!Array.isArray(payload?.gis) || payload.gis.length !== manifest.counts.gis_rows || gisKeys.size !== gisUnicos) errors.push('conteo GIS inválido');
  const bytes = Buffer.from(stableJson(payload), 'utf8');
  if (bytes.length !== manifest.sizes.json_bytes || sha256(bytes) !== manifest.hashes.json_sha256) errors.push('hash JSON no coincide');
  return errors;
}

export function decodeSeed(encoded, manifest) {
  if (typeof encoded !== 'string' || encoded.length !== manifest.sizes.base64_bytes || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0 || sha256(encoded) !== manifest.hashes.base64_sha256) throw new Error('Seed bootstrap ausente o base64 corrupto');
  const gzip = Buffer.from(encoded, 'base64');
  if (gzip.toString('base64') !== encoded || gzip.length !== manifest.sizes.gzip_bytes || sha256(gzip) !== manifest.hashes.gzip_sha256) throw new Error('Seed bootstrap gzip corrupto');
  let bytes;
  try { bytes = gunzipSync(gzip); } catch { throw new Error('Seed bootstrap no se puede descomprimir'); }
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Seed bootstrap JSON inválido'); }
  if (!bytes.equals(Buffer.from(stableJson(payload), 'utf8'))) throw new Error('Seed bootstrap no es JSON canónico');
  const errors = validateSeed(payload, manifest);
  if (errors.length) throw new Error(`Seed bootstrap rechazado: ${errors.join('; ')}`);
  return payload;
}

/** Las filas GIS de una semilla con su capa, sea cual sea su versión. */
export const seedGisWithLayer = (payload) => (payload.schema_version === 2 ? payload.gis : payload.gis.map((row) => ['35', ...row]));

/** Las tablas sanitizadas que el seed materializa usan el encabezado del módulo CSV. */
export function materializeSeedTables(payload) {
  return {
    registry: `${csvLine([...REGISTRY_HEADER])}${payload.registry.map(([activity, registration, department, province, district]) => csvLine([activity, registration, '', '', department, province, district, ''])).join('')}`,
    gis: `${csvLine([...GIS_HEADER])}${seedGisWithLayer(payload).map(([layer, ...row]) => csvLine([layer, '', row[0], '', '', ...row.slice(1)])).join('')}`,
  };
}

/**
 * La semilla v2 desde las tablas privadas completas, en su orden de archivo:
 * así restringirla a los filtros de la 1 devuelve la 1 byte a byte.
 *
 * @param {object} entrada
 * @param {object[]} entrada.registryRows  filas con SOURCE_ACTIVITY, REGISTRO, DEPARTAMENTO, PROVINCIA, DISTRITO
 * @param {object[]} entrada.gisRows       filas con LAYER, N, DEPARTAMENTO, PROVINCIA, DISTRITO, LONGITUDE, LATITUDE
 * @param {{source_activity: string[], layers: string[]}} entrada.filters
 * @param {string} entrada.referenceDate
 */
export function buildSeedPayload({ registryRows, gisRows, filters, referenceDate }) {
  const enLima = (row) => row.DEPARTAMENTO === LIMA.department && row.PROVINCIA === LIMA.province;
  return {
    schema_version: 2,
    reference_snapshot_date: referenceDate,
    registry_fields: [...REGISTRY_FIELDS],
    gis_fields: [...GIS_FIELDS_V2],
    registry: registryRows.filter((row) => filters.source_activity.includes(row.SOURCE_ACTIVITY) && enLima(row)).map((row) => [row.SOURCE_ACTIVITY, row.REGISTRO, row.DEPARTAMENTO, row.PROVINCIA, row.DISTRITO]),
    gis: gisRows.filter((row) => filters.layers.includes(row.LAYER) && enLima(row)).map((row) => [row.LAYER, row.N, row.DEPARTAMENTO, row.PROVINCIA, row.DISTRITO, Number(row.LONGITUDE), Number(row.LATITUDE)]),
  };
}

/** El manifest público de una semilla: conteos, tamaños y huellas, nada de filas. */
export function seedManifest(payload, { seedId, filters, privacy }) {
  const json = Buffer.from(stableJson(payload), 'utf8');
  const gzip = gzipCanonical(payload);
  const encoded = gzip.toString('base64');
  return {
    schema_version: payload.schema_version,
    seed_id: seedId,
    reference_snapshot_date: payload.reference_snapshot_date,
    registry_fields: payload.registry_fields,
    gis_fields: payload.gis_fields,
    filters: { source_activity: filters.source_activity, layers: filters.layers, department: LIMA.department, province: LIMA.province },
    counts: { registry_rows: payload.registry.length, registry_unique_keys: new Set(payload.registry.map((row) => `${row[0]}\u001f${row[1]}`)).size, gis_rows: payload.gis.length, gis_unique_keys: new Set(payload.gis.map((row) => `${row[0]}\u001f${row[1]}`)).size },
    sizes: { json_bytes: json.length, gzip_bytes: gzip.length, base64_bytes: encoded.length },
    hashes: { json_sha256: sha256(json), gzip_sha256: sha256(gzip), base64_sha256: sha256(encoded) },
    privacy,
  };
}

/**
 * Una semilla v2 recortada a los filtros de la 1, en el formato de la 1. Sirve
 * para exigir que ampliar la semilla no cambie ninguna fila existente.
 */
export function restrictSeed(payload, filters) {
  return {
    schema_version: 1,
    reference_snapshot_date: payload.reference_snapshot_date,
    registry_fields: [...REGISTRY_FIELDS],
    gis_fields: [...GIS_FIELDS],
    registry: payload.registry.filter((row) => filters.source_activity.includes(row[0])),
    gis: seedGisWithLayer(payload).filter(([layer]) => layer === filters.layer).map(([, ...row]) => row),
  };
}
