// Grupos publicados: cada vista activa del catálogo con su contrato de Node y su
// configuración de operación.
//
// Es la lista que recorren la descarga del bundle vivo, el verificador, el
// preflight, el refresco y la proyección, para que ninguno publique ni compare un
// grupo y se olvide de otro. Es de operación: no viaja a `web/`.

import { ACTIVE_VIEWS, GROUPS } from '../web/lib/catalog.js';
import { GROUP_RULES } from '../web/lib/bundle-contract.js';
import { nodeContract } from './gasolina-contract.mjs';

// Actividades del CSV que cuentan como venta al público, con su código en el
// Registro. Son las que filtra la semilla (`bootstrap/seed.manifest.json`): una
// actividad fuera de ella no tiene con qué cruzarse.
const ESTACIONES = Object.freeze({ 'ESTACIÓN DE SERVICIOS / GRIFOS': '01', 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP': '02', 'EE.SS con GNV': '05', 'EE.SS con GLP y GNV': '06' });

/**
 * Lo que cada grupo necesita para proyectarse, compararse y recuperarse.
 *
 * - `idScheme`: prefijo y espacio de nombres de los IDs de oferta. Cambiarlos
 *   cambia todos los IDs publicados.
 * - `revisionPrefix`: con qué empieza la revisión de sus bundles.
 * - `guardrails`: caída máxima de ofertas frescas y de cobertura entre dos
 *   versiones, y la base auditada contra la que se juzga la primera activación.
 */
export const GROUP_CONFIG = Object.freeze({
  gasolina: Object.freeze({
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
