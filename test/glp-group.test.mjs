// GLP como grupo publicado: su contrato no acepta nada de Gasolina ni de Diésel,
// solo publica `GLP - G` en galones, su primera versión se juzga siempre contra
// la base auditada —también sobre su pointer propio— y nunca se compone sobre
// un snapshot de los líquidos. Un fallo de GLP no arrastra a los demás grupos,
// ni al revés, salvo en su primera activación.
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
import { selectOfferPrice } from '../web/lib/price-source.js';
import { GLP_MINIMIZED_FIELDS, csvLine } from '../pipeline/csv.mjs';
import { applyFacilitoRun, facilitoStateForProducts } from '../pipeline/facilito/state.mjs';
import { facilitoLinkKey } from '../pipeline/facilito/link.mjs';
import { buildSourceProducts } from '../pipeline/gasolina-products.mjs';
import { GROUP_CONFIG, groupByKey, productGroup } from '../pipeline/groups.mjs';
import { buildGroupCandidate } from '../pipeline/project-gasolina.mjs';
import { compareGroupQuality } from '../pipeline/refresh-state.mjs';
import { prepareRelease } from '../pipeline/prepare-release.mjs';
import { sourceById } from '../pipeline/sources.mjs';
import { bundleDiesel, bundleGasolina, bundleGlp } from './fixtures/gasolina-bundle.mjs';

const glp = groupByKey('glp');
const diesel = groupByKey('diesel');
const gasolina = groupByKey('gasolina');
const erroresGlp = (b) => [...glp.validate.manifest(b.manifest), ...glp.validate.refreshState(b.state, b.manifest), ...glp.validate.bundle(b.manifest, 'glp', b.bodies.glp)];

test('un bundle de GLP válido pasa en Node y en el navegador', async () => {
  const b = bundleGlp();
  assert.deepEqual(erroresGlp(b), []);
  assert.equal(GROUP_CONTRACTS.glp.validManifest(b.manifest), true);
  assert.equal(await GROUP_CONTRACTS.glp.validBundle(b.manifest, 'glp', b.bodies.glp), true);
});

test('el contrato de GLP rechaza lo que no es suyo', async () => {
  const oferta = JSON.parse(bundleGlp().bodies.glp).offers[0];
  const casos = {
    'IDs de Diésel': bundleGlp({ cambios: { dataset: { offers: [{ ...oferta, id: `d1_${'a'.repeat(24)}` }] } } }),
    'URL de Diésel': bundleGlp({ cambios: { descriptor: { dataset_url: 'data/diesel/snapshots/x/glp.json' } } }),
    'el nombre de Facilito': bundleGlp({ cambios: { dataset: { product: { key: 'glp', canonical: 'GLP - Granel', label: 'GLP automotor', display_unit: 'Galones' } } } }),
    'kilogramos': bundleGlp({ cambios: { dataset: { product: { key: 'glp', canonical: 'GLP - G', label: 'GLP automotor', display_unit: 'Kilogramos' } } } }),
    'versión de Gasolina': bundleGlp({ cambios: { manifest: { schema_version: '2.7.0' } } }),
    'revisión de Diésel': bundleGlp({ revision: 'diesel-2026-09-06-prueba-000000000000' }),
  };
  for (const [caso, b] of Object.entries(casos)) {
    assert.ok(erroresGlp(b).length > 0, caso);
    const cliente = GROUP_CONTRACTS.glp.validManifest(b.manifest) && await GROUP_CONTRACTS.glp.validBundle(b.manifest, 'glp', b.bodies.glp);
    assert.equal(cliente, false, `el navegador también rechaza: ${caso}`);
  }
});

test('un bundle de un grupo no pasa por el contrato de otro', () => {
  const [g, d, l] = [bundleGasolina(), bundleDiesel(), bundleGlp()];
  assert.ok(glp.validate.manifest(g.manifest).length > 0);
  assert.ok(glp.validate.manifest(d.manifest).length > 0);
  assert.ok(diesel.validate.manifest(l.manifest).length > 0);
  assert.ok(gasolina.validate.manifest(l.manifest).length > 0);
  assert.ok(GROUP_RULES.diesel.datasetErrors(JSON.parse(l.bodies.glp)).length > 0);
  assert.ok(GROUP_RULES.glp.datasetErrors(JSON.parse(d.bodies.diesel)).length > 0);
});

// --- De las filas del original al bundle, sin red --------------------------

