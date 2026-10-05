// Resultados: el aviso sin conexión, el de actualización de ubicación, el estado
// de la vista (cargando, error o distrito sin grifos), la lista y «Sobre los
// datos». La lista es la de `ui/results/`, montada aquí directamente.

import { MAX_OFFER_AGE_DAYS } from '../../web/lib/freshness.js';
import { RADIUS_MAX_KM, RADIUS_MIN_KM } from '../../web/lib/haversine.js';
import { Results } from '../results/Results.jsx';
import { EstadoIcono } from './EstadoIcono.jsx';

/**
 * Lo que el producto tiene que declarar, sin justificarse: atribución, no
 * afiliación, qué se mide de la visita, qué significa una ausencia, la ventana de
 * vigencia, cómo se mide la distancia, la precisión medida y de quién son las marcas.
 */
function SobreLosDatos({ provenance }) {
  if (!provenance) return <div id="source-content"></div>;
  return (
    <div id="source-content">
      <p>{`${provenance.attribution} Proyecto independiente, sin afiliación con Osinergmin, Facilito ni el Estado.`}</p>
      <p>
        No guardamos tu ubicación ni sale de tu dispositivo. Contamos visitas de forma anónima y sin cookies, para
        mejorar la app.
      </p>
      <p>{`«—» significa que ese grifo no publica precio vigente de ese producto, no que no lo venda. Pasados ${MAX_OFFER_AGE_DAYS} días sin reportar, su tarjeta queda sin precios y dice desde cuándo calla.`}</p>
      <p>{`La distancia es en línea recta. Tu zona es el radio que eliges, entre ${RADIUS_MIN_KM} y ${RADIUS_MAX_KM} km.`}</p>
      <p>
        Los nombres salen del Registro oficial: precisión medida de 89 % en los confirmados y 85 % en los{' '}
        <b>por confirmar</b>. Marcas y logos son de sus titulares, solo para identificar la estación.
      </p>
      <p>
        <a href={provenance.source_url} target="_blank" rel="noopener noreferrer">
          Ver fuente de Osinergmin
        </a>
      </p>
    </div>
  );
}

export function CompareScreen({ hidden, nota, aviso, estadoVista, resultados, provenance, onViewStateAction }) {
  return (
    <section
      id="compare-step"
      className="screen-flow screen-flow--results"
      aria-labelledby="compare-title"
      hidden={hidden}
    >
      <p
        id="offline-note"
        className="mx-[2px] mt-s4 mb-0 text-[13px] leading-[1.4] text-muted-foreground"
        role="status"
        hidden={!nota}
      >
        {nota ?? ''}
      </p>
      {/* La lista sigue debajo, con o sin éxito; el error se dice con tinta y peso. */}
      <div
        id="location-update"
        className="group mx-[2px] mt-s4 mb-0 flex items-baseline justify-between gap-s3"
        hidden={!aviso?.texto}
        data-status={aviso?.status}
      >
        <p
          id="location-update-text"
          className="m-0 text-[13px] leading-[1.4] text-muted-foreground group-data-[status=error]:font-semibold group-data-[status=error]:text-foreground"
          role="status"
          aria-live="polite"
        >
          {aviso?.texto ?? ''}
        </p>
      </div>
      {/* Cargando, error o distrito sin grifos del combustible elegido. */}
      <section
        id="view-state"
        className="plate mt-s4 grid justify-items-start gap-s3"
        hidden={!estadoVista.contenido}
        data-state={estadoVista.estado}
      >
        {estadoVista.contenido ? <EstadoIcono estado={estadoVista.estado} /> : null}
        <p id="view-state-text" className="lede" role="status" aria-live="polite">
          {estadoVista.contenido?.texto ?? ''}
        </p>
        <button
          id="view-state-action"
          className="button button--ghost"
          type="button"
          hidden={!estadoVista.contenido?.accion}
          onClick={onViewStateAction}
        >
          {estadoVista.contenido?.accion ?? ''}
        </button>
      </section>
      <Results {...resultados} />
      <details className="about plate">
        <summary>Sobre los datos</summary>
        <SobreLosDatos provenance={provenance} />
      </details>
    </section>
  );
}
