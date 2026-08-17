import { haversineKm, nearestPool, visibleOffers } from './haversine.js';
import { buildSanitizedMeasurement } from './measurement.js';

const SIMULATED_ORIGIN = Object.freeze({ latitude: -12.1211, longitude: -77.0297 });
const POOL_SIZE = 20;
const MAX_VISIBLE = 6;
const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';
const state = { dataset: null, origin: null, originKind: null, sort: 'distance', offers: [], pool: [], session: null, selected: null };

document.documentElement.classList.toggle('debug', DEBUG);

const elements = Object.fromEntries([
  'start-step', 'compare-step', 'choose-step', 'fatal-state', 'fatal-message', 'use-location', 'use-simulated',
  'location-status', 'dataset-badge', 'result-count', 'offers', 'source-content', 'choice-summary', 'change-origin',
  'back-to-results', 'copy-measurement', 'restart-task', 'copy-status', 'measurement-fallback', 'retry-load',
].map((id) => [id, document.getElementById(id)]));

function ensureSession() {
  if (!state.session) state.session = { startedAt: performance.now(), originKind: null, actions: [] };
}

function recordAction(type, value = undefined) {
  if (!state.session) return;
  const action = { at_ms: Math.round(performance.now() - state.session.startedAt), type };
  if (value !== undefined) action.value = value;
  state.session.actions.push(action);
}

function setBusy(busy) {
  elements['use-location'].disabled = busy;
  elements['use-simulated'].disabled = busy;
}

function formatPrice(price) {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 }).format(price);
}

