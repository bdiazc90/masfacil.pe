// GLP en la consulta web: su propia página, «Gas Licuado de Petróleo
// Automotor», con un único producto ya elegido y la unidad en una sexta
// columna. Se lee en una pasada aparte, la última, y sus unidades se guardan en
// el mismo expediente sin entrar en lo que publican Gasolina y Diésel.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { FACILITO_GLP_URL, FACILITO_PAGES, FACILITO_PRODUCTS, FACILITO_URL, capturarLima, parseTabla } from '../pipeline/facilito/capture.mjs';
import { applyFacilitoRun, facilitoStateForProducts, facilitoStateId, facilitoUnitInstants } from '../pipeline/facilito/state.mjs';

const GLP = FACILITO_PRODUCTS.find((producto) => producto.key === 'glp');
const CABECERAS_GLP = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles)', 'Unidad de Medida'];
const CABECERAS = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles por galón)'];
const DISTRITOS = [{ nombre: 'ATE', codigo: '150103' }, { nombre: 'SAN LUIS', codigo: '150134' }];
const ETIQUETAS = { 126: 'Gasohol Regular', 127: 'Gasohol Premium', 40: 'DB5 S-50 UV', 49: 'GLP - Granel' };
const tablaGlp = (distrito, unidad = 'Galones') => ({ estado: 'ok', completo: true, total: 1, firma: 'x', seleccion: { valor: '49', texto: 'GLP - Granel' }, cabeceras: CABECERAS_GLP, filas: [[distrito, 'GASOCENTRO SAC', 'AV. GAS 1', '999999999', '7.49', unidad]] });
const tabla = (distrito, codigo) => (codigo === '49' ? tablaGlp(distrito) : { estado: 'ok', completo: true, total: 1, firma: 'x', cabeceras: CABECERAS, filas: [[distrito, 'GRIFO', 'AV. GRIFO 1', '999999999', 'S/ 19,49']] });

/** Navegador simulado que registra qué páginas abre y qué selects toca. */
function navegador(respuesta) {
  let distrito = null;
  let producto = null;
  let reloj = 1000;
  const registro = [];
  const ejecutar = (args) => {
    if (args[0] === 'open') { producto = args[1] === FACILITO_GLP_URL ? '49' : null; registro.push(`open ${args[1]}`); }
    if (args[0] === 'select') {
      registro.push(`select ${args[1]}`);
      if (args[1].includes('distrito')) distrito = DISTRITOS.find((d) => d.codigo === args[2]);
      if (args[1].includes('producto')) producto = args[2];
      reloj += 1;
      return '';
    }
    if (args[0] === '--json' && args[1] === 'eval') {
      const script = Buffer.from(args[3], 'base64').toString('utf8');
      const valor = script.includes('page.info') ? { seleccion: { valor: producto, texto: ETIQUETAS[producto] }, ...respuesta(distrito, producto) } : { t: (reloj += 1), distritos: DISTRITOS };
      return JSON.stringify({ result: valor });
    }
    return '';
  };
  return { ejecutar, registro };
}

test('la tabla de GLP exige sus seis columnas y galones en cada fila', () => {
  const pagina = FACILITO_PAGES.granel_glp;
  const leido = parseTabla(tablaGlp('ATE'), 'ATE', { producto: GLP, pagina });
  assert.deepEqual([leido.ok, leido.filas.length, leido.filas[0].precio], [true, 1, 7.49]);
  assert.equal('establecimiento' in leido.filas[0], false, 'razón social y dirección se vuelven huella');
  assert.equal(parseTabla(tablaGlp('ATE', 'Kilogramos'), 'ATE', { producto: GLP, pagina }).razon, 'unidad_no_coincide');
  assert.equal(parseTabla({ ...tablaGlp('ATE'), cabeceras: CABECERAS }, 'ATE', { producto: GLP, pagina }).razon, 'cabeceras_desconocidas');
  // Y al revés: la tabla de GLP no pasa por la automotora.
  assert.equal(parseTabla(tablaGlp('ATE'), 'ATE').razon, 'cabeceras_desconocidas');
  assert.equal(parseTabla({ ...tablaGlp('ATE'), seleccion: { valor: '49', texto: 'GLP - Envasado' } }, 'ATE', { producto: GLP, pagina }).razon, 'producto_no_coincide');
});

