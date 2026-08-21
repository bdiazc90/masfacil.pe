import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeSeed, materializeSeedTables } from '../app/gate-4.3-bootstrap.mjs';
import { publicationDecision } from '../app/gate-4.3-publication-policy.mjs';
import { compareGasolinaQuality, validateRefreshState } from '../pipeline/refresh-state.mjs';
import { verifyContrast } from '../web/contrast.mjs';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';
import { loadGasolinaProduct } from '../web/data-client.js';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap/gate-4.3-seed.manifest.json'), 'utf8'));
const seedPath = path.join(root, '.local-cache/gate-4.3/bootstrap-seed.b64');

test('el seed autorizado se valida, se instala privado y rechaza corrupción', { skip: !fs.existsSync(seedPath) }, (t) => {
  const encoded = fs.readFileSync(seedPath, 'utf8');
  const payload = decodeSeed(encoded, manifest);
  assert.equal(payload.registry.length, 744);
  assert.equal(payload.gis.length, 750);
  assert.throws(() => decodeSeed(`${encoded.slice(0, -1)}A`, manifest), /corrupto/);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-4.3-install-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const output = execFileSync(process.execPath, ['scripts/install-gate-4.3-bootstrap-seed.mjs', '--target', target], { cwd: root, env: { ...process.env, GATE_4_3_BOOTSTRAP_SEED_B64: encoded }, encoding: 'utf8' });
  assert.match(output, /"installed":true/);
  for (const file of ['registry/authorizations.csv.gz', 'gis/features.csv.gz']) assert.equal(fs.statSync(path.join(target, file)).mode & 0o077, 0);
  const tables = materializeSeedTables(payload);
  assert.match(tables.registry, /^SOURCE_ACTIVITY;REGISTRO;/);
  assert.match(tables.gis, /^LAYER;OBJECTID;N;/);
});

test('refresh-state público falla cerrado ante bundle o guardrail incoherente', () => {
  const manifestFixture = { snapshot_id: '2026-08-18-fixture' };
  const state = { schema_version: 1, snapshot_id: manifestFixture.snapshot_id, source_id: 'liquid-current', validators: { etag: 'opaque', last_modified: null }, guardrails: { fresh_offers: 740, contract_ready: 714, coverage_percent: 96.486, source_max_reported_at: '2026-08-18T04:59:36.000Z', exceptions: { latest_price_conflicts: 0, latest_territory_conflicts: 0, registry_ambiguous_after_freshness: 0, registry_territory_mismatch_after_exact_join: 0, gis_ambiguous_after_registry: 0, gis_unsafe_coordinate_after_exact_join: 0, gis_territory_mismatch_after_exact_join: 0, missing_or_ambiguous_provisional_identity: 0 } } };
  assert.deepEqual(validateRefreshState(state, manifestFixture), []);
  assert.ok(validateRefreshState({ ...state, snapshot_id: 'otro' }, manifestFixture).length > 0);
  assert.ok(validateRefreshState({ ...state, guardrails: { ...state.guardrails, exceptions: {} } }, manifestFixture).length > 0);
});

test('refresh-state v2 y promoción conjunta protegen Regular y Premium', () => {
  const product = (fresh, ready, coverage = Number((ready / fresh * 100).toFixed(3))) => ({ fresh_0_30_days: { offers: fresh, districts: 42 }, contract_ready: { offers: ready, districts: 42 }, coverage_percent: coverage, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 }, cutoff_at: '2026-08-20T23:59:59.000-05:00' });
  const state = { schema_version: '2.0.0', revision_id: 'gasolina-2026-08-20-fixture', validators: { etag: 'v2', last_modified: null }, source_max_reported_at: '2026-08-20T17:00:00.000Z', products: { regular: product(740, 714), premium: product(726, 700) } };
  assert.deepEqual(validateGasolinaRefreshState(state, { revision_id: state.revision_id }), []);
  assert.ok(validateGasolinaRefreshState({ ...state, source_max_reported_at: null }, { revision_id: state.revision_id }).length > 0);
  const ready = compareGasolinaQuality({ previousProducts: state.products, candidateProducts: state.products, previousSourceMaxReportedAt: '2026-08-19T17:00:00.000Z', candidateSourceMaxReportedAt: state.source_max_reported_at });
  assert.equal(ready.status, 'ready');
  const broken = compareGasolinaQuality({ previousProducts: state.products, candidateProducts: { ...state.products, premium: product(0, 0, 0) }, previousSourceMaxReportedAt: '2026-08-19T17:00:00.000Z', candidateSourceMaxReportedAt: state.source_max_reported_at });
  assert.equal(broken.status, 'needs_review');
  assert.ok(broken.reasons.some((reason) => reason.startsWith('premium:')));
});

