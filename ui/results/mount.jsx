// El puente temporal entre el coordinador Vanilla (`ui/app.js`) y la lista en
// React, hasta que G3 pase la coordinación a React y lo retire.
//
// Es síncrono a propósito: `flushSync` deja el DOM pintado al volver de
// `render`, como hacía `innerHTML`, así que lo que el coordinador hace justo
// después —volver arriba, mover el foco al encabezado— ve la lista nueva. Ni bus
// de eventos ni copia del estado: cada `render` recibe la vista completa.

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Results } from './Results.jsx';

export function mountResults(container) {
  const root = createRoot(container);
  const pintar = (props) => flushSync(() => root.render(<Results {...props} />));
  pintar({});
  return {
    /** Pinta la vista de resultados que calculó el coordinador. */
    render: (props) => pintar(props),
    /** Sin vista: ni tarjetas ni avisos, mientras carga otra. */
    clear: () => pintar({}),
    unmount: () => root.unmount(),
  };
}
