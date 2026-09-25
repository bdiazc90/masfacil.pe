/**
 * Poda de `.local-cache/snapshots/` en CI.
 *
 * La caché de Actions guarda la carpeta entera en cada corrida. Sin poda, cada
 * CSV nuevo deja su snapshot para siempre y cada entrada de caché crece con él,
 * hasta pasar el límite del repositorio y desalojar las entradas buenas.
 *
 * La poda corre en `prepare`, ANTES del deploy, así que no puede fiarse de los
 * pointers: tras promover apuntan al snapshot nuevo, y el que sirve producción
 * sigue haciendo falta si el deploy falla. La fuente solo sirve el CSV vigente:
 * lo que se borre no vuelve sin descargar, y lo viejo no vuelve nunca. Por eso,
 * por cada grupo publicado, se protege explícitamente:
 * - su producción: el snapshot del estado que sirve, leído antes de escribir;
 * - un destino de rollback: el snapshot utilizable más nuevo anterior a su
 *   producción, de la misma fuente y con OTRO CSV. Una revisión nueva de
 *   Facilito o una reproyección del mismo CSV no cuentan como otro destino.
 *
 * Y por fuente se conserva todo lo que hay desde ese destino hasta lo más nuevo:
 * así sobrevive también lo que otra corrida está desplegando en este momento.
 * Con eso, los destinos de los pointers y el cierre de dependencias —el dueño
 * real de cada original y el destino de cada symlink—, lo demás se borra, igual
 * que `staging/`.
 *
 * Ante cualquier referencia faltante o incoherente no se borra NADA: un
 * refresco en curso, un pointer ilegible o hacia una carpeta que no está,
 * producción desconocida o incompleta, un destino de rollback que no aparece
 * habiendo snapshots anteriores, un symlink colgante o fuera de la caché, un
 * original que no resuelve. Sin saber qué está en uso, lo seguro es no tocar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateSnapshotPointer } from '../app/snapshot-manifest.mjs';
import { facilitoRoot } from './facilito/state.mjs';
import { PUBLISHED_GROUPS } from './groups.mjs';
import { resolveSourceRaw, snapshotUsable } from './project-gasolina.mjs';
import { SOURCES, sourceOfPointer } from './sources.mjs';

const POINTER = /^(active(-[a-z0-9-]+)?|source-[a-z0-9-]+)\.json$/;
// Solo una carpeta con forma de snapshot es candidata a borrarse; otra cosa no se toca.
const SNAPSHOT_ID = /^\d{4}-\d{2}-\d{2}-\S+$/;

/**
 * El plan de poda, sin tocar el disco.
 *
 * @param {object} entrada
 * @param {Record<string, {source_id: string|null, raw_sha256: string|null, eligible: boolean, usable: boolean, problems: string[], dependencies: string[]}>} entrada.snapshots
 *   cada carpeta con forma de snapshot y lo que se sabe de ella: si sirve para
 *   componer, qué referencias rotas tiene y de qué otras carpetas depende
 * @param {{file: string, snapshot_id: string|null}[]} entrada.pointers  `snapshot_id` null si el pointer no se pudo leer
 * @param {Record<string, {source: string, production: undefined|null|{error: string}|{snapshot_id: string, revision_id: string|null}}>} entrada.groups
 *   los grupos publicados. `production` null: nunca se publicó; `undefined`: no se sabe
 * @param {boolean} [entrada.locked]   hay un refresco en curso
 * @param {boolean} [entrada.staging]  existe `staging/`
 */
