import { loadGasolina } from './data-client.js';
import { haversineKm, initialRadiusKm, nextVisibleCount, orderOffers, radiusIsInert, withinRadius, PAGE_SIZE, RADIUS_MAX_KM, RADIUS_MIN_KM, SHOW_ALL_THRESHOLD } from './lib/haversine.js';
import { decisionTag, formatRadius } from './lib/decision-view.js';
import { filterFreshOffers } from './lib/freshness.js';
import { mergeOfferRows } from './lib/merge-products.js';
import { safeGoogleMapsDirectionsUrl } from './lib/directions.js';
import { visibleDistricts } from './district-list.js';
import { UNVERIFIED_STATION_LABEL, displayDistrict, escapeHtml, renderOfferCard, renderOfferDetail } from './offer-card.js';
import { GASOLINA_KEYS } from './gasolina-contract.js';
import { prepareServiceWorker } from './service-worker-ready.js';
import { initTheme } from './theme.js';

const state = { dataset: null, dataMode: 'network', origin: null, district: null, districts: [], showAllDistricts: false, fresh: [], located: [], pool: [], radiusKm: RADIUS_MIN_KM, visibleCount: PAGE_SIZE, sort: 'distance', priceProduct: 'regular', locationAttempt: 0 };
const $ = (id) => document.getElementById(id);
const nodes = Object.fromEntries(['start-step', 'loading-step', 'district-step', 'district-hint', 'compare-step', 'fatal-state', 'location-status', 'data-status', 'districts', 'district-search', 'district-empty', 'district-show-all', 'compare-title', 'sort-toggle', 'price-product-toggle', 'offers', 'offers-note', 'offers-status', 'offline-note', 'empty-state', 'official-source', 'source-content', 'fatal-message', 'radius-control', 'radius-input', 'radius-readout', 'radius-empty', 'load-more'].map((id) => [id, $(id)]));
const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(value));

function show(name) { for (const key of ['start-step', 'loading-step', 'district-step', 'compare-step', 'fatal-state']) nodes[key].hidden = key !== name; $('main').setAttribute('aria-busy', String(name === 'loading-step')); }
// La vigencia se evalúa por producto y recién después se fusiona: un grifo con
// Regular vigente y Premium vencido conserva su tarjeta y apaga solo ese precio.
function currentFresh() {
  const now = () => new Date();
  return mergeOfferRows(Object.fromEntries(GASOLINA_KEYS.map((key) => [key, filterFreshOffers(state.dataset.offers[key], { now, cutoffAt: state.dataset.cutoff_at }).offers])));
}
function renderRadiusControl() {
  const inerte = radiusIsInert(state.located);
  nodes['radius-control'].hidden = false;
  nodes['radius-input'].value = String(state.radiusKm);
  nodes['radius-input'].disabled = inerte;
  const total = state.pool.length;
  // Inerte significa que mover el radio no cambia el conteo, no que haya una
  // sola estación: en Pucusana son tres en todo el rango.
  nodes['radius-readout'].textContent = inerte
    ? (total === 1 ? `Única estación en ${formatRadius(RADIUS_MAX_KM)}` : `Las mismas ${total} estaciones en todo el radio`)
    : `${formatRadius(state.radiusKm)} · ${total} ${total === 1 ? 'estación' : 'estaciones'}`;
}

