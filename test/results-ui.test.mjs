// La lista de resultados en React, pintada en Node a través de Vite (el mismo
// JSX que compila el build): los datos publicados salen como texto y nunca como
// marcado, y cada etiqueta y cada enlace son los que decidió `offer-view.js`.
//
// Sin `pnpm install` estas pruebas se saltan y lo dicen: el resto de la suite no
// necesita React.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { offerCardView } from '../ui/offer-view.js';

const REPO = path.resolve(new URL('..', import.meta.url).pathname);
const SIN_REACT = fs.existsSync(path.join(REPO, 'node_modules', 'react-dom', 'package.json'))
  ? false
  : 'requiere pnpm install';

/** Carga un componente por el pipeline de Vite y lo pinta como HTML estático. */
async function pintar(archivo, nombre, props) {
  const { runnerImport } = await import('vite');
  const { module } = await runnerImport(path.join(REPO, archivo), {
    configFile: path.join(REPO, 'vite.config.mjs'),
    logLevel: 'error',
  });
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(createElement(module[nombre], props));
}

// Las clases son presentación (utilidades o CSS de componente) y cambian sin
// cambiar la interfaz: las pruebas miran ids, roles, atributos y texto. La única
// clase con significado es `sr-only` —oculto a la vista, no a los lectores—.
const sinClases = (html) => html.replace(/ class="[^"]*"/g, '');
const SOLO_LECTOR = '[^"]*\\bsr-only\\b[^"]*';

const HOSTIL = '<img src=x onerror="alert(1)">';
const oferta = (extra = {}) => ({
  establishment_id: 'est_1',
  commercial_identity: { brand: 'Primax', public_site_name: HOSTIL, confidence: 'nearby' },
  address: '"><script>alert(2)</script>',
  district: 'ATE',
  latitude: -12.05,
  longitude: -76.95,
  distance_km: 0.4,
  prices: { regular: { price: 20.5, source: 'csv', reported_at: '2026-09-25T10:00:00.000Z' } },
  has_price: true,
  age_days: 1,
  age_source: 'csv',
  ...extra,
});

