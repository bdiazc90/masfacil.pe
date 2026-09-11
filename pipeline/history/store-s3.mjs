/**
 * Backend S3 del histórico, sobre la API compatible con S3 de cualquier proveedor.
 *
 * Hoy el bucket vive en Neon Object Storage; el código no lo sabe ni debe
 * saberlo: endpoint, región, bucket y prefijo entran como opciones, la firma es
 * SigV4 estándar y el direccionamiento es path-style (`endpoint/bucket/clave`),
 * el único que Neon admite. Cambiar de proveedor es cambiar variables.
 *
 * `aws4fetch` firma; el transporte es `fetch` nativo y se inyecta. Es la única
 * dependencia npm del proyecto y se importa SOLO desde aquí: ningún archivo de
 * `web/` la toca, así que sus bytes no llegan al navegador ni a la precache.
 * Este módulo se carga de forma dinámica desde `store.mjs`, así que sin
 * credenciales ni se evalúa.
 *
 * Lo que este backend NO puede prometer, y cómo se cubre:
 *
 * - No hay PUT condicional: Neon no documenta `If-None-Match`, así que «escribir
 *   si no estaba» es un HEAD y después un PUT. La carrera entre ambos la cierra
 *   el escritor único serializado del workflow, no el proveedor.
 * - No está documentado que HEAD/GET devuelvan los metadatos `x-amz-meta-*`.
 *   Se envían igual y, si no vuelven, la huella se recalcula del cuerpo leído.
 *   Nunca se usa el ETag: es opaco por contrato.
 *
 * Ninguna función imprime jamás una clave, una firma ni una cabecera de
 * autorización: los errores llevan el código HTTP, el código de error S3 si el
 * cuerpo lo trae, y la clave del objeto. Nada más.
 */

import crypto from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { parseListResponse } from './list-xml.mjs';

/** Metadato propio: la huella no se deduce del ETag, que es opaco por contrato. */
const META_SHA256 = 'x-amz-meta-sha256';
const MAX_KEYS = 1000;
/** Dos reintentos cortos ante 5xx, 429 o fallo de red; la corrida siguiente es el tercero. */
const REINTENTOS_MS = Object.freeze([250, 750]);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const espera = (ms) => new Promise((listo) => setTimeout(listo, ms));
/** El `<Code>` del XML de error S3, si lo hay: `AccessDenied`, `NoSuchBucket`… Sin cuerpo completo. */
const codigoS3 = (texto) => /<Code>([A-Za-z]{1,64})<\/Code>/.exec(String(texto ?? ''))?.[1] ?? null;

/** Un prefijo es vacío o una ruta de segmentos simples terminada en `/`. */
export function validatePrefix(prefix) {
  const valor = String(prefix ?? '');
  if (valor === '') return '';
  const partes = valor.split('/');
  if (!valor.endsWith('/') || valor.startsWith('/') || valor.includes('\\') || partes.slice(0, -1).some((parte) => parte === '' || parte === '.' || parte === '..')) {
    throw new Error(`Prefijo de almacén inválido: ${valor} (se espera algo como "gasolina/")`);
  }
  return valor;
}

