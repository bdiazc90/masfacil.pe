// Las transiciones de la aplicación y lo que dicen sus controles, sin React: el
// reducer de `ui/app-state.js` y los textos de `ui/app-view.js`. Las carreras de
// carga y de GPS se prueban en el navegador; aquí, que cada gesto deje la búsqueda
// como la dejaba antes.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { PAGE_SIZE } from '../web/lib/haversine.js';
import { estadoInicial, transicion } from '../ui/app-state.js';
import { avisoUbicacion, estadoInicio, estadoVista, lecturaRadio, notaSinConexion, pildora, resumenControles } from '../ui/app-view.js';

const aplicar = (estado, ...acciones) => acciones.reduce(transicion, estado);
const ORIGEN = { latitude: -12.12, longitude: -77.01 };

test('cambiar de combustible conserva el contexto y recuerda el producto por vista', () => {
  let estado = aplicar(estadoInicial('gasolina'), { type: 'ubicado', origin: ORIGEN }, { type: 'radio', km: 3 }, { type: 'producto', product: 'premium' }, { type: 'verMas', count: 12 });
  estado = transicion(estado, { type: 'vista', view: 'diesel' });
  assert.deepEqual([estado.search.view, estado.search.origin, estado.search.radiusKm, estado.search.priceProduct, estado.search.visibleCount], ['diesel', ORIGEN, 3, 'diesel', PAGE_SIZE]);
  estado = transicion(estado, { type: 'vista', view: 'gasolina' });
  assert.equal(estado.search.priceProduct, 'premium', 'volver a Gasolina devuelve Premium a quien lo eligió');
  assert.equal(transicion(estado, { type: 'vista', view: 'gasolina' }), estado, 'la misma vista no cambia nada');
  assert.equal(transicion(estado, { type: 'vista', view: 'kerosene' }), estado, 'una vista que no existe no cambia nada');
});

test('el histórico se monta la primera vez que se entra a una vista que lo tiene y ya no se desmonta', () => {
  let estado = estadoInicial('diesel');
  assert.equal(estado.historyMounted, false);
  estado = aplicar(estado, { type: 'vista', view: 'gasolina' }, { type: 'vista', view: 'glp' });
  assert.equal(estado.historyMounted, true);
});

test('orden, producto y radio vuelven a la primera página; el orden y el radio pasan a ser preferencia', () => {
  const base = aplicar(estadoInicial('gasolina'), { type: 'verMas', count: 18 });
  assert.deepEqual([transicion(base, { type: 'orden', sort: 'price' }).search.sort, transicion(base, { type: 'orden', sort: 'price' }).search.preferencesTouched, transicion(base, { type: 'orden', sort: 'price' }).search.visibleCount], ['price', true, PAGE_SIZE]);
  assert.equal(transicion(base, { type: 'orden', sort: 'raro' }).search.sort, 'distance');
  assert.deepEqual([transicion(base, { type: 'producto', product: 'premium' }).search.preferencesTouched, transicion(base, { type: 'producto', product: 'premium' }).search.visibleCount], [false, PAGE_SIZE]);
  assert.deepEqual([transicion(base, { type: 'radio', km: 2.5 }).search.radiusKm, transicion(base, { type: 'radio', km: 2.5 }).search.preferencesTouched], [2.5, true]);
});

test('abrir resultados con GPS y sin preferencias abre el radio donde caben seis precios', () => {
  const cerca = (km) => ({ distance_km: km, has_price: true, prices: { regular: { price: 20 } } });
  const located = [0.3, 0.6, 0.9, 1.2, 1.4, 1.8, 2.6, 3.9].map(cerca);
  const abierto = aplicar(estadoInicial('gasolina'), { type: 'ubicado', origin: ORIGEN }, { type: 'resultados', located });
  assert.equal(abierto.screen, 'compare');
  assert.equal(abierto.search.radiusKm, 2);
  assert.deepEqual([abierto.placeStatus, abierto.locationUpdate], ['idle', { status: 'idle', message: '' }]);
  const elegido = aplicar(estadoInicial('gasolina'), { type: 'ubicado', origin: ORIGEN }, { type: 'radio', km: 4 }, { type: 'resultados', located });
  assert.equal(elegido.search.radiusKm, 4, 'un radio que la persona eligió no se recalcula');
});

