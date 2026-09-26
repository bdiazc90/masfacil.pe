// Un bundle de Gasolina válido para el contrato 2.7.0, con la revisión y el precio
// que se pidan: sirve para simular revisiones distintas sin tocar datos reales.

import crypto from 'node:crypto';

const CORTE = '2026-09-06T22:45:36.508Z';
const sha = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const PRODUCTOS = Object.freeze({ regular: ['GASOHOL REGULAR', 'Gasohol Regular'], premium: ['GASOHOL PREMIUM', 'Gasohol Premium'] });

function oferta(letra, precio) {
  return { id: `g2_${letra.repeat(24)}`, establishment_id: `est_${letra.repeat(24)}`, commercial_identity: null, address: 'Av. Larco 123', price: precio, reported_at: '2026-09-01T12:00:00.000Z', facilito: null, district: 'MIRAFLORES', longitude: -77.03, latitude: -12.12 };
}

export function bundleGasolina({ revision = 'gasolina-2026-09-06-prueba-000000000000', precio = 15.49, snapshot = '2026-09-06-prueba' } = {}) {
  const bodies = {};
  const products = {};
  for (const [key, [canonical, label]] of Object.entries(PRODUCTOS)) {
    const dataset = { schema_version: '2.7.0', revision_id: revision, product: { key, canonical, label, display_unit: 'Galones' }, scope: { department: 'LIMA', province: 'LIMA' }, snapshot_date: '2026-09-06', cutoff_at: CORTE, source_max_reported_at: '2026-09-06T21:37:00.000Z', provenance: { source: 'Osinergmin', source_url: 'https://example.test/fuente', attribution: 'Datos de prueba.' }, offers: [oferta('a', precio + (key === 'premium' ? 2 : 0)), oferta('b', precio + 0.1 + (key === 'premium' ? 2 : 0))] };
    bodies[key] = `${JSON.stringify(dataset)}\n`;
    products[key] = { canonical_product: canonical, label, dataset_url: `data/gasolina/snapshots/${revision}/${key}.json`, bytes: Buffer.byteLength(bodies[key]), sha256: sha(bodies[key]), cutoff_at: CORTE };
  }
  const manifest = { schema_version: '2.7.0', revision_id: revision, scope: { department: 'LIMA', province: 'LIMA' }, products, generated_at: CORTE };
  const metricas = { contract_ready: { offers: 2, districts: 1 }, fresh_0_30_days: { offers: 2, districts: 1 }, coverage_percent: 100, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 }, cutoff_at: CORTE };
  const state = {
    schema_version: '2.7.0', revision_id: revision, snapshot_id: snapshot, validators: { etag: null, last_modified: null }, source_max_reported_at: '2026-09-06T21:37:00.000Z',
    products: { regular: metricas, premium: metricas },
    facilito: { contract: 'scrap-facilito/v1', state_id: null, units_observed: {}, units: { fresh: 0, reused: 0, failed: 0 }, districts: 0, linked: { regular: 0, premium: 0 }, ambiguous: 0, unlinked: 0, effective: { regular: { facilito: 0, csv: 2, none: 0 }, premium: { facilito: 0, csv: 2, none: 0 } } },
  };
  return { revision, manifest, manifestText: `${JSON.stringify(manifest)}\n`, bodies, state, stateText: `${JSON.stringify(state)}\n` };
}

