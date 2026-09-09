#!/usr/bin/env node

// Traduce el evento de CI a una ruta de publicación. Calcula TODOS los commits
// del push, no solo el último: una interfaz cambiada en un commit y una línea de
// documentación en el siguiente ya no se publicaba, porque la comparación era
// `HEAD^..HEAD` y solo veía el final del rango.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRoute } from '../app/route-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const flag = (value) => value === '1' || value === 'true';

const eventName = process.env.EVENT_NAME ?? '';
const before = (process.env.RANGE_BEFORE ?? '').trim();
const after = (process.env.RANGE_AFTER ?? 'HEAD').trim();

// El rango solo vale si el punto de partida existe, es un commit y es ancestro
// del final. Un force-push, un primer push o un historial recortado no dan un
// rango parcial silencioso: dan `previousCommitValid: false`.
function rangoDelPush() {
  if (eventName !== 'push') return { changedPaths: [], previousCommitValid: true };
  if (!before || /^0+$/.test(before)) return { changedPaths: [], previousCommitValid: false };
  if (git('rev-parse', '--verify', '--quiet', `${before}^{commit}`).status !== 0) return { changedPaths: [], previousCommitValid: false };
  if (git('merge-base', '--is-ancestor', before, after).status !== 0) return { changedPaths: [], previousCommitValid: false };
  const diff = git('diff', '--name-only', '-z', `${before}..${after}`);
  if (diff.status !== 0) return { changedPaths: [], previousCommitValid: false };
  return { changedPaths: diff.stdout.split('\0').filter(Boolean), previousCommitValid: true };
}

const { changedPaths, previousCommitValid } = rangoDelPush();
const decision = resolveRoute({
  eventName,
  changedPaths,
  inputs: { deployShell: flag(process.env.INPUT_DEPLOY_SHELL), forceProject: flag(process.env.INPUT_FORCE_PROJECT) },
  previousCommitValid,
});

const salida = {
  route: decision.route,
  route_reason: decision.reason,
  fetch_live: decision.fetchLive,
  needs_seed: decision.needsSeed,
  needs_identity: decision.needsIdentity,
  needs_refresh: decision.needsRefresh,
  force_project: decision.forceProject,
  verify: decision.verify,
  deploy: decision.deploy,
  changed_paths: changedPaths.length,
  previous_commit_valid: previousCommitValid,
};

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(salida).map(([clave, valor]) => `${clave}=${valor}`).join('\n') + '\n');
}
process.stdout.write(`${JSON.stringify(salida)}\n`);
