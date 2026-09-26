import { loadView } from './data-client.js';
import { PAGE_SIZE, RADIUS_MAX_KM, RADIUS_MIN_KM } from './lib/haversine.js';
import { concordancia, formatRadius } from './lib/decision-view.js';
import { MAX_OFFER_AGE_DAYS } from './lib/freshness.js';
import { createSearch, districtsFrom, evaluateRows, resultsView, startResults, withDistances, withPrice } from './lib/search.js';
import { safeGoogleMapsDirectionsUrl } from './lib/directions.js';
import { visibleDistricts } from './district-list.js';
import { displayDistrict, escapeHtml, renderOfferCard, renderOfferDetail } from './offer-card.js';
import { ACTIVE_VIEWS, PRODUCTS, VIEWS } from './lib/catalog.js';
import { createLocator } from './geolocation.js';
import { historyPath, resolvePath, viewPath } from './lib/routes.js';
import { readPreference, writePreference } from './preference.js';
import { prepareServiceWorker } from './service-worker-ready.js';
import { initTheme } from './theme.js';
import { initControlsCard } from './controls-card.js';
import { mountHistoryChart } from './history-chart.js';

// El estado se declara, no se deduce de la pantalla. `search` es lo que la
// persona eligió y lo único que necesitan las reglas de `lib/search.js`; `data`,
// lo que se cargó de la vista activa; `ui`, lo que solo le importa a esta
// presentación. Las filas se guardan evaluadas hasta `refreshAt` y, con
// ubicación, ya medidas.
//
// Cada vista guarda su propia copia cargada, y cada carga lleva su turno: la
// respuesta tardía de la vista que se dejó queda guardada, pero no se pinta bajo
// la etiqueta de la nueva. Mismo patrón que el localizador.
let search;
let data = { dataset: null, mode: 'network' };
const cargadas = new Map();
let turnoDeCarga = 0;
// El producto que ordena se recuerda por vista: volver a Gasolina devuelve
// Premium a quien lo había elegido.
const ordenPorVista = {};
let rows = [];
let located = [];
let refreshAt = 0;
const ui = { screen: 'start', updatingLocation: false, districts: [], showAllDistricts: false, view: null };
const elegir = (cambios) => { search = { ...search, ...cambios }; };
const locator = createLocator();
const $ = (id) => document.getElementById(id);
// La ruta decide la vista. `/` no tiene vista propia: vale la recordada y la URL
// pasa a la canónica sin añadir una entrada al historial. Una ruta concreta manda
// sobre la preferencia y queda recordada. El servidor y el service worker ya
// redirigieron los enlaces antiguos; si uno llega hasta aquí, se redirige igual.
const entrada = resolvePath(location.pathname, { preference: readPreference() });
const inicial = entrada.kind === 'view' ? entrada : resolvePath('/', { preference: readPreference() });
search = createSearch(inicial.view);
if (entrada.kind === 'redirect') location.replace(`${entrada.to}${location.search}${location.hash}`);
else {
  if (location.pathname !== inicial.canonical) history.replaceState(null, '', `${inicial.canonical}${location.search}${location.hash}`);
  writePreference(inicial.view);
}
// La ruta del historial es la misma portada con el gráfico enfocado.
const enHistorial = () => resolvePath(location.pathname).history === true;
const SCREENS = Object.freeze({ start: 'start-step', loading: 'loading-step', district: 'district-step', compare: 'compare-step', fatal: 'fatal-state' });
const nodes = Object.fromEntries(['start-step', 'loading-step', 'district-step', 'district-hint', 'compare-step', 'fatal-state', 'data-status', 'districts', 'district-search', 'district-empty', 'compare-title', 'place-icon', 'place-name', 'sum-place', 'sum-criteria', 'sort-toggle', 'price-product-toggle', 'offers', 'offers-status', 'offline-note', 'empty-state', 'official-source', 'source-content', 'fatal-message', 'radius-control', 'radius-input', 'radius-readout', 'radius-empty', 'radius-empty-title', 'radius-empty-text', 'load-more', 'controls', 'controls-slot', 'controls-scrim', 'controls-summary', 'controls-done', 'refresh-location', 'refresh-location-compact', 'refresh-location-compact-label', 'place-action-label', 'place-more', 'place-menu', 'menu-back-results', 'location-update', 'location-update-text', 'sum-fuel', 'view-state', 'view-state-text', 'view-state-action', 'start-retry', 'history-chart', 'menu-history'].map((id) => [id, $(id)]));
const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(value));

