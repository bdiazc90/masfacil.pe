#!/usr/bin/env node

// Verifica lo que se va a publicar: el bundle de datos, que el CLIENTE nuevo lo
// acepte, que la precache derivada esté al día y que los logos registrados
// existan, sean SVG saneado y viajen en esa precache.
//
//   npm run verify:web                      árbol local
//   npm run verify:web -- --origin <url>     además, contra el origen público
//
// `verifyWeb` es una función: `prepareRelease` la llama en proceso y este guion
// solo imprime o lanza. Las reglas del contrato son un solo módulo
// (`web/lib/bundle-contract.js`), pero cada entorno calcula su huella —Node con
// `node:crypto`, el navegador con `crypto.subtle`— y el cliente se publica junto
// con los datos: por eso se sigue comprobando que el cliente nuevo acepte el
// bundle que viaja con él, y no solo que el productor lo dé por bueno.
//
// Con `--origin` se mira además lo que de verdad sirve el origen: el bundle
// servido, validado en memoria sin tocar `web/data/`, y el shell publicado,
// archivo por archivo, contra este árbol. Es la comprobación posterior al deploy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';
import { validateGasolinaManifest as clienteAceptaManifest, validGasolinaBundle as clienteAceptaBundle } from '../web/gasolina-contract.js';
import { BRAND_LOGOS, brandAssets } from '../web/brand-logos.js';
import { renderShellManifest, shellManifestProblems } from '../pipeline/shell-manifest.mjs';
import { fetchLiveBundle } from '../pipeline/live-bundle.mjs';
import { HISTORY_ORIGIN } from '../web/lib/history-contract.js';
import { appPaths, redirectRules, redirects } from '../web/lib/routes.js';
import { NOT_FOUND_MARKER, brandAssetProblems, notFoundPageProblems, serviceWorkerUpdateProblems, shellEntryFile } from '../app/shell-assets.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Problemas de un bundle con los dos contratos: el del productor y el del
 * cliente. Sirve igual para el árbol local y para los bytes que sirve el origen.
 *
 * @param {{manifest: object, state: object|undefined, bodies: Record<string, string|undefined>}} bundle
 */
async function bundleProblems({ manifest, state, bodies }) {
  const errors = [...validateGasolinaManifest(manifest)];
  if (state === undefined) errors.push('falta refresh-state gasolina');
  else errors.push(...validateGasolinaRefreshState(state, manifest));
  for (const key of GASOLINA_KEYS) {
    if (bodies[key] === undefined) { errors.push(`falta snapshot ${key}`); continue; }
    errors.push(...validateGasolinaBundle(manifest, key, bodies[key]));
  }
  // Si el cliente que se publica no acepta el bundle que se publica con él, no
  // se publica ninguno de los dos.
  if (!clienteAceptaManifest(manifest)) errors.push('el cliente nuevo rechaza el manifest del bundle');
  for (const key of GASOLINA_KEYS) {
    if (bodies[key] === undefined) continue;
    if (!(await clienteAceptaBundle(manifest, key, bodies[key]))) errors.push(`el cliente nuevo rechaza el snapshot ${key}`);
  }
  return errors;
}

