#!/usr/bin/env node
// Empaqueta el catálogo y la auditoría locales en el base64 que consume el CI.
// La salida va a stdout para cargarla con: npm run identity:pack | gh secret set ...

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.local-cache', 'identity');
const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const payload = { catalog: read('commercial-identity-catalog.json'), audit: read('commercial-identity-audit.json') };
// Sin comprimir son ~490 KB y el límite de un secret de GitHub es 48 KB.
process.stdout.write(zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 }).toString('base64'));
