#!/usr/bin/env node
// Instala el SVG de una variante de marca en web/icons/brands/ tras sanearlo.
//
//   node scripts/install-brand-logo.mjs <slug> <rol> <archivo.svg> <referencia> <AAAA-MM-DD>
//
// El rol es la función visual de la variante (`mark`, el isotipo que firma la
// tarjeta) y tiene que estar declarado en `web/brand-logos.js`, igual que el
// nombre de archivo de destino: aquí no se deduce nada del slug.
//
// Vale el activo oficial de la marca, una recreación fiel o un aporte del owner;
// lo que no vale es declarar oficial lo que no lo es, y por eso la entrada del
// registro declara `source_kind` y su procedencia real. Solo `official_asset`
// exige una URL https; una recreación o un aporte describen su referencia.
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
const [slug, role, source, reference, retrievedAt] = process.argv.slice(2);
if (!slug || !role || !source || !reference || !retrievedAt) throw new Error('Uso: install-brand-logo.mjs <slug> <rol> <archivo.svg> <referencia> <AAAA-MM-DD>');
const marca = Object.values(BRAND_LOGOS).find((entry) => entry.slug === slug);
if (!marca) throw new Error(`El slug ${slug} no está en la lista controlada de web/brand-logos.js`);
const declarado = marca.assets?.[role];
if (!declarado) throw new Error(`La marca ${slug} no declara la variante ${role} en web/brand-logos.js`);
if (declarado.source_url !== reference || declarado.retrieved_at !== retrievedAt) throw new Error('La procedencia declarada en brand-logos.js no coincide con la que se instala');
const procedencia = provenanceProblems(declarado);
if (procedencia.length) throw new Error(`Procedencia de ${slug}.${role} fuera de contrato:\n- ${procedencia.join('\n- ')}`);

const original = fs.readFileSync(path.resolve(source), 'utf8');
// Se informan todos los defectos de una vez: corregir de uno en uno obliga a
// reinstalar tantas veces como problemas tenga el archivo.
const defectos = svgProblems(original);
if (defectos.length) throw new Error(`SVG rechazado (${defectos.join('; ')}): ${source}`);

const limpio = `${original
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/>\s+</g, '><')
  .trim()}\n`;
const target = path.join(root, 'web', 'icons', 'brands', declarado.file);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, limpio, { mode: 0o644 });
process.stdout.write(`${path.relative(root, target)} · ${Buffer.byteLength(limpio)} bytes · ${role} · ${declarado.source_kind} · ${reference} (${retrievedAt})\n`);
