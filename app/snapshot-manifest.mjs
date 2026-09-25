import fs from 'node:fs';
import path from 'node:path';

export const ACTIVE_POINTER_RELATIVE = '.local-cache/snapshots/active.json';

/**
 * El pointer de cada grupo. Gasolina conserva `active.json` y su significado
 * —el último snapshot que Gasolina aprobó—, que es lo que leen el rollback, la
 * proyección local y las sondas. Cada grupo nuevo lleva el suyo: comparten las
 * carpetas de snapshots, no la decisión de cuál usar.
 */
export const pointerRelative = (group = 'gasolina') => (group === 'gasolina' ? ACTIVE_POINTER_RELATIVE : `.local-cache/snapshots/active-${group}.json`);

function relative(root, value) {
  const absolute = path.resolve(root, value);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Ruta de snapshot fuera del workspace: ${value}`);
  return absolute;
}

const isoDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/**
 * Un pointer vale si declara SU CONTEXTO TEMPORAL —los dos únicos campos que el
 * público consume del snapshot— o si todavía apunta a un dataset legado que los
 * contiene. Los snapshots nuevos ya no escriben `dataset/`; los antiguos siguen
 * siendo revertibles sin reescribirlos.
 */
export function validateSnapshotPointer(root, pointer) {
  if (!pointer || pointer.schema_version !== 1 || typeof pointer.snapshot_id !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:-|$)/.test(pointer.snapshot_id) || typeof pointer.snapshot_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pointer.snapshot_date)) throw new Error('Pointer/manifesto fuera de contrato');
  const temporal = pointer.temporal_context;
  const conTemporal = Boolean(temporal) && isoDate(temporal.cutoff_at) && isoDate(temporal.source_max_reported_at);
  const datasetPath = typeof pointer.dataset_path === 'string' && pointer.dataset_path ? relative(root, pointer.dataset_path) : null;
  const conDatasetLegado = datasetPath !== null && fs.existsSync(datasetPath);
  if (!conTemporal && !conDatasetLegado) throw new Error(`Pointer sin temporal_context ni dataset legado utilizable: ${pointer.snapshot_id}`);
  if (pointer.evidence_path) relative(root, pointer.evidence_path);
  if (pointer.acquisition_path) relative(root, pointer.acquisition_path);
  if (pointer.overlay_path) relative(root, pointer.overlay_path);
  for (const field of ['raw_path', 'minimized_path']) if (pointer.lineage?.paths?.[field]) {
    const lineagePath = relative(root, pointer.lineage.paths[field]);
    if (!fs.existsSync(lineagePath)) throw new Error(`El lineage del snapshot no existe: ${pointer.lineage.paths[field]}`);
  }
  return { ...pointer, ...(conDatasetLegado ? { dataset_absolute_path: datasetPath } : {}) };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function readActivePointer(root, { group = 'gasolina' } = {}) {
  const pointerPath = path.join(root, pointerRelative(group));
  if (!fs.existsSync(pointerPath)) return null;
  const pointer = readJson(pointerPath);
  return { ...validateSnapshotPointer(root, pointer), pointer_path: pointerPath };
}

export function writeActivePointer(root, pointer, fsModule = fs, { group = 'gasolina' } = {}) {
  const pointerPath = path.join(root, pointerRelative(group));
  const value = `${JSON.stringify(pointer, null, 2)}\n`;
  fsModule.mkdirSync(path.dirname(pointerPath), { recursive: true, mode: 0o700 });
  const temporary = `${pointerPath}.${process.pid}.${Date.now()}.tmp`;
  fsModule.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
  fsModule.chmodSync(temporary, 0o600);
  fsModule.renameSync(temporary, pointerPath);
  return pointerPath;
}
