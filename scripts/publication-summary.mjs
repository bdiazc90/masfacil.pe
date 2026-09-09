#!/usr/bin/env node

// Resumen de la corrida para quien la mira desde GitHub. Distingue un `no-op`
// esperado de una entrega pedida que no se publicó, y hace visible una identidad
// degradada: un deploy con menos nombres puede ser correcto, pero no silencioso.
//
// Dos etapas, porque «previsto» y «efectivo» no son lo mismo:
//   SUMMARY_STAGE=prepare   ruta, decisión, identidad y ENTREGA PREVISTA
//                           (lee PREPARE_RESULT, que `publish` siempre escribe)
//   SUMMARY_STAGE=deploy    lo que pasó de verdad: preflight y subida
//
// Solo conteos y motivos accionables. El expediente —fuente, método, fecha,
// responsable, RUC— es privado y no aparece aquí.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (archivo) => { try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return null; } };
const stage = process.env.SUMMARY_STAGE || 'prepare';
const lineas = [];

if (stage === 'deploy') {
  const preflightDeploy = process.env.PREFLIGHT_DEPLOY === 'true';
  const preflightReason = process.env.PREFLIGHT_REASON || 'sin motivo';
  const upload = process.env.UPLOAD_OUTCOME || 'skipped';
  lineas.push(`## Publicación · ruta \`${process.env.ROUTE ?? 'desconocida'}\``, '');
  if (!preflightDeploy) lineas.push(`**No publicado.** ${preflightReason}`, '', 'El deployment vigente se conserva. Si el motivo empieza por `corrida_desactualizada` o `codigo_desactualizado`, otra corrida más nueva ya publicó o va a publicar lo suyo: no hay nada que corregir.');
  else if (upload === 'success') lineas.push('**Publicado.** El Direct Upload terminó y producción sirve esta corrida.');
  else lineas.push(`**No publicado: la subida terminó en \`${upload}\`.** El preflight había autorizado (${preflightReason}); revisa el paso de Cloudflare arriba. Se conserva el último deployment válido.`);
} else {
  const resultado = process.env.PREPARE_RESULT ? leer(path.resolve(process.env.PREPARE_RESULT)) : null;
  const problemas = leer(path.join(root, process.env.IDENTITY_ROOT || '.local-cache/identity', 'identity-problems.json'));
  const route = resultado?.informe?.route ?? process.env.ROUTE ?? 'desconocida';
  const routeReason = resultado?.informe?.route_reason ?? process.env.ROUTE_REASON ?? null;
  const decision = resultado?.decision ?? {};
  const refresh = resultado?.refresh ?? {};
  const informe = resultado?.informe ?? {};

  lineas.push(`## Preparación · ruta \`${route}\``, '');
  if (routeReason) lineas.push(`${routeReason}`, '');
  lineas.push('| campo | valor |', '| --- | --- |');
  lineas.push(`| refresco | \`${refresh.status ?? 'no ejecutado'}\`${refresh.reason ? ` · ${refresh.reason}` : ''} |`);
  if (informe.refresh_reason) lineas.push(`| por qué se refrescó | ${informe.refresh_reason} |`);
  lineas.push(`| decisión | \`${decision.action ?? 'sin decisión'}\` |`);
  if (decision.reason) lineas.push(`| motivo | ${decision.reason} |`);
  if (informe.revision_reused) lineas.push(`| revisión reutilizada | \`${informe.revision_reused}\` |`);
  if (informe.revision_generated) lineas.push(`| revisión generada | \`${informe.revision_generated}\` |`);
  // «Prevista», no «hecha»: el preflight y la subida vienen después y tienen su
  // propio resumen. Decir «deploy: sí» aquí hacía creer que ya estaba publicado.
  lineas.push(`| entrega prevista | ${decision.deploy ? 'sí — pendiente de preflight y subida' : 'no'} |`);

  // Lo que antes imprimía el bloque inline del workflow: la causa del rechazo,
  // la detección de validadores y los guardrails que se dispararon.
  if (refresh.error) lineas.push(`| causa | ${refresh.error} |`);
  if (refresh.detection?.reason) lineas.push(`| detección | ${refresh.detection.reason} |`);
  if (resultado?.execution && resultado.execution.ok === false) lineas.push(`| falló en | \`${resultado.execution.stage}\` · ${resultado.execution.error ?? 'sin mensaje'} |`);
  for (const motivo of refresh.quality?.reasons ?? []) lineas.push(`| guardrail | ${motivo} |`);

  // `no_op` es el resultado correcto de un push que no cambia lo publicado.
  // `fail_closed` con una entrega pedida es lo contrario y se marca como tal.
  if (!decision.deploy) {
    lineas.push('', decision.action === 'no_op'
      ? '**No-op esperado.** Nada que publicar en esta corrida; el deployment vigente se conserva.'
      : '**Entrega solicitada que no se publicó.** Se conserva el último deployment bueno; la causa está arriba.');
  }

  const identidad = resultado?.identity ?? resultado?.refresh?.identity ?? (problemas ? { status: problemas.status, problems: problemas.reasons ?? [], counts: problemas.counts ?? null } : null);
  if (identidad && identidad.status && identidad.status !== 'complete') {
    lineas.push('', '> [!WARNING]', `> **Identidad comercial ${identidad.status}.** Los precios se publican igual; las afirmaciones sin respaldo no.`);
    for (const motivo of (identidad.problems ?? []).slice(0, 20)) lineas.push(`> - ${typeof motivo === 'string' ? motivo : `${motivo.scope ?? 'identidad'}: ${motivo.reason}${motivo.affected != null ? ` (${motivo.affected})` : ''}`}`);
    if (identidad.counts) lineas.push('> ', `> Conteos: ${Object.entries(identidad.counts).map(([clave, valor]) => `${clave} ${valor}`).join(' · ')}`);
  } else if (identidad?.status === 'complete') {
    lineas.push('', 'Identidad comercial completa.');
  }
}

const texto = `${lineas.join('\n')}\n`;
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texto);
process.stdout.write(texto);
