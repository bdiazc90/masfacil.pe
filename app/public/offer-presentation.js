// Presentación honesta de una oferta cuando algunos campos no llegan del servidor
// (política de publicación de campos estricta, Gate 2.2). Nunca inventa un sustituto:
// cuando un campo no está disponible, declara la ausencia explícitamente en el texto.

export const IDENTITY_UNAVAILABLE_LABEL = 'Identidad no publicable bajo esta política';
export const ADDRESS_UNAVAILABLE_LABEL = 'Dirección no publicable bajo esta política';
export const DISTANCE_UNAVAILABLE_LABEL = 'Distancia no disponible bajo esta política';

export function identityTitle(offer) {
  if (offer?.commercial_identity) return `${offer.commercial_identity.brand} · ${offer.commercial_identity.public_site_name}`;
  if (offer?.legal_name) return offer.legal_name;
  return IDENTITY_UNAVAILABLE_LABEL;
}

export function addressLabel(offer) {
  return offer?.address ?? ADDRESS_UNAVAILABLE_LABEL;
}

export function distanceLabel(offer, formatDistance) {
  return Number.isFinite(offer?.distance_km) ? formatDistance(offer.distance_km) : DISTANCE_UNAVAILABLE_LABEL;
}
