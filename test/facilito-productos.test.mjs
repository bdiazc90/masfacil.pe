// Un segundo combustible en la consulta web sin tocar lo que ya funciona.
//
// Diésel se lee en su propia pasada, después de Gasolina: un problema de su
// tabla no puede costarle a Gasolina un distrito. Y el expediente, que es uno,
// se cuenta por grupo: las consultas de Diésel no entran en el estado que
// publica Gasolina ni en lo que el preflight compara unidad por unidad.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { dataStateRegressions } from '../app/publication-policy.mjs';
import { capturarLima } from '../pipeline/facilito/capture.mjs';
import { applyFacilitoRun, facilitoRunCounts, facilitoStateForProducts, facilitoStateId, facilitoUnitInstants } from '../pipeline/facilito/state.mjs';

const CABECERAS = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles por galón)'];
const CABECERAS_GLP = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles)', 'Unidad de Medida'];
const DISTRITOS = [{ nombre: 'ATE', codigo: '150103' }, { nombre: 'SAN LUIS', codigo: '150134' }];
const ETIQUETAS_DEL_SITIO = { 126: 'Gasohol Regular', 127: 'Gasohol Premium', 40: 'DB5 S-50 UV', 49: 'GLP - Granel' };
// La página de GLP (código 49) trae una sexta columna con la unidad.
const tabla = (distrito, codigo = '126') => (codigo === '49'
  ? { estado: 'ok', completo: true, total: 1, firma: 'x', cabeceras: CABECERAS_GLP, filas: [[distrito, 'GASOCENTRO', 'AV. GAS 1', '999999999', 'S/ 7,49', 'Galones']] }
  : { estado: 'ok', completo: true, total: 1, firma: 'x', cabeceras: CABECERAS, filas: [[distrito, 'GRIFO', 'AV. GRIFO 1', '999999999', 'S/ 19,49']] });

/** Navegador simulado: `respuesta(distrito, código)` decide qué ve cada unidad. */
function navegador(respuesta, etiquetas = ETIQUETAS_DEL_SITIO) {
  let distrito = null;
  let producto = null;
  let reloj = 1000;
  return (args) => {
    // La página de GLP abre con su único producto ya elegido.
    if (args[0] === 'open') producto = args[1].includes('buscadorAGranelGLP') ? '49' : null;
    if (args[0] === 'select') {
      if (args[1].includes('distrito')) distrito = DISTRITOS.find((d) => d.codigo === args[2]);
      if (args[1].includes('producto')) producto = args[2];
      reloj += 1;
      return '';
    }
    if (args[0] === '--json' && args[1] === 'eval') {
      const script = Buffer.from(args[3], 'base64').toString('utf8');
      const valor = script.includes('page.info')
        ? { seleccion: { valor: producto, texto: etiquetas[producto] ?? '' }, ...respuesta(distrito, producto) }
        : { t: (reloj += 1), distritos: DISTRITOS };
      return JSON.stringify({ result: valor });
    }
    return '';
  };
}
const estados = (resultado) => Object.fromEntries(resultado.units.map((u) => [`${u.district_name}:${u.product}`, u.status]));

test('Diésel se lee aparte y su tabla rota no le cuesta nada a Gasolina', () => {
  // `sin_tabla` es reintentable: antes, un fallo así hacía caer el distrito entero.
  const resultado = capturarLima({ ejecutar: navegador((d, codigo) => (codigo === '40' ? { estado: 'sin_tabla' } : tabla(d.nombre, codigo))) });
  assert.equal(resultado.blocked, null);
  assert.deepEqual(resultado.passes.map((p) => [p.name, p.products]), [['gasolina', ['regular', 'premium']], ['diesel', ['diesel']], ['glp', ['glp']]]);
  assert.deepEqual(estados(resultado), {
    'ATE:regular': 'ok', 'ATE:premium': 'ok', 'SAN LUIS:regular': 'ok', 'SAN LUIS:premium': 'ok',
    'ATE:diesel': 'sin_tabla', 'SAN LUIS:diesel': 'sin_tabla',
    'ATE:glp': 'ok', 'SAN LUIS:glp': 'ok',
  });
});

test('si el código no muestra la etiqueta esperada, falla solo esa unidad', () => {
  // Un sitio que reasignara el 40 a otro producto no puede colar esos precios como Diésel.
  const resultado = capturarLima({ ejecutar: navegador((d, codigo) => tabla(d.nombre, codigo), { ...ETIQUETAS_DEL_SITIO, 40: 'Gasohol Regular' }) });
  assert.deepEqual(estados(resultado), {
    'ATE:regular': 'ok', 'ATE:premium': 'ok', 'SAN LUIS:regular': 'ok', 'SAN LUIS:premium': 'ok',
    'ATE:diesel': 'producto_no_coincide', 'SAN LUIS:diesel': 'producto_no_coincide',
    'ATE:glp': 'ok', 'SAN LUIS:glp': 'ok',
  });
});