export function planSnapshotPrune({ snapshots, pointers, groups, locked = false, staging = false }) {
  const omitir = (reason) => ({ status: 'skipped', reason, keep: Object.keys(snapshots).sort(), remove: [], staging: false, protected: {}, cutoffs: {} });
  if (locked) return omitir('hay un refresco en curso');
  if (!pointers.length) return omitir('no hay pointers: no se sabe qué está en uso');
  const ilegibles = pointers.filter((pointer) => !pointer.snapshot_id).map((pointer) => pointer.file);
  if (ilegibles.length) return omitir(`pointers ilegibles: ${ilegibles.join(', ')}`);
  for (const pointer of pointers) {
    const hechos = snapshots[pointer.snapshot_id];
    if (!hechos) return omitir(`${pointer.file} apunta a ${pointer.snapshot_id}, que no está en la caché`);
    if (!hechos.usable) return omitir(`${pointer.file} apunta a ${pointer.snapshot_id}, que no sirve para componer: ${hechos.problems.join('; ') || 'incompleto'}`);
  }

  const protegidos = {};
  const cortes = {};
  for (const [grupo, { source, production }] of Object.entries(groups)) {
    if (production === undefined) return omitir(`producción de ${grupo} desconocida`);
    if (production === null) continue;
    if (production.error) return omitir(`producción de ${grupo} ilegible: ${production.error}`);
    const actual = snapshots[production.snapshot_id];
    if (!actual) return omitir(`la producción de ${grupo} (${production.snapshot_id}) no está en la caché`);
    if (!actual.usable) return omitir(`la producción de ${grupo} (${production.snapshot_id}) no sirve para componer: ${actual.problems.join('; ') || 'incompleta'}`);
    if (actual.source_id !== source) return omitir(`la producción de ${grupo} (${production.snapshot_id}) es de ${actual.source_id}, no de ${source}`);
    const anteriores = Object.keys(snapshots).filter((id) => snapshots[id].source_id === source && id < production.snapshot_id).sort().reverse();
    const otroCsv = (id) => !snapshots[id].raw_sha256 || !actual.raw_sha256 || snapshots[id].raw_sha256 !== actual.raw_sha256;
    const destino = anteriores.find((id) => snapshots[id].usable && snapshots[id].eligible && otroCsv(id)) ?? null;
    // Sin nada anterior no hay nada que perder; con anteriores y ninguno que
    // sirva, algo no cuadra y no se toca nada.
    if (anteriores.length && !destino) return omitir(`hay snapshots de ${source} anteriores a la producción de ${grupo}, pero ninguno sirve de destino de rollback`);
    protegidos[grupo] = { production: production.snapshot_id, revision: production.revision_id ?? null, rollback: destino };
    const corte = destino ?? production.snapshot_id;
    if (!cortes[source] || corte < cortes[source]) cortes[source] = corte;
  }

  const keep = new Set(pointers.map((pointer) => pointer.snapshot_id));
  for (const [id, hechos] of Object.entries(snapshots)) if (cortes[hechos.source_id] && id >= cortes[hechos.source_id]) keep.add(id);
  const pendientes = [...keep];
  while (pendientes.length) {
    const id = pendientes.pop();
    const hechos = snapshots[id];
    if (!hechos) return omitir(`${id} hace falta y no está en la caché`);
    if (hechos.problems.length) return omitir(`${id}: ${hechos.problems.join('; ')}`);
    for (const dependencia of hechos.dependencies) {
      if (!snapshots[dependencia]) return omitir(`${id} depende de ${dependencia}, que no está en la caché`);
      if (!keep.has(dependencia)) { keep.add(dependencia); pendientes.push(dependencia); }
    }
  }
  return {
    status: 'pruned',
    reason: null,
    keep: [...keep].sort(),
    remove: Object.keys(snapshots).filter((id) => !keep.has(id)).sort(),
    staging,
    protected: protegidos,
    cutoffs: cortes,
  };
}

/** Los symlinks de una carpeta, sin seguirlos. */
function symlinks(dir, fsModule) {
  const encontrados = [];
  for (const entry of fsModule.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) encontrados.push(full);
    else if (entry.isDirectory()) encontrados.push(...symlinks(full, fsModule));
  }
  return encontrados;
}

/** Bytes de una carpeta sin seguir symlinks: lo que de verdad se libera. */
function bytes(target, fsModule) {
  const stat = fsModule.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fsModule.readdirSync(target).reduce((total, name) => total + bytes(path.join(target, name), fsModule), 0);
}

/**
 * Lo que se sabe de una carpeta de snapshot: si sirve para componer —lo mismo
 * que exige el rollback—, qué referencias rotas tiene y de qué otras carpetas
 * depende.
 */
function hechosDe(root, snapshotsRoot, id, fsModule) {
  const dir = path.join(snapshotsRoot, id);
  const problems = [];
  const dependencies = new Set();
  // La carpeta de snapshot a la que pertenece una ruta, o null si queda fuera de
  // la caché. Se mira contra la raíz tal cual y contra su ruta real: un
  // `realpath` resuelve también los symlinks de más arriba (en macOS, /var).
  const raices = [...new Set([snapshotsRoot, fsModule.realpathSync(snapshotsRoot)])];
  const carpetaDe = (ruta) => {
    for (const raiz of raices) {
      const relativa = path.relative(raiz, ruta);
      if (!relativa.startsWith('..') && !path.isAbsolute(relativa)) return relativa.split(path.sep)[0];
    }
    return null;
  };
  for (const link of symlinks(dir, fsModule)) {
    const destino = path.resolve(path.dirname(link), fsModule.readlinkSync(link));
    const carpeta = carpetaDe(destino);
    if (!carpeta) { problems.push(`symlink fuera de la caché: ${path.relative(dir, link)}`); continue; }
    if (!fsModule.existsSync(link)) { problems.push(`symlink colgante: ${path.relative(dir, link)}`); continue; }
    if (carpeta !== id) dependencies.add(carpeta);
  }
  let manifest = null;
  try { manifest = JSON.parse(fsModule.readFileSync(path.join(dir, 'snapshot-manifest.json'), 'utf8')); } catch { problems.push('snapshot-manifest.json ausente o ilegible'); }
  if (manifest && manifest.snapshot_id !== id) problems.push(`el manifest dice ${manifest.snapshot_id}`);
  const sourceId = manifest ? sourceOfPointer(manifest) : null;
  if (manifest && !SOURCES[sourceId]) problems.push(`fuente desconocida: ${sourceId}`);
  let usable = false;
  if (!problems.length) {
    try {
      validateSnapshotPointer(root, manifest);
      const uso = snapshotUsable(root, manifest, { sourceId });
      usable = uso.ok;
      // El original que de verdad se lee, siguiendo toda la cadena: su dueño es
      // una dependencia aunque el symlink de esta carpeta apunte a otro eslabón.
      const dueño = carpetaDe(fsModule.realpathSync(resolveSourceRaw(root, manifest)));
      if (!dueño) problems.push('el original vive fuera de la caché');
      else if (dueño !== id) dependencies.add(dueño);
    } catch (error) { problems.push(`no sirve para componer: ${error.message}`); }
  }
  return {
    source_id: SOURCES[sourceId] ? sourceId : null,
    raw_sha256: manifest?.lineage?.raw?.sha256 ?? null,
    eligible: manifest?.eligible_for_rollback !== false,
    usable: usable && !problems.length,
    problems,
    dependencies: [...dependencies].sort(),
  };
}

