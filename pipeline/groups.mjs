// Grupos publicados: cada vista activa del catálogo con su contrato de Node.
//
// Es la lista que recorren la descarga del bundle vivo, el verificador y el
// preflight, para que ninguno publique ni compare un grupo y se olvide de otro.
// Es de operación: no viaja a `web/`.

import { ACTIVE_VIEWS, VIEWS } from '../web/lib/catalog.js';
import { validateGasolinaBundle, validateGasolinaManifest, validateGasolinaRefreshState } from './gasolina-contract.mjs';

const CONTRATOS = Object.freeze({
  gasolina: Object.freeze({ manifest: validateGasolinaManifest, refreshState: validateGasolinaRefreshState, bundle: validateGasolinaBundle }),
});

export const PUBLISHED_GROUPS = Object.freeze(ACTIVE_VIEWS.map((key) => {
  if (!CONTRATOS[key]) throw new Error(`Vista activa sin contrato de publicación: ${key}`);
  return Object.freeze({ key, dataRoot: VIEWS[key].dataRoot, products: VIEWS[key].products, validate: CONTRATOS[key] });
}));

export const groupByKey = (key) => PUBLISHED_GROUPS.find((grupo) => grupo.key === key) ?? null;
