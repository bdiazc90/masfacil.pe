/**
 * Resolución de identidad comercial: qué se puede publicar y qué falta.
 *
 * El enriquecimiento comercial dejó de ser un prerrequisito de los precios. Un
 * expediente ilegible, una auditoría de otro catálogo o un nombre sin respaldo
 * retiran ESA afirmación, no el bundle: los precios y su vínculo con el Registro
 * se construyen y se validan por sus propias reglas.
 *
 * No hay un `catch` general: solo se aíslan causas conocidas de la identidad
 * —archivo ausente, JSON ilegible, contrato incumplido, auditoría que no
 * corresponde—. Cualquier otro error se propaga, porque no sabemos qué es.
 */

import fs from 'node:fs';
import { commercialNameBacking, loadValidatedCommercialAudit } from './commercial-audit.mjs';
import { emptyCommercialCatalog, isPublicCommercialEntry, isolateCommercialCatalog, validateCommercialCatalog } from './commercial-catalog.mjs';

const CAUSAS_CONOCIDAS = /fuera de contrato|Unexpected token|Unexpected end of JSON|JSON at position|is not valid JSON/i;

/**
 * El catálogo se carga aislando entradas defectuosas: un duplicado o una fila
 * fuera de contrato retiran ESA entrada, no el catálogo entero. Un defecto de
 * nivel catálogo sí lo deja fuera. Las entradas retiradas se devuelven aparte
 * para el reporte privado; en los problemas públicos solo va el conteo.
 */
function cargarCatalogo(archivo, problems) {
  if (!archivo || !fs.existsSync(archivo)) { problems.push({ scope: 'catalog', reason: 'archivo_ausente', affected: null }); return { catalog: null, isolated: [] }; }
  let crudo;
  try { crudo = JSON.parse(fs.readFileSync(archivo, 'utf8')); }
  catch (error) { problems.push({ scope: 'catalog', reason: 'json_ilegible', affected: null, detail: error.message.split('\n')[0] }); return { catalog: null, isolated: [] }; }
  const aislado = isolateCommercialCatalog(crudo);
  if (!aislado) { problems.push({ scope: 'catalog', reason: 'fuera_de_contrato', affected: null, detail: validateCommercialCatalog(crudo)[0] }); return { catalog: null, isolated: [] }; }
  problems.push(...aislado.problems);
  return { catalog: aislado.catalog, isolated: aislado.dropped };
}

function cargar(descripcion, archivo, cargador, problems) {
  if (!archivo || !fs.existsSync(archivo)) { problems.push({ scope: descripcion, reason: 'archivo_ausente', affected: null }); return null; }
  try { return cargador(archivo); }
  catch (error) {
    if (!CAUSAS_CONOCIDAS.test(error.message)) throw error;
    problems.push({ scope: descripcion, reason: 'fuera_de_contrato', affected: null, detail: error.message.split('\n')[0] });
    return null;
  }
}

/**
 * Catálogo utilizable: se retiran las afirmaciones sin respaldo y se conservan
 * las que sí lo tienen. Una entrada que se queda sin nombre Y sin marca no se
 * publica vacía: desaparece, y su oferta muestra el fallback neutral.
 */
function catalogoUtilizable(catalog, aprobadas) {
  const entries = [];
  let nombresRetirados = 0;
  let neutralizadas = 0;
  for (const entry of catalog.entries) {
    if (!isPublicCommercialEntry(entry) || !entry.public_site_name || aprobadas.has(entry.establishment_id)) { entries.push(entry); continue; }
    nombresRetirados += 1;
    if (!entry.brand) { neutralizadas += 1; continue; }
    entries.push({ ...entry, public_site_name: null });
  }
  return { catalog: { ...catalog, entries }, nombresRetirados, neutralizadas };
}

/**
 * @param {{catalogPath?: string, auditPath?: string}} rutas
 * @returns {{status:'complete'|'degraded'|'absent', catalog, audit, problems, counts}}
 */
/** Identidad ausente: el caso neutral. Los precios se publican igual. */
export function absentCommercialResolution(problems = []) {
  return Object.freeze({
    status: 'absent',
    catalog: emptyCommercialCatalog(),
    audit: null,
    problems: Object.freeze(problems),
    isolated: Object.freeze([]),
    counts: Object.freeze({ entries: 0, publishable: 0, name_published: 0, brand_published: 0, name_withdrawn: 0, neutralized: 0 }),
  });
}

export function resolveCommercialIdentity({ catalogPath, auditPath } = {}) {
  const problems = [];
  const { catalog: catalogoOriginal, isolated } = cargarCatalogo(catalogPath, problems);
  const audit = cargar('audit', auditPath, loadValidatedCommercialAudit, problems);

  // Sin catálogo utilizable no hay identidad que publicar. Toda la identidad que
  // dependía de ese paquete queda neutral; los precios siguen su camino.
  if (!catalogoOriginal) return absentCommercialResolution(problems);

  // Una auditoría que no corresponde al catálogo no acredita nada de él, pero
  // tampoco lo invalida: se pierde el nombre, no la bandera.
  if (audit && audit.catalog_id !== catalogoOriginal.catalog_id) problems.push({ scope: 'audit', reason: 'catalog_id_no_corresponde', affected: null });

  const backing = commercialNameBacking(catalogoOriginal, audit);
  problems.push(...backing.problems);
  const { catalog, nombresRetirados, neutralizadas } = catalogoUtilizable(catalogoOriginal, backing.approved);

  // El catálogo derivado vuelve a pasar por su propio contrato: retirar una
  // afirmación no puede producir una entrada que el contrato no admite.
  const errores = validateCommercialCatalog(catalog);
  if (errores.length) throw new Error(`El catálogo derivado quedó fuera de contrato:\n- ${errores.join('\n- ')}`);

  const publicables = catalog.entries.filter(isPublicCommercialEntry);
  const counts = Object.freeze({
    entries: catalog.entries.length,
    publishable: publicables.length,
    name_published: publicables.filter((entry) => entry.public_site_name).length,
    brand_published: publicables.filter((entry) => entry.brand).length,
    name_withdrawn: nombresRetirados,
    neutralized: neutralizadas,
  });

  return Object.freeze({
    status: problems.length ? 'degraded' : (publicables.length ? 'complete' : 'absent'),
    catalog,
    audit,
    problems: Object.freeze(problems),
    isolated: Object.freeze(isolated),
    counts,
  });
}

/** Lo que se guarda o se muestra: conteos y motivos, nunca el expediente. */
export function commercialIdentityReport(resolution) {
  return Object.freeze({
    status: resolution.status,
    counts: resolution.counts,
    problems: resolution.problems.map(({ scope, reason, affected }) => ({ scope, reason, affected })),
  });
}
