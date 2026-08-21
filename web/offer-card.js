export const UNVERIFIED_STATION_LABEL = 'Estación sin nombre verificado';

export const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
export const formatPrice = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(value);
const ago = (days) => days < 1 ? `hace ${Math.max(1, Math.round(days * 24))} h` : `hace ${Math.floor(days)} ${Math.floor(days) === 1 ? 'día' : 'días'}`;
const kilometers = (value) => value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(value < 10 ? 1 : 0)} km`;
const lowercaseParticles = new Set(['de', 'del', 'el', 'la', 'las', 'los', 'y']);

export function stationIdentity() {
  return UNVERIFIED_STATION_LABEL;
}

export function displayDistrict(district) {
  return String(district).trim().toLocaleLowerCase('es-PE').split(/\s+/).map((word, index) => index > 0 && lowercaseParticles.has(word) ? word : `${word[0]?.toLocaleUpperCase('es-PE') ?? ''}${word.slice(1)}`).join(' ');
}

export function directionsLabel(offer, { withDistance = true } = {}) {
  const details = [`Cómo llegar a una opción en ${displayDistrict(offer.district)}`, formatPrice(offer.price)];
  if (withDistance) details.push(`a ${kilometers(offer.distance_km)}`);
  return details.join(', ');
}

export function renderOfferCard(offer, { withDistance = true, directionsUrl = null, includeDirections = true, tag = null } = {}) {
  const distance = withDistance ? `<p class="offer__distance">${escapeHtml(kilometers(offer.distance_km))}</p>` : '';
  const action = includeDirections && directionsUrl ? `<a class="button button--primary" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(directionsLabel(offer, { withDistance }))}">Cómo llegar</a>` : '';
  const tagHtml = tag ? `<p class="offer__tag">${escapeHtml(tag)}</p>` : '';
  return `<li class="offer glass">${tagHtml}<div class="offer__topline"><p class="offer__price">${escapeHtml(formatPrice(offer.price))}</p>${distance}</div><h3 class="offer__identity">${escapeHtml(displayDistrict(offer.district))}</h3><p class="offer__context"><span class="offer__freshness">actualizado ${escapeHtml(ago(offer.age_days))}</span></p>${action}</li>`;
}
