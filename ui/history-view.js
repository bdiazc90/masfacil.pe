// El pulso de precios, calculado sin pintarlo: la geometría del plano, las
// etiquetas de los ejes, las lecturas grandes y los textos accesibles. El SVG lo
// pone en su sitio `ui/history/HistoryChart.jsx`.
//
// Los dos combustibles comparten trazado, calendario y una sola escala en soles
// reales: la brecha entre Regular y Premium se lee tal cual. El COLOR dice el
// producto y el TRAZO dice la función: continuo lo observado, discontinuo el
// promedio del periodo. Aquí no se interpreta: fechas, producto, unidad,
// promedio y estados de datos son etiquetas informativas.

import { HISTORY_MAX_BYTES, HISTORY_MAX_DAYS, HISTORY_PRODUCTS, limaDate, validateDailySummary } from '../web/lib/history-contract.js';
import { STALE_HOURS, areaPath, frameWindow, lastPoint, monotonePath, periodAverage, planeScale, segments, staleHours } from '../web/lib/history-series.js';
import { PRODUCTS } from '../web/lib/catalog.js';

const DIA_CORTO = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DIA_SEMANA = new Intl.DateTimeFormat('es-PE', { weekday: 'short', timeZone: 'UTC' });
const DIA_NUMERO = new Intl.DateTimeFormat('es-PE', { day: 'numeric', timeZone: 'UTC' });
const DIA_LARGO = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

// Los productos son los del contrato del resumen, que es independiente del de
// precios; solo el nombre que se pinta sale del catálogo.
export const PRODUCTOS = Object.freeze(HISTORY_PRODUCTS.map((key) => ({ key, label: PRODUCTS[key]?.short ?? key })));

// Lienzo único, con `viewBox`: escala a cualquier ancho sin recalcular nada y sin
// desbordar a 320 px. El margen izquierdo deja sitio a las cifras del eje —bajo
// 340 px «22.80» ocupa unas 44 unidades— y el inferior a las fechas.
export const W = 320;
const TRAZADO = 220;
const PAD = Object.freeze({ arriba: 12, derecha: 10, abajo: 40, izquierda: 50 });
export const H = PAD.arriba + TRAZADO + PAD.abajo;
const ANCHO = W - PAD.izquierda - PAD.derecha;
const BASE = PAD.arriba + TRAZADO;
// Alto del faldón de relleno: el degradado se ancla al techo de su propia curva y
// muere aquí, así el relleno de una serie no tiñe el territorio de la otra.
const FALDON = 56;

const numero = (valor) => (Number.isFinite(valor) ? Number(valor.toFixed(2)) : 0);
export const fecha = (date, formato = DIA_CORTO) => formato.format(new Date(`${date}T12:00:00Z`));
export const fechaLarga = (date) => fecha(date, DIA_LARGO);
export const dosDecimales = (valor) => valor.toFixed(2);

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
 * Una fecha del eje. Con siete días va en dos renglones —día de semana arriba y
 * número abajo— y bajo 340 px el CSS esconde una de cada dos contando desde hoy,
 * que es la que nunca se va (`alterna`).
 */
function etiquetaX(punto, days, x) {
  const ancla = punto.index === 0 ? 'start' : punto.index === days - 1 ? 'end' : 'middle';
  const arriba = punto.isToday ? 'Hoy' : fecha(punto.date, days <= 7 ? DIA_SEMANA : DIA_CORTO);
  if (days > 7) return { key: punto.date, x, ancla, arriba: { y: H - 22, texto: arriba }, abajo: null, alterna: false };
  return { key: punto.date, x, ancla, arriba: { y: H - 24, texto: arriba }, abajo: { y: H - 8, texto: fecha(punto.date, DIA_NUMERO) }, alterna: (days - 1 - punto.index) % 2 === 1 };
}

/**
 * La geometría del plano, recalculada del marco. Pura y barata: una sola escala,
 * unas solas coordenadas, y lo que cada serie aporta.
 */
export function geometria(points, days) {
  const series = PRODUCTOS.map((producto) => ({ ...producto, ultimo: lastPoint(points, producto.key), promedio: periodAverage(points, producto.key) }));
  const scale = planeScale(points, series.map(({ key, promedio }) => ({ key, average: promedio?.k >= 2 ? promedio.mean : null })));
  return { series, scale, coords: coordenadas(scale, days) };
}

