import { brandAssetFor } from './brand-logos.js';
import { GASOLINA_KEYS, PRODUCTS } from './lib/catalog.js';

export const UNVERIFIED_STATION_LABEL = 'Estación sin nombre verificado';

export const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
export const formatPrice = (value) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(value);
// «hace 24 h» y «hace 1 día» son lo mismo; a partir de 23.5 h se redondea a día.
const ago = (days) => { const horas = Math.max(1, Math.round(days * 24)); return horas < 24 ? `hace ${horas} h` : `hace ${Math.max(1, Math.floor(days))} ${Math.floor(days) <= 1 ? 'día' : 'días'}`; };
// El silencio se mide en meses porque casi siempre son meses: «hace 190 días»
// es exacto y no se siente. `ago` se queda para la tarjeta con precio, donde el
// día sí importa.
const calladoDesde = (days) => {
  if (!Number.isFinite(days)) return 'desde hace un tiempo';
  if (days < 60) return `hace ${Math.max(1, Math.floor(days))} días`;
  return days < 365 ? `hace ${Math.round(days / 30)} meses` : 'hace más de un año';
};
// El verbo no es adorno: un precio del CSV rige desde su fecha porque el
// operador lo registró, y uno de la consulta web solo consta desde que lo
// leímos. Decir «reportado» de lo segundo afirmaría una fecha que nadie nos dio.
const VERBOS = Object.freeze({ csv: 'Reportado', facilito: 'Consultado' });
const desde = (days, source) => { const relativo = ago(days); return source ? `${VERBOS[source]} ${relativo}` : `${relativo[0].toLocaleUpperCase('es-PE')}${relativo.slice(1)}`; };
const kilometers = (value) => value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(value < 10 ? 1 : 0)} km`;
const lowercaseParticles = new Set(['de', 'del', 'el', 'la', 'las', 'los', 'y']);

export const UNCONFIRMED_LABEL = 'por confirmar';

// Las claves de producto son las mismas en datos, JS y CSS ([data-key]). Nombre
// y sigla salen del catálogo; los productos de la tarjeta, de la vista, en su
// orden. Sin vista declarada, la tarjeta es la de Gasolina, como siempre.
export const PRODUCT_CHIPS = Object.freeze(Object.fromEntries(Object.values(PRODUCTS).map((product) => [product.key, product.chip])));
// Con un solo producto en la tarjeta, su nombre accesible es el preciso
// —«Diésel B5 S-50 UV»—; con dos, basta el corto que los distingue.
const nombre = (key, products) => (products.length > 1 ? PRODUCTS[key].short : PRODUCTS[key].label);
const fechaHora = (iso) => new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(iso));
// «S/» reducido dentro de la cifra: el número es el dato que decide, la moneda solo lo acompaña.
const priceHtml = (value) => `<small>S/</small>${escapeHtml(value.toFixed(2))}`;
// El chip lleva su nombre completo para lectores de pantalla; el texto visible es la sigla.
const chip = (key, products = GASOLINA_KEYS) => `<span class="chip chip--${key}" role="img" aria-label="${escapeHtml(nombre(key, products))}">${PRODUCT_CHIPS[key]}</span>`;

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

// La marca es la firma visual de la tarjeta: un isotipo amplio y traslúcido que
// sangra por la esquina superior derecha, con un halo tenue de su color. Es
// DECORACIÓN —`aria-hidden` y `alt` vacío—, porque la tarjeta ya dice la marca en
// texto: un lector de pantalla no debe oírla dos veces. No captura eventos ni
// añade paradas de teclado.
//
// El recurso sale del registro controlado, nunca de los datos publicados: estos
// solo pueden elegir una marca conocida. Sin marca publicada, o con una marca sin
// variante registrada, no hay capa y la tarjeta se queda en superficie neutral.
export function brandMarkHtml(offer) {
  const variante = brandAssetFor(offer?.commercial_identity, 'mark');
  if (!variante) return '';
  const { asset, path } = variante;
  return `<div class="offer__brandmark" aria-hidden="true"><img src="${escapeHtml(path)}" alt="" width="${asset.width}" height="${asset.height}" loading="lazy" decoding="async"></div>`;
}

// El identificador va al marcado para que el CSS elija el halo de esa marca sin
// un estilo en línea: la CSP del sitio es `style-src 'self'`. Solo puede tomar
// uno de los slugs del registro.
export function brandAttr(offer) {
  const variante = brandAssetFor(offer?.commercial_identity, 'mark');
  return variante ? ` data-brand="${escapeHtml(variante.key)}"` : '';
}

export function displayDistrict(district) {
  return String(district).trim().toLocaleLowerCase('es-PE').split(/\s+/).map((word, index) => index > 0 && lowercaseParticles.has(word) ? word : `${word[0]?.toLocaleUpperCase('es-PE') ?? ''}${word.slice(1)}`).join(' ');
}

export function directionsLabel(offer, { withDistance = true, products = GASOLINA_KEYS } = {}) {
  const details = [`Cómo llegar a ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`];
  for (const key of products) { const item = offer.prices?.[key]; if (item) details.push(`${nombre(key, products)} ${formatPrice(item.price)}`); }
  if (withDistance) details.push(`a ${kilometers(offer.distance_km)}`);
  return details.join(', ');
}

// Panel que se despliega bajo la tarjeta. Solo usa datos que ya viajan en el
// bundle: nada externo, así que funciona igual sin conexión.
export function renderOfferDetail(offer, { prices = {}, attribution = null, products = GASOLINA_KEYS, priceUnit = null } = {}) {
  const unidad = priceUnit ? ` <small class="detail__unit">${escapeHtml(priceUnit)}</small>` : '';
  const filas = products.map((key) => {
    const item = prices[key];
    if (!item) return `<div class="detail__row detail__row--empty">${chip(key, products)}<span class="detail__price">sin precio vigente</span><span class="detail__when"></span></div>`;
    // Cada producto conserva su fuente y su fecha: aquí es donde se ve cuál de
    // los dos importes se leyó de la web y cuál lo registró el operador.
    const cuando = `${VERBOS[item.source ?? 'csv'].toLocaleLowerCase('es-PE')} ${fechaHora(item.at ?? item.reported_at)}`;
    return `<div class="detail__row">${chip(key, products)}<span class="detail__price">${priceHtml(item.price)}${unidad}</span><span class="detail__when">${escapeHtml(cuando)}</span></div>`;
  }).join('');
  const coordenada = `${offer.latitude.toFixed(5)}, ${offer.longitude.toFixed(5)}`;
  const fuente = attribution ? `<span>${escapeHtml(attribution)}</span>` : '';
  // En una fila muda las dos filas de arriba dicen «sin precio vigente»; lo que
  // el panel puede añadir es cuándo fue la última vez que reportó.
  const ultimo = offer.has_price === false && offer.last_reported_at ? `<span>Último precio reportado el <b>${escapeHtml(fechaHora(offer.last_reported_at))}</b></span>` : '';
  // Última consulta y último reporte son fechas distintas y se conservan por
  // separado: que nuestra consulta venciera no dice nada sobre el operador.
  const consultado = offer.has_price === false && offer.last_observed_at ? `<span>Última consulta el <b>${escapeHtml(fechaHora(offer.last_observed_at))}</b></span>` : '';
  return `<div class="offer__detail">${filas}<p class="detail__meta">${ultimo}${consultado}<span>Coordenada oficial <b>${escapeHtml(coordenada)}</b></span>${fuente}</p><a class="button--text" href="${escapeHtml(streetViewUrl(offer))}" target="_blank" rel="noopener noreferrer">Ver en Street View</a></div>`;
}

export function streetViewUrl(offer) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${offer.latitude},${offer.longitude}`;
}

