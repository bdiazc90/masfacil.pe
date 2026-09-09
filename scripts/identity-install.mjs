#!/usr/bin/env node
// Materializa el catálogo y la auditoría de identidad comercial desde un secret,
// para que el runner de CI pueda proyectar identidades sin que el expediente
// viva en Git. Mismo patrón que el seed de Registro y GIS.
//
// El expediente —fuente, método, fecha, responsable— es privado por contrato
// (AGENTS.md). Solo `brand` y `public_site_name` salen al bundle público.
//
// Un problema aquí ya NO mata la corrida. Antes cualquiera de estas
// comprobaciones lanzaba, el paso de CI moría antes de `npm run publish` y unos
// precios impecables se quedaban sin publicar por un nombre. Ahora se deja
// constancia en `identity-problems.json`, la proyección publica lo que sí tiene
// respaldo y el resumen de la corrida lo dice en voz alta.
//
// Instalar es REEMPLAZAR la pareja catálogo+auditoría. Lo que hubiera antes se
// aparta a `replaced/` (una sola ranura) para que nunca se reutilice por
// accidente: una instalación fallida deja el directorio sin pareja y la
// identidad queda ausente de verdad; un catálogo nuevo no convive con una
// auditoría vieja. `IDENTITY_ROOT` cambia el directorio (por defecto
// .local-cache/identity), y así una sonda trabaja sobre una copia.

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolateCommercialCatalog, validateCommercialCatalog } from '../app/commercial-catalog.mjs';
import { validateCommercialAudit } from '../app/commercial-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(root, process.env.IDENTITY_ROOT || path.join('.local-cache', 'identity'));
const PAREJA = ['commercial-identity-catalog.json', 'commercial-identity-audit.json'];

function apartarPareja() {
  const replaced = path.join(target, 'replaced');
  const apartados = [];
  for (const archivo of PAREJA) {
    const origen = path.join(target, archivo);
    if (!fs.existsSync(origen)) continue;
    fs.mkdirSync(replaced, { recursive: true, mode: 0o700 });
    fs.renameSync(origen, path.join(replaced, archivo));
    apartados.push(archivo);
  }
  return apartados;
}
const problemsPath = path.join(target, 'identity-problems.json');
const problems = [];

// El límite de un secret de GitHub son 48 KB y el paquete ya ronda los 44,7 KB.
// Cuando no quepa, `identity:pack` lo parte y el CI publica COMMERCIAL_IDENTITY_B64,
// _2, _3… Aquí se reensamblan en orden antes de decodificar: el gunzip solo
// funciona si el paquete quedó completo, así que la partición se verifica sola.
function encodedParts() {
  const first = process.env.COMMERCIAL_IDENTITY_B64;
  if (!first) return null;
  const parts = [first];
  for (let index = 2; ; index += 1) {
    const next = process.env[`COMMERCIAL_IDENTITY_B64_${index}`];
    if (!next) break;
    parts.push(next);
  }
  return parts;
}

function decodificar() {
  const partes = encodedParts();
  if (!partes) { problems.push({ scope: 'secret', reason: 'COMMERCIAL_IDENTITY_B64 ausente' }); return { partes: 0, payload: null }; }
  const encoded = partes.map((part) => part.trim()).join('');
  try {
    const payload = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
    // Un paquete que no se puede delimitar deja neutral toda la identidad que
    // depende de él, no los precios.
    if (!payload?.catalog && !payload?.audit) { problems.push({ scope: 'secret', reason: 'el paquete no contiene catalog ni audit' }); return { partes: partes.length, payload: null }; }
    return { partes: partes.length, payload };
  } catch (error) {
    problems.push({ scope: 'secret', reason: `no decodifica (${partes.length} parte(s), ${encoded.length} bytes): ${error.message}` });
    return { partes: partes.length, payload: null };
  }
}

const { partes, payload } = decodificar();
const replaced = apartarPareja();
const write = (file, value) => fs.writeFileSync(path.join(target, file), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

// Cada artefacto se decide por separado: una auditoría rota no debería impedir
// instalar un catálogo válido, porque con catálogo y sin auditoría todavía se
// publican las banderas. Y dentro del catálogo, una entrada defectuosa o
// duplicada se aísla; no tumba a las demás.
let catalogo = null;
let auditoria = null;
let isolated = [];
if (payload) {
  if (!payload.catalog) problems.push({ scope: 'catalog', reason: 'ausente en el paquete' });
  else {
    const aislado = isolateCommercialCatalog(payload.catalog);
    if (!aislado) problems.push({ scope: 'catalog', reason: `fuera de contrato: ${validateCommercialCatalog(payload.catalog).slice(0, 3).join('; ')}` });
    else {
      catalogo = aislado.catalog;
      isolated = aislado.dropped;
      if (isolated.length) problems.push({ scope: 'catalog', reason: `entradas aisladas: ${isolated.length} (${isolated.map((item) => item.establishment_id).slice(0, 5).join(', ')}${isolated.length > 5 ? ', …' : ''})` });
    }
  }

  const auditErrors = payload.audit ? validateCommercialAudit(payload.audit) : ['ausente en el paquete'];
  if (auditErrors.length) problems.push({ scope: 'audit', reason: `fuera de contrato: ${auditErrors.join('; ')}` });
  else if (catalogo && payload.audit.catalog_id !== catalogo.catalog_id) problems.push({ scope: 'audit', reason: 'la auditoría no corresponde al catálogo' });
  else auditoria = payload.audit;
}

if (catalogo || auditoria) fs.mkdirSync(target, { recursive: true, mode: 0o700 });
if (catalogo) write('commercial-identity-catalog.json', catalogo);
if (auditoria) write('commercial-identity-audit.json', auditoria);

const status = !catalogo ? 'absent' : problems.length ? 'degraded' : 'complete';
if (problems.length) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.writeFileSync(problemsPath, `${JSON.stringify({ status, reasons: problems, isolated, at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
} else if (fs.existsSync(problemsPath)) fs.rmSync(problemsPath);

process.stdout.write(`${JSON.stringify({
  status,
  catalog_id: catalogo?.catalog_id ?? null,
  catalog_schema: catalogo?.schema_version ?? null,
  audit_schema: auditoria?.schema_version ?? null,
  entries: catalogo?.entries.length ?? 0,
  publishable: catalogo ? catalogo.entries.filter((entry) => entry.publication.status === 'publishable').length : 0,
  audited: auditoria?.entries.length ?? 0,
  secret_parts: partes,
  problems: problems.map(({ scope, reason }) => `${scope}: ${reason}`),
  // Lo que quedó activo es exactamente lo que está en disco: nada más.
  active: { catalog: Boolean(catalogo), audit: Boolean(auditoria) },
  replaced,
  replaced_to: replaced.length ? (path.relative(root, path.join(target, 'replaced')).startsWith('..') ? path.join(target, 'replaced') : path.relative(root, path.join(target, 'replaced'))) : null,
  installed: Boolean(catalogo),
})}\n`);
