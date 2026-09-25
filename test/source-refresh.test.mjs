// Cada fuente se refresca por su cuenta: su línea base, su descarga, sus grupos
// y sus pointers. GLP se adquiere y se juzga en privado sin leer ni mover nada
// de los líquidos, y el fallo de una fuente no detiene a la otra.
//
// Corre el refresco de verdad contra un origen local: sondeo, descarga,
// minimizado, selección y promoción, con archivos de unos pocos cientos de bytes.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { adoptSnapshot, rollbackSnapshot } from '../app/snapshot-refresh.mjs';
import { GIS_FIELDS, REGISTRY_FIELDS, csvLine } from '../pipeline/csv.mjs';
import { groupsOfSource } from '../pipeline/groups.mjs';
import { composeGroups, firstActivationBase } from '../pipeline/project-gasolina.mjs';
import { assertReferenceCovers, refreshSnapshot } from '../pipeline/refresh-snapshot.mjs';

const CABECERA_GLP = ['ID4', 'ACTIVIDAD', 'REGISTRO DE HIDROCARBUROS', 'RUC', 'RAZÓN SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCIÓN', 'FECHA DE REGISTRO', 'PRODUCTO', 'TIPO DE CLIENTE', 'MARCA', 'PRECIO DE VENTA (SOLES)', 'UNIDAD'];
// Horas de Lima relativas a ahora: la prueba no puede vencerse con el calendario.
const haceHoras = (horas) => new Date(Date.now() - horas * 3_600_000 - 5 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
const GLP = Buffer.from([CABECERA_GLP,
  ['1', 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP', 'R-A', 'RUC-FICTICIO-1', 'RAZON UNO', 'LIMA', 'LIMA', 'MIRAFLORES', 'AV. UNO 1', haceHoras(30), 'GLP - G', 'Usuario Final', '', '7.29', 'Galones'],
  ['2', 'EE.SS con GLP y GNV', 'R-B', 'RUC-FICTICIO-2', 'RAZON DOS', 'LIMA', 'LIMA', 'MIRAFLORES', 'AV. DOS 2', haceHoras(28), 'GLP - G', 'Usuario Final', '', '7.39', 'Galones'],
  ['3', 'GASOCENTROS DE GLP', 'R-C', 'RUC-FICTICIO-3', 'RAZON TRES', 'LIMA', 'LIMA', 'MIRAFLORES', 'AV. TRES 3', haceHoras(26), 'GLP - G', 'Usuario Final', '', '7.49', 'Galones'],
  ['4', 'PLANTAS ENVASADORAS GLP', 'R-H', 'RUC-FICTICIO-4', 'RAZON CUATRO', 'LIMA', 'LIMA', 'MIRAFLORES', 'AV. CUATRO 4', haceHoras(26), 'Cilindros de 10 Kg de GLP', 'Agentes con RHO', 'MARCA-SECRETA', '40', 'Kilogramos'],
].map(csvLine).join(''));
const LIQUIDOS = Buffer.from('no debería pedirse\n');
const ULTIMA_MODIFICACION = new Date(Date.now() - 3_600_000).toUTCString();

/** Un origen local con ETag y Last-Modified, rangos y 304: lo que el sondeo necesita. */
async function origen() {
  const archivos = { '/glp.csv': { body: GLP, etag: '"glp-1"' }, '/liquidos.csv': { body: LIQUIDOS, etag: '"liq-1"' } };
  const pedidos = [];
  const server = http.createServer((req, res) => {
    const archivo = archivos[req.url];
    pedidos.push(`${req.method} ${req.url}${req.headers.range ? ' rango' : ''}`);
    if (!archivo) { res.writeHead(404); res.end(); return; }
    const cabeceras = { etag: archivo.etag, 'last-modified': ULTIMA_MODIFICACION, 'accept-ranges': 'bytes' };
    if (req.headers['if-none-match'] === archivo.etag) { res.writeHead(304, cabeceras); res.end(); return; }
    if (req.method === 'HEAD') { res.writeHead(200, { ...cabeceras, 'content-length': archivo.body.length }); res.end(); return; }
    if (req.headers.range === 'bytes=0-0') { res.writeHead(206, { ...cabeceras, 'content-length': 1, 'content-range': `bytes 0-0/${archivo.body.length}` }); res.end(archivo.body.subarray(0, 1)); return; }
    res.writeHead(200, { ...cabeceras, 'content-length': archivo.body.length });
    res.end(archivo.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = (ruta) => `http://127.0.0.1:${server.address().port}${ruta}`;
  return { url, pedidos, descargas: (ruta) => pedidos.filter((pedido) => pedido === `GET ${ruta}`).length, cerrar: () => new Promise((resolve) => server.close(resolve)) };
}

/** Registro y GIS sanitizados; sin gasocentros es la semilla v1. */
function referencia({ gasocentros = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-ref-'));
  const registro = (codigo, numero) => [codigo, numero, '', '', 'LIMA', 'LIMA', 'MIRAFLORES', ''];
  const punto = (capa, numero, dLat) => [capa, '', numero, '', '', 'LIMA', 'LIMA', 'MIRAFLORES', '-77.03', String(-12.12 + dLat)];
  const registros = [registro('01', 'R-L'), registro('02', 'R-A'), registro('05', 'R-5'), registro('06', 'R-B'), ...(gasocentros ? [registro('15', 'R-C')] : [])];
  const puntos = [punto('35', 'R-L', 0), punto('35', 'R-A', 0.01), punto('35', 'R-B', 0.02), ...(gasocentros ? [punto('36', 'R-C', 0.03)] : [])];
  for (const [relativo, campos, filas] of [['registry/authorizations.csv.gz', REGISTRY_FIELDS, registros], ['gis/features.csv.gz', GIS_FIELDS, puntos]]) {
    fs.mkdirSync(path.dirname(path.join(dir, relativo)), { recursive: true });
    fs.writeFileSync(path.join(dir, relativo), gzipSync([campos, ...filas].map(csvLine).join('')));
  }
  return dir;
}

// Los pointers de los líquidos son una trampa: si el refresco de GLP los leyera,
// fallaría al validarlos; si los tocara, cambiarían sus bytes.
const TRAMPA = '{"no": "es un pointer: GLP no puede leerlo"}\n';
function raiz() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-raiz-'));
  fs.mkdirSync(path.join(dir, '.local-cache', 'snapshots'), { recursive: true });
  for (const archivo of ['active.json', 'active-diesel.json']) fs.writeFileSync(path.join(dir, '.local-cache', 'snapshots', archivo), TRAMPA);
  return dir;
}
const snapshots = (dir) => path.join(dir, '.local-cache', 'snapshots');
const leer = (archivo) => JSON.parse(fs.readFileSync(archivo, 'utf8'));
const pointerDe = (snapshotId, fuente, extra = {}) => ({ schema_version: 1, source_id: fuente, snapshot_id: snapshotId, snapshot_date: snapshotId.slice(0, 10), temporal_context: { cutoff_at: '2026-09-24T12:00:00.000Z', source_max_reported_at: '2026-09-24T04:00:00.000Z', snapshot_date: snapshotId.slice(0, 10) }, validators: { etag: '"x"', last_modified: null }, ...extra });

test('GLP sin base adquiere y, sin pasar su base auditada, no mueve ningún pointer', async () => {
  const servidor = await origen();
  try {
    const dir = raiz();
    const r = await refreshSnapshot({ root: dir, testSourceUrl: { 'glp-current': servidor.url('/glp.csv') }, referenceMinimizedRoot: referencia() });
    assert.deepEqual(Object.keys(r.sources), ['glp-current']);
    const glp = r.sources['glp-current'];
    assert.deepEqual([glp.status, glp.detection.baseline, glp.promoted], ['needs_review', 'sin_base', false]);
    assert.deepEqual(glp.groups.glp.products, { glp: { offers: 3, districts: 1 } });
    assert.equal(glp.groups.glp.private, true);
    assert.match(glp.groups.glp.reasons.join(' '), /base auditada/);
    assert.equal(servidor.descargas('/glp.csv'), 1);
    assert.deepEqual(servidor.pedidos.filter((pedido) => pedido.includes('liquidos')), [], 'los líquidos no se consultan');
    for (const archivo of ['active-glp.json', 'source-glp-current.json']) assert.equal(fs.existsSync(path.join(snapshots(dir), archivo)), false);
    for (const archivo of ['active.json', 'active-diesel.json']) assert.equal(fs.readFileSync(path.join(snapshots(dir), archivo), 'utf8'), TRAMPA);
    // Lo que queda del juicio son conteos: nada del original llega a la validación.
    const validacion = fs.readFileSync(path.join(dir, glp.staging_path, 'glp-validation.json'), 'utf8');
    for (const privado of ['RAZON', 'AV. ', 'RUC-FICTICIO', 'MARCA-SECRETA']) assert.equal(validacion.includes(privado), false);
  } finally { await servidor.cerrar(); }
});

test('con una semilla sin gasocentros, GLP se rechaza antes de descargar', async () => {
  const servidor = await origen();
  try {
    const r = await refreshSnapshot({ root: raiz(), testSourceUrl: { 'glp-current': servidor.url('/glp.csv') }, referenceMinimizedRoot: referencia({ gasocentros: false }) });
    assert.equal(r.sources['glp-current'].status, 'rejected');
    assert.match(r.sources['glp-current'].error, /no cubre la fuente: glp: Registro 15; glp: capa GIS 36/);
    assert.equal(servidor.descargas('/glp.csv'), 0);
  } finally { await servidor.cerrar(); }
  // La misma referencia sí cubre los líquidos.
  await assertReferenceCovers(referencia({ gasocentros: false }), groupsOfSource('liquid-current'));
});

test('una fuente caída no detiene a la otra', async () => {
  const servidor = await origen();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-raiz-'));
    const r = await refreshSnapshot({ root: dir, testSourceUrl: { 'liquid-current': servidor.url('/liquidos.csv'), 'glp-current': servidor.url('/glp.csv') }, referenceMinimizedRoot: referencia() });
    // Sin línea base de Gasolina los líquidos se rechazan sin consultar el origen...
    assert.equal(r.status, 'rejected', 'los campos de siempre siguen hablando de los líquidos');
    assert.match(r.sources['liquid-current'].error, /No hay pointer activo/);
    assert.deepEqual(servidor.pedidos.filter((pedido) => pedido.includes('liquidos')), []);
    // ...y GLP se refresca igual.
    assert.equal(r.sources['glp-current'].status, 'needs_review');
    assert.equal(servidor.descargas('/glp.csv'), 1);
  } finally { await servidor.cerrar(); }
});

test('con base propia, GLP promueve en privado: mueve solo sus pointers y la corrida siguiente sale sin cambios', async () => {
  const servidor = await origen();
  try {
    const dir = raiz();
    const ref = referencia();
    const url = { 'glp-current': servidor.url('/glp.csv') };
    const primera = (await refreshSnapshot({ root: dir, testSourceUrl: url, referenceMinimizedRoot: ref })).sources['glp-current'];
    // La base: una validación anterior con las mismas cifras y una fuente un día más vieja.
    const juicio = leer(path.join(dir, primera.staging_path, 'glp-validation.json'));
    const anterior = new Date(Date.parse(juicio.refresh_state.source_max_reported_at) - 86_400_000).toISOString();
    const base = '2026-01-01-base';
    fs.mkdirSync(path.join(snapshots(dir), base), { recursive: true });
    fs.writeFileSync(path.join(snapshots(dir), base, 'glp-validation.json'), JSON.stringify({ ...juicio, snapshot_id: base, refresh_state: { ...juicio.refresh_state, source_max_reported_at: anterior } }));
    fs.writeFileSync(path.join(snapshots(dir), 'active-glp.json'), JSON.stringify(pointerDe(base, 'glp-current', { validators: { etag: '"glp-0"', last_modified: null } })));

    const segunda = (await refreshSnapshot({ root: dir, testSourceUrl: url, referenceMinimizedRoot: ref })).sources['glp-current'];
    assert.deepEqual([segunda.status, segunda.promoted, segunda.public_projection_validated], ['promoted', true, false]);
    assert.deepEqual(segunda.promoted_groups, ['glp']);
    const nuevo = segunda.active_after.snapshot_id;
    assert.equal(leer(path.join(snapshots(dir), 'active-glp.json')).snapshot_id, nuevo);
    assert.equal(leer(path.join(snapshots(dir), 'source-glp-current.json')).snapshot_id, nuevo);
    assert.equal(leer(path.join(snapshots(dir), nuevo, 'snapshot-manifest.json')).source_id, 'glp-current');
    for (const archivo of ['active.json', 'active-diesel.json']) assert.equal(fs.readFileSync(path.join(snapshots(dir), archivo), 'utf8'), TRAMPA);
    assert.equal(fs.existsSync(path.join(snapshots(dir), 'source-liquid-current.json')), false);

    const tercera = (await refreshSnapshot({ root: dir, testSourceUrl: url, referenceMinimizedRoot: ref })).sources['glp-current'];
    assert.deepEqual([tercera.status, tercera.active_snapshot], ['unchanged', nuevo]);
    assert.equal(servidor.descargas('/glp.csv'), 2, 'sin cambios no se descarga');
  } finally { await servidor.cerrar(); }
});

test('rollback, adopción, composición y primera activación nunca cruzan fuentes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-raiz-'));
  const snapshot = (id, fuente) => {
    fs.mkdirSync(path.join(snapshots(dir), id, 'minimized'), { recursive: true });
    fs.writeFileSync(path.join(snapshots(dir), id, 'snapshot-manifest.json'), JSON.stringify(pointerDe(id, fuente)));
    return pointerDe(id, fuente);
  };
  const glp = snapshot('2026-09-24-glp', 'glp-current');
  const liquidos = snapshot('2026-09-24-liq', 'liquid-current');
  fs.writeFileSync(path.join(snapshots(dir), 'active.json'), JSON.stringify(liquidos));

  assert.throws(() => rollbackSnapshot(dir, glp.snapshot_id, fs, () => {}, { group: 'gasolina', sourceId: 'liquid-current' }), /es de glp-current, no de liquid-current/);
  assert.throws(() => adoptSnapshot(dir, glp.snapshot_id, { group: 'diesel', sourceId: 'liquid-current' }), /es de glp-current/);
  assert.throws(() => adoptSnapshot(dir, liquidos.snapshot_id, { group: 'glp', sourceId: 'glp-current' }), /es de liquid-current/);
  assert.equal(leer(path.join(snapshots(dir), 'active.json')).snapshot_id, liquidos.snapshot_id);
  assert.equal(fs.existsSync(path.join(snapshots(dir), 'active-diesel.json')), false);

  const compuestas = await composeGroups({ root: dir, plan: [{ pointer: glp, groups: ['gasolina', 'diesel'] }], facilitoState: null, bootstrapSeed: null, isolate: true });
  assert.match(compuestas.gasolina.error, /es de glp-current, no de la fuente de gasolina, diesel/);
  assert.match(compuestas.diesel.error, /es de glp-current/);

  // GLP sin snapshot aprobado de su fuente no hereda el de los líquidos.
  const sinBase = firstActivationBase(dir, 'glp');
  assert.deepEqual([sinBase.ok, sinBase.snapshot_id], [false, null]);
  // Ni aunque su pointer de fuente apunte, mal, a uno de líquidos.
  fs.writeFileSync(path.join(snapshots(dir), 'source-glp-current.json'), JSON.stringify(liquidos));
  const cruzada = firstActivationBase(dir, 'glp');
  assert.equal(cruzada.ok, false);
  assert.match(cruzada.missing.join(' '), /es de liquid-current, no de glp-current/);
});
