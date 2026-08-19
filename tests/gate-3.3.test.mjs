import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGunzip } from 'node:zlib';
import { compareSnapshotQuality, makeSnapshotPointer, promoteSnapshot, rollbackSnapshot, validateCsvHeader, validateDownloadMetadata } from '../app/snapshot-refresh.mjs';
import { readActivePointer, writeActivePointer } from '../app/snapshot-manifest.mjs';
import { compareSnapshotValidators } from '../app/validator-comparison.mjs';
import { canUseCurlFallback, hasNumericQuality, sourceMaxAdvances } from '../app/refresh-policy.mjs';
import { acquireExclusiveLock } from '../app/exclusive-lock.mjs';
import { findMatchingRaw } from '../app/raw-reuse.mjs';

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'facilito-gate-3-3-')); }

function evidence({ fresh = 100, ready = 90, coverage = 90, exceptions = {} } = {}) {
  return {
    metrics: {
      funnel: {
        within_30_days: { offers: fresh },
        contract_ready_with_provisional_identity: { offers: ready },
      },
      coverage: { offers: { percent: coverage } },
      exceptions: { latest_price_conflicts: 0, latest_territory_conflicts: 0, registry_ambiguous_after_freshness: 0, registry_territory_mismatch_after_exact_join: 0, gis_ambiguous_after_registry: 0, gis_unsafe_coordinate_after_exact_join: 0, gis_territory_mismatch_after_exact_join: 0, missing_or_ambiguous_provisional_identity: 0, ...exceptions },
    },
    temporal_semantics: { values: { source_max_reported_at: fresh >= 715 ? '2026-08-19T00:00:00Z' : '2026-08-18T00:00:00Z' } },
  };
}

test('unchanged evita cualquier descarga posterior', async () => {
  let getCalls = 0;
  const result = await (await import('../app/http-validator-probe.mjs')).probeSnapshotValidators({
    url: 'https://source.invalid/file.csv',
    local: { etag: 'opaque', last_modified: 'today' },
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'HEAD');
      getCalls += options.method === 'GET' ? 1 : 0;
      return new Response(null, { status: 304 });
    },
  });
  assert.equal(result.status, 'unchanged');
  assert.equal(getCalls, 0);
});

test('metadata truncado, schema drift y contrato inválido rechazan antes de promover', async () => {
  assert.ok(validateDownloadMetadata({ status: 200, headers: { 'content-length': '100' }, bytes: 99 }).length > 0);
  assert.ok(validateDownloadMetadata({ status: 206, headers: {}, bytes: 100, contentRange: 'bytes 0-98/100' }).length > 0);
  assert.throws(() => validateCsvHeader(['ID3', 'FECHA'], ['ID3', 'ACTIVIDAD']), /schema\/header drift/);
  const { validateDataset } = await import('../app/contract.mjs');
  const schema = JSON.parse(fs.readFileSync(new URL('../contracts/gate-1.1-experiment-dataset.schema.json', import.meta.url), 'utf8'));
  const invalid = { schema_version: '1.1.0', dataset_id: 'drift', scope: {}, temporal_context: {}, offers: [] };
  assert.ok(validateDataset(invalid, schema).length > 0);
});

test('guardrails devuelven needs_review ante degradación material y no congelan conteos', () => {
  const result = compareSnapshotQuality(evidence({ fresh: 100, ready: 90, coverage: 95 }), evidence({ fresh: 70, ready: 60, coverage: 89 }));
  assert.equal(result.status, 'needs_review');
  assert.ok(result.reasons.some((reason) => reason.includes('ofertas frescas')));
  assert.ok(result.reasons.some((reason) => reason.includes('cobertura')));
  assert.equal(compareSnapshotQuality(evidence({ fresh: 714, ready: 714, coverage: 96.356 }), evidence({ fresh: 715, ready: 700, coverage: 96.2 })).status, 'ready');
});

test('guardrails fallan cerrado ante coverage o excepción material ausente', () => {
  const noCoverage = evidence({});
  delete noCoverage.metrics.coverage;
  assert.equal(compareSnapshotQuality(evidence(), noCoverage).status, 'needs_review');
  const noException = evidence();
  delete noException.metrics.exceptions.gis_ambiguous_after_registry;
  assert.equal(compareSnapshotQuality(evidence(), noException).status, 'needs_review');
});

