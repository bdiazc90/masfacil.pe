import fs from 'node:fs';
import path from 'node:path';
import { ACTIVE_POINTER_RELATIVE, readActivePointer, validateSnapshotPointer, writeActivePointer } from './snapshot-manifest.mjs';

export function validateDownloadMetadata({ status, headers, bytes, contentRange }) {
  const errors = [];
  const contentLength = Number(headers?.['content-length']);
  if (![200, 206].includes(status)) errors.push(`estado HTTP inesperado: ${status}`);
  if (Number.isFinite(contentLength) && contentLength !== bytes) errors.push(`Content-Length ${contentLength} no coincide con ${bytes} bytes`);
  if (!Number.isFinite(contentLength) && !contentRange) errors.push('faltan Content-Length y Content-Range para verificar integridad');
  if (status === 206 || contentRange) {
    const match = String(contentRange ?? '').match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
    if (!match) errors.push('Content-Range inválido o ausente en respuesta parcial');
    else {
      const [, start, end, total] = match.map(Number);
      if (start !== 0 || end + 1 !== total || total !== bytes) errors.push(`Content-Range no cubre el archivo completo: ${contentRange}`);
    }
  }
  return errors;
}

/**
 * El pointer del snapshot. `temporalContext` lleva los dos únicos campos que el
 * bundle público consumía del dataset privado —`cutoff_at` y
 * `source_max_reported_at`— más la fecha del snapshot. Con ellos ahí, un
 * snapshot nuevo no necesita escribir `dataset/` ni `evidence/`.
 */
export function makeSnapshotPointer({ root, snapshotId, snapshotDate, datasetPath = null, evidencePath = null, acquisitionPath = null, overlayPath = null, sourceUrl, validators, promotedAt, temporalContext = null, referenceInputs, lineage }) {
  return {
    schema_version: 1,
    source_id: 'liquid-current',
    snapshot_id: snapshotId,
    snapshot_date: snapshotDate,
    temporal_context: temporalContext
      ? { cutoff_at: temporalContext.cutoff_at, source_max_reported_at: temporalContext.source_max_reported_at, snapshot_date: temporalContext.snapshot_date ?? snapshotDate }
      : null,
    dataset_path: datasetPath ? path.relative(root, datasetPath) : null,
    evidence_path: evidencePath ? path.relative(root, evidencePath) : null,
    acquisition_path: acquisitionPath ? path.relative(root, acquisitionPath) : null,
    overlay_path: overlayPath ? path.relative(root, overlayPath) : null,
    source_url: sourceUrl,
    validators,
    promoted_at: promotedAt,
    reference_inputs: referenceInputs,
    lineage: lineage ?? null,
  };
}

export function promoteSnapshot({ root, stagePath, finalPath, pointer, beforePointerUpdate = () => {}, fsModule = fs }) {
  if (fsModule.existsSync(finalPath)) throw new Error(`El snapshot destino ya existe: ${finalPath}`);
  fsModule.mkdirSync(path.dirname(finalPath), { recursive: true, mode: 0o700 });
  fsModule.renameSync(stagePath, finalPath);
  try {
    beforePointerUpdate();
    writeActivePointer(root, pointer, fsModule);
  } catch (error) {
    throw new Error(`Snapshot validado movido pero pointer no actualizado: ${error.message}; snapshot_id=${pointer.snapshot_id}; recuperación: npm run rollback -- ${pointer.snapshot_id}`);
  }
  return pointer;
}

/**
 * Rollback = mover el pointer, nunca reescribir un snapshot.
 *
 * El snapshot destino tiene que traer su propio `snapshot-manifest.json`: la
 * rama que reconstruía un pointer a mano describía un dataset bajo `data/` y
 * `evidence/`, rutas que este árbol ya no tiene.
 */
export function rollbackSnapshot(root, snapshotId, fsModule = fs, beforePointerUpdate = () => {}) {
  const snapshotPath = path.join(root, '.local-cache', 'snapshots', snapshotId, 'snapshot-manifest.json');
  if (!fsModule.existsSync(snapshotPath)) throw new Error(`No existe snapshot para rollback: ${snapshotId}`);
  const target = validateSnapshotPointer(root, JSON.parse(fsModule.readFileSync(snapshotPath, 'utf8')));
  if (target.eligible_for_rollback === false) throw new Error(`Snapshot no elegible para rollback: ${snapshotId}`);
  const active = readActivePointer(root);
  if (!active) throw new Error('No hay pointer activo desde el que revertir');
  const { dataset_absolute_path, ...persistedTarget } = target;
  const pointer = { ...persistedTarget, rollback_from: active.snapshot_id, rolled_back_at: new Date().toISOString() };
  beforePointerUpdate(pointer);
  writeActivePointer(root, pointer, fsModule);
  return pointer;
}

export { ACTIVE_POINTER_RELATIVE };
