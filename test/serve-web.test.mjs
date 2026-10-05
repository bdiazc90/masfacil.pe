// El servidor local responde con las cabeceras que declara `web/_headers`, como
// Pages: si se apartara, `npm run serve` acreditaría una CSP o una caché que
// producción no tiene.
//
// node --test test/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { cacheControl, headersFor, readHeaders } from '../scripts/serve-web.mjs';

const reglas = readHeaders(fs.readFileSync(new URL('../web/_headers', import.meta.url), 'utf8'));

test('toda ruta lleva la CSP y las cabeceras comunes de _headers', () => {
  for (const ruta of ['/', '/combustibles/gnv', '/assets/index.js', '/no-existe']) {
    const cabeceras = headersFor(reglas, ruta);
    assert.match(cabeceras['Content-Security-Policy'], /default-src 'self'/);
    assert.equal(cabeceras['X-Content-Type-Options'], 'nosniff');
  }
});

test('los datos llevan la caché de su regla: el manifest nunca se guarda y el snapshot es inmutable', () => {
  assert.equal(headersFor(reglas, '/data/gasolina/manifest.json')['Cache-Control'], 'no-store');
  assert.match(headersFor(reglas, '/data/gnv/snapshots/x/gnv.json')['Cache-Control'], /immutable/);
  assert.equal(headersFor(reglas, '/assets/index.js')['Cache-Control'], undefined);
});

test('en desarrollo se revalida todo; el modo prod reproduce el peor caso de la zona', () => {
  assert.equal(cacheControl('dev', '.js', undefined), 'no-cache');
  assert.equal(cacheControl('dev', '.json', 'no-store'), 'no-store');
  assert.equal(cacheControl('prod', '.html', undefined), 'public, max-age=0, must-revalidate');
  assert.equal(cacheControl('prod', '.js', undefined), 'public, max-age=14400, must-revalidate');
  assert.equal(cacheControl('prod', '.js', 'no-cache'), 'max-age=14400');
  assert.equal(
    cacheControl('prod', '.json', 'public, max-age=31536000, immutable'),
    'public, max-age=31536000, immutable',
  );
});