const CABECERA_GLP = ['ID4', 'ACTIVIDAD', 'REGISTRO DE HIDROCARBUROS', 'RUC', 'RAZÓN SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCIÓN', 'FECHA DE REGISTRO', 'PRODUCTO', 'TIPO DE CLIENTE', 'MARCA', 'PRECIO DE VENTA (SOLES)', 'UNIDAD'];
const CAMPOS_ORIGINAL = ['ID4', 'ACTIVIDAD', 'REGISTRO_DE_HIDROCARBUROS', 'RUC', 'RAZON_SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCION', 'FECHA_DE_REGISTRO', 'PRODUCTO', 'TIPO_DE_CLIENTE', 'MARCA', 'PRECIO_DE_VENTA_SOLES', 'UNIDAD'];
const AHORA = '2026-09-24T12:00:00.000Z';
// El corte de GLP es el de su propia fuente, no el de los líquidos.
const FUENTE_GLP = '2026-09-23T16:00:00.000Z';
const cruda = ({ id, actividad, registro, producto = 'GLP - G', cliente = 'Usuario Final', precio = '7.49', unidad = 'Galones', marca = '' }) => [id, actividad, registro, `RUC-FICTICIO-${id}`, `RAZON ${id}`, 'LIMA', 'LIMA', 'MIRAFLORES', `AV. ${id} 123`, '2026-09-23 10:00:00', producto, cliente, marca, precio, unidad];
const minimizada = (fila) => Object.fromEntries(GLP_MINIMIZED_FIELDS.map((campo) => [campo, fila[CAMPOS_ORIGINAL.indexOf(campo)]]));
const registro = (codigo, numero) => ({ SOURCE_ACTIVITY: codigo, REGISTRO: numero, CODIGO_OSINERGMIN: '', CODIGO: '', DEPARTAMENTO: 'LIMA', PROVINCIA: 'LIMA', DISTRITO: 'MIRAFLORES', ACTIVIDAD: '' });
const punto = (capa, numero, dLat) => ({ LAYER: capa, OBJECTID: '', N: numero, COD_OSINERGMIN: '', CODIGO_DGH: '', DEPARTAMENTO: 'LIMA', PROVINCIA: 'LIMA', DISTRITO: 'MIRAFLORES', LONGITUDE: '-77.03', LATITUDE: String(-12.12 + dLat) });

