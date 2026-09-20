// La consulta web, acotada y reproducible.
//
// Portado del piloto `scripts/pilots/scrap-facilito.mjs`, que queda como está:
// mismo mecanismo validado —navegador normal, sesión aislada, selectores
// públicos y la API documentada de DataTables—, sin endpoints, sin reutilizar el
// token de reCAPTCHA y sin resolver ningún desafío.
//
// Tres cosas cambian respecto del piloto, y las tres vienen del SPEC:
//
// 1. La unidad de aceptación es **distrito × producto**, no la corrida. Que
//    Premium de San Borja falle no invalida el Regular que ya se comprobó ni
//    toca los otros 42 distritos. Una tabla parcial o de forma desconocida no
//    actualiza unas filas sí y otras no: se cae entera esa unidad.
// 2. Un rechazo explícito —401/403/429 o un desafío— **detiene toda la
//    adquisición**. Seguir golpeando el mismo bloqueo con otros distritos sería
//    exactamente lo que no se debe hacer.
// 3. Las filas salen como huella y precio. La razón social y la dirección se
//    usan para calcular el vínculo y se descartan; el teléfono no se emite nunca,
//    igual que en el piloto.

import { execFileSync } from 'node:child_process';

import { facilitoLinkKey } from './link.mjs';

export const CAPTURE_CONTRACT = 'scrap-facilito/v1';
export const FACILITO_URL = 'https://www.facilito.gob.pe/facilito/pages/facilito/buscadorEESS.jsp';

const DEPARTAMENTO = { nombre: 'LIMA', codigo: '150000' };
const PROVINCIA = { nombre: 'LIMA', codigo: '150100' };
const PRODUCTOS = Object.freeze([
  { key: 'regular', nombre: 'GASOHOL REGULAR', codigo: '126' },
  { key: 'premium', nombre: 'GASOHOL PREMIUM', codigo: '127' },
]);
// Orden exacto de la tabla. El teléfono se valida por posición y nunca se emite.
const CABECERAS = ['Distrito', 'Establecimiento', 'Dirección', 'Teléfono', 'Precio de Venta (Soles por galón)'];

// Presupuestos declarados. La medición del piloto es de ~11 s por distrito con
// los dos productos, así que 43 distritos caben de sobra en el total; el techo
// existe para que una corrida rota no se quede colgada hasta el siguiente cron.
export const RUN_BUDGET_MS = 20 * 60_000;
const TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 45_000;
const MAX_FILAS = 400;
const INTENTOS_POR_DISTRITO = 3;

export const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
export const precio = (v) => { const m = String(v ?? '').trim().match(/^(?:S\/\s*)?(\d+(?:[.,]\d{1,4})?)$/); return m ? Number(m[1].replace(',', '.')) : NaN; };

const RECHAZO = `
  const txt = (e) => (e?.innerText || e?.textContent || '').replace(/\\s+/g, ' ').trim();
  const t = performance.timeOrigin;
  const tabla = document.querySelector('#tblPreciosAutomotor');
  if (/^(?:error\\s*)?(?:401|403|429)\\b/.test((document.title || '').toLowerCase())) return { t, rechazo: 'rechazo_http' };
  if (!tabla && /(unauthorized|forbidden|too many requests|access denied|verify you are human|checking your browser|security check|challenge required|just a moment)/.test(txt(document.body).toLowerCase())) return { t, rechazo: 'desafio_o_rechazo' };
`;

const SONDA = (conDistritos) => `(() => {${RECHAZO}
  if (!${!!conDistritos}) return { t };
  const sel = document.querySelector('select[name=distrito]');
  return { t, distritos: sel ? Array.from(sel.options).map((o) => ({ nombre: txt(o), codigo: o.value })).filter((o) => /^\\d{6}$/.test(o.codigo)) : [] };
})()`;

