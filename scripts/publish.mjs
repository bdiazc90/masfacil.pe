#!/usr/bin/env node

// CLI fino de la preparación: traduce env a opciones, llama a `prepareRelease`
// y deja el resultado escrito. No decide nada por su cuenta.
//
//   ROUTE=shell npm run publish
//
// SIEMPRE escribe `prepare-result.json` antes de salir, incluso si el módulo
// lanza: el paso del workflow lee ese archivo y un resultado ausente o ilegible
// no puede dejar la corrida en verde con el rechazo invisible.
//
// Códigos de salida: 0 = decidido (deploy o no-op); 1 = entrega pedida que no
// se publicó, o error interno.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRelease } from '../pipeline/prepare-release.mjs';
import { refreshOptionsFromEnv } from '../pipeline/refresh-snapshot.mjs';
import { pruneInCi } from '../pipeline/snapshot-prune.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = process.env.PREPARE_RESULT ? path.resolve(process.env.PREPARE_RESULT) : path.join(root, '.local-cache', 'publish', 'prepare-result.json');

function escribirResultado(payload) {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resultPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${payload.decision?.deploy === true}\n`);
}

let resultado;
try {
  resultado = await prepareRelease({
    root,
    route: process.env.ROUTE || 'data',
    routeReason: process.env.ROUTE_REASON || null,
    forceProject: process.env.FORCE_PROJECT === '1',
    identityRoot: process.env.IDENTITY_ROOT || null,
    // Las mismas env que entiende `npm run refresh`, para que las dos entradas
    // se comporten igual: línea base pública, inputs de bootstrap, tiempo de
    // sondeo y origen de prueba.
    refreshOptions: refreshOptionsFromEnv(process.env, []),
  });
} catch (error) {
  resultado = {
    ok: false,
    route: process.env.ROUTE || 'data',
    route_reason: process.env.ROUTE_REASON || null,
    refresh: { status: 'rejected', error: error.message },
    decision: { action: 'fail_closed', project: false, verify: false, deploy: false, reason: 'la preparación falló antes de decidir; se conserva el último deployment bueno' },
    execution: { stage: 'prepare', ok: false, error: error.message },
    informe: { route: process.env.ROUTE || 'data', route_reason: process.env.ROUTE_REASON || null, deploy: false },
    identity: null,
    error: error.message,
  };
}

// Solo en CI y antes de que la caché de Actions guarde la carpeta: sin poda,
// cada CSV nuevo se queda para siempre en la caché. En local no se toca nada.
// Corre antes del deploy, así que protege lo que sirve producción; si la
// preparación falló antes de leerlo, no poda. Una poda que falla no cambia la
// decisión de publicar; queda dicho.
try {
  const poda = pruneInCi({ root, production: resultado.production });
  if (poda) resultado.prune = poda;
} catch (error) { resultado.prune = { status: 'failed', error: error.message }; }

escribirResultado(resultado);
process.stdout.write(`${JSON.stringify(resultado)}\n`);
if (!resultado.ok) process.exitCode = 1;
