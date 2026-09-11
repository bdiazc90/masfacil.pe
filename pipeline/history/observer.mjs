/**
 * El observador: mira lo que YA sirve producción y deja constancia.
 *
 * Descarga el bundle del origen público, lo valida, archiva sus bytes, calcula
 * las dos medias del instante y reconstruye el resumen. Nunca escribe en
 * `web/data/`, nunca lee artefactos de otra corrida y nunca toca el raw de
 * Osinergmin: si esta función falla entera, publicar precios sigue igual.
 *
 * `deps` permite recorrerlo completo sin red y sin credenciales.
 */

import crypto from 'node:crypto';
import { limaDate } from '../../web/lib/history-contract.js';
import { fetchLiveBundle } from '../live-bundle.mjs';
import { archiveBundle, archiveKey } from './archive.mjs';
import { METHOD_VERSION, observationMeans } from './daily-mean.mjs';
import { buildDailySummary, publishDailySummary } from './summary.mjs';
import { IMMUTABLE_CACHE_CONTROL, JSON_CONTENT_TYPE, putImmutable } from './store.mjs';

export const OBSERVATION_SCHEMA_VERSION = 'history-observation-1';

/**
 * Identificador determinista de la observación.
 *
 * Depende solo de datos que la corrida ya fijó, así que un reintento de la fase
 * de escritura reutiliza la misma clave con los mismos bytes: no crea otra
 * observación ni cambia su instante original. Una corrida NUEVA sí tiene otro
 * `observed_at` y por tanto otra observación, que es lo que se quiere: cuatro
 * capturas al día y la última manda.
 */
export function observationId({ observedAt, archiveHash, methodVersion = METHOD_VERSION }) {
  return `obs_${crypto.createHash('sha256').update(`obs-v1\n${observedAt}\n${archiveHash}\n${methodVersion}\n`).digest('hex').slice(0, 24)}`;
}

export const observationKey = (localDate, id) => `observations/${localDate}/${id}.json`;

export function buildObservation({ observedAt, archiveHash, complete, products }) {
  return {
    schema_version: OBSERVATION_SCHEMA_VERSION,
    observation_id: observationId({ observedAt, archiveHash }),
    local_date: limaDate(observedAt),
    observed_at: observedAt,
    revision_id: complete.revision_id,
    archive_hash: archiveHash,
    archive_key: archiveKey(archiveHash, 'complete.json'),
    cutoff_at: complete.cutoff_at,
    source_max_reported_at: complete.source_max_reported_at,
    method_version: METHOD_VERSION,
    products,
  };
}

/**
 * Una observación completa: descargar, archivar, medir, anotar y resumir.
 *
 * @param {object} entrada
 * @param {object} entrada.store          almacén ya creado
 * @param {string} entrada.origin         origen público canónico
 * @param {boolean} [entrada.summaryOnly] solo reconstruir el resumen
 * @param {object} [entrada.deps]         `fetchLiveBundle` y `now`, inyectables
 * @returns {Promise<object>} informe de la corrida; `ok:false` si algo la invalidó
 */
export async function observeHistory({ store, origin, summaryOnly = false, days, deps = {} } = {}) {
  const usar = { fetchLiveBundle, now: () => new Date().toISOString(), ...deps };
  const informe = { ok: true, observation: 'none', archive: 'none', problems: [] };

  if (!summaryOnly) {
    // Sin trío coherente no hay nada que archivar ni que medir: se prefiere el
    // hueco del día a una observación que mezcle dos publicaciones.
    const bundle = await usar.fetchLiveBundle({ origin });
    // El instante se fija AQUÍ, con el bundle ya completo y validado en la mano:
    // no cuando arrancó el proceso ni cuando terminó de escribir.
    const observedAt = usar.now();

    const archivo = await archiveBundle(store, bundle);
    informe.archive = archivo.stored ? 'stored' : 'reused';
    informe.archive_hash = archivo.archive_hash;
    informe.revision_id = bundle.manifest.revision_id;
    informe.observed_at = observedAt;
    informe.local_date = limaDate(observedAt);

    const medidas = observationMeans({ manifest: bundle.manifest, bodies: bundle.bodies, observedAt });
    informe.problems.push(...medidas.problems);
    if (!medidas.ok) {
      // Los bytes quedan archivados —fueron públicos y son evidencia— pero no se
      // publica una media que dependa de cuál de dos filas contradictorias se
      // eligió. La corrida termina en rojo: un bundle incoherente consigo mismo
      // merece mirarse, no acumularse en silencio.
      informe.ok = false;
      informe.contradictions = medidas.contradictions;
      informe.problems.push(medidas.contradictions.length ? `el bundle publicado se contradice en ${medidas.contradictions.length} establecimiento(s)` : 'no se pudieron calcular las medias');
    } else {
      const observation = buildObservation({ observedAt, archiveHash: archivo.archive_hash, complete: archivo.complete, products: medidas.products });
      const escrita = await putImmutable(store, observationKey(observation.local_date, observation.observation_id), `${JSON.stringify(observation)}\n`, { contentType: JSON_CONTENT_TYPE, cacheControl: IMMUTABLE_CACHE_CONTROL });
      informe.observation = escrita.written ? 'new' : 'reused';
      informe.observation_id = observation.observation_id;
      informe.products = medidas.products;
    }
  }

  // El resumen se reconstruye incluso cuando la observación no salió: puede
  // haber quedado a medias en una corrida anterior y esta lo repara.
  const construido = await buildDailySummary(store, { generatedAt: usar.now(), ...(days ? { days } : {}) });
  informe.problems.push(...construido.problems);
  informe.days_with_observation = construido.daysWithObservation;
  if (construido.problems.length) {
    informe.ok = false;
    informe.summary_write = 'blocked_invalid_summary';
    return informe;
  }
  const publicado = await publishDailySummary(store, construido.summary);
  informe.summary_write = publicado.write;
  informe.summary_reason = publicado.reason;
  if (publicado.write === 'blocked_missing_observations') informe.ok = false;
  return informe;
}
