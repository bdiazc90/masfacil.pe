// Cuándo se publica una composición y cuál de dos corridas manda.
//
// Los dos fallos que esto vigila son invisibles hasta que duelen: publicar
// cuatro veces al día lo mismo con otra hora, y que una corrida lenta pise con
// datos viejos a otra que vio la tabla después.
//
// node --test test/
// Vive fuera de `web/`, que es exactamente lo que se publica.

import assert from 'node:assert/strict';
import test from 'node:test';

import { dataStateIsBehind, dataStateRegressions, publicationDecision } from '../app/publication-policy.mjs';
import { facilitoPublicationChange, REPUBLISH_AFTER_MS } from '../pipeline/facilito/publication.mjs';

const AHORA = Date.parse('2026-09-20T18:00:00.000Z');
const HORA = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

const datasets = (ofertas) => ({ regular: { offers: ofertas } });
const oferta = (id, price, facilito = null) => ({ id, price, facilito });
const consulta = (price, observed_at) => ({ price, observed_at, reported_at: null });

test('sin capa publicada, cualquier composición con consulta se publica', () => {
  const cambio = facilitoPublicationChange({
    candidate: datasets([oferta('g2_a', 22.99, consulta(22.39, iso(AHORA - HORA)))]),
    published: datasets([oferta('g2_a', 22.99)]),
    now: AHORA,
  });
  assert.equal(cambio.visible, true);
});

test('si ningún precio efectivo cambia, no se publica', () => {
  // Es la corrida normal: la tabla dice lo mismo que hace seis horas. Publicar
  // costaría media descarga por cliente para cambiar una hora que nadie mira.
  const cambio = facilitoPublicationChange({
    candidate: datasets([oferta('g2_a', 22.99, consulta(22.39, iso(AHORA - HORA)))]),
    published: datasets([oferta('g2_a', 22.99, consulta(22.39, iso(AHORA - 7 * HORA)))]),
    now: AHORA,
  });
  assert.equal(cambio.visible, false);
  assert.equal(cambio.changed_offers, 0);
});

test('un precio distinto, uno que entra y uno que se cae cuentan igual', () => {
  const publicado = datasets([
    oferta('g2_igual', 22.99, consulta(22.39, iso(AHORA - HORA))),
    oferta('g2_cambia', 21.50, consulta(21.50, iso(AHORA - HORA))),
    oferta('g2_entra', 20.10),
    oferta('g2_cae', 19.90, consulta(19.80, iso(AHORA - HORA))),
  ]);
  const candidato = datasets([
    oferta('g2_igual', 22.99, consulta(22.39, iso(AHORA))),
    oferta('g2_cambia', 21.50, consulta(20.99, iso(AHORA))),
    oferta('g2_entra', 20.10, consulta(20.05, iso(AHORA))),
    oferta('g2_cae', 19.90),
  ]);
  const cambio = facilitoPublicationChange({ candidate: candidato, published: publicado, now: AHORA });
  assert.equal(cambio.visible, true);
  assert.equal(cambio.changed_offers, 3);
});

test('una consulta publicada que se acerca a las 24 h se renueva antes de vencer', () => {
  // Si no, el respaldo del CSV entraría teniendo una consulta fresca guardada.
  const mismoPrecio = (observed_at) => datasets([oferta('g2_a', 22.99, consulta(22.39, observed_at))]);
  const vieja = iso(AHORA - REPUBLISH_AFTER_MS - HORA);
  assert.equal(facilitoPublicationChange({ candidate: mismoPrecio(iso(AHORA)), published: mismoPrecio(vieja), now: AHORA }).visible, true);
  const reciente = iso(AHORA - REPUBLISH_AFTER_MS + HORA);
  assert.equal(facilitoPublicationChange({ candidate: mismoPrecio(iso(AHORA)), published: mismoPrecio(reciente), now: AHORA }).visible, false);
});

test('el CSV sin cambios ya no significa no publicar, pero solo si hay expediente', () => {
  const sinCapa = publicationDecision({ status: 'unchanged' }, { facilitoAvailable: false });
  assert.equal(sinCapa.action, 'no_op');
  assert.equal(sinCapa.deploy, false);
  const conCapa = publicationDecision({ status: 'unchanged' }, { facilitoAvailable: true });
  assert.equal(conCapa.action, 'facilito_project_verify_deploy');
  assert.equal(conCapa.project, true);
});

const entrega = (snapshot, unidades) => ({ snapshot_id: snapshot, facilito: { units_observed: unidades } });

