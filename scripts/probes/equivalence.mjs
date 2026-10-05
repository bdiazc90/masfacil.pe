// Equivalencia entre dos árboles compilados, A y B, con el mismo reloj —el corte
// de los datos servidos—, la misma posición, los mismos datos y el mismo
// histórico (sintético, en lugar del origen vivo).
//
//   node scripts/probes/equivalence.mjs --a <árbol A> --b <árbol B> [--out <carpeta>] [--declared <archivo.mjs>]
//
// Sin `--declared`, la igualdad es estricta: sirve para un cambio que no debe
// verse (formato, refactor). Un cambio visual declara cada diferencia, por
// elemento y propiedad, en un módulo que exporta por defecto
// `{ diferencias: [{ cat, el: RegExp, props: RegExp, motivo, estado?: RegExp }], extra: 'selector', atributos: ['data-…'] }`:
// `extra` son nodos nuevos que no cuentan en la estructura y `atributos`, los que
// se ignoran al comparar el DOM. Tras cada paso exige, entre A y B:
//   · DOM de `body` sin `class`, sin `extra` ni `atributos`;
//   · estilos calculados de cada elemento y de ::before/::after/::placeholder/
//     ::marker, solo con diferencias declaradas (`-webkit-tap-highlight-color`,
//     que se hereda en todo, se mira una vez en <html>);
//   · tamaños de cada caja, solo con diferencias declaradas;
//   · árbol de accesibilidad, foco, ruta y consola limpia.
// Pasadas: `base` (320/390/1280 × claro/oscuro, reduced-motion), `forzado`
// (forced-colors), `movimiento` (no-preference, animaciones terminadas) y
// `estados` (:hover/:focus-visible/:active forzados por CDP en los enfocables).
// Además acumula qué reglas de cada hoja casan con algo (cobertura por selector)
// y, en B, busca solapes entre capas (`CSS.getMatchedStylesForNode`).
//
// Filtros por entorno: PASADA, ESCENARIO, ANCHO, TEMA; ESPERA (ms) antes de medir.
// Sale con 1 si hay diferencias sin declarar.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HISTORY_ORIGIN, HORA, MIRAFLORES, REPO, argumentos, chrome, dormir, historicoDe, relojDe, servir } from './lib.mjs';

const args = argumentos();
if (!args.a || !args.b) throw new Error('Uso: --a <árbol A> --b <árbol B> [--out <carpeta>] [--declared <archivo.mjs>]');
const [ARBOL_A, ARBOL_B] = [path.resolve(args.a), path.resolve(args.b)];
const SALIDA = path.resolve(args.out ?? path.join(REPO, '.local-cache', 'sondas', `equivalence-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`));
fs.mkdirSync(SALIDA, { recursive: true });
const DECLARADO = args.declared ? (await import(pathToFileURL(path.resolve(args.declared)))).default : {};
const LADOS = ['a', 'b'];
// Nodos nuevos que no cuentan en la estructura (`extra`; ninguno si no se declara)
// y atributos que se ignoran al comparar el DOM.
const EXTRA_SEL = DECLARADO.extra || ':not(*)';
const ATRIBUTOS = DECLARADO.atributos ?? [];

// Reloj: una hora después de la última consulta del bundle servido.
const T0 = relojDe(ARBOL_A);
const leer = (rel) => JSON.parse(fs.readFileSync(path.join(ARBOL_A, 'web', rel), 'utf8'));
const corte = Date.parse(leer('data/gasolina/manifest.json').products.regular.cutoff_at);
const T40 = corte + 40 * 24 * HORA;
const HISTORICO = historicoDe(T0);
const MAR = { latitude: -12.25, longitude: -77.45, accuracy: 20 };

const servidores = { a: await servir(ARBOL_A), b: await servir(ARBOL_B) };
for (const lado of LADOS) console.log(`${lado}: ${servidores[lado].origen} · ${servidores[lado].shell}`);
const c = await chrome();
const send = c.send;
const errores = new Map(); const historicoPorSesion = new Map();
c.oir((m) => {
  const lista = errores.get(m.sessionId);
  if (m.method === 'Runtime.exceptionThrown') lista?.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') lista?.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Fetch.requestPaused') {
    const modo = historicoPorSesion.get(m.sessionId) ?? 'ok';
    const cabeceras = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'no-store' }];
    const respuesta = modo === 'error'
      ? { requestId: m.params.requestId, responseCode: 500, responseHeaders: cabeceras, body: Buffer.from('{}').toString('base64') }
      : { requestId: m.params.requestId, responseCode: 200, responseHeaders: cabeceras, body: HISTORICO.toString('base64') };
    send('Fetch.fulfillRequest', respuesta, m.sessionId).catch(() => {});
  }
});

