// El build de la interfaz: compila fuera de `web/`, comprueba lo compilado e
// instala por inventario, sin tocar datos ni nada ajeno. Y la verificación
// rechaza un build viejo, alterado o a medias aunque sea coherente consigo mismo.
//
// Las pruebas con Vite real compilan una copia del repositorio con su
// `node_modules` enlazado: sin `pnpm install` se saltan y lo dicen.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { htmlResourceProblems, notFoundPageProblems } from '../app/shell-assets.mjs';
import { deriveShell } from '../pipeline/shell-manifest.mjs';
import { buildUi, inspectStaging, installUiBuild, readUiBuild, uiBuildProblems } from '../pipeline/ui-build.mjs';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const CON_VITE = fs.existsSync(path.join(REPO, 'node_modules', 'vite', 'package.json'));
const SIN_VITE = CON_VITE ? false : 'requiere pnpm install';
const GRUPOS = ['gasolina', 'diesel', 'glp', 'gnv'];

const temporal = (prefijo) => fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
const escribir = (raiz, relativo, texto) => {
  fs.mkdirSync(path.dirname(path.join(raiz, relativo)), { recursive: true });
  fs.writeFileSync(path.join(raiz, relativo), texto);
};

/** Huella de cada archivo bajo `dir`, relativa. */
function huellas(dir) {
  const salida = {};
  const recorrer = (actual) => {
    for (const entrada of fs.readdirSync(actual, { withFileTypes: true })) {
      const ruta = path.join(actual, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else salida[path.relative(dir, ruta)] = crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex');
    }
  };
  recorrer(dir);
  return salida;
}

/**
 * Una copia mínima del repositorio para compilar de verdad: fuentes, config,
 * `web/` sin generados, cuatro bundles de datos ficticios y `node_modules`
 * enlazado.
 */
function copiaDelRepositorio() {
  const raiz = temporal('masfacil-ui-');
  fs.cpSync(path.join(REPO, 'ui'), path.join(raiz, 'ui'), { recursive: true });
  for (const archivo of ['vite.config.mjs', 'package.json', 'pnpm-lock.yaml', 'pipeline/ui-build.mjs'])
    escribir(raiz, archivo, fs.readFileSync(path.join(REPO, archivo)));
  const generados = new Set(['data', 'assets', 'index.html', '404.html', 'sw.js', 'shell-manifest.js']);
  fs.cpSync(path.join(REPO, 'web'), path.join(raiz, 'web'), {
    recursive: true,
    filter: (src) => !generados.has(path.relative(path.join(REPO, 'web'), src).split(path.sep)[0]),
  });
  for (const grupo of GRUPOS) {
    escribir(raiz, `web/data/${grupo}/manifest.json`, `{"grupo":"${grupo}"}\n`);
    escribir(raiz, `web/data/${grupo}/refresh-state.json`, `{"estado":"${grupo}"}\n`);
    escribir(raiz, `web/data/${grupo}/snapshots/s1/a.json`, `{"ofertas":["${grupo}"]}\n`);
  }
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(raiz, 'node_modules'), 'dir');
  return raiz;
}

/** Un staging simulado, como el que deja Vite. */
function staging(
  archivos,
  manifest = {
    'index.html': { file: 'assets/app.js', isEntry: true },
    '404.html': { file: 'assets/404.js', isEntry: true },
  },
) {
  const dir = temporal('masfacil-staging-');
  for (const [relativo, texto] of Object.entries(archivos)) escribir(dir, relativo, texto);
  escribir(dir, '.vite/manifest.json', JSON.stringify(manifest));
  return dir;
}

const PAGINAS = {
  'index.html':
    '<link rel="stylesheet" crossorigin href="/assets/estilo.css"><script type="module" crossorigin src="/assets/app.js"></script>',
  '404.html':
    '<link rel="stylesheet" crossorigin href="/assets/estilo.css"><script type="module" crossorigin src="/assets/404.js"></script><h1>No encontramos esta página</h1><a href="/">Portada</a>',
  'assets/app.js': 'console.log(1);\n',
  'assets/404.js': 'console.log(2);\n',
  'assets/estilo.css': 'body{}\n',
};

