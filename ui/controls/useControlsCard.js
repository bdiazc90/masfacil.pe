// Card de Controles: full | compact | overlay (DESIGN.md §7).
//
// Regla: baja más de --collapse-at → compact solo; vuelve a menos de
// --expand-at → full solo. Entre ambos no cambia (histéresis). overlay (abierto a
// mano estando abajo) dura hasta bajar 32 px más, tocar fuera, Escape o «Listo».
// Fuera de resultados y distritos (`activo` falso) el card no se fija y vuelve al
// flujo.
//
// Lo que mira fuera de React —scroll, los dos centinelas, el alto del card y el
// Escape— vive en efectos con su limpieza; el estado del card es de React.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const cssPx = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
const visible = (el) => el && el.offsetParent !== null;

/**
 * Cambiar un filtro estando scrolleado: el primer resultado es la respuesta, así
 * que se vuelve arriba y el card regresa al flujo solo.
 */
export function scrollToTop() {
  if (scrollY > cssPx('--expand-at')) scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

export function useControlsCard({ activo }) {
  const card = useRef(null);
  const slot = useRef(null);
  const summary = useRef(null);
  const colapso = useRef(null);
  const expansion = useRef(null);
  const [estado, setEstado] = useState('full');
  // Fuera de resultados y distritos el card vuelve al flujo: se ajusta al pintar.
  if (!activo && estado !== 'full') setEstado('full');
  const actual = useRef({ estado, activo });
  const devolverFoco = useRef(false);
  const primerControl = useRef(false);

  const cambiar = useCallback((nuevo, { foco = false, alPrimerControl = false } = {}) => {
    devolverFoco.current = foco;
    primerControl.current = alPrimerControl;
    setEstado(nuevo);
  }, []);

  useLayoutEffect(() => {
    actual.current = { estado, activo };
    const el = card.current;
    // Nadie se queda enfocado dentro de un panel que acaba de cerrarse. En
    // distritos «Ajustar» no existe, así que el foco va al primer control visible
    // de la barra. Cerrar a mano devuelve el foco a «Ajustar» aunque estuviera
    // fuera del card: tocar el fondo no puede dejarlo en <body>.
    if (estado === 'compact' && el && (devolverFoco.current || el.contains(document.activeElement))) {
      const destino = visible(summary.current) ? summary.current : [...el.querySelectorAll('.controls__bar button')].find(visible);
      destino?.focus({ preventScroll: true });
    }
    // Abrir «Ajustar» lleva el foco al primer control de búsqueda: la cabecera de
    // marca y tema queda fuera, porque abrir es para ajustar, no para ir al inicio.
    if (estado === 'overlay' && el && primerControl.current) {
      [...el.querySelectorAll('.controls__panel :is(button, a[href], input):not([disabled])')].find((nodo) => visible(nodo) && !nodo.closest('.appbar'))?.focus({ preventScroll: true });
    }
    devolverFoco.current = false;
    primerControl.current = false;
  }, [estado, activo]);

  // Abierto encima, se cierra al bajar 32 px más.
  useEffect(() => {
    if (estado !== 'overlay') return undefined;
    const desde = scrollY;
    const alBajar = () => { if (scrollY - desde > 32) cambiar('compact'); };
    addEventListener('scroll', alBajar, { passive: true });
    return () => removeEventListener('scroll', alBajar);
  }, [estado, cambiar]);

  useEffect(() => {
    const alTeclear = (event) => { if (event.key === 'Escape' && actual.current.estado === 'overlay') cambiar('compact', { foco: true }); };
    addEventListener('keydown', alTeclear);
    const centinelas = new IntersectionObserver((entries) => {
      if (!actual.current.activo) return;
      for (const entry of entries) {
        if (entry.target === colapso.current && !entry.isIntersecting && actual.current.estado === 'full') cambiar('compact');
        if (entry.target === expansion.current && entry.isIntersecting) cambiar('full');
      }
    });
    centinelas.observe(colapso.current);
    centinelas.observe(expansion.current);
    // El hueco conserva el alto del card en full: fijarlo no mueve la lista y
    // volver al flujo tampoco.
    const alto = new ResizeObserver(() => { if (actual.current.estado === 'full') slot.current?.style.setProperty('--controls-slot-h', `${card.current.offsetHeight}px`); });
    alto.observe(card.current);
    return () => { removeEventListener('keydown', alTeclear); centinelas.disconnect(); alto.disconnect(); };
  }, [cambiar]);

  return {
    estado,
    refs: { card, slot, summary, colapso, expansion },
    abrir: () => cambiar('overlay', { alPrimerControl: estado === 'compact' }),
    cerrar: () => cambiar('compact', { foco: true }),
  };
}