async function pestana(origen, { ancho, tema, reloj = T0, gps = MIRAFLORES, medios = [], historico = 'ok' }) {
  const { browserContextId } = await send('Target.createBrowserContext', {});
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  errores.set(S, []); historicoPorSesion.set(S, historico);
  for (const m of ['Page.enable', 'Runtime.enable', 'Accessibility.enable', 'DOM.enable', 'CSS.enable']) await send(m, {}, S);
  const escritorio = ancho >= 1024;
  await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: escritorio ? 900 : 860, deviceScaleFactor: 1, mobile: !escritorio }, S);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: tema }, ...medios] }, S);
  await send('Emulation.setGeolocationOverride', gps, S);
  await send('Browser.grantPermissions', { permissions: ['geolocation'], origin: origen, browserContextId });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, S);
  await send('Emulation.setScrollbarsHidden', { hidden: true }, S);
  await send('Fetch.enable', { patterns: [{ urlPattern: `${HISTORY_ORIGIN}/*` }] }, S);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const T0 = ${reloj}; const D = Date; class F extends D { constructor(...a) { if (a.length) super(...a); else super(T0); } static now() { return T0; } } globalThis.Date = F; try { localStorage.setItem('masfacil-theme', ${JSON.stringify(tema)}); } catch {} })();` }, S);
  return { S, browserContextId, origen };
}
const evalua = async (S, e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }, S); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const llamar = (S, fn, ...args) => evalua(S, `(${fn.toString()})(...${JSON.stringify(args)})`);
const esperar = async (S, e, ms = 20000) => { const fin = Date.now() + ms; while (Date.now() < fin) { try { const v = await evalua(S, e); if (v) return v; } catch {} await dormir(150); } return null; };
const listo = `document.readyState === 'complete' && (document.getElementById('choose-district')?.disabled === false || document.getElementById('fatal-state')?.hidden === false || document.body.innerText.includes('No encontramos esta página'))`;
const estable = `document.getElementById('history-chart')?.dataset.state !== 'loading'`;

// --- Lo que se compara ---------------------------------------------------------
// Ruta estructural de un elemento: índices de hijos desde <html>, sin contar los
// nodos `extra` declarados: fuera de ellos no se añaden, quitan ni reordenan nodos, así que la misma ruta es el mismo elemento en A y B.
// `-webkit-tap-highlight-color` se hereda en todo: se compara aparte, en <html>.
function enPagina(EXTRA) {
  const ruta = (e) => { const p = []; while (e && e !== document.documentElement) { p.unshift([...e.parentElement.children].filter((x) => !x.matches(EXTRA)).indexOf(e)); e = e.parentElement; } return p.join('.'); };
  const propio = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + (e.getAttribute('class') ? `.${e.getAttribute('class').trim().split(/\s+/).slice(0, 3).join('.')}` : '');
  // Sin id ni clase, con su padre delante: `div.theme-toggle > button`.
  const nombre = (e) => (!e.id && !e.getAttribute('class') && e.parentElement && e.parentElement !== document.documentElement ? `${propio(e.parentElement)} > ` : '') + propio(e);
  const props = [...getComputedStyle(document.documentElement)].filter((p) => !p.startsWith('--') && p !== '-webkit-tap-highlight-color');
  const fnv = (s) => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(36); };
  const valores = (cs) => props.map((p) => cs.getPropertyValue(p));
  const pseudos = (e, cs) => {
    const lista = [];
    for (const pe of ['::before', '::after']) { const c = getComputedStyle(e, pe); if (c.content !== 'none' && c.content !== 'normal') lista.push([pe, c]); }
    if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') lista.push(['::placeholder', getComputedStyle(e, '::placeholder')]);
    if (cs.display === 'list-item') lista.push(['::marker', getComputedStyle(e, '::marker')]);
    return lista;
  };
  const elementos = () => [document.documentElement, document.body, ...document.body.querySelectorAll('*')].filter((e) => e.tagName !== 'SCRIPT' && !e.closest(EXTRA));
  return { EXTRA, ruta, nombre, props, fnv, valores, pseudos, elementos };
}
function huellas(ayudas) {
  const { ruta, nombre, fnv, valores, pseudos, elementos } = ayudas;
  const salida = {}; const nombres = {};
  for (const e of elementos()) {
    const k = e === document.documentElement ? 'html' : ruta(e);
    const cs = getComputedStyle(e);
    salida[k] = fnv(valores(cs).join('|')); nombres[k] = nombre(e);
    for (const [pe, c] of pseudos(e, cs)) { salida[k + pe] = fnv(valores(c).join('|')); nombres[k + pe] = nombre(e) + pe; }
  }
  return { salida, nombres };
}
function detalleEstilos(ayudas, claves) {
  const { props } = ayudas;
  const buscar = (k) => { const [r, pe] = k.split(/(?=::)/); if (r === 'html') return [document.documentElement, pe]; let e = document.documentElement; for (const i of r.split('.')) e = e?.children[Number(i)]; return [e, pe]; };
  const salida = {};
  for (const k of claves) { const [e, pe] = buscar(k); if (!e) { salida[k] = null; continue; } const cs = getComputedStyle(e, pe ?? null); salida[k] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])); }
  return salida;
}
const AYUDAS = `(${enPagina.toString()})(${JSON.stringify(EXTRA_SEL)})`;
const huellasDe = (S) => evalua(S, `(${huellas.toString()})(${AYUDAS})`);
const detalleDe = (S, claves) => evalua(S, `(${detalleEstilos.toString()})(${AYUDAS}, ${JSON.stringify(claves)})`);

// DOM de `body` sin `class`, con el valor vivo de los campos y sin lo oculto,
// sin los nodos `extra` ni los atributos declarados.
// Las cajas, por tamaño: las posiciones se mueven cuando algo de arriba crece.
function fotoDom(EXTRA, ATRIBUTOS) {
  const ocultos = [...document.body.querySelectorAll('*')].filter((e) => getComputedStyle(e).display === 'none' || e.matches(EXTRA));
  ocultos.forEach((e) => e.setAttribute('data-sonda-oculto', ''));
  const c = document.body.cloneNode(true);
  ocultos.forEach((e) => e.removeAttribute('data-sonda-oculto'));
  c.querySelectorAll('[data-sonda-oculto]').forEach((e) => e.remove());
  for (const a of ATRIBUTOS) c.querySelectorAll(`[${a}]`).forEach((e) => e.removeAttribute(a));
  const vivos = [...document.body.querySelectorAll('input')];
  [...c.querySelectorAll('input')].forEach((e, i) => { e.removeAttribute('value'); e.setAttribute('data-valor', vivos[i]?.value ?? ''); });
  c.querySelectorAll('script').forEach((s) => s.remove());
  c.querySelectorAll('[hidden]').forEach((e) => e.remove());
  c.querySelectorAll('[class]').forEach((e) => e.removeAttribute('class'));
  const ser = (nodo) => nodo.nodeType === 3 ? nodo.textContent.replace(/\s+/g, ' ') : nodo.nodeType !== 1 ? '' : '<' + nodo.tagName.toLowerCase() + [...nodo.attributes].map((a) => [a.name, a.value]).sort().map(([k, v]) => ' ' + k + '="' + v + '"').join('') + '>' + [...nodo.childNodes].map(ser).join('') + '</' + nodo.tagName.toLowerCase() + '>';
  const a = document.activeElement;
  const offers = [...document.querySelectorAll('#offers > li')];
  const foco = !a || a === document.body ? 'body' : a.id ? '#' + a.id : offers.includes(a) ? 'offer:' + offers.indexOf(a) : a.closest('#offers > li') ? 'offer:' + offers.indexOf(a.closest('#offers > li')) + ':' + (a.textContent || a.tagName).trim() : a.tagName;
  const ruta = (e) => { const p = []; while (e && e !== document.documentElement) { p.unshift([...e.parentElement.children].filter((x) => !x.matches(EXTRA)).indexOf(e)); e = e.parentElement; } return p.join('.'); };
  const propio = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + (e.getAttribute('class') ? `.${e.getAttribute('class').trim().split(/\s+/).slice(0, 3).join('.')}` : '');
  // Sin id ni clase, con su padre delante: `div.theme-toggle > button`.
  const nombre = (e) => (!e.id && !e.getAttribute('class') && e.parentElement && e.parentElement !== document.documentElement ? `${propio(e.parentElement)} > ` : '') + propio(e);
  const tamanos = {};
  for (const e of [document.body, ...document.querySelectorAll('body *:not(script)')]) {
    if (e.closest(EXTRA) || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    tamanos[ruta(e)] = { nombre: nombre(e), caja: `${r.width.toFixed(1)}×${r.height.toFixed(1)}` };
  }
  const toque = getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color');
  return { ruta: location.pathname, foco, scroll: scrollY, tamanos, toque, ancho: document.documentElement.scrollWidth, body: ser(c).replace(/\s+/g, ' ').replace(/> </g, '><').replace(/(id="|url\(#)[^"()]*-(fill-[a-z]+|dias)/g, '$1uid-$2') };
}
async function accesibilidad(S) {
  const { nodes } = await send('Accessibility.getFullAXTree', {}, S);
  return nodes.filter((nodo) => !nodo.ignored && nodo.role?.value !== 'generic' && nodo.role?.value !== 'none').map((nodo) => `${nodo.role?.value}|${nodo.name?.value ?? ''}|${(nodo.properties ?? []).filter((p) => ['expanded', 'hidden', 'focusable', 'pressed', 'disabled'].includes(p.name)).map((p) => `${p.name}=${p.value.value}`).sort().join(',')}`).sort();
}

// Cobertura por selector: qué reglas de las hojas casan con algún elemento ahora.
// Se quitan los pseudoelementos y las pseudoclases dinámicas para probar la parte
// estructural; lo que está bajo un @media que no aplica también cuenta como casado
// (su estado se cubre en otra pasada o se justifica aparte).
function cobertura() {
  const todas = []; const usadas = [];
  const quitar = (sel) => sel.replace(/::?(before|after|placeholder|marker|backdrop|selection|-webkit-[a-z-]+)\b(\([^)]*\))?/g, '').replace(/:(hover|focus-visible|focus-within|focus|active|visited|target)\b/g, '');
  const recorrer = (reglas, ctx) => {
    for (const r of reglas) {
      if (r instanceof CSSStyleRule) {
        const k = ctx + r.selectorText; todas.push(k);
        try { if (document.querySelector(quitar(r.selectorText).replace(/(^|,)\s*(?=,|$)/g, '$1*') || '*')) usadas.push(k); } catch { usadas.push(k); }
        if (r.cssRules?.length) recorrer(r.cssRules, `${k} › `);
      } else if (r.cssRules && !(r instanceof CSSKeyframesRule)) recorrer(r.cssRules, `${ctx}@${r.constructor.name.replace(/^CSS|Rule$/g, '')} ${r.conditionText ?? r.name ?? ''} › `);
    }
  };
  for (const s of document.styleSheets) { try { recorrer(s.cssRules, `${s.href ? new URL(s.href).pathname.replace(/-[\w-]{8}\.css$/, '.css') : 'inline'} | `); } catch {} }
  return { todas, usadas };
}

// Solapes de cascada en B: misma propiedad en el mismo nodo declarada por una
// utilidad sin condición y por una regla de componente o base; reglas sin capa
// fuera de <html>; `!important` fuera de `[hidden]`.
async function cascada(S) {
  const { root } = await send('DOM.getDocument', { depth: -1 }, S);
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'html, body, body *:not(script)' }, S);
  const hallazgos = new Set();
  for (const nodeId of nodeIds) {
    let m; try { m = await send('CSS.getMatchedStylesForNode', { nodeId }, S); } catch { continue; }
    const { node } = await send('DOM.describeNode', { nodeId }, S);
    const etiqueta = node.localName + (node.attributes ? (() => { const a = node.attributes; const i = a.indexOf('id'); return i >= 0 ? `#${a[i + 1]}` : ''; })() : '');
    const porProp = new Map();
    for (const { rule } of m.matchedCSSRules ?? []) {
      if (rule.origin !== 'regular') continue;
      const capa = (rule.layers ?? []).map((l) => l.text).join('.');
      const condicion = Boolean(rule.media?.length || rule.supports?.length || rule.containerQueries?.length);
      const sel = rule.selectorList.text;
      if (!capa && node.localName !== 'html') hallazgos.add(`sin capa · ${sel} → ${etiqueta}`);
      for (const p of rule.style.cssProperties ?? []) {
        if (p.disabled || p.parsedOk === false || p.name.startsWith('--') || !p.range) continue;
        if (p.important && !/^\[hidden\]$/.test(sel.trim())) hallazgos.add(`!important · ${sel} { ${p.name} } → ${etiqueta}`);
        const nombres = p.longhandProperties?.length ? p.longhandProperties.map((l) => l.name) : [p.name];
        for (const nombre of nombres) { if (!porProp.has(nombre)) porProp.set(nombre, []); porProp.get(nombre).push({ capa, condicion, sel }); }
      }
    }
    for (const [prop, reglas] of porProp) {
      const util = reglas.filter((r) => r.capa === 'utilities' && !r.condicion && !/:(hover|focus|active|disabled|checked)/.test(r.sel));
      // Pisar el reset (`base`) es lo normal; pisar CSS de componente es una regla sustituida.
      const resto = reglas.filter((r) => r.capa === 'components');
      if (util.length && resto.length) hallazgos.add(`solape · ${prop}: ${util.map((r) => r.sel).join(' + ')} sobre ${resto.map((r) => `${r.capa}:${r.sel}`).join(' + ')} → ${etiqueta}`);
    }
  }
  return [...hallazgos];
}

