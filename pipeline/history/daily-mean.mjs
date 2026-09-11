/**
 * Promedio del día por producto: el único cálculo del histórico.
 *
 * Describe LAS ESTACIONES QUE PARTICIPARON, no un índice de precios de población
 * fija ni una garantía de precio en surtidor. El promedio también se mueve
 * cuando entran o salen estaciones, y por eso `n` viaja siempre pegado a `mean`.
 *
 * La regla de vigencia NO se reimplementa aquí: se importa la misma que usa la
 * interfaz (`web/lib/freshness.js`), con el reloj inyectado en `observed_at`.
 * Cualquier otra cosa mediría algo distinto de lo que la app podía mostrar en
 * ese instante, que es justo lo que este indicador afirma.
 */

import { filterFreshOffers } from '../../web/lib/freshness.js';
import { GASOLINA_KEYS, validateGasolinaBundle } from '../gasolina-contract.mjs';

export const METHOD_VERSION = 'daily-mean-1';
/** Se persiste con cuatro decimales; la interfaz muestra dos. */
const PRECISION = 10_000;

/**
 * Media de un producto sobre las ofertas mostrables en `observedAt`.
 *
 * `blocked` distingue «no se pudo medir» de «no había precios elegibles». Los
 * dos dan `{mean: null, n: 0}`, pero el primero invalida la observación entera y
 * el segundo es un dato legítimo que se publica tal cual.
 *
 * @param {Array<object>} offers   ofertas del bundle público, tal cual
 * @param {{observedAt: string, cutoffAt: string}} entrada
 * @returns {{mean: number|null, n: number, blocked: boolean, contradictions: Array<object>, duplicates_ignored: number, problems: string[]}}
 */
export function productMean(offers, { observedAt, cutoffAt }) {
  const problems = [];
  let frescas;
  try {
    // Solo `.offers`: lo vencido viaja aparte a propósito para que la tarjeta del
    // grifo permanezca, pero un precio de hace 40 días no promedia nada de hoy.
    frescas = filterFreshOffers(offers, { now: () => observedAt, cutoffAt }).offers;
  } catch (error) {
    // Un reloj anterior al corte, o ilegible, no mide nada: publicar `n: 0` aquí
    // afirmaría que ese día no hubo precios, y lo que pasó es que no se pudo
    // mirar. Se marca bloqueada y no habrá observación.
    return { mean: null, n: 0, blocked: true, contradictions: [], duplicates_ignored: 0, problems: [error.message] };
  }

  // Cada estación pesa lo mismo, así que la clave es el establecimiento y no la
  // oferta: dos filas del mismo grifo no le dan doble voto.
  const porEstablecimiento = new Map();
  const contradictions = [];
  let duplicates_ignored = 0;
  for (const offer of frescas) {
    const anchor = offer?.establishment_id;
    if (typeof anchor !== 'string' || !anchor) { problems.push('oferta sin establishment_id utilizable'); continue; }
    if (!Number.isFinite(offer.price) || offer.price <= 0) { problems.push(`oferta con precio inválido: ${anchor}`); continue; }
    const previa = porEstablecimiento.get(anchor);
    if (!previa) { porEstablecimiento.set(anchor, { price: offer.price, reported_at: offer.reported_at }); continue; }
    // Repetir la misma fila no altera la media; que la fuente se contradiga sobre
    // el mismo establecimiento sí invalida la medición: no hay forma de elegir.
    if (previa.price === offer.price && previa.reported_at === offer.reported_at) { duplicates_ignored += 1; continue; }
    contradictions.push({ establishment_id: anchor, values: [previa, { price: offer.price, reported_at: offer.reported_at }] });
  }

  const precios = [...porEstablecimiento.values()].map((item) => item.price);
  const n = precios.length;
  // Se suma sin redondear ningún sumando; el redondeo es solo de persistencia.
  const mean = n ? Math.round((precios.reduce((total, price) => total + price, 0) / n) * PRECISION) / PRECISION : null;
  return { mean, n, blocked: false, contradictions, duplicates_ignored, problems };
}

/**
 * Los dos productos de un bundle público, con denominadores independientes.
 *
 * Valida manifest y ambos cuerpos antes de contar: bytes, hash y contrato. Como
 * los dos se validan contra el MISMO manifest, mezclar Regular de una revisión
 * con Premium de otra es imposible por construcción.
 *
 * @param {{manifest: object, bodies: {regular: string, premium: string}, observedAt: string}} entrada
 * @returns {{ok: boolean, products: object, contradictions: Array<object>, duplicates_ignored: object, problems: string[]}}
 */
export function observationMeans({ manifest, bodies, observedAt }) {
  const problems = [];
  const products = {};
  const contradictions = [];
  const duplicates_ignored = {};
  for (const key of GASOLINA_KEYS) {
    const body = bodies?.[key];
    if (typeof body !== 'string') { problems.push(`falta el cuerpo de ${key}`); continue; }
    const errores = validateGasolinaBundle(manifest, key, body);
    if (errores.length) { problems.push(...errores.map((motivo) => `${key}: ${motivo}`)); continue; }
    const dataset = JSON.parse(body);
    const medida = productMean(dataset.offers, { observedAt, cutoffAt: dataset.cutoff_at });
    if (medida.blocked) { problems.push(...medida.problems.map((motivo) => `${key}: ${motivo}`)); continue; }
    products[key] = { mean: medida.mean, n: medida.n };
    duplicates_ignored[key] = medida.duplicates_ignored;
    contradictions.push(...medida.contradictions.map((item) => ({ ...item, product: key })));
    problems.push(...medida.problems.map((motivo) => `${key}: ${motivo}`));
  }
  // Un bundle que se contradice consigo mismo no produce observación. Los bytes
  // sí se archivan —fueron públicos y son evidencia—, pero no se publica una
  // media que dependa de cuál de las dos filas se eligió.
  const completo = GASOLINA_KEYS.every((key) => products[key]);
  return { ok: completo && contradictions.length === 0, products, contradictions, duplicates_ignored, problems: [...new Set(problems)] };
}
