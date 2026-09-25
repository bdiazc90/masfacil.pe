// GLP como fuente propia: su CSV, su minimizado y su selección. Nada de eso
// puede mover un byte de lo que ya publican los líquidos.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { CANONICAL_SOURCE_URLS } from '../app/source-catalog.mjs';
import { GLP_MINIMIZED_FIELDS, MINIMIZED_FIELDS, RAW_FIELDS, csvLine } from '../pipeline/csv.mjs';
import { buildSourceProducts, selectProductCandidates } from '../pipeline/gasolina-products.mjs';
import { configuredGroup, groupByKey, productGroup } from '../pipeline/groups.mjs';
import { SOURCES, sourceById } from '../pipeline/sources.mjs';
import { PRODUCTS } from '../web/lib/catalog.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-glp-'));
const CABECERA_GLP = ['ID4', 'ACTIVIDAD', 'REGISTRO DE HIDROCARBUROS', 'RUC', 'RAZÓN SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCIÓN', 'FECHA DE REGISTRO', 'PRODUCTO', 'TIPO DE CLIENTE', 'MARCA', 'PRECIO DE VENTA (SOLES)', 'UNIDAD'];
const CABECERA_LIQUIDOS = ['ID3', 'ACTIVIDAD', 'REGISTRO DE HIDROCARBUROS', 'RUC', 'RAZÓN SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCIÓN', 'FECHA DE REGISTRO', 'PRODUCTO', 'PRECIO DE VENTA (SOLES)', 'UNIDAD'];
const ESTACION_GLP = 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP';
const ESTACION_GLP_GNV = 'EE.SS con GLP y GNV';
const GASOCENTRO = 'GASOCENTROS DE GLP';
const GASOCENTRO_GNV = 'GASOCENTRO DE GLP CON ESTABLECIMIENTO DE VENTA AL PUBLICO DE GNV';
const AHORA = '2026-09-24T12:00:00.000Z';

/** Una fila del original de GLP, con todo lo que el minimizado tiene que quitar. */
const crudaGlp = ({ id, actividad, registro, distrito = 'MIRAFLORES', producto = 'GLP - G', cliente = 'Usuario Final', precio = '7.49', unidad = 'Galones', fecha = '2026-09-23 10:00:00', marca = '' }) => [id, actividad, registro, `RUC-${id}`, `RAZON ${id}`, 'LIMA', 'LIMA', distrito, `AV. ${id} 123`, fecha, producto, cliente, marca, precio, unidad];
/** La misma fila ya minimizada, como la leen los constructores. */
const minimizada = (cruda) => Object.fromEntries(GLP_MINIMIZED_FIELDS.map((campo) => [campo, cruda[['ID4', 'ACTIVIDAD', 'REGISTRO_DE_HIDROCARBUROS', 'RUC', 'RAZON_SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCION', 'FECHA_DE_REGISTRO', 'PRODUCTO', 'TIPO_DE_CLIENTE', 'MARCA', 'PRECIO_DE_VENTA_SOLES', 'UNIDAD'].indexOf(campo)]]));
const registro = (codigo, numero, distrito = 'MIRAFLORES') => ({ SOURCE_ACTIVITY: codigo, REGISTRO: numero, CODIGO_OSINERGMIN: '', CODIGO: '', DEPARTAMENTO: 'LIMA', PROVINCIA: 'LIMA', DISTRITO: distrito, ACTIVIDAD: '' });
const punto = (capa, numero, distrito = 'MIRAFLORES', dLat = 0) => ({ LAYER: capa, OBJECTID: '', N: numero, COD_OSINERGMIN: '', CODIGO_DGH: '', DEPARTAMENTO: 'LIMA', PROVINCIA: 'LIMA', DISTRITO: distrito, LONGITUDE: '-77.03', LATITUDE: String(-12.12 + dLat) });
const escribir = (archivo, cabecera, filas) => fs.writeFileSync(archivo, [cabecera, ...filas].map(csvLine).join(''));

test('la fuente de líquidos es la de siempre y GLP es otra', () => {
  const liquidos = sourceById('liquid-current');
  assert.deepEqual([liquidos.url, liquidos.idField, liquidos.rawRelative, liquidos.minimizedRelative, liquidos.downloadTimeoutMs], [CANONICAL_SOURCE_URLS.liquid_current, 'ID3', 'acquired/price-liquid/CL-Registro-precios-DMA-V-CCA-CCE.csv', 'prices/liquid-current.csv.gz', 60 * 60 * 1000]);
  assert.deepEqual([...liquidos.rawFields], [...RAW_FIELDS]);
  assert.deepEqual([...liquidos.minimizedFields], [...MINIMIZED_FIELDS]);
  assert.deepEqual(Object.keys(SOURCES), ['liquid-current', 'glp-current']);
  const glp = sourceById('glp-current');
  assert.deepEqual([glp.url, glp.idField], [CANONICAL_SOURCE_URLS.glp_current, 'ID4']);
  assert.throws(() => sourceById('gnv-current'), /Fuente desconocida/);
});