// Estados forzados: cada enfocable visible con :hover, :focus-visible y :active.
async function estadosForzados(S) {
  const { root } = await send('DOM.getDocument', { depth: -1 }, S);
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'button, a[href], input, summary, [tabindex]' }, S);
  const salida = {};
  for (const nodeId of nodeIds) {
    const { object } = await send('DOM.resolveNode', { nodeId }, S);
    const visible = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { return this.getClientRects().length > 0 && getComputedStyle(this).visibility !== "hidden"; }', returnByValue: true }, S);
    if (!visible.result.value) continue;
    for (const estado of ['hover', 'focus-visible', 'active']) {
      await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [estado === 'focus-visible' ? 'focus-visible' : estado, ...(estado === 'focus-visible' ? ['focus'] : [])] }, S);
      const r = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function () { const a = ${AYUDAS}; const e = this; const cs = getComputedStyle(e); const out = { yo: a.valores(cs).join('|') }; for (const [pe, c] of a.pseudos(e, cs)) out[pe] = a.valores(c).join('|'); const k = a.ruta(e); return { k, nombre: a.nombre(e), out }; }`, returnByValue: true }, S);
      await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, S);
      const { k, nombre, out } = r.result.value;
      for (const [parte, valor] of Object.entries(out)) salida[`${k}:${estado}${parte === 'yo' ? '' : parte}`] = { nombre, valor };
    }
  }
  return salida;
}

// Con movimiento: esperar a que terminen las transiciones finitas, congelar las
// infinitas en su inicio y esperar a que el scroll suave se detenga.
async function reposar(S) {
  await esperar(S, `(() => { const vivas = document.getAnimations().filter((a) => a.playState === 'running'); for (const a of vivas) if (a.effect?.getComputedTiming().iterations === Infinity) { a.pause(); a.currentTime = 0; } return document.getAnimations().every((a) => a.playState !== 'running'); })()`, 5000);
  let previo = null;
  for (let i = 0; i < 30; i++) { const y = await evalua(S, 'scrollY'); if (y === previo) break; previo = y; await dormir(120); }
}

// --- Pasos (por lo que se ve, no por clases) ------------------------------------
const ir = async (S, o, ruta) => { await send('Page.navigate', { url: `${o}${ruta}` }, S); await esperar(S, listo); };
const gps = async (S, o) => { await ir(S, o, '/combustibles/gasolina'); await evalua(S, `document.getElementById('use-location').click(); 1`); await esperar(S, `document.getElementById('compare-step').hidden === false && (document.querySelectorAll('#offers > li').length > 0 || !document.getElementById('radius-empty').hidden)`); await dormir(400); };
const buscar = (sel) => { const [cont, texto] = sel.split(' >> '); return texto ? `[...document.querySelectorAll(${JSON.stringify(`${cont} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(texto)} || b.getAttribute('aria-label') === ${JSON.stringify(texto)})` : `document.querySelector(${JSON.stringify(sel)})`; };
const clic = (selector) => async (S) => { await evalua(S, `(() => { const e = ${buscar(selector)}; e?.focus({ preventScroll: true }); e?.click(); return 1; })()`); await dormir(350); };
const foco = (selector) => async (S) => { await evalua(S, `(${buscar(selector)})?.focus(); 1`); await dormir(100); };
const escribir = (selector, valor) => `(() => { const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(valor)}); e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`;
const radio = (km) => async (S) => { await evalua(S, escribir('#radius-input', String(km))); await evalua(S, `document.getElementById('radius-input').dispatchEvent(new Event('change', { bubbles: true })); 1`); await dormir(350); };
const tecla = (key, code, vk) => async (S) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk }, S); await dormir(350); };
const desplazar = (y) => async (S) => { await evalua(S, `scrollTo(0, ${y}); 1`); await dormir(700); };
const DETALLE = '#offers > li button[aria-expanded]';
const DISTRITO = '#districts button';

