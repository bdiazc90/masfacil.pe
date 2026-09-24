// La carga de una vista: un conjunto completo, de una sola revisión.
//
// El fallo que esto vigila no se ve en pantalla: una lista con el Regular de una
// revisión y el Premium de otra, o una app que se rinde teniendo una copia
// completa guardada. Se simulan un deploy a mitad de lectura, un snapshot que
// falla siempre y un segundo grupo que no tiene por qué enterarse del primero.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadView } from '../web/data-client.js';
import { bundleGasolina } from './fixtures/gasolina-bundle.mjs';

const R1 = bundleGasolina({ revision: 'gasolina-2026-09-06-prueba-000000000001', precio: 15.49 });
const R2 = bundleGasolina({ revision: 'gasolina-2026-09-06-prueba-000000000002', precio: 16.49 });
const respuesta = (texto, modo = 'network') => new Response(texto, { headers: { 'Content-Type': 'application/json', 'X-Masfacil-Data-Mode': modo } });
const noEsta = () => new Response('no', { status: 404 });

/** Un `fetch` que responde con `servir(ruta, pedidos)` y anota cada pedido. */
function red(servir) {
  const pedidos = [];
  return { pedidos, fetchImpl: async (url) => { pedidos.push(url); return servir(new URL(url, 'https://masfacil.test'), pedidos) ?? noEsta(); } };
}
const snapshotDe = (bundle, url) => Object.entries(bundle.manifest.products).find(([, d]) => url.pathname === `/${d.dataset_url}`)?.[0];
const precios = (dataset) => Object.values(dataset.offers).flat().map((oferta) => oferta.price);
// Los precios de una revisión: Regular y Premium de cada una son distintos de los de la otra.
const de = (bundle) => new Set(Object.values(bundle.bodies).flatMap((body) => JSON.parse(body).offers.map((oferta) => oferta.price)));
const sinEspera = { sleep: async () => {} };

test('un manifest y todos sus productos, contra esa misma revisión', async () => {
  const { pedidos, fetchImpl } = red((url) => {
    if (url.pathname === '/data/gasolina/manifest.json') return respuesta(R2.manifestText);
    const key = snapshotDe(R2, url); return key ? respuesta(R2.bodies[key]) : null;
  });
  const dataset = await loadView('gasolina', { fetchImpl, ...sinEspera });
  assert.equal(dataset.revision_id, R2.revision);
  assert.equal(dataset.dataMode, 'network');
  const manifests = pedidos.filter((url) => url.includes('manifest.json'));
  assert.deepEqual(manifests, ['/data/gasolina/manifest.json?product=regular'], 'un solo manifest, compatible con el service worker anterior');
});

test('si la revisión cambia a mitad de la lectura, se vuelve a empezar entera', async () => {
  let deploy = false;
  const { fetchImpl } = red((url) => {
    if (url.pathname === '/data/gasolina/manifest.json') return respuesta((deploy ? R2 : R1).manifestText);
    const k1 = snapshotDe(R1, url); if (k1) { if (k1 === 'premium') { deploy = true; return null; } return respuesta(R1.bodies[k1]); }
    const k2 = snapshotDe(R2, url); return k2 ? respuesta(R2.bodies[k2]) : null;
  });
  const dataset = await loadView('gasolina', { fetchImpl, ...sinEspera });
  assert.equal(dataset.revision_id, R2.revision);
  assert.ok(precios(dataset).length > 0 && precios(dataset).every((precio) => de(R2).has(precio)), 'ni un precio de la revisión anterior');
});

test('con un snapshot nuevo roto, se recupera entero el conjunto guardado', async () => {
  const { pedidos, fetchImpl } = red((url) => {
    if (url.pathname === '/data/gasolina/manifest.json') return url.searchParams.get('guardado') === '1' ? respuesta(R1.manifestText, 'saved') : respuesta(R2.manifestText);
    const k2 = snapshotDe(R2, url); if (k2) return k2 === 'premium' ? new Response('roto', { status: 500 }) : respuesta(R2.bodies[k2]);
    const k1 = snapshotDe(R1, url); return k1 ? respuesta(R1.bodies[k1], 'saved') : null;
  });
  const dataset = await loadView('gasolina', { fetchImpl, ...sinEspera });
  assert.equal(dataset.revision_id, R1.revision);
  assert.equal(dataset.dataMode, 'saved');
  assert.ok(precios(dataset).length > 0 && precios(dataset).every((precio) => de(R1).has(precio)), 'nunca el Regular nuevo con el Premium antiguo');
  assert.equal(pedidos.filter((url) => url.includes('manifest.json')).length, 4, 'tres intentos con red y uno a la copia');
});

test('sin copia completa guardada, la carga falla con la causa de la red', async () => {
  const { fetchImpl } = red((url) => {
    if (url.pathname === '/data/gasolina/manifest.json') return url.searchParams.get('guardado') === '1' ? noEsta() : respuesta(R2.manifestText);
    const k2 = snapshotDe(R2, url); return k2 === 'regular' ? respuesta(R2.bodies.regular) : new Response('roto', { status: 500 });
  });
  await assert.rejects(loadView('gasolina', { fetchImpl, ...sinEspera }), /Gasohol Premium \(HTTP 500\)/);
});

test('cada vista pide solo lo de su grupo', async () => {
  const sintetico = { key: 'sintetico', products: ['regular', 'premium'], dataRoot: 'data/sintetico' };
  const contrato = { validManifest: (manifest) => manifest?.grupo === 'sintetico', validBundle: async (manifest, key, body) => JSON.parse(body).product.key === key };
  const dataset = (key) => JSON.stringify({ product: { key }, scope: {}, snapshot_date: '2026-09-06', cutoff_at: '2026-09-06T22:45:36.508Z', provenance: {}, offers: [] });
  const { pedidos, fetchImpl } = red((url) => {
    if (url.pathname === '/data/sintetico/manifest.json') return respuesta(JSON.stringify({ grupo: 'sintetico', revision_id: 'sintetico-1', products: { regular: { dataset_url: 'data/sintetico/snapshots/1/regular.json', label: 'R' }, premium: { dataset_url: 'data/sintetico/snapshots/1/premium.json', label: 'P' } } }));
    const key = /^\/data\/sintetico\/snapshots\/1\/(regular|premium)\.json$/.exec(url.pathname)?.[1]; return key ? respuesta(dataset(key)) : null;
  });
  const cargado = await loadView('sintetico', { fetchImpl, views: { sintetico }, contracts: { sintetico: contrato }, ...sinEspera });
  assert.equal(cargado.revision_id, 'sintetico-1');
  assert.ok(pedidos.every((url) => url.startsWith('/data/sintetico/')), 'no toca los datos de Gasolina');
  await assert.rejects(loadView('diesel', { fetchImpl, ...sinEspera }), /Vista sin datos publicados: diesel/);
});