/** Módulos relativos que alcanza `entrada` por imports estáticos, dentro de `web/`. */
function grafoDeModulos(root, entrada) {
  const vistos = new Set();
  const pendientes = [entrada];
  while (pendientes.length) {
    const relativo = pendientes.pop();
    const archivo = path.join(root, 'web', relativo);
    if (vistos.has(relativo) || !fs.existsSync(archivo)) continue;
    vistos.add(relativo);
    for (const match of fs.readFileSync(archivo, 'utf8').matchAll(/\b(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      pendientes.push(path.posix.normalize(path.posix.join(path.posix.dirname(relativo), match[1])));
    }
  }
  return vistos;
}

// Direcciones que tienen que responder 404 con la página propia: la raíz de las
// vistas, las vistas no activadas y rutas inventadas. Ninguna puede ser la portada.
const NO_EXISTEN = Object.freeze(['/combustibles', '/combustibles/', '/combustibles/diesel', '/combustibles/glp', '/combustibles/gnv', '/combustibles/gasolina/otra', '/tipo-de-cambio']);

/**
 * La tabla de rutas contra un origen: la app en cada vista, cada 301 con su
 * destino exacto y 404 propio en lo demás. Sirve para producción y para el
 * servidor local, que tienen que responder lo mismo.
 */
export async function routeProblems(origin) {
  const problemas = [];
  const pedir = (ruta) => fetch(new URL(ruta, origin), { redirect: 'manual', cache: 'no-store' });
  for (const ruta of ['/', ...appPaths()]) {
    try {
      const response = await pedir(ruta);
      const cuerpo = await response.text();
      if (response.status !== 200 || !cuerpo.includes('src="/app.js"')) problemas.push(`ruta ${ruta} respondió ${response.status} sin la app`);
    } catch (error) { problemas.push(`ruta ${ruta}: ${error.message}`); }
  }
  for (const [desde, hacia] of redirects()) {
    try {
      const response = await pedir(desde);
      await response.arrayBuffer();
      const destino = response.headers.get('location');
      if (response.status !== 301 || !destino || new URL(destino, origin).pathname !== hacia) problemas.push(`ruta ${desde} respondió ${response.status} → ${destino ?? 'sin destino'} en vez de 301 → ${hacia}`);
    } catch (error) { problemas.push(`ruta ${desde}: ${error.message}`); }
  }
  for (const ruta of NO_EXISTEN) {
    try {
      const response = await pedir(ruta);
      const cuerpo = await response.text();
      if (response.status !== 404 || !cuerpo.includes(NOT_FOUND_MARKER)) problemas.push(`ruta ${ruta} respondió ${response.status} en vez de la 404 propia`);
    } catch (error) { problemas.push(`ruta ${ruta}: ${error.message}`); }
  }
  return problemas;
}

/**
 * @param {{root?: string, origin?: string|null}} [entrada]
 * @returns {Promise<{errors: string[], notas: string[], summary: string}>}
 */
export async function verifyWeb({ root = rootFromModule, origin = null } = {}) {
  const dataRoot = path.join(root, 'web', 'data', 'gasolina');
  const errors = [];
  const notas = [];

  // 1 y 2. Bundle de datos del árbol, con el contrato del productor y el del
  // cliente.
  const manifestPath = path.join(dataRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Falta web/data/gasolina/manifest.json; ejecuta npm run project o npm run fetch:live -- <url de Pages>');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const refreshPath = path.join(dataRoot, 'refresh-state.json');
  const cuerpos = {};
  for (const key of GASOLINA_KEYS) {
    const descriptor = manifest.products?.[key];
    const snapshot = descriptor && path.join(root, 'web', descriptor.dataset_url);
    if (snapshot && fs.existsSync(snapshot)) cuerpos[key] = fs.readFileSync(snapshot, 'utf8');
  }
  errors.push(...await bundleProblems({
    manifest,
    state: fs.existsSync(refreshPath) ? JSON.parse(fs.readFileSync(refreshPath, 'utf8')) : undefined,
    bodies: cuerpos,
  }));

  // 3. Precache: se DERIVA aquí y se compara con el módulo generado en disco.
  // Verificar no genera: publicar con un manifest viejo sería publicar un
  // `addAll` que no corresponde al árbol, y cache-first no lo corregiría nunca.
  const shell = shellManifestProblems({ root });
  errors.push(...shell.problems);
  // El bump solo llega si sw.js importa el módulo generado: el navegador
  // reinstala el service worker por sus bytes y los de sus imports.
  errors.push(...serviceWorkerUpdateProblems(fs.readFileSync(path.join(root, 'web', 'sw.js'), 'utf8')));
  // El catálogo y las reglas del contrato se comparten con la proyección, así que
  // es fácil que algo de Node se cuele. Ningún módulo que cargue el navegador
  // puede importar `node:`: la página fallaría y el service worker ni siquiera se
  // instalaría. `sw.js` no está en la precache —se sirve aparte—, por eso su grafo
  // se recorre desde él; y en ese grafo tampoco cabe un import dinámico, que un
  // service worker no admite.
  const grafoDelSw = grafoDeModulos(root, 'sw.js');
  const delNavegador = new Set([...shell.derived.entries.filter((entry) => entry.endsWith('.js')).map((entry) => entry.slice(1)), ...grafoDelSw]);
  for (const relativo of delNavegador) {
    const archivo = path.join(root, 'web', relativo);
    if (fs.existsSync(archivo) && /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]node:/.test(fs.readFileSync(archivo, 'utf8'))) errors.push(`web/${relativo} importa un módulo node:, que el navegador no puede cargar`);
  }
  for (const relativo of grafoDelSw) {
    if (/\bimport\s*\(/.test(fs.readFileSync(path.join(root, 'web', relativo), 'utf8'))) errors.push(`web/${relativo} usa un import dinámico, que el service worker no admite`);
  }

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
  if (!shell.derived.entries.includes('/404.html')) errors.push('/404.html no está en la precache derivada: sin red no habría 404 propia');

  // 6b. Las reglas del hosting son las de la tabla de rutas, una a una y en el
  // mismo orden: el cliente, el service worker y el servidor local usan la tabla.
  const reglas = fs.readFileSync(path.join(root, 'web', '_redirects'), 'utf8').split('\n')
    .map((linea) => linea.trim().replace(/\s+/g, ' ')).filter((linea) => linea && !linea.startsWith('#'));
  if (JSON.stringify(reglas) !== JSON.stringify(redirectRules())) errors.push('web/_redirects no coincide con la tabla de web/lib/routes.js');

  // 7. Contra el origen público. Se mira el tipo y el contenido de cada
  // respuesta, no solo que llegue: un 200 con HTML donde iba un SVG es un fallo.
  let servido = null;
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

    // 8. El bundle que de verdad se sirve, no la copia local: se lee con la misma
    // lectura coherente que usa CI —manifest releído al final— y se valida en
    // memoria con los dos contratos. `web/data/` no se toca.
    try {
      const vivo = await fetchLiveBundle({ origin });
      servido = vivo.revision_id;
      const problemas = await bundleProblems({ manifest: vivo.manifest, state: JSON.parse(vivo.stateText), bodies: vivo.bodies });
      errors.push(...problemas.map((motivo) => `origen público · bundle servido · ${motivo}`));
    } catch (error) { errors.push(`origen público · no se pudo leer un bundle servido coherente: ${error.message}`); }

    // 9. El shell publicado. La precache que sirve el origen tiene que ser la
    // derivada de este árbol y cada archivo, byte a byte, el de este árbol: así se
    // sabe que el deploy subió este commit entero y no una mezcla. `sw.js` va
    // aparte porque no está en la precache. La única alteración que se descuenta
    // es el bloque que Pages Analytics inyecta en el HTML servido, delimitado por
    // su propio comentario; cualquier otra diferencia cuenta.
    const sinAnalytics = (bytes) => Buffer.from(bytes.toString('utf8').replace(/<!-- Cloudflare Pages Analytics -->[\s\S]*?<!-- Cloudflare Pages Analytics -->/g, ''));
    const publicados = [...shell.derived.entries, '/sw.js', '/shell-manifest.js'];
    const comparados = await Promise.all(publicados.map(async (entry) => {
      try {
        // `/404.html` es la única entrada que Pages redirige (308 a `/404`).
        const response = await fetch(new URL(entry, origin), { redirect: entry === '/404.html' ? 'follow' : 'error', cache: 'no-store' });
        if (!response.ok) return `origen público · shell · ${entry} respondió ${response.status}`;
        const recibido = Buffer.from(await response.arrayBuffer());
        const bytes = (response.headers.get('content-type') ?? '').startsWith('text/html') ? sinAnalytics(recibido) : recibido;
        const local = entry === '/shell-manifest.js' ? Buffer.from(renderShellManifest(shell.derived)) : fs.readFileSync(path.join(root, shellEntryFile(entry)));
        return bytes.equals(local) ? null : `origen público · shell · ${entry} no coincide con este árbol`;
      } catch (error) { return `origen público · shell · ${entry}: ${error.message}`; }
    }));
    errors.push(...comparados.filter(Boolean));

    // 10. Las rutas, tal como responde el origen.
    errors.push(...(await routeProblems(origin)).map((motivo) => `origen público · ${motivo}`));
  }

  const variantes = [...brandAssets(BRAND_LOGOS)].length;
  const publico = origin ? ` · origen: bundle ${servido ?? 'sin leer'} y shell ${shell.derived.cache}` : '';
  const summary = `Bundles gasolina válidos: ${manifest.revision_id} · Regular ${manifest.products?.regular?.bytes} bytes · Premium ${manifest.products?.premium?.bytes} bytes · cliente compatible · ${Object.keys(BRAND_LOGOS).length} marcas y ${variantes} activos registrados en ${shell.derived.cache} (${shell.derived.entries.length} entradas)${publico}`;
  return { errors: [...new Set(errors)], notas, summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const originFlag = process.argv.indexOf('--origin');
  const { errors, notas, summary } = await verifyWeb({ origin: originFlag >= 0 ? process.argv[originFlag + 1] : null });
  if (errors.length) throw new Error(errors.join('; '));
  for (const nota of notas) process.stdout.write(`Nota: ${nota}\n`);
  process.stdout.write(`${summary}\n`);
}
