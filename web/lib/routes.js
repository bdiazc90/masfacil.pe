// Rutas: una sola tabla para el navegador, el service worker, el servidor local
// y el hosting, para que ninguno resuelva una dirección distinto que otro.
//
// Cada vista activa vive en `/combustibles/<vista>` y, si tiene histórico, en
// `/combustibles/<vista>/historial`: las dos son la misma portada, que la app
// enfoca según la ruta. La forma canónica no lleva barra final; con barra se
// responde 301. Los enlaces publicados antes de las vistas redirigen a Gasolina.
// Todo lo demás —una vista no activada, una subruta inventada— es 404, nunca la
// portada con 200. `/` es la entrada sin vista: la resuelve la preferencia
// guardada, que solo conoce el navegador, así que el servidor sirve la portada y
// el cliente reescribe la URL a la vista.
//
// Sin DOM y sin E/S: lo importan la página, el service worker y Node.

import { ACTIVE_VIEWS, DEFAULT_VIEW, VIEWS } from './catalog.js';

export const viewPath = (view) => `/combustibles/${view}`;
export const historyPath = (view) => `${viewPath(view)}/historial`;

// Enlaces anteriores a las vistas. No salen del catálogo: son historia publicada
// y tienen que seguir llevando al mismo sitio aunque el catálogo cambie.
const ANTIGUAS = Object.freeze([
  ['/gasolina', viewPath('gasolina')],
  ['/gasolina/regular', viewPath('gasolina')],
  ['/gasolina/premium', viewPath('gasolina')],
  ['/gasolina/historial', historyPath('gasolina')],
]);

/** Las rutas que sirven la portada, además de `/`. */
export function appPaths() {
  return ACTIVE_VIEWS.flatMap((view) => [viewPath(view), ...(VIEWS[view].history ? [historyPath(view)] : [])]);
}

/** Redirecciones 301 exactas: la barra final de las rutas de la app y los enlaces antiguos. */
export function redirects() {
  const conBarra = appPaths().map((ruta) => [`${ruta}/`, ruta]);
  const antiguas = ANTIGUAS.flatMap(([desde, hacia]) => [[desde, hacia], [`${desde}/`, hacia]]);
  return [...conBarra, ...antiguas];
}

/**
 * Qué es una dirección.
 *
 * @param {string} pathname
 * @param {{preference?: string|null}} [opciones]  la vista recordada; solo cuenta en `/`
 * @returns {{kind: 'view', view: string, history: boolean, canonical: string} | {kind: 'redirect', to: string} | {kind: 'not-found'}}
 */
export function resolvePath(pathname, { preference = null } = {}) {
  if (pathname === '/') {
    const view = ACTIVE_VIEWS.includes(preference) ? preference : DEFAULT_VIEW;
    return { kind: 'view', view, history: false, canonical: viewPath(view) };
  }
  for (const view of ACTIVE_VIEWS) {
    if (pathname === viewPath(view)) return { kind: 'view', view, history: false, canonical: pathname };
    if (VIEWS[view].history && pathname === historyPath(view)) return { kind: 'view', view, history: true, canonical: pathname };
  }
  const destino = redirects().find(([desde]) => desde === pathname)?.[1];
  return destino ? { kind: 'redirect', to: destino } : { kind: 'not-found' };
}

/**
 * Las reglas de `web/_redirects`, en el orden en que Pages las aplica: primero
 * las reescrituras de la app, después los 301. El destino de una reescritura es
 * `/` y no `/index.html`: Pages normaliza `/index.html` a `/` con un 308 y ese
 * redirect se colaría en la reescritura.
 */
export function redirectRules() {
  return [
    ...appPaths().map((ruta) => `${ruta} / 200`),
    ...redirects().map(([desde, hacia]) => `${desde} ${hacia} 301`),
  ];
}
