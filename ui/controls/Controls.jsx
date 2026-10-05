// La cabecera: el card de controles con su barra compacta, la marca y el tema,
// el lugar con su píldora y su menú, el combustible, el radio y los dos
// ordenamientos. Pinta lo que decide el estado de la aplicación y devuelve cada
// gesto como una acción; lo único suyo es si el card está lleno, compacto o
// desplegado encima, y si el menú de puntos está abierto.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ACTIVE_VIEWS, VIEWS } from '../../web/lib/catalog.js';
import { RADIUS_MAX_KM, RADIUS_MIN_KM } from '../../web/lib/haversine.js';
import { ThemeToggle } from './ThemeToggle.jsx';
import { useControlsCard } from './useControlsCard.js';

const LOGO = { src: '/icons/logo.svg', alt: '', width: 28, height: 29 };
const IconoLugar = ({ tipo, className, hidden }) =>
  tipo === 'refresh' ? (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" hidden={hidden}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.49-6.01" />
      <path d="M20.5 4v4.8h-4.8" />
    </svg>
  ) : (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" hidden={hidden}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
      <path d="M12 1.5V4M12 20v2.5M1.5 12H4M20 12h2.5" />
    </svg>
  );
const Chevron = ({ d }) => (
  <svg className="controls__chevron" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Los botones de combustible, desde el catálogo. Solo existen si hay más de una vista. */
export function ViewButtons({ view, onView }) {
  return ACTIVE_VIEWS.map((key) => (
    <button key={key} type="button" aria-pressed={key === view} onClick={() => onView(key)}>
      {VIEWS[key].label}
    </button>
  ));
}

/**
 * Menú de puntos: disclosure simple, sin `role="menu"`, para que Tab recorra los
 * ítems sin gestión de foco propia. `Escape` cierra primero el menú y solo el
 * segundo llega al card, que es quien lo colapsa.
 */
function PlaceMenu({ screen, backHidden, historyHidden, onDistricts, onBack, onHistory, onHome }) {
  const [abierto, setAbierto] = useState(false);
  const [pantalla, setPantalla] = useState(screen);
  // Cambiar de pantalla cierra el menú: no puede quedar abierto y sin dueño.
  if (pantalla !== screen) {
    setPantalla(screen);
    if (abierto) setAbierto(false);
  }
  const boton = useRef(null);
  const menu = useRef(null);
  const foco = useRef(null);

  const cerrar = ({ devolverFoco = false } = {}) => {
    foco.current = devolverFoco ? 'boton' : null;
    setAbierto(false);
  };
  useLayoutEffect(() => {
    if (foco.current === 'boton') boton.current?.focus();
    if (foco.current === 'menu') menu.current?.querySelector('button:not(:disabled)')?.focus();
    foco.current = null;
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return undefined;
    // `stopImmediatePropagation` y no `stopPropagation`: con destino la propia
    // ventana, los dos listeners corren en la misma fase y el card colapsaría con
    // el mismo Escape que solo debía cerrar el menú.
    const alTeclear = (event) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        cerrar({ devolverFoco: true });
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...menu.current.querySelectorAll('button:not(:disabled)')];
      const paso = event.key === 'ArrowDown' ? 1 : items.length - 1;
      event.preventDefault();
      items[(items.indexOf(document.activeElement) + paso + items.length) % items.length]?.focus();
    };
    const alTocar = (event) => {
      if (!menu.current.contains(event.target) && !boton.current.contains(event.target)) cerrar();
    };
    // Al colapsarse el card por scroll el panel se esconde: el menú se cierra con él.
    const alDesplazar = () => cerrar();
    addEventListener('keydown', alTeclear, true);
    addEventListener('pointerdown', alTocar);
    addEventListener('scroll', alDesplazar, { passive: true });
    return () => {
      removeEventListener('keydown', alTeclear, true);
      removeEventListener('pointerdown', alTocar);
      removeEventListener('scroll', alDesplazar);
    };
  }, [abierto]);

  const item = (accion) => () => {
    cerrar();
    accion();
  };
  return (
    <>
      <button
        ref={boton}
        id="place-more"
        className="place__more"
        type="button"
        aria-expanded={abierto}
        aria-controls="place-menu"
        aria-label="Más opciones"
        title="Más opciones"
        onClick={() => {
          if (abierto) cerrar({ devolverFoco: true });
          else {
            foco.current = 'menu';
            setAbierto(true);
          }
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <div ref={menu} id="place-menu" className="place__menu" hidden={!abierto}>
        <button
          id="menu-districts"
          className="place__menu-item"
          data-menu-screen="compare"
          type="button"
          onClick={item(onDistricts)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
          Ver distritos
        </button>
        <button
          id="menu-back-results"
          className="place__menu-item"
          data-menu-screen="district"
          type="button"
          hidden={backHidden}
          onClick={item(onBack)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 12H4M10 6l-6 6 6 6" />
          </svg>
          Volver a los resultados
        </button>
        <button
          id="menu-history"
          className="place__menu-item"
          type="button"
          hidden={historyHidden}
          onClick={item(onHistory)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.3V12l3.2 1.9" />
          </svg>
          Ver historial
        </button>
        <button id="menu-home" className="place__menu-item place__menu-item--home" type="button" onClick={item(onHome)}>
          <img className="brand__logo" src={LOGO.src} alt="" width="20" height="21" />
          Volver al inicio
        </button>
      </div>
    </>
  );
}

/**
 * @param {object} p
 * @param {'start'|'loading'|'district'|'compare'} p.screen
 * @param {object} p.search                  la búsqueda vigente
 * @param {object} p.lugar                   `{ nombre, gps }` del encabezado
 * @param {object} p.pildora                 lo que dice la píldora (`app-view.js`)
 * @param {object|null} p.resumen            lo que dice la barra compacta
 * @param {object|null} p.radio              `{ inert, readout }` o `null` si no hay radio
 * @param {object|null} p.orden              `{ sortToggle, productToggle, byPrice }` de la vista
 */
export function Controls({
  screen,
  search,
  lugar,
  pildora,
  resumen,
  radio,
  orden,
  temaInicial,
  onPlaceAction,
  onView,
  onSort,
  onProduct,
  onRadius,
  onRadiusCommit,
  onDistricts,
  onBack,
  onHistory,
  onHome,
}) {
  const card = useControlsCard({ activo: screen === 'compare' || screen === 'district' });
  const { refs } = card;
  const radioInput = useRef(null);
  const varias = ACTIVE_VIEWS.length > 1;
  const pantalla = screen === 'compare' || screen === 'district' ? screen : 'other';

  // Al soltar el radio la lista vuelve arriba: es el `change` nativo, que React
  // no distingue del `input` que filtra mientras se arrastra.
  useEffect(() => {
    const input = radioInput.current;
    const alSoltar = () => onRadiusCommit();
    input.addEventListener('change', alSoltar);
    return () => input.removeEventListener('change', alSoltar);
  }, [onRadiusCommit]);

  return (
    <>
      <div ref={refs.colapso} className="controls-sentinel controls-sentinel--collapse" aria-hidden="true"></div>
      <div ref={refs.expansion} className="controls-sentinel controls-sentinel--expand" aria-hidden="true"></div>
      <div ref={refs.slot} className="controls-slot" id="controls-slot">
        <section
          ref={refs.card}
          className="controls plate"
          id="controls"
          data-state={card.estado}
          data-screen={pantalla}
          aria-label="Controles de búsqueda"
        >
          <div className="controls__bar">
            <button
              className="controls__quick"
              id="refresh-location-compact"
              type="button"
              aria-label={pildora.nombreCompacta}
              title={pildora.nombreCompacta}
              data-status={pildora.status ?? undefined}
              data-compact-label={pildora.etiquetaCompacta ?? undefined}
              disabled={pildora.disabled}
              onClick={onPlaceAction}
            >
              <IconoLugar tipo="refresh" className="controls__quick-icon" hidden={pildora.icono !== 'refresh'} />
              <IconoLugar tipo="gps" className="controls__quick-icon" hidden={pildora.icono !== 'gps'} />
              <span className="controls__quick-label" id="refresh-location-compact-label">
                {pildora.compacta}
              </span>
            </button>
            <button
              ref={refs.summary}
              className="controls__summary"
              id="controls-summary"
              type="button"
              aria-expanded={card.estado !== 'compact'}
              aria-controls="controls-panel"
              onClick={card.abrir}
            >
              <img className="brand__logo" src={LOGO.src} alt={LOGO.alt} width={LOGO.width} height={LOGO.height} />
              <span className="controls__text">
                <span className="controls__lead">
                  <span className="controls__fuel" id="sum-fuel" hidden={!resumen?.fuel}>
                    {resumen?.fuel ?? ''}
                  </span>
                  <span className="controls__place" id="sum-place">
                    {resumen?.place ?? ''}
                  </span>
                </span>
                <span className="controls__criteria" id="sum-criteria">
                  {resumen?.criteria ?? ''}
                </span>
              </span>
              <span className="controls__expand">
                Ajustar <Chevron d="m6 9 6 6 6-6" />
              </span>
            </button>
          </div>
          <div className="controls__panel" id="controls-panel">
            <div className="controls__inner">
              <header className="appbar">
                <a className="brand" href="/" aria-label="masfacil.pe, inicio">
                  <img className="brand__logo" src={LOGO.src} alt={LOGO.alt} width={LOGO.width} height={LOGO.height} />
                  masfacil<em>.pe</em>
                </a>
                <ThemeToggle inicial={temaInicial} />
              </header>
              {/* Arriba dónde estás, abajo qué puedes hacer. El nombre del lugar nunca es pulsable: es el encabezado de los resultados. */}
              <div className="place">
                <h2 className="place__value" id="compare-title" tabIndex={-1}>
                  <IconoLugar tipo="gps" className="place__icon" hidden={!lugar.gps} />
                  <span id="place-name">{lugar.nombre}</span>
                </h2>
                <div className="place__row">
                  <button
                    id="refresh-location"
                    className="place__action"
                    type="button"
                    aria-label={pildora.nombre ?? undefined}
                    data-status={pildora.status ?? undefined}
                    data-variant={pildora.variante ?? undefined}
                    disabled={pildora.disabled}
                    onClick={onPlaceAction}
                  >
                    <IconoLugar tipo="refresh" className="place__action-icon" hidden={pildora.icono !== 'refresh'} />
                    <IconoLugar tipo="gps" className="place__action-icon" hidden={pildora.icono !== 'gps'} />
                    <span id="place-action-label">{pildora.label}</span>
                  </button>
                  <PlaceMenu
                    screen={screen}
                    backHidden={!(search.origin || search.district)}
                    historyHidden={!VIEWS[search.view].history}
                    onDistricts={onDistricts}
                    onBack={onBack}
                    onHistory={onHistory}
                    onHome={onHome}
                  />
                </div>
              </div>
              {/* El combustible, entre el lugar y el radio. Solo existe si hay más de una vista. */}
              <div id="view-picker-controls" className="toggle" role="group" aria-label="Combustible" hidden={!varias}>
                <ViewButtons view={search.view} onView={onView} />
              </div>
              <div id="radius-control" className="radius" hidden={!radio}>
                <div className="radius__head">
                  <label className="radius__label" htmlFor="radius-input">
                    Radio
                  </label>
                  <p id="radius-readout" className="radius__readout" role="status">
                    {radio?.readout ?? ''}
                  </p>
                </div>
                <input
                  ref={radioInput}
                  id="radius-input"
                  className="radius__input"
                  type="range"
                  min={RADIUS_MIN_KM}
                  max={RADIUS_MAX_KM}
                  step="0.5"
                  value={search.radiusKm}
                  disabled={Boolean(radio?.inert)}
                  aria-describedby="radius-readout"
                  onChange={(event) => onRadius(Number(event.target.value))}
                />
              </div>
              <div
                id="sort-toggle"
                className="toggle"
                role="group"
                aria-label="Ordenar resultados"
                hidden={!orden?.sortToggle}
              >
                <button aria-pressed={!orden?.byPrice} type="button" onClick={() => onSort('distance')}>
                  Más cerca
                </button>
                <button aria-pressed={Boolean(orden?.byPrice)} type="button" onClick={() => onSort('price')}>
                  Más barata
                </button>
              </div>
              <div
                id="price-product-toggle"
                className="toggle toggle--sub"
                role="group"
                aria-label="Producto para ordenar por precio"
                hidden={!orden?.productToggle}
              >
                <button
                  aria-pressed={search.priceProduct === 'regular'}
                  type="button"
                  onClick={() => onProduct('regular')}
                >
                  Regular
                </button>
                <button
                  aria-pressed={search.priceProduct === 'premium'}
                  type="button"
                  onClick={() => onProduct('premium')}
                >
                  Premium
                </button>
              </div>
              <button
                className="button--text controls__done"
                id="controls-done"
                type="button"
                aria-expanded={card.estado !== 'compact'}
                aria-controls="controls-panel"
                onClick={card.cerrar}
              >
                Listo <Chevron d="m6 15 6-6 6 6" />
              </button>
            </div>
          </div>
        </section>
      </div>
      <div
        className="controls-scrim"
        id="controls-scrim"
        hidden={card.estado !== 'overlay'}
        onClick={card.cerrar}
      ></div>
    </>
  );
}
