import { validBundle, validateManifest } from './public-contract.js';

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
  return { dataset: JSON.parse(body), manifest, dataMode: manifestResponse.headers.get('X-Facilito-Data-Mode') ?? 'network' };
}
