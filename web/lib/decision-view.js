import { orderOffers } from './haversine.js';
import { PRODUCTS } from './catalog.js';

// El más barato del radio, en el producto activo. Una fila que no publica ese
// producto no compite: no tiene precio que comparar, y darle `Infinity` la
// dejaría ganando el empate contra otra igual de vacía.
export function cheapestOffer(pool, product = 'regular') {
  const conPrecio = pool.filter((row) => row.prices?.[product]);
  if (!conPrecio.length) return null;
  return conPrecio.sort((left, right) => left.prices[product].price - right.prices[product].price || left.distance_km - right.distance_km || left.establishment_id.localeCompare(right.establishment_id))[0];
}

// El tag se calcula sobre el conjunto que el radio define, así que "tu zona" ya
// no es una cantidad elástica sino los kilómetros que la persona eligió.
export function decisionTag(offer, pool, radiusKm = null, product = 'regular') {
  const cheapest = cheapestOffer(pool, product);
  if (!cheapest || offer.establishment_id !== cheapest.establishment_id) return null;
  const nearest = orderOffers(pool, 'distance')[0];
  const alcance = radiusKm ? `en ${formatRadius(radiusKm)}` : 'de tu zona';
  const { short: etiqueta } = PRODUCTS[product] ?? PRODUCTS.regular;
  const a = concordancia(product);
  return nearest && nearest.establishment_id === cheapest.establishment_id ? `${etiqueta} más barat${a} y más cercan${a} ${alcance}` : `${etiqueta} más barat${a} ${alcance}`;
}

/** La vocal que concuerda con el producto: «Regular más barata», «Diésel más barato». */
export const concordancia = (product) => ((PRODUCTS[product] ?? PRODUCTS.regular).gender === 'm' ? 'o' : 'a');

export function formatRadius(radiusKm) {
  return Number.isInteger(radiusKm) ? `${radiusKm} km` : `${radiusKm.toFixed(1)} km`;
}
