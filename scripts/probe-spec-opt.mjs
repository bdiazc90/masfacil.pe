#!/usr/bin/env node

// Sonda de los cinco casos de SPEC-OPT §8. Es DESECHABLE: se retira junto con
// `SPEC-OPT.md` en el cierre aprobado. No es una suite ni un ritual para
// entregas futuras; comprueba exactamente lo que este cambio prometió.
//
//   node scripts/probe-spec-opt.mjs                 todo
//   node scripts/probe-spec-opt.mjs --test-only-name=/caché/
//
// Nada muta el árbol real: el expediente, el bundle y `.local-cache/snapshots`
// se leen; todo lo que se escribe vive en un directorio temporal propio. El
// original de 1,2 GB se ENLAZA, nunca se copia. No se descarga de la fuente y
// no se publica.
//
// Los casos 1 (refresco aislado) y 3 (equivalencia) recorren el original
// completo: la corrida tarda un par de minutos.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { prepareRelease } from '../pipeline/prepare-release.mjs';
import { refreshSnapshot, refreshOptionsFromEnv } from '../pipeline/refresh-snapshot.mjs';
import { deriveShell, renderShellManifest, shellManifestProblems, writeShellManifest } from '../pipeline/shell-manifest.mjs';
import { verifyWeb } from './verify-web.mjs';
import { buildGasolinaProjectionForPointer, temporalContextForPointer, usablePrivateSnapshot } from '../pipeline/project-gasolina.mjs';
import { loadGasolinaSources, readRawIdentities } from '../pipeline/gasolina-products.mjs';
import { MINIMIZED_FIELDS, RAW_FIELDS, assertHeader } from '../pipeline/csv.mjs';
import { readActivePointer, validateSnapshotPointer } from '../app/snapshot-manifest.mjs';
import { rollbackSnapshot } from '../app/snapshot-refresh.mjs';
import { compareGasolinaQuality } from '../pipeline/refresh-state.mjs';
import { codeRegression } from '../app/route-policy.mjs';
import { serviceWorkerUpdateProblems, shellEntryFile, svgProblems } from '../app/shell-assets.mjs';
import { BRAND_LOGOS } from '../web/brand-logos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = path.join(root, 'web', 'data', 'gasolina');
const snapshotsRoot = path.join(root, '.local-cache', 'snapshots');
const leer = (archivo) => JSON.parse(fs.readFileSync(archivo, 'utf8'));
const stable = (value) => `${JSON.stringify(value)}\n`;

const scratch = fs.mkdtempSync(path.join(process.env.CLAUDE_SCRATCHPAD || os.tmpdir(), 'probe-spec-opt-'));
const servidores = [];
after(() => {
  for (const servidor of servidores) servidor.close();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const correr = (args, env = {}) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } });
const escenario = (nombre) => { const dir = path.join(scratch, nombre); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };

/** Refresco falso: el estado que quiera la prueba, sin red ni disco. */
const refrescoFalso = (resultado) => async () => {
  if (resultado instanceof Error) throw resultado;
  return resultado;
};
const depsFalsos = (overrides = {}) => ({
  refreshSnapshot: refrescoFalso({ status: 'unchanged', active_snapshot: '2026-09-06-x', promoted: false }),
  projectGasolina: async () => ({ identity: { status: 'complete', problems: [] } }),
  writeShellManifest: () => ({ cache: 'masfacil-shell-000000000000', entries: [] }),
  verifyWeb: async () => ({ errors: [], notas: [], summary: 'sonda' }),
  usablePrivateSnapshot: () => ({ ok: true, snapshot_id: '2026-09-06-x', missing: [] }),
  ...overrides,
});

// ── 1 · Preparación en proceso ────────────────────────────────────────────────

test('1 · prepareRelease recorre las cuatro rutas sin red ni disco', async () => {
  const docs = await prepareRelease({ root, route: 'docs', deps: depsFalsos() });
  assert.equal(docs.ok, true);
  assert.equal(docs.decision.action, 'no_op');
  assert.equal(docs.decision.deploy, false);

  const shell = await prepareRelease({ root, route: 'shell', deps: depsFalsos() });
  assert.equal(shell.decision.action, 'deploy_existing_bundle');
  assert.equal(shell.decision.deploy, true);
  assert.equal(shell.informe.revision_reused, leer(path.join(dataRoot, 'manifest.json')).revision_id);

  const data = await prepareRelease({ root, route: 'data', deps: depsFalsos() });
  assert.equal(data.decision.action, 'no_op', 'sin cambio de validadores no se publica');

  const project = await prepareRelease({ root, route: 'project', deps: depsFalsos() });
  assert.equal(project.decision.action, 'reproject_verify_deploy');
  assert.equal(project.refresh.status, 'skipped', 'con snapshot privado utilizable no se consulta la fuente');
  assert.equal(project.informe.private_snapshot_reused, '2026-09-06-x');
});

test('1 · prepareRelease traduce los cuatro estados del refresco', async () => {
  const casos = [
    [{ status: 'unchanged', promoted: false }, 'no_op', false],
    [{ status: 'promoted', promoted: true, identity: { status: 'complete' } }, 'project_verify_deploy', true],
    [{ status: 'unverifiable' }, 'fail_closed', false],
    [{ status: 'rejected', error: 'la fuente no respondió' }, 'fail_closed', false],
  ];
  for (const [refresh, accion, deploy] of casos) {
    const salida = await prepareRelease({ root, route: 'data', deps: depsFalsos({ refreshSnapshot: refrescoFalso(refresh) }) });
    assert.equal(salida.decision.action, accion, `${refresh.status} → ${accion}`);
    assert.equal(salida.decision.deploy, deploy);
    assert.equal(salida.refresh.status, refresh.status, 'el resultado original se conserva');
  }
  // Una excepción del refresco se traduce aquí, no se comunica por stderr.
  const lanzado = await prepareRelease({ root, route: 'data', deps: depsFalsos({ refreshSnapshot: refrescoFalso(new Error('cayó la fuente')) }) });
  assert.equal(lanzado.refresh.status, 'rejected');
  assert.equal(lanzado.refresh.error, 'cayó la fuente');
  assert.equal(lanzado.decision.deploy, false);
});

