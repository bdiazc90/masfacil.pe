// Tema claro, oscuro o del sistema. La elección se aplica al documento en el
// mismo gesto —`data-theme` y la preferencia guardada, con `applyTheme`, la
// misma función que usa la 404— y, con «Sistema», sigue al sistema mientras
// dure la visita y la preferencia guardada siga siendo «Sistema».

import { useEffect, useState } from 'react';
import { applyTheme, readThemeChoice } from '../theme.js';

const OPCIONES = [
  {
    choice: 'light',
    label: 'Tema claro',
    title: 'Claro',
    icono: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
        <path d="M12 2v2.5M12 19.5V22M4.93 4.93 6.7 6.7m10.6 10.6 1.77 1.77M2 12h2.5m15 0H22M4.93 19.07 6.7 17.3m10.6-10.6 1.77-1.77" />
      </svg>
    ),
  },
  {
    choice: 'system',
    label: 'Tema del sistema',
    title: 'Sistema',
    icono: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="12" rx="1.5" />
        <path d="M8.5 20h7M12 16.5V20" />
      </svg>
    ),
  },
  {
    choice: 'dark',
    label: 'Tema oscuro',
    title: 'Oscuro',
    icono: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />
      </svg>
    ),
  },
];

export function ThemeToggle({ inicial = null }) {
  const [elegido, setElegido] = useState(inicial);
  useEffect(() => {
    if (elegido !== 'system') return undefined;
    const sistema = matchMedia('(prefers-color-scheme: dark)');
    // Manda lo guardado, no este estado: otra pestaña pudo elegir un tema fijo
    // después, y un cambio del sistema no puede pisar esa elección.
    const alCambiar = () => {
      if (readThemeChoice() === 'system') applyTheme('system');
    };
    sistema.addEventListener('change', alCambiar);
    return () => sistema.removeEventListener('change', alCambiar);
  }, [elegido]);
  const elegir = (choice) => {
    applyTheme(choice);
    setElegido(choice);
  };
  return (
    <div className="theme-toggle" role="group" aria-label="Tema">
      {OPCIONES.map(({ choice, label, title, icono }) => (
        <button
          key={choice}
          aria-pressed={elegido === choice}
          aria-label={label}
          title={title}
          type="button"
          onClick={() => elegir(choice)}
        >
          {icono}
        </button>
      ))}
    </div>
  );
}
