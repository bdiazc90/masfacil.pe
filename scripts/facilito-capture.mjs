#!/usr/bin/env node

// Una corrida de consulta web. Lee Lima provincia distrito por distrito, guarda
// lo que quedó comprobado en el expediente privado y no toca `web/`.
//
// No escribe nunca una fila en stdout: el log público de Actions vería razón
// social y dirección de cada grifo de Lima. Lo que sale son conteos, duración y
// motivos de fallo, que es lo que hace falta para saber si la corrida sirvió.
//
//   node scripts/facilito-capture.mjs [-v] [--districts "ATE,SAN LUIS"] [--products diesel,glp]
//
// Salidas: 0 con captura utilizable, 1 si no se pudo capturar nada, 2 en args.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentBrowserSession, capturarLima, CAPTURE_CONTRACT, FACILITO_PRODUCTS, FACILITO_URL } from '../pipeline/facilito/capture.mjs';
import { applyFacilitoRun, facilitoStateId, readFacilitoState, writeFacilitoState } from '../pipeline/facilito/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opciones = { verbose: false, districts: null, products: null, budgetMs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-v' || arg === '--verbose') opciones.verbose = true;
    else if (arg === '--districts') opciones.districts = String(argv[++i] ?? '').split(',').map((d) => d.trim()).filter(Boolean);
    else if (arg === '--products') opciones.products = String(argv[++i] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    else if (arg === '--budget-ms') opciones.budgetMs = Number(argv[++i]);
    else throw new Error(`argumento desconocido: ${arg}`);
  }
  if (opciones.budgetMs !== null && (!Number.isFinite(opciones.budgetMs) || opciones.budgetMs < 30_000)) throw new Error('presupuesto inválido');
  if (opciones.products && (!opciones.products.length || opciones.products.some((p) => !FACILITO_PRODUCTS.some((producto) => producto.key === p)))) throw new Error('producto desconocido');
  if (opciones.districts && !opciones.districts.length) throw new Error('lista de distritos vacía');
  return opciones;
}

function main() {
  let opciones;
  try { opciones = parseArgs(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\nUso: node scripts/facilito-capture.mjs [-v] [--districts "ATE,SAN LUIS"] [--products regular,premium,diesel,glp] [--budget-ms N]\n`);
    process.exitCode = 2;
    return;
  }

  const log = (linea) => { if (opciones.verbose) process.stderr.write(`${linea}\n`); };
  const facilitoRoot = process.env.FACILITO_ROOT || undefined;
  const attemptedAt = new Date().toISOString();
  const resultado = capturarLima({
    ejecutar: agentBrowserSession({ cwd: ROOT, session: `facilito-${process.pid}-${Date.now()}` }),
    log,
    budgetMs: opciones.budgetMs,
    soloDistritos: opciones.districts,
    soloProductos: opciones.products,
  });

  const previo = readFacilitoState(ROOT, { facilitoRoot });
  const estado = applyFacilitoRun(previo, resultado.units, { attemptedAt, contract: CAPTURE_CONTRACT, sourceUrl: FACILITO_URL });
  writeFacilitoState(ROOT, estado, { facilitoRoot });

  const ok = resultado.units.filter((u) => u.status === 'ok');
  const motivos = {};
  for (const unidad of resultado.units) if (unidad.status !== 'ok') motivos[unidad.status] = (motivos[unidad.status] ?? 0) + 1;
  const resumen = {
    contrato: CAPTURE_CONTRACT,
    intentado_en: attemptedAt,
    duracion_ms: resultado.elapsed_ms,
    distritos_en_el_select: resultado.districts.length,
    unidades: { comprobadas: ok.length, fallidas: resultado.units.length - ok.length, motivos },
    filas_comprobadas: ok.reduce((total, unidad) => total + unidad.rows.length, 0),
    // Una fila sin las tres partes del texto no puede vincularse con nadie; se
    // cuenta para que el hueco se vea y no parezca que la tabla venía corta.
    filas_sin_clave: ok.reduce((total, unidad) => total + (unidad.dropped_rows ?? 0), 0),
    expediente: { unidades: Object.keys(estado.units).length, state_id: facilitoStateId(estado) },
    // Por producto y por pasada, para ver en el log público si Diésel cuesta
    // tiempo o unidades a Gasolina sin mirar una sola fila.
    productos: Object.fromEntries(FACILITO_PRODUCTS.filter((p) => resultado.units.some((u) => u.product === p.key)).map((p) => {
      const propias = resultado.units.filter((u) => u.product === p.key);
      const buenas = propias.filter((u) => u.status === 'ok');
      return [p.key, { comprobadas: buenas.length, fallidas: propias.length - buenas.length, filas: buenas.reduce((total, unidad) => total + unidad.rows.length, 0) }];
    })),
    pasadas: resultado.passes.map((p) => ({ pasada: p.name, duracion_ms: p.elapsed_ms, bloqueo: p.blocked })),
    bloqueo: resultado.blocked,
  };
  process.stdout.write(`${JSON.stringify(resumen, null, 2)}\n`);
  // Sin una sola unidad nueva la corrida no sirvió, aunque el expediente
  // anterior siga siendo válido: quien llama decide si eso frena la publicación.
  if (!ok.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
