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
const SECRET_LIMIT = 48 * 1024;
// Margen para el nombre y el sobre del propio secret; partir antes de rozar el
// techo evita descubrirlo en el momento de cargarlo.
const PART_SIZE = 44 * 1024;
const encoded = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 }).toString('base64');

if (process.argv.includes('--measure')) {
  const partes = Math.ceil(encoded.length / PART_SIZE);
  process.stderr.write(`${JSON.stringify({ bytes: encoded.length, secret_limit: SECRET_LIMIT, cabe_en_uno: encoded.length <= SECRET_LIMIT, partes })}\n`);
} else if (encoded.length <= SECRET_LIMIT) {
  process.stdout.write(encoded);
} else {
  // Partido: cada trozo va a su propio secret y `identity:install` los concatena
  // en orden. Si falta uno o llegan desordenados, el gunzip falla y no se publica.
  const partes = [];
  for (let offset = 0; offset < encoded.length; offset += PART_SIZE) partes.push(encoded.slice(offset, offset + PART_SIZE));
  const nombre = (index) => (index === 0 ? 'COMMERCIAL_IDENTITY_B64' : `COMMERCIAL_IDENTITY_B64_${index + 1}`);
  const destino = path.join(dir, 'identity-secret-parts');
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true, mode: 0o700 });
  for (const [index, parte] of partes.entries()) fs.writeFileSync(path.join(destino, `${nombre(index)}.txt`), parte, { mode: 0o600 });
  process.stderr.write(`${JSON.stringify({ bytes: encoded.length, partes: partes.length, escrito_en: path.relative(root, destino), carga: partes.map((_, index) => `gh secret set ${nombre(index)} < ${path.join(path.relative(root, destino), `${nombre(index)}.txt`)}`) }, null, 2)}\n`);
}
