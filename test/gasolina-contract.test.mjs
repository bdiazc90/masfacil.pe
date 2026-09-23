// El contrato del bundle, visto por sus dos lados.
//
// Las reglas son un solo módulo, pero el productor responde con errores y el
// navegador con sí o no, y cada uno calcula su propia huella. Lo que importa
// fijar es que digan lo mismo: un bundle que el productor rechaza no puede
// entrar en la página ni en el service worker, y uno válido de CUALQUIER versión
// del contrato tiene que seguir entrando, porque una instalación antigua puede
// conservar un par guardado de hace semanas.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { GASOLINA_VERSIONS, validateGasolinaBundle } from '../pipeline/gasolina-contract.mjs';
import { validGasolinaBundle } from '../web/gasolina-contract.js';
import { PRODUCTS } from '../web/lib/catalog.js';

const REVISION = 'gasolina-2026-09-06-prueba-000000000000';
const CORTE = '2026-09-06T22:45:36.508Z';
const hex = (letra) => letra.repeat(24);
const sha = (texto) => crypto.createHash('sha256').update(texto).digest('hex');

function identidad(version) {
  if (['2.1.0', '2.2.0'].includes(version)) return { brand: 'Primax', public_site_name: null };
  if (['2.4.0', '2.5.0'].includes(version)) return { brand: 'Primax', public_site_name: null, confidence: 'verified', brand_accredited: true };
  return { brand: 'Primax', public_site_name: null, confidence: 'verified' };
}

function oferta(version, letra) {
  const base = { id: `g2_${hex(letra)}`, price: 15.49, reported_at: '2026-09-01T12:00:00.000Z', district: 'MIRAFLORES', longitude: -77.03, latitude: -12.12 };
  if (version === '2.0.0') return base;
  const conIdentidad = { ...base, establishment_id: `est_${hex(letra)}`, commercial_identity: identidad(version) };
  if (version === '2.1.0') return conIdentidad;
  const conDireccion = { ...conIdentidad, address: 'Av. Larco 123' };
  return version === '2.7.0' ? { ...conDireccion, facilito: { price: 15.39, observed_at: '2026-09-06T20:00:00.000Z', reported_at: null } } : conDireccion;
}

function dataset(version, key) {
  return {
    schema_version: version,
    revision_id: REVISION,
    product: { key, canonical: PRODUCTS[key].canonical, label: PRODUCTS[key].label, display_unit: 'Galones' },
    scope: { department: 'LIMA', province: 'LIMA' },
    snapshot_date: '2026-09-06',
    cutoff_at: CORTE,
    source_max_reported_at: '2026-09-06T21:37:00.000Z',
    provenance: { source: 'Osinergmin', source_url: 'https://example.test/fuente', attribution: 'Datos de prueba.' },
    offers: [oferta(version, 'a'), oferta(version, 'b')],
  };
}

/** Bundle coherente; `cambiar` toca los datasets ANTES de medirlos. */
function bundle(version, cambiar = () => {}) {
  const datasets = { regular: dataset(version, 'regular'), premium: dataset(version, 'premium') };
  cambiar(datasets);
  const bodies = Object.fromEntries(Object.entries(datasets).map(([key, value]) => [key, `${JSON.stringify(value)}\n`]));
  const products = Object.fromEntries(Object.entries(bodies).map(([key, body]) => [key, {
    canonical_product: PRODUCTS[key].canonical, label: PRODUCTS[key].label, dataset_url: `data/gasolina/snapshots/${REVISION}/${key}.json`, bytes: Buffer.byteLength(body), sha256: sha(body), cutoff_at: CORTE,
  }]));
  return { manifest: { schema_version: version, revision_id: REVISION, scope: { department: 'LIMA', province: 'LIMA' }, products, generated_at: CORTE }, bodies };
}

async function veredictos({ manifest, bodies }, key = 'regular') {
  return { productor: validateGasolinaBundle(manifest, key, bodies[key]), navegador: await validGasolinaBundle(manifest, key, bodies[key]) };
}

