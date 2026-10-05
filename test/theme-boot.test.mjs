// El tema antes del primer pintado (docs/SPEC-ui-react.md §8 bis): `web/theme-boot.js`
// fija `data-theme` y `theme-color` en el <head>, y repite a propósito la regla
// de `applyTheme` (`ui/theme.js`). Estas pruebas atan las dos copias —clave,
// regla y color de la barra— para que no se separen.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { color, tokensPorTema } from '../scripts/css-tokens.mjs';
import { THEME_KEY, applyTheme } from '../ui/theme.js';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const leer = (relativo) => fs.readFileSync(path.join(REPO, relativo), 'utf8');
const PAGINAS = ['ui/index.html', 'ui/404.html'];
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** El `<meta name="theme-color">` de una página, con sus atributos. */
function metaTema(html) {
  const etiqueta = /<meta\s+name="theme-color"[^>]*>/.exec(html)?.[0];
  assert.ok(etiqueta, 'falta <meta name="theme-color">');
  return Object.fromEntries([...etiqueta.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, nombre, valor]) => [nombre, valor]));
}

/** Un documento mínimo: lo que leen y escriben las dos copias de la regla. */
function entorno({ guardado, sistemaOscuro, sinAlmacenamiento = false }) {
  const meta = { content: '#000000', dataset: { light: '#f1f3f3', dark: '#161b1d' } };
  const datos = new Map(guardado === undefined ? [] : [[THEME_KEY, guardado]]);
  const localStorage = sinAlmacenamiento ? null : { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => datos.set(k, v) };
  const document = { documentElement: { dataset: {} }, querySelector: (selector) => (selector === 'meta[name="theme-color"]' ? meta : null) };
  const ventana = { document, matchMedia: (consulta) => ({ matches: consulta === '(prefers-color-scheme: dark)' && sistemaOscuro }) };
  if (localStorage) ventana.localStorage = localStorage;
  else Object.defineProperty(ventana, 'localStorage', { get() { throw new Error('SecurityError'); } });
  return { ventana, document, meta };
}

const CASOS = [
  { nombre: 'oscuro guardado', guardado: 'dark', sistemaOscuro: false, tema: 'dark' },
  { nombre: 'claro guardado con el sistema en oscuro', guardado: 'light', sistemaOscuro: true, tema: 'light' },
  { nombre: '«Sistema» en oscuro', guardado: 'system', sistemaOscuro: true, tema: 'dark' },
  { nombre: 'nada guardado, sistema claro', guardado: undefined, sistemaOscuro: false, tema: 'light' },
  { nombre: 'sin almacenamiento, sistema oscuro', sinAlmacenamiento: true, sistemaOscuro: true, tema: 'dark' },
];

test('las dos páginas fijan el tema en el <head> con un script clásico, antes de cualquier módulo', () => {
  for (const pagina of PAGINAS) {
    const head = /<head>([\s\S]*?)<\/head>/.exec(leer(pagina))?.[1] ?? '';
    const scripts = [...head.matchAll(/<script\b([^>]*)>/g)].map(([, atributos]) => atributos);
    const indice = scripts.findIndex((atributos) => /src="\/theme-boot\.js"/.test(atributos));
    assert.ok(indice >= 0, `${pagina} no carga /theme-boot.js en el <head>`);
    assert.doesNotMatch(scripts[indice], /\b(type="module"|defer|async)\b/, `${pagina}: theme-boot.js tiene que bloquear, sin módulo, defer ni async`);
    assert.ok(!scripts.slice(0, indice).some((atributos) => /type="module"/.test(atributos)), `${pagina}: ningún módulo antes de theme-boot.js`);
  }
});

test('theme-boot.js usa la clave de theme.js y decide igual que applyTheme', () => {
  const fuente = leer('web/theme-boot.js');
  assert.ok(fuente.includes(`'${THEME_KEY}'`), `theme-boot.js no usa la clave ${THEME_KEY}`);
  const script = new vm.Script(fuente, { filename: 'theme-boot.js' });
  for (const caso of CASOS) {
    const arranque = entorno(caso);
    script.runInNewContext(arranque.ventana);
    // `applyTheme` corre en Node: le prestamos el mismo documento por un momento.
    const app = entorno(caso);
    const previos = { document: globalThis.document, matchMedia: globalThis.matchMedia, localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') };
    Object.assign(globalThis, { document: app.document, matchMedia: app.ventana.matchMedia });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => app.ventana.localStorage });
    try {
      applyTheme(caso.sinAlmacenamiento ? 'system' : (caso.guardado ?? 'system'));
    } finally {
      Object.assign(globalThis, { document: previos.document, matchMedia: previos.matchMedia });
      if (previos.localStorage) Object.defineProperty(globalThis, 'localStorage', previos.localStorage); else delete globalThis.localStorage;
    }
    assert.equal(arranque.document.documentElement.dataset.theme, caso.tema, `${caso.nombre}: tema de theme-boot.js`);
    assert.equal(app.document.documentElement.dataset.theme, caso.tema, `${caso.nombre}: tema de applyTheme`);
    assert.equal(arranque.meta.content, arranque.meta.dataset[caso.tema], `${caso.nombre}: theme-color de theme-boot.js`);
    assert.equal(app.meta.content, app.meta.dataset[caso.tema], `${caso.nombre}: theme-color de applyTheme`);
  }
});

test('theme-color es el fondo de cada tema, en hex, en las dos páginas', () => {
  const temas = tokensPorTema(leer('ui/styles.css'));
  const fondo = { light: hex(color(temas.light.get('--background'), '--background (claro)')), dark: hex(color(temas.dark.get('--background'), '--background (oscuro)')) };
  for (const pagina of PAGINAS) {
    const meta = metaTema(leer(pagina));
    assert.equal(meta['data-light'], fondo.light, `${pagina}: data-light`);
    assert.equal(meta['data-dark'], fondo.dark, `${pagina}: data-dark`);
    assert.equal(meta.content, fondo.light, `${pagina}: sin JavaScript vale el claro, como data-theme`);
  }
});
