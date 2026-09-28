// GNV como grupo publicado: sale de los líquidos pero con sus propias
// actividades, su contrato no acepta nada de otro grupo, solo publica el
// comprimido en metros cúbicos, su primera versión se compone sobre el snapshot
// de Gasolina y se juzga contra su base auditada, y un fallo suyo no arrastra a
// los demás grupos, ni al revés, salvo en su primera activación.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GROUP_RULES } from '../web/lib/bundle-contract.js';
import { GROUP_CONTRACTS } from '../web/group-contracts.js';
import { MINIMIZED_FIELDS, csvLine } from '../pipeline/csv.mjs';
import { buildSourceProducts } from '../pipeline/gasolina-products.mjs';
import { GROUP_CONFIG, groupByKey, productGroup } from '../pipeline/groups.mjs';
import { buildGroupCandidate } from '../pipeline/project-gasolina.mjs';
import { compareGroupQuality } from '../pipeline/refresh-state.mjs';
import { prepareRelease } from '../pipeline/prepare-release.mjs';
import { sourceById } from '../pipeline/sources.mjs';
import { bundleDiesel, bundleGlp, bundleGnv } from './fixtures/gasolina-bundle.mjs';

const gnv = groupByKey('gnv');
const glp = groupByKey('glp');
const diesel = groupByKey('diesel');
const gasolina = groupByKey('gasolina');
const erroresGnv = (b) => [...gnv.validate.manifest(b.manifest), ...gnv.validate.refreshState(b.state, b.manifest), ...gnv.validate.bundle(b.manifest, 'gnv', b.bodies.gnv)];

test('un bundle de GNV válido pasa en Node y en el navegador', async () => {
  const b = bundleGnv();
  assert.deepEqual(erroresGnv(b), []);
  assert.equal(GROUP_CONTRACTS.gnv.validManifest(b.manifest), true);
  assert.equal(await GROUP_CONTRACTS.gnv.validBundle(b.manifest, 'gnv', b.bodies.gnv), true);
});

test('el contrato de GNV rechaza lo que no es suyo, y en especial otra unidad', async () => {
  const oferta = JSON.parse(bundleGnv().bodies.gnv).offers[0];
  const producto = (cambio) => ({ dataset: { product: { key: 'gnv', canonical: 'GAS NATURAL VEHICULAR COMPRIMIDO', label: 'GNV comprimido', display_unit: 'Metros Cúbicos', ...cambio } } });
  const casos = {
    'IDs de GLP': bundleGnv({ cambios: { dataset: { offers: [{ ...oferta, id: `glp1_${'a'.repeat(24)}` }] } } }),
    'URL de GLP': bundleGnv({ cambios: { descriptor: { dataset_url: 'data/glp/snapshots/x/gnv.json' } } }),
    licuefactado: bundleGnv({ cambios: producto({ canonical: 'GAS NATURAL VEHICULAR LICUEFACTADO' }) }),
    'por galón': bundleGnv({ cambios: producto({ display_unit: 'Galones' }) }),
    'por kilo': bundleGnv({ cambios: producto({ display_unit: 'Kilogramos' }) }),
    'versión de Gasolina': bundleGnv({ cambios: { manifest: { schema_version: '2.7.0' } } }),
    'revisión de GLP': bundleGnv({ revision: 'glp-2026-09-06-prueba-000000000000' }),
  };
  for (const [caso, b] of Object.entries(casos)) {
    assert.ok(erroresGnv(b).length > 0, caso);
    const cliente = GROUP_CONTRACTS.gnv.validManifest(b.manifest) && await GROUP_CONTRACTS.gnv.validBundle(b.manifest, 'gnv', b.bodies.gnv);
    assert.equal(cliente, false, `el navegador también rechaza: ${caso}`);
  }
});

test('un bundle de un grupo no pasa por el contrato de otro', () => {
  const [d, l, v] = [bundleDiesel(), bundleGlp(), bundleGnv()];
  assert.ok(gnv.validate.manifest(d.manifest).length > 0);
  assert.ok(gnv.validate.manifest(l.manifest).length > 0);
  assert.ok(glp.validate.manifest(v.manifest).length > 0);
  assert.ok(diesel.validate.manifest(v.manifest).length > 0);
  assert.ok(GROUP_RULES.glp.datasetErrors(JSON.parse(v.bodies.gnv)).length > 0);
  assert.ok(GROUP_RULES.gnv.datasetErrors(JSON.parse(l.bodies.glp)).length > 0);
});

