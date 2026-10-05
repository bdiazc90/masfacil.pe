// Las tarjetas que llegan a la lista entran: suben 8 px y aparecen, escalonadas
// hasta la sexta (SPEC-UI-REACT §8 bis). Llegan con una lista nueva —abrir
// resultados, cambiar de combustible— o al final de la que había —«Ver más», un
// radio que suma grifos—; las que ya estaban no se mueven. Reordenar no anima:
// si las que siguen cambian de orden o una nueva se intercala entre ellas
// («Más barata»), la lista cambia al instante.
//
// Web Animations API y no una animación CSS: reordenar mueve nodos del DOM, y
// una animación CSS volvería a correr en cada tarjeta movida; así tampoco hace
// falta marcar las nuevas con un atributo. Duración, paso y curva salen de los
// tokens de `ui/styles.css`. `fill: 'backwards'` sostiene la tarjeta sin verse
// mientras espera su turno; al terminar no queda nada aplicado. Nunca bloquea
// el toque, el foco ni los anuncios.
//
// Los cuadros usan `translate` y no la propiedad compuesta: Tailwind lee este
// archivo buscando clases y, con esa palabra, emitiría una utilidad que nadie usa.

import { useLayoutEffect, useRef } from 'react';

/** La sexta tarjeta nueva (índice 5) es la última con turno propio; las demás entran con ella. */
const ULTIMO_TURNO = 5;

const token = (raiz, nombre) => getComputedStyle(raiz).getPropertyValue(nombre).trim();
const enMs = (valor) => (parseFloat(valor) || 0) * (valor.endsWith('ms') ? 1 : 1000);

/**
 * Anima, después de cada commit, los hijos de `lista` cuya clave no estaba en
 * el commit anterior. `claves` va en el mismo orden que los hijos.
 */
export function useEntradaTarjetas(lista, claves) {
  const anteriores = useRef(new Set());
  useLayoutEffect(() => {
    const vistas = anteriores.current;
    anteriores.current = new Set(claves);
    const nodos = lista.current?.children;
    if (!nodos?.length) return;
    // Lista nueva (ninguna seguía) o agregado al final (todas las que siguen van
    // primero y en su orden); cualquier otra cosa es reordenar.
    const siguen = claves.filter((clave) => vistas.has(clave));
    const enOrden = [...vistas].filter((clave) => anteriores.current.has(clave));
    if (siguen.length && (siguen.some((clave, i) => clave !== claves[i] || clave !== enOrden[i]))) return;
    const raiz = document.documentElement;
    const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Con `reduce`, un fundido sin subir ni escalonar.
    const cuadros = reducir ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }];
    const duracion = enMs(token(raiz, reducir ? '--motion-enter' : '--motion-cards'));
    const paso = reducir ? 0 : enMs(token(raiz, '--motion-stagger'));
    const curva = token(raiz, reducir ? '--motion-ease' : '--ease-out') || 'ease-out';
    let turno = 0;
    claves.forEach((clave, indice) => {
      if (vistas.has(clave)) return;
      const nodo = nodos[indice];
      if (typeof nodo?.animate !== 'function') return;
      nodo.animate(cuadros, { duration: duracion, delay: Math.min(turno, ULTIMO_TURNO) * paso, easing: curva, fill: 'backwards' });
      turno += 1;
    });
  });
}
