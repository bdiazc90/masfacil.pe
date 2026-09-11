/**
 * Precio promedio en Lima: dos líneas en la pantalla inicial.
 *
 * Se monta fuera del arranque de precios y NUNCA rechaza: si el resumen no
 * llega, no vale o todavía no hay días, el bloque lo cuenta dentro de sí mismo.
 * Buscar gasolina no puede fallar porque un gráfico de contexto no cargue.
 *
 * El SVG se arma con plantillas de string, como las tarjetas de oferta: con
 * sesenta puntos, repintar entero al cambiar de ventana sale más barato —y se
 * lee mucho mejor— que mantener nodos vivos.
 */

import { HISTORY_ORIGIN, HISTORY_SUMMARY_PATH, HISTORY_MAX_BYTES, limaDate, validateDailySummary } from './lib/history-contract.js';
import { DEFAULT_WINDOW, HISTORY_WINDOWS, STALE_HOURS, demoSummary, frameWindow, lastCounts, segments, sharedScale, staleHours } from './lib/history-series.js';
import { escapeHtml } from './offer-card.js';

const GUARDADO = 'masfacil-history-daily-v1';
const SOLES = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DIA_CORTO = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DIA_LARGO = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const HORA = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' });

const PRODUCTOS = Object.freeze([
  { key: 'regular', label: 'Regular', dash: '', marca: 'circulo' },
  { key: 'premium', label: 'Premium', dash: '5 3', marca: 'cuadro' },
]);

// Lienzo fijo con `viewBox`: escala a cualquier ancho sin recalcular nada y sin
// desbordar a 320 px. Los márgenes dejan sitio a las etiquetas de los dos ejes.
const W = 320; const H = 148; const PAD = Object.freeze({ arriba: 8, derecha: 6, abajo: 22, izquierda: 34 });
const ANCHO = W - PAD.izquierda - PAD.derecha;
const ALTO = H - PAD.arriba - PAD.abajo;

const fecha = (date, formato = DIA_CORTO) => formato.format(new Date(`${date}T12:00:00Z`));
const numero = (valor) => (Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0);
const soles = (valor) => (Number.isFinite(valor) ? SOLES.format(valor) : '—');

function coordenadas(points, scale, days) {
  const paso = days > 1 ? ANCHO / (days - 1) : 0;
  const x = (index) => numero(PAD.izquierda + (days > 1 ? index * paso : ANCHO / 2));
  const y = (mean) => numero(PAD.arriba + ALTO - ((mean - scale.min) / (scale.max - scale.min)) * ALTO);
  return { x, y, paso };
}

function pintarSerie(points, scale, days, producto) {
  const { x, y } = coordenadas(points, scale, days);
  const tramos = segments(points, producto.key);
  const piezas = tramos.map((tramo) => {
    if (tramo.length === 1) return `<circle class="history__solo" cx="${x(tramo[0].index)}" cy="${y(tramo[0].mean)}" r="3.2"/>`;
    return `<path class="history__linea" d="${tramo.map((punto, indice) => `${indice ? 'L' : 'M'}${x(punto.index)} ${y(punto.mean)}`).join(' ')}" stroke-dasharray="${producto.dash}"/>`;
  });
  return `<g class="history__serie" data-serie="${producto.key}" aria-hidden="true">${piezas.join('')}</g>`;
}

function pintarMarcadores(points, scale, days, producto) {
  const { x, y } = coordenadas(points, scale, days);
  const marcas = points.filter((punto) => punto[producto.key]).map((punto) => (producto.marca === 'cuadro'
    ? `<rect x="${numero(x(punto.index) - 2.4)}" y="${numero(y(punto[producto.key].mean) - 2.4)}" width="4.8" height="4.8"/>`
    : `<circle cx="${x(punto.index)}" cy="${y(punto[producto.key].mean)}" r="2.6"/>`));
  return `<g class="history__marcas" data-serie="${producto.key}" aria-hidden="true">${marcas.join('')}</g>`;
}

