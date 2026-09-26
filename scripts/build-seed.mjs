#!/usr/bin/env node

// La semilla v3 de Registro y GIS: la v2 —la de siempre más los gasocentros de
// GLP (Registro 15, capa GIS 36)— más la venta al público de GNV (Registro 59,
// que también vive en la capa 36). El formato es el de la 2.
//
//   node scripts/build-seed.mjs            comprueba sin escribir
//   node scripts/build-seed.mjs --write    escribe el secret privado y el manifest
//
// Lee las tablas privadas completas del snapshot de referencia, que solo viven
// en `.local-cache/`, y exige dos cosas antes de escribir nada:
// - la semilla se decodifica con su propio manifest, igual que en CI;
// - recortada a los filtros de la semilla anterior, es idéntica a ella byte a
//   byte. Ampliar la semilla no puede cambiar las filas de los grupos que ya
//   publican; `--breaking` es la única forma de saltarse esa comprobación.
//
// Con `--write` guarda la semilla anterior y su manifest como `.v2` y escribe
// `.local-cache/publish/bootstrap-seed.{b64,json.gz}` y `bootstrap/seed.manifest.json`.
// A consola solo salen conteos y huellas. El `.b64` es el valor del secret
// `BOOTSTRAP_SEED_B64` del entorno `pages-production`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedPayload, decodeSeed, gzipCanonical, restrictSeed, seedManifest, stableJson } from '../app/bootstrap-seed.mjs';
import { GIS_FIELDS, REGISTRY_FIELDS, readTable } from '../pipeline/csv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const BREAKING = process.argv.includes('--breaking');
const VERSION = 'v3';
const FILTROS = Object.freeze({ source_activity: ['01', '02', '05', '06', '15', '59'], layers: ['35', '36'] });

const manifestPath = path.join(root, 'bootstrap', 'seed.manifest.json');
const publish = path.join(root, '.local-cache', 'publish');
const leer = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// La semilla anterior es la del manifest del árbol mientras no sea esta; ya
// escrita, es el respaldo que dejó `--write`.
const vigente = leer(manifestPath);
const yaEscrita = vigente.seed_id?.endsWith(`-${VERSION}`);
const anterior = yaEscrita
  ? { manifest: leer(path.join(publish, 'seed.manifest.v2.json')), encoded: fs.readFileSync(path.join(publish, 'bootstrap-seed.b64.v2'), 'utf8') }
  : { manifest: vigente, encoded: fs.readFileSync(path.join(publish, 'bootstrap-seed.b64'), 'utf8') };
const previa = decodeSeed(anterior.encoded, anterior.manifest);

const tablas = path.join(root, '.local-cache', 'raw', anterior.manifest.reference_snapshot_date, 'superseded-uncompressed', 'minimized');
const registryRows = await readTable(path.join(tablas, 'registry', 'authorizations.csv'), REGISTRY_FIELDS);
const gisRows = await readTable(path.join(tablas, 'gis', 'features.csv'), GIS_FIELDS);
const payload = buildSeedPayload({ registryRows, gisRows, filters: FILTROS, referenceDate: anterior.manifest.reference_snapshot_date });
const manifest = seedManifest(payload, { seedId: `registry-gis-lima-${payload.reference_snapshot_date}-${VERSION}`, filters: FILTROS, privacy: anterior.manifest.privacy });
const encoded = gzipCanonical(payload).toString('base64');

// La misma validación que corre en CI al instalarla.
decodeSeed(encoded, manifest);
const conserva = stableJson(restrictSeed(payload, anterior.manifest.filters)) === stableJson(previa);
if (!conserva && !BREAKING) throw new Error('La semilla nueva cambia filas de la anterior; revisa las tablas o usa --breaking a sabiendas');

function privado(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, content, { mode: 0o600 }); fs.chmodSync(file, 0o600); }
if (WRITE) {
  if (!yaEscrita) {
    privado(path.join(publish, 'bootstrap-seed.b64.v2'), anterior.encoded);
    privado(path.join(publish, 'bootstrap-seed.json.gz.v2'), fs.readFileSync(path.join(publish, 'bootstrap-seed.json.gz')));
    privado(path.join(publish, 'seed.manifest.v2.json'), `${JSON.stringify(anterior.manifest, null, 2)}\n`);
  }
  privado(path.join(publish, 'bootstrap-seed.b64'), encoded);
  privado(path.join(publish, 'bootstrap-seed.json.gz'), gzipCanonical(payload));
  // Una clave por línea con su valor compacto, como siempre se escribió a mano.
  fs.writeFileSync(manifestPath, `{\n${Object.entries(manifest).map(([clave, valor]) => `  ${JSON.stringify(clave)}: ${JSON.stringify(valor).replaceAll('","', '", "').replaceAll('":', '": ').replaceAll(',"', ', "')}`).join(',\n')}\n}\n`);
}
const porCodigo = (filas, i) => filas.reduce((acc, fila) => { acc[fila[i]] = (acc[fila[i]] ?? 0) + 1; return acc; }, {});
process.stdout.write(`${JSON.stringify({
  seed_id: manifest.seed_id,
  registro: payload.registry.length,
  gis: payload.gis.length,
  registro_por_codigo: porCodigo(payload.registry, 0),
  gis_por_capa: porCodigo(payload.gis, 0),
  base64_bytes: manifest.sizes.base64_bytes,
  base64_sha256: manifest.hashes.base64_sha256,
  conserva_la_anterior: conserva,
  escrito: WRITE,
}, null, 2)}\n`);
