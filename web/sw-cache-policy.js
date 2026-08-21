export const SHELL_CACHE = 'masfacil-shell-v12';
export const DATA_CACHE = 'masfacil-data-v2';
export async function cacheFirst({ request, cache, fetchImpl }) {
  const cached = await cache.match(request); if (cached) return { response: cached, source: 'cache' };
  const response = await fetchImpl(request); if (response?.ok) await cache.put(request, response.clone());
  return { response, source: 'network' };
}
export async function networkFirst({ request, cache, fetchImpl, fallback }) {
  try { const response = await fetchImpl(request); if (!response?.ok) throw new Error('HTTP no exitoso'); return { response, source: 'network' }; }
  catch (error) { const response = await fallback(cache, request); if (!response) throw error; return { response, source: 'fallback' }; }
}
