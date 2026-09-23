// Contrato del bundle de gasolina, del lado de Node.
//
// Las reglas estructurales viven en `web/lib/bundle-contract.js`, que es el
// mismo módulo que usa el navegador: aquí solo se pone lo que es propio de este
// entorno —la huella con `node:crypto`— y el estado de refresco, que solo lee la
// operación. Los nombres y las firmas son los de siempre: la proyección, el
// refresco, la descarga del bundle vivo, el histórico y el verificador los
// importan tal cual.

import crypto from 'node:crypto';
import { GASOLINA_KEYS, GASOLINA_VERSIONS, bundleErrors, datasetErrors, manifestErrors, sameKeys, text, timestamp } from '../web/lib/bundle-contract.js';

export { CONFIDENCE_LEVELS, FACILITO_FIELDS, GASOLINA_KEYS, GASOLINA_MANIFEST_VERSION, GASOLINA_SCOPE, GASOLINA_VERSIONS, LEGACY_GASOLINA_MANIFEST_VERSION, PUBLIC_OFFER_FIELDS } from '../web/lib/bundle-contract.js';

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const validateGasolinaDataset = (dataset) => datasetErrors(dataset);
export const validateGasolinaManifest = (manifest) => manifestErrors(manifest);

export function validateGasolinaRefreshState(state, manifest) {
  const errors = [];
  // Desde 2.6.0 el snapshot se declara; antes se deducía recortando el
  // `revision_id`, y ese recorte nunca quitó el sufijo, así que la comparación
  // que apagaba o encendía los guardrails de caída era siempre falsa.
  const conSnapshot = ['2.6.0', '2.7.0'].includes(state?.schema_version);
  // Desde 2.7.0 el estado de datos no es solo el CSV. `facilito.state_id` es el
  // `observed_at` más reciente que guarda el expediente privado, y ordena dos
  // composiciones sobre el MISMO snapshot: sin él, dos capturas del mismo CSV
  // empatan y la corrida que termina tarde pisa a la que vio la tabla después.
  const conFacilito = ['2.7.0'].includes(state?.schema_version);
  const raiz = ['schema_version', 'revision_id', 'snapshot_id', 'validators', 'source_max_reported_at', 'products'];
  if (!sameKeys(state, conFacilito ? [...raiz, 'facilito'] : conSnapshot ? raiz : raiz.filter((field) => field !== 'snapshot_id'))) errors.push('campos refresh-state inválidos');
  if (conSnapshot && !text(state?.snapshot_id)) errors.push('snapshot_id refresh-state inválido');
  if (conFacilito) {
    const capa = state?.facilito;
    const entero = (value) => Number.isInteger(value) && value >= 0;
    if (!sameKeys(capa, ['contract', 'state_id', 'units_observed', 'units', 'districts', 'linked', 'ambiguous', 'unlinked', 'effective'])
      || !text(capa.contract)
      || (capa.state_id !== null && !timestamp(capa.state_id))
      || !capa.units_observed || typeof capa.units_observed !== 'object' || Array.isArray(capa.units_observed)
      || !Object.values(capa.units_observed).every((valor) => timestamp(valor))
      || !sameKeys(capa.units, ['fresh', 'reused', 'failed']) || !Object.values(capa.units).every(entero)
      || !entero(capa.districts) || !entero(capa.ambiguous) || !entero(capa.unlinked)
      || !GASOLINA_KEYS.every((key) => entero(capa.linked?.[key]) && sameKeys(capa.effective?.[key], ['facilito', 'csv', 'none']) && Object.values(capa.effective[key]).every(entero))) errors.push('capa facilito refresh-state inválida');
  }
  if (!GASOLINA_VERSIONS.includes(state?.schema_version) || (manifest?.schema_version && state?.schema_version !== manifest.schema_version) || state?.revision_id !== manifest?.revision_id) errors.push('revisión refresh-state inválida');
  if (!timestamp(state?.source_max_reported_at)) errors.push('máximo temporal refresh-state inválido');
  if (!state?.validators || !Object.hasOwn(state.validators, 'etag') || !Object.hasOwn(state.validators, 'last_modified')) errors.push('validadores refresh-state inválidos');
  if (JSON.stringify(Object.keys(state?.products ?? {})) !== JSON.stringify(GASOLINA_KEYS)) errors.push('productos refresh-state inválidos');
  for (const key of GASOLINA_KEYS) {
    const value = state?.products?.[key];
    const ready = value?.contract_ready;
    const fresh = value?.fresh_0_30_days;
    const conflicts = value?.conflicts;
    if (!value
      || !Number.isInteger(ready?.offers) || ready.offers < 1
      || !Number.isInteger(ready?.districts) || ready.districts < 1
      || !Number.isInteger(fresh?.offers) || fresh.offers < ready.offers
      || !Number.isInteger(fresh?.districts) || fresh.districts < ready.districts
      || !Number.isFinite(value.coverage_percent) || value.coverage_percent <= 0 || value.coverage_percent > 100
      || !conflicts
      || !Number.isInteger(conflicts.latest_price_conflicts) || conflicts.latest_price_conflicts < 0
      || !Number.isInteger(conflicts.latest_territory_conflicts) || conflicts.latest_territory_conflicts < 0
      || !timestamp(value.cutoff_at)) errors.push(`guardrails ${key} inválidos`);
  }
  return errors;
}

export function validateGasolinaBundle(manifest, key, body) {
  // Sin descriptor no hay con qué comparar: se informa sin medir el cuerpo.
  const digest = manifest?.products?.[key] ? { bytes: Buffer.byteLength(body), sha256: sha256(body) } : null;
  return bundleErrors(manifest, key, body, digest);
}
