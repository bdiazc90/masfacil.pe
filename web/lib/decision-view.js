import { orderOffers } from './haversine.js';

export function cheapestOffer(pool) {
  if (!pool.length) return null;
  return [...pool].sort((left, right) => left.price - right.price || left.distance_km - right.distance_km || left.id.localeCompare(right.id))[0];
}

export function nearOffersView(pool, visibleSize = 4) {
  const cheapest = cheapestOffer(pool);
  if (!cheapest) return [];
  const nearest = orderOffers(pool, 'distance').slice(0, visibleSize).filter((offer) => offer.id !== cheapest.id);
  return [cheapest, ...nearest];
}

export function cheapOffersView(pool, visibleSize = 4) {
  return orderOffers(pool, 'price').slice(0, visibleSize);
}

export function decisionTag(offer, pool) {
  const cheapest = cheapestOffer(pool);
  if (!cheapest || offer.id !== cheapest.id) return null;
  const nearest = orderOffers(pool, 'distance')[0];
  return nearest && nearest.id === cheapest.id ? 'Más barata y más cercana de tu zona' : 'Más barata de tu zona';
}