test('un bundle válido de cada versión del contrato entra por los dos lados', async () => {
  for (const version of GASOLINA_VERSIONS) {
    const candidato = bundle(version);
    for (const key of ['regular', 'premium']) {
      const { productor, navegador } = await veredictos(candidato, key);
      assert.deepEqual(productor, [], `${version} ${key}`);
      assert.equal(navegador, true, `${version} ${key}`);
    }
  }
});

const primera = (datasets) => datasets.regular.offers[0];
const RECHAZOS = Object.freeze([
  ['campo extra en la oferta', '2.7.0', (d) => { primera(d).telefono = '999'; }],
  ['campo de otra versión: brand_accredited en 2.6.0', '2.6.0', (d) => { primera(d).commercial_identity.brand_accredited = true; }],
  ['identidad sin confidence en 2.3.0', '2.3.0', (d) => { delete primera(d).commercial_identity.confidence; }],
  ['precio cero', '2.7.0', (d) => { primera(d).price = 0; }],
  ['precio no numérico', '2.7.0', (d) => { primera(d).price = null; }],
  ['fecha de reporte ilegible', '2.7.0', (d) => { primera(d).reported_at = 'ayer'; }],
  ['coordenada fuera del Perú', '2.7.0', (d) => { primera(d).longitude = -60; }],
  ['dirección más larga que la tarjeta', '2.7.0', (d) => { primera(d).address = 'x'.repeat(49); }],
  ['identificador fuera de patrón', '2.7.0', (d) => { primera(d).id = 'g2_corto'; }],
  ['consulta con fecha de reporte', '2.7.0', (d) => { primera(d).facilito.reported_at = '2026-09-06T20:00:00.000Z'; }],
  ['consulta con precio cero', '2.7.0', (d) => { primera(d).facilito.price = 0; }],
  ['unidad distinta', '2.7.0', (d) => { d.regular.product.display_unit = 'Litros'; }],
  ['nombre canónico de otro producto', '2.7.0', (d) => { d.regular.product.canonical = 'GASOLINA REGULAR'; }],
  ['ámbito con un campo más', '2.7.0', (d) => { d.regular.scope = { department: 'LIMA', province: 'LIMA', district: 'MIRAFLORES' }; }],
  ['corte ilegible', '2.7.0', (d) => { d.regular.snapshot_date = '06/09/2026'; }],
  ['procedencia sin atribución', '2.7.0', (d) => { d.regular.provenance.attribution = ''; }],
  ['snapshot de otra revisión', '2.7.0', (d) => { d.regular.revision_id = 'gasolina-otra'; }],
  ['snapshot de otro producto bajo esta clave', '2.7.0', (d) => { d.regular = dataset('2.7.0', 'premium'); }],
]);

test('lo que el productor rechaza, el navegador también', async () => {
  for (const [nombre, version, cambiar] of RECHAZOS) {
    const { productor, navegador } = await veredictos(bundle(version, cambiar));
    assert.ok(productor.length > 0, `el productor aceptó: ${nombre}`);
    assert.equal(navegador, false, `el navegador aceptó: ${nombre}`);
  }
});

test('el manifest tiene que describir exactamente los bytes y la versión', async () => {
  const casos = [
    ['bytes alterados tras medir', (b) => { b.bodies.regular = b.bodies.regular.replace('15.49', '15.48'); }],
    ['versión desconocida', (b) => { b.manifest.schema_version = '2.8.0'; }],
    ['canónico del descriptor', (b) => { b.manifest.products.regular.canonical_product = 'GASOHOL PREMIUM'; }],
    ['ruta del snapshot fuera de su grupo', (b) => { b.manifest.products.regular.dataset_url = `data/diesel/snapshots/${REVISION}/regular.json`; }],
    ['corte del descriptor ilegible', (b) => { b.manifest.products.regular.cutoff_at = 'hoy'; }],
    ['productos en otro orden', (b) => { b.manifest.products = { premium: b.manifest.products.premium, regular: b.manifest.products.regular }; }],
  ];
  for (const [nombre, cambiar] of casos) {
    const candidato = bundle('2.7.0');
    cambiar(candidato);
    const { productor, navegador } = await veredictos(candidato);
    assert.ok(productor.length > 0, `el productor aceptó: ${nombre}`);
    assert.equal(navegador, false, `el navegador aceptó: ${nombre}`);
  }
});