export function detailLabel(offer) {
  return `Ver detalle de ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`;
}

// En Gasolina los dos precios se ven a la vez porque la decisión se toma
// comparándolos. Estado del bloque: --on (producto que ordena), --muted (el
// otro), --absent (sin precio vigente, siempre apagado). En «Más cerca» no hay
// énfasis. Una vista de un solo producto escribe además la unidad junto a la
// cifra: «S/ por galón» no se da por supuesto fuera de Gasolina.
function priceCell(offer, key, activeProduct, products, priceUnit) {
  const item = offer.prices?.[key];
  const clases = ['offer__price'];
  if (!item) clases.push('offer__price--absent');
  else if (activeProduct) clases.push(activeProduct === key ? 'offer__price--on' : 'offer__price--muted');
  const cifra = item ? priceHtml(item.price) : '<span aria-hidden="true">—</span><span class="sr-only">sin precio vigente</span>';
  const unidad = item && priceUnit ? `<small class="offer__unit">${escapeHtml(priceUnit)}</small>` : '';
  return `<p class="${clases.join(' ')}" data-key="${key}"><span class="chip" role="img" aria-label="${escapeHtml(nombre(key, products))}">${PRODUCT_CHIPS[key]}</span><b>${cifra}</b>${unidad}</p>`;
}

