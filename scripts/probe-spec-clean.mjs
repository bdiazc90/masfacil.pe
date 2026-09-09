#!/usr/bin/env node

// Sonda de los cinco casos de SPEC-CLEAN §8 y de las correcciones del ciclo FIX.
// Es DESECHABLE: se retira junto con `SPEC-CLEAN.md` en el cierre aprobado. No
// es una suite ni un ritual para entregas futuras; comprueba exactamente lo que
// este cambio prometió.
//
//   node scripts/probe-spec-clean.mjs
//
// Usa el bundle público válido que ya está en `web/data/`, COPIAS del catálogo
// privado en el scratchpad —nunca toca `.local-cache/identity/`— y un servidor
// HTTP local. No descarga nada de la fuente y no publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { codeRegression, resolveRoute } from '../app/route-policy.mjs';
import { publicationDecision, publicationDecisionForRoute } from '../app/publication-policy.mjs';
import { brandAssetProblems, serviceWorkerUpdateProblems, shellEntryFile, svgProblems } from '../app/shell-assets.mjs';
import { deriveShell, renderShellManifest, shellManifestProblems } from '../pipeline/shell-manifest.mjs';
import { commercialNameBacking, loadValidatedCommercialAudit } from '../app/commercial-audit.mjs';
import { buildCommercialCatalogIndex, isolateCommercialCatalog, loadValidatedCommercialCatalog } from '../app/commercial-catalog.mjs';
import { resolveCommercialIdentity } from '../app/commercial-resolution.mjs';
import { buildGasolinaProjectionForPointer, usablePrivateSnapshot } from '../pipeline/project-gasolina.mjs';
import { GASOLINA_KEYS, PUBLIC_OFFER_FIELDS, validateGasolinaBundle, validateGasolinaManifest } from '../pipeline/gasolina-contract.mjs';
import { BRAND_LOGOS } from '../web/brand-logos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'web', 'data', 'gasolina');
const identityRoot = path.join(root, '.local-cache', 'identity');
const CATALOG = 'commercial-identity-catalog.json';
const AUDIT = 'commercial-identity-audit.json';
const leer = (archivo) => JSON.parse(fs.readFileSync(archivo, 'utf8'));
const manifest = leer(path.join(dataRoot, 'manifest.json'));
const refreshState = leer(path.join(dataRoot, 'refresh-state.json'));
const manifestTexto0 = fs.readFileSync(path.join(dataRoot, 'manifest.json'), 'utf8');
const estadoTexto0 = fs.readFileSync(path.join(dataRoot, 'refresh-state.json'), 'utf8');
const cuerpo = (key) => fs.readFileSync(path.join(root, 'web', manifest.products[key].dataset_url), 'utf8');
const pointer = leer(path.join(root, '.local-cache', 'snapshots', 'active.json'));

