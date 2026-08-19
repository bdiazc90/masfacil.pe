#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublicBundle } from '../pipeline/public-contract.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const dataRoot = path.join(root,'web','data'); const manifestPath=path.join(dataRoot,'manifest.json');
if(!fs.existsSync(manifestPath)) throw new Error('Falta web/data/manifest.json; ejecuta npm run project:gate-4.1');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')); const snapshotPath=path.join(root,'web',manifest.dataset_url); const errors=validatePublicBundle(manifest,fs.readFileSync(snapshotPath,'utf8'));
if(errors.length) throw new Error(errors.join('; ')); process.stdout.write(`Bundle público válido: ${manifest.snapshot_id} · ${manifest.bytes} bytes\n`);
