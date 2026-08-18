import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { once } from 'node:events';
import { compareSnapshotValidators } from '../app/validator-comparison.mjs';
import { probeSnapshotValidators } from '../app/http-validator-probe.mjs';
import { CANONICAL_SOURCE_URLS } from '../app/source-catalog.mjs';

const local = { etag: '"snapshot-a"', last_modified: 'Fri, 14 Aug 2026 12:28:52 GMT' };

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('la interfaz pura distingue coincidencia, diferencia y ambigüedad sin interpretar ETag', () => {
  assert.equal(compareSnapshotValidators(local, local), 'unchanged');
  assert.equal(compareSnapshotValidators(local, { ...local, etag: '"snapshot-b"' }), 'changed');
  assert.equal(compareSnapshotValidators(local, { etag: null, last_modified: null }), 'unverifiable');
  assert.equal(compareSnapshotValidators(local, { etag: local.etag, last_modified: null }), 'unverifiable');
  assert.equal(compareSnapshotValidators({ etag: null, last_modified: null }, local), 'unverifiable');
});

test('HEAD condicional con 304 devuelve unchanged sin GET ni cuerpo', async () => {
  const calls = [];
  await withServer((request, response) => {
    calls.push({ method: request.method, headers: request.headers });
    if (request.method === 'HEAD' && request.headers['if-none-match'] === local.etag) {
      response.writeHead(304);
      response.end();
      return;
    }
    response.writeHead(500);
    response.end();
  }, async (url) => {
    const result = await probeSnapshotValidators({ url, local });
    assert.equal(result.status, 'unchanged');
    assert.equal(result.bytes_consumed, 0);
    assert.deepEqual(calls.map(({ method }) => method), ['HEAD']);
    assert.equal(calls[0].headers['if-modified-since'], local.last_modified);
  });
});

test('HEAD con validador diferente devuelve changed sin fallback', async () => {
  const calls = [];
  await withServer((request, response) => {
    calls.push(request.method);
    response.writeHead(200, { ETag: '"snapshot-b"', 'Last-Modified': local.last_modified });
    response.end();
  }, async (url) => {
    const result = await probeSnapshotValidators({ url, local });
    assert.equal(result.status, 'changed');
    assert.deepEqual(calls, ['HEAD']);
    assert.equal(result.bytes_consumed, 0);
  });
});

test('HEAD 200 con los mismos validadores devuelve unchanged sin depender de un 304', async () => {
  const calls = [];
  await withServer((request, response) => {
    calls.push(request.method);
    response.writeHead(200, { ETag: local.etag, 'Last-Modified': local.last_modified });
    response.end();
  }, async (url) => {
    const result = await probeSnapshotValidators({ url, local });
    assert.equal(result.status, 'unchanged');
    assert.deepEqual(calls, ['HEAD']);
    assert.equal(result.bytes_consumed, 0);
  });
});

test('HEAD/GET sin validadores o con condicional ignorada devuelve unverifiable sin consumir el cuerpo', async () => {
  const calls = [];
  await withServer((request, response) => {
    calls.push({ method: request.method, range: request.headers.range });
    response.writeHead(200, { 'Content-Length': String(1024 * 1024) });
    if (request.method === 'GET') {
      response.write(Buffer.alloc(1024 * 1024));
      setTimeout(() => response.end(), 50);
    } else response.end();
  }, async (url) => {
    const result = await probeSnapshotValidators({ url, local, timeoutMs: 500 });
    assert.equal(result.status, 'unverifiable');
    assert.deepEqual(calls.map(({ method }) => method), ['HEAD', 'GET']);
    assert.equal(calls[1].range, 'bytes=0-0');
    assert.equal(result.bytes_consumed, 0);
  });
});

test('timeout o error HTTP nunca se convierte en unchanged', async () => {
  await withServer(() => {}, async (url) => {
    const result = await probeSnapshotValidators({ url, local, timeoutMs: 25 });
    assert.equal(result.status, 'unverifiable');
    assert.match(result.reason, /timeout|error HTTP/);
  });
  await withServer((request, response) => {
    response.writeHead(503);
    response.end('no disponible');
  }, async (url) => {
    const result = await probeSnapshotValidators({ url, local, timeoutMs: 500 });
    assert.equal(result.status, 'unverifiable');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].method, 'HEAD');
  });
});

test('la URL canónica líquida permanece alineada con la adquisición existente', async () => {
  const acquireSource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/acquire-gate-0.2.mjs', import.meta.url), 'utf8'));
  assert.match(acquireSource, /CANONICAL_SOURCE_URLS\.liquid_current/);
  assert.match(CANONICAL_SOURCE_URLS.liquid_current, /CL-Registro-precios-DMA-V-CCA-CCE\.csv$/);
});