const TABLA = `(() => {${RECHAZO}
  const visible = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length > 0; };
  if (!tabla || !visible(tabla)) return { t, estado: 'sin_tabla' };
  const cab = tabla.querySelector('thead tr:last-child') || tabla.querySelector('tr');
  const firma = JSON.stringify(Array.from(tabla.querySelectorAll('tbody tr')).slice(0, 3).map(txt));
  let nodos = Array.from(tabla.querySelectorAll('tbody tr')).filter(visible);
  let total = null;
  let completo = false;
  const jq = window.jQuery;
  if (jq?.fn?.dataTable?.isDataTable(tabla)) {
    const api = jq(tabla).DataTable();
    const info = api.page.info();
    total = info.recordsTotal;
    if (info.serverSide === false && Number.isInteger(total) && total <= ${MAX_FILAS}) {
      const todas = api.rows({ search: 'none' }).nodes().toArray();
      if (todas.length === total) { nodos = todas; completo = true; }
    }
  }
  return { t, estado: 'ok', total, completo, firma, cabeceras: cab ? Array.from(cab.children).map(txt) : [], filas: nodos.map((f) => Array.from(f.cells).map(txt)) };
})()`;

/**
 * Lee la tabla de una unidad, o dice por qué no se puede.
 *
 * Cero filas solo vale si la tabla cargada confirma explícitamente ese total:
 * una tabla vacía porque todavía no terminó de dibujarse diría que un distrito
 * entero dejó de vender.
 */
export function parseTabla(payload, distritoNombre, { conTexto = false } = {}) {
  if (payload?.rechazo) return { ok: false, razon: payload.rechazo };
  if (payload?.estado !== 'ok') return { ok: false, razon: payload?.estado ?? 'sin_respuesta' };
  const cab = (payload.cabeceras ?? []).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
  if (cab.length !== CABECERAS.length || cab.some((c, i) => c !== CABECERAS[i])) return { ok: false, razon: 'cabeceras_desconocidas' };
  const filas = [];
  for (const c of payload.filas ?? []) {
    if (!Array.isArray(c) || c.length !== CABECERAS.length) return { ok: false, razon: 'fila_con_forma_inesperada' };
    if (norm(c[0]) !== norm(distritoNombre)) return { ok: false, razon: 'distrito_no_coincide' };
    const p = precio(c[4]);
    if (!Number.isFinite(p) || p <= 0) return { ok: false, razon: 'precio_ilegible' };
    // c[3] es el teléfono: se valida por posición y no se emite nunca. El nombre
    // y la dirección se convierten en huella; solo una corrida de evidencia,
    // local y explícita, los conserva para poder revisar la muestra a ojo.
    filas.push({ key_hash: facilitoLinkKey(c[1], c[2], c[0]), precio: p, ...(conTexto ? { establecimiento: c[1], direccion: c[2] } : {}) });
  }
  if (payload.completo !== true) return { ok: false, razon: 'extraccion_incompleta' };
  if (Number.isInteger(payload.total) && payload.total !== filas.length) return { ok: false, razon: 'total_no_coincide' };
  return { ok: true, filas, total: payload.total, firma: payload.firma ?? '' };
}

/** El catálogo sale del propio select del sitio, no de una lista nuestra. */
export function resolverDistrito(distritos, consulta) {
  const q = norm(consulta);
  const exactos = distritos.filter((d) => norm(d.nombre) === q);
  if (exactos.length === 1) return { ok: true, distrito: exactos[0] };
  if (exactos.length > 1) return { ok: false, razon: 'distrito_ambiguo', candidatos: exactos.map((d) => d.nombre) };
  const cerca = distritos.filter((d) => q && (norm(d.nombre).includes(q) || q.includes(norm(d.nombre))));
  return { ok: false, razon: 'distrito_desconocido', candidatos: (cerca.length ? cerca : distritos).map((d) => d.nombre).slice(0, 12) };
}

