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
import { viewPath } from '../web/lib/routes.js';

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
  if (response.status === 404) throw Object.assign(new Error(`Bundle público ausente en Pages (${relative}): el workflow requiere manifest, refresh-state y snapshots ya publicados`), { status: 404, relative });
  if (!response.ok) throw new Error(`No se pudo descargar ${relative}: HTTP ${response.status}`);
  return response.text();
}

/**
 * ¿El grupo todavía no se publicó nunca?
 *
 * Solo si faltan a la vez sus datos y su página: un manifest ausente con la
 * vista respondiendo 200 es un despliegue roto, no una primera vez, y eso tiene
 * que detener la corrida. Se pregunta una sola vez, sin reintentos, y solo
 * puede decir «no publicado» un grupo que declara cómo juzgar su primera versión.
 */
async function sinPublicar(base, grupo, fetchImpl) {
  if (!grupo.config?.guardrails?.firstActivation) return false;
  const response = await fetchImpl(new URL(viewPath(grupo.key).slice(1), base), { redirect: 'manual', cache: 'no-store' });
  return response.status === 404;
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
      if (error.status === 404 && error.relative === `${group.dataRoot}/manifest.json` && await sinPublicar(base, group, fetchImpl)) return { group: group.key, unpublished: true };
      if (intento < attempts - 1) await sleep(REINTENTOS_MS[Math.min(intento, REINTENTOS_MS.length - 1)]);
    }
  }
  throw new Error(`No se pudo leer un bundle público coherente tras ${attempts} intentos: ${ultimo.message}`);
}

/**
 * El `refresh-state.json` que sirve producción para un grupo, o `null` si el
 * grupo no se publicó nunca: faltan a la vez su estado y su página. Cualquier
 * otra respuesta lanza, también un estado ausente con la página en 200.
 */
export async function fetchPublishedState({ origin, group, fetchImpl = fetch, testMode } = {}) {
  const base = liveBundleBase(origin, testMode === undefined ? {} : { testMode });
  const response = await fetchImpl(new URL(`${group.dataRoot}/refresh-state.json`, base), { redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) {
    const pagina = await fetchImpl(new URL(viewPath(group.key).slice(1), base), { redirect: 'manual', cache: 'no-store' });
    if (pagina.status === 404) return null;
    throw new Error(`El refresh-state de ${group.key} no está publicado pero su página responde HTTP ${pagina.status}`);
  }
  if (!response.ok) throw new Error(`No se pudo leer el refresh-state publicado de ${group.key}: HTTP ${response.status}`);
  return JSON.parse(await response.text());
}

/** El bundle de Gasolina, como siempre: el histórico y quien lo necesite solo. */
export const fetchLiveBundle = (entrada = {}) => fetchLiveGroup({ ...entrada, group: groupByKey('gasolina') });

/**
 * Todos los grupos publicados, o ninguno. Publicar el shell sin uno de ellos
 * sería perderlo, así que un grupo que no se puede leer o validar detiene todo.
 * Un grupo que nunca se publicó vuelve como `{ group, unpublished: true }`.
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
  for (const key of group.products) if (!manifest.products?.[key]) throw new Error(`El bundle no declara ${key} para el grupo ${group.key}`);
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
    // Un grupo que todavía no tiene primera versión no deja nada en disco: su
    // ausencia es lo que la preparación reconoce como primera activación.
    if (bundle.unpublished) return [bundle.group, { unpublished: true }];
    return [bundle.group, writeLiveGroup(bundle, { root, group })];
  }));
}
