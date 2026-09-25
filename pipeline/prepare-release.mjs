/**
 * Preparar la entrega: UNA función que devuelve UN objeto.
 *
 * Antes esto estaba repartido entre `scripts/publish.mjs`, que lanzaba tres
 * procesos y rebuscaba una línea JSON en su stdout —y en su stderr, porque el
 * refresco comunicaba su rechazo por ahí—, y 55 líneas de shell en el workflow
 * que releían el archivo resultante para decidir si desplegar. Dos programas
 * para una sola decisión, y ninguno de los dos se podía probar en local.
 *
 * Aquí se llama en proceso a `refreshSnapshot`, `composeGroups`,
 * `writeShellManifest` y `verifyWeb`, y se devuelve el resultado. `deps` permite
 * recorrer las cuatro rutas y todos los estados del refresco sin red y sin los
 * 1,2 GB del original.
 *
 * Cada grupo decide por su cuenta con su propio estado publicado: un fallo de
 * Diésel conserva su última versión y deja publicar Gasolina, y al revés. La
 * única excepción es la primera activación: un grupo que el código activa y
 * cuya primera versión no pasa detiene la entrega, porque publicar la vista sin
 * datos sería peor que no publicar nada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptSnapshot } from '../app/snapshot-refresh.mjs';
import { combineGroupDecisions, publicationDecisionForRoute } from '../app/publication-policy.mjs';
import { composeGroups, firstActivationBase, usablePrivateSnapshot, writeGroupProjection } from './project-gasolina.mjs';
import { facilitoPublicationChange } from './facilito/publication.mjs';
import { facilitoStateForProducts, readFacilitoState } from './facilito/state.mjs';
import { PUBLISHED_GROUPS } from './groups.mjs';
import { refreshSnapshot } from './refresh-snapshot.mjs';
import { compareGroupQuality } from './refresh-state.mjs';
import { writeShellManifest } from './shell-manifest.mjs';
import { verifyWeb } from '../scripts/verify-web.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const leerJson = (archivo) => { try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return null; } };
const raizDeDatos = (root, grupo) => path.join(root, 'web', ...grupo.dataRoot.split('/'));

/**
 * Los datasets que hoy sirve producción para un grupo, tal como quedaron en
 * `web/`.
 *
 * En CI los acaba de bajar `fetch:live`, así que comparar contra ellos es
 * comparar contra lo que la gente está viendo, no contra una copia local.
 */
function publicadosDesdeDisco(root, grupo = PUBLISHED_GROUPS[0]) {
  const manifest = leerJson(path.join(raizDeDatos(root, grupo), 'manifest.json'));
  if (!manifest?.products) return null;
  const datasets = {};
  for (const key of grupo.products) {
    const url = manifest.products[key]?.dataset_url;
    const dataset = url ? leerJson(path.join(root, 'web', url)) : null;
    if (!dataset) return null;
    datasets[key] = dataset;
  }
  return datasets;
}

/** El estado publicado de un grupo, o `null` si nunca se publicó. */
const estadoPublicado = (root, grupo) => leerJson(path.join(raizDeDatos(root, grupo), 'refresh-state.json'));

/**
 * Qué snapshot sirve producción para un grupo, leído antes de escribir nada. La
 * poda lo protege: tras promover, los pointers ya apuntan al snapshot nuevo, y
 * el de producción sigue haciendo falta si el deploy falla. Sin archivo, el
 * grupo nunca se publicó; un estado ilegible o sin snapshot no se adivina.
 */
function produccionPublicada(root, grupo, estado) {
  if (!estado) return fs.existsSync(path.join(raizDeDatos(root, grupo), 'refresh-state.json')) ? { error: 'estado publicado ilegible' } : null;
  if (typeof estado.snapshot_id !== 'string' || !estado.snapshot_id) return { error: 'el estado publicado no declara snapshot_id' };
  return { snapshot_id: estado.snapshot_id, revision_id: estado.revision_id ?? null, facilito: Boolean(estado.facilito?.state_id) };
}

