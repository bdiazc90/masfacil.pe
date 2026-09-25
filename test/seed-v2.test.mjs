// La semilla v2: la de siempre más los gasocentros (Registro 15, capa GIS 36).
// Amplía, no refresca: recortada a los filtros de la 1 es la 1 byte a byte, así
// que Gasolina y Diésel no pueden cambiar por instalarla. Y la 1 sigue
// decodificando: el secret y el manifest del commit viajan juntos.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { GIS_FIELDS, REGISTRY_FIELDS, buildSeedPayload, decodeSeed, gzipCanonical, materializeSeedTables, restrictSeed, seedManifest, sha256, stableJson, validateSeed } from '../app/bootstrap-seed.mjs';

const FECHA = '2026-08-14';
const FILTROS_V1 = { source_activity: ['01', '02', '05', '06'], layer: '35' };
const FILTROS_V2 = { source_activity: ['01', '02', '05', '06', '15'], layers: ['35', '36'] };
const PRIVACIDAD = { contains: 'solo códigos, distrito y coordenadas' };

const registro = (codigo, numero, distrito = 'MIRAFLORES', provincia = 'LIMA') => ({ SOURCE_ACTIVITY: codigo, REGISTRO: numero, CODIGO_OSINERGMIN: '', CODIGO: '', DEPARTAMENTO: 'LIMA', PROVINCIA: provincia, DISTRITO: distrito, ACTIVIDAD: '' });
const punto = (capa, numero, distrito = 'MIRAFLORES', provincia = 'LIMA') => ({ LAYER: capa, OBJECTID: '', N: numero, COD_OSINERGMIN: '', CODIGO_DGH: '', DEPARTAMENTO: 'LIMA', PROVINCIA: provincia, DISTRITO: distrito, LONGITUDE: '-77.03', LATITUDE: '-12.12' });
// Mezcladas a propósito: la semilla conserva el orden del archivo.
const REGISTROS = [registro('01', 'R-1'), registro('15', 'R-G1'), registro('02', 'R-2'), registro('03', 'R-OTRO'), registro('06', 'R-6'), registro('01', 'R-HUARAL', 'HUARAL', 'HUARAL'), registro('15', 'R-G2', 'SURQUILLO')];
// Un mismo N en las dos capas es válido: el N solo vale dentro de su capa.
const PUNTOS = [punto('35', 'R-1'), punto('36', 'R-G1'), punto('35', 'R-2'), punto('37', 'R-X'), punto('36', 'R-1', 'SURQUILLO'), punto('35', 'R-6'), punto('35', 'R-HUARAL', 'HUARAL', 'HUARAL')];

/** La v1 como la armaba el generador borrado: sin capa en las filas GIS. */
function semillaV1(registros, puntos) {
  const lima = (fila) => fila.DEPARTAMENTO === 'LIMA' && fila.PROVINCIA === 'LIMA';
  const payload = {
    schema_version: 1,
    reference_snapshot_date: FECHA,
    registry_fields: [...REGISTRY_FIELDS],
    gis_fields: [...GIS_FIELDS],
    registry: registros.filter((fila) => lima(fila) && FILTROS_V1.source_activity.includes(fila.SOURCE_ACTIVITY)).map((fila) => [fila.SOURCE_ACTIVITY, fila.REGISTRO, fila.DEPARTAMENTO, fila.PROVINCIA, fila.DISTRITO]),
    gis: puntos.filter((fila) => lima(fila) && fila.LAYER === FILTROS_V1.layer).map((fila) => [fila.N, fila.DEPARTAMENTO, fila.PROVINCIA, fila.DISTRITO, Number(fila.LONGITUDE), Number(fila.LATITUDE)]),
  };
  const json = Buffer.from(stableJson(payload), 'utf8');
  const gzip = gzipCanonical(payload);
  const encoded = gzip.toString('base64');
  const manifest = {
    schema_version: 1, seed_id: 'prueba-v1', reference_snapshot_date: FECHA, registry_fields: payload.registry_fields, gis_fields: payload.gis_fields,
    filters: { ...FILTROS_V1, department: 'LIMA', province: 'LIMA' },
    counts: { registry_rows: payload.registry.length, registry_unique_keys: payload.registry.length, gis_rows: payload.gis.length, gis_unique_n: payload.gis.length },
    sizes: { json_bytes: json.length, gzip_bytes: gzip.length, base64_bytes: encoded.length },
    hashes: { json_sha256: sha256(json), gzip_sha256: sha256(gzip), base64_sha256: sha256(encoded) },
    privacy: PRIVACIDAD,
  };
  return { payload, manifest, encoded };
}

