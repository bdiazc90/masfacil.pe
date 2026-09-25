// Diésel como grupo propio: su contrato no acepta nada de Gasolina ni al revés,
// su primera versión se juzga contra la base auditada, y un fallo de un grupo no
// arrastra al otro salvo que sea la primera activación.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { GROUP_RULES } from '../web/lib/bundle-contract.js';
import { GROUP_CONTRACTS } from '../web/group-contracts.js';
import { GROUP_CONFIG, groupByKey } from '../pipeline/groups.mjs';
import { compareGasolinaQuality, compareGroupQuality } from '../pipeline/refresh-state.mjs';
import { groupsBehind } from '../app/publication-policy.mjs';
import { prepareRelease } from '../pipeline/prepare-release.mjs';
import { bundleDiesel, bundleGasolina } from './fixtures/gasolina-bundle.mjs';

const diesel = groupByKey('diesel');
const gasolina = groupByKey('gasolina');
const erroresDiesel = (b) => [...diesel.validate.manifest(b.manifest), ...diesel.validate.refreshState(b.state, b.manifest), ...diesel.validate.bundle(b.manifest, 'diesel', b.bodies.diesel)];

test('un bundle de Diésel válido pasa en Node y en el navegador', async () => {
  const b = bundleDiesel();
  assert.deepEqual(erroresDiesel(b), []);
  assert.equal(GROUP_CONTRACTS.diesel.validManifest(b.manifest), true);
  assert.equal(await GROUP_CONTRACTS.diesel.validBundle(b.manifest, 'diesel', b.bodies.diesel), true);
});

test('el contrato de Diésel rechaza lo que no es suyo', async () => {
  const casos = {
    'IDs de Gasolina': bundleDiesel({ cambios: { dataset: { offers: [{ ...JSON.parse(bundleDiesel().bodies.diesel).offers[0], id: `g2_${'a'.repeat(24)}` }] } } }),
    'URL de Gasolina': bundleDiesel({ cambios: { descriptor: { dataset_url: 'data/gasolina/snapshots/x/diesel.json' } } }),
    'otro canónico': bundleDiesel({ cambios: { dataset: { product: { key: 'diesel', canonical: 'DIESEL B5 S-50 UV', label: 'Diésel B5 S-50 UV', display_unit: 'Galones' } } } }),
    'otra unidad': bundleDiesel({ cambios: { dataset: { product: { key: 'diesel', canonical: 'Diesel B5 S-50 UV', label: 'Diésel B5 S-50 UV', display_unit: 'Litros' } } } }),
    'versión de Gasolina': bundleDiesel({ cambios: { manifest: { schema_version: '2.7.0' } } }),
    'revisión ajena': bundleDiesel({ revision: 'gasolina-2026-09-06-prueba-000000000000' }),
  };
  for (const [caso, b] of Object.entries(casos)) {
    assert.ok(erroresDiesel(b).length > 0, caso);
    const cliente = GROUP_CONTRACTS.diesel.validManifest(b.manifest) && await GROUP_CONTRACTS.diesel.validBundle(b.manifest, 'diesel', b.bodies.diesel);
    assert.equal(cliente, false, `el navegador también rechaza: ${caso}`);
  }
});

test('un bundle de un grupo no pasa por el contrato del otro', () => {
  const g = bundleGasolina();
  const d = bundleDiesel();
  assert.ok(diesel.validate.manifest(g.manifest).length > 0);
  assert.ok(gasolina.validate.manifest(d.manifest).length > 0);
  assert.ok(GROUP_RULES.gasolina.datasetErrors(JSON.parse(d.bodies.diesel)).length > 0);
});

test('las actividades de cada grupo están dentro de la semilla y los IDs no se cruzan', () => {
  const semilla = JSON.parse(fs.readFileSync(new URL('../bootstrap/seed.manifest.json', import.meta.url), 'utf8')).filters.source_activity;
  for (const [grupo, config] of Object.entries(GROUP_CONFIG)) {
    for (const codigo of Object.values(config.activities)) assert.ok(semilla.includes(codigo), `${grupo}: ${codigo} fuera de la semilla; cambiarla vacía la caché de Actions`);
  }
  assert.notEqual(GROUP_CONFIG.diesel.idScheme.prefix, GROUP_CONFIG.gasolina.idScheme.prefix);
  assert.notEqual(GROUP_CONFIG.diesel.idScheme.namespace, GROUP_CONFIG.gasolina.idScheme.namespace);
  assert.deepEqual(GROUP_CONFIG.gasolina.idScheme, { prefix: 'g2_', namespace: 'masfacil-pe|gasolina-v2' }, 'cambiarlo cambiaría todos los IDs publicados');
  // Diésel no es más laxo que Gasolina.
  assert.ok(GROUP_CONFIG.diesel.guardrails.maxOfferDrop <= GROUP_CONFIG.gasolina.guardrails.maxOfferDrop);
  assert.ok(GROUP_CONFIG.diesel.guardrails.maxCoverageDropPoints <= GROUP_CONFIG.gasolina.guardrails.maxCoverageDropPoints);
});

