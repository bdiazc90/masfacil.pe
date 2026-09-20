// El vínculo entre una fila de la tabla pública y un establecimiento oficial.
//
// Todo lo que se comprueba aquí es una forma de lo mismo: publicar el precio de
// otro grifo es peor que no publicar ninguno, y el único caso en que eso se cuela
// es cuando dos filas parecidas se resuelven «por lo más probable».
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { facilitoLinkKey, normalizeLinkText, resolveFacilitoLayer } from '../pipeline/facilito/link.mjs';

const AHORA = Date.parse('2026-09-20T15:00:00.000Z');
const HORA = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

const unidad = (product, rows, { observed_at = iso(AHORA - HORA), district_code = '150103' } = {}) => ({
  district_code, district_name: 'ATE', product, observed_at, announced_total: rows.length, rows,
});
const estado = (...unidades) => ({ schema_version: 'facilito-state-1', units: Object.fromEntries(unidades.map((u, i) => [`${u.district_code}:${u.product}:${i}`, u])) });

test('la normalización solo toca mayúsculas, tildes y espacios', () => {
  assert.equal(normalizeLinkText(' Av.  Nicolás   Ayllón \n'), 'AV. NICOLAS AYLLON');
  // Deliberadamente NO equivalen: expandir abreviaturas convertiría una
  // coincidencia exacta en una interpretación nuestra.
  assert.notEqual(normalizeLinkText('AV. LIMA'), normalizeLinkText('AVENIDA LIMA'));
});

test('una terna incompleta no produce clave', () => {
  assert.equal(facilitoLinkKey('GRIFO X', '', 'ATE'), null);
  assert.equal(facilitoLinkKey('', 'AV. X 1', 'ATE'), null);
  assert.equal(facilitoLinkKey('GRIFO X', 'AV. X 1', '   '), null);
  assert.ok(facilitoLinkKey('GRIFO X', 'AV. X 1', 'ATE'));
});

test('la misma terna da la misma clave aunque cambie el formato del texto', () => {
  assert.equal(facilitoLinkKey('Grifo X S.A.C.', 'Av. X  1', 'Ate'), facilitoLinkKey('GRIFO X S.A.C.', 'AV. X 1', 'ATE'));
});

test('dos filas con la misma terna no se reparten: las dos quedan fuera', () => {
  // Pasa de verdad: dos autorizaciones en la misma dirección. Elegir una sería
  // decidir por orden de archivo, que es elegir al azar con cara seria.
  const clave = facilitoLinkKey('GRIFO GEMELO', 'AV. REPETIDA 100', 'ATE');
  const { byOfferId, counts } = resolveFacilitoLayer({
    state: estado(unidad('regular', [{ key_hash: clave, price: 19.15 }, { key_hash: clave, price: 19.49 }])),
    linkKeys: new Map([['g2_aaaaaaaaaaaaaaaaaaaaaaaa', clave]]),
    product: 'regular',
    now: AHORA,
  });
  assert.equal(byOfferId.size, 0);
  assert.equal(counts.ambiguous, 1);
});

test('dos ofertas con la misma terna tampoco reciben precio', () => {
  const clave = facilitoLinkKey('GRIFO GEMELO', 'AV. REPETIDA 100', 'ATE');
  const { byOfferId, counts } = resolveFacilitoLayer({
    state: estado(unidad('regular', [{ key_hash: clave, price: 19.15 }])),
    linkKeys: new Map([['g2_aaaaaaaaaaaaaaaaaaaaaaaa', clave], ['g2_bbbbbbbbbbbbbbbbbbbbbbbb', clave]]),
    product: 'regular',
    now: AHORA,
  });
  assert.equal(byOfferId.size, 0);
  assert.equal(counts.ambiguous, 1);
});

test('una fila sin par oficial se cuenta, no se fuerza', () => {
  const { byOfferId, counts } = resolveFacilitoLayer({
    state: estado(unidad('regular', [{ key_hash: facilitoLinkKey('GRIFO AJENO', 'AV. OTRA 2', 'ATE'), price: 19.15 }])),
    linkKeys: new Map([['g2_aaaaaaaaaaaaaaaaaaaaaaaa', facilitoLinkKey('GRIFO NUESTRO', 'AV. X 1', 'ATE')]]),
    product: 'regular',
    now: AHORA,
  });
  assert.equal(byOfferId.size, 0);
  assert.equal(counts.unlinked, 1);
});

