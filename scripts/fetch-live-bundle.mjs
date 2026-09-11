#!/usr/bin/env node

// Recupera el bundle público ya publicado en Pages (manifest, refresh-state y
// los dos snapshots, ~500 KB) y lo deja en web/data/gasolina/ verificado por
// bytes y SHA-256. Así un cambio de shell se despliega reusando los datos
// vigentes sin proyectar ni descargar el raw de Osinergmin.
//
//   npm run fetch:live -- https://masfacil.pe
//
// La descarga y la escritura viven en `pipeline/live-bundle.mjs`: el observador
// del histórico usa solo la primera, porque no puede escribir sobre el bundle
// que otra corrida esté usando.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLiveBundle, writeLiveBundle } from '../pipeline/live-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await fetchLiveBundle({ origin: process.argv[2] });
process.stdout.write(`${JSON.stringify(writeLiveBundle(bundle, { root }))}\n`);
