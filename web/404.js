// Entrada de 404.html: solo el tema. Sin esto la página de error sería siempre
// clara, porque styles.css resuelve el tema por `data-theme` y no por media query.
import { initTheme } from './theme.js';

initTheme();
