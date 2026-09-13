/**
 * Almacén del histórico: contrato mínimo, semántica inmutable y elección de backend.
 *
 * La interfaz tiene `head`, `get`, `put` y `list`. **No tiene `delete`.** No es un
 * olvido: si borrar no existe en la forma, ningún camino puede borrar por error,
 * y el §5 del encargo pide justamente conservar sin borrado automático.
 *
 * El archivo es inmutable por CÓDIGO, no por el proveedor: el bucket no tiene
 * versionado ni object-lock. `putImmutable` es toda la garantía, y por eso ante
 * bytes distintos bajo la misma clave lanza en vez de sobrescribir.
 *
 * Todos los backends anteponen el mismo prefijo (`gasolina/` por defecto) y lo
 * quitan al listar: quien usa el almacén nunca lo ve. Un bucket, un utilitario
 * por prefijo.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFsStore } from './store-fs.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** El resumen cambia cada pocas horas: caché corta y NUNCA `immutable`. */
export const SUMMARY_CACHE_CONTROL = 'public, max-age=300';
/**
 * Las cinco obligatorias del almacén S3. Se llaman `DATOS_*` porque describen el
 * bucket compartido de `datos.masfacil.pe`, no este utilitario: un utilitario
 * futuro reutiliza las mismas y solo aporta su prefijo (`HISTORY_S3_PREFIX` aquí).
 */
export const S3_VARIABLES = Object.freeze(['DATOS_S3_ENDPOINT', 'DATOS_S3_REGION', 'DATOS_S3_BUCKET', 'DATOS_S3_ACCESS_KEY_ID', 'DATOS_S3_SECRET_ACCESS_KEY']);
export const DEFAULT_PREFIX = 'gasolina/';
/** Tope de páginas al listar: una lista parcial silenciosa es peor que un fallo. */
const MAX_PAGINAS = 50;

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Escribe un objeto que no puede cambiar nunca.
 *
 * Repetir los mismos bytes es idempotente y no escribe. Encontrar bytes
 * distintos bajo la misma clave es un error que se cuenta, no se resuelve
 * pisando lo que ya estaba.
 *
 * @returns {Promise<{written: boolean, reused: boolean, sha256: string}>}
 */
export async function putImmutable(store, key, body, { contentType = JSON_CONTENT_TYPE, cacheControl = IMMUTABLE_CACHE_CONTROL } = {}) {
  const huella = sha256(body);
  const { created } = await store.put(key, body, { contentType, cacheControl, metaSha256: huella, ifAbsent: true });
  if (created) return { written: true, reused: false, sha256: huella };

  // Ya existía. Se compara por la huella guardada como metadato y, si el
  // proveedor no la devuelve, por el hash del cuerpo leído. Nunca por el ETag:
  // solo es MD5 en subidas de una sola parte y su valor es opaco por contrato.
  const cabecera = await store.head(key);
  const existente = cabecera?.sha256 ?? (await store.get(key))?.sha256 ?? null;
  if (existente === huella) return { written: false, reused: true, sha256: huella };
  throw new Error(`Objeto inmutable con bytes distintos bajo la misma clave: ${key} (guardado ${existente ?? 'desconocido'}, nuevo ${huella}). No se sobrescribe ni se borra. Revisa qué corrida lo escribió; si el contenido nuevo es legítimo, archívalo bajo su propio archive_hash.`);
}

/** El resumen es el único objeto que se reemplaza. Las guardas anti-retroceso viven en quien llama. */
export async function putMutable(store, key, body, { contentType = JSON_CONTENT_TYPE, cacheControl = SUMMARY_CACHE_CONTROL } = {}) {
  await store.put(key, body, { contentType, cacheControl, metaSha256: sha256(body), ifAbsent: false });
  return { written: true, sha256: sha256(body) };
}

/**
 * Todas las claves de un prefijo, agotando el cursor.
 *
 * El bucle es obligatorio: una página suelta parece una lista completa y haría
 * que el resumen perdiera observaciones sin decirlo.
 */
export async function listAll(store, prefix, { limit } = {}) {
  const claves = [];
  let cursor = null;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const salida = await store.list({ prefix, cursor, limit });
    claves.push(...salida.keys);
    cursor = salida.cursor;
    if (!cursor) return claves;
  }
  throw new Error(`El listado de ${prefix} superó ${MAX_PAGINAS} páginas; se prefiere fallar antes que devolver una lista parcial`);
}

/** Raíz por defecto de las copias de trabajo locales; siempre fuera de Git. */
function defaultHistoryRoot(root = rootFromModule) {
  return path.join(root, '.local-cache', 'history');
}

/**
 * Elige backend por entorno.
 *
 * `store-s3.mjs` se importa de forma DINÁMICA y solo en su rama: sin credenciales
 * ese módulo ni se carga, así que una sonda puede demostrar que no pidió acceso
 * ni salió a la red en vez de prometerlo.
 *
 * @returns {Promise<object>} el almacén, con `kind` `'fs'` o `'s3'`
 */
export async function createHistoryStore({ env = process.env, root = rootFromModule } = {}) {
  const forzado = env.HISTORY_STORE ?? null;
  // Vacío cuenta como ausente: en Actions una variable no definida llega como "".
  const prefix = env.HISTORY_S3_PREFIX || DEFAULT_PREFIX;
  const raiz = env.HISTORY_STORE_ROOT ? path.resolve(env.HISTORY_STORE_ROOT) : defaultHistoryRoot(root);
  if (forzado === 'fs') return createFsStore({ root: raiz, prefix });

  const faltan = S3_VARIABLES.filter((nombre) => !env[nombre]);
  if (forzado === 's3' || faltan.length === 0) {
    if (faltan.length) throw new Error(`Faltan variables del almacén S3: ${faltan.join(', ')}`);
    const { createS3Store } = await import('./store-s3.mjs');
    return createS3Store({
      endpoint: env.DATOS_S3_ENDPOINT,
      region: env.DATOS_S3_REGION,
      bucket: env.DATOS_S3_BUCKET,
      prefix,
      accessKeyId: env.DATOS_S3_ACCESS_KEY_ID,
      secretAccessKey: env.DATOS_S3_SECRET_ACCESS_KEY,
    });
  }
  // Una configuración a medias es un error, no un silencioso «pues a disco»:
  // creerse que se está escribiendo en el bucket y no estarlo es el peor de los dos.
  if (faltan.length < S3_VARIABLES.length) throw new Error(`Configuración del almacén S3 incompleta: faltan ${faltan.join(', ')}. Defínelas todas o usa HISTORY_STORE=fs`);
  if (env.HISTORY_STORE_ROOT === undefined) process.stdout.write(`Sin almacén S3 configurado: el histórico usa ${path.relative(root, raiz) || raiz}\n`);
  return createFsStore({ root: raiz, prefix });
}
