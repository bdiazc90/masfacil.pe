#!/usr/bin/env node

// Sonda del encargo de histórico (SPEC-HISTORICO §10). Es DESECHABLE: se retira
// junto con `SPEC-HISTORICO.md` en el cierre aprobado. No es una suite ni un
// ritual para entregas futuras; comprueba exactamente lo que este cambio prometió.
//
//   node scripts/probe-historico.mjs
//   node scripts/probe-historico.mjs --test-name-pattern=/media/
//
// Nunca toca un bucket real ni sale a la red: el adaptador S3 se prueba contra
// un doble en memoria que imita a Neon (path-style, sin PUT condicional) y esas
// pruebas se saltan solas si `aws4fetch` no está instalado. Todo lo que escribe
// vive en un directorio temporal propio; el expediente privado, el bundle
// público y `.local-cache/` no se tocan. Las fixtures se generan en código, así
// que no hay ni un byte de dato de prueba versionado.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  HISTORY_MAX_BYTES, HISTORY_PRODUCTS, HISTORY_SCOPE, HISTORY_TIMEZONE,
  addDays, daysBetween, isRealDate, limaDate, validateDailySummary, windowDates,
} from '../web/lib/history-contract.js';
import { METHOD_VERSION, observationMeans, productMean } from '../pipeline/history/daily-mean.mjs';
import { createFsStore } from '../pipeline/history/store-fs.mjs';
import { DEFAULT_PREFIX, IMMUTABLE_CACHE_CONTROL, JSON_CONTENT_TYPE, S3_VARIABLES, SUMMARY_CACHE_CONTROL, createHistoryStore, listAll, putImmutable, putMutable, sha256 } from '../pipeline/history/store.mjs';
import { archiveBundle, archiveComplete, archiveHash, archiveKey } from '../pipeline/history/archive.mjs';
import { buildDailySummary, lastObservationOfDay, publishDailySummary, SUMMARY_KEY } from '../pipeline/history/summary.mjs';
import { buildObservation, observationId, observationKey, observeHistory } from '../pipeline/history/observer.mjs';
import { fetchLiveBundle, writeLiveBundle } from '../pipeline/live-bundle.mjs';
import { parseListResponse } from '../pipeline/history/list-xml.mjs';
import { DEFAULT_WINDOW, HISTORY_WINDOWS, STALE_HOURS, demoSummary, frameWindow, lastCounts, segments, sharedScale, staleHours } from '../web/lib/history-series.js';
import { GASOLINA_KEYS, GASOLINA_MANIFEST_VERSION, GASOLINA_SCOPE } from '../pipeline/gasolina-contract.mjs';
import { classifyPath } from '../app/route-policy.mjs';
import { deriveShell } from '../pipeline/shell-manifest.mjs';
import { HISTORY_ORIGIN, HISTORY_SUMMARY_PATH } from '../web/lib/history-contract.js';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'web', 'data', 'gasolina');
const scratch = fs.mkdtempSync(path.join(process.env.CLAUDE_SCRATCHPAD || os.tmpdir(), 'probe-historico-'));
const servidores = [];
const procesos = [];
after(() => {
  for (const servidor of servidores) servidor.close();
  for (const proceso of procesos) proceso.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const escenario = (nombre) => { const dir = path.join(scratch, nombre); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
const almacen = (nombre) => createFsStore({ root: escenario(nombre) });
const huellaDelBundle = fs.existsSync(path.join(dataRoot, 'manifest.json')) ? fs.readFileSync(path.join(dataRoot, 'manifest.json')) : null;
// La copia local del histórico puede existir —`npm run history:observe` la
// escribe a propósito—; lo que la sonda promete es no tocarla, no que no exista.
const historyLocal = path.join(root, '.local-cache', 'history');
const huellaLocal = (dir) => {
  if (!fs.existsSync(dir)) return null;
  const archivos = [];
  (function recorrer(actual) { for (const entrada of fs.readdirSync(actual, { withFileTypes: true })) { const ruta = path.join(actual, entrada.name); if (entrada.isDirectory()) recorrer(ruta); else archivos.push(`${path.relative(dir, ruta)} ${fs.statSync(ruta).size} ${fs.statSync(ruta).mtimeMs}`); } })(dir);
  return archivos.sort().join('\n');
};
const huellaHistoryLocal = huellaLocal(historyLocal);

// ── Fixtures generadas en código ──────────────────────────────────────────────

const CORTE = '2026-09-06T22:32:01.865Z';
const OBSERVADO = '2026-09-09T18:37:12.482Z';
const anchor = (semilla) => `est_${crypto.createHash('sha256').update(String(semilla)).digest('hex').slice(0, 24)}`;
const ofertaId = (semilla) => `g2_${crypto.createHash('sha256').update(`g2${semilla}`).digest('hex').slice(0, 24)}`;

/** Una oferta del contrato público 2.6.0, con los nueve campos exactos. */
function oferta({ semilla, price, reportedAt = '2026-09-05T10:00:00.000Z', establishment = null }) {
  return {
    id: ofertaId(semilla),
    establishment_id: establishment ?? anchor(semilla),
    commercial_identity: null,
    address: 'Av. Sonda 100',
    price,
    reported_at: reportedAt,
    district: 'MIRAFLORES',
    longitude: -77.03,
    latitude: -12.12,
  };
}

function dataset(key, offers, { revisionId = 'gasolina-2026-09-06-x-abcdefabcdef', cutoffAt = CORTE } = {}) {
  return {
    schema_version: GASOLINA_MANIFEST_VERSION,
    revision_id: revisionId,
    product: { key, canonical: key === 'regular' ? 'GASOHOL REGULAR' : 'GASOHOL PREMIUM', label: key === 'regular' ? 'Gasohol Regular' : 'Gasohol Premium', display_unit: 'Galones' },
    scope: GASOLINA_SCOPE,
    snapshot_date: '2026-09-06',
    cutoff_at: cutoffAt,
    source_max_reported_at: '2026-09-05T04:54:46.000Z',
    provenance: { source: 'Osinergmin', source_url: 'https://www.osinergmin.gob.pe/sonda.csv', attribution: 'Datos de precios y coordenadas: Osinergmin.' },
    offers,
  };
}

/** Manifest + cuerpos coherentes: los hashes se calculan de los bytes reales. */
function bundle({ regular, premium, revisionId = 'gasolina-2026-09-06-x-abcdefabcdef', cutoffAt = CORTE }) {
  const bodies = {
    regular: `${JSON.stringify(dataset('regular', regular, { revisionId, cutoffAt }))}\n`,
    premium: `${JSON.stringify(dataset('premium', premium, { revisionId, cutoffAt }))}\n`,
  };
  const descriptor = (key) => ({
    canonical_product: key === 'regular' ? 'GASOHOL REGULAR' : 'GASOHOL PREMIUM',
    label: key === 'regular' ? 'Gasohol Regular' : 'Gasohol Premium',
    dataset_url: `data/gasolina/snapshots/${revisionId}/${key}.json`,
    bytes: Buffer.byteLength(bodies[key]),
    sha256: sha256(bodies[key]),
    cutoff_at: cutoffAt,
  });
  const manifest = {
    schema_version: GASOLINA_MANIFEST_VERSION,
    revision_id: revisionId,
    scope: GASOLINA_SCOPE,
    products: { regular: descriptor('regular'), premium: descriptor('premium') },
    generated_at: '2026-09-06T22:46:45.739Z',
  };
  return { manifest, manifestText: `${JSON.stringify(manifest)}\n`, bodies };
}

function resumen({ generatedAt = '2026-09-09T18:40:02.118Z', days = 7, medias = null } = {}) {
  const fechas = windowDates(limaDate(generatedAt), days);
  return {
    schema_version: 'history-daily-1',
    method_version: METHOD_VERSION,
    timezone: HISTORY_TIMEZONE,
    scope: { ...HISTORY_SCOPE },
    currency: 'PEN',
    unit: 'Galones',
    generated_at: generatedAt,
    days,
    series: fechas.map((date, indice) => ({
      date,
      observation: medias?.[indice] === null ? null : {
        observation_id: `obs_${crypto.createHash('sha256').update(date).digest('hex').slice(0, 24)}`,
        observed_at: `${date}T23:37:00.000Z`,
        revision_id: 'gasolina-2026-09-06-x-abcdefabcdef',
        archive_hash: 'a'.repeat(64),
        // El corte del snapshot observado es siempre anterior a la observación:
        // medir vigencia contra un futuro que no existía es imposible.
        cutoff_at: `${addDays(date, -1)}T22:32:01.865Z`,
        source_max_reported_at: `${addDays(date, -2)}T04:54:46.000Z`,
        products: medias?.[indice] ?? { regular: { mean: 15.5, n: 600 }, premium: { mean: 18.25, n: 570 } },
      },
    })),
  };
}

// ── 1 · Fechas de Lima y aritmética del calendario ────────────────────────────

test('1 · el calendario es el de Lima aunque el instante sea de otro día en UTC', () => {
  assert.equal(limaDate('2026-09-10T02:37:00Z'), '2026-09-09', 'las 21:37 de Lima siguen siendo el día 9');
  assert.equal(limaDate('2026-09-10T05:01:00Z'), '2026-09-10');
  assert.equal(limaDate('2026-09-10T04:59:59Z'), '2026-09-09', 'el corte local está en 05:00Z');
  assert.equal(limaDate(new Date('2026-01-01T04:00:00Z')), '2025-12-31', 'también cruza el año');
  assert.throws(() => limaDate('no es un instante'), /Instante inválido/);
});

test('1 · la aritmética de días no depende del huso ni acepta fechas inexistentes', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-08-31', '2026-09-01'), 1);
  assert.equal(daysBetween('2026-08-10', '2026-09-09'), 30);
  // `Date.parse('2026-02-30T00:00:00Z')` no falla: DESBORDA al 2 de marzo. Sin
  // el ida y vuelta, un 30 de febrero entraría en la serie como otra fecha.
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2027-02-29'), false);
  assert.equal(isRealDate('2028-02-29'), true, '2028 sí es bisiesto');
  assert.equal(isRealDate('2026-09-31'), false);
  assert.equal(isRealDate('2026-13-01'), false);
  const ventana = windowDates('2026-09-10', 7);
  assert.equal(ventana.length, 7);
  assert.equal(ventana.at(-1), '2026-09-10');
  assert.equal(ventana[0], '2026-09-04');
  assert.throws(() => windowDates('2026-09-10', 31), /Ventana fuera de rango/);
});

// ── 2 · La media (§4) ─────────────────────────────────────────────────────────

test('2 · medias conocidas, con denominadores independientes por producto', () => {
  const { manifest, bodies } = bundle({
    regular: [oferta({ semilla: 'a', price: 10 }), oferta({ semilla: 'b', price: 20 })],
    premium: [oferta({ semilla: 'a', price: 15 }), oferta({ semilla: 'b', price: 25 }), oferta({ semilla: 'c', price: 20 })],
  });
  const salida = observationMeans({ manifest, bodies, observedAt: OBSERVADO });
  assert.deepEqual(salida.problems, [], salida.problems.join('; '));
  assert.equal(salida.ok, true);
  assert.deepEqual(salida.products.regular, { mean: 15, n: 2 }, 'el ejemplo literal del SPEC');
  assert.deepEqual(salida.products.premium, { mean: 20, n: 3 });
});

test('2 · repetir la misma fila no altera la media; contradecirse la invalida', () => {
  const repetida = oferta({ semilla: 'a', price: 10 });
  const { manifest, bodies } = bundle({
    regular: [repetida, { ...repetida, id: ofertaId('a2') }, { ...repetida, id: ofertaId('a3') }, oferta({ semilla: 'b', price: 20 })],
    premium: [oferta({ semilla: 'a', price: 15 }), oferta({ semilla: 'b', price: 25 })],
  });
  const salida = observationMeans({ manifest, bodies, observedAt: OBSERVADO });
  assert.deepEqual(salida.products.regular, { mean: 15, n: 2 }, 'tres copias del mismo grifo siguen siendo un voto');
  assert.equal(salida.duplicates_ignored.regular, 2);
  assert.equal(salida.ok, true);

  const contradictorio = bundle({
    regular: [oferta({ semilla: 'a', price: 10 }), { ...oferta({ semilla: 'a', price: 12 }), id: ofertaId('otro') }],
    premium: [oferta({ semilla: 'a', price: 15 })],
  });
  const roto = observationMeans({ manifest: contradictorio.manifest, bodies: contradictorio.bodies, observedAt: OBSERVADO });
  assert.equal(roto.ok, false, 'no se elige una de las dos filas: no hay observación');
  assert.equal(roto.contradictions.length, 1);
  assert.equal(roto.contradictions[0].product, 'regular');
});

test('2 · la vigencia se mide con la regla de la interfaz y el reloj en observed_at', () => {
  const observadoEn = '2026-10-05T12:00:00.000Z';
  const justo = new Date(Date.parse(observadoEn) - 30 * 86_400_000).toISOString();
  const pasado = new Date(Date.parse(observadoEn) - 30 * 86_400_000 - 1).toISOString();
  const futuro = new Date(Date.parse(observadoEn) + 60_000).toISOString();
  const medida = productMean([
    oferta({ semilla: 'a', price: 10, reportedAt: justo }),
    oferta({ semilla: 'b', price: 30, reportedAt: pasado }),
    oferta({ semilla: 'c', price: 50, reportedAt: futuro }),
  ], { observedAt: observadoEn, cutoffAt: CORTE });
  assert.deepEqual(medida, { mean: 10, n: 1, blocked: false, contradictions: [], duplicates_ignored: 0, problems: [] },
    'exactamente 30 días entra; 30 días y 1 ms y el futuro quedan fuera');

  // Un reloj anterior al corte no puede medir vigencia: se informa, no se cae.
  const imposible = productMean([oferta({ semilla: 'a', price: 10 })], { observedAt: '2026-09-01T00:00:00.000Z', cutoffAt: CORTE });
  assert.equal(imposible.blocked, true, 'no se pudo medir; no es que no hubiera precios');
  assert.equal(imposible.n, 0);
  assert.equal(imposible.mean, null);
  assert.match(imposible.problems[0], /anterior al corte/);
  // Y esa diferencia importa: una observación que no se pudo medir no se publica.
  const { manifest, bodies } = bundle({ regular: [oferta({ semilla: 'a', price: 10 })], premium: [oferta({ semilla: 'a', price: 15 })] });
  const bloqueada = observationMeans({ manifest, bodies, observedAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(bloqueada.ok, false);
});

test('2 · sin precios elegibles la media es null con n cero, nunca un precio cero', () => {
  const viejo = new Date(Date.parse(OBSERVADO) - 40 * 86_400_000).toISOString();
  const medida = productMean([oferta({ semilla: 'a', price: 10, reportedAt: viejo })], { observedAt: OBSERVADO, cutoffAt: CORTE });
  assert.equal(medida.mean, null);
  assert.equal(medida.n, 0);
});

test('2 · una pareja mezclada de dos revisiones no produce medias', () => {
  const primera = bundle({ regular: [oferta({ semilla: 'a', price: 10 })], premium: [oferta({ semilla: 'a', price: 15 })] });
  const segunda = bundle({ regular: [oferta({ semilla: 'a', price: 11 })], premium: [oferta({ semilla: 'a', price: 16 })], revisionId: 'gasolina-2026-09-07-y-0123456789ab' });
  // Regular de una revisión con Premium de otra: los hashes del manifest son los
  // de la primera, así que el segundo cuerpo no cuadra y no hay observación.
  const salida = observationMeans({ manifest: primera.manifest, bodies: { regular: primera.bodies.regular, premium: segunda.bodies.premium }, observedAt: OBSERVADO });
  assert.equal(salida.ok, false);
  assert.ok(salida.problems.some((motivo) => /^premium:/.test(motivo)), salida.problems.join('; '));
  assert.equal(salida.products.premium, undefined, 'no se cuenta un producto que no se pudo validar');
});

test('2 · marca, distrito y coordenada no intervienen en el cálculo', () => {
  const base = [oferta({ semilla: 'a', price: 10 }), oferta({ semilla: 'b', price: 20 })];
  const adornadas = base.map((item, indice) => ({ ...item, commercial_identity: { brand: 'Primax', public_site_name: 'Sonda', confidence: 'verified' }, district: indice ? 'SURCO' : 'LINCE' }));
  assert.deepEqual(
    productMean(adornadas, { observedAt: OBSERVADO, cutoffAt: CORTE }),
    productMean(base, { observedAt: OBSERVADO, cutoffAt: CORTE }),
  );
});

// ── 3 · El contrato del resumen (§6) ──────────────────────────────────────────

test('3 · un resumen bien formado pasa, y las dos listas de productos coinciden', () => {
  assert.deepEqual(validateDailySummary(resumen()), []);
  assert.deepEqual([...HISTORY_PRODUCTS], [...GASOLINA_KEYS], 'el formato histórico y el de precios nombran los mismos productos');
  assert.deepEqual(HISTORY_SCOPE, GASOLINA_SCOPE, 'y el mismo alcance');
});

test('3 · el validador rechaza cada forma de resumen corrupto', () => {
  const casos = [
    ['versión desconocida', (s) => { s.schema_version = 'history-daily-9'; }, /versión de esquema desconocida/],
    ['otro calendario', (s) => { s.timezone = 'UTC'; }, /calendario/],
    ['otro ámbito', (s) => { s.scope = { department: 'AREQUIPA', province: 'AREQUIPA' }; }, /ámbito/],
    ['otra moneda', (s) => { s.currency = 'USD'; }, /moneda/],
    ['otra unidad', (s) => { s.unit = 'Litros'; }, /unidad/],
    ['días y fechas descuadrados', (s) => { s.days = 6; }, /fechas para days/],
    ['fecha inexistente', (s) => { s.series[2].date = '2026-02-30'; }, /fecha inexistente/],
    ['fechas no consecutivas', (s) => { s.series[3].date = addDays(s.series[3].date, 1); }, /no sigue a/],
    ['fechas duplicadas', (s) => { s.series[3].date = s.series[2].date; }, /no sigue a/],
    ['última fecha distinta de la generación', (s) => { s.series.at(-1).date = addDays(s.series.at(-1).date, -1); }, /la última fecha es/],
    ['media cero con n cero', (s) => { s.series[0].observation.products.regular = { mean: 0, n: 0 }; }, /null o un número positivo/],
    ['media sin denominador', (s) => { s.series[0].observation.products.regular = { mean: null, n: 3 }; }, /mean null y n cero/],
    ['denominador sin media', (s) => { s.series[0].observation.products.regular = { mean: 15.5, n: 0 }; }, /mean null y n cero/],
    ['n no entero', (s) => { s.series[0].observation.products.regular = { mean: 15.5, n: 2.5 }; }, /entero no negativo/],
    ['campo de más', (s) => { s.series[0].observation.extra = 1; }, /campos inesperados/],
    ['observación anterior a su corte', (s) => { s.series[0].observation.observed_at = '2026-01-01T00:00:00.000Z'; }, /anterior al corte/],
  ];
  for (const [nombre, romper, patron] of casos) {
    const copia = structuredClone(resumen());
    romper(copia);
    const problemas = validateDailySummary(copia);
    assert.ok(problemas.length, `${nombre}: debía dar error`);
    assert.ok(problemas.some((motivo) => patron.test(motivo)), `${nombre}: ${problemas.join('; ')}`);
  }
});

test('3 · un día sin captura no es lo mismo que un día sin precios elegibles', () => {
  const sinCaptura = resumen({ medias: [null, undefined, undefined, undefined, undefined, undefined, undefined] });
  assert.deepEqual(validateDailySummary(sinCaptura), []);
  assert.equal(sinCaptura.series[0].observation, null);

  const sinElegibles = resumen({ medias: [{ regular: { mean: null, n: 0 }, premium: { mean: null, n: 0 } }] });
  assert.deepEqual(validateDailySummary(sinElegibles), []);
  assert.notEqual(sinElegibles.series[0].observation, null, 'hubo captura; lo que no hubo fue precio');
});

test('3 · un cuerpo desmesurado se descarta antes de mirarlo', () => {
  assert.deepEqual(validateDailySummary(resumen(), { bytes: 1024 }), []);
  assert.ok(validateDailySummary(resumen(), { bytes: HISTORY_MAX_BYTES + 1 }).some((motivo) => /el tope es/.test(motivo)));
});

// ── 4 · El almacén (§5) ───────────────────────────────────────────────────────

test('4 · escribir dos veces los mismos bytes es idempotente; bytes distintos son error', async () => {
  const store = almacen('inmutable');
  const primera = await putImmutable(store, 'bundles/aa/manifest.json', '{"a":1}');
  assert.deepEqual({ written: primera.written, reused: primera.reused }, { written: true, reused: false });

  const segunda = await putImmutable(store, 'bundles/aa/manifest.json', '{"a":1}');
  assert.deepEqual({ written: segunda.written, reused: segunda.reused }, { written: false, reused: true }, 'un reintento no reescribe');
  assert.equal(segunda.sha256, primera.sha256);

  await assert.rejects(
    () => putImmutable(store, 'bundles/aa/manifest.json', '{"a":2}'),
    /Objeto inmutable con bytes distintos/,
    'no se sobrescribe ni se borra el objeto en conflicto',
  );
  assert.equal((await store.get('bundles/aa/manifest.json')).body, '{"a":1}', 'y el original sigue intacto');
});

test('4 · el almacén no ofrece forma de borrar', () => {
  const store = almacen('sin-borrado');
  assert.equal(store.delete, undefined, 'si borrar no existe en la forma, ningún camino puede borrar');
  assert.deepEqual(Object.keys(store).filter((clave) => typeof store[clave] === 'function').sort(), ['get', 'head', 'list', 'put']);
});

test('4 · el listado pagina de verdad y agota el cursor', async () => {
  const store = almacen('paginado');
  const fechas = ['2026-09-07', '2026-09-08', '2026-09-09'];
  for (const [indice, fecha] of fechas.entries()) {
    for (const sufijo of ['a', 'b']) await putImmutable(store, `observations/${fecha}/obs_${indice}${sufijo}.json`, `{"i":"${indice}${sufijo}"}`);
  }
  const primera = await store.list({ prefix: 'observations/', limit: 2 });
  assert.equal(primera.keys.length, 2);
  assert.ok(primera.cursor, 'quedan más páginas');

  const todas = await listAll(store, 'observations/', { limit: 2 });
  assert.equal(todas.length, 6, 'el bucle de cursor recorre las tres páginas');
  assert.deepEqual(todas.map((item) => item.key), [...todas].map((item) => item.key).sort((a, b) => a.localeCompare(b, 'en')), 'ordenadas');

  const unDia = await listAll(store, 'observations/2026-09-08/', { limit: 2 });
  assert.equal(unDia.length, 2, 'el prefijo por fecha acota');
});

test('4 · una clave no puede escapar de la raíz del almacén', async () => {
  const store = almacen('claves');
  for (const clave of ['../fuera.json', 'a/../../fuera.json', '/absoluta.json', 'a\\b.json', '', './a.json']) {
    await assert.rejects(() => store.put(clave, '{}', {}), /Clave de almacén/, `debía rechazar ${JSON.stringify(clave)}`);
  }
});

test('4 · el resumen sí se reemplaza, y sus cabeceras no lo declaran eterno', async () => {
  const store = almacen('mutable');
  await putMutable(store, 'series/daily-v1.json', '{"v":1}');
  await putMutable(store, 'series/daily-v1.json', '{"v":2}');
  assert.equal((await store.get('series/daily-v1.json')).body, '{"v":2}');
});

// ── 6 · Lectura coherente del bundle público (§7) ────────────────────────────

/** Servidor local que sirve un bundle; `mutar` puede cambiarlo entre peticiones. */
async function servirBundle(inicial, mutar = null) {
  let actual = inicial;
  let peticiones = 0;
  const servidor = http.createServer((peticion, respuesta) => {
    peticiones += 1;
    const ruta = peticion.url.replace(/^\//, '');
    const estado = { schema_version: GASOLINA_MANIFEST_VERSION, revision_id: actual.manifest.revision_id, snapshot_id: '2026-09-06-x', validators: { etag: '"x"', last_modified: null }, source_max_reported_at: '2026-09-05T04:54:46.000Z', products: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, { fresh_0_30_days: { offers: 2, districts: 1 }, contract_ready: { offers: 2, districts: 1 }, coverage_percent: 100, published: { offers: 2, districts: 1 }, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 }, cutoff_at: actual.manifest.products[key].cutoff_at }])) };
    const cuerpos = {
      'data/gasolina/manifest.json': `${JSON.stringify(actual.manifest)}\n`,
      'data/gasolina/refresh-state.json': `${JSON.stringify(estado)}\n`,
      [actual.manifest.products.regular.dataset_url]: actual.bodies.regular,
      [actual.manifest.products.premium.dataset_url]: actual.bodies.premium,
    };
    const cuerpo = cuerpos[ruta];
    if (mutar) actual = mutar(actual, peticiones, ruta) ?? actual;
    if (cuerpo === undefined) { respuesta.writeHead(404).end('no'); return; }
    respuesta.writeHead(200, { 'content-type': 'application/json' }).end(cuerpo);
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  servidores.push(servidor);
  return { origin: `http://127.0.0.1:${servidor.address().port}`, peticiones: () => peticiones };
}

// Corte anterior a cualquier observación de estas pruebas: un snapshot no puede
// tener un corte posterior al instante en que se lo observó.
const CORTE_TEMPRANO = '2026-09-06T00:00:00.000Z';
const bundleSimple = () => bundle({ regular: [oferta({ semilla: 'a', price: 10 }), oferta({ semilla: 'b', price: 20 })], premium: [oferta({ semilla: 'a', price: 15 }), oferta({ semilla: 'b', price: 25 })], cutoffAt: CORTE_TEMPRANO });

test('6 · un bundle coherente se lee entero y no toca el disco de nadie', async () => {
  const esperado = bundleSimple();
  const { origin } = await servirBundle(esperado);
  const leido = await fetchLiveBundle({ origin, testMode: true });
  assert.equal(leido.revision_id, esperado.manifest.revision_id);
  assert.equal(leido.bodies.regular, esperado.bodies.regular, 'los BYTES, no un JSON reserializado');
  assert.equal(leido.bodies.premium, esperado.bodies.premium);
  assert.ok(huellaDelBundle ? huellaDelBundle.equals(fs.readFileSync(path.join(dataRoot, 'manifest.json'))) : true, 'observar no escribe en web/data/');
});

test('6 · si el bundle cambia a mitad de la lectura, se reintenta y converge', async () => {
  const primero = bundleSimple();
  const segundo = bundle({ regular: [oferta({ semilla: 'a', price: 11 }), oferta({ semilla: 'b', price: 21 })], premium: [oferta({ semilla: 'a', price: 16 }), oferta({ semilla: 'b', price: 26 })], revisionId: 'gasolina-2026-09-07-y-0123456789ab' });
  let cambiado = false;
  // Cambia una sola vez, a mitad del primer intento: el segundo ya lee un trío
  // coherente. Es el caso de un deploy que aterriza mientras se observa.
  const { origin } = await servirBundle(primero, (actual, peticiones) => {
    if (!cambiado && peticiones === 2) { cambiado = true; return segundo; }
    return actual;
  });
  const leido = await fetchLiveBundle({ origin, testMode: true, sleep: async () => {} });
  assert.equal(leido.revision_id, segundo.manifest.revision_id, 'converge en la publicación nueva');
});

test('6 · un origen que cambia en cada intento no produce observación', async () => {
  let contador = 0;
  const { origin } = await servirBundle(bundleSimple(), () => bundle({
    regular: [oferta({ semilla: 'a', price: 10 + (contador += 1) })],
    premium: [oferta({ semilla: 'a', price: 15 })],
    revisionId: `gasolina-2026-09-0${(contador % 7) + 1}-z-abcdefabcdef`,
    cutoffAt: CORTE_TEMPRANO,
  }));
  await assert.rejects(
    () => fetchLiveBundle({ origin, testMode: true, sleep: async () => {} }),
    /No se pudo leer un bundle público coherente/,
  );
});

test('6 · la escritura del bundle conserva el efecto y la salida de siempre', async () => {
  const dir = escenario('escritura');
  const esperado = bundleSimple();
  const { origin } = await servirBundle(esperado);
  const leido = await fetchLiveBundle({ origin, testMode: true });
  const informe = writeLiveBundle(leido, { root: dir });
  assert.deepEqual(Object.keys(informe).sort(), ['raw_downloaded', 'refresh_state', 'revision_id', 'snapshots'], 'las cuatro claves de stdout de siempre');
  assert.equal(informe.raw_downloaded, false);
  assert.equal(informe.refresh_state, true);
  const escritos = path.join(dir, 'web', 'data', 'gasolina');
  assert.equal(fs.readFileSync(path.join(escritos, 'manifest.json'), 'utf8'), leido.manifestText);
  assert.equal(fs.readFileSync(path.join(escritos, 'refresh-state.json'), 'utf8'), leido.stateText);
  for (const key of GASOLINA_KEYS) {
    assert.equal(fs.readFileSync(path.join(dir, 'web', esperado.manifest.products[key].dataset_url), 'utf8'), esperado.bodies[key]);
    assert.equal(informe.snapshots[key], esperado.manifest.products[key].bytes);
  }
  // Repetirlo es idempotente, igual que antes del refactor.
  assert.deepEqual(writeLiveBundle(leido, { root: dir }), informe);
});

// ── 7 · Archivo durable (§5) ──────────────────────────────────────────────────

test('7 · archive_hash depende de los bytes y de nada más', () => {
  const primero = bundleSimple();
  assert.match(archiveHash(primero), /^[a-f0-9]{64}$/);
  assert.equal(archiveHash(primero), archiveHash({ manifestText: primero.manifestText, bodies: { ...primero.bodies } }), 'estable ante dos corridas');
  const cambiado = { ...primero, bodies: { ...primero.bodies, premium: `${primero.bodies.premium} ` } };
  assert.notEqual(archiveHash(cambiado), archiveHash(primero), 'un byte de un producto cambia la huella');
  const otroManifest = { ...primero, manifestText: `${primero.manifestText} ` };
  assert.notEqual(archiveHash(otroManifest), archiveHash(primero), 'y el manifest también cuenta');
});

test('7 · complete.json es función pura de los bytes: sin reloj dentro', () => {
  const datos = bundleSimple();
  const hash = archiveHash(datos);
  const primero = archiveComplete({ ...datos, hash });
  const segundo = archiveComplete({ ...datos, hash });
  assert.deepEqual(primero, segundo);
  // Si llevara `archived_at`, observar el mismo bundle dos veces produciría
  // bytes distintos bajo una clave inmutable y el conflicto saltaría en una
  // operación correcta.
  assert.equal(JSON.stringify(primero).includes('archived_at'), false);
  assert.deepEqual(Object.keys(primero.objects).sort(), ['manifest.json', 'premium.json', 'regular.json']);
});

test('7 · archivar dos veces el mismo bundle no duplica nada', async () => {
  const store = almacen('archivo');
  const datos = bundleSimple();
  const primera = await archiveBundle(store, datos);
  assert.equal(primera.stored, true);
  assert.deepEqual(primera.written.sort(), ['complete.json', 'manifest.json', 'premium.json', 'regular.json']);

  const segunda = await archiveBundle(store, datos);
  assert.equal(segunda.stored, false, 'nada nuevo que subir');
  assert.equal(segunda.reused.length, 4);
  assert.equal(segunda.archive_hash, primera.archive_hash);
  const todas = await listAll(store, 'bundles/');
  assert.equal(todas.length, 4, 'cuatro objetos, no ocho');
});

test('7 · una escritura parcial la repara la corrida siguiente, sin lógica especial', async () => {
  const store = almacen('parcial');
  const datos = bundleSimple();
  const hash = archiveHash(datos);
  // Simula una corrida que subió los tres cuerpos y murió antes del cierre.
  for (const [nombre, cuerpo] of [['manifest.json', datos.manifestText], ['regular.json', datos.bodies.regular], ['premium.json', datos.bodies.premium]]) {
    await putImmutable(store, archiveKey(hash, nombre), cuerpo);
  }
  assert.equal(await store.get(archiveKey(hash, 'complete.json')), null, 'el archivo estaba incompleto');

  const reparada = await archiveBundle(store, datos);
  assert.deepEqual(reparada.reused.sort(), ['manifest.json', 'premium.json', 'regular.json']);
  assert.deepEqual(reparada.written, ['complete.json'], 'solo se escribe lo que faltaba');
  assert.ok(await store.get(archiveKey(hash, 'complete.json')));
});

// ── 8 · Observación y resumen (§4, §6) ───────────────────────────────────────

test('8 · el identificador de observación es determinista', () => {
  const argumentos = { observedAt: OBSERVADO, archiveHash: 'b'.repeat(64) };
  assert.equal(observationId(argumentos), observationId(argumentos));
  assert.match(observationId(argumentos), /^obs_[a-f0-9]{24}$/);
  assert.notEqual(observationId(argumentos), observationId({ ...argumentos, observedAt: '2026-09-09T18:37:12.483Z' }));
  assert.notEqual(observationId(argumentos), observationId({ ...argumentos, archiveHash: 'c'.repeat(64) }));
  const observation = buildObservation({ observedAt: OBSERVADO, archiveHash: 'b'.repeat(64), complete: { revision_id: 'r', cutoff_at: CORTE, source_max_reported_at: '2026-09-05T04:54:46.000Z' }, products: { regular: { mean: 15, n: 2 }, premium: { mean: 20, n: 2 } } });
  assert.equal(observation.local_date, limaDate(OBSERVADO));
  assert.equal(observationKey(observation.local_date, observation.observation_id), `observations/${observation.local_date}/${observation.observation_id}.json`);
});

test('8 · de varias observaciones del día gana la última, no la media de medias', () => {
  const observaciones = [
    { observation_id: 'obs_b', observed_at: '2026-09-09T14:00:00.000Z', products: { regular: { mean: 10, n: 5 } } },
    { observation_id: 'obs_a', observed_at: '2026-09-09T20:00:00.000Z', products: { regular: { mean: 30, n: 7 } } },
    { observation_id: 'obs_c', observed_at: '2026-09-09T08:00:00.000Z', products: { regular: { mean: 20, n: 6 } } },
  ];
  assert.equal(lastObservationOfDay(observaciones).observation_id, 'obs_a');
  // Empate exacto: desempata el identificador, para que dos corridas coincidan.
  const empatadas = observaciones.map((item) => ({ ...item, observed_at: '2026-09-09T20:00:00.000Z' }));
  assert.equal(lastObservationOfDay(empatadas).observation_id, 'obs_c');
  assert.equal(lastObservationOfDay([]), null);
});

test('8 · el mismo bundle en dos días da un archivo y dos observaciones distintas', async () => {
  const store = almacen('dos-dias');
  const datos = bundleSimple();
  const { origin } = await servirBundle(datos);
  const primera = await observeHistory({ store, origin, days: 7, deps: { fetchLiveBundle: () => fetchLiveBundle({ origin, testMode: true }), now: () => '2026-09-08T18:00:00.000Z' } });
  const segunda = await observeHistory({ store, origin, days: 7, deps: { fetchLiveBundle: () => fetchLiveBundle({ origin, testMode: true }), now: () => '2026-09-09T18:00:00.000Z' } });
  assert.equal(primera.ok, true, primera.problems.join('; '));
  assert.equal(segunda.ok, true, segunda.problems.join('; '));
  assert.equal(primera.archive, 'stored');
  assert.equal(segunda.archive, 'reused', 'el bundle no cambió: no se vuelve a archivar');
  assert.equal(primera.archive_hash, segunda.archive_hash);
  assert.notEqual(primera.observation_id, segunda.observation_id);
  assert.equal((await listAll(store, 'bundles/')).length, 4, 'un solo archivo');
  assert.equal((await listAll(store, 'observations/')).length, 2, 'dos observaciones');
  assert.equal(segunda.days_with_observation, 2);

  // Y el resumen publicado pasa el contrato que usará el navegador.
  const publicado = JSON.parse((await store.get(SUMMARY_KEY)).body);
  assert.deepEqual(validateDailySummary(publicado, { bytes: (await store.head(SUMMARY_KEY)).bytes }), []);
  assert.equal(publicado.series.at(-1).date, '2026-09-09');
  assert.deepEqual(publicado.series.at(-1).observation.products.regular, { mean: 15, n: 2 });
});

test('8 · un reintento dentro de la misma corrida no crea una segunda observación', async () => {
  const store = almacen('reintento');
  const { origin } = await servirBundle(bundleSimple());
  const deps = { fetchLiveBundle: () => fetchLiveBundle({ origin, testMode: true }), now: () => '2026-09-09T18:00:00.000Z' };
  const primera = await observeHistory({ store, origin, days: 7, deps });
  const repetida = await observeHistory({ store, origin, days: 7, deps });
  assert.equal(primera.observation, 'new');
  assert.equal(repetida.observation, 'reused', 'mismo instante y mismo archivo: misma clave');
  assert.equal(repetida.observation_id, primera.observation_id);
  assert.equal((await listAll(store, 'observations/')).length, 1);
  assert.equal(repetida.summary_write, 'skipped_unchanged', 'ni siquiera se reescribe el resumen');
});

test('8 · un bundle que se contradice se archiva pero deja la corrida en rojo', async () => {
  const store = almacen('contradictorio');
  const roto = bundle({
    regular: [oferta({ semilla: 'a', price: 10 }), { ...oferta({ semilla: 'a', price: 12 }), id: ofertaId('otro') }],
    premium: [oferta({ semilla: 'a', price: 15 })],
    cutoffAt: CORTE_TEMPRANO,
  });
  const { origin } = await servirBundle(roto);
  const salida = await observeHistory({ store, origin, days: 7, deps: { fetchLiveBundle: () => fetchLiveBundle({ origin, testMode: true }), now: () => '2026-09-09T18:00:00.000Z' } });
  assert.equal(salida.ok, false, 'la corrida termina en rojo');
  assert.equal(salida.observation, 'none', 'no se publica una media que dependa de qué fila se eligió');
  assert.equal(salida.archive, 'stored', 'pero los bytes públicos sí se conservan como evidencia');
  assert.ok(salida.problems.some((motivo) => /se contradice/.test(motivo)), salida.problems.join('; '));
  assert.equal((await listAll(store, 'observations/')).length, 0);
});

test('8 · un día sin captura queda como hueco, no como punto repetido', async () => {
  const store = almacen('hueco');
  const { origin } = await servirBundle(bundleSimple());
  await observeHistory({ store, origin, days: 7, deps: { fetchLiveBundle: () => fetchLiveBundle({ origin, testMode: true }), now: () => '2026-09-06T18:00:00.000Z' } });
  const { summary } = await buildDailySummary(store, { generatedAt: '2026-09-09T18:00:00.000Z', days: 7 });
  assert.deepEqual(validateDailySummary(summary), []);
  const conObservacion = summary.series.filter((dia) => dia.observation);
  assert.equal(conObservacion.length, 1);
  assert.equal(conObservacion[0].date, '2026-09-06');
  assert.equal(summary.series.at(-1).observation, null, 'los días posteriores son huecos');
});

// ── 9 · Guardas del resumen (§5) ─────────────────────────────────────────────

test('9 · una corrida atrasada no hace retroceder la serie', async () => {
  const store = almacen('atrasada');
  const nuevo = resumen({ generatedAt: '2026-09-09T18:00:00.000Z', days: 7 });
  await publishDailySummary(store, nuevo);
  const viejo = resumen({ generatedAt: '2026-09-08T18:00:00.000Z', days: 7 });
  const salida = await publishDailySummary(store, viejo);
  assert.equal(salida.write, 'skipped_stale');
  assert.match(salida.reason, /más nuevo que esta corrida/);
  assert.equal(JSON.parse((await store.get(SUMMARY_KEY)).body).generated_at, nuevo.generated_at, 'lo publicado no se movió');
});

test('9 · perder una observación que ya estaba publicada bloquea la escritura', async () => {
  const store = almacen('perdidas');
  const completo = resumen({ generatedAt: '2026-09-09T18:00:00.000Z', days: 7 });
  await publishDailySummary(store, completo);
  // La misma ventana, pero un día se quedó sin observación: un listado devolvió
  // menos de lo que hay. Se prefiere no escribir y que la corrida se vea roja.
  const incompleto = structuredClone(completo);
  incompleto.generated_at = '2026-09-09T19:00:00.000Z';
  incompleto.series[3].observation = null;
  const salida = await publishDailySummary(store, incompleto);
  assert.equal(salida.write, 'blocked_missing_observations');
  assert.match(salida.reason, new RegExp(completo.series[3].date));
  assert.equal(JSON.parse((await store.get(SUMMARY_KEY)).body).series[3].observation !== null, true);
});

test('9 · sin cambios no se reescribe, y avanzar sí se publica', async () => {
  const store = almacen('sin-cambios');
  const base = resumen({ generatedAt: '2026-09-09T18:00:00.000Z', days: 7 });
  assert.equal((await publishDailySummary(store, base)).write, 'written');
  assert.equal((await publishDailySummary(store, base)).write, 'skipped_unchanged');
  const avanzado = resumen({ generatedAt: '2026-09-10T18:00:00.000Z', days: 7 });
  assert.equal((await publishDailySummary(store, avanzado)).write, 'written');
});

test('9 · el listado S3 se lee sin parser y falla antes que mentir', () => {
  const xml = '<ListBucketResult><Contents><Key>observations/2026-09-09/obs_a.json</Key><Size>412</Size></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>abc</NextContinuationToken></ListBucketResult>';
  assert.deepEqual(parseListResponse(xml), { keys: [{ key: 'observations/2026-09-09/obs_a.json', bytes: 412 }], cursor: 'abc' });
  assert.deepEqual(parseListResponse('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'), { keys: [], cursor: null });
  assert.throws(() => parseListResponse('<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>'), /lista estaría incompleta/);
  assert.throws(() => parseListResponse('<ListBucketResult><Contents><Size>1</Size></Contents></ListBucketResult>'), /sin clave/);
});

// ── 10 · El modelo de vista del gráfico (§8) ─────────────────────────────────

test('10 · las tres ventanas recortan la misma serie y siempre terminan hoy', () => {
  const hoy = '2026-09-09';
  const fuente = resumen({ generatedAt: `${hoy}T18:00:00.000Z`, days: 30 });
  assert.deepEqual(HISTORY_WINDOWS, [7, 14, 30]);
  assert.equal(DEFAULT_WINDOW, 30, 'treinta por defecto: la ventana de frescura de la app');
  for (const days of HISTORY_WINDOWS) {
    const marco = frameWindow(fuente, { today: hoy, days });
    assert.equal(marco.points.length, days);
    assert.equal(marco.points.at(-1).date, hoy);
    assert.equal(marco.points.at(-1).isToday, true);
    assert.equal(marco.points[0].date, addDays(hoy, -(days - 1)));
  }
});

test('10 · un resumen viejo deja huecos al final, no puntos repetidos', () => {
  // El resumen se generó anteayer; quien mira lo abre hoy.
  const fuente = resumen({ generatedAt: '2026-09-07T18:00:00.000Z', days: 7 });
  const marco = frameWindow(fuente, { today: '2026-09-09', days: 7 });
  assert.equal(marco.points.at(-1).date, '2026-09-09');
  assert.equal(marco.points.at(-1).observation, null, 'hoy es un hueco');
  assert.equal(marco.points.at(-2).observation, null, 'y ayer también');
  assert.equal(marco.points.at(-3).date, '2026-09-07');
  assert.ok(marco.points.at(-3).observation, 'el último día observado sí tiene dato');
  // La antigüedad se cuenta desde la última OBSERVACIÓN, no desde la generación.
  const horas = staleHours(marco.lastObservedAt, '2026-09-09T23:37:00.000Z');
  assert.ok(horas > STALE_HOURS, `${horas} h desde la última observación`);
  assert.equal(staleHours(null, '2026-09-09T23:37:00.000Z'), null);
});

test('10 · un hueco corta la línea: nada de interpolar ni arrastrar el último valor', () => {
  const hoy = '2026-09-09';
  const fuente = resumen({ generatedAt: `${hoy}T18:00:00.000Z`, days: 7, medias: [undefined, undefined, null, undefined, undefined, undefined, undefined] });
  const marco = frameWindow(fuente, { today: hoy, days: 7 });
  const tramos = segments(marco.points, 'regular');
  assert.equal(tramos.length, 2, 'dos tramos, no una línea continua por encima del hueco');
  assert.equal(tramos[0].length, 2);
  assert.equal(tramos[1].length, 4);
  // Y el calendario no se comprime: el hueco conserva su ranura.
  assert.equal(marco.points.length, 7);
  assert.equal(marco.points[2].regular, null);
});

test('10 · un día suelto entre huecos es un punto, no una tendencia', () => {
  const hoy = '2026-09-09';
  const solo = [null, null, undefined, null, null, null, null];
  const marco = frameWindow(resumen({ generatedAt: `${hoy}T18:00:00.000Z`, days: 7, medias: solo }), { today: hoy, days: 7 });
  const tramos = segments(marco.points, 'premium');
  assert.equal(tramos.length, 1);
  assert.equal(tramos[0].length, 1, 'un tramo de un punto se dibuja como punto');
});

test('10 · el eje Y lo comparten las dos series y nunca queda degenerado', () => {
  const hoy = '2026-09-09';
  const marco = frameWindow(resumen({ generatedAt: `${hoy}T18:00:00.000Z`, days: 7 }), { today: hoy, days: 7 });
  const escala = sharedScale(marco.points);
  assert.ok(escala.min < 15.5 && escala.max > 18.25, 'cubre las dos series, no solo una');
  assert.ok(escala.ticks.length >= 2);
  assert.equal(escala.empty, false);
  // Todos los valores iguales: el rango se abre para que la línea se vea.
  const planas = frameWindow(resumen({ generatedAt: `${hoy}T18:00:00.000Z`, days: 7, medias: Array(7).fill({ regular: { mean: 21, n: 5 }, premium: { mean: 21, n: 5 } }) }), { today: hoy, days: 7 });
  const constante = sharedScale(planas.points);
  assert.ok(constante.max > constante.min, 'rango no nulo');
  assert.equal(constante.min, 20.75);
  assert.equal(constante.max, 21.25);
  // Sin ningún dato no se inventa una escala.
  assert.equal(sharedScale(frameWindow(null, { today: hoy, days: 7 }).points).empty, true);
});

test('10 · la serie de demostración es válida y no toca red ni almacenamiento', () => {
  const hoy = '2026-09-09';
  const demo = demoSummary({ today: hoy });
  assert.deepEqual(validateDailySummary(demo), [], 'pasa el mismo contrato que el dato real');
  assert.equal(demo.series.length, 30);
  assert.equal(demo.series.at(-1).date, hoy);
  assert.ok(demo.series.some((dia) => dia.observation === null), 'incluye huecos: una fuente semanal no da una línea continua');
  const fuente = fs.readFileSync(path.join(root, 'web', 'history-chart.js'), 'utf8');
  assert.match(fuente, /if \(demo\) \{[\s\S]*?return;\n {4}\}/, 'la rama de demostración sale antes de cualquier fetch');
});

test('10 · el gráfico entra en la precache y la CSP autoriza su origen', () => {
  const { entries } = deriveShell({ root });
  for (const modulo of ['/history-chart.js', '/lib/history-contract.js', '/lib/history-series.js']) {
    assert.ok(entries.includes(modulo), `${modulo} viaja en la precache`);
  }
  const cabeceras = fs.readFileSync(path.join(root, 'web', '_headers'), 'utf8');
  assert.match(cabeceras, new RegExp(`connect-src [^;]*${HISTORY_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'connect-src autoriza el histórico');
  // Cross-origin a propósito: es lo que hace que el service worker lo ignore.
  assert.notEqual(new URL(HISTORY_ORIGIN).origin, 'https://masfacil.pe');
  assert.match(fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8'), /url\.origin !== self\.location\.origin\) return;/);
});

test('10 · el gráfico se monta fuera del arranque de precios', () => {
  const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
  // Sentencia aparte, después de `initialize()`: su fallo no puede caer en el
  // `catch` que manda la app a `fatal-state`.
  assert.match(app, /initialize\(\);\n(?:\/\/[^\n]*\n)*(?:const historyChart = )?mountHistoryChart\(/);
  assert.doesNotMatch(app, /await mountHistoryChart/, 'nunca se espera al histórico');
  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const start = html.slice(html.indexOf('id="start-step"'), html.indexOf('id="loading-step"'));
  assert.ok(start.includes('id="history-chart"'), 'vive dentro de #start-step, así que show() lo oculta gratis');
  assert.ok(start.indexOf('id="data-status"') < start.indexOf('id="history-chart"'), 'va después de los avisos');
});

// ── 5 · Aislamiento: nada de credenciales, nada de red ────────────────────────

test('5 · sin credenciales el almacén es local y el módulo S3 ni se importa', async () => {
  const dir = escenario('eleccion');
  const local = await createHistoryStore({ env: { HISTORY_STORE: 'fs', HISTORY_STORE_ROOT: dir } });
  assert.equal(local.kind, 'fs');

  const porDefecto = await createHistoryStore({ env: { HISTORY_STORE_ROOT: dir } });
  assert.equal(porDefecto.kind, 'fs');

  // Una configuración a medias es un error: creerse que se escribe en el bucket
  // y no estarlo es peor que no escribir.
  await assert.rejects(
    () => createHistoryStore({ env: { DATOS_S3_ENDPOINT: 'x', DATOS_S3_BUCKET: 'y' } }),
    /Configuración del almacén S3 incompleta: faltan DATOS_S3_REGION, DATOS_S3_ACCESS_KEY_ID, DATOS_S3_SECRET_ACCESS_KEY/,
  );
  assert.deepEqual([...S3_VARIABLES], ['DATOS_S3_ENDPOINT', 'DATOS_S3_REGION', 'DATOS_S3_BUCKET', 'DATOS_S3_ACCESS_KEY_ID', 'DATOS_S3_SECRET_ACCESS_KEY']);
  // El backend S3 se carga con `import()` DENTRO de su rama: sin credenciales
  // ese módulo nunca se evalúa, y por eso una corrida como esta puede demostrar
  // que no pidió acceso en vez de prometerlo.
  const fuente = fs.readFileSync(path.join(root, 'pipeline', 'history', 'store.mjs'), 'utf8');
  assert.doesNotMatch(fuente, /^import .*store-s3\.mjs/m, 'store-s3 no puede importarse de forma estática');
  assert.match(fuente, /await import\('\.\/store-s3\.mjs'\)/, 'y sí de forma dinámica');
  assert.equal(fs.existsSync(path.join(root, 'pipeline', 'history', 'store-r2.mjs')), false, 'el adaptador de R2 se retiró');
  // Y el workflow pide exactamente esas variables, ninguna de R2.
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'history.yml'), 'utf8');
  for (const nombre of S3_VARIABLES) assert.ok(workflow.includes(`test -n "$${nombre}"`), `${nombre} se exige antes de observar`);
  assert.doesNotMatch(workflow, /R2_/);
  assert.match(workflow, /environment: datos-production/, 'el environment es el del bucket compartido, no el del workflow');
});

test('5 · el histórico no arrastra una reproyección de precios', () => {
  for (const ruta of ['pipeline/history/store.mjs', 'pipeline/history/daily-mean.mjs', 'scripts/observe-history.mjs', 'scripts/probe-historico.mjs']) {
    assert.equal(classifyPath(ruta), 'operator', ruta);
  }
  assert.equal(classifyPath('pipeline/project-gasolina.mjs'), 'projection', 'el camino de precios no cambia');
  assert.equal(classifyPath('web/lib/history-contract.js'), 'shell', 'el contrato isomórfico viaja con la interfaz');
});

test('5 · la sonda no tocó el bundle público ni la caché local', () => {
  if (huellaDelBundle) assert.ok(huellaDelBundle.equals(fs.readFileSync(path.join(dataRoot, 'manifest.json'))), 'el bundle real sigue igual');
  assert.equal(huellaLocal(historyLocal), huellaHistoryLocal, 'la copia local del histórico quedó exactamente como estaba');
  for (const nombre of S3_VARIABLES) {
    assert.equal(process.env[nombre], undefined, `${nombre} no debería existir en esta corrida`);
  }
});

// ── 4 bis · El prefijo del bucket ─────────────────────────────────────────────

test('4 · el prefijo lo antepone el almacén, también en disco, y lo quita al listar', async () => {
  const dir = escenario('prefijo');
  const store = createFsStore({ root: dir, prefix: 'gasolina/' });
  await putImmutable(store, 'series/daily-v1.json', '{}');
  assert.ok(fs.existsSync(path.join(dir, 'gasolina', 'series', 'daily-v1.json')), 'la copia local tiene la misma disposición que el bucket');
  assert.deepEqual((await listAll(store, 'series/')).map((item) => item.key), ['series/daily-v1.json'], 'quien lista nunca ve el prefijo');
  assert.equal(await store.head('gasolina/series/daily-v1.json'), null, 'ni puede colarlo a mano');
  assert.throws(() => createFsStore({ root: dir, prefix: '../fuera/' }), /Clave de almacén/);
  assert.throws(() => createFsStore({ root: dir, prefix: 'gasolina' }), /Prefijo/);
  const porEntorno = await createHistoryStore({ env: { HISTORY_STORE: 'fs', HISTORY_STORE_ROOT: dir } });
  assert.equal(porEntorno.prefix, DEFAULT_PREFIX, 'el prefijo por defecto es el del histórico');
  assert.equal((await createHistoryStore({ env: { HISTORY_STORE: 'fs', HISTORY_STORE_ROOT: dir, HISTORY_S3_PREFIX: '' } })).prefix, DEFAULT_PREFIX, 'vacío cuenta como ausente: así llega una variable sin definir desde Actions');
});

// ── 11 · El adaptador S3 contra un doble que imita a Neon ────────────────────

/**
 * Doble de un almacén S3 path-style: un bucket, listado `ListObjectsV2` con
 * prefijo y token de continuación, PUT que guarda cabeceras, HEAD/GET que las
 * devuelven —o no, si `echoMeta` es falso, porque Neon no documenta que los
 * metadatos vuelvan—, y 404 `NoSuchKey` en XML. No verifica la firma: solo
 * registra qué se pidió y con qué credencial.
 */
async function servirS3({ bucket = 'masfacil-datos', echoMeta = true } = {}) {
  const objetos = new Map();
  const registro = [];
  const servidor = http.createServer((peticion, respuesta) => {
    const url = new URL(peticion.url, 'http://127.0.0.1');
    const partes = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    registro.push({ method: peticion.method, path: url.pathname, query: url.search, auth: peticion.headers.authorization ?? '' });
    const xmlError = (status, code) => { respuesta.writeHead(status, { 'content-type': 'application/xml' }); respuesta.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>doble</Message></Error>`); };
    if (partes[0] !== bucket) return xmlError(404, 'NoSuchBucket');
    const key = partes.slice(1).join('/');
    if (peticion.method === 'GET' && partes.length === 1 && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const max = Number(url.searchParams.get('max-keys') ?? 1000);
      const token = url.searchParams.get('continuation-token');
      const claves = [...objetos.keys()].filter((item) => item.startsWith(prefix)).sort();
      const desde = token ? claves.indexOf(Buffer.from(token, 'base64').toString()) + 1 : 0;
      const pagina = claves.slice(desde, desde + max);
      const truncado = desde + max < claves.length;
      const contenido = pagina.map((item) => `<Contents><Key>${item}</Key><Size>${objetos.get(item).body.length}</Size></Contents>`).join('');
      const siguiente = truncado ? `<NextContinuationToken>${Buffer.from(pagina.at(-1)).toString('base64')}</NextContinuationToken>` : '';
      respuesta.writeHead(200, { 'content-type': 'application/xml' });
      respuesta.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>${truncado}</IsTruncated>${contenido}${siguiente}</ListBucketResult>`);
      return;
    }
    if (peticion.method === 'PUT') {
      const trozos = [];
      peticion.on('data', (trozo) => trozos.push(trozo));
      peticion.on('end', () => {
        objetos.set(key, { body: Buffer.concat(trozos), contentType: peticion.headers['content-type'] ?? null, cacheControl: peticion.headers['cache-control'] ?? null, meta: peticion.headers['x-amz-meta-sha256'] ?? null });
        respuesta.writeHead(200, { etag: '"opaco"' });
        respuesta.end();
      });
      return;
    }
    const objeto = objetos.get(key);
    if (!objeto) return xmlError(404, 'NoSuchKey');
    const cabeceras = { 'content-length': String(objeto.body.length), etag: '"opaco"' };
    if (objeto.contentType) cabeceras['content-type'] = objeto.contentType;
    if (objeto.cacheControl) cabeceras['cache-control'] = objeto.cacheControl;
    if (echoMeta && objeto.meta) cabeceras['x-amz-meta-sha256'] = objeto.meta;
    if (peticion.method === 'HEAD') { respuesta.writeHead(200, cabeceras); respuesta.end(); return; }
    if (peticion.method === 'GET') { respuesta.writeHead(200, cabeceras); respuesta.end(objeto.body); return; }
    return xmlError(405, 'MethodNotAllowed');
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  servidores.push(servidor);
  return { endpoint: `http://127.0.0.1:${servidor.address().port}`, objetos, registro };
}

const aws4fetchInstalado = await import('aws4fetch').then(() => true, () => false);
const sinAws4fetch = aws4fetchInstalado ? false : 'aws4fetch no está instalado (pnpm install); el adaptador S3 no se prueba';
const almacenS3 = async ({ endpoint, prefix = 'gasolina/' }) => {
  const { createS3Store } = await import('../pipeline/history/store-s3.mjs');
  return createS3Store({ endpoint, region: 'us-east-2', bucket: 'masfacil-datos', prefix, accessKeyId: 'sonda-key', secretAccessKey: 'sonda-secreto', sleep: async () => {} });
};

test('11 · el adaptador S3 habla path-style, firma con la región real y antepone el prefijo', { skip: sinAws4fetch }, async () => {
  const doble = await servirS3();
  const store = await almacenS3(doble);
  assert.equal(store.kind, 's3');
  assert.deepEqual(Object.keys(store).filter((clave) => typeof store[clave] === 'function').sort(), ['get', 'head', 'list', 'put'], 'tampoco aquí existe borrar');

  const primera = await putImmutable(store, 'bundles/aa/manifest.json', '{"a":1}');
  assert.equal(primera.written, true);
  const put = doble.registro.find((item) => item.method === 'PUT');
  assert.equal(put.path, '/masfacil-datos/gasolina/bundles/aa/manifest.json', 'bucket en la ruta y prefijo delante de la clave');
  assert.match(put.auth, /^AWS4-HMAC-SHA256 Credential=sonda-key\/\d{8}\/us-east-2\/s3\/aws4_request/, 'SigV4 con la región real, no `auto`');
  assert.ok(doble.registro.some((item) => item.method === 'HEAD' && item.path === put.path), 'HEAD antes de PUT: no hay PUT condicional');
  const guardado = doble.objetos.get('gasolina/bundles/aa/manifest.json');
  assert.equal(guardado.contentType, JSON_CONTENT_TYPE);
  assert.equal(guardado.cacheControl, IMMUTABLE_CACHE_CONTROL);
  assert.equal(guardado.meta, sha256('{"a":1}'), 'la huella viaja como metadato');

  const putsAntes = doble.registro.filter((item) => item.method === 'PUT').length;
  const segunda = await putImmutable(store, 'bundles/aa/manifest.json', '{"a":1}');
  assert.equal(segunda.reused, true);
  assert.equal(doble.registro.filter((item) => item.method === 'PUT').length, putsAntes, 'repetir no vuelve a subir');
  await assert.rejects(() => putImmutable(store, 'bundles/aa/manifest.json', '{"a":2}'), /Objeto inmutable con bytes distintos/);
  assert.equal(doble.objetos.get('gasolina/bundles/aa/manifest.json').body.toString(), '{"a":1}', 'el original sigue intacto');

  const cabecera = await store.head('bundles/aa/manifest.json');
  assert.deepEqual({ bytes: cabecera.bytes, sha256: cabecera.sha256 }, { bytes: 7, sha256: sha256('{"a":1}') });
  assert.equal(await store.head('bundles/no/existe.json'), null, '404 NoSuchKey es «no está», no un error');
  assert.equal(await store.get('bundles/no/existe.json'), null);
  assert.equal((await store.get('bundles/aa/manifest.json')).body, '{"a":1}');

  for (const dia of [1, 2, 3, 4, 5]) await putImmutable(store, `observations/2026-09-0${dia}/obs_${dia}.json`, `{"i":${dia}}`);
  const pagina = await store.list({ prefix: 'observations/', limit: 2 });
  assert.equal(pagina.keys.length, 2);
  assert.ok(pagina.cursor, 'quedan páginas');
  const todas = await listAll(store, 'observations/', { limit: 2 });
  assert.deepEqual(todas.map((item) => item.key), [1, 2, 3, 4, 5].map((dia) => `observations/2026-09-0${dia}/obs_${dia}.json`), 'tres páginas, sin prefijo en las claves');
  const listados = doble.registro.filter((item) => item.query.includes('list-type=2'));
  assert.ok(listados.length >= 3 && listados.every((item) => item.query.includes('prefix=gasolina%2Fobservations%2F')), 'el prefijo va en la consulta');
  assert.ok(doble.registro.every((item) => !item.auth.includes('sonda-secreto')), 'la clave secreta nunca viaja en claro');
});

test('11 · sin eco de metadatos la huella sale del cuerpo, y un 5xx se reintenta acotado', { skip: sinAws4fetch }, async () => {
  const doble = await servirS3({ echoMeta: false });
  const store = await almacenS3(doble);
  await putImmutable(store, 'bundles/bb/manifest.json', '{"b":1}');
  assert.equal((await store.head('bundles/bb/manifest.json')).sha256, null, 'el proveedor no devuelve el metadato');
  assert.equal((await putImmutable(store, 'bundles/bb/manifest.json', '{"b":1}')).reused, true, 'se comparó el hash del cuerpo leído');
  await assert.rejects(() => putImmutable(store, 'bundles/bb/manifest.json', '{"b":2}'), /bytes distintos/);

  const caido = http.createServer((peticion, respuesta) => { respuesta.writeHead(503); respuesta.end(); });
  await new Promise((listo) => caido.listen(0, '127.0.0.1', listo));
  servidores.push(caido);
  const inaccesible = await almacenS3({ endpoint: `http://127.0.0.1:${caido.address().port}` });
  await assert.rejects(() => inaccesible.head('bundles/x.json'), /no respondió tras 3 intentos: HTTP 503/);

  const denegado = await servirS3({ bucket: 'otro' });
  const sinPermiso = await almacenS3(denegado);
  await assert.rejects(() => sinPermiso.get('bundles/x.json'), /HTTP 404 NoSuchBucket/, 'el código S3 llega al error, sin cuerpo ni cabeceras');
});

test('11 · el observador entero contra el doble S3 deja archivo, observación y resumen bajo el prefijo', { skip: sinAws4fetch }, async () => {
  const doble = await servirS3();
  const store = await almacenS3(doble);
  const { origin } = await servirBundle(bundleSimple());
  const salida = await observeHistory({ store, origin, days: 7, deps: { fetchLiveBundle: () => fetchLiveBundle({ origin, testMode: true }), now: () => '2026-09-09T18:00:00.000Z' } });
  assert.equal(salida.ok, true, salida.problems.join('; '));
  assert.equal(salida.observation, 'new');
  assert.equal(salida.archive, 'stored');
  assert.equal(salida.summary_write, 'written');
  const claves = [...doble.objetos.keys()].sort();
  assert.equal(claves.filter((clave) => clave.startsWith('gasolina/bundles/')).length, 4);
  assert.equal(claves.filter((clave) => clave.startsWith('gasolina/observations/2026-09-09/')).length, 1);
  assert.ok(claves.every((clave) => clave.startsWith('gasolina/')), 'nada fuera del prefijo');
  const resumen = doble.objetos.get('gasolina/series/daily-v1.json');
  assert.equal(resumen.cacheControl, SUMMARY_CACHE_CONTROL, 'el resumen nunca es immutable');
  assert.equal(resumen.contentType, JSON_CONTENT_TYPE);
  assert.deepEqual(validateDailySummary(JSON.parse(resumen.body.toString())), []);
  // El cliente pide exactamente la clave que escribe el observador: bucket,
  // prefijo por defecto y nombre del resumen, en ese orden.
  assert.equal(HISTORY_SUMMARY_PATH, `/masfacil-datos/${DEFAULT_PREFIX}${SUMMARY_KEY}`);
  assert.match(HISTORY_ORIGIN, /^https:\/\/[a-z0-9-]+\.storage\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech$/, 'el origen es la URL pública de la rama del bucket');
});

// ── 12 · La ruta del historial y la leyenda ──────────────────────────────────

test('10 · la leyenda lleva el n del último punto con dato, y el resumen se revalida', () => {
  const hoy = '2026-09-09';
  const medias = [undefined, undefined, undefined, undefined, undefined, { regular: { mean: 16, n: 610 }, premium: { mean: 19, n: 580 } }, null];
  const marco = frameWindow(resumen({ generatedAt: `${hoy}T18:00:00.000Z`, days: 7, medias }), { today: hoy, days: 7 });
  assert.deepEqual(lastCounts(marco.points), { regular: 610, premium: 580 }, 'hoy es hueco: manda el último día con dato');
  assert.deepEqual(lastCounts(frameWindow(null, { today: hoy, days: 7 }).points), { regular: null, premium: null });
  const fuente = fs.readFileSync(path.join(root, 'web', 'history-chart.js'), 'utf8');
  assert.match(fuente, /history__n/, 'la leyenda pinta el n');
  assert.match(fuente, /cache: 'no-cache'/, 'el resumen se revalida por ETag en cada carga');
  assert.match(fuente, /publica los martes/, '«Cómo se calcula» explica la cadencia semanal');
});

test('12 · /gasolina/historial es la portada con el gráfico: en _redirects, en local y sin red', async () => {
  const reglas = fs.readFileSync(path.join(root, 'web', '_redirects'), 'utf8').split('\n').filter((linea) => linea && !linea.startsWith('#'));
  assert.deepEqual(reglas.slice(0, 2), ['/gasolina/historial / 200', '/gasolina/historial/ / 200'], 'las reescrituras van antes de los 301, con destino / y no /index.html');
  assert.ok(reglas.slice(2).every((linea) => / 301$/.test(linea)), 'y las rutas viejas siguen siendo 301');

  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const boton = /<button id="menu-history"[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? '';
  assert.ok(boton, 'el menú «Ver historial» existe');
  assert.doesNotMatch(boton, /disabled|chip-soon|próximo/, 'ya no está deshabilitado ni dice «próximo»');
  assert.match(html, /<h2 id="history-title" tabindex="-1">/, 'el título recibe el foco');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'web', 'styles.css'), 'utf8'), /chip-soon/, 'sin CSS muerto');

  const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
  assert.match(app, /history\.pushState\(null, '', '\/gasolina\/historial'\)/);
  assert.match(app, /addEventListener\('popstate'/);
  assert.match(app, /\$\('menu-history'\)\.addEventListener\('click'/);
  assert.match(app, /HISTORY_ROUTE\.test\(location\.pathname\)\) history\.replaceState\(null, '', '\/'\)/, 'salir de la portada devuelve la URL a /');
  const sw = fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8');
  assert.ok(sw.includes("event.request.mode === 'navigate'") && sw.includes('gasolina\\/historial'), 'sin red, la ruta sirve la / precacheada');
  assert.ok(!deriveShell({ root }).entries.includes('/gasolina/historial'), 'sin entrada extra en la precache');

  // Y el servidor local reproduce lo que hará Cloudflare.
  const puerto = 43000 + Math.floor(Math.random() * 1000);
  const hijo = spawn(process.execPath, [path.join(root, 'scripts', 'serve-web.mjs')], { env: { ...process.env, PORT: String(puerto) }, stdio: ['ignore', 'pipe', 'pipe'] });
  procesos.push(hijo);
  await new Promise((listo, falla) => {
    hijo.stdout.on('data', (trozo) => { if (String(trozo).includes('masfacil.pe local en')) listo(); });
    hijo.on('exit', (codigo) => falla(new Error(`serve-web terminó con ${codigo}`)));
  });
  const historial = await fetch(`http://127.0.0.1:${puerto}/gasolina/historial`, { redirect: 'manual' });
  assert.equal(historial.status, 200);
  assert.match(historial.headers.get('content-type'), /text\/html/);
  assert.ok((await historial.text()).includes('id="history-chart"'), 'sirve la portada sin cambiar la URL');
  const conBarra = await fetch(`http://127.0.0.1:${puerto}/gasolina/historial/`, { redirect: 'manual' });
  assert.equal(conBarra.status, 200);
  const viejo = await fetch(`http://127.0.0.1:${puerto}/gasolina/regular`, { redirect: 'manual' });
  assert.equal(viejo.status, 301);
  assert.equal(viejo.headers.get('location'), '/');
});
