/**
 * Reglas del shell publicado: saneamiento de SVG y coherencia entre el registro
 * de marcas, los archivos en disco y la precache del service worker.
 *
 * Viven aquí porque las usan dos consumidores: el instalador de logos, que
 * decide si un archivo entra, y el verificador, que decide si lo que ya entró
 * sigue siendo publicable.
 */

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

/** Procedencia declarada de una entrada del registro de marcas. */
export function provenanceProblems(entry) {
  const problemas = [];
  if (!SOURCE_KINDS.includes(entry?.source_kind)) return [`source_kind ausente o desconocido: ${entry?.source_kind}`];
  if (entry.source_kind === 'official_asset' && !/^https:\/\//.test(entry.source_url ?? '')) problemas.push('declarado oficial sin URL https de origen');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.retrieved_at ?? '')) problemas.push('retrieved_at no es una fecha AAAA-MM-DD');
  return problemas;
}

/**
 * Comprueba el registro contra los archivos y la precache.
 *
 * Recorre EL REGISTRO, no el directorio: un SVG presente en `web/icons/brands/`
 * y no registrado —Petroperú hoy— es correcto, no se pinta y no debe hacer
 * fallar nada. Exigir lo inverso obligaría a activar marcas para pasar la sonda.
 *
 * @param {object} entrada
 * @param {object} entrada.brandLogos  BRAND_LOGOS del cliente
 * @param {string[]} entrada.shellList entradas de la precache
 * @param {(ruta: string) => {ok: boolean, body?: string, contentType?: string}} entrada.read
 */
export function brandAssetProblems({ brandLogos, shellList, read }) {
  const problemas = [];
  const precache = new Set(shellList);
  for (const [clave, entry] of Object.entries(brandLogos)) {
    const ruta = `/icons/brands/${entry.slug}.svg`;
    for (const motivo of provenanceProblems(entry)) problemas.push(`${clave}: ${motivo}`);
    if (!precache.has(ruta)) problemas.push(`${clave}: ${ruta} no está en la precache del service worker`);
    const recurso = read(ruta);
    if (!recurso?.ok) { problemas.push(`${clave}: ${ruta} no se pudo leer`); continue; }
    // Una ruta inexistente puede responder 200 con HTML; se comprueba el tipo y
    // el contenido, no solo que la respuesta llegue.
    if (recurso.contentType && !/image\/svg\+xml/i.test(recurso.contentType)) problemas.push(`${clave}: ${ruta} respondió ${recurso.contentType} en vez de image/svg+xml`);
    for (const motivo of svgProblems(recurso.body ?? '')) problemas.push(`${clave}: ${ruta} ${motivo}`);
  }
  return problemas;
}

/** Archivo del árbol que respalda una entrada de la precache. */
export function shellEntryFile(entry) {
  return entry === '/' ? 'web/index.html' : `web/${entry.replace(/^\//, '')}`;
}

/**
 * El mecanismo de actualización: el navegador solo reinstala el service worker
 * cuando cambian sus bytes o los de sus imports. La lista y la versión de la
 * precache viven en el módulo generado `shell-manifest.js`, así que sw.js tiene
 * que importarlo para que un shell nuevo llegue a quien ya tiene caché. Un
 * refactor que copie la lista dentro de sw.js rompería eso en silencio.
 */
export function serviceWorkerUpdateProblems(swSource) {
  return /from\s+['"]\.\/shell-manifest\.js['"]/.test(swSource) ? [] : ['sw.js no importa ./shell-manifest.js: un shell nuevo no reinstalaría el service worker'];
}
