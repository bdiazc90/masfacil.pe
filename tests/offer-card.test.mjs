import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { UNVERIFIED_STATION_LABEL, directionsLabel, formatPrice, renderOfferCard, stationIdentity } from '../web/offer-card.js';

const offer = Object.freeze({ id: 'opaque-1', price: 19.84, reported_at: '2026-08-18T04:00:00.000Z', district: 'SANTIAGO DE SURCO', longitude: -76.99, latitude: -12.12, distance_km: 0.591, age_days: 3 });

test('la tarjeta con ubicación prioriza precio y distancia sin inventar identidad', () => {
  const directionsUrl = 'https://www.google.com/maps/dir/?api=1&destination=-12.12%2C-76.99&travelmode=driving';
  const card = renderOfferCard(offer, { directionsUrl });
  assert.equal(stationIdentity(), UNVERIFIED_STATION_LABEL);
  assert.equal((card.match(/Estación sin nombre verificado/g) ?? []).length, 1);
  assert.match(card, /class="offer__topline"[\s\S]*?class="offer__price">S\/\s?19\.84<[\s\S]*?class="offer__distance">591 m</);
  assert.match(card, /<h3 class="offer__identity">Estación sin nombre verificado<\/h3>/);
  assert.match(card, /Santiago de Surco<span class="offer__freshness"><span aria-hidden="true"> · <\/span>actualizado hace 3 días<\/span>/);
  assert.match(card, /aria-label="Cómo llegar a una opción en Santiago de Surco, S\/\s?19\.84, a 591 m"/);
  assert.match(card, /<a class="button button--primary" href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=-12\.12%2C-76\.99&amp;travelmode=driving" target="_blank" rel="noopener noreferrer"[^>]*>Cómo llegar<\/a>/);
  assert.doesNotMatch(card, /data-choose|<button/);
  assert.doesNotMatch(card, /Precio reportado/);
});

test('el estilo mantiene precio y distancia en una misma fila flexible', () => {
  const styles = fs.readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.offer__topline\{display:flex;align-items:baseline;justify-content:space-between;gap:12px/);
  assert.match(styles, /\.offer__price\{margin:0;white-space:nowrap\}/);
  assert.match(styles, /\.offer__distance\{flex:0 0 auto;[\s\S]*?text-align:right;white-space:nowrap\}/);
  assert.match(styles, /\.offer__freshness\{white-space:nowrap\}/);
});

test('el formateador compartido conserva el precio que usa la tarjeta y el resumen', () => {
  assert.equal(formatPrice(19.84), 'S/ 19.84');
});

test('la tarjeta distrital omite distancia sin reservar un hueco y conserva frescura singular', () => {
  const card = renderOfferCard({ ...offer, age_days: 1 }, { withDistance: false, directionsUrl: 'https://www.google.com/maps/dir/?api=1' });
  assert.doesNotMatch(card, /offer__distance|591 m|a 591 m/);
  assert.match(card, /Santiago de Surco<span class="offer__freshness"><span aria-hidden="true"> · <\/span>actualizado hace 1 día<\/span>/);
  assert.match(card, /aria-label="Cómo llegar a una opción en Santiago de Surco, S\/\s?19\.84"/);
  assert.doesNotMatch(card, /Precio reportado/);
});

test('la tarjeta puede renderizarse sin CTA cuando no hay destino válido', () => {
  const card = renderOfferCard(offer, { includeDirections: false });
  assert.match(card, /offer__topline/);
  assert.match(card, /Estación sin nombre verificado/);
  assert.doesNotMatch(card, /data-choose|<button/);
  assert.equal(directionsLabel(offer), 'Cómo llegar a una opción en Santiago de Surco, S/ 19.84, a 591 m');
});