// --- De las filas del CSV de líquidos al bundle, sin red ----------------------

const CABECERA_LIQUIDOS = ['ID3', 'ACTIVIDAD', 'REGISTRO DE HIDROCARBUROS', 'RUC', 'RAZÓN SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCIÓN', 'FECHA DE REGISTRO', 'PRODUCTO', 'PRECIO DE VENTA (SOLES)', 'UNIDAD'];
const CAMPOS_ORIGINAL = ['ID3', 'ACTIVIDAD', 'REGISTRO_DE_HIDROCARBUROS', 'RUC', 'RAZON_SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCION', 'FECHA_DE_REGISTRO', 'PRODUCTO', 'PRECIO_DE_VENTA_SOLES', 'UNIDAD'];
const AHORA = '2026-09-24T12:00:00.000Z';
const COMPRIMIDO = 'GAS NATURAL VEHICULAR COMPRIMIDO';
const cruda = ({ id, actividad, registro, producto = COMPRIMIDO, precio = '1.77', unidad = 'Metros Cúbicos' }) => [id, actividad, registro, `RUC-FICTICIO-${id}`, `RAZON ${id}`, 'LIMA', 'LIMA', 'MIRAFLORES', `AV. ${id} 123`, '2026-09-23 10:00:00', producto, precio, unidad];
const minimizada = (fila) => Object.fromEntries(MINIMIZED_FIELDS.map((campo) => [campo, fila[CAMPOS_ORIGINAL.indexOf(campo)]]));
const registro = (codigo, numero) => ({ SOURCE_ACTIVITY: codigo, REGISTRO: numero, CODIGO_OSINERGMIN: '', CODIGO: '', DEPARTAMENTO: 'LIMA', PROVINCIA: 'LIMA', DISTRITO: 'MIRAFLORES', ACTIVIDAD: '' });
const punto = (capa, numero, dLat) => ({ LAYER: capa, OBJECTID: '', N: numero, COD_OSINERGMIN: '', CODIGO_DGH: '', DEPARTAMENTO: 'LIMA', PROVINCIA: 'LIMA', DISTRITO: 'MIRAFLORES', LONGITUDE: '-77.03', LATITUDE: String(-12.12 + dLat) });

test('solo se publica el comprimido en metros cúbicos; el licuefactado, los galones y la estación de carga quedan fuera', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-gnv-'));
  const filas = [
    cruda({ id: '1', actividad: 'EE.SS con GLP y GNV', registro: 'R-A', precio: '1.69' }),
    // El mismo establecimiento vende licuefactado por kilo: es otro registro.
    cruda({ id: '2', actividad: 'EE.SS con GLP y GNV', registro: 'R-A', producto: 'GAS NATURAL VEHICULAR LICUEFACTADO', precio: '1.66', unidad: 'Kilogramos' }),
    cruda({ id: '3', actividad: 'EE.SS con GNV', registro: 'R-5', precio: '1.79' }),
    // El comprimido en galones es una anomalía de unidad: se cuenta y se descarta.
    cruda({ id: '4', actividad: 'EE.SS con GNV', registro: 'R-5', precio: '6.10', unidad: 'Galones' }),
    // Un local de venta al público (59) vive en la capa 36.
    cruda({ id: '5', actividad: 'ESTABLECIMIENTO DE VENTA AL PUBLICO DE GNV', registro: 'R-G', precio: '1.73' }),
    // La estación de carga no vende al público.
    cruda({ id: '6', actividad: 'ESTACIÓN DE CARGA DE GNC', registro: 'R-X', precio: '1.50', unidad: 'Galones' }),
  ];
  const original = path.join(dir, 'liquidos.csv');
  fs.writeFileSync(original, [CABECERA_LIQUIDOS, ...filas].map(csvLine).join(''));
  const tablas = { prices: filas.map(minimizada), registry: [registro('06', 'R-A'), registro('05', 'R-5'), registro('59', 'R-G')], gis: [punto('35', 'R-A', 0), punto('35', 'R-5', 0.01), punto('36', 'R-G', 0.02), punto('35', 'R-G', 0.03)] };
  const { resultsByGroup } = await buildSourceProducts({ source: sourceById('liquid-current'), sources: tablas, rawPath: original, cutoffAt: AHORA, snapshotId: '2026-09-24-liquidos', sourceMaxReportedAt: '2026-09-23T16:00:00.000Z', sourceUrl: 'https://example.test/liquidos.csv', groups: [productGroup(gnv)] });
  assert.deepEqual(resultsByGroup.gnv.gnv.rowExclusions, { otra_unidad: 1 });
  const pointer = { snapshot_id: '2026-09-24-liquidos', snapshot_date: '2026-09-24', source_url: 'https://example.test/liquidos.csv', validators: { etag: '"liq-1"', last_modified: null }, promoted_at: AHORA };
  const c = buildGroupCandidate({ group: gnv, pointer, temporalContext: { cutoff_at: AHORA, source_max_reported_at: '2026-09-23T16:00:00.000Z' }, results: resultsByGroup.gnv, now: Date.parse(AHORA) });
  assert.deepEqual(c.datasets.gnv.offers.map((oferta) => oferta.price).sort(), [1.69, 1.73, 1.79]);
  assert.equal(c.datasets.gnv.product.display_unit, 'Metros Cúbicos');
  assert.ok(c.datasets.gnv.offers.every((oferta) => oferta.id.startsWith('gnv1_')));
  assert.deepEqual(erroresGnv({ manifest: c.manifest, state: c.refreshState, bodies: c.bodies }), []);
  assert.match(c.manifest.revision_id, /^gnv-2026-09-24-liquidos-/);
  // El local 59 se ubica en la capa 36: su N en la 35 no cuenta.
  assert.equal(c.datasets.gnv.offers.find((oferta) => oferta.price === 1.73).latitude, -12.1);
  for (const privado of ['RUC-FICTICIO', 'RAZON ', 'LICUEFACTADO']) assert.equal(c.bodies.gnv.includes(privado), false, privado);
});