test('fallo antes de actualizar pointer conserva el last-known-good', () => {
  const root = tempRoot();
  const oldDataset = path.join(root, 'old.json');
  fs.writeFileSync(oldDataset, '{}');
  const oldPointer = { schema_version: 1, snapshot_id: '2026-08-14-test-old', snapshot_date: '2026-08-14', dataset_path: 'old.json' };
  writeActivePointer(root, oldPointer);
  const stage = path.join(root, 'stage');
  const final = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', 'new');
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'snapshot-manifest.json'), '{}');
  const newPointer = { schema_version: 1, snapshot_id: '2026-08-18-test-new', snapshot_date: '2026-08-18', dataset_path: '.local-cache/gate-3.3/snapshots/new/dataset.json' };
  assert.throws(() => promoteSnapshot({ root, stagePath: stage, finalPath: final, pointer: newPointer, beforePointerUpdate: () => { throw new Error('simulated pointer failure'); } }), /pointer no actualizado/);
  assert.equal(readActivePointer(root).snapshot_id, '2026-08-14-test-old');
  assert.equal(fs.existsSync(final), true);
});

test('snapshot válido se promueve, el pointer es pequeño y rollback solo cambia el pointer', () => {
  const root = tempRoot();
  const oldFinal = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', '2026-08-14-test-old');
  fs.mkdirSync(oldFinal, { recursive: true });
  const oldPointer = { schema_version: 1, snapshot_id: '2026-08-14-test-old', snapshot_date: '2026-08-14', dataset_path: '.local-cache/gate-3.3/snapshots/2026-08-14-test-old/dataset.json' };
  fs.writeFileSync(path.join(oldFinal, 'snapshot-manifest.json'), `${JSON.stringify(oldPointer)}\n`);
  fs.writeFileSync(path.join(oldFinal, 'dataset.json'), '{}');
  writeActivePointer(root, oldPointer);
  const stage = path.join(root, 'stage');
  const final = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', '2026-08-18-test-new');
  fs.mkdirSync(path.join(stage, 'dataset'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'dataset', 'experiment-dataset-lima-province.json'), '{}');
  const pointer = makeSnapshotPointer({ root, snapshotId: '2026-08-18-test-new', snapshotDate: '2026-08-18', datasetPath: path.join(final, 'dataset', 'experiment-dataset-lima-province.json'), evidencePath: path.join(final, 'evidence.json'), acquisitionPath: path.join(final, 'acquisitions.jsonl'), sourceUrl: 'https://source.invalid/file.csv', validators: { etag: 'new', last_modified: 'today' }, promotedAt: new Date().toISOString(), referenceInputs: { registry_gis_snapshot_date: '2026-08-14' } });
  fs.writeFileSync(path.join(stage, 'snapshot-manifest.json'), `${JSON.stringify(pointer)}\n`);
  promoteSnapshot({ root, stagePath: stage, finalPath: final, pointer });
  assert.equal(readActivePointer(root).snapshot_id, '2026-08-18-test-new');
  const before = fs.readFileSync(path.join(final, 'snapshot-manifest.json'), 'utf8');
  rollbackSnapshot(root, '2026-08-14-test-old');
  assert.equal(readActivePointer(root).snapshot_id, '2026-08-14-test-old');
  assert.equal(fs.readFileSync(path.join(final, 'snapshot-manifest.json'), 'utf8'), before);
});

test('comparación de validadores sigue tratando ETag como valor opaco', () => {
  assert.equal(compareSnapshotValidators({ etag: 'W/"x"', last_modified: null }, { etag: 'W/"x"', last_modified: null }), 'unchanged');
  assert.equal(compareSnapshotValidators({ etag: 'W/"x"', last_modified: null }, { etag: '"x"', last_modified: null }), 'changed');
});

test('política de refresco falla cerrado ante no-op, métricas faltantes y errores HTTP', () => {
  assert.equal(sourceMaxAdvances('2026-08-14T04:58:57Z', '2026-08-14T04:58:57Z'), false);
  assert.equal(sourceMaxAdvances('2026-08-14T04:58:57Z', '2026-08-13T04:58:57Z'), false);
  assert.equal(sourceMaxAdvances('2026-08-14T04:58:57Z', '2026-08-18T04:59:36Z'), true);
  assert.equal(hasNumericQuality({ candidate: { fresh_offers: 1, contract_ready: null, coverage_percent: 2 } }), false);
  assert.equal(canUseCurlFallback([{ status: 403 }]), false);
  assert.equal(canUseCurlFallback([{ status: 500 }]), false);
  assert.equal(canUseCurlFallback([{ status: null }]), true);
});

