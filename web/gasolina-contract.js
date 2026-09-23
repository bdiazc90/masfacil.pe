// Contrato del bundle de gasolina, del lado del navegador.
//
// Las reglas son las de `lib/bundle-contract.js`, las mismas que aplica la
// proyección antes de publicar: aquí solo se calcula la huella con
// `crypto.subtle` y se responde sí o no, que es lo que necesitan la carga y el
// service worker.

import { GASOLINA_KEYS, GASOLINA_VERSIONS, bundleErrors, datasetErrors, manifestErrors } from './lib/bundle-contract.js';

export { GASOLINA_KEYS, GASOLINA_VERSIONS };

export const validateGasolinaManifest = (manifest) => manifestErrors(manifest).length === 0;

export function validateGasolinaDataset(dataset, key, revision) {
  return datasetErrors(dataset).length === 0 && dataset.revision_id === revision && dataset.product?.key === key;
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function validGasolinaBundle(manifest, key, body) {
  const bytes = new TextEncoder().encode(body);
  const descriptor = manifest?.products?.[key];
  // Si el tamaño ya no coincide, la huella no puede coincidir: no se calcula.
  const sha256 = descriptor && bytes.length === descriptor.bytes ? hex(await crypto.subtle.digest('SHA-256', bytes)) : null;
  return bundleErrors(manifest, key, body, { bytes: bytes.length, sha256 }).length === 0;
}
