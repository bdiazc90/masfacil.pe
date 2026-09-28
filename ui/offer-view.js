// Lo que dice una tarjeta de resultados, calculado sin pintarlo.
//
// Aquí se decide cada texto, cada estado y cada enlace de la tarjeta y de su
// detalle; los componentes de `ui/results/` solo los ponen en su sitio. Por eso
// esto no importa React ni toca el DOM: las pruebas lo leen desde Node y afirman
// sobre datos, no sobre HTML.
//
// La tarjeta recibe filas ya evaluadas por las reglas (`web/lib/`): no decide
// fuentes, vigencia ni ranking.

import { brandAssetFor } from '../web/brand-logos.js';
import { GASOLINA_KEYS, PRODUCTS, VIEWS } from '../web/lib/catalog.js';
import { formatRadius } from '../web/lib/decision-view.js';
import { RADIUS_MAX_KM } from '../web/lib/haversine.js';

export const UNVERIFIED_STATION_LABEL = 'Estación sin nombre verificado';
export const UNCONFIRMED_LABEL = 'por confirmar';

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
const fechaHora = (iso) => new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(iso));

// Las claves de producto son las mismas en datos, JS y CSS ([data-key]). Nombre
// y sigla salen del catálogo; los productos de la tarjeta, de la vista, en su
// orden. Sin vista declarada, la tarjeta es la de Gasolina, como siempre.
export const PRODUCT_CHIPS = Object.freeze(Object.fromEntries(Object.values(PRODUCTS).map((product) => [product.key, product.chip])));
// Con un solo producto en la tarjeta, su nombre accesible es el preciso
// —«Diésel B5 S-50 UV»—; con dos, basta el corto que los distingue.
const nombre = (key, products) => (products.length > 1 ? PRODUCTS[key].short : PRODUCTS[key].label);
// El chip lleva su nombre completo para lectores de pantalla; el texto visible es la sigla.
const chip = (key, products) => ({ key, text: PRODUCT_CHIPS[key], label: nombre(key, products) });

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

export function directionsLabel(offer, { withDistance = true, products = GASOLINA_KEYS } = {}) {
  const details = [`Cómo llegar a ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`];
  for (const key of products) { const item = offer.prices?.[key]; if (item) details.push(`${nombre(key, products)} ${formatPrice(item.price)}`); }
  if (withDistance) details.push(`a ${kilometers(offer.distance_km)}`);
  return details.join(', ');
}

export function detailLabel(offer) {
  return `Ver detalle de ${stationIdentity(offer)} en ${displayDistrict(offer.district)}`;
}

