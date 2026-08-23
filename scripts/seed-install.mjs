#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeSeed, materializeSeedTables } from '../app/bootstrap-seed.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap', 'seed.manifest.json'), 'utf8'));
const targetFlag = process.argv.indexOf('--target');
const target = targetFlag >= 0 ? process.argv[targetFlag + 1] : null;
if (!target || target.startsWith('-')) throw new Error('Uso: node scripts/seed-install.mjs --target <directorio-privado>');
const outputRoot = path.resolve(target);
for (const forbidden of [path.join(root, 'data'), path.join(root, 'web')]) if (outputRoot === forbidden || outputRoot.startsWith(`${forbidden}${path.sep}`)) throw new Error('El seed no puede materializarse en data/ ni web/');
const payload = decodeSeed(process.env.BOOTSTRAP_SEED_B64, manifest);
const tables = materializeSeedTables(payload);
function writePrivate(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, gzipSync(content, { level: 9 }), { mode: 0o600, flag: 'wx' }); fs.chmodSync(file, 0o600); }
writePrivate(path.join(outputRoot, 'registry', 'authorizations.csv.gz'), tables.registry);
writePrivate(path.join(outputRoot, 'gis', 'features.csv.gz'), tables.gis);
process.stdout.write(`${JSON.stringify({ seed_id: manifest.seed_id, registry_rows: payload.registry.length, gis_rows: payload.gis.length, installed: true })}\n`);
