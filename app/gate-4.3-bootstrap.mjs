import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const ROOT_FIELDS = Object.freeze(['schema_version', 'reference_snapshot_date', 'registry_fields', 'gis_fields', 'registry', 'gis']);
export const REGISTRY_FIELDS = Object.freeze(['source_activity', 'registro', 'department', 'province', 'district']);
export const GIS_FIELDS = Object.freeze(['n', 'department', 'province', 'district', 'longitude', 'latitude']);

export function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
export function stableJson(value) { return JSON.stringify(value); }
export function gzipCanonical(value) { return gzipSync(Buffer.from(stableJson(value), 'utf8'), { level: 9 }); }

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }

export function validateSeed(payload, manifest) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !same(Object.keys(payload), ROOT_FIELDS)) errors.push('campos raíz o su orden inválidos');
  if (payload?.schema_version !== 1 || payload?.reference_snapshot_date !== manifest.reference_snapshot_date) errors.push('versión o fecha de referencia inválida');
  if (!same(payload?.registry_fields, manifest.registry_fields) || !same(payload?.gis_fields, manifest.gis_fields)) errors.push('listas de campos inválidas');
  const registryKeys = new Set();
  for (const row of payload?.registry ?? []) {
    if (!Array.isArray(row) || row.length !== REGISTRY_FIELDS.length || !row.every(text) || row[2] !== 'LIMA' || row[3] !== 'LIMA' || !manifest.filters.source_activity.includes(row[0])) { errors.push('fila Registro fuera de contrato'); continue; }
    const key = `${row[0]}\u001f${row[1]}`;
    if (registryKeys.has(key)) errors.push('clave Registro duplicada');
    registryKeys.add(key);
  }
  const gisKeys = new Set();
  for (const row of payload?.gis ?? []) {
    if (!Array.isArray(row) || row.length !== GIS_FIELDS.length || !text(row[0]) || !text(row[1]) || !text(row[2]) || !text(row[3]) || row[1] !== 'LIMA' || row[2] !== 'LIMA' || !Number.isFinite(row[4]) || !Number.isFinite(row[5]) || row[4] < -82 || row[4] > -68 || row[5] < -19 || row[5] > 1) { errors.push('fila GIS fuera de contrato'); continue; }
    if (gisKeys.has(row[0])) errors.push('N GIS duplicado');
    gisKeys.add(row[0]);
  }
  if (!Array.isArray(payload?.registry) || payload.registry.length !== manifest.counts.registry_rows || registryKeys.size !== manifest.counts.registry_unique_keys) errors.push('conteo Registro inválido');
  if (!Array.isArray(payload?.gis) || payload.gis.length !== manifest.counts.gis_rows || gisKeys.size !== manifest.counts.gis_unique_n) errors.push('conteo GIS inválido');
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

function csvLine(values) {
  return `${values.map((value) => {
    const textValue = String(value);
    return /[;"\n\r]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
  }).join(';')}\n`;
}

export function materializeSeedTables(payload) {
  const registryHeader = ['SOURCE_ACTIVITY', 'REGISTRO', 'CODIGO_OSINERGMIN', 'CODIGO', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'ACTIVIDAD'];
  const gisHeader = ['LAYER', 'OBJECTID', 'N', 'COD_OSINERGMIN', 'CODIGO_DGH', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'LONGITUDE', 'LATITUDE'];
  return {
    registry: `${csvLine(registryHeader)}${payload.registry.map(([activity, registration, department, province, district]) => csvLine([activity, registration, '', '', department, province, district, ''])).join('')}`,
    gis: `${csvLine(gisHeader)}${payload.gis.map((row) => csvLine(['35', '', row[0], '', '', ...row.slice(1)])).join('')}`,
  };
}
