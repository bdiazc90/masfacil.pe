/**
 * Rollback de un grupo: reconstruir su versión sobre un snapshot nombrado y
 * mover solo SU pointer.
 *
 * Recuperar un grupo no toca los demás: el de Diésel no mueve `active.json` ni
 * escribe en `web/data/gasolina`, y el de Gasolina restaura siempre el par
 * Regular/Premium con los mismos bytes de siempre. Solo cambia archivos locales;
 * publicarlos es otra decisión.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointerRelative, writeActivePointer } from '../app/snapshot-manifest.mjs';
import { rollbackSnapshot } from '../app/snapshot-refresh.mjs';
import { readFacilitoRevision } from './facilito/state.mjs';
import { groupByKey } from './groups.mjs';
import { composeGroups, writeGroupProjection } from './project-gasolina.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {object} entrada
 * @param {string} entrada.snapshotId   snapshot completo en `.local-cache/snapshots/`
 * @param {string|null} [entrada.revisionId]  revisión cuya consulta web se restaura
 * @param {string} [entrada.group]      por defecto Gasolina, como siempre
 */
export async function rollbackGroup({ root = rootFromModule, group = 'gasolina', snapshotId, revisionId = null }) {
  const grupo = groupByKey(group);
  if (!grupo) throw new Error(`Grupo no publicado: ${group}`);
  if (!snapshotId) throw new Error('Falta el snapshot al que volver');
  // La revisión nombrada tiene que ser del mismo grupo: restaurar la consulta de
  // Gasolina sobre Diésel sería componer una revisión que nunca existió.
  if (revisionId && !revisionId.startsWith(grupo.config.revisionPrefix)) throw new Error(`La revisión ${revisionId} no es de ${group}`);

  // La consulta web NO se hereda. Recuperar una entrega de ayer y pintarle los
  // precios de hoy sería componer una revisión que nunca existió, así que por
  // defecto se vuelve a CSV puro —que es como funcionaba todo antes de la capa— y
  // solo nombrando una revisión se restaura la captura exacta con la que se
  // compuso. Nunca se consulta la web durante un rollback.
  const guardado = revisionId ? readFacilitoRevision(root, revisionId) : null;
  if (revisionId && !guardado) throw new Error(`No hay expediente de consulta guardado para la revisión ${revisionId}`);
  // Se reconstruye con el reloj de aquella composición, no con el de hoy: así
  // salen los mismos bytes aunque la captura lleve días vencida. El vencimiento
  // sigue decidiendo qué precio muestra el cliente, con SU reloj.
  const { composed_at: compuestoEn = null, ...facilitoState } = guardado ?? {};

  const activePath = path.join(root, pointerRelative(group));
  if (!fs.existsSync(activePath)) throw new Error('No existe pointer activo para rollback');
  const activeBefore = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  const manifestPath = path.join(root, '.local-cache', 'snapshots', snapshotId, 'snapshot-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Solo se revierten snapshots completos: ${snapshotId}`);
  const target = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Todo el grupo se reconstruye y valida antes de mover el pointer privado.
  const projection = (await composeGroups({ root, plan: [{ pointer: target, groups: [group] }], facilitoState: guardado ? facilitoState : null, ...(compuestoEn ? { now: Date.parse(compuestoEn) } : {}) }))[group];
  let rolledBack;
  try {
    rolledBack = rollbackSnapshot(root, snapshotId, fs, () => {}, { group });
    writeGroupProjection(projection, { root, group: grupo });
  } catch (error) {
    if (rolledBack) writeActivePointer(root, activeBefore, fs, { group });
    throw new Error(`Rollback ${group} abortado sin dejar pointer parcial: ${error.message}`);
  }
  return { status: 'rolled_back', group, active_before: activeBefore.snapshot_id, active_after: rolledBack.snapshot_id, revision_id: projection.manifest.revision_id, facilito: projection.refreshState.facilito?.state_id ?? null, products: Object.fromEntries(Object.entries(projection.datasets).map(([key, value]) => [key, value.offers.length])) };
}
