// La poda de snapshots en CI corre antes del deploy. Tras promover, los
// pointers ya apuntan al snapshot nuevo, así que la poda protege explícitamente,
// por cada grupo publicado, su producción y un destino de rollback con otro CSV,
// y por fuente todo lo que hay desde ese destino hasta lo más nuevo. Ante una
// referencia faltante o incoherente no se borra nada.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pruneInCi, pruneSnapshots } from '../pipeline/snapshot-prune.mjs';
import { resolveSourceRaw, snapshotUsable } from '../pipeline/project-gasolina.mjs';
import { sourceById } from '../pipeline/sources.mjs';

const CI = { GITHUB_ACTIONS: 'true' };
const LIQUIDOS = ['active.json', 'active-diesel.json', 'source-liquid-current.json'];

/** Una caché de snapshots en una raíz temporal, con carpetas que sirven para componer. */
function cache() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-poda-'));
  const snapshots = path.join(root, '.local-cache', 'snapshots');
  fs.mkdirSync(snapshots, { recursive: true });
  const raw = (id, source = 'liquid-current') => path.join(snapshots, id, ...sourceById(source).rawRelative.split('/'));
  const api = {
    root,
    snapshots,
    raw,
    /** Un snapshot completo. `enlazaA`: su original es un symlink al de otro, como cuando se reutiliza. */
    snapshot(id, { source = 'liquid-current', sha = `sha-${id}`, enlazaA = null, legado = false, elegible = true, sinMinimizado = false } = {}) {
      const dir = path.join(snapshots, id);
      fs.mkdirSync(path.dirname(raw(id, source)), { recursive: true });
      if (enlazaA) fs.symlinkSync(raw(enlazaA, source), raw(id, source)); else fs.writeFileSync(raw(id, source), 'x'.repeat(100));
      if (!sinMinimizado) fs.mkdirSync(path.join(dir, 'minimized'), { recursive: true });
      const fecha = id.slice(0, 10);
      if (legado) { fs.mkdirSync(path.join(dir, 'dataset'), { recursive: true }); fs.writeFileSync(path.join(dir, 'dataset', 'gasolina.json'), '{}'); }
      fs.writeFileSync(path.join(dir, 'snapshot-manifest.json'), JSON.stringify({
        schema_version: 1, source_id: source, snapshot_id: id, snapshot_date: fecha,
        temporal_context: legado ? null : { cutoff_at: `${fecha}T12:00:00.000Z`, source_max_reported_at: `${fecha}T05:00:00.000Z`, snapshot_date: fecha },
        dataset_path: legado ? path.relative(root, path.join(dir, 'dataset', 'gasolina.json')) : null,
        lineage: { raw: { sha256: sha }, paths: { raw_path: path.relative(root, raw(id, source)) } },
        ...(elegible ? {} : { eligible_for_rollback: false }),
      }));
      return api;
    },
    pointers(archivos, id) { for (const archivo of archivos) fs.writeFileSync(path.join(snapshots, archivo), JSON.stringify({ snapshot_id: id })); return api; },
    staging() { fs.mkdirSync(path.join(snapshots, 'staging', 'corrida'), { recursive: true }); fs.writeFileSync(path.join(snapshots, 'staging', 'corrida', 'glp.csv'), 'y'); return api; },
    quedan: () => fs.readdirSync(snapshots).filter((nombre) => !nombre.endsWith('.json')).sort(),
  };
  return api;
}
// Lo que sirve producción, como lo devuelve `prepareRelease`.
const produccion = (id, revision = 'aaaaaaaaaaaa') => ({ gasolina: { snapshot_id: id, revision_id: `gasolina-${id}-${revision}`, facilito: false }, diesel: { snapshot_id: id, revision_id: `diesel-${id}-bbbbbbbbbbbb`, facilito: false } });
const manifestDe = (c, id) => JSON.parse(fs.readFileSync(path.join(c.snapshots, id, 'snapshot-manifest.json'), 'utf8'));

