import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

export function nativeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const method = options.method ?? 'GET';
    const request = transport.request(parsed, {
      method,
      headers: options.headers ?? {},
      signal: options.signal,
    }, (response) => {
      const bodyless = response.statusCode === 204 || response.statusCode === 205 || response.statusCode === 304 || method === 'HEAD';
      if (bodyless) response.resume();
      resolve(new Response(bodyless ? null : Readable.toWeb(response), {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: response.headers,
      }));
    });
    request.once('error', reject);
    request.end();
  });
}