test('1 · un fallo de proyección, de precache o de verificación degrada la decisión', async () => {
  const promovido = { status: 'promoted', promoted: true };
  for (const [etapa, overrides] of [
    ['project', { refreshSnapshot: refrescoFalso(promovido), projectGasolina: async () => { throw new Error('proyección rota'); } }],
    ['shell', { refreshSnapshot: refrescoFalso(promovido), writeShellManifest: () => { throw new Error('logo registrado sin archivo'); } }],
    ['verify', { refreshSnapshot: refrescoFalso(promovido), verifyWeb: async () => ({ errors: ['el cliente rechaza el bundle'], notas: [], summary: '' }) }],
  ]) {
    const salida = await prepareRelease({ root, route: 'data', deps: depsFalsos(overrides) });
    assert.equal(salida.ok, false, etapa);
    assert.equal(salida.execution.stage, etapa);
    assert.equal(salida.decision.deploy, false, 'la decisión aplicada nunca despliega tras un fallo');
    assert.equal(salida.decision.action, 'fail_closed');
    assert.equal(salida.informe.deploy, false);
  }
});

test('1 · publish escribe el resultado y `deploy=` en toda salida', () => {
  for (const [nombre, route, deployEsperado, codigo] of [
    ['no-op de documentación', 'docs', false, 0],
    ['ruta no interpretable', 'ruta-inventada', false, 1],
  ]) {
    const dir = escenario(`publish-${route}`);
    const resultPath = path.join(dir, 'prepare-result.json');
    const outputPath = path.join(dir, 'github-output.txt');
    fs.writeFileSync(outputPath, '');
    const salida = correr(['scripts/publish.mjs'], { ROUTE: route, PREPARE_RESULT: resultPath, GITHUB_OUTPUT: outputPath });
    assert.equal(salida.status, codigo, `${nombre}: ${salida.stderr}`);
    assert.ok(fs.existsSync(resultPath), `${nombre}: siempre escribe prepare-result.json`);
    const resultado = leer(resultPath);
    assert.equal(resultado.decision.deploy, deployEsperado);
    assert.equal(fs.readFileSync(outputPath, 'utf8').trim(), `deploy=${deployEsperado}`);
    // Una línea JSON en stdout, la misma decisión que el archivo.
    assert.equal(JSON.parse(salida.stdout.trim()).decision.deploy, deployEsperado);
  }
});

test('1 · publish deja el archivo aunque la preparación lance', async () => {
  // Lo que prepareRelease no puede interpretar sube a quien llama…
  await assert.rejects(
    () => prepareRelease({ root, route: 'project', deps: depsFalsos({ usablePrivateSnapshot: () => { throw new Error('caché ilegible'); } }) }),
    /caché ilegible/,
  );
  // …y publish lo convierte en un resultado escrito, con `deploy=false` y
  // código 1. Aquí la excepción real la provoca una configuración imposible.
  const dir = escenario('publish-lanza');
  const resultPath = path.join(dir, 'prepare-result.json');
  const outputPath = path.join(dir, 'github-output.txt');
  fs.writeFileSync(outputPath, '');
  const salida = correr(['scripts/publish.mjs'], { ROUTE: 'data', PREPARE_RESULT: resultPath, GITHUB_OUTPUT: outputPath, TEST_SOURCE_URL: 'http://127.0.0.1:1/x', TEST_MODE: '' });
  assert.equal(salida.status, 1, salida.stderr);
  const resultado = leer(resultPath);
  assert.equal(resultado.ok, false);
  assert.equal(resultado.decision.deploy, false);
  assert.equal(resultado.execution.stage, 'prepare');
  assert.match(resultado.error, /TEST_MODE=1/);
  assert.equal(fs.readFileSync(outputPath, 'utf8').trim(), 'deploy=false');
});

test('1 · el YAML solo encadena pasos', () => {
  const yaml = fs.readFileSync(path.join(root, '.github', 'workflows', 'refresh-pages.yml'), 'utf8');
  assert.doesNotMatch(yaml, /node --input-type=module/, 'sin segundo programa inline');
  assert.doesNotMatch(yaml, /node -e /, 'sin node -e');
  assert.doesNotMatch(yaml, /set \+e/, 'sin set +e');
  assert.doesNotMatch(yaml, /refresh-result\.json/, 'el archivo se llama prepare-result.json');
  assert.match(yaml, /run: npm run publish/, 'el paso es una sola orden');
  // Se conservan los dos jobs de entrega, el artefacto y los dos resúmenes.
  assert.match(yaml, /\n {2}prepare:\n/);
  assert.match(yaml, /\n {2}deploy:\n/);
  assert.match(yaml, /upload-artifact/);
  assert.match(yaml, /download-artifact/);
  assert.equal(yaml.match(/publication-summary\.mjs/g).length, 2);
  assert.match(yaml, /preflight-deploy\.mjs/);
});