function formatDistance(distance) {
  return distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(distance < 10 ? 1 : 0)} km`;
}

function formatAge(age) {
  if (age < 1) {
    const hours = Math.max(1, Math.round(age * 24));
    return `hace ${hours} h`;
  }
  const days = Math.floor(age);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Lima' }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function prepareOffers(origin) {
  return state.dataset.offers.map((offer) => ({
    ...offer,
    distance_km: haversineKm(origin, { latitude: offer.latitude, longitude: offer.longitude }),
  }));
}

function renderOffers() {
  const visible = visibleOffers(state.offers, state.sort, POOL_SIZE, MAX_VISIBLE);
  elements['result-count'].textContent = `pool cercano ${state.pool.length}/${state.offers.length} · visibles ${visible.length} · orden ${state.sort}`;
  elements.offers.innerHTML = visible.map((offer, index) => `
    <li class="offer-card">
      <p class="offer-card__metrics">
        <strong>${escapeHtml(formatPrice(offer.price))}</strong>
        <span>${escapeHtml(formatDistance(offer.distance_km))}</span>
        <span>${escapeHtml(formatAge(offer.age_days))}</span>
      </p>
      <h3>${escapeHtml(offer.legal_name)}</h3>
      <p class="address">${escapeHtml(offer.address)} · ${escapeHtml(offer.district)}</p>
      <button class="button button--quiet" type="button" data-choose="${escapeHtml(offer.id)}" data-rank="${index + 1}">Elegir</button>
    </li>`).join('');
}

function showComparison(origin, originKind) {
  ensureSession();
  state.session.originKind = originKind;
  state.origin = origin;
  state.originKind = originKind;
  state.offers = prepareOffers(origin);
  state.pool = nearestPool(state.offers, POOL_SIZE);
  state.sort = 'distance';
  state.selected = null;
  document.querySelectorAll('[data-sort]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sort === 'distance')));
  elements['start-step'].hidden = true;
  elements['choose-step'].hidden = true;
  elements['compare-step'].hidden = false;
  elements['location-status'].textContent = '';
  renderOffers();
  document.getElementById('compare-title').focus();
}

function useBrowserLocation() {
  ensureSession();
  recordAction('origin_requested', 'browser');
  if (!navigator.geolocation) {
    elements['location-status'].textContent = 'Este navegador no ofrece geolocalización. Prueba con la ubicación simulada.';
    return;
  }
  setBusy(true);
  elements['location-status'].textContent = 'Esperando permiso de ubicación…';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setBusy(false);
      showComparison({ latitude: position.coords.latitude, longitude: position.coords.longitude }, 'browser');
    },
    (error) => {
      setBusy(false);
      const reason = error.code === error.PERMISSION_DENIED ? 'El permiso fue denegado.' : 'No se pudo obtener una ubicación confiable.';
      elements['location-status'].textContent = `${reason} Prueba con la ubicación simulada.`;
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
  );
}

function selectOffer(id, rank) {
  const offer = state.pool.find((item) => item.id === id);
  if (!offer) return;
  recordAction('offer_selected', { offer_id: offer.id, rank, sort: state.sort });
  state.selected = { offer, rank, sort: state.sort, completedAt: performance.now() };
  elements['choice-summary'].innerHTML = `
    <div class="choice-card">
      <strong>${escapeHtml(offer.legal_name)}</strong>
      <span>${escapeHtml(offer.address)} · ${escapeHtml(offer.district)}</span>
      <span>${escapeHtml(formatPrice(offer.price))} · ${escapeHtml(formatDistance(offer.distance_km))} · ${escapeHtml(formatAge(offer.age_days))}</span>
    </div>`;
  elements['compare-step'].hidden = true;
  elements['choose-step'].hidden = false;
  elements['copy-status'].textContent = '';
  elements['measurement-fallback'].hidden = true;
  document.getElementById('choose-title').focus();
}

function sanitizedMeasurement() {
  return buildSanitizedMeasurement({ dataset: state.dataset, session: state.session, selected: state.selected });
}

async function copyMeasurement() {
  const text = JSON.stringify(sanitizedMeasurement(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    elements['copy-status'].textContent = 'Medición sanitizada copiada.';
  } catch {
    elements['measurement-fallback'].value = text;
    elements['measurement-fallback'].hidden = false;
    elements['measurement-fallback'].select();
    elements['copy-status'].textContent = 'Copia el texto seleccionado.';
  }
}

function backToResults() {
  recordAction('comparison_resumed');
  elements['choose-step'].hidden = true;
  elements['compare-step'].hidden = false;
  document.getElementById('compare-title').focus();
}

function restart() {
  state.origin = null;
  state.originKind = null;
  state.offers = [];
  state.pool = [];
  state.session = null;
  state.selected = null;
  elements['compare-step'].hidden = true;
  elements['choose-step'].hidden = true;
  elements['start-step'].hidden = false;
  elements['use-location'].focus();
}

function renderSource() {
  const sourceText = state.dataset.mode === 'demo'
    ? 'Las estaciones de esta demostración son sintéticas y replican el contrato de la fuente pública de Osinergmin.'
    : 'Precios provenientes de una fuente pública de Osinergmin.';
  elements['source-content'].innerHTML = `
    <p>${escapeHtml(sourceText)} Corte: ${escapeHtml(formatDate(state.dataset.cutoff_at))}.</p>
    <ul>
      <li>La distancia es geodésica, en línea recta; no representa ruta ni tiempo de viaje.</li>
      <li>La razón social y la dirección son una identidad provisional, no un nombre comercial.</li>
      <li>El precio reportado no confirma stock.</li>
      <li>Proyecto independiente, sin afiliación ni aprobación de Osinergmin, Facilito o el Estado peruano.</li>
    </ul>`;
}

async function initialize() {
  try {
    const response = await fetch('/api/dataset', { cache: 'no-store' });
    if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
    state.dataset = await response.json();
    if (!Array.isArray(state.dataset.offers) || state.dataset.offers.length === 0) throw new Error('No hay opciones disponibles');
    elements['dataset-badge'].textContent = `${state.dataset.mode} · ${state.dataset.offers.length} ofertas validadas`;
    renderSource();
  } catch (error) {
    elements['start-step'].hidden = true;
    elements['fatal-state'].hidden = false;
    elements['fatal-message'].textContent = `${error.message}. Verifica el servidor y vuelve a intentar.`;
  }
}

elements['use-location'].addEventListener('click', useBrowserLocation);
elements['use-simulated'].addEventListener('click', () => {
  ensureSession();
  recordAction('origin_selected', 'simulated');
  showComparison(SIMULATED_ORIGIN, 'simulated');
});
elements['change-origin'].addEventListener('click', restart);
elements['back-to-results'].addEventListener('click', backToResults);
elements.offers.addEventListener('click', (event) => {
  const button = event.target.closest('[data-choose]');
  if (button) selectOffer(button.dataset.choose, Number(button.dataset.rank));
});
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
  if (state.sort === button.dataset.sort) return;
  state.sort = button.dataset.sort;
  recordAction('sort_changed', state.sort);
  document.querySelectorAll('[data-sort]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  renderOffers();
}));
elements['copy-measurement'].addEventListener('click', copyMeasurement);
elements['restart-task'].addEventListener('click', restart);
elements['retry-load'].addEventListener('click', () => window.location.reload());

initialize();
