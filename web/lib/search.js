// Reglas de consulta: qué filas hay, cuáles entran en la búsqueda y en qué orden.
//
// Todo lo que decide la lista de resultados vive aquí como datos. No se pinta
// nada, no se guarda nada y no se lee el reloj del sistema: el instante llega
// como argumento, igual que en `freshness.js` y `price-source.js`. La página lo
// traduce a marcado; una prueba en Node, o una interfaz futura, lo llama igual.

import { GASOLINA, GASOLINA_KEYS } from './catalog.js';
import { filterFreshOffers } from './freshness.js';
import { msUntilSourceChange } from './price-source.js';
import { mergeOfferRows } from './merge-products.js';
import { haversineKm, initialRadiusKm, nextVisibleCount, orderOffers, radiusIsInert, withinRadius, PAGE_SIZE, RADIUS_MIN_KM, SHOW_ALL_THRESHOLD } from './haversine.js';
import { decisionTag } from './decision-view.js';

/**
 * Lo que la persona eligió, declarado y no deducido de la pantalla. Con
 * `origin` se mide desde un punto; con `district`, dentro de él. `sort` dice si
 * se ordena por cercanía o por precio, y `priceProduct` de qué producto.
 */
export function createSearch() {
  return { view: GASOLINA.key, origin: null, district: null, radiusKm: RADIUS_MIN_KM, sort: 'distance', priceProduct: GASOLINA_KEYS[0], visibleCount: PAGE_SIZE, preferencesTouched: false };
}

/**
 * Las filas vigentes en `instante` y hasta cuándo siguen valiendo.
 *
 * La vigencia se evalúa por producto y recién después se fusiona: un grifo con
 * Regular vigente y Premium vencido conserva su tarjeta y apaga solo ese
 * precio, y lo vencido viaja aparte para que la fila quede muda en vez de
 * desaparecer. `refreshAt` es el próximo instante en que alguna oferta cambia de
 * respuesta —una consulta que cruza las 24 horas o un reporte que cruza los 30
 * días—: se le pregunta a la oferta y no a su edad porque el cambio de fuente
 * tiene que ocurrir también sin red, con el bundle ya guardado.
 *
 * @param {{offers: Record<string, object[]>, cutoff_at: string}} dataset
 * @param {Date} instante
 */
export function evaluateRows(dataset, instante) {
  const now = () => instante;
  const cutoffAt = dataset.cutoff_at;
  const porProducto = Object.fromEntries(GASOLINA_KEYS.map((key) => [key, filterFreshOffers(dataset.offers[key], { now, cutoffAt })]));
  const rows = mergeOfferRows(
    Object.fromEntries(GASOLINA_KEYS.map((key) => [key, porProducto[key].offers])),
    Object.fromEntries(GASOLINA_KEYS.map((key) => [key, porProducto[key].expired])),
  );
  const proximo = GASOLINA_KEYS.flatMap((key) => dataset.offers[key] ?? [])
    .reduce((menor, offer) => Math.min(menor, msUntilSourceChange(offer, { now, cutoffAt })), Infinity);
  return { rows, refreshAt: Number.isFinite(proximo) ? instante.getTime() + proximo : Infinity };
}

// Lo que de verdad se puede comparar. Lo consultan el estado vacío, el radio
// inicial y los controles que solo tienen sentido con más de un precio.
export const withPrice = (rows) => rows.filter((row) => row.has_price);
export const withDistances = (rows, origin) => rows.map((row) => ({ ...row, distance_km: haversineKm(origin, row) }));
export const districtsFrom = (rows) => [...new Set(rows.map((row) => row.district))].sort();

/**
 * La búsqueda con la que se abren unos resultados. La lista vuelve a su primera
 * página. Con ubicación, el radio se abre donde caben seis PRECIOS —medirlo
 * sobre todas las filas lo dejaría estrecho y lleno de tarjetas mudas— y el orden
 * vuelve a la cercanía, salvo que la persona ya haya elegido radio o criterio:
 * eso es una preferencia, no una consecuencia de dónde está.
 */
export function startResults(search, located) {
  const inicio = { ...search, visibleCount: PAGE_SIZE };
  if (!search.origin || search.preferencesTouched) return inicio;
  return { ...inicio, radiusKm: initialRadiusKm(withPrice(located)), sort: 'distance' };
}

/**
 * Lo que muestra la lista de resultados, sin pintarlo.
 *
 * Con ubicación, el radio filtra, el criterio ordena y la lista pagina: cada
 * control hace una cosa. Con distrito se ordena por el precio del producto
 * elegido y no hay radio. Sin un solo precio vigente, ordenar por precio no
 * significa nada y se cae a cercanía sin tocar la preferencia guardada.
 *
 * @returns {{hasPrices: boolean, byPrice: boolean, pool: object[], ordered: object[], items: object[], comparables: number, tags: (string|null)[], activeProduct: string|null, sortToggle: boolean, productToggle: boolean, radius: {inert: boolean, total: number}|null, radiusEmpty: boolean, remaining: number, nextCount: number, paged: boolean, criterion: 'none'|'price'|'distance'}}
 */
export function resultsView({ rows, located, search }) {
  const conOrigen = Boolean(search.origin);
  const hasPrices = withPrice(rows).length > 0;
  const byPrice = hasPrices && search.sort === 'price';
  const product = search.priceProduct;
  const pool = conOrigen ? withinRadius(located, search.radiusKm) : [];
  const ordered = conOrigen
    ? orderOffers(pool, byPrice ? `price:${product}` : 'distance')
    : orderOffers(rows.filter((row) => row.district === search.district), `price:${product}`);
  // Si lo que falta cabe en el umbral se muestra entero: un botón para cuatro
  // tarjetas cuesta más de lo que ahorra.
  const pedidas = Math.min(search.visibleCount, ordered.length);
  const items = ordered.slice(0, ordered.length - pedidas <= SHOW_ALL_THRESHOLD ? ordered.length : pedidas);
  const comparables = withPrice(items).length;
  // El tag compara dentro del radio con el producto elegido también en «Más
  // cerca»: dice cuál es la más barata aunque la lista no ordene por precio.
  const conTag = conOrigen && comparables > 1;
  const remaining = ordered.length - items.length;
  return {
    hasPrices,
    byPrice,
    pool,
    ordered,
    items,
    comparables,
    tags: items.map((offer) => (conTag ? decisionTag(offer, pool, search.radiusKm, product) : null)),
    activeProduct: byPrice || !conOrigen ? product : null,
    sortToggle: conOrigen && comparables >= 2,
    // El sub-toggle solo aparece cuando el orden depende del producto: en «Más
    // cerca» no ordena nada y sería un control que no hace lo que promete.
    productToggle: (byPrice || !conOrigen) && comparables >= 2,
    radius: conOrigen ? { inert: radiusIsInert(located), total: pool.length } : null,
    radiusEmpty: conOrigen && items.length === 0,
    remaining,
    nextCount: nextVisibleCount(items.length, ordered.length),
    // Solo se cuenta cuando hubo algo que paginar: en una lista que cabe entera
    // el radio ya dice cuántas son.
    paged: ordered.length > items.length || ordered.length > PAGE_SIZE + SHOW_ALL_THRESHOLD,
    // El resumen tiene su propia regla: sin origen siempre se ordena por precio,
    // y sin precios no promete un orden que no existe.
    criterion: !hasPrices ? 'none' : search.sort === 'price' || !conOrigen ? 'price' : 'distance',
  };
}