// El card de controles solo se fija en resultados; en las demás pantallas es la
// appbar de siempre, en flujo.
const controls = initControlsCard({
  card: nodes.controls, slot: nodes['controls-slot'], scrim: nodes['controls-scrim'], summaryButton: nodes['controls-summary'], doneButton: nodes['controls-done'],
  collapseSentinel: document.querySelector('.controls-sentinel--collapse'), expandSentinel: document.querySelector('.controls-sentinel--expand'),
  // La tarjeta se fija sobre las dos pantallas con lista larga: resultados y
  // distritos. En las demás no hay nada que perseguir al hacer scroll.
  isActive: () => ui.screen === 'compare' || ui.screen === 'district',
});

function show(screen) {
  ui.screen = screen;
  for (const [key, id] of Object.entries(SCREENS)) nodes[id].hidden = key !== screen;
  // La ruta del historial describe la portada con el gráfico; al salir de ella
  // la URL vuelve a la vista sin añadir entradas al historial del navegador.
  if (screen !== 'start' && enHistorial()) history.replaceState(null, '', viewPath(search.view));
  $('main').setAttribute('aria-busy', String(screen === 'loading'));
  // Tres valores, no dos: en distritos la tarjeta conserva la píldora y se fija.
  // El atributo es para el CSS; la lógica lee `ui.screen`.
  const pantalla = screen === 'compare' || screen === 'district' ? screen : 'other';
  nodes.controls.dataset.screen = pantalla;
  if (pantalla === 'other') controls.setState('full');
}
// La vigencia se congela en el instante en que se calcula, así que hay que
// volver a mirarla cada vez que se rearma la lista: un precio de 29 días y 23
// horas cruza los 30 mientras la app sigue abierta. No hace falta recomputar en
// cada frame: las reglas dicen cuándo cambia la próxima respuesta y hasta
// entonces se reutiliza lo que ya hay. Con ubicación, las distancias se rehacen
// siempre junto con las filas, nunca unas sin las otras.
function refrescar({ force = false } = {}) {
  if (!force && Date.now() < refreshAt) return;
  ({ rows, refreshAt } = evaluateRows(data.dataset, new Date()));
  if (search.origin) located = withDistances(rows, search.origin);
}
function renderRadiusControl({ inert, total }) {
  nodes['radius-control'].hidden = false;
  nodes['radius-input'].value = String(search.radiusKm);
  nodes['radius-input'].disabled = inert;
  // Inerte significa que mover el radio no cambia el conteo, no que haya una
  // sola estación: en Pucusana son tres en todo el rango.
  nodes['radius-readout'].textContent = inert
    ? (total === 0 ? `Ninguna estación en ${formatRadius(RADIUS_MAX_KM)}` : total === 1 ? `Única estación en ${formatRadius(RADIUS_MAX_KM)}` : `Las mismas ${total} estaciones en todo el radio`)
    : `${formatRadius(search.radiusKm)} · ${total} ${total === 1 ? 'estación' : 'estaciones'}`;
}
// Resumen del card compacto: el lugar puede truncar; el criterio nunca.
function renderSummary(criterion) {
  // Sin un solo precio vigente, anunciar un criterio de precio promete un orden
  // que no existe: el resumen dice lo que pasa, no lo que ordenaría.
  const criterio = criterion === 'none' ? 'Sin precios recientes' : criterion === 'price' ? `${PRODUCTS[search.priceProduct].short} más barat${concordancia(search.priceProduct)}` : 'Más cerca';
  // Con más de una vista el resumen dice de qué combustible habla, en dos
  // renglones: arriba el combustible y dónde —el radio o el distrito, que es lo
  // que puede truncarse—, abajo el criterio entero.
  const varias = ACTIVE_VIEWS.length > 1;
  nodes['sum-fuel'].hidden = !varias;
  if (varias) {
    nodes['sum-fuel'].textContent = VIEWS[search.view].label;
    nodes['sum-place'].textContent = `· ${search.origin ? formatRadius(search.radiusKm) : displayDistrict(search.district)}`;
    nodes['sum-criteria'].textContent = criterio;
    return;
  }
  const partes = search.origin ? [formatRadius(search.radiusKm), criterio] : [criterio];
  // Con GPS el icono de la barra ya dice «mi ubicación»: repetirlo en texto solo
  // le robaba ancho al criterio, que nunca debe truncar.
  nodes['sum-criteria'].textContent = search.origin ? partes.join(' · ') : `· ${partes.join(' · ')}`;
}

