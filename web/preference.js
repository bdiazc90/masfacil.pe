// La última vista elegida, recordada en este dispositivo.
//
// Solo la clave de la vista: nunca coordenadas ni distrito. El almacenamiento
// puede no existir, estar lleno o lanzar en una ventana privada; entonces no se
// recuerda nada y la app sigue igual. Qué vale como preferencia lo decide
// `lib/routes.js`: una clave desconocida o de una vista no activada se ignora.

const CLAVE = 'masfacil-vista';

function almacen() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function readPreference(storage = almacen()) {
  try { return storage?.getItem(CLAVE) ?? null; } catch { return null; }
}

export function writePreference(view, storage = almacen()) {
  try { storage?.setItem(CLAVE, view); } catch { /* sin almacenamiento no hay preferencia, y no pasa nada */ }
}