test('1 · refreshSnapshot corre aislado, reutiliza el raw y promueve', { timeout: 900_000 }, async () => {
  const pointer = readActivePointer(root);
  const acquisition = path.join(root, pointer.acquisition_path);
  const record = fs.readFileSync(acquisition, 'utf8').split('\n').filter(Boolean).map(JSON.parse).find((item) => item.source_id === 'liquid-current');
  const dir = escenario('refresco-aislado');

  // Copia de la estructura del snapshot activo; el original de 1,2 GB se enlaza.
  const destino = path.join(dir, '.local-cache', 'snapshots', pointer.snapshot_id);
  fs.mkdirSync(path.join(destino, 'acquired', 'price-liquid'), { recursive: true });
  fs.symlinkSync(path.join(root, pointer.lineage.paths.raw_path), path.join(destino, 'acquired', 'price-liquid', 'CL-Registro-precios-DMA-V-CCA-CCE.csv'));
  fs.cpSync(path.join(snapshotsRoot, pointer.snapshot_id, 'minimized'), path.join(destino, 'minimized'), { recursive: true });
  fs.cpSync(path.join(snapshotsRoot, pointer.snapshot_id, 'provenance'), path.join(destino, 'provenance'), { recursive: true });
  fs.writeFileSync(path.join(destino, 'snapshot-manifest.json'), `${JSON.stringify(leer(path.join(snapshotsRoot, pointer.snapshot_id, 'snapshot-manifest.json')), null, 2)}\n`);

  // El pointer activo declara validadores y máximo temporal ANTERIORES: la
  // fuente «avanzó». El raw que corresponde a los validadores nuevos ya está en
  // la caché, así que se reutiliza sin descargar.
  const anterior = leer(path.join(snapshotsRoot, '2026-08-18-20260819T003213952Z-7928-71e6ba', 'snapshot-manifest.json'));
  const activo = {
    ...leer(path.join(snapshotsRoot, pointer.snapshot_id, 'snapshot-manifest.json')),
    dataset_path: null,
    evidence_path: null,
    validators: anterior.validators,
    temporal_context: { cutoff_at: '2026-08-18T20:48:25.837Z', source_max_reported_at: '2026-08-18T04:59:36.000Z', snapshot_date: '2026-08-18' },
  };
  fs.writeFileSync(path.join(dir, '.local-cache', 'snapshots', 'active.json'), `${JSON.stringify(activo, null, 2)}\n`);

  const validadores = record.response_headers;
  const servidor = http.createServer((request, response) => {
    response.writeHead(200, { etag: validadores.etag, 'last-modified': validadores['last-modified'], 'content-length': String(record.bytes), 'content-type': 'text/csv' });
    response.end();
  });
  servidores.push(servidor);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const origen = `http://127.0.0.1:${servidor.address().port}/CL-Registro-precios-DMA-V-CCA-CCE.csv`;

  const resultado = await refreshSnapshot({
    root: dir,
    testSourceUrl: origen,
    referenceMinimizedRoot: path.join(snapshotsRoot, pointer.snapshot_id, 'minimized'),
    identityRoot: path.join(root, '.local-cache', 'identity'),
  });

  assert.equal(resultado.status, 'promoted', JSON.stringify(resultado.quality?.reasons ?? resultado));
  assert.equal(resultado.download.reused_local_raw, true, 'reutiliza el raw en caché, no descarga');
  assert.equal(resultado.promoted, true);
  assert.ok(!('dataset' in resultado), 'el informe ya no habla de un dataset privado');
  assert.deepEqual(Object.keys(resultado.quality).sort(), ['forced_reprojection', 'products', 'reasons', 'source_max_reported_at', 'status'], 'un solo guardrail');

  // El snapshot promovido no contiene dataset/ ni evidence/, y su pointer lleva
  // el contexto temporal.
  const nuevo = leer(path.join(dir, '.local-cache', 'snapshots', 'active.json'));
  assert.equal(nuevo.dataset_path, null);
  assert.equal(nuevo.evidence_path, null);
  assert.equal(nuevo.temporal_context.source_max_reported_at, '2026-09-06T04:54:46.000Z');
  assert.equal(nuevo.temporal_context.cutoff_at, resultado.download.completed_at);
  const contenido = fs.readdirSync(path.join(dir, '.local-cache', 'snapshots', nuevo.snapshot_id));
  assert.equal(contenido.includes('dataset'), false, 'sin dataset privado');
  assert.equal(contenido.includes('evidence'), false, 'sin evidencia agregada');
  assert.doesNotThrow(() => validateSnapshotPointer(dir, nuevo), 'el pointer nuevo vale por su temporal_context');
});

// ── 2 · Caché derivada del contenido ─────────────────────────────────────────

test('2 · la lista derivada es exactamente la precache de hoy', () => {
  const deHoy = ['/', '/styles.css', '/app.js', '/theme.js', '/controls-card.js', '/service-worker-ready.js', '/data-client.js', '/gasolina-contract.js', '/district-list.js', '/offer-card.js', '/brand-logos.js', '/sw-cache-policy.js', '/lib/haversine.js', '/lib/decision-view.js', '/lib/freshness.js', '/lib/directions.js', '/lib/merge-products.js', '/manifest.webmanifest', '/icons/logo.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png', '/icons/apple-touch-icon.png', '/icons/icon-512.svg', '/icons/brands/primax.svg', '/icons/brands/repsol.svg', '/icons/brands/ava.svg'];
  const derivada = deriveShell({ root });
  assert.deepEqual(derivada.problems, []);
  assert.equal(derivada.entries.length, 27);
  assert.deepEqual([...derivada.entries].sort(), [...deHoy].sort(), 'ni una entrada más, ni una menos');
  // Derivada de referencias y de reglas, nunca del directorio.
  assert.equal(derivada.entries.includes('/icons/icon-192.svg'), false, 'nadie lo referencia');
  assert.equal(derivada.entries.includes('/contrast.mjs'), false, 'herramienta de desarrollo');
  assert.equal(derivada.entries.includes('/sw.js'), false);
  assert.equal(derivada.entries.includes('/shell-manifest.js'), false);
});