// Pinta lo que deciden las reglas. Siempre repinta; solo el recálculo de filas
// espera a que algo venza.
function renderOffers() {
  refrescar();
  const view = resultsView({ rows, located, search });
  ui.view = view;
  const conOrigen = Boolean(search.origin);
  const { products, priceUnit } = VIEWS[search.view];
  nodes.offers.innerHTML = view.items.map((offer, index) => renderOfferCard(offer, { withDistance: conOrigen, directionsUrl: safeGoogleMapsDirectionsUrl(offer), tag: view.tags[index], activeProduct: view.activeProduct, products, priceUnit })).join('');
  nodes.offers.hidden = view.items.length === 0;
  renderViewState(view.districtEmpty ? 'district-empty' : 'ready');
  // El aviso de «sin precios recientes» acompaña a las tarjetas mudas, no las
  // sustituye: el grifo sigue existiendo aunque hoy no diga a cuánto vende.
  nodes['empty-state'].hidden = view.hasPrices;
  nodes['sort-toggle'].hidden = !view.sortToggle;
  nodes['price-product-toggle'].hidden = !view.productToggle;
  if (view.radius) renderRadiusControl(view.radius);
  nodes['radius-empty'].hidden = !view.radiusEmpty;
  // Sin ninguna estación en todo el rango, ampliar el radio no sirve: se dice, y
  // se ofrece lo que sí sirve.
  const nadaEnElRango = view.radius?.inert && view.radius.total === 0;
  nodes['radius-empty-title'].textContent = nadaEnElRango ? `Ningún grifo a ${formatRadius(RADIUS_MAX_KM)}` : 'Ningún grifo en este radio';
  nodes['radius-empty-text'].textContent = nadaEnElRango ? `No hay estaciones de ${VIEWS[search.view].label} cerca de ti. Busca por distrito o elige otro combustible.` : 'Amplía el radio de búsqueda para encontrar estaciones más lejanas.';
  nodes['load-more'].hidden = view.remaining <= 0;
  // El botón carga su propio salto: la etiqueta y lo que hace salen del mismo
  // número, así que no pueden discrepar.
  nodes['load-more'].textContent = view.nextCount >= view.ordered.length ? `Ver las ${view.remaining} restantes` : `Ver ${view.nextCount - view.items.length} más (${view.remaining} restantes)`;
  // Cuando sí paginó, el último toque cierra con «N de N», que es lo que el botón
  // ya no puede decir.
  nodes['offers-status'].textContent = view.paged ? `Se muestran ${view.items.length} de ${view.ordered.length} estaciones.` : '';
  document.querySelectorAll('[data-sort]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.sort === (view.byPrice ? 'price' : 'distance'))));
  document.querySelectorAll('[data-price-product]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.priceProduct === search.priceProduct)));
  renderSummary(view.criterion);
}

// Los dos precios ya viajan en la fila, así que el panel se abre sin pedir nada
// y funciona igual sin conexión.
function toggleDetail(button) {
  const slot = nodes.offers.querySelector(`[data-detail-slot="${CSS.escape(button.dataset.detail)}"]`);
  const offer = (ui.view?.pool ?? []).concat(rows).find((item) => item.establishment_id === button.dataset.detail);
  if (!slot || !offer) return;
  const abierto = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!abierto));
  button.textContent = abierto ? 'Ver detalle' : 'Ocultar';
  slot.hidden = abierto;
  const { products, priceUnit } = VIEWS[search.view];
  slot.innerHTML = abierto ? '' : renderOfferDetail(offer, { prices: offer.prices, attribution: data.dataset.provenance.attribution, products, priceUnit });
}

