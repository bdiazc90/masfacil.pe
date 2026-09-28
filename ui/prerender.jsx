// La portada del HTML publicado, pintada en el build con la misma `App` que corre
// en el navegador: una sola fuente del marcado y un primer pintado inmediato
// aunque el JavaScript tarde.
//
// Es la portada de `/` sin nada que dependa de quien la abre: Gasolina,
// «Cargando precios…» y el espacio del histórico reservado. No lee ruta, reloj,
// preferencia ni tema, así que las mismas fuentes dan los mismos bytes.

import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_VIEW } from '../web/lib/catalog.js';
import { App } from './App.jsx';

export function renderPortada() {
  return renderToStaticMarkup(<App view={DEFAULT_VIEW} />);
}