export function createS3Store({ endpoint, region, bucket, prefix = '', accessKeyId, secretAccessKey, fetchImpl = fetch, sleep = espera }) {
  for (const [nombre, valor] of Object.entries({ endpoint, region, bucket, accessKeyId, secretAccessKey })) {
    if (typeof valor !== 'string' || !valor) throw new Error(`Almacén S3 sin ${nombre}`);
  }
  const prefijo = validatePrefix(prefix);
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region });
  const base = `${endpoint.replace(/\/+$/, '')}/${encodeURIComponent(bucket)}`;
  const url = (key) => `${base}/${`${prefijo}${key}`.split('/').map(encodeURIComponent).join('/')}`;

  // Se firma con `aws4fetch` y se transporta con el `fetch` inyectado: así una
  // sonda puede poner un doble delante, y los reintentos son pocos y visibles
  // en vez de los diez con espera exponencial que trae la librería.
  async function pedir(target, init) {
    let ultimo;
    for (let intento = 0; intento <= REINTENTOS_MS.length; intento += 1) {
      try {
        const response = await fetchImpl(await client.sign(target, init));
        if (response.status < 500 && response.status !== 429) return response;
        ultimo = new Error(`HTTP ${response.status}`);
      } catch (error) {
        ultimo = error;
      }
      if (intento < REINTENTOS_MS.length) await sleep(REINTENTOS_MS[intento]);
    }
    throw new Error(`El almacén S3 no respondió tras ${REINTENTOS_MS.length + 1} intentos: ${ultimo.message}`);
  }

  async function fallo(accion, key, response) {
    const codigo = codigoS3(await response.text().catch(() => ''));
    return new Error(`No se pudo ${accion} ${key} en el almacén S3: HTTP ${response.status}${codigo ? ` ${codigo}` : ''}`);
  }

  async function head(key) {
    const response = await pedir(url(key), { method: 'HEAD' });
    if (response.status === 404) return null;
    if (!response.ok) throw await fallo('consultar', key, response);
    const bytes = Number(response.headers.get('content-length'));
    return {
      bytes: Number.isFinite(bytes) ? bytes : null,
      sha256: response.headers.get(META_SHA256),
      etag: response.headers.get('etag'),
    };
  }

  return {
    kind: 's3',
    bucket,
    prefix: prefijo,
    head,

    async get(key) {
      const response = await pedir(url(key), { method: 'GET' });
      // Solo «no existe la clave» es «no está». Un 404 por bucket equivocado
      // (`NoSuchBucket`) es configuración rota y se dice; leerlo como «vacío»
      // haría creer que el histórico empieza de cero. HEAD no trae cuerpo y no
      // puede distinguirlos, pero el PUT o el listado siguientes sí fallan.
      if (response.status === 404) {
        const codigo = codigoS3(await response.text().catch(() => ''));
        if (codigo && codigo !== 'NoSuchKey') throw new Error(`No se pudo leer ${key} en el almacén S3: HTTP 404 ${codigo}`);
        return null;
      }
      if (!response.ok) throw await fallo('leer', key, response);
      const body = await response.text();
      // Si el proveedor no devuelve el metadato, la huella sale del cuerpo: es
      // lo que hace que la comparación de `putImmutable` no dependa de él.
      return { body, bytes: Buffer.byteLength(body), sha256: response.headers.get(META_SHA256) ?? sha256(body) };
    },

    async put(key, body, { contentType, cacheControl, metaSha256, ifAbsent = false } = {}) {
      // «Escribir si no estaba» sin PUT condicional: se mira antes. Repetir un
      // HEAD es barato; pisar un objeto inmutable no tiene vuelta.
      if (ifAbsent && (await head(key))) return { created: false };
      const headers = { 'Content-Type': contentType, 'Cache-Control': cacheControl, [META_SHA256]: metaSha256 };
      for (const nombre of Object.keys(headers)) if (headers[nombre] === undefined || headers[nombre] === null) delete headers[nombre];
      const response = await pedir(url(key), { method: 'PUT', body, headers });
      if (!response.ok) throw await fallo('escribir', key, response);
      return { created: true };
    },

    async list({ prefix: subprefijo = '', cursor = null, limit = MAX_KEYS } = {}) {
      const consulta = new URL(`${base}/`);
      consulta.searchParams.set('list-type', '2');
      consulta.searchParams.set('prefix', `${prefijo}${subprefijo}`);
      consulta.searchParams.set('max-keys', String(Math.min(limit, MAX_KEYS)));
      if (cursor) consulta.searchParams.set('continuation-token', cursor);
      const response = await pedir(consulta.toString(), { method: 'GET' });
      if (!response.ok) throw await fallo('listar', `${prefijo}${subprefijo}`, response);
      const salida = parseListResponse(await response.text());
      // El prefijo lo antepone el almacén y lo quita el almacén: el resto del
      // código habla de `bundles/…` y `observations/…`, esté donde esté el bucket.
      return {
        cursor: salida.cursor,
        keys: salida.keys.map(({ key, bytes }) => {
          if (!key.startsWith(prefijo)) throw new Error(`El listado devolvió una clave fuera del prefijo ${prefijo}: ${key}`);
          return { key: key.slice(prefijo.length), bytes };
        }),
      };
    },
  };
}