export class Fallo extends Error {
  constructor(codigo, etapa, detalle = null) { super(codigo); this.codigo = codigo; this.etapa = etapa; this.detalle = detalle; }
  /** El sitio devuelve al buscador o corta la conexión de forma intermitente. */
  get reintentable() { return ['timeout_de_comando', 'comando_fallido', 'eval_ilegible', 'sin_tabla', 'sin_respuesta', 'distrito_no_coincide', 'cabeceras_desconocidas'].includes(this.codigo); }
  /** Un rechazo explícito no se reintenta ni con otro distrito: se para todo. */
  get bloqueo() { return ['rechazo_http', 'desafio_o_rechazo'].includes(this.codigo); }
}

/** Una sesión de navegador. Se inyecta para poder recorrer el flujo sin navegador. */
export function agentBrowserSession({ cwd, session }) {
  return (args, { ms = TIMEOUT_MS } = {}) => execFileSync('agent-browser', ['--session', session, ...args], {
    cwd, encoding: 'utf8', timeout: ms, maxBuffer: 8 * 1024 * 1024, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function controlador(ejecutar, restante) {
  const cmd = (args, etapa, { ms = TIMEOUT_MS, presupuesto = true } = {}) => {
    const queda = restante();
    if (presupuesto && queda <= 0) throw new Fallo('presupuesto_agotado', etapa);
    try { return ejecutar(args, { ms: presupuesto ? Math.min(ms, queda) : ms }); } catch (error) {
      const detalle = String(error?.stderr || error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Fallo(error?.killed || error?.code === 'ETIMEDOUT' ? 'timeout_de_comando' : 'comando_fallido', etapa, detalle || null);
    }
  };
  const evaluar = (script, etapa) => {
    const salida = cmd(['--json', 'eval', '-b', Buffer.from(script, 'utf8').toString('base64')], etapa).trim();
    try {
      const valor = JSON.parse(salida);
      if (valor?.data && Object.hasOwn(valor.data, 'result')) return valor.data.result;
      return valor && Object.hasOwn(valor, 'result') ? valor.result : valor;
    } catch { throw new Fallo('eval_ilegible', etapa); }
  };
  const sondear = (etapa, conDistritos = false) => {
    const r = evaluar(SONDA(conDistritos), etapa);
    if (r?.rechazo) throw new Fallo(r.rechazo, etapa);
    return r;
  };
  const aplicar = ({ selector, espera, valor, siguiente, previo, etapa, conDistritos }) => {
    cmd(['select', selector, valor], etapa);
    cmd(['wait', '--fn', `(() => { const s = document.querySelector(${JSON.stringify(espera ?? selector)}); return !!s && s.value === ${JSON.stringify(valor)} && !!document.getElementById('g-recaptcha-response')?.value && !!document.querySelector(${JSON.stringify(siguiente)}) && performance.timeOrigin !== ${Number(previo)}; })()`], etapa);
    return sondear(etapa, conDistritos);
  };
  return { cmd, evaluar, sondear, aplicar };
}

/**
 * Barre Lima provincia: cada distrito, los dos productos.
 *
 * @param {object} entrada
 * @param {(args: string[], opciones: object) => string} [entrada.ejecutar]  comando del navegador
 * @param {(linea: string) => void} [entrada.log]
 * @param {() => Date} [entrada.now]
 * @param {number} [entrada.budgetMs]  presupuesto total declarado de la corrida
 * @param {string[]|null} [entrada.soloDistritos]  para una corrida de comprobación
 * @param {boolean} [entrada.conTexto]  conserva razón social y dirección en las
 *   filas devueltas, SOLO para armar la muestra que se revisa a ojo. Nunca se
 *   persiste en el expediente ni se imprime.
 * @returns {{units: object[], districts: object[], blocked: object|null, elapsed_ms: number}}
 */
export function capturarLima({ ejecutar, log = () => {}, now = () => new Date(), budgetMs = RUN_BUDGET_MS, soloDistritos = null, conTexto = false } = {}) {
  const inicioMs = Date.now();
  const restante = () => budgetMs - (Date.now() - inicioMs);
  const units = [];
  let bloqueo = null;
  let catalogo = [];

  const control = controlador(ejecutar, restante);
  const cascadaHastaDistritos = () => {
    const { cmd, sondear, aplicar } = control;
    cmd(['open', FACILITO_URL], 'abrir', { ms: OPEN_TIMEOUT_MS });
    cmd(['wait', '--fn', "!!document.querySelector('select#departmento') && !!document.getElementById('g-recaptcha-response')?.value"], 'formulario');
    let t = sondear('formulario').t;
    t = aplicar({ selector: '#departmento', espera: '#departmento,select[name=departamentoAux]', valor: DEPARTAMENTO.codigo, siguiente: 'select[name=provincia]', previo: t, etapa: 'departamento' }).t;
    const provincia = aplicar({ selector: 'select[name=provincia]', valor: PROVINCIA.codigo, siguiente: 'select[name=distrito]', previo: t, etapa: 'provincia', conDistritos: true });
    return { t: provincia.t, catalogo: provincia.distritos ?? [] };
  };

  // Un distrito completo: seleccionar y leer sus dos tablas. Cada producto se
  // acepta o se rechaza por su cuenta; la cascada, en cambio, es de todo o nada,
  // porque si el sitio devolvió al buscador ya no sabemos qué estamos leyendo.
  const recorrerDistrito = (distrito, previo) => {
    const leidas = [];
    let t = control.aplicar({ selector: 'select[name=distrito]', valor: distrito.codigo, siguiente: 'select[name=producto]', previo, etapa: `distrito_${distrito.codigo}` }).t;
    let firma = '';
    for (const producto of PRODUCTOS) {
      const etapa = `${distrito.codigo}_${producto.codigo}`;
      try {
        control.cmd(['select', 'select[name=producto]', producto.codigo], etapa);
        control.cmd(['wait', '--fn', `(() => { const s = document.querySelector('select[name=producto]'); const tb = document.querySelector('#tblPreciosAutomotor');
          if (!s || s.value !== ${JSON.stringify(producto.codigo)} || !tb || !document.getElementById('g-recaptcha-response')?.value) return false;
          const proc = document.querySelector('#tblPreciosAutomotor_processing');
          if (proc && getComputedStyle(proc).display !== 'none') return false;
          const f = JSON.stringify(Array.from(tb.querySelectorAll('tbody tr')).slice(0, 3).map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()));
          return performance.timeOrigin !== ${Number(t)} || f !== ${JSON.stringify(firma)}; })()`], etapa);
        const observadoEn = now().toISOString();
        const leido = parseTabla(control.evaluar(TABLA, etapa), distrito.nombre, { conTexto });
        if (!leido.ok) throw new Fallo(leido.razon, etapa);
        firma = leido.firma;
        t = control.sondear(etapa).t;
        leidas.push({
          district_code: distrito.codigo, district_name: distrito.nombre, product: producto.key,
          status: 'ok', observed_at: observadoEn, announced_total: leido.total ?? leido.filas.length,
          rows: leido.filas.map(({ key_hash, precio, establecimiento, direccion }) => ({ key_hash, price: precio, ...(conTexto ? { establecimiento, direccion } : {}) })).filter((fila) => fila.key_hash),
          dropped_rows: leido.filas.filter((fila) => !fila.key_hash).length,
        });
      } catch (error) {
        const fallo = error instanceof Fallo ? error : new Fallo('fallo_inesperado', etapa, String(error?.message ?? '').slice(0, 200));
        leidas.push({ district_code: distrito.codigo, district_name: distrito.nombre, product: producto.key, status: fallo.codigo });
        // Un bloqueo o una cascada rota no se puede aislar por producto.
        if (fallo.bloqueo || fallo.reintentable) throw fallo;
      }
    }
    return { units: leidas, t };
  };

  // El sitio corta la navegación de vez en cuando —el piloto ya lo midió— y esa
  // caída llega como `comando_fallido` antes de tocar un solo distrito. Sin
  // reintento, un ERR_TIMED_OUT de un segundo tira la corrida de seis horas.
  const conReintentos = (paso, etiqueta) => {
    let ultimo = null;
    for (let intento = 1; intento <= INTENTOS_POR_DISTRITO; intento += 1) {
      if (restante() <= 0) throw ultimo ?? new Fallo('presupuesto_agotado', etiqueta);
      try { return paso(); } catch (error) {
        ultimo = error instanceof Fallo ? error : new Fallo('fallo_inesperado', etiqueta, String(error?.message ?? '').slice(0, 200));
        log(`${etiqueta}: intento ${intento}/${INTENTOS_POR_DISTRITO} falló (${ultimo.codigo}${ultimo.detalle ? `: ${ultimo.detalle}` : ''})`);
        if (ultimo.bloqueo || !ultimo.reintentable) throw ultimo;
      }
    }
    throw ultimo;
  };

  let t = 0;
  try {
    const inicial = conReintentos(cascadaHastaDistritos, 'cascada_inicial');
    t = inicial.t;
    catalogo = inicial.catalogo;
    const objetivo = soloDistritos
      ? soloDistritos.map((nombre) => resolverDistrito(catalogo, nombre)).filter((r) => r.ok).map((r) => r.distrito)
      : catalogo;
    log(`${catalogo.length} distritos en el select; se recorrerán ${objetivo.length}`);

    for (const distrito of objetivo) {
      if (restante() <= 0) { log('Presupuesto de corrida agotado; se conserva lo ya leído'); break; }
      let hecho = false;
      for (let intento = 1; intento <= INTENTOS_POR_DISTRITO && !hecho; intento += 1) {
        try {
          const resultado = recorrerDistrito(distrito, t);
          units.push(...resultado.units);
          t = resultado.t;
          hecho = true;
          log(`${distrito.nombre}: ${resultado.units.filter((u) => u.status === 'ok').length}/2 unidades`);
        } catch (error) {
          const fallo = error instanceof Fallo ? error : new Fallo('fallo_inesperado', 'distrito');
          if (fallo.bloqueo) { bloqueo = { codigo: fallo.codigo, etapa: fallo.etapa, distrito: distrito.nombre }; break; }
          log(`${distrito.nombre}: intento ${intento}/${INTENTOS_POR_DISTRITO} falló (${fallo.codigo}${fallo.detalle ? `: ${fallo.detalle}` : ''})`);
          if (intento === INTENTOS_POR_DISTRITO || !fallo.reintentable) {
            for (const producto of PRODUCTOS) units.push({ district_code: distrito.codigo, district_name: distrito.nombre, product: producto.key, status: fallo.codigo });
            break;
          }
          // Reabrir la cascada: tras un fallo no sabemos en qué página estamos.
          try { t = conReintentos(cascadaHastaDistritos, 'reapertura').t; } catch (otro) {
            const roto = otro instanceof Fallo ? otro : new Fallo('fallo_inesperado', 'reinicio');
            if (roto.bloqueo) { bloqueo = { codigo: roto.codigo, etapa: roto.etapa, distrito: distrito.nombre }; }
            break;
          }
        }
      }
      // Se detiene la adquisición entera: no se sigue golpeando el mismo muro.
      if (bloqueo) { log(`Adquisición detenida por ${bloqueo.codigo} en ${bloqueo.distrito}`); break; }
    }
  } catch (error) {
    const fallo = error instanceof Fallo ? error : new Fallo('fallo_inesperado', 'cascada', String(error?.message ?? '').slice(0, 200));
    bloqueo = fallo.bloqueo ? { codigo: fallo.codigo, etapa: fallo.etapa, distrito: null } : bloqueo;
    log(`Cascada inicial fallida: ${fallo.codigo} en ${fallo.etapa}${fallo.detalle ? ` (${fallo.detalle})` : ''}`);
  } finally {
    try { ejecutar(['close'], { ms: 5_000 }); } catch { /* la sesión se cierra sola al terminar */ }
  }

  return { units, districts: catalogo, blocked: bloqueo, elapsed_ms: Date.now() - inicioMs };
}
