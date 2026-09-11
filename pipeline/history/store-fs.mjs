/**
 * Backend de sistema de archivos para el histórico.
 *
 * Es el almacén de desarrollo y de las sondas: permite construir y comprobar el
 * observador entero sin bucket, sin credenciales y sin red. La raíz vive bajo
 * `.local-cache/`, que ya está fuera de Git y prohibida en la auditoría.
 *
 * Pagina de verdad aunque tenga todas las claves a mano. Es deliberado: un
 * backend local que devolviera todo en una página nunca ejercitaría el bucle de
 * cursor que el bucket sí necesita, y el fallo aparecería en producción.
 *
 * Aplica el mismo prefijo que el bucket: la copia local tiene la misma
 * disposición que lo publicado, y ningún camino ve claves distintas según dónde
 * esté escribiendo.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LIMIT = 1000;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Una clave es una ruta relativa de segmentos simples; nada puede escapar de la raíz. */
function resolveKey(root, key) {
  const clave = String(key ?? '');
  const partes = clave.split('/');
  if (!clave || clave.startsWith('/') || clave.includes('\\') || partes.some((parte) => parte === '' || parte === '.' || parte === '..')) {
    throw new Error(`Clave de almacén inválida: ${clave}`);
  }
  const destino = path.join(root, ...partes);
  if (!destino.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Clave de almacén fuera de la raíz: ${clave}`);
  return destino;
}

function walk(directory, base, claves) {
  if (!fs.existsSync(directory)) return claves;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absoluta = path.join(directory, entry.name);
    const relativa = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(absoluta, relativa, claves);
    else if (entry.isFile()) claves.push({ key: relativa, bytes: fs.statSync(absoluta).size });
  }
  return claves;
}

export function createFsStore({ root, prefix = '' }) {
  const raiz = path.resolve(root);
  const prefijo = String(prefix ?? '');
  if (prefijo && !prefijo.endsWith('/')) throw new Error(`Prefijo de almacén inválido: ${prefijo} (debe terminar en "/")`);
  // El prefijo pasa por la misma validación que una clave: tampoco puede escapar.
  if (prefijo) resolveKey(raiz, `${prefijo}x`);
  const conPrefijo = (key) => `${prefijo}${key}`;

  return {
    kind: 'fs',
    root: raiz,
    prefix: prefijo,

    async head(key) {
      const destino = resolveKey(raiz, conPrefijo(key));
      if (!fs.existsSync(destino)) return null;
      const body = fs.readFileSync(destino);
      // El disco no guarda metadatos, así que la huella se recalcula. Los objetos
      // del histórico son JSON pequeños; el coste es irrelevante y evita un
      // archivo lateral que ensuciaría los listados.
      return { bytes: body.length, sha256: sha256(body), etag: null };
    },

    async get(key) {
      const destino = resolveKey(raiz, conPrefijo(key));
      if (!fs.existsSync(destino)) return null;
      const body = fs.readFileSync(destino);
      return { body: body.toString('utf8'), bytes: body.length, sha256: sha256(body) };
    },

    async put(key, body, { ifAbsent = false } = {}) {
      const destino = resolveKey(raiz, conPrefijo(key));
      fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
      const temporal = `${destino}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
      fs.writeFileSync(temporal, body, { mode: 0o600, flag: 'wx' });
      try {
        // `link` falla con EEXIST si el destino ya existe, y lo hace de forma
        // atómica: es el «escribir si no estaba» local. `rename` no sirve para
        // esto porque sobrescribe sin avisar.
        if (ifAbsent) fs.linkSync(temporal, destino);
        else fs.renameSync(temporal, destino);
        return { created: true };
      } catch (error) {
        if (ifAbsent && error.code === 'EEXIST') return { created: false };
        throw error;
      } finally {
        if (fs.existsSync(temporal)) fs.unlinkSync(temporal);
      }
    },

    async list({ prefix: subprefijo = '', cursor = null, limit = DEFAULT_LIMIT } = {}) {
      const completo = conPrefijo(subprefijo);
      const todas = walk(raiz, '', [])
        .filter((item) => item.key.startsWith(completo) && !item.key.endsWith('.tmp'))
        .map((item) => ({ key: item.key.slice(prefijo.length), bytes: item.bytes }))
        .sort((izquierda, derecha) => izquierda.key.localeCompare(derecha.key, 'en'));
      // Cursor por última clave devuelta: estable aunque se escriban objetos
      // nuevos entre página y página, que es lo que pasa cuando otra corrida
      // está observando a la vez.
      const pendientes = cursor ? todas.filter((item) => item.key.localeCompare(cursor, 'en') > 0) : todas;
      const pagina = pendientes.slice(0, limit);
      return { keys: pagina, cursor: pendientes.length > pagina.length ? pagina.at(-1).key : null };
    },
  };
}
