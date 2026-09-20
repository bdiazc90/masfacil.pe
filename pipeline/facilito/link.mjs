// El vínculo entre una fila de la tabla pública y un establecimiento oficial.
//
// La tabla no publica el Registro ni ningún código: solo razón social,
// dirección, distrito, teléfono y precio. Así que el único puente honesto es el
// texto, y tiene que ser EXACTO y ÚNICO en ambos sentidos. Nada de distancia,
// nombre comercial, fuzzy ni expansión de abreviaturas: un vínculo dudoso no se
// resuelve, se descarta, porque publicar el precio de otro grifo es peor que no
// publicar ninguno.
//
// La comparación viaja como huella, no como texto. La razón social y la
// dirección son datos privados que no salen de `.local-cache/`; guardarlas otra
// vez en el estado persistido —que además se restaura en la caché de Actions—
// no aporta nada al vínculo, porque para comparar basta el SHA-256 de la terna
// normalizada. El texto vive en memoria durante la corrida y en el diagnóstico
// local, y ahí se queda.

import crypto from 'node:crypto';

export const FACILITO_LINK_SCHEME = 'facilito-link-v1';

/**
 * La normalización permitida: mayúsculas, tildes y espacios. Nada más.
 *
 * Es la misma del comparador del piloto, y es deliberadamente pobre: cada regla
 * extra («AV.» ≙ «AVENIDA», «N°» ≙ «NRO») convertiría una coincidencia exacta en
 * una interpretación, y entonces ya no sabríamos qué estamos afirmando.
 */
export const normalizeLinkText = (value) => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * La huella de una terna, o `null` si le falta alguna parte.
 *
 * Exigir las tres no vacías no es formalismo: sin dirección, «PRIMAX» en un
 * distrito grande coincidiría con una decena de grifos distintos.
 */
export function facilitoLinkKey(legalName, address, district) {
  const partes = [legalName, address, district].map(normalizeLinkText);
  if (partes.some((parte) => parte === '')) return null;
  return crypto.createHash('sha256').update(`${FACILITO_LINK_SCHEME}|${JSON.stringify(partes)}`).digest('hex').slice(0, 32);
}

export const MAX_QUERY_AGE_MS = 24 * 3_600_000;

/**
 * Qué oferta recibe qué precio de la consulta, para un producto.
 *
 * Unicidad en ambos sentidos, como manda el SPEC: una fila no se asigna a dos
 * establecimientos, y un establecimiento/producto no recibe dos precios
 * incompatibles. Si una huella aparece dos veces en cualquiera de los dos lados,
 * las dos partes quedan fuera y se cuentan como ambiguas; no se desempata por
 * orden de archivo, que es elegir al azar con cara seria.
 *
 * @param {object} entrada
 * @param {object} entrada.state       estado privado (`pipeline/facilito/state.mjs`)
 * @param {Map<string,string>} entrada.linkKeys  id de oferta → huella
 * @param {string} entrada.product     'regular' | 'premium'
 * @param {number} entrada.now         instante de composición, en ms
 * @returns {{byOfferId: Map<string,{price:number,observed_at:string,reported_at:null}>, counts: object}}
 */
export function resolveFacilitoLayer({ state, linkKeys, product, now }) {
  const vigentes = [];
  let expiradas = 0;
  for (const unidad of Object.values(state?.units ?? {})) {
    if (unidad.product !== product) continue;
    const observado = Date.parse(unidad.observed_at);
    // Una captura que ya venció no se publica: el cliente la rechazaría igual y
    // solo engordaría el bundle. Se conserva en el expediente con su hora
    // original, que es lo que el SPEC pide preservar.
    if (!Number.isFinite(observado) || now - observado > MAX_QUERY_AGE_MS || now < observado) { expiradas += 1; continue; }
    for (const row of unidad.rows ?? []) vigentes.push({ ...row, observed_at: unidad.observed_at });
  }

  const porHuella = new Map();
  for (const row of vigentes) {
    if (!row.key_hash || !Number.isFinite(row.price) || row.price <= 0) continue;
    porHuella.set(row.key_hash, [...(porHuella.get(row.key_hash) ?? []), row]);
  }
  const ofertasPorHuella = new Map();
  for (const [offerId, key] of linkKeys) {
    if (!key) continue;
    ofertasPorHuella.set(key, [...(ofertasPorHuella.get(key) ?? []), offerId]);
  }

  const byOfferId = new Map();
  let ambiguous = 0;
  let unlinked = 0;
  for (const [key, filas] of porHuella) {
    const ofertas = ofertasPorHuella.get(key) ?? [];
    if (filas.length > 1 || ofertas.length > 1) { ambiguous += 1; continue; }
    if (ofertas.length === 0) { unlinked += 1; continue; }
    byOfferId.set(ofertas[0], { price: filas[0].price, observed_at: filas[0].observed_at, reported_at: null });
  }
  return { byOfferId, counts: { rows: vigentes.length, linked: byOfferId.size, ambiguous, unlinked, expired_units: expiradas } };
}