const ESCENARIOS = [
  { nombre: 'recorrido', pasos: [
    ['portada', async (S, o) => { await ir(S, o, '/combustibles/gasolina'); await esperar(S, estable); }],
    ...['gasolina', 'diesel', 'glp', 'gnv'].flatMap((vista) => [
      [`${vista}-distritos`, async (S, o) => { await ir(S, o, `/combustibles/${vista}`); await clic('#choose-district')(S); }],
      [`${vista}-distritos-compacto`, desplazar(700)],
      [`${vista}-resultados-distrito`, async (S) => { await evalua(S, 'scrollTo(0, 0); 1'); await dormir(500); await clic(DISTRITO)(S); }],
    ]),
    ['distritos-busqueda', async (S) => { await clic('#place-more')(S); await clic('#menu-districts')(S); await evalua(S, escribir('#district-search', 'mira')); await dormir(350); }],
    ['distritos-sin-coincidencia', async (S) => { await evalua(S, escribir('#district-search', 'zzzz')); await dormir(350); }],
    ['distritos-busqueda-compacto', async (S) => { await evalua(S, escribir('#district-search', '')); await dormir(200); await desplazar(700)(S); }],
    ['distritos-volver', async (S) => { await evalua(S, 'scrollTo(0, 0); 1'); await dormir(500); await clic('#place-more')(S); await clic('#menu-back-results')(S); }],
    ['gps', gps],
    ['precio', clic('#sort-toggle >> Más barata')],
    ['premium', clic('#price-product-toggle >> Premium')],
    ['radio-3', radio(3)],
    ['ver-mas', clic('#load-more')],
    ['ver-mas-otra', clic('#load-more')],
    ['detalle-abierto', async (S) => { await foco(DETALLE)(S); await clic(DETALLE)(S); }],
    ['detalle-tras-repintar', radio(4)],
    ['cambio-a-diesel', async (S) => { await clic('#view-picker-controls >> Diésel')(S); await esperar(S, `location.pathname === '/combustibles/diesel' && document.querySelectorAll('#offers > li').length > 0`); await dormir(300); }],
    ['actualizar-ubicacion', async (S) => { await evalua(S, 'scrollTo(0, 0); 1'); await clic('#refresh-location')(S); await esperar(S, `document.getElementById('location-update')?.dataset.status === 'done'`); await dormir(300); }],
    ['compacto', desplazar(1400)],
    ['ajustar', clic('#controls-summary')],
    ['ajustar-escape', tecla('Escape', 'Escape', 27)],
    ['arriba', desplazar(0)],
    ['menu', clic('#place-more')],
    ['menu-flecha', tecla('ArrowDown', 'ArrowDown', 40)],
    ['menu-escape', tecla('Escape', 'Escape', 27)],
    ['cambio-a-gasolina', async (S) => { await clic('#view-picker-controls >> Gasolina')(S); await esperar(S, `location.pathname === '/combustibles/gasolina' && document.querySelectorAll('#offers > li').length > 0`); await dormir(300); }],
    ['menu-historial', async (S) => { await clic('#place-more')(S); await clic('#menu-history')(S); await esperar(S, estable); await dormir(700); }],
    ['historial-flecha', tecla('ArrowLeft', 'ArrowLeft', 37)],
    ['historial-atras', async (S) => { await evalua(S, 'history.back(); 1'); await dormir(900); }],
    ['menu-inicio', async (S) => { await evalua(S, 'scrollTo(0, 0); 1'); await clic('#place-more')(S); await clic('#menu-home')(S); await esperar(S, estable); }],
    ['inicio-a-resultados', async (S) => { await clic('#use-location')(S); await esperar(S, `document.getElementById('compare-step')?.hidden === false`); await dormir(400); }],
    ['inicio-a-resultados-compacto', desplazar(1400)],
    ['volver-inicio', async (S) => { await evalua(S, 'scrollTo(0, 0); 1'); await dormir(500); await clic('#place-more')(S); await clic('#menu-home')(S); await esperar(S, estable); }],
    ['tema-oscuro', clic('.appbar >> Tema oscuro')],
    ['tema-claro', clic('.appbar >> Tema claro')],
    ['tema-sistema', clic('.appbar >> Tema del sistema')],
    ['historial', async (S, o) => { await ir(S, o, '/combustibles/gasolina/historial'); await esperar(S, estable); await dormir(300); }],
    ['404', async (S, o) => { await ir(S, o, '/combustibles/otra-cosa'); await dormir(300); }],
  ] },
  { nombre: 'paginacion-final', pasos: [
    ['gps', gps],
    ['radio-5', radio(5)],
    ...Array.from({ length: 8 }, (_, i) => [`ver-mas-${i + 1}`, clic('#load-more:not([hidden])')]),
  ] },
  { nombre: 'todo-vencido', reloj: T40, pasos: [
    ['distrito', async (S, o) => { await ir(S, o, '/combustibles/gasolina'); await clic('#choose-district')(S); await clic(DISTRITO)(S); }],
    ['detalle-mudo', async (S) => { await clic(DETALLE)(S); }],
    ['gps', gps],
  ] },
  { nombre: 'vacio-por-radio', gps: MAR, pasos: [['gps', gps], ['diesel', async (S) => { await clic('#view-picker-controls >> Diésel')(S); await dormir(800); }]] },
  { nombre: 'gps-fallido', gps: {}, pasos: [
    ['portada', async (S, o) => { await ir(S, o, '/combustibles/glp'); }],
    ['fallo', async (S) => { await clic('#use-location')(S); await esperar(S, `document.getElementById('district-step')?.hidden === false`); await dormir(400); }],
    ['elegir', clic(DISTRITO)],
  ] },
  { nombre: 'historial-fallido', historico: 'error', pasos: [['portada', async (S, o) => { await ir(S, o, '/combustibles/gasolina'); await esperar(S, estable); await dormir(300); }]] },
  // «Actualizar ubicación» sin posición: el aviso queda en error y la lista sigue.
  { nombre: 'actualizar-fallido', pasos: [
    ['gps', gps],
    ['fallo', async (S) => { await send('Emulation.setGeolocationOverride', {}, S); await clic('#refresh-location')(S); await esperar(S, `document.getElementById('location-update')?.dataset.status === 'error'`); await dormir(300); }],
  ] },
];