// Sin ningún precio vigente la tarjeta no desaparece: se encoge. Se va la fila
// de precios —la más alta— y queda lo que sigue siendo cierto: quién es, dónde
// está, a qué distancia y desde cuándo calla. Conserva «Ver detalle» porque el
// Street View es justo como se averigua si el grifo sigue abierto.
function renderSilentCard(offer, { withDistance, directionsUrl, includeDirections, includeDetail, products }) {
  const detail = includeDetail
    ? `<button type="button" class="button button--ghost" data-detail="${escapeHtml(offer.establishment_id)}" aria-expanded="false" aria-label="${escapeHtml(detailLabel(offer))}">Ver detalle</button>`
    : '';
  const directions = includeDirections && directionsUrl
    ? `<a class="button button--primary" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(directionsLabel(offer, { withDistance, products }))}">Cómo llegar</a>`
    : '';
  const actions = detail || directions ? `<div class="offer__actions">${detail}${directions}</div>` : '';
  const detailSlot = includeDetail ? `<div class="offer__detail-slot" data-detail-slot="${escapeHtml(offer.establishment_id)}" hidden></div>` : '';
  const address = offer.address ? escapeHtml(offer.address) : '';
  const desde = offer.last_reported_at ? ` datetime="${escapeHtml(offer.last_reported_at)}"` : '';
  // Sin precios que alinear, la fila superior no tiene nada que sostener: la
  // distancia baja a la columna derecha, junto al distrito, y la tarjeta se
  // queda en dos filas.
  const ubicacion = [withDistance ? kilometers(offer.distance_km) : '', displayDistrict(offer.district)].filter(Boolean).join(' · ');
  return `<li class="offer offer--silent glass"${brandAttr(offer)} tabindex="-1">${brandMarkHtml(offer)}<div class="offer__grid"><h3 class="offer__identity">${escapeHtml(stationIdentity(offer))}${isUnconfirmedIdentity(offer) ? `<span class="offer__unconfirmed"> · ${UNCONFIRMED_LABEL}</span>` : ''}</h3><p class="offer__address">${address}</p><p class="offer__silence"><time${desde}>Sin precio ${escapeHtml(calladoDesde(offer.silent_days))}</time></p><p class="offer__district">${escapeHtml(ubicacion)}</p></div>${actions}${detailSlot}</li>`;
}

export function renderOfferCard(offer, { withDistance = true, directionsUrl = null, includeDirections = true, includeDetail = true, tag = null, activeProduct = null, products = GASOLINA_KEYS, priceUnit = null } = {}) {
  if (offer.has_price === false) return renderSilentCard(offer, { withDistance, directionsUrl, includeDirections, includeDetail, products });
  // La distancia se alinea con los precios en vez de anclarse a la derecha: así
  // los tres datos que se comparan se leen de un barrido y la esquina superior
  // derecha queda libre para la marca. Sin píldora: el espacio ya la separa.
  const distance = withDistance ? `<p class="offer__distance"><span class="chip chip--distance" role="img" aria-label="Distancia">DIST</span><b>${escapeHtml(kilometers(offer.distance_km))}</b></p>` : '';
  const precios = products.map((key) => priceCell(offer, key, activeProduct, products, priceUnit)).join('');
  const detail = includeDetail
    ? `<button type="button" class="button button--ghost" data-detail="${escapeHtml(offer.establishment_id)}" aria-expanded="false" aria-label="${escapeHtml(detailLabel(offer))}">Ver detalle</button>`
    : '';
  const directions = includeDirections && directionsUrl
    ? `<a class="button button--primary" href="${escapeHtml(directionsUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(directionsLabel(offer, { withDistance, products }))}">Cómo llegar</a>`
    : '';
  const actions = detail || directions ? `<div class="offer__actions">${detail}${directions}</div>` : '';
  const detailSlot = includeDetail ? `<div class="offer__detail-slot" data-detail-slot="${escapeHtml(offer.establishment_id)}" hidden></div>` : '';
  const tagHtml = tag ? `<p class="offer__tag">${escapeHtml(tag)}</p>` : '';
  // La columna derecha ubica —dirección y distrito— y la izquierda identifica.
  // Sin dirección publicable, el distrito sube para que la fila no quede coja.
  // El `tabindex="-1"` no entra al tabulador: es el destino de foco al paginar.
  // La capa de marca va primera en el marcado y detrás en pintura: nunca se
  // interpone entre el contenido y quien lo toca.
  const address = offer.address ? escapeHtml(offer.address) : '';
  // Una sola línea y un solo tiempo: el del precio más reciente que la tarjeta
  // muestra, con el verbo de SU fuente. Si Regular viene de la consulta y
  // Premium del CSV, el detalle desglosa las dos; la etiqueta no promete que
  // ambos tengan la frescura del más nuevo.
  const frescura = desde(offer.age_days, offer.age_source);
  return `<li class="offer glass"${brandAttr(offer)} tabindex="-1">${brandMarkHtml(offer)}${tagHtml}<div class="offer__topline">${precios}${distance}</div><div class="offer__grid"><h3 class="offer__identity">${escapeHtml(stationIdentity(offer))}${isUnconfirmedIdentity(offer) ? `<span class="offer__unconfirmed"> · ${UNCONFIRMED_LABEL}</span>` : ''}</h3><p class="offer__address">${address || escapeHtml(displayDistrict(offer.district))}</p><p class="offer__freshness">${escapeHtml(frescura)}</p><p class="offer__district">${address ? escapeHtml(displayDistrict(offer.district)) : ''}</p></div>${actions}${detailSlot}</li>`;
}