// --- La primera activación y el aislamiento, sin red ------------------------

const auditada = GROUP_CONFIG.gnv.guardrails.firstActivation.audited;
const producto = (fresh, ready, coverage, publicadas, distritos) => ({ fresh_0_30_days: { offers: fresh, districts: distritos }, contract_ready: { offers: ready, districts: distritos }, coverage_percent: coverage, published: { offers: publicadas, districts: distritos }, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 } });
const productosAuditados = () => { const p = auditada.products.gnv; return { gnv: producto(p.fresh_0_30_days.offers, p.contract_ready.offers, p.coverage_percent, p.published.offers, p.published.districts) }; };

test('la primera versión de GNV se juzga contra su base auditada', () => {
  const fuente = auditada.source_max_reported_at;
  const ok = compareGroupQuality({ group: 'gnv', candidateProducts: productosAuditados(), candidateSourceMaxReportedAt: fuente });
  assert.deepEqual([ok.status, ok.first_activation], ['ready', true]);
  assert.match(compareGroupQuality({ group: 'gnv', candidateProducts: { gnv: producto(238, 212, 89, 244, 33) }, candidateSourceMaxReportedAt: fuente }).reasons.join(), /pierde más de 2 distritos/);
  assert.match(compareGroupQuality({ group: 'gnv', candidateProducts: { gnv: producto(150, 140, 89, 150, 36) }, candidateSourceMaxReportedAt: fuente }).reasons.join(), /caída de ofertas frescas superior a 20%/);
  assert.match(compareGroupQuality({ group: 'gnv', candidateProducts: productosAuditados(), candidateSourceMaxReportedAt: '2026-09-01T00:00:00Z' }).reasons.join(), /anterior a la base auditada/);
});

const candidata = (grupo, revision, extra = {}) => ({ group: grupo, manifest: { revision_id: revision }, datasets: {}, refreshState: { snapshot_id: 'S1', source_max_reported_at: auditada.source_max_reported_at, products: {} }, identity: null, ...extra });
const gnvAuditada = () => candidata('gnv', 'gnv-primera', { refreshState: { snapshot_id: 'S1', source_max_reported_at: auditada.source_max_reported_at, products: productosAuditados() } });
const puntero = (id, fuente) => ({ ok: true, snapshot_id: id, missing: [], pointer: { snapshot_id: id, source_id: fuente } });