const producto = (fresh, ready, coverage, publishedDistricts = 43) => ({ fresh_0_30_days: { offers: fresh, districts: 43 }, contract_ready: { offers: ready, districts: 43 }, coverage_percent: coverage, published: { offers: ready + 10, districts: publishedDistricts }, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 } });

test('Gasolina conserva sus guardrails exactos', () => {
  const previo = { regular: producto(700, 690, 95), premium: producto(700, 690, 95) };
  const caida = { regular: producto(500, 480, 88), premium: producto(700, 690, 95) };
  const r = compareGasolinaQuality({ previousProducts: previo, candidateProducts: caida, previousSourceMaxReportedAt: '2026-09-01T00:00:00Z', candidateSourceMaxReportedAt: '2026-09-02T00:00:00Z' });
  assert.deepEqual(r.reasons, ['regular: caída de ofertas frescas superior a 20%', 'regular: caída de cobertura superior a 5 puntos']);
  assert.equal('first_activation' in r, false, 'la salida de Gasolina no cambia de forma');
  assert.deepEqual(Object.keys(r), ['status', 'reasons', 'products', 'forced_reprojection', 'source_max_reported_at']);
});

test('la primera versión de Diésel se juzga contra la base auditada', () => {
  const { audited } = GROUP_CONFIG.diesel.guardrails.firstActivation;
  const fuente = audited.source_max_reported_at;
  const base = producto(audited.products.diesel.fresh_0_30_days.offers, audited.products.diesel.contract_ready.offers, audited.products.diesel.coverage_percent);
  const ok = compareGroupQuality({ group: 'diesel', candidateProducts: { diesel: base }, candidateSourceMaxReportedAt: fuente });
  assert.deepEqual([ok.status, ok.first_activation], ['ready', true], 'el mismo CSV auditado pasa: no hace falta que avance');
  const tresDistritos = compareGroupQuality({ group: 'diesel', candidateProducts: { diesel: producto(752, 714, 94.9, 40) }, candidateSourceMaxReportedAt: fuente });
  assert.match(tresDistritos.reasons.join(), /pierde más de 2 distritos/);
  const caida = compareGroupQuality({ group: 'diesel', candidateProducts: { diesel: producto(500, 480, 94.9) }, candidateSourceMaxReportedAt: fuente });
  assert.match(caida.reasons.join(), /caída de ofertas frescas superior a 20%/);
  const vieja = compareGroupQuality({ group: 'diesel', candidateProducts: { diesel: base }, candidateSourceMaxReportedAt: '2026-09-01T00:00:00Z' });
  assert.match(vieja.reasons.join(), /anterior a la base auditada/);
  // Ya publicado, se compara con su versión anterior como cualquier grupo.
  const despues = compareGroupQuality({ group: 'diesel', previousProducts: { diesel: base }, candidateProducts: { diesel: base }, previousSourceMaxReportedAt: fuente, candidateSourceMaxReportedAt: fuente });
  assert.equal('first_activation' in despues, false);
  assert.match(despues.reasons.join(), /no avanzó/);
});

test('el preflight ve un retroceso de Diésel aunque Gasolina avance', () => {
  const estado = (snapshot, unidades = {}) => ({ snapshot_id: snapshot, products: {}, facilito: { units_observed: unidades } });
  const publicado = { gasolina: estado('2026-09-23-a'), diesel: estado('2026-09-23-a', { '150101:diesel': '2026-09-23T13:00:00.000Z' }) };
  const local = { gasolina: estado('2026-09-24-b'), diesel: estado('2026-09-24-b', { '150101:diesel': '2026-09-23T07:00:00.000Z' }) };
  const [atrasado] = groupsBehind({ local, published: publicado });
  assert.deepEqual([atrasado.group, atrasado.regressions.length], ['diesel', 1]);
});

// --- La preparación por grupo, sin red y sin los 1,2 GB del original -------

const candidata = (grupo, revision, extra = {}) => ({ group: grupo, manifest: { revision_id: revision }, datasets: {}, refreshState: { snapshot_id: 'S1', source_max_reported_at: GROUP_CONFIG.diesel.guardrails.firstActivation.audited.source_max_reported_at, products: {} }, identity: null, ...extra });
const productosAuditados = () => {
  const { audited } = GROUP_CONFIG.diesel.guardrails.firstActivation;
  return { diesel: producto(audited.products.diesel.fresh_0_30_days.offers, audited.products.diesel.contract_ready.offers, audited.products.diesel.coverage_percent) };
};

