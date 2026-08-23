#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SOURCE_URLS } from '../app/source-catalog.mjs';
import { probeSnapshotValidators } from '../app/http-validator-probe.mjs';
import { makeSnapshotPointer, compareSnapshotQuality, promoteSnapshot, validateDownloadMetadata } from '../app/snapshot-refresh.mjs';
import { readActivePointer, resolveActiveSnapshot, validateSnapshotPointer, writeActivePointer } from '../app/snapshot-manifest.mjs';
import { loadValidatedDataset } from '../app/contract.mjs';
import { nativeFetch } from '../app/native-http.mjs';
import { canUseCurlFallback } from '../app/refresh-policy.mjs';
import { findMatchingRaw } from '../app/raw-reuse.mjs';
import { acquireExclusiveLock } from '../app/exclusive-lock.mjs';
import { validateGasolinaRefreshState } from '../pipeline/gasolina-contract.mjs';
import { buildGasolinaProjectionCandidate, loadCommercialPublicationInputs } from '../pipeline/project-gasolina.mjs';
import { compareGasolinaQuality, snapshotIdFromGasolinaRevision } from '../pipeline/refresh-state.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceId = process.argv[2] ?? 'liquid-current';
const referenceSnapshot = '2026-08-14';
const userAgent = 'Mozilla/5.0 (compatible; masfacil.pe/4.3; public-data-research)';
const maxRedirects = 3;
const downloadTimeoutMs = 60 * 60 * 1000;
const probeTimeoutMs = Number(process.env.PROBE_TIMEOUT_MS ?? 10_000);
const lockPath = path.join(root, '.local-cache', 'snapshots', 'refresh.lock');
const publicRefreshStatePath = process.env.REFRESH_STATE_PATH ? path.resolve(process.env.REFRESH_STATE_PATH) : null;
const referenceMinimizedRoot = process.env.REFERENCE_MINIMIZED_ROOT ? path.resolve(process.env.REFERENCE_MINIMIZED_ROOT) : path.join(root, 'data', 'minimized', referenceSnapshot);
const testSourceUrl = process.env.TEST_SOURCE_URL ?? null;

if (testSourceUrl && process.env.TEST_MODE !== '1') {
  throw new Error('TEST_SOURCE_URL exige TEST_MODE=1');
}

const refreshSourceUrl = testSourceUrl ?? CANONICAL_SOURCE_URLS.liquid_current;

function acquireLock() {
  return acquireExclusiveLock(lockPath);
}

function curlHeadFetch(url, options = {}) {
  if ((options.method ?? 'GET') !== 'HEAD') throw new Error('curl fallback solo admite HEAD');
  const args = ['--silent', '--show-error', '--location', '--max-redirs', String(maxRedirects), '--max-time', String(Math.ceil(probeTimeoutMs / 1000)), '--head', '--dump-header', '-', '--output', '/dev/null', '--user-agent', userAgent];
  for (const [name, value] of Object.entries(options.headers ?? {})) args.push('--header', `${name}: ${value}`);
  args.push(url);
  const result = spawnSync('curl', args, { encoding: 'utf8', timeout: probeTimeoutMs + 2000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `curl terminó con ${result.status}`);
  const blocks = result.stdout.replace(/\r\n/g, '\n').split(/\n\n+/).filter((block) => /^HTTP\//.test(block.trim()));
  const block = blocks.at(-1);
  if (!block) throw new Error('curl no devolvió cabeceras HTTP');
  const lines = block.trim().split('\n');
  const status = Number(lines[0].match(/^HTTP\/\S+\s+(\d+)/)?.[1]);
  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':');
    if (separator > 0) headers.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return new Response(null, { status, headers });
}

function materialHeaders(headers) {
  const names = ['accept-ranges', 'cache-control', 'content-disposition', 'content-length', 'content-range', 'content-type', 'date', 'etag', 'last-modified', 'location'];
  return Object.fromEntries(names.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]));
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }


