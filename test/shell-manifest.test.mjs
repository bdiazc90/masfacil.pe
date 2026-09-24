// La versión del shell tiene que moverse cuando cambian las cabeceras.
//
// El service worker guarda la portada con su CSP y la sirve así, sin volver a
// pedirla. Si un cambio solo en `web/_headers` no cambiara la versión, quien ya
// tiene la app instalada seguiría con la cabecera vieja indefinidamente.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deriveShell } from '../pipeline/shell-manifest.mjs';

test('cambiar web/_headers cambia la versión del shell, no su lista', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-shell-'));
  try {
    const origen = path.resolve(new URL('..', import.meta.url).pathname, 'web');
    fs.cpSync(origen, path.join(raiz, 'web'), { recursive: true, filter: (src) => !path.relative(origen, src).startsWith('data') });
    const antes = deriveShell({ root: raiz });
    fs.appendFileSync(path.join(raiz, 'web', '_headers'), '\n# cambio de prueba\n');
    const despues = deriveShell({ root: raiz });
    assert.deepEqual(antes.problems, []);
    assert.deepEqual(despues.entries, antes.entries, '_headers no entra en la precache');
    assert.notEqual(despues.cache, antes.cache);
  } finally { fs.rmSync(raiz, { recursive: true, force: true }); }
});
