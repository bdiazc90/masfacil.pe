// Actualización real de la PWA en producción, de un shell al siguiente deploy.
//
//   node scripts/probes/update.mjs [--origin https://masfacil.pe] [--out <carpeta>] [--minutos 120]
//
// 1. Antes del push: instala la versión publicada, guarda los cuatro grupos (una
//    vista por grupo, primer distrito con precios) y deja una segunda pestaña
//    abierta. Cuando dice LISTO PARA EL DEPLOY, se hace el push.
// 2. Espera a que `/sw.js` de producción lleve otro shell.
// 3. Exige: shell nuevo único y fresco (bytes de la precache = bytes servidos), sin
//    errores del worker; la pestaña vieja sigue usable con el worker nuevo; las
//    rutas anidadas no piden `/combustibles/…/assets/`; ningún JS/CSS en 404.
// 4. Cierra el navegador y lo reabre sin red (página y worker): las cuatro vistas
//    abren con sus precios guardados, el detalle se abre y la 404 propia funciona.
//
// Sale con 1 si algo falla. El perfil y el informe quedan en `--out`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, argumentos, chrome, dormir, registro } from './lib.mjs';

const a = argumentos();
const O = a.origin ?? 'https://masfacil.pe';
const SALIDA = path.resolve(
  a.out ??
    path.join(REPO, '.local-cache', 'sondas', `update-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`),
);
const MINUTOS = Number(a.minutos ?? 120);
fs.mkdirSync(SALIDA, { recursive: true });
const PERFIL = path.join(SALIDA, 'perfil');
fs.rmSync(PERFIL, { recursive: true, force: true });
const VISTAS = ['gasolina', 'diesel', 'glp', 'gnv'];
const informe = fs.createWriteStream(path.join(SALIDA, 'informe.txt'));
const log = (linea) => {
  console.log(linea);
  informe.write(`${linea}\n`);
};
const { anotar, ok } = registro(log);
const OFFLINE = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };

let c = null;
let sinRed = false;
let fallo = false;
const eventos = [];
const fallidas = [];
async function abrirChrome() {
  c = await chrome({ perfil: PERFIL });
  c.oir((m) => {
    if (!m.method) return;
    eventos.push(m);
    const p = m.params ?? {};
    if (
      m.method === 'Network.responseReceived' &&
      p.response.status >= 400 &&
      /\.(js|css)$|\/assets\//.test(new URL(p.response.url).pathname)
    )
      fallidas.push(`${p.response.status} ${p.response.url}`);
    if (
      m.method === 'Network.requestWillBeSent' &&
      /^\/combustibles\/.*\/assets\//.test(new URL(p.request.url).pathname)
    )
      fallidas.push(`anidada ${p.request.url}`);
    // Sin red también en el worker: se le corta antes de que arranque.
    if (m.method === 'Target.attachedToTarget' && p.targetInfo.type === 'service_worker') {
      const S = p.sessionId;
      (async () => {
        await c.send('Network.enable', {}, S).catch(() => {});
        if (sinRed) await c.send('Network.emulateNetworkConditions', OFFLINE, S).catch(() => {});
        await c.send('Runtime.runIfWaitingForDebugger', {}, S).catch(() => {});
      })();
    }
  });
  await c.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: 'service_worker', exclude: false }, { exclude: true }],
  });
}
async function pestana() {
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable']) await c.send(m, {}, sessionId);
  if (sinRed) await c.send('Network.emulateNetworkConditions', OFFLINE, sessionId);
  await c.send('ServiceWorker.enable', {}, sessionId).catch(() => {});
  return sessionId;
}
const evalua = async (S, e) => {
  const r = await c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, S);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const esperar = async (S, e, ms = 30000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      const v = await evalua(S, e);
      if (v) return v;
    } catch {}
    await dormir(300);
  }
  return null;
};
const listo = `document.readyState === 'complete' && (document.getElementById('choose-district')?.disabled === false || document.getElementById('fatal-state')?.hidden === false)`;
const ir = async (S, ruta) => {
  await c.send('Page.navigate', { url: `${O}${ruta}` }, S);
  return esperar(S, listo);
};
const shells = `caches.keys().then((k) => k.filter((c) => c.startsWith('masfacil-shell-')))`;
const guardado = (vista) =>
  `caches.open('masfacil-data-v3').then((c) => c.match('/__masfacil-pair/${vista}')).then((r) => !!r)`;
