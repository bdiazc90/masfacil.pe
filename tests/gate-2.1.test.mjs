import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildCommercialIdentityIndex,
  emptyCommercialOverlay,
  loadValidatedCommercialOverlay,
  PROJECTION_POLICIES,
  validateCommercialOverlay,
} from '../app/commercial-overlay.mjs';
import { evaluateNormalizedAddressDiscovery } from '../app/commercial-discovery.mjs';
import { loadValidatedDataset, toClientDataset } from '../app/contract.mjs';
import { OFFICIAL_ANCHOR_SCHEME, officialAnchorFromRegistration } from '../app/official-anchor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const datasetSchemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const overlaySchemaPath = path.join(root, 'contracts', 'gate-2.1-commercial-identity-overlay.schema.json');
const overlayPath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-overlay.synthetic.json');
const duplicatePath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-overlay.duplicate-conflict.invalid.synthetic.json');
const incompletePath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-overlay.incomplete.invalid.synthetic.json');
const negativesPath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-discovery-negatives.synthetic.json');
const evidencePath = path.join(root, 'evidence', 'gate-2.1-commercial-identity-summary.json');
const overlaySchema = JSON.parse(fs.readFileSync(overlaySchemaPath, 'utf8'));
const validOverlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
const duplicateOverlay = JSON.parse(fs.readFileSync(duplicatePath, 'utf8'));
const incompleteOverlay = JSON.parse(fs.readFileSync(incompletePath, 'utf8'));
const negatives = JSON.parse(fs.readFileSync(negativesPath, 'utf8'));
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const serverSource = fs.readFileSync(path.join(root, 'app', 'server.mjs'), 'utf8');
const dataset = loadValidatedDataset(datasetPath, datasetSchemaPath);

test('el overlay distingue descubrimiento, integración, acceso, modificación y frescura', () => {
  assert.equal(overlaySchema.additionalProperties, false);
  assert.equal(overlaySchema.$defs.entry.additionalProperties, false);
  assert.deepEqual(validateCommercialOverlay(validOverlay, overlaySchema), []);
  assert.ok(validOverlay.entries.every((entry) => entry.integration_method === 'official_anchor_exact'));
  assert.ok(validOverlay.entries.every((entry) => entry.discovery_method === 'normalized_address_exact'));
  assert.ok(validOverlay.entries.every((entry) => Object.hasOwn(entry, 'observed_at') && Object.hasOwn(entry, 'source_last_modified_at')));

  const fuzzy = structuredClone(validOverlay);
  fuzzy.entries[0].discovery_method = 'fuzzy_name';
  assert.ok(validateCommercialOverlay(fuzzy, overlaySchema).some((error) => error.includes('discovery_method')));

  const unknownModification = structuredClone(validOverlay);
  unknownModification.entries[0].source_last_modified_at = null;
  unknownModification.entries[0].identity_freshness = 'unknown';
  assert.deepEqual(validateCommercialOverlay(unknownModification, overlaySchema), []);
});

test('el anchor deriva de REGISTRO exacto con el mismo esquema estable del pipeline', () => {
  const first = officialAnchorFromRegistration('REGISTRO-SINTÉTICO-001');
  assert.match(first, /^est_[a-f0-9]{24}$/);
  assert.equal(first, officialAnchorFromRegistration(' REGISTRO-SINTÉTICO-001 '));
  assert.notEqual(first, officialAnchorFromRegistration('registro-sintético-001'));
  assert.equal(validOverlay.anchor_scheme, OFFICIAL_ANCHOR_SCHEME);
  assert.throws(() => officialAnchorFromRegistration('  '), /no vacío/);
});

