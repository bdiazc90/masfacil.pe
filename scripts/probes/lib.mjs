// Piezas comunes de las sondas de navegador: Chrome sin cabeza por CDP —sin
// dependencias, con tiempo límite en cada llamada—, páginas con ancho, tema,
// movimiento, reloj, posición e histórico fijos, y un árbol servido como Pages
// (`serveWeb` de `scripts/serve-web.mjs`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serveWeb } from '../serve-web.mjs';
import { HISTORY_ORIGIN, limaDate } from '../../web/lib/history-contract.js';
import { demoSummary } from '../../web/lib/history-series.js';

export { HISTORY_ORIGIN };
export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const HORA = 3_600_000;
export const MIRAFLORES = { latitude: -12.1276, longitude: -77.0104, accuracy: 20 };
export const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const LIMITE = Number(process.env.SONDA_LIMITE_MS ?? 60_000);

/** Chrome del sistema: `CHROME` manda; si no, el de macOS o el de Linux. */
export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return fs.existsSync(mac) ? mac : 'google-chrome';
}

/** Argumentos con nombre: `--clave valor` y `--bandera`. */
export function argumentos(lista = process.argv.slice(2)) {
  const salida = {};
  for (let i = 0; i < lista.length; i += 1) {
    const m = /^--([\w-]+)$/.exec(lista[i]);
    if (!m) throw new Error(`Argumento inesperado: ${lista[i]}`);
    salida[m[1]] = lista[i + 1] && !lista[i + 1].startsWith('--') ? lista[++i] : true;
  }
  return salida;
}

/**
 * Chrome sin cabeza. `perfil` fijo conserva el estado entre aperturas (la sonda de
 * actualización); si no, uno temporal que se borra al cerrar. Cada `send` falla si
 * Chrome no contesta en `SONDA_LIMITE_MS` (60 s): una sonda nunca queda colgada.
 */
export async function chrome({ argumentos: extra = [], perfil = null } = {}) {
  const dir = perfil ?? fs.mkdtempSync(path.join(os.tmpdir(), 'masfacil-sonda-'));
  fs.mkdirSync(dir, { recursive: true });
  const banderas = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...(process.env.CI ? ['--no-sandbox'] : []), ...extra, 'about:blank'];
  const proceso = spawn(chromePath(), banderas, { stdio: ['ignore', 'ignore', 'pipe'] });
  const ws = await new Promise((ok, ko) => {
    let b = '';
    const t = setTimeout(() => ko(new Error('Chrome no abrió DevTools en 20 s')), 20_000);
    proceso.once('error', (e) => { clearTimeout(t); ko(e); });
    proceso.stderr.on('data', (d) => { b += d; const m = /DevTools listening on (ws:\S+)/.exec(b); if (m) { clearTimeout(t); ok(m[1]); } });
  });
  const socket = new WebSocket(ws);
  await new Promise((ok) => (socket.onopen = ok));
  let n = 0;
  const pendientes = new Map();
  const oyentes = new Set();
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); return; }
    for (const oyente of oyentes) oyente(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, ko) => {
    const i = ++n;
    const t = setTimeout(() => { pendientes.delete(i); ko(new Error(`${method}: sin respuesta de Chrome en ${LIMITE / 1000} s`)); }, LIMITE);
    pendientes.set(i, (m) => { clearTimeout(t); if (m.error) ko(new Error(`${method}: ${m.error.message}`)); else ok(m.result); });
    socket.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const cerrar = async () => {
    try { socket.send(JSON.stringify({ id: ++n, method: 'Browser.close' })); } catch {}
    await new Promise((ok) => { if (proceso.exitCode !== null) ok(); proceso.once('exit', ok); setTimeout(() => { proceso.kill(); ok(); }, 5000); });
    if (!perfil) fs.rmSync(dir, { recursive: true, force: true });
  };
  return { send, cerrar, oir: (f) => { oyentes.add(f); return () => oyentes.delete(f); } };
}

/** Un árbol (con `web/` compilado) servido como Pages en un puerto libre. */
export async function servir(arbol = REPO, { cache = 'dev', analytics = true } = {}) {
  const s = await serveWeb({ root: arbol, port: 0, build: false, cache, analytics });
  return { origen: s.origin, shell: s.shell, cerrar: s.close };
}

/** El reloj de la sonda: una hora después del último dato de gasolina del árbol. */
export function relojDe(arbol = REPO) {
  const leer = (rel) => JSON.parse(fs.readFileSync(path.join(arbol, 'web', rel), 'utf8'));
  const manifest = leer('data/gasolina/manifest.json');
  const corte = Date.parse(manifest.products.regular.cutoff_at);
  const observadas = ['regular', 'premium'].flatMap((k) => leer(manifest.products[k].dataset_url).offers.map((o) => Date.parse(o.facilito?.observed_at ?? ''))).filter(Number.isFinite);
  return Math.max(corte, ...observadas) + HORA;
}

/** Histórico sintético y válido que termina el día de Lima del reloj. */
export const historicoDe = (reloj) => Buffer.from(JSON.stringify(demoSummary({ today: limaDate(new Date(reloj)) })));

/**
 * Una página aislada (contexto propio) con el entorno fijo. `historico` es el JSON
 * que se sirve en lugar del resumen remoto; `reloj` congela Date; `interceptar`:
 * [{ patron: '*\/data/diesel/*', accion: 'fallar' | 'retener' }].
 */