const conPrecios = `(async () => {
  document.getElementById('choose-district').click();
  await new Promise((ok) => setTimeout(ok, 400));
  document.querySelector('#districts button').click();
  await new Promise((ok) => setTimeout(ok, 900));
  return JSON.stringify({ vista: location.pathname, nota: !document.getElementById('offline-note').hidden, precios: [...document.querySelectorAll('#offers .offer__price b')].map((b) => Number(b.textContent.replace(/[^0-9.]/g, ''))).filter((x) => x > 0).length });
})()`;
const shellServido = async () =>
  /masfacil-shell-[a-z0-9]+/.exec(
    await (await fetch(`${O}/sw.js?sonda=${Date.now()}`, { cache: 'no-store' })).text(),
  )?.[0] ?? null;

// Huellas de la precache guardada contra los bytes que sirve producción.
async function rancias(S, cache) {
  const guardadas = await evalua(
    S,
    `(async () => { const c = await caches.open(${JSON.stringify(cache)}); const out = {}; for (const req of await c.keys()) { const b = await (await c.match(req)).arrayBuffer(); out[new URL(req.url).pathname] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join(''); } return out; })()`,
  );
  const fuera = [];
  for (const [ruta, huella] of Object.entries(guardadas)) {
    const bytes = Buffer.from(await (await fetch(`${O}${ruta}`, { cache: 'no-store' })).arrayBuffer());
    // Pages inyecta Analytics en el HTML con un token que no cambia entre pedidos.
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== huella) fuera.push(ruta);
  }
  return { entradas: Object.keys(guardadas).length, fuera };
}

