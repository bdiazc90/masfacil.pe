// La aplicación: coordina búsqueda, datos, ubicación, URL y pantallas.
//
// El estado se declara en `app-state.js` y lo que se muestra se calcula de él y de
// los datos, con las mismas reglas de `web/lib/`: nada se deduce de la pantalla.
// Los efectos son solo para lo que vive fuera —worker, atrás y adelante,
// segundo plano— y cada gesto hace su transición y sus efectos de URL en el mismo
// manejador: un render nunca escribe el historial del navegador, así que tampoco
// cuenta páginas vistas de más.
//
// La app NUNCA se localiza sola: un permiso concedido una vez no es una orden
// permanente. Localizar es siempre un gesto.

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ACTIVE_VIEWS, VIEWS } from '../web/lib/catalog.js';
import { formatRadius } from '../web/lib/decision-view.js';
import { withinRadius } from '../web/lib/haversine.js';
import { historyPath, resolvePath, viewPath } from '../web/lib/routes.js';
import { districtsFrom, evaluateRows, resultsView, withDistances } from '../web/lib/search.js';
import { estadoInicial, transicion } from './app-state.js';
import {
  avisoUbicacion,
  estadoInicio,
  estadoVista,
  lecturaRadio,
  notaSinConexion,
  pildora,
  resumenControles,
} from './app-view.js';
import { Controls } from './controls/Controls.jsx';
import { scrollToTop } from './controls/useControlsCard.js';
import { createLocator } from './geolocation.js';
import { enfocarHistorial } from './history/HistoryChart.jsx';
import { displayDistrict } from './offer-view.js';
import { readPreference, writePreference } from './preference.js';
import { CompareScreen } from './screens/CompareScreen.jsx';
import { DistrictScreen } from './screens/DistrictScreen.jsx';
import { LoadingScreen } from './screens/LoadingScreen.jsx';
import { StartScreen } from './screens/StartScreen.jsx';
import { useViewData } from './useViewData.js';

// La ruta del historial es la misma portada con el gráfico enfocado.
const enHistorial = () => resolvePath(location.pathname).history === true;
const enLinea = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
const filasAhora = (entrada) => (entrada ? evaluateRows(entrada.dataset, new Date()).rows : []);

/** El último valor conocido de algo que a ratos falta —mientras carga otra vista—. */
function useUltimo(valor) {
  const [ultimo, setUltimo] = useState(valor);
  if (valor != null && valor !== ultimo) setUltimo(valor);
  return valor ?? ultimo;
}

/**
 * @param {object} p
 * @param {string} p.view              vista inicial, ya resuelta de la ruta y la preferencia
 * @param {boolean} [p.history]        la ruta pedía el historial
 * @param {Promise|null} [p.trabajador] el worker listo; los datos esperan a que lo esté
 * @param {string|null} [p.temaInicial]
 * @param {boolean} [p.demoHistorial]
 */
