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
