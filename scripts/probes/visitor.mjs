// Visitante nuevo en producción, por el contrato visible: en cada vista la portada
// llega pre-renderizada en el HTML, React la reemplaza, el worker instala el shell
// que se sirve, GPS y distrito pintan precios, sin errores de consola ni
// violaciones de CSP. En Gasolina, además, el histórico carga.
//
//   node scripts/probes/visitor.mjs [--origin https://masfacil.pe] [--shell masfacil-shell-…]
//
// Sin `--shell`, exige el que anuncia `/sw.js` del origen. Con `--shell`, antes espera
// hasta 5 min a que el origen lo sirva (un deploy recién subido tarda en propagarse).
// Sale con 1 si algo falla.
import { MIRAFLORES, argumentos, chrome, dormir, registro } from './lib.mjs';

const { origin: O = 'https://masfacil.pe', shell: ESPERADO } = argumentos();
const servido = async () => /masfacil-shell-[a-z0-9]+/.exec(await (await fetch(`${O}/sw.js?sonda=${Date.now()}`, { cache: 'no-store' })).text())?.[0] ?? null;
if (ESPERADO) { const fin = Date.now() + 5 * 60_000; while (Date.now() < fin && (await servido().catch(() => null)) !== ESPERADO) await dormir(10_000); }
const SHELL = ESPERADO ?? await servido();
const V = { gasolina: 'Gasolina', diesel: 'Diésel', glp: 'GLP', gnv: 'GNV' };
const { anotar, ok } = registro();
const c = await chrome();
const errores = [];
c.oir((m) => {
  if (m.method === 'Runtime.exceptionThrown') errores.push(`excepción: ${m.params.exceptionDetails.exception?.description?.split('\n')[0]}`);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errores.push(`error: ${m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)}`);
});
const evalua = async (S, e) => { const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, S); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const esperar = async (S, e, ms = 30000) => { const fin = Date.now() + ms; while (Date.now() < fin) { try { const v = await evalua(S, e); if (v) return v; } catch {} await dormir(200); } return null; };
const buscar = (sel) => { const [cont, texto] = sel.split(' >> '); return texto ? `[...document.querySelectorAll(${JSON.stringify(`${cont} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(texto)})` : `document.querySelector(${JSON.stringify(sel)})`; };
const clic = (S, sel) => evalua(S, `(() => { const e = ${buscar(sel)}; if (!e) throw new Error('no existe'); e.focus({ preventScroll: true }); e.click(); return 1; })()`);

try {
  for (const vista of Object.keys(V)) {
    // El HTML tal como lo sirve Pages: la portada ya viene dentro de <main>.
    const html = await (await fetch(`${O}/combustibles/${vista}`, { headers: { 'cache-control': 'no-cache' } })).text();
    const main = /<main id="main"[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
    const { browserContextId } = await c.send('Target.createBrowserContext', {});
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId: S } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    for (const m of ['Page.enable', 'Runtime.enable']) await c.send(m, {}, S);
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 860, deviceScaleFactor: 2, mobile: true }, S);
    await c.send('Emulation.setGeolocationOverride', MIRAFLORES, S);
    await c.send('Browser.grantPermissions', { permissions: ['geolocation'], origin: O, browserContextId });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.effectiveDirective + ' ' + e.blockedURI));` }, S);
    errores.length = 0;
    await c.send('Page.navigate', { url: `${O}/combustibles/${vista}` }, S);
    await esperar(S, `document.getElementById('choose-district')?.disabled === false`);
    const shell = await esperar(S, `caches.keys().then((k) => k.find((c) => c.startsWith('masfacil-shell-')) ?? null)`);
    const portada = JSON.parse(await evalua(S, `JSON.stringify({ activa: document.querySelector('#view-picker-start [aria-pressed="true"]')?.textContent ?? null, estado: document.getElementById('data-status')?.textContent ?? null })`));
    if (vista === 'gasolina') await esperar(S, `['ready', 'stale', 'saved'].includes(document.getElementById('history-chart')?.dataset.state)`);
    const historial = await evalua(S, `document.getElementById('history-chart')?.hidden === false ? document.getElementById('history-chart').dataset.state : 'oculto'`);
    await clic(S, '#use-location');
    await esperar(S, `document.querySelectorAll('#offers > li').length > 0`);
    const gps = JSON.parse(await evalua(S, `JSON.stringify({ ruta: location.pathname, tarjetas: document.querySelectorAll('#offers > li').length, chips: [...new Set([...document.querySelectorAll('#offers .offer__price .chip')].map((c) => c.textContent))] })`));
    await clic(S, '#place-more'); await clic(S, '#menu-districts');
    await esperar(S, `document.querySelector('#districts button')`);
    await clic(S, '#districts button');
    await esperar(S, `document.getElementById('compare-step')?.hidden === false && document.getElementById('place-name')?.textContent !== 'Mi ubicación'`);
    await dormir(400);
    const distrito = JSON.parse(await evalua(S, `JSON.stringify({ lugar: document.getElementById('place-name')?.textContent, precios: [...document.querySelectorAll('#offers .offer__price b')].filter((b) => /[0-9]/.test(b.textContent)).length })`));
    const csp = await evalua(S, 'window.__csp');
    anotar(vista, {
      portada_en_html: (main.match(/id="start-step"/g) ?? []).length,
      marca_sin_reemplazar: html.includes('<!--portada-->'),
      shell, ...portada, historial,
      gps_ruta: gps.ruta, gps_tarjetas: gps.tarjetas, chips: gps.chips,
      distrito: distrito.lugar, distrito_precios: distrito.precios,
      csp, errores: [...errores],
    }, {
      portada_en_html: 1, marca_sin_reemplazar: false, shell: SHELL, activa: V[vista],
      historial: vista === 'gasolina' ? (x) => ['ready', 'stale', 'saved'].includes(x) : 'oculto',
      gps_ruta: `/combustibles/${vista}`, gps_tarjetas: (x) => x > 0, distrito_precios: (x) => x > 0, csp: [], errores: [],
    });
    await c.send('Target.disposeBrowserContext', { browserContextId });
  }
} finally {
  await c.cerrar();
}
console.log(ok() ? `VISITANTE OK en ${O} (${SHELL})` : `VISITANTE CON FALLOS en ${O}`);
process.exitCode = ok() ? 0 : 1;