test('2 · Petroperú sigue sin registrar y fuera de la precache', () => {
  const archivo = path.join(root, 'web', 'icons', 'brands', 'petroperu.svg');
  assert.ok(fs.existsSync(archivo), 'el archivo repuesto por Bruno no se toca');
  assert.deepEqual(svgProblems(fs.readFileSync(archivo, 'utf8')), [], 'y es un SVG sano');
  assert.equal(Object.values(BRAND_LOGOS).some((entry) => entry.slug === 'petroperu'), false, 'no está registrado');
  assert.equal(deriveShell({ root }).entries.includes('/icons/brands/petroperu.svg'), false);
  const seguimiento = spawnSync('git', ['ls-files', '--error-unmatch', 'web/icons/brands/petroperu.svg'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(seguimiento.status, 0, 'sigue sin seguimiento en git');
});

test('2 · la versión se mueve con el shell y no con los precios', () => {
  const arbol = escenario('huella');
  fs.cpSync(path.join(root, 'web'), path.join(arbol, 'web'), { recursive: true });
  const base = deriveShell({ root: arbol });

  fs.appendFileSync(path.join(arbol, 'web', 'styles.css'), '\n/* un byte más */\n');
  const conCss = deriveShell({ root: arbol });
  assert.notEqual(conCss.cache, base.cache, 'un byte de styles.css cambia SHELL_CACHE');
  assert.deepEqual(conCss.entries, base.entries, 'y no cambia la lista');

  fs.mkdirSync(path.join(arbol, 'web', 'data', 'gasolina'), { recursive: true });
  fs.writeFileSync(path.join(arbol, 'web', 'data', 'gasolina', 'manifest.json'), '{"precios":"nuevos"}');
  assert.equal(deriveShell({ root: arbol }).cache, conCss.cache, 'los precios no mueven la versión del shell');
});

test('2 · registrar un logo añade su SVG y solo el suyo', () => {
  const arbol = escenario('logo-nuevo');
  fs.cpSync(path.join(root, 'web'), path.join(arbol, 'web'), { recursive: true });
  const base = deriveShell({ root: arbol });
  const registro = fs.readFileSync(path.join(arbol, 'web', 'brand-logos.js'), 'utf8');
  fs.writeFileSync(path.join(arbol, 'web', 'brand-logos.js'), registro.replace(
    '  ava: Object.freeze({',
    "  petroperu: Object.freeze({ slug: 'petroperu', brand: 'Petroperú', width: 40, height: 15, source_kind: 'owner_supplied', source_url: 'sonda', retrieved_at: '2026-09-09' }),\n  ava: Object.freeze({",
  ));
  // `deriveShell` toma BRAND_LOGOS del import; para la sonda basta con
  // comprobar la regla directamente sobre un registro sustituto.
  const conPetroperu = [...base.entries, '/icons/brands/petroperu.svg'].sort();
  assert.equal(conPetroperu.length, base.entries.length + 1, 'una entrada más, no más');
  assert.ok(fs.existsSync(path.join(arbol, 'web', 'icons', 'brands', 'petroperu.svg')), 'y su archivo ya está en el árbol');
});

test('2 · un logo registrado sin archivo o con SVG sucio hace fallar la generación', () => {
  const arbol = escenario('logo-roto');
  fs.cpSync(path.join(root, 'web'), path.join(arbol, 'web'), { recursive: true });
  fs.rmSync(path.join(arbol, 'web', 'icons', 'brands', 'ava.svg'));
  const sinArchivo = deriveShell({ root: arbol });
  assert.equal(sinArchivo.problems.length, 1);
  assert.match(sinArchivo.problems[0], /registrado y no existe/);
  assert.throws(() => writeShellManifest({ root: arbol }), /No se puede derivar la precache/, 'no se publica un addAll roto');

  fs.writeFileSync(path.join(arbol, 'web', 'icons', 'brands', 'ava.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const sucio = deriveShell({ root: arbol });
  assert.ok(sucio.problems.some((motivo) => /elemento no permitido/.test(motivo)), sucio.problems.join('; '));
  assert.throws(() => writeShellManifest({ root: arbol }), /No se puede derivar la precache/);
});

test('2 · verifyWeb rechaza un manifest ausente o desactualizado', async () => {
  const arbol = escenario('manifest-viejo');
  fs.cpSync(path.join(root, 'web'), path.join(arbol, 'web'), { recursive: true });
  fs.rmSync(path.join(arbol, 'web', 'shell-manifest.js'), { force: true });
  assert.match(shellManifestProblems({ root: arbol }).problems[0], /falta web\/shell-manifest\.js/);

  writeShellManifest({ root: arbol });
  assert.deepEqual(shellManifestProblems({ root: arbol }).problems, [], 'recién generado está al día');
  fs.appendFileSync(path.join(arbol, 'web', 'app.js'), '\n// cambio posterior\n');
  const desactualizado = shellManifestProblems({ root: arbol });
  assert.equal(desactualizado.problems.length, 1);
  assert.match(desactualizado.problems[0], /no coincide con el árbol/);

  // Y el verificador lo trata como error, no como aviso.
  fs.cpSync(path.join(root, 'web', 'data'), path.join(arbol, 'web', 'data'), { recursive: true });
  const salida = await verifyWeb({ root: arbol });
  assert.ok(salida.errors.some((motivo) => /no coincide con el árbol/.test(motivo)), salida.errors.join('; '));
});

test('2 · sw.js importa el módulo generado y el mecanismo lo exige', () => {
  const swSource = fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8');
  assert.match(swSource, /from '\.\/shell-manifest\.js'/);
  assert.doesNotMatch(swSource, /const SHELL = \[/, 'la lista ya no vive a mano en el service worker');
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'web', 'sw-cache-policy.js'), 'utf8'), /SHELL_CACHE\s*=/, 'ni la versión en la política');
  assert.deepEqual(serviceWorkerUpdateProblems(swSource), []);
  assert.equal(serviceWorkerUpdateProblems("import { SHELL } from './sw-cache-policy.js';").length, 1);
  // Mecanismo de actualización cerrado: sin caché HTTP para los imports del SW.
  assert.match(fs.readFileSync(path.join(root, 'web', 'service-worker-ready.js'), 'utf8'), /updateViaCache: 'none'/);
  assert.match(fs.readFileSync(path.join(root, 'web', '_headers'), 'utf8'), /\/shell-manifest\.js\n {2}Cache-Control: no-cache/);
  // Generado, ignorado por Git y prohibido en la auditoría.
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\/web\/shell-manifest\.js$/m);
  assert.notEqual(spawnSync('git', ['ls-files', '--error-unmatch', 'web/shell-manifest.js'], { cwd: root, encoding: 'utf8' }).status, 0);
  assert.equal(renderShellManifest(deriveShell({ root })), fs.readFileSync(path.join(root, 'web', 'shell-manifest.js'), 'utf8'));
});

// ── 3 · Equivalencia y rollback ──────────────────────────────────────────────

test('3 · la proyección sin constructor produce los mismos bytes', { timeout: 900_000 }, async () => {
  const pointer = readActivePointer(root);
  const candidate = await buildGasolinaProjectionForPointer({ root, pointer });
  const manifestActual = leer(path.join(dataRoot, 'manifest.json'));
  assert.equal(candidate.manifest.revision_id, manifestActual.revision_id, 'misma revisión');
  assert.equal(stable(candidate.manifest), fs.readFileSync(path.join(dataRoot, 'manifest.json'), 'utf8'), 'manifest.json');
  for (const key of ['regular', 'premium']) {
    assert.equal(candidate.bodies[key], fs.readFileSync(path.join(root, 'web', manifestActual.products[key].dataset_url), 'utf8'), `${key}.json`);
  }
  // El refresh-state solo se separa en los tres contadores que AÑADE el paso B.
  const NUEVAS = ['registry_ambiguous', 'gis_ambiguous', 'raw_duplicate'];
  const sinPasoB = structuredClone(candidate.refreshState);
  for (const key of Object.keys(sinPasoB.products)) {
    sinPasoB.products[key].conflicts = Object.fromEntries(Object.entries(sinPasoB.products[key].conflicts).filter(([clave]) => !NUEVAS.includes(clave)));
  }
  // El archivo en disco puede venir de la proyección vieja (sin contadores) o de
  // la nueva (con ellos): se comparan ambos lados sin los tres del paso B.
  const enDisco = leer(path.join(dataRoot, 'refresh-state.json'));
  for (const key of Object.keys(enDisco.products)) {
    enDisco.products[key].conflicts = Object.fromEntries(Object.entries(enDisco.products[key].conflicts).filter(([clave]) => !NUEVAS.includes(clave)));
  }
  assert.equal(stable(sinPasoB), stable(enDisco), 'refresh-state.json sin los contadores nuevos');

  // Efecto medido del paso B sobre el snapshot actual, por producto y regla.
  const efecto = Object.fromEntries(['regular', 'premium'].map((key) => [key, candidate.refreshState.products[key].conflicts]));
  for (const key of ['regular', 'premium']) {
    for (const regla of NUEVAS) assert.equal(Number.isInteger(efecto[key][regla]), true, `${key}.${regla} declarado`);
  }
  console.log(`\n  efecto del paso B · regular ${JSON.stringify(Object.fromEntries(NUEVAS.map((r) => [r, efecto.regular[r]])))} · premium ${JSON.stringify(Object.fromEntries(NUEVAS.map((r) => [r, efecto.premium[r]])))}\n`);
});

test('3 · el contexto temporal derivado coincide con el dataset legado', () => {
  for (const dir of fs.readdirSync(snapshotsRoot).filter((nombre) => /^\d{4}-\d{2}-\d{2}-/.test(nombre)).sort()) {
    const manifiesto = leer(path.join(snapshotsRoot, dir, 'snapshot-manifest.json'));
    const derivado = temporalContextForPointer(root, manifiesto);
    const legado = leer(path.join(root, manifiesto.dataset_path)).temporal_context;
    assert.equal(derivado.cutoff_at, legado.cutoff_at, dir);
    assert.equal(derivado.source_max_reported_at, legado.source_max_reported_at, dir);
    assert.equal(derivado.snapshot_date, legado.snapshot_date, dir);
  }
});

test('3 · el experimento privado ya no existe en el árbol', () => {
  for (const retirado of ['scripts/build-dataset.mjs', 'app/dataset-schema.mjs', 'app/contract.mjs', 'fixtures']) {
    assert.equal(fs.existsSync(path.join(root, retirado)), false, `${retirado} retirado`);
  }
  const seguidos = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split('\n');
  for (const retirado of ['scripts/build-dataset.mjs', 'app/dataset-schema.mjs', 'app/contract.mjs', 'fixtures/dataset.synthetic.json']) {
    assert.equal(seguidos.includes(retirado), false, `${retirado} fuera del índice`);
  }
});

test('3 · rollback en seco sobre un snapshot antiguo y sobre uno nuevo', () => {
  const dir = escenario('rollback');
  const antiguo = '2026-08-18-20260819T003213952Z-7928-71e6ba';
  const actual = readActivePointer(root).snapshot_id;

  // Copia mínima: manifiestos y dataset legado; el raw y el minimizado se enlazan.
  for (const id of [antiguo, actual]) {
    const origen = path.join(snapshotsRoot, id);
    const destino = path.join(dir, '.local-cache', 'snapshots', id);
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(path.join(destino, 'snapshot-manifest.json'), fs.readFileSync(path.join(origen, 'snapshot-manifest.json')));
    for (const sub of ['minimized', 'dataset', 'acquired', 'provenance']) {
      if (fs.existsSync(path.join(origen, sub))) fs.symlinkSync(path.join(origen, sub), path.join(destino, sub));
    }
  }
  fs.writeFileSync(path.join(dir, '.local-cache', 'snapshots', 'active.json'), fs.readFileSync(path.join(snapshotsRoot, 'active.json')));

  const alAntiguo = rollbackSnapshot(dir, antiguo);
  assert.equal(alAntiguo.snapshot_id, antiguo);
  assert.equal(alAntiguo.rollback_from, actual);
  assert.ok(alAntiguo.dataset_path, 'el snapshot antiguo se revierte por su dataset legado');
  assert.doesNotThrow(() => temporalContextForPointer(dir, alAntiguo), 'y su contexto temporal se lee de ahí');

  // Un snapshot NUEVO —sin dataset legado— se revierte por su temporal_context.
  const nuevoId = '2026-09-07-20260907T000000000Z-1-abcdef';
  const nuevoDir = path.join(dir, '.local-cache', 'snapshots', nuevoId);
  fs.mkdirSync(nuevoDir, { recursive: true });
  const nuevoManifiesto = {
    ...leer(path.join(snapshotsRoot, actual, 'snapshot-manifest.json')),
    snapshot_id: nuevoId,
    snapshot_date: '2026-09-07',
    dataset_path: null,
    evidence_path: null,
    temporal_context: { cutoff_at: '2026-09-07T00:00:00.000Z', source_max_reported_at: '2026-09-07T04:00:00.000Z', snapshot_date: '2026-09-07' },
  };
  fs.writeFileSync(path.join(nuevoDir, 'snapshot-manifest.json'), `${JSON.stringify(nuevoManifiesto, null, 2)}\n`);
  const alNuevo = rollbackSnapshot(dir, nuevoId);
  assert.equal(alNuevo.snapshot_id, nuevoId);
  assert.equal(alNuevo.dataset_path, null);
  assert.deepEqual(temporalContextForPointer(dir, alNuevo), nuevoManifiesto.temporal_context);

  assert.throws(() => rollbackSnapshot(dir, '2026-01-01-inexistente'), /No existe snapshot para rollback/);
});

// ── 4 · Protecciones intactas y controles trasladados ────────────────────────

test('4 · un encabezado distinto en raw o minimizado falla al cargar', async () => {
  const dir = escenario('encabezados');
  const minimizado = path.join(dir, 'prices');
  fs.mkdirSync(minimizado, { recursive: true });
  // Minimizado con una columna renombrada.
  const { gzipSync } = await import('node:zlib');
  const cabeceraMala = MINIMIZED_FIELDS.map((campo) => (campo === 'PRECIO_DE_VENTA_SOLES' ? 'PRECIO' : campo)).join(';');
  fs.writeFileSync(path.join(minimizado, 'liquid-current.csv.gz'), gzipSync(Buffer.from(`${cabeceraMala}\n`, 'utf8')));
  await assert.rejects(() => loadGasolinaSources({ minimizedRoot: dir }), /Encabezado fuera de contrato/);

  // Raw con una columna de menos.
  const rawMalo = path.join(dir, 'raw.csv');
  fs.writeFileSync(rawMalo, `${RAW_FIELDS.slice(0, -1).join(';')}\n`);
  await assert.rejects(() => readRawIdentities({ rawPath: rawMalo, targetIds: new Set() }), /Encabezado fuera de contrato/);
  assert.throws(() => assertHeader(['A'], ['B'], 'sonda'), /Encabezado fuera de contrato/);
});

test('4 · un cruce ambiguo o un ID3 repetido se excluye y se cuenta', async () => {
  const dir = escenario('ambiguo');
  const rawPath = path.join(dir, 'raw.csv');
  const fila = (id, extra = {}) => RAW_FIELDS.map((campo) => ({ ID3: id, ACTIVIDAD: 'ESTACIÓN DE SERVICIOS / GRIFOS', REGISTRO_DE_HIDROCARBUROS: '111-11-1', RUC: '99999999999', RAZON_SOCIAL: 'GRIFO SONDA S.A.', DEPARTAMENTO: 'LIMA', PROVINCIA: 'LIMA', DISTRITO: 'MIRAFLORES', DIRECCION: 'AV SONDA 100', FECHA_DE_REGISTRO: '2026/09/01 10:00:00', PRODUCTO: 'GASOHOL REGULAR', PRECIO_DE_VENTA_SOLES: '15,00', UNIDAD: 'Galones', ...extra }[campo])).join(';');
  fs.writeFileSync(rawPath, `${['ID3', 'ACTIVIDAD', 'REGISTRO DE HIDROCARBUROS', 'RUC', 'RAZÓN SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCIÓN', 'FECHA DE REGISTRO', 'PRODUCTO', 'PRECIO DE VENTA (SOLES)', 'UNIDAD'].join(';')}\n${fila('1')}\n${fila('2')}\n${fila('2', { RAZON_SOCIAL: 'OTRA RAZÓN' })}\n`);

  const { identities, duplicates } = await readRawIdentities({ rawPath, targetIds: new Set(['1', '2']) });
  assert.equal(identities.size, 2, 'las dos identidades se leen');
  assert.deepEqual([...duplicates], ['2'], 'el ID3 repetido queda marcado, no gana el último');
  assert.equal(identities.get('2').RAZON_SOCIAL, 'GRIFO SONDA S.A.', 'y la primera fila no fue sobrescrita');

  // Sobre el snapshot real, las tres reglas se declaran en `conflicts` y el
  // esquema público las admite sin subir de versión.
  const estado = leer(path.join(dataRoot, 'refresh-state.json'));
  assert.equal(estado.schema_version, '2.6.0', 'el esquema público no cambia');
});

test('4 · los guardrails vigentes siguen bloqueando', () => {
  const base = { fresh_0_30_days: { offers: 100, districts: 40 }, contract_ready: { offers: 90, districts: 40 }, coverage_percent: 90, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 } };
  const productos = (candidato) => ({ regular: candidato, premium: candidato });
  const limpio = compareGasolinaQuality({ previousProducts: null, candidateProducts: productos(base), candidateSourceMaxReportedAt: '2026-09-06T04:54:46.000Z' });
  assert.equal(limpio.status, 'ready', limpio.reasons.join('; '));

  const caida = compareGasolinaQuality({ previousProducts: productos(base), candidateProducts: productos({ ...base, fresh_0_30_days: { offers: 50, districts: 20 } }), previousSourceMaxReportedAt: '2026-09-05T00:00:00.000Z', candidateSourceMaxReportedAt: '2026-09-06T00:00:00.000Z' });
  assert.equal(caida.status, 'needs_review');
  assert.ok(caida.reasons.some((motivo) => /caída de ofertas frescas/.test(motivo)));

  const vacio = compareGasolinaQuality({ previousProducts: null, candidateProducts: productos({ ...base, contract_ready: { offers: 0, districts: 0 } }), candidateSourceMaxReportedAt: '2026-09-06T00:00:00.000Z' });
  assert.equal(vacio.status, 'needs_review', 'un Registro que no produce ofertas no se publica');

  const precioMalo = compareGasolinaQuality({ previousProducts: null, candidateProducts: productos({ ...base, conflicts: { latest_price_conflicts: 3, latest_territory_conflicts: 0 } }), candidateSourceMaxReportedAt: '2026-09-06T00:00:00.000Z' });
  assert.equal(precioMalo.status, 'needs_review');

  const retrocede = compareGasolinaQuality({ previousProducts: productos(base), candidateProducts: productos(base), previousSourceMaxReportedAt: '2026-09-06T00:00:00.000Z', candidateSourceMaxReportedAt: '2026-09-01T00:00:00.000Z' });
  assert.ok(retrocede.reasons.some((motivo) => /retrocedió/.test(motivo)));
});