test('con los pointers ya en el snapshot nuevo, protege producción y su rollback, y tras un deploy fallido siguen recuperables', () => {
  const c = cache().snapshot('2026-09-20-viejo').snapshot('2026-09-21-s0').snapshot('2026-09-22-s1').snapshot('2026-09-23-s2').staging().pointers(LIQUIDOS, '2026-09-23-s2');
  // Sin producción que proteger —lo único que miraba la poda de 3A— se habrían ido producción y rollback.
  const soloPointers = pruneSnapshots({ root: c.root, production: { gasolina: null, diesel: null }, dryRun: true });
  assert.deepEqual(soloPointers.remove, ['2026-09-20-viejo', '2026-09-21-s0', '2026-09-22-s1']);

  const informe = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([informe.status, informe.remove, informe.staging, informe.freed_bytes > 0], ['pruned', ['2026-09-20-viejo'], true, true]);
  assert.deepEqual(informe.protected.gasolina, { production: '2026-09-22-s1', revision: 'gasolina-2026-09-22-s1-aaaaaaaaaaaa', rollback: '2026-09-21-s0' });
  assert.deepEqual(informe.cutoffs, { 'liquid-current': '2026-09-21-s0' });
  assert.deepEqual(c.quedan(), ['2026-09-21-s0', '2026-09-22-s1', '2026-09-23-s2']);
  // El deploy falla: producción sigue en S1 y se puede reconstruir, igual que el rollback, sin descargar.
  for (const id of ['2026-09-22-s1', '2026-09-21-s0']) {
    const manifest = manifestDe(c, id);
    assert.equal(snapshotUsable(c.root, manifest, { sourceId: 'liquid-current' }).ok, true);
    assert.equal(resolveSourceRaw(c.root, manifest), path.join(c.root, manifest.lineage.paths.raw_path), 'su propio original, no uno encontrado por huella');
  }
  const siguiente = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([siguiente.status, siguiente.remove], ['pruned', []]);
});

test('lo que otra corrida está desplegando no se borra aunque no sea pointer ni producción', () => {
  const c = cache().snapshot('2026-09-20-viejo').snapshot('2026-09-21-s0').snapshot('2026-09-22-s1').snapshot('2026-09-23-en-vuelo').snapshot('2026-09-24-s3').pointers(LIQUIDOS, '2026-09-24-s3');
  const informe = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual(informe.remove, ['2026-09-20-viejo']);
  assert.ok(informe.keep.includes('2026-09-23-en-vuelo'));
});

test('una revisión nueva de Facilito sobre el mismo snapshot no cambia el plan', () => {
  const c = cache().snapshot('2026-09-20-viejo').snapshot('2026-09-21-s0').snapshot('2026-09-22-s1').pointers(LIQUIDOS, '2026-09-22-s1');
  const plan = (revision) => { const { freed_bytes: _f, protected: p, ...resto } = pruneSnapshots({ root: c.root, production: produccion('2026-09-22-s1', revision), dryRun: true }); return { ...resto, rollback: p.gasolina.rollback }; };
  assert.deepEqual(plan('cccccccccccc'), plan('dddddddddddd'));
  assert.equal(plan('cccccccccccc').rollback, '2026-09-21-s0');
});

test('una reproyección del mismo CSV no cuenta como destino de rollback', () => {
  const c = cache()
    .snapshot('2026-09-19-viejo', { sha: 'csv-a' })
    .snapshot('2026-09-20-s0', { sha: 'csv-a' })
    .snapshot('2026-09-21-s1', { sha: 'csv-b' })
    .snapshot('2026-09-22-s2', { sha: 'csv-b', enlazaA: '2026-09-21-s1' })
    .pointers(LIQUIDOS, '2026-09-22-s2');
  const informe = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s2') });
  assert.equal(informe.protected.gasolina.rollback, '2026-09-20-s0', 'el anterior con el mismo CSV no sirve de vuelta atrás');
  assert.deepEqual(informe.remove, ['2026-09-19-viejo']);
});

test('un pointer a un snapshot que no está no deja borrar nada', () => {
  const c = cache().snapshot('2026-09-20-viejo').snapshot('2026-09-21-s0').snapshot('2026-09-22-s1').staging()
    .pointers(['active.json', 'source-liquid-current.json'], '2026-09-22-s1').pointers(['active-diesel.json'], '2026-09-25-fantasma');
  const informe = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.equal(informe.status, 'skipped');
  assert.match(informe.reason, /active-diesel\.json apunta a 2026-09-25-fantasma, que no está en la caché/);
  assert.deepEqual([informe.remove, c.quedan()], [[], ['2026-09-20-viejo', '2026-09-21-s0', '2026-09-22-s1', 'staging']]);
});

