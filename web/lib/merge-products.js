import { GASOLINA_KEYS } from './catalog.js';

// Los bundles de una vista describen el mismo universo de grifos —en Gasolina
// la mayoría aparece en los dos— y solo difieren en precio y fecha. Fusionarlos
// deja una tarjeta por grifo con todos sus precios, que es como se decide parado
// frente al surtidor. Un grifo presente en un solo producto conserva su tarjeta
// con el precio que sí reportó. Los productos son los de la vista, en su orden:
// el conjunto fusionado los declara para que nadie tenga que adivinarlos.
export function mergeProducts(...cargados) {
  const keys = cargados.map((item) => item.key);
  const porProducto = new Map(cargados.map((item) => [item.key, item]));
  const base = porProducto.get(keys[0]) ?? cargados[0];
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
    products: keys,
    offers: Object.fromEntries(keys.map((key) => [key, porProducto.get(key)?.dataset.offers ?? []])),
  };
}

// Recibe, por producto, las ofertas vigentes y las vencidas. La vigencia se
// evalúa antes de fusionar y no después: un grifo con Regular vigente y Premium
// vencido conserva la fila y apaga solo el precio vencido. Y cuando los dos
// vencen, la fila tampoco desaparece: queda muda, porque el grifo sigue
// existiendo en el Registro y borrarlo diría que cerró.
export function mergeOfferRows(vigentes, vencidas = {}, keys = GASOLINA_KEYS) {
  const filas = new Map();
  const fila = (offer) => {
    let actual = filas.get(offer.establishment_id);
    if (!actual) {
      // Dirección, coordenada e identidad salen del primer bundle que traiga
      // el establecimiento; están medidas como idénticas en ambos.
      // `age_days` arranca en Infinity y solo lo baja un precio VIGENTE: si lo
      // sembrara la primera oferta que llega y esa fuera vencida, una tarjeta
      // con Premium de hoy anunciaría «Hace 190 días».
      actual = { establishment_id: offer.establishment_id, address: offer.address, district: offer.district, latitude: offer.latitude, longitude: offer.longitude, commercial_identity: offer.commercial_identity, prices: Object.fromEntries(keys.map((item) => [item, null])), age_days: Infinity, age_source: null, silent_days: Infinity, last_reported_at: null, last_observed_at: null };
      filas.set(offer.establishment_id, actual);
    }
    // Desde cuándo calla: el reporte más reciente que tiene, vigente o no, y
    // siempre el del CSV. Que nuestra consulta fallara o venciera no es silencio
    // del operador y no puede contarse como tal.
    if (offer.reported_age_days < actual.silent_days) { actual.silent_days = offer.reported_age_days; actual.last_reported_at = offer.reported_at; }
    // La última vez que vimos su tabla se conserva aparte: última consulta y
    // último reporte son fechas distintas y no se funden en una.
    const observado = offer.facilito?.observed_at ?? null;
    if (observado && (!actual.last_observed_at || Date.parse(observado) > Date.parse(actual.last_observed_at))) actual.last_observed_at = observado;
    return actual;
  };
  for (const key of keys) {
    for (const offer of vigentes[key] ?? []) {
      const actual = fila(offer);
      actual.prices[key] = { id: offer.id, price: offer.price, reported_at: offer.reported_at, age_days: offer.age_days, source: offer.price_source, at: offer.price_at };
      // «Hace N días» habla del precio más reciente que la tarjeta muestra, y
      // `age_source` dice de dónde salió ese más reciente: sin eso la etiqueta
      // no puede elegir entre «Consultado» y «Reportado» sin inventarse cuál.
      if (offer.age_days < actual.age_days) { actual.age_days = offer.age_days; actual.age_source = offer.price_source; }
    }
  }
  for (const key of keys) for (const offer of vencidas[key] ?? []) fila(offer);
  return [...filas.values()].map((item) => ({
    ...item,
    age_days: Number.isFinite(item.age_days) ? item.age_days : null,
    silent_days: Number.isFinite(item.silent_days) ? item.silent_days : null,
    // Un solo lugar decide si la fila tiene algo que comparar; lo consultan la
    // tarjeta, los contadores y el radio inicial.
    has_price: keys.some((product) => item.prices[product]),
  }));
}