test('elegir distrito suelta el GPS en vuelo; actualizar ubicación conserva radio y criterio', () => {
  let estado = aplicar(estadoInicial('gasolina'), { type: 'ubicado', origin: ORIGEN }, { type: 'actualizando' });
  assert.deepEqual([estado.updatingLocation, estado.placeStatus, avisoUbicacion(estado.locationUpdate).texto], [true, 'pending', 'Actualizando tu ubicación…']);
  estado = transicion(estado, { type: 'distritos', fromError: false });
  assert.deepEqual([estado.screen, estado.updatingLocation, estado.districtQuery, estado.districtHint], ['district', false, '', false]);
  // Abrir distritos no pinta resultados: el resumen del card sigue vacío hasta el primero.
  assert.equal(estado.resultsShown, false);
  assert.equal(aplicar(estado, { type: 'distrito', district: 'MIRAFLORES' }, { type: 'resultados', located: [] }, { type: 'distritos' }).resultsShown, true);
  estado = aplicar(estado, { type: 'distrito', district: 'MIRAFLORES' });
  assert.deepEqual([estado.search.origin, estado.search.district], [null, 'MIRAFLORES']);
  const actualizada = aplicar(estadoInicial('gasolina'), { type: 'ubicado', origin: ORIGEN }, { type: 'radio', km: 3 }, { type: 'orden', sort: 'price' }, { type: 'actualizada', origin: { latitude: -12.2, longitude: -77 }, message: 'listo' });
  assert.deepEqual([actualizada.search.radiusKm, actualizada.search.sort, actualizada.search.visibleCount, actualizada.placeStatus], [3, 'price', PAGE_SIZE, 'done']);
  assert.deepEqual(avisoUbicacion(transicion(actualizada, { type: 'actualizacionFallida' }).locationUpdate), { status: 'error', texto: 'No pudimos actualizar. Las distancias usan tu ubicación anterior.' });
});

test('la píldora nombra la acción: actualizar con GPS en resultados, ir a mi ubicación si no', () => {
  assert.deepEqual([pildora({ status: null, gps: false, screen: 'start' }).label, pildora({ status: null, gps: false, screen: 'start' }).status], ['Actualizar ubicación', null]);
  const gps = pildora({ status: 'idle', gps: true, screen: 'compare' });
  assert.deepEqual([gps.label, gps.compacta, gps.icono, gps.variante, gps.etiquetaCompacta], ['Actualizar ubicación', 'Actualizar', 'refresh', 'solid', 'on']);
  const distrito = pildora({ status: 'idle', gps: false, screen: 'compare' });
  assert.deepEqual([distrito.label, distrito.compacta, distrito.icono, distrito.etiquetaCompacta], ['Ver en mi ubicación', 'Mi ubicación', 'gps', 'off']);
  assert.equal(pildora({ status: 'idle', gps: false, screen: 'district' }).compacta, 'Ver en mi ubicación', 'en distritos cabe el nombre completo');
  const fallo = pildora({ status: 'error', gps: true, screen: 'compare' });
  assert.deepEqual([fallo.label, fallo.nombre], ['Reintentar', 'No pudimos actualizar. Las distancias usan tu ubicación anterior. Reintentar.']);
  assert.equal(pildora({ status: 'pending', gps: true, screen: 'compare' }).disabled, true);
});

test('el resumen, el radio y los estados dicen lo que pasa, no lo que ordenaría', () => {
  const search = { view: 'gasolina', origin: ORIGEN, district: null, radiusKm: 2.5, priceProduct: 'premium' };
  assert.deepEqual(resumenControles({ search, criterion: 'price' }), { fuel: 'Gasolina', place: '· 2.5 km', criteria: 'Premium más barata' });
  assert.equal(resumenControles({ search, criterion: 'none' }).criteria, 'Sin precios recientes');
  assert.equal(resumenControles({ search: { ...search, view: 'diesel', priceProduct: 'diesel', origin: null, district: 'SAN JUAN DE MIRAFLORES' }, criterion: 'price' }).place, '· San Juan de Miraflores');
  assert.equal(lecturaRadio({ inert: false, total: 1 }, 1.5), '1.5 km · 1 estación');
  assert.equal(lecturaRadio({ inert: true, total: 3 }, 1), 'Las mismas 3 estaciones en todo el radio');
  assert.equal(lecturaRadio({ inert: true, total: 0 }, 1), 'Ninguna estación en 5 km');
  assert.equal(estadoVista('district-empty', 'GLP').accion, 'Cambiar distrito');
  assert.match(estadoVista('error', 'GNV', { online: false }).texto, /No hay precios de GNV guardados todavía/);
  assert.equal(estadoVista('ready', 'Gasolina'), null);
  assert.deepEqual(estadoInicio('loading'), { texto: 'Cargando precios…', visible: false });
  assert.equal(estadoInicio('error', { vista: 'Diésel' }).visible, true);
  assert.equal(notaSinConexion({ mode: 'network', dataset: {} }), null);
  assert.match(notaSinConexion({ mode: 'saved', dataset: { cutoff_at: '2026-09-27T12:00:00Z' } }), /^Sin conexión · precios guardados del /);
});