function renderResults() {
  refrescar({ force: true });
  nodes['official-source'].href = data.dataset.provenance.source_url;
  // El nombre del lugar es el encabezado de los resultados: dice desde dónde se
  // compara, y por eso nunca es un botón.
  const lugar = search.origin ? 'Mi ubicación' : displayDistrict(search.district);
  nodes['place-name'].textContent = lugar;
  nodes['sum-place'].textContent = search.origin ? '' : lugar;
  // `hidden` como propiedad solo existe en HTMLElement: sobre un <svg> hay que
  // escribir el atributo o el icono se queda visible en los dos modos.
  nodes['place-icon'].toggleAttribute('hidden', !search.origin);
  renderPlaceAction('idle');
  // Sin precios vigentes ya no se corta aquí: las tarjetas mudas se siguen
  // pintando y los controles se recalculan en renderOffers. Cortar dejaba el
  // radio y el resumen con los números de la búsqueda anterior.
  search = startResults(search, located);
  if (!search.origin) {
    located = [];
    nodes['radius-control'].hidden = true;
    nodes['radius-empty'].hidden = true;
  }
  renderOffers();
}
function showCompare() {
  // La pantalla se declara ANTES de pintar: la píldora decide su promesa según
  // dónde está, y renderizarla con la pantalla anterior le ponía la etiqueta
  // equivocada.
  show('compare');
  ui.updatingLocation = false;
  renderLocationUpdate('idle', '');
  renderResults();
  nodes['offline-note'].hidden = data.mode !== 'saved';
  nodes['offline-note'].textContent = data.mode === 'saved' ? `Sin conexión · precios guardados del ${formatDate(data.dataset.cutoff_at)}.` : '';
  nodes['compare-title'].focus();
}
function renderDistricts(query = '') {
  const normalizedQuery = query.trim();
  const matches = visibleDistricts(ui.districts, normalizedQuery, ui.showAllDistricts);
  nodes.districts.innerHTML = matches.map((district) => `<button type="button" data-district="${escapeHtml(district)}">${escapeHtml(displayDistrict(district))}</button>`).join('');
  nodes['district-empty'].hidden = !normalizedQuery || matches.length > 0;
}
function chooseDistrict({ fromError = false } = {}) {
  if (!data.dataset) return;
  // Elegir distrito descarta cualquier ubicación en vuelo.
  locator.cancel();
  ui.updatingLocation = false;
  // Se evalúa en el momento, sin tocar las filas guardadas de los resultados.
  ui.districts = districtsFrom(evaluateRows(data.dataset, new Date()).rows);
  // Todos los chips de entrada: el buscador acota una lista visible, no la revela.
  ui.showAllDistricts = true;
  nodes['district-search'].value = '';
  renderDistricts();
  nodes['district-hint'].hidden = !fromError;
  // Solo se ofrece volver si hay resultados detrás a los que volver.
  nodes['menu-back-results'].hidden = !(search.origin || search.district);
  show('district');
  renderPlaceAction('idle');
  // Una pantalla nueva empieza arriba: si se llegaba desde una lista scrolleada,
  // quedarse a media altura escondía el buscador y la propia píldora.
  scrollTo({ top: 0, behavior: 'auto' });
  $('district-title').focus();
}
// Actualizar ubicación no es el flujo inicial: aquel reinicia radio y orden y,
// si falla, borra el origen y manda a elegir distrito. Aquí se conserva todo
// —radio, producto y criterio— y un fallo deja intacta la posición anterior.
const AVISO_UBICACION = Object.freeze({
  pending: 'Actualizando tu ubicación…',
  error: 'No pudimos actualizar. Las distancias usan tu ubicación anterior.',
});
// La píldora nombra la ACCIÓN, nunca el lugar: el lugar es el encabezado de al
// lado. Y la acción es siempre la misma promesa —llevarte a tu posición actual—,
// que con GPS significa volver a medirla y con distrito, cambiar el origen.
const ACCION_LUGAR = Object.freeze({
  gps: { label: 'Actualizar ubicación', corta: 'Actualizar', icono: 'refresh', variante: 'solid' },
  distrito: { label: 'Ver en mi ubicación', corta: 'Mi ubicación', icono: 'gps', variante: 'outline' },
});
// La píldora es también el indicador. En movimiento el dedo y la vista están
// ahí, y como la lista ya no salta al inicio, un aviso arriba puede quedar fuera
// de pantalla: el proceso y el fallo tienen que contarse en el propio botón.
// Con GPS guardado pero fuera de resultados —en la lista de distritos— la píldora
// no puede prometer «actualizar»: ahí solo tiene sentido salir hacia el GPS.
const enGps = () => Boolean(search.origin) && ui.screen === 'compare';
function renderPlaceAction(status = 'idle') {
  const accion = enGps() ? ACCION_LUGAR.gps : ACCION_LUGAR.distrito;
  const pendiente = status === 'pending';
  const error = status === 'error';
  nodes['place-action-label'].textContent = pendiente ? 'Actualizando…' : error ? 'Reintentar' : accion.label;
  // En distritos la barra compacta lleva solo este botón: no hay resumen con el
  // que competir, así que cabe el nombre completo y no hay por qué abreviarlo.
  const soloEnLaBarra = ui.screen === 'district';
  nodes['refresh-location-compact-label'].textContent = pendiente ? 'Actualizando…' : error ? 'Reintentar' : (soloEnLaBarra ? accion.label : accion.corta);
  const nombre = error ? `${AVISO_UBICACION.error} Reintentar.` : nodes['place-action-label'].textContent;
  for (const key of ['refresh-location', 'refresh-location-compact']) {
    nodes[key].dataset.status = status;
    nodes[key].disabled = pendiente;
    nodes[key].setAttribute('aria-label', nombre);
  }
  nodes['refresh-location'].dataset.variant = accion.variante;
  // La etiqueta corta solo estorba en la barra compacta de resultados con distrito,
  // donde el resumen ya carga el nombre del distrito y el criterio.
  nodes['refresh-location-compact'].dataset.compactLabel = enGps() || soloEnLaBarra ? 'on' : 'off';
  nodes['refresh-location-compact'].title = nombre;
  for (const icono of document.querySelectorAll('[data-place-icon]')) icono.toggleAttribute('hidden', icono.dataset.placeIcon !== accion.icono);
}
function renderLocationUpdate(status, message = null) {
  const texto = message ?? AVISO_UBICACION[status] ?? '';
  nodes['location-update'].hidden = !texto;
  nodes['location-update'].dataset.status = status;
  nodes['location-update-text'].textContent = texto;
  renderPlaceAction(status);
}
// Reordena y repagina sobre el origen nuevo sin volver a decidir radio ni
// criterio: si el radio conservado queda vacío, se ve el estado vacío y la
// persona decide si lo amplía.
function applyUpdatedOrigin() {
  // Forzado: cambió el origen, así que las distancias hay que rehacerlas aunque
  // ningún precio haya vencido todavía, y de paso se reevalúa la vigencia.
  refrescar({ force: true });
  elegir({ visibleCount: PAGE_SIZE });
  renderOffers();
}
async function refreshLocation() {
  if (!search.origin || ui.updatingLocation) return;
  if (!locator.available) { renderLocationUpdate('error'); return; }
  ui.updatingLocation = true;
  renderLocationUpdate('pending');
  // Si mientras tanto se elige distrito, se vuelve al inicio o se reintenta, la
  // respuesta que llegue tarde se descarta.
  const respuesta = await locator.request();
  if (respuesta.status === 'stale') return;
  ui.updatingLocation = false;
  if (respuesta.status === 'error') { renderLocationUpdate('error'); return; }
  elegir({ origin: respuesta.origin });
  applyUpdatedOrigin();
  // Sin salto al inicio: si te moviste 300 m la lista casi no cambia de orden,
  // y arrancarte de la tarjeta que leías castiga justo el uso en movimiento.
  // El foco se queda en la píldora, que es la que cuenta el resultado.
  const total = ui.view.pool.length;
  renderLocationUpdate('done', `Ubicación actualizada · ${total} ${total === 1 ? 'estación' : 'estaciones'} en ${formatRadius(search.radiusKm)}.`);
}
// Un solo gesto con una sola promesa. Con distrito elegido es el flujo inicial
// completo, porque el radio y el orden solo tienen sentido sobre una posición.
function placeAction() { if (enGps()) refreshLocation(); else locate(); }
async function locate() {
  if (!data.dataset) return;
  if (!locator.available) { chooseDistrict({ fromError: true }); return; }
  show('loading');
  const respuesta = await locator.request();
  if (respuesta.status === 'stale') return;
  if (respuesta.status === 'error') { elegir({ origin: null }); chooseDistrict({ fromError: true }); return; }
  elegir({ origin: respuesta.origin, district: null });
  // Si mientras se buscaba la posición se cambió de combustible y la vista
  // nueva todavía carga, los resultados se abren cuando llegue.
  if (!data.dataset) { show('start'); return; }
  showCompare();
}
// Lo que el producto tiene que declarar, sin justificarse: atribución, no
// afiliación, qué se mide de la visita, qué significa una ausencia, la ventana
// de vigencia, cómo se mide la distancia, la precisión medida y de quién son las
// marcas. Nada de explicar por qué se decidió cada cosa, y nada de pedir un
// contacto que la app no ofrece.
function applyLoaded(dataset) {
  const filas = evaluateRows(dataset, new Date()).rows;
  $('use-location').disabled = false;
  $('choose-district').disabled = false;
  nodes['start-retry'].hidden = true;
  nodes['data-status'].textContent = `${withPrice(filas).length} de ${filas.length} grifos con precio vigente · corte ${formatDate(dataset.cutoff_at)}.`;
  nodes['data-status'].classList.add('sr-only');
  nodes['source-content'].innerHTML = `<p>${escapeHtml(dataset.provenance.attribution)} Proyecto independiente, sin afiliación con Osinergmin, Facilito ni el Estado.</p><p>No guardamos tu ubicación ni sale de tu dispositivo. Contamos visitas de forma anónima y sin cookies, para mejorar la app.</p><p>«—» significa que ese grifo no publica precio vigente de ese producto, no que no lo venda. Pasados ${MAX_OFFER_AGE_DAYS} días sin reportar, su tarjeta queda sin precios y dice desde cuándo calla.</p><p>La distancia es en línea recta. Tu zona es el radio que eliges, entre ${RADIUS_MIN_KM} y ${RADIUS_MAX_KM} km.</p><p>Los nombres salen del Registro oficial: precisión medida de 89 % en los confirmados y 85 % en los <b>por confirmar</b>. Marcas y logos son de sus titulares, solo para identificar la estación.</p><p><a href="${escapeHtml(dataset.provenance.source_url)}" target="_blank" rel="noopener noreferrer">Ver fuente de Osinergmin</a></p>`;
}

