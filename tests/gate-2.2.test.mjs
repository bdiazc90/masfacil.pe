import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyFieldPublicationPolicy,
  FIELD_PUBLICATION_MATRIX,
  FIELD_PUBLICATION_POLICIES,
  fieldVerdict,
  measurePublicSubset,
  projectClientOfferFields,
  PUBLICATION_VERDICTS,
} from '../app/publication-matrix.mjs';
import { buildCommercialIdentityIndex } from '../app/commercial-overlay.mjs';
import { loadValidatedDataset, toClientDataset } from '../app/contract.mjs';
import {
  addressLabel,
  ADDRESS_UNAVAILABLE_LABEL,
  DISTANCE_UNAVAILABLE_LABEL,
  distanceLabel,
  identityTitle,
  IDENTITY_UNAVAILABLE_LABEL,
} from '../app/public/offer-presentation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const datasetSchemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const overlayPath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-overlay.synthetic.json');
const dataset = loadValidatedDataset(datasetPath, datasetSchemaPath);
const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
const serverSource = fs.readFileSync(path.join(root, 'app', 'server.mjs'), 'utf8');

const REQUIRED_FIELDS = [
  'precio', 'fecha_de_reporte', 'frescura', 'distancia_derivada', 'coordenada',
  'razon_social', 'direccion', 'distrito', 'identidad_comercial',
];

function sampleClientOffer() {
  return {
    id: 'offer_sample000000000000000',
    price: 18.5,
    reported_at: '2026-08-13T10:00:00.000Z',
    age_days: 1.5,
    district: 'SURQUILLO',
    longitude: -77.01,
    latitude: -12.11,
    identity_label: 'IDENTIDAD PROVISIONAL — razón social/dirección',
    legal_name: 'RAZON SOCIAL SINTETICA',
    address: 'DIRECCION SINTETICA 123',
    commercial_identity: Object.freeze({ brand: 'MARCA', public_site_name: 'SEDE' }),
  };
}

test('la matriz cubre exactamente los campos exigidos por el gate, congelada y con evidencia declarada', () => {
  assert.ok(Object.isFrozen(FIELD_PUBLICATION_MATRIX));
  assert.deepEqual(FIELD_PUBLICATION_MATRIX.map((entry) => entry.field).sort(), [...REQUIRED_FIELDS].sort());
  for (const entry of FIELD_PUBLICATION_MATRIX) {
    assert.ok(Object.isFrozen(entry), `${entry.field} debe estar congelada`);
    assert.ok(entry.evidence && entry.evidence.length > 10, `${entry.field} requiere evidencia citada`);
    assert.ok(entry.verdict === 'governed_upstream' || PUBLICATION_VERDICTS.includes(entry.verdict), `${entry.field}: veredicto fuera de catálogo`);
  }
});

test('fieldVerdict resuelve por nombre y lanza ante un campo desconocido', () => {
  assert.equal(fieldVerdict('precio'), 'publishable');
  assert.equal(fieldVerdict('coordenada'), 'not_publishable');
  assert.equal(fieldVerdict('razon_social'), 'unknown');
  assert.throws(() => fieldVerdict('campo_inexistente'), /desconocido/);
});

test('private_experiment no altera ningún campo (comportamiento actual sin cambios)', () => {
  const offer = sampleClientOffer();
  const projected = projectClientOfferFields(offer, 'private_experiment');
  assert.equal(projected, offer);
  assert.deepEqual(projected, sampleClientOffer());
});

test('la matriz y la proyección no pueden divergir: cada campo se proyecta exactamente según su veredicto', () => {
  const offer = sampleClientOffer();
  const projected = projectClientOfferFields(offer, 'public_safe');
  for (const entry of FIELD_PUBLICATION_MATRIX) {
    if (entry.verdict === 'governed_upstream') continue;
    for (const key of entry.client_fields) {
      if (entry.verdict === 'publishable') assert.deepEqual(projected[key], offer[key], `${key} debía conservarse (publishable)`);
      else assert.equal(projected[key], null, `${key} debía suprimirse (${entry.verdict})`);
    }
  }
  assert.deepEqual(projected.commercial_identity, offer.commercial_identity, 'identidad comercial la gobierna Gate 2.1, no esta matriz');
});

test('un campo unknown nunca degrada a permitido bajo public_safe', () => {
  assert.equal(fieldVerdict('razon_social'), 'unknown');
  const projected = projectClientOfferFields(sampleClientOffer(), 'public_safe');
  assert.equal(projected.legal_name, null);
  assert.ok(projected.suppressed_fields.includes('legal_name'));
});