/**
 * El plano entero como datos: gradientes, marcas de los ejes y, por serie,
 * relleno, curvas, promedio y último punto. `null` si no hay escala.
 *
 * Las series van en orden `premium` → `regular` para que la de abajo quede
 * encima si alguna vez se acercan.
 */
export function plano(marco) {
  const { points, days } = marco;
  const { series, scale, coords } = geometria(points, days);
  if (scale.empty) return null;
  const alturasPromedio = series.filter((serie) => serie.promedio?.k >= 2).map((serie) => coords.y(serie.promedio.mean));
  const orden = [...series].reverse();
  const conDatos = series.filter((serie) => serie.ultimo);
  return {
    ariaLabel: `Precio promedio diario en Lima. ${conDatos.map((serie) => `${serie.label}: último S/ ${dosDecimales(serie.ultimo.mean)} del ${fecha(serie.ultimo.date, DIA_LARGO)} con ${serie.ultimo.n} estaciones${serie.promedio?.k >= 2 ? `, promedio de ${serie.promedio.k} días S/ ${dosDecimales(serie.promedio.mean)}` : ''}`).join('. ')}. Usa las flechas para recorrer los días.`,
    // El gradiente del faldón de cada serie, desde su punto más alto hasta
    // `FALDON` más abajo, con tres paradas para que no se le vea el corte.
    gradientes: orden.map((serie) => {
      const alturas = points.map((punto) => punto[serie.key]?.mean).filter(Number.isFinite).map(coords.y);
      if (!alturas.length) return null;
      const techo = Math.min(...alturas);
      return { key: serie.key, y1: numero(techo), y2: numero(techo + FALDON) };
    }).filter(Boolean),
    // La cifra de una marca que cae encima de una referencia se calla: dos
    // números pegados a la misma altura no se leen.
    ticks: scale.ticks.map((valor) => {
      const altura = coords.y(valor);
      const choca = alturasPromedio.some((suya) => Math.abs(altura - suya) < 7);
      return { key: valor, x1: PAD.izquierda, x2: W - PAD.derecha, y: altura, texto: choca ? null : { x: PAD.izquierda - 6, y: numero(altura + 4), valor: dosDecimales(valor) } };
    }),
    fechas: marcasX(points, days).map((punto) => etiquetaX(punto, days, coords.x(punto.index))),
    series: orden.map((serie) => {
      // Un hueco corta la línea y el área; un tramo de un solo día es un punto y
      // no arrastra relleno.
      const tramos = segments(points, serie.key);
      const promedio = serie.promedio?.k >= 2 ? (() => {
        const y = coords.y(serie.promedio.mean);
        return { y, x1: PAD.izquierda, x2: W - PAD.derecha, texto: { x: PAD.izquierda + 2, y: numero(y > PAD.arriba + 22 ? y - 6 : y + 14), valor: `Prom. ${dosDecimales(serie.promedio.mean)}` } };
      })() : null;
      // La etiqueta del último punto va sobre él, anclada a la derecha, al extremo
      // opuesto de la cifra del promedio.
      const ultimo = serie.ultimo ? (() => {
        const x = coords.x(serie.ultimo.index);
        const y = coords.y(serie.ultimo.mean);
        return { cx: x, cy: y, nombre: { x: numero(x + 2), y: numero(y > PAD.arriba + 20 ? y - 11 : y + 20), texto: serie.label.toLocaleUpperCase('es-PE') } };
      })() : null;
      return {
        key: serie.key,
        areas: tramos.filter((tramo) => tramo.length > 1).map((tramo) => areaPath(tramo, coords.x, coords.y, BASE)),
        lineas: tramos.map((tramo) => (tramo.length > 1 ? { d: monotonePath(tramo, coords.x, coords.y) } : { cx: coords.x(tramo[0].index), cy: coords.y(tramo[0].mean) })),
        promedio,
        ultimo,
      };
    }),
  };
}