test('lo publicado sale como texto: ni un nombre ni una dirección se interpretan como marcado', {
  skip: SIN_REACT,
}, async () => {
  const html = await pintar('ui/results/OfferCard.jsx', 'OfferCard', {
    offer: oferta(),
    options: { directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=-12.05%2C-76.95&travelmode=driving' },
    detailOptions: {},
  });
  assert.doesNotMatch(html, /<img src=x|<script>/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&quot;&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /dangerously|__html/);
});

test('etiquetas, enlaces y marca son los de la vista, y el detalle empieza cerrado', { skip: SIN_REACT }, async () => {
  const url = 'https://www.google.com/maps/dir/?api=1&destination=-12.05%2C-76.95&travelmode=driving';
  const offer = oferta({
    commercial_identity: { brand: 'Primax', public_site_name: 'Primax Ate', confidence: 'verified' },
  });
  const vista = offerCardView(offer, { directionsUrl: url });
  const html = await pintar('ui/results/OfferCard.jsx', 'OfferCard', {
    offer,
    options: { directionsUrl: url },
    detailOptions: {},
  });
  const atributo = (texto) => texto.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  assert.ok(html.includes(`aria-label="${atributo(vista.directions.label)}"`));
  assert.ok(html.includes(`href="${atributo(url)}"`));
  assert.ok(
    html.includes(`aria-label="${atributo(vista.detail.label)}" `) ||
      html.includes(`aria-label="${atributo(vista.detail.label)}">`),
  );
  // La marca va primera en el marcado (y detrás en pintura), como decoración.
  assert.match(
    sinClases(html),
    /<li data-brand="primax" tabindex="-1"><div aria-hidden="true"><img src="\/icons\/brands\/primax-mark\.svg" alt=""/,
  );
  assert.match(html, /aria-expanded="false"[^>]*>Ver detalle<\/button>/);
  assert.match(sinClases(html), /<div hidden=""><\/div><\/li>$/);
});

test('la lista mantiene sus nodos y conmuta `hidden` según la vista', { skip: SIN_REACT }, async () => {
  const reposo = await pintar('ui/results/Results.jsx', 'Results', {});
  for (const id of ['empty-state', 'offers', 'radius-empty', 'load-more', 'offers-status'])
    assert.match(reposo, new RegExp(`id="${id}"`), id);
  assert.match(sinClases(reposo), /<ol id="offers" hidden="">/);
  const view = {
    items: [oferta()],
    ordered: [oferta(), oferta({ establishment_id: 'est_2' })],
    tags: ['Más barata'],
    activeProduct: null,
    hasPrices: true,
    radiusEmpty: false,
    remaining: 1,
    nextCount: 2,
    paged: true,
    radius: { inert: false, total: 2 },
  };
  const lista = await pintar('ui/results/Results.jsx', 'Results', {
    view,
    viewKey: 'gasolina',
    products: ['regular', 'premium'],
    withDistance: true,
    sourceUrl: 'https://www.facilito.gob.pe/',
    onLoadMore: () => {},
  });
  assert.match(sinClases(lista), /<section id="empty-state" hidden="">/);
  assert.match(sinClases(lista), /<ol id="offers"><li data-brand="primax"/);
  assert.match(sinClases(lista), /<p>Más barata<\/p>/);
  assert.match(sinClases(lista), /<button id="load-more" type="button">Ver las 1 restantes<\/button>/);
  assert.match(
    lista,
    new RegExp(`<p id="offers-status" class="${SOLO_LECTOR}" role="status">Se muestran 1 de 2 estaciones\\.</p>`),
  );
  assert.match(lista, /id="official-source"[^>]*href="https:\/\/www\.facilito\.gob\.pe\/"/);
});

test('la portada pre-renderizada es la de siempre: inicio, «Cargando precios…» y el histórico reservado', {
  skip: SIN_REACT,
}, async () => {
  const { runnerImport } = await import('vite');
  const { module } = await runnerImport(path.join(REPO, 'ui/prerender.jsx'), {
    configFile: path.join(REPO, 'vite.config.mjs'),
    logLevel: 'error',
  });
  const html = module.renderPortada();
  assert.equal(module.renderPortada(), html, 'sin reloj ni ruta: siempre los mismos bytes');
  assert.match(sinClases(html), /<section id="start-step" aria-labelledby="start-title">/);
  assert.match(sinClases(html), /<button id="use-location" type="button" disabled="">Ver en mi ubicación<\/button>/);
  assert.match(
    html,
    new RegExp(`<p id="data-status" class="${SOLO_LECTOR}" role="status" aria-live="polite">Cargando precios…</p>`),
  );
  assert.match(sinClases(html), /<section id="history-chart" aria-labelledby="history-title" data-state="loading">/);
  assert.match(sinClases(html), /<p>Cargando el histórico…<\/p>/);
  assert.match(html, /id="controls" data-state="full" data-screen="other"/);
  for (const id of ['loading-step', 'district-step', 'compare-step'])
    assert.match(html, new RegExp(`id="${id}"[^>]*hidden=""`), `${id} oculta`);
  assert.doesNotMatch(html, /\sstyle=|<script/);
  const fuente = fs.readFileSync(path.join(REPO, 'ui/index.html'), 'utf8');
  assert.equal(fuente.split('<!--portada-->').length, 2, 'un solo lugar para la portada');
});

test('la interfaz en React no escribe HTML crudo', () => {
  const recorrer = (dir) =>
    fs
      .readdirSync(path.join(REPO, dir), { withFileTypes: true })
      .flatMap((entrada) =>
        entrada.isDirectory()
          ? recorrer(`${dir}/${entrada.name}`)
          : /\.(jsx?|mjs)$/.test(entrada.name)
            ? [`${dir}/${entrada.name}`]
            : [],
      );
  const fuentes = recorrer('ui');
  // Sin comentarios: pueden nombrar lo que ya no se hace.
  const codigo = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const archivo of fuentes)
    assert.doesNotMatch(
      codigo(fs.readFileSync(path.join(REPO, archivo), 'utf8')),
      /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/,
      archivo,
    );
});
