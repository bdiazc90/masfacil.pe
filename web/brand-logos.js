// Lista controlada de activos de marca. Solo lo que está aquí se puede pintar:
// los datos publicados llevan `commercial_identity.brand`, nunca una URL ni una
// ruta, así que ninguna entrada del catálogo puede introducir un recurso nuevo.
//
// Cada marca declara sus VARIANTES renderizables con su función visual. Hoy la
// única es `mark`: el isotipo que firma la tarjeta. El archivo se declara aquí,
// no se deduce del slug: así una marca puede reutilizar un activo que ya es
// isotipo (AVA, Petroperú) o estrenar uno recortado o recreado (Primax, Repsol)
// sin abrir una segunda lista de marcas ni una convención paralela de rutas.
//
// Se acepta el activo oficial, una recreación fiel o un aporte del owner; lo que
// no se acepta es llamar oficial a lo que no lo es. Por eso cada variante declara
// `source_kind` junto a su procedencia real, y todas pasan el mismo saneamiento
// de `app/shell-assets.mjs` al instalarse: se sirven locales y se referencian con
// <img>, así que no ejecutan scripts, no piden nada a terceros y sus ids internos
// viven en un documento aislado que no puede colisionar con la página.
//
// Sin entrada aquí la tarjeta muestra la marca en texto y ya. Marca identificada
// y activo disponible siguen siendo dos conteos distintos y no se mezclan.

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase('es-PE');

/** Funciones visuales admitidas. Una variante sin rol conocido no se recorre. */
export const ASSET_ROLES = Object.freeze(['mark']);

/** El nombre de archivo es un dato del registro: se acota para que nunca sea una ruta. */
export const ASSET_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.svg$/;

export const BRAND_LOGOS = Object.freeze({
  primax: Object.freeze({
    slug: 'primax',
    brand: 'Primax',
    assets: Object.freeze({
      mark: Object.freeze({
        file: 'primax-mark.svg',
        width: 58,
        height: 57,
        source_kind: 'official_asset',
        source_url: 'https://creaturuta.primax.com.pe/img/svg/logo-primax-footer.svg',
        retrieved_at: '2026-09-06',
        note: 'isotipo recortado del activo oficial; el trazo y su degradado se conservan tal cual',
      }),
    }),
  }),
  repsol: Object.freeze({
    slug: 'repsol',
    brand: 'Repsol',
    assets: Object.freeze({
      mark: Object.freeze({
        file: 'repsol-mark.svg',
        width: 2476,
        height: 1796,
        source_kind: 'faithful_recreation',
        source_url: 'recreación fiel del isotipo desde https://www.repsol.pe/content/dam/global/logotipos/repsol/logo-repsol.svg',
        retrieved_at: '2026-09-13',
        note: 'misma geometría del símbolo, sin los filtros de desenfoque ni las máscaras del export original',
      }),
    }),
  }),
  ava: Object.freeze({
    slug: 'ava',
    brand: 'AVA',
    assets: Object.freeze({
      mark: Object.freeze({
        file: 'ava.svg',
        width: 112,
        height: 100,
        source_kind: 'owner_supplied',
        source_url: 'aportado por el owner',
        retrieved_at: '2026-09-07',
      }),
    }),
  }),
  petroperu: Object.freeze({
    slug: 'petroperu',
    brand: 'Petroperú',
    assets: Object.freeze({
      mark: Object.freeze({
        file: 'petroperu.svg',
        width: 450,
        height: 434,
        source_kind: 'faithful_recreation',
        source_url: 'recreación fiel desde la referencia oficial de Petroperú',
        retrieved_at: '2026-09-08',
      }),
    }),
  }),
});

/** Ruta pública de una variante. Sale del registro, nunca de una convención. */
export const brandAssetPath = (asset) => `/icons/brands/${asset.file}`;

/**
 * Todas las variantes renderizables del registro, una vez cada una.
 *
 * Es el ÚNICO recorrido de activos de marca: lo comparten la derivación de la
 * precache, el verificador, el instalador y la tarjeta. Mientras haya uno solo,
 * registrar una variante basta para que viaje, se sanee y se pinte.
 *
 * @param {object} [registry]
 * @returns {Generator<{key: string, role: string, entry: object, asset: object, path: string}>}
 */
export function* brandAssets(registry = BRAND_LOGOS) {
  for (const [key, entry] of Object.entries(registry)) {
    for (const role of ASSET_ROLES) {
      const asset = entry.assets?.[role];
      if (asset) yield { key, role, entry, asset, path: brandAssetPath(asset) };
    }
  }
}

/**
 * La variante de una identidad comercial, o null.
 *
 * La marca y su activo son la misma afirmación: si publicamos «Primax» en texto,
 * publicamos su isotipo. La única condición es tenerlo en esta lista, y por eso
 * una marca sin variante registrada se queda en texto sin más.
 */
export function brandAssetFor(identity, role = 'mark') {
  if (!identity?.brand) return null;
  const entry = BRAND_LOGOS[normalize(identity.brand)];
  const asset = entry?.assets?.[role];
  return asset ? { key: entry.slug, role, entry, asset, path: brandAssetPath(asset) } : null;
}
