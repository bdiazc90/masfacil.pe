/**
 * Refresco de las fuentes como FUNCIÓN, no como proceso.
 *
 * Antes esto vivía en `scripts/refresh.mjs` leyendo env y argv en el nivel
 * superior, así que la única forma de usarlo era lanzarlo y rebuscar una línea
 * JSON en su stdout —o en su stderr, cuando rechazaba—. Aquí las mismas
 * entradas son opciones con los mismos valores por defecto y el resultado se
 * devuelve.
 *
 * Cada fuente (`sources.mjs`) se refresca por su cuenta: su línea base, su
 * descarga, sus grupos y sus pointers. El fallo de una queda en su resultado
 * con estado `rejected` y no impide refrescar la otra.
 *
 * El lock exclusivo sigue dentro y cubre todas las fuentes: dos refrescos
 * simultáneos siguen sin poder pisarse aunque ahora se invoquen en proceso.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeSnapshotValidators } from '../app/http-validator-probe.mjs';
import { makeSnapshotPointer, promoteSnapshot, validateDownloadMetadata } from '../app/snapshot-refresh.mjs';
import { readActivePointer, readSourcePointer } from '../app/snapshot-manifest.mjs';
import { nativeFetch } from '../app/native-http.mjs';
import { canUseCurlFallback } from '../app/refresh-policy.mjs';
import { findMatchingRaw } from '../app/raw-reuse.mjs';
import { acquireExclusiveLock } from '../app/exclusive-lock.mjs';
import { validateGasolinaRefreshState } from './gasolina-contract.mjs';
import { buildGroupCandidate, buildPrivateCandidate, loadCommercialPublicationInputs, temporalContextForPointer } from './project-gasolina.mjs';
import { buildSourceProducts, loadSourceTables } from './gasolina-products.mjs';
import { configuredGroup, groupsOfSource, productGroup } from './groups.mjs';
import { compareGroupQuality, snapshotIdFromGasolinaRevision } from './refresh-state.mjs';
import { GIS_FIELDS, REGISTRY_FIELDS, readTable } from './csv.mjs';
import { readFacilitoState } from './facilito/state.mjs';
import { SOURCE_ORDER, sourceById, sourceOfPointer } from './sources.mjs';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REFRESH_DEFAULTS = Object.freeze({
  // Sin fuente declarada se refrescan todas, en el orden de `SOURCE_ORDER`. El
  // tiempo máximo de descarga es de cada fuente.
  sourceId: null,
  referenceSnapshot: '2026-08-14',
  userAgent: 'Mozilla/5.0 (compatible; masfacil.pe/4.3; public-data-research)',
  maxRedirects: 3,
  probeTimeoutMs: 10_000,
});

// Gasolina es el ancla de los líquidos: sin su línea base la fuente no se
// refresca, y un error de su contrato la rechaza entera, como siempre.
const ANCLA = 'gasolina';

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

/**
 * La línea base de un grupo que todavía no publica: la validación que dejó en
 * su snapshot activo el último refresco que lo aprobó. Vive en la caché
 * privada; sin ella el grupo se juzga contra su base auditada o, si no la
 * tiene, queda pendiente de revisión.
 */
function privateBaseline({ root, group }) {
  const vacia = { previousProducts: null, previousSourceMaxReportedAt: null, validators: null, snapshot_id: null };
  const pointer = readActivePointer(root, { group: group.key });
  if (!pointer) return vacia;
  if (sourceOfPointer(pointer) !== group.config.source) throw new Error(`El pointer de ${group.key} es de ${sourceOfPointer(pointer)}, no de ${group.config.source}`);
  const file = path.join(root, '.local-cache', 'snapshots', pointer.snapshot_id, `${group.key}-validation.json`);
  if (!fs.existsSync(file)) return vacia;
  const validation = readJson(file);
  if (validation.snapshot_id !== pointer.snapshot_id || !validation.refresh_state?.products) return vacia;
  return { previousProducts: validation.refresh_state.products, previousSourceMaxReportedAt: validation.refresh_state.source_max_reported_at, validators: pointer.validators, snapshot_id: pointer.snapshot_id };
}

/**
 * La referencia de Registro y GIS tiene que traer los códigos y las capas de
 * todos los grupos de la fuente. Con una semilla sin gasocentros GLP no
 * fallaría: simplemente perdería filas en silencio. Por eso se exige antes de
 * descargar nada.
 */