/** Guía y marcadores del día elegido: una sola selección, un marcador por producto. */
export function seleccionVista(marco, seleccion) {
  if (seleccion === null) return { guia: null, activos: [] };
  const { coords } = geometria(marco.points, marco.days);
  const x = coords.x(seleccion);
  return {
    guia: { x, y1: PAD.arriba, y2: BASE },
    activos: PRODUCTOS.map((producto) => {
      const dato = marco.points[seleccion]?.[producto.key];
      return dato ? { key: producto.key, cx: x, cy: coords.y(dato.mean) } : null;
    }).filter(Boolean),
  };
}

/** El índice del día bajo el puntero, dado su x relativo al lienzo. */
export function diaEnX(relativo, days) {
  const paso = days > 1 ? ANCHO / (days - 1) : 0;
  return paso ? Math.round((relativo - PAD.izquierda) / paso) : 0;
}

/** Las dos lecturas grandes, una por combustible: la cifra, la fecha y la población. */
export function lecturas(marco) {
  return PRODUCTOS.map((producto) => {
    const ultimo = lastPoint(marco.points, producto.key);
    return { key: producto.key, label: producto.label, valor: ultimo ? dosDecimales(ultimo.mean) : null, fecha: ultimo ? fecha(ultimo.date) : null, datetime: ultimo ? (ultimo.observedAt ?? ultimo.date) : null, n: ultimo?.n ?? null };
  });
}

/**
 * Lectura accesible de la franja: un día por elemento, sin parada de teclado.
 * Región hermana con nombre propio, no `aria-describedby` del gráfico: colgada
 * del foco, el lector recitaría los catorce días cada vez que se entra.
 */
export function listaDias(points) {
  return points.map((punto) => {
    const dia = `${fecha(punto.date, DIA_LARGO)}${punto.isToday ? ' (hoy, en curso)' : ''}`;
    const partes = PRODUCTOS.map((producto) => {
      const dato = punto[producto.key];
      return `${producto.label} ${dato ? `S/ ${dosDecimales(dato.mean)} con ${dato.n} estaciones` : 'sin dato'}`;
    });
    return `${dia}: ${partes.join('; ')}.`;
  });
}

/** Lo que se anuncia al elegir un día: solo esa fecha, los dos combustibles. */
export function lectura(punto) {
  if (!punto) return '';
  if (!punto.observation) return `${fecha(punto.date, DIA_LARGO)}: no se registró precio ese día.`;
  const partes = PRODUCTOS.map((producto) => {
    const dato = punto[producto.key];
    return `${producto.label} ${dato ? `S/ ${dosDecimales(dato.mean)} con ${dato.n} estaciones` : 'sin dato'}`;
  });
  return `${fecha(punto.date, DIA_LARGO)}${punto.isToday ? ' (en curso)' : ''}: ${partes.join('; ')}.`;
}

/**
 * Valida un resumen y dice en qué estado deja el bloque. Lanza si no vale.
 *
 * La antigüedad se mide contra la serie ENTERA que viajó, no contra la ventana
 * que se está mirando: son dos recortes distintos.
 */
export function evaluarResumen(texto, { hoy, now, desdeCopia = false, savedAt = null }) {
  const bytes = texto.length;
  if (bytes > HISTORY_MAX_BYTES) throw new Error('resumen desmesurado');
  const resumen = JSON.parse(texto);
  const problemas = validateDailySummary(resumen, { bytes });
  if (problemas.length) throw new Error(problemas[0]);
  const completo = frameWindow(resumen, { today: hoy, days: HISTORY_MAX_DAYS });
  if (!completo.daysWithObservation) return { resumen, estado: 'empty', nota: 'Todavía no hay días registrados en el histórico.' };
  if (desdeCopia) return { resumen, estado: 'saved', nota: `Copia guardada${savedAt ? ` del ${fecha(limaDate(savedAt), DIA_LARGO)}` : ''}: puede no estar al día.` };
  const horas = staleHours(completo.lastObservedAt, now);
  if (horas !== null && horas > STALE_HOURS) return { resumen, estado: 'stale', nota: `Última actualización: ${fecha(completo.lastObservedAt.slice(0, 10), DIA_LARGO)}.` };
  return { resumen, estado: 'ready', nota: '' };
}
