export const UNVERIFIED_STATION_LABEL = 'Estación sin nombre verificado';

export const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
export const formatPrice = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(value);
const ago = (days) => days < 1 ? `hace ${Math.max(1, Math.round(days * 24))} h` : `hace ${Math.floor(days)} ${Math.floor(days) === 1 ? 'día' : 'días'}`;
const kilometers = (value) => value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(value < 10 ? 1 : 0)} km`;
const lowercaseParticles = new Set(['de', 'del', 'el', 'la', 'las', 'los', 'y']);

export function stationIdentity(offer) {
  const identity = offer?.commercial_identity;
  if (!identity) return UNVERIFIED_STATION_LABEL;
  const labels = [identity.brand, identity.public_site_name].filter((value) => typeof value === 'string' && value.trim());
  if (!labels.length) return UNVERIFIED_STATION_LABEL;
  // "Primax · Primax Granada" repite la marca. Cuando el nombre de sede ya la
  // contiene, basta con el nombre de sede.
  const [brand, site] = [identity.brand, identity.public_site_name];
  if (brand && site && site.toLocaleLowerCase('es-PE').includes(brand.toLocaleLowerCase('es-PE'))) return site;
  return labels.join(' · ');
}

export function displayDistrict(district) {
  return String(district).trim().toLocaleLowerCase('es-PE').split(/\s+/).map((word, index) => index > 0 && lowercaseParticles.has(word) ? word : `${word[0]?.toLocaleUpperCase('es-PE') ?? ''}${word.slice(1)}`).join(' ');
}

export function directionsLabel(offer, { withDistance = true } = {}) {
  const details = [`Cómo llegar a ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`, formatPrice(offer.price)];
  if (withDistance) details.push(`a ${kilometers(offer.distance_km)}`);
  return details.join(', ');
}

const PRODUCTOS = Object.freeze({ regular: 'Regular', premium: 'Premium' });
const fechaHora = (iso) => new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(iso));

// Panel que se despliega bajo la tarjeta. Solo usa datos que ya viajan en el
// bundle: nada externo, así que funciona igual sin conexión.
export function renderOfferDetail(offer, { prices = {}, attribution = null } = {}) {
  const filas = Object.entries(PRODUCTOS).map(([key, label]) => {
    const item = prices[key];
    if (!item) return `<div class="detail__row detail__row--empty"><span>${escapeHtml(label)}</span><span>sin precio vigente</span></div>`;
    return `<div class="detail__row"><span class="detail__product">${escapeHtml(label)}</span><span class="detail__price">${escapeHtml(formatPrice(item.price))}</span><span class="detail__when">${escapeHtml(fechaHora(item.reported_at))}</span></div>`;
  }).join('');
  const coordenada = `${offer.latitude.toFixed(5)}, ${offer.longitude.toFixed(5)}`;
  const fuente = attribution ? `<p class="detail__source">${escapeHtml(attribution)}</p>` : '';
  return `<div class="offer__detail">${filas}<p class="detail__meta">Coordenada oficial ${escapeHtml(coordenada)}</p>${fuente}<a class="button button--text" href="${escapeHtml(streetViewUrl(offer))}" target="_blank" rel="noopener noreferrer">Ver en Street View</a></div>`;
}

export function streetViewUrl(offer) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${offer.latitude},${offer.longitude}`;
}

export function detailLabel(offer) {
  return `Ver detalle de ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`;
}

export function renderOfferCard(offer, { withDistance = true, directionsUrl = null, includeDirections = true, includeDetail = true, tag = null } = {}) {
  const distance = withDistance ? `<p class="offer__distance">${escapeHtml(kilometers(offer.distance_km))}</p>` : '';
  const detail = includeDetail
    ? `<button type="button" class="button button--ghost" data-detail="${escapeHtml(offer.id)}" aria-expanded="false" aria-label="${escapeHtml(detailLabel(offer))}">Ver detalle</button>`
    : '';
  const directions = includeDirections && directionsUrl
    ? `<a class="button button--primary" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(directionsLabel(offer, { withDistance }))}">Cómo llegar</a>`
    : '';
  const actions = detail || directions ? `<div class="offer__actions">${detail}${directions}</div>` : '';
  const detailSlot = includeDetail ? `<div class="offer__detail-slot" data-detail-slot="${escapeHtml(offer.id)}" hidden></div>` : '';
  const tagHtml = tag ? `<p class="offer__tag">${escapeHtml(tag)}</p>` : '';
  // La columna derecha ubica —dirección y distrito— y la izquierda identifica.
  // Sin dirección publicable, el distrito sube para que la fila no quede coja.
  const address = offer.address ? escapeHtml(offer.address) : '';
  return `<li class="offer glass">${tagHtml}<div class="offer__topline"><p class="offer__price">${escapeHtml(formatPrice(offer.price))}</p>${distance}</div><div class="offer__grid"><h3 class="offer__identity">${escapeHtml(stationIdentity(offer))}</h3><p class="offer__address">${address || escapeHtml(displayDistrict(offer.district))}</p><p class="offer__freshness">${escapeHtml(`${ago(offer.age_days)[0].toLocaleUpperCase('es-PE')}${ago(offer.age_days).slice(1)}`)}</p><p class="offer__district">${address ? escapeHtml(displayDistrict(offer.district)) : ''}</p></div>${actions}${detailSlot}</li>`;
}