test('dos corridas sobre el mismo CSV no empatan: manda la que vio la tabla después', () => {
  const vieja = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z' });
  const nueva = entrega('S1', { 'A:regular': '2026-09-20T18:00:00.000Z' });
  assert.equal(dataStateIsBehind(vieja, nueva), true, 'la antigua se aborta aunque termine después');
  assert.equal(dataStateIsBehind(nueva, vieja), false);
});

test('un máximo mayor no tapa un distrito que retrocede', () => {
  // El caso que encontró la auditoría: producción tiene dos distritos leídos a
  // las 12:00 y el candidato trae uno a las 13:00 y otro a las 06:00. Su hora
  // máxima sube, así que una comparación por máximo lo aceptaría y publicaría
  // seis horas hacia atrás en el segundo distrito.
  const publicado = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z', 'B:regular': '2026-09-20T12:00:00.000Z' });
  const candidato = entrega('S1', { 'A:regular': '2026-09-20T13:00:00.000Z', 'B:regular': '2026-09-20T06:00:00.000Z' });
  assert.equal(dataStateIsBehind(candidato, publicado), true);
  assert.deepEqual(dataStateRegressions(candidato, publicado), ['B:regular: 2026-09-20T06:00:00.000Z < 2026-09-20T12:00:00.000Z']);
});

test('perder una unidad que producción sí tiene también es retroceder', () => {
  const publicado = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z', 'B:regular': '2026-09-20T12:00:00.000Z' });
  const candidato = entrega('S1', { 'A:regular': '2026-09-20T18:00:00.000Z' });
  assert.equal(dataStateIsBehind(candidato, publicado), true);
  assert.match(dataStateRegressions(candidato, publicado)[0], /ausente/);
});

test('avanzar en todas las unidades no es retroceder, y tener MÁS tampoco', () => {
  const publicado = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z' });
  const candidato = entrega('S1', { 'A:regular': '2026-09-20T18:00:00.000Z', 'B:regular': '2026-09-20T18:00:00.000Z' });
  assert.equal(dataStateIsBehind(candidato, publicado), false);
  assert.deepEqual(dataStateRegressions(candidato, publicado), []);
});

test('un CSV anterior se rechaza primero, por muy nueva que sea la consulta', () => {
  const candidato = entrega('S1', { 'A:regular': '2026-09-20T18:00:00.000Z' });
  const publicado = entrega('S2', { 'A:regular': '2026-09-20T12:00:00.000Z' });
  assert.equal(dataStateIsBehind(candidato, publicado), true);
});

test('un CSV nuevo NO exime de comparar las unidades: una consulta antigua se rechaza', () => {
  // Traer un archivo más reciente no autoriza a retroceder seis horas en un
  // distrito: el usuario vería el precio de esta mañana donde ya tenía el de
  // esta tarde.
  const candidato = entrega('S2', { 'A:regular': '2026-09-20T06:00:00.000Z' });
  const publicado = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z' });
  assert.equal(dataStateIsBehind(candidato, publicado), true);
  assert.deepEqual(dataStateRegressions(candidato, publicado), ['A:regular: 2026-09-20T06:00:00.000Z < 2026-09-20T12:00:00.000Z']);
});

test('un CSV nuevo con una unidad ausente también se rechaza', () => {
  // Perder la captura de un distrito devolvería sus tarjetas al respaldo del
  // CSV teniendo una consulta vigente publicada.
  const candidato = entrega('S2', { 'A:regular': '2026-09-20T18:00:00.000Z' });
  const publicado = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z', 'B:premium': '2026-09-20T12:00:00.000Z' });
  assert.equal(dataStateIsBehind(candidato, publicado), true);
  assert.deepEqual(dataStateRegressions(candidato, publicado), ['B:premium: ausente < 2026-09-20T12:00:00.000Z']);
});

test('un CSV nuevo con las unidades al día sí se publica', () => {
  const candidato = entrega('S2', { 'A:regular': '2026-09-20T18:00:00.000Z', 'B:premium': '2026-09-20T18:00:00.000Z' });
  const publicado = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z', 'B:premium': '2026-09-20T12:00:00.000Z' });
  assert.equal(dataStateIsBehind(candidato, publicado), false);
  assert.deepEqual(dataStateRegressions(candidato, publicado), []);
});

test('un bundle sin capa cuenta como el más antiguo, no como empate', () => {
  const sinCapa = { snapshot_id: 'S1' };
  const conCapa = entrega('S1', { 'A:regular': '2026-09-20T12:00:00.000Z' });
  assert.equal(dataStateIsBehind(sinCapa, conCapa), true);
  assert.equal(dataStateIsBehind(conCapa, sinCapa), false);
  assert.equal(dataStateIsBehind(sinCapa, sinCapa), false, 'igual a sí mismo no es atrasado');
});

