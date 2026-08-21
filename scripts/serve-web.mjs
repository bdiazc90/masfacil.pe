#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'web');
const port = Number(process.env.PORT ?? 4173);
const types = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.webmanifest','application/manifest+json'],['.svg','image/svg+xml']]);
const server = http.createServer((request,response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/') { response.writeHead(302, { Location: '/gasolina/' }); response.end(); return; }
  if (url.pathname === '/gasolina') { response.writeHead(302, { Location: '/gasolina/' }); response.end(); return; }
  const route = url.pathname === '/gasolina/' ? '/gasolina/index.html' : /^\/gasolina\/(regular|premium)\/?$/.test(url.pathname) ? '/index.html' : url.pathname;
  const relative = path.posix.normalize(route).replace(/^\/+/, ''); const file = path.join(webRoot, relative);
  if (!file.startsWith(`${webRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); response.end('No encontrado'); return; }
  const headers = {'Content-Type':types.get(path.extname(file)) ?? 'application/octet-stream','Cache-Control':relative === 'data/manifest.json' || relative === 'data/gasolina/manifest.json' ? 'no-store' : relative.startsWith('data/snapshots/') || relative.startsWith('data/gasolina/snapshots/') ? 'public, max-age=31536000, immutable' : 'no-cache','Service-Worker-Allowed':'/','X-Content-Type-Options':'nosniff'};
  response.writeHead(200,headers); if(request.method==='GET')fs.createReadStream(file).pipe(response); else response.end();
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`masfacil.pe local en http://127.0.0.1:${port}\n`));
