import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditPublication, LARGE_FILE_ALLOWLIST } from '../scripts/audit-publication.mjs';

const ignoreRules = ['/.local-cache/', '/data/', '/web/data/', '/fetch-gis.mjs', '/gis-osinergmin.json'].join('\n');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root, file, content) {
  const destination = path.join(root, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
}

function commit(root, message) {
  git(root, ['add', '--all']);
  git(root, ['commit', '-q', '-m', message]);
}

function repository(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-4.2-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Audit fixture']);
  git(root, ['config', 'user.email', ['audit-fixture', '@', 'example.invalid'].join('')]);
  write(root, '.gitignore', ignoreRules);
  for (const [file, content] of Object.entries(files)) write(root, file, content);
  commit(root, 'base seguro');
  return root;
}

function seededSensitiveContent() {
  return [
    ['/', 'Users', '/', 'audit', '/', 'private'].join(''),
    ['AK', 'IA', '1234567890ABCDEF'].join(''),
    ['Author', 'ization: Bear', 'er token-for-history'].join(''),
    ['api', '_key=supersecretvalue'].join(''),
    ['audit', '@', 'example.test'].join(''),
    ['20', '123456789'].join(''),
  ].join('\n');
}

test('la auditoría usa blobs del índice, conserva la allowlist y detecta contenido histórico retirado', (t) => {
  const root = repository(t, { 'README.md': '# Proyecto\n', 'evidence/feasibility-2026-08-14.json': 'x'.repeat(300 * 1024) });
  const result = auditPublication(root);
  assert.deepEqual(result.candidate.findings, []);
  assert.equal(result.candidate.treeish, ':');
  assert.ok(LARGE_FILE_ALLOWLIST.has('evidence/feasibility-2026-08-14.json'));
  const committed = auditPublication(root, { treeish: 'HEAD' });
  assert.equal(committed.candidate.treeish, 'HEAD');
  assert.deepEqual(committed.candidate.findings, []);

  const historicRoot = repository(t, { 'historial.txt': seededSensitiveContent() });
  write(historicRoot, 'data/minimized/retired.csv', 'derivado prohibido');
  git(historicRoot, ['add', '-f', 'data/minimized/retired.csv']);
  git(historicRoot, ['commit', '-q', '-m', 'agrega derivado prohibido']);
  write(historicRoot, 'historial.txt', 'contenido ya retirado');
  fs.rmSync(path.join(historicRoot, 'data/minimized/retired.csv'));
  commit(historicRoot, 'retira contenido sensible');

  const historic = auditPublication(historicRoot);
  assert.deepEqual(historic.candidate.findings, []);
  assert.deepEqual(historic.history.path_findings.map((item) => item.file), ['data/minimized/retired.csv']);
  assert.deepEqual(new Set(historic.history.content_findings.map((item) => item.kind)), new Set([
    'absolute_path', 'cloud_key', 'bearer_token', 'assigned_secret', 'email', 'peruvian_ruc',
  ]));
  assert.ok(historic.history.content_findings.every((item) => item.scope === 'history_content'));
});

test('la auditoría examina el candidato staged y aborta ante un error real de Git', (t) => {
  const root = repository(t, { 'candidate.txt': 'seguro\n' });
  write(root, 'candidate.txt', seededSensitiveContent());
  git(root, ['add', 'candidate.txt']);
  write(root, 'candidate.txt', 'working tree limpio pero no staged\n');

  const stagedSensitive = auditPublication(root);
  assert.ok(stagedSensitive.candidate.findings.some((item) => item.kind === 'cloud_key'));

  git(root, ['add', 'candidate.txt']);
  write(root, 'candidate.txt', seededSensitiveContent());
  const stagedClean = auditPublication(root);
  assert.deepEqual(stagedClean.candidate.findings, []);
  assert.throws(
    () => auditPublication(root, { treeish: 'treeish-que-no-existe' }),
    /La auditoría no pudo ejecutar git ls-tree/,
  );

  const privateRoot = repository(t, { 'README.md': 'público y seguro\n' });
  const publicHead = git(privateRoot, ['rev-parse', 'HEAD']).trim();
  write(privateRoot, 'solo-ref-privada.txt', seededSensitiveContent());
  git(privateRoot, ['add', 'solo-ref-privada.txt']);
  const privateTree = git(privateRoot, ['write-tree']).trim();
  const privateCommit = git(privateRoot, ['commit-tree', privateTree, '-p', publicHead, '-m', 'estado privado de herramienta']).trim();
  git(privateRoot, ['update-ref', 'refs/codex/prueba', privateCommit]);
  git(privateRoot, ['reset', '--hard', publicHead]);
  const publicOnly = auditPublication(privateRoot);
  assert.deepEqual(publicOnly.candidate.findings, []);
  assert.deepEqual(publicOnly.history.content_findings, []);
  assert.equal(publicOnly.history.revisions_checked, 1);
});
