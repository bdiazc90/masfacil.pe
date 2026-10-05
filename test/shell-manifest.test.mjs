// La versión del shell tiene que moverse con todo lo que el service worker
// sirve o ejecuta, y tiene que llegar a los bytes de `web/sw.js`.
//
// El service worker guarda la portada con su CSP y la sirve así, sin volver a
// pedirla: un cambio solo en `web/_headers` tiene que cambiar la versión. Y
// Chrome no reinstala un worker de módulos cuando cambia solo un import: la
// versión va en el script registrado, y su huella cubre el grafo del worker.
//
// La precache sale del build de la interfaz y de lo que cargan sus páginas, no
// de escanear `web/`. Aquí el build se simula sin Vite: dos páginas y sus assets
// instalados por el mismo instalador que usa el build real.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { moduleGraph } from '../app/shell-assets.mjs';
import {
  deriveShell,
  renderServiceWorker,
  shellManifestProblems,
  writeShellManifest,
} from '../pipeline/shell-manifest.mjs';
import { installUiBuild } from '../pipeline/ui-build.mjs';

// Lo generado no se copia: ni datos, ni la interfaz compilada, ni la precache.
const GENERADOS = new Set(['data', 'assets', 'index.html', '404.html', 'sw.js', 'shell-manifest.js']);