function pintarEjes(points, scale, days, seleccion) {
  const { x, y } = coordenadas(points, scale, days);
  const marcasY = scale.ticks.map((valor) => `<g class="history__tick"><line x1="${PAD.izquierda}" y1="${y(valor)}" x2="${W - PAD.derecha}" y2="${y(valor)}"/><text x="${PAD.izquierda - 5}" y="${numero(y(valor) + 3)}" text-anchor="end">${valor.toFixed(2)}</text></g>`).join('');
  // Solo tres etiquetas en X: con 30 días, una por punto sería ilegible.
  const indices = days > 2 ? [0, Math.floor((days - 1) / 2), days - 1] : points.map((punto) => punto.index);
  const marcasX = [...new Set(indices)].map((index) => {
    const punto = points[index];
    const ancla = index === 0 ? 'start' : index === days - 1 ? 'end' : 'middle';
    return `<text class="history__eje-x" x="${x(index)}" y="${H - 6}" text-anchor="${ancla}">${escapeHtml(punto.isToday ? 'Hoy' : fecha(punto.date))}</text>`;
  }).join('');
  const guia = seleccion === null ? '' : `<line class="history__guia" x1="${x(seleccion)}" y1="${PAD.arriba}" x2="${x(seleccion)}" y2="${PAD.arriba + ALTO}"/>`;
  return `${marcasY}${guia}${marcasX}`;
}

function pintarSeleccion(points, scale, days, seleccion) {
  if (seleccion === null) return '';
  const { x, y } = coordenadas(points, scale, days);
  const punto = points[seleccion];
  return PRODUCTOS.filter((producto) => punto[producto.key]).map((producto) => `<circle class="history__activo" data-serie="${producto.key}" cx="${x(punto.index)}" cy="${y(punto[producto.key].mean)}" r="4.4"/>`).join('');
}

function lectura(punto) {
  if (!punto) return 'Toca o usa las flechas para ver un día.';
  if (!punto.observation) return `${fecha(punto.date, DIA_LARGO)}: no se pudo registrar el precio de ese día.`;
  const partes = PRODUCTOS.map((producto) => `${producto.label} ${soles(punto[producto.key]?.mean)}${punto[producto.key] ? ` con ${punto[producto.key].n} estaciones` : ''}`);
  const hora = HORA.format(new Date(punto.observation.observed_at));
  return `${fecha(punto.date, DIA_LARGO)}${punto.isToday ? ' (en curso)' : ''}: ${partes.join('; ')}. Al corte de las ${hora}.`;
}

function pintarTabla(points) {
  const filas = points.map((punto) => {
    const celdas = PRODUCTOS.map((producto) => `<td>${escapeHtml(soles(punto[producto.key]?.mean))}</td><td>${punto[producto.key] ? punto[producto.key].n : '—'}</td>`).join('');
    const hora = punto.observation ? HORA.format(new Date(punto.observation.observed_at)) : '—';
    return `<tr><th scope="row">${escapeHtml(fecha(punto.date))}${punto.isToday ? ' <span class="history__curso">en curso</span>' : ''}</th>${celdas}<td>${escapeHtml(hora)}</td></tr>`;
  }).join('');
  return `<details class="history__tabla"><summary>Ver la tabla</summary><div class="history__scroll"><table><caption class="sr-only">Precio promedio por día, con cuántas estaciones lo formaron</caption><thead><tr><th scope="col">Día</th><th scope="col">Regular</th><th scope="col">n</th><th scope="col">Premium</th><th scope="col">n</th><th scope="col">Corte</th></tr></thead><tbody>${filas}</tbody></table></div></details>`;
}

// La media nunca viaja sin su denominador: la leyenda lleva el `n` del último
// punto con dato de cada producto, visible sin tocar ni pasar el puntero.
function pintarLeyenda(points) {
  const conteos = lastCounts(points);
  return `<ul class="history__leyenda">${PRODUCTOS.map((producto) => `<li data-serie="${producto.key}"><svg viewBox="0 0 20 10" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="5" x2="19" y2="5" stroke-dasharray="${producto.dash}"/>${producto.marca === 'cuadro' ? '<rect x="7.6" y="2.6" width="4.8" height="4.8"/>' : '<circle cx="10" cy="5" r="2.6"/>'}</svg>${producto.label}${conteos[producto.key] === null ? '' : `<span class="history__n">n ${conteos[producto.key]}</span>`}</li>`).join('')}</ul>`;
}

function pintarSelector(days) {
  return `<div class="toggle toggle--sub history__ventanas" role="group" aria-label="Días a mostrar">${HISTORY_WINDOWS.map((valor) => `<button type="button" data-window="${valor}" aria-pressed="${valor === days}">${valor} d</button>`).join('')}</div>`;
}

