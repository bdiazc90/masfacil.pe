#!/usr/bin/env node
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_TRACKED_BYTES = 256 * 1024;

// El único artefacto grande permitido es evidencia agregada, descrita en docs/datos.md.
export const LARGE_FILE_ALLOWLIST = Object.freeze(new Set(['evidence/feasibility-2026-08-14.json']));
export const FORBIDDEN_PATHS = Object.freeze([
  /^\.local-cache\//,
  /^data\//,
  /^web\/data\//,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)fetch-gis\.mjs$/,
  /(^|\/)gis-osinergmin\.json$/,
]);
export const REQUIRED_IGNORES = Object.freeze([
  ['.local-cache/audit-sentinel', '/.local-cache/'],
  ['data/minimized/audit-sentinel.csv.gz', '/data/'],
  ['data/derived/audit-sentinel.json', '/data/'],
  ['web/data/audit-sentinel.json', '/web/data/'],
  ['fetch-gis.mjs', '/fetch-gis.mjs'],
  ['gis-osinergmin.json', '/gis-osinergmin.json'],
]);

const CONTENT_RULES = Object.freeze([
  ['absolute_path', /(?:\/Users\/|\/home\/|\/private\/var\/|[A-Z]:\\Users\\)/],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['cloud_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['bearer_token', /authorization\s*[:=]\s*bearer\s+[A-Za-z0-9._-]+/i],
  ['assigned_secret', /(?:api[_-]?key|secret(?:[_-]?key)?|password)\s*[:=]\s*(?:['"][^'"\s]{8,}['"]|[A-Za-z0-9._-]{12,})/i],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['peruvian_ruc', /\b(?:10|20)\d{9}\b/],
]);

function git(root, args, encoding = 'utf8') {
  try {
    return execFileSync('git', args, { cwd: root, encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    throw new Error(`La auditoría no pudo ejecutar git ${args.join(' ')}: ${stderr || error.message}`, { cause: error });
  }
}

function assertTreeish(treeish) {
  if (typeof treeish !== 'string' || !treeish || treeish.startsWith('-')) {
    throw new Error(`Treeish inválido para auditoría: ${String(treeish)}`);
  }
}

function isText(file, bytes) {
  return !/\.(?:gz|zip|png|jpg|jpeg|webp|pdf)$/i.test(file) && !bytes.includes(0);
}

function pathFinding(file) {
  return FORBIDDEN_PATHS.find((pattern) => pattern.test(file));
}

function contentFindings(bytes) {
  const text = bytes.toString('utf8');
  return CONTENT_RULES.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

function readBlob(root, oid) {
  return git(root, ['cat-file', 'blob', oid], null);
}

/** Refs que pueden formar parte de una publicación normal; excluye refs privadas de herramientas locales. */
function publicationRefs(root) {
  return String(git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags', 'refs/remotes']))
    .split('\n')
    .filter((ref) => ref && !ref.endsWith('/HEAD'))
    .sort();
}

function publicationRevisions(root) {
  const refs = publicationRefs(root);
  if (!refs.length) throw new Error('La auditoría no encontró ramas, tags ni remotos publicables');
  return String(git(root, ['rev-list', ...refs])).split('\n').filter(Boolean);
}

/** Lista blobs exactamente como los ve el índice (:) o un treeish confirmado. */
export function listTreeEntries(root, treeish = ':') {
  if (treeish === ':') {
    return String(git(root, ['ls-files', '-s', '-z']))
      .split('\0')
      .filter(Boolean)
      .map((record) => {
        const match = /^(\d+) ([0-9a-f]+) (\d+)\t(.+)$/.exec(record);
        if (!match) throw new Error(`Entrada de índice inválida: ${record}`);
        return { mode: match[1], oid: match[2], stage: Number(match[3]), file: match[4] };
      })
      .filter((entry) => entry.stage === 0)
      .sort((a, b) => a.file.localeCompare(b.file));
  }

  assertTreeish(treeish);
  return String(git(root, ['ls-tree', '-r', '-z', '-l', treeish]))
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const match = /^(\d+) (\w+) ([0-9a-f]+)\s+(\d+|-)\t(.+)$/.exec(record);
      if (!match) throw new Error(`Entrada de árbol inválida: ${record}`);
      return { mode: match[1], type: match[2], oid: match[3], bytes: match[4] === '-' ? null : Number(match[4]), file: match[5] };
    })
    .filter((entry) => entry.type === 'blob')
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** Audita bytes de blobs Git; nunca lee el working tree. */
export function auditTreeEntries(root, entries, scope = 'candidate', revision) {
  const findings = [];
  for (const entry of entries) {
    const base = { scope, file: entry.file, ...(revision ? { revision: revision.slice(0, 12) } : {}) };
    if (pathFinding(entry.file)) findings.push({ ...base, kind: 'forbidden_path' });
    const bytes = readBlob(root, entry.oid);
    if (bytes.length > MAX_TRACKED_BYTES && !LARGE_FILE_ALLOWLIST.has(entry.file)) {
      findings.push({ ...base, kind: 'oversized_file', bytes: bytes.length });
    }
    if (isText(entry.file, bytes)) {
      for (const kind of contentFindings(bytes)) findings.push({ ...base, kind });
    }
  }
  return findings;
}

function verifyIgnores(root, entries) {
  const ignore = entries.find((entry) => entry.file === '.gitignore');
  const rules = ignore ? new Set(readBlob(root, ignore.oid).toString('utf8').split(/\r?\n/).map((line) => line.trim())) : new Set();
  return REQUIRED_IGNORES
    .filter(([, rule]) => !rules.has(rule))
    .map(([file]) => ({ scope: 'candidate', kind: 'missing_ignore', file }));
}

export function auditHistoryPaths(root) {
  const refs = publicationRefs(root);
  const revisions = publicationRevisions(root);
  const paths = new Set();
  for (const revision of revisions) {
    for (const entry of listTreeEntries(root, revision)) if (pathFinding(entry.file)) paths.add(entry.file);
  }
  return [...paths].sort().map((file) => ({
    scope: 'history_path',
    kind: 'forbidden_path',
    file,
    introduced_by: String(git(root, ['log', ...refs, '--diff-filter=A', '--format=%H', '--', file]))
      .split('\n').filter(Boolean).at(-1)?.slice(0, 12) ?? 'desconocido',
  }));
}

/** Aplica las mismas regex JavaScript a blobs históricos, sin git grep. */
export function auditHistoryContent(root) {
  const revisions = publicationRevisions(root);
  const findings = [];
  const seenBlobs = new Set();
  for (const revision of revisions) {
    for (const entry of listTreeEntries(root, revision)) {
      if (seenBlobs.has(entry.oid)) continue;
      seenBlobs.add(entry.oid);
      findings.push(...auditTreeEntries(root, [entry], 'history_content', revision)
        .filter((item) => item.kind !== 'forbidden_path' && item.kind !== 'oversized_file'));
    }
  }
  return { revisions: revisions.length, blobs: seenBlobs.size, findings };
}

export function auditPublication(root = rootFromModule, { treeish = ':' } = {}) {
  const entries = listTreeEntries(root, treeish);
  const candidate = {
    treeish,
    tracked_files: entries.length,
    findings: [...auditTreeEntries(root, entries), ...verifyIgnores(root, entries)],
  };
  const content = auditHistoryContent(root);
  return {
    checked_at: new Date().toISOString(),
    candidate,
    history: {
      path_findings: auditHistoryPaths(root),
      content_findings: content.findings,
      revisions_checked: content.revisions,
      distinct_blobs_checked: content.blobs,
    },
  };
}

function parseArgs(args) {
  let strictHistory = false;
  let treeish = ':';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--strict-history') strictHistory = true;
    else if (args[index] === '--treeish') {
      treeish = args[index + 1];
      index += 1;
    } else throw new Error(`Argumento no reconocido: ${args[index]}`);
  }
  return { strictHistory, treeish };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { strictHistory, treeish } = parseArgs(process.argv.slice(2));
  const result = auditPublication(rootFromModule, { treeish });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const historyFindings = result.history.path_findings.length + result.history.content_findings.length;
  if (result.candidate.findings.length || (strictHistory && historyFindings)) process.exitCode = 1;
}
