/**
 * Pulso de precios: un plano y cuatro líneas en la pantalla inicial.
 *
 * Se monta fuera del arranque de precios y NUNCA rechaza: si el resumen no
 * llega, no vale o todavía no hay días, el bloque lo cuenta dentro de sí mismo.
 * Buscar gasolina no puede fallar porque un gráfico de contexto no cargue.
 *
 * Los dos combustibles comparten trazado, calendario y **una sola escala en
 * soles reales**: es el precio que de verdad tienen, así que la brecha entre
 * Regular y Premium se lee tal cual. El coste está aceptado y declarado: con los
 * dos dentro, cada curva recorre menos altura que cuando tenía su propio eje.
 *
 * Cuatro líneas, dos señales para distinguirlas. El COLOR dice el producto —el
 * mismo de su chip en la tarjeta— y el TRAZO dice la función: continuo para lo
 * observado, discontinuo para el promedio del periodo. Además cada curva lleva
 * su nombre junto al último punto, así que nadie depende del color solo ni tiene
 * que consultar una leyenda.
 *
 * Aquí no se interpreta: fechas, producto, unidad, promedio y estados de datos
 * son etiquetas informativas. Ninguna frase dice si el precio está alto, bajo o
 * si conviene cargar.
 *
 * El SVG se arma con plantillas de string, como las tarjetas de oferta: con
 * siete puntos, repintar entero sale más barato —y se lee mucho mejor— que
 * mantener nodos vivos. Lo que NO se repinta es ni la región viva ni el nodo que
 * tiene el foco: la selección de un día solo reescribe sus dos capas, para que
 * un lector de pantalla anuncie lo que la persona eligió y no toda la gráfica.
 */

import { HISTORY_MAX_DAYS, HISTORY_ORIGIN, HISTORY_PRODUCTS, HISTORY_SUMMARY_PATH, HISTORY_MAX_BYTES, limaDate, validateDailySummary } from './lib/history-contract.js';
import { DEFAULT_WINDOW, STALE_HOURS, areaPath, demoSummary, frameWindow, lastPoint, monotonePath, periodAverage, planeScale, segments, staleHours } from './lib/history-series.js';
import { escapeHtml } from './offer-card.js';
import { PRODUCTS } from './lib/catalog.js';

const GUARDADO = 'masfacil-history-daily-v1';
const DIA_CORTO = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DIA_SEMANA = new Intl.DateTimeFormat('es-PE', { weekday: 'short', timeZone: 'UTC' });
const DIA_NUMERO = new Intl.DateTimeFormat('es-PE', { day: 'numeric', timeZone: 'UTC' });
const DIA_LARGO = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

// Los productos son los del contrato del resumen, que es independiente del de
// precios; solo el nombre que se pinta sale del catálogo.
const PRODUCTOS = Object.freeze(HISTORY_PRODUCTS.map((key) => ({ key, label: PRODUCTS[key]?.short ?? key })));

// Lienzo único, con `viewBox`: escala a cualquier ancho sin recalcular nada y sin
// desbordar a 320 px. El margen izquierdo deja sitio a las cifras del eje y el
// inferior a las fechas, las dos a 12 px reales.
//
// El trazado sube a 220 porque ahora carga con las dos series: entre ellas hay
// más de un sol de distancia, y con menos altura cada curva se aplanaría.
const W = 320;
const TRAZADO = 220;
// El margen izquierdo lo fija la cifra más ancha del eje a su tamaño mayor:
// bajo 340 px la etiqueta sube a 16 unidades para seguir midiendo 12 px reales,
// y «22.80» ocupa entonces unas 44. Con menos, la cifra se saldría del lienzo.
const PAD = Object.freeze({ arriba: 12, derecha: 10, abajo: 40, izquierda: 50 });
const H = PAD.arriba + TRAZADO + PAD.abajo;
const ANCHO = W - PAD.izquierda - PAD.derecha;
const BASE = PAD.arriba + TRAZADO;

// Los ids de gradiente viven en el documento de la página, no en un SVG aislado:
// dos series y dos montajes tienen que poder convivir sin pisarse.
let secuencia = 0;

// Alto del faldón de relleno, en unidades del lienzo.
//
// El área ya no cierra contra el suelo del plano: con las dos series juntas, el
// relleno de Premium taparía la curva de Regular entera y las dos tintas se
// apilarían abajo, que es justo lo que un área por producto no debe sugerir. El
// degradado se ancla al techo de su propia curva y muere aquí; más abajo el
// gradiente hace `pad` con la parada transparente.
const FALDON = 56;

