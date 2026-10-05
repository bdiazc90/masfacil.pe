// Inicio: la portada con el combustible, las dos formas de buscar, el estado de
// los precios y el histórico. Se pinta entera desde el primer render —y desde el
// HTML pre-renderizado—: nunca una portada vacía esperando a que algo cargue.

import { ACTIVE_VIEWS } from '../../web/lib/catalog.js';
import { ViewButtons } from '../controls/Controls.jsx';
import { HistoryChart } from '../history/HistoryChart.jsx';

export function StartScreen({ hidden, view, listo, estado, historial, onView, onLocate, onDistricts, onRetry }) {
  return (
    <section id="start-step" className="screen-flow start-step" aria-labelledby="start-title" hidden={hidden}>
      <h1 id="start-title">Encuentra combustible cerca de ti</h1>
      {/* Elegir combustible no pide ubicación ni abre otra pantalla. */}
      <fieldset
        id="view-picker-start"
        className="m-0 mb-s3 grid min-w-0 gap-s2 p-0 [border:0]"
        hidden={ACTIVE_VIEWS.length < 2}
      >
        <legend className="mx-auto mt-0 mb-s2 p-0 text-[14px] font-semibold text-muted-foreground">Combustible</legend>
        <div className="toggle">
          <ViewButtons view={view} onView={onView} />
        </div>
      </fieldset>
      <button id="use-location" className="button button--primary" type="button" disabled={!listo} onClick={onLocate}>
        Ver en mi ubicación
      </button>
      <button
        id="choose-district"
        className="button button--ghost"
        type="button"
        disabled={!listo}
        onClick={onDistricts}
      >
        Ver distritos
      </button>
      <p id="data-status" className={estado.visible ? 'hint' : 'hint sr-only'} role="status" aria-live="polite">
        {estado.texto}
      </p>
      <button
        id="start-retry"
        className="button button--ghost"
        type="button"
        hidden={!estado.visible}
        onClick={onRetry}
      >
        Reintentar
      </button>
      {/* Contexto, no acción: va después de los botones y reserva su alto desde el primer pintado. */}
      <HistoryChart hidden={!historial.visible} activo={historial.activo} demo={historial.demo} />
    </section>
  );
}
