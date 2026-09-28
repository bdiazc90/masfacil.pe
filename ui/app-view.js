// Lo que dicen los controles y los avisos de la aplicación, calculado sin
// pintarlo: la píldora de ubicación, el resumen del card compacto, la lectura del
// radio y los estados de carga. Como `offer-view.js`, no importa React ni toca el
// DOM: las pruebas lo leen desde Node.

import { ACTIVE_VIEWS, PRODUCTS, VIEWS } from '../web/lib/catalog.js';
import { concordancia, formatRadius } from '../web/lib/decision-view.js';
import { RADIUS_MAX_KM } from '../web/lib/haversine.js';
import { withPrice } from '../web/lib/search.js';
import { displayDistrict } from './offer-view.js';

export const formatDate = (value) => new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(value));

// Actualizar ubicación no es el flujo inicial: aquel reinicia radio y orden y,
// si falla, borra el origen y manda a elegir distrito. Aquí se conserva todo.
export const AVISO_UBICACION = Object.freeze({
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

/**
 * La píldora de ubicación y su gemela de la barra compacta. `status` es `null`
 * hasta el primer resultado: entonces la píldora dice lo que siempre dijo al
 * arrancar y no lleva estado ni variante.
 */
export function pildora({ status, gps, screen }) {
  if (status === null) return { status: null, label: 'Actualizar ubicación', compacta: 'Actualizar', nombre: null, nombreCompacta: 'Actualizar ubicación', icono: 'refresh', variante: null, etiquetaCompacta: null, disabled: false };
  // En movimiento el dedo y la vista están en la píldora: el proceso y el fallo
  // se cuentan en el propio botón. Con GPS guardado pero fuera de resultados —en
  // la lista de distritos— no puede prometer «actualizar».
  const accion = gps ? ACCION_LUGAR.gps : ACCION_LUGAR.distrito;
  const pendiente = status === 'pending';
  const error = status === 'error';
  const label = pendiente ? 'Actualizando…' : error ? 'Reintentar' : accion.label;
  // En distritos la barra compacta lleva solo este botón: cabe el nombre completo.
  const soloEnLaBarra = screen === 'district';
  const nombre = error ? `${AVISO_UBICACION.error} Reintentar.` : label;
  return {
    status,
    label,
    compacta: pendiente ? 'Actualizando…' : error ? 'Reintentar' : (soloEnLaBarra ? accion.label : accion.corta),
    nombre,
    nombreCompacta: nombre,
    icono: accion.icono,
    variante: accion.variante,
    // La etiqueta corta solo estorba en la barra compacta de resultados con
    // distrito, donde el resumen ya carga el nombre del distrito y el criterio.
    etiquetaCompacta: gps || soloEnLaBarra ? 'on' : 'off',
    disabled: pendiente,
  };
}

/** El aviso de actualización de ubicación, o `null` antes del primer resultado. */
export function avisoUbicacion(locationUpdate) {
  if (!locationUpdate) return null;
  const texto = locationUpdate.message ?? AVISO_UBICACION[locationUpdate.status] ?? '';
  return { status: locationUpdate.status, texto };
}

/**
 * El resumen del card compacto: el lugar puede truncar; el criterio nunca. Sin
 * un solo precio vigente, anunciar un criterio de precio promete un orden que no
 * existe: el resumen dice lo que pasa.
 */
export function resumenControles({ search, criterion }) {
  const criterio = criterion === 'none' ? 'Sin precios recientes' : criterion === 'price' ? `${PRODUCTS[search.priceProduct].short} más barat${concordancia(search.priceProduct)}` : 'Más cerca';
  // Con más de una vista el resumen dice de qué combustible habla, en dos
  // renglones: arriba el combustible y dónde, abajo el criterio entero.
  if (ACTIVE_VIEWS.length > 1) return { fuel: VIEWS[search.view].label, place: `· ${search.origin ? formatRadius(search.radiusKm) : displayDistrict(search.district)}`, criteria: criterio };
  const partes = search.origin ? [formatRadius(search.radiusKm), criterio] : [criterio];
  // Con GPS el icono de la barra ya dice «mi ubicación»: repetirlo solo le robaba
  // ancho al criterio.
  return { fuel: null, place: search.origin ? '' : displayDistrict(search.district), criteria: search.origin ? partes.join(' · ') : `· ${partes.join(' · ')}` };
}

/**
 * Lo que dice el radio. Inerte significa que moverlo no cambia el conteo, no que
 * haya una sola estación: en Pucusana son tres en todo el rango.
 */
export function lecturaRadio({ inert, total }, radiusKm) {
  if (inert) return total === 0 ? `Ninguna estación en ${formatRadius(RADIUS_MAX_KM)}` : total === 1 ? `Única estación en ${formatRadius(RADIUS_MAX_KM)}` : `Las mismas ${total} estaciones en todo el radio`;
  return `${formatRadius(radiusKm)} · ${total} ${total === 1 ? 'estación' : 'estaciones'}`;
}

/**
 * El estado de la lista cuando no hay tarjetas por una razón de la vista: se
 * está cargando, falló o el distrito conservado no tiene grifos de este
 * combustible. Nunca se dejan a la vista precios de la anterior.
 */
export function estadoVista(estado, vista, { online = true } = {}) {
  if (estado === 'loading') return { texto: `Cargando precios de ${vista}…`, accion: null };
  if (estado === 'error') return { texto: online ? `No pudimos cargar los precios de ${vista}. Revisa tu conexión y reintenta.` : `No hay precios de ${vista} guardados todavía. Conéctate una vez para descargarlos.`, accion: 'Reintentar' };
  if (estado === 'district-empty') return { texto: `Ningún grifo de este distrito publica ${vista}.`, accion: 'Cambiar distrito' };
  return null;
}

/** El renglón de Inicio: cargando, el resumen de lo cargado o la falla. */
export function estadoInicio(fase, { rows = [], dataset = null, vista, online = true } = {}) {
  if (fase === 'error') return { texto: estadoVista('error', vista, { online }).texto, visible: true };
  if (fase === 'ready' && dataset) return { texto: `${withPrice(rows).length} de ${rows.length} grifos con precio vigente · corte ${formatDate(dataset.cutoff_at)}.`, visible: false };
  return { texto: 'Cargando precios…', visible: false };
}

/** El aviso de datos guardados, o `null` con datos de la red. */
export function notaSinConexion(entrada) {
  return entrada?.mode === 'saved' ? `Sin conexión · precios guardados del ${formatDate(entrada.dataset.cutoff_at)}.` : null;
}
