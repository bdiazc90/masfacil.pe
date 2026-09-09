// Lista controlada de logos de marca. Solo lo que está aquí se puede pintar:
// los datos publicados llevan `commercial_identity.brand`, nunca una URL, así
// que ninguna entrada del catálogo puede introducir un recurso nuevo.
//
// Se acepta el activo oficial de la marca o una recreación fiel desde una
// referencia oficial; lo que no se acepta es llamar oficial a lo segundo. Por
// eso cada entrada declara `source_kind` junto a su procedencia real, y todas
// pasan el mismo saneamiento de `app/shell-assets.mjs` al instalarse: se sirven
// locales y se referencian con <img>, así que no ejecutan scripts ni piden nada
// a terceros.
//
// Sin entrada aquí —Petroperú hoy solo publica su logo en PNG— la tarjeta
// muestra la marca en texto y ya. Marca identificada y logo disponible siguen
// siendo dos conteos distintos y no se mezclan.

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase('es-PE');

export const BRAND_LOGOS = Object.freeze({
  primax: Object.freeze({
    slug: 'primax',
    brand: 'Primax',
    width: 41,
    height: 15,
    source_kind: 'official_asset',
    source_url: 'https://creaturuta.primax.com.pe/img/svg/logo-primax-footer.svg',
    retrieved_at: '2026-09-06',
  }),
  repsol: Object.freeze({
    slug: 'repsol',
    brand: 'Repsol',
    width: 60,
    height: 14,
    source_kind: 'official_asset',
    source_url: 'https://www.repsol.pe/content/dam/global/logotipos/repsol/logo-repsol.svg',
    retrieved_at: '2026-09-06',
  }),
  ava: Object.freeze({
    slug: 'ava',
    brand: 'AVA',
    width: 17,
    height: 15,
    source_kind: 'owner_supplied',
    source_url: 'aportado por el owner',
    retrieved_at: '2026-09-07',
  }),
});

export const brandLogoPath = (slug) => `/icons/brands/${slug}.svg`;

/**
 * Devuelve el logo de una identidad comercial, o null.
 * La marca y su logo son la misma afirmación: si publicamos «Primax» en texto,
 * publicamos su logo. La única condición es tener el archivo en esta lista, y
 * por eso una marca sin SVG —Petroperú hoy— se queda en texto sin más.
 */
export function brandLogoFor(identity) {
  if (!identity?.brand) return null;
  return BRAND_LOGOS[normalize(identity.brand)] ?? null;
}
