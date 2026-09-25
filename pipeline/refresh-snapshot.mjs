/**
 * Refresco de la fuente como FUNCIÓN, no como proceso.
 *
 * Antes esto vivía en `scripts/refresh.mjs` leyendo env y argv en el nivel
 * superior, así que la única forma de usarlo era lanzarlo y rebuscar una línea
 * JSON en su stdout —o en su stderr, cuando rechazaba—. Aquí las mismas
 * entradas son opciones con los mismos valores por defecto y el resultado se
 * devuelve. Si algo falla, LANZA: quien llama decide cómo traducirlo.
 *
 * El lock exclusivo sigue dentro: dos refrescos simultáneos siguen sin poder
 * pisarse aunque ahora se invoquen en proceso.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SOURCE_URLS } from '../app/source-catalog.mjs';
import { probeSnapshotValidators } from '../app/http-validator-probe.mjs';
import { makeSnapshotPointer, promoteSnapshot, validateDownloadMetadata } from '../app/snapshot-refresh.mjs';
import { readActivePointer } from '../app/snapshot-manifest.mjs';
import { nativeFetch } from '../app/native-http.mjs';
import { canUseCurlFallback } from '../app/refresh-policy.mjs';
import { findMatchingRaw } from '../app/raw-reuse.mjs';
import { acquireExclusiveLock } from '../app/exclusive-lock.mjs';
import { validateGasolinaRefreshState } from './gasolina-contract.mjs';
import { buildGroupCandidate, loadCommercialPublicationInputs, temporalContextForPointer } from './project-gasolina.mjs';
import { buildLiquidProducts, loadGasolinaSources } from './gasolina-products.mjs';
import { PUBLISHED_GROUPS } from './groups.mjs';
import { compareGroupQuality, snapshotIdFromGasolinaRevision } from './refresh-state.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REFRESH_DEFAULTS = Object.freeze({
  sourceId: 'liquid-current',
  referenceSnapshot: '2026-08-14',
  userAgent: 'Mozilla/5.0 (compatible; masfacil.pe/4.3; public-data-research)',
  maxRedirects: 3,
  downloadTimeoutMs: 60 * 60 * 1000,
  probeTimeoutMs: 10_000,
});

/** Opciones desde el entorno: el guion CLI y CI siguen hablando el mismo idioma. */
export function refreshOptionsFromEnv(env = process.env, argv = process.argv) {
  const testSourceUrl = env.TEST_SOURCE_URL ?? null;
  if (testSourceUrl && env.TEST_MODE !== '1') throw new Error('TEST_SOURCE_URL exige TEST_MODE=1');
  return {
    sourceId: argv[2] ?? REFRESH_DEFAULTS.sourceId,
    forceRefresh: env.FORCE_PROJECT === '1',
    publicRefreshStatePath: env.REFRESH_STATE_PATH ? path.resolve(env.REFRESH_STATE_PATH) : null,
    referenceMinimizedRoot: env.REFERENCE_MINIMIZED_ROOT ? path.resolve(env.REFERENCE_MINIMIZED_ROOT) : null,
    testSourceUrl,
    probeTimeoutMs: Number(env.PROBE_TIMEOUT_MS ?? REFRESH_DEFAULTS.probeTimeoutMs),
    identityRoot: env.IDENTITY_ROOT ?? null,
  };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function materialHeaders(headers) {
  const names = ['accept-ranges', 'cache-control', 'content-disposition', 'content-length', 'content-range', 'content-type', 'date', 'etag', 'last-modified', 'location'];
  return Object.fromEntries(names.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]));
}

