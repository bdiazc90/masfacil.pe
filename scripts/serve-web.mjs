#!/usr/bin/env node
// Servidor local fiel a Cloudflare Pages: la misma tabla de rutas que el sitio
// (`web/lib/routes.js`), `_headers` completo —CSP incluida—, ETag/304 y la 404
// propia. Sirve el artefacto publicable: antes compila la interfaz y deriva la
// precache, así que el service worker ve el shell que se está editando. Para
// cambios en caliente está `npm run dev`, que no acredita CSP, 404 ni modo sin red.
//
//   npm run serve                    http://127.0.0.1:4173
//   npm run serve -- --lan           además, el teléfono por HTTPS en la red local
//   npm run serve -- --port 8080 --cache prod --no-build --root <árbol>
//
// `serveWeb()` es la misma pieza que usan las sondas de `scripts/probes/`.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPOS = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'],
  ['.webmanifest', 'application/manifest+json'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);
// Lo que Pages inyecta en cada HTML cuando Web Analytics está activo.
const BEACON = `<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "prueba-local"}'></script><!-- Cloudflare Pages Analytics -->`;

/** `_headers` de Pages: bloques de patrón y cabeceras; los patrones admiten `*`. */
export function readHeaders(texto) {
  const reglas = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    if (!/^\s/.test(linea)) {
      reglas.push({
        patron: new RegExp(
          `^${linea
            .trim()
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')}$`,
        ),
        cabeceras: {},
      });
      continue;
    }
    const [, nombre, valor] = /^\s+([^:]+):\s*(.+)$/.exec(linea) ?? [];
    if (nombre && reglas.length) reglas.at(-1).cabeceras[nombre] = valor;
  }
  return reglas;
}

/** Las cabeceras de una ruta: todas las reglas que casan, la última manda. */
export const headersFor = (reglas, ruta) =>
  Object.assign({}, ...reglas.filter((r) => r.patron.test(ruta)).map((r) => r.cabeceras));

/**
 * `dev`: la cabecera declarada o `no-cache`, que revalida con ETag en cada carga.
 * `prod`: el peor caso medido en la zona el 23/09/2026 —JS, CSS e imágenes a 4 h;
 * HTML y webmanifest a 0; `no-cache` → 4 h—, para las sondas de actualización.
 */
export function cacheControl(modo, ext, declarada) {
  if (modo !== 'prod') return declarada ?? 'no-cache';
  if (ext === '.html' || ext === '.webmanifest') return 'public, max-age=0, must-revalidate';
  if (declarada === 'no-store') return declarada;
  if (declarada === 'no-cache') return 'max-age=14400';
  const maxAge = Number(/max-age=(\d+)/.exec(declarada ?? '')?.[1] ?? -1);
  return maxAge >= 14400 ? declarada : 'public, max-age=14400, must-revalidate';
}

/**
 * Sirve `<root>/web` como Pages. `port: 0` elige uno libre. `tls`: `{cert, key}`.
 * @returns {Promise<{origin: string, shell: string, close: () => Promise<void>}>}
 */
