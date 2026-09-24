// Publicar por grupos sin perder ninguno.
//
// La ruta `shell` sube el árbol entero con los datos que ya sirve producción. Si
// un grupo activo no se pudiera leer y aun así se publicara, desaparecería. Y
// antes de subir, cada grupo se compara con su propio estado publicado: la
// novedad de uno no autoriza a retroceder otro.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { groupsBehind } from '../app/publication-policy.mjs';
import { PUBLISHED_GROUPS } from '../pipeline/groups.mjs';
import { fetchLiveBundle, fetchLiveGroups, writeLiveGroups } from '../pipeline/live-bundle.mjs';
import { bundleGasolina } from './fixtures/gasolina-bundle.mjs';

const R = bundleGasolina({ revision: 'gasolina-2026-09-06-prueba-000000000001' });
const ORIGEN = 'https://masfacil.test';
function origen(extra = () => null) {
  return async (url) => {
    const ruta = new URL(url).pathname.slice(1);
    if (ruta === 'data/gasolina/manifest.json') return new Response(R.manifestText);
    if (ruta === 'data/gasolina/refresh-state.json') return new Response(R.stateText);
    const key = Object.entries(R.manifest.products).find(([, d]) => d.dataset_url === ruta)?.[0];
    if (key) return new Response(R.bodies[key]);
    return extra(ruta) ?? new Response('no', { status: 404 });
  };
}
const sinEspera = { attempts: 1, sleep: async () => {} };

test('los grupos publicados son las vistas activas, cada una con su contrato', () => {
  assert.deepEqual(PUBLISHED_GROUPS.map((grupo) => [grupo.key, grupo.dataRoot, [...grupo.products]]), [['gasolina', 'data/gasolina', ['regular', 'premium']]]);
});

test('el bundle vivo se lee por grupo y Gasolina conserva su lectura de siempre', async () => {
  const [gasolina] = await fetchLiveGroups({ origin: ORIGEN, fetchImpl: origen(), ...sinEspera });
  assert.equal(gasolina.group, 'gasolina');
  assert.equal(gasolina.revision_id, R.revision);
  const clasico = await fetchLiveBundle({ origin: ORIGEN, fetchImpl: origen(), ...sinEspera });
  assert.deepEqual(clasico.bodies, gasolina.bodies);
});

test('si un grupo activo no se puede leer, no se publica ninguno', async () => {
  const sintetico = { key: 'sintetico', dataRoot: 'data/sintetico', products: ['unico'], validate: { manifest: () => [], refreshState: () => [], bundle: () => [] } };
  await assert.rejects(fetchLiveGroups({ origin: ORIGEN, groups: [...PUBLISHED_GROUPS, sintetico], fetchImpl: origen(), ...sinEspera }), /Grupo sintetico: .*data\/sintetico\/manifest\.json/);
});

test('cada grupo se escribe en su raíz, snapshots antes que el manifest', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-grupos-'));
  try {
    const bundles = [{ group: 'gasolina', ...R }];
    const resumen = writeLiveGroups(bundles, { root: raiz });
    assert.equal(resumen.gasolina.revision_id, R.revision);
    const datos = path.join(raiz, 'web', 'data', 'gasolina');
    assert.equal(fs.readFileSync(path.join(datos, 'manifest.json'), 'utf8'), R.manifestText);
    for (const key of ['regular', 'premium']) assert.equal(fs.readFileSync(path.join(raiz, 'web', R.manifest.products[key].dataset_url), 'utf8'), R.bodies[key]);
    assert.throws(() => writeLiveGroups([{ group: 'diesel', ...R }], { root: raiz }), /grupo no publicado: diesel/i);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});

test('el preflight compara cada grupo con lo suyo y no deja perder ninguno', () => {
  const estado = (snapshot, unidades = {}) => ({ snapshot_id: snapshot, facilito: { units_observed: unidades } });
  const igual = estado('2026-09-23-a', { '150101:regular': '2026-09-23T13:00:00.000Z' });
  assert.deepEqual(groupsBehind({ local: { gasolina: igual }, published: { gasolina: igual } }), []);
  assert.deepEqual(groupsBehind({ local: { gasolina: igual }, published: { gasolina: null } }), [], 'un grupo sin publicar no tiene con qué compararse');
  const [csv] = groupsBehind({ local: { gasolina: estado('2026-09-20-a') }, published: { gasolina: igual } });
  assert.equal(csv.group, 'gasolina');
  assert.equal(csv.published_snapshot, '2026-09-23-a');
  const [consulta] = groupsBehind({ local: { gasolina: estado('2026-09-23-a', { '150101:regular': '2026-09-23T07:00:00.000Z' }) }, published: { gasolina: igual } });
  assert.equal(consulta.regressions.length, 1, 'un CSV igual no exime de comparar la consulta');
  const [perdido] = groupsBehind({ local: { gasolina: igual }, published: { gasolina: igual, diesel: estado('2026-09-23-d') } });
  assert.deepEqual([perdido.group, perdido.missing], ['diesel', true]);
});
