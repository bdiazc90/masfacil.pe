// Las fuentes de precio que el refresco descarga: una por CSV de Osinergmin.
//
// Cada fuente tiene su archivo, su esquema, su identificador de fila, sus
// validadores y sus snapshots. Los grupos se atan a una fuente en `groups.mjs`:
// Gasolina y Diésel salen de los líquidos, GLP de su propio CSV, y un refresco
// de una nunca juzga ni mueve los grupos de la otra. Es de operación: no viaja a
// `web/`.

import { CANONICAL_SOURCE_URLS } from '../app/source-catalog.mjs';
import { GLP_MINIMIZED_FIELDS, GLP_RAW_FIELDS, MINIMIZED_FIELDS, RAW_FIELDS } from './csv.mjs';

const fuente = (definicion) => Object.freeze({ ...definicion, rawFields: Object.freeze([...definicion.rawFields]), minimizedFields: Object.freeze([...definicion.minimizedFields]) });

export const SOURCES = Object.freeze({
  'liquid-current': fuente({
    id: 'liquid-current',
    url: CANONICAL_SOURCE_URLS.liquid_current,
    idField: 'ID3',
    rawFields: RAW_FIELDS,
    minimizedFields: MINIMIZED_FIELDS,
    rawRelative: 'acquired/price-liquid/CL-Registro-precios-DMA-V-CCA-CCE.csv',
    minimizedRelative: 'prices/liquid-current.csv.gz',
    downloadTimeoutMs: 60 * 60 * 1000,
  }),
  'glp-current': fuente({
    id: 'glp-current',
    url: CANONICAL_SOURCE_URLS.glp_current,
    idField: 'ID4',
    rawFields: GLP_RAW_FIELDS,
    minimizedFields: GLP_MINIMIZED_FIELDS,
    rawRelative: 'acquired/price-glp/GLP-Registro-precios-PIC-PE-V.csv',
    minimizedRelative: 'prices/glp-current.csv.gz',
    // Medio GB: la mitad del tiempo de los líquidos alcanza de sobra, y un GLP
    // trabado no retrasa más que eso la entrega de los demás grupos.
    downloadTimeoutMs: 30 * 60 * 1000,
  }),
});

/** El orden del refresco: los líquidos primero, porque de ellos depende lo que ya se publica. */
export const SOURCE_ORDER = Object.freeze(['liquid-current', 'glp-current']);

export function sourceById(id) {
  const source = SOURCES[id];
  if (!source) throw new Error(`Fuente desconocida: ${id}`);
  return source;
}

/** Un pointer anterior a las fuentes solo pudo ser de líquidos. */
export const sourceOfPointer = (pointer) => pointer?.source_id ?? 'liquid-current';
