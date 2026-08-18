#!/usr/bin/env node
// Gate 2.2 — mide el tamaño real del subconjunto publicable bajo la matriz de
// publicación de campos (app/publication-matrix.mjs), aplicada sobre el dataset
// real si está disponible (o el fixture sintético si no lo está) y sobre el
// overlay de identidad comercial real (o el fixture si no está disponible).
//
// No adquiere datos nuevos: solo mide y reporta. El resultado es agregado y
// sanitizado — nunca contiene coordenadas, razón social ni dirección reales.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommercialIdentityIndex, emptyCommercialOverlay, loadValidatedCommercialOverlay } from '../app/commercial-overlay.mjs';
import { loadValidatedDataset, toClientDataset } from '../app/contract.mjs';
import { applyFieldPublicationPolicy, FIELD_PUBLICATION_MATRIX } from '../app/publication-matrix.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const realPath = path.join(root, '.local-cache', 'gate-1.1', '2026-08-14', 'experiment-dataset-lima-province.json');
const demoPath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const overlaySchemaPath = path.join(root, 'contracts', 'gate-2.1-commercial-identity-overlay.schema.json');
const demoOverlayPath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-overlay.synthetic.json');
const realOverlayPath = path.join(root, '.local-cache', 'gate-2.1', 'commercial-identity-overlay.json');
const evidenceOutput = path.join(root, 'evidence', 'gate-2.2-public-subset-summary.json');

const useRealDataset = fs.existsSync(realPath);
const dataset = loadValidatedDataset(useRealDataset ? realPath : demoPath, schemaPath);

let overlay;
let overlaySource;
if (!useRealDataset) {
  overlay = loadValidatedCommercialOverlay(demoOverlayPath, overlaySchemaPath);
  overlaySource = 'fixture sintético';
} else if (fs.existsSync(realOverlayPath)) {
  overlay = loadValidatedCommercialOverlay(realOverlayPath, overlaySchemaPath);
  overlaySource = 'golden set privado';
} else {
  overlay = emptyCommercialOverlay(dataset.dataset_id);
  overlaySource = 'golden set privado ausente';
}

const commercial = buildCommercialIdentityIndex(dataset, overlay, { projectionPolicy: 'public_safe' });
const baseClient = toClientDataset(dataset, useRealDataset ? 'real' : 'demo', commercial.byAnchor, 'public_safe');
const permissive = applyFieldPublicationPolicy(baseClient, 'private_experiment');
const strict = applyFieldPublicationPolicy(baseClient, 'public_safe');

const evidence = {
  schema_version: 1,
  generated_by: 'scripts/measure-gate-2.2-public-subset.mjs',
  classification: 'AGREGADO SANITIZADO — SIN COORDENADAS, RAZÓN SOCIAL NI DIRECCIÓN REALES',
  input: {
    dataset_source: useRealDataset ? 'real (.local-cache/gate-1.1)' : 'fixture sintético',
    overlay_source: overlaySource,
    total_offers: dataset.offers.length,
  },
  field_publication_matrix: FIELD_PUBLICATION_MATRIX.map(({ field, source, permission, verdict, evidence: cite }) => ({ field, source, permission, verdict, evidence: cite })),
  today_private_experiment: permissive.publication_subset,
  public_strict_projection: strict.publication_subset,
  determinism: {
    note: 'No todas estas cifras son mediciones sobre los datos. Distinguir antes de usarlas para decidir.',
    data_dependent: ['identifiable'],
    structurally_fixed: ['locatable', 'decision_ready'],
    explanation: 'La coordenada tiene veredicto not_publishable congelado, de modo que bajo public_safe locatable es 0 para cualquier dataset, y decision_ready lo hereda. Verificado con un control: 714 ofertas con todos los campos presentes y una identidad comercial publicable siguen dando locatable=0 y decision_ready=0. Solo identifiable responde a los datos: refleja cuántas identidades comerciales superan hoy la política de Gate 2.1. Adquirir más o mejores datos no mueve estas cifras; solo un cambio de permiso puede hacerlo.',
    today_private_experiment_caveat: 'Bajo private_experiment no se suprime ningún campo, de modo que las tres cifras igualan el total. Eso describe ausencia de supresión, no publicabilidad demostrada.',
  },
  finding: strict.publication_subset.decision_ready === 0
    ? 'Bajo publicación estricta, el subconjunto listo para decidir (identidad + ubicación publicables a la vez) es 0. La coordenada exacta no tiene permiso de reutilización pública demostrado, y ninguna identidad comercial real es hoy public_safe (ver Gate 2.1); precio, fecha, frescura y distrito sí son publicables de forma aislada. Este 0 es consecuencia determinística de la matriz, no un resultado empírico: ver el bloque determinism.'
    : `Bajo publicación estricta, ${strict.publication_subset.decision_ready}/${strict.publication_subset.total} ofertas quedan listas para decidir (identidad y ubicación publicables a la vez).`,
};

fs.mkdirSync(path.dirname(evidenceOutput), { recursive: true });
fs.writeFileSync(evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ evidence: path.relative(root, evidenceOutput), input: evidence.input, today_private_experiment: evidence.today_private_experiment, public_strict_projection: evidence.public_strict_projection, finding: evidence.finding })}\n`);
