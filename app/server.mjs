#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommercialIdentityIndex, emptyCommercialOverlay, loadValidatedCommercialOverlay } from './commercial-overlay.mjs';
import { loadValidatedDataset, toClientDataset } from './contract.mjs';
import { applyFieldPublicationPolicy } from './publication-matrix.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'app', 'public');
const schemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const realPath = path.join(root, '.local-cache', 'gate-1.1', '2026-08-14', 'experiment-dataset-lima-province.json');
const demoPath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const overlaySchemaPath = path.join(root, 'contracts', 'gate-2.1-commercial-identity-overlay.schema.json');
const demoOverlayPath = path.join(root, 'fixtures', 'gate-2.1', 'commercial-identity-overlay.synthetic.json');
const realOverlayPath = path.join(root, '.local-cache', 'gate-2.1', 'commercial-identity-overlay.json');
const host = '127.0.0.1';

function parseOptions(argv) {
  const options = { demo: false, privatePreview: false, publicStrict: false, port: 4173 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--demo') options.demo = true;
    else if (argv[index] === '--private-preview') options.privatePreview = true;
    else if (argv[index] === '--public-strict') options.publicStrict = true;
    else if (argv[index] === '--port') {
      const port = Number(argv[index + 1]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port requiere un entero entre 1024 y 65535');
      options.port = port;
      index += 1;
    } else throw new Error(`Opción desconocida: ${argv[index]}`);
  }
  if (options.privatePreview && options.publicStrict) throw new Error('--private-preview y --public-strict son contradictorios: no pueden combinarse');
  return options;
}

const options = parseOptions(process.argv.slice(2));
const useDemo = options.demo || !fs.existsSync(realPath);
const datasetPath = useDemo ? demoPath : realPath;
const dataset = loadValidatedDataset(datasetPath, schemaPath);
let overlay;
let overlaySource;
if (useDemo) {
  overlay = loadValidatedCommercialOverlay(demoOverlayPath, overlaySchemaPath);
  overlaySource = 'fixture sintético';
} else if (fs.existsSync(realOverlayPath)) {
  if ((fs.statSync(realOverlayPath).mode & 0o077) !== 0) throw new Error('El golden set comercial privado debe tener permisos 0600');
  overlay = loadValidatedCommercialOverlay(realOverlayPath, overlaySchemaPath);
  overlaySource = 'golden set privado';
} else {
  overlay = emptyCommercialOverlay(dataset.dataset_id);
  overlaySource = 'golden set privado ausente';
}
const identityPolicy = options.privatePreview ? 'private_preview' : 'public_safe';
const fieldPolicy = options.publicStrict ? 'public_safe' : 'private_experiment';
const commercial = buildCommercialIdentityIndex(dataset, overlay, { projectionPolicy: identityPolicy });
const baseClientDataset = toClientDataset(dataset, useDemo ? 'demo' : 'real', commercial.byAnchor, identityPolicy);
const clientDatasetObject = applyFieldPublicationPolicy(baseClientDataset, fieldPolicy);
const clientDataset = JSON.stringify(clientDatasetObject);

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function headers(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

function send(res, status, body, contentType) {
  res.writeHead(status, headers(contentType));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${options.port}`);
  if (req.method !== 'GET') {
    send(res, 405, JSON.stringify({ error: 'Método no permitido' }), 'application/json; charset=utf-8');
    return;
  }
  if (url.pathname === '/api/dataset') {
    send(res, 200, clientDataset, 'application/json; charset=utf-8');
    return;
  }
  const route = url.pathname === '/' ? '/index.html' : url.pathname;
  const relative = path.posix.normalize(route).replace(/^\/+/, '');
  const file = path.join(publicRoot, relative);
  if (!file.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    send(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
    return;
  }
  send(res, 200, fs.readFileSync(file), types.get(path.extname(file)) ?? 'application/octet-stream');
});

server.on('error', (error) => {
  process.stderr.write(`No se pudo iniciar la web local: ${error.message}\n`);
  process.exitCode = 1;
});

server.listen(options.port, host, () => {
  process.stdout.write(`Facilito UX Lab — modo ${useDemo ? 'demo' : 'real'} (${dataset.offers.length} ofertas)\n`);
  process.stdout.write(`Overlay comercial — ${overlaySource}: ${commercial.metrics.projected}/${commercial.metrics.entries} identidades proyectables · política ${identityPolicy}\n`);
  const subset = clientDatasetObject.publication_subset;
  process.stdout.write(fieldPolicy === 'public_safe'
    ? `Publicación de campos — public_safe: ${subset.decision_ready}/${subset.total} ofertas con identidad y ubicación publicables (${subset.identifiable}/${subset.total} identificables, ${subset.locatable}/${subset.total} ubicables). Ubicables y listas para decidir son 0 por la matriz, no por los datos.\n`
    : `Publicación de campos — private_experiment: sin supresión; ${subset.total} ofertas completas. No se evalúa publicabilidad en esta política.\n`);
  process.stdout.write(`http://${host}:${options.port}\n`);
  if (!options.demo && useDemo) process.stdout.write('Dataset privado ausente: se inició automáticamente con el fixture sintético.\n');
});
