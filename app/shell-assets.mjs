/**
 * Reglas del shell publicado: saneamiento de SVG y coherencia entre el registro
 * de marcas, los archivos en disco y la precache del service worker.
 *
 * Viven aquí porque las usan dos consumidores: el instalador de logos, que
 * decide si un archivo entra, y el verificador, que decide si lo que ya entró
 * sigue siendo publicable.
 */

import path from 'node:path';
import { ASSET_FILE_PATTERN, brandAssets } from '../web/brand-logos.js';

// Lo que se publica no debe depender de un tercero ni poder pedirle nada. El
// bloqueo de <image> cubre además el bitmap incrustado presentado como
// vectorización.
const PROHIBIDOS = Object.freeze([
  [/<\s*(?:script|foreignObject|image|iframe|audio|video|animate|set)\b/i, 'elemento no permitido'],
  [/\son[a-z]+\s*=/i, 'manejador de eventos'],
  [/(?:xlink:)?href\s*=\s*["'](?!#)/i, 'referencia externa'],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'recurso remoto en un estilo'],
  [/<!ENTITY|<!DOCTYPE/i, 'entidad o DOCTYPE'],
]);

// Procedencias admitidas. Un activo oficial y una recreación fiel se publican
// igual, pero no se llaman igual: la recreación no se declara oficial.
export const SOURCE_KINDS = Object.freeze(['official_asset', 'faithful_recreation', 'owner_supplied']);

/** Problemas de un SVG, vacío si es publicable. */
export function svgProblems(text) {
  const problemas = [];
  for (const [patron, motivo] of PROHIBIDOS) if (patron.test(text)) problemas.push(motivo);
  if (!/^\s*<svg[\s>]/i.test(text)) problemas.push('no empieza por <svg>');
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(text)) problemas.push('falta el xmlns de SVG');
  return problemas;
}

/**
 * Procedencia declarada de una VARIANTE del registro de marcas.
 *
 * El nombre de archivo también es procedencia: sale del registro y se acota para
 * que una entrada no pueda apuntar fuera de `web/icons/brands/`.
 */
export function provenanceProblems(asset) {
  const problemas = [];
  if (!SOURCE_KINDS.includes(asset?.source_kind)) return [`source_kind ausente o desconocido: ${asset?.source_kind}`];
  if (!ASSET_FILE_PATTERN.test(asset?.file ?? '')) problemas.push(`file fuera de contrato: ${asset?.file}`);
  if (asset.source_kind === 'official_asset' && !/^https:\/\//.test(asset.source_url ?? ''))
    problemas.push('declarado oficial sin URL https de origen');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asset?.retrieved_at ?? '')) problemas.push('retrieved_at no es una fecha AAAA-MM-DD');
  return problemas;
}

/**
 * Comprueba el registro contra los archivos y la precache.
 *
 * Recorre EL REGISTRO con `brandAssets()`, no el directorio: un SVG presente en
 * `web/icons/brands/` y no registrado es correcto, no se pinta y no debe hacer
 * fallar nada. Exigir lo inverso obligaría a activar marcas para pasar la sonda.
 *
 * Es el mismo recorrido que deriva la precache y que elige el recurso en la
 * tarjeta: si una variante se registra, viaja, se sanea y se pinta por la misma
 * vía. No hay una segunda lista que se pueda desincronizar.
 *
 * @param {object} entrada
 * @param {object} entrada.brandLogos  BRAND_LOGOS del cliente
 * @param {string[]} entrada.shellList entradas de la precache
 * @param {(ruta: string) => {ok: boolean, body?: string, contentType?: string}} entrada.read
 */
export function brandAssetProblems({ brandLogos, shellList, read }) {
  const problemas = [];
  const precache = new Set(shellList);
  for (const { key, role, asset, path: ruta } of brandAssets(brandLogos)) {
    const donde = `${key}.${role}`;
    for (const motivo of provenanceProblems(asset)) problemas.push(`${donde}: ${motivo}`);
    if (!precache.has(ruta)) problemas.push(`${donde}: ${ruta} no está en la precache del service worker`);
    const recurso = read(ruta);
    if (!recurso?.ok) {
      problemas.push(`${donde}: ${ruta} no se pudo leer`);
      continue;
    }
    // Una ruta inexistente puede responder 200 con HTML; se comprueba el tipo y
    // el contenido, no solo que la respuesta llegue.
    if (recurso.contentType && !/image\/svg\+xml/i.test(recurso.contentType))
      problemas.push(`${donde}: ${ruta} respondió ${recurso.contentType} en vez de image/svg+xml`);
    for (const motivo of svgProblems(recurso.body ?? '')) problemas.push(`${donde}: ${ruta} ${motivo}`);
  }
  return problemas;
}