function sourceRecordFor(pointer) {
  const pathFromPointer = pointer.acquisition_path ? path.join(root, pointer.acquisition_path) : path.join(root, 'data', 'provenance', pointer.snapshot_date, 'acquisitions.jsonl');
  if (!fs.existsSync(pathFromPointer)) throw new Error(`Falta procedencia del snapshot activo: ${pathFromPointer}`);
  const records = fs.readFileSync(pathFromPointer, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const record = records.find((item) => item.source_id === sourceId);
  if (!record) throw new Error(`Falta adquisición ${sourceId} del snapshot activo`);
  return record;
}

function validatedActiveSnapshot() {
  const active = ensureInitialPointer();
  const checked = validateSnapshotPointer(root, active);
  const evidencePath = checked.evidence_path ? path.join(root, checked.evidence_path) : null;
  const acquisitionPath = checked.acquisition_path ? path.join(root, checked.acquisition_path) : null;
  if (!evidencePath || !fs.existsSync(evidencePath) || !acquisitionPath || !fs.existsSync(acquisitionPath)) throw new Error('Manifest activo sin evidencia o procedencia verificable');
  const dataset = loadValidatedDataset(checked.dataset_absolute_path);
  return { ...checked, source_max_reported_at: dataset.temporal_context.source_max_reported_at };
}

function refreshBaseline() {
  if (publicRefreshStatePath) {
    if (!fs.existsSync(publicRefreshStatePath)) throw new Error('Falta refresh-state público para bootstrap limpio');
    const state = readJson(publicRefreshStatePath);
    const errors = validateGasolinaRefreshState(state, { revision_id: state.revision_id });
    if (errors.length) throw new Error(`Refresh-state público inválido: ${errors.join('; ')}`);
    return {
      active: { snapshot_id: snapshotIdFromGasolinaRevision(state.revision_id), validators: state.validators },
      localValidators: state.validators,
      previousEvidence: null,
      previousProducts: state.products,
      previousSourceMaxReportedAt: state.source_max_reported_at,
    };
  }
  const active = validatedActiveSnapshot();
  const evidencePath = active.evidence_path ? path.join(root, active.evidence_path) : null;
  if (!evidencePath || !fs.existsSync(evidencePath)) throw new Error('Falta evidencia agregada del snapshot activo');
  const localStatePath = path.join(root, 'web', 'data', 'gasolina', 'refresh-state.json');
  let previousProducts = null;
  let previousSourceMaxReportedAt = active.source_max_reported_at;
  if (fs.existsSync(localStatePath)) {
    const state = readJson(localStatePath);
    const errors = validateGasolinaRefreshState(state, { revision_id: state.revision_id });
    if (!errors.length && snapshotIdFromGasolinaRevision(state.revision_id) === active.snapshot_id) {
      previousProducts = state.products;
      previousSourceMaxReportedAt = state.source_max_reported_at;
    }
  }
  return { active, localValidators: active.validators, previousEvidence: readJson(evidencePath), previousProducts, previousSourceMaxReportedAt };
}

function ensureInitialPointer() {
  const existing = readActivePointer(root);
  if (existing) return existing;
  const legacy = resolveActiveSnapshot(root);
  const record = sourceRecordFor(legacy);
  const pointer = makeSnapshotPointer({
    root,
    snapshotId: legacy.snapshot_id.replace(/^legacy-/, ''),
    snapshotDate: legacy.snapshot_date,
    datasetPath: legacy.dataset_absolute_path,
    evidencePath: path.join(root, 'evidence', `lima-province-${legacy.snapshot_date}.json`),
    acquisitionPath: path.join(root, 'data', 'provenance', legacy.snapshot_date, 'acquisitions.jsonl'),
    sourceUrl: record.final_url ?? record.requested_url,
    validators: { etag: record.response_headers?.etag ?? null, last_modified: record.response_headers?.['last-modified'] ?? null },
    promotedAt: null,
    referenceInputs: { registry_gis_snapshot_date: referenceSnapshot, note: 'pointer de migración del last-known-good anterior' },
  });
  writeActivePointer(root, { ...pointer, legacy: true });
  return readActivePointer(root);
}

async function fetchFull(url, destination) {
  let currentUrl = url;
  const redirects = [];
  for (let count = 0; count <= maxRedirects; count += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), downloadTimeoutMs);
    const requestedAt = new Date().toISOString();
    let response;
    try {
      response = await nativeFetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': userAgent },
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`timeout de descarga: ${currentUrl}`);
      throw new Error(`error de descarga: ${error.message}`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || count === maxRedirects) throw new Error(`redirect inválido o excesivo para ${url}`);
      redirects.push({ status: response.status, from: currentUrl, to: new URL(location, currentUrl).toString() });
      currentUrl = new URL(location, currentUrl).toString();
      clearTimeout(timeout);
      continue;
    }
    if (!response.body) {
      clearTimeout(timeout);
      throw new Error(`respuesta sin cuerpo: HTTP ${response.status}`);
    }
    const headers = Object.fromEntries(response.headers.entries());
    const partial = `${destination}.part`;
    if (fs.existsSync(partial) || fs.existsSync(destination)) throw new Error(`destino de descarga ya existe: ${destination}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); bytes += chunk.length; callback(null, chunk); } });
    try {
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
      const errors = validateDownloadMetadata({ status: response.status, headers, bytes, contentRange: headers['content-range'] });
      if (errors.length) throw new Error(errors.join('; '));
      fs.chmodSync(partial, 0o600);
      fs.renameSync(partial, destination);
      clearTimeout(timeout);
      return {
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        final_url: currentUrl,
        response_status: response.status,
        response_headers: materialHeaders(headers),
        response_chain: redirects,
        bytes,
        sha256: hash.digest('hex'),
      };
    } catch (error) {
      controller.abort();
      clearTimeout(timeout);
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
      throw error;
    }
  }
  throw new Error(`no se pudo descargar ${url}`);
}

function writeRecord(stage, record, cachePath) {
  const provenanceDir = path.join(stage, 'provenance', record.snapshot_date);
  fs.mkdirSync(provenanceDir, { recursive: true, mode: 0o700 });
  const acquisition = {
    source_id: sourceId,
    requested_url: refreshSourceUrl,
    query_parameters: {},
    request_headers: { 'accept-encoding': 'identity', 'user-agent': userAgent },
    ...record,
    cache_path: cachePath,
  };
  fs.writeFileSync(path.join(provenanceDir, 'acquisitions.jsonl'), `${JSON.stringify(acquisition)}\n`, { mode: 0o600, flag: 'wx' });
  return acquisition;
}

function rewriteFinalAcquisition(final, snapshotDate, rawRelativePath) {
  const file = path.join(final, 'provenance', snapshotDate, 'acquisitions.jsonl');
  const records = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const updated = records.map((record) => record.source_id === sourceId
    ? { ...record, cache_path: path.relative(root, path.join(final, rawRelativePath)) }
    : record);
  fs.writeFileSync(file, `${updated.map((record) => JSON.stringify(record)).join('\n')}\n`, { mode: 0o600 });
}

function runBuilder(stage, snapshotDate, rawRecord) {
  const output = path.join(stage, 'dataset', 'experiment-dataset-lima-province.json');
  const evidence = path.join(stage, 'evidence', `lima-province-${snapshotDate}.json`);
  const provenance = path.join(stage, 'provenance', snapshotDate);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-dataset.mjs')], {
    cwd: root,
    env: {
      ...process.env,
      SNAPSHOT_DATE: snapshotDate,
      MINIMIZED_ROOT: path.relative(root, path.join(stage, 'minimized')),
      PROVENANCE_ROOT: path.relative(root, provenance),
      LOCAL_OUTPUT: path.relative(root, output),
      EVIDENCE_OUTPUT: path.relative(root, evidence),
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!fs.existsSync(output) || !fs.existsSync(evidence)) throw new Error(`builder terminó sin dataset o evidencia: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  const dataset = loadValidatedDataset(output);
  const candidateEvidence = readJson(evidence);
  if (result.status !== 0 || (candidateEvidence.assertion_summary?.failed ?? 1) !== 0) {
    const failures = (candidateEvidence.assertions ?? []).filter((item) => !item.pass).map((item) => `${item.id}: ${JSON.stringify(item.observed)}`).join(' | ');
    throw new Error(`builder rechazó el snapshot: ${failures || result.stderr || result.stdout}`);
  }
  return { output, evidence, dataset, candidateEvidence, builder_stdout: result.stdout.trim(), raw_record: rawRecord };
}

