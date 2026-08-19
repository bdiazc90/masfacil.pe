import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function files(directory) {
  const result = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...files(candidate));
    else if (entry.isFile() || entry.isSymbolicLink()) result.push(candidate);
  }
  return result;
}

export async function findMatchingRaw({ root, snapshotsRoot, sourceId, validators }) {
  if (!fs.existsSync(snapshotsRoot)) return null;
  for (const entry of fs.readdirSync(snapshotsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const snapshotDir = path.join(snapshotsRoot, entry.name);
    const manifestPath = path.join(snapshotDir, 'snapshot-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }
    const acquisitionPath = manifest.acquisition_path ? path.join(root, manifest.acquisition_path) : null;
    if (!acquisitionPath || !fs.existsSync(acquisitionPath)) continue;
    const record = fs.readFileSync(acquisitionPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse).find((item) => item.source_id === sourceId);
    if (!record || record.response_headers?.etag !== validators.etag || record.response_headers?.['last-modified'] !== validators.last_modified) continue;
    const recordedPath = record.cache_path ? path.join(root, record.cache_path) : null;
    const candidates = recordedPath && fs.existsSync(recordedPath) ? [recordedPath] : files(snapshotDir).filter((file) => file.endsWith('.csv'));
    for (const candidate of candidates) {
      if (fs.statSync(candidate).size !== Number(record.bytes)) continue;
      if (await sha256File(candidate) === record.sha256) return { path: candidate, record };
    }
  }
  return null;
}