test('el refresh valida el par antes de promover y rollback reconstruye el mismo par', () => {
  const refresh = fs.readFileSync(path.join(root, 'scripts', 'refresh-gate-3.3.mjs'), 'utf8');
  const rollback = fs.readFileSync(path.join(root, 'scripts', 'rollback-gate-4.3.mjs'), 'utf8');
  assert.ok(refresh.indexOf('buildGasolinaProjectionCandidate') < refresh.indexOf('promoteSnapshot({'));
  assert.ok(refresh.indexOf('compareGasolinaQuality') < refresh.indexOf('promoteSnapshot({'));
  assert.ok(rollback.indexOf('buildGasolinaProjectionForPointer') < rollback.indexOf('rollbackSnapshot(root'));
  assert.ok(rollback.indexOf('rollbackSnapshot(root') < rollback.indexOf('writeGasolinaProjection(projection'));
});

test('los dos temas cumplen AA sobre el peor caso de vidrio y fondo', () => {
  for (const theme of ['light', 'dark']) {
    const result = verifyContrast(theme);
    for (const [name, ratio] of Object.entries(result)) assert.ok(ratio >= (name === 'primary' || name === 'ring' ? 3 : 4.5), `${theme} ${name}: ${ratio}`);
  }
});

test('la publicación falla cerrada salvo cambio promovido o shell explícitamente cambiado', () => {
  assert.deepEqual(publicationDecision({ status: 'unchanged' }), {
    action: 'no_op', download_data: false, project: false, verify: false, deploy: false,
    reason: 'validadores sin cambio; cero bytes de datos y cero deploy',
  });
  assert.deepEqual(publicationDecision({ status: 'unchanged' }, { shellChanged: true }), {
    action: 'deploy_existing_bundle', download_data: false, project: false, verify: true, deploy: true,
    reason: 'shell cambió; se conserva el último bundle público validado',
  });
  assert.equal(publicationDecision({ status: 'promoted', promoted: true }).action, 'project_verify_deploy');
  for (const status of ['unverifiable', 'needs_review', 'rejected']) {
    const decision = publicationDecision({ status });
    assert.equal(decision.action, 'fail_closed');
    assert.equal(decision.deploy, false);
  }
  assert.throws(() => publicationDecision({ status: 'ready' }), /no permitido/);
});

test('el shell conserva los estados operativos sin pantalla de confirmación e identidad inventada', () => {
  const index = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
  const offerCard = fs.readFileSync(path.join(root, 'web', 'offer-card.js'), 'utf8');
  for (const id of ['start-step', 'loading-step', 'district-step', 'compare-step', 'fatal-state']) assert.match(index, new RegExp(`id="${id}"`));
  assert.doesNotMatch(index, /id="choose-step"|Elegiste una opción para comparar|Volver a comparar/);
  assert.match(index, /id="offline-note"/); assert.match(index, /id="empty-state"/); assert.doesNotMatch(index, /No necesitas sacrificar cercanía/);
  assert.match(app, /renderOfferCard/); assert.match(offerCard, /offer\.district/); assert.match(offerCard, /offer\.price/); assert.match(offerCard, /offer\.age_days/); assert.doesNotMatch(offerCard, /offer\.(?:legal_name|address|commercial_identity|name)/);
});

