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
import { BRAND_LOGOS, brandAssets } from '../web/brand-logos.js';
import { shellManifestProblems } from '../pipeline/shell-manifest.mjs';
import { HISTORY_ORIGIN } from '../web/lib/history-contract.js';
import { NOT_FOUND_MARKER, brandAssetProblems, notFoundPageProblems, serviceWorkerUpdateProblems } from '../app/shell-assets.mjs';

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

  // 4. Activos de marca registrados: registro → archivo → SVG válido → precache.
  errors.push(...brandAssetProblems({
    brandLogos: BRAND_LOGOS,
    shellList: shell.derived.entries,
    read: (ruta) => {
      const archivo = path.join(root, 'web', ruta.replace(/^\//, ''));
      if (!fs.existsSync(archivo)) return { ok: false };
      return { ok: true, body: fs.readFileSync(archivo, 'utf8') };
    },
  }));

  // 5. El origen del histórico vive en DOS sitios —la constante que usa el
  // cliente y la CSP que lo autoriza— y si divergen el gráfico funciona en local
  // y muere en producción con un error de consola que nadie ve. Se cruzan, igual
  // que el paso 2 cruza cliente y datos.
  const cabeceras = fs.readFileSync(path.join(root, 'web', '_headers'), 'utf8');
  const connectSrc = /connect-src ([^;]+);/.exec(cabeceras)?.[1] ?? '';
  if (!connectSrc.split(/\s+/).includes(HISTORY_ORIGIN)) errors.push(`web/_headers no autoriza ${HISTORY_ORIGIN} en connect-src; el navegador bloquearía el histórico`);
  // Y tiene que ser CROSS-ORIGIN: es lo que hace que el service worker lo ignore
  // (web/sw.js descarta lo que no es del propio origen) y que un JSON que cambia
  // cada pocas horas no acabe cacheado como si fuera parte del shell.
  if (origin && new URL(HISTORY_ORIGIN).origin === new URL(origin).origin) errors.push('el histórico no puede servirse desde el mismo origen que la app: el service worker lo cachearía como shell');

  // 6. La página 404 propia: sin ella Pages sirve la portada con 200 para toda
  // ruta desconocida. Tiene que existir, respetar la CSP y llevar su módulo en
  // la precache derivada.
  const notFoundPath = path.join(root, 'web', '404.html');
  if (!fs.existsSync(notFoundPath)) errors.push('falta web/404.html: Pages serviría la portada con 200 para cualquier ruta desconocida');
  else errors.push(...notFoundPageProblems(fs.readFileSync(notFoundPath, 'utf8')));
  if (!shell.derived.entries.includes('/404.js')) errors.push('/404.js no está en la precache derivada');

  // 7. Contra el origen público. Se mira el tipo y el contenido de cada
  // respuesta, no solo que llegue: un 200 con HTML donde iba un SVG es un fallo.
  if (origin) {
    // Una ruta que no existe tiene que responder 404 con la página propia; si
    // responde 200 con la portada, el 404.html no llegó al deploy.
    const inexistente = `/__verify-web/no-existe-${Date.now().toString(36)}`;
    try {
      const response = await fetch(new URL(inexistente, origin), { redirect: 'error', cache: 'no-store' });
      const tipo = response.headers.get('content-type') ?? '';
      const cuerpo = await response.text();
      if (response.status !== 404) errors.push(`origen público · ${inexistente} respondió ${response.status} en vez de 404`);
      if (!tipo.startsWith('text/html')) errors.push(`origen público · la página 404 respondió ${tipo || 'sin tipo'} en vez de text/html`);
      if (!cuerpo.includes(NOT_FOUND_MARKER)) errors.push('origen público · la respuesta 404 no es la página 404 propia');
    } catch (error) { errors.push(`origen público · no se pudo comprobar la página 404: ${error.message}`); }

    const respuestas = new Map();
    // Mismo recorrido que la precache y que la tarjeta: si una variante se
    // registra, la sonda pública la mira sin que haya que apuntarla aquí.
    for (const { path: ruta } of brandAssets(BRAND_LOGOS)) {
      try {
        const response = await fetch(new URL(ruta, origin), { redirect: 'error', cache: 'no-store' });
        respuestas.set(ruta, response.ok ? { ok: true, body: await response.text(), contentType: response.headers.get('content-type') ?? '' } : { ok: false });
      } catch (error) { respuestas.set(ruta, { ok: false, error: error.message }); }
    }
    errors.push(...brandAssetProblems({ brandLogos: BRAND_LOGOS, shellList: shell.derived.entries, read: (ruta) => respuestas.get(ruta) }).map((motivo) => `origen público · ${motivo}`));
  }

  const variantes = [...brandAssets(BRAND_LOGOS)].length;
  const summary = `Bundles gasolina válidos: ${manifest.revision_id} · Regular ${manifest.products?.regular?.bytes} bytes · Premium ${manifest.products?.premium?.bytes} bytes · cliente compatible · ${Object.keys(BRAND_LOGOS).length} marcas y ${variantes} activos registrados en ${shell.derived.cache} (${shell.derived.entries.length} entradas)`;
  return { errors: [...new Set(errors)], notas, summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const originFlag = process.argv.indexOf('--origin');
  const { errors, notas, summary } = await verifyWeb({ origin: originFlag >= 0 ? process.argv[originFlag + 1] : null });
  if (errors.length) throw new Error(errors.join('; '));
  for (const nota of notas) process.stdout.write(`Nota: ${nota}\n`);
  process.stdout.write(`${summary}\n`);
}
