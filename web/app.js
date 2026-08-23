import { loadGasolinaProduct } from './data-client.js';
import { haversineKm, initialRadiusKm, orderOffers, radiusIsInert, withinRadius, PAGE_INCREMENT, PAGE_SIZE, RADIUS_MAX_KM, RADIUS_MIN_KM } from './lib/haversine.js';
import { decisionTag, formatRadius } from './lib/decision-view.js';
import { filterFreshOffers } from './lib/freshness.js';
import { safeGoogleMapsDirectionsUrl } from './lib/directions.js';
import { visibleDistricts } from './district-list.js';
import { UNVERIFIED_STATION_LABEL, displayDistrict, escapeHtml, renderOfferCard, renderOfferDetail } from './offer-card.js';
import { GASOLINA_KEYS } from './gasolina-contract.js';
import { prepareServiceWorker } from './service-worker-ready.js';
import { initTheme } from './theme.js';

const state = { dataset: null, dataMode: 'network', product: null, origin: null, district: null, districts: [], showAllDistricts: false, fresh: [], located: [], pool: [], radiusKm: RADIUS_MIN_KM, visibleCount: PAGE_SIZE, sort: 'distance', locationAttempt: 0, otherPrices: null, otherPending: null };
const $ = (id) => document.getElementById(id);
const nodes = Object.fromEntries(['start-step', 'loading-step', 'district-step', 'district-hint', 'compare-step', 'fatal-state', 'location-status', 'data-status', 'districts', 'district-search', 'district-empty', 'district-show-all', 'compare-title', 'sort-toggle', 'product-toggle', 'offers', 'offers-note', 'offline-note', 'empty-state', 'official-source', 'source-content', 'fatal-message', 'radius-control', 'radius-input', 'radius-readout', 'radius-empty', 'load-more'].map((id) => [id, $(id)]));
const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(value));

function show(name) { for (const key of ['start-step', 'loading-step', 'district-step', 'compare-step', 'fatal-state']) nodes[key].hidden = key !== name; $('main').setAttribute('aria-busy', String(name === 'loading-step')); }
function currentFresh() { return filterFreshOffers(state.dataset.offers, { now: () => new Date(), cutoffAt: state.dataset.cutoff_at }).offers; }
function renderRadiusControl() {
  const inerte = radiusIsInert(state.located);
  nodes['radius-control'].hidden = false;
  nodes['radius-input'].value = String(state.radiusKm);
  nodes['radius-input'].disabled = inerte;
  const total = state.pool.length;
  nodes['radius-readout'].textContent = inerte
    ? `Única estación en ${formatRadius(RADIUS_MAX_KM)}`
    : `${formatRadius(state.radiusKm)} · ${total} ${total === 1 ? 'estación' : 'estaciones'}`;
}

function renderOffers() {
  const noOrigin = !state.origin;
  // Con ubicación: el radio filtra, el toggle solo ordena y la lista pagina.
  // Cada control hace una cosa.
  state.pool = noOrigin ? [] : withinRadius(state.located, state.radiusKm);
  const ordenadas = noOrigin
    ? state.fresh.filter((offer) => offer.district === state.district).sort((left, right) => left.price - right.price || left.id.localeCompare(right.id))
    : orderOffers(state.pool, state.sort);
  const items = ordenadas.slice(0, noOrigin ? 4 : state.visibleCount);
  const showTag = !noOrigin && items.length > 1;
  nodes.offers.innerHTML = items.map((offer) => renderOfferCard(offer, { withDistance: !noOrigin, directionsUrl: safeGoogleMapsDirectionsUrl(offer), tag: showTag ? decisionTag(offer, state.pool, state.radiusKm) : null })).join('');
  nodes.offers.hidden = items.length === 0;
  nodes['sort-toggle'].hidden = noOrigin || items.length < 2;
  if (!noOrigin) renderRadiusControl();
  nodes['radius-empty'].hidden = noOrigin || items.length > 0;
  const restantes = ordenadas.length - items.length;
  nodes['load-more'].hidden = restantes <= 0;
  nodes['load-more'].textContent = `Cargar ${Math.min(PAGE_INCREMENT, restantes)} más (${restantes} ${restantes === 1 ? 'restante' : 'restantes'})`;
  nodes['offers-note'].textContent = items.some((offer) => !offer.commercial_identity) ? UNVERIFIED_STATION_LABEL : '';
  nodes['offers-note'].hidden = items.length === 0;
  document.querySelectorAll('[data-sort]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sort === state.sort)));
}
// El bundle del otro producto solo se pide la primera vez que alguien abre un
// detalle. Si falla —sin conexión y sin copia guardada— el panel muestra el
// producto actual igual, sin romperse.
async function otherProductPrices() {
  if (state.otherPrices) return state.otherPrices;
  if (!state.otherPending) {
    const other = GASOLINA_KEYS.find((key) => key !== state.product);
    state.otherPending = loadGasolinaProduct(other)
      .then((loaded) => { state.otherPrices = new Map(loaded.dataset.offers.map((offer) => [offer.establishment_id, offer])); return state.otherPrices; })
      .catch(() => { state.otherPrices = new Map(); return state.otherPrices; });
  }
  return state.otherPending;
}

async function toggleDetail(button) {
  const slot = nodes.offers.querySelector(`[data-detail-slot="${CSS.escape(button.dataset.detail)}"]`);
  const offer = state.pool.concat(state.fresh).find((item) => item.id === button.dataset.detail);
  if (!slot || !offer) return;
  const abierto = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!abierto));
  button.textContent = abierto ? 'Ver detalle' : 'Ocultar';
  slot.hidden = abierto;
  if (abierto) { slot.innerHTML = ''; return; }
  const pintar = (otras) => {
    const par = otras?.get(offer.establishment_id) ?? null;
    const prices = { [state.product]: offer, ...(par ? { [GASOLINA_KEYS.find((key) => key !== state.product)]: par } : {}) };
    slot.innerHTML = renderOfferDetail(offer, { prices, attribution: state.dataset.provenance.attribution });
  };
  pintar(state.otherPrices);
  if (!state.otherPrices) pintar(await otherProductPrices());
}