test('headers y workflow conservan CSP propia, secretos aislados y direct upload condicionado', () => {
  const headers = fs.readFileSync(path.join(root, 'web', '_headers'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'refresh-pages.yml'), 'utf8');
  assert.match(headers, /default-src 'self'/); assert.match(headers, /connect-src 'self'/); assert.match(headers, /worker-src 'self'/); assert.match(headers, /frame-ancestors 'none'/); assert.match(headers, /Permissions-Policy: geolocation=\(self\)/); assert.match(headers, /data\/snapshots\/\*/); assert.match(headers, /immutable/);
  assert.match(workflow, /pull_request:/); assert.match(workflow, /if: github\.event_name != 'pull_request'/); assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/); assert.match(workflow, /CLOUDFLARE_API_TOKEN/); assert.match(workflow, /CLOUDFLARE_PAGES_PROJECT/); assert.match(workflow, /GATE_4_3_BOOTSTRAP_SEED_B64/); assert.match(workflow, /wrangler@4\.31\.0 pages deploy web/); assert.match(workflow, /fetch:refresh-state/); assert.match(workflow, /fetch:public-bundle/); assert.match(workflow, /17 2,8,14,20/); assert.doesNotMatch(workflow, /actions\/cache|upload-artifact|download-artifact/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/); assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
  assert.equal((workflow.match(/fetch-depth: 0/g) ?? []).length, 2);
});

test('el bootstrap manual verifica bundle local y la identidad pública usa masfacil.pe', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'scripts', 'serve-web.mjs'), 'utf8');
  const ignored = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.equal(packageJson.name, 'masfacil-pe'); assert.match(readme, /# masfacil\.pe/); assert.match(readme, /pages project create masfacil-pe/); assert.match(readme, /pages deploy \.local-cache\/gate-4\.3\/pages-bootstrap-web --project-name masfacil-pe/); assert.match(server, /masfacil\.pe local/); assert.match(ignored, /^\/\.env$/m);
});