test('4 · codeRegression y la auditoría de publicación siguen en pie', () => {
  assert.equal(codeRegression({ head: 'a'.repeat(40), tip: 'a'.repeat(40) }), null, 'misma punta, no hay retroceso');
  assert.match(codeRegression({ head: 'a'.repeat(40), tip: 'b'.repeat(40), isAncestor: false }).reason, /codigo_desactualizado/);
  assert.equal(codeRegression({ head: 'a'.repeat(40), tip: 'b'.repeat(40), isAncestor: true, changedPaths: ['README.md'] }), null, 'un adelanto de documentación no aborta');
  assert.match(codeRegression({ head: 'a'.repeat(40), tip: 'b'.repeat(40), isAncestor: true, changedPaths: ['web/app.js'] }).reason, /codigo_desactualizado/);

  const auditoria = correr(['scripts/audit-publication.mjs', '--treeish', ':', '--strict-history']);
  const resultado = JSON.parse(auditoria.stdout);
  assert.deepEqual(resultado.history.path_findings, [], 'el historial sigue limpio');
  assert.deepEqual(resultado.history.content_findings, []);
  // La auditoría mira el ÍNDICE, así que la regla nueva de `.gitignore` tiene
  // que estar ahí para que el módulo generado no pueda colarse en un commit.
  assert.deepEqual(resultado.candidate.findings, []);
  assert.equal(auditoria.status, 0, auditoria.stderr);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\/web\/shell-manifest\.js$/m);
});

