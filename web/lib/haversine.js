const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees) => degrees * Math.PI / 180;

export function haversineKm(origin, destination) {
  for (const point of [origin, destination]) {
    if (!Number.isFinite(point?.latitude) || !Number.isFinite(point?.longitude)) throw new TypeError('Haversine requiere latitud y longitud numéricas');
    if (point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) throw new RangeError('Coordenada fuera de rango');
  }
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(toRadians(origin.latitude)) * Math.cos(toRadians(destination.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function orderOffers(offers, criterion = 'distance') {
  const accessor = { distance: (offer) => offer.distance_km, price: (offer) => offer.price, freshness: (offer) => offer.age_days }[criterion];
  if (!accessor) throw new Error(`Criterio de orden desconocido: ${criterion}`);
  return offers.map((offer, index) => ({ offer, index })).sort((left, right) => accessor(left.offer) - accessor(right.offer) || left.offer.id.localeCompare(right.offer.id) || left.index - right.index).map(({ offer }) => offer);
}

export function nearestPool(offers, size = 20) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('El tamaño del pool debe ser un entero positivo');
  return orderOffers(offers, 'distance').slice(0, size);
}

export function visibleOffers(offers, criterion = 'distance', poolSize = 20, visibleSize = 6) {
  if (!Number.isInteger(visibleSize) || visibleSize < 1) throw new RangeError('La cantidad visible debe ser un entero positivo');
  return orderOffers(nearestPool(offers, poolSize), criterion).slice(0, visibleSize);
}
