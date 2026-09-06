#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicationDecision } from '../app/publication-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = process.env.REFRESH_RESULT ? path.resolve(process.env.REFRESH_RESULT) : path.join(root, '.local-cache', 'publish', 'refresh-result.json');
const shellChanged = process.env.SHELL_CHANGED === '1';
const forceProject = process.env.FORCE_PROJECT === '1';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) return { status: null, stdout: '', stderr: result.error.message };
  return result;
}

const trimmed = (value) => String(value ?? '').trim();
const firstJson = (text) => {
  for (const line of trimmed(text).split('\n').reverse()) {
    try { const parsed = JSON.parse(line); if (parsed && typeof parsed.status === 'string') return parsed; } catch { /* la línea no era el resultado */ }
  }
  try { const parsed = JSON.parse(trimmed(text)); if (parsed && typeof parsed.status === 'string') return parsed; } catch { /* tampoco el bloque completo */ }
  return null;
};

// El refresco comunica su rechazo por stderr en una línea JSON. Antes se leía
// solo stdout y un rechazo se convertía en una excepción de parseo que tapaba
// la causa original y dejaba sin escribir refresh-result.json. Ahora cualquier
// salida produce un resultado estructurado y el motivo real se conserva.
function parseRefresh(result) {
  const parsed = firstJson(result.stdout) ?? firstJson(result.stderr);
  if (parsed) return parsed;
  return {
    status: 'rejected',
    error: trimmed(result.stderr) || trimmed(result.stdout) || `el refresco terminó con código ${result.status}`,
    exit_code: result.status,
    parsed: false,
  };
}

function decide(refresh) {
  try { return publicationDecision(refresh, { shellChanged, forceProject }); }
  catch (error) {
    return { action: 'fail_closed', download_data: false, project: false, verify: false, deploy: false, reason: `resultado de refresco no interpretable: ${error.message}` };
  }
}

function writeResult(payload) {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resultPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
}

const refreshed = run(process.execPath, ['scripts/refresh.mjs']);
const refresh = parseRefresh(refreshed);
const decision = decide(refresh);
const execution = { stage: 'refresh', ok: decision.action !== 'fail_closed', error: null };

if (decision.action === 'fail_closed') {
  writeResult({ refresh, decision, execution });
  process.stdout.write(`${JSON.stringify({ status: refresh.status, decision, error: refresh.error ?? null })}\n`);
  process.exitCode = 1;
} else {
  for (const [stage, enabled, command, args] of [['project', decision.project, 'npm', ['run', 'project']], ['verify', decision.verify, 'npm', ['run', 'verify:web']]]) {
    if (!enabled || !execution.ok) continue;
    const step = run(command, args);
    if (step.status !== 0) { execution.stage = stage; execution.ok = false; execution.error = trimmed(step.stderr) || trimmed(step.stdout) || `${stage} terminó con código ${step.status}`; }
  }
  // El log tiene que decir lo mismo que el archivo: imprimir la decisión original
  // mientras se escribe la degradada hacía creer que se iba a desplegar algo que
  // ya estaba descartado.
  const applied = execution.ok ? decision : { ...decision, deploy: false, action: 'fail_closed', reason: `${execution.stage} falló tras un refresco ${refresh.status}` };
  writeResult({ refresh, decision: applied, execution });
  process.stdout.write(`${JSON.stringify({ status: refresh.status, decision: applied, execution })}\n`);
  if (!execution.ok) process.exitCode = 1;
}
