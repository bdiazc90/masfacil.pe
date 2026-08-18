#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SOURCE_URLS } from '../app/source-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = '2026-08-14';
const cacheRoot = path.join(root, '.local-cache', 'gate-0.2', snapshot, 'acquired');
const provenanceRoot = path.join(root, 'data', 'provenance', snapshot);
const acquisitionLog = path.join(provenanceRoot, 'acquisitions.jsonl');
const userAgent = 'Mozilla/5.0 (compatible; facilito-ux-lab/0.2; public-data-research)';

const sources = {
  'glp-current': {
    url: CANONICAL_SOURCE_URLS.glp_current,
    output: 'price-glp/GLP-Registro-precios-PIC-PE-V.csv',
  },
  'liquid-current': {
    url: CANONICAL_SOURCE_URLS.liquid_current,
    output: 'price-liquid/CL-Registro-precios-DMA-V-CCA-CCE.csv',
  },
  'ubigeo-catalog': {
    url: 'https://www.datosabiertos.gob.pe/api/3/action/package_show?id=fd98ecaf-c53c-44ed-be1c-a37b7afc6f3e',
    output: 'ubigeo/catalog.json',
  },
  'ubigeo-current': {
    url: 'https://www.datosabiertos.gob.pe/sites/default/files/UBIGEO%202022_1891%20distritos.xlsx',
    output: 'ubigeo/UBIGEO-2022-1891-distritos.xlsx',
  },
  'dmin-catalog': {
    url: 'https://www.datosabiertos.gob.pe/api/3/action/package_show?id=20921426-6c40-4b86-af69-802066bd55ea',
    output: 'catalogs/dmin.json',
  },
  'daily-catalog': {
    url: 'https://www.datosabiertos.gob.pe/api/3/action/package_show?id=288e1362-0bf8-448f-8665-45058674ec5f',
    output: 'catalogs/daily-anonymized.json',
  },
  'glp-catalog': {
    url: 'https://www.datosabiertos.gob.pe/api/3/action/package_show?id=a5326a6b-7064-4cec-a78f-6f3680e9eee2',
    output: 'catalogs/glp.json',
  },
  'liquid-catalog': {
    url: 'https://www.datosabiertos.gob.pe/api/3/action/package_show?id=35e929b0-085a-47a3-86a4-483da58fda25',
    output: 'catalogs/liquid.json',
  },
  'price-documents': {
    url: 'https://www.osinergmin.gob.pe/empresas/hidrocarburos/scop/documentos-scop',
    output: 'surfaces/price-documents.html',
  },
};

function parseHeaderBlocks(text) {
  return text.replace(/\r\n/g, '\n').split(/\n\n+/).map((block) => block.trim()).filter(Boolean)
    .filter((block) => /^HTTP\//.test(block))
    .map((block) => {
      const [statusLine, ...lines] = block.split('\n');
      const status = Number(statusLine.match(/^HTTP\/\S+\s+(\d+)/)?.[1]);
      const headers = {};
      for (const line of lines) {
        const index = line.indexOf(':');
        if (index < 1) continue;
        const key = line.slice(0, index).trim().toLowerCase();
        const value = line.slice(index + 1).trim();
        headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
      }
      return { status, headers };
    });
}

function materialHeaders(headers) {
  const names = ['accept-ranges', 'cache-control', 'content-disposition', 'content-length', 'content-range', 'content-type', 'date', 'etag', 'last-modified', 'location'];
  return Object.fromEntries(names.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]));
}

function existingRecords() {
  if (!fs.existsSync(acquisitionLog)) return [];
  return fs.readFileSync(acquisitionLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

async function acquire(id, source) {
  if (existingRecords().some((record) => record.source_id === id)) throw new Error(`${id}: ya existe un registro de adquisición; se rechaza una nueva solicitud`);
  const output = path.join(cacheRoot, source.output);
  const partial = `${output}.part`;
  const headerFile = `${output}.headers.part`;
  if ([output, partial, headerFile].some(fs.existsSync)) throw new Error(`${id}: ya existe un archivo local; no se sobrescribe`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(provenanceRoot, { recursive: true });

  const requestedAt = new Date().toISOString();
  const requested = new URL(source.url);
  const args = [
    '--fail', '--location', '--silent', '--show-error',
    '--range', '0-',
    '--header', 'Accept-Encoding: identity',
    '--user-agent', userAgent,
    '--dump-header', headerFile,
    '--output', '-',
    source.url,
  ];
  const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let nextProgress = 64 * 1024 * 1024;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      if (bytes >= nextProgress) {
        process.stdout.write(`${id}: ${Math.floor(bytes / 1048576)} MiB recibidos\n`);
        nextProgress += 64 * 1024 * 1024;
      }
      callback(null, chunk);
    },
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${id}: curl terminó con ${code}: ${stderr.trim()}`)));
  });
  await Promise.all([pipeline(child.stdout, meter, fs.createWriteStream(partial, { flags: 'wx' })), exit]);
  const completedAt = new Date().toISOString();
  const chain = parseHeaderBlocks(fs.readFileSync(headerFile, 'utf8'));
  if (!chain.length) throw new Error(`${id}: no se pudo interpretar la respuesta HTTP`);
  const final = chain.at(-1);
  if (![200, 206].includes(final.status)) throw new Error(`${id}: estado final inesperado ${final.status}`);
  fs.renameSync(partial, output);
  fs.unlinkSync(headerFile);
  const record = {
    source_id: id,
    requested_url: `${requested.origin}${requested.pathname}`,
    query_parameters: Object.fromEntries(requested.searchParams.entries()),
    request_headers: { range: 'bytes=0-', 'accept-encoding': 'identity', 'user-agent': userAgent },
    requested_at: requestedAt,
    completed_at: completedAt,
    final_url: source.url,
    response_chain: chain.map((item) => ({ status: item.status, headers: materialHeaders(item.headers) })),
    response_status: final.status,
    response_headers: materialHeaders(final.headers),
    bytes,
    sha256: hash.digest('hex'),
    cache_path: path.relative(root, output),
  };
  fs.appendFileSync(acquisitionLog, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  process.stdout.write(`${id}: ${bytes} bytes, HTTP ${final.status}, sha256 ${record.sha256}\n`);
}

const requestedIds = process.argv.slice(2);
if (!requestedIds.length || requestedIds.some((id) => !sources[id])) {
  process.stderr.write(`Uso: node scripts/acquire-gate-0.2.mjs ${Object.keys(sources).join(' ')}\n`);
  process.exit(2);
}

for (const id of requestedIds) await acquire(id, sources[id]);
