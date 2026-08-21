import assert from 'node:assert/strict';
import test from 'node:test';
import { cheapOffersView, cheapestOffer, decisionTag, nearOffersView } from '../web/lib/decision-view.js';

function poolOf(entries) {
  return entries.map(([id, distance_km, price]) => ({ id, distance_km, price }));
}

test('empate de precio: gana la más cercana', () => {
  const pool = poolOf([
    ['far', 5, 15],
    ['near', 1, 15],
    ['mid', 3, 15],
  ]);
  assert.equal(cheapestOffer(pool).id, 'near');
});

test('sin pool, no hay ganador', () => {
  assert.equal(cheapestOffer([]), null);
});

test('cheapest dentro del top 4 por distancia produce 4 tarjetas', () => {
  const pool = poolOf([
    ['n1', 1, 19],
    ['n2', 2, 18],
    ['n3', 3, 17],
    ['n4', 4, 16],
    ['n5', 5, 22],
  ]);
  const view = nearOffersView(pool, 4);
  assert.equal(view.length, 4);
  assert.equal(view[0].id, 'n4');
  assert.deepEqual(view.map((offer) => offer.id).sort(), ['n1', 'n2', 'n3', 'n4']);
});

test('cheapest fuera del top 4 por distancia produce 5 tarjetas', () => {
  const pool = poolOf([
    ['n1', 1, 19],
    ['n2', 2, 18],
    ['n3', 3, 17],
    ['n4', 4, 16.5],
    ['bargain', 8, 12],
  ]);
  const view = nearOffersView(pool, 4);
  assert.equal(view.length, 5);
  assert.equal(view[0].id, 'bargain');
  assert.deepEqual(view.slice(1).map((offer) => offer.id), ['n1', 'n2', 'n3', 'n4']);
});

test('vista «Más baratas» se mantiene intacta', () => {
  const pool = poolOf([
    ['a', 1, 19],
    ['b', 2, 15],
    ['c', 3, 17],
    ['d', 4, 16],
    ['e', 5, 20],
  ]);
  assert.deepEqual(cheapOffersView(pool, 4).map((offer) => offer.id), ['b', 'd', 'c', 'a']);
});

test('etiqueta doble cuando cheapest también es la más cercana del pool', () => {
  const pool = poolOf([
    ['near-cheap', 1, 15],
    ['n2', 2, 18],
    ['n3', 3, 17],
  ]);
  assert.equal(decisionTag(pool[0], pool), 'Más barata y más cercana de tu zona');
});

test('etiqueta simple cuando cheapest no es la más cercana del pool', () => {
  const pool = poolOf([
    ['n1', 1, 19],
    ['n2', 2, 18],
    ['cheap', 5, 12],
  ]);
  const cheapest = cheapestOffer(pool);
  assert.equal(decisionTag(cheapest, pool), 'Más barata de tu zona');
});

test('sin etiqueta para ofertas que no son cheapest', () => {
  const pool = poolOf([
    ['n1', 1, 19],
    ['cheap', 5, 12],
  ]);
  assert.equal(decisionTag(pool[0], pool), null);
});