export async function serveWeb({
  root = REPO,
  port = 4173,
  host = '127.0.0.1',
  build = true,
  cache = 'dev',
  analytics = false,
  tls = null,
} = {}) {
  const raiz = path.resolve(root);
  const webRoot = path.join(raiz, 'web');
  if (build) await (await import(pathToFileURL(path.join(raiz, 'pipeline', 'ui-build.mjs')))).buildUi({ root: raiz });
  const { writeShellManifest } = await import(pathToFileURL(path.join(raiz, 'pipeline', 'shell-manifest.mjs')));
  const { resolvePath } = await import(pathToFileURL(path.join(webRoot, 'lib', 'routes.js')));
  const shell = writeShellManifest({ root: raiz });
  const reglas = readHeaders(fs.readFileSync(path.join(webRoot, '_headers'), 'utf8'));

  const responder = (request, response, estado, ruta, archivo) => {
    const ext = path.extname(archivo);
    let cuerpo = fs.readFileSync(archivo);
    if (ext === '.html' && analytics)
      cuerpo = Buffer.from(cuerpo.toString('utf8').replace('</body>', `${BEACON}</body>`));
    const { 'Cache-Control': declarada, ...resto } = headersFor(reglas, ruta);
    const etag = `W/"${crypto.createHash('sha1').update(cuerpo).digest('hex')}"`;
    const cabeceras = {
      ...resto,
      'Content-Type': TIPOS.get(ext) ?? 'application/octet-stream',
      'Cache-Control': cacheControl(cache, ext, declarada),
      ETag: etag,
    };
    if (estado === 200 && request.headers['if-none-match'] === etag) {
      response.writeHead(304, cabeceras);
      response.end();
      return;
    }
    response.writeHead(estado, cabeceras);
    response.end(request.method === 'GET' ? cuerpo : undefined);
  };
  const manejar = (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://local');
    // La misma tabla que `_redirects` y el service worker: las vistas son la
    // portada sin cambiar la URL, la barra final y los enlaces antiguos responden
    // 301, y lo demás es un archivo o la 404 propia con su código.
    const ruta = resolvePath(url.pathname);
    if (ruta.kind === 'redirect') {
      response.writeHead(301, { ...headersFor(reglas, url.pathname), Location: `${ruta.to}${url.search}` });
      response.end();
      return;
    }
    if (ruta.kind === 'view') {
      responder(request, response, 200, url.pathname, path.join(webRoot, 'index.html'));
      return;
    }
    const relativo = path.posix.normalize(url.pathname).replace(/^\/+/, '');
    const archivo = path.join(webRoot, relativo);
    if (
      archivo.startsWith(`${webRoot}${path.sep}`) &&
      !relativo.startsWith('_') &&
      fs.existsSync(archivo) &&
      fs.statSync(archivo).isFile()
    ) {
      responder(request, response, 200, url.pathname, archivo);
      return;
    }
    responder(request, response, 404, url.pathname, path.join(webRoot, '404.html'));
  };

  const server = tls ? https.createServer(tls, manejar) : http.createServer(manejar);
  await new Promise((ok, ko) => {
    server.once('error', ko);
    server.listen(port, host, ok);
  });
  const origin = `${tls ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`;
  return {
    origin,
    shell: shell.cache,
    entries: shell.entries.length,
    close: () =>
      new Promise((ok) => {
        server.closeAllConnections?.();
        server.close(() => ok());
      }),
  };
}

/** La IP privada de la Mac en la red local, o `null`. */
export function lanAddress() {
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista ?? [])
      if (i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))
        return i.address;
  }
  return null;
}

/**
 * CA de prueba y certificado para `ip`, en `.local-cache/tls/` (nunca en Git). La
 * CA dura 30 días y solo vale para redes privadas y localhost (nameConstraints),
 * así que su clave no sirve para suplantar un sitio público. El certificado del
 * servidor se rehace si cambia la IP o vence; la CA, solo si vence.
 */