// Pasos donde además se fuerzan estados y se mide la cascada de B.
const MUESTRA = new Set(['recorrido/portada', 'recorrido/gasolina-distritos', 'recorrido/gasolina-resultados-distrito', 'recorrido/detalle-abierto', 'recorrido/compacto', 'recorrido/ajustar', 'recorrido/menu', 'recorrido/historial', 'recorrido/404', 'recorrido/distritos-busqueda', 'todo-vencido/detalle-mudo', 'vacio-por-radio/gps', 'historial-fallido/portada', 'gps-fallido/fallo', 'actualizar-fallido/fallo']);
const DECLARADAS = DECLARADO.diferencias ?? [];
const casa = (r, el, prop) => r.el.test(el) && r.props.test(prop);
const declarada = (el, prop, estado = null) => DECLARADAS.find((r) => (r.estado ? estado && r.estado.test(estado) : true) && casa(r, el, prop)) ?? null;

const REDUCE = { name: 'prefers-reduced-motion', value: 'reduce' };
const PASADAS = [
  { nombre: 'base', anchos: [320, 390, 1280], temas: ['light', 'dark'], medios: [REDUCE], escenarios: null },
  { nombre: 'forzado', anchos: [390], temas: ['light', 'dark'], medios: [REDUCE, { name: 'forced-colors', value: 'active' }], escenarios: ['recorrido', 'todo-vencido'] },
  { nombre: 'movimiento', anchos: [390], temas: ['light', 'dark'], medios: [{ name: 'prefers-reduced-motion', value: 'no-preference' }], escenarios: ['recorrido', 'paginacion-final'] },
  { nombre: 'estados', anchos: [390, 1280], temas: ['light', 'dark'], medios: [REDUCE], escenarios: ['recorrido', 'todo-vencido', 'vacio-por-radio', 'historial-fallido', 'gps-fallido', 'actualizar-fallido'], soloMuestra: true },
];

