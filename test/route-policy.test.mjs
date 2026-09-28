// Qué ruta de publicación toma un push según lo que toca.
//
// El catálogo y las reglas del contrato viven en `web/lib/` porque los carga el
// navegador, pero también deciden qué publica la proyección. Si un cambio solo
// en ellos se clasificara como interfaz, CI subiría el shell sin reproyectar. Y
// lo contrario también importa: un cambio visual no puede arrastrar una
// reproyección que no necesita.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRoute } from '../app/route-policy.mjs';

const ruta = (...changedPaths) => resolveRoute({ eventName: 'push', changedPaths }).route;

test('un módulo de web/ que decide los bytes publicados reproyecta', () => {
  for (const file of ['web/lib/catalog.js', 'web/lib/bundle-contract.js', 'web/lib/price-source.js']) assert.equal(ruta(file), 'project', file);
  assert.equal(ruta('ui/styles.css', 'web/lib/catalog.js'), 'project');
});

test('las dependencias no se clasifican como interfaz; la herramienta local de build no publica', () => {
  assert.equal(ruta('package.json', 'pnpm-lock.yaml'), 'project');
  assert.equal(ruta('ui/app.js', 'package.json'), 'project');
  assert.equal(ruta('scripts/build-web.mjs'), 'docs');
  assert.equal(ruta('scripts/build-web.mjs', 'ui/app.js'), 'shell');
});

test('un cambio visual habitual sigue siendo shell', () => {
  assert.equal(ruta('ui/styles.css'), 'shell');
  assert.equal(ruta('ui/index.html', 'ui/app.js', 'ui/offer-card.js'), 'shell');
  assert.equal(ruta('ui/history-chart.js', 'web/lib/history-series.js'), 'shell');
  // La configuración y el módulo del build solo cambian la interfaz compilada.
  assert.equal(ruta('vite.config.mjs', 'pipeline/ui-build.mjs'), 'shell');
  // Retirar las fuentes que pasaron a `ui/` también es un cambio de interfaz.
  assert.equal(ruta('web/app.js', 'web/styles.css', 'ui/app.js', 'ui/styles.css'), 'shell');
  // Instalar un logo: el SVG, su registro y el instalador del operador.
  assert.equal(ruta('web/icons/brands/primax-mark.svg', 'web/brand-logos.js', 'scripts/install-brand-logo.mjs'), 'shell');
  // El adaptador del navegador no cambia lo que se publica; verify:web ya
  // comprueba que el cliente acepte el bundle vigente.
  assert.equal(ruta('web/gasolina-contract.js'), 'shell');
});
