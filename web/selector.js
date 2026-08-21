function applyTheme(choice) {
  const dark = choice === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : choice === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('masfacil-theme', choice);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice)));
}
document.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.themeChoice)));
const productStatus = document.getElementById('product-selection-status');
const productChoices = [...document.querySelectorAll('[data-product-choice]')];
function resetProductChoice() {
  document.querySelector('main').removeAttribute('aria-busy');
  productStatus.hidden = true;
  for (const choice of productChoices) {
    choice.removeAttribute('aria-disabled');
    choice.textContent = choice.dataset.productChoice === 'regular' ? 'Regular' : 'Premium';
  }
}
productChoices.forEach((choice) => choice.addEventListener('click', () => {
  const label = choice.dataset.productChoice === 'regular' ? 'Gasohol Regular' : 'Gasohol Premium';
  document.querySelector('main').setAttribute('aria-busy', 'true');
  productStatus.hidden = false;
  productStatus.textContent = `Abriendo ${label}…`;
  for (const item of productChoices) item.setAttribute('aria-disabled', String(item === choice));
}));
addEventListener('pageshow', resetProductChoice);
applyTheme(localStorage.getItem('masfacil-theme') ?? 'system');
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((localStorage.getItem('masfacil-theme') ?? 'system') === 'system') applyTheme('system'); });