test('el bootstrap manual produce una raíz sellada cuando existe el bundle privado', { skip: !fs.existsSync(path.join(root, 'web', 'data', 'gasolina', 'manifest.json')) }, () => {
  const output = execFileSync(process.execPath, ['scripts/verify-first-pages-bootstrap.mjs'], { cwd: root, encoding: 'utf8' });
  const prepared = JSON.parse(execFileSync(process.execPath, ['scripts/prepare-pages-bootstrap-root.mjs'], { cwd: root, encoding: 'utf8' }));
  assert.match(output, /"ready":true/); assert.match(output, /"pages_project_recommendation":"masfacil-pe"/); assert.match(output, /"revision_id":"gasolina-/);
  assert.equal(prepared.deploy_root, '.local-cache/gate-4.3/pages-bootstrap-web');
  assert.equal(fs.existsSync(path.join(root, prepared.deploy_root, 'assets', 'bg_light.png')), false);
  assert.equal(fs.existsSync(path.join(root, prepared.deploy_root, 'data', 'gasolina', 'manifest.json')), true);
});

test('gasolina v2 separa LIMA/LIMA y ambos bundles inmutables sin producto por oferta', { skip: !fs.existsSync(path.join(root, 'web', 'data', 'gasolina', 'manifest.json')) }, () => {
  const data = path.join(root, 'web', 'data', 'gasolina'); const publicManifest = JSON.parse(fs.readFileSync(path.join(data, 'manifest.json'), 'utf8'));
  assert.deepEqual(validateGasolinaManifest(publicManifest), []); assert.deepEqual(Object.keys(publicManifest.products), GASOLINA_KEYS);
  for (const key of GASOLINA_KEYS) { const body = fs.readFileSync(path.join(root, 'web', publicManifest.products[key].dataset_url), 'utf8'); const dataset = JSON.parse(body); assert.deepEqual(validateGasolinaBundle(publicManifest, key, body), []); assert.equal(dataset.scope.department, 'LIMA'); assert.equal(dataset.scope.province, 'LIMA'); assert.equal(dataset.product.key, key); assert.ok(dataset.offers.every((offer) => JSON.stringify(Object.keys(offer)) === JSON.stringify(['id', 'price', 'reported_at', 'district', 'longitude', 'latitude']))); }
});

test('Premium no se solicita antes de su selección y conserva la pareja validada por revisión', { skip: !fs.existsSync(path.join(root, 'web', 'data', 'gasolina', 'manifest.json')) }, async () => {
  const data = path.join(root, 'web', 'data', 'gasolina'); const publicManifest = fs.readFileSync(path.join(data, 'manifest.json'), 'utf8'); const manifest = JSON.parse(publicManifest); const regular = fs.readFileSync(path.join(root, 'web', manifest.products.regular.dataset_url), 'utf8'); const requests = [];
  const loaded = await loadGasolinaProduct('regular', async (url) => { requests.push(url); if (url === '/data/gasolina/manifest.json?product=regular') return new Response(publicManifest); if (url === `/${manifest.products.regular.dataset_url}`) return new Response(regular); throw new Error(`request inesperado: ${url}`); });
  assert.equal(loaded.dataset.offers.length, 714); assert.equal(requests.includes(`/${manifest.products.premium.dataset_url}`), false);
});

test('ruta, selectores y fallback Premium preservan estados separados', () => {
  const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8'); const selector = fs.readFileSync(path.join(root, 'web', 'gasolina', 'index.html'), 'utf8'); const redirects = fs.readFileSync(path.join(root, 'web', '_redirects'), 'utf8');
  assert.deepEqual([...selector.matchAll(/href="\/gasolina\/([^/]+)\/"/g)].map((match) => match[1]), ['regular', 'premium']); assert.match(app, /state\.sort/); assert.match(app, /state\.product/); assert.match(app, /location\.assign\(`/); assert.match(redirects, /^\/ \/gasolina\/ 302/m); assert.match(redirects, /^\/gasolina\/regular\/ \/index\.html 200/m); assert.match(redirects, /^\/gasolina\/premium\/ \/index\.html 200/m);
});

test('el tema es un toggle accesible de tres estados con iconos', () => {
  const index = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8'); const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8'); const styles = fs.readFileSync(path.join(root, 'web', 'styles.css'), 'utf8');
  assert.doesNotMatch(index, /theme-menu/); assert.deepEqual([...index.matchAll(/data-theme-choice="([^"]+)"/g)].map((match) => match[1]), ['light', 'system', 'dark']); assert.equal((index.match(/<svg /g) ?? []).length >= 3, true); assert.match(index, /aria-label="Tema claro"/); assert.match(index, /aria-label="Tema del sistema"/); assert.match(index, /aria-label="Tema oscuro"/); assert.match(app, /button\.dataset\.themeChoice === choice/); assert.match(styles, /\.theme-toggle/); assert.match(styles, /aria-pressed="true"/);
});

test('la simplificación UX concentra la selección, ubicación, distrito y resultados', () => {
  const index = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  const selector = fs.readFileSync(path.join(root, 'web', 'gasolina', 'index.html'), 'utf8');
  const selectorScript = fs.readFileSync(path.join(root, 'web', 'selector.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'web', 'styles.css'), 'utf8');
  assert.match(selector, /¿Qué gasolina buscas\?/); assert.match(selector, />Regular<\/a>/); assert.match(selector, />Premium<\/a>/); assert.doesNotMatch(selector, /Precio, cercanía y frescura|No cargamos precios hasta/); assert.equal((selector.match(/<svg /g) ?? []).length >= 3, true); assert.match(selector, /id="product-selection-status"/); assert.match(selectorScript, /Abriendo \$\{label\}/); assert.match(selectorScript, /aria-busy/);
  assert.match(index, /href="\/gasolina\/"/); assert.match(index, /Encuentra gasolina cerca de ti/); assert.match(index, /Usar mi ubicación/); assert.match(index, /No guardamos tu ubicación/); assert.match(index, /Escribe tu distrito/); assert.match(index, /Ver todos los distritos/); assert.match(index, />Cambiar<\/button>/); assert.doesNotMatch(index, /id="start-saving"|Ubicación no disponible|Sin coordenada de origen no mostramos distancias|Distancias en línea recta/); assert.match(index, /id="use-location"[^>]*disabled/); assert.match(index, /id="choose-district"[^>]*disabled/);
  assert.match(app, /function cancelLocation\(\)/); assert.match(app, /locationAttempt/); assert.match(app, /function renderDistricts\(/); assert.match(app, /visibleDistricts/); assert.match(app, /document\.title = `masfacil\.pe · \$\{label\}`/); assert.match(app, /\$\('use-location'\)\.disabled = false/); assert.match(styles, /\.product-choices/); assert.match(styles, /\.district-filter/); assert.match(styles, /\.app-shell--selector/); assert.match(styles, /\.offer\{padding:17px\}/);
});
