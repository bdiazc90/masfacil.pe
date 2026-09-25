#!/usr/bin/env node

// Envoltorio CLI del refresco. La lógica vive en `pipeline/refresh-snapshot.mjs`
// y se puede llamar en proceso; aquí solo se traducen env y argv a opciones, se
// imprime el resultado y se conservan los códigos de salida de siempre, con el
// peor estado entre las fuentes refrescadas:
//
//   0  decidido (unchanged o promoted)
//   1  rechazado
//   2  no verificable o pendiente de revisión
//
//   npm run refresh                 todas las fuentes
//   npm run refresh -- glp-current  una sola

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshOptionsFromEnv, refreshSnapshot } from '../pipeline/refresh-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = await refreshSnapshot({ root, ...refreshOptionsFromEnv() });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const estados = Object.values(result.sources ?? { unica: result }).map((fuente) => fuente.status);
  if (estados.includes('rejected')) process.exitCode = 1;
  else if (estados.some((estado) => estado === 'unverifiable' || estado === 'needs_review')) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'rejected', error: error.message })}\n`);
  process.exitCode = 1;
}
