/**
 * El bundle público, como BYTES y como escritura, separados.
 *
 * Antes esto era un guion sin exportes que descargaba y escribía en
 * `web/data/gasolina/` de una sola vez. El histórico necesita exactamente la
 * mitad: los bytes ya validados, sin tocar el disco de nadie —observar no puede
 * pisar el bundle que otra corrida está usando—. Así que la descarga vive aquí y
 * la escritura también, pero se piden por separado.
 *
 * Desde que hay grupos, cada uno se lee y se escribe en su propia raíz, y
 * `scripts/fetch-live-bundle.mjs` trae todos los publicados o ninguno: la ruta
 * `shell` no puede subir un árbol al que le falte un grupo. `fetchLiveBundle` y
 * `writeLiveBundle` siguen siendo los de Gasolina, con la firma de siempre.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLISHED_GROUPS, groupByKey } from './groups.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const espera = (ms) => new Promise((listo) => setTimeout(listo, ms));
/** Dos reintentos cortos: el bundle solo cambia bajo los pies durante un deploy. */
const REINTENTOS_MS = Object.freeze([250, 750]);

/** Base normalizada; HTTP solo en pruebas locales, como siempre. */
function liveBundleBase(baseUrl, { testMode = process.env.TEST_MODE === '1' } = {}) {
  const localHttp = testMode && /^http:\/\/127\.0\.0\.1(?::\d+)?\/?$/.test(baseUrl ?? '');
  if (!baseUrl || (!/^https:\/\//.test(baseUrl) && !localHttp)) throw new Error('Se requiere URL HTTPS de Pages (HTTP solo en test local)');
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;
  return base;
}

async function descargar(base, relative, fetchImpl) {
  const response = await fetchImpl(new URL(relative, base), { redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new Error(`Bundle público ausente en Pages (${relative}): el workflow requiere manifest, refresh-state y snapshots ya publicados`);
  if (!response.ok) throw new Error(`No se pudo descargar ${relative}: HTTP ${response.status}`);
  return response.text();
}

async function intentar(base, grupo, fetchImpl) {
  const manifestText = await descargar(base, `${grupo.dataRoot}/manifest.json`, fetchImpl);
  const manifest = JSON.parse(manifestText);
  const manifestErrors = grupo.validate.manifest(manifest);
  if (manifestErrors.length) throw new Error(`Manifest remoto inválido: ${manifestErrors.join('; ')}`);

  const stateText = await descargar(base, `${grupo.dataRoot}/refresh-state.json`, fetchImpl);
  const stateErrors = grupo.validate.refreshState(JSON.parse(stateText), manifest);
  if (stateErrors.length) throw new Error(`Refresh-state remoto inválido: ${stateErrors.join('; ')}`);

  const bodies = {};
  for (const key of grupo.products) {
    const body = await descargar(base, manifest.products[key].dataset_url, fetchImpl);
    const errors = grupo.validate.bundle(manifest, key, body);
    if (errors.length) throw new Error(`Snapshot remoto ${key} inválido: ${errors.join('; ')}`);
    bodies[key] = body;
  }

  // El origen pudo republicar mientras se leían los snapshots: entonces el
  // conjunto no describe un instante, sino dos. Releer el manifest al final es lo
  // que convierte «varias descargas» en «una lectura coherente».
  const confirmacion = await descargar(base, `${grupo.dataRoot}/manifest.json`, fetchImpl);
  if (confirmacion !== manifestText) throw new Error('El bundle cambió durante la lectura: el manifest ya no es el mismo');

  return { group: grupo.key, manifest, manifestText, stateText, bodies, revision_id: manifest.revision_id };
}

/**
 * Descarga y valida el bundle público de un grupo. Devuelve BYTES; no toca disco.
 *
 * @param {{origin: string, group?: object, fetchImpl?: Function, attempts?: number, sleep?: Function, testMode?: boolean}} entrada
 * @returns {Promise<{group: string, manifest: object, manifestText: string, stateText: string, bodies: Record<string, string>, revision_id: string}>}
 */
export async function fetchLiveGroup({ origin, group = groupByKey('gasolina'), fetchImpl = fetch, attempts = REINTENTOS_MS.length + 1, sleep = espera, testMode } = {}) {
  const base = liveBundleBase(origin, testMode === undefined ? {} : { testMode });
  let ultimo;
  for (let intento = 0; intento < attempts; intento += 1) {
    try { return await intentar(base, group, fetchImpl); }
    catch (error) {
      ultimo = error;
      if (intento < attempts - 1) await sleep(REINTENTOS_MS[Math.min(intento, REINTENTOS_MS.length - 1)]);
    }
  }
  throw new Error(`No se pudo leer un bundle público coherente tras ${attempts} intentos: ${ultimo.message}`);
}

/** El bundle de Gasolina, como siempre: el histórico y quien lo necesite solo. */
export const fetchLiveBundle = (entrada = {}) => fetchLiveGroup({ ...entrada, group: groupByKey('gasolina') });

/**
 * Todos los grupos publicados, o ninguno. Publicar el shell sin uno de ellos
 * sería perderlo, así que un grupo que no se puede leer o validar detiene todo.
 */
export async function fetchLiveGroups({ groups = PUBLISHED_GROUPS, ...entrada } = {}) {
  const bundles = [];
  for (const group of groups) {
    try { bundles.push(await fetchLiveGroup({ ...entrada, group })); }
    catch (error) { throw new Error(`Grupo ${group.key}: ${error.message}`); }
  }
  return bundles;
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

function snapshotTarget(root, grupo, datasetUrl) {
  // El contrato ya restringe dataset_url a <raíz del grupo>/snapshots/<revisión>/<producto>.json;
  // se rechaza además cualquier segmento relativo para que el destino quede dentro de web/.
  if (datasetUrl.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error(`dataset_url con segmentos relativos: ${datasetUrl}`);
  if (!datasetUrl.startsWith(`${grupo.dataRoot}/snapshots/`)) throw new Error(`dataset_url fuera del grupo ${grupo.key}: ${datasetUrl}`);
  return path.join(root, 'web', datasetUrl);
}

/** Deja en `web/<raíz del grupo>/` un bundle ya obtenido y validado. */
export function writeLiveGroup({ manifest, manifestText, stateText, bodies }, { root = rootFromModule, group = groupByKey('gasolina') } = {}) {
  const dataRoot = path.join(root, 'web', ...group.dataRoot.split('/'));
  const snapshots = Object.fromEntries(group.products.map((key) => [key, { target: snapshotTarget(root, group, manifest.products[key].dataset_url), body: bodies[key], bytes: manifest.products[key].bytes }]));
  // Mismo orden que la proyección: primero snapshots inmutables, el manifest al
  // final, para que nunca quede un manifest apuntando a snapshots ausentes.
  for (const { target, body } of Object.values(snapshots)) {
    if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== body) throw new Error(`Snapshot inmutable ya existe con bytes distintos: ${path.relative(root, target)}`);
    if (!fs.existsSync(target)) atomicWrite(target, body);
  }
  atomicWrite(path.join(dataRoot, 'refresh-state.json'), stateText);
  atomicWrite(path.join(dataRoot, 'manifest.json'), manifestText);
  return {
    revision_id: manifest.revision_id,
    refresh_state: true,
    snapshots: Object.fromEntries(group.products.map((key) => [key, snapshots[key].bytes])),
    raw_downloaded: false,
  };
}

/** El de Gasolina, con la firma de siempre. */
export const writeLiveBundle = (bundle, entrada = {}) => writeLiveGroup(bundle, { ...entrada, group: groupByKey('gasolina') });

/** Escribe cada grupo en su raíz; devuelve un resumen por grupo. */
export function writeLiveGroups(bundles, { root = rootFromModule, groups = PUBLISHED_GROUPS } = {}) {
  return Object.fromEntries(bundles.map((bundle) => {
    const group = groups.find((grupo) => grupo.key === bundle.group);
    if (!group) throw new Error(`Bundle de un grupo no publicado: ${bundle.group}`);
    return [bundle.group, writeLiveGroup(bundle, { root, group })];
  }));
}
