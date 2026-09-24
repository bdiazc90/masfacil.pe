// Con qué valida el navegador los datos de cada grupo.
//
// Lo comparten la carga, el service worker y el verificador, para que ninguno
// acepte lo que otro rechaza. Solo existe Gasolina; un grupo nuevo añade aquí su
// contrato en la misma entrega que lo activa.
import { validGasolinaBundle, validateGasolinaManifest } from './gasolina-contract.js';

export const GROUP_CONTRACTS = Object.freeze({
  gasolina: Object.freeze({ validManifest: validateGasolinaManifest, validBundle: validGasolinaBundle }),
});