test('un bloqueo en la pasada de Diésel detiene todo y conserva lo ya leído', () => {
  const resultado = capturarLima({ ejecutar: navegador((d, codigo) => (codigo === '40' ? { rechazo: 'desafio_o_rechazo' } : tabla(d.nombre, codigo))) });
  assert.equal(resultado.blocked?.codigo, 'desafio_o_rechazo');
  assert.equal(resultado.units.filter((u) => u.product !== 'diesel' && u.status === 'ok').length, 4);
  assert.equal(resultado.units.some((u) => u.district_name === 'SAN LUIS' && u.product === 'diesel'), false, 'no se sigue golpeando el mismo muro');
  assert.deepEqual(resultado.passes.map((p) => p.name), ['gasolina', 'diesel'], 'tampoco se abre la página de GLP');
});

test('`soloProductos` recorre solo lo pedido', () => {
  const resultado = capturarLima({ ejecutar: navegador((d) => tabla(d.nombre)), soloProductos: ['diesel'] });
  assert.deepEqual(resultado.passes.map((p) => p.name), ['diesel']);
  assert.deepEqual(estados(resultado), { 'ATE:diesel': 'ok', 'SAN LUIS:diesel': 'ok' });
});

// --- El expediente contado por grupo ----------------------------------------

const unidad = (codigo, product, observed_at, status = 'ok') => (status === 'ok'
  ? { district_code: codigo, district_name: codigo, product, status, observed_at, announced_total: 1, rows: [{ key_hash: `${codigo}${product}`, price: 19.49 }] }
  : { district_code: codigo, district_name: codigo, product, status });
const GASOLINA = ['regular', 'premium'];

test('las consultas de Diésel no entran en el estado de Gasolina', () => {
  const soloGasolina = [unidad('150103', 'regular', '2026-09-24T10:00:00.000Z'), unidad('150103', 'premium', '2026-09-24T10:00:05.000Z'), unidad('150134', 'regular', '2026-09-24T10:00:09.000Z', 'timeout_de_comando')];
  const conDiesel = [...soloGasolina, unidad('150103', 'diesel', '2026-09-24T10:20:00.000Z'), unidad('150134', 'diesel', '2026-09-24T10:21:00.000Z')];
  const opciones = { attemptedAt: '2026-09-24T10:00:00.000Z' };
  const sin = facilitoStateForProducts(applyFacilitoRun(null, soloGasolina, opciones), GASOLINA);
  const con = facilitoStateForProducts(applyFacilitoRun(null, conDiesel, opciones), GASOLINA);
  // La consulta de Diésel es la más reciente y aun así no mueve el de Gasolina.
  assert.equal(facilitoStateId(con), facilitoStateId(sin));
  assert.equal(facilitoStateId(con), '2026-09-24T10:00:05.000Z');
  assert.deepEqual(facilitoUnitInstants(con), facilitoUnitInstants(sin));
  assert.deepEqual(facilitoRunCounts(con), facilitoRunCounts(sin));
  assert.deepEqual(facilitoRunCounts(con), { fresh: 2, reused: 0, failed: 1 });
});

test('un expediente anterior al desglose conserva sus conteos globales', () => {
  // Así era el expediente con solo Gasolina: `last_run` sin `by_product`.
  const anterior = applyFacilitoRun(null, [unidad('150103', 'regular', '2026-09-20T10:00:00.000Z')], { attemptedAt: '2026-09-20T10:00:00.000Z' });
  delete anterior.last_run.by_product;
  // Una unidad de Diésel añadida por fuera no altera nada de lo que publica Gasolina.
  const conDiesel = { ...anterior, units: { ...anterior.units, '150103:diesel': unidad('150103', 'diesel', '2026-09-20T11:00:00.000Z') } };
  const propio = facilitoStateForProducts(conDiesel, GASOLINA);
  assert.deepEqual(facilitoRunCounts(propio), facilitoRunCounts(anterior));
  assert.deepEqual(facilitoUnitInstants(propio), facilitoUnitInstants(anterior));
});

test('claves ajenas en un estado publicado no bloquean el deploy de Gasolina', () => {
  // Un estado publicado por código anterior al filtro, con consultas de Diésel dentro.
  const publicado = {
    snapshot_id: 'S1',
    products: { regular: {}, premium: {} },
    facilito: { units_observed: { '150103:regular': '2026-09-24T10:00:00.000Z', '150103:diesel': '2026-09-24T10:20:00.000Z' } },
  };
  const candidato = { snapshot_id: 'S1', products: { regular: {}, premium: {} }, facilito: { units_observed: { '150103:regular': '2026-09-24T16:00:00.000Z' } } };
  assert.deepEqual(dataStateRegressions(candidato, publicado), []);
  // Lo propio sigue comparándose: una unidad de Gasolina que retrocede se rechaza.
  const atrasado = { ...candidato, facilito: { units_observed: { '150103:regular': '2026-09-24T09:00:00.000Z' } } };
  assert.equal(dataStateRegressions(atrasado, publicado).length, 1);
});