async function run() {
  if (sourceId !== 'liquid-current') throw new Error(`Solo se permite refrescar ${sourceId} actual: liquid-current`);
  const baseline = refreshBaseline();
  const active = baseline.active;
  const localValidators = baseline.localValidators;
  const url = refreshSourceUrl;
  let detection = await probeSnapshotValidators({ url, local: localValidators, timeoutMs: probeTimeoutMs });
  if (detection.status === 'unverifiable' && detection.reason && canUseCurlFallback(detection.attempts)) {
    detection = await probeSnapshotValidators({ url, local: localValidators, timeoutMs: probeTimeoutMs, fetchImpl: curlHeadFetch });
    detection.transport_fallback = 'curl HEAD por fallo del cliente HTTPS nativo';
  }
  if (detection.status === 'unchanged') return { status: 'unchanged', active_snapshot: active.snapshot_id, detection, downloaded: false, promoted: false };
  if (detection.status === 'unverifiable') return { status: 'unverifiable', active_snapshot: active.snapshot_id, detection, downloaded: false, promoted: false };

  const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const stage = path.join(root, '.local-cache', 'snapshots', 'staging', runId);
  const rawPath = path.join(stage, 'acquired', 'price-liquid', 'CL-Registro-precios-DMA-V-CCA-CCE.csv');
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  try {
    const remoteAttempt = [...(detection.attempts ?? [])].reverse().find((attempt) => attempt.response_validators?.etag || attempt.response_validators?.last_modified);
    const remoteValidators = remoteAttempt?.response_validators ?? { etag: null, last_modified: null };
    const reusable = await findMatchingRaw({ root, snapshotsRoot: path.join(root, '.local-cache', 'snapshots'), sourceId, validators: remoteValidators });
    let downloaded;
    if (reusable) {
      fs.mkdirSync(path.dirname(rawPath), { recursive: true, mode: 0o700 });
      fs.symlinkSync(reusable.path, rawPath);
      downloaded = { requested_at: reusable.record.requested_at, completed_at: reusable.record.completed_at, final_url: reusable.record.final_url ?? url, response_status: reusable.record.response_status, response_headers: { ...reusable.record.response_headers, 'content-length': String(reusable.record.bytes), etag: remoteValidators.etag, 'last-modified': remoteValidators.last_modified }, response_chain: reusable.record.response_chain ?? [], bytes: Number(reusable.record.bytes), sha256: reusable.record.sha256, reused_local_raw: true };
    } else downloaded = await fetchFull(url, rawPath);
    const snapshotDate = new Date(downloaded.response_headers['last-modified'] ?? downloaded.completed_at).toISOString().slice(0, 10);
    const rawRecord = writeRecord(stage, { ...downloaded, snapshot_date: snapshotDate, source_id: sourceId, final_url: downloaded.final_url }, path.relative(root, rawPath));
    const minimized = spawnSync(process.execPath, [path.join(root, 'scripts', 'minimize.mjs')], { cwd: root, env: { ...process.env, RAW_INPUT: path.relative(root, rawPath), MINIMIZED_OUTPUT: path.relative(root, path.join(stage, 'minimized')) }, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (minimized.status !== 0) throw new Error(`minimización rechazada: ${minimized.stderr || minimized.stdout}`);
    const minimizedLineage = JSON.parse(minimized.stdout);
    minimizedLineage.minimized_path = 'minimized/prices/liquid-current.csv.gz';
    if (minimizedLineage.raw_sha256 !== downloaded.sha256 || minimizedLineage.raw_bytes !== downloaded.bytes) throw new Error('lineage raw/minimizado inconsistente');
    fs.mkdirSync(path.join(stage, 'minimized', 'registry'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(stage, 'minimized', 'gis'), { recursive: true, mode: 0o700 });
    for (const relative of ['registry/authorizations.csv.gz', 'gis/features.csv.gz']) {
      const source = path.join(referenceMinimizedRoot, relative);
      if (!fs.existsSync(source)) throw new Error(`Falta input sanitizado de bootstrap: ${relative}`);
      fs.copyFileSync(source, path.join(stage, 'minimized', relative));
      fs.chmodSync(path.join(stage, 'minimized', relative), 0o600);
    }
    fs.mkdirSync(path.join(stage, 'provenance', snapshotDate), { recursive: true, mode: 0o700 });
    const built = runBuilder(stage, snapshotDate, rawRecord);
    const snapshotId = `${snapshotDate}-${runId}`;
    const final = path.join(root, '.local-cache', 'snapshots', snapshotId);
    const lineage = { raw: { sha256: downloaded.sha256, bytes: downloaded.bytes }, minimized: minimizedLineage, dataset: { snapshot_date: built.dataset.temporal_context.snapshot_date, source_max_reported_at: built.dataset.temporal_context.source_max_reported_at } };
    const pointer = makeSnapshotPointer({
      root,
      snapshotId,
      snapshotDate,
      datasetPath: path.join(final, 'dataset', 'experiment-dataset-lima-province.json'),
      evidencePath: path.join(final, 'evidence', path.basename(built.evidence)),
      acquisitionPath: path.join(final, 'provenance', snapshotDate, 'acquisitions.jsonl'),
      overlayPath: null,
      sourceUrl: url,
      validators: { etag: downloaded.response_headers.etag ?? null, last_modified: downloaded.response_headers['last-modified'] ?? null },
      promotedAt: new Date().toISOString(),
      referenceInputs: { registry_gis_snapshot_date: referenceSnapshot, note: 'Registro y GIS no se refrescan en este ciclo' },
      lineage: { ...lineage, paths: { raw_path: path.relative(root, path.join(final, path.relative(stage, rawPath))), minimized_path: path.relative(root, path.join(final, 'minimized', 'prices', 'liquid-current.csv.gz')) } },
    });
    const projection = await buildGasolinaProjectionCandidate({
      pointer,
      privateDataset: built.dataset,
      minimizedRoot: path.join(stage, 'minimized'),
      rawPath,
      ...loadCommercialPublicationInputs(root),
    });
    const gasolinaQuality = compareGasolinaQuality({
      previousProducts: baseline.previousProducts,
      candidateProducts: projection.refreshState.products,
      previousSourceMaxReportedAt: baseline.previousSourceMaxReportedAt,
      candidateSourceMaxReportedAt: projection.refreshState.source_max_reported_at,
    });
    const legacyQuality = baseline.previousEvidence
      ? compareSnapshotQuality(baseline.previousEvidence, built.candidateEvidence)
      : { status: 'ready', reasons: [], note: 'guardrails públicos v2 aplicados a ambos productos' };
    const quality = {
      status: legacyQuality.status === 'ready' && gasolinaQuality.status === 'ready' ? 'ready' : 'needs_review',
      reasons: [...(legacyQuality.reasons ?? []), ...gasolinaQuality.reasons],
      legacy_regular: legacyQuality,
      gasolina: gasolinaQuality,
    };
    const validation = {
      schema_version: 1,
      revision_id: projection.manifest.revision_id,
      source_max_reported_at: projection.refreshState.source_max_reported_at,
      products: Object.fromEntries(Object.entries(projection.results).map(([key, value]) => [key, { metrics: value.metrics, public_snapshot: projection.manifest.products[key] }])),
      quality,
    };
    fs.writeFileSync(path.join(stage, 'gasolina-validation.json'), `${JSON.stringify(validation, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const report = { schema_version: 2, status: quality.status, detection, active_before: active, download: downloaded, lineage, reference_inputs: { registry_gis_snapshot_date: referenceSnapshot, note: 'Registro y GIS no se refrescan en este ciclo' }, quality, staging_path: path.relative(root, stage), dataset: { snapshot_date: snapshotDate, offers: built.dataset.offers.length }, gasolina: { revision_id: projection.manifest.revision_id, products: Object.fromEntries(Object.entries(projection.datasets).map(([key, value]) => [key, { offers: value.offers.length, districts: projection.results[key].metrics.contract_ready.districts }])) } };
    fs.writeFileSync(path.join(stage, 'refresh-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    if (quality.status === 'needs_review') return { ...report, promoted: false, staging_path: path.relative(root, stage) };

    fs.writeFileSync(path.join(stage, 'snapshot-manifest.json'), `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const promoted = promoteSnapshot({ root, stagePath: stage, finalPath: final, pointer, beforePointerUpdate: () => rewriteFinalAcquisition(final, snapshotDate, path.relative(stage, rawPath)) });
    return { ...report, status: 'promoted', promoted: true, active_after: promoted, downloaded: true, public_projection_validated: true };
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw new Error(`${error.message}${error.snapshot_id ? `; snapshot_id=${error.snapshot_id}` : ''}`);
  }
}

let releaseLock = null;
try {
  releaseLock = acquireLock();
  const result = await run();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'unverifiable' || result.status === 'needs_review') process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'rejected', error: error.message })}\n`);
  process.exitCode = 1;
} finally {
  if (typeof releaseLock === 'function') releaseLock();
}