const numero = (valor) => (Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0);
const fecha = (date, formato = DIA_CORTO) => formato.format(new Date(`${date}T12:00:00Z`));
const dosDecimales = (valor) => valor.toFixed(2);
const cifra = (valor) => `<small>S/</small>${escapeHtml(dosDecimales(valor))}`;

function coordenadas(scale, days) {
  const paso = days > 1 ? ANCHO / (days - 1) : 0;
  const x = (index) => numero(PAD.izquierda + (days > 1 ? index * paso : ANCHO / 2));
  const y = (mean) => numero(PAD.arriba + TRAZADO - ((mean - scale.min) / (scale.max - scale.min)) * TRAZADO);
  return { x, y, paso };
}

/** Fechas del eje: todas con siete días; espaciadas desde el final con catorce. */
function marcasX(points, days) {
  const paso = days <= 7 ? 1 : 3;
  const indices = [];
  for (let i = days - 1; i >= 0; i -= paso) indices.push(i);
  return indices.reverse().map((index) => points[index]).filter(Boolean);
}

/**
 * Una fecha del eje, en dos renglones: día de semana arriba y número abajo.
 *
 * Con siete días etiquetados y el mínimo de 12 px reales, «lun 7» en una línea
 * ocupa casi toda su ranura y las etiquetas se tocan. Partiéndola cada una mide
 * la mitad, se etiquetan los siete días y el día de semana sigue leyéndose.
 */
function etiquetaX(punto, days) {
  const x = punto.x;
  const arriba = punto.isToday ? 'Hoy' : fecha(punto.date, days <= 7 ? DIA_SEMANA : DIA_CORTO);
  if (days > 7) return `<text class="history__eje-x" x="${x}" y="${H - 22}" text-anchor="${punto.ancla}">${escapeHtml(arriba)}</text>`;
  // Bajo 340 px el lienzo se encoge y las siete no caben: el CSS esconde una de
  // cada dos contando desde hoy, que es la que nunca se va. Se decide por ancho
  // real, no por una consulta de medios desde JavaScript.
  const alterna = (days - 1 - punto.index) % 2 === 1 ? ' data-alterna="1"' : '';
  return `<text class="history__eje-x" x="${x}" y="${H - 24}" text-anchor="${punto.ancla}"${alterna}>${escapeHtml(arriba)}</text>`
    + `<text class="history__eje-x history__eje-dia" x="${x}" y="${H - 8}" text-anchor="${punto.ancla}"${alterna}>${escapeHtml(fecha(punto.date, DIA_NUMERO))}</text>`;
}

function pintarEjes(points, scale, days, { x, y }, alturasPromedio = []) {
  // La cifra de una marca que cae encima de una referencia se calla: la línea
  // sigue ahí, pero dos números pegados a la misma altura no se leen. Nunca se
  // deja al lado dos cifras sin decir qué es cada una.
  const marcasY = scale.ticks.map((valor) => {
    const altura = y(valor);
    const choca = alturasPromedio.some((suya) => Math.abs(altura - suya) < 7);
    return `<g class="history__tick"><line x1="${PAD.izquierda}" y1="${altura}" x2="${W - PAD.derecha}" y2="${altura}"/>${choca ? '' : `<text x="${PAD.izquierda - 6}" y="${numero(altura + 4)}" text-anchor="end">${dosDecimales(valor)}</text>`}</g>`;
  }).join('');
  const etiquetas = marcasX(points, days).map((punto) => etiquetaX({
    ...punto,
    x: x(punto.index),
    ancla: punto.index === 0 ? 'start' : punto.index === days - 1 ? 'end' : 'middle',
  }, days)).join('');
  return `${marcasY}${etiquetas}`;
}

/**
 * Curva, relleno y puntos de una franja.
 *
 * Un hueco corta los dos: ni la línea ni el área lo atraviesan. Un tramo de un
 * solo día se pinta como punto y no arrastra relleno, porque un área de ancho
 * cero no describe nada.
 */
function pintarSerie(points, key, coords, uid) {
  const tramos = segments(points, key);
  const areas = tramos.map((tramo) => (tramo.length > 1 ? `<path class="history__area" d="${areaPath(tramo, coords.x, coords.y, BASE)}" fill="url(#${uid}-fill-${key})"/>` : '')).join('');
  const lineas = tramos.map((tramo) => (tramo.length > 1
    ? `<path class="history__linea" d="${monotonePath(tramo, coords.x, coords.y)}"/>`
    : `<circle class="history__solo" cx="${coords.x(tramo[0].index)}" cy="${coords.y(tramo[0].mean)}" r="3.4"/>`)).join('');
  return `${areas}${lineas}`;
}

