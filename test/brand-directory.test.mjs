// Comprobaciones puntuales del emparejador de directorios de marca.
//
// No es una suite: son los casos donde un error no se ve en la tarjeta y sí
// atribuye una bandera ajena —un distrito que falta, una coordenada redondeada,
// dos candidatos empatados, una ficha repetida, dos cadenas que reclaman el
// mismo grifo— y que por eso conviene fijar.
//
//   node --test test/
//
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';
import { analizarDireccion, emparejarDirectorios } from '../scripts/brand-directory.mjs';

const id = (letra) => `est_${letra.repeat(24)}`;
const sitio = (letra, direccion, { distrito = 'SANTIAGO DE SURCO', razon = `INVERSIONES ${letra.toUpperCase()} SAC`, latitude, longitude }) => ({ establishment_id: id(letra), distrito, direccion, razon_social: razon, latitude, longitude });
const directorio = (archivo, brand, entries) => ({ archivo, brand, source_url: `https://example.test/${archivo}`, evidenced_at: '2026-07-24T12:00:00.000Z', consulted_at: '2026-09-17T12:00:00.000Z', entries });
const ficha = (name, address, latitude, longitude, district = '') => ({ name, address, district, latitude, longitude });

test('sin distrito: confirma vía y puerta, no la cercanía ni la vía sola', () => {
  const sitios = [
    sitio('a', 'AV. JAVIER PRADO ESTE N° 4350', { latitude: -12.0900, longitude: -76.9800 }),
    // Más cerca de la ficha, pero sin nada textual en común.
    sitio('b', 'AV. LA FONTANA N° 100', { latitude: -12.09012, longitude: -76.98034 }),
  ];
  const conPuerta = emparejarDirectorios({ sitios, directorios: [directorio('primax.json', 'Primax', [ficha('E/S HIPODROMO', 'Av. Javier Prado Este 4350', -12.090123, -76.980345)])] });
  assert.deepEqual(conPuerta.aceptadas.map((item) => [item.establishment_id, item.estrato]), [[id('a'), 'sin_distrito_coordenada_precisa']]);

  const viaSola = emparejarDirectorios({ sitios, directorios: [directorio('primax.json', 'Primax', [ficha('E/S HIPODROMO', 'Av. Javier Prado Este', -12.090123, -76.980345)])] });
  assert.equal(viaSola.aceptadas.length, 0);
  assert.equal(viaSola.pendientes[0].motivo, 'sin_corroboracion');

  // Un distrito declarado y distinto sí descarta el vínculo.
  const contradictorio = emparejarDirectorios({ sitios, directorios: [directorio('repsol.json', 'Repsol', [ficha('HIPODROMO', 'AV. JAVIER PRADO ESTE 4350', -12.090123, -76.980345, 'LA MOLINA')])] });
  assert.equal(contradictorio.aceptadas.length, 0);
  assert.equal(contradictorio.pendientes[0].motivo, 'distrito_contradictorio');
});

test('coordenada imprecisa: la ventana sigue la precisión y el número de la vía no es puerta', () => {
  const sitios = [
    // El grifo real, a ~620 m del punto redondeado.
    sitio('c', 'AV. UNIVERSITARIA N° 6500', { distrito: 'LOS OLIVOS', latitude: -12.1140, longitude: -77.0340 }),
    // Sobre el punto redondeado, en la misma avenida y con otra puerta.
    sitio('d', 'AV. UNIVERSITARIA N° 5200', { distrito: 'LOS OLIVOS', latitude: -12.1101, longitude: -77.0301 }),
  ];
  const aproximada = emparejarDirectorios({ sitios, directorios: [directorio('primax.json', 'Primax', [ficha('E/S LOS OLIVOS', 'Av. Universitaria 6500', -12.11, -77.03)])] });
  assert.deepEqual(aproximada.aceptadas.map((item) => [item.establishment_id, item.estrato]), [[id('c'), 'sin_distrito_coordenada_aproximada']]);

  // La misma ficha con 6 decimales abre solo 200 m: el grifo real queda fuera y
  // el vecino no se acredita por estar cerca.
  const precisa = emparejarDirectorios({ sitios, directorios: [directorio('primax.json', 'Primax', [ficha('E/S LOS OLIVOS', 'Av. Universitaria 6500', -12.110001, -77.030001)])] });
  assert.equal(precisa.aceptadas.length, 0);

  assert.deepEqual([...analizarDireccion('Av. 28 de Julio 2200').puertas], ['2200']);
  const nombreDeVia = emparejarDirectorios({
    sitios: [sitio('e', 'AV. 28 DE JULIO N° 1500', { distrito: 'LA VICTORIA', latitude: -12.0620, longitude: -77.0186 })],
    directorios: [directorio('primax.json', 'Primax', [ficha('E/S 28 DE JULIO', 'Av. 28 de Julio 2200', -12.062018, -77.018679)])],
  });
  assert.equal(nombreDeVia.aceptadas.length, 0);
});

