#!/usr/bin/env node
// Instala el SVG de una marca en web/icons/brands/ tras sanearlo.
//
//   node scripts/install-brand-logo.mjs <slug> <archivo.svg> <url de origen> <AAAA-MM-DD>
//
// Vale el activo oficial de la marca o una recreación fiel desde una referencia
// oficial; lo que no vale es declarar oficial lo segundo, y por eso la entrada
// de `web/brand-logos.js` tiene que declarar `source_kind` y su procedencia real.
//
// El activo se sirve local y se referencia con <img>, así que el navegador no
// ejecuta scripts dentro del SVG. Aun así se rechaza cualquier archivo con
// script, manejador de eventos, recurso externo o bitmap incrustado: lo que se
// publica no debe depender de un tercero ni poder pedirle nada.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_LOGOS } from '../web/brand-logos.js';
import { provenanceProblems, svgProblems } from '../app/shell-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [slug, source, url, retrievedAt] = process.argv.slice(2);
if (!slug || !source || !url || !retrievedAt) throw new Error('Uso: install-brand-logo.mjs <slug> <archivo.svg> <url> <AAAA-MM-DD>');
const declarado = Object.values(BRAND_LOGOS).find((logo) => logo.slug === slug);
if (!declarado) throw new Error(`El slug ${slug} no está en la lista controlada de web/brand-logos.js`);
if (declarado.source_url !== url || declarado.retrieved_at !== retrievedAt) throw new Error('La procedencia declarada en brand-logos.js no coincide con la que se instala');
const procedencia = provenanceProblems(declarado);
if (procedencia.length) throw new Error(`Procedencia de ${slug} fuera de contrato:\n- ${procedencia.join('\n- ')}`);

const original = fs.readFileSync(path.resolve(source), 'utf8');
// Se informan todos los defectos de una vez: corregir de uno en uno obliga a
// reinstalar tantas veces como problemas tenga el archivo.
const defectos = svgProblems(original);
if (defectos.length) throw new Error(`SVG rechazado (${defectos.join('; ')}): ${source}`);

const limpio = `${original
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/>\s+</g, '><')
  .trim()}\n`;
const target = path.join(root, 'web', 'icons', 'brands', `${slug}.svg`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, limpio, { mode: 0o644 });
process.stdout.write(`${path.relative(root, target)} · ${Buffer.byteLength(limpio)} bytes · ${declarado.source_kind} · ${url} (${retrievedAt})\n`);