export const DEFAULT_PREPARE_DEPS = Object.freeze({ refreshSnapshot, composeGroups, writeGroupProjection, verifyWeb, writeShellManifest, usablePrivateSnapshot, firstActivationBase, readFacilitoState, publicadosDesdeDisco, estadoPublicado, adoptSnapshot, groups: PUBLISHED_GROUPS });

const trimmed = (value) => String(value ?? '').trim();
const fallo = (reason) => ({ action: 'fail_closed', project: false, verify: false, deploy: false, reason });

/**
 * Solo la ruta de datos consulta siempre la fuente. Las de interfaz y
 * documentación nunca —ejecutar el refresco siempre era lo que ataba un cambio
 * de CSS a que Osinergmin respondiera—, y la de reproyección solo cuando
 * Gasolina no tiene un snapshot privado utilizable: cambiar el contrato o el
 * catálogo no necesita precios nuevos.
 */
function planDeRefresco({ root, route, deps, publicado }) {
  if (route === 'data') return { refresh: true };
  if (route !== 'project') return { refresh: false };
  const privado = deps.usablePrivateSnapshot(root, { publishedSnapshotId: publicado?.snapshot_id ?? null, group: 'gasolina' });
  return privado.ok ? { refresh: false, reused: privado.snapshot_id } : { refresh: true, missing: privado.missing };
}

/**
 * El resultado del refresco de la fuente del grupo. Un refresco sin `sources`
 * —el de antes, o uno que falló entero— vale para todas.
 */
const refrescoDeLaFuente = (refresh, grupo) => refresh?.sources?.[grupo.config?.source] ?? refresh;

/**
 * El resultado del refresco visto desde un grupo. `unchanged`, `unverifiable` y
 * `rejected` valen para todos los de su fuente; `promoted` y `needs_review` son
 * de cada uno.
 */
function refrescoDelGrupo(refresh, grupo) {
  const fuente = refrescoDeLaFuente(refresh, grupo);
  const propio = fuente?.groups?.[grupo.key];
  if (!propio) return fuente;
  return { ...fuente, status: propio.status, promoted: propio.status === 'promoted' };
}

/** Lo que el informe dice de cada fuente: estado y conteos, nada del original. */
const resumenFuente = (fuente) => ({
  status: fuente.status,
  promoted: fuente.promoted === true,
  snapshot_id: fuente.active_after?.snapshot_id ?? (fuente.snapshot_path ? path.basename(fuente.snapshot_path) : null) ?? fuente.active_snapshot ?? null,
  groups: Object.fromEntries(Object.entries(fuente.groups ?? {}).map(([key, value]) => [key, { status: value.status, private: value.private === true, reasons: value.reasons ?? [], products: value.products ?? null }])),
  error: fuente.error ?? null,
});

/**
 * @param {object} [entrada]
 * @param {string} [entrada.root]
 * @param {string} [entrada.route]        docs | shell | data | project
 * @param {string|null} [entrada.routeReason]
 * @param {boolean} [entrada.forceProject]
 * @param {string|null} [entrada.identityRoot]
 * @param {object} [entrada.refreshOptions]  el resto de opciones de `refreshSnapshot`
 * @param {object} [entrada.deps]         inyectables para probar sin red
 * @returns {Promise<{ok: boolean, route: string, route_reason: string|null, refresh: object, decision: object, execution: object, informe: object, identity: object|null, production: object}>}
 *   `production`: el snapshot que sirve producción por grupo al empezar, para la poda
 */
