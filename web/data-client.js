import { validBundle, validateManifest } from './public-contract.js';
import { GASOLINA_KEYS, validGasolinaBundle, validateGasolinaManifest } from './gasolina-contract.js';

const MANIFEST_URL = '/data/manifest.json';
export async function loadPublicDataset(fetchImpl = fetch) {
  const manifestResponse = await fetchImpl(MANIFEST_URL, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`No se pudo obtener el manifest (HTTP ${manifestResponse.status})`);
  const manifest = await manifestResponse.clone().json();
  if (!validateManifest(manifest)) throw new Error('El manifest recibido no cumple el contrato público');
  const datasetResponse = await fetchImpl(`/${manifest.dataset_url}`, { cache: 'no-store' });
  if (!datasetResponse.ok) throw new Error(`No se pudo obtener el snapshot (HTTP ${datasetResponse.status})`);
  const body = await datasetResponse.clone().text();
  if (!(await validBundle(manifest, body))) throw new Error('El snapshot recibido no coincide con el manifest válido');
  return { dataset: JSON.parse(body), manifest, dataMode: manifestResponse.headers.get('X-Masfacil-Data-Mode') ?? 'network' };
}

export async function loadGasolinaProduct(key, fetchImpl = fetch) {
  if (!GASOLINA_KEYS.includes(key)) throw new Error('Producto gasolina no permitido');
  const manifestResponse = await fetchImpl(`/data/gasolina/manifest.json?product=${key}`, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`No se pudo obtener el manifest gasolina (HTTP ${manifestResponse.status})`);
  const manifest = await manifestResponse.clone().json();
  if (!validateGasolinaManifest(manifest)) throw new Error('El manifest gasolina recibido no cumple el contrato');
  const descriptor = manifest.products[key];
  const snapshotResponse = await fetchImpl(`/${descriptor.dataset_url}`, { cache: 'no-store' });
  if (!snapshotResponse.ok) throw new Error(`No se pudo obtener ${descriptor.label} (HTTP ${snapshotResponse.status})`);
  const body = await snapshotResponse.clone().text();
  if (!(await validGasolinaBundle(manifest, key, body))) throw new Error(`El bundle ${descriptor.label} no coincide con su revisión`);
  return { dataset: JSON.parse(body), manifest, key, dataMode: snapshotResponse.headers.get('X-Masfacil-Data-Mode') ?? manifestResponse.headers.get('X-Masfacil-Data-Mode') ?? 'network' };
}