test('la integración no modifica la entidad oficial y el join es determinístico', () => {
  const officialBefore = structuredClone(dataset);
  const first = buildCommercialIdentityIndex(dataset, validOverlay);
  const reversed = buildCommercialIdentityIndex(dataset, { ...validOverlay, entries: [...validOverlay.entries].reverse() });
  const projected = toClientDataset(dataset, 'demo', first.byAnchor);
  const projectedReversed = toClientDataset(dataset, 'demo', reversed.byAnchor);

  assert.deepEqual(dataset, officialBefore);
  assert.deepEqual(projected, projectedReversed);
  assert.deepEqual(projected.offers[0].commercial_identity, {
    brand: 'MARCA SINTÉTICA NORTE',
    public_site_name: 'SEDE DEMOSTRACIÓN SUR',
  });
  assert.equal(projected.offers.find((offer) => offer.id === 'offer_444444444444444444444444').commercial_identity, null);
  assert.equal(first.metrics.projected, 1);
});

test('public_safe y private_preview aplican políticas distintas sin deducir frescura ni publicación', () => {
  assert.deepEqual(PROJECTION_POLICIES, ['public_safe', 'private_preview']);
  const publicSafe = buildCommercialIdentityIndex(dataset, validOverlay);
  const preview = buildCommercialIdentityIndex(dataset, validOverlay, { projectionPolicy: 'private_preview' });
  const publicClient = toClientDataset(dataset, 'demo', publicSafe.byAnchor, 'public_safe');
  const previewClient = toClientDataset(dataset, 'demo', preview.byAnchor, 'private_preview');
  const publicSerialized = JSON.stringify(publicClient);
  const previewSerialized = JSON.stringify(previewClient);

  assert.equal(validOverlay.entries[1].verification_status, 'unverified');
  assert.equal(validOverlay.entries[1].publication_status, 'publishable');
  assert.equal(validOverlay.entries[2].verification_status, 'verified');
  assert.equal(validOverlay.entries[2].publication_status, 'unknown');
  assert.equal(validOverlay.entries[2].identity_freshness, 'stale');
  assert.equal(publicSerialized.includes('SEDE QUE NO DEBE MOSTRARSE'), false);
  assert.equal(publicSerialized.includes('SEDE ANTIGUA DE PREVIEW'), false);
  assert.equal(previewSerialized.includes('SEDE ANTIGUA DE PREVIEW'), true);
  assert.equal(previewSerialized.includes('SEDE QUE NO DEBE MOSTRARSE'), false);
  assert.equal(publicSafe.metrics.projected, 1);
  assert.equal(preview.metrics.projected, 2);
  assert.equal(publicClient.identity_policy, 'public_safe');
  assert.equal(previewClient.identity_policy, 'private_preview');

  const recentButExplicitlyStale = structuredClone(validOverlay);
  recentButExplicitlyStale.entries[0].source_last_modified_at = '2026-08-16T14:59:00.000Z';
  recentButExplicitlyStale.entries[0].identity_freshness = 'stale';
  assert.equal(buildCommercialIdentityIndex(dataset, recentButExplicitlyStale).metrics.projected, 0);

  const explicitlyNotPublishable = structuredClone(validOverlay);
  explicitlyNotPublishable.entries[2].publication_status = 'not_publishable';
  assert.equal(buildCommercialIdentityIndex(dataset, explicitlyNotPublishable, { projectionPolicy: 'private_preview' }).metrics.projected, 1);

  const ambiguous = structuredClone(validOverlay);
  ambiguous.entries[0].verification_status = 'conflict';
  const ambiguousClient = toClientDataset(dataset, 'demo', buildCommercialIdentityIndex(dataset, ambiguous, { projectionPolicy: 'private_preview' }).byAnchor);
  assert.equal(JSON.stringify(ambiguousClient).includes('SEDE DEMOSTRACIÓN SUR'), false);
  assert.throws(() => buildCommercialIdentityIndex(dataset, validOverlay, { projectionPolicy: 'public' }), /desconocida/);
});

test('private_preview requiere opt-in de servidor y loopback permanece inmutable', () => {
  assert.match(serverSource, /const host = '127\.0\.0\.1'/);
  assert.match(serverSource, /privatePreview: false/);
  assert.match(serverSource, /--private-preview/);
  assert.match(serverSource, /options\.privatePreview \? 'private_preview' : 'public_safe'/);
});

