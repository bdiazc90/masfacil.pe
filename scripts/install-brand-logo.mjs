#!/usr/bin/env node
// Instala el SVG oficial de una marca en web/icons/brands/ tras sanearlo.
//
//   node scripts/install-brand-logo.mjs <slug> <archivo.svg> <url de origen> <AAAA-MM-DD>
//
// El activo se sirve local y se referencia con <img>, así que el navegador no
// ejecuta scripts dentro del SVG. Aun así se rechaza cualquier archivo con
// script, manejador de eventos o recurso externo: lo que se publica no debe
// depender de un tercero ni poder pedirle nada.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_LOGOS } from '../web/brand-logos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [slug, source, url, retrievedAt] = process.argv.slice(2);
if (!slug || !source || !url || !retrievedAt) throw new Error('Uso: install-brand-logo.mjs <slug> <archivo.svg> <url> <AAAA-MM-DD>');
const declarado = Object.values(BRAND_LOGOS).find((logo) => logo.slug === slug);
if (!declarado) throw new Error(`El slug ${slug} no está en la lista controlada de web/brand-logos.js`);
if (declarado.source_url !== url || declarado.retrieved_at !== retrievedAt) throw new Error('La procedencia declarada en brand-logos.js no coincide con la que se instala');

const original = fs.readFileSync(path.resolve(source), 'utf8');
const prohibidos = [
  [/<\s*(?:script|foreignObject|image|iframe|audio|video|animate|set)\b/i, 'elemento no permitido'],
  [/\son[a-z]+\s*=/i, 'manejador de eventos'],
  [/(?:xlink:)?href\s*=\s*["'](?!#)/i, 'referencia externa'],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'recurso remoto en un estilo'],
  [/<!ENTITY|<!DOCTYPE/i, 'entidad o DOCTYPE'],
];
for (const [patron, motivo] of prohibidos) if (patron.test(original)) throw new Error(`SVG rechazado (${motivo}): ${source}`);
if (!/^\s*<svg[\s>]/i.test(original)) throw new Error('El archivo no empieza por <svg>');
if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(original)) throw new Error('Falta el xmlns de SVG');

const limpio = `${original
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/>\s+</g, '><')
  .trim()}\n`;
const target = path.join(root, 'web', 'icons', 'brands', `${slug}.svg`);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, limpio, { mode: 0o644 });
process.stdout.write(`${path.relative(root, target)} · ${Buffer.byteLength(limpio)} bytes · ${url} (${retrievedAt})\n`);