test('lo compilado se rechaza antes de tocar web/: relativo, inexistente, ajeno, en línea, diferido o fuera del build', () => {
  const web = temporal('masfacil-web-');
  const casos = {
    relativo: [
      { ...PAGINAS, 'index.html': PAGINAS['index.html'].replace('/assets/estilo.css', 'assets/estilo.css') },
      undefined,
      /ruta relativa/,
    ],
    inexistente: [
      { ...PAGINAS, 'index.html': `${PAGINAS['index.html']}<link rel="icon" href="/icons/no-existe.svg">` },
      undefined,
      /no-existe\.svg, que no existe/,
    ],
    ajeno: [
      { ...PAGINAS, 'index.html': `${PAGINAS['index.html']}<script src="https://cdn.example/x.js"></script>` },
      undefined,
      /recurso ajeno/,
    ],
    enLinea: [
      { ...PAGINAS, '404.html': `${PAGINAS['404.html']}<script>alert(1)</script>` },
      undefined,
      /script en línea/,
    ],
    diferido: [
      PAGINAS,
      {
        'index.html': { file: 'assets/app.js', isEntry: true, dynamicImports: ['_x.js'] },
        '404.html': { file: 'assets/404.js', isEntry: true },
      },
      /carga diferida/,
    ],
    sinModulo: [
      PAGINAS,
      { 'index.html': { file: 'assets/otro.js', isEntry: true }, '404.html': { file: 'assets/404.js', isEntry: true } },
      /index\.html no carga su módulo compilado/,
    ],
    urlCss: [
      { ...PAGINAS, 'assets/estilo.css': 'body{background:url(/icons/fondo.png)}\n' },
      undefined,
      /fondo\.png, que no salió del build/,
    ],
    inesperada: [{ ...PAGINAS, 'favicon.ico': 'x' }, undefined, /salida inesperada: favicon\.ico/],
  };
  for (const [caso, [archivos, manifest, esperado]] of Object.entries(casos)) {
    const dir = staging(archivos, manifest);
    assert.throws(() => inspectStaging({ stagingDir: dir, webRoot: web }), esperado, caso);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const bueno = staging(PAGINAS);
  assert.deepEqual(inspectStaging({ stagingDir: bueno, webRoot: web }).archivos, [
    '404.html',
    'assets/404.js',
    'assets/app.js',
    'assets/estilo.css',
    'index.html',
  ]);
});

test('una instalación interrumpida se rechaza, y la siguiente retira lo que quedó por inventario', () => {
  const raiz = temporal('masfacil-install-');
  escribir(raiz, 'web/data/gasolina/manifest.json', '{"datos":1}\n');
  escribir(raiz, 'web/assets/de-otro.txt', 'no es del build\n');
  const instalar = (archivos, opciones = {}) => {
    const dir = staging(archivos);
    try {
      return installUiBuild({
        root: raiz,
        stagingDir: dir,
        archivos: Object.keys(archivos),
        inputs: {},
        manifest: {},
        versiones: {},
        ...opciones,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  instalar({ ...PAGINAS, 'assets/viejo.js': 'viejo\n' });
  let copiados = 0;
  assert.throws(
    () =>
      instalar(
        { ...PAGINAS, 'assets/nuevo.js': 'nuevo\n' },
        {
          copiar: (origen, destino) => {
            if (++copiados > 2) throw new Error('muere a mitad');
            fs.copyFileSync(origen, destino);
          },
        },
      ),
    /muere a mitad/,
  );
  assert.equal(readUiBuild({ root: raiz }).status, 'installing');
  assert.match(uiBuildProblems({ root: raiz }).join('; '), /no terminó \(installing\)/);
  instalar(PAGINAS);
  assert.equal(readUiBuild({ root: raiz }).status, 'complete');
  assert.ok(
    !fs.existsSync(path.join(raiz, 'web/assets/viejo.js')) && !fs.existsSync(path.join(raiz, 'web/assets/nuevo.js')),
    'lo que instaló el build y ya no emite se retira',
  );
  assert.equal(
    fs.readFileSync(path.join(raiz, 'web/data/gasolina/manifest.json'), 'utf8'),
    '{"datos":1}\n',
    'los datos no son del build',
  );
  assert.ok(fs.existsSync(path.join(raiz, 'web/assets/de-otro.txt')), 'lo ajeno no se barre');
  assert.match(uiBuildProblems({ root: raiz }).join('; '), /web\/assets\/de-otro\.txt no salió de este build/);
  fs.rmSync(path.join(raiz, 'web/assets/de-otro.txt'));
  fs.appendFileSync(path.join(raiz, 'web/assets/app.js'), '// alterado\n');
  fs.rmSync(path.join(raiz, 'web/assets/404.js'));
  const problemas = uiBuildProblems({ root: raiz }).join('; ');
  assert.match(problemas, /web\/assets\/app\.js no es la salida del build/);
  assert.match(problemas, /falta web\/assets\/404\.js/);
});

test('carga diferida, `node:` sustituido o React en modo desarrollo no llegan a instalarse', async () => {
  const raiz = temporal('masfacil-guardas-');
  const conModulos = (ids) => async () => ({ modulos: new Set(ids), versiones: {} });
  for (const [ids, esperado] of [
    [
      ['/r/ui/app.js', '/r/node_modules/react-dom/cjs/react-dom-client.development.js'],
      /build de desarrollo \(react-dom-client\.development\.js\)/,
    ],
    [['\0vite/preload-helper.js'], /carga diferida/],
    [['\0__vite-browser-external:node:fs'], /importa uno de Node/],
  ])
    await assert.rejects(buildUi({ root: raiz, compile: conModulos(ids) }), esperado);
  assert.ok(!fs.existsSync(path.join(raiz, 'web')), 'nada llegó a web/');
});

test('la 404 se verifica por lo que usa y cada recurso de una página tiene que viajar en la precache', () => {
  assert.deepEqual(notFoundPageProblems(PAGINAS['404.html']), []);
  assert.match(
    notFoundPageProblems('<h1>No encontramos esta página</h1><a href="/">x</a>').join('; '),
    /ninguna hoja.*ningún módulo/,
  );
  assert.match(notFoundPageProblems(`${PAGINAS['404.html']}<p style="color:red">x</p>`).join('; '), /estilos en línea/);
  const existe = () => true;
  assert.deepEqual(
    htmlResourceProblems('index.html', PAGINAS['index.html'], {
      exists: existe,
      precache: new Set(['/assets/estilo.css', '/assets/app.js']),
    }),
    [],
  );
  assert.match(
    htmlResourceProblems('index.html', PAGINAS['index.html'], {
      exists: existe,
      precache: new Set(['/assets/app.js']),
    }).join('; '),
    /estilo\.css, que no está en la precache/,
  );
});

test('compila sin tocar datos ni nada ajeno, y dos builds dan los mismos bytes y la misma versión', {
  skip: SIN_VITE,
}, async () => {
  const raiz = copiaDelRepositorio();
  try {
    const antes = huellas(path.join(raiz, 'web'));
    const primero = await buildUi({ root: raiz });
    const despues = huellas(path.join(raiz, 'web'));
    for (const [relativo, valor] of Object.entries(antes))
      assert.equal(despues[relativo], valor, `${relativo} no es del build y no cambia`);
    assert.deepEqual(
      Object.keys(despues)
        .filter((relativo) => !(relativo in antes))
        .sort(),
      Object.keys(primero.outputs).sort(),
      'solo se añade lo que emitió el build',
    );
    assert.deepEqual(uiBuildProblems({ root: raiz }), []);
    assert.ok(
      Object.keys(primero.inputs).includes('web/lib/catalog.js'),
      'los módulos compartidos del bundle son entradas',
    );
    assert.ok(
      !fs.readdirSync(path.join(raiz, '.local-cache', 'ui-build')).some((nombre) => nombre.startsWith('staging-')),
      'el staging se retira',
    );
    const version = deriveShell({ root: raiz });
    assert.deepEqual(version.problems, []);
    const constancia = fs.readFileSync(path.join(raiz, '.local-cache/ui-build/build.json'), 'utf8');
    await buildUi({ root: raiz });
    assert.deepEqual(huellas(path.join(raiz, 'web')), despues, 'mismos bytes publicados');
    assert.equal(
      fs.readFileSync(path.join(raiz, '.local-cache/ui-build/build.json'), 'utf8'),
      constancia,
      'la constancia no lleva hora',
    );
    assert.equal(deriveShell({ root: raiz }).cache, version.cache);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('una fuente cambiada sin recompilar invalida la verificación; recompilar retira el asset viejo y mueve la versión', {
  skip: SIN_VITE,
}, async () => {
  const raiz = copiaDelRepositorio();
  try {
    const primero = await buildUi({ root: raiz });
    const version = deriveShell({ root: raiz }).cache;
    fs.appendFileSync(path.join(raiz, 'ui/styles.css'), '\n.prueba-g1{color:red}\n');
    assert.match(
      uiBuildProblems({ root: raiz }).join('; '),
      /no corresponde a las fuentes actuales \(ui\/styles\.css\)/,
    );
    fs.appendFileSync(path.join(raiz, 'web/lib/directions.js'), '\n// un módulo compartido que viaja en el bundle\n');
    assert.match(uiBuildProblems({ root: raiz }).join('; '), /web\/lib\/directions\.js/);
    const segundo = await buildUi({ root: raiz });
    const hojaVieja = Object.keys(primero.outputs).find((relativo) => relativo.endsWith('.css'));
    assert.ok(
      !(hojaVieja in segundo.outputs) && !fs.existsSync(path.join(raiz, 'web', hojaVieja)),
      'el asset viejo se retira por inventario',
    );
    assert.deepEqual(uiBuildProblems({ root: raiz }), []);
    assert.notEqual(deriveShell({ root: raiz }).cache, version);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('un error de compilación no toca web/ ni deja un build aceptable', { skip: SIN_VITE }, async () => {
  const raiz = copiaDelRepositorio();
  try {
    await buildUi({ root: raiz });
    const antes = huellas(path.join(raiz, 'web'));
    fs.appendFileSync(path.join(raiz, 'ui/App.jsx'), '\nconst = ;\n');
    await assert.rejects(buildUi({ root: raiz }));
    assert.deepEqual(huellas(path.join(raiz, 'web')), antes, 'web/ queda idéntico, datos incluidos');
    assert.match(uiBuildProblems({ root: raiz }).join('; '), /ui\/App\.jsx/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('Tailwind: utilidades solo de ui/, sin Preflight ni tema por defecto, y styles.css llega tal cual', {
  skip: SIN_VITE,
}, async () => {
  const raiz = copiaDelRepositorio();
  try {
    // Una clase escrita fuera de `ui/` no entra: la hoja no puede cambiar por un
    // prototipo o un documento que CI no tiene.
    escribir(raiz, 'ui/sonda-clase.js', "export const clase = 'tracking-[.33em]';\n");
    escribir(raiz, 'web/lib/sonda-fuera.js', "export const clase = 'tracking-[.31em]';\n");
    escribir(raiz, 'prototipo.html', '<p class="tracking-[.32em]"></p>\n');
    const build = await buildUi({ root: raiz });
    const hoja = fs.readFileSync(
      path.join(
        raiz,
        'web',
        Object.keys(build.outputs).find((relativo) => relativo.endsWith('.css')),
      ),
      'utf8',
    );
    const propia = fs.readFileSync(path.join(raiz, 'ui/styles.css'), 'utf8');
    assert.ok(hoja.endsWith(propia), 'styles.css llega byte a byte: Tailwind no reescribe sus colores ni su cascada');
    const tailwind = hoja.slice(0, hoja.length - propia.length);
    assert.match(tailwind, /letter-spacing: \.33em/, 'una clase de ui/ genera su utilidad');
    assert.doesNotMatch(tailwind, /\.31em|\.32em/, 'nada fuera de ui/ genera utilidades');
    assert.doesNotMatch(
      tailwind,
      /::file-selector-button|--default-font-family|--color-[a-z]+-\d+|prefers-color-scheme/,
      'sin Preflight, paleta por defecto ni tema por media query',
    );
    assert.ok(
      tailwind.indexOf('@layer theme, base, components') >= 0 &&
        tailwind.indexOf('@layer theme, base, components') < tailwind.indexOf('@layer utilities'),
      'el orden de capas va antes: las utilidades ganan a la CSS de componente',
    );
    assert.equal(
      build.versions.tailwindcss,
      JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).devDependencies.tailwindcss,
    );
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('un aviso de Tailwind al optimizar la hoja no se publica', { skip: SIN_VITE }, async () => {
  const raiz = copiaDelRepositorio();
  try {
    // Lightning CSS descarta en silencio lo que no entiende; Tailwind lo avisa por la consola.
    fs.appendFileSync(path.join(raiz, 'ui/tailwind.css'), '\n.sonda:::rota{color:red}\n');
    await assert.rejects(buildUi({ root: raiz }), /avisó/);
    assert.ok(!fs.existsSync(path.join(raiz, 'web', 'index.html')), 'nada llegó a web/');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('un import con otras mayúsculas o de un módulo de Node no se publica', { skip: SIN_VITE }, async () => {
  const raiz = copiaDelRepositorio();
  try {
    fs.writeFileSync(path.join(raiz, 'ui/404.js'), `import { initTheme } from './Theme.js';\ninitTheme();\n`);
    // En macOS, que no distingue mayúsculas, lo detiene la guarda del build; en
    // Linux (CI) ni siquiera resuelve. En los dos casos no se publica.
    await assert.rejects(buildUi({ root: raiz }), /mayúsculas|Could not resolve/);
    fs.writeFileSync(
      path.join(raiz, 'ui/404.js'),
      `import { initTheme } from './theme.js';\nimport fs from 'node:fs';\ninitTheme(fs);\n`,
    );
    await assert.rejects(buildUi({ root: raiz }), /Node|avisó/);
    assert.ok(!fs.existsSync(path.join(raiz, 'web', 'index.html')), 'nada llegó a web/');
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
