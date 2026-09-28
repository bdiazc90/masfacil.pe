// La carga del histórico: el resumen publicado, o su copia guardada si la red
// falla. Nunca rechaza: si nada vale, lo dice el estado y el bloque lo cuenta
// dentro de sí mismo. Buscar gasolina no puede fallar porque un gráfico de
// contexto no cargue.
//
// Un solo pedido a la vez: si el bloque se monta dos veces mientras carga —el
// doble montaje de Strict Mode en desarrollo—, las dos esperan la misma promesa
// y la red recibe una sola petición.

import { HISTORY_SUMMARY_PATH, limaDate } from '../../web/lib/history-contract.js';
import { demoSummary } from '../../web/lib/history-series.js';
import { evaluarResumen } from '../history-view.js';

const GUARDADO = 'masfacil-history-daily-v1';
const enCurso = new Map();

async function cargar({ origin, fetchImpl, storage, now, demo }) {
  const hoy = limaDate(now());
  // La demostración no toca la red ni el almacenamiento: no debe dejar rastro
  // que luego parezca un dato.
  if (demo) return { resumen: demoSummary({ today: hoy }), estado: 'demo', nota: 'Serie de demostración: no son precios reales.' };
  try {
    // `no-cache` es revalidar, no descargar: un 304 cuesta casi nada. Sin
    // cabeceras propias: nada de preflight.
    const response = await fetchImpl(new URL(HISTORY_SUMMARY_PATH, origin), { redirect: 'error', cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const texto = await response.text();
    const resultado = evaluarResumen(texto, { hoy, now: now() });
    try { storage?.setItem(GUARDADO, JSON.stringify({ savedAt: new Date(now()).toISOString(), body: texto })); } catch { /* modo privado o sin cuota: no es motivo para romper nada */ }
    return resultado;
  } catch {
    // La copia guardada se vuelve a validar entera: nunca se confía en lo que
    // haya en el almacenamiento del navegador.
    try {
      const copia = JSON.parse(storage?.getItem(GUARDADO) ?? 'null');
      if (!copia?.body) throw new Error('sin copia');
      return evaluarResumen(copia.body, { hoy, now: now(), desdeCopia: true, savedAt: copia.savedAt });
    } catch {
      return { resumen: null, estado: 'error', nota: 'No pudimos cargar el histórico. Los precios de arriba no dependen de esto.' };
    }
  }
}

/** @returns {Promise<{resumen: object|null, estado: string, nota: string}>} */
export function cargarHistorial({ origin, fetchImpl = globalThis.fetch, storage = null, now = () => new Date(), demo = false }) {
  const clave = `${origin}|${demo}`;
  if (!enCurso.has(clave)) {
    const promesa = cargar({ origin, fetchImpl, storage, now, demo })
      .catch(() => ({ resumen: null, estado: 'error', nota: 'No pudimos cargar el histórico.' }))
      .finally(() => enCurso.delete(clave));
    enCurso.set(clave, promesa);
  }
  return enCurso.get(clave);
}