function curlHeadFetch(url, options = {}, { probeTimeoutMs, userAgent, maxRedirects }) {
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

async function fetchFull(url, destination, { userAgent, maxRedirects, downloadTimeoutMs }) {
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

function writeRecord(stage, record, cachePath, { sourceId, refreshSourceUrl, userAgent }) {
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

function rewriteFinalAcquisition(root, final, snapshotDate, rawRelativePath, sourceId) {
  const file = path.join(final, 'provenance', snapshotDate, 'acquisitions.jsonl');
  const records = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const updated = records.map((record) => record.source_id === sourceId
    ? { ...record, cache_path: path.relative(root, path.join(final, rawRelativePath)) }
    : record);
  fs.writeFileSync(file, `${updated.map((record) => JSON.stringify(record)).join('\n')}\n`, { mode: 0o600 });
}

/**
 * Línea base contra la que se juzga el candidato.
 *
 * En CI llega el `refresh-state.json` público —el único estado que sobrevive a
 * un runner limpio—. En local se usa el pointer activo y su `temporal_context`.
 * Sin ninguno de los dos no hay línea base y se dice, en vez de promover a
 * ciegas el primer snapshot que llegue.
 */
function refreshBaseline({ root, publicRefreshStatePath }) {
  if (publicRefreshStatePath) {
    if (!fs.existsSync(publicRefreshStatePath)) throw new Error('Falta refresh-state público para bootstrap limpio');
    const state = readJson(publicRefreshStatePath);
    const errors = validateGasolinaRefreshState(state, { revision_id: state.revision_id });
    if (errors.length) throw new Error(`Refresh-state público inválido: ${errors.join('; ')}`);
    return {
      active: { snapshot_id: state.snapshot_id ?? snapshotIdFromGasolinaRevision(state.revision_id), validators: state.validators },
      localValidators: state.validators,
      previousProducts: state.products,
      previousSourceMaxReportedAt: state.source_max_reported_at,
    };
  }
  const active = readActivePointer(root);
  if (!active) throw new Error('No hay pointer activo ni refresh-state público: no hay línea base para refrescar');
  const temporal = temporalContextForPointer(root, active);
  const localStatePath = path.join(root, 'web', 'data', 'gasolina', 'refresh-state.json');
  let previousProducts = null;
  let previousSourceMaxReportedAt = temporal.source_max_reported_at;
  if (fs.existsSync(localStatePath)) {
    const state = readJson(localStatePath);
    const errors = validateGasolinaRefreshState(state, { revision_id: state.revision_id });
    // Antes se comparaba recortando el `revision_id`, y como el recorte nunca
    // quitaba el sufijo la igualdad era siempre falsa: `previousProducts` quedaba
    // en null y los guardrails de caída de ofertas y de cobertura no llegaban a
    // evaluarse. Ahora el snapshot viene declarado.
    if (!errors.length && (state.snapshot_id ?? snapshotIdFromGasolinaRevision(state.revision_id)) === active.snapshot_id) {
      previousProducts = state.products;
      previousSourceMaxReportedAt = state.source_max_reported_at;
    }
  }
  return { active, localValidators: active.validators, previousProducts, previousSourceMaxReportedAt };
}

/**
 * La línea base de cada grupo que no es Gasolina: su propio estado publicado.
 *
 * En CI lo acaba de escribir `fetch:live`; en local es la copia de `web/`, y
 * solo cuenta si describe el snapshot de su pointer. Sin estado —un grupo que
 * todavía no se activó— no hay línea base y la primera versión se juzga contra
 * la base auditada de su configuración.
 */
function groupBaseline({ root, group, ci }) {
  const file = path.join(root, 'web', ...group.dataRoot.split('/'), 'refresh-state.json');
  if (!fs.existsSync(file)) return { previousProducts: null, previousSourceMaxReportedAt: null, validators: null, snapshot_id: null };
  const state = readJson(file);
  const errors = group.validate.refreshState(state, { revision_id: state.revision_id });
  if (errors.length) throw new Error(`Refresh-state ${group.key} inválido: ${errors.join('; ')}`);
  if (!ci) {
    const pointer = readActivePointer(root, { group: group.key });
    if (!pointer || pointer.snapshot_id !== state.snapshot_id) return { previousProducts: null, previousSourceMaxReportedAt: null, validators: null, snapshot_id: null };
  }
  return { previousProducts: state.products, previousSourceMaxReportedAt: state.source_max_reported_at, validators: state.validators, snapshot_id: state.snapshot_id };
}

async function runRefresh(options) {
  const {
    root, sourceId, forceRefresh, publicRefreshStatePath, referenceMinimizedRoot,
    refreshSourceUrl, probeTimeoutMs, userAgent, maxRedirects, downloadTimeoutMs,
    referenceSnapshot, identityRoot,
  } = options;
  if (sourceId !== 'liquid-current') throw new Error(`Solo se permite refrescar ${sourceId} actual: liquid-current`);
  const baseline = refreshBaseline({ root, publicRefreshStatePath });
  const active = baseline.active;
  const otros = Object.fromEntries(PUBLISHED_GROUPS.filter((grupo) => grupo.key !== 'gasolina').map((grupo) => [grupo.key, groupBaseline({ root, group: grupo, ci: Boolean(publicRefreshStatePath) })]));
  // Se compara contra el CSV más nuevo que algún grupo ya aprobó. Si Gasolina
  // rechazó un archivo que Diésel sí publicó, volver a bajarlo en cada corrida
  // solo repetiría el mismo rechazo: Gasolina espera al próximo CSV.
  const masNuevo = Object.values(otros).filter((base) => base.validators && base.snapshot_id > (active.snapshot_id ?? '')).sort((a, b) => (a.snapshot_id < b.snapshot_id ? 1 : -1))[0];
  const url = refreshSourceUrl;
  let detection = await probeSnapshotValidators({ url, local: masNuevo?.validators ?? baseline.localValidators, timeoutMs: probeTimeoutMs });
  if (detection.status === 'unverifiable' && detection.reason && canUseCurlFallback(detection.attempts)) {
    detection = await probeSnapshotValidators({
      url,
      local: masNuevo?.validators ?? baseline.localValidators,
      timeoutMs: probeTimeoutMs,
      fetchImpl: (target, init) => curlHeadFetch(target, init, { probeTimeoutMs, userAgent, maxRedirects }),
    });
    detection.transport_fallback = 'curl HEAD por fallo del cliente HTTPS nativo';
  }
  // Un runner limpio no conserva snapshots entre corridas: si el origen no
  // cambió, no descarga y no queda nada que proyectar. Por eso una reproyección
  // forzada —cambio de contrato o de catálogo, no de datos— tiene que pagar la
  // descarga completa igual. Es caro y por eso es manual.
  if (detection.status === 'unchanged' && !forceRefresh) return { status: 'unchanged', active_snapshot: active.snapshot_id, detection, downloaded: false, promoted: false };
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
    } else downloaded = await fetchFull(url, rawPath, { userAgent, maxRedirects, downloadTimeoutMs });
    const snapshotDate = new Date(downloaded.response_headers['last-modified'] ?? downloaded.completed_at).toISOString().slice(0, 10);
    writeRecord(stage, { ...downloaded, snapshot_date: snapshotDate, source_id: sourceId, final_url: downloaded.final_url }, path.relative(root, rawPath), { sourceId, refreshSourceUrl, userAgent });
    // El guion vive junto a este módulo; el snapshot puede estar en otra raíz
    // (una sonda aislada, por ejemplo). Por eso el ejecutable se resuelve contra
    // el repositorio y sus entradas viajan como rutas absolutas.
    const minimized = spawnSync(process.execPath, [path.join(rootFromModule, 'scripts', 'minimize.mjs')], { cwd: rootFromModule, env: { ...process.env, RAW_INPUT: rawPath, MINIMIZED_OUTPUT: path.join(stage, 'minimized') }, encoding: 'utf8', maxBuffer: 1024 * 1024 });
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

    // El minimizado se recorre UNA vez: de esa pasada sale el máximo temporal de
    // la fuente, que antes calculaba el constructor privado y que ahora viaja en
    // el pointer. Los dos productos comparten estas tablas.
    const minimizedRoot = path.join(stage, 'minimized');
    const sources = await loadGasolinaSources({ minimizedRoot });
    const temporalContext = {
      cutoff_at: new Date(downloaded.completed_at).toISOString(),
      source_max_reported_at: sources.sourceMaxReportedAt,
      snapshot_date: snapshotDate,
    };
    const snapshotId = `${snapshotDate}-${runId}`;
    const final = path.join(root, '.local-cache', 'snapshots', snapshotId);
    const lineage = { raw: { sha256: downloaded.sha256, bytes: downloaded.bytes }, minimized: minimizedLineage };
    const pointer = makeSnapshotPointer({
      root,
      snapshotId,
      snapshotDate,
      acquisitionPath: path.join(final, 'provenance', snapshotDate, 'acquisitions.jsonl'),
      sourceUrl: url,
      validators: { etag: downloaded.response_headers.etag ?? null, last_modified: downloaded.response_headers['last-modified'] ?? null },
      promotedAt: new Date().toISOString(),
      temporalContext,
      referenceInputs: { registry_gis_snapshot_date: referenceSnapshot, note: 'Registro y GIS no se refrescan en este ciclo' },
      lineage: { ...lineage, paths: { raw_path: path.relative(root, path.join(final, path.relative(stage, rawPath))), minimized_path: path.relative(root, path.join(final, 'minimized', 'prices', 'liquid-current.csv.gz')) } },
    });
    // UNA pasada por el original para todos los grupos; cada uno se juzga con su
    // línea base y sus tolerancias. Un error de contrato de Gasolina sigue
    // rechazando el refresco entero, como siempre; el de otro grupo solo lo deja
    // a él pendiente de revisión.
    const { resultsByGroup } = await buildLiquidProducts({
      sources, minimizedRoot, rawPath, cutoffAt: temporalContext.cutoff_at, snapshotId: pointer.snapshot_id, sourceMaxReportedAt: temporalContext.source_max_reported_at, sourceUrl: pointer.source_url,
      groups: PUBLISHED_GROUPS.map((grupo) => ({ key: grupo.key, products: grupo.products, activities: grupo.config.activities, scope: grupo.scope, idScheme: grupo.config.idScheme })),
    });
    const comerciales = loadCommercialPublicationInputs(root, { identityRoot });
    const grupos = {};
    for (const grupo of PUBLISHED_GROUPS) {
      const base = grupo.key === 'gasolina' ? baseline : otros[grupo.key];
      let projection;
      try { projection = buildGroupCandidate({ group: grupo, pointer, temporalContext, results: resultsByGroup[grupo.key], ...comerciales }); }
      catch (error) {
        if (grupo.key === 'gasolina') throw error;
        grupos[grupo.key] = { projection: null, quality: { status: 'needs_review', reasons: [`${grupo.key}: ${error.message}`] } };
        continue;
      }
      // Un solo guardrail por grupo. El legado solo se evaluaba con evidencia
      // previa, que en CI era siempre null: no protegía nada donde importaba.
      const quality = compareGroupQuality({
        group: grupo.key,
        previousProducts: base.previousProducts,
        candidateProducts: projection.refreshState.products,
        previousSourceMaxReportedAt: base.previousSourceMaxReportedAt,
        candidateSourceMaxReportedAt: projection.refreshState.source_max_reported_at,
        forcedReprojection: forceRefresh,
      });
      grupos[grupo.key] = { projection, quality };
    }
    const projection = grupos.gasolina.projection;
    const quality = grupos.gasolina.quality;
    for (const [key, { projection: candidata, quality: calidad }] of Object.entries(grupos)) {
      if (!candidata) continue;
      const validation = {
        schema_version: 1,
        revision_id: candidata.manifest.revision_id,
        source_max_reported_at: candidata.refreshState.source_max_reported_at,
        products: Object.fromEntries(Object.entries(candidata.results).map(([producto, value]) => [producto, { metrics: value.metrics, public_snapshot: candidata.manifest.products[producto] }])),
        identity: candidata.identity,
        commercial_identity: { ...candidata.catalog, without_current_offer_detail: candidata.catalogWithoutOffer, unknown_anchors: candidata.catalogUnknownAnchors, brand_groups: candidata.brandGroups, brand_evidence_review_queue: candidata.brandEvidenceQueue },
        quality: calidad,
      };
      fs.writeFileSync(path.join(stage, `${key}-validation.json`), `${JSON.stringify(validation, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    }
    const resumenGrupos = Object.fromEntries(Object.entries(grupos).map(([key, { projection: candidata, quality: calidad }]) => [key, { status: calidad.status, reasons: calidad.reasons, first_activation: calidad.first_activation === true, revision_id: candidata?.manifest.revision_id ?? null, products: candidata ? Object.fromEntries(Object.entries(candidata.datasets).map(([producto, value]) => [producto, { offers: value.offers.length, districts: candidata.results[producto].metrics.contract_ready.districts }])) : null }]));
    const report = { schema_version: 2, status: quality.status, detection, active_before: active, download: downloaded, lineage, temporal_context: temporalContext, identity: projection.identity, commercial_identity: projection.catalog, reference_inputs: { registry_gis_snapshot_date: referenceSnapshot, note: 'Registro y GIS no se refrescan en este ciclo' }, quality, staging_path: path.relative(root, stage), gasolina: { revision_id: projection.manifest.revision_id, products: Object.fromEntries(Object.entries(projection.datasets).map(([key, value]) => [key, { offers: value.offers.length, districts: projection.results[key].metrics.contract_ready.districts }])) }, groups: resumenGrupos };
    fs.writeFileSync(path.join(stage, 'refresh-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    // La carpeta se promueve si la aprueba al menos un grupo, y solo se mueven
    // los pointers de los que la aprobaron: Gasolina conserva el suyo si
    // rechaza un CSV que Diésel sí acepta, y al revés.
    const aprobados = PUBLISHED_GROUPS.map((grupo) => grupo.key).filter((key) => grupos[key].quality.status === 'ready');
    const conGrupos = (estado) => ({ ...estado, groups: Object.fromEntries(Object.entries(resumenGrupos).map(([key, value]) => [key, { ...value, status: aprobados.includes(key) ? 'promoted' : 'needs_review' }])), promoted_groups: aprobados });
    if (!aprobados.length) return conGrupos({ ...report, promoted: false, staging_path: path.relative(root, stage) });

    fs.writeFileSync(path.join(stage, 'snapshot-manifest.json'), `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const promoted = promoteSnapshot({ root, stagePath: stage, finalPath: final, pointer, groups: aprobados, beforePointerUpdate: () => rewriteFinalAcquisition(root, final, snapshotDate, path.relative(stage, rawPath), sourceId) });
    if (quality.status === 'needs_review') {
      const { staging_path: _staging, ...sinStaging } = report;
      return conGrupos({ ...sinStaging, promoted: false, downloaded: true, snapshot_path: path.relative(root, final) });
    }
    return conGrupos({ ...report, status: 'promoted', promoted: true, active_after: promoted, downloaded: true, public_projection_validated: true });
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw new Error(`${error.message}${error.snapshot_id ? `; snapshot_id=${error.snapshot_id}` : ''}`);
  }
}

/**
 * Refresca la fuente y, si el candidato pasa los guardrails, promueve el
 * snapshot. Devuelve el resultado; lanza cuando no lo hay.
 *
 * @param {object} [options]
 * @param {string} [options.root]                     raíz del workspace
 * @param {string} [options.sourceId]                 fuente a refrescar
 * @param {boolean} [options.forceRefresh]            reproyectar aunque no cambien los validadores
 * @param {string|null} [options.publicRefreshStatePath] línea base para un runner limpio
 * @param {string|null} [options.referenceMinimizedRoot] Registro y GIS sanitizados
 * @param {string|null} [options.testSourceUrl]       origen local para sondas
 * @param {number} [options.probeTimeoutMs]
 * @param {string|null} [options.identityRoot]        expediente comercial alternativo
 */
export async function refreshSnapshot({
  root = rootFromModule,
  sourceId = REFRESH_DEFAULTS.sourceId,
  forceRefresh = false,
  publicRefreshStatePath = null,
  referenceMinimizedRoot = null,
  testSourceUrl = null,
  probeTimeoutMs = REFRESH_DEFAULTS.probeTimeoutMs,
  identityRoot = null,
  referenceSnapshot = REFRESH_DEFAULTS.referenceSnapshot,
} = {}) {
  const options = {
    root,
    sourceId,
    forceRefresh,
    publicRefreshStatePath,
    referenceMinimizedRoot: referenceMinimizedRoot ?? path.join(root, 'data', 'minimized', referenceSnapshot),
    refreshSourceUrl: testSourceUrl ?? CANONICAL_SOURCE_URLS.liquid_current,
    probeTimeoutMs,
    identityRoot,
    referenceSnapshot,
    userAgent: REFRESH_DEFAULTS.userAgent,
    maxRedirects: REFRESH_DEFAULTS.maxRedirects,
    downloadTimeoutMs: REFRESH_DEFAULTS.downloadTimeoutMs,
  };
  const releaseLock = acquireExclusiveLock(path.join(root, '.local-cache', 'snapshots', 'refresh.lock'));
  try {
    return await runRefresh(options);
  } finally {
    releaseLock();
  }
}