/**
 * El gradiente del faldón de una serie, anclado a su propia curva.
 *
 * `userSpaceOnUse` desde el punto más alto de la serie hasta `FALDON` más abajo.
 * El `d` del área sigue cerrando contra el suelo; lo que cambia es dónde muere
 * el color, y por eso una serie no puede teñir el territorio de la otra.
 */
function faldon(points, key, coords, uid) {
  const alturas = points.map((punto) => punto[key]?.mean).filter(Number.isFinite).map(coords.y);
  if (!alturas.length) return '';
  const techo = Math.min(...alturas);
  // Tres paradas: sin la intermedia el degradado se apaga de golpe y se le ve
  // el corte, porque el faldón es corto.
  return `<linearGradient id="${uid}-fill-${key}" x1="0" y1="${numero(techo)}" x2="0" y2="${numero(techo + FALDON)}" gradientUnits="userSpaceOnUse"><stop class="history__fill-alto" offset="0"/><stop class="history__fill-medio" offset=".55"/><stop class="history__fill-bajo" offset="1"/></linearGradient>`;
}

/**
 * El último día observado, destacado y con el nombre de su producto al lado.
 *
 * La etiqueta es la señal que sustituye a las franjas separadas: con las dos
 * curvas en el mismo plano, distinguirlas no puede depender solo del color.
 * Va sobre el punto y anclada a la derecha, al extremo opuesto de la cifra del
 * promedio, para que las dos etiquetas de un producto nunca se crucen.
 */
function pintarUltimo(ultimo, label, coords) {
  if (!ultimo) return '';
  const x = coords.x(ultimo.index);
  const y = coords.y(ultimo.mean);
  const arriba = y > PAD.arriba + 20;
  return `<text class="history__serie-nombre" x="${numero(x + 2)}" y="${numero(arriba ? y - 11 : y + 20)}" text-anchor="end">${escapeHtml(label.toLocaleUpperCase('es-PE'))}</text>`
    + `<circle class="history__ultimo" cx="${x}" cy="${y}" r="4.6"/>`;
}

/**
 * La recta del promedio del periodo, discontinua y con su valor.
 *
 * El patrón discontinuo está RESERVADO a esta referencia: las dos curvas son
 * continuas, así que una línea a trazos solo puede significar «promedio».
 * Con un solo día válido no se dibuja: repetiría el mismo número.
 */
function pintarPromedio(promedio, coords) {
  if (!promedio || promedio.k < 2) return '';
  const y = coords.y(promedio.mean);
  // La etiqueta sube o baja según dónde caiga la recta, para no salirse del
  // trazado ni chocar con la cifra del último punto cuando ambos coinciden.
  const arriba = y > PAD.arriba + 22;
  return `<g class="history__promedio"><line x1="${PAD.izquierda}" y1="${y}" x2="${W - PAD.derecha}" y2="${y}"/><text x="${PAD.izquierda + 2}" y="${numero(arriba ? y - 6 : y + 14)}">Prom. ${escapeHtml(dosDecimales(promedio.mean))}</text></g>`;
}

/**
 * Guía y marcador del día elegido.
 *
 * Viven en dos capas propias —una bajo las curvas y otra encima— para poder
 * moverlas SIN rehacer el `<svg>`. Reconstruir el nodo que tiene el foco obliga
 * al lector de pantalla a releer su nombre entero en cada flecha, y le devuelve
 * el foco a un elemento que acaba de nacer.
 */
function pintarGuia(seleccion, coords) {
  if (seleccion === null) return '';
  return `<line class="history__guia" x1="${coords.x(seleccion)}" y1="${PAD.arriba}" x2="${coords.x(seleccion)}" y2="${BASE}"/>`;
}

function pintarActivo(points, key, seleccion, coords) {
  if (seleccion === null) return '';
  const dato = points[seleccion]?.[key];
  if (!dato) return '';
  return `<circle class="history__activo" data-serie="${key}" cx="${coords.x(seleccion)}" cy="${coords.y(dato.mean)}" r="5"/>`;
}

