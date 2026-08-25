export const UNVERIFIED_STATION_LABEL = 'Estación sin nombre verificado';

export const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
export const formatPrice = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(value);
// «hace 24 h» y «hace 1 día» son lo mismo; a partir de 23.5 h se redondea a día.
const ago = (days) => { const horas = Math.max(1, Math.round(days * 24)); return horas < 24 ? `hace ${horas} h` : `hace ${Math.max(1, Math.floor(days))} ${Math.floor(days) <= 1 ? 'día' : 'días'}`; };
const kilometers = (value) => value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(value < 10 ? 1 : 0)} km`;
const lowercaseParticles = new Set(['de', 'del', 'el', 'la', 'las', 'los', 'y']);

export const UNCONFIRMED_LABEL = 'por confirmar';

// Las claves de producto son las mismas en datos, JS y CSS ([data-key]).
const PRODUCTOS = Object.freeze({ regular: 'Regular', premium: 'Premium' });
export const PRODUCT_CHIPS = Object.freeze({ regular: 'REG', premium: 'PRE' });
const fechaHora = (iso) => new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(iso));
// «S/» reducido dentro de la cifra: el número es el dato que decide, la moneda solo lo acompaña.
const priceHtml = (value) => `<small>S/</small>${escapeHtml(value.toFixed(2))}`;
// El chip lleva su nombre completo para lectores de pantalla; el texto visible es la sigla.
const chip = (key, extra = '') => `<span class="chip chip--${key}${extra}" role="img" aria-label="${escapeHtml(PRODUCTOS[key])}">${PRODUCT_CHIPS[key]}</span>`;

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

/** Un nombre `nearby` solo tiene cercanía comprobada: se muestra, marcado. */
export function isUnconfirmedIdentity(offer) {
  return offer?.commercial_identity?.confidence === 'nearby';
}

export function displayDistrict(district) {
  return String(district).trim().toLocaleLowerCase('es-PE').split(/\s+/).map((word, index) => index > 0 && lowercaseParticles.has(word) ? word : `${word[0]?.toLocaleUpperCase('es-PE') ?? ''}${word.slice(1)}`).join(' ');
}

export function directionsLabel(offer, { withDistance = true } = {}) {
  const details = [`Cómo llegar a ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`];
  for (const [key, label] of Object.entries(PRODUCTOS)) { const item = offer.prices?.[key]; if (item) details.push(`${label} ${formatPrice(item.price)}`); }
  if (withDistance) details.push(`a ${kilometers(offer.distance_km)}`);
  return details.join(', ');
}

// Panel que se despliega bajo la tarjeta. Solo usa datos que ya viajan en el
// bundle: nada externo, así que funciona igual sin conexión.
export function renderOfferDetail(offer, { prices = {}, attribution = null } = {}) {
  const filas = Object.keys(PRODUCTOS).map((key) => {
    const item = prices[key];
    if (!item) return `<div class="detail__row detail__row--empty">${chip(key)}<span class="detail__price">sin precio vigente</span><span class="detail__when"></span></div>`;
    return `<div class="detail__row">${chip(key)}<span class="detail__price">${priceHtml(item.price)}</span><span class="detail__when">${escapeHtml(fechaHora(item.reported_at))}</span></div>`;
  }).join('');
  const coordenada = `${offer.latitude.toFixed(5)}, ${offer.longitude.toFixed(5)}`;
  const fuente = attribution ? `<span>${escapeHtml(attribution)}</span>` : '';
  return `<div class="offer__detail">${filas}<p class="detail__meta"><span>Coordenada oficial <b>${escapeHtml(coordenada)}</b></span>${fuente}</p><a class="button--text" href="${escapeHtml(streetViewUrl(offer))}" target="_blank" rel="noopener noreferrer">Ver en Street View</a></div>`;
}

export function streetViewUrl(offer) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${offer.latitude},${offer.longitude}`;
}

export function detailLabel(offer) {
  return `Ver detalle de ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`;
}

// Los dos precios se ven a la vez porque la decisión se toma comparándolos.
// Estado del bloque: --on (producto que ordena), --muted (el otro), --absent
// (sin precio vigente, siempre apagado). En «Más cerca» no hay énfasis.
function priceCell(offer, key, activeProduct) {
  const item = offer.prices?.[key];
  const clases = ['offer__price'];
  if (!item) clases.push('offer__price--absent');
  else if (activeProduct) clases.push(activeProduct === key ? 'offer__price--on' : 'offer__price--muted');
  const cifra = item ? priceHtml(item.price) : '<span aria-hidden="true">—</span><span class="sr-only">sin precio vigente</span>';
  return `<p class="${clases.join(' ')}" data-key="${key}"><span class="chip" role="img" aria-label="${escapeHtml(PRODUCTOS[key])}">${PRODUCT_CHIPS[key]}</span><b>${cifra}</b></p>`;
}

export function renderOfferCard(offer, { withDistance = true, directionsUrl = null, includeDirections = true, includeDetail = true, tag = null, activeProduct = null } = {}) {
  const distance = withDistance ? `<p class="offer__distance"><span class="chip chip--distance" role="img" aria-label="Distancia">DIST</span><b>${escapeHtml(kilometers(offer.distance_km))}</b></p>` : '';
  const precios = Object.keys(PRODUCTOS).map((key) => priceCell(offer, key, activeProduct)).join('');
  const detail = includeDetail
    ? `<button type="button" class="button button--ghost" data-detail="${escapeHtml(offer.establishment_id)}" aria-expanded="false" aria-label="${escapeHtml(detailLabel(offer))}">Ver detalle</button>`
    : '';
  const directions = includeDirections && directionsUrl
    ? `<a class="button button--primary" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(directionsLabel(offer, { withDistance }))}">Cómo llegar</a>`
    : '';
  const actions = detail || directions ? `<div class="offer__actions">${detail}${directions}</div>` : '';
  const detailSlot = includeDetail ? `<div class="offer__detail-slot" data-detail-slot="${escapeHtml(offer.establishment_id)}" hidden></div>` : '';
  const tagHtml = tag ? `<p class="offer__tag">${escapeHtml(tag)}</p>` : '';
  // La columna derecha ubica —dirección y distrito— y la izquierda identifica.
  // Sin dirección publicable, el distrito sube para que la fila no quede coja.
  // El `tabindex="-1"` no entra al tabulador: es el destino de foco al paginar.
  const address = offer.address ? escapeHtml(offer.address) : '';
  const frescura = ago(offer.age_days);
  return `<li class="offer glass" tabindex="-1">${tagHtml}<div class="offer__topline">${precios}${distance}</div><div class="offer__grid"><h3 class="offer__identity">${escapeHtml(stationIdentity(offer))}${isUnconfirmedIdentity(offer) ? `<span class="offer__unconfirmed"> · ${UNCONFIRMED_LABEL}</span>` : ''}</h3><p class="offer__address">${address || escapeHtml(displayDistrict(offer.district))}</p><p class="offer__freshness">${escapeHtml(`${frescura[0].toLocaleUpperCase('es-PE')}${frescura.slice(1)}`)}</p><p class="offer__district">${address ? escapeHtml(displayDistrict(offer.district)) : ''}</p></div>${actions}${detailSlot}</li>`;
}