test('duplicados y conflictos fallan visiblemente y no pueden sobrescribirse', () => {
  const errors = validateCommercialOverlay(duplicateOverlay, overlaySchema);
  assert.ok(errors.some((error) => error.includes('duplicado')));
  assert.ok(errors.some((error) => error.includes('conflicto')));
  assert.throws(() => loadValidatedCommercialOverlay(duplicatePath, overlaySchemaPath), /duplicado|conflicto/);
  assert.throws(() => buildCommercialIdentityIndex(dataset, duplicateOverlay), /duplicado o conflictivo/);
});

test('identidad incompleta y campos extra fallan contra el boundary', () => {
  const errors = validateCommercialOverlay(incompleteOverlay, overlaySchema);
  assert.ok(errors.some((error) => error.includes('public_site_name')));
  assert.ok(errors.some((error) => error.includes('brand')));
  assert.throws(() => loadValidatedCommercialOverlay(incompletePath, overlaySchemaPath), /fuera del contrato/);

  const extra = structuredClone(validOverlay);
  extra.entries[0].inferred_brand = true;
  assert.ok(validateCommercialOverlay(extra, overlaySchema).some((error) => error.includes('campos inesperados')));
});

test('dataset incorrecto y anchor desconocido fallan; overlay vacío conserva fallback', () => {
  const wrongDataset = { ...validOverlay, official_dataset_id: 'gate-1.1-lima-province-gasohol-regular-2026-08-15' };
  assert.throws(() => buildCommercialIdentityIndex(dataset, wrongDataset), /apunta a/);

  const unknownAnchor = structuredClone(validOverlay);
  unknownAnchor.entries[0].official_anchor = 'est_ffffffffffffffffffffffff';
  assert.throws(() => buildCommercialIdentityIndex(dataset, unknownAnchor), /sin entidad oficial/);

  const empty = emptyCommercialOverlay(dataset.dataset_id);
  assert.deepEqual(validateCommercialOverlay(empty, overlaySchema), []);
  const commercial = buildCommercialIdentityIndex(dataset, empty);
  const client = toClientDataset(dataset, 'real', commercial.byAnchor);
  assert.ok(client.offers.every((offer) => offer.commercial_identity === null));
});

test('los tres negativos de discovery no pueden entrar por coordenada', () => {
  assert.match(negatives.classification, /SINTÉTICO/);
  for (const candidate of negatives.cases) {
    const observed = evaluateNormalizedAddressDiscovery(candidate);
    assert.deepEqual(observed, candidate.expected);
    assert.equal(observed.accepted, false);
  }
  assert.equal(negatives.cases.every((candidate) => candidate.coordinate_match), true);
});

test('la evidencia agregada conserva denominadores y limita la conclusión de falsos positivos', () => {
  assert.equal(evidence.universe.total_establishments, 64);
  assert.equal(evidence.universe.repsol_legal_name_candidates, 14);
  assert.equal(evidence.universe.accepted_private_preview_candidates, 11);
  assert.equal(evidence.universe.unmatched_candidates, 3);
  assert.equal(evidence.universe.primax_verifiable_public_site_names, 0);
  assert.equal(evidence.universe.publication_unknown, 11);
  assert.deepEqual(evidence.coverage.total, { numerator: 11, denominator: 64, percent: 17.188 });
  assert.deepEqual(evidence.coverage.corporate_subset, { numerator: 11, denominator: 14, percent: 78.571 });
  assert.equal(evidence.quality.false_positive_candidate, 0);
  assert.equal(evidence.quality.status, 'accepted_with_limitations');
  assert.match(evidence.quality.conclusion, /no generalizar/i);
  assert.match(evidence.classification, /SIN NOMBRES, DIRECCIONES NI ANCHORS REALES/);
});
