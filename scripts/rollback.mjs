#!/usr/bin/env node
//   npm run rollback -- <snapshot-id> [<revision-id>] [--group gasolina|diesel|glp]
//
// El grupo se elige de forma explícita; sin `--group` es Gasolina, como siempre.
// Recuperar un grupo no toca los demás, y el de Gasolina restaura siempre el par.
// La lógica vive en `pipeline/rollback.mjs`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollbackGroup } from '../pipeline/rollback.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argumentos = process.argv.slice(2);
const bandera = argumentos.indexOf('--group');
const grupo = bandera >= 0 ? argumentos[bandera + 1] : 'gasolina';
const posicionales = bandera >= 0 ? argumentos.filter((_, indice) => indice !== bandera && indice !== bandera + 1) : argumentos;
const [snapshotId, revisionId = null] = posicionales;
if (!snapshotId || !grupo) throw new Error('Uso: npm run rollback -- <snapshot-id> [<revision-id>] [--group gasolina|diesel|glp]');

process.stdout.write(`${JSON.stringify(await rollbackGroup({ root, group: grupo, snapshotId, revisionId }))}\n`);
