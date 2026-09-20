/**
 * Preparar la entrega: UNA función que devuelve UN objeto.
 *
 * Antes esto estaba repartido entre `scripts/publish.mjs`, que lanzaba tres
 * procesos y rebuscaba una línea JSON en su stdout —y en su stderr, porque el
 * refresco comunicaba su rechazo por ahí—, y 55 líneas de shell en el workflow
 * que releían el archivo resultante para decidir si desplegar. Dos programas
 * para una sola decisión, y ninguno de los dos se podía probar en local.
 *
 * Aquí se llama en proceso a `refreshSnapshot`, `projectGasolina`,
 * `writeShellManifest` y `verifyWeb`, y se devuelve el resultado. `deps` permite
 * recorrer las cuatro rutas y todos los estados del refresco sin red y sin los
 * 1,2 GB del original.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicationDecisionForRoute } from '../app/publication-policy.mjs';
import { composeGasolinaProjection, usablePrivateSnapshot, writeGasolinaProjection } from './project-gasolina.mjs';
import { facilitoPublicationChange } from './facilito/publication.mjs';
import { readFacilitoState } from './facilito/state.mjs';
import { GASOLINA_KEYS } from './gasolina-contract.mjs';
import { refreshSnapshot } from './refresh-snapshot.mjs';
import { writeShellManifest } from './shell-manifest.mjs';
import { verifyWeb } from '../scripts/verify-web.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_PREPARE_DEPS = Object.freeze({ refreshSnapshot, composeGasolinaProjection, writeGasolinaProjection, verifyWeb, writeShellManifest, usablePrivateSnapshot, readFacilitoState, publicadosDesdeDisco });

const leerJson = (archivo) => { try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return null; } };

/**
 * Los datasets que hoy sirve producción, tal como quedaron en `web/data/`.
 *
 * En CI los acaba de bajar `fetch:live`, así que comparar contra ellos es
 * comparar contra lo que la gente está viendo, no contra una copia local.
 */
function publicadosDesdeDisco(root) {
  const base = path.join(root, 'web', 'data', 'gasolina');
  const manifest = leerJson(path.join(base, 'manifest.json'));
  if (!manifest?.products) return null;
  const datasets = {};
  for (const key of GASOLINA_KEYS) {
    const url = manifest.products[key]?.dataset_url;
    const dataset = url ? leerJson(path.join(root, 'web', url)) : null;
    if (!dataset) return null;
    datasets[key] = dataset;
  }
  return datasets;
}
const trimmed = (value) => String(value ?? '').trim();

/**
 * Solo la ruta de datos consulta siempre la fuente. Las de interfaz y
 * documentación nunca —ejecutar el refresco siempre era lo que ataba un cambio
 * de CSS a que Osinergmin respondiera—, y la de reproyección solo cuando no hay
 * un snapshot privado utilizable: cambiar el contrato o el catálogo no necesita
 * precios nuevos.
 */
function planDeRefresco({ root, route, deps }) {
  if (route === 'data') return { refresh: true };
  if (route !== 'project') return { refresh: false };
  const publicado = leerJson(path.join(root, 'web', 'data', 'gasolina', 'refresh-state.json'))?.snapshot_id ?? null;
  const privado = deps.usablePrivateSnapshot(root, { publishedSnapshotId: publicado });
  return privado.ok ? { refresh: false, reused: privado.snapshot_id } : { refresh: true, missing: privado.missing };
}

/**
 * @param {object} [entrada]
 * @param {string} [entrada.root]
 * @param {string} [entrada.route]        docs | shell | data | project
 * @param {string|null} [entrada.routeReason]
 * @param {boolean} [entrada.forceProject]
 * @param {string|null} [entrada.identityRoot]
 * @param {object} [entrada.refreshOptions]  el resto de opciones de `refreshSnapshot`
 * @param {object} [entrada.deps]         inyectables para probar sin red
 * @returns {Promise<{ok: boolean, route: string, route_reason: string|null, refresh: object, decision: object, execution: object, informe: object, identity: object|null}>}
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
  const manifestPath = path.join(root, 'web', 'data', 'gasolina', 'manifest.json');
  const revision = () => leerJson(manifestPath)?.revision_id ?? null;

  const plan = planDeRefresco({ root, route, deps: usar });
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

  const revisionAntes = revision();
  let decision;
  // Sin una sola unidad en el expediente no hay capa que componer, y `unchanged`
  // vuelve a significar lo de siempre: cero bytes y cero deploy.
  const facilitoAvailable = Object.keys(usar.readFacilitoState(root, { facilitoRoot })?.units ?? {}).length > 0;
  // Con el refresco caído, el pointer activo sigue siendo el último snapshot
  // oficial validado. Si además es utilizable, la consulta web puede publicarse
  // sobre él en vez de perderse junto al CSV.
  const officialSnapshotUsable = facilitoAvailable && ['unverifiable', 'needs_review', 'rejected'].includes(refresh.status)
    ? usar.usablePrivateSnapshot(root, { publishedSnapshotId: null }).ok
    : false;
  try { decision = publicationDecisionForRoute(route, plan.refresh ? refresh : null, { forceProject, reusedSnapshot: plan.reused ?? null, facilitoAvailable, officialSnapshotUsable }); }
  catch (error) { decision = { action: 'fail_closed', project: false, verify: false, deploy: false, reason: `resultado de refresco no interpretable: ${error.message}` }; }

  const execution = { stage: plan.refresh ? 'refresh' : 'route', ok: decision.action !== 'fail_closed', error: null };
  let identity = refresh.identity ?? null;

  let facilitoChange = null;
  if (execution.ok && decision.project) {
    execution.stage = 'project';
    try {
      const candidate = await usar.composeGasolinaProjection({ root, identityRoot, facilitoRoot });
      // Con el CSV sin cambios, la entrega solo se justifica si la consulta web
      // mueve algo que alguien pueda ver. Si no, la anterior sigue siendo
      // correcta y se queda: publicar la misma lista con otra hora costaría una
      // descarga completa a cada cliente para no decirle nada nuevo.
      if (['facilito_project_verify_deploy', 'facilito_over_last_valid_snapshot'].includes(decision.action)) {
        facilitoChange = facilitoPublicationChange({ candidate: candidate.datasets, published: usar.publicadosDesdeDisco(root), now: Date.now() });
      }
      if (facilitoChange && !facilitoChange.visible) {
        decision = { ...decision, project: false, verify: false, deploy: false, action: 'no_op', reason: `consulta web sin efecto publicable: ${facilitoChange.reason}` };
      } else {
        identity = usar.writeGasolinaProjection(candidate, { root, identityRoot, facilitoRoot }).identity ?? identity;
      }
    } catch (error) { execution.ok = false; execution.error = trimmed(error.message) || 'la proyección falló sin mensaje'; }
  }
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
  const revisionDespues = revision();
  const informe = {
    route,
    route_reason: routeReason,
    // Reutilizada o generada: un `no-op` esperado y una entrega que no se
    // publicó se distinguen sin leer los logs de arriba.
    revision_reused: applied.deploy && !decision.project ? revisionDespues : null,
    revision_generated: decision.project && revisionDespues !== revisionAntes ? revisionDespues : null,
    revision_id: revisionDespues,
    private_snapshot_reused: plan.reused ?? null,
    refresh_reason: refresh.refresh_reason ?? null,
    facilito_change: facilitoChange?.reason ?? null,
    deploy: applied.deploy,
  };
  return { ok: execution.ok, route, route_reason: routeReason, refresh, decision: applied, execution, informe, identity };
}
