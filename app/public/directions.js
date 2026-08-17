const GOOGLE_MAPS_DIRECTIONS_URL = 'https://www.google.com/maps/dir/';

export function buildGoogleMapsDirectionsUrl(destination) {
  const latitude = destination?.latitude;
  const longitude = destination?.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new TypeError('El destino requiere latitud y longitud finitas');
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new RangeError('Coordenadas de destino fuera de rango');
  }

  const url = new URL(GOOGLE_MAPS_DIRECTIONS_URL);
  url.search = new URLSearchParams({
    api: '1',
    destination: `${latitude},${longitude}`,
    travelmode: 'driving',
  });
  return url.toString();
}

export function safeGoogleMapsDirectionsUrl(destination) {
  try {
    return buildGoogleMapsDirectionsUrl(destination);
  } catch {
    return null;
  }
}
