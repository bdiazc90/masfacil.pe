#!/usr/bin/env node

// Recupera el bundle público ya publicado en Pages de CADA grupo activo
// (manifest, refresh-state y snapshots) y lo deja en `web/<raíz del grupo>/`,
// verificado por bytes y SHA-256. Así un cambio de shell se despliega reusando
// los datos vigentes sin proyectar ni descargar el raw de Osinergmin. Si un grupo
// no se puede leer o validar, no se escribe ninguno.
//
//   npm run fetch:live -- https://masfacil.pe
//
// La descarga y la escritura viven en `pipeline/live-bundle.mjs`: el observador
// del histórico usa solo la descarga de Gasolina, porque no puede escribir sobre
// el bundle que otra corrida esté usando.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLiveGroups, writeLiveGroups } from '../pipeline/live-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundles = await fetchLiveGroups({ origin: process.argv[2] });
process.stdout.write(`${JSON.stringify(writeLiveGroups(bundles, { root }))}\n`);
