// Qué es cada dirección, igual para el navegador, el service worker, el servidor
// local y el hosting.
//
// Lo que se fija aquí es lo que un enlace roto no avisa: que `/` respete una
// preferencia válida y descarte cualquier otra, que una ruta específica mande,
// que los enlaces viejos sigan llegando, que una vista no activada sea 404 y que
// `web/_redirects` diga exactamente lo mismo que la tabla.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { redirectRules, resolvePath } from '../web/lib/routes.js';
import { readPreference, writePreference } from '../web/preference.js';

const vista = (pathname, preference) => resolvePath(pathname, { preference });

test('la raíz resuelve la preferencia válida y si no, Gasolina', () => {
  for (const preference of [null, 'gasolina', 'gnv', 'GASOLINA', 'Diesel', 'GLP', '', '__proto__', 'constructor']) {
    assert.deepEqual(vista('/', preference), { kind: 'view', view: 'gasolina', history: false, canonical: '/combustibles/gasolina' }, String(preference));
  }
  assert.deepEqual(vista('/', 'diesel'), { kind: 'view', view: 'diesel', history: false, canonical: '/combustibles/diesel' });
  assert.deepEqual(vista('/', 'glp'), { kind: 'view', view: 'glp', history: false, canonical: '/combustibles/glp' });
});

test('una ruta específica manda sobre la preferencia', () => {
  assert.deepEqual(vista('/combustibles/gasolina', 'diesel'), { kind: 'view', view: 'gasolina', history: false, canonical: '/combustibles/gasolina' });
  assert.deepEqual(vista('/combustibles/gasolina/historial', 'diesel'), { kind: 'view', view: 'gasolina', history: true, canonical: '/combustibles/gasolina/historial' });
  assert.deepEqual(vista('/combustibles/diesel', 'gasolina'), { kind: 'view', view: 'diesel', history: false, canonical: '/combustibles/diesel' });
  assert.deepEqual(vista('/combustibles/glp', 'diesel'), { kind: 'view', view: 'glp', history: false, canonical: '/combustibles/glp' });
  assert.deepEqual(vista('/combustibles/gasolina', 'glp'), { kind: 'view', view: 'gasolina', history: false, canonical: '/combustibles/gasolina' });
});

test('barra final y enlaces antiguos redirigen a la forma canónica', () => {
  const esperadas = {
    '/combustibles/gasolina/': '/combustibles/gasolina',
    '/combustibles/gasolina/historial/': '/combustibles/gasolina/historial',
    '/combustibles/diesel/': '/combustibles/diesel',
    '/combustibles/glp/': '/combustibles/glp',
    '/gasolina': '/combustibles/gasolina',
    '/gasolina/': '/combustibles/gasolina',
    '/gasolina/regular': '/combustibles/gasolina',
    '/gasolina/regular/': '/combustibles/gasolina',
    '/gasolina/premium': '/combustibles/gasolina',
    '/gasolina/premium/': '/combustibles/gasolina',
    // El historial antiguo conserva su significado aunque la preferencia sea otra.
    '/gasolina/historial': '/combustibles/gasolina/historial',
    '/gasolina/historial/': '/combustibles/gasolina/historial',
  };
  for (const [desde, hacia] of Object.entries(esperadas)) assert.deepEqual(vista(desde, 'diesel'), { kind: 'redirect', to: hacia }, desde);
});

test('lo no activado o inventado es 404, no la portada', () => {
  // Diésel y GLP no tienen histórico: su ruta de historial no existe.
  for (const ruta of ['/combustibles', '/combustibles/', '/combustibles/gnv', '/combustibles/gnv/', '/combustibles/diesel/historial', '/combustibles/diesel/otra', '/combustibles/glp/historial', '/combustibles/glp/otra', '/glp', '/combustibles/gasolina/regular', '/combustibles/gasolina/historial/extra', '/tipo-de-cambio', '/dolar', '/gasolina/diesel', '/diesel', '/index']) {
    assert.deepEqual(vista(ruta), { kind: 'not-found' }, ruta);
  }
});

test('web/_redirects dice exactamente lo que dice la tabla', () => {
  const reglas = fs.readFileSync(new URL('../web/_redirects', import.meta.url), 'utf8')
    .split('\n').map((linea) => linea.trim().replace(/\s+/g, ' ')).filter((linea) => linea && !linea.startsWith('#'));
  assert.deepEqual(reglas, redirectRules());
});

test('la preferencia sobrevive a un almacenamiento que falla', () => {
  const roto = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('lleno'); } };
  assert.equal(readPreference(roto), null);
  assert.doesNotThrow(() => writePreference('gasolina', roto));
  assert.equal(readPreference(null), null);
  const datos = new Map();
  const memoria = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, v) };
  writePreference('gasolina', memoria);
  assert.equal(readPreference(memoria), 'gasolina');
});
