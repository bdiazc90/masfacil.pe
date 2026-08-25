import { GASOLINA_KEYS } from '../gasolina-contract.js';

// Los dos bundles describen el mismo universo de grifos —697 de 717 aparecen en
// ambos— y solo difieren en precio y fecha. Fusionarlos deja una tarjeta por
// grifo con los dos precios, que es como se decide parado frente al surtidor.
export function mergeProducts(...cargados) {
  const porProducto = new Map(cargados.map((item) => [item.key, item]));
  const base = porProducto.get(GASOLINA_KEYS[0]) ?? cargados[0];
  const cortes = cargados.map((item) => item.dataset.cutoff_at);
  return {
    revision_id: base.manifest.revision_id,
    scope: base.dataset.scope,
    snapshot_date: base.dataset.snapshot_date,
    // El corte más antiguo manda: es hasta dónde se puede afirmar que los dos
    // productos están verificados. Hoy coinciden, pero se declara igual.
    cutoff_at: cortes.reduce((viejo, actual) => (Date.parse(actual) < Date.parse(viejo) ? actual : viejo)),
    provenance: base.dataset.provenance,
    // Basta que un bundle venga de la copia guardada para no prometer datos vivos.
    dataMode: cargados.some((item) => item.dataMode === 'saved') ? 'saved' : 'network',
    offers: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, porProducto.get(key)?.dataset.offers ?? []])),
  };
}

// Recibe, por producto, las ofertas que ya pasaron el filtro de 30 días. La
// frescura se evalúa antes de fusionar y no después: un grifo con Regular
// vigente y Premium vencido conserva la fila y apaga solo el precio vencido,
// en vez de desaparecer entero.
export function mergeOfferRows(frescas) {
  const filas = new Map();
  for (const key of GASOLINA_KEYS) {
    for (const offer of frescas[key] ?? []) {
      let fila = filas.get(offer.establishment_id);
      if (!fila) {
        // Dirección, coordenada e identidad salen del primer bundle que traiga
        // el establecimiento; están medidas como idénticas en ambos.
        fila = { establishment_id: offer.establishment_id, address: offer.address, district: offer.district, latitude: offer.latitude, longitude: offer.longitude, commercial_identity: offer.commercial_identity, prices: Object.fromEntries(GASOLINA_KEYS.map((item) => [item, null])), age_days: offer.age_days };
        filas.set(offer.establishment_id, fila);
      }
      fila.prices[key] = { id: offer.id, price: offer.price, reported_at: offer.reported_at, age_days: offer.age_days };
      // «Hace N días» habla del precio más reciente que la tarjeta muestra.
      if (offer.age_days < fila.age_days) fila.age_days = offer.age_days;
    }
  }
  return [...filas.values()];
}
