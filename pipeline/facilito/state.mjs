// El expediente privado de las consultas web.
//
// Vive en `.local-cache/facilito/`, fuera de Git y con los mismos permisos que
// el resto de lo privado, y se restaura entre corridas junto a los snapshots.
// Existe porque una captura vale 24 horas y el cron corre cada 6: sin
// persistencia, un fallo transitorio de un distrito borraría un precio que
// seguía siendo válido.
//
// La regla que ordena todo lo demás: **una corrida que falla no rejuvenece
// nada**. Se conserva la captura anterior con su hora original y se anota el
// intento aparte. Una consulta exitosa del mismo precio sí acredita una
// observación nueva —la vimos otra vez— pero nunca un reporte nuevo.

import fs from 'node:fs';
import path from 'node:path';

export const FACILITO_STATE_VERSION = 'facilito-state-1';
export const FACILITO_ROOT_RELATIVE = path.join('.local-cache', 'facilito');

const STATE_FILE = 'state.json';
const REVISIONS_DIR = 'revisions';

/** Dónde vive el expediente. `FACILITO_ROOT` permite trabajar sobre una copia, como `IDENTITY_ROOT`. */
export const facilitoRoot = (root, override = null) => override ?? process.env.FACILITO_ROOT ?? path.join(root, FACILITO_ROOT_RELATIVE);

/** La clave de una unidad de aceptación: distrito × producto, nunca una fila suelta. */
export const unitKey = (districtCode, product) => `${districtCode}:${product}`;

export function emptyFacilitoState(contract = 'scrap-facilito/v1', sourceUrl = null) {
  return { schema_version: FACILITO_STATE_VERSION, contract, source_url: sourceUrl, units: {} };
}