/**
 * Poda la carpeta de snapshots según el plan. Devuelve el informe; con
 * `dryRun` solo planifica.
 *
 * @param {object} entrada
 * @param {Record<string, object>|undefined} entrada.production  lo que sirve producción por grupo, de `prepareRelease`
 */
export function pruneSnapshots({ root, production, fsModule = fs, dryRun = false } = {}) {
  const snapshotsRoot = path.join(root, '.local-cache', 'snapshots');
  if (!fsModule.existsSync(snapshotsRoot)) return { status: 'skipped', reason: 'no hay carpeta de snapshots', keep: [], remove: [], staging: false, protected: {}, cutoffs: {}, others: [], warnings: [], freed_bytes: 0, dry_run: dryRun };
  const entries = fsModule.readdirSync(snapshotsRoot, { withFileTypes: true });
  const carpetas = entries.filter((entry) => entry.isDirectory() && entry.name !== 'staging').map((entry) => entry.name);
  const snapshots = Object.fromEntries(carpetas.filter((name) => SNAPSHOT_ID.test(name)).map((id) => [id, hechosDe(root, snapshotsRoot, id, fsModule)]));
  const others = carpetas.filter((name) => !SNAPSHOT_ID.test(name)).sort();
  const pointers = entries.filter((entry) => entry.isFile() && POINTER.test(entry.name)).map((entry) => {
    try { return { file: entry.name, snapshot_id: JSON.parse(fsModule.readFileSync(path.join(snapshotsRoot, entry.name), 'utf8')).snapshot_id || null }; }
    catch { return { file: entry.name, snapshot_id: null }; }
  });
  const groups = Object.fromEntries(PUBLISHED_GROUPS.map((grupo) => [grupo.key, { source: grupo.config.source, production: production === undefined ? undefined : production?.[grupo.key] }]));
  const plan = planSnapshotPrune({
    snapshots,
    pointers,
    groups,
    locked: fsModule.existsSync(path.join(snapshotsRoot, 'refresh.lock')),
    staging: entries.some((entry) => entry.isDirectory() && entry.name === 'staging'),
  });
  // La consulta web con la que se compuso producción no vive aquí y la poda no
  // la toca; sin ella, un rollback solo reconstruiría la versión de CSV puro.
  const warnings = [];
  for (const [grupo, estado] of Object.entries(production ?? {})) {
    if (estado?.facilito && estado.revision_id && !fsModule.existsSync(path.join(facilitoRoot(root), 'revisions', `${estado.revision_id}.json`))) warnings.push(`falta la consulta web guardada de la producción de ${grupo} (${estado.revision_id})`);
  }
  if (others.length) warnings.push(`carpetas sin forma de snapshot, no se tocan: ${others.join(', ')}`);
  const objetivos = plan.status === 'pruned' ? [...plan.remove, ...(plan.staging ? ['staging'] : [])] : [];
  const freed = objetivos.reduce((total, name) => total + bytes(path.join(snapshotsRoot, name), fsModule), 0);
  if (!dryRun) for (const name of objetivos) fsModule.rmSync(path.join(snapshotsRoot, name), { recursive: true, force: true });
  return { ...plan, others, warnings, freed_bytes: freed, dry_run: dryRun };
}

/**
 * La poda que corre `publish`: solo en CI, donde la caché de Actions guarda la
 * carpeta después. En local no se toca nada: ahí los snapshots viejos son los
 * que permiten revertir.
 */
export function pruneInCi({ root, production, env = process.env, fsModule = fs } = {}) {
  if (env.GITHUB_ACTIONS !== 'true') return null;
  return pruneSnapshots({ root, production, fsModule });
}
