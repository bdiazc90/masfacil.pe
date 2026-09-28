// El estado de la aplicación y sus transiciones, sin React ni DOM.
//
// `search` es lo que la persona eligió y lo único que necesitan las reglas de
// `web/lib/search.js`; lo demás es de esta presentación: en qué pantalla está, qué
// dice la píldora de ubicación, el aviso de actualización y el buscador de
// distritos. Lo que se muestra —filas, distancias, lista— no se guarda aquí: se
// calcula de los datos y de `search`, así que no hay copias que puedan
// contradecirse.
//
// Cada transición es la de antes, sin cambios: cambiar de combustible conserva
// GPS o distrito y el radio elegido, el producto que ordena se recuerda por
// vista, volver al inicio o elegir distrito sueltan la ubicación en vuelo.

import { VIEWS } from '../web/lib/catalog.js';
import { PAGE_SIZE } from '../web/lib/haversine.js';
import { createSearch, startResults } from '../web/lib/search.js';

export function estadoInicial(view) {
  return {
    screen: 'start',
    search: createSearch(view),
    // El producto que ordena, recordado por vista: volver a Gasolina devuelve
    // Premium a quien lo había elegido.
    ordenPorVista: {},
    updatingLocation: false,
    // `null` hasta abrir distritos o resultados: la píldora conserva su marcado de arranque.
    placeStatus: null,
    // El resumen, el radio y la lista existen desde el primer resultado y no se
    // borran después; antes, abrir distritos no tiene nada que resumir.
    resultsShown: false,
    locationUpdate: null,
    districtHint: false,
    districtQuery: '',
    // El histórico se monta la primera vez que se entra a una vista que lo tiene
    // y ya no se desmonta: volver a Gasolina no lo pide otra vez.
    historyMounted: Boolean(VIEWS[view]?.history),
  };
}

const conBusqueda = (estado, cambios) => ({ ...estado, search: { ...estado.search, ...cambios } });

export function transicion(estado, accion) {
  switch (accion.type) {
    case 'vista': {
      if (!VIEWS[accion.view] || accion.view === estado.search.view) return estado;
      const ordenPorVista = { ...estado.ordenPorVista, [estado.search.view]: estado.search.priceProduct };
      const recordado = ordenPorVista[accion.view];
      const productos = VIEWS[accion.view].products;
      return {
        ...conBusqueda(estado, { view: accion.view, priceProduct: productos.includes(recordado) ? recordado : productos[0], visibleCount: PAGE_SIZE }),
        ordenPorVista,
        historyMounted: estado.historyMounted || Boolean(VIEWS[accion.view].history),
      };
    }
    // Cambiar un filtro vuelve a la primera página; el radio y el criterio,
    // además, pasan a ser preferencia de la persona.
    case 'orden': return conBusqueda(estado, { sort: accion.sort === 'price' ? 'price' : 'distance', preferencesTouched: true, visibleCount: PAGE_SIZE });
    case 'producto': return conBusqueda(estado, { priceProduct: accion.product, visibleCount: PAGE_SIZE });
    case 'radio': return conBusqueda(estado, { radiusKm: accion.km, preferencesTouched: true, visibleCount: PAGE_SIZE });
    case 'verMas': return conBusqueda(estado, { visibleCount: accion.count });
    case 'pantalla': return { ...estado, screen: accion.screen };
    // Elegir distrito descarta cualquier ubicación en vuelo; el buscador empieza vacío.
    case 'distritos': return { ...estado, screen: 'district', updatingLocation: false, placeStatus: 'idle', districtHint: Boolean(accion.fromError), districtQuery: '' };
    case 'buscar': return { ...estado, districtQuery: accion.query };
    case 'distrito': return conBusqueda(estado, { origin: null, district: accion.district });
    case 'localizando': return { ...estado, screen: 'loading' };
    case 'ubicado': return conBusqueda(estado, { origin: accion.origin, district: null });
    case 'sinUbicacion': return conBusqueda(estado, { origin: null });
    // Abrir resultados: la lista vuelve a su primera página y, con GPS y sin
    // preferencia de la persona, el radio se abre donde caben seis precios.
    case 'resultados': return { ...estado, screen: 'compare', resultsShown: true, updatingLocation: false, placeStatus: 'idle', locationUpdate: { status: 'idle', message: '' }, search: startResults(estado.search, accion.located) };
    // Los datos de la vista llegaron estando en resultados: misma regla.
    case 'datosAplicados': return { ...estado, search: startResults(estado.search, accion.located) };
    // Actualizar ubicación conserva radio, producto y criterio; un fallo deja
    // intacta la posición anterior.
    case 'actualizando': return { ...estado, updatingLocation: true, placeStatus: 'pending', locationUpdate: { status: 'pending', message: null } };
    case 'actualizada': return { ...conBusqueda(estado, { origin: accion.origin, visibleCount: PAGE_SIZE }), updatingLocation: false, placeStatus: 'done', locationUpdate: { status: 'done', message: accion.message } };
    case 'actualizacionFallida': return { ...estado, updatingLocation: false, placeStatus: 'error', locationUpdate: { status: 'error', message: null } };
    // Volver al inicio conserva radio y criterio: son preferencias, no
    // consecuencias del origen.
    case 'inicio': return { ...estado, screen: 'start', updatingLocation: false };
    // Volver a los resultados los devuelve tal como estaban.
    case 'volver': return { ...estado, screen: 'compare', placeStatus: 'idle' };
    default: throw new Error(`Transición desconocida: ${accion.type}`);
  }
}