test('cada producto se resuelve por separado', () => {
  const clave = facilitoLinkKey('GRIFO X', 'AV. X 1', 'ATE');
  const state = estado(unidad('regular', [{ key_hash: clave, price: 19.15 }]), unidad('premium', [{ key_hash: clave, price: 21.40 }]));
  const linkKeys = new Map([['g2_aaaaaaaaaaaaaaaaaaaaaaaa', clave]]);
  assert.equal(resolveFacilitoLayer({ state, linkKeys, product: 'regular', now: AHORA }).byOfferId.get('g2_aaaaaaaaaaaaaaaaaaaaaaaa').price, 19.15);
  assert.equal(resolveFacilitoLayer({ state, linkKeys, product: 'premium', now: AHORA }).byOfferId.get('g2_aaaaaaaaaaaaaaaaaaaaaaaa').price, 21.40);
});

test('una captura vencida no se publica, y su hora original no se toca', () => {
  const clave = facilitoLinkKey('GRIFO X', 'AV. X 1', 'ATE');
  const vieja = unidad('regular', [{ key_hash: clave, price: 19.15 }], { observed_at: iso(AHORA - 30 * HORA) });
  const { byOfferId, counts } = resolveFacilitoLayer({ state: estado(vieja), linkKeys: new Map([['g2_a', clave]]), product: 'regular', now: AHORA });
  assert.equal(byOfferId.size, 0);
  assert.equal(counts.expired_units, 1);
  assert.equal(vieja.observed_at, iso(AHORA - 30 * HORA), 'la captura conserva su hora en el expediente');
});

test('si una tabla completa nueva omite una fila, esa consulta deja de respaldarla', () => {
  // La fila que desaparece vuelve al CSV. No significa que el grifo cerrara ni
  // que no tenga stock: significa que hoy no lo vimos.
  const presente = facilitoLinkKey('GRIFO PRESENTE', 'AV. X 1', 'ATE');
  const ausente = facilitoLinkKey('GRIFO AUSENTE', 'AV. Y 2', 'ATE');
  const linkKeys = new Map([['g2_presente', presente], ['g2_ausente', ausente]]);
  const antes = resolveFacilitoLayer({ state: estado(unidad('regular', [{ key_hash: presente, price: 19.15 }, { key_hash: ausente, price: 19.49 }])), linkKeys, product: 'regular', now: AHORA });
  assert.equal(antes.byOfferId.size, 2);
  const despues = resolveFacilitoLayer({ state: estado(unidad('regular', [{ key_hash: presente, price: 19.15 }])), linkKeys, product: 'regular', now: AHORA });
  assert.equal(despues.byOfferId.size, 1);
  assert.equal(despues.byOfferId.has('g2_ausente'), false);
});

test('la capa nunca afirma una fecha de reporte', () => {
  const clave = facilitoLinkKey('GRIFO X', 'AV. X 1', 'ATE');
  const { byOfferId } = resolveFacilitoLayer({ state: estado(unidad('regular', [{ key_hash: clave, price: 19.15 }])), linkKeys: new Map([['g2_a', clave]]), product: 'regular', now: AHORA });
  assert.deepEqual(byOfferId.get('g2_a'), { price: 19.15, observed_at: iso(AHORA - HORA), reported_at: null });
});

test('reconstruir con el reloj de la composición devuelve la misma capa, aunque ya venciera', () => {
  // Es la invariante del rollback: recuperar una entrega de anteayer tiene que
  // dar los mismos bytes. Con el reloj de hoy la capa se vaciaría por
  // vencimiento y saldría otra revisión, que es una entrega que nunca existió.
  const clave = facilitoLinkKey('GRIFO X', 'AV. X 1', 'ATE');
  const state = estado(unidad('regular', [{ key_hash: clave, price: 19.15 }], { observed_at: iso(AHORA - 2 * HORA) }));
  const linkKeys = new Map([['g2_a', clave]]);
  const compuestoEn = AHORA;

  const original = resolveFacilitoLayer({ state, linkKeys, product: 'regular', now: compuestoEn });
  const recuperada = resolveFacilitoLayer({ state, linkKeys, product: 'regular', now: compuestoEn });
  assert.deepEqual([...recuperada.byOfferId], [...original.byOfferId]);

  const conRelojDeHoy = resolveFacilitoLayer({ state, linkKeys, product: 'regular', now: compuestoEn + 5 * 24 * HORA });
  assert.equal(conRelojDeHoy.byOfferId.size, 0, 'con el reloj de hoy la capa se vacía: por eso se guarda composed_at');
});
