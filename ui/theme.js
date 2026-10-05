// El tema del documento: claro, oscuro o el del sistema. `styles.css` resuelve el
// tema por `data-theme` y no por media query, así que alguien tiene que fijarlo.
// Antes del primer pintado lo fija `web/theme-boot.js`, con la misma clave y la
// misma regla; la aplicación lo vuelve a aplicar al arrancar y desde su
// selector, y la 404, con `initTheme`.

export const THEME_KEY = 'masfacil-theme';

export function readThemeChoice() {
  try { return globalThis.localStorage?.getItem(THEME_KEY) ?? 'system'; } catch { return 'system'; }
}

export function applyTheme(choice) {
  const tema = (choice === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : choice === 'dark') ? 'dark' : 'light';
  document.documentElement.dataset.theme = tema;
  // La barra del navegador sigue al tema: el `<meta>` lleva el fondo de cada uno.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta?.dataset[tema]) meta.content = meta.dataset[tema];
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* sin almacenamiento el tema vale para esta visita */ }
}

/** La 404 no tiene selector: aplica la preferencia y sigue al sistema si es «Sistema». */
export function initTheme() {
  applyTheme(readThemeChoice());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (readThemeChoice() === 'system') applyTheme('system'); });
}