export async function pagina(c, { origen, ancho = 390, alto, dpr = 2, tema = 'light', movimiento = 'reduce', reloj = null, historico = null, gps = MIRAFLORES, contraste = null, colores = null, antesDeCargar = '', interceptar = [] }) {
  const { browserContextId } = await c.send('Target.createBrowserContext', {});
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: S } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  for (const m of ['Page.enable', 'Runtime.enable']) await c.send(m, {}, S);
  await c.send('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto ?? (ancho >= 1024 ? 900 : 860), deviceScaleFactor: dpr, mobile: ancho < 1024 }, S);
  const features = [{ name: 'prefers-color-scheme', value: tema === 'dark' ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: movimiento }];
  if (contraste) features.push({ name: 'prefers-contrast', value: contraste });
  if (colores) features.push({ name: 'forced-colors', value: colores });
  await c.send('Emulation.setEmulatedMedia', { features }, S);
  if (gps) {
    await c.send('Emulation.setGeolocationOverride', gps, S);
    await c.send('Browser.grantPermissions', { permissions: ['geolocation'], origin: origen, browserContextId });
  }
  const quitar = [];
  if (interceptar.length) { await c.send('Network.enable', {}, S); await c.send('Network.setBypassServiceWorker', { bypass: true }, S); }
  const patrones = [...(historico ? [{ urlPattern: `${HISTORY_ORIGIN}/*` }] : []), ...interceptar.map((r) => ({ urlPattern: r.patron }))];
  const casa = (patron, url) => new RegExp(`^${patron.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(url);
  if (patrones.length) {
    await c.send('Fetch.enable', { patterns: patrones }, S);
    quitar.push(c.oir((m) => {
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== S) return;
      const { requestId, request } = m.params;
      if (historico && request.url.startsWith(HISTORY_ORIGIN)) { c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(historico).toString('base64') }, S).catch(() => {}); return; }
      const regla = interceptar.find((r) => casa(r.patron, request.url));
      if (regla?.accion === 'fallar') c.send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }, S).catch(() => {});
      else if (regla?.accion !== 'retener') c.send('Fetch.continueRequest', { requestId }, S).catch(() => {});
    }));
  }
  const fijarReloj = reloj ? `const T0 = ${reloj}; const D = Date; class F extends D { constructor(...a) { if (a.length) super(...a); else super(T0); } static now() { return T0; } } globalThis.Date = F;` : '';
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { ${fijarReloj} try { if (!sessionStorage.getItem('sonda-tema')) { localStorage.setItem('masfacil-theme', ${JSON.stringify(tema)}); sessionStorage.setItem('sonda-tema', '1'); } } catch {} ${antesDeCargar} })();` }, S);
  const evalua = async (e) => { const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, S); if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`); return r.result?.value; };
  const esperar = async (e, ms = 15000) => { const fin = Date.now() + ms; while (Date.now() < fin) { try { if (await evalua(e)) return true; } catch {} await dormir(120); } return false; };
  // En reposo: sin animaciones en curso (las de bucle, como el indicador de carga, no cuentan).
  const quieta = () => esperar(`document.getAnimations().filter((a) => a.effect?.getComputedTiming?.().iterations !== Infinity).every((a) => a.playState !== 'running')`, 5000);
  const ir = async (ruta) => { await c.send('Page.navigate', { url: `${origen}${ruta}` }, S); };
  const captura = async ({ completa = true } = {}) => Buffer.from((await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: completa }, S)).data, 'base64');
  const cerrar = async () => { for (const q of quitar) q(); await c.send('Target.disposeBrowserContext', { browserContextId }); };
  return { S, send: (m, p) => c.send(m, p, S), evalua, esperar, quieta, ir, captura, cerrar };
}

/** La portada lista para usarse: precios cargados o el aviso de que no hay. */
export const LISTO = `document.readyState === 'complete' && (document.getElementById('choose-district')?.disabled === false || document.body.innerText.includes('No encontramos'))`;

/** Pulsa por selector, o el botón con ese texto dentro de un contenedor: `#sort-toggle >> Más barata`. */
export function clic(p, sel) {
  return p.evalua(`(() => { const [c, t] = ${JSON.stringify(sel)}.split(' >> '); const e = t ? [...document.querySelectorAll(c + ' button')].find((b) => b.textContent.trim() === t || b.getAttribute('aria-label') === t) : document.querySelector(c); if (!e) return false; e.focus({ preventScroll: true }); e.click(); return true; })()`);
}

/** Registro de pasos con ✔/✖; `ok()` dice si todos pasaron. */
export function registro(escribir = (linea) => console.log(linea)) {
  const resultados = [];
  const anotar = (paso, obtenido, esperado) => {
    const ok = Object.entries(esperado).every(([k, v]) => (typeof v === 'function' ? v(obtenido[k]) : JSON.stringify(obtenido[k]) === JSON.stringify(v)));
    resultados.push(ok);
    escribir(`${ok ? '✔' : '✖'} ${paso} ${JSON.stringify(obtenido)}`);
    return ok;
  };
  return { anotar, ok: () => resultados.length > 0 && resultados.every(Boolean) };
}
