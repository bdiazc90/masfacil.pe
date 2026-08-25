// Card de Controles: full | compact | overlay (DESIGN.md §7).
// Regla: baja más de --collapse-at → compact solo; vuelve a menos de
// --expand-at → full solo. Entre ambos no cambia (histéresis). overlay
// (abierto a mano estando abajo) dura hasta bajar 32 px más, tocar fuera,
// Escape o «Listo». Fuera de resultados (`isActive` falso) el card no se fija.
export function initControlsCard({ card, slot, scrim, summaryButton, doneButton, collapseSentinel, expandSentinel, isActive = () => true }) {
  const cssPx = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let overlayWatch = null;

  function setState(state) {
    if (overlayWatch) { removeEventListener('scroll', overlayWatch); overlayWatch = null; }
    if (card.dataset.state === state) return;
    card.dataset.state = state;
    const open = state !== 'compact';
    summaryButton.setAttribute('aria-expanded', String(open));
    doneButton.setAttribute('aria-expanded', String(open));
    scrim.hidden = state !== 'overlay';
    // Nadie se queda enfocado dentro de un panel que acaba de cerrarse.
    if (!open && card.contains(document.activeElement)) summaryButton.focus({ preventScroll: true });
    if (state === 'overlay') {
      const from = scrollY;
      overlayWatch = () => { if (scrollY - from > 32) setState('compact'); };
      addEventListener('scroll', overlayWatch, { passive: true });
    }
  }

  summaryButton.addEventListener('click', () => setState('overlay'));
  doneButton.addEventListener('click', () => setState('compact'));
  scrim.addEventListener('click', () => setState('compact'));
  addEventListener('keydown', (event) => { if (event.key === 'Escape' && card.dataset.state === 'overlay') setState('compact'); });

  const sentinels = new IntersectionObserver((entries) => {
    if (!isActive()) return;
    for (const entry of entries) {
      if (entry.target === collapseSentinel && !entry.isIntersecting && card.dataset.state === 'full') setState('compact');
      if (entry.target === expandSentinel && entry.isIntersecting) setState('full');
    }
  });
  sentinels.observe(collapseSentinel);
  sentinels.observe(expandSentinel);
  // El hueco conserva el alto del card en full: fijarlo no mueve la lista y volver al flujo tampoco.
  new ResizeObserver(() => { if (card.dataset.state === 'full') slot.style.setProperty('--controls-slot-h', `${card.offsetHeight}px`); }).observe(card);

  // Cambiar un filtro estando scrolleado: el primer resultado es la respuesta,
  // así que volvemos arriba y el card vuelve al flujo solo.
  function scrollToTop() {
    if (scrollY > cssPx('--expand-at')) scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  return { setState, scrollToTop };
}
