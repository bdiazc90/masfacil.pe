// Compilación de la interfaz. Las fuentes viven en `ui/`; el resultado llega a
// `web/`, la raíz publicada, SOLO por `pipeline/ui-build.mjs`: compila en un
// staging, lo comprueba y reemplaza por inventario lo que es suyo. Vite nunca
// escribe en `web/`.
//
//   npm run build   compila, instala y deriva la precache
//   npm run dev     servidor de desarrollo con HMR, sin service worker
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(raiz, 'ui');
const web = path.join(raiz, 'web');

export default defineConfig({
  // Tailwind compila `ui/styles.css` (sus utilidades salen solo de `ui/`); JSX de
  // la interfaz y, en `npm run dev`, recarga que conserva el estado.
  plugins: [tailwindcss(), react()],
  root: ui,
  base: '/',
  // `web/` como publicDir solo para resolver: Vite deja sin tocar `/icons/…` y
  // `/manifest.webmanifest` en el HTML y, en desarrollo, sirve los datos. Nunca
  // se copia; la salida es solo lo que se compila.
  publicDir: web,
  // Ni `.env` ni variables del entorno viajan al cliente.
  envDir: false,
  // Sin buscar configuración de PostCSS fuera del repositorio.
  css: { postcss: {} },
  appType: 'spa',
  // En desarrollo solo se leen `ui/` y `web/`: `.local-cache/` tiene material
  // privado y no se sirve ni en localhost.
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { strict: true, allow: [ui, web] } },
  build: {
    // Fuera de `web/`: un `vite build` suelto no puede pisar lo publicado.
    outDir: path.join(raiz, '.local-cache', 'ui-build', 'vite'),
    emptyOutDir: true,
    copyPublicDir: false,
    manifest: true,
    sourcemap: false,
    // Nada se incrusta como `data:`: la CSP (`font-src 'self'`) lo bloquearía.
    assetsInlineLimit: 0,
    // Sin minificar: `styles.css` llega tal cual (no lleva directivas de
    // Tailwind) y la parte de `tailwind.css` sale legible para auditarla.
    cssMinify: false,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: { index: path.join(ui, 'index.html'), 404: path.join(ui, '404.html') },
    },
  },
});