test('un fallo del CSV no apaga la consulta si queda un snapshot oficial válido', () => {
  for (const estado of ['unverifiable', 'needs_review', 'rejected']) {
    const conRespaldo = publicationDecision({ status: estado }, { facilitoAvailable: true, officialSnapshotUsable: true });
    assert.equal(conRespaldo.action, 'facilito_over_last_valid_snapshot', estado);
    assert.equal(conRespaldo.deploy, true, estado);
    // Sin referencia oficial utilizable no se publica ningún vínculo nuevo.
    assert.equal(publicationDecision({ status: estado }, { facilitoAvailable: true, officialSnapshotUsable: false }).action, 'fail_closed', estado);
    assert.equal(publicationDecision({ status: estado }, { facilitoAvailable: false, officialSnapshotUsable: true }).action, 'fail_closed', estado);
  }
});

// --- La compuerta completa, sin red y sin los 1,2 GB del original ----------

import { prepareRelease } from '../pipeline/prepare-release.mjs';
import { groupByKey } from '../pipeline/groups.mjs';

const candidato = (precioWeb) => ({
  manifest: { revision_id: 'gasolina-X-nueva' },
  datasets: { regular: { offers: [oferta('g2_a', 22.99, consulta(precioWeb, iso(AHORA)))] }, premium: { offers: [] } },
  identity: null,
});

// `prepareRelease` decide con el reloj real (`Date.now()`) y estas consultas
// están fechadas respecto a AHORA: sin fijar el reloj, en cuanto pasan 24 h desde
// AHORA la consulta publicada vence y la decisión cambia sola.
const relojEnAhora = (t) => t.mock.timers.enable({ apis: ['Date'], now: AHORA });

/** `unchanged` + expediente con unidades: se compone para mirar, no para publicar. */
// Solo Gasolina: estas pruebas miran su compuerta de la consulta web; el
// aislamiento entre grupos tiene las suyas.
function conDeps({ precioWeb, publicadoWeb, escrituras }) {
  return {
    groups: [groupByKey('gasolina')],
    estadoPublicado: () => ({ snapshot_id: 'S1' }),
    refreshSnapshot: async () => ({ status: 'unchanged' }),
    readFacilitoState: () => ({ units: { '150103:regular': {} } }),
    composeGroups: async () => ({ gasolina: candidato(precioWeb) }),
    writeGroupProjection: (c) => { escrituras.push(c.manifest.revision_id); return c; },
    publicadosDesdeDisco: () => datasets([oferta('g2_a', 22.99, publicadoWeb === null ? null : consulta(publicadoWeb, iso(AHORA - 7 * HORA)))]),
    writeShellManifest: () => {},
    verifyWeb: async () => ({ errors: [] }),
    usablePrivateSnapshot: () => ({ ok: true, snapshot_id: 'S1', missing: [], pointer: { snapshot_id: 'S1' } }),
  };
}

test('con el CSV sin cambios y la consulta sin novedad, se compone, se mira y no se escribe', async (t) => {
  // El caso normal de tres de cada cuatro corridas del día: la tabla dice lo
  // mismo que hace seis horas y la entrega anterior sigue siendo correcta.
  relojEnAhora(t);
  const escrituras = [];
  const resultado = await prepareRelease({ route: 'data', deps: conDeps({ precioWeb: 22.39, publicadoWeb: 22.39, escrituras }) });
  assert.equal(resultado.decision.action, 'no_op');
  assert.equal(resultado.decision.deploy, false);
  assert.deepEqual(escrituras, [], 'se compuso, pero no se escribió nada');
  assert.match(resultado.informe.facilito_change, /ningún precio efectivo cambia/);
});

test('con el CSV sin cambios y un precio distinto, sí se escribe y se despliega', async (t) => {
  relojEnAhora(t);
  const escrituras = [];
  const resultado = await prepareRelease({ route: 'data', deps: conDeps({ precioWeb: 21.99, publicadoWeb: 22.39, escrituras }) });
  assert.equal(resultado.decision.action, 'facilito_project_verify_deploy');
  assert.equal(resultado.decision.deploy, true);
  assert.deepEqual(escrituras, ['gasolina-X-nueva']);
});

test('sin expediente de consulta, el CSV sin cambios sigue siendo cero bytes y cero deploy', async (t) => {
  relojEnAhora(t);
  const escrituras = [];
  const resultado = await prepareRelease({
    route: 'data',
    deps: { ...conDeps({ precioWeb: 22.39, publicadoWeb: 22.39, escrituras }), readFacilitoState: () => null },
  });
  assert.equal(resultado.decision.action, 'no_op');
  assert.deepEqual(escrituras, [], 'no se compone ni se escribe nada');
  assert.equal(resultado.informe.facilito_change, null);
});