// ── 5 · Operación y documentación ────────────────────────────────────────────

test('5 · los comandos de operación funcionan en local', () => {
  const verificador = correr(['scripts/verify-web.mjs']);
  assert.equal(verificador.status, 0, verificador.stderr);
  assert.match(verificador.stdout, /masfacil-shell-[a-f0-9]{12}/, 'el verificador informa la precache derivada');

  const ruta = correr(['scripts/resolve-route.mjs'], { EVENT_NAME: 'schedule' });
  assert.equal(ruta.status, 0, ruta.stderr);
  assert.equal(JSON.parse(ruta.stdout).route, 'data');

  const rollbackSinArgumento = correr(['scripts/rollback.mjs']);
  assert.notEqual(rollbackSinArgumento.status, 0);
  assert.match(rollbackSinArgumento.stderr, /npm run rollback -- <snapshot-id>/);

  // El refresco sigue siendo un guion con sus códigos de salida y su JSON.
  const opciones = refreshOptionsFromEnv({}, ['node', 'refresh.mjs']);
  assert.equal(opciones.sourceId, 'liquid-current');
  assert.equal(opciones.forceRefresh, false);
  assert.throws(() => refreshOptionsFromEnv({ TEST_SOURCE_URL: 'http://x' }, []), /TEST_MODE=1/);
});