export async function assertReferenceCovers(referenceMinimizedRoot, groups) {
  const tabla = async (relative, fields) => {
    const file = path.join(referenceMinimizedRoot, relative);
    if (!fs.existsSync(file)) throw new Error(`Falta input sanitizado de bootstrap: ${relative}`);
    return readTable(file, fields);
  };
  const codigos = new Set((await tabla('registry/authorizations.csv.gz', REGISTRY_FIELDS)).map((fila) => fila.SOURCE_ACTIVITY));
  const capas = new Set((await tabla('gis/features.csv.gz', GIS_FIELDS)).map((fila) => fila.LAYER));
  const faltan = new Set();
  for (const grupo of groups) {
    for (const codigo of new Set(Object.values(grupo.config.activities))) {
      if (!codigos.has(codigo)) faltan.add(`${grupo.key}: Registro ${codigo}`);
      const capa = grupo.config.gisLayers?.[codigo] ?? '35';
      if (!capas.has(capa)) faltan.add(`${grupo.key}: capa GIS ${capa}`);
    }
  }
  if (faltan.size) throw new Error(`La referencia de Registro y GIS no cubre la fuente: ${[...faltan].join('; ')}`);
}

/** Los validadores que respondió el origen en la sonda, si respondió alguno. */
const validadoresRemotos = (detection) => [...(detection.attempts ?? [])].reverse().find((attempt) => attempt.response_validators?.etag || attempt.response_validators?.last_modified)?.response_validators ?? null;

/**
 * Refresca UNA fuente: sondea contra su propia línea base, adquiere, minimiza,
 * juzga cada grupo suyo contra la suya y promueve la carpeta si la aprueba al
 * menos uno. Nunca lee ni mueve nada de otra fuente.
 */
