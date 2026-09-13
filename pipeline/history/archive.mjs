/**
 * Archivo durable de los bundles públicos.
 *
 * Se guardan los BYTES que sirvió producción, no una reconstrucción: un snapshot
 * privado reproyectado hoy no demuestra lo que la app mostraba entonces.
 *
 * `archive_hash` identifica el contenido completo —los dos productos y el
 * manifest— y solo eso. No depende del `revision_id` como nombre, ni de la hora
 * de ejecución, ni del orden en que se descargó: mismo contenido, misma clave,
 * una sola copia por más veces que se observe.
 */

import { GASOLINA_KEYS } from '../gasolina-contract.mjs';
import { IMMUTABLE_CACHE_CONTROL, JSON_CONTENT_TYPE, putImmutable, sha256 } from './store.mjs';

export const ARCHIVE_SCHEMA_VERSION = 'history-archive-1';
const ARCHIVE_HASH_PREFIX = 'masfacil-history-archive-v1';
/** Orden alfabético fijo: el hash no puede depender de cómo se recorrió el bundle. */
const ARCHIVE_FILES = Object.freeze(['manifest.json', 'premium.json', 'regular.json']);

/** Los tres cuerpos públicos, por nombre de archivo. */
function archiveObjects({ manifestText, bodies }) {
  return { 'manifest.json': manifestText, 'premium.json': bodies.premium, 'regular.json': bodies.regular };
}

/**
 * Huella del contenido completo del bundle.
 *
 * @returns {string} 64 hex
 */
export function archiveHash({ manifestText, bodies }) {
  const objetos = archiveObjects({ manifestText, bodies });
  const lineas = ARCHIVE_FILES.map((nombre) => `${nombre} ${sha256(objetos[nombre])} ${Buffer.byteLength(objetos[nombre])}\n`);
  return sha256(`${ARCHIVE_HASH_PREFIX}\n${lineas.join('')}`);
}

/**
 * Manifiesto del archivo. Función PURA de los bytes del bundle.
 *
 * No lleva `archived_at` ni nada derivado del reloj, y no es un descuido: si lo
 * llevara, observar el mismo bundle dos veces produciría bytes distintos bajo
 * una clave inmutable, y el conflicto saltaría en una operación correcta.
 */
export function archiveComplete({ manifest, manifestText, bodies, hash }) {
  const objetos = archiveObjects({ manifestText, bodies });
  const primerDataset = JSON.parse(bodies[GASOLINA_KEYS[0]]);
  return {
    schema_version: ARCHIVE_SCHEMA_VERSION,
    archive_hash: hash,
    revision_id: manifest.revision_id,
    manifest_schema_version: manifest.schema_version,
    cutoff_at: primerDataset.cutoff_at,
    source_max_reported_at: primerDataset.source_max_reported_at,
    objects: Object.fromEntries(ARCHIVE_FILES.map((nombre) => [nombre, { sha256: sha256(objetos[nombre]), bytes: Buffer.byteLength(objetos[nombre]) }])),
  };
}

export const archiveKey = (hash, nombre) => `bundles/${hash}/${nombre}`;

/**
 * Archiva el bundle. Idempotente: repetirlo no escribe y no duplica.
 *
 * `complete.json` se escribe AL FINAL y solo tras confirmar los tres cuerpos:
 * su presencia es lo que significa «este archivo está entero y verificado», y
 * es la única condición para que una observación pueda apoyarse en él.
 *
 * Una escritura parcial no necesita reparación especial: la corrida siguiente
 * repite los mismos pasos, los objetos que ya estaban se reutilizan y el que
 * faltaba se escribe. La idempotencia ES la reparación.
 *
 * @returns {Promise<{archive_hash: string, complete: object, stored: boolean, written: string[], reused: string[]}>}
 */
export async function archiveBundle(store, { manifest, manifestText, bodies }) {
  const hash = archiveHash({ manifestText, bodies });
  const objetos = archiveObjects({ manifestText, bodies });
  const written = [];
  const reused = [];
  for (const nombre of ARCHIVE_FILES) {
    const salida = await putImmutable(store, archiveKey(hash, nombre), objetos[nombre], { contentType: JSON_CONTENT_TYPE, cacheControl: IMMUTABLE_CACHE_CONTROL });
    (salida.written ? written : reused).push(nombre);
  }

  // Confirmación antes del cierre: si un cuerpo no quedó con los bytes que se
  // creen, `complete.json` no debe existir y respaldar una observación falsa.
  const complete = archiveComplete({ manifest, manifestText, bodies, hash });
  for (const nombre of ARCHIVE_FILES) {
    const cabecera = await store.head(archiveKey(hash, nombre));
    const esperado = complete.objects[nombre];
    if (!cabecera) throw new Error(`El objeto archivado desapareció antes de cerrar el archivo: ${archiveKey(hash, nombre)}`);
    if (cabecera.sha256 && cabecera.sha256 !== esperado.sha256) throw new Error(`El objeto archivado no coincide con su huella: ${archiveKey(hash, nombre)}`);
    if (Number.isFinite(cabecera.bytes) && cabecera.bytes !== esperado.bytes) throw new Error(`El objeto archivado no coincide en tamaño: ${archiveKey(hash, nombre)}`);
  }

  const cierre = await putImmutable(store, archiveKey(hash, 'complete.json'), `${JSON.stringify(complete)}\n`, { contentType: JSON_CONTENT_TYPE, cacheControl: IMMUTABLE_CACHE_CONTROL });
  (cierre.written ? written : reused).push('complete.json');
  return { archive_hash: hash, complete, stored: written.length > 0, written, reused };
}