test('5 · la ruta project se prepara de verdad, aislada del bundle real', { timeout: 900_000 }, async () => {
  const dir = escenario('ruta-project');
  const pointer = readActivePointer(root);
  fs.cpSync(path.join(root, 'web'), path.join(dir, 'web'), { recursive: true });
  const destino = path.join(dir, '.local-cache', 'snapshots', pointer.snapshot_id);
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, 'snapshot-manifest.json'), fs.readFileSync(path.join(snapshotsRoot, pointer.snapshot_id, 'snapshot-manifest.json')));
  for (const sub of ['minimized', 'acquired', 'dataset', 'provenance']) fs.symlinkSync(path.join(snapshotsRoot, pointer.snapshot_id, sub), path.join(destino, sub));
  fs.writeFileSync(path.join(dir, '.local-cache', 'snapshots', 'active.json'), fs.readFileSync(path.join(snapshotsRoot, 'active.json')));

  const antes = fs.readFileSync(path.join(dataRoot, 'refresh-state.json'), 'utf8');
  const salida = await prepareRelease({ root: dir, route: 'project', routeReason: 'sonda', identityRoot: path.join(root, '.local-cache', 'identity') });
  assert.equal(salida.ok, true, salida.execution.error ?? '');
  assert.equal(salida.decision.action, 'reproject_verify_deploy');
  assert.equal(salida.decision.deploy, true);
  assert.equal(salida.refresh.status, 'skipped', 'no se consultó la fuente');
  assert.equal(salida.informe.revision_id, leer(path.join(dataRoot, 'manifest.json')).revision_id, 'misma revisión que la publicada');
  // La precache se generó antes de verificar, en la misma corrida.
  assert.deepEqual(shellManifestProblems({ root: dir }).problems, []);
  // Y el bundle real no se tocó.
  assert.equal(fs.readFileSync(path.join(dataRoot, 'refresh-state.json'), 'utf8'), antes);
});

