#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidatedDataset, toClientDataset } from './contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(root, 'app', 'public');
const schemaPath = path.join(root, 'contracts', 'gate-1.1-experiment-dataset.schema.json');
const realPath = path.join(root, '.local-cache', 'gate-1.1', '2026-08-14', 'experiment-dataset-lima-province.json');
const demoPath = path.join(root, 'fixtures', 'gate-1.1', 'experiment-dataset.synthetic.json');
const host = '127.0.0.1';

function parseOptions(argv) {
  const options = { demo: false, port: 4173 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--demo') options.demo = true;
    else if (argv[index] === '--port') {
      const port = Number(argv[index + 1]);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port requiere un entero entre 1024 y 65535');
      options.port = port;
      index += 1;
    } else throw new Error(`Opción desconocida: ${argv[index]}`);
  }
  return options;
}

const options = parseOptions(process.argv.slice(2));
const useDemo = options.demo || !fs.existsSync(realPath);
const datasetPath = useDemo ? demoPath : realPath;
const dataset = loadValidatedDataset(datasetPath, schemaPath);
const clientDataset = JSON.stringify(toClientDataset(dataset, useDemo ? 'demo' : 'real'));

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
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
  process.stdout.write(`http://${host}:${options.port}\n`);
  if (!options.demo && useDemo) process.stdout.write('Dataset privado ausente: se inició automáticamente con el fixture sintético.\n');
});
