/**
 * Un solo lector de CSV para todo el proyecto.
 *
 * Había tres copias del mismo parser —minimización, proyección y el constructor
 * privado— con diferencias sutiles en el manejo de comillas y en la
 * normalización de encabezados. Aquí vive una, con los esquemas exactos que
 * cada tabla debe traer.
 *
 * El encabezado es un control duro, no un aviso: si la fuente cambia de forma,
 * se falla al cargar antes de mirar una sola fila. Publicar con un encabezado
 * distinto significaría leer una columna por otra.
 */

import fs from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';

/** Esquemas exactos. Cualquier diferencia de nombre u orden es un fallo. */
export const RAW_FIELDS = Object.freeze(['ID3', 'ACTIVIDAD', 'REGISTRO_DE_HIDROCARBUROS', 'RUC', 'RAZON_SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCION', 'FECHA_DE_REGISTRO', 'PRODUCTO', 'PRECIO_DE_VENTA_SOLES', 'UNIDAD']);
export const MINIMIZED_FIELDS = Object.freeze(['ID3', 'ACTIVIDAD', 'REGISTRO_DE_HIDROCARBUROS', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'FECHA_DE_REGISTRO', 'PRODUCTO', 'PRECIO_DE_VENTA_SOLES', 'UNIDAD']);
export const REGISTRY_FIELDS = Object.freeze(['SOURCE_ACTIVITY', 'REGISTRO', 'CODIGO_OSINERGMIN', 'CODIGO', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'ACTIVIDAD']);
export const GIS_FIELDS = Object.freeze(['LAYER', 'OBJECTID', 'N', 'COD_OSINERGMIN', 'CODIGO_DGH', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'LONGITUDE', 'LATITUDE']);

export const clean = (value) => String(value ?? '').replace(/\r/g, '').trim();

/** `RAZÓN SOCIAL` y `PRECIO DE VENTA (SOLES)` llegan así del original. */
export const normalizeHeader = (value) => clean(value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  .toUpperCase();

/**
 * `AAAA-MM-DD hh:mm:ss` de la fuente anclado en la hora de Perú.
 * Sin el anclaje explícito el valor dependería del huso del runner.
 */
export function parseTimestamp(value) {
  const match = clean(value).match(/^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}-05:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Filas de un CSV `;` en streaming. Descomprime `.gz` por extensión.
 * `onChunk` recibe los bytes del ARCHIVO —antes de descomprimir—, para que
 * quien minimiza pueda medir y hashear el original en la misma pasada.
 */
export async function* csvRows(file, { onChunk = null } = {}) {
  let source = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  if (onChunk) source = source.pipe(new Transform({ transform(chunk, encoding, callback) { onChunk(chunk); callback(null, chunk); } }));
  const stream = (file.endsWith('.gz') ? source.pipe(createGunzip()) : source).setEncoding('utf8');
  let row = []; let value = ''; let quoted = false; let quoteAtEnd = false; let first = true;
  for await (const chunk of stream) for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk[index]; if (first) { first = false; if (char === '\uFEFF') continue; }
    if (quoteAtEnd) { quoteAtEnd = false; if (char === '"') { value += '"'; continue; } quoted = false; }
    if (quoted) { if (char === '"') { if (index === chunk.length - 1) quoteAtEnd = true; else if (chunk[index + 1] === '"') { value += '"'; index += 1; } else quoted = false; } else value += char; }
    else if (char === '"') quoted = true;
    else if (char === ';') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); yield row; row = []; value = ''; }
    else value += char;
  }
  if (quoted || quoteAtEnd) throw new Error(`CSV incompleto: ${file}`);
  if (value || row.length) { row.push(value.replace(/\r$/, '')); yield row; }
}

/** Una línea CSV `;` con comillas solo donde hacen falta. */
export function csvLine(values) {
  return `${values.map((value) => { const text = String(value ?? ''); return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }).join(';')}\n`;
}

/**
 * Tabla completa en memoria con encabezado exacto.
 *
 * @param {string} file
 * @param {readonly string[]} expected
 * @param {{normalize?: (value: string) => string, onRow?: (row: object) => void}} [options]
 *   `normalize` traduce el encabezado observado (el original trae tildes y
 *   paréntesis); `onRow` ve cada fila antes de acumularla.
 */
export async function readTable(file, expected, { normalize = clean, onRow = null } = {}) {
  let header; const rows = [];
  for await (const row of csvRows(file)) {
    if (!header) {
      header = row.map(normalize);
      assertHeader(header, expected, file);
      continue;
    }
    if (row.length !== header.length) throw new Error(`Fila de ancho inesperado en ${file}`);
    const item = Object.fromEntries(expected.map((key, index) => [key, clean(row[index])]));
    if (onRow) onRow(item);
    rows.push(item);
  }
  if (!header) throw new Error(`CSV vacío: ${file}`);
  return rows;
}

/** Fallo duro y explicado ante cualquier deriva de esquema. */
export function assertHeader(observed, expected, file) {
  if (JSON.stringify(observed) !== JSON.stringify([...expected])) {
    throw new Error(`Encabezado fuera de contrato en ${file}: esperado ${JSON.stringify([...expected])}, observado ${JSON.stringify(observed)}`);
  }
  return true;
}