// El estado de la lista cuando no hay tarjetas que mostrar por una razón de la
// vista: se está cargando, falló o el distrito conservado no tiene grifos de
// este combustible. Nunca se dejan a la vista precios de la anterior.
const ESTADO_VISTA = Object.freeze({
  loading: (vista) => ({ texto: `Cargando precios de ${vista}…`, accion: null }),
  error: (vista) => ({ texto: navigator.onLine ? `No pudimos cargar los precios de ${vista}. Revisa tu conexión y reintenta.` : `No hay precios de ${vista} guardados todavía. Conéctate una vez para descargarlos.`, accion: 'Reintentar' }),
  'district-empty': (vista) => ({ texto: `Ningún grifo de este distrito publica ${vista}.`, accion: 'Cambiar distrito' }),
});
function renderViewState(estado) {
  const vista = VIEWS[search.view].label;
  const contenido = ESTADO_VISTA[estado]?.(vista) ?? null;
  nodes['view-state'].hidden = !contenido;
  nodes['view-state'].dataset.state = estado;
  nodes['view-state-text'].textContent = contenido?.texto ?? '';
  nodes['view-state-action'].hidden = !contenido?.accion;
  nodes['view-state-action'].textContent = contenido?.accion ?? '';
}

// En Inicio la falla se cuenta en el mismo renglón que decía «Cargando precios…»,
// ahora visible, con su reintento; el selector sigue ahí para cambiar de vista.
function renderStartError() {
  $('use-location').disabled = true;
  $('choose-district').disabled = true;
  nodes['data-status'].textContent = ESTADO_VISTA.error(VIEWS[search.view].label).texto;
  nodes['data-status'].classList.remove('sr-only');
  nodes['start-retry'].hidden = false;
}
function renderStartLoading() {
  $('use-location').disabled = true;
  $('choose-district').disabled = true;
  nodes['start-retry'].hidden = true;
  nodes['data-status'].textContent = 'Cargando precios…';
  nodes['data-status'].classList.add('sr-only');
}