async function runRefresh(options, source, url) {
  const {
    root, forceRefresh, publicRefreshStatePath, referenceMinimizedRoot,
    probeTimeoutMs, userAgent, maxRedirects, referenceSnapshot, identityRoot,
  } = options;
  const sourceId = source.id;
  const grupos = groupsOfSource(sourceId);
  if (!grupos.length) throw new Error(`La fuente ${sourceId} no alimenta ningún grupo`);
  const baseline = grupos.some((grupo) => grupo.key === ANCLA) ? refreshBaseline({ root, publicRefreshStatePath }) : null;
  const active = baseline?.active ?? null;
  const otros = Object.fromEntries(grupos.filter((grupo) => grupo.key !== ANCLA).map((grupo) => [grupo.key, grupo.private
    ? privateBaseline({ root, group: grupo })
    : groupBaseline({ root, group: grupo, ci: Boolean(publicRefreshStatePath) })]));
  // Se compara contra el CSV más nuevo que algún grupo de la fuente ya aprobó.
  // Si Gasolina rechazó un archivo que Diésel sí publicó, volver a bajarlo en
  // cada corrida solo repetiría el mismo rechazo: Gasolina espera al próximo
  // CSV. Una fuente sin ancla ni grupo con base usa el último snapshot que
  // aprobó; sin ninguno no hay con qué comparar.
  const masNuevo = Object.values(otros).filter((base) => base.validators && base.snapshot_id > (active?.snapshot_id ?? '')).sort((a, b) => (a.snapshot_id < b.snapshot_id ? 1 : -1))[0];
  const deLaFuente = baseline || masNuevo ? null : readSourcePointer(root, sourceId);
  const local = masNuevo?.validators ?? baseline?.localValidators ?? deLaFuente?.validators ?? null;
  const activeSnapshot = active?.snapshot_id ?? masNuevo?.snapshot_id ?? deLaFuente?.snapshot_id ?? null;
  let detection = await probeSnapshotValidators({ url, local, timeoutMs: probeTimeoutMs });
  if (detection.status === 'unverifiable' && detection.reason && canUseCurlFallback(detection.attempts)) {
    detection = await probeSnapshotValidators({
      url,
      local,
      timeoutMs: probeTimeoutMs,
      fetchImpl: (target, init) => curlHeadFetch(target, init, { probeTimeoutMs, userAgent, maxRedirects }),
    });
    detection.transport_fallback = 'curl HEAD por fallo del cliente HTTPS nativo';
  }
  // Sin base la sonda no puede decir «sin cambios»: si el origen respondió con
  // sus validadores, se adquiere.
  if (!local && detection.status === 'unverifiable' && validadoresRemotos(detection)) detection = { ...detection, status: 'changed', baseline: 'sin_base' };
  // Un runner limpio no conserva snapshots entre corridas: si el origen no
  // cambió, no descarga y no queda nada que proyectar. Por eso una reproyección
  // forzada —cambio de contrato o de catálogo, no de datos— tiene que pagar la
  // descarga completa igual. Es caro y por eso es manual.
  if (detection.status === 'unchanged' && !forceRefresh) return { status: 'unchanged', active_snapshot: activeSnapshot, detection, downloaded: false, promoted: false };
  if (detection.status === 'unverifiable') return { status: 'unverifiable', active_snapshot: activeSnapshot, detection, downloaded: false, promoted: false };
  await assertReferenceCovers(referenceMinimizedRoot, grupos);

  const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const stage = path.join(root, '.local-cache', 'snapshots', 'staging', runId);
  const rawPath = path.join(stage, ...source.rawRelative.split('/'));
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  try {
    const remoteValidators = validadoresRemotos(detection) ?? { etag: null, last_modified: null };
    const reusable = await findMatchingRaw({ root, snapshotsRoot: path.join(root, '.local-cache', 'snapshots'), sourceId, validators: remoteValidators });
    let downloaded;
    if (reusable) {
      fs.mkdirSync(path.dirname(rawPath), { recursive: true, mode: 0o700 });
      fs.symlinkSync(reusable.path, rawPath);
      downloaded = { requested_at: reusable.record.requested_at, completed_at: reusable.record.completed_at, final_url: reusable.record.final_url ?? url, response_status: reusable.record.response_status, response_headers: { ...reusable.record.response_headers, 'content-length': String(reusable.record.bytes), etag: remoteValidators.etag, 'last-modified': remoteValidators.last_modified }, response_chain: reusable.record.response_chain ?? [], bytes: Number(reusable.record.bytes), sha256: reusable.record.sha256, reused_local_raw: true };
    } else downloaded = await fetchFull(url, rawPath, { userAgent, maxRedirects, downloadTimeoutMs: source.downloadTimeoutMs });
    const snapshotDate = new Date(downloaded.response_headers['last-modified'] ?? downloaded.completed_at).toISOString().slice(0, 10);
    writeRecord(stage, { ...downloaded, snapshot_date: snapshotDate, source_id: sourceId, final_url: downloaded.final_url }, path.relative(root, rawPath), { sourceId, refreshSourceUrl: url, userAgent });
    // El guion vive junto a este módulo; el snapshot puede estar en otra raíz
    // (una sonda aislada, por ejemplo). Por eso el ejecutable se resuelve contra
    // el repositorio y sus entradas viajan como rutas absolutas.
    const minimized = spawnSync(process.execPath, [path.join(rootFromModule, 'scripts', 'minimize.mjs')], { cwd: rootFromModule, env: { ...process.env, RAW_INPUT: rawPath, MINIMIZED_OUTPUT: path.join(stage, 'minimized'), SOURCE_ID: sourceId }, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (minimized.status !== 0) throw new Error(`minimización rechazada: ${minimized.stderr || minimized.stdout}`);
    const minimizedLineage = JSON.parse(minimized.stdout);
    minimizedLineage.minimized_path = `minimized/${source.minimizedRelative}`;
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
    // el pointer. Todos los productos de la fuente comparten estas tablas.
    const minimizedRoot = path.join(stage, 'minimized');
    const tablas = await loadSourceTables({ source, minimizedRoot });
    const temporalContext = {
      cutoff_at: new Date(downloaded.completed_at).toISOString(),
      source_max_reported_at: tablas.sourceMaxReportedAt,
      snapshot_date: snapshotDate,
    };
    const snapshotId = `${snapshotDate}-${runId}`;
    const final = path.join(root, '.local-cache', 'snapshots', snapshotId);
    const lineage = { raw: { sha256: downloaded.sha256, bytes: downloaded.bytes }, minimized: minimizedLineage };
    const pointer = makeSnapshotPointer({
      root,
      sourceId,
      snapshotId,
      snapshotDate,
      acquisitionPath: path.join(final, 'provenance', snapshotDate, 'acquisitions.jsonl'),
      sourceUrl: url,
      validators: { etag: downloaded.response_headers.etag ?? null, last_modified: downloaded.response_headers['last-modified'] ?? null },
      promotedAt: new Date().toISOString(),
      temporalContext,
      referenceInputs: { registry_gis_snapshot_date: referenceSnapshot, note: 'Registro y GIS no se refrescan en este ciclo' },
      lineage: { ...lineage, paths: { raw_path: path.relative(root, path.join(final, path.relative(stage, rawPath))), minimized_path: path.relative(root, path.join(final, 'minimized', ...source.minimizedRelative.split('/'))) } },
    });
    // UNA pasada por el original para todos los grupos de la fuente; cada uno se
    // juzga con su línea base y sus tolerancias. Un error de contrato del ancla
    // sigue rechazando la fuente entera, como siempre; el de otro grupo solo lo
    // deja a él pendiente de revisión.
    const { resultsByGroup } = await buildSourceProducts({
      source, sources: tablas, minimizedRoot, rawPath, cutoffAt: temporalContext.cutoff_at, snapshotId: pointer.snapshot_id, sourceMaxReportedAt: temporalContext.source_max_reported_at, sourceUrl: pointer.source_url,
      groups: grupos.map(productGroup),
    });
    const comerciales = grupos.some((grupo) => !grupo.private) ? loadCommercialPublicationInputs(root, { identityRoot }) : {};
    const facilito = grupos.some((grupo) => grupo.private) ? readFacilitoState(root) : null;
    const juicios = {};
    for (const grupo of grupos) {
      const base = grupo.key === ANCLA ? baseline : otros[grupo.key];
      let projection;
      try {
        projection = grupo.private
          ? buildPrivateCandidate({ group: grupo, pointer, temporalContext, results: resultsByGroup[grupo.key], facilitoState: facilito })
          : buildGroupCandidate({ group: grupo, pointer, temporalContext, results: resultsByGroup[grupo.key], ...comerciales });
      } catch (error) {
        if (grupo.key === ANCLA) throw error;
        juicios[grupo.key] = { projection: null, quality: { status: 'needs_review', reasons: [`${grupo.key}: ${error.message}`] } };
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
      // Sin estado previo ni base auditada no hay contra qué juzgar: el grupo no
      // se promueve a ciegas.
      if (grupo.key !== ANCLA && !base.previousProducts && !grupo.config.guardrails.firstActivation) {
        quality.status = 'needs_review';
        quality.reasons = [...quality.reasons, `${grupo.key}: sin línea base ni base auditada contra la que juzgarlo`];
      }
      juicios[grupo.key] = { projection, quality };
    }
    for (const [key, { projection: candidata, quality: calidad }] of Object.entries(juicios)) {
      if (!candidata) continue;
      // Un grupo privado deja solo conteos: su estado, su embudo y sus
      // exclusiones. Es la línea base de su próximo refresco.
      const validation = candidata.private ? {
        schema_version: 1,
        group: key,
        private: true,
        snapshot_id: pointer.snapshot_id,
        refresh_state: candidata.refreshState,
        funnel: candidata.funnel,
        row_exclusions: candidata.rowExclusions,
        quality: calidad,
      } : {
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
    const ofertas = (candidata, producto) => (candidata.private ? candidata.results[producto].metrics.published.offers : candidata.datasets[producto].offers.length);
    const resumenGrupos = Object.fromEntries(Object.entries(juicios).map(([key, { projection: candidata, quality: calidad }]) => [key, { status: calidad.status, reasons: calidad.reasons, first_activation: calidad.first_activation === true, revision_id: candidata?.manifest?.revision_id ?? null, ...(candidata?.private ? { private: true } : {}), products: candidata ? Object.fromEntries(Object.keys(candidata.private ? candidata.results : candidata.datasets).map((producto) => [producto, { offers: ofertas(candidata, producto), districts: candidata.results[producto].metrics.contract_ready.districts }])) : null }]));
    // La carpeta se promueve si la aprueba al menos un grupo, y solo se mueven
    // los pointers de los que la aprobaron: Gasolina conserva el suyo si
    // rechaza un CSV que Diésel sí acepta, y al revés.
    const aprobados = grupos.map((grupo) => grupo.key).filter((key) => juicios[key].quality.status === 'ready');
    // Con ancla, la fuente dice lo que dice Gasolina; sin ella, lo que diga
    // cualquiera de sus grupos.
    const ancla = juicios[ANCLA] ?? null;
    const estado = ancla ? ancla.quality.status : (aprobados.length ? 'ready' : 'needs_review');
    const referencia = { registry_gis_snapshot_date: referenceSnapshot, note: 'Registro y GIS no se refrescan en este ciclo' };
    const report = ancla
      ? { schema_version: 2, status: estado, detection, active_before: active, download: downloaded, lineage, temporal_context: temporalContext, identity: ancla.projection.identity, commercial_identity: ancla.projection.catalog, reference_inputs: referencia, quality: ancla.quality, staging_path: path.relative(root, stage), gasolina: { revision_id: ancla.projection.manifest.revision_id, products: Object.fromEntries(Object.entries(ancla.projection.datasets).map(([key, value]) => [key, { offers: value.offers.length, districts: ancla.projection.results[key].metrics.contract_ready.districts }])) }, groups: resumenGrupos }
      : { schema_version: 2, source_id: sourceId, status: estado, detection, active_before: activeSnapshot, download: downloaded, lineage, temporal_context: temporalContext, reference_inputs: referencia, staging_path: path.relative(root, stage), groups: resumenGrupos };
    fs.writeFileSync(path.join(stage, 'refresh-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const conGrupos = (resultado) => ({ ...resultado, groups: Object.fromEntries(Object.entries(resumenGrupos).map(([key, value]) => [key, { ...value, status: aprobados.includes(key) ? 'promoted' : 'needs_review' }])), promoted_groups: aprobados });
    if (!aprobados.length) return conGrupos({ ...report, promoted: false, staging_path: path.relative(root, stage) });

    fs.writeFileSync(path.join(stage, 'snapshot-manifest.json'), `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    const promoted = promoteSnapshot({ root, stagePath: stage, finalPath: final, pointer, groups: aprobados, beforePointerUpdate: () => rewriteFinalAcquisition(root, final, snapshotDate, path.relative(stage, rawPath), sourceId) });
    if (estado === 'needs_review') {
      const { staging_path: _staging, ...sinStaging } = report;
      return conGrupos({ ...sinStaging, promoted: false, downloaded: true, snapshot_path: path.relative(root, final) });
    }
    return conGrupos({ ...report, status: 'promoted', promoted: true, active_after: promoted, downloaded: true, public_projection_validated: aprobados.some((key) => !configuredGroup(key).private) });
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw new Error(`${error.message}${error.snapshot_id ? `; snapshot_id=${error.snapshot_id}` : ''}`);
  }
}

/**
 * Las fuentes de esta corrida con su URL. Una URL de prueba nunca deja que otra
 * fuente toque la red real: suelta es la de la fuente pedida —o la de los
 * líquidos—, y una fuente sin URL de prueba no se refresca.
 */
function fuentesDeLaCorrida({ sourceId, testSourceUrl }) {
  const ids = sourceId ? [sourceById(sourceId).id] : [...SOURCE_ORDER];
  if (!testSourceUrl) return ids.map((id) => ({ source: sourceById(id), url: sourceById(id).url }));
  const urls = typeof testSourceUrl === 'string' ? { [sourceId ?? 'liquid-current']: testSourceUrl } : testSourceUrl;
  const fuentes = ids.filter((id) => urls[id]).map((id) => ({ source: sourceById(id), url: urls[id] }));
  if (!fuentes.length) throw new Error('Ninguna fuente de esta corrida tiene URL de prueba');
  return fuentes;
}

/**
 * Refresca cada fuente y, si su candidato pasa los guardrails, promueve su
 * snapshot. Los campos de siempre hablan de los líquidos; `sources` trae el
 * resultado de cada fuente. Solo lanza si no puede tomar el lock.
 *
 * @param {object} [options]
 * @param {string} [options.root]                     raíz del workspace
 * @param {string|null} [options.sourceId]            una sola fuente; `null` las refresca todas
 * @param {boolean} [options.forceRefresh]            reproyectar aunque no cambien los validadores
 * @param {string|null} [options.publicRefreshStatePath] línea base para un runner limpio
 * @param {string|null} [options.referenceMinimizedRoot] Registro y GIS sanitizados
 * @param {string|Record<string, string>|null} [options.testSourceUrl] origen local para sondas, o uno por fuente
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
    forceRefresh,
    publicRefreshStatePath,
    referenceMinimizedRoot: referenceMinimizedRoot ?? path.join(root, 'data', 'minimized', referenceSnapshot),
    probeTimeoutMs,
    identityRoot,
    referenceSnapshot,
    userAgent: REFRESH_DEFAULTS.userAgent,
    maxRedirects: REFRESH_DEFAULTS.maxRedirects,
  };
  const fuentes = fuentesDeLaCorrida({ sourceId, testSourceUrl });
  const releaseLock = acquireExclusiveLock(path.join(root, '.local-cache', 'snapshots', 'refresh.lock'));
  try {
    // Una fuente caída no detiene a las demás: su fallo queda en su resultado.
    const sources = {};
    for (const { source, url } of fuentes) {
      try { sources[source.id] = { source_id: source.id, ...(await runRefresh(options, source, url)) }; }
      catch (error) { sources[source.id] = { source_id: source.id, status: 'rejected', error: error.message }; }
    }
    return { ...(sources['liquid-current'] ?? sources[fuentes[0].source.id]), sources };
  } finally {
    releaseLock();
  }
}