export function streetViewUrl(offer) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${offer.latitude},${offer.longitude}`;
}

// La marca es la firma visual de la tarjeta: un isotipo amplio y traslúcido que
// sangra por la esquina superior derecha, con un halo tenue de su color. Es
// DECORACIÓN, porque la tarjeta ya dice la marca en texto.
//
// El recurso sale del registro controlado, nunca de los datos publicados: estos
// solo pueden elegir una marca conocida. Sin marca publicada, o con una marca sin
// variante registrada, no hay capa y la tarjeta se queda en superficie neutral.
// La clave va al marcado (`data-brand`) para que el CSS elija el halo sin un
// estilo en línea: la CSP del sitio es `style-src 'self'`.
function brandMark(offer) {
  const variante = brandAssetFor(offer?.commercial_identity, 'mark');
  return variante ? { key: variante.key, src: variante.path, width: variante.asset.width, height: variante.asset.height } : null;
}

// En Gasolina los dos precios se ven a la vez porque la decisión se toma
// comparándolos. Estado del bloque: `on` (producto que ordena), `muted` (el
// otro), `absent` (sin precio vigente, siempre apagado). En «Más cerca» no hay
// énfasis. Una vista de un solo producto escribe además la unidad junto a la
// cifra: «S/ por galón» no se da por supuesto fuera de Gasolina.
function priceCell(offer, key, activeProduct, products, priceUnit) {
  const item = offer.prices?.[key];
  const state = !item ? 'absent' : activeProduct ? (activeProduct === key ? 'on' : 'muted') : null;
  return { key, state, chip: PRODUCT_CHIPS[key], label: nombre(key, products), amount: item ? item.price.toFixed(2) : null, unit: item && priceUnit ? priceUnit : null };
}

/**
 * La tarjeta de una fila de resultados.
 *
 * Sin ningún precio vigente la tarjeta no desaparece: se encoge (`silent`). Se
 * va la fila de precios y queda lo que sigue siendo cierto: quién es, dónde está,
 * a qué distancia y desde cuándo calla. Conserva «Ver detalle» porque el Street
 * View es justo como se averigua si el grifo sigue abierto.
 */
export function offerCardView(offer, { withDistance = true, directionsUrl = null, includeDirections = true, includeDetail = true, tag = null, activeProduct = null, products = GASOLINA_KEYS, priceUnit = null } = {}) {
  const silent = offer.has_price === false;
  const address = offer.address ? String(offer.address) : '';
  const base = {
    silent,
    brand: brandMark(offer),
    identity: stationIdentity(offer),
    unconfirmed: isUnconfirmedIdentity(offer),
    detail: includeDetail ? { label: detailLabel(offer) } : null,
    directions: includeDirections && directionsUrl ? { url: directionsUrl, label: directionsLabel(offer, { withDistance, products }) } : null,
  };
  if (silent) {
    // Sin precios que alinear, la distancia baja a la columna derecha, junto al
    // distrito, y la tarjeta se queda en dos filas.
    return {
      ...base,
      address,
      district: [withDistance ? kilometers(offer.distance_km) : '', displayDistrict(offer.district)].filter(Boolean).join(' · '),
      silence: { text: `Sin precio ${calladoDesde(offer.silent_days)}`, dateTime: offer.last_reported_at ?? null },
      freshness: null,
      prices: [],
      distance: null,
      tag: null,
    };
  }
  // La columna derecha ubica —dirección y distrito— y la izquierda identifica.
  // Sin dirección publicable, el distrito sube para que la fila no quede coja.
  // La frescura es una sola línea y un solo tiempo: el del precio más reciente
  // que la tarjeta muestra, con el verbo de SU fuente; el detalle desglosa.
  return {
    ...base,
    address: address || displayDistrict(offer.district),
    district: address ? displayDistrict(offer.district) : '',
    silence: null,
    freshness: desde(offer.age_days, offer.age_source),
    prices: products.map((key) => priceCell(offer, key, activeProduct, products, priceUnit)),
    distance: withDistance ? kilometers(offer.distance_km) : null,
    tag: tag ?? null,
  };
}

/**
 * El panel que se despliega bajo la tarjeta. Solo usa datos que ya viajan en el
 * bundle: nada externo, así que funciona igual sin conexión.
 */
export function offerDetailView(offer, { prices = offer.prices ?? {}, attribution = null, products = GASOLINA_KEYS, priceUnit = null } = {}) {
  return {
    // Cada producto conserva su fuente y su fecha: aquí es donde se ve cuál de
    // los dos importes se leyó de la web y cuál lo registró el operador.
    rows: products.map((key) => {
      const item = prices[key];
      if (!item) return { ...chip(key, products), amount: null, unit: null, when: '' };
      return { ...chip(key, products), amount: item.price.toFixed(2), unit: priceUnit, when: `${VERBOS[item.source ?? 'csv'].toLocaleLowerCase('es-PE')} ${fechaHora(item.at ?? item.reported_at)}` };
    }),
    // En una fila muda las filas de arriba dicen «sin precio vigente»; lo que el
    // panel puede añadir es cuándo fue la última vez que reportó. Última consulta
    // y último reporte son fechas distintas: que nuestra consulta venciera no
    // dice nada sobre el operador.
    lastReported: offer.has_price === false && offer.last_reported_at ? fechaHora(offer.last_reported_at) : null,
    lastObserved: offer.has_price === false && offer.last_observed_at ? fechaHora(offer.last_observed_at) : null,
    coordinate: `${offer.latitude.toFixed(5)}, ${offer.longitude.toFixed(5)}`,
    attribution: attribution || null,
    streetViewUrl: streetViewUrl(offer),
  };
}

/**
 * Los textos de la lista que dependen de la vista: «Ver más», el recuento para
 * lectores de pantalla y el vacío por radio. Sin vista, los de reposo.
 */
export function resultsCopy(view, viewKey) {
  if (!view) return { loadMore: '', status: '', radiusEmpty: { title: 'Ningún grifo en este radio', text: 'Amplía el radio de búsqueda para encontrar estaciones más lejanas.' } };
  // Sin ninguna estación en todo el rango, ampliar el radio no sirve: se dice, y
  // se ofrece lo que sí sirve.
  const nadaEnElRango = view.radius?.inert && view.radius.total === 0;
  return {
    // El botón carga su propio salto: la etiqueta y lo que hace salen del mismo
    // número, así que no pueden discrepar.
    loadMore: view.nextCount >= view.ordered.length ? `Ver las ${view.remaining} restantes` : `Ver ${view.nextCount - view.items.length} más (${view.remaining} restantes)`,
    // Cuando sí paginó, el último toque cierra con «N de N», que es lo que el
    // botón ya no puede decir.
    status: view.paged ? `Se muestran ${view.items.length} de ${view.ordered.length} estaciones.` : '',
    radiusEmpty: nadaEnElRango
      ? { title: `Ningún grifo a ${formatRadius(RADIUS_MAX_KM)}`, text: `No hay estaciones de ${VIEWS[viewKey].label} cerca de ti. Busca por distrito o elige otro combustible.` }
      : { title: 'Ningún grifo en este radio', text: 'Amplía el radio de búsqueda para encontrar estaciones más lejanas.' },
  };
}