// Un bundle de Diésel válido para su contrato 1.0.0: un solo producto, IDs `d1_`
// y revisión `diesel-`. `cambios` permite romper una pieza para comprobar que el
// contrato la rechaza.
export function bundleDiesel({ revision = 'diesel-2026-09-06-prueba-000000000000', precio = 25.49, snapshot = '2026-09-06-prueba', cambios = {} } = {}) {
  const oferta = (letra, extra = 0) => ({ id: `d1_${letra.repeat(24)}`, establishment_id: `est_${letra.repeat(24)}`, commercial_identity: null, address: 'Av. Larco 123', price: precio + extra, reported_at: '2026-09-01T12:00:00.000Z', facilito: null, district: 'MIRAFLORES', longitude: -77.03, latitude: -12.12 });
  const dataset = { schema_version: '1.0.0', revision_id: revision, product: { key: 'diesel', canonical: 'Diesel B5 S-50 UV', label: 'Diésel B5 S-50 UV', display_unit: 'Galones' }, scope: { department: 'LIMA', province: 'LIMA' }, snapshot_date: '2026-09-06', cutoff_at: CORTE, source_max_reported_at: '2026-09-06T21:37:00.000Z', provenance: { source: 'Osinergmin', source_url: 'https://example.test/fuente', attribution: 'Datos de prueba.' }, offers: [oferta('a'), oferta('b', 0.1)], ...cambios.dataset };
  const body = `${JSON.stringify(dataset)}\n`;
  const manifest = { schema_version: '1.0.0', revision_id: revision, scope: { department: 'LIMA', province: 'LIMA' }, products: { diesel: { canonical_product: 'Diesel B5 S-50 UV', label: 'Diésel B5 S-50 UV', dataset_url: `data/diesel/snapshots/${revision}/diesel.json`, bytes: Buffer.byteLength(body), sha256: sha(body), cutoff_at: CORTE, ...cambios.descriptor } }, generated_at: CORTE, ...cambios.manifest };
  const metricas = { contract_ready: { offers: 2, districts: 1 }, fresh_0_30_days: { offers: 2, districts: 1 }, coverage_percent: 100, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 }, cutoff_at: CORTE };
  const state = {
    schema_version: '1.0.0', revision_id: revision, snapshot_id: snapshot, validators: { etag: null, last_modified: null }, source_max_reported_at: '2026-09-06T21:37:00.000Z',
    products: { diesel: metricas },
    facilito: { contract: 'scrap-facilito/v1', state_id: null, units_observed: {}, units: { fresh: 0, reused: 0, failed: 0 }, districts: 0, linked: { diesel: 0 }, ambiguous: 0, unlinked: 0, effective: { diesel: { facilito: 0, csv: 2, none: 0 } } },
  };
  return { revision, manifest, manifestText: `${JSON.stringify(manifest)}\n`, bodies: { diesel: body }, state, stateText: `${JSON.stringify(state)}\n` };
}

// Un bundle de GLP válido para su contrato 1.0.0: un solo producto, IDs `glp1_`
// y revisión `glp-`, con el corte de su propia fuente.
export function bundleGlp({ revision = 'glp-2026-09-06-prueba-000000000000', precio = 7.49, snapshot = '2026-09-06-prueba', cambios = {} } = {}) {
  const oferta = (letra, extra = 0) => ({ id: `glp1_${letra.repeat(24)}`, establishment_id: `est_${letra.repeat(24)}`, commercial_identity: null, address: 'Av. Larco 123', price: precio + extra, reported_at: '2026-09-01T12:00:00.000Z', facilito: null, district: 'MIRAFLORES', longitude: -77.03, latitude: -12.12 });
  const dataset = { schema_version: '1.0.0', revision_id: revision, product: { key: 'glp', canonical: 'GLP - G', label: 'GLP automotor', display_unit: 'Galones' }, scope: { department: 'LIMA', province: 'LIMA' }, snapshot_date: '2026-09-06', cutoff_at: CORTE, source_max_reported_at: '2026-09-06T21:37:00.000Z', provenance: { source: 'Osinergmin', source_url: 'https://example.test/glp', attribution: 'Datos de prueba.' }, offers: [oferta('a'), oferta('b', 0.1)], ...cambios.dataset };
  const body = `${JSON.stringify(dataset)}\n`;
  const manifest = { schema_version: '1.0.0', revision_id: revision, scope: { department: 'LIMA', province: 'LIMA' }, products: { glp: { canonical_product: 'GLP - G', label: 'GLP automotor', dataset_url: `data/glp/snapshots/${revision}/glp.json`, bytes: Buffer.byteLength(body), sha256: sha(body), cutoff_at: CORTE, ...cambios.descriptor } }, generated_at: CORTE, ...cambios.manifest };
  const metricas = { contract_ready: { offers: 2, districts: 1 }, fresh_0_30_days: { offers: 2, districts: 1 }, coverage_percent: 100, conflicts: { latest_price_conflicts: 0, latest_territory_conflicts: 0 }, cutoff_at: CORTE };
  const state = {
    schema_version: '1.0.0', revision_id: revision, snapshot_id: snapshot, validators: { etag: null, last_modified: null }, source_max_reported_at: '2026-09-06T21:37:00.000Z',
    products: { glp: metricas },
    facilito: { contract: 'scrap-facilito/v1', state_id: null, units_observed: {}, units: { fresh: 0, reused: 0, failed: 0 }, districts: 0, linked: { glp: 0 }, ambiguous: 0, unlinked: 0, effective: { glp: { facilito: 0, csv: 2, none: 0 } } },
  };
  return { revision, manifest, manifestText: `${JSON.stringify(manifest)}\n`, bodies: { glp: body }, state, stateText: `${JSON.stringify(state)}\n` };
}
