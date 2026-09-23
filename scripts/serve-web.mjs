#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeShellManifest } from '../pipeline/shell-manifest.mjs';
import { resolvePath } from '../web/lib/routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'web');
// La precache se genera al arrancar: en local nunca hay que acordarse de nada
// para que el service worker vea el shell que se está editando.
const shell = writeShellManifest({ root });
const port = Number(process.env.PORT ?? 4173);
const types = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.webmanifest','application/manifest+json'],['.svg','image/svg+xml']]);
const server = http.createServer((request,response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  // La misma tabla que `_redirects` y el service worker: las vistas son la
  // portada sin cambiar la URL, la barra final y los enlaces antiguos responden
  // 301, y lo demás es un archivo o 404.
  const ruta = resolvePath(url.pathname);
  if (ruta.kind === 'redirect') { response.writeHead(301, { Location: `${ruta.to}${url.search}` }); response.end(); return; }
  const route = ruta.kind === 'view' ? '/index.html' : url.pathname;
  const relative = path.posix.normalize(route).replace(/^\/+/, ''); const file = path.join(webRoot, relative);
  if (!file.startsWith(`${webRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Como Pages: la página 404 propia, con su código de estado; sin ella, texto.
    const notFound = path.join(webRoot, '404.html');
    if (fs.existsSync(notFound)) { response.writeHead(404, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}); if (request.method === 'GET') fs.createReadStream(notFound).pipe(response); else response.end(); return; }
    response.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); response.end('No encontrado'); return;
  }
  const headers = {'Content-Type':types.get(path.extname(file)) ?? 'application/octet-stream','Cache-Control':relative === 'data/gasolina/manifest.json' ? 'no-store' : relative.startsWith('data/gasolina/snapshots/') ? 'public, max-age=31536000, immutable' : 'no-cache','Service-Worker-Allowed':'/','X-Content-Type-Options':'nosniff'};
  response.writeHead(200,headers); if(request.method==='GET')fs.createReadStream(file).pipe(response); else response.end();
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`masfacil.pe local en http://127.0.0.1:${port}\nPrecache derivada: ${shell.cache} · ${shell.entries.length} entradas\n`));
