// Catálogo público de productos: el único lugar con sus metadatos.
//
// Lo leen la página, el service worker, la proyección y la validación, así que
// aquí solo vive lo que ya es público en el bundle o en la interfaz: clave,
// nombre canónico del CSV, etiquetas, unidad y moneda. Los códigos de
// adquisición, las actividades autorizadas y las reglas de vínculo son de
// operación y se quedan en `pipeline/`. Sin imports y sin E/S: tiene que cargar
// igual en Node y en el navegador.

// `gender` concuerda el adjetivo con el producto que se nombra: «Regular más
// barata» habla de la gasolina, «Diésel más barato» del diésel.
const producto = (key, canonical, label, short, chip, gender) => Object.freeze({ key, canonical, label, short, chip, gender, unit: 'Galones', currency: 'PEN' });

export const PRODUCTS = Object.freeze({
  regular: producto('regular', 'GASOHOL REGULAR', 'Gasohol Regular', 'Regular', 'REG', 'f'),
  premium: producto('premium', 'GASOHOL PREMIUM', 'Gasohol Premium', 'Premium', 'PRE', 'f'),
  // El nombre exacto del CSV, con sus mayúsculas: las otras variedades de diésel
  // son registros distintos y no se unen por parecido.
  diesel: producto('diesel', 'Diesel B5 S-50 UV', 'Diésel B5 S-50 UV', 'Diésel', 'B5 S-50 UV', 'm'),
  // `GLP - G` es el GLP a granel que se despacha a vehículos, en galones. El
  // mismo nombre en kilogramos y los cilindros son otros registros y no entran.
  glp: producto('glp', 'GLP - G', 'GLP automotor', 'GLP', 'GLP', 'm'),
});

const LIMA = Object.freeze({ department: 'LIMA', province: 'LIMA' });

// Regular y Premium se publican juntos y se pintan en la misma tarjeta. El orden
// de esta lista es el de los descriptores del manifest, el de los bundles y el
// de los precios en la tarjeta.
export const GASOLINA_KEYS = Object.freeze(['regular', 'premium']);

export const GASOLINA = Object.freeze({
  key: 'gasolina',
  products: GASOLINA_KEYS,
  scope: LIMA,
  dataRoot: 'data/gasolina',
});

// Diésel es un grupo propio de un solo producto: su revisión, su estado y sus
// guardrails no dependen de los de Gasolina.
export const DIESEL_KEYS = Object.freeze(['diesel']);

export const DIESEL = Object.freeze({
  key: 'diesel',
  products: DIESEL_KEYS,
  scope: LIMA,
  dataRoot: 'data/diesel',
});

// GLP sale de su propia fuente, el CSV de GLP: su corte y su revisión no son
// los de los líquidos.
export const GLP_KEYS = Object.freeze(['glp']);

export const GLP = Object.freeze({
  key: 'glp',
  products: GLP_KEYS,
  scope: LIMA,
  dataRoot: 'data/glp',
});

export const GROUPS = Object.freeze({ gasolina: GASOLINA, diesel: DIESEL, glp: GLP });

// Vistas: lo que la persona elige ver. Cada una muestra juntos sus productos y
// vive en `/combustibles/<clave>`. Solo existen las de `ACTIVE_VIEWS`: activar una
// vista es una decisión de cada entrega, no el efecto de que aparezcan sus datos.
// `priceUnit` es la unidad que la tarjeta escribe junto al precio; Gasolina no la
// escribe porque su tarjeta conjunta no cambia.
export const VIEWS = Object.freeze({
  gasolina: Object.freeze({ key: GASOLINA.key, label: 'Gasolina', products: GASOLINA.products, dataRoot: GASOLINA.dataRoot, history: true, priceUnit: null }),
  diesel: Object.freeze({ key: DIESEL.key, label: 'Diésel', products: DIESEL.products, dataRoot: DIESEL.dataRoot, history: false, priceUnit: 'por galón' }),
  glp: Object.freeze({ key: GLP.key, label: 'GLP', products: GLP.products, dataRoot: GLP.dataRoot, history: false, priceUnit: 'por galón' }),
});
export const ACTIVE_VIEWS = Object.freeze(['gasolina', 'diesel', 'glp']);
export const DEFAULT_VIEW = 'gasolina';
