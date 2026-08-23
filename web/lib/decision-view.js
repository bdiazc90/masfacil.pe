import { orderOffers } from './haversine.js';

export function cheapestOffer(pool) {
  if (!pool.length) return null;
  return [...pool].sort((left, right) => left.price - right.price || left.distance_km - right.distance_km || left.id.localeCompare(right.id))[0];
}

// El tag se calcula sobre el conjunto que el radio define, así que "tu zona" ya
// no es una cantidad elástica sino los kilómetros que la persona eligió.
export function decisionTag(offer, pool, radiusKm = null) {
  const cheapest = cheapestOffer(pool);
  if (!cheapest || offer.id !== cheapest.id) return null;
  const nearest = orderOffers(pool, 'distance')[0];
  const alcance = radiusKm ? `en ${formatRadius(radiusKm)}` : 'de tu zona';
  return nearest && nearest.id === cheapest.id ? `Más barata y más cercana ${alcance}` : `Más barata ${alcance}`;
}

export function formatRadius(radiusKm) {
  return Number.isInteger(radiusKm) ? `${radiusKm} km` : `${radiusKm.toFixed(1)} km`;
}