function pintarGrafico(marco, seleccion) {
  const { points, days } = marco;
  const scale = sharedScale(points);
  if (scale.empty) return '';
  const capas = [
    pintarEjes(points, scale, days, seleccion),
    ...PRODUCTOS.map((producto) => pintarSerie(points, scale, days, producto)),
    ...PRODUCTOS.map((producto) => pintarMarcadores(points, scale, days, producto)),
    pintarSeleccion(points, scale, days, seleccion),
  ];
  // El blanco táctil es el SVG entero: a 30 días cada ranura mide unos diez
  // píxeles, y un rectángulo por punto quedaría muy por debajo de los 44 px.
  return `<svg class="history__svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="group" tabindex="0" aria-label="Precio promedio diario de Regular y Premium en Lima. Usa las flechas para recorrer los días.">${capas.join('')}</svg>`;
}

const explicacion = `<details class="history__como"><summary>Cómo se calcula</summary><p>Cada punto es el promedio de los precios que la app podía mostrar al último corte de ese día. Cada estación pesa lo mismo y <em>n</em> dice cuántas participaron. No depende de tu ubicación, del distrito que elijas ni de la marca.</p><p>La fuente oficial publica los martes, así que verás tramos planos con escalones. Entre martes y martes el promedio se mueve por estaciones que entran o salen de la ventana de 30 días, no por precios nuevos: describe a las que participaron, no es un índice de precios ni una garantía de lo que cobra el surtidor.</p></details>`;

/**
 * Monta el gráfico. Nunca rechaza.
 *
 * @param {object} entrada
 * @param {HTMLElement} entrada.mount   contenedor con `data-state`
 * @param {HTMLElement} entrada.body    donde se pinta
 * @returns {{setWindow: Function, destroy: Function}}
 */