const resultados = []; const coberturas = { a: { todas: new Set(), usadas: new Set() }, b: { todas: new Set(), usadas: new Set() } }; const solapes = new Set();
const vistas = new Map(); // `${cat} · ${el} · ${prop}` → { veces, ejemplo, motivo }
const sinDeclarar = new Map();
const anotar = (mapa, clave, valor) => { const v = mapa.get(clave) ?? { veces: 0, ...valor }; v.veces += 1; mapa.set(clave, v); };
const informe = fs.createWriteStream(path.join(SALIDA, 'informe.txt'));
const log = (linea) => { console.log(linea); informe.write(`${linea}\n`); };
log(`reloj T0 ${new Date(T0).toISOString()} · T40 ${new Date(T40).toISOString()}`);
let PROPS = null;
try {
  const { PASADA, ESCENARIO, ANCHO, TEMA, ESPERA = '250' } = process.env;
  for (const pasada of PASADAS.filter((p) => !PASADA || p.nombre === PASADA)) {
    for (const escenario of ESCENARIOS.filter((e) => (!ESCENARIO || e.nombre === ESCENARIO) && (!pasada.escenarios || pasada.escenarios.includes(e.nombre)))) {
      for (const ancho of pasada.anchos.filter((a) => !ANCHO || String(a) === ANCHO)) {
        for (const tema of pasada.temas.filter((t) => !TEMA || t === TEMA)) {
          const pestanas = {};
          for (const lado of LADOS) pestanas[lado] = await pestana(servidores[lado].origen, { ancho, tema, reloj: escenario.reloj ?? T0, gps: escenario.gps ?? MIRAFLORES, medios: pasada.medios, historico: escenario.historico ?? 'ok' });
          PROPS ??= await evalua(pestanas.b.S, `(${AYUDAS}).props`);
          for (const [paso, accion] of escenario.pasos) {
            const base = `${pasada.nombre}-${escenario.nombre}-${ancho}-${tema}-${paso}`;
            const enMuestra = MUESTRA.has(`${escenario.nombre}/${paso}`);
            const f = {}; const ax = {}; const est = {}; const forzados = {};
            for (const lado of LADOS) {
              const { S, origen } = pestanas[lado];
              errores.get(S).length = 0;
              await accion(S, origen);
              await dormir(Number(ESPERA));
              await reposar(S);
              if (pasada.soloMuestra && !enMuestra) continue;
              f[lado] = await llamar(S, fotoDom, EXTRA_SEL, ATRIBUTOS);
              f[lado].errores = [...errores.get(S)];
              ax[lado] = await accesibilidad(S);
              est[lado] = await huellasDe(S);
              const cob = await llamar(S, cobertura);
              for (const k of cob.todas) coberturas[lado].todas.add(k);
              for (const k of cob.usadas) coberturas[lado].usadas.add(k);
              if (pasada.nombre === 'estados') forzados[lado] = await estadosForzados(S);
              if (lado === 'b' && enMuestra && pasada.nombre === 'base' && ancho === 390) for (const h of await cascada(S)) solapes.add(h);
            }
            if (pasada.soloMuestra && !enMuestra) continue;
            const dom = f.a.body === f.b.body;
            const axIgual = JSON.stringify(ax.a) === JSON.stringify(ax.b);
            const focoIgual = f.a.foco === f.b.foco;
            const rutaIgual = f.a.ruta === f.b.ruta;
            const anchoIgual = f.a.ancho === f.b.ancho;
            const sinErrores = !f.b.errores.length && !f.a.errores.length;
            const toque = f.b.toque === 'rgba(0, 0, 0, 0)';
            const nuevas = [];
            const revisar = (el, prop, va, vb, estado = null) => {
              const r = declarada(el, prop, estado);
              const clave = `${el}${estado ? ` ${estado}` : ''} · ${prop}`;
              if (r) anotar(vistas, `${r.cat} · ${clave}`, { motivo: r.motivo, ejemplo: [va, vb] });
              else { anotar(sinDeclarar, clave, { ejemplo: [va, vb], paso: base }); nuevas.push(clave); }
            };
            // Estilos: detalle completo de cada elemento distinto, en tandas.
            const claves = [...new Set([...Object.keys(est.a.salida), ...Object.keys(est.b.salida)])];
            const distintas = claves.filter((k) => est.a.salida[k] !== est.b.salida[k]);
            for (let i = 0; i < distintas.length; i += 60) {
              const tanda = distintas.slice(i, i + 60);
              const det = { a: await detalleDe(pestanas.a.S, tanda), b: await detalleDe(pestanas.b.S, tanda) };
              for (const k of tanda) {
                const el = est.b.nombres[k] ?? est.a.nombres[k]; const pa = det.a[k] ?? {}; const pb = det.b[k] ?? {};
                if (!det.a[k] || !det.b[k]) { revisar(el, '(elemento)', det.a[k] ? 'está' : 'falta', det.b[k] ? 'está' : 'falta'); continue; }
                for (const p of PROPS) if (pa[p] !== pb[p]) revisar(el, p, pa[p], pb[p]);
              }
            }
            // Tamaños de caja.
            for (const k of new Set([...Object.keys(f.a.tamanos), ...Object.keys(f.b.tamanos)])) {
              const ta = f.a.tamanos[k]; const tb = f.b.tamanos[k];
              if (ta?.caja === tb?.caja) continue;
              revisar((tb ?? ta).nombre, '(tamaño)', ta?.caja ?? 'falta', tb?.caja ?? 'falta');
            }
            // Estados forzados: por propiedad, con la misma lista.
            if (pasada.nombre === 'estados') {
              for (const k of new Set([...Object.keys(forzados.a), ...Object.keys(forzados.b)])) {
                const va = forzados.a[k]?.valor; const vb = forzados.b[k]?.valor;
                if (va === vb) continue;
                // Clave `ruta:estado` o `ruta:estado::pseudo`: el pseudo-elemento va con el elemento.
                const [, estadoBase, pseudo = ''] = /:([a-z-]+)(::[a-z-]+)?$/.exec(k) ?? [null, k, ''];
                const el = `${forzados.b[k]?.nombre ?? forzados.a[k]?.nombre}${pseudo}`; const estado = `:${estadoBase}`;
                if (!va || !vb) { revisar(el, '(estado)', va ? 'está' : 'falta', vb ? 'está' : 'falta', estado); continue; }
                const xa = va.split('|'); const xb = vb.split('|');
                PROPS.forEach((p, i) => { if (xa[i] !== xb[i]) revisar(el, p, xa[i], xb[i], estado); });
              }
            }
            const ok = dom && axIgual && focoIgual && rutaIgual && anchoIgual && sinErrores && toque && !nuevas.length;
            resultados.push({ base, ok });
            const unicas = [...new Set(nuevas)];
            log(`${ok ? '✔' : '✖'} ${base} · dom ${dom ? '=' : '≠'} · ax ${axIgual ? '=' : '≠'} · foco ${f.a.foco}${focoIgual ? '' : ` ≠ ${f.b.foco}`} · ruta ${f.a.ruta}${rutaIgual ? '' : ` ≠ ${f.b.ruta}`} · ancho ${anchoIgual ? '=' : '≠'} · toque ${toque ? 'ok' : f.b.toque} · sin declarar ${unicas.length}${unicas.length ? ` (${unicas.slice(0, 5).join(' | ')})` : ''}${f.b.errores.length ? ` · errores B ${JSON.stringify(f.b.errores)}` : ''}${f.a.errores.length ? ` · errores A ${JSON.stringify(f.a.errores)}` : ''}`);
            if (!dom || !axIgual) fs.writeFileSync(path.join(SALIDA, `${base}.diff.json`), JSON.stringify({ a: { body: f.a.body, ax: ax.a }, b: { body: f.b.body, ax: ax.b } }, null, 1));
          }
          for (const { S, browserContextId } of Object.values(pestanas)) { errores.delete(S); historicoPorSesion.delete(S); await send('Target.disposeBrowserContext', { browserContextId }); }
        }
      }
    }
  }
} finally {
  await c.cerrar();
  for (const lado of LADOS) await servidores[lado].cerrar();
}
for (const lado of LADOS) {
  const sinUso = [...coberturas[lado].todas].filter((k) => !coberturas[lado].usadas.has(k));
  fs.writeFileSync(path.join(SALIDA, `cobertura-${lado}.txt`), `${coberturas[lado].todas.size} reglas · ${sinUso.length} sin casar en ningún estado\n${sinUso.join('\n')}\n`);
  log(`cobertura ${lado}: ${coberturas[lado].todas.size} reglas · ${sinUso.length} sin casar`);
}
fs.writeFileSync(path.join(SALIDA, 'cascada-b.txt'), `${[...solapes].sort().join('\n')}\n`);
log(`cascada B: ${solapes.size} hallazgos`);
const tabla = (mapa) => [...mapa].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k} · ×${v.veces} · ${JSON.stringify(v.ejemplo)}${v.motivo ? ` · ${v.motivo}` : ''}${v.paso ? ` · ${v.paso}` : ''}`).join('\n');
fs.writeFileSync(path.join(SALIDA, 'declaradas.txt'), `${tabla(vistas)}\n`);
fs.writeFileSync(path.join(SALIDA, 'sin-declarar.txt'), `${tabla(sinDeclarar)}\n`);
log(`diferencias declaradas: ${vistas.size} pares elemento · propiedad · sin declarar: ${sinDeclarar.size}`);
const fallos = resultados.filter((r) => !r.ok);
log(fallos.length ? `EQUIVALENCIA CON DIFERENCIAS SIN DECLARAR (${fallos.length} de ${resultados.length})` : `EQUIVALENCIA OK (${resultados.length} estados${DECLARADAS.length ? ', solo diferencias declaradas' : ', sin diferencias'})`);
informe.end();
process.exitCode = fallos.length || !resultados.length ? 1 : 0;
