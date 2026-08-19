import { compareSnapshotValidators } from './validator-comparison.mjs';
import { nativeFetch } from './native-http.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HEAD_FALLBACK_STATUSES = new Set([405, 501]);

function headerValidators(headers) {
  return {
    etag: headers.get('etag'),
    last_modified: headers.get('last-modified'),
  };
}

function conditionalHeaders(local) {
  const headers = {};
  if (typeof local?.etag === 'string' && local.etag.length > 0) headers['If-None-Match'] = local.etag;
  if (typeof local?.last_modified === 'string' && local.last_modified.length > 0) headers['If-Modified-Since'] = local.last_modified;
  return headers;
}

function timeoutError(url, timeoutMs) {
  return new Error(`timeout después de ${timeoutMs} ms: ${url}`);
}

async function requestWithRedirects({ url, method, headers, timeoutMs, maxRedirects, fetchImpl }) {
  let currentUrl = url;
  const redirects = [];
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(currentUrl, { method, headers, redirect: 'manual', signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw timeoutError(currentUrl, timeoutMs);
      throw new Error(`error HTTP en ${currentUrl}: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }

    const attempt = {
      method,
      url: currentUrl,
      status: response.status,
      request_headers: headers,
      response_validators: headerValidators(response.headers),
      bytes_consumed: 0,
    };
    if (!REDIRECT_STATUSES.has(response.status)) return { response, attempt, redirects, controller };
    const location = response.headers.get('location');
    if (!location) throw new Error(`redirect sin Location en ${currentUrl}`);
    if (redirectCount === maxRedirects) throw new Error(`demasiados redirects para ${url}`);
    redirects.push({ status: response.status, from: currentUrl, to: new URL(location, currentUrl).toString() });
    controller.abort();
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error(`no se pudo resolver ${url}`);
}

function cancelResponseBody(response, controller) {
  controller.abort();
  if (response.body) void response.body.cancel().catch(() => {});
}

function outcomeForResponse(response, local, attempt) {
  if (response.status === 304) return Object.keys(conditionalHeaders(local)).length > 0 ? 'unchanged' : 'unverifiable';
  if (response.status < 200 || response.status >= 300) return 'unverifiable';
  return compareSnapshotValidators(local, attempt.response_validators);
}

export async function probeSnapshotValidators({ url, local, fetchImpl = nativeFetch, now = () => new Date(), timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = DEFAULT_MAX_REDIRECTS } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new TypeError('La URL canónica debe usar HTTP(S)');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl debe ser una función');
  const startedAt = new Date(now()).toISOString();
  const headers = conditionalHeaders(local);
  const attempts = [];
  let head;
  try {
    head = await requestWithRedirects({ url, method: 'HEAD', headers, timeoutMs, maxRedirects, fetchImpl });
    attempts.push(...head.redirects.map((item) => ({ ...item, method: 'HEAD', request_headers: headers, response_validators: {}, bytes_consumed: 0 })));
    attempts.push(head.attempt);
    if (head.response.status === 304 && Object.keys(headers).length > 0) {
      return { status: 'unchanged', checked_at: startedAt, url: head.attempt.url, local_validators: local, attempts, bytes_consumed: 0 };
    }
    const headOutcome = outcomeForResponse(head.response, local, head.attempt);
    if (headOutcome !== 'unverifiable') {
      return { status: headOutcome, checked_at: startedAt, url: head.attempt.url, local_validators: local, attempts, bytes_consumed: 0 };
    }
    if ((head.response.status < 200 || head.response.status >= 300) && !HEAD_FALLBACK_STATUSES.has(head.response.status)) {
      return { status: 'unverifiable', checked_at: startedAt, url: head.attempt.url, local_validators: local, attempts, bytes_consumed: 0, reason: `HEAD respondió ${head.response.status}` };
    }
  } catch (error) {
    attempts.push({ method: 'HEAD', url, status: null, request_headers: headers, response_validators: {}, bytes_consumed: 0, error: error.message });
    return { status: 'unverifiable', checked_at: startedAt, url, local_validators: local, attempts, bytes_consumed: 0, reason: error.message };
  }

  const rangeHeaders = { ...headers, Range: 'bytes=0-0' };
  try {
    const ranged = await requestWithRedirects({ url, method: 'GET', headers: rangeHeaders, timeoutMs, maxRedirects, fetchImpl });
    attempts.push(...ranged.redirects.map((item) => ({ ...item, method: 'GET', request_headers: rangeHeaders, response_validators: {}, bytes_consumed: 0 })));
    cancelResponseBody(ranged.response, ranged.controller);
    attempts.push(ranged.attempt);
    const rangeOutcome = outcomeForResponse(ranged.response, local, ranged.attempt);
    return { status: rangeOutcome, checked_at: startedAt, url: ranged.attempt.url, local_validators: local, attempts, bytes_consumed: ranged.attempt.bytes_consumed };
  } catch (error) {
    attempts.push({ method: 'GET', url, status: null, request_headers: rangeHeaders, response_validators: {}, bytes_consumed: 0, error: error.message });
    return { status: 'unverifiable', checked_at: startedAt, url, local_validators: local, attempts, bytes_consumed: 0, reason: error.message };
  }
}
