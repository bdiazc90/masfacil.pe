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
  // Una fila sin el producto activo va al final, no se descarta: sigue siendo un
  // grifo cercano y todavía tiene el otro precio que ofrecer.
  const accessor = { distance: (row) => row.distance_km, 'price:regular': (row) => row.prices.regular?.price ?? Infinity, 'price:premium': (row) => row.prices.premium?.price ?? Infinity }[criterion];
  if (!accessor) throw new Error(`Criterio de orden desconocido: ${criterion}`);
  return offers.map((offer, index) => ({ offer, index })).sort((left, right) => accessor(left.offer) - accessor(right.offer) || left.offer.establishment_id.localeCompare(right.offer.establishment_id) || left.index - right.index).map(({ offer }) => offer);
}

export const RADIUS_MIN_KM = 1;
export const RADIUS_MAX_KM = 5;
export const RADIUS_STEP_KM = 0.5;
export const PAGE_SIZE = 6;
export const SHOW_ALL_THRESHOLD = 4;

// El incremento se adapta a la densidad en vez de ignorarla: duplica lo que ya
// se ve y, cuando lo que falta cabe en el umbral, muestra todo. En Lima Cercado
// a 5 km son 120 estaciones en cinco toques en vez de 38, y donde quedan cuatro
// o menos no hace falta ni el botón. Cada paso al menos duplica, así que la
// sucesión siempre termina en el total.
export function nextVisibleCount(current, total) {
  const doubled = current * 2;
  return total - doubled <= SHOW_ALL_THRESHOLD ? total : doubled;
}

export function withinRadius(offers, radiusKm) {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) throw new RangeError('El radio debe ser un número positivo');
  return offers.filter((offer) => offer.distance_km <= radiusKm);
}

// Radio inicial: el menor que llena una página, redondeado al paso del control y
// acotado al rango. En Lima urbana cae en 1 km; en zonas dispersas sube solo,
// así que la app se adapta al lugar sin que nadie la configure.
export function initialRadiusKm(offers, target = PAGE_SIZE) {
  const distances = offers.map((offer) => offer.distance_km).sort((left, right) => left - right);
  const needed = distances[target - 1] ?? RADIUS_MAX_KM;
  const stepped = Math.ceil(needed / RADIUS_STEP_KM) * RADIUS_STEP_KM;
  return Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, Number(stepped.toFixed(1))));
}

// El control es inerte cuando mover el radio no cambia el resultado: pasa donde
// hay una sola estación en todo el rango. Se informa en vez de fingir.
export function radiusIsInert(offers) {
  return withinRadius(offers, RADIUS_MIN_KM).length === withinRadius(offers, RADIUS_MAX_KM).length;
}
