import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleDistricts } from '../web/district-list.js';

const districts = ['ANCON', 'MIRAFLORES', 'SAN ISIDRO', 'SANTIAGO DE SURCO', 'SURQUILLO'];

test('la lista distrital no renderiza los 42 distritos antes de buscar o desplegar', () => {
  assert.deepEqual(visibleDistricts(districts), []);
  assert.deepEqual(visibleDistricts(districts, 'sur'), ['SANTIAGO DE SURCO', 'SURQUILLO']);
});

test('ver todos los distritos es una acción explícita y conserva el universo recibido', () => {
  assert.deepEqual(visibleDistricts(districts, '', true), districts);
});
