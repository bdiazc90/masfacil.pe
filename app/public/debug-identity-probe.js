// Sonda de inspección exclusiva de modo debug (Gate 2.1, corrección acotada).
//
// Objetivo: permitir comprobar tangiblemente que una identidad comercial
// verificada llega al cliente y puede caer dentro del pool visible, incluso
// cuando el origen normal (real o simulado) la deja fuera del pool de 20 por
// distancia. No sustituye SIMULATED_ORIGIN ni cambia nearestPool/visibleOffers:
// solo elige, en runtime, la coordenada exacta de una oferta ya servida por el
// backend que traiga `commercial_identity` no nulo, para usarla como origen.
//
// No debe contener nunca coordenadas, nombres ni marcas reales hardcodeadas:
// toda la información sale del dataset cargado en tiempo de ejecución.

/**
 * Busca, en orden, la primera oferta con `commercial_identity` no nulo y
 * devuelve su coordenada exacta. Es una función pura: no muta `offers` ni
 * ninguno de sus elementos, y nunca lanza una excepción no controlada — ante
 * cualquier entrada inválida u oferta con coordenadas no numéricas, devuelve
 * `null` para que el llamador declare la ausencia de forma honesta.
 *
 * @param {unknown} offers - dataset.offers ya cargado (o cualquier valor).
 * @returns {{ latitude: number, longitude: number } | null}
 */
export function pickIdentityProbeOrigin(offers) {
  if (!Array.isArray(offers)) return null;
  const withIdentity = offers.find((offer) => offer && typeof offer === 'object' && offer.commercial_identity != null);
  if (!withIdentity) return null;
  const { latitude, longitude } = withIdentity;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}