// El selector y todo lo que depende de la vista, sin tocar la lista: el botón
// usado conserva el foco porque solo cambia su `aria-pressed`.
function renderViewChrome() {
  const varias = ACTIVE_VIEWS.length > 1;
  for (const grupo of document.querySelectorAll('[data-view-picker]')) grupo.hidden = !varias;
  for (const boton of document.querySelectorAll('[data-view]')) boton.setAttribute('aria-pressed', String(boton.dataset.view === search.view));
  // El histórico existe solo donde hay una serie válida: hoy, Gasolina.
  const conHistorial = VIEWS[search.view].history;
  nodes['history-chart'].hidden = !conHistorial;
  nodes['menu-history'].hidden = !conHistorial;
  if (conHistorial) montarHistorial();
}

function mountViewPickers() {
  const botones = ACTIVE_VIEWS.map((key) => `<button type="button" data-view="${escapeHtml(key)}" aria-pressed="false">${escapeHtml(VIEWS[key].label)}</button>`).join('');
  for (const opciones of document.querySelectorAll('[data-view-options]')) opciones.innerHTML = botones;
}

// Aplica la copia cargada de la vista activa donde esté la persona: en
// resultados conserva origen o distrito, el radio y el orden que la persona
// eligió, y vuelve a la primera página. Un radio que nadie eligió no es una
// preferencia: se recalcula con los precios de esta vista, como al abrir los
// resultados —GLP tiene muchas menos estaciones que Gasolina—.
function applyView(entrada) {
  data = entrada;
  applyLoaded(entrada.dataset);
  if (ui.screen === 'compare') {
    refrescar({ force: true });
    search = startResults(search, located);
    nodes['official-source'].href = data.dataset.provenance.source_url;
    nodes['offline-note'].hidden = data.mode !== 'saved';
    nodes['offline-note'].textContent = data.mode === 'saved' ? `Sin conexión · precios guardados del ${formatDate(data.dataset.cutoff_at)}.` : '';
    renderOffers();
    controls.scrollToTop();
  } else if (ui.screen === 'district') {
    ui.districts = districtsFrom(evaluateRows(data.dataset, new Date()).rows);
    renderDistricts(nodes['district-search'].value);
  }
}

// Mientras la vista nueva carga no se pinta ningún precio: ni los de la
// anterior bajo la etiqueta nueva, ni una lista vacía que parezca un resultado.
function showViewLoading() {
  data = { dataset: null, mode: 'network' };
  renderStartLoading();
  if (ui.screen === 'compare') {
    nodes.offers.innerHTML = '';
    nodes.offers.hidden = true;
    for (const id of ['empty-state', 'radius-empty', 'load-more', 'sort-toggle', 'price-product-toggle']) nodes[id].hidden = true;
    renderViewState('loading');
  }
}
function showViewError() {
  renderStartError();
  if (ui.screen === 'compare') renderViewState('error');
  // Sin datos no hay distritos que elegir: se vuelve a Inicio, que tiene el
  // selector y el reintento.
  if (ui.screen === 'district') show('start');
}

