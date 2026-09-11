#!/usr/bin/env node

// CLI del observador de histórico. Traduce env a opciones, llama a
// `observeHistory` y deja constancia; no decide nada por su cuenta.
//
//   npm run history:observe                       observa y reconstruye el resumen
//   npm run history:summary                       solo reconstruye el resumen
//   HISTORY_STORE=fs npm run history:observe      contra .local-cache/history/
//
// Sin almacén S3 configurado escribe en disco y lo dice. Nunca imprime una clave,
// una firma ni una cabecera de autorización.
//
// Códigos de salida: 0 = observación registrada o no-op explicado; 1 = la
// corrida no pudo dejar el histórico en un estado bueno. Un fallo aquí no toca
// el deploy de precios: son workflows distintos y no hay dependencia entre ellos.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeHistory } from '../pipeline/history/observer.mjs';
import { createHistoryStore } from '../pipeline/history/store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const soloResumen = process.argv.includes('--summary-only') || process.env.SUMMARY_ONLY === '1';
const origin = process.env.PUBLIC_ORIGIN || (process.env.CLOUDFLARE_PAGES_PROJECT ? `https://${process.env.CLOUDFLARE_PAGES_PROJECT}.pages.dev` : null);

const salida = { ok: false, observation: 'none', archive: 'none', summary_write: 'none', problems: [] };
try {
  if (!soloResumen && !origin) throw new Error('Se requiere PUBLIC_ORIGIN para observar el bundle público');
  const store = await createHistoryStore({ root });
  Object.assign(salida, await observeHistory({ store, origin, summaryOnly: soloResumen }));
  salida.store = store.kind;
} catch (error) {
  salida.ok = false;
  salida.error = error.message;
  salida.problems.push(error.message);
}

// Mismo patrón que `scripts/resolve-route.mjs`: el guion escribe sus propias
// salidas y el YAML solo las encadena.
const outputs = {
  ok: salida.ok,
  observation: salida.observation,
  observation_id: salida.observation_id ?? '',
  archive: salida.archive,
  archive_hash: salida.archive_hash ?? '',
  revision_id: salida.revision_id ?? '',
  observed_at: salida.observed_at ?? '',
  local_date: salida.local_date ?? '',
  n_regular: salida.products?.regular?.n ?? '',
  n_premium: salida.products?.premium?.n ?? '',
  mean_regular: salida.products?.regular?.mean ?? '',
  mean_premium: salida.products?.premium?.mean ?? '',
  summary_write: salida.summary_write,
  days_with_observation: salida.days_with_observation ?? '',
};
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(outputs).map(([clave, valor]) => `${clave}=${valor}`).join('\n')}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lineas = [`## Histórico · ${salida.local_date || 'sin observación'}`, ''];
  lineas.push('| campo | valor |', '| --- | --- |');
  lineas.push(`| almacén | \`${salida.store ?? 'no creado'}\` |`);
  lineas.push(`| observación | \`${salida.observation}\`${salida.observation_id ? ` · ${salida.observation_id}` : ''} |`);
  lineas.push(`| archivo | \`${salida.archive}\`${salida.archive_hash ? ` · ${salida.archive_hash.slice(0, 12)}` : ''} |`);
  if (salida.revision_id) lineas.push(`| revisión | \`${salida.revision_id}\` |`);
  if (salida.observed_at) lineas.push(`| observado | ${salida.observed_at} |`);
  if (salida.products) lineas.push(`| Regular | ${salida.products.regular.mean ?? '—'} · n ${salida.products.regular.n} |`, `| Premium | ${salida.products.premium.mean ?? '—'} · n ${salida.products.premium.n} |`);
  lineas.push(`| resumen | \`${salida.summary_write}\`${salida.summary_reason ? ` · ${salida.summary_reason}` : ''} |`);
  lineas.push(`| días con observación | ${salida.days_with_observation ?? 0} |`);
  for (const problema of salida.problems.slice(0, 20)) lineas.push('', `> [!WARNING]`, `> ${problema}`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lineas.join('\n')}\n`);
}

process.stdout.write(`${JSON.stringify(salida)}\n`);
if (!salida.ok) process.exitCode = 1;