test('el minimizado de GLP no guarda RUC, razón social, dirección ni marca', () => {
  const dir = temporal();
  const raw = path.join(dir, 'glp.csv');
  // Relleno a propósito: un `;` dentro de un campo entrecomillado no puede correr columnas.
  escribir(raw, CABECERA_GLP, [
    crudaGlp({ id: '1', actividad: ESTACION_GLP, registro: 'R-A' }),
    crudaGlp({ id: '2', actividad: 'PLANTAS ENVASADORAS GLP', registro: 'R-H', producto: 'Cilindros de 10 Kg de GLP', unidad: 'Kilogramos', marca: 'MARCA-SECRETA; "X"' }),
  ]);
  const salida = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'minimize.mjs')], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, RAW_INPUT: raw, MINIMIZED_OUTPUT: path.join(dir, 'minimized'), SOURCE_ID: 'glp-current' } });
  assert.equal(salida.status, 0, salida.stderr);
  const informe = JSON.parse(salida.stdout);
  assert.deepEqual([informe.source_id, informe.minimized_rows, informe.minimized_path.endsWith('prices/glp-current.csv.gz')], ['glp-current', 2, true]);
  const texto = gunzipSync(fs.readFileSync(path.join(dir, 'minimized', 'prices', 'glp-current.csv.gz'))).toString('utf8');
  assert.equal(texto.split('\n')[0], GLP_MINIMIZED_FIELDS.join(';'));
  for (const privado of ['RUC-', 'RAZON ', 'AV. ', 'MARCA-SECRETA']) assert.equal(texto.includes(privado), false, `${privado} no puede llegar al minimizado`);
  assert.match(texto, /Usuario Final/);
});

test('GLP es GLP - G en galones para «Usuario Final»; lo demás se descarta y se cuenta', () => {
  const precios = [
    crudaGlp({ id: '1', actividad: ESTACION_GLP, registro: 'R-A' }),
    crudaGlp({ id: '2', actividad: ESTACION_GLP, registro: 'R-F', unidad: 'Kilogramos' }),
    crudaGlp({ id: '3', actividad: ESTACION_GLP_GNV, registro: 'R-G', cliente: 'Agentes con RHO' }),
    // Una planta envasadora no es un gasocentro: ni siquiera entra al conteo.
    crudaGlp({ id: '4', actividad: 'PLANTAS ENVASADORAS GLP', registro: 'R-H', cliente: 'Agentes con RHO' }),
    // Un cilindro es otro producto.
    crudaGlp({ id: '5', actividad: ESTACION_GLP, registro: 'R-I', producto: 'Cilindros de 10 Kg de GLP', unidad: 'Kilogramos' }),
  ].map(minimizada);
  const grupo = configuredGroup('glp');
  const candidatos = selectProductCandidates({ sources: { prices: precios, registry: [], gis: [] }, product: grupo.config.productDefinitions.glp, activities: grupo.config.activities, scope: grupo.scope, cutoffAt: AHORA, gisLayers: grupo.config.gisLayers, clientType: grupo.config.clientType, idField: 'ID4' });
  assert.deepEqual(candidatos.rowExclusions, { otra_unidad: 1, otro_tipo_de_cliente: 1 });
  assert.deepEqual(candidatos.latestLima.map((item) => item.selected.REGISTRO_DE_HIDROCARBUROS), ['R-A']);
});