test('GLP se lee en su página, al final y sin tocar el select de producto', () => {
  const { ejecutar, registro } = navegador((d, codigo) => tabla(d.nombre, codigo));
  const resultado = capturarLima({ ejecutar });
  assert.deepEqual(resultado.passes.map((p) => p.name), ['gasolina', 'diesel', 'glp']);
  assert.deepEqual(registro.filter((linea) => linea.startsWith('open')), [`open ${FACILITO_URL}`, `open ${FACILITO_URL}`, `open ${FACILITO_GLP_URL}`]);
  const desdeGlp = registro.slice(registro.lastIndexOf(`open ${FACILITO_GLP_URL}`));
  assert.equal(desdeGlp.some((linea) => linea.includes('producto')), false);
  const unidades = resultado.units.filter((u) => u.status === 'ok');
  assert.deepEqual(unidades.filter((u) => u.product === 'glp').map((u) => u.source_url), [FACILITO_GLP_URL, FACILITO_GLP_URL]);
  assert.equal(unidades.filter((u) => u.product !== 'glp').some((u) => 'source_url' in u), false, 'las unidades automotoras no cambian de forma');
});

test('un bloqueo en la página de GLP conserva todo lo leído de Gasolina y Diésel', () => {
  const { ejecutar } = navegador((d, codigo) => (codigo === '49' ? { rechazo: 'rechazo_http' } : tabla(d.nombre, codigo)));
  const resultado = capturarLima({ ejecutar });
  assert.equal(resultado.blocked?.codigo, 'rechazo_http');
  assert.equal(resultado.units.filter((u) => ['regular', 'premium', 'diesel'].includes(u.product) && u.status === 'ok').length, 6);
});

test('en el expediente, GLP no entra en lo que publican Gasolina y Diésel', () => {
  const unidad = (codigo, producto, hora, extra = {}) => ({ district_code: codigo, district_name: 'ATE', product: producto, status: 'ok', observed_at: `2026-09-24T${hora}:00:00.000Z`, announced_total: 1, rows: [{ key_hash: 'k', price: 1 }], ...extra });
  const antes = applyFacilitoRun(null, [unidad('150103', 'regular', '10'), unidad('150103', 'diesel', '10')], { attemptedAt: '2026-09-24T10:05:00.000Z', contract: 'scrap-facilito/v1', sourceUrl: FACILITO_URL });
  const despues = applyFacilitoRun(antes, [unidad('150103', 'glp', '11', { source_url: FACILITO_GLP_URL })], { attemptedAt: '2026-09-24T11:05:00.000Z', contract: 'scrap-facilito/v1', sourceUrl: FACILITO_URL });
  assert.equal(despues.units['150103:glp'].source_url, FACILITO_GLP_URL);
  assert.equal('source_url' in despues.units['150103:regular'], false);
  assert.equal(despues.source_url, FACILITO_URL);
  for (const productos of [['regular', 'premium'], ['diesel']]) {
    const propio = facilitoStateForProducts(despues, productos);
    assert.deepEqual(Object.keys(propio.units).map((clave) => clave.split(':')[1]).filter((p) => p === 'glp'), []);
    assert.equal(facilitoStateId(propio), '2026-09-24T10:00:00.000Z', 'una consulta de GLP no rejuvenece a los demás');
    assert.deepEqual(facilitoUnitInstants(propio), facilitoUnitInstants(facilitoStateForProducts(antes, productos)));
    assert.equal(Object.keys(propio.last_run.by_product).includes('glp'), false);
  }
});