/** Una estación con gasocentro (02) y un gasocentro puro (15), con sus kg y cilindros al lado. */
async function candidataGlp({ facilitoState = null, now = Date.parse(AHORA) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-glp-grupo-'));
  const filas = [
    cruda({ id: '1', actividad: 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP', registro: 'R-A', precio: '7.29' }),
    // El mismo nombre en kilogramos y un cilindro, en el mismo establecimiento.
    cruda({ id: '2', actividad: 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP', registro: 'R-A', precio: '3.10', unidad: 'Kilogramos' }),
    cruda({ id: '3', actividad: 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP', registro: 'R-A', producto: 'Cilindros de 10 Kg de GLP', precio: '45', unidad: 'Kilogramos', marca: 'MARCA-SECRETA' }),
    // Un gasocentro puro con marca de envasadora: la marca no es su identidad.
    cruda({ id: '4', actividad: 'GASOCENTROS DE GLP', registro: 'R-C', precio: '7.49', marca: 'MARCA-SECRETA' }),
  ];
  const original = path.join(dir, 'glp.csv');
  fs.writeFileSync(original, [CABECERA_GLP, ...filas].map(csvLine).join(''));
  const tablas = { prices: filas.map(minimizada), registry: [registro('02', 'R-A'), registro('15', 'R-C')], gis: [punto('35', 'R-A', 0), punto('36', 'R-C', 0.01)] };
  const { resultsByGroup } = await buildSourceProducts({ source: sourceById('glp-current'), sources: tablas, rawPath: original, cutoffAt: AHORA, snapshotId: '2026-09-24-glp', sourceMaxReportedAt: FUENTE_GLP, sourceUrl: 'https://example.test/glp.csv', groups: [productGroup(glp)] });
  const pointer = { snapshot_id: '2026-09-24-glp', snapshot_date: '2026-09-24', source_url: 'https://example.test/glp.csv', validators: { etag: '"glp-1"', last_modified: null }, promoted_at: AHORA };
  return buildGroupCandidate({ group: glp, pointer, temporalContext: { cutoff_at: AHORA, source_max_reported_at: FUENTE_GLP }, results: resultsByGroup.glp, facilitoState, now });
}

test('solo se publica GLP - G en galones; kg, cilindros y la marca de envasadora no llegan al bundle', async () => {
  const c = await candidataGlp();
  assert.deepEqual(c.datasets.glp.offers.map((oferta) => oferta.price).sort(), [7.29, 7.49]);
  assert.deepEqual(erroresGlp({ manifest: c.manifest, state: c.refreshState, bodies: c.bodies }), []);
  assert.match(c.manifest.revision_id, /^glp-2026-09-24-glp-/);
  assert.ok(c.datasets.glp.offers.every((oferta) => oferta.id.startsWith('glp1_') && oferta.commercial_identity === null));
  for (const privado of ['MARCA-SECRETA', 'RUC-FICTICIO', 'RAZON ']) assert.equal(c.bodies.glp.includes(privado), false, privado);
  // Sus cortes son los de su fuente.
  assert.deepEqual([c.datasets.glp.source_max_reported_at, c.refreshState.source_max_reported_at, c.datasets.glp.provenance.source_url], [FUENTE_GLP, FUENTE_GLP, 'https://example.test/glp.csv']);
});

test('si falla la pasada de GLP en Facilito, la captura anterior vigente se conserva y, vencida, manda el CSV', async () => {
  const observado = '2026-09-24T07:00:00.000Z';
  const fila = { key_hash: facilitoLinkKey('RAZON 1', 'AV. 1 123', 'MIRAFLORES'), price: 7.19 };
  const gasolina = { district_code: '150122', district_name: 'MIRAFLORES', product: 'regular', status: 'ok', observed_at: observado, announced_total: 1, rows: [{ key_hash: 'x', price: 15.49 }] };
  const antes = applyFacilitoRun(null, [{ district_code: '150122', district_name: 'MIRAFLORES', product: 'glp', status: 'ok', observed_at: observado, announced_total: 1, rows: [fila] }, gasolina], { attemptedAt: observado });
  const fallida = applyFacilitoRun(antes, [{ district_code: '150122', district_name: 'MIRAFLORES', product: 'glp', status: 'timeout' }], { attemptedAt: AHORA });
  assert.equal(fallida.units['150122:glp'].observed_at, observado, 'la captura anterior sigue con SU hora');
  assert.equal(fallida.units['150122:glp'].last_attempt.status, 'timeout');
  assert.deepEqual(facilitoStateForProducts(fallida, ['regular', 'premium']).units, facilitoStateForProducts(antes, ['regular', 'premium']).units, 'Gasolina no cambia');

  // (a) A 5 h de la consulta sigue vigente: GLP publica el precio consultado.
  const vigente = await candidataGlp({ facilitoState: fallida, now: Date.parse(AHORA) });
  const conCapa = vigente.datasets.glp.offers.find((oferta) => oferta.price === 7.29);
  assert.deepEqual(conCapa.facilito, { price: 7.19, observed_at: observado, reported_at: null });
  assert.equal(selectOfferPrice(conCapa, { now: () => new Date(AHORA), cutoffAt: AHORA }).source, 'facilito');
  // (b) Pasadas las 24 h no hay captura válida: la oferta sale solo con el CSV.
  const tarde = Date.parse(observado) + 25 * 3_600_000;
  const vencida = await candidataGlp({ facilitoState: fallida, now: tarde });
  const sinCapa = vencida.datasets.glp.offers.find((oferta) => oferta.price === 7.29);
  assert.equal(sinCapa.facilito, null);
  assert.equal(selectOfferPrice(sinCapa, { now: () => new Date(tarde), cutoffAt: AHORA }).source, 'csv');
});

// --- La primera activación y el aislamiento, sin red ------------------------

const auditada = GROUP_CONFIG.glp.guardrails.firstActivation.audited;
const producto = (fresh, ready, coverage, publicadas, distritos) => ({ fresh_0_30_days: { offers: fresh, districts: distritos }, contract_ready: { offers: ready, districts: distritos }, coverage_percent: coverage, published: { offers: publicadas, districts: distritos }, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 } });
const productosAuditados = () => { const p = auditada.products.glp; return { glp: producto(p.fresh_0_30_days.offers, p.contract_ready.offers, p.coverage_percent, p.published.offers, p.published.districts) }; };

test('la primera versión de GLP se juzga contra su base auditada', () => {
  const fuente = auditada.source_max_reported_at;
  const ok = compareGroupQuality({ group: 'glp', candidateProducts: productosAuditados(), candidateSourceMaxReportedAt: fuente });
  assert.deepEqual([ok.status, ok.first_activation], ['ready', true]);
  const tresDistritos = compareGroupQuality({ group: 'glp', candidateProducts: { glp: producto(449, 415, 92.4, 425, 38) }, candidateSourceMaxReportedAt: fuente });
  assert.match(tresDistritos.reasons.join(), /pierde más de 2 distritos/);
  const vieja = compareGroupQuality({ group: 'glp', candidateProducts: productosAuditados(), candidateSourceMaxReportedAt: '2026-09-01T00:00:00Z' });
  assert.match(vieja.reasons.join(), /anterior a la base auditada/);
});

const candidata = (grupo, revision, extra = {}) => ({ group: grupo, manifest: { revision_id: revision }, datasets: {}, refreshState: { snapshot_id: 'S1', source_max_reported_at: auditada.source_max_reported_at, products: {} }, identity: null, ...extra });
const glpAuditada = (revision = 'glp-primera') => candidata('glp', revision, { refreshState: { snapshot_id: 'G1', source_max_reported_at: auditada.source_max_reported_at, products: productosAuditados() } });
const glpFloja = () => candidata('glp', 'glp-floja', { refreshState: { snapshot_id: 'G1', source_max_reported_at: auditada.source_max_reported_at, products: { glp: producto(449, 415, 92.4, 425, 38) } } });
const puntero = (id, fuente) => ({ ok: true, snapshot_id: id, missing: [], pointer: { snapshot_id: id, source_id: fuente } });
const ausente = (motivo) => ({ ok: false, snapshot_id: null, missing: [motivo] });

function deps({ publicados = { gasolina: { snapshot_id: 'S1' }, diesel: { snapshot_id: 'S1' } }, propios = { gasolina: puntero('S1', 'liquid-current'), diesel: puntero('S1', 'liquid-current') }, baseDeFuente = ausente('la fuente glp-current todavía no tiene snapshot aprobado'), compuestas = {}, refresco = { status: 'unchanged' }, escritas = [], adoptados = [], planes = [] } = {}) {
  return {
    groups: [gasolina, diesel, glp],
    estadoPublicado: (root, grupo) => publicados[grupo.key] ?? null,
    refreshSnapshot: async () => refresco,
    readFacilitoState: () => ({ units: { '150101:regular': {}, '150101:diesel': {}, '150101:glp': {} } }),
    usablePrivateSnapshot: (root, { group }) => propios[group] ?? ausente(`pointer activo ausente (active-${group}.json)`),
    firstActivationBase: (root, key) => (key === 'glp' ? baseDeFuente : propios.gasolina),
    composeGroups: async ({ plan }) => { planes.push(...plan); return Object.fromEntries(plan.flatMap((entrada) => entrada.groups).map((key) => [key, compuestas[key] ?? candidata(key, `${key}-nueva`)])); },
    writeGroupProjection: (c) => { escritas.push(c.manifest.revision_id); return c; },
    adoptSnapshot: (root, snapshotId, { group, sourceId }) => adoptados.push(`${group}:${snapshotId}:${sourceId}`),
    publicadosDesdeDisco: () => null,
    writeShellManifest: () => {},
    verifyWeb: async () => ({ errors: [] }),
  };
}
const planDe = (planes, grupo) => planes.find((entrada) => entrada.groups.includes(grupo));

test('primera activación sobre active-glp.json: se juzga contra la base auditada y se publica sin adoptar', async () => {
  const escritas = [];
  const adoptados = [];
  const planes = [];
  const r = await prepareRelease({ route: 'project', deps: deps({ propios: { gasolina: puntero('S1', 'liquid-current'), diesel: puntero('S1', 'liquid-current'), glp: puntero('G1', 'glp-current') }, compuestas: { glp: glpAuditada() }, escritas, adoptados, planes }) });
  assert.deepEqual([r.ok, r.decision.deploy], [true, true]);
  assert.deepEqual(escritas.sort(), ['diesel-nueva', 'gasolina-nueva', 'glp-primera']);
  assert.deepEqual(adoptados, [], 'con pointer propio no hay nada que adoptar');
  assert.equal(planDe(planes, 'glp').pointer.source_id, 'glp-current');
  assert.equal(planDe(planes, 'glp').groups.includes('gasolina'), false, 'GLP se compone aparte, sobre su snapshot');
  assert.equal(r.informe.groups.glp.first_activation, true);
  assert.equal(r.production.glp, null, 'nunca publicado');
});

test('primera activación sobre active-glp.json que no cumple la base auditada: se detiene la entrega', async () => {
  const adoptados = [];
  const r = await prepareRelease({ route: 'project', deps: deps({ propios: { gasolina: puntero('S1', 'liquid-current'), diesel: puntero('S1', 'liquid-current'), glp: puntero('G1', 'glp-current') }, compuestas: { glp: glpFloja() }, adoptados }) });
  assert.deepEqual([r.ok, r.decision.action, r.decision.deploy], [false, 'fail_closed', false]);
  assert.match(r.decision.reason, /primera activación de glp rechazada: glp: pierde más de 2 distritos/);
  assert.deepEqual(adoptados, []);
});

test('sin active-glp.json pero con source-glp-current.json utilizable, activa desde él y lo adopta', async () => {
  const escritas = [];
  const adoptados = [];
  const planes = [];
  const r = await prepareRelease({ route: 'project', deps: deps({ baseDeFuente: puntero('G0', 'glp-current'), compuestas: { glp: glpAuditada() }, escritas, adoptados, planes }) });
  assert.deepEqual([r.ok, r.decision.deploy], [true, true]);
  assert.ok(escritas.includes('glp-primera'));
  assert.deepEqual(adoptados, ['glp:G0:glp-current']);
  assert.deepEqual([planDe(planes, 'glp').pointer.snapshot_id, planDe(planes, 'glp').pointer.source_id], ['G0', 'glp-current']);
});

test('sin ningún snapshot de GLP utilizable, la primera activación bloquea sin publicar ni adoptar', async () => {
  const escritas = [];
  const adoptados = [];
  const planes = [];
  const r = await prepareRelease({ route: 'project', deps: deps({ baseDeFuente: ausente('el snapshot G0 es de liquid-current, no de glp-current'), escritas, adoptados, planes }) });
  assert.deepEqual([r.ok, r.decision.action, r.decision.deploy], [false, 'fail_closed', false]);
  assert.equal(r.informe.groups.glp.outcome, 'first_activation_failed');
  assert.match(r.informe.groups.glp.error, /sin snapshot privado utilizable: el snapshot G0 es de liquid-current/);
  assert.deepEqual(adoptados, []);
  assert.equal(planDe(planes, 'glp'), undefined, 'nunca se compone sobre el snapshot de los líquidos');
});

test('primera activación que el refresco de esta corrida rechazó: se detiene la entrega', async () => {
  const refresco = { status: 'unchanged', sources: { 'liquid-current': { status: 'unchanged' }, 'glp-current': { status: 'needs_review', groups: { glp: { status: 'needs_review', reasons: ['glp: caída de ofertas frescas superior a 20%'] } } } } };
  const r = await prepareRelease({ route: 'data', deps: deps({ propios: { gasolina: puntero('S1', 'liquid-current'), diesel: puntero('S1', 'liquid-current'), glp: puntero('G1', 'glp-current') }, refresco, compuestas: { glp: glpAuditada() } }) });
  assert.deepEqual([r.ok, r.decision.action], [false, 'fail_closed']);
  assert.match(r.decision.reason, /primera activación de glp rechazada.*caída de ofertas frescas/);
});

const publicadosTres = { gasolina: { snapshot_id: 'S1' }, diesel: { snapshot_id: 'S1' }, glp: { snapshot_id: 'G1' } };
const propiosTres = { gasolina: puntero('S1', 'liquid-current'), diesel: puntero('S1', 'liquid-current'), glp: puntero('G1', 'glp-current') };

test('ya publicado, un fallo de GLP no impide publicar Gasolina y Diésel, y queda dicho', async () => {
  const escritas = [];
  const r = await prepareRelease({ route: 'data', deps: deps({ publicados: publicadosTres, propios: propiosTres, compuestas: { glp: { error: 'raw de GLP ilegible' } }, escritas }) });
  assert.deepEqual([r.ok, r.decision.deploy], [true, true]);
  assert.deepEqual(escritas.sort(), ['diesel-nueva', 'gasolina-nueva']);
  assert.equal(r.informe.groups.glp.outcome, 'failed');
  assert.match(r.decision.reason, /glp conserva su versión publicada: raw de GLP ilegible/);
});

test('ya publicado, un fallo de los líquidos no impide publicar GLP', async () => {
  const escritas = [];
  const r = await prepareRelease({ route: 'data', deps: deps({ publicados: publicadosTres, propios: propiosTres, compuestas: { gasolina: { error: 'contrato gasolina inválido' }, diesel: { error: 'contrato diesel inválido' } }, escritas }) });
  assert.deepEqual([r.ok, r.decision.deploy], [true, true]);
  assert.deepEqual(escritas, ['glp-nueva']);
  assert.deepEqual([r.informe.groups.gasolina.outcome, r.informe.groups.diesel.outcome], ['failed', 'failed']);
});