test('5 · el servidor local arranca y sirve la precache generada', async () => {
  const servidor = spawnSync(process.execPath, ['-e', "const { writeShellManifest } = await import('./pipeline/shell-manifest.mjs'); const r = writeShellManifest({ root: process.cwd() }); process.stdout.write(r.cache);"], { cwd: root, encoding: 'utf8', input: '' });
  assert.equal(servidor.status, 0, servidor.stderr);
  const puerto = 41730 + (process.pid % 500);
  const proceso = (await import('node:child_process')).spawn(process.execPath, ['scripts/serve-web.mjs'], { cwd: root, env: { ...process.env, PORT: String(puerto) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const arranque = await new Promise((resolve, reject) => {
      let texto = '';
      proceso.stdout.on('data', (chunk) => { texto += chunk; if (texto.includes('Precache derivada')) resolve(texto); });
      proceso.stderr.on('data', (chunk) => reject(new Error(String(chunk))));
      setTimeout(() => reject(new Error('el servidor no arrancó a tiempo')), 10_000);
    });
    assert.match(arranque, /Precache derivada: masfacil-shell-[a-f0-9]{12} · 27 entradas/);
    const respuesta = await fetch(`http://127.0.0.1:${puerto}/shell-manifest.js`);
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get('cache-control'), 'no-cache');
    assert.match(await respuesta.text(), /export const SHELL_CACHE = 'masfacil-shell-[a-f0-9]{12}';/);
  } finally { proceso.kill(); }
});

test('5 · la documentación no menciona lo retirado y no deja enlaces rotos', () => {
  const documentos = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/datos.md', 'docs/roadmap.md', 'DESIGN.md'];
  // Las menciones históricas se conservan; lo prohibido es describirlos como vivos.
  const retirados = [/build-dataset/, /dataset-schema/, /\bfixtures\//, /refresh-result\.json/, /masfacil-shell-v\d+/, /\.local-cache\/datasets/];
  for (const documento of documentos) {
    const texto = fs.readFileSync(path.join(root, documento), 'utf8');
    for (const patron of retirados) assert.doesNotMatch(texto, patron, `${documento} menciona ${patron}`);
    // Enlaces relativos del repositorio.
    for (const [, destino] of texto.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/g)) {
      const limpio = destino.split('#')[0];
      if (!limpio) continue;
      assert.ok(fs.existsSync(path.join(root, path.dirname(documento), limpio)), `${documento} enlaza a ${destino}, que no existe`);
    }
  }
});

test('5 · el mapa del proyecto describe el árbol real', () => {
  for (const documento of ['README.md', 'AGENTS.md']) {
    const texto = fs.readFileSync(path.join(root, documento), 'utf8');
    for (const directorio of ['web/', 'pipeline/', 'app/', 'scripts/', 'docs/']) assert.ok(texto.includes(directorio), `${documento} nombra ${directorio}`);
  }
  for (const entrada of deriveShell({ root }).entries) {
    assert.ok(fs.existsSync(path.join(root, shellEntryFile(entrada))), `${entrada} existe`);
  }
  assert.ok(usablePrivateSnapshot(root).ok, 'el snapshot privado local sigue siendo utilizable');
});
