// Primer cuadro del tema (DESIGN.md §6): con el módulo de la página RETENIDO —la
// app no arrancó—, la portada pre-renderizada y la 404 ya se pintan con el tema
// guardado o el del sistema, y `theme-color` ya es el de ese tema.
//
//   node scripts/probes/first-frame.mjs [--tree <árbol con web/ compilado>] [--out <carpeta de capturas>]
//
// Sale con 1 si algún caso arranca con el tema equivocado.
import fs from 'node:fs';
import path from 'node:path';
import { REPO, argumentos, chrome, dormir, pagina, servir } from './lib.mjs';

const { tree: ARBOL = REPO, out: SALIDA } = argumentos();
if (SALIDA) fs.mkdirSync(SALIDA, { recursive: true });
const srv = await servir(ARBOL);
const c = await chrome();
const CASOS = [
  { guardado: 'dark', sistema: 'light', espera: 'dark' },
  { guardado: 'system', sistema: 'dark', espera: 'dark' },
  { guardado: 'light', sistema: 'dark', espera: 'light' },
  { guardado: 'system', sistema: 'light', espera: 'light' },
];
const PAGINAS = [
  ['portada', '/combustibles/gasolina'],
  ['404', '/combustibles/otra-cosa'],
];
let fallos = 0;
try {
  for (const [nombre, ruta] of PAGINAS) {
    for (const caso of CASOS) {
      // `tema` de la librería guarda la elección y emula el sistema: aquí van por separado.
      const p = await pagina(c, {
        origen: srv.origen,
        ancho: 390,
        tema: caso.sistema,
        gps: null,
        antesDeCargar: `try { localStorage.setItem('masfacil-theme', ${JSON.stringify(caso.guardado)}); } catch {}`,
        interceptar: [
          { patron: '*/assets/index-*.js', accion: 'retener' },
          { patron: '*/assets/404-*.js', accion: 'retener' },
        ],
      });
      await p.ir(ruta);
      await p.esperar(
        `document.readyState !== 'loading' && getComputedStyle(document.documentElement).backgroundColor !== 'rgba(0, 0, 0, 0)'`,
      );
      await p.evalua('new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(1))))');
      await dormir(150);
      const r = await p.evalua(
        `({ tema: document.documentElement.dataset.theme, fondo: getComputedStyle(document.documentElement).backgroundColor, barra: document.querySelector('meta[name="theme-color"]')?.content })`,
      );
      const meta = await p.evalua(
        `(() => { const m = document.querySelector('meta[name="theme-color"]'); return m?.dataset?.[${JSON.stringify(caso.espera)}] ?? null; })()`,
      );
      if (SALIDA)
        fs.writeFileSync(
          path.join(SALIDA, `${nombre}-${caso.guardado}-sistema-${caso.sistema}.png`),
          await p.captura({ completa: false }),
        );
      const bien = r.tema === caso.espera && meta !== null && r.barra === meta;
      fallos += !bien;
      console.log(
        `${bien ? '✔' : '✖'} ${nombre} · guardado ${caso.guardado} · sistema ${caso.sistema} → data-theme ${r.tema ?? '—'} (espera ${caso.espera}) · fondo ${r.fondo} · theme-color ${r.barra}${meta ? '' : ' (sin data-*)'}`,
      );
      await p.cerrar();
    }
  }
} finally {
  await c.cerrar();
  await srv.cerrar();
}
console.log(
  fallos
    ? `PRIMER CUADRO: ${fallos} casos con el tema equivocado`
    : 'PRIMER CUADRO OK: el tema y la barra son los correctos antes de que arranque la app',
);
process.exitCode = fallos ? 1 : 0;