export function readFacilitoState(root, { facilitoRoot: override = null } = {}) {
  const file = path.join(facilitoRoot(root, override), STATE_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed?.schema_version === FACILITO_STATE_VERSION && parsed.units && typeof parsed.units === 'object' ? parsed : null;
  } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

export function writeFacilitoState(root, state, { facilitoRoot: override = null } = {}) {
  writeJson(path.join(facilitoRoot(root, override), STATE_FILE), state);
}

/**
 * El estado exacto con el que se compuso una revisión, y CUÁNDO se compuso.
 *
 * El rollback tiene que reconstruir los inputs de LA revisión elegida, no
 * añadirle la captura activa de otra: recuperar una entrega de ayer y pintarle
 * los precios de hoy sería inventar una revisión que nunca existió.
 *
 * La hora de composición importa tanto como el estado. La capa publicada omite
 * las capturas ya vencidas, así que reconstruir con el reloj de hoy una entrega
 * de anteayer dejaría fuera todo lo que entonces estaba vigente y daría otra
 * revisión. Con `composed_at` se reconstruye con el reloj de aquel momento y
 * salen los mismos bytes.
 */
export function writeFacilitoRevision(root, revisionId, state, { facilitoRoot: override = null, composedAt } = {}) {
  const file = path.join(facilitoRoot(root, override), REVISIONS_DIR, `${revisionId}.json`);
  if (fs.existsSync(file)) return file;
  writeJson(file, { ...state, composed_at: new Date(composedAt ?? Date.now()).toISOString() });
  return file;
}

export function readFacilitoRevision(root, revisionId, { facilitoRoot: override = null } = {}) {
  const file = path.join(facilitoRoot(root, override), REVISIONS_DIR, `${revisionId}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * El instante más reciente del expediente. Sirve para el resumen, NO para
 * ordenar dos corridas.
 *
 * Un máximo esconde retrocesos: si producción tiene dos distritos consultados a
 * las 12:00 y el candidato trae uno a las 13:00 y otro a las 06:00, el máximo
 * sube y la entrega parece más nueva mientras un distrito retrocede seis horas.
 * El orden lo decide `facilitoUnitInstants`, unidad por unidad.
 */
export function facilitoStateId(state) {
  const instantes = Object.values(state?.units ?? {}).map((unidad) => Date.parse(unidad.observed_at)).filter(Number.isFinite);
  return instantes.length ? new Date(Math.max(...instantes)).toISOString() : null;
}

/**
 * La hora de cada unidad, que es lo que de verdad ordena dos entregas.
 *
 * Viaja al `refresh-state` público —no al bundle, así que no toca la revisión ni
 * llega al navegador— para que el preflight pueda comparar distrito a distrito
 * contra lo que sirve producción.
 */
export function facilitoUnitInstants(state) {
  return Object.fromEntries(Object.entries(state?.units ?? {})
    .filter(([, unidad]) => Number.isFinite(Date.parse(unidad.observed_at)))
    .map(([clave, unidad]) => [clave, unidad.observed_at])
    .sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Incorpora el resultado de una corrida, unidad por unidad.
 *
 * Una unidad con tabla completa REEMPLAZA a la anterior, incluidas sus
 * ausencias: si una fila que antes estaba ya no aparece, esa consulta deja de
 * respaldarla y el grifo vuelve al CSV. Eso no significa que cerrara ni que no
 * tenga stock; significa que hoy no lo vimos.
 */
export function applyFacilitoRun(previous, units, { attemptedAt, contract = null, sourceUrl = null }) {
  const state = previous ? { ...previous, units: { ...previous.units } } : emptyFacilitoState(contract ?? 'scrap-facilito/v1', sourceUrl);
  if (contract) state.contract = contract;
  if (sourceUrl) state.source_url = sourceUrl;
  for (const unidad of units) {
    const clave = unitKey(unidad.district_code, unidad.product);
    const anterior = state.units[clave] ?? null;
    if (unidad.status !== 'ok') {
      // Intento fallido: se anota, y la captura anterior sigue con SU hora.
      if (anterior) state.units[clave] = { ...anterior, last_attempt: { at: attemptedAt, status: unidad.status } };
      continue;
    }
    // Una unidad solo se reemplaza por otra POSTERIOR. Dos corridas que
    // comparten el expediente restaurado pueden terminar al revés, y sin esta
    // guarda la que leyó la tabla antes sobrescribiría a la que la leyó después.
    const anteriorEn = Date.parse(anterior?.observed_at ?? '');
    if (Number.isFinite(anteriorEn) && Date.parse(unidad.observed_at) <= anteriorEn) {
      state.units[clave] = { ...anterior, last_attempt: { at: attemptedAt, status: 'descartada_por_anterior' } };
      continue;
    }
    state.units[clave] = {
      district_code: unidad.district_code,
      district_name: unidad.district_name,
      product: unidad.product,
      observed_at: unidad.observed_at,
      announced_total: unidad.announced_total,
      rows: unidad.rows,
      last_attempt: { at: attemptedAt, status: 'ok' },
    };
  }
  // El resumen de la corrida se guarda con el estado porque la proyección no
  // presencia la captura: sin esto no podría distinguir una unidad recién leída
  // de otra que lleva cinco horas guardada, y un fallo parecería un éxito.
  const frescas = units.filter((unidad) => unidad.status === 'ok').length;
  // También por producto: el expediente es uno, pero cada grupo publica sus
  // propios conteos y no debe sumar las consultas de otro combustible.
  const porProducto = {};
  for (const unidad of units) {
    const cuenta = porProducto[unidad.product] ??= { fresh: 0, failed: 0 };
    if (unidad.status === 'ok') cuenta.fresh += 1; else cuenta.failed += 1;
  }
  state.last_run = {
    at: attemptedAt,
    fresh: frescas,
    failed: units.length - frescas,
    reused: Math.max(0, Object.keys(state.units).length - frescas),
    by_product: porProducto,
  };
  return state;
}

/**
 * El expediente visto desde un grupo: solo las unidades de sus productos.
 *
 * La captura llena un único expediente, pero cada grupo publica su propio
 * estado, y el preflight compara unidad por unidad contra lo que sirve
 * producción. Sin este filtro, las consultas de Diésel entrarían en el
 * refresh-state de Gasolina, y el día que dejaran de estar ahí el preflight las
 * vería como distritos que retroceden. Un expediente anterior al desglose por
 * producto conserva sus conteos globales: entonces solo había Gasolina.
 */
export function facilitoStateForProducts(state, products) {
  if (!state) return state;
  const propios = new Set(products);
  // La clave ya dice el producto (`distrito:producto`); el campo es la misma cosa.
  const units = Object.fromEntries(Object.entries(state.units ?? {}).filter(([clave, unidad]) => propios.has(unidad?.product ?? clave.slice(clave.lastIndexOf(':') + 1))));
  const corrida = state.last_run;
  if (!corrida?.by_product) return { ...state, units };
  const cuentas = Object.entries(corrida.by_product).filter(([producto]) => propios.has(producto));
  const frescas = cuentas.reduce((total, [, cuenta]) => total + cuenta.fresh, 0);
  return {
    ...state,
    units,
    last_run: {
      at: corrida.at,
      fresh: frescas,
      failed: cuentas.reduce((total, [, cuenta]) => total + cuenta.failed, 0),
      reused: Math.max(0, Object.keys(units).length - frescas),
      by_product: Object.fromEntries(cuentas),
    },
  };
}

/** Conteos de captura para el resumen y el refresh-state. Nunca son vínculos ni precios. */
export function facilitoRunCounts(state) {
  const corrida = state?.last_run ?? null;
  return { fresh: corrida?.fresh ?? 0, reused: corrida?.reused ?? Object.keys(state?.units ?? {}).length, failed: corrida?.failed ?? 0 };
}
