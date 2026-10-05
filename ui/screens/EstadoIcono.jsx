// El icono de un estado de la lista: cargando, error, distrito sin grifos o
// radio vacío (docs/SPEC-ui-react.md §8 bis). Es decoración: `aria-hidden`, porque el
// texto de al lado ya dice lo mismo y es el que se anuncia.

const ICONOS = Object.freeze({
  error: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.6v5.1M12 16.3v.1" />
    </svg>
  ),
  'district-empty': (
    <svg viewBox="0 0 24 24">
      <path d="M12 21s-6.5-5.4-6.5-10.8a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21Z" />
      <path d="M9.6 10.2h4.8" />
    </svg>
  ),
  'radius-empty': (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" strokeDasharray="2.6 2.9" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  ),
});

export function EstadoIcono({ estado, className = '' }) {
  if (estado === 'loading') return <span className={`loader ${className}`.trim()} aria-hidden="true"></span>;
  const icono = ICONOS[estado];
  if (!icono) return null;
  return (
    <span
      className={`estado-icono${estado === 'error' ? ' estado-icono--error' : ''} ${className}`.trim()}
      aria-hidden="true"
    >
      {icono}
    </span>
  );
}
