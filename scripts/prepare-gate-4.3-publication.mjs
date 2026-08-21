#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicationDecision } from '../app/gate-4.3-publication-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = process.env.GATE_4_3_REFRESH_RESULT ? path.resolve(process.env.GATE_4_3_REFRESH_RESULT) : path.join(root, '.local-cache', 'gate-4.3', 'refresh-result.json');
const shellChanged = process.env.GATE_4_3_SHELL_CHANGED === '1';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function parseResult(result) {
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`El refresco no produjo JSON verificable: ${result.stderr || result.stdout}`); }
}

const refreshed = run(process.execPath, ['scripts/refresh-gate-3.3.mjs']);
const refresh = parseResult(refreshed);
const decision = publicationDecision(refresh, { shellChanged });

fs.mkdirSync(path.dirname(resultPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(resultPath, `${JSON.stringify({ refresh, decision })}\n`, { mode: 0o600 });

if (decision.action === 'fail_closed') {
  process.stdout.write(`${JSON.stringify({ status: refresh.status, decision })}\n`);
  process.exitCode = 1;
} else {
  if (decision.project) {
    const projected = run('npm', ['run', 'project:gasolina']);
    if (projected.status !== 0) throw new Error(`Proyección falló: ${projected.stderr || projected.stdout}`);
  }
  if (decision.verify) {
    const verified = run('npm', ['run', 'verify:web']);
    if (verified.status !== 0) throw new Error(`Verificación web falló: ${verified.stderr || verified.stdout}`);
  }
  process.stdout.write(`${JSON.stringify({ status: refresh.status, decision })}\n`);
}