test('los gasocentros cruzan con la capa 36 y las estaciones con la 35; dos etiquetas del 15 son una oferta', async () => {
  const dir = temporal();
  const crudas = [
    crudaGlp({ id: '1', actividad: ESTACION_GLP, registro: 'R-A', precio: '7.29' }),
    crudaGlp({ id: '2', actividad: ESTACION_GLP_GNV, registro: 'R-B', precio: '7.39' }),
    // El mismo gasocentro con sus dos etiquetas: vale el último reporte.
    crudaGlp({ id: '3', actividad: GASOCENTRO, registro: 'R-C', precio: '7.49', fecha: '2026-09-23 11:00:00' }),
    crudaGlp({ id: '4', actividad: GASOCENTRO_GNV, registro: 'R-C', precio: '7.10', fecha: '2026-09-20 11:00:00' }),
    // Un gasocentro cuyo punto solo está en la capa de estaciones no se ubica.
    crudaGlp({ id: '5', actividad: GASOCENTRO, registro: 'R-E' }),
  ];
  escribir(path.join(dir, 'glp.csv'), CABECERA_GLP, crudas);
  const tablas = {
    prices: crudas.map(minimizada),
    registry: [registro('02', 'R-A'), registro('06', 'R-B'), registro('15', 'R-C'), registro('15', 'R-E')],
    gis: [punto('35', 'R-A'), punto('35', 'R-B', 'MIRAFLORES', 0.01), punto('36', 'R-C', 'MIRAFLORES', 0.02), punto('35', 'R-E', 'MIRAFLORES', 0.03), punto('35', 'R-C', 'SURQUILLO', 0.04)],
  };
  const { resultsByGroup } = await buildSourceProducts({ source: sourceById('glp-current'), sources: tablas, rawPath: path.join(dir, 'glp.csv'), cutoffAt: AHORA, snapshotId: '2026-09-24-prueba', sourceMaxReportedAt: '2026-09-23T16:00:00.000Z', sourceUrl: 'https://example.test/glp.csv', groups: [productGroup(configuredGroup('glp'))] });
  const glp = resultsByGroup.glp.glp;
  assert.deepEqual(glp.offers.map((oferta) => oferta.price).sort(), [7.29, 7.39, 7.49]);
  assert.ok(glp.offers.every((oferta) => oferta.id.startsWith('glp1_')));
  assert.deepEqual(glp.funnel.reasons, { publicada: 3, sin_gis_unico: 1 });
  // El punto de R-C en la capa 35 (otro distrito) no cuenta: el gasocentro vive en la 36.
  assert.equal(glp.offers.find((oferta) => oferta.price === 7.49).district, 'MIRAFLORES');
  assert.deepEqual(glp.rowExclusions, {});
});

test('Gasolina sale idéntica con la semilla v2: su Registro se limita a sus códigos', async () => {
  const dir = temporal();
  const fila = (id, registroNumero, producto, precio) => [id, 'ESTACIÓN DE SERVICIOS / GRIFOS', registroNumero, `RUC-${id}`, `RAZON ${id}`, 'LIMA', 'LIMA', 'MIRAFLORES', `AV. ${id} 1`, '2026-09-23 10:00:00', producto, precio, 'Galones'];
  const crudas = [fila('1', 'R-1', PRODUCTS.regular.canonical, '15.49'), fila('2', 'R-1', PRODUCTS.premium.canonical, '17.49'), fila('3', 'R-2', PRODUCTS.regular.canonical, '15.29')];
  escribir(path.join(dir, 'liquidos.csv'), CABECERA_LIQUIDOS, crudas);
  const precios = crudas.map((c) => Object.fromEntries(MINIMIZED_FIELDS.map((campo) => [campo, c[RAW_FIELDS.indexOf(campo)]])));
  const v1 = { prices: precios, registry: [registro('01', 'R-1'), registro('01', 'R-2'), registro('01', 'R-SIN-PRECIO')], gis: [punto('35', 'R-1'), punto('35', 'R-2', 'MIRAFLORES', 0.01)] };
  // La v2 suma gasocentros, incluso con un N igual al de una estación en la capa 36.
  const v2 = { prices: precios, registry: [...v1.registry, registro('15', 'R-C'), registro('15', 'R-1')], gis: [...v1.gis, punto('36', 'R-C'), punto('36', 'R-1', 'SURQUILLO')] };
  const construir = (tablas) => buildSourceProducts({ source: sourceById('liquid-current'), sources: tablas, rawPath: path.join(dir, 'liquidos.csv'), cutoffAt: AHORA, snapshotId: '2026-09-24-prueba', sourceMaxReportedAt: '2026-09-23T15:00:00.000Z', sourceUrl: 'https://example.test/liquidos.csv', groups: [productGroup(groupByKey('gasolina'))] });
  const plano = ({ resultsByGroup }) => Object.fromEntries(Object.entries(resultsByGroup.gasolina).map(([clave, r]) => [clave, { offers: r.offers, metrics: r.metrics, funnel: r.funnel, anchors: [...r.registryAnchors], exclusions: [...r.exclusions], links: [...r.linkKeys] }]));
  const [antes, despues] = [plano(await construir(v1)), plano(await construir(v2))];
  assert.equal(antes.regular.offers.length, 2);
  assert.deepEqual(despues, antes);
});