/**
 * La geometría del plano, recalculada del marco. Pura y barata.
 *
 * Devuelve una sola escala y unas solas coordenadas, más lo que cada serie
 * aporta: su último punto y su promedio del periodo.
 */
function geometria(points, days) {
  const series = PRODUCTOS.map((producto) => ({
    ...producto,
    ultimo: lastPoint(points, producto.key),
    promedio: periodAverage(points, producto.key),
  }));
  const scale = planeScale(points, series.map(({ key, promedio }) => ({ key, average: promedio?.k >= 2 ? promedio.mean : null })));
  return { series, scale, coords: coordenadas(scale, days) };
}

/**
 * Lectura accesible de la franja: un día por elemento, sin parada de teclado.
 *
 * Sustituye a la tabla desplegable que se retiró. Retirar la tabla no puede
 * quitar el acceso a los valores; un listado que solo ven las tecnologías de
 * asistencia lo conserva sin ocupar pantalla ni añadir un tab por punto.
 */
function pintarLista(points, id) {
  const filas = points.map((punto) => {
    const dia = `${fecha(punto.date, DIA_LARGO)}${punto.isToday ? ' (hoy, en curso)' : ''}`;
    const partes = PRODUCTOS.map((producto) => {
      const dato = punto[producto.key];
      return `${producto.label} ${dato ? `S/ ${dosDecimales(dato.mean)} con ${dato.n} estaciones` : 'sin dato'}`;
    });
    return `<li>${escapeHtml(`${dia}: ${partes.join('; ')}.`)}</li>`;
  }).join('');
  // Región hermana con nombre propio, NO `aria-describedby` del gráfico: colgada
  // del foco, el lector recitaría los catorce días cada vez que se entra en el
  // trazado. Así el dato sigue disponible y se alcanza navegando.
  return `<section class="sr-only" id="${id}" aria-label="Precio promedio día a día"><ul>${filas}</ul></section>`;
}

/** Las dos lecturas grandes, una por combustible, sobre el trazado. */
function pintarLecturas(marco) {
  const { points } = marco;
  return `<div class="history__lecturas">${PRODUCTOS.map((producto) => {
    const ultimo = lastPoint(points, producto.key);
    // Fecha y población, nada más: el subtítulo del bloque ya dice de qué
    // ventana se habla, y la hora del corte pertenece a la lectura de un día.
    const cuerpo = ultimo
      ? `<p class="history__valor">${cifra(ultimo.mean)}</p><p class="history__meta"><time datetime="${escapeHtml(ultimo.observedAt ?? ultimo.date)}">${escapeHtml(fecha(ultimo.date))}</time> · ${ultimo.n} grifos</p>`
      : '<p class="history__valor history__valor--vacio" aria-hidden="true">—</p><p class="history__meta">Sin días registrados en esta ventana.</p>';
    return `<div class="history__lectura-producto" data-serie="${producto.key}"><h3 class="history__producto">${producto.label}</h3>${cuerpo}</div>`;
  }).join('')}</div>`;
}

/**
 * El trazado: un lienzo, las dos series y sus dos referencias.
 *
 * Se pintan en orden `premium` → `regular` para que la curva de abajo quede
 * encima si alguna vez se acercan. Con el faldón no llegan a tocarse —la brecha
 * ronda los 130 de 220—, así que el orden es una red de seguridad barata, no el
 * mecanismo que las separa.
 *
 * Las dos capas de selección nacen vacías y son lo ÚNICO que se reescribe al
 * elegir un día: el `<svg>`, su nombre accesible y el foco sobreviven.
 */
function pintarPlano(marco, uid, listaId) {
  const { points, days } = marco;
  const { series, scale, coords } = geometria(points, days);
  if (scale.empty) return '';

  const conDatos = series.filter((serie) => serie.ultimo);
  const orden = [...series].reverse();
  const resumen = `Precio promedio diario en Lima. ${conDatos.map((serie) => `${serie.label}: último S/ ${dosDecimales(serie.ultimo.mean)} del ${fecha(serie.ultimo.date, DIA_LARGO)} con ${serie.ultimo.n} estaciones${serie.promedio?.k >= 2 ? `, promedio de ${serie.promedio.k} días S/ ${dosDecimales(serie.promedio.mean)}` : ''}`).join('. ')}. Usa las flechas para recorrer los días.`;

  // El blanco táctil es el trazado entero: a catorce días cada ranura mide unos
  // veinte píxeles, y un rectángulo por punto quedaría muy por debajo de 44 px.
  return `<svg class="history__svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="group" tabindex="0" aria-label="${escapeHtml(resumen)}">`
    + `<defs>${orden.map((serie) => faldon(points, serie.key, coords, uid)).join('')}</defs>`
    + pintarEjes(points, scale, days, coords, series.filter((serie) => serie.promedio?.k >= 2).map((serie) => coords.y(serie.promedio.mean)))
    + '<g class="history__guia-capa"></g>'
    + orden.map((serie) => `<g data-serie="${serie.key}">`
      + pintarSerie(points, serie.key, coords, uid)
      + pintarPromedio(serie.promedio, coords)
      + pintarUltimo(serie.ultimo, serie.label, coords)
      + '</g>').join('')
    + '<g class="history__activo-capa"></g>'
    + '</svg>'
    + pintarLista(points, listaId);
}

