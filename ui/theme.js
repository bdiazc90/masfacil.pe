// El tema del documento: claro, oscuro o el del sistema. `styles.css` resuelve el
// tema por `data-theme` y no por media query, así que alguien tiene que fijarlo.
// La aplicación lo aplica al arrancar y desde su selector; la 404, con `initTheme`.

const CLAVE = 'masfacil-theme';

export function readThemeChoice() {
  try { return globalThis.localStorage?.getItem(CLAVE) ?? 'system'; } catch { return 'system'; }
}

export function applyTheme(choice) {
  const dark = choice === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : choice === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem(CLAVE, choice); } catch { /* sin almacenamiento el tema vale para esta visita */ }
}

/** La 404 no tiene selector: aplica la preferencia y sigue al sistema si es «Sistema». */
export function initTheme() {
  applyTheme(readThemeChoice());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (readThemeChoice() === 'system') applyTheme('system'); });
}
