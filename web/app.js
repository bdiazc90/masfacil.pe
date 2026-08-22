import { loadGasolinaProduct } from './data-client.js';
import { haversineKm, nearestPool, visibleOffers } from './lib/haversine.js';
import { decisionTag, nearOffersView } from './lib/decision-view.js';
import { filterFreshOffers } from './lib/freshness.js';
import { safeGoogleMapsDirectionsUrl } from './lib/directions.js';
import { visibleDistricts } from './district-list.js';
import { UNVERIFIED_STATION_LABEL, displayDistrict, escapeHtml, renderOfferCard } from './offer-card.js';
import { prepareServiceWorker } from './service-worker-ready.js';
import { initTheme } from './theme.js';

const state = { dataset: null, dataMode: 'network', product: null, origin: null, district: null, districts: [], showAllDistricts: false, fresh: [], pool: [], sort: 'distance', locationAttempt: 0 };
const $ = (id) => document.getElementById(id);
const nodes = Object.fromEntries(['start-step', 'loading-step', 'district-step', 'district-hint', 'compare-step', 'fatal-state', 'location-status', 'data-status', 'districts', 'district-search', 'district-empty', 'district-show-all', 'compare-title', 'sort-toggle', 'product-toggle', 'offers', 'offers-note', 'offline-note', 'empty-state', 'official-source', 'source-content', 'fatal-message'].map((id) => [id, $(id)]));
const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(value));

function show(name) { for (const key of ['start-step', 'loading-step', 'district-step', 'compare-step', 'fatal-state']) nodes[key].hidden = key !== name; $('main').setAttribute('aria-busy', String(name === 'loading-step')); }
function currentFresh() { return filterFreshOffers(state.dataset.offers, { now: () => new Date(), cutoffAt: state.dataset.cutoff_at }).offers; }
function renderOffers() {
  const noOrigin = !state.origin;
  const items = noOrigin
    ? state.fresh.filter((offer) => offer.district === state.district).sort((left, right) => left.price - right.price || left.id.localeCompare(right.id)).slice(0, 4)
    : state.sort === 'distance' ? nearOffersView(state.pool, 4) : visibleOffers(state.pool, state.sort, 20, 4);
  const showTag = !noOrigin && state.sort === 'distance';
  nodes.offers.innerHTML = items.map((offer) => renderOfferCard(offer, { withDistance: !noOrigin, directionsUrl: safeGoogleMapsDirectionsUrl(offer), tag: showTag ? decisionTag(offer, state.pool) : null })).join('');
  nodes['sort-toggle'].hidden = noOrigin;
  nodes['offers-note'].textContent = items.some((offer) => !offer.commercial_identity) ? UNVERIFIED_STATION_LABEL : '';
  nodes['offers-note'].hidden = items.length === 0;
  document.querySelectorAll('[data-sort]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sort === state.sort)));
}
function renderResults() {
  state.fresh = currentFresh();
  nodes['official-source'].href = state.dataset.provenance.source_url;
  nodes['empty-state'].hidden = state.fresh.length > 0;
  nodes.offers.hidden = state.fresh.length === 0;
  nodes['sort-toggle'].hidden = state.fresh.length === 0 || !state.origin;
  if (state.fresh.length === 0) return;
  if (state.origin) {
    state.pool = nearestPool(state.fresh.map((offer) => ({ ...offer, distance_km: haversineKm(state.origin, offer) })), 20);
    state.sort = 'distance';
    nodes['compare-title'].textContent = 'Cerca de ti';
  } else { nodes['compare-title'].textContent = `Más baratas en ${displayDistrict(state.district)}`; }
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
  nodes['source-content'].innerHTML = `<p>${escapeHtml(state.dataset.provenance.attribution)}</p><p>La distancia es geodésica en línea recta. No calculamos ruta, ETA, tráfico ni costo del desvío. Proyecto independiente, sin afiliación con Osinergmin, Facilito ni el Estado.</p><p>Tu zona son las 20 estaciones más cercanas a tu ubicación.</p><p><a href="${escapeHtml(state.dataset.provenance.source_url)}" target="_blank" rel="noopener noreferrer">Ver fuente de Osinergmin</a></p>`;
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
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => { state.sort = button.dataset.sort; renderOffers(); }));
document.querySelectorAll('[data-product]').forEach((button) => button.addEventListener('click', () => switchProduct(button.dataset.product)));
$('change-origin').addEventListener('click', () => show('start-step')); $('retry-load').addEventListener('click', () => location.reload());
document.querySelector('.brand').addEventListener('click', () => { try { sessionStorage.setItem('masfacil-selector-intent', '1'); } catch { /* almacenamiento no disponible */ } });
initTheme();
initialize();