async function loadActiveView() {
  const view = search.view;
  const turno = ++turnoDeCarga;
  const guardada = cargadas.get(view);
  if (guardada) { applyView(guardada); return; }
  showViewLoading();
  let dataset;
  try { dataset = await loadView(view); }
  catch (error) {
    console.error(error);
    if (turno === turnoDeCarga) showViewError();
    return;
  }
  const entrada = { dataset, mode: dataset.dataMode };
  cargadas.set(view, entrada);
  if (turno !== turnoDeCarga || view !== search.view) return;
  applyView(entrada);
}

// Cambiar de combustible: la URL y la preferencia pasan a la vista nueva sin
// añadir una entrada al historial, y todo lo demás se conserva.
function switchView(view, { fromHistory = false } = {}) {
  if (!VIEWS[view] || !ACTIVE_VIEWS.includes(view) || view === search.view) return;
  ordenPorVista[search.view] = search.priceProduct;
  const recordado = ordenPorVista[view];
  elegir({ view, priceProduct: VIEWS[view].products.includes(recordado) ? recordado : VIEWS[view].products[0], visibleCount: PAGE_SIZE });
  // Desde el historial se sigue en el historial solo si la vista nueva lo
  // tiene; si no, se vuelve a su portada: una ruta de historial sin histórico no existe.
  if (!fromHistory) history.replaceState(null, '', `${enHistorial() && VIEWS[view].history ? historyPath(view) : viewPath(view)}${location.search}${location.hash}`);
  writePreference(view);
  renderViewChrome();
  // Con GPS, la posición espera a que cargue la vista: no se pide de nuevo.
  loadActiveView();
}

// La app NUNCA se localiza sola. Antes, si el permiso ya estaba concedido, la
// portada llamaba a `locate()` al cargar; como el navegador guarda ese permiso
// de forma persistente, desde la primera concesión la portada dejaba de ser
// alcanzable: no se podía mirar el histórico ni elegir distrito sin que la
// localización secuestrara la pantalla. Un permiso concedido una vez no es una
// orden permanente. Localizar es siempre un gesto.
async function initialize() {
  // Sin un worker listo los datos se piden igual a la red: esperar un
  // controlador compatible es una mejora, no una condición.
  try { await prepareServiceWorker(); } catch (error) { console.error(error); }
  await loadActiveView();
}

$('use-location').addEventListener('click', locate); $('choose-district').addEventListener('click', () => chooseDistrict());
// Elegir distrito ya descarta la ubicación en vuelo.
$('cancel-location').addEventListener('click', () => chooseDistrict()); nodes['district-search'].addEventListener('input', () => renderDistricts(nodes['district-search'].value));
// Volver a los resultados los devuelve tal como estaban: no se recalcula nada,
// solo se vuelve a mostrar la pantalla que seguía pintada debajo.
$('menu-back-results').addEventListener('click', () => { closePlaceMenu(); show('compare'); renderPlaceAction('idle'); nodes['compare-title'].focus(); });
nodes.districts.addEventListener('click', (event) => { const district = event.target.closest('[data-district]')?.dataset.district; if (district) { elegir({ origin: null, district }); showCompare(); } });
// Cambiar un filtro estando abajo: el primer resultado es la respuesta, así
// que la lista vuelve arriba y el card de controles regresa al flujo.
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => { elegir({ sort: button.dataset.sort === 'price' ? 'price' : 'distance', preferencesTouched: true, visibleCount: PAGE_SIZE }); renderOffers(); controls.scrollToTop(); }));
// El sub-toggle recuerda la elección aunque se vuelva a «Más cerca», así que
// quien compara Premium no tiene que volver a decirlo en cada vuelta.
document.querySelectorAll('[data-price-product]').forEach((button) => button.addEventListener('click', () => { elegir({ priceProduct: button.dataset.priceProduct, visibleCount: PAGE_SIZE }); renderOffers(); controls.scrollToTop(); }));
nodes.offers.addEventListener('click', (event) => { const button = event.target.closest('[data-detail]'); if (button) toggleDetail(button); });
// Filtrado local sobre datos ya cargados: no hay red, así que `input` responde
// mientras se arrastra sin costo perceptible; al soltar, la lista vuelve arriba.
nodes['radius-input'].addEventListener('input', () => { elegir({ radiusKm: Number(nodes['radius-input'].value), preferencesTouched: true, visibleCount: PAGE_SIZE }); renderOffers(); });
nodes['radius-input'].addEventListener('change', () => controls.scrollToTop());
nodes['load-more'].addEventListener('click', () => {
  const pintadas = nodes.offers.children.length;
  elegir({ visibleCount: ui.view.nextCount });
  renderOffers();
  // El botón puede acabar de desaparecer y el foco caería en <body>. Pasa a la
  // primera tarjeta nueva, que es justo lo que se acaba de pedir.
  nodes.offers.children[pintadas]?.focus();
});
nodes['refresh-location'].addEventListener('click', placeAction);
nodes['refresh-location-compact'].addEventListener('click', placeAction);