export async function prepareRelease({
  root = rootFromModule,
  // Sin ruta declarada se asume la de datos, que es la que más comprueba.
  route = 'data',
  routeReason = null,
  forceProject = false,
  identityRoot = null,
  facilitoRoot = undefined,
  refreshOptions = {},
  deps = {},
} = {}) {
  const usar = { ...DEFAULT_PREPARE_DEPS, ...deps };
  const grupos = usar.groups;
  const revision = (grupo) => leerJson(path.join(raizDeDatos(root, grupo), 'manifest.json'))?.revision_id ?? null;
  const publicados = Object.fromEntries(grupos.map((grupo) => [grupo.key, usar.estadoPublicado(root, grupo)]));
  const production = Object.fromEntries(grupos.map((grupo) => [grupo.key, produccionPublicada(root, grupo, publicados[grupo.key])]));

  const plan = planDeRefresco({ root, route, deps: usar, publicado: publicados.gasolina });
  let refresh;
  if (plan.refresh) {
    // El refresco ya no comunica su rechazo por stderr: si lanza, se traduce
    // aquí y la causa original se conserva tal cual.
    try {
      refresh = await usar.refreshSnapshot({ root, forceRefresh: forceProject, identityRoot, ...refreshOptions });
    } catch (error) {
      refresh = { status: 'rejected', error: error.message };
    }
  } else {
    refresh = { status: 'skipped', reason: plan.reused ? `ruta project: reproyección desde el snapshot privado ${plan.reused}; la fuente no se consultó` : `ruta ${route}: no se consulta la fuente` };
  }
  if (plan.missing) refresh.refresh_reason = `no había snapshot privado utilizable: ${plan.missing.join('; ')}`;

  const expediente = usar.readFacilitoState(root, { facilitoRoot });
  const porGrupo = {};
  for (const grupo of grupos) {
    const antes = revision(grupo);
    const publicado = publicados[grupo.key];
    // Sin una sola unidad del grupo en el expediente no hay capa que componer,
    // y `unchanged` vuelve a significar lo de siempre: cero bytes y cero
    // deploy. Una captura de otro combustible no es una capa de este.
    const facilitoAvailable = Object.keys(facilitoStateForProducts(expediente, grupo.products)?.units ?? {}).length > 0;
    const refreshGrupo = plan.refresh ? refrescoDelGrupo(refresh, grupo) : null;
    const primeraActivacion = !publicado && Boolean(grupo.config?.guardrails?.firstActivation) && !['docs', 'shell'].includes(route);
    const propio = usar.usablePrivateSnapshot(root, { publishedSnapshotId: publicado?.snapshot_id ?? null, group: grupo.key });
    const reusado = route === 'project' && !plan.refresh ? (grupo.key === 'gasolina' ? plan.reused ?? null : (propio.ok ? propio.snapshot_id : null)) : null;
    // Con el refresco caído, el pointer del grupo sigue siendo su último
    // snapshot oficial validado. Si además es utilizable, la consulta web puede
    // publicarse sobre él en vez de perderse junto al CSV.
    const officialSnapshotUsable = facilitoAvailable && ['unverifiable', 'needs_review', 'rejected'].includes(refreshGrupo?.status)
      ? usar.usablePrivateSnapshot(root, { publishedSnapshotId: null, group: grupo.key }).ok
      : false;
    let decision;
    if (primeraActivacion) {
      // El refresco de esta corrida ya juzgó al grupo contra su base auditada:
      // si lo rechazó, no hay primera versión que publicar.
      const juzgado = plan.refresh ? refrescoDeLaFuente(refresh, grupo)?.groups?.[grupo.key] : null;
      decision = juzgado?.status === 'needs_review'
        ? fallo(`primera activación de ${grupo.key} rechazada por el refresco: ${juzgado.reasons?.join('; ') || 'sin motivo'}`)
        : { action: 'first_activation', project: true, verify: true, deploy: true, reason: `primera activación de ${grupo.key}` };
    } else {
      try { decision = publicationDecisionForRoute(route, refreshGrupo, { forceProject, reusedSnapshot: reusado, facilitoAvailable, officialSnapshotUsable }); }
      catch (error) { decision = fallo(`resultado de refresco no interpretable: ${error.message}`); }
    }
    porGrupo[grupo.key] = { grupo, antes, decision, primeraActivacion, propio, facilitoChange: null, outcome: null, error: null, base: null };
  }

  const execution = { stage: plan.refresh ? 'refresh' : 'route', ok: true, error: null };
  let identity = refresh.identity ?? null;

  // Las bases de cada grupo que se compone. Un grupo usa su propio pointer; en
  // su primera activación, sin pointer propio, el último snapshot aprobado de
  // su fuente —en los líquidos, el de Gasolina, que es el oficial vigente—. Los
  // grupos sobre el mismo snapshot se componen juntos: UNA pasada por el
  // original por snapshot.
  const aComponer = Object.values(porGrupo).filter((item) => item.decision.project && item.decision.action !== 'fail_closed');
  if (aComponer.length) {
    execution.stage = 'project';
    const planComposicion = new Map();
    for (const item of aComponer) {
      const base = item.propio.ok ? item.propio : (item.primeraActivacion ? usar.firstActivationBase(root, item.grupo.key, { usable: usar.usablePrivateSnapshot }) : item.propio);
      if (!base.ok || !base.pointer) { item.outcome = 'failed'; item.error = `sin snapshot privado utilizable: ${(base.missing ?? []).join('; ') || 'pointer ausente'}`; continue; }
      item.base = base;
      const entrada = planComposicion.get(base.snapshot_id) ?? { pointer: base.pointer, groups: [] };
      entrada.groups.push(item.grupo.key);
      planComposicion.set(base.snapshot_id, entrada);
    }
    let candidatas = {};
    try { candidatas = planComposicion.size ? await usar.composeGroups({ root, plan: [...planComposicion.values()], identityRoot, facilitoRoot, isolate: true }) : {}; }
    catch (error) { for (const item of aComponer) if (!item.outcome) { item.outcome = 'failed'; item.error = trimmed(error.message) || 'la proyección falló sin mensaje'; } }
    for (const item of aComponer) {
      if (item.outcome) continue;
      const candidata = candidatas[item.grupo.key];
      if (!candidata || candidata.error) { item.outcome = 'failed'; item.error = trimmed(candidata?.error) || 'la proyección falló sin mensaje'; continue; }
      try {
        // Sin refresco que la haya juzgado, la primera versión se juzga aquí contra
        // la base auditada; solo si pasa, el grupo adopta ese snapshot como suyo.
        if (item.primeraActivacion && !item.propio.ok) {
          const calidad = compareGroupQuality({ group: item.grupo.key, candidateProducts: candidata.refreshState.products, candidateSourceMaxReportedAt: candidata.refreshState.source_max_reported_at });
          if (calidad.status !== 'ready') { item.outcome = 'first_activation_failed'; item.error = calidad.reasons.join('; '); continue; }
          usar.adoptSnapshot(root, item.base.snapshot_id, { group: item.grupo.key, sourceId: item.grupo.config.source });
        }
        // Con el CSV sin cambios, la entrega solo se justifica si la consulta web
        // mueve algo que alguien pueda ver. Si no, la anterior sigue siendo
        // correcta y se queda: publicar la misma lista con otra hora costaría una
        // descarga completa a cada cliente para no decirle nada nuevo.
        if (['facilito_project_verify_deploy', 'facilito_over_last_valid_snapshot'].includes(item.decision.action)) {
          item.facilitoChange = facilitoPublicationChange({ candidate: candidata.datasets, published: usar.publicadosDesdeDisco(root, item.grupo), now: Date.now() });
        }
        if (item.facilitoChange && !item.facilitoChange.visible) {
          item.decision = { ...item.decision, project: false, verify: false, deploy: false, action: 'no_op', reason: `consulta web sin efecto publicable: ${item.facilitoChange.reason}` };
          item.outcome = 'unchanged';
        } else {
          identity = usar.writeGroupProjection(candidata, { root, group: item.grupo, identityRoot, facilitoRoot }).identity ?? identity;
          item.outcome = 'written';
        }
      } catch (error) { item.outcome = 'failed'; item.error = trimmed(error.message) || 'la proyección falló sin mensaje'; }
    }
    // Una primera activación que no llega a escribirse, por la causa que sea,
    // también detiene la entrega.
    for (const item of aComponer) if (item.primeraActivacion && item.outcome === 'failed') item.outcome = 'first_activation_failed';
  }
  for (const item of Object.values(porGrupo)) {
    if (item.outcome) continue;
    if (item.decision.action === 'fail_closed') item.outcome = item.primeraActivacion ? 'first_activation_failed' : 'failed';
    else item.outcome = item.decision.deploy ? 'reused' : 'unchanged';
  }

  let decision = combineGroupDecisions(route, Object.values(porGrupo).map((item) => ({ group: item.grupo.key, decision: item.decision, outcome: item.outcome, error: item.error })));
  if (decision.action === 'fail_closed') { execution.ok = false; execution.error = decision.reason; }
  // La precache se deriva antes de verificar, en TODA ruta que publica: el
  // shell que se sube y el módulo que lo describe salen de la misma corrida.
  if (execution.ok && decision.verify) {
    execution.stage = 'shell';
    try { usar.writeShellManifest({ root }); }
    catch (error) { execution.ok = false; execution.error = trimmed(error.message) || 'la precache derivada falló sin mensaje'; }
  }
  if (execution.ok && decision.verify) {
    execution.stage = 'verify';
    try {
      const verificacion = await usar.verifyWeb({ root });
      if (verificacion.errors.length) { execution.ok = false; execution.error = verificacion.errors.join('; '); }
    } catch (error) { execution.ok = false; execution.error = trimmed(error.message) || 'la verificación falló sin mensaje'; }
  }

  // El log tiene que decir lo mismo que el archivo: informar la decisión
  // original mientras se escribe la degradada hacía creer que se iba a desplegar
  // algo que ya estaba descartado.
  const applied = execution.ok ? decision : { ...decision, deploy: false, action: 'fail_closed', reason: decision.action === 'fail_closed' ? decision.reason : `${execution.stage} falló tras un refresco ${refresh.status}` };
  const informeGrupo = (item) => {
    const despues = revision(item.grupo);
    return {
      action: item.decision.action,
      outcome: item.outcome,
      first_activation: item.primeraActivacion,
      base_snapshot: item.base?.snapshot_id ?? (item.propio.ok ? item.propio.snapshot_id : null),
      revision_before: item.antes,
      revision_id: despues,
      revision_generated: item.outcome === 'written' && despues !== item.antes ? despues : null,
      facilito_change: item.facilitoChange?.reason ?? null,
      error: item.error,
    };
  };
  const grupoInforme = Object.fromEntries(Object.values(porGrupo).map((item) => [item.grupo.key, informeGrupo(item)]));
  const gasolina = grupoInforme.gasolina ?? Object.values(grupoInforme)[0];
  const informe = {
    route,
    route_reason: routeReason,
    // Reutilizada o generada: un `no-op` esperado y una entrega que no se
    // publicó se distinguen sin leer los logs de arriba. Los campos de siempre
    // hablan de Gasolina; `groups` los tiene de cada grupo.
    revision_reused: applied.deploy && gasolina.outcome !== 'written' ? gasolina.revision_id : null,
    revision_generated: gasolina.revision_generated,
    revision_id: gasolina.revision_id,
    private_snapshot_reused: plan.reused ?? null,
    refresh_reason: refresh.refresh_reason ?? null,
    facilito_change: gasolina.facilito_change,
    deploy: applied.deploy,
    groups: grupoInforme,
    // Cada fuente que se consultó, con los grupos que juzgó: también los que
    // todavía no publican, como GLP. Nunca cambia la decisión de publicar.
    sources: Object.fromEntries(Object.entries(refresh.sources ?? {}).map(([id, fuente]) => [id, resumenFuente(fuente)])),
  };
  return { ok: execution.ok, route, route_reason: routeReason, refresh, decision: applied, execution, informe, identity, production };
}
