/**
 * Ruta de publicación de un push, un cron o una ejecución manual.
 *
 * La ruta se decide por EFECTO, no por directorio. Antes bastaba con que un
 * push tocara `scripts/` para que dejara de contar como cambio de interfaz, así
 * que instalar un SVG —el archivo y su instalador— se clasificaba como cambio
 * de precios y había que rescatarlo a mano con un flag. Aquí un script que solo
 * usa el operador no arrastra la proyección.
 */

// Scripts que NUNCA se ejecutan dentro de refresh, project o publish: son
// herramientas de operador y su cambio no altera el bundle publicado.
// Norma: si un script llega a ejecutarse durante refresh/project/publish, no va
// en esta lista.
const OPERATOR_ONLY = Object.freeze([
  'audit-sheet.mjs',
  'brand-directory.mjs',
  'brand-sample.mjs',
  'build-catalog.mjs',
  'dump-establishments.mjs',
  'harvest-centers.mjs',
  'identity-pack.mjs',
  'install-brand-logo.mjs',
  'match-identities.mjs',
  'rollback.mjs',
  'serve-web.mjs',
]);

const DOCS_FILES = Object.freeze(['LICENSE', 'NOTICE', 'mockup.html']);

export const ROUTES = Object.freeze(['docs', 'shell', 'data', 'project']);

// Qué necesita cada ruta. `deploy` es la intención; en las rutas de datos la
// decisión final la sigue tomando el resultado del refresco.
const PLAN = Object.freeze({
  docs: { fetchLive: false, needsSeed: false, needsIdentity: false, needsRefresh: false, forceProject: false, verify: false, deploy: false },
  shell: { fetchLive: true, needsSeed: false, needsIdentity: false, needsRefresh: false, forceProject: false, verify: true, deploy: true },
  data: { fetchLive: true, needsSeed: true, needsIdentity: true, needsRefresh: true, forceProject: false, verify: true, deploy: true },
  project: { fetchLive: true, needsSeed: true, needsIdentity: true, needsRefresh: true, forceProject: true, verify: true, deploy: true },
});

const segments = (value) => String(value ?? '').split('/').filter(Boolean);

/** docs | shell | operator | projection — un cambio, un efecto. */
export function classifyPath(rawPath) {
  const parts = segments(rawPath);
  if (!parts.length) return 'docs';
  const [head, ...rest] = parts;
  // La proyección pública se genera; nunca llega por un push (está en .gitignore).
  if (head === 'web' && rest[0] === 'data') return 'docs';
  if (head === 'web') return 'shell';
  if (head === 'docs') return 'docs';
  if (head === 'scripts' && rest.length === 1 && OPERATOR_ONLY.includes(rest[0])) return 'operator';
  if (parts.length === 1 && (DOCS_FILES.includes(head) || head.endsWith('.md'))) return 'docs';
  return 'projection';
}

function routeFromPaths(changedPaths) {
  const efectos = new Set(changedPaths.map(classifyPath));
  if (efectos.has('projection')) {
    return efectos.has('shell')
      ? { route: 'project', reason: 'cambio mixto de interfaz y proyección; se reproyecta y se sube el shell nuevo' }
      : { route: 'project', reason: 'cambia código o entradas de proyección' };
  }
  if (efectos.has('shell')) return { route: 'shell', reason: 'solo interfaz y assets; se reutiliza el bundle publicado' };
  if (efectos.has('operator')) return { route: 'docs', reason: 'solo documentación y herramientas de operador; nada que publicar' };
  return { route: 'docs', reason: 'solo documentación; nada que publicar' };
}

/**
 * @param {object} entrada
 * @param {string} entrada.eventName          push | schedule | workflow_dispatch | …
 * @param {string[]} entrada.changedPaths     rutas del RANGO COMPLETO del push
 * @param {{deployShell?: boolean, forceProject?: boolean}} entrada.inputs
 * @param {boolean} entrada.previousCommitValid  si el rango previo era resoluble
 */
export function resolveRoute({ eventName, changedPaths = [], inputs = {}, previousCommitValid = true } = {}) {
  const decidida = (() => {
    if (eventName === 'schedule') return { route: 'data', reason: 'refresco programado de la fuente' };
    if (eventName === 'workflow_dispatch') {
      if (inputs.forceProject && inputs.deployShell) return { route: 'project', reason: 'se pidieron reproyección y shell; la reproyección los cubre a los dos' };
      if (inputs.forceProject) return { route: 'project', reason: 'reproyección pedida a mano' };
      if (inputs.deployShell) return { route: 'shell', reason: 'publicación de shell pedida a mano' };
      return { route: 'data', reason: 'ejecución manual sin opciones; se refresca la fuente' };
    }
    if (eventName === 'push') {
      // Sin rango previo resoluble —primer push, force-push, historial recortado—
      // no se compara a medias: se reproyecta todo, que es el superconjunto seguro.
      if (!previousCommitValid) return { route: 'project', reason: 'sin rango previo válido; se reproyecta todo por precaución' };
      return routeFromPaths(changedPaths);
    }
    return { route: 'docs', reason: `evento sin ruta de publicación: ${eventName ?? 'desconocido'}` };
  })();
  return Object.freeze({ ...decidida, ...PLAN[decidida.route] });
}

/**
 * ¿Publicaría esta corrida código anterior a la punta de main?
 *
 * Todas las rutas suben `web/` entero, así que aplica a todas, no solo a la de
 * interfaz. Un adelanto que solo toca documentación no cambia lo publicado y no
 * aborta: hacerlo dejaría sin publicar un refresco de datos válido porque
 * alguien corrigió el README mientras corría.
 */
export function codeRegression({ head, tip, isAncestor, changedPaths = [] }) {
  if (!tip || tip === head) return null;
  const corto = (sha) => String(sha).slice(0, 7);
  if (!isAncestor) return { reason: `codigo_desactualizado: ${corto(head)} no es ancestro de main (${corto(tip)})` };
  const ruta = resolveRoute({ eventName: 'push', changedPaths });
  if (ruta.route === 'docs') return null;
  return { reason: `codigo_desactualizado: main avanzó a ${corto(tip)} con cambios de ${ruta.route}; esta corrida trae ${corto(head)}` };
}