test('margen insuficiente: dos candidatos con las mismas señales quedan en conflicto', () => {
  const sitios = [
    sitio('f', 'AV. TUPAC AMARU N° 1500', { distrito: 'COMAS', latitude: -11.95, longitude: -77.06 }),
    sitio('g', 'AV. TUPAC AMARU N° 1500', { distrito: 'INDEPENDENCIA', latitude: -11.99, longitude: -77.05 }),
  ];
  // Coordenada sin decimales: no selecciona y solo queda el texto.
  const { aceptadas, pendientes } = emparejarDirectorios({ sitios, directorios: [directorio('primax.json', 'Primax', [ficha('TUPAC', 'Av. Tupac Amaru 1500', -12, -77)])] });
  assert.equal(aceptadas.length, 0);
  assert.equal(pendientes[0].motivo, 'margen_insuficiente');
  assert.deepEqual([...pendientes[0].candidatos].sort(), [id('f'), id('g')]);
});

test('duplicidad: dos fichas sobre un mismo grifo acreditan una sola vez', () => {
  const sitios = [sitio('h', 'AV. EL DERBY N° 118, MZ. A, LOTE 5, URB. EL DERBY', { latitude: -12.0986, longitude: -76.9710 })];
  const { aceptadas, pendientes } = emparejarDirectorios({
    sitios,
    directorios: [directorio('primax.json', 'Primax', [
      ficha('EL DERBY', 'AV. EL DERBY NRO. 118 URB. MONTERRICO', -12.098612, -76.971034),
      ficha('SEÑOR DE HUANCA', 'AV EL DERBY 118 MZ A LT 5 URB EL DERBY', -12.098612, -76.971034),
    ])],
  });
  assert.equal(aceptadas.length, 1);
  assert.equal(aceptadas[0].nombre_ficha, 'SEÑOR DE HUANCA');
  assert.deepEqual(pendientes.map((item) => [item.nombre, item.motivo]), [['EL DERBY', 'perdio_asignacion']]);
});

test('conflicto entre directorios: ni el orden de archivos ni el puntaje eligen bandera', () => {
  const sitios = [sitio('i', 'AV. LA MARINA N° 2185', { distrito: 'SAN MIGUEL', latitude: -12.0775, longitude: -77.0862 })];
  const repsol = directorio('repsol.json', 'Repsol', [ficha('MARINA', 'AV. LA MARINA 2185', -12.077512, -77.086234, 'SAN MIGUEL')]);
  const primax = directorio('primax.json', 'Primax', [ficha('E/S LA MARINA', 'Av. La Marina 2185', -12.077498, -77.086199)]);
  const resultados = [[repsol, primax], [primax, repsol]].map((directorios) => emparejarDirectorios({ sitios, directorios }));
  for (const { aceptadas, conflictos } of resultados) {
    assert.equal(aceptadas.length, 0);
    assert.deepEqual(conflictos.map((item) => [item.establishment_id, item.motivo, [...item.marcas].sort()]), [[id('i'), 'conflicto_entre_directorios', ['Primax', 'Repsol']]]);
  }

  // La razón social de otra cadena con directorio propio también es choque.
  const choque = emparejarDirectorios({
    sitios: [sitio('j', 'AV. LA MARINA N° 2185', { distrito: 'SAN MIGUEL', razon: 'REPSOL COMERCIAL S.A.C.', latitude: -12.0775, longitude: -77.0862 })],
    directorios: [primax],
    marcasActivas: ['Primax', 'Repsol'],
  });
  assert.equal(choque.aceptadas.length, 0);
  assert.equal(choque.conflictos[0].motivo, 'choque_con_operador');
});