function renderOffers() {
  const noOrigin = !state.origin;
  const porPrecio = state.sort.startsWith('price:');
  const producto = state.priceProduct;
  // Con ubicación: el radio filtra, el toggle solo ordena y la lista pagina.
  // Cada control hace una cosa.
  state.pool = noOrigin ? [] : withinRadius(state.located, state.radiusKm);
  const ordenadas = noOrigin
    ? orderOffers(state.fresh.filter((row) => row.district === state.district && row.prices[producto]), `price:${producto}`)
    : orderOffers(state.pool, state.sort);
  // Si lo que falta cabe en el umbral se muestra entero: un botón para cuatro
  // tarjetas cuesta más de lo que ahorra.
  const pedidas = Math.min(state.visibleCount, ordenadas.length);
  const corte = ordenadas.length - pedidas <= SHOW_ALL_THRESHOLD ? ordenadas.length : pedidas;
  const items = ordenadas.slice(0, corte);
  const showTag = !noOrigin && items.length > 1;
  const activeProduct = porPrecio || noOrigin ? producto : null;
  nodes.offers.innerHTML = items.map((offer) => renderOfferCard(offer, { withDistance: !noOrigin, directionsUrl: safeGoogleMapsDirectionsUrl(offer), tag: showTag ? decisionTag(offer, state.pool, state.radiusKm, producto) : null, activeProduct })).join('');
  nodes.offers.hidden = items.length === 0;
  nodes['sort-toggle'].hidden = noOrigin || items.length < 2;
  // El sub-toggle solo aparece cuando el orden depende del producto: en «Más
  // cerca» no ordena nada y sería un control que no hace lo que promete.
  nodes['price-product-toggle'].hidden = !(porPrecio || noOrigin) || items.length < 2;
  if (!noOrigin) renderRadiusControl();
  nodes['radius-empty'].hidden = noOrigin || items.length > 0;
  const restantes = ordenadas.length - items.length;
  const siguiente = nextVisibleCount(items.length, ordenadas.length);
  nodes['load-more'].hidden = restantes <= 0;
  // El botón carga su propio salto: la etiqueta y lo que hace salen del mismo
  // número, así que no pueden discrepar.
  nodes['load-more'].dataset.siguiente = String(siguiente);
  nodes['load-more'].textContent = siguiente >= ordenadas.length ? `Ver las ${restantes} restantes` : `Ver ${siguiente - items.length} más (${restantes} restantes)`;
  // Solo habla cuando hubo algo que paginar: en una lista que cabe entera el
  // radio ya dice cuántas son y repetirlo sería ruido. Cuando sí paginó, el
  // último toque cierra con «N de N», que es lo que el botón ya no puede decir.
  nodes['offers-status'].textContent = ordenadas.length > items.length || ordenadas.length > PAGE_SIZE + SHOW_ALL_THRESHOLD ? `Se muestran ${items.length} de ${ordenadas.length} estaciones.` : '';
  nodes['offers-note'].textContent = items.some((offer) => !offer.commercial_identity) ? UNVERIFIED_STATION_LABEL : '';
  nodes['offers-note'].hidden = items.length === 0 || !nodes['offers-note'].textContent;
  document.querySelectorAll('[data-sort]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sort === (porPrecio ? 'price' : 'distance'))));
  document.querySelectorAll('[data-price-product]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.priceProduct === producto)));
}

// Los dos precios ya viajan en la fila, así que el panel se abre sin pedir nada
// y funciona igual sin conexión.
function toggleDetail(button) {
  const slot = nodes.offers.querySelector(`[data-detail-slot="${CSS.escape(button.dataset.detail)}"]`);
  const offer = state.pool.concat(state.fresh).find((item) => item.establishment_id === button.dataset.detail);
  if (!slot || !offer) return;
  const abierto = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!abierto));
  button.textContent = abierto ? 'Ver detalle' : 'Ocultar';
  slot.hidden = abierto;
  slot.innerHTML = abierto ? '' : renderOfferDetail(offer, { prices: offer.prices, attribution: state.dataset.provenance.attribution });
}

