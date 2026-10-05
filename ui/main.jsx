// Entrada de la aplicación. Antes de montar React se resuelve la ruta —una sola
// vez, fuera de React, así que ningún render ni el doble montaje de Strict Mode
// escriben el historial—, se aplica el tema y se prepara el worker.
//
// React reemplaza la portada pre-renderizada que trae el HTML (ver
// `prerender.jsx`) en su primer render: sin hidratación, porque la ruta, la vista
// recordada y el tema solo se conocen aquí.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolvePath } from '../web/lib/routes.js';
import { App } from './App.jsx';
import { readPreference, writePreference } from './preference.js';
import { prepareServiceWorker } from './service-worker-ready.js';
import { applyTheme, readThemeChoice } from './theme.js';

// La ruta decide la vista. `/` vale la recordada y pasa a la canónica sin añadir
// una entrada al historial; una ruta concreta manda y queda recordada. El
// servidor y el worker ya redirigieron los enlaces antiguos; si uno llega aquí,
// se redirige igual.
const entrada = resolvePath(location.pathname, { preference: readPreference() });
if (entrada.kind === 'redirect') location.replace(`${entrada.to}${location.search}${location.hash}`);
else {
  const inicial = entrada.kind === 'view' ? entrada : resolvePath('/', { preference: readPreference() });
  if (location.pathname !== inicial.canonical)
    history.replaceState(null, '', `${inicial.canonical}${location.search}${location.hash}`);
  writePreference(inicial.view);
  const tema = readThemeChoice();
  applyTheme(tema);
  // Sin un worker listo los datos se piden igual a la red: esperarlo es una
  // mejora, no una condición. `npm run dev` no registra el worker de producción:
  // su caché taparía los cambios en caliente. En el build la condición desaparece.
  const trabajador = import.meta.env.DEV ? null : prepareServiceWorker().catch((error) => console.error(error));
  const demo = new URLSearchParams(location.search).get('history-demo') === '1';
  createRoot(document.getElementById('main')).render(
    <StrictMode>
      <App
        view={inicial.view}
        history={Boolean(inicial.history)}
        trabajador={trabajador}
        temaInicial={tema}
        demoHistorial={demo}
      />
    </StrictMode>,
  );
}
