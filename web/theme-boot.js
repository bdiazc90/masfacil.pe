// Tema y theme-color antes del primer pintado (SPEC-UI-REACT §8 bis): script
// clásico en el <head> de la portada y la 404. Repite la regla de applyTheme
// (ui/theme.js) con la misma clave; lo ata test/theme-boot.test.mjs.
(() => {
  let eleccion = 'system';
  try { eleccion = localStorage.getItem('masfacil-theme') ?? 'system'; } catch { /* sin almacenamiento, el del sistema */ }
  const tema = (eleccion === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : eleccion === 'dark') ? 'dark' : 'light';
  document.documentElement.dataset.theme = tema;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta?.dataset[tema]) meta.content = meta.dataset[tema];
})();
