// Objetivos táctiles (DESIGN.md §8): todo lo pulsable y visible mide al menos
// 44 × 44 px, en los estados de la app. Exentos, en lista cerrada: los enlaces
// dentro de una frase (la firma).
//
//   node scripts/probes/touch.mjs [--tree <árbol con web/ compilado>] [--widths 320,390]
//
// Sale con 1 si algo queda bajo 44 px.
import { LISTO, REPO, argumentos, chrome, clic, historicoDe, pagina, relojDe, servir } from './lib.mjs';

const { tree: ARBOL = REPO, widths: ANCHOS = '320,390' } = argumentos();
const EXENTOS = ['.firma a'];
const reloj = relojDe(ARBOL);
const historico = historicoDe(reloj);
const srv = await servir(ARBOL);
const c = await chrome();
const conResultados = `document.querySelectorAll('#offers > li').length > 0`;

const medir = (p) =>
  p.evalua(`(() => {
  const exentos = ${JSON.stringify(EXENTOS)};
  const nombre = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.getAttribute('class') ? '.' + e.getAttribute('class').trim().split(/\\s+/).slice(0, 2).join('.') : '') + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : e.textContent.trim() ? '«' + e.textContent.trim().slice(0, 24) + '»' : '');
  const fuera = [];
  let total = 0;
  for (const e of document.querySelectorAll('button, a[href], input, select, summary, [role="button"], [tabindex="0"]')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden' || e.closest('[hidden], .sr-only')) continue;
    if (e.closest('details:not([open])') && !e.closest('summary')) continue; // dentro de un <details> cerrado no se ve
    if (r.bottom < 0 || r.right < 0) continue; // fuera de pantalla a propósito (el salto al contenido)
    if (exentos.some((s) => e.matches(s))) continue;
    total += 1;
    if (r.width < 44 - 0.01 || r.height < 44 - 0.01) fuera.push(nombre(e) + ' ' + r.width.toFixed(1) + '×' + r.height.toFixed(1));
  }
  return { total, fuera };
})()`);

const ESTADOS = [
  [
    'portada',
    {},
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
    },
  ],
  [
    'distritos',
    {},
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#choose-district');
    },
  ],
  [
    'resultados',
    {},
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
      await p.esperar(conResultados);
    },
  ],
  [
    'detalle',
    {},
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
      await p.esperar(conResultados);
      await clic(p, '#offers > li button[aria-expanded]');
    },
  ],
  [
    'ajustar',
    {},
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
      await p.esperar(conResultados);
      await p.evalua('scrollTo(0, 1400); 1');
      await p.esperar(`document.getElementById('controls')?.dataset.state === 'compact'`);
      await clic(p, '#controls-summary');
    },
  ],
  [
    'menu',
    {},
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
      await p.esperar(conResultados);
      await clic(p, '#place-more');
    },
  ],
  [
    'buscando',
    { antesDeCargar: 'if (navigator.geolocation) navigator.geolocation.getCurrentPosition = () => {};' },
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
    },
  ],
  [
    'error-vista',
    { interceptar: [{ patron: '*/data/diesel/*', accion: 'fallar' }] },
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
      await p.esperar(conResultados);
      await clic(p, '#view-picker-controls >> Diésel');
      await p.esperar(`document.getElementById('view-state')?.dataset.state === 'error'`);
    },
  ],
  [
    'radio-vacio',
    { gps: { latitude: -12.6, longitude: -77.2, accuracy: 20 } },
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
      await p.esperar(`!document.getElementById('radius-empty').hidden`);
    },
  ],
  [
    'sobre-los-datos',
    {},
    async (p) => {
      await p.ir('/combustibles/gasolina');
      await p.esperar(LISTO);
      await clic(p, '#use-location');
      await p.esperar(conResultados);
      await p.evalua(`document.querySelector('details.about').open = true; 1`);
    },
  ],
  [
    '404',
    {},
    async (p) => {
      await p.ir('/combustibles/otra-cosa');
      await p.esperar(`document.readyState === 'complete'`);
    },
  ],
];

let fallos = 0;
try {
  for (const ancho of String(ANCHOS).split(',').map(Number)) {
    for (const [nombre, pide, accion] of ESTADOS) {
      const p = await pagina(c, { origen: srv.origen, ancho, reloj, historico, ...pide });
      await accion(p);
      await p.quieta();
      const { total, fuera } = await medir(p);
      fallos += fuera.length;
      console.log(
        `${fuera.length ? '✖' : '✔'} ${ancho} ${nombre} · ${total} pulsables${fuera.length ? ` · bajo 44: ${fuera.join(' | ')}` : ''}`,
      );
      await p.cerrar();
    }
  }
} finally {
  await c.cerrar();
  await srv.cerrar();
}
console.log(
  fallos ? `OBJETIVOS TÁCTILES: ${fallos} bajo 44 px` : 'OBJETIVOS TÁCTILES OK: todo lo pulsable mide al menos 44 × 44',
);
process.exitCode = fallos ? 1 : 0;
