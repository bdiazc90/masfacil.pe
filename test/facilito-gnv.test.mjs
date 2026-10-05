// GNV en la consulta web: su propia página, «Gas Natural Vehicular», con el
// comprimido (`131`) ya elegido y la unidad en la cabecera del precio. Se lee en
// una pasada aparte, la última, sin tocar el select de producto, y sus unidades
// no entran en lo que publican los demás grupos.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FACILITO_GNV_URL,
  FACILITO_PAGES,
  FACILITO_PRODUCTS,
  FACILITO_URL,
  capturarLima,
  parseTabla,
} from '../pipeline/facilito/capture.mjs';
import { applyFacilitoRun, facilitoStateForProducts, facilitoStateId } from '../pipeline/facilito/state.mjs';

const GNV = FACILITO_PRODUCTS.find((producto) => producto.key === 'gnv');
const pagina = FACILITO_PAGES.gnv;
const CABECERAS_GNV = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles/m3)'];
const CABECERAS = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles por galón)'];
const tablaGnv = (distrito, seleccion = { valor: '131', texto: 'Gas Natural Vehicular Comprimido' }) => ({
  estado: 'ok',
  completo: true,
  total: 1,
  firma: 'x',
  seleccion,
  cabeceras: CABECERAS_GNV,
  filas: [[distrito, 'GNV SAC', 'AV. GNV 1', '999999999', 'S/ 1,77']],
});

test('la tabla de GNV exige su cabecera en metros cúbicos y el comprimido elegido', () => {
  const leido = parseTabla(tablaGnv('ATE'), 'ATE', { producto: GNV, pagina });
  assert.deepEqual([leido.ok, leido.filas.length, leido.filas[0].precio], [true, 1, 1.77]);
  assert.equal('establecimiento' in leido.filas[0], false, 'razón social y dirección se vuelven huella');
  // El licuefactado es otra opción del mismo select: sus precios no son GNV.
  assert.equal(
    parseTabla(tablaGnv('ATE', { valor: '129', texto: 'Gas Natural Vehicular Licuefactado' }), 'ATE', {
      producto: GNV,
      pagina,
    }).razon,
    'producto_no_coincide',
  );
  // Una tabla por galón no pasa por la de GNV, ni al revés.
  assert.equal(
    parseTabla({ ...tablaGnv('ATE'), cabeceras: CABECERAS }, 'ATE', { producto: GNV, pagina }).razon,
    'cabeceras_desconocidas',
  );
  assert.equal(parseTabla(tablaGnv('ATE'), 'ATE').razon, 'cabeceras_desconocidas');
});

test('GNV se lee en su página, al final y sin tocar el select de producto', () => {
  const distritos = [{ nombre: 'ATE', codigo: '150103' }];
  let distrito = null;
  let producto = null;
  let reloj = 1000;
  const registro = [];
  const ejecutar = (args) => {
    if (args[0] === 'open') {
      producto = args[1] === FACILITO_GNV_URL ? '131' : null;
      registro.push(`open ${args[1]}`);
    }
    if (args[0] === 'select') {
      registro.push(`select ${args[1]}`);
      if (args[1].includes('distrito')) distrito = distritos.find((d) => d.codigo === args[2]);
      if (args[1].includes('producto')) producto = args[2];
      reloj += 1;
      return '';
    }
    if (args[0] === '--json' && args[1] === 'eval') {
      const script = Buffer.from(args[3], 'base64').toString('utf8');
      const valor = script.includes('page.info')
        ? tablaGnv(distrito.nombre, { valor: producto, texto: 'Gas Natural Vehicular Comprimido' })
        : { t: (reloj += 1), distritos };
      return JSON.stringify({ result: valor });
    }
    return '';
  };
  const resultado = capturarLima({ ejecutar, soloProductos: ['gnv'] });
  assert.deepEqual(
    resultado.passes.map((p) => p.name),
    ['gnv'],
  );
  assert.deepEqual(
    registro.filter((linea) => linea.startsWith('open')),
    [`open ${FACILITO_GNV_URL}`],
  );
  assert.equal(
    registro.some((linea) => linea.includes('producto')),
    false,
  );
  assert.deepEqual(
    resultado.units.map((u) => [u.product, u.status, u.source_url]),
    [['gnv', 'ok', FACILITO_GNV_URL]],
  );
});

test('en el expediente, GNV no entra en lo que publican los demás grupos', () => {
  const unidad = (producto, hora, extra = {}) => ({
    district_code: '150103',
    district_name: 'ATE',
    product: producto,
    status: 'ok',
    observed_at: `2026-09-24T${hora}:00:00.000Z`,
    announced_total: 1,
    rows: [{ key_hash: 'k', price: 1 }],
    ...extra,
  });
  const antes = applyFacilitoRun(null, [unidad('regular', '10'), unidad('diesel', '10'), unidad('glp', '10')], {
    attemptedAt: '2026-09-24T10:05:00.000Z',
    contract: 'scrap-facilito/v1',
    sourceUrl: FACILITO_URL,
  });
  const despues = applyFacilitoRun(antes, [unidad('gnv', '11', { source_url: FACILITO_GNV_URL })], {
    attemptedAt: '2026-09-24T11:05:00.000Z',
    contract: 'scrap-facilito/v1',
    sourceUrl: FACILITO_URL,
  });
  for (const productos of [['regular', 'premium'], ['diesel'], ['glp']]) {
    const propio = facilitoStateForProducts(despues, productos);
    assert.equal(
      Object.keys(propio.units).some((clave) => clave.endsWith(':gnv')),
      false,
    );
    assert.equal(facilitoStateId(propio), '2026-09-24T10:00:00.000Z', 'una consulta de GNV no rejuvenece a los demás');
  }
  assert.equal(facilitoStateId(facilitoStateForProducts(despues, ['gnv'])), '2026-09-24T11:00:00.000Z');
});
