// Catálogo público de productos: el único lugar con sus metadatos.
//
// Lo leen la página, el service worker, la proyección y la validación, así que
// aquí solo vive lo que ya es público en el bundle o en la interfaz: clave,
// nombre canónico del CSV, etiquetas, unidad y moneda. Los códigos de
// adquisición, las actividades autorizadas y las reglas de vínculo son de
// operación y se quedan en `pipeline/`. Sin imports y sin E/S: tiene que cargar
// igual en Node y en el navegador.

const producto = (key, canonical, label, short, chip) => Object.freeze({ key, canonical, label, short, chip, unit: 'Galones', currency: 'PEN' });

export const PRODUCTS = Object.freeze({
  regular: producto('regular', 'GASOHOL REGULAR', 'Gasohol Regular', 'Regular', 'REG'),
  premium: producto('premium', 'GASOHOL PREMIUM', 'Gasohol Premium', 'Premium', 'PRE'),
});

// Regular y Premium se publican juntos y se pintan en la misma tarjeta. El orden
// de esta lista es el de los descriptores del manifest, el de los bundles y el
// de los precios en la tarjeta.
export const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);

export const GASOLINA = Object.freeze({
  key: 'gasolina',
  products: GASOLINA_KEYS,
  scope: Object.freeze({ department: 'LIMA', province: 'LIMA' }),
  dataRoot: 'data/gasolina',
});

// Vistas: lo que la persona elige ver. Cada una muestra juntos sus productos y
// vive en `/combustibles/<clave>`. Solo existen las de `ACTIVE_VIEWS`: activar una
// vista es una decisión de cada entrega, no el efecto de que aparezcan sus datos.
export const VIEWS = Object.freeze({
  gasolina: Object.freeze({ key: GASOLINA.key, products: GASOLINA.products, dataRoot: GASOLINA.dataRoot, history: true }),
});
export const ACTIVE_VIEWS = Object.freeze(['gasolina']);
export const DEFAULT_VIEW = 'gasolina';