export function App({
  view: vistaInicial,
  history: rutaHistorial = false,
  trabajador = null,
  temaInicial = null,
  demoHistorial = false,
}) {
  const [estado, despachar] = useReducer(transicion, vistaInicial, estadoInicial);
  const { search, screen } = estado;
  const [reloj, setReloj] = useState(() => Date.now());
  const [relojDistritos, setRelojDistritos] = useState(() => Date.now());

  // Lo vigente, para las continuaciones asíncronas: la respuesta de un GPS o de
  // una carga llega cuando el estado ya pudo cambiar.
  const vigente = useRef({ estado, entrada: null, refreshAt: Infinity });
  const localizador = useRef(null);
  const locator = () => (localizador.current ??= createLocator());

  // Foco y scroll después de pintar: el DOM queda para eso y para medir.
  const despues = useRef([]);
  useLayoutEffect(() => {
    const acciones = despues.current;
    despues.current = [];
    for (const accion of acciones) accion();
  });
  const luego = (accion) => {
    despues.current.push(accion);
  };

  // La vigencia se congela en el instante en que se calcula: se vuelve a mirar
  // cuando algo venció (`refreshAt`) o cuando se abre algo nuevo.
  const tocarReloj = (forzar) => {
    if (forzar || Date.now() >= vigente.current.refreshAt) setReloj(Date.now());
  };

  function aplicarDatos(entrada, { screen: pantalla, origin }) {
    tocarReloj(true);
    setRelojDistritos(Date.now());
    // En resultados se conservan origen o distrito, radio y orden elegidos, y se
    // vuelve a la primera página. Un radio que nadie eligió se recalcula con los
    // precios de esta vista.
    if (pantalla === 'compare') {
      despachar({ type: 'datosAplicados', located: origin ? withDistances(filasAhora(entrada), origin) : [] });
      luego(scrollToTop);
    }
  }

  const datos = useViewData({
    alListo: (vista, entrada) => {
      const actual = vigente.current.estado;
      if (vista !== actual.search.view) return;
      aplicarDatos(entrada, { screen: actual.screen, origin: actual.search.origin });
    },
    // Sin datos no hay distritos que elegir: se vuelve a Inicio, que tiene el
    // selector y el reintento.
    alError: () => {
      if (vigente.current.estado.screen === 'district') irA('start');
    },
  });
  const { entrada, fase } = datos.leer(search.view);

  const evaluacion = useMemo(() => (entrada ? evaluateRows(entrada.dataset, new Date(reloj)) : null), [entrada, reloj]);
  const rows = useMemo(() => evaluacion?.rows ?? [], [evaluacion]);
  const located = useMemo(() => (search.origin ? withDistances(rows, search.origin) : []), [rows, search.origin]);
  const vista = useMemo(
    () => (entrada ? resultsView({ rows, located, search }) : null),
    [entrada, rows, located, search],
  );
  // Los distritos se evalúan al abrir la lista, sin tocar las filas de los resultados.
  const distritos = useMemo(
    () => (entrada ? districtsFrom(evaluateRows(entrada.dataset, new Date(relojDistritos)).rows) : []),
    [entrada, relojDistritos],
  );

  useLayoutEffect(() => {
    vigente.current = { estado, entrada, refreshAt: evaluacion?.refreshAt ?? Infinity };
  });

  // --- Gestos -----------------------------------------------------------------

  // Salir de la portada devuelve la URL a la vista, sin añadir entradas.
  function salirDelHistorial(pantalla) {
    if (pantalla !== 'start' && enHistorial())
      history.replaceState(null, '', viewPath(vigente.current.estado.search.view));
  }
  function irA(pantalla) {
    salirDelHistorial(pantalla);
    despachar({ type: 'pantalla', screen: pantalla });
  }

  function abrirResultados(origin) {
    salirDelHistorial('compare');
    tocarReloj(true);
    despachar({
      type: 'resultados',
      located: origin ? withDistances(filasAhora(vigente.current.entrada), origin) : [],
    });
    luego(() => document.getElementById('compare-title')?.focus());
  }

  function abrirDistritos({ fromError = false } = {}) {
    if (!vigente.current.entrada) return;
    locator().cancel();
    salirDelHistorial('district');
    setRelojDistritos(Date.now());
    despachar({ type: 'distritos', fromError });
    // Una pantalla nueva empieza arriba, con el foco en su título.
    luego(() => {
      scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('district-title')?.focus();
    });
  }

  async function localizar() {
    if (!vigente.current.entrada) return;
    const gps = locator();
    if (!gps.available) {
      abrirDistritos({ fromError: true });
      return;
    }
    salirDelHistorial('loading');
    despachar({ type: 'localizando' });
    const respuesta = await gps.request();
    if (respuesta.status === 'stale') return;
    if (respuesta.status === 'error') {
      despachar({ type: 'sinUbicacion' });
      abrirDistritos({ fromError: true });
      return;
    }
    despachar({ type: 'ubicado', origin: respuesta.origin });
    // Si mientras se buscaba se cambió de combustible y la vista nueva todavía
    // carga, los resultados se abren desde Inicio cuando llegue.
    if (!vigente.current.entrada) {
      irA('start');
      return;
    }
    abrirResultados(respuesta.origin);
  }

  // Actualizar ubicación conserva radio, producto y criterio; si mientras tanto se
  // elige distrito, se vuelve al inicio o se reintenta, la respuesta se descarta.
  async function actualizarUbicacion() {
    const actual = vigente.current.estado;
    if (!actual.search.origin || actual.updatingLocation) return;
    const gps = locator();
    if (!gps.available) {
      despachar({ type: 'actualizacionFallida' });
      return;
    }
    despachar({ type: 'actualizando' });
    const respuesta = await gps.request();
    if (respuesta.status === 'stale') return;
    if (respuesta.status === 'error') {
      despachar({ type: 'actualizacionFallida' });
      return;
    }
    tocarReloj(true);
    const radio = vigente.current.estado.search.radiusKm;
    const total = withinRadius(withDistances(filasAhora(vigente.current.entrada), respuesta.origin), radio).length;
    despachar({
      type: 'actualizada',
      origin: respuesta.origin,
      message: `Ubicación actualizada · ${total} ${total === 1 ? 'estación' : 'estaciones'} en ${formatRadius(radio)}.`,
    });
  }

  // Un solo gesto con una sola promesa: con GPS en resultados, volver a medir;
  // si no, el flujo inicial completo.
  const accionLugar = () => {
    const actual = vigente.current.estado;
    if (actual.search.origin && actual.screen === 'compare') actualizarUbicacion();
    else localizar();
  };

  // Cambiar de combustible: la URL y la preferencia pasan a la vista nueva sin
  // añadir una entrada al historial, y todo lo demás se conserva.
  function cambiarVista(nueva, { fromHistory = false } = {}) {
    const actual = vigente.current.estado;
    if (!VIEWS[nueva] || !ACTIVE_VIEWS.includes(nueva) || nueva === actual.search.view) return;
    // Desde el historial se sigue en el historial solo si la vista nueva lo tiene.
    if (!fromHistory)
      history.replaceState(
        null,
        '',
        `${enHistorial() && VIEWS[nueva].history ? historyPath(nueva) : viewPath(nueva)}${location.search}${location.hash}`,
      );
    writePreference(nueva);
    despachar({ type: 'vista', view: nueva });
    // Con GPS, la posición espera a que cargue la vista: no se pide de nuevo.
    const guardada = datos.cargar(nueva);
    if (guardada) aplicarDatos(guardada, { screen: actual.screen, origin: actual.search.origin });
  }

  function recargar() {
    const guardada = datos.cargar(vigente.current.estado.search.view);
    if (guardada)
      aplicarDatos(guardada, { screen: vigente.current.estado.screen, origin: vigente.current.estado.search.origin });
  }

  // «Ver historial» no es otra pantalla: es la portada con el gráfico enfocado y
  // con URL propia, para enlazarla y volver con «atrás».
  function mostrarHistorial({ push = true, view: vistaDestino = vigente.current.estado.search.view } = {}) {
    if (!VIEWS[vistaDestino].history) return;
    locator().cancel();
    despachar({ type: 'inicio' });
    if (push && !enHistorial()) history.pushState(null, '', historyPath(vistaDestino));
    luego(enfocarHistorial);
  }

  // Cambiar un filtro estando abajo: el primer resultado es la respuesta, así que
  // la lista vuelve arriba y el card de controles regresa al flujo.
  const ordenar = (sort) => {
    tocarReloj(false);
    despachar({ type: 'orden', sort });
    luego(scrollToTop);
  };
  // El producto se recuerda aunque se vuelva a «Más cerca».
  const elegirProducto = (product) => {
    tocarReloj(false);
    despachar({ type: 'producto', product });
    luego(scrollToTop);
  };
  // Filtrado local sobre datos ya cargados: responde mientras se arrastra.
  const moverRadio = (km) => {
    tocarReloj(false);
    despachar({ type: 'radio', km });
  };
  const soltarRadio = useCallback(() => scrollToTop(), []);
  const verMas = () => {
    tocarReloj(false);
    despachar({ type: 'verMas', count: vista.nextCount });
  };
  const elegirDistrito = (district) => {
    despachar({ type: 'distrito', district });
    abrirResultados(null);
  };
  // Volver a los resultados los devuelve tal como estaban.
  const volver = () => {
    salirDelHistorial('compare');
    despachar({ type: 'volver' });
    luego(() => document.getElementById('compare-title')?.focus());
  };
  // Volver al inicio conserva radio y criterio; solo se suelta la posición en vuelo.
  const inicio = () => {
    locator().cancel();
    despachar({ type: 'inicio' });
    luego(() => document.getElementById('use-location')?.focus());
  };

  // --- Sistemas externos ------------------------------------------------------

  const gestos = useRef(null);
  useLayoutEffect(() => {
    gestos.current = { cambiarVista, mostrarHistorial, recargar };
  });

  // La primera carga espera a que el worker controle la página: así los datos
  // quedan guardados para abrir sin red. Montar dos veces no carga dos veces.
  useEffect(() => {
    let vigenteEfecto = true;
    Promise.resolve(trabajador)
      .catch(() => {})
      .then(() => {
        if (vigenteEfecto) gestos.current.recargar();
      });
    return () => {
      vigenteEfecto = false;
    };
  }, [trabajador]);

  // La ruta del historial llega con el gráfico enfocado.
  useEffect(() => {
    if (rutaHistorial) enfocarHistorial();
  }, [rutaHistorial]);

  // Atrás y adelante se resuelven con la misma tabla que la carga directa: si la
  // entrada es de otra vista, se cambia por el mismo camino que el selector, sin
  // volver a escribir el historial.
  useEffect(() => {
    const alNavegar = () => {
      const ruta = resolvePath(location.pathname, { preference: readPreference() });
      if (ruta.kind !== 'view') return;
      if (ruta.view !== vigente.current.estado.search.view)
        gestos.current.cambiarVista(ruta.view, { fromHistory: true });
      if (ruta.history) gestos.current.mostrarHistorial({ push: false, view: ruta.view });
    };
    addEventListener('popstate', alNavegar);
    return () => removeEventListener('popstate', alNavegar);
  }, []);

  // Volver a la app tras un rato no dispara ningún gesto: sin esto, un precio que
  // venció mientras estaba en segundo plano seguiría en pantalla.
  useEffect(() => {
    const alVolver = () => {
      if (
        document.visibilityState === 'visible' &&
        vigente.current.entrada &&
        vigente.current.estado.screen === 'compare'
      )
        tocarReloj(false);
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, []);

  // `<main>` es el contenedor de React: su `aria-busy` se escribe desde fuera.
  useEffect(() => {
    document.getElementById('main')?.setAttribute('aria-busy', String(screen === 'loading'));
  }, [screen]);

  // --- Lo que se pinta ---------------------------------------------------------

  const conResultados = estado.resultsShown;
  const { products, priceUnit, label: etiquetaVista } = VIEWS[search.view];
  const lista = fase === 'ready' ? vista : null;
  const criterio = useUltimo(lista?.criterion ?? null);
  const radioInfo = useUltimo(lista?.radius ?? null);
  const procedencia = useUltimo(entrada?.dataset.provenance ?? null);
  const estadoLista = fase === 'ready' ? (lista?.districtEmpty ? 'district-empty' : 'ready') : fase;

  return (
    <>
      <Controls
        screen={screen}
        search={search}
        temaInicial={temaInicial}
        lugar={{
          nombre: search.origin || !search.district ? 'Mi ubicación' : displayDistrict(search.district),
          gps: Boolean(search.origin) || !search.district,
        }}
        pildora={pildora({ status: estado.placeStatus, gps: Boolean(search.origin) && screen === 'compare', screen })}
        resumen={conResultados && criterio ? resumenControles({ search, criterion: criterio }) : null}
        radio={
          conResultados && search.origin && radioInfo
            ? { inert: radioInfo.inert, readout: lecturaRadio(radioInfo, search.radiusKm) }
            : null
        }
        orden={
          lista ? { sortToggle: lista.sortToggle, productToggle: lista.productToggle, byPrice: lista.byPrice } : null
        }
        onPlaceAction={accionLugar}
        onView={(nueva) => cambiarVista(nueva)}
        onSort={ordenar}
        onProduct={elegirProducto}
        onRadius={moverRadio}
        onRadiusCommit={soltarRadio}
        onDistricts={() => abrirDistritos()}
        onBack={volver}
        onHistory={() => mostrarHistorial()}
        onHome={inicio}
      />
      <StartScreen
        hidden={screen !== 'start'}
        view={search.view}
        listo={fase === 'ready'}
        estado={estadoInicio(fase, { rows, dataset: entrada?.dataset, vista: etiquetaVista, online: enLinea() })}
        historial={{ visible: Boolean(VIEWS[search.view].history), activo: estado.historyMounted, demo: demoHistorial }}
        onView={(nueva) => cambiarVista(nueva)}
        onLocate={localizar}
        onDistricts={() => abrirDistritos()}
        onRetry={recargar}
      />
      <LoadingScreen hidden={screen !== 'loading'} onDistricts={() => abrirDistritos()} />
      <DistrictScreen
        hidden={screen !== 'district'}
        districts={distritos}
        query={estado.districtQuery}
        hint={estado.districtHint}
        onQuery={(query) => despachar({ type: 'buscar', query })}
        onPick={elegirDistrito}
      />
      <CompareScreen
        hidden={screen !== 'compare'}
        nota={conResultados ? notaSinConexion(entrada) : null}
        aviso={avisoUbicacion(estado.locationUpdate)}
        estadoVista={
          conResultados
            ? { estado: estadoLista, contenido: estadoVista(estadoLista, etiquetaVista, { online: enLinea() }) }
            : { estado: undefined, contenido: null }
        }
        resultados={
          conResultados && lista
            ? {
                view: lista,
                viewKey: search.view,
                products,
                priceUnit,
                withDistance: Boolean(search.origin),
                attribution: entrada.dataset.provenance.attribution,
                sourceUrl: entrada.dataset.provenance.source_url,
                onLoadMore: verMas,
              }
            : {}
        }
        provenance={procedencia}
        onViewStateAction={() => {
          if (estadoLista === 'district-empty') abrirDistritos();
          else recargar();
        }}
      />
    </>
  );
}
