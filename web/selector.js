import { initTheme } from './theme.js';

function rememberedProduct() {
  const value = localStorage.getItem('masfacil-product');
  return value === 'regular' || value === 'premium' ? value : null;
}
function consumeSelectorIntent() {
  if (sessionStorage.getItem('masfacil-selector-intent') !== '1') return false;
  sessionStorage.removeItem('masfacil-selector-intent');
  return true;
}
const remembered = rememberedProduct();
if (remembered && !consumeSelectorIntent()) location.replace(`/gasolina/${remembered}/`);

const productStatus = document.getElementById('product-selection-status');
const productChoices = [...document.querySelectorAll('[data-product-choice]')];
function resetProductChoice() {
  document.querySelector('main').removeAttribute('aria-busy');
  productStatus.hidden = true;
  for (const choice of productChoices) choice.removeAttribute('aria-disabled');
}
productChoices.forEach((choice) => choice.addEventListener('click', () => {
  const label = choice.dataset.productChoice === 'regular' ? 'Gasohol Regular' : 'Gasohol Premium';
  document.querySelector('main').setAttribute('aria-busy', 'true');
  productStatus.hidden = false;
  productStatus.textContent = `Abriendo ${label}…`;
  for (const item of productChoices) item.setAttribute('aria-disabled', String(item === choice));
}));
addEventListener('pageshow', resetProductChoice);
initTheme();
