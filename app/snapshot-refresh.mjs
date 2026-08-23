import fs from 'node:fs';
import path from 'node:path';
import { ACTIVE_POINTER_RELATIVE, readActivePointer, resolveActiveSnapshot, validateSnapshotPointer, writeActivePointer } from './snapshot-manifest.mjs';

export const REFRESH_GUARDRAILS = Object.freeze({
  max_fresh_offer_drop_ratio: 0.2,
  max_coverage_drop_points: 5,
  material_conflicts: Object.freeze([
    'latest_price_conflicts',
    'latest_territory_conflicts',
    'registry_ambiguous_after_freshness',
    'registry_territory_mismatch_after_exact_join',
    'gis_ambiguous_after_registry',
    'gis_unsafe_coordinate_after_exact_join',
    'gis_territory_mismatch_after_exact_join',
    'missing_or_ambiguous_provisional_identity',
  ]),
});

function funnel(metrics, key) {
  return metrics?.funnel?.[key]?.offers ?? null;
}

function numeric(value) { return typeof value === 'number' && Number.isFinite(value); }

export function compareSnapshotQuality(previousEvidence, candidateEvidence, guardrails = REFRESH_GUARDRAILS) {
  const reasons = [];
  const previousFresh = funnel(previousEvidence?.metrics, 'within_30_days');
  const candidateFresh = funnel(candidateEvidence?.metrics, 'within_30_days');
  const candidateReady = funnel(candidateEvidence?.metrics, 'contract_ready_with_provisional_identity');
  const previousCoverage = previousEvidence?.metrics?.coverage?.offers?.percent;
  const candidateCoverage = candidateEvidence?.metrics?.coverage?.offers?.percent;
  if (!numeric(previousCoverage) || !numeric(candidateCoverage)) reasons.push('coverage ausente o no numérica');
  if (!(candidateFresh > 0)) reasons.push('no quedan ofertas frescas en el snapshot candidato');
  if (!(candidateReady > 0)) reasons.push('el snapshot candidato no produce ofertas listas para contrato');
  if (Number.isFinite(previousFresh) && Number.isFinite(candidateFresh)
    && candidateFresh < previousFresh * (1 - guardrails.max_fresh_offer_drop_ratio)) {
    reasons.push(`caída material de ofertas frescas: ${previousFresh} → ${candidateFresh}`);
  }
  if (Number.isFinite(previousCoverage) && Number.isFinite(candidateCoverage)
    && candidateCoverage < previousCoverage - guardrails.max_coverage_drop_points) {
    reasons.push(`caída material de cobertura: ${previousCoverage} → ${candidateCoverage} puntos porcentuales`);
  }
  const exceptions = candidateEvidence?.metrics?.exceptions ?? {};
  for (const field of guardrails.material_conflicts) {
    if (!numeric(exceptions[field])) reasons.push(`métrica material ausente o no numérica: ${field}`);
    else if (exceptions[field] > 0) reasons.push(`conflicto material ${field}: ${exceptions[field]}`);
  }
  const previousMax = previousEvidence?.temporal_semantics?.values?.source_max_reported_at;
  const candidateMax = candidateEvidence?.temporal_semantics?.values?.source_max_reported_at;
  if (!previousMax || !candidateMax || !Number.isFinite(Date.parse(previousMax)) || !Number.isFinite(Date.parse(candidateMax))) reasons.push('source_max_reported_at ausente o inválido');
  else if (Date.parse(candidateMax) <= Date.parse(previousMax)) reasons.push(`source_max_reported_at no avanza: ${candidateMax} <= ${previousMax}`);
  return {
    status: reasons.length ? 'needs_review' : 'ready',
    reasons,
    guardrails,
    previous: { fresh_offers: previousFresh, coverage_percent: previousCoverage },
    candidate: { fresh_offers: candidateFresh, contract_ready: candidateReady, coverage_percent: candidateCoverage },
  };
}

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

export function validateCsvHeader(observed, expected) {
  if (!Array.isArray(observed) || JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(`schema/header drift: esperado ${JSON.stringify(expected)}, observado ${JSON.stringify(observed)}`);
  }
  return true;
}

export function makeSnapshotPointer({ root, snapshotId, snapshotDate, datasetPath, evidencePath, acquisitionPath, overlayPath, sourceUrl, validators, promotedAt, referenceInputs, lineage }) {
  return {
    schema_version: 1,
    source_id: 'liquid-current',
    snapshot_id: snapshotId,
    snapshot_date: snapshotDate,
    dataset_path: path.relative(root, datasetPath),
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

export function rollbackSnapshot(root, snapshotId, fsModule = fs, beforePointerUpdate = () => {}) {
  const snapshotPath = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', snapshotId, 'snapshot-manifest.json');
  let target;
  if (fsModule.existsSync(snapshotPath)) {
    target = validateSnapshotPointer(root, JSON.parse(fsModule.readFileSync(snapshotPath, 'utf8')));
    if (target.eligible_for_rollback === false) throw new Error(`Snapshot no elegible para rollback: ${snapshotId}`);
  } else {
    // Permite recuperar el last-known-good pre-Gate 3.3 sin copiar ni modificar
    // su dataset legado: rollback solo cambia el pointer.
    const legacyDataset = path.join(root, '.local-cache', 'gate-1.1', snapshotId, 'experiment-dataset-lima-province.json');
    if (!fsModule.existsSync(legacyDataset)) throw new Error(`No existe snapshot para rollback: ${snapshotId}`);
    target = {
      schema_version: 1,
      source_id: 'liquid-current',
      snapshot_id: snapshotId,
      snapshot_date: snapshotId,
      dataset_path: path.relative(root, legacyDataset),
      evidence_path: path.relative(root, path.join(root, 'evidence', `gate-1.1-lima-province-${snapshotId}.json`)),
      acquisition_path: path.relative(root, path.join(root, 'data', 'provenance', snapshotId, 'acquisitions.jsonl')),
      reference_inputs: { note: 'rollback al last-known-good pre-Gate 3.3' },
    };
  }
  const active = readActivePointer(root) ?? resolveActiveSnapshot(root);
  const { dataset_absolute_path, ...persistedTarget } = target;
  const pointer = { ...persistedTarget, rollback_from: active.snapshot_id, rolled_back_at: new Date().toISOString() };
  beforePointerUpdate(pointer);
  writeActivePointer(root, pointer, fsModule);
  return pointer;
}

export { ACTIVE_POINTER_RELATIVE };