try {
  const DESDE = await shellServido();
  await abrirChrome();
  const T1 = await pestana();
  await ir(T1, '/combustibles/gasolina');
  await esperar(T1, `navigator.serviceWorker.getRegistration().then((r) => r?.active?.state === 'activated')`);
  for (const vista of VISTAS) {
    await ir(T1, `/combustibles/${vista}`);
    const r = JSON.parse(await evalua(T1, conPrecios));
    anotar(
      `antes · ${vista} con red`,
      { ...r, guardado: await esperar(T1, guardado(vista)) },
      { vista: `/combustibles/${vista}`, precios: (x) => x > 0, guardado: true },
    );
  }
  const instalado = await esperar(T1, `${shells}.then((k) => k.length === 1 ? k[0] : null)`);
  anotar(
    'instalado',
    { controlada: await evalua(T1, '!!navigator.serviceWorker.controller'), shell: instalado },
    { controlada: true, shell: DESDE },
  );
  const T2 = await pestana();
  await ir(T2, '/combustibles/gasolina');
  const inicioT2 = await evalua(T2, 'performance.timeOrigin');
  log(`LISTO PARA EL DEPLOY · ${DESDE} · ${new Date().toISOString()}`);

  // El deploy: producción pasa a servir otro shell.
  let objetivo = null;
  const tope = Date.now() + MINUTOS * 60_000;
  while (Date.now() < tope) {
    const s = await shellServido().catch(() => null);
    if (s && s !== DESDE) {
      objetivo = s;
      break;
    }
    await dormir(20_000);
  }
  log(`producción sirve ${objetivo ?? `(sin cambios en ${MINUTOS} min)`} · ${new Date().toISOString()}`);
  if (!objetivo) throw new Error('el deploy no llegó a producción');
  eventos.length = 0;
  fallidas.length = 0;

  await ir(T1, '/combustibles/gasolina');
  const nuevo = await esperar(
    T1,
    `${shells}.then((k) => k.includes(${JSON.stringify(objetivo)}) && k.length === 1 ? k[0] : null)`,
    60000,
  );
  const errores = eventos
    .filter((e) => e.method === 'ServiceWorker.workerErrorReported')
    .map((e) => e.params.errorMessage.errorMessage);
  await esperar(T1, `navigator.serviceWorker.getRegistration().then((r) => r?.active && !r.installing && !r.waiting)`);
  await ir(T1, '/combustibles/gasolina');
  const frescura = nuevo ? await rancias(T1, nuevo) : null;
  const hoja = await evalua(
    T1,
    `[...document.querySelectorAll('link[rel=stylesheet]')].map((l) => new URL(l.href).pathname).join(',')`,
  );
  anotar(
    '→ shell nuevo',
    {
      shell: nuevo,
      errores_sw: errores,
      controlada: await evalua(T1, '!!navigator.serviceWorker.controller'),
      precache_rancia: frescura?.fuera,
      entradas: frescura?.entradas,
      hoja,
    },
    { shell: objetivo, errores_sw: [], controlada: true, precache_rancia: [] },
  );
  const mismoDocumento = (await evalua(T2, 'performance.timeOrigin')) === inicioT2;
  await evalua(
    T2,
    `[...document.querySelectorAll('#view-picker-start button')].find((b) => b.textContent.trim() === 'Diésel')?.click(); 1`,
  ).catch(() => null);
  await esperar(
    T2,
    `location.pathname === '/combustibles/diesel' && document.getElementById('choose-district').disabled === false`,
    20000,
  );
  const vieja = JSON.parse(await evalua(T2, conPrecios).catch(() => '{}'));
  anotar(
    '   pestaña abierta desde antes',
    { mismo_documento: mismoDocumento, controlada: await evalua(T2, '!!navigator.serviceWorker.controller'), ...vieja },
    { mismo_documento: true, controlada: true, vista: '/combustibles/diesel', precios: (x) => x > 0 },
  );
  for (const ruta of ['/combustibles/gasolina/historial', '/combustibles/glp', '/combustibles/gnv/'])
    await ir(T1, ruta);
  anotar('   anidadas y 404 de código', { fallidas: [...fallidas] }, { fallidas: [] });

  // Sin red: el navegador cerrado y vuelto a abrir con la página y el worker sin conexión.
  await c.cerrar();
  sinRed = true;
  await abrirChrome();
  const T3 = await pestana();
  for (const vista of VISTAS) {
    const cargo = await ir(T3, `/combustibles/${vista}`);
    const r = JSON.parse(await evalua(T3, conPrecios).catch(() => '{}'));
    anotar(
      `sin red · ${vista}`,
      {
        app: !!cargo,
        controlada: await evalua(T3, '!!navigator.serviceWorker.controller').catch(() => false),
        shell: await evalua(T3, shells)
          .then((k) => k[0])
          .catch(() => null),
        ...r,
      },
      {
        app: true,
        controlada: true,
        shell: objetivo,
        vista: `/combustibles/${vista}`,
        nota: true,
        precios: (x) => x > 0,
      },
    );
    await evalua(T3, `document.querySelector('#offers > li button[aria-expanded]')?.click(); 1`).catch(() => null);
    await dormir(400);
    const detalle = await evalua(
      T3,
      `document.querySelectorAll('#offers .offer__detail > div:has(> [role=img])').length`,
    ).catch(() => 0);
    anotar(`sin red · ${vista} · detalle`, { filas_detalle: detalle }, { filas_detalle: (x) => x > 0 });
  }
  await c.send('Page.navigate', { url: `${O}/no-existe-${Date.now().toString(36)}` }, T3);
  await esperar(T3, `document.readyState === 'complete'`);
  const cuatro = JSON.parse(
    await evalua(
      T3,
      `JSON.stringify({ propia: document.body.innerText.includes('No encontramos esta página'), hoja: [...document.styleSheets].some((s) => { try { return s.cssRules.length > 0; } catch { return false; } }), modulo: [...document.querySelectorAll('script[type=module]')].some((s) => s.src.includes('/assets/')) })`,
    ),
  );
  anotar('sin red · 404 propia con su hoja y su módulo', cuatro, { propia: true, hoja: true, modulo: true });
} catch (error) {
  fallo = true;
  log(`✖ ${error.message}`);
} finally {
  await c?.cerrar().catch(() => {});
}
const bien = ok() && !fallo;
log(bien ? 'ACTUALIZACIÓN EN PRODUCCIÓN OK' : 'ACTUALIZACIÓN EN PRODUCCIÓN CON FALLOS');
informe.end();
process.exitCode = bien ? 0 : 1;