function renderResults() {
  state.fresh = currentFresh();
  nodes['official-source'].href = state.dataset.provenance.source_url;
  nodes['empty-state'].hidden = state.fresh.length > 0;
  nodes.offers.hidden = state.fresh.length === 0;
  nodes['sort-toggle'].hidden = state.fresh.length === 0 || !state.origin;
  if (state.fresh.length === 0) return;
  if (state.origin) {
    state.located = state.fresh.map((offer) => ({ ...offer, distance_km: haversineKm(state.origin, offer) }));
    state.radiusKm = initialRadiusKm(state.located);
    state.visibleCount = PAGE_SIZE;
    state.sort = 'distance';
    nodes['compare-title'].textContent = 'Cerca de ti';
  } else {
    state.located = [];
    nodes['radius-control'].hidden = true;
    nodes['radius-empty'].hidden = true;
    nodes['load-more'].hidden = true;
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
function applyLoaded(loaded) {
  state.dataset = loaded.dataset; state.dataMode = loaded.dataMode; state.product = loaded.key;
  localStorage.setItem('masfacil-product', state.product);
  const fresh = currentFresh(); const label = state.dataset.product.label;
  document.title = `masfacil.pe · ${label}`;
  document.querySelector('meta[name="description"]').content = `Compara precio y cercanía de ${label} en Lima provincia.`;
  $('use-location').disabled = false;
  $('choose-district').disabled = false;
  nodes['data-status'].textContent = `${label}: ${fresh.length} precios vigentes · corte ${formatDate(state.dataset.cutoff_at)}.`;
  nodes['data-status'].classList.add('sr-only');
  nodes['source-content'].innerHTML = `<p>${escapeHtml(state.dataset.provenance.attribution)}</p><p>La distancia es geodésica en línea recta. No calculamos ruta, ETA, tráfico ni costo del desvío. Proyecto independiente, sin afiliación con Osinergmin, Facilito ni el Estado.</p><p>Tu zona es el radio que eliges con el control, entre ${RADIUS_MIN_KM} y ${RADIUS_MAX_KM} km de tu ubicación.</p><p><a href="${escapeHtml(state.dataset.provenance.source_url)}" target="_blank" rel="noopener noreferrer">Ver fuente de Osinergmin</a></p>`;
  document.querySelectorAll('[data-product]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.product === state.product)));
}
async function switchProduct(key) {
  if (key === state.product) return;
  location.assign(`/gasolina/${key}/`);
}
function routeProduct() { const match = location.pathname.match(/^\/gasolina\/(regular|premium)\/?$/); return match?.[1] ?? null; }
async function hasGrantedLocationPermission() {
  try { return (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted'; }
  catch { return false; }
}
async function initialize() {
  try {
    const product = routeProduct(); if (!product) throw new Error('Elige Gasohol Regular o Gasohol Premium para cargar sus precios.');
    await prepareServiceWorker();
    applyLoaded(await loadGasolinaProduct(product));
    if (await hasGrantedLocationPermission()) locate();
  } catch (error) { fatal(error); }
}

$('use-location').addEventListener('click', locate); $('choose-district').addEventListener('click', chooseDistrict); $('retry-location').addEventListener('click', locate);
$('cancel-location').addEventListener('click', cancelLocation); nodes['district-search'].addEventListener('input', () => { state.showAllDistricts = false; renderDistricts(nodes['district-search'].value); }); nodes['district-show-all'].addEventListener('click', () => { state.showAllDistricts = true; renderDistricts(nodes['district-search'].value); });
nodes.districts.addEventListener('click', (event) => { const district = event.target.closest('[data-district]')?.dataset.district; if (district) { state.origin = null; state.district = district; showCompare(); } });
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => { state.sort = button.dataset.sort; state.visibleCount = PAGE_SIZE; renderOffers(); }));
nodes.offers.addEventListener('click', (event) => { const button = event.target.closest('[data-detail]'); if (button) toggleDetail(button); });
// Filtrado local sobre datos ya cargados: no hay red, así que `input` responde
// mientras se arrastra sin costo perceptible.
nodes['radius-input'].addEventListener('input', () => { state.radiusKm = Number(nodes['radius-input'].value); state.visibleCount = PAGE_SIZE; renderOffers(); });
nodes['load-more'].addEventListener('click', () => { state.visibleCount += PAGE_INCREMENT; renderOffers(); });
document.querySelectorAll('[data-product]').forEach((button) => button.addEventListener('click', () => switchProduct(button.dataset.product)));
$('change-origin').addEventListener('click', () => show('start-step')); $('retry-load').addEventListener('click', () => location.reload());
document.querySelector('.brand').addEventListener('click', () => { try { sessionStorage.setItem('masfacil-selector-intent', '1'); } catch { /* almacenamiento no disponible */ } });
initTheme();
initialize();
