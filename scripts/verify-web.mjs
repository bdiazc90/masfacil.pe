#!/usr/bin/env node

// Verifica lo que se va a publicar: el bundle de datos, que el CLIENTE nuevo lo
// acepte, que la precache derivada esté al día y que los logos registrados
// existan, sean SVG saneado y viajen en esa precache.
//
//   npm run verify:web                      árbol local
//   npm run verify:web -- --origin <url>     además, contra el origen público
//
// `verifyWeb` es una función: `prepareRelease` la llama en proceso y este guion
// solo imprime o lanza. La comprobación con el contrato del cliente es la que
// faltaba: `web/` y `pipeline/` mantienen a mano dos copias del mismo contrato
// y nada las comparaba, así que un cliente nuevo podía publicarse sobre un
// bundle que él mismo iba a rechazar.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';
import { validateGasolinaManifest as clienteAceptaManifest, validGasolinaBundle as clienteAceptaBundle } from '../web/gasolina-contract.js';
import { BRAND_LOGOS } from '../web/brand-logos.js';
import { shellManifestProblems } from '../pipeline/shell-manifest.mjs';
import { brandAssetProblems, serviceWorkerUpdateProblems } from '../app/shell-assets.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{root?: string, origin?: string|null}} [entrada]
 * @returns {Promise<{errors: string[], notas: string[], summary: string}>}
 */
export async function verifyWeb({ root = rootFromModule, origin = null } = {}) {
  const dataRoot = path.join(root, 'web', 'data', 'gasolina');
  const errors = [];
  const notas = [];

  // 1. Bundle de datos, con el contrato de servidor.
  const manifestPath = path.join(dataRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Falta web/data/gasolina/manifest.json; ejecuta npm run project o npm run fetch:live -- <url de Pages>');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  errors.push(...validateGasolinaManifest(manifest));
  const refreshPath = path.join(dataRoot, 'refresh-state.json');
  if (!fs.existsSync(refreshPath)) errors.push('falta refresh-state gasolina');
  else errors.push(...validateGasolinaRefreshState(JSON.parse(fs.readFileSync(refreshPath, 'utf8')), manifest));

  const cuerpos = {};
  for (const key of GASOLINA_KEYS) {
    const descriptor = manifest.products?.[key];
    const snapshot = descriptor && path.join(root, 'web', descriptor.dataset_url);
    if (!snapshot || !fs.existsSync(snapshot)) { errors.push(`falta snapshot ${key}`); continue; }
    cuerpos[key] = fs.readFileSync(snapshot, 'utf8');
    errors.push(...validateGasolinaBundle(manifest, key, cuerpos[key]));
  }

  // 2. Compatibilidad cliente ↔ datos: si el cliente que se publica no acepta el
  // bundle que se publica con él, no se publica ninguno de los dos.
  if (!clienteAceptaManifest(manifest)) errors.push('el cliente nuevo rechaza el manifest del bundle');
  for (const key of GASOLINA_KEYS) {
    if (cuerpos[key] === undefined) continue;
    if (!(await clienteAceptaBundle(manifest, key, cuerpos[key]))) errors.push(`el cliente nuevo rechaza el snapshot ${key}`);
  }

  // 3. Precache: se DERIVA aquí y se compara con el módulo generado en disco.
  // Verificar no genera: publicar con un manifest viejo sería publicar un
  // `addAll` que no corresponde al árbol, y cache-first no lo corregiría nunca.
  const shell = shellManifestProblems({ root });
  errors.push(...shell.problems);
  // El bump solo llega si sw.js importa el módulo generado: el navegador
  // reinstala el service worker por sus bytes y los de sus imports.
  errors.push(...serviceWorkerUpdateProblems(fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8')));

  // 4. Logos registrados: registro → archivo → SVG válido → precache.
  errors.push(...brandAssetProblems({
    brandLogos: BRAND_LOGOS,
    shellList: shell.derived.entries,
    read: (ruta) => {
      const archivo = path.join(root, 'web', ruta.replace(/^\//, ''));
      if (!fs.existsSync(archivo)) return { ok: false };
      return { ok: true, body: fs.readFileSync(archivo, 'utf8') };
    },
  }));

  // 5. Contra el origen público: una ruta inexistente puede responder 200 con
  // HTML, así que se mira el tipo y el contenido, no solo que llegue respuesta.
  if (origin) {
    const respuestas = new Map();
    for (const entry of Object.values(BRAND_LOGOS)) {
      const ruta = `/icons/brands/${entry.slug}.svg`;
      try {
        const response = await fetch(new URL(ruta, origin), { redirect: 'error', cache: 'no-store' });
        respuestas.set(ruta, response.ok ? { ok: true, body: await response.text(), contentType: response.headers.get('content-type') ?? '' } : { ok: false });
      } catch (error) { respuestas.set(ruta, { ok: false, error: error.message }); }
    }
    errors.push(...brandAssetProblems({ brandLogos: BRAND_LOGOS, shellList: shell.derived.entries, read: (ruta) => respuestas.get(ruta) }).map((motivo) => `origen público · ${motivo}`));
  }

  const summary = `Bundles gasolina válidos: ${manifest.revision_id} · Regular ${manifest.products?.regular?.bytes} bytes · Premium ${manifest.products?.premium?.bytes} bytes · cliente compatible · ${Object.keys(BRAND_LOGOS).length} logos registrados en ${shell.derived.cache} (${shell.derived.entries.length} entradas)`;
  return { errors: [...new Set(errors)], notas, summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const originFlag = process.argv.indexOf('--origin');
  const { errors, notas, summary } = await verifyWeb({ origin: originFlag >= 0 ? process.argv[originFlag + 1] : null });
  if (errors.length) throw new Error(errors.join('; '));
  for (const nota of notas) process.stdout.write(`Nota: ${nota}\n`);
  process.stdout.write(`${summary}\n`);
}
