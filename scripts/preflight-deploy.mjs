#!/usr/bin/env node

// Última comprobación antes de subir. Las corridas no terminan en el orden en
// que empiezan: una que arrancó antes puede llegar al upload después y restaurar
// un shell anterior o pisar un bundle más nuevo con uno viejo. Aquí se revalida
// el estado real contra el origen público y contra la punta de main.
//
//   ROUTE=shell PUBLIC_ORIGIN=https://masfacil.pe node scripts/preflight-deploy.mjs
//
// Abortar no es un fallo: es un `no-op` explicado. Se informa y se conserva el
// deployment vigente, que ya es más nuevo que lo que traía esta corrida.
//
// Si la punta de main no se puede consultar, no se publica: revalidar es la
// única garantía de no retroceder código, y sin ella no hay garantía.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codeRegression } from '../app/route-policy.mjs';
import { dataStateIsBehind, dataStateRegressions } from '../app/publication-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const route = process.env.ROUTE || 'data';
const origin = process.env.PUBLIC_ORIGIN;
if (!origin) throw new Error('Se requiere PUBLIC_ORIGIN para revalidar antes de subir');

const localState = JSON.parse(fs.readFileSync(path.join(root, 'web', 'data', 'gasolina', 'refresh-state.json'), 'utf8'));
const localSnapshot = localState.snapshot_id ?? null;
if (!localSnapshot) throw new Error('El refresh-state local no declara snapshot_id; no se puede ordenar la corrida');

const base = new URL(origin);
if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`;

// Se lee el refresh-state entero, no solo su `snapshot_id`: ordenar dos corridas
// necesita también la consulta web, distrito por distrito.
async function publicado() {
  const response = await fetch(new URL('data/gasolina/refresh-state.json', base), { redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`No se pudo leer el refresh-state publicado: HTTP ${response.status}`);
  return JSON.parse(await response.text());
}

const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });

// La referencia a comparar se consulta en el remoto. `PREFLIGHT_MAIN_REF` permite
// a una sonda local comparar contra una referencia ya presente sin salir a la
// red; en CI no se define y siempre se consulta origin.
function puntaDeMain() {
  const declarada = process.env.PREFLIGHT_MAIN_REF;
  if (declarada) return { ref: declarada };
  const fetched = git('fetch', '--quiet', 'origin', 'main');
  if (fetched.status !== 0) return { error: fetched.stderr.trim() || 'git fetch falló' };
  return { ref: 'origin/main' };
}

function retrocesoDeCodigo() {
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const punta = puntaDeMain();
  if (punta.error) return { reason: `sin_verificacion_de_main: ${punta.error}` };
  const tip = git('rev-parse', '--verify', '--quiet', `${punta.ref}^{commit}`).stdout.trim();
  if (!tip) return { reason: `sin_verificacion_de_main: ${punta.ref} no resuelve` };
  const isAncestor = git('merge-base', '--is-ancestor', head, tip).status === 0;
  const delta = isAncestor ? git('diff', '--name-only', '-z', `${head}..${tip}`).stdout.split('\0').filter(Boolean) : [];
  return codeRegression({ head, tip, isAncestor, changedPaths: delta });
}

const remoteState = await publicado();
const remoteSnapshot = remoteState?.snapshot_id ?? null;
const atrasado = Boolean(remoteState) && dataStateIsBehind(localState, remoteState);
const retrocesos = remoteState ? dataStateRegressions(localState, remoteState) : [];
const retroceso = atrasado ? null : retrocesoDeCodigo();

// Las dos causas se informan por separado y pueden darse a la vez: un CSV
// anterior y, además, distritos cuya consulta retrocede.
const causas = [
  remoteSnapshot && localSnapshot < remoteSnapshot ? `el CSV publicado (${remoteSnapshot}) es posterior al de esta corrida (${localSnapshot})` : null,
  retrocesos.length ? `la consulta retrocede en ${retrocesos.length} unidad(es) — ${retrocesos.slice(0, 3).join('; ')}` : null,
].filter(Boolean);

const decision = atrasado
  ? { deploy: false, reason: `corrida_desactualizada: ${causas.join('; además, ') || 'el estado publicado es más nuevo'}` }
  : retroceso
    ? { deploy: false, reason: retroceso.reason }
    : { deploy: true, reason: remoteSnapshot ? 'estado revalidado; esta corrida no retrocede código ni datos' : 'no hay bundle publicado todavía; primera publicación' };

const salida = { ...decision, route, local_snapshot: localSnapshot, published_snapshot: remoteSnapshot, local_facilito: localState?.facilito?.state_id ?? null, published_facilito: remoteState?.facilito?.state_id ?? null, unidades_que_retroceden: retrocesos.length };
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${decision.deploy}\npreflight_reason=${decision.reason}\n`);
process.stdout.write(`${JSON.stringify(salida)}\n`);