function deps({ publicados = { gasolina: { snapshot_id: 'S1' }, diesel: { snapshot_id: 'S1' }, glp: { snapshot_id: 'G1' } }, propios = { gasolina: puntero('S1', 'liquid-current'), diesel: puntero('S1', 'liquid-current'), glp: puntero('G1', 'glp-current') }, compuestas = {}, escritas = [], adoptados = [], planes = [] } = {}) {
  return {
    groups: [gasolina, diesel, glp, gnv],
    estadoPublicado: (root, grupo) => publicados[grupo.key] ?? null,
    refreshSnapshot: async () => ({ status: 'unchanged' }),
    readFacilitoState: () => ({ units: { '150101:regular': {}, '150101:diesel': {}, '150101:glp': {}, '150101:gnv': {} } }),
    usablePrivateSnapshot: (root, { group }) => propios[group] ?? { ok: false, snapshot_id: null, missing: [`pointer activo ausente (active-${group}.json)`] },
    firstActivationBase: (root, key) => (key === 'glp' ? { ok: false, snapshot_id: null, missing: ['sin fuente'] } : propios.gasolina),
    composeGroups: async ({ plan }) => { planes.push(...plan); return Object.fromEntries(plan.flatMap((entrada) => entrada.groups).map((key) => [key, compuestas[key] ?? candidata(key, `${key}-nueva`)])); },
    writeGroupProjection: (c) => { escritas.push(c.manifest.revision_id); return c; },
    adoptSnapshot: (root, snapshotId, { group, sourceId }) => adoptados.push(`${group}:${snapshotId}:${sourceId}`),
    publicadosDesdeDisco: () => null,
    buildUi: async () => ({}),
    writeShellManifest: () => {},
    verifyWeb: async () => ({ errors: [] }),
  };
}

test('la primera activación de GNV se compone con los líquidos sobre el snapshot de Gasolina, se juzga y lo adopta', async () => {
  const escritas = [];
  const adoptados = [];
  const planes = [];
  const r = await prepareRelease({ route: 'project', deps: deps({ compuestas: { gnv: gnvAuditada() }, escritas, adoptados, planes }) });
  assert.deepEqual([r.ok, r.decision.deploy], [true, true]);
  assert.ok(escritas.includes('gnv-primera'));
  assert.deepEqual(adoptados, ['gnv:S1:liquid-current']);
  const plan = planes.find((entrada) => entrada.groups.includes('gnv'));
  assert.deepEqual([plan.pointer.snapshot_id, plan.pointer.source_id, plan.groups.includes('gasolina')], ['S1', 'liquid-current', true], 'una sola pasada por el original de los líquidos');
  assert.equal(r.informe.groups.gnv.first_activation, true);
  assert.equal(r.production.gnv, null);
});

test('una primera activación de GNV que no cumple su base detiene toda la entrega', async () => {
  const adoptados = [];
  const floja = candidata('gnv', 'gnv-floja', { refreshState: { snapshot_id: 'S1', source_max_reported_at: auditada.source_max_reported_at, products: { gnv: producto(238, 212, 89, 244, 33) } } });
  const r = await prepareRelease({ route: 'project', deps: deps({ compuestas: { gnv: floja }, adoptados }) });
  assert.deepEqual([r.ok, r.decision.action, r.decision.deploy], [false, 'fail_closed', false]);
  assert.match(r.decision.reason, /primera activación de gnv rechazada: gnv: pierde más de 2 distritos/);
  assert.deepEqual(adoptados, []);
});

const publicadosCuatro = { gasolina: { snapshot_id: 'S1' }, diesel: { snapshot_id: 'S1' }, glp: { snapshot_id: 'G1' }, gnv: { snapshot_id: 'S1' } };
const propiosCuatro = { gasolina: puntero('S1', 'liquid-current'), diesel: puntero('S1', 'liquid-current'), glp: puntero('G1', 'glp-current'), gnv: puntero('S1', 'liquid-current') };

test('ya publicado, un fallo de GNV no impide publicar los demás, y al revés', async () => {
  const escritas = [];
  const r = await prepareRelease({ route: 'data', deps: deps({ publicados: publicadosCuatro, propios: propiosCuatro, compuestas: { gnv: { error: 'contrato gnv inválido' } }, escritas }) });
  assert.deepEqual([r.ok, r.decision.deploy], [true, true]);
  assert.deepEqual(escritas.sort(), ['diesel-nueva', 'gasolina-nueva', 'glp-nueva']);
  assert.match(r.decision.reason, /gnv conserva su versión publicada: contrato gnv inválido/);
  const otras = [];
  const inversa = await prepareRelease({ route: 'data', deps: deps({ publicados: publicadosCuatro, propios: propiosCuatro, compuestas: { gasolina: { error: 'x' }, diesel: { error: 'y' }, glp: { error: 'z' } }, escritas: otras }) });
  assert.deepEqual([inversa.ok, inversa.decision.deploy, otras], [true, true, ['gnv-nueva']]);
});
