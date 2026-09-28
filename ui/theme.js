export function applyTheme(choice) {
  const dark = choice === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : choice === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('masfacil-theme', choice);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice)));
}

export function initTheme() {
  const savedTheme = localStorage.getItem('masfacil-theme') ?? 'system';
  applyTheme(savedTheme);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((localStorage.getItem('masfacil-theme') ?? 'system') === 'system') applyTheme('system'); });
}
