/**
 * Lectura de una respuesta `ListObjectsV2` de la API compatible con S3.
 *
 * Vive aparte del backend a propósito: es una función pura, sin dependencias y
 * sin red, así que se puede comprobar sin instalar nada ni tener credenciales.
 * `store-s3.mjs` sí importa `aws4fetch`, y arrastrarlo hasta aquí obligaría a
 * cualquier sonda a instalar la dependencia para probar un parseo de texto.
 *
 * Sin parser de XML: la respuesta es acotada y bien conocida. La regla es fallar
 * ruidosamente antes que devolver una lista incompleta, porque una lista parcial
 * silenciosa haría que el resumen perdiera observaciones sin que nadie lo note.
 */

const textoEntre = (bloque, etiqueta) => bloque.match(new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`))?.[1] ?? null;

/**
 * @param {string} xml
 * @returns {{keys: Array<{key: string, bytes: number|null}>, cursor: string|null}}
 */
export function parseListResponse(xml) {
  const keys = [];
  for (const [, bloque] of String(xml).matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = textoEntre(bloque, 'Key');
    const size = Number(textoEntre(bloque, 'Size'));
    if (!key) throw new Error('Listado S3 con una entrada sin clave; se prefiere fallar antes que devolver una lista parcial');
    keys.push({ key, bytes: Number.isFinite(size) ? size : null });
  }
  const truncado = textoEntre(xml, 'IsTruncated') === 'true';
  const cursor = textoEntre(xml, 'NextContinuationToken');
  if (truncado && !cursor) throw new Error('Listado S3 truncado sin token de continuación; la lista estaría incompleta');
  return { keys, cursor: truncado ? cursor : null };
}
