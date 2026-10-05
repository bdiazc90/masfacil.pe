// Pulso de precios: un plano y cuatro líneas en la pantalla inicial.
//
// Se monta fuera del arranque de precios y nunca falla hacia fuera: si el
// resumen no llega, no vale o todavía no hay días, el bloque lo cuenta dentro de
// sí mismo. La geometría y los textos salen de `ui/history-view.js`; aquí solo se
// ponen en su sitio.
//
// Elegir un día solo cambia la guía, los marcadores y la lectura: el `<svg>` que
// tiene el foco no se rehace, así que el lector de pantalla anuncia lo que la
// persona eligió y no vuelve a leer la gráfica entera.

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { HISTORY_ORIGIN, limaDate } from '../../web/lib/history-contract.js';
import { DEFAULT_WINDOW, frameWindow } from '../../web/lib/history-series.js';
import { H, W, diaEnX, lectura, lecturas, listaDias, plano, seleccionVista } from '../history-view.js';
import { cargarHistorial } from './cargar-historial.js';

const CARGADOS = new Set(['ready', 'stale', 'saved', 'demo']);
const almacen = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

/**
 * Lleva la vista y el foco al bloque: es lo que hace «Ver historial» y la ruta
 * del historial. Con «reducir movimiento» salta sin deslizarse.
 */
