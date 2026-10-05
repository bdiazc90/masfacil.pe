#!/usr/bin/env node

// Construye lo que se publica, salvo los datos: compila la interfaz de `ui/`
// hacia `web/` y deriva la precache y `web/sw.js`. No descarga ni proyecta nada,
// y no necesita raws ni credenciales.
//
//   npm run build
//
// Verificar es otro paso (`npm run verify:web`): este no repara lo que falte.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { writeShellManifest } from '../pipeline/shell-manifest.mjs';
import { buildUi } from '../pipeline/ui-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

const ui = await buildUi({ root });
const shell = writeShellManifest({ root });
for (const relativo of Object.keys(ui.outputs)) {
  const bytes = fs.readFileSync(path.join(root, 'web', relativo));
  process.stdout.write(
    `web/${relativo}  ${kib(bytes.length)} · gzip ${kib(zlib.gzipSync(bytes, { level: 9 }).length)}\n`,
  );
}
const tailwind = ui.versions.tailwindcss ? ` · tailwindcss ${ui.versions.tailwindcss}` : '';
process.stdout.write(
  `Interfaz: vite ${ui.versions.vite} · rolldown ${ui.versions.rolldown}${tailwind} · ${Object.keys(ui.inputs).length} entradas\nPrecache derivada: ${shell.cache} · ${shell.entries.length} entradas\n`,
);
