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
import { groupsBehind } from '../app/publication-policy.mjs';
import { PUBLISHED_GROUPS } from '../pipeline/groups.mjs';
import { fetchPublishedState } from '../pipeline/live-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const route = process.env.ROUTE || 'data';
const origin = process.env.PUBLIC_ORIGIN;
if (!origin) throw new Error('Se requiere PUBLIC_ORIGIN para revalidar antes de subir');

// Cada grupo publicado se compara con su propio estado: la novedad de uno no
// autoriza a retroceder otro, y un grupo que ya está publicado no puede faltar.
const locales = Object.fromEntries(PUBLISHED_GROUPS.map((grupo) => {
  const estado = JSON.parse(fs.readFileSync(path.join(root, 'web', ...grupo.dataRoot.split('/'), 'refresh-state.json'), 'utf8'));
  if (!estado.snapshot_id) throw new Error(`El refresh-state local de ${grupo.key} no declara snapshot_id; no se puede ordenar la corrida`);
  return [grupo.key, estado];
}));

// Se lee el refresh-state entero, no solo su `snapshot_id`: ordenar dos corridas
// necesita también la consulta web, distrito por distrito. Un grupo sin estado
// publicado solo cuenta como «todavía no publicado» si su página también da
// 404; si la página existe, producción está rota y no se sube nada encima.
const publicado = (grupo) => fetchPublishedState({ origin, group: grupo });

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

const publicados = Object.fromEntries(await Promise.all(PUBLISHED_GROUPS.map(async (grupo) => [grupo.key, await publicado(grupo)])));
const atrasados = groupsBehind({ local: locales, published: publicados });
const retroceso = atrasados.length ? null : retrocesoDeCodigo();

// Las causas se informan por grupo y pueden darse a la vez: un CSV anterior y,
// además, distritos cuya consulta retrocede.
const causa = (atrasado) => (atrasado.missing
  ? `${atrasado.group}: publicado y ausente en esta corrida`
  : [
    atrasado.published_snapshot && atrasado.local_snapshot < atrasado.published_snapshot ? `${atrasado.group}: el CSV publicado (${atrasado.published_snapshot}) es posterior al de esta corrida (${atrasado.local_snapshot})` : null,
    atrasado.regressions.length ? `${atrasado.group}: la consulta retrocede en ${atrasado.regressions.length} unidad(es) — ${atrasado.regressions.slice(0, 3).join('; ')}` : null,
  ].filter(Boolean).join('; además, ') || `${atrasado.group}: el estado publicado es más nuevo`);

const decision = atrasados.length
  ? { deploy: false, reason: `corrida_desactualizada: ${atrasados.map(causa).join('; además, ')}` }
  : retroceso
    ? { deploy: false, reason: retroceso.reason }
    : { deploy: true, reason: Object.values(publicados).some(Boolean) ? 'estado revalidado; esta corrida no retrocede código ni datos' : 'no hay bundle publicado todavía; primera publicación' };

const [local, remoto] = [locales.gasolina ?? null, publicados.gasolina ?? null];
const salida = {
  ...decision,
  route,
  local_snapshot: local?.snapshot_id ?? null,
  published_snapshot: remoto?.snapshot_id ?? null,
  local_facilito: local?.facilito?.state_id ?? null,
  published_facilito: remoto?.facilito?.state_id ?? null,
  unidades_que_retroceden: atrasados.reduce((total, atrasado) => total + atrasado.regressions.length, 0),
  grupos: Object.fromEntries(PUBLISHED_GROUPS.map((grupo) => [grupo.key, { local: locales[grupo.key]?.snapshot_id ?? null, publicado: publicados[grupo.key]?.snapshot_id ?? null }])),
};
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${decision.deploy}\npreflight_reason=${decision.reason}\n`);
process.stdout.write(`${JSON.stringify(salida)}\n`);
