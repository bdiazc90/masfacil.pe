// Carga de una vista: un conjunto completo de su grupo, de una sola revisión.
//
// Se pide UN manifest y todos los productos se validan contra él, así que Regular
// y Premium no pueden salir de revisiones distintas. Si la revisión cambia a
// mitad de la lectura —un deploy mientras se descarga— se vuelve a empezar. Si
// tras los intentos no hay un conjunto nuevo completo, se pide el conjunto
// guardado entero (`guardado=1`), que el service worker solo entrega completo y
// validado: nunca se combina una parte nueva con otra antigua.
//
// El manifest se pide con `?product=`: el service worker anterior lo exige, y
// durante una actualización puede ser él quien atienda la primera carga.

import { VIEWS } from './lib/catalog.js';
import { GROUP_CONTRACTS } from './group-contracts.js';
import { mergeProducts } from './lib/merge-products.js';

const ESPERAS_MS = Object.freeze([300, 900]);
const desdeCopia = (response) => response.headers.get('X-Masfacil-Data-Mode') === 'saved';

async function leerConjunto(view, contrato, fetchImpl, { deCopia }) {
  const url = `/${view.dataRoot}/manifest.json?product=${view.products[0]}${deCopia ? '&guardado=1' : ''}`;
  const manifestResponse = await fetchImpl(url, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`No se pudo obtener el manifest ${view.key} (HTTP ${manifestResponse.status})`);
  const manifest = await manifestResponse.clone().json();
  if (!contrato.validManifest(manifest)) throw new Error(`El manifest ${view.key} recibido no cumple el contrato`);
  const respuestas = [manifestResponse];
  const cargados = await Promise.all(view.products.map(async (key) => {
    const descriptor = manifest.products[key];
    const response = await fetchImpl(`/${descriptor.dataset_url}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo obtener ${descriptor.label} (HTTP ${response.status})`);
    const body = await response.clone().text();
    if (!(await contrato.validBundle(manifest, key, body))) throw new Error(`El bundle ${descriptor.label} no coincide con su revisión`);
    respuestas.push(response);
    return { key, manifest, dataset: JSON.parse(body) };
  }));
  // Basta que una parte venga de la copia guardada para no prometer datos vivos.
  const dataMode = respuestas.some(desdeCopia) ? 'saved' : 'network';
  return mergeProducts(...cargados.map((cargado) => ({ ...cargado, dataMode })));
}

/**
 * @param {string} viewKey
 * @param {{fetchImpl?: Function, attempts?: number, sleep?: Function, views?: object, contracts?: object}} [opciones]
 */
export async function loadView(viewKey, { fetchImpl = fetch, attempts = 3, sleep = (ms) => new Promise((listo) => setTimeout(listo, ms)), views = VIEWS, contracts = GROUP_CONTRACTS } = {}) {
  const view = views[viewKey];
  const contrato = contracts[viewKey];
  if (!view || !contrato) throw new Error(`Vista sin datos publicados: ${viewKey}`);
  let ultimo;
  for (let intento = 0; intento < attempts; intento += 1) {
    try { return await leerConjunto(view, contrato, fetchImpl, { deCopia: false }); }
    catch (error) {
      ultimo = error;
      if (intento < attempts - 1) await sleep(ESPERAS_MS[Math.min(intento, ESPERAS_MS.length - 1)]);
    }
  }
  try { return await leerConjunto(view, contrato, fetchImpl, { deCopia: true }); }
  catch { throw ultimo; }
}

// El nombre de siempre, para quien lo importe mientras Gasolina sea la única vista.
export const loadGasolina = (fetchImpl = fetch) => loadView('gasolina', { fetchImpl });