export function enfocarHistorial() {
  const bloque = document.getElementById('history-chart');
  if (!bloque) return;
  bloque.scrollIntoView?.({
    block: 'start',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  (bloque.querySelector('.history__svg') ?? document.getElementById('history-title') ?? bloque).focus?.({
    preventScroll: true,
  });
}

// Lo secundario del bloque —subtítulo, fecha de cada lectura, notas— se lee en
// gris y pequeño, sin competir con las cifras.
const SECUNDARIO = 'm-0 text-[12.5px] text-muted-foreground';
// El último promedio se lee en reposo, sin tocar nada: es la lectura principal.
const VALOR = 'm-0 text-[26px] leading-[1.1] tracking-[-.035em]';

function Lecturas({ marco }) {
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-s3">
      {lecturas(marco).map((producto) => (
        <div key={producto.key} className="grid min-w-0 gap-[2px]" data-serie={producto.key}>
          <h3 className="m-0 text-[12px] font-bold tracking-[.08em] text-serie uppercase">{producto.label}</h3>
          {producto.valor !== null ? (
            <>
              <p className={`${VALOR} font-extrabold text-foreground`}>
                <small className="mr-[3px] text-[14px] font-semibold tracking-[0] text-muted-foreground">S/</small>
                {producto.valor}
              </p>
              <p className={SECUNDARIO}>
                <time dateTime={producto.datetime}>{producto.fecha}</time>
                {` · ${producto.n} grifos`}
              </p>
            </>
          ) : (
            <>
              <p className={`${VALOR} font-semibold text-muted-foreground`} aria-hidden="true">
                —
              </p>
              <p className={SECUNDARIO}>Sin días registrados en esta ventana.</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// El blanco táctil es el trazado entero: a catorce días cada ranura mide unos
// veinte píxeles, y un rectángulo por punto quedaría por debajo de 44 px.
function Plano({ marco, seleccion, uid, onElegir, onTecla }) {
  const vista = plano(marco);
  if (!vista) return null;
  const elegido = seleccionVista(marco, seleccion);
  const alApuntar = (event) => {
    const caja = event.currentTarget.getBoundingClientRect();
    if (!caja.width) return;
    onElegir(diaEnX(((event.clientX - caja.left) / caja.width) * W, marco.days));
  };
  return (
    <>
      <svg
        className="history__svg"
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        tabIndex={0}
        aria-label={vista.ariaLabel}
        onPointerDown={alApuntar}
        onKeyDown={onTecla}
      >
        <defs>
          {vista.gradientes.map((gradiente) => (
            // `data-serie` en el degradado: está en `<defs>`, fuera del grupo de su
            // serie, y sin él sus paradas no heredan `--serie` y salen grises.
            <linearGradient
              key={gradiente.key}
              id={`${uid}-fill-${gradiente.key}`}
              data-serie={gradiente.key}
              x1="0"
              y1={gradiente.y1}
              x2="0"
              y2={gradiente.y2}
              gradientUnits="userSpaceOnUse"
            >
              <stop className="history__fill-alto" offset="0" />
              <stop className="history__fill-medio" offset=".55" />
              <stop className="history__fill-bajo" offset="1" />
            </linearGradient>
          ))}
        </defs>
        {vista.ticks.map((tick) => (
          <g key={tick.key} className="history__tick">
            <line x1={tick.x1} y1={tick.y} x2={tick.x2} y2={tick.y} />
            {tick.texto ? (
              <text x={tick.texto.x} y={tick.texto.y} textAnchor="end">
                {tick.texto.valor}
              </text>
            ) : null}
          </g>
        ))}
        {vista.fechas.map((etiqueta) => (
          <Fragment key={etiqueta.key}>
            <text
              className="history__eje-x"
              x={etiqueta.x}
              y={etiqueta.arriba.y}
              textAnchor={etiqueta.ancla}
              data-alterna={etiqueta.alterna ? '1' : undefined}
            >
              {etiqueta.arriba.texto}
            </text>
            {etiqueta.abajo ? (
              <text
                className="history__eje-x history__eje-dia"
                x={etiqueta.x}
                y={etiqueta.abajo.y}
                textAnchor={etiqueta.ancla}
                data-alterna={etiqueta.alterna ? '1' : undefined}
              >
                {etiqueta.abajo.texto}
              </text>
            ) : null}
          </Fragment>
        ))}
        <g className="history__guia-capa">
          {elegido.guia ? (
            <line
              className="history__guia"
              x1={elegido.guia.x}
              y1={elegido.guia.y1}
              x2={elegido.guia.x}
              y2={elegido.guia.y2}
            />
          ) : null}
        </g>
        {vista.series.map((serie) => (
          <g key={serie.key} data-serie={serie.key}>
            {serie.areas.map((d, indice) => (
              <path key={`area-${indice}`} className="history__area" d={d} fill={`url(#${uid}-fill-${serie.key})`} />
            ))}
            {serie.lineas.map((linea, indice) =>
              linea.d ? (
                <path key={`linea-${indice}`} className="history__linea" d={linea.d} />
              ) : (
                <circle key={`linea-${indice}`} className="history__solo" cx={linea.cx} cy={linea.cy} r="3.4" />
              ),
            )}
            {serie.promedio ? (
              <g className="history__promedio">
                <line x1={serie.promedio.x1} y1={serie.promedio.y} x2={serie.promedio.x2} y2={serie.promedio.y} />
                <text x={serie.promedio.texto.x} y={serie.promedio.texto.y}>
                  {serie.promedio.texto.valor}
                </text>
              </g>
            ) : null}
            {serie.ultimo ? (
              <>
                <text
                  className="history__serie-nombre"
                  x={serie.ultimo.nombre.x}
                  y={serie.ultimo.nombre.y}
                  textAnchor="end"
                >
                  {serie.ultimo.nombre.texto}
                </text>
                <circle className="history__ultimo" cx={serie.ultimo.cx} cy={serie.ultimo.cy} r="4.6" />
              </>
            ) : null}
          </g>
        ))}
        <g className="history__activo-capa">
          {elegido.activos.map((activo) => (
            <circle
              key={activo.key}
              className="history__activo"
              data-serie={activo.key}
              cx={activo.cx}
              cy={activo.cy}
              r="5"
            />
          ))}
        </g>
      </svg>
      <section className="sr-only" id={`${uid}-dias`} aria-label="Precio promedio día a día">
        <ul>
          {listaDias(marco.points).map((texto) => (
            <li key={texto}>{texto}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * El bloque del histórico. Existe siempre en la portada —reserva su alto desde el
 * primer pintado—, pero solo carga cuando `activo`: la primera vez que se entra a
 * una vista con histórico. A partir de ahí no se desmonta.
 */
export function HistoryChart({ hidden, activo, demo = false }) {
  const [carga, setCarga] = useState({ estado: 'loading', resumen: null, nota: '' });
  const [seleccion, setSeleccion] = useState(null);
  const [hoy, setHoy] = useState(() => limaDate(new Date()));
  const hoyActual = useRef(hoy);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  // Se lanza sin esperar: los precios y el GPS no dependen de esto.
  useEffect(() => {
    if (!activo) return undefined;
    let vigente = true;
    cargarHistorial({ origin: HISTORY_ORIGIN, storage: almacen(), demo }).then((resultado) => {
      if (vigente) setCarga(resultado);
    });
    return () => {
      vigente = false;
    };
  }, [activo, demo]);

  // Volver de segundo plano no pide nada a la red: solo vuelve a contar los días
  // contra el reloj. Cruzada la medianoche de Lima, el dato de ayer deja de ser «Hoy».
  useEffect(() => {
    if (!activo) return undefined;
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      const ahora = limaDate(new Date());
      if (ahora === hoyActual.current) return;
      hoyActual.current = ahora;
      setHoy(ahora);
      setSeleccion(null);
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [activo]);

  const marco =
    activo && CARGADOS.has(carga.estado) ? frameWindow(carga.resumen, { today: hoy, days: DEFAULT_WINDOW }) : null;
  // La selección es una sola y vale para las dos franjas: misma fecha, dos datos.
  const elegir = (indice) => {
    if (marco) setSeleccion(Math.max(0, Math.min(marco.days - 1, indice)));
  };
  const alTeclear = (event) => {
    const accion = { ArrowLeft: -1, ArrowRight: 1, Home: 'inicio', End: 'fin' }[event.key];
    if (accion === undefined || !marco) return;
    event.preventDefault();
    if (accion === 'inicio') elegir(0);
    else if (accion === 'fin') elegir(marco.days - 1);
    else elegir((seleccion === null ? marco.days - 1 : seleccion) + accion);
  };

  return (
    <section
      id="history-chart"
      className="history plate"
      aria-labelledby="history-title"
      data-state={activo ? carga.estado : 'loading'}
      hidden={hidden}
    >
      <h2 id="history-title" className="m-0 text-[16px]" tabIndex={-1}>
        Precio promedio en Lima
      </h2>
      <p className={SECUNDARIO}>S/ por galón · últimos 7 días observados</p>
      <div id="history-body">
        {activo && carga.estado === 'loading' ? <p className={SECUNDARIO}>Cargando el histórico…</p> : null}
        {marco ? (
          <>
            <Lecturas marco={marco} />
            <Plano marco={marco} seleccion={seleccion} uid={uid} onElegir={elegir} onTecla={alTeclear} />
          </>
        ) : null}
      </div>
      {activo ? (
        <>
          {/* Persistentes: no se rehacen, así que el lector anuncia lo que la persona eligió. */}
          <p className={SECUNDARIO} role="status" hidden={!carga.nota}>
            {carga.nota}
          </p>
          <p className="history__lectura" role="status">
            {marco && seleccion !== null ? lectura(marco.points[seleccion]) : ''}
          </p>
        </>
      ) : null}
    </section>
  );
}