test('snapshot inválido queda fuera de rollback aunque conserve sus archivos', () => {
  const root = tempRoot();
  const snapshot = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', '2026-08-18-invalid');
  fs.mkdirSync(snapshot, { recursive: true });
  fs.writeFileSync(path.join(snapshot, 'dataset.json'), '{}');
  fs.writeFileSync(path.join(snapshot, 'snapshot-manifest.json'), JSON.stringify({ schema_version: 1, eligible_for_rollback: false, snapshot_id: '2026-08-18-invalid', snapshot_date: '2026-08-18', dataset_path: '.local-cache/gate-3.3/snapshots/2026-08-18-invalid/dataset.json' }));
  assert.throws(() => rollbackSnapshot(root, '2026-08-18-invalid'), /no elegible/);
});

test('lock exclusivo rechaza concurrencia', () => {
  const root = tempRoot();
  const lock = path.join(root, 'refresh.lock');
  const release = acquireExclusiveLock(lock);
  assert.throws(() => acquireExclusiveLock(lock), /concurrente rechazado/);
  release();
  assert.doesNotThrow(() => acquireExclusiveLock(lock)());
});

test('el minimizado promovido tiene exactamente un header al inicio del gzip', async () => {
  const pointerPath = path.join(process.cwd(), '.local-cache', 'gate-3.3', 'active.json');
  if (!fs.existsSync(pointerPath)) return;
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  const minimized = pointer.lineage?.paths?.minimized_path;
  if (!minimized || !fs.existsSync(path.join(process.cwd(), minimized))) return;
  const stream = fs.createReadStream(path.join(process.cwd(), minimized)).pipe(createGunzip());
  let text = '';
  for await (const chunk of stream) { text += chunk.toString(); if (text.split('\n').length > 3) { stream.destroy(); break; } }
  const lines = text.split('\n').slice(0, 3);
  assert.equal(lines[0], 'ID3;ACTIVIDAD;REGISTRO_DE_HIDROCARBUROS;DEPARTAMENTO;PROVINCIA;DISTRITO;FECHA_DE_REGISTRO;PRODUCTO;PRECIO_DE_VENTA_SOLES;UNIDAD');
  assert.notEqual(lines[1], lines[0]);
});

test('raw reutilizable exige validators exactos y no reutiliza ante ETag futuro', async () => {
  const root = tempRoot();
  const snapshot = path.join(root, '.local-cache', 'gate-3.3', 'snapshots', '2026-08-18-test');
  const raw = path.join(snapshot, 'acquired', 'source.csv');
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.writeFileSync(raw, 'ID3;ACTIVIDAD\n1;X\n');
  const { createHash } = await import('node:crypto');
  const sha256 = createHash('sha256').update(fs.readFileSync(raw)).digest('hex');
  const acquisition = { source_id: 'liquid-current', bytes: fs.statSync(raw).size, sha256, response_headers: { etag: '"v1"', 'last-modified': 'Mon, 18 Aug 2026 12:00:00 GMT' }, cache_path: path.relative(root, raw) };
  fs.writeFileSync(path.join(snapshot, 'snapshot-manifest.json'), JSON.stringify({ acquisition_path: path.relative(root, path.join(snapshot, 'acquisitions.jsonl')) }));
  fs.writeFileSync(path.join(snapshot, 'acquisitions.jsonl'), `${JSON.stringify(acquisition)}\n`);
  const validators = { etag: acquisition.response_headers.etag, last_modified: acquisition.response_headers['last-modified'] };
  assert.ok(await findMatchingRaw({ root, snapshotsRoot: path.join(root, '.local-cache', 'gate-3.3', 'snapshots'), sourceId: 'liquid-current', validators }));
  assert.equal(await findMatchingRaw({ root, snapshotsRoot: path.join(root, '.local-cache', 'gate-3.3', 'snapshots'), sourceId: 'liquid-current', validators: { etag: '"v2"', 'last-modified': acquisition.response_headers['last-modified'] } }), null);
});