/** Lo que se anuncia al elegir un día: solo esa fecha, los dos combustibles. */
function lectura(punto) {
  if (!punto) return '';
  if (!punto.observation) return `${fecha(punto.date, DIA_LARGO)}: no se registró precio ese día.`;
  const partes = PRODUCTOS.map((producto) => {
    const dato = punto[producto.key];
    return `${producto.label} ${dato ? `S/ ${dosDecimales(dato.mean)} con ${dato.n} estaciones` : 'sin dato'}`;
  });
  return `${fecha(punto.date, DIA_LARGO)}${punto.isToday ? ' (en curso)' : ''}: ${partes.join('; ')}.`;
}

/**
 * Monta el gráfico. Nunca rechaza.
 *
 * @param {object} entrada
 * @param {HTMLElement} entrada.mount   contenedor con `data-state`
 * @param {HTMLElement} entrada.body    donde se pintan selector y franjas
 * @returns {{focus: Function, destroy: Function}}
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
  if (!mount || !body) return { focus() {}, destroy() {} };
  const demo = new URLSearchParams(search).get('history-demo') === '1';
  let resumen = null;
  let estado = 'loading';
  const dias = DEFAULT_WINDOW;
  let seleccion = null;
  let nota = '';
  let hoy = limaDate(now());

  // Persistentes: no se repintan, así que el lector anuncia lo que la persona
  // eligió y no la gráfica entera.
  const aviso = document.createElement('p');
  aviso.className = 'history__nota';
  aviso.setAttribute('role', 'status');
  const lecturaNodo = document.createElement('p');
  lecturaNodo.className = 'history__lectura';
  lecturaNodo.setAttribute('role', 'status');
  mount.append(aviso, lecturaNodo);

  const guardar = (texto) => { try { storage?.setItem(GUARDADO, JSON.stringify({ savedAt: new Date(now()).toISOString(), body: texto })); } catch { /* modo privado o sin cuota: no es motivo para romper nada */ } };
  const recuperar = () => { try { return JSON.parse(storage?.getItem(GUARDADO) ?? 'null'); } catch { return null; } };

  /**
   * Mueve la selección escribiendo SOLO las dos capas de cada franja.
   *
   * Es lo que separa elegir un día de repintar el bloque: el `<svg>` que tiene
   * el foco no se toca, así que el lector de pantalla no vuelve a leer su
   * nombre ni el foco salta a un nodo recién creado. La geometría se recalcula
   * del marco, que es una función pura de catorce puntos.
   */
  function marcarSeleccion(marco) {
    const guia = body.querySelector('.history__guia-capa');
    const activo = body.querySelector('.history__activo-capa');
    if (guia && activo) {
      const { coords } = geometria(marco.points, marco.days);
      guia.innerHTML = pintarGuia(seleccion, coords);
      // Un marcador por producto, en el mismo día: la selección es una sola.
      activo.innerHTML = PRODUCTOS.map((producto) => pintarActivo(marco.points, producto.key, seleccion, coords)).join('');
    }
    lecturaNodo.textContent = seleccion === null ? '' : lectura(marco.points[seleccion]);
  }

  function render() {
    mount.dataset.state = estado;
    aviso.textContent = nota;
    aviso.hidden = !nota;
    if (estado === 'loading') { body.innerHTML = '<p class="history__cargando">Cargando el histórico…</p>'; return; }
    if (estado === 'error' || estado === 'empty') { body.innerHTML = ''; return; }

    const marco = frameWindow(resumen, { today: hoy, days: dias });
    const uid = `h${(secuencia += 1)}`;
    body.innerHTML = pintarLecturas(marco) + pintarPlano(marco, uid, `${uid}-dias`);
    marcarSeleccion(marco);
  }

  /** La selección es una sola y vale para las dos franjas: misma fecha, dos datos. */
  function elegir(indice) {
    if (!resumen || estado === 'loading' || estado === 'error' || estado === 'empty') return;
    seleccion = Math.max(0, Math.min(dias - 1, indice));
    marcarSeleccion(frameWindow(resumen, { today: hoy, days: dias }));
  }

  function aplicar(texto, { desdeCopia = false, savedAt = null } = {}) {
    const bytes = texto.length;
    if (bytes > HISTORY_MAX_BYTES) throw new Error('resumen desmesurado');
    const candidato = JSON.parse(texto);
    const problemas = validateDailySummary(candidato, { bytes });
    if (problemas.length) throw new Error(problemas[0]);
    resumen = candidato;
    // La antigüedad se mide contra la serie ENTERA que viajó, no contra la
    // ventana que se está mirando: son dos recortes distintos.
    const completo = frameWindow(resumen, { today: hoy, days: HISTORY_MAX_DAYS });
    const horas = staleHours(completo.lastObservedAt, now());
    if (!completo.daysWithObservation) { estado = 'empty'; nota = 'Todavía no hay días registrados en el histórico.'; return; }
    if (desdeCopia) { estado = 'saved'; nota = `Copia guardada${savedAt ? ` del ${fecha(limaDate(savedAt), DIA_LARGO)}` : ''}: puede no estar al día.`; return; }
    if (horas !== null && horas > STALE_HOURS) { estado = 'stale'; nota = `Última actualización: ${fecha(completo.lastObservedAt.slice(0, 10), DIA_LARGO)}.`; return; }
    estado = 'ready';
    nota = '';
  }

  async function cargar() {
    if (demo) {
      // La demostración no toca la red ni el almacenamiento: es evidentemente
      // una demostración y no debe dejar rastro que luego parezca un dato.
      resumen = demoSummary({ today: hoy });
      estado = 'demo';
      nota = 'Serie de demostración: no son precios reales.';
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

  const alApuntar = (event) => {
    const svg = event.target.closest('.history__svg');
    if (!svg) return;
    const caja = svg.getBoundingClientRect();
    if (!caja.width) return;
    const relativo = ((event.clientX - caja.left) / caja.width) * W;
    const paso = dias > 1 ? ANCHO / (dias - 1) : 0;
    elegir(paso ? Math.round((relativo - PAD.izquierda) / paso) : 0);
  };
  const alTeclear = (event) => {
    const svg = event.target.closest('.history__svg');
    if (!svg) return;
    const teclas = { ArrowLeft: -1, ArrowRight: 1, Home: 'inicio', End: 'fin' };
    const accion = teclas[event.key];
    if (accion === undefined) return;
    event.preventDefault();
    if (accion === 'inicio') elegir(0);
    else if (accion === 'fin') elegir(dias - 1);
    else elegir((seleccion === null ? dias - 1 : seleccion) + accion);
  };
  // Volver de segundo plano no pide nada a la red: solo vuelve a contar los días
  // contra el reloj. Si se cruzó la medianoche de Lima, el dato de ayer deja de
  // etiquetarse «Hoy» y el calendario se corre un día.
  const alVolver = () => {
    if (document.visibilityState !== 'visible') return;
    const ahora = limaDate(now());
    if (ahora === hoy) return;
    hoy = ahora;
    seleccion = null;
    render();
  };

  body.addEventListener('pointerdown', alApuntar);
  body.addEventListener('keydown', alTeclear);
  document.addEventListener('visibilitychange', alVolver);
  render();
  // Se lanza sin esperar: los precios y el GPS no dependen de esto.
  cargar().catch(() => { estado = 'error'; nota = 'No pudimos cargar el histórico.'; render(); });

  return {
    /** Lleva la vista y el foco al bloque: es lo que hace «Ver historial» y la ruta `/combustibles/gasolina/historial`. */
    focus() {
      mount.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      (body.querySelector('.history__svg') ?? mount.querySelector('#history-title') ?? mount).focus?.({ preventScroll: true });
    },
    destroy() {
      body.removeEventListener('pointerdown', alApuntar);
      body.removeEventListener('keydown', alTeclear);
      document.removeEventListener('visibilitychange', alVolver);
      aviso.remove();
      lecturaNodo.remove();
    },
  };
}