function renderResults() {
  state.fresh = currentFresh();
  nodes['official-source'].href = state.dataset.provenance.source_url;
  nodes['empty-state'].hidden = state.fresh.length > 0;
  nodes.offers.hidden = state.fresh.length === 0;
  nodes['sort-toggle'].hidden = state.fresh.length === 0 || !state.origin;
  if (state.fresh.length === 0) return;
  state.visibleCount = PAGE_SIZE;
  if (state.origin) {
    state.located = state.fresh.map((offer) => ({ ...offer, distance_km: haversineKm(state.origin, offer) }));
    state.radiusKm = initialRadiusKm(state.located);
    state.sort = 'distance';
    nodes['compare-title'].textContent = 'Cerca de ti';
  } else {
    state.located = [];
    nodes['radius-control'].hidden = true;
    nodes['radius-empty'].hidden = true;
    nodes['compare-title'].textContent = `Más baratas en ${displayDistrict(state.district)}`;
  }
  renderOffers();
}
function showCompare() {
  renderResults();
  nodes['offline-note'].hidden = state.dataMode !== 'saved';
  nodes['offline-note'].textContent = state.dataMode === 'saved' ? `Sin conexión · precios guardados del ${formatDate(state.dataset.cutoff_at)}.` : '';
  show('compare-step'); $('compare-title').focus();
}
function renderDistricts(query = '') {
  const normalizedQuery = query.trim();
  const matches = visibleDistricts(state.districts, normalizedQuery, state.showAllDistricts);
  nodes.districts.innerHTML = matches.map((district) => `<button type="button" data-district="${escapeHtml(district)}">${escapeHtml(displayDistrict(district))}</button>`).join('');
  nodes['district-empty'].hidden = !normalizedQuery || matches.length > 0;
  nodes['district-show-all'].hidden = state.showAllDistricts || Boolean(normalizedQuery);
}
function chooseDistrict({ fromError = false } = {}) {
  state.locationAttempt += 1;
  state.districts = [...new Set(currentFresh().map((offer) => offer.district))].sort();
  state.showAllDistricts = false;
  nodes['district-search'].value = '';
  renderDistricts();
  nodes['district-hint'].hidden = !fromError;
  show('district-step'); $('district-title').focus();
}
function locate() {
  if (!navigator.geolocation) { chooseDistrict({ fromError: true }); return; }
  const attempt = ++state.locationAttempt;
  show('loading-step');
  navigator.geolocation.getCurrentPosition((position) => {
    if (attempt !== state.locationAttempt) return;
    state.origin = { latitude: position.coords.latitude, longitude: position.coords.longitude }; state.district = null; showCompare();
  }, () => { if (attempt !== state.locationAttempt) return; state.origin = null; chooseDistrict({ fromError: true }); }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
}
function cancelLocation() { state.locationAttempt += 1; chooseDistrict(); }
function fatal(error) { console.error(error); nodes['fatal-message'].textContent = navigator.onLine ? 'No pudimos cargar los precios. Revisa tu conexión y reintenta.' : 'No hay datos guardados todavía. Conéctate una vez para descargar precios.'; show('fatal-state'); }
function applyLoaded(dataset) {
  state.dataset = dataset; state.dataMode = dataset.dataMode;
  const fresh = currentFresh();
  document.querySelector('meta[name="description"]').content = 'Compara precio y cercanía de Gasohol Regular y Premium en Lima provincia.';
  $('use-location').disabled = false;
  $('choose-district').disabled = false;
  nodes['data-status'].textContent = `${fresh.length} grifos con precio vigente · corte ${formatDate(state.dataset.cutoff_at)}.`;
  nodes['data-status'].classList.add('sr-only');
  nodes['source-content'].innerHTML = `<p>${escapeHtml(state.dataset.provenance.attribution)}</p><p>Cada tarjeta muestra los dos productos. «—» significa que ese grifo no tiene precio vigente de ese producto, no que no lo venda.</p><p>La distancia es geodésica en línea recta. No calculamos ruta, ETA, tráfico ni costo del desvío. Proyecto independiente, sin afiliación con Osinergmin, Facilito ni el Estado.</p><p>Tu zona es el radio que eliges con el control, entre ${RADIUS_MIN_KM} y ${RADIUS_MAX_KM} km de tu ubicación.</p><p>Los nombres de estación se cruzan contra el Registro oficial de Osinergmin. Auditamos 54 al azar y encontramos 0 errores: la precisión medida es de al menos 89 % en los nombres confirmados y 86 % en los marcados <b>por confirmar</b>. Si ves un nombre equivocado, escríbenos.</p><p><a href="${escapeHtml(state.dataset.provenance.source_url)}" target="_blank" rel="noopener noreferrer">Ver fuente de Osinergmin</a></p>`;
}
async function hasGrantedLocationPermission() {
  try { return (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted'; }
  catch { return false; }
}
async function initialize() {
  try {
    await prepareServiceWorker();
    applyLoaded(await loadGasolina());
    if (await hasGrantedLocationPermission()) locate();
  } catch (error) { fatal(error); }
}

$('use-location').addEventListener('click', locate); $('choose-district').addEventListener('click', chooseDistrict); $('retry-location').addEventListener('click', locate);
$('cancel-location').addEventListener('click', cancelLocation); nodes['district-search'].addEventListener('input', () => { state.showAllDistricts = false; renderDistricts(nodes['district-search'].value); }); nodes['district-show-all'].addEventListener('click', () => { state.showAllDistricts = true; renderDistricts(nodes['district-search'].value); });
nodes.districts.addEventListener('click', (event) => { const district = event.target.closest('[data-district]')?.dataset.district; if (district) { state.origin = null; state.district = district; showCompare(); } });
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => { state.sort = button.dataset.sort === 'price' ? `price:${state.priceProduct}` : 'distance'; state.visibleCount = PAGE_SIZE; renderOffers(); }));
// El sub-toggle recuerda la elección aunque se vuelva a «Más cerca», así que
// quien compara Premium no tiene que volver a decirlo en cada vuelta.
document.querySelectorAll('[data-price-product]').forEach((button) => button.addEventListener('click', () => { state.priceProduct = button.dataset.priceProduct; if (state.sort.startsWith('price:')) state.sort = `price:${state.priceProduct}`; state.visibleCount = PAGE_SIZE; renderOffers(); }));
nodes.offers.addEventListener('click', (event) => { const button = event.target.closest('[data-detail]'); if (button) toggleDetail(button); });
// Filtrado local sobre datos ya cargados: no hay red, así que `input` responde
// mientras se arrastra sin costo perceptible.
nodes['radius-input'].addEventListener('input', () => { state.radiusKm = Number(nodes['radius-input'].value); state.visibleCount = PAGE_SIZE; renderOffers(); });
nodes['load-more'].addEventListener('click', () => {
  const pintadas = nodes.offers.children.length;
  state.visibleCount = Number(nodes['load-more'].dataset.siguiente);
  renderOffers();
  // El botón puede acabar de desaparecer y el foco caería en <body>. Pasa a la
  // primera tarjeta nueva, que es justo lo que se acaba de pedir.
  nodes.offers.children[pintadas]?.focus();
});
$('change-origin').addEventListener('click', () => show('start-step')); $('retry-load').addEventListener('click', () => location.reload());
initTheme();
initialize();