// Menú de puntos: disclosure simple, sin `role="menu"`, para que Tab recorra los
// ítems sin gestión de foco propia. `Escape` cierra primero el menú y solo el
// segundo llega al card de controles, que es quien lo colapsa.
const menuAbierto = () => !nodes['place-menu'].hidden;
function closePlaceMenu({ devolverFoco = false } = {}) {
  if (!menuAbierto()) return;
  nodes['place-menu'].hidden = true;
  nodes['place-more'].setAttribute('aria-expanded', 'false');
  if (devolverFoco) nodes['place-more'].focus();
}
nodes['place-more'].addEventListener('click', () => {
  if (menuAbierto()) { closePlaceMenu({ devolverFoco: true }); return; }
  nodes['place-menu'].hidden = false;
  nodes['place-more'].setAttribute('aria-expanded', 'true');
  nodes['place-menu'].querySelector('button:not(:disabled)')?.focus();
});
addEventListener('keydown', (event) => {
  if (!menuAbierto()) return;
  // `stopImmediatePropagation` y no `stopPropagation`: si el evento tiene como
  // destino la propia ventana, ambos listeners corren en la misma fase y el
  // card colapsaría con el mismo Escape que solo debía cerrar el menú.
  if (event.key === 'Escape') { event.stopImmediatePropagation(); closePlaceMenu({ devolverFoco: true }); return; }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = [...nodes['place-menu'].querySelectorAll('button:not(:disabled)')];
  const paso = event.key === 'ArrowDown' ? 1 : items.length - 1;
  event.preventDefault();
  items[(items.indexOf(document.activeElement) + paso + items.length) % items.length]?.focus();
}, true);
addEventListener('pointerdown', (event) => { if (!nodes['place-menu'].contains(event.target) && !nodes['place-more'].contains(event.target)) closePlaceMenu(); });
// Al colapsarse el card por scroll el panel se esconde; el menú no puede quedar
// abierto y sin dueño detrás.
addEventListener('scroll', () => closePlaceMenu(), { passive: true });
$('menu-districts').addEventListener('click', () => { closePlaceMenu(); chooseDistrict(); });
// Volver al inicio conserva radio y criterio: son preferencias, no consecuencias
// del origen. Solo se suelta la posición en vuelo, si había una.
$('menu-home').addEventListener('click', () => { closePlaceMenu(); locator.cancel(); ui.updatingLocation = false; show('start'); $('use-location').focus(); });
$('retry-load').addEventListener('click', () => location.reload());
nodes['start-retry'].addEventListener('click', () => loadActiveView());
nodes['view-state-action'].addEventListener('click', () => {
  if (nodes['view-state'].dataset.state === 'district-empty') chooseDistrict();
  else loadActiveView();
});
// Un solo listener por contenedor: los botones se pintan desde el catálogo.
for (const opciones of document.querySelectorAll('[data-view-options]')) opciones.addEventListener('click', (event) => { const boton = event.target.closest('[data-view]'); if (boton) switchView(boton.dataset.view); });
// Volver a la app tras un rato no dispara ningún gesto: sin esto, un precio que
// venció mientras estaba en segundo plano seguiría en pantalla hasta tocar algo.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data.dataset && ui.screen === 'compare') renderOffers(); });
initTheme();
// «Ver historial» no es otra pantalla: es la portada con el gráfico enfocado, y
// tiene URL propia para poder enlazarla y volver a ella con «atrás». El gráfico
// se monta la primera vez que se entra a una vista con histórico: en paralelo
// con los precios, sin retrasar el GPS, y si falla se cuenta dentro de su
// propio bloque.
let historyChart = null;
function montarHistorial() {
  if (!historyChart) historyChart = mountHistoryChart({ mount: $('history-chart'), body: $('history-body') });
}
function showHistory({ push = true } = {}) {
  if (!VIEWS[search.view].history) return;
  closePlaceMenu(); locator.cancel(); ui.updatingLocation = false; show('start');
  if (push && !enHistorial()) history.pushState(null, '', historyPath(search.view));
  montarHistorial();
  historyChart.focus();
}
$('menu-history').addEventListener('click', () => showHistory());
// Atrás y adelante se resuelven con la misma tabla que la carga directa: si la
// entrada es de otra vista, se cambia de vista por el mismo camino que el
// selector, sin volver a escribir el historial.
addEventListener('popstate', () => {
  const ruta = resolvePath(location.pathname, { preference: readPreference() });
  if (ruta.kind !== 'view') return;
  if (ruta.view !== search.view) switchView(ruta.view, { fromHistory: true });
  if (ruta.history) showHistory({ push: false });
});
mountViewPickers();
renderViewChrome();
initialize();
if (inicial.history) historyChart?.focus();
