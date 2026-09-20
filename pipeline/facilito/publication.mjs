// ¿Vale la pena publicar esta composición?
//
// El cron corre cada seis horas y cada corrida trae un `observed_at` nuevo, así
// que la revisión cambiaría siempre: cuatro entregas al día y cuatro descargas
// de medio megabyte por cliente, casi todas para decir lo mismo con otra hora.
//
// Se publica cuando cambia algo que alguien puede ver: un precio efectivo, un
// grifo que gana o pierde su consulta, o una captura publicada que se acerca a
// las 24 horas y hay que renovar antes de que el respaldo entre sin necesidad.
// Cuando no cambia nada de eso, la entrega anterior sigue siendo correcta y se
// queda: su consulta sigue dentro de su ventana.

/** Se renueva antes de vencer, no al vencer: con el cron de 6 h sobra margen. */
export const REPUBLISH_AFTER_MS = 18 * 3_600_000;

const capaPorOferta = (datasets) => {
  const mapa = new Map();
  for (const dataset of Object.values(datasets ?? {})) {
    for (const offer of dataset?.offers ?? []) mapa.set(offer.id, offer.facilito ?? null);
  }
  return mapa;
};

/**
 * @param {object} entrada
 * @param {object} entrada.candidate   datasets por producto de la composición nueva
 * @param {object|null} entrada.published  datasets por producto de lo que ya sirve producción
 * @param {number} entrada.now
 * @returns {{visible: boolean, reason: string, changed_offers: number}}
 */
export function facilitoPublicationChange({ candidate, published, now }) {
  const nuevos = capaPorOferta(candidate);
  const previos = capaPorOferta(published);
  if (!previos.size) return { visible: true, reason: 'lo publicado no tiene capa de consulta', changed_offers: nuevos.size };

  let cambiadas = 0;
  for (const [id, capa] of nuevos) {
    const antes = previos.get(id) ?? null;
    // Un precio distinto, una consulta que entra y una que se cae son el mismo
    // hecho para quien mira la tarjeta: lo que dice el precio cambió.
    if ((antes?.price ?? null) !== (capa?.price ?? null)) cambiadas += 1;
  }
  for (const id of previos.keys()) if (!nuevos.has(id)) cambiadas += 1;
  if (cambiadas) return { visible: true, reason: `${cambiadas} ofertas cambian de precio efectivo o de fuente`, changed_offers: cambiadas };

  const instantes = [...previos.values()].map((capa) => Date.parse(capa?.observed_at ?? '')).filter(Number.isFinite);
  const masVieja = instantes.length ? Math.min(...instantes) : null;
  if (masVieja !== null && now - masVieja > REPUBLISH_AFTER_MS) {
    return { visible: true, reason: 'la consulta publicada se acerca a las 24 horas', changed_offers: 0 };
  }
  return { visible: false, reason: 'ningún precio efectivo cambia y la consulta publicada sigue vigente', changed_offers: 0 };
}