function semillaV2(registros = REGISTROS, puntos = PUNTOS) {
  const payload = buildSeedPayload({ registryRows: registros, gisRows: puntos, filters: FILTROS_V2, referenceDate: FECHA });
  return { payload, manifest: seedManifest(payload, { seedId: 'prueba-v2', filters: FILTROS_V2, privacy: PRIVACIDAD }), encoded: gzipCanonical(payload).toString('base64') };
}

test('la v2 se decodifica con su manifest y trae gasocentros con su capa', () => {
  const { payload, manifest, encoded } = semillaV2();
  assert.deepEqual(decodeSeed(encoded, manifest), payload);
  assert.deepEqual(payload.registry.map((fila) => `${fila[0]}:${fila[1]}`), ['01:R-1', '15:R-G1', '02:R-2', '06:R-6', '15:R-G2']);
  assert.deepEqual(payload.gis.map((fila) => `${fila[0]}:${fila[1]}`), ['35:R-1', '36:R-G1', '35:R-2', '36:R-1', '35:R-6']);
  assert.deepEqual([manifest.schema_version, manifest.filters.layers, manifest.counts.gis_unique_keys], [2, ['35', '36'], 5]);
});

test('la v1 sigue decodificando y la v2 recortada a sus filtros es ella, byte a byte', () => {
  const v1 = semillaV1(REGISTROS, PUNTOS);
  assert.deepEqual(decodeSeed(v1.encoded, v1.manifest), v1.payload);
  assert.equal(stableJson(restrictSeed(semillaV2().payload, FILTROS_V1)), stableJson(v1.payload));
  // Un cambio en una fila que ya existía rompe la igualdad: el generador lo rechaza.
  const cambiada = semillaV2([registro('01', 'R-1', 'SAN ISIDRO'), ...REGISTROS.slice(1)]).payload;
  assert.notEqual(stableJson(restrictSeed(cambiada, FILTROS_V1)), stableJson(v1.payload));
});

test('la v2 rechaza capas fuera del filtro y un (capa, N) repetido', () => {
  const { payload, manifest } = semillaV2();
  const conCapaMala = structuredClone(payload);
  conCapaMala.gis[0][0] = '37';
  assert.ok(validateSeed(conCapaMala, manifest).includes('fila GIS fuera de contrato'));
  const repetida = structuredClone(payload);
  repetida.gis.push([...repetida.gis[0]]);
  assert.ok(validateSeed(repetida, manifest).includes('capa y N GIS duplicados'));
  // Una fila de la v1 dentro de un manifest v2 tampoco pasa.
  const sinCapa = structuredClone(payload);
  sinCapa.gis[0] = sinCapa.gis[0].slice(1);
  assert.ok(validateSeed(sinCapa, manifest).includes('fila GIS fuera de contrato'));
  assert.deepEqual(validateSeed(payload, manifest), []);
});

test('las tablas materializadas llevan la capa de cada fila', () => {
  const capas = (tablas) => tablas.gis.trim().split('\n').slice(1).map((linea) => linea.split(';')[0]);
  assert.deepEqual(capas(materializeSeedTables(semillaV2().payload)), ['35', '36', '35', '36', '35']);
  assert.deepEqual(capas(materializeSeedTables(semillaV1(REGISTROS, PUNTOS).payload)), ['35', '35', '35']);
});
