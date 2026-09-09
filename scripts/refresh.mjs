#!/usr/bin/env node

// Envoltorio CLI del refresco. La lógica vive en `pipeline/refresh-snapshot.mjs`
// y se puede llamar en proceso; aquí solo se traducen env y argv a opciones, se
// imprime el resultado y se conservan los códigos de salida de siempre:
//
//   0  decidido (unchanged o promoted)
//   1  rechazado
//   2  no verificable o pendiente de revisión
//
//   npm run refresh

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshOptionsFromEnv, refreshSnapshot } from '../pipeline/refresh-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const result = await refreshSnapshot({ root, ...refreshOptionsFromEnv() });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'unverifiable' || result.status === 'needs_review') process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'rejected', error: error.message })}\n`);
  process.exitCode = 1;
}
