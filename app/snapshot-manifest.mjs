import fs from 'node:fs';
import path from 'node:path';

export const ACTIVE_POINTER_RELATIVE = '.local-cache/snapshots/active.json';

function relative(root, value) {
  const absolute = path.resolve(root, value);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Ruta de snapshot fuera del workspace: ${value}`);
  return absolute;
}

export function validateSnapshotPointer(root, pointer, { requireDataset = true } = {}) {
  if (!pointer || pointer.schema_version !== 1 || typeof pointer.snapshot_id !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:-|$)/.test(pointer.snapshot_id) || typeof pointer.snapshot_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pointer.snapshot_date) || typeof pointer.dataset_path !== 'string') throw new Error('Pointer/manifesto fuera de contrato');
  const datasetPath = relative(root, pointer.dataset_path);
  if (requireDataset && !fs.existsSync(datasetPath)) throw new Error(`El dataset del snapshot no existe: ${pointer.dataset_path}`);
  if (pointer.evidence_path) relative(root, pointer.evidence_path);
  if (pointer.acquisition_path) relative(root, pointer.acquisition_path);
  if (pointer.overlay_path) relative(root, pointer.overlay_path);
  for (const field of ['raw_path', 'minimized_path']) if (pointer.lineage?.paths?.[field]) {
    const lineagePath = relative(root, pointer.lineage.paths[field]);
    if (requireDataset && !fs.existsSync(lineagePath)) throw new Error(`El lineage del snapshot no existe: ${pointer.lineage.paths[field]}`);
  }
  return { ...pointer, dataset_absolute_path: datasetPath };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function readActivePointer(root) {
  const pointerPath = path.join(root, ACTIVE_POINTER_RELATIVE);
  if (!fs.existsSync(pointerPath)) return null;
  const pointer = readJson(pointerPath);
  return { ...validateSnapshotPointer(root, pointer), pointer_path: pointerPath };
}

function candidateDatasets(root) {
  const candidates = [];
  const roots = [path.join(root, '.local-cache', 'snapshots'), path.join(root, '.local-cache', 'datasets')];
  for (const base of roots) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const datasetPath = path.join(base, entry.name, 'experiment-dataset-lima-province.json');
      if (entry.isDirectory() && fs.existsSync(datasetPath)) candidates.push({ datasetPath, snapshot_id: entry.name });
    }
  }
  return candidates.sort((left, right) => right.snapshot_id.localeCompare(left.snapshot_id));
}

export function resolveActiveSnapshot(root) {
  const pointer = readActivePointer(root);
  if (pointer) return pointer;
  const legacy = candidateDatasets(root)[0];
  if (!legacy) throw new Error('No existe pointer ni snapshot local last-known-good');
  const match = legacy.snapshot_id.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error(`Snapshot legacy sin fecha válida: ${legacy.snapshot_id}`);
  return {
    schema_version: 1,
    snapshot_id: `legacy-${legacy.snapshot_id}`,
    snapshot_date: match[0],
    dataset_path: path.relative(root, legacy.datasetPath),
    dataset_absolute_path: legacy.datasetPath,
    pointer_path: path.join(root, ACTIVE_POINTER_RELATIVE),
    legacy: true,
  };
}

export function writeActivePointer(root, pointer, fsModule = fs) {
  const pointerPath = path.join(root, ACTIVE_POINTER_RELATIVE);
  const value = `${JSON.stringify(pointer, null, 2)}\n`;
  fsModule.mkdirSync(path.dirname(pointerPath), { recursive: true, mode: 0o700 });
  const temporary = `${pointerPath}.${process.pid}.${Date.now()}.tmp`;
  fsModule.writeFileSync(temporary, value, { mode: 0o600, flag: 'wx' });
  fsModule.chmodSync(temporary, 0o600);
  fsModule.renameSync(temporary, pointerPath);
  return pointerPath;
}