/** Archivo del árbol que respalda una entrada de la precache. */
export function shellEntryFile(entry) {
  return entry === '/' ? 'web/index.html' : `web/${entry.replace(/^\//, '')}`;
}

/**
 * La lógica del service worker lee la lista y la versión de la precache del
 * módulo generado `shell-manifest.js`. Un refactor que copie la lista dentro de
 * `sw-main.js` dejaría la precache fija aunque el shell cambiara.
 */
export function serviceWorkerUpdateProblems(swMainSource) {
  return /from\s+['"]\.\/shell-manifest\.js['"]/.test(swMainSource)
    ? []
    : ['sw-main.js no importa ./shell-manifest.js: la precache no seguiría al shell'];
}

// Declaraciones de import al inicio de línea: `import … from '…'`,
// `export … from '…'` e `import '…'`; el cuerpo puede ocupar varias líneas.
const DECLARACION = /^[ \t]*(?:import|export)\b(?:[^;'"]*?\bfrom)?[ \t]*(['"])([^'"\n]+)\1/gm;
// Lo que queda de un import después de quitar esas declaraciones y los
// comentarios: un import con otra forma o uno dinámico. `import.meta` no es
// una dependencia.
const RASTRO_DE_IMPORT = /\bimport\b(?!\s*\.\s*meta\b)|\bfrom\s*['"]/;
const sinComentarios = (fuente) => fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

/**
 * El grafo de módulos de un punto de entrada de `web/`, completo o con sus
 * problemas: cada dependencia se resuelve o se rechaza, ninguna se omite.
 *
 * Solo se admiten imports estáticos con ruta relativa que quede dentro de
 * `web/`. Un módulo que falta, otro tipo de especificador, un import dinámico
 * —que un service worker no admite— o un import escrito de otra forma son
 * problemas. Los módulos `generated` (rutas relativas a `web/`) se admiten sin
 * existir todavía y no se recorren: los escribe el mismo paso que deriva la
 * huella, y leerlos la haría circular.
 *
 * `read(relativo)` devuelve el texto del módulo, o `null` si no existe.
 * Devuelve los módulos ordenados, generados incluidos, y los problemas.
 */
export function moduleGraph({ entry, read, generated = [] }) {
  const generados = new Set(generated);
  const modulos = new Set([entry]);
  const problemas = [];
  const pendientes = [entry];
  if (read(entry) === null) problemas.push(`falta web/${entry}`);
  while (pendientes.length) {
    const relativo = pendientes.pop();
    const fuente = generados.has(relativo) ? null : read(relativo);
    if (fuente === null) continue;
    for (const [, , especificador] of fuente.matchAll(DECLARACION)) {
      if (!/^\.{1,2}\//.test(especificador)) {
        problemas.push(`web/${relativo}: import no admitido «${especificador}»; solo rutas relativas dentro de web/`);
        continue;
      }
      const destino = path.posix.normalize(path.posix.join(path.posix.dirname(relativo), especificador));
      if (destino === '..' || destino.startsWith('../')) {
        problemas.push(`web/${relativo}: «${especificador}» sale de web/`);
        continue;
      }
      if (modulos.has(destino)) continue;
      if (!generados.has(destino) && read(destino) === null) {
        problemas.push(`web/${relativo} importa «${especificador}», que no existe`);
        continue;
      }
      modulos.add(destino);
      pendientes.push(destino);
    }
    const resto = sinComentarios(fuente.replace(DECLARACION, ''));
    if (/\bimport\s*\(/.test(resto))
      problemas.push(`web/${relativo} usa un import dinámico, que el service worker no admite`);
    else if (RASTRO_DE_IMPORT.test(resto))
      problemas.push(`web/${relativo} tiene un import que no se reconoce; va al inicio de su línea`);
  }
  // Por unidades de código: el orden entra en la huella y no puede depender del ICU.
  return { modules: [...modulos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), problems: problemas };
}

/**
 * El beacon de Cloudflare Web Analytics, la única fuente de scripts ajena a
 * `'self'` que admite la CSP. Lo inyecta Pages en cada HTML; la app no lo carga
 * por su cuenta. Cuenta visitas sin cookies (decisión de Bruno, 23/09/2026).
 */
export const ANALYTICS_BEACON = 'https://static.cloudflareinsights.com/beacon.min.js';

/**
 * Adonde envía el beacon. La etiqueta de Pages solo declara el token, y sin
 * `send.to` ni `version` el beacon manda las visitas a este endpoint, no al
 * `/cdn-cgi/rum` del propio dominio: con `connect-src` sin él, el script carga
 * y el envío queda bloqueado (comprobado el 23/09/2026 con el beacon publicado).
 * Se autoriza la ruta exacta, no el host.
 */
export const ANALYTICS_ENDPOINT = 'https://cloudflareinsights.com/cdn-cgi/rum';

/** Texto que identifica la página 404 propia, también cuando se lee desde el origen público. */
export const NOT_FOUND_MARKER = 'No encontramos esta página';

/** El bloque que Pages Analytics inyecta en cada HTML servido, delimitado por su propio comentario. */
export const withoutPagesAnalytics = (html) =>
  html.replace(/<!-- Cloudflare Pages Analytics -->[\s\S]*?<!-- Cloudflare Pages Analytics -->/g, '');

const sinComentariosHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/**
 * Lo que un HTML hace cargar: hojas, módulos, precargas, manifiesto, iconos e
 * imágenes (`link href`, `script src`, `img src`). Un `<a>` es navegación, no un
 * recurso. Lee el HTML que escribe este proyecto y el que emite Vite: atributos
 * entre comillas.
 *
 * @returns {{tag: string, rel: string|null, type: string|null, url: string}[]}
 */
export function htmlResources(html) {
  const recursos = [];
  for (const [, etiqueta, atributos] of sinComentariosHtml(html).matchAll(/<(link|script|img)\b([^>]*)>/gi)) {
    const attr = Object.fromEntries(
      [...atributos.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, nombre, doble, simple]) => [
        nombre.toLowerCase(),
        doble ?? simple,
      ]),
    );
    const tag = etiqueta.toLowerCase();
    const url = tag === 'link' ? attr.href : attr.src;
    if (url !== undefined) recursos.push({ tag, rel: attr.rel ?? null, type: attr.type ?? null, url });
  }
  return recursos;
}

/**
 * Un recurso de un HTML publicado es propio, absoluto y existe. Relativo, desde
 * `/combustibles/gasolina` se pediría bajo esa ruta; ajeno, la CSP no lo dejaría
 * cargar. Con `precache`, además tiene que viajar en ella: sin red, la página lo
 * necesita igual.
 *
 * @param {string} nombre  para el mensaje
 * @param {string} html
 * @param {{exists: (ruta: string) => boolean, precache?: Set<string>|null}} opciones
 */
export function htmlResourceProblems(nombre, html, { exists, precache = null }) {
  const problemas = [];
  for (const { url } of htmlResources(html)) {
    if (url.startsWith('data:')) continue;
    if (url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
      problemas.push(`${nombre} carga un recurso ajeno: ${url}`);
      continue;
    }
    if (!url.startsWith('/')) {
      problemas.push(`${nombre} carga ${url} con ruta relativa; desde /combustibles/… se pediría otra ruta`);
      continue;
    }
    const ruta = url.replace(/[?#].*$/, '');
    if (!exists(ruta)) problemas.push(`${nombre} carga ${ruta}, que no existe`);
    else if (precache && !precache.has(ruta))
      problemas.push(`${nombre} carga ${ruta}, que no está en la precache: sin red faltaría`);
  }
  return problemas;
}

/**
 * La CSP del sitio (`style-src 'self'`, `script-src 'self'`) bloquea estilos y
 * scripts en línea: no darían error de publicación, solo una página rota en
 * silencio.
 */
export function inlineProblems(nombre, html) {
  const limpio = sinComentariosHtml(html);
  const problemas = [];
  if (/<style\b/i.test(limpio) || /\sstyle\s*=/i.test(limpio))
    problemas.push(`${nombre} lleva estilos en línea; la CSP los bloquearía`);
  if (/<script\b(?![^>]*\bsrc\s*=)/i.test(limpio))
    problemas.push(`${nombre} lleva un script en línea; la CSP lo bloquearía`);
  return problemas;
}

/**
 * La página 404 se verifica por lo que usa, no por nombres de archivo: tiene que
 * funcionar bajo la CSP, llevar a la portada —para eso existe— y cargar su hoja
 * y su módulo de tema, sin el cual sería siempre clara. Que esos recursos existan
 * y viajen en la precache lo comprueba `htmlResourceProblems`.
 *
 * @param {string} html  contenido de web/404.html
 * @returns {string[]}
 */
export function notFoundPageProblems(html) {
  const problems = [];
  if (!html.includes(NOT_FOUND_MARKER)) problems.push(`404.html no contiene «${NOT_FOUND_MARKER}»`);
  if (!/href="\/"/.test(html)) problems.push('404.html no enlaza a la portada (href="/")');
  const recursos = htmlResources(html);
  if (!recursos.some(({ tag, rel }) => tag === 'link' && rel === 'stylesheet'))
    problems.push('404.html no carga ninguna hoja de estilos');
  if (!recursos.some(({ tag, type }) => tag === 'script' && type === 'module'))
    problems.push('404.html no carga ningún módulo: quedaría sin tema');
  problems.push(...inlineProblems('404.html', html));
  return problems;
}
