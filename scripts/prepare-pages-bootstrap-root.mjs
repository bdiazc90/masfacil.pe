#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceWeb = path.join(root, 'web');
const sourceData = path.join(sourceWeb, 'data');
const destination = path.join(root, '.local-cache', 'gate-4.3', 'pages-bootstrap-web');

const verified = spawnSync(process.execPath, ['scripts/verify-first-pages-bootstrap.mjs'], { cwd: root, encoding: 'utf8' });
if (verified.status !== 0) throw new Error(verified.stderr || verified.stdout || 'Bootstrap local inválido');
const listed = spawnSync('git', ['ls-files', '-z', '--', 'web'], { cwd: root, encoding: 'utf8' });
if (listed.status !== 0) throw new Error(listed.stderr || 'No se pudo resolver el árbol público trackeado');
const tracked = listed.stdout.split('\0').filter(Boolean);
if (!tracked.length) throw new Error('Git no declaró archivos públicos bajo web/');

const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
try {
  for (const relative of tracked) {
    const source = path.join(root, relative);
    const target = path.join(temporary, path.relative('web', relative));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target);
  }
  fs.cpSync(sourceData, path.join(temporary, 'data'), { recursive: true });
  const candidate = spawnSync(process.execPath, ['scripts/verify-first-pages-bootstrap.mjs', '--web-root', path.relative(root, temporary)], { cwd: root, encoding: 'utf8' });
  if (candidate.status !== 0) throw new Error(candidate.stderr || candidate.stdout || 'Raíz sellada de Pages inválida');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(temporary, destination);
} catch (error) {
  fs.rmSync(temporary, { recursive: true, force: true });
  throw error;
}

process.stdout.write(`${JSON.stringify({ ready: true, deploy_root: path.relative(root, destination), tracked_shell_files: tracked.length, generated_data_included: true })}\n`);