test('sin producción conocida, completa y legible no se borra nada', () => {
  const armar = () => cache().snapshot('2026-09-20-viejo').snapshot('2026-09-21-s0').snapshot('2026-09-22-s1').pointers(LIQUIDOS, '2026-09-22-s1');
  const casos = [
    [undefined, /producción de gasolina desconocida/],
    [produccion('2026-09-23-ausente'), /no está en la caché/],
    [{ ...produccion('2026-09-22-s1'), diesel: { error: 'el estado publicado no declara snapshot_id' } }, /producción de diesel ilegible/],
  ];
  for (const [production, motivo] of casos) {
    const c = armar();
    const informe = pruneInCi({ root: c.root, env: CI, production });
    assert.deepEqual([informe.status, informe.remove], ['skipped', []]);
    assert.match(informe.reason, motivo);
    assert.equal(c.quedan().length, 3);
  }
  // Con un refresco en curso tampoco.
  const c = armar();
  fs.writeFileSync(path.join(c.snapshots, 'refresh.lock'), '1\n');
  assert.equal(pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') }).status, 'skipped');
});

test('un snapshot legado sirve de destino de rollback', () => {
  const c = cache().snapshot('2026-09-19-viejo').snapshot('2026-09-20-legado', { legado: true }).snapshot('2026-09-22-s1').pointers(LIQUIDOS, '2026-09-22-s1');
  const informe = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([informe.protected.gasolina.rollback, informe.remove], ['2026-09-20-legado', ['2026-09-19-viejo']]);
});

test('un symlink colgante o que sale de la caché no deja borrar nada', () => {
  const colgante = cache().snapshot('2026-09-20-viejo').snapshot('2026-09-21-s0').snapshot('2026-09-22-s1', { enlazaA: '2026-09-21-s0' }).pointers(LIQUIDOS, '2026-09-22-s1');
  fs.rmSync(colgante.raw('2026-09-21-s0'));
  const primero = pruneInCi({ root: colgante.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([primero.status, primero.remove], ['skipped', []]);
  assert.match(primero.reason, /symlink colgante/);

  const fuera = cache().snapshot('2026-09-20-viejo').snapshot('2026-09-21-s0').snapshot('2026-09-22-s1').pointers(LIQUIDOS, '2026-09-22-s1');
  fs.symlinkSync(os.tmpdir(), path.join(fuera.snapshots, '2026-09-22-s1', 'afuera'));
  const segundo = pruneInCi({ root: fuera.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([segundo.status, segundo.remove], ['skipped', []]);
  assert.match(segundo.reason, /symlink fuera de la caché/);
});

test('al arrancar sin nada anterior a producción se poda; con anteriores que no sirven, no', () => {
  const solo = cache().snapshot('2026-09-22-s1').staging().pointers(LIQUIDOS, '2026-09-22-s1');
  const informe = pruneInCi({ root: solo.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([informe.status, informe.remove, informe.staging, informe.protected.gasolina.rollback], ['pruned', [], true, null]);

  const inservibles = cache().snapshot('2026-09-20-sin-minimizado', { sinMinimizado: true }).snapshot('2026-09-21-no-elegible', { elegible: false }).snapshot('2026-09-22-s1').pointers(LIQUIDOS, '2026-09-22-s1');
  const omitida = pruneInCi({ root: inservibles.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([omitida.status, omitida.remove], ['skipped', []]);
  assert.match(omitida.reason, /ninguno sirve de destino de rollback/);
});

test('un snapshot marcado como no elegible no es destino de rollback', () => {
  const c = cache().snapshot('2026-09-19-viejo').snapshot('2026-09-20-s0').snapshot('2026-09-21-no-elegible', { elegible: false }).snapshot('2026-09-22-s1').pointers(LIQUIDOS, '2026-09-22-s1');
  const informe = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([informe.protected.gasolina.rollback, informe.remove], ['2026-09-20-s0', ['2026-09-19-viejo']]);
});

test('los snapshots viejos de GLP se borran y su pointer no; fuera de CI no se poda', () => {
  const c = cache().snapshot('2026-09-21-s0').snapshot('2026-09-22-s1').pointers(LIQUIDOS, '2026-09-22-s1')
    .snapshot('2026-09-20-glp-viejo', { source: 'glp-current' }).snapshot('2026-09-22-glp', { source: 'glp-current' })
    .pointers(['active-glp.json', 'source-glp-current.json'], '2026-09-22-glp');
  assert.equal(pruneInCi({ root: c.root, env: {}, production: produccion('2026-09-22-s1') }), null);
  assert.equal(c.quedan().length, 4);
  const informe = pruneInCi({ root: c.root, env: CI, production: produccion('2026-09-22-s1') });
  assert.deepEqual([informe.remove, informe.cutoffs], [['2026-09-20-glp-viejo'], { 'liquid-current': '2026-09-21-s0' }]);
  assert.deepEqual(c.quedan(), ['2026-09-21-s0', '2026-09-22-glp', '2026-09-22-s1']);
});
