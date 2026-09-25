// Grupos: cada vista activa del catálogo con su contrato de Node y su
// configuración de operación, y los grupos que todavía se preparan en privado.
//
// `PUBLISHED_GROUPS` es la lista que recorren la descarga del bundle vivo, el
// verificador, el preflight y la proyección, para que ninguno publique ni compare
// un grupo y se olvide de otro. `CONFIGURED_GROUPS` suma los que se adquieren y
// se juzgan sin publicarse, como GLP antes de tener su vista. Es de operación:
// no viaja a `web/`.

import { ACTIVE_VIEWS, GROUPS } from '../web/lib/catalog.js';
import { GROUP_RULES } from '../web/lib/bundle-contract.js';
import { nodeContract } from './gasolina-contract.mjs';

// Actividades del CSV que cuentan como venta al público, con su código en el
// Registro. Son las que filtra la semilla (`bootstrap/seed.manifest.json`): una
// actividad fuera de ella no tiene con qué cruzarse.
const ESTACIONES = Object.freeze({ 'ESTACIÓN DE SERVICIOS / GRIFOS': '01', 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP': '02', 'EE.SS con GNV': '05', 'EE.SS con GLP y GNV': '06' });

// Las que venden GLP a granel a vehículos, según el CSV de GLP: las estaciones
// con gasocentro (Registro 02 y 06, capa GIS 35) y los gasocentros (Registro 15,
// capa 36), con o sin GNV. Las plantas envasadoras también reportan `GLP - G` en
// galones, pero venden a agentes, no a conductores, y quedan fuera.
const GASOCENTROS = Object.freeze({ 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP': '02', 'EE.SS con GLP y GNV': '06', 'GASOCENTROS DE GLP': '15', 'GASOCENTRO DE GLP CON ESTABLECIMIENTO DE VENTA AL PUBLICO DE GNV': '15' });
const LIMA = Object.freeze({ department: 'LIMA', province: 'LIMA' });

/**
 * Lo que cada grupo necesita para proyectarse, compararse y recuperarse.
 *
 * - `source`: la fuente de la que sale (`sources.mjs`). Un refresco de una fuente
 *   nunca juzga ni mueve los grupos de otra.
 * - `gisLayers`: la capa GIS de cada código del Registro; sin ella, la 35.
 * - `clientType`: el tipo de cliente exigido, si la fuente lo declara.
 * - `idScheme`: prefijo y espacio de nombres de los IDs de oferta. Cambiarlos
 *   cambia todos los IDs publicados.
 * - `revisionPrefix`: con qué empieza la revisión de sus bundles.
 * - `guardrails`: caída máxima de ofertas frescas y de cobertura entre dos
 *   versiones, y la base auditada contra la que se juzga la primera activación.
 */
export const GROUP_CONFIG = Object.freeze({
  gasolina: Object.freeze({
    source: 'liquid-current',
    gisLayers: null,
    clientType: null,
    activities: ESTACIONES,
    idScheme: Object.freeze({ prefix: 'g2_', namespace: 'masfacil-pe|gasolina-v2' }),
    revisionPrefix: 'gasolina-',
    guardrails: Object.freeze({ maxOfferDrop: 0.2, maxCoverageDropPoints: 5, firstActivation: null }),
  }),
  // Las cuatro actividades de estación de servicio, con evidencia del CSV del
  // 24/09/2026: son las únicas que venden `Diesel B5 S-50 UV` al público en
  // Lima (853 establecimientos). La otra que lo reporta, «DISTRIBUIDOR MAYORISTA
  // DE COMBUSTIBLES LIQUIDOS» (8 registros), vende al por mayor y queda fuera.
  diesel: Object.freeze({
    source: 'liquid-current',
    gisLayers: null,
    clientType: null,
    activities: ESTACIONES,
    idScheme: Object.freeze({ prefix: 'd1_', namespace: 'masfacil-pe|diesel-v1' }),
    revisionPrefix: 'diesel-',
    guardrails: Object.freeze({
      maxOfferDrop: 0.2,
      maxCoverageDropPoints: 5,
      // La base auditada antes de activar: el embudo del CSV del 24/09/2026
      // (validadores `…,275`, `Thu, 24 Sep 2026 12:31:26 GMT`), el mismo que
      // publicaba Gasolina. Sin estado publicado, la primera versión se compara
      // contra ella con las mismas tolerancias, y además no puede perder más de
      // dos de sus 43 distritos: cinco tienen un solo grifo.
      firstActivation: Object.freeze({
        audited: Object.freeze({
          source_max_reported_at: '2026-09-24T04:59:31.000Z',
          products: Object.freeze({
            diesel: Object.freeze({ fresh_0_30_days: Object.freeze({ offers: 752, districts: 43 }), contract_ready: Object.freeze({ offers: 714, districts: 43 }), coverage_percent: 94.947, published: Object.freeze({ offers: 732, districts: 43 }) }),
          }),
        }),
        maxDistrictLoss: 2,
      }),
    }),
  }),
  // GLP se adquiere y se juzga en privado hasta que tenga vista (Fase 3B): su
  // producto todavía no está en el catálogo público, así que su definición vive
  // aquí, y nada suyo llega a `web/`.
  glp: Object.freeze({
    source: 'glp-current',
    products: Object.freeze(['glp']),
    productDefinitions: Object.freeze({ glp: Object.freeze({ key: 'glp', canonical: 'GLP - G', label: 'GLP automotor', unit: 'Galones', currency: 'PEN' }) }),
    scope: LIMA,
    gisLayers: Object.freeze({ '02': '35', '06': '35', '15': '36' }),
    clientType: 'Usuario Final',
    activities: GASOCENTROS,
    idScheme: Object.freeze({ prefix: 'glp1_', namespace: 'masfacil-pe|glp-v1' }),
    revisionPrefix: 'glp-',
    guardrails: Object.freeze({
      maxOfferDrop: 0.2,
      maxCoverageDropPoints: 5,
      // La base auditada: el embudo del CSV de GLP del 24/09/2026 (validadores
      // `…,278`, `Thu, 24 Sep 2026 12:28:56 GMT`) contra la semilla v2. En esas
      // cuatro actividades solo aparece `GLP - G` en galones para «Usuario
      // Final». De 510 últimos reportes en Lima se pierden 79 que no están en
      // el Registro del 14/08 y 6 sin punto GIS. Son 41 distritos, y en cinco
      // hay un solo gasocentro.
      firstActivation: Object.freeze({
        audited: Object.freeze({
          source_max_reported_at: '2026-09-24T04:59:31.000Z',
          products: Object.freeze({
            glp: Object.freeze({ fresh_0_30_days: Object.freeze({ offers: 449, districts: 41 }), contract_ready: Object.freeze({ offers: 415, districts: 41 }), coverage_percent: 92.428, published: Object.freeze({ offers: 425, districts: 41 }) }),
          }),
        }),
        maxDistrictLoss: 2,
      }),
    }),
  }),
});

/** Un grupo con todo lo que se sabe de él: catálogo, contrato y operación. */
export function describeGroup(key) {
  const grupo = GROUPS[key];
  const rules = GROUP_RULES[key];
  const config = GROUP_CONFIG[key];
  if (!grupo || !rules || !config) throw new Error(`Grupo sin catálogo, contrato o configuración: ${key}`);
  return Object.freeze({ key, dataRoot: grupo.dataRoot, products: grupo.products, scope: grupo.scope, rules, validate: nodeContract(rules), config });
}

export const PUBLISHED_GROUPS = Object.freeze(ACTIVE_VIEWS.map((key) => {
  if (!GROUP_RULES[key]) throw new Error(`Vista activa sin contrato de publicación: ${key}`);
  return describeGroup(key);
}));

export const groupByKey = (key) => PUBLISHED_GROUPS.find((grupo) => grupo.key === key) ?? null;

/**
 * Un grupo publicado, o uno que se prepara en privado: sin vista ni contrato
 * público, con sus productos y su ámbito tomados de su configuración.
 */
export function configuredGroup(key) {
  const publicado = groupByKey(key);
  if (publicado) return publicado;
  const config = GROUP_CONFIG[key];
  if (!config) throw new Error(`Grupo sin configuración: ${key}`);
  if (GROUPS[key] && GROUP_RULES[key]) return describeGroup(key);
  return Object.freeze({ key, dataRoot: null, products: config.products, scope: config.scope, rules: null, validate: null, config, private: true });
}

/** Todos los grupos que el refresco adquiere y juzga: los publicados y los privados. */
export const CONFIGURED_GROUPS = Object.freeze(Object.keys(GROUP_CONFIG).map(configuredGroup));

/** Los grupos que salen de una fuente, en el orden de la configuración. */
export const groupsOfSource = (sourceId, groups = CONFIGURED_GROUPS) => groups.filter((grupo) => grupo.config.source === sourceId);

/** Lo que el constructor de productos necesita de un grupo. */
export const productGroup = (grupo) => ({ key: grupo.key, products: grupo.products, activities: grupo.config.activities, scope: grupo.scope, idScheme: grupo.config.idScheme, gisLayers: grupo.config.gisLayers, clientType: grupo.config.clientType, productDefinitions: grupo.config.productDefinitions });

/**
 * Cómo se cachean los datos de cada grupo, en el formato de `web/_headers`. El
 * manifest y el estado cambian con cada entrega y no se guardan nunca; un
 * snapshot es inmutable por construcción —contenido distinto, ruta distinta— y
 * se guarda un año. El servidor local y el verificador leen lo mismo.
 */
export function dataCacheRules(groups = PUBLISHED_GROUPS) {
  return groups.flatMap((grupo) => [
    { path: `/${grupo.dataRoot}/manifest.json`, cacheControl: 'no-store' },
    { path: `/${grupo.dataRoot}/refresh-state.json`, cacheControl: 'no-store' },
    { path: `/${grupo.dataRoot}/snapshots/*`, cacheControl: 'public, max-age=31536000, immutable' },
  ]);
}

/** La cabecera de caché de un archivo de datos, o `null` si no es de ningún grupo. */
export function dataCacheControl(relative, groups = PUBLISHED_GROUPS) {
  const ruta = `/${relative.replace(/^\/+/, '')}`;
  const regla = dataCacheRules(groups).find((item) => (item.path.endsWith('/*') ? ruta.startsWith(item.path.slice(0, -1)) : ruta === item.path));
  return regla?.cacheControl ?? null;
}
