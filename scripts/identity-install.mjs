#!/usr/bin/env node
// Materializa el catálogo y la auditoría de identidad comercial desde un secret,
// para que el runner de CI pueda proyectar identidades sin que el expediente
// viva en Git. Mismo patrón que el seed de Registro y GIS.
//
// El expediente —fuente, método, fecha, responsable— es privado por contrato
// (AGENTS.md). Solo `brand` y `public_site_name` salen al bundle público.

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCommercialCatalog } from '../app/commercial-catalog.mjs';
import { validateCommercialAudit } from '../app/commercial-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// El límite de un secret de GitHub son 48 KB y el paquete ya ronda los 44,7 KB.
// Cuando no quepa, `identity:pack` lo parte y el CI publica COMMERCIAL_IDENTITY_B64,
// _2, _3… Aquí se reensamblan en orden antes de decodificar: el gunzip solo
// funciona si el paquete quedó completo, así que la partición se verifica sola.
function encodedParts() {
  const first = process.env.COMMERCIAL_IDENTITY_B64;
  if (!first) throw new Error('COMMERCIAL_IDENTITY_B64 es obligatorio');
  const parts = [first];
  for (let index = 2; ; index += 1) {
    const next = process.env[`COMMERCIAL_IDENTITY_B64_${index}`];
    if (!next) break;
    parts.push(next);
  }
  return parts;
}
const partes = encodedParts();
const encoded = partes.map((part) => part.trim()).join('');

let payload;
try {
  payload = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
} catch (error) {
  throw new Error(`El secret de identidad comercial no decodifica (${partes.length} parte(s), ${encoded.length} bytes): ${error.message}`);
}
if (!payload?.catalog || !payload?.audit) throw new Error('El secret debe contener catalog y audit');

const catalogErrors = validateCommercialCatalog(payload.catalog);
const auditErrors = validateCommercialAudit(payload.audit);
if (catalogErrors.length || auditErrors.length) {
  throw new Error(`Identidad comercial fuera de contrato:\n- ${[...catalogErrors, ...auditErrors].join('\n- ')}`);
}
if (payload.audit.catalog_id !== payload.catalog.catalog_id) throw new Error('La auditoría no corresponde al catálogo');

const target = path.join(root, '.local-cache', 'identity');
fs.mkdirSync(target, { recursive: true, mode: 0o700 });
const write = (file, value) => fs.writeFileSync(path.join(target, file), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
write('commercial-identity-catalog.json', payload.catalog);
write('commercial-identity-audit.json', payload.audit);

const publicables = payload.catalog.entries.filter((entry) => entry.publication.status === 'publishable').length;
process.stdout.write(`${JSON.stringify({ catalog_id: payload.catalog.catalog_id, catalog_schema: payload.catalog.schema_version, audit_schema: payload.audit.schema_version, entries: payload.catalog.entries.length, publishable: publicables, audited: payload.audit.entries.length, secret_parts: partes.length, installed: true })}\n`);