// Todo lo mutable vive en un directorio temporal propio de esta corrida.
const scratch = fs.mkdtempSync(path.join(process.env.CLAUDE_SCRATCHPAD || os.tmpdir(), 'probe-spec-clean-'));
const huellaReal = { catalog: fs.readFileSync(path.join(identityRoot, CATALOG)), audit: fs.readFileSync(path.join(identityRoot, AUDIT)) };
const servidores = [];
after(() => {
  for (const servidor of servidores) servidor.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** Copia del expediente real; el nombre distingue cada escenario. */
function copiaDeIdentidad(nombre, { catalog = true, audit = true, mutate = null } = {}) {
  const dir = path.join(scratch, nombre);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const catalogo = JSON.parse(huellaReal.catalog.toString('utf8'));
  const auditoria = JSON.parse(huellaReal.audit.toString('utf8'));
  if (mutate) mutate(catalogo, auditoria);
  if (catalog) fs.writeFileSync(path.join(dir, CATALOG), `${JSON.stringify(catalogo)}\n`, { mode: 0o600 });
  if (audit) fs.writeFileSync(path.join(dir, AUDIT), `${JSON.stringify(auditoria)}\n`, { mode: 0o600 });
  return dir;
}

/** Servidor local que responde con rutas explícitas. Sin red externa. */
async function servir(rutas) {
  const servidor = http.createServer((peticion, respuesta) => {
    const recurso = rutas[peticion.url];
    if (!recurso) { respuesta.writeHead(404).end('no'); return; }
    respuesta.writeHead(200, { 'content-type': recurso.type }).end(recurso.body);
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  servidores.push(servidor);
  return `http://127.0.0.1:${servidor.address().port}`;
}

// Se sirven los BYTES del bundle local, no un JSON re-serializado: `fetch:live`
// escribe lo que recibe, y reescribirlo con otro formato tocaría el bundle real.
const bundlePublico = (manifestTexto = manifestTexto0, estadoTexto = estadoTexto0) => ({
  '/data/gasolina/manifest.json': { body: manifestTexto, type: 'application/json' },
  '/data/gasolina/refresh-state.json': { body: estadoTexto, type: 'application/json' },
  ...Object.fromEntries(GASOLINA_KEYS.map((key) => [`/${manifest.products[key].dataset_url}`, { body: cuerpo(key), type: 'application/json' }])),
});

const correr = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

// `spawnSync` bloquea el bucle de eventos y el servidor local vive en ESTE
// proceso: un subproceso que lo consulte con la versión síncrona se queda
// esperando para siempre. Los que hablan con el servidor usan esta.
function correrAsync(args, env = {}) {
  return new Promise((listo) => {
    const hijo = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env } });
    let stdout = ''; let stderr = '';
    hijo.stdout.on('data', (trozo) => { stdout += trozo; });
    hijo.stderr.on('data', (trozo) => { stderr += trozo; });
    hijo.on('close', (status) => listo({ status, stdout, stderr }));
  });
}

// ── 1 · Interfaz independiente de la fuente ────────────────────────────────────

test('1 · la ruta de interfaz no consulta la fuente ni pide secretos privados', () => {
  const ruta = resolveRoute({ eventName: 'push', changedPaths: ['web/styles.css', 'web/icons/brands/repsol.svg', 'scripts/install-brand-logo.mjs'] });
  assert.equal(ruta.route, 'shell');
  assert.equal(ruta.needsRefresh, false, 'la ruta de interfaz no debe refrescar');
  assert.equal(ruta.needsSeed, false, 'la ruta de interfaz no debe pedir el seed');
  assert.equal(ruta.needsIdentity, false, 'la ruta de interfaz no debe instalar identidad');
  assert.equal(ruta.deploy, true);
  // Con la fuente caída da igual: la decisión de interfaz no mira el refresco.
  const decision = publicationDecisionForRoute('shell', { status: 'unverifiable' });
  assert.equal(decision.action, 'deploy_existing_bundle');
  assert.equal(decision.project, false);
  assert.equal(decision.deploy, true);
});

test('1 · recuperar el bundle público conserva bytes, hashes y revisión', async () => {
  const origen = await servir(bundlePublico());
  const salida = await correrAsync(['scripts/fetch-live-bundle.mjs', origen], { TEST_MODE: '1' });
  assert.equal(salida.status, 0, salida.stderr);
  const informe = JSON.parse(salida.stdout);
  assert.equal(informe.revision_id, manifest.revision_id);
  assert.equal(informe.raw_downloaded, false, 'no se descarga raw de la fuente');
  for (const key of GASOLINA_KEYS) {
    assert.equal(informe.snapshots[key], manifest.products[key].bytes);
    assert.deepEqual(validateGasolinaBundle(manifest, key, cuerpo(key)), [], `bundle ${key} intacto`);
  }
});

test('1 · un bundle incompatible con el cliente no se publica', async () => {
  const incompatible = { ...manifest, schema_version: '9.9.9' };
  assert.notDeepEqual(validateGasolinaManifest(incompatible), [], 'el contrato rechaza una versión desconocida');
  const origen = await servir(bundlePublico(JSON.stringify(incompatible)));
  const salida = await correrAsync(['scripts/fetch-live-bundle.mjs', origen], { TEST_MODE: '1' });
  assert.notEqual(salida.status, 0, 'no debe aceptar un manifest fuera de contrato');
  assert.match(salida.stderr, /Manifest remoto inválido/);
});

test('1 · un HTTP 200 con HTML no pasa por SVG válido', () => {
  const html = '<!DOCTYPE html><html><body>404</body></html>';
  assert.notDeepEqual(svgProblems(html), [], 'el HTML debe fallar el saneamiento');
  const problemas = brandAssetProblems({
    brandLogos: { repsol: BRAND_LOGOS.repsol },
    shellList: deriveShell({ root }).entries,
    read: () => ({ ok: true, body: html, contentType: 'text/html; charset=utf-8' }),
  });
  assert.ok(problemas.some((motivo) => /text\/html/.test(motivo)), 'debe delatar el content-type');
  assert.ok(problemas.length > 1, 'y además el contenido');
});

// ── 2 · Aislamiento comercial ─────────────────────────────────────────────────

test('2 · un nombre sin respaldo se retira solo a sí mismo (rancio, pendiente, incorrecto)', () => {
  const catalog = loadValidatedCommercialCatalog(path.join(identityRoot, CATALOG));
  const audit = loadValidatedCommercialAudit(path.join(identityRoot, AUDIT));
  const sano = commercialNameBacking(catalog, audit);
  assert.deepEqual(sano.problems, [], 'el estado real está limpio');

  const muestreada = audit.entries.find((row) => (row.claim ?? 'name') === 'name');
  const editado = structuredClone(catalog);
  const objetivo = editado.entries.find((item) => item.establishment_id === muestreada.establishment_id);
  objetivo.public_site_name = `${objetivo.public_site_name} (editado)`;
  const rancio = commercialNameBacking(editado, audit);
  assert.equal(rancio.approved.has(objetivo.establishment_id), false, 'pierde el respaldo la entrada tocada');
  assert.equal(rancio.approved.size, sano.approved.size - 1, 'y solo ella');
  assert.deepEqual(rancio.problems.map((problema) => problema.reason), ['audit_stale']);

  const pendiente = structuredClone(audit);
  pendiente.entries.find((row) => (row.claim ?? 'name') === 'name').result = 'pending';
  assert.equal(commercialNameBacking(catalog, pendiente).approved.size, sano.approved.size - 1);

  // FIX #1: un veredicto `incorrect` tampoco publica ese nombre.
  const incorrecta = structuredClone(audit);
  incorrecta.entries.find((row) => (row.claim ?? 'name') === 'name').result = 'incorrect';
  const conIncorrecta = commercialNameBacking(catalog, incorrecta);
  assert.equal(conIncorrecta.approved.has(muestreada.establishment_id), false, 'el nombre marcado incorrect no se publica');
  assert.equal(conIncorrecta.approved.size, sano.approved.size - 1, 'y los demás se conservan');
  assert.deepEqual(conIncorrecta.problems.map((problema) => `${problema.reason}:${problema.affected}`), ['audit_incorrect:1']);
  assert.equal(conIncorrecta.incorrect_links, 1);
});

test('2 · un ID comercial fuera del Registro se descarta, no tumba la proyección', () => {
  const catalog = loadValidatedCommercialCatalog(path.join(identityRoot, CATALOG));
  const ids = catalog.entries.map((item) => item.establishment_id);
  const recortado = buildCommercialCatalogIndex(catalog, { registryIds: ids.slice(0, -3), offerIds: ids });
  assert.equal(recortado.metrics.unknown_anchors, 3);
  assert.equal(recortado.unknownAnchors.length, 3);
  assert.equal(recortado.byAnchor.size, ids.length - 3, 'el resto se sigue proyectando');
});

test('2 · un duplicado se aísla (las dos copias) y el resto del catálogo sobrevive', () => {
  // FIX #6: antes el validador rechazaba el catálogo entero y toda la identidad
  // quedaba neutral por una sola fila repetida.
  const catalog = loadValidatedCommercialCatalog(path.join(identityRoot, CATALOG));
  const duplicado = structuredClone(catalog);
  duplicado.entries.push(structuredClone(duplicado.entries[3]));
  const aislado = isolateCommercialCatalog(duplicado);
  assert.equal(aislado.dropped.length, 2, 'se retiran las dos copias, no se elige una');
  assert.ok(aislado.dropped.every((item) => item.establishment_id === duplicado.entries[3].establishment_id));
  assert.equal(aislado.catalog.entries.length, catalog.entries.length - 1);
  assert.equal(isolateCommercialCatalog({ ...catalog, schema_version: '0.0.1' }), null, 'un defecto de nivel catálogo no se aísla');

  const dir = copiaDeIdentidad('duplicado', { mutate: (cat) => cat.entries.push(structuredClone(cat.entries[3])) });
  const resolucion = resolveCommercialIdentity({ catalogPath: path.join(dir, CATALOG), auditPath: path.join(dir, AUDIT) });
  assert.equal(resolucion.status, 'degraded');
  assert.equal(resolucion.isolated.length, 2);
  assert.ok(resolucion.counts.brand_published > 0, 'las marcas del resto del catálogo se conservan');
  assert.ok(resolucion.problems.some((problema) => problema.reason === 'entradas_aisladas' && problema.affected === 2));
});

test('2 · sin auditoría se publican precios y marcas, y la reproyección recupera', async () => {
  // Todo sobre copias: `identityRoot` apunta al scratchpad, nunca al expediente real.
  const completo = await buildGasolinaProjectionForPointer({ root, pointer, identityRoot: copiaDeIdentidad('completo') });
  assert.equal(completo.identity.status, 'complete');

  const degradado = await buildGasolinaProjectionForPointer({ root, pointer, identityRoot: copiaDeIdentidad('sin-auditoria', { audit: false }) });
  assert.equal(degradado.identity.status, 'degraded');
  for (const key of GASOLINA_KEYS) {
    assert.equal(degradado.datasets[key].offers.length, completo.datasets[key].offers.length, `los precios de ${key} no se frenan`);
  }
  const identidades = degradado.datasets.regular.offers.map((offer) => offer.commercial_identity).filter(Boolean);
  assert.ok(identidades.length > 0, 'quedan identidades publicables');
  assert.equal(identidades.every((identidad) => identidad.public_site_name === null), true, 'ningún nombre sin respaldo');
  assert.equal(identidades.every((identidad) => identidad.brand), true, 'las marcas válidas se conservan');
  assert.ok(degradado.identity.counts.name_withdrawn > 0 && degradado.identity.problems.length > 0, 'la degradación se cuenta y se explica');

  // Corregido el expediente, la reproyección devuelve la identidad y la misma revisión.
  const recuperado = await buildGasolinaProjectionForPointer({ root, pointer, identityRoot: copiaDeIdentidad('recuperado') });
  assert.equal(recuperado.identity.status, 'complete');
  assert.equal(recuperado.manifest.revision_id, completo.manifest.revision_id, 'revisión determinista');
});

test('2 · un paquete comercial ilegible deja la identidad neutral y sale en verde', () => {
  const dir = path.join(scratch, 'ilegible');
  const salida = correr(['scripts/identity-install.mjs'], { IDENTITY_ROOT: dir, COMMERCIAL_IDENTITY_B64: 'esto-no-es-gzip', COMMERCIAL_IDENTITY_B64_2: '' });
  assert.equal(salida.status, 0, 'no puede matar el job');
  const informe = JSON.parse(salida.stdout);
  assert.equal(informe.status, 'absent');
  assert.equal(informe.installed, false);
  assert.deepEqual(informe.active, { catalog: false, audit: false });
  assert.ok(informe.problems.length > 0);
});

test('2 · una instalación fallida no reutiliza la pareja anterior', () => {
  // FIX #2: antes el instalador informaba «ausente» pero dejaba en su sitio el
  // catálogo y la auditoría previos, y la proyección los volvía a cargar.
  const dir = copiaDeIdentidad('previa');
  const salida = correr(['scripts/identity-install.mjs'], { IDENTITY_ROOT: dir, COMMERCIAL_IDENTITY_B64: 'esto-no-es-gzip', COMMERCIAL_IDENTITY_B64_2: '' });
  assert.equal(salida.status, 0);
  const informe = JSON.parse(salida.stdout);
  assert.deepEqual(informe.replaced.sort(), [AUDIT, CATALOG].sort(), 'la pareja anterior se aparta');
  assert.equal(fs.existsSync(path.join(dir, CATALOG)), false);
  assert.equal(fs.existsSync(path.join(dir, AUDIT)), false);
  assert.ok(fs.existsSync(path.join(dir, 'replaced', CATALOG)), 'y se conserva aparte, no se destruye');
  const resolucion = resolveCommercialIdentity({ catalogPath: path.join(dir, CATALOG), auditPath: path.join(dir, AUDIT) });
  assert.equal(resolucion.status, 'absent', 'la proyección no la vuelve a cargar');
  assert.equal(resolucion.counts.brand_published, 0);
});

test('2 · un catálogo nuevo no convive con una auditoría vieja', () => {
  // Paquete con catálogo válido y auditoría rota, sobre un directorio que ya
  // tenía una pareja válida: solo el catálogo queda activo.
  const dir = copiaDeIdentidad('mezcla');
  const catalogo = JSON.parse(huellaReal.catalog.toString('utf8'));
  const paquete = Buffer.from(JSON.stringify({ catalog: catalogo, audit: { schema_version: 'rota' } }));
  const { gzipSync } = globalThis.process.getBuiltinModule('node:zlib');
  const salida = correr(['scripts/identity-install.mjs'], { IDENTITY_ROOT: dir, COMMERCIAL_IDENTITY_B64: gzipSync(paquete).toString('base64'), COMMERCIAL_IDENTITY_B64_2: '' });
  assert.equal(salida.status, 0);
  const informe = JSON.parse(salida.stdout);
  assert.deepEqual(informe.active, { catalog: true, audit: false });
  assert.equal(informe.status, 'degraded');
  assert.equal(fs.existsSync(path.join(dir, AUDIT)), false, 'la auditoría vieja no sigue ahí');
  const resolucion = resolveCommercialIdentity({ catalogPath: path.join(dir, CATALOG), auditPath: path.join(dir, AUDIT) });
  assert.equal(resolucion.status, 'degraded');
  assert.equal(resolucion.counts.name_published, 0, 'sin auditoría no hay nombres');
  assert.ok(resolucion.counts.brand_published > 0, 'pero sí marcas');
});

// ── 3 · Protecciones intactas ─────────────────────────────────────────────────

test('3 · un defecto real sigue impidiendo la promoción', () => {
  const catalog = loadValidatedCommercialCatalog(path.join(identityRoot, CATALOG));
  assert.throws(() => buildCommercialCatalogIndex(catalog, { registryIds: [], offerIds: [] }), /Universo del Registro vacío/);
  for (const status of ['unverifiable', 'needs_review', 'rejected']) {
    assert.equal(publicationDecision({ status }).action, 'fail_closed', status);
    assert.equal(publicationDecision({ status }).deploy, false);
  }
  assert.equal(publicationDecision({ status: 'promoted', promoted: false }).action, 'fail_closed');
  assert.throws(() => publicationDecision({ status: 'inventado' }), /no permitido/);
  const roto = JSON.parse(cuerpo('regular'));
  roto.offers[0].price = -1;
  assert.notDeepEqual(validateGasolinaBundle(manifest, 'regular', `${JSON.stringify(roto)}\n`), [], 'un precio inválido bloquea');
});

test('3 · el bundle público no lleva información privada', () => {
  const prohibidos = ['razon_social', 'ruc', 'RUC', 'representante', 'telefono', 'correo', 'placa', 'brand_evidence', 'source', 'entity_link', 'publication'];
  for (const key of GASOLINA_KEYS) {
    for (const offer of JSON.parse(cuerpo(key)).offers) {
      assert.deepEqual(Object.keys(offer).sort(), [...PUBLIC_OFFER_FIELDS].sort(), 'allowlist exacta de oferta');
      for (const campo of prohibidos) assert.equal(Object.hasOwn(offer, campo), false, `${campo} fuera del bundle`);
      if (offer.commercial_identity) assert.deepEqual(Object.keys(offer.commercial_identity).sort(), ['brand', 'confidence', 'public_site_name']);
    }
  }
});

test('3 · la recuperación no depende de que la identidad esté sana', async () => {
  // `rollback` reconstruye y valida ambos productos antes de mover el pointer; con
  // la puerta comercial ni siquiera llegaba a hacerlo. Copia con catálogo ilegible.
  const dir = copiaDeIdentidad('catalogo-roto');
  fs.writeFileSync(path.join(dir, CATALOG), '{ esto no es json', { mode: 0o600 });
  const proyeccion = await buildGasolinaProjectionForPointer({ root, pointer, identityRoot: dir });
  assert.equal(proyeccion.identity.status, 'absent');
  assert.ok(proyeccion.datasets.regular.offers.length > 0, 'se puede reconstruir para recuperar');
});

// ── 4 · Ruta y concurrencia ───────────────────────────────────────────────────

test('4 · la ruta se resuelve sobre el rango completo del push', () => {
  assert.equal(resolveRoute({ eventName: 'push', changedPaths: ['web/app.js', 'README.md'] }).route, 'shell');
  assert.equal(resolveRoute({ eventName: 'push', changedPaths: ['README.md'] }).route, 'docs');
  assert.equal(resolveRoute({ eventName: 'push', changedPaths: ['web/icons/brands/x.svg', 'scripts/install-brand-logo.mjs'] }).route, 'shell');
  assert.equal(resolveRoute({ eventName: 'push', changedPaths: ['web/app.js', 'pipeline/project-gasolina.mjs'] }).route, 'project');
  const sinRango = resolveRoute({ eventName: 'push', changedPaths: [], previousCommitValid: false });
  assert.equal(sinRango.route, 'project');
  assert.match(sinRango.reason, /sin rango previo/);
  assert.equal(resolveRoute({ eventName: 'push', changedPaths: ['web/data/gasolina/manifest.json'] }).route, 'docs', 'la proyección generada no es un cambio de shell');
});

test('4 · una corrida vieja no pisa una publicación más nueva', async () => {
  const masNuevo = { ...refreshState, snapshot_id: '2099-01-01-20990101T000000000Z-1-ffffff' };
  const origen = await servir(bundlePublico(manifestTexto0, JSON.stringify(masNuevo)));
  const vieja = await correrAsync(['scripts/preflight-deploy.mjs'], { ROUTE: 'data', PUBLIC_ORIGIN: origen, PREFLIGHT_MAIN_REF: 'HEAD' });
  assert.equal(vieja.status, 0, 'abortar no es un fallo');
  const informeViejo = JSON.parse(vieja.stdout);
  assert.equal(informeViejo.deploy, false);
  assert.match(informeViejo.reason, /corrida_desactualizada/);

  const alDia = await correrAsync(['scripts/preflight-deploy.mjs'], { ROUTE: 'data', PUBLIC_ORIGIN: await servir(bundlePublico()), PREFLIGHT_MAIN_REF: 'HEAD' });
  assert.equal(JSON.parse(alDia.stdout).deploy, true, 'la corrida vigente sí publica');
});

test('4 · ninguna ruta publica código anterior a la punta de main', async () => {
  // FIX #3: `data` y `project` también suben `web/` entero. Solo se tolera un
  // adelanto de documentación, que no cambia lo publicado.
  for (const cambio of [['web/app.js'], ['pipeline/project-gasolina.mjs'], ['scripts/refresh.mjs']]) {
    const veredicto = codeRegression({ head: 'aaaaaaa1', tip: 'bbbbbbb2', isAncestor: true, changedPaths: cambio });
    assert.match(veredicto?.reason ?? '', /codigo_desactualizado/, `${cambio} debe abortar`);
  }
  assert.equal(codeRegression({ head: 'aaaaaaa1', tip: 'bbbbbbb2', isAncestor: true, changedPaths: ['README.md', 'docs/datos.md'] }), null, 'documentación no aborta');
  assert.match(codeRegression({ head: 'aaaaaaa1', tip: 'bbbbbbb2', isAncestor: false }).reason, /no es ancestro/);
  assert.equal(codeRegression({ head: 'x', tip: 'x', isAncestor: true }), null);

  // Sin forma de consultar main no se publica: revalidar es la única garantía.
  const sinMain = await correrAsync(['scripts/preflight-deploy.mjs'], { ROUTE: 'project', PUBLIC_ORIGIN: await servir(bundlePublico()), PREFLIGHT_MAIN_REF: 'refs/no/existe' });
  const informe = JSON.parse(sinMain.stdout);
  assert.equal(informe.deploy, false);
  assert.match(informe.reason, /sin_verificacion_de_main/);
});

test('4 · la reproyección usa el snapshot privado y no consulta la fuente', () => {
  // FIX #4b: `project` con snapshot utilizable no ejecuta refresh.mjs.
  const privado = usablePrivateSnapshot(root, { publishedSnapshotId: refreshState.snapshot_id });
  assert.equal(privado.ok, true, privado.missing.join('; '));
  assert.equal(privado.snapshot_id, pointer.snapshot_id);
  assert.equal(usablePrivateSnapshot(root, { publishedSnapshotId: '2099-01-01-x' }).ok, false, 'no se reproyecta un snapshot más viejo que el publicado');
  const decision = publicationDecisionForRoute('project', null, { reusedSnapshot: privado.snapshot_id });
  assert.equal(decision.action, 'reproject_verify_deploy');
  assert.equal(decision.project, true);
  assert.equal(decision.deploy, true);
  // Sin snapshot utilizable la ruta cae al refresco, que es la decisión de datos.
  assert.throws(() => publicationDecisionForRoute('project', null, {}), /ausente o inválido/);
});

// ── 5 · Poda y operación ──────────────────────────────────────────────────────

test('5 · los documentos activos no enlazan a lo eliminado ni repiten normas superadas', () => {
  const vivos = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'DESIGN.md', 'docs/datos.md', 'docs/roadmap.md'];
  const superadas = [/0\/717/, /Capa 5/, /Capa 6/, /35 revisiones/, /sin tests automatizados/, /Loop MVP/];
  for (const archivo of vivos) {
    const texto = fs.readFileSync(path.join(root, archivo), 'utf8');
    for (const enlace of texto.matchAll(/\]\(([^)#][^)]*)\)/g)) {
      if (/^https?:|^mailto:/.test(enlace[1])) continue;
      assert.ok(fs.existsSync(path.join(root, path.dirname(archivo), enlace[1].split('#')[0])), `${archivo} enlaza a ${enlace[1]}`);
    }
    for (const patron of superadas) assert.doesNotMatch(texto, patron, `${archivo} conserva una norma superada: ${patron}`);
  }
  for (const eliminado of ['HANDOFF.md', 'BITACORA.md', 'SPEC-OPT.md', 'SPEC-precios-marcas-ubicacion.md', 'docs/descubrimiento.md', 'docs/factibilidad.md', 'docs/aportes.md', 'docs/arquitectura.html']) {
    assert.equal(fs.existsSync(path.join(root, eliminado)), false, `${eliminado} debía retirarse`);
  }
});

test('5 · los roles quedan separados y sin permiso automático de deploy', () => {
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  assert.match(agents, /Parte 1[\s\S]*Parte 2/, 'reglas comunes y rol del Líder separados');
  assert.match(claude, /No hace commit, push ni deploy/);
  assert.doesNotMatch(claude, /GO`\/`FIX`\/`KILL`.*decides/i);
});

test('5 · Petroperú sigue intacto, sin registrar y fuera del precache', () => {
  const archivo = path.join(root, 'web', 'icons', 'brands', 'petroperu.svg');
  assert.ok(fs.existsSync(archivo), 'el archivo repuesto por Bruno no se toca');
  assert.deepEqual(svgProblems(fs.readFileSync(archivo, 'utf8')), [], 'y es un SVG sano');
  assert.equal(Object.values(BRAND_LOGOS).some((entry) => entry.slug === 'petroperu'), false, 'no está registrado');
  const shell = deriveShell({ root }).entries;
  assert.equal(shell.includes('/icons/brands/petroperu.svg'), false, 'no entra al precache');
  const seguimiento = spawnSync('git', ['ls-files', '--error-unmatch', 'web/icons/brands/petroperu.svg'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(seguimiento.status, 0, 'sigue sin seguimiento en git');
  // La sonda recorre el registro, no el directorio: un SVG sin registrar no falla.
  assert.deepEqual(brandAssetProblems({
    brandLogos: BRAND_LOGOS,
    shellList: shell,
    read: (ruta) => ({ ok: true, body: fs.readFileSync(path.join(root, 'web', ruta.replace(/^\//, '')), 'utf8') }),
  }), []);
});

test('5 · la precache y su versión se derivan del contenido, sin bump a mano', () => {
  const swSource = fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8');
  const base = deriveShell({ root });
  assert.deepEqual(base.problems, [], 'el árbol actual deriva sin problemas');
  assert.match(base.cache, /^masfacil-shell-[a-f0-9]{12}$/, 'la versión es la huella del contenido');
  for (const entrada of base.entries) assert.ok(fs.existsSync(path.join(root, shellEntryFile(entrada))), `${entrada} existe en el árbol`);
  assert.equal(shellEntryFile('/'), 'web/index.html');
  // El módulo generado en disco tiene que coincidir con el árbol: verificar no genera.
  assert.deepEqual(shellManifestProblems({ root }).problems, [], 'el manifest en disco está al día');
  assert.equal(renderShellManifest(base), fs.readFileSync(path.join(root, 'web', 'shell-manifest.js'), 'utf8'));
  // El mecanismo: el bump solo llega si sw.js importa el módulo generado.
  assert.deepEqual(serviceWorkerUpdateProblems(swSource), []);
  assert.equal(serviceWorkerUpdateProblems("import { SHELL } from './sw-cache-policy.js';").length, 1);
});

test('5 · la auditoría de publicación y el verificador pasan', () => {
  const auditoria = correr(['scripts/audit-publication.mjs', '--treeish', ':', '--strict-history']);
  assert.equal(auditoria.status, 0, auditoria.stdout || auditoria.stderr);
  const verificador = correr(['scripts/verify-web.mjs']);
  assert.equal(verificador.status, 0, verificador.stderr);
  assert.match(verificador.stdout, /cliente compatible/);
});

test('5 · la sonda no tocó el expediente real ni el bundle', () => {
  assert.ok(huellaReal.catalog.equals(fs.readFileSync(path.join(identityRoot, CATALOG))));
  assert.ok(huellaReal.audit.equals(fs.readFileSync(path.join(identityRoot, AUDIT))));
  assert.equal(fs.existsSync(path.join(identityRoot, 'replaced')), false);
  assert.equal(fs.existsSync(path.join(identityRoot, 'identity-problems.json')), false);
  assert.equal(fs.readFileSync(path.join(dataRoot, 'manifest.json'), 'utf8'), manifestTexto0);
});