function deps({ publicados = { gasolina: { snapshot_id: 'S1' }, diesel: { snapshot_id: 'S1' } }, pointers = { gasolina: true, diesel: true }, compuestas = {}, escritas = [], adoptados = [] } = {}) {
  return {
    groups: [gasolina, diesel],
    estadoPublicado: (root, grupo) => publicados[grupo.key] ?? null,
    refreshSnapshot: async () => ({ status: 'unchanged' }),
    readFacilitoState: () => ({ units: { '150101:regular': {}, '150101:diesel': {} } }),
    usablePrivateSnapshot: (root, { group }) => (pointers[group] ? { ok: true, snapshot_id: 'S1', missing: [], pointer: { snapshot_id: 'S1' } } : { ok: false, snapshot_id: null, missing: ['pointer ausente'] }),
    composeGroups: async ({ plan }) => Object.fromEntries(plan.flatMap((entrada) => entrada.groups).map((key) => [key, compuestas[key] ?? candidata(key, `${key}-nueva`)])),
    writeGroupProjection: (c) => { escritas.push(c.manifest.revision_id); return c; },
    adoptSnapshot: (root, snapshotId, { group }) => adoptados.push(`${group}:${snapshotId}`),
    // La consulta web siempre mueve algo: aquí se mira la decisión por grupo.
    publicadosDesdeDisco: () => null,
    writeShellManifest: () => {},
    verifyWeb: async () => ({ errors: [] }),
  };
}

test('un fallo de Gasolina no impide publicar Diésel, y queda dicho', async () => {
  const escritas = [];
  const r = await prepareRelease({ route: 'data', deps: deps({ escritas, compuestas: { gasolina: { error: 'contrato gasolina inválido' } } }) });
  assert.equal(r.decision.deploy, true);
  assert.deepEqual(escritas, ['diesel-nueva']);
  assert.equal(r.informe.groups.gasolina.outcome, 'failed');
  assert.match(r.decision.reason, /gasolina conserva su versión publicada: contrato gasolina inválido/);
});

test('un fallo de Diésel ya publicado no impide publicar Gasolina', async () => {
  const escritas = [];
  const r = await prepareRelease({ route: 'data', deps: deps({ escritas, compuestas: { diesel: { error: 'raw ilegible' } } }) });
  assert.deepEqual([r.decision.deploy, r.ok], [true, true]);
  assert.deepEqual(escritas, ['gasolina-nueva']);
  assert.equal(r.informe.groups.diesel.outcome, 'failed');
});

test('la primera activación se juzga, adopta el snapshot de Gasolina y publica', async () => {
  const escritas = [];
  const adoptados = [];
  const buena = candidata('diesel', 'diesel-primera', { refreshState: { snapshot_id: 'S1', source_max_reported_at: GROUP_CONFIG.diesel.guardrails.firstActivation.audited.source_max_reported_at, products: productosAuditados() } });
  const r = await prepareRelease({ route: 'project', deps: deps({ publicados: { gasolina: { snapshot_id: 'S1' } }, pointers: { gasolina: true, diesel: false }, compuestas: { diesel: buena }, escritas, adoptados }) });
  assert.equal(r.decision.deploy, true);
  assert.deepEqual(adoptados, ['diesel:S1']);
  assert.deepEqual(escritas.sort(), ['diesel-primera', 'gasolina-nueva']);
  assert.equal(r.informe.groups.diesel.first_activation, true);
});

test('una primera activación que no pasa detiene toda la entrega', async () => {
  const escritas = [];
  const adoptados = [];
  const floja = candidata('diesel', 'diesel-floja', { refreshState: { snapshot_id: 'S1', source_max_reported_at: '2026-09-24T04:59:31.000Z', products: { diesel: producto(100, 90, 60) } } });
  const r = await prepareRelease({ route: 'project', deps: deps({ publicados: { gasolina: { snapshot_id: 'S1' } }, pointers: { gasolina: true, diesel: false }, compuestas: { diesel: floja }, escritas, adoptados }) });
  assert.deepEqual([r.ok, r.decision.action, r.decision.deploy], [false, 'fail_closed', false]);
  assert.match(r.decision.reason, /primera activación de diesel rechazada/);
  assert.deepEqual(adoptados, [], 'sin primera versión válida, el grupo no adopta ningún snapshot');
});

test('la ruta shell no compone y exige todos los grupos', async () => {
  let compuso = false;
  const base = deps();
  const r = await prepareRelease({ route: 'shell', deps: { ...base, composeGroups: async () => { compuso = true; return {}; } } });
  assert.deepEqual([r.decision.action, r.decision.deploy, compuso], ['deploy_existing_bundle', true, false]);
  const sinDiesel = await prepareRelease({ route: 'shell', deps: { ...base, verifyWeb: async () => ({ errors: ['Falta web/data/diesel/manifest.json'] }) } });
  assert.deepEqual([sinDiesel.ok, sinDiesel.decision.deploy], [false, false]);
});
