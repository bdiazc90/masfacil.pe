/**
 * El bundle público, como BYTES y como escritura, separados.
 *
 * Antes esto era un guion sin exportes que descargaba y escribía en
 * `web/data/gasolina/` de una sola vez. El histórico necesita exactamente la
 * mitad: los bytes ya validados, sin tocar el disco de nadie —observar no puede
 * pisar el bundle que otra corrida está usando—. Así que la descarga vive aquí y
 * la escritura también, pero se piden por separado.
 *
 * `scripts/fetch-live-bundle.mjs` queda como CLI de las dos, con el mismo efecto
 * y la misma salida de siempre: el workflow de precios depende de eso.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GASOLINA_KEYS, validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from './gasolina-contract.mjs';

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

async function intentar(base, fetchImpl) {
  const manifestText = await descargar(base, 'data/gasolina/manifest.json', fetchImpl);
  const manifest = JSON.parse(manifestText);
  const manifestErrors = validateGasolinaManifest(manifest);
  if (manifestErrors.length) throw new Error(`Manifest remoto inválido: ${manifestErrors.join('; ')}`);

  const stateText = await descargar(base, 'data/gasolina/refresh-state.json', fetchImpl);
  const stateErrors = validateGasolinaRefreshState(JSON.parse(stateText), manifest);
  if (stateErrors.length) throw new Error(`Refresh-state remoto inválido: ${stateErrors.join('; ')}`);

  const bodies = {};
  for (const key of GASOLINA_KEYS) {
    const body = await descargar(base, manifest.products[key].dataset_url, fetchImpl);
    const errors = validateGasolinaBundle(manifest, key, body);
    if (errors.length) throw new Error(`Snapshot remoto ${key} inválido: ${errors.join('; ')}`);
    bodies[key] = body;
  }

  // El origen pudo republicar mientras se leían los snapshots: entonces el trío
  // no describe un instante, sino dos. Releer el manifest al final es lo que
  // convierte «tres descargas» en «una lectura coherente».
  const confirmacion = await descargar(base, 'data/gasolina/manifest.json', fetchImpl);
  if (confirmacion !== manifestText) throw new Error('El bundle cambió durante la lectura: el manifest ya no es el mismo');

  return { manifest, manifestText, stateText, bodies, revision_id: manifest.revision_id };
}

/**
 * Descarga y valida el bundle público. Devuelve BYTES; no toca disco.
 *
 * @param {{origin: string, fetchImpl?: Function, attempts?: number, sleep?: Function, testMode?: boolean}} entrada
 * @returns {Promise<{manifest: object, manifestText: string, stateText: string, bodies: {regular: string, premium: string}, revision_id: string}>}
 */
export async function fetchLiveBundle({ origin, fetchImpl = fetch, attempts = REINTENTOS_MS.length + 1, sleep = espera, testMode } = {}) {
  const base = liveBundleBase(origin, testMode === undefined ? {} : { testMode });
  let ultimo;
  for (let intento = 0; intento < attempts; intento += 1) {
    try { return await intentar(base, fetchImpl); }
    catch (error) {
      ultimo = error;
      if (intento < attempts - 1) await sleep(REINTENTOS_MS[Math.min(intento, REINTENTOS_MS.length - 1)]);
    }
  }
  throw new Error(`No se pudo leer un bundle público coherente tras ${attempts} intentos: ${ultimo.message}`);
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

function snapshotTarget(root, datasetUrl) {
  // El contrato ya restringe dataset_url a data/gasolina/snapshots/<revisión>/<producto>.json;
  // se rechaza además cualquier segmento relativo para que el destino quede dentro de web/.
  if (datasetUrl.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error(`dataset_url con segmentos relativos: ${datasetUrl}`);
  return path.join(root, 'web', datasetUrl);
}

/** Deja en `web/data/gasolina/` un bundle ya obtenido y validado. */
export function writeLiveBundle({ manifest, manifestText, stateText, bodies }, { root = rootFromModule } = {}) {
  const dataRoot = path.join(root, 'web', 'data', 'gasolina');
  const snapshots = Object.fromEntries(GASOLINA_KEYS.map((key) => [key, { target: snapshotTarget(root, manifest.products[key].dataset_url), body: bodies[key], bytes: manifest.products[key].bytes }]));
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
    snapshots: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, snapshots[key].bytes])),
    raw_downloaded: false,
  };
}