/** Instala un build simulado: la portada, la 404 y sus assets. */
function simularBuild(raiz, { css = 'body{color:black}\n', app = 'console.log(1);\n' } = {}) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-staging-'));
  const archivos = {
    'assets/app.js': app,
    'assets/404.js': 'import "./tema.js";\n',
    'assets/tema.js': 'export const t = 1;\n',
    'assets/estilo.css': css,
    'index.html':
      '<!doctype html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/logo.svg"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><script type="module" crossorigin src="/assets/app.js"></script><link rel="modulepreload" crossorigin href="/assets/tema.js"><link rel="stylesheet" crossorigin href="/assets/estilo.css"></head><body><img src="/icons/logo.svg" alt=""></body>\n',
    '404.html':
      '<!doctype html><head><script type="module" crossorigin src="/assets/404.js"></script><link rel="modulepreload" crossorigin href="/assets/tema.js"><link rel="stylesheet" crossorigin href="/assets/estilo.css"></head><body><h1>No encontramos esta página</h1><a href="/">Ir a la portada</a></body>\n',
  };
  for (const [relativo, texto] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(staging, relativo)), { recursive: true });
    fs.writeFileSync(path.join(staging, relativo), texto);
  }
  try {
    return installUiBuild({
      root: raiz,
      stagingDir: staging,
      archivos: Object.keys(archivos),
      inputs: {},
      manifest: {
        'index.html': { file: 'assets/app.js', isEntry: true },
        '404.html': { file: 'assets/404.js', isEntry: true },
      },
      versiones: { vite: 'simulada' },
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function conCopiaDeWeb(prueba) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-shell-'));
  try {
    const origen = path.resolve(new URL('..', import.meta.url).pathname, 'web');
    fs.cpSync(origen, path.join(raiz, 'web'), {
      recursive: true,
      filter: (src) => !GENERADOS.has(path.relative(origen, src).split(path.sep)[0]),
    });
    simularBuild(raiz);
    prueba(raiz, (relativo) => path.join(raiz, 'web', relativo));
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

test('la precache sale del build y de lo que cargan sus páginas, no de escanear web/', () =>
  conCopiaDeWeb((raiz, web) => {
    fs.writeFileSync(web('suelto.js'), 'export const SUELTO = 1;\n');
    const { entries, problems } = deriveShell({ root: raiz });
    assert.deepEqual(problems, []);
    assert.deepEqual(entries.slice(0, 2), ['/', '/404.html']);
    for (const entry of [
      '/assets/app.js',
      '/assets/404.js',
      '/assets/tema.js',
      '/assets/estilo.css',
      '/manifest.webmanifest',
      '/icons/logo.svg',
      '/icons/apple-touch-icon.png',
      '/icons/icon-192.png',
    ])
      assert.ok(entries.includes(entry), entry);
    assert.ok(
      entries.some((entry) => entry.startsWith('/icons/brands/')),
      'las marcas registradas viajan',
    );
    // Lo que el bundle ya lleva dentro no se pide suelto, y un archivo suelto no viaja por estar ahí.
    for (const entry of [
      '/suelto.js',
      '/brand-logos.js',
      '/lib/catalog.js',
      '/group-contracts.js',
      '/sw-cache-policy.js',
      '/sw-main.js',
      '/sw.js',
      '/shell-manifest.js',
      '/index.html',
    ])
      assert.ok(!entries.includes(entry), entry);
  }));

test('sin un build completo no hay shell', () =>
  conCopiaDeWeb((raiz) => {
    fs.rmSync(path.join(raiz, '.local-cache'), { recursive: true, force: true });
    assert.match(deriveShell({ root: raiz }).problems.join('; '), /falta el build de la interfaz/);
  }));

test('cambiar web/_headers cambia la versión del shell, no su lista', () =>
  conCopiaDeWeb((raiz, web) => {
    const antes = deriveShell({ root: raiz });
    fs.appendFileSync(web('_headers'), '\n# cambio de prueba\n');
    const despues = deriveShell({ root: raiz });
    assert.deepEqual(antes.problems, []);
    assert.deepEqual(despues.entries, antes.entries, '_headers no entra en la precache');
    assert.notEqual(despues.cache, antes.cache);
  }));

test('los datos no mueven la versión; la interfaz compilada y un icono que se carga, sí', () =>
  conCopiaDeWeb((raiz, web) => {
    const base = deriveShell({ root: raiz }).cache;
    fs.mkdirSync(web('data/gasolina'), { recursive: true });
    fs.writeFileSync(web('data/gasolina/manifest.json'), '{"revision_id":"otra"}\n');
    assert.equal(deriveShell({ root: raiz }).cache, base, 'cambiar solo datos no cambia el shell');
    simularBuild(raiz, { css: 'body{color:red}\n' });
    const conOtraHoja = deriveShell({ root: raiz }).cache;
    assert.notEqual(conOtraHoja, base);
    fs.appendFileSync(web('icons/logo.svg'), '\n');
    assert.notEqual(deriveShell({ root: raiz }).cache, conOtraHoja);
  }));

test('la versión y los bytes de sw.js siguen al shell y a todo el grafo del worker', () =>
  conCopiaDeWeb((raiz, web) => {
    const versiones = [deriveShell({ root: raiz })];
    assert.deepEqual(versiones[0].problems, []);
    assert.equal(deriveShell({ root: raiz }).cache, versiones[0].cache, 'sin cambios, la misma versión');
    assert.ok(!versiones[0].entries.includes('/sw-main.js'), 'la lógica del worker no se precachea');
    assert.ok(versiones[0].worker.includes('lib/catalog.js') && versiones[0].worker.includes('shell-manifest.js'));

    simularBuild(raiz, { app: 'console.log(2);\n' });
    versiones.push(deriveShell({ root: raiz }));
    fs.appendFileSync(web('sw-main.js'), '\n// solo la lógica del worker\n');
    versiones.push(deriveShell({ root: raiz }));
    // Un módulo que solo importa el worker, en una subcarpeta que la precache no mira.
    fs.mkdirSync(web('sw'));
    fs.writeFileSync(web('sw/extra.js'), 'export const EXTRA = 1;\n');
    fs.writeFileSync(
      web('sw-main.js'),
      `import { EXTRA } from './sw/extra.js';\n${fs.readFileSync(web('sw-main.js'), 'utf8')}`,
    );
    versiones.push(deriveShell({ root: raiz }));
    fs.appendFileSync(web('sw/extra.js'), '// cambio solo aquí\n');
    versiones.push(deriveShell({ root: raiz }));

    assert.ok(versiones.at(-1).worker.includes('sw/extra.js'));
    assert.deepEqual(versiones.at(-1).entries, versiones[1].entries, 'el módulo del worker no entra en la precache');
    const scripts = versiones.map((derivada) => renderServiceWorker(derivada));
    assert.equal(
      new Set(versiones.map((derivada) => derivada.cache)).size,
      versiones.length,
      'cada cambio, una versión',
    );
    assert.equal(new Set(scripts).size, scripts.length, 'cada versión, otros bytes en sw.js');
    assert.match(scripts[0], new RegExp(`${versiones[0].cache}[\\s\\S]*import '\\./sw-main\\.js';`));
  }));

test('sw.js ausente o desfasado es un problema y se genera con el manifest', () =>
  conCopiaDeWeb((raiz, web) => {
    fs.rmSync(web('sw.js'), { force: true });
    assert.match(shellManifestProblems({ root: raiz }).problems.join('; '), /falta web\/sw\.js/);
    writeShellManifest({ root: raiz });
    assert.deepEqual(shellManifestProblems({ root: raiz }).problems, []);
    fs.appendFileSync(web('lib/routes.js'), '\n// cambio\n');
    assert.match(shellManifestProblems({ root: raiz }).problems.join('; '), /web\/sw\.js no coincide/);
  }));

test('el grafo del worker resuelve o rechaza cada dependencia', () => {
  const grafo = (archivos) =>
    moduleGraph({
      entry: 'sw-main.js',
      generated: ['shell-manifest.js'],
      read: (relativo) => archivos[relativo] ?? null,
    });
  const bien = grafo({
    'sw-main.js': [
      '// un import en un comentario: import x from "./no-existe.js"',
      "import { SHELL } from './shell-manifest.js';",
      'import {',
      '  A,',
      '  B,',
      "} from './lib/a.js';",
      "import './lateral.js';",
      "export { C } from './lib/c.js';",
      'const u = import.meta.url;',
    ].join('\n'),
    'lib/a.js': "export { A, B } from './c.js';\n",
    'lib/c.js': 'export const A = 1, B = 2, C = 3;\n',
    'lateral.js': '',
  });
  assert.deepEqual(
    bien.problems,
    [],
    'el generado se admite sin existir; varias líneas, export from e import lateral se resuelven',
  );
  assert.deepEqual(bien.modules, ['lateral.js', 'lib/a.js', 'lib/c.js', 'shell-manifest.js', 'sw-main.js']);

  const rechazos = {
    falta: [{ 'sw-main.js': "import './no-existe.js';" }, /importa «\.\/no-existe\.js», que no existe/],
    desnudo: [{ 'sw-main.js': "import x from 'paquete';" }, /import no admitido «paquete»/],
    nodo: [{ 'sw-main.js': "import fs from 'node:fs';" }, /import no admitido «node:fs»/],
    absoluto: [{ 'sw-main.js': "import x from '/lib/a.js';" }, /import no admitido «\/lib\/a\.js»/],
    fuera: [{ 'sw-main.js': "import x from '../x.js';" }, /sale de web\//],
    dinamico: [{ 'sw-main.js': "const m = () => import('./a.js');", 'a.js': '' }, /import dinámico/],
    oculto: [{ 'sw-main.js': "const a = 1; import x from './a.js';", 'a.js': '' }, /import que no se reconoce/],
    entrada: [{}, /falta web\/sw-main\.js/],
  };
  for (const [caso, [archivos, esperado]] of Object.entries(rechazos))
    assert.match(grafo(archivos).problems.join('; '), esperado, caso);
});