test('un campo con permiso explícito permanece visible bajo public_safe', () => {
  const projected = projectClientOfferFields(sampleClientOffer(), 'public_safe');
  assert.equal(projected.price, 18.5);
  assert.equal(projected.reported_at, '2026-08-13T10:00:00.000Z');
  assert.equal(projected.age_days, 1.5);
  assert.equal(projected.district, 'SURQUILLO');
});

test('coordenada explícitamente prohibida se suprime siempre bajo public_safe', () => {
  const projected = projectClientOfferFields(sampleClientOffer(), 'public_safe');
  assert.equal(projected.longitude, null);
  assert.equal(projected.latitude, null);
  assert.deepEqual(projected.suppressed_fields, ['address', 'latitude', 'legal_name', 'longitude'].sort());
});

test('projectClientOfferFields y applyFieldPublicationPolicy lanzan ante una política desconocida', () => {
  assert.throws(() => projectClientOfferFields(sampleClientOffer(), 'publico'), /desconocida/);
  assert.throws(() => applyFieldPublicationPolicy({ offers: [] }, 'publico'), /desconocida/);
});

test('measurePublicSubset mide identificabilidad, ubicabilidad y disposición para decidir por separado', () => {
  const withIdentity = { commercial_identity: { brand: 'X', public_site_name: 'Y' }, legal_name: null, longitude: null, latitude: null, price: 10 };
  const withLegalNameOnly = { commercial_identity: null, legal_name: 'RAZON', longitude: -77, latitude: -12, price: 11 };
  const bare = { commercial_identity: null, legal_name: null, longitude: null, latitude: null, price: null };
  const metrics = measurePublicSubset([withIdentity, withLegalNameOnly, bare]);
  assert.equal(metrics.total, 3);
  assert.equal(metrics.with_price, 2);
  assert.equal(metrics.identifiable, 2);
  assert.equal(metrics.locatable, 1);
  assert.equal(metrics.decision_ready, 1);
});

test('applyFieldPublicationPolicy proyecta todas las ofertas y reporta el tamaño real del subconjunto', () => {
  const commercial = buildCommercialIdentityIndex(dataset, overlay, { projectionPolicy: 'public_safe' });
  const client = toClientDataset(dataset, 'demo', commercial.byAnchor, 'public_safe');
  const strict = applyFieldPublicationPolicy(client, 'public_safe');

  assert.equal(strict.field_publication_policy, 'public_safe');
  assert.equal(strict.offers.length, client.offers.length);
  assert.ok(strict.offers.every((offer) => offer.longitude === null && offer.latitude === null));
  assert.ok(strict.offers.every((offer) => offer.legal_name === null && offer.address === null));
  assert.ok(strict.offers.every((offer) => offer.price !== null && offer.district !== null));
  assert.equal(strict.publication_subset.locatable, 0);
  assert.equal(strict.publication_subset.total, client.offers.length);

  const permissive = applyFieldPublicationPolicy(client, 'private_experiment');
  assert.deepEqual(permissive.offers, client.offers);
  assert.equal(permissive.field_publication_policy, 'private_experiment');
});

test('FIELD_PUBLICATION_POLICIES solo admite los dos valores declarados', () => {
  assert.deepEqual(FIELD_PUBLICATION_POLICIES, ['private_experiment', 'public_safe']);
});

test('server.mjs expone --public-strict, lo aplica y rechaza combinarlo con --private-preview', () => {
  assert.match(serverSource, /--public-strict/);
  assert.match(serverSource, /options\.privatePreview && options\.publicStrict/);
  assert.match(serverSource, /applyFieldPublicationPolicy/);
  assert.match(serverSource, /fieldPolicy = options\.publicStrict \? 'public_safe' : 'private_experiment'/);
});

test('offer-presentation declara la ausencia en vez de inventar un sustituto', () => {
  const withNothing = { commercial_identity: null, legal_name: null, address: null, distance_km: null };
  assert.equal(identityTitle(withNothing), IDENTITY_UNAVAILABLE_LABEL);
  assert.equal(addressLabel(withNothing), ADDRESS_UNAVAILABLE_LABEL);
  assert.equal(distanceLabel(withNothing, () => 'nunca debería llamarse'), DISTANCE_UNAVAILABLE_LABEL);

  const withLegalName = { commercial_identity: null, legal_name: 'RAZON SOCIAL X', address: 'DIRECCION X', distance_km: 2.5 };
  assert.equal(identityTitle(withLegalName), 'RAZON SOCIAL X');
  assert.equal(addressLabel(withLegalName), 'DIRECCION X');
  assert.equal(distanceLabel(withLegalName, (value) => `${value}km`), '2.5km');

  const withCommercialIdentity = { commercial_identity: { brand: 'MARCA', public_site_name: 'SEDE' }, legal_name: 'IGNORADA' };
  assert.equal(identityTitle(withCommercialIdentity), 'MARCA · SEDE');
});
