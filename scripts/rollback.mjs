#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollbackSnapshot } from '../app/snapshot-refresh.mjs';
import { writeActivePointer } from '../app/snapshot-manifest.mjs';
import { buildGasolinaProjectionForPointer, writeGasolinaProjection } from '../pipeline/project-gasolina.mjs';
import { readFacilitoRevision } from '../pipeline/facilito/state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotId = process.argv[2];
const revisionId = process.argv[3] ?? null;
if (!snapshotId) throw new Error('Uso: npm run rollback -- <snapshot-id> [<revision-id>]');

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
const relojDeLaRevision = compuestoEn ? Date.parse(compuestoEn) : undefined;

const activePath = path.join(root, '.local-cache', 'snapshots', 'active.json');
if (!fs.existsSync(activePath)) throw new Error('No existe pointer activo para rollback');
const activeBefore = JSON.parse(fs.readFileSync(activePath, 'utf8'));
const manifestPath = path.join(root, '.local-cache', 'snapshots', snapshotId, 'snapshot-manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Solo se revierten snapshots completos: ${snapshotId}`);
const target = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Ambos productos se reconstruyen y validan antes de mover el pointer privado.
const projection = await buildGasolinaProjectionForPointer({ root, pointer: target, facilitoState: guardado ? facilitoState : null, now: relojDeLaRevision });
let rolledBack;
try {
  rolledBack = rollbackSnapshot(root, snapshotId);
  writeGasolinaProjection(projection, { root });
} catch (error) {
  if (rolledBack) writeActivePointer(root, activeBefore);
  throw new Error(`Rollback gasolina abortado sin dejar pointer parcial: ${error.message}`);
}

process.stdout.write(`${JSON.stringify({ status: 'rolled_back', active_before: activeBefore.snapshot_id, active_after: rolledBack.snapshot_id, revision_id: projection.manifest.revision_id, facilito: projection.refreshState.facilito?.state_id ?? null, products: Object.fromEntries(Object.entries(projection.datasets).map(([key, value]) => [key, value.offers.length])) })}\n`);