export function localTls(ip, dir = path.join(REPO, '.local-cache', 'tls')) {
  fs.mkdirSync(dir, { recursive: true });
  const ruta = (nombre) => path.join(dir, nombre);
  const ssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const vigente = (crt) => {
    try {
      ssl('x509', '-in', crt, '-noout', '-checkend', '86400');
      return true;
    } catch {
      return false;
    }
  };
  if (!fs.existsSync(ruta('ca.crt')) || !vigente(ruta('ca.crt'))) {
    fs.writeFileSync(
      ruta('ca.cnf'),
      [
        '[req]',
        'distinguished_name = dn',
        '[dn]',
        '[v3_ca_local]',
        'basicConstraints = critical,CA:TRUE,pathlen:0',
        'keyUsage = critical,keyCertSign,cRLSign',
        'subjectKeyIdentifier = hash',
        'nameConstraints = critical,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:127.0.0.1/255.255.255.255,permitted;DNS:localhost',
        '',
      ].join('\n'),
    );
    ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', ruta('ca.key'));
    ssl(
      'req',
      '-x509',
      '-new',
      '-key',
      ruta('ca.key'),
      '-sha256',
      '-days',
      '30',
      '-subj',
      '/CN=masfacil prueba local',
      '-config',
      ruta('ca.cnf'),
      '-extensions',
      'v3_ca_local',
      '-out',
      ruta('ca.crt'),
    );
    ssl('x509', '-in', ruta('ca.crt'), '-outform', 'der', '-out', ruta('masfacil-prueba-local.cer'));
    fs.rmSync(ruta('servidor.crt'), { force: true });
    fs.chmodSync(ruta('ca.key'), 0o600);
  }
  const cubre = () => {
    try {
      return ssl('x509', '-in', ruta('servidor.crt'), '-noout', '-checkip', ip).includes('does match');
    } catch {
      return false;
    }
  };
  if (!fs.existsSync(ruta('servidor.crt')) || !vigente(ruta('servidor.crt')) || !cubre()) {
    fs.writeFileSync(
      ruta('servidor.cnf'),
      [
        '[servidor]',
        `subjectAltName = IP:${ip},IP:127.0.0.1,DNS:localhost`,
        'extendedKeyUsage = serverAuth',
        'keyUsage = critical,digitalSignature',
        'basicConstraints = critical,CA:FALSE',
        '',
      ].join('\n'),
    );
    ssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', ruta('servidor.key'));
    ssl(
      'req',
      '-new',
      '-key',
      ruta('servidor.key'),
      '-subj',
      `/CN=${ip}`,
      '-config',
      ruta('ca.cnf'),
      '-out',
      ruta('servidor.csr'),
    );
    ssl(
      'x509',
      '-req',
      '-in',
      ruta('servidor.csr'),
      '-CA',
      ruta('ca.crt'),
      '-CAkey',
      ruta('ca.key'),
      '-set_serial',
      `0x${crypto.randomBytes(16).toString('hex')}`,
      '-days',
      '30',
      '-sha256',
      '-extfile',
      ruta('servidor.cnf'),
      '-extensions',
      'servidor',
      '-out',
      ruta('servidor.crt'),
    );
    fs.chmodSync(ruta('servidor.key'), 0o600);
  }
  return {
    cert: fs.readFileSync(ruta('servidor.crt')),
    key: fs.readFileSync(ruta('servidor.key')),
    cer: ruta('masfacil-prueba-local.cer'),
  };
}

function parseArgs(args) {
  const o = { port: Number(process.env.PORT ?? 4173), lanPort: 4443 };
  for (let i = 0; i < args.length; i += 1) {
    const valor = () => args[++i];
    if (args[i] === '--port') o.port = Number(valor());
    else if (args[i] === '--host') o.host = valor();
    else if (args[i] === '--root') o.root = valor();
    else if (args[i] === '--cache') o.cache = valor();
    else if (args[i] === '--no-build') o.build = false;
    else if (args[i] === '--analytics') o.analytics = true;
    else if (args[i] === '--lan') o.lan = true;
    else if (args[i] === '--lan-port') o.lanPort = Number(valor());
    else throw new Error(`Opción desconocida: ${args[i]}`);
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { lan, lanPort, ...opciones } = parseArgs(process.argv.slice(2));
  const local = await serveWeb(opciones);
  const lineas = ['masfacil.pe local', `  esta máquina: ${local.origin}`];
  if (lan) {
    // Fuera de localhost solo un origen seguro tiene `crypto.subtle` (la huella de
    // los datos), worker y GPS: por HTTP, el teléfono no carga precios.
    const ip = lanAddress();
    if (!ip) throw new Error('No hay una IP privada de red local: conecta la Mac a la Wi-Fi.');
    const tls = localTls(ip);
    const red = await serveWeb({
      ...opciones,
      build: false,
      host: ip,
      port: lanPort,
      tls: { cert: tls.cert, key: tls.key },
    });
    lineas.push(
      `  teléfono (misma Wi-Fi): ${red.origin}`,
      '',
      'La primera vez, en el iPhone:',
      `  1. Pasa ${path.relative(process.cwd(), tls.cer)} por AirDrop e instálalo en Ajustes → Perfil descargado.`,
      '  2. Actívalo en Ajustes → General → Información → Ajustes de confianza de certificados.',
      '  Al terminar, bórralo en Ajustes → General → VPN y gestión de dispositivos.',
    );
  }
  lineas.push('', `Precache derivada: ${local.shell} · ${local.entries} entradas`);
  process.stdout.write(`${lineas.join('\n')}\n`);
}
