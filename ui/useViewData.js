// Los datos de cada vista: se cargan una vez y quedan guardados en la visita.
//
// Cada carga lleva su turno, como antes: la respuesta tardía de una vista que se
// dejó queda guardada, pero no se aplica bajo la etiqueta de la nueva. Volver a
// una vista que todavía carga la pide otra vez, también como antes: una petición
// colgada no deja a nadie esperando sin salida. Mientras la última pedida no
// llega, su vista sigue «cargando» aunque una respuesta anterior de la misma
// vista ya esté guardada: los datos se muestran cuando se aplican, no antes.
// (El doble montaje de Strict Mode no carga dos veces: el efecto de arranque
// descarta su primera vuelta.)

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { loadView } from './data-client.js';

/**
 * @param {{alListo: (vista: string, entrada: object) => void, alError: (vista: string) => void}} avisos
 *   Se llaman solo si la carga sigue siendo la última pedida.
 */
export function useViewData(avisos) {
  const [cargadas, setCargadas] = useState(() => new Map());
  const [fallidas, setFallidas] = useState(() => new Set());
  // La vista de la última carga pedida, hasta que llega o falla.
  const [pendiente, setPendiente] = useState(null);
  const cargadasVigentes = useRef(cargadas);
  const turno = useRef(0);
  const avisar = useRef(avisos);
  useLayoutEffect(() => { cargadasVigentes.current = cargadas; avisar.current = avisos; });

  /**
   * Pide la vista. Si ya está guardada la devuelve para aplicarla en el mismo
   * gesto; si no, la carga y avisa al terminar.
   */
  const cargar = useCallback((vista) => {
    const mio = ++turno.current;
    const guardada = cargadasVigentes.current.get(vista);
    if (guardada) { setPendiente(null); return guardada; }
    setPendiente(vista);
    setFallidas((previas) => { if (!previas.has(vista)) return previas; const nuevas = new Set(previas); nuevas.delete(vista); return nuevas; });
    loadView(vista).then((dataset) => ({ dataset, mode: dataset.dataMode })).then((entrada) => {
      setCargadas((previas) => new Map(previas).set(vista, entrada));
      if (mio !== turno.current) return;
      setPendiente(null);
      avisar.current.alListo(vista, entrada);
    }, (error) => {
      console.error(error);
      if (mio !== turno.current) return;
      setPendiente(null);
      setFallidas((previas) => new Set(previas).add(vista));
      avisar.current.alError(vista);
    });
    return null;
  }, []);

  /** La copia guardada de una vista, o `null`, y en qué fase está. */
  const leer = (vista) => {
    if (vista === pendiente) return { entrada: null, fase: 'loading' };
    const entrada = cargadas.get(vista) ?? null;
    return { entrada, fase: entrada ? 'ready' : fallidas.has(vista) ? 'error' : 'loading' };
  };

  return { cargar, leer };
}