export function mountHistoryChart({
  mount,
  body,
  origin = HISTORY_ORIGIN,
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  now = () => new Date(),
  storage = typeof localStorage === 'undefined' ? null : localStorage,
  search = typeof location === 'undefined' ? '' : location.search,
} = {}) {
  if (!mount || !body) return { setWindow() {}, destroy() {} };
  const demo = new URLSearchParams(search).get('history-demo') === '1';
  let resumen = null;
  let estado = 'loading';
  let dias = DEFAULT_WINDOW;
  let seleccion = null;
  let nota = '';

  const guardar = (texto) => { try { storage?.setItem(GUARDADO, JSON.stringify({ savedAt: new Date(now()).toISOString(), body: texto })); } catch { /* modo privado o sin cuota: no es motivo para romper nada */ } };
  const recuperar = () => { try { return JSON.parse(storage?.getItem(GUARDADO) ?? 'null'); } catch { return null; } };

  function render() {
    mount.dataset.state = estado;
    if (estado === 'loading') { body.innerHTML = '<p class="history__nota" role="status">Cargando el histórico…</p>'; return; }
    if (estado === 'error' || estado === 'empty') { body.innerHTML = `<p class="history__nota" role="status">${escapeHtml(nota)}</p>`; return; }

    const marco = frameWindow(resumen, { today: limaDate(now()), days: dias });
    const punto = seleccion === null ? null : marco.points[seleccion];
    const aviso = nota ? `<p class="history__nota" role="status">${escapeHtml(nota)}</p>` : '';
    body.innerHTML = `${pintarSelector(dias)}${pintarGrafico(marco, seleccion)}${pintarLeyenda(marco.points)}<p class="history__lectura" role="status">${escapeHtml(lectura(punto))}</p>${aviso}${pintarTabla(marco.points)}${explicacion}`;
  }

  function elegir(indice) {
    const marco = frameWindow(resumen, { today: limaDate(now()), days: dias });
    if (!marco.points.length) return;
    seleccion = Math.max(0, Math.min(marco.points.length - 1, indice));
    render();
    body.querySelector('.history__svg')?.focus({ preventScroll: true });
  }

  function setWindow(valor) {
    if (!HISTORY_WINDOWS.includes(valor) || valor === dias) return;
    dias = valor;
    // Cambiar la ventana no vuelve a pedir nada ni recalcula ninguna media:
    // solo recorta lo que ya está.
    seleccion = null;
    render();
  }

  function aplicar(texto, { desdeCopia = false, savedAt = null } = {}) {
    const bytes = texto.length;
    if (bytes > HISTORY_MAX_BYTES) throw new Error('resumen desmesurado');
    const candidato = JSON.parse(texto);
    const problemas = validateDailySummary(candidato, { bytes });
    if (problemas.length) throw new Error(problemas[0]);
    resumen = candidato;
    const marco = frameWindow(resumen, { today: limaDate(now()), days: 30 });
    const horas = staleHours(marco.lastObservedAt, now());
    if (!marco.daysWithObservation) { estado = 'empty'; nota = 'Estamos construyendo el histórico: 0 días registrados.'; return; }
    if (marco.daysWithObservation < 3) { estado = 'few'; nota = `Estamos construyendo el histórico: ${marco.daysWithObservation} ${marco.daysWithObservation === 1 ? 'día registrado' : 'días registrados'}.`; return; }
    if (desdeCopia) { estado = 'saved'; nota = `Copia guardada${savedAt ? ` del ${fecha(limaDate(savedAt), DIA_LARGO)}` : ''}: puede no estar al día.`; return; }
    if (horas !== null && horas > STALE_HOURS) { estado = 'stale'; nota = `Última actualización: ${fecha(marco.lastObservedAt.slice(0, 10), DIA_LARGO)}.`; return; }
    estado = 'ready';
    nota = '';
  }

  async function cargar() {
    if (demo) {
      // La demostración no toca la red ni el almacenamiento: es evidentemente
      // una demostración y no debe dejar rastro que luego parezca un dato.
      resumen = demoSummary({ today: limaDate(now()) });
      estado = 'demo';
      nota = 'Serie de demostración: no son precios reales.';
      dias = 30;
      render();
      return;
    }
    let texto = null;
    try {
      // `no-cache` es revalidar, no descargar: el navegador pregunta por ETag y
      // un 304 cuesta casi nada. Así la frescura no depende de que el bucket
      // devuelva un `Cache-Control` corto. Sin cabeceras propias: nada de preflight.
      const response = await fetchImpl(new URL(HISTORY_SUMMARY_PATH, origin), { redirect: 'error', cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      texto = await response.text();
      aplicar(texto);
      guardar(texto);
    } catch {
      // La copia guardada se vuelve a validar entera: nunca se confía en lo que
      // haya en el almacenamiento del navegador.
      const copia = recuperar();
      try {
        if (!copia?.body) throw new Error('sin copia');
        aplicar(copia.body, { desdeCopia: true, savedAt: copia.savedAt });
      } catch {
        estado = 'error';
        nota = 'No pudimos cargar el histórico. Los precios de arriba no dependen de esto.';
      }
    }
    render();
  }

  const alPulsar = (event) => {
    const ventana = event.target.closest('[data-window]');
    if (ventana) { setWindow(Number(ventana.dataset.window)); return; }
  };
  const alApuntar = (event) => {
    const svg = event.target.closest('.history__svg');
    if (!svg) return;
    const caja = svg.getBoundingClientRect();
    if (!caja.width) return;
    const relativo = ((event.clientX - caja.left) / caja.width) * W;
    const paso = dias > 1 ? (W - PAD.izquierda - PAD.derecha) / (dias - 1) : 0;
    elegir(paso ? Math.round((relativo - PAD.izquierda) / paso) : 0);
  };
  const alTeclear = (event) => {
    if (!event.target.closest('.history__svg')) return;
    const teclas = { ArrowLeft: -1, ArrowRight: 1, Home: 'inicio', End: 'fin' };
    const accion = teclas[event.key];
    if (accion === undefined) return;
    event.preventDefault();
    if (accion === 'inicio') elegir(0);
    else if (accion === 'fin') elegir(dias - 1);
    else elegir((seleccion === null ? dias - 1 : seleccion) + accion);
  };

  body.addEventListener('click', alPulsar);
  body.addEventListener('pointerdown', alApuntar);
  body.addEventListener('keydown', alTeclear);
  render();
  // Se lanza sin esperar: los precios y el GPS no dependen de esto.
  cargar().catch(() => { estado = 'error'; nota = 'No pudimos cargar el histórico.'; render(); });

  return {
    setWindow,
    /** Lleva la vista y el foco al gráfico: es lo que hace «Ver historial» y la ruta `/gasolina/historial`. */
    focus() {
      mount.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      (body.querySelector('.history__svg') ?? mount.querySelector('#history-title') ?? mount).focus?.({ preventScroll: true });
    },
    destroy() {
      body.removeEventListener('click', alPulsar);
      body.removeEventListener('pointerdown', alApuntar);
      body.removeEventListener('keydown', alTeclear);
    },
  };
}
