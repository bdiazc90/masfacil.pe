#!/usr/bin/env node
// Revisión ligera de BANDERA: una muestra por estrato de estaciones con marca,
// con botones, para que el owner conteste una sola pregunta —¿lleva esa marca en
// el letrero?— sin tocar JSON.
//
//   node scripts/brand-sample.mjs            genera la hoja
//   node scripts/brand-sample.mjs --serve    la sirve y guarda los veredictos
//
// Ya no se exigen 35 revisiones ni una cota mínima: marca y logo son la misma
// afirmación y se publican juntos. Esto MIDE y corrige lo que encuentre; un
// error aislado quita esa marca, no bloquea el catálogo.
//
// Cada regla de emparejamiento es un estrato y se muestrea por separado: el
// directorio con distrito, el que no lo declara con coordenada precisa, la
// aproximada y la inútil. MUESTRA fija el tamaño base (10); los estratos sin
// distrito, que son nuevos, piden el doble, y la coordenada inútil entra entera.
// Los choques —el nombre en Maps o la razón social dicen otra marca— entran
// siempre, como muestra de riesgo.
//
// Contiene razón social y dirección: privada, vive en .local-cache/ y no se
// commitea. Por eso se sirve en su propio puerto y no por el servidor público.
// `IDENTITY_ROOT` trabaja sobre una copia del expediente.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandAssetFor } from '../web/brand-logos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identidad = path.resolve(root, process.env.IDENTITY_ROOT || path.join('.local-cache', 'identity'));
const PUERTO = Number(process.env.PORT ?? 4176);
export const MUESTRA = Number(process.env.MUESTRA ?? 10);
const OBJETIVO = Object.freeze({
  distrito_declarado: MUESTRA,
  sin_distrito_coordenada_precisa: 2 * MUESTRA,
  sin_distrito_coordenada_aproximada: 2 * MUESTRA,
  sin_distrito_coordenada_inutil: Infinity,
});
const ETIQUETA = Object.freeze({
  distrito_declarado: 'Directorio con distrito',
  sin_distrito_coordenada_precisa: 'Directorio sin distrito · coordenada precisa',
  sin_distrito_coordenada_aproximada: 'Directorio sin distrito · coordenada aproximada (~1 km)',
  sin_distrito_coordenada_inutil: 'Directorio sin distrito · coordenada inútil (solo texto)',
  operador_del_registro: 'Nombre visible + razón social del operador',
  conservada_del_catalogo_base: 'Marca conservada del catálogo publicado',
});

const leer = (nombre, fallback = null) => (fs.existsSync(path.join(identidad, nombre)) ? JSON.parse(fs.readFileSync(path.join(identidad, nombre), 'utf8')) : fallback);
const escapar = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const sinTildes = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const misma = (a, b) => Boolean(a && b) && sinTildes(a) === sinTildes(b);

const catalogo = leer('commercial-identity-catalog.json');
if (!catalogo) throw new Error('Falta commercial-identity-catalog.json; ejecuta npm run build:catalog');
const archivoVeredictos = path.join(identidad, 'veredictos-marca.json');
const veredictosGuardados = leer('veredictos-marca.json', { entradas: [] }).entradas ?? [];
const evidencia = leer('brand-evidence.json', { entradas: {} }).entradas ?? {};
const detalle = new Map((leer('brand-evidence-detalle.json', { aceptadas: [] }).aceptadas ?? []).map((x) => [x.establishment_id, x]));
const nombreMaps = new Map((leer('matches.json', { resultados: [] }).resultados ?? []).map((x) => [x.establishment_id, x.nombre_maps]));

// El CSV privado aporta dirección, razón social y el Street View: es lo que
// convierte la revisión en observación y no en trámite.
const sitios = new Map();
if (fs.existsSync(path.join(identidad, 'establecimientos.csv'))) {
  const texto = fs.readFileSync(path.join(identidad, 'establecimientos.csv'), 'utf8').replace(/^﻿/, '');
  let campo = ''; let fila = []; let comillas = false; const filas = [];
  for (let index = 0; index < texto.length; index += 1) {
    const char = texto[index];
    if (comillas) { if (char === '"') { if (texto[index + 1] === '"') { campo += '"'; index += 1; } else comillas = false; } else campo += char; }
    else if (char === '"') comillas = true;
    else if (char === ',') { fila.push(campo); campo = ''; }
    else if (char === '\n') { fila.push(campo.replace(/\r$/, '')); filas.push(fila); fila = []; campo = ''; }
    else campo += char;
  }
  if (campo || fila.length) { fila.push(campo.replace(/\r$/, '')); filas.push(fila); }
  const cabecera = filas.shift();
  for (const f of filas) if (f.length === cabecera.length) { const row = Object.fromEntries(cabecera.map((k, i) => [k, f[i]])); sitios.set(row.establishment_id, row); }
}

/** Orden pseudoaleatorio pero estable: dos corridas dan la misma hoja. */
const orden = (id) => crypto.createHash('sha256').update(`muestra-marca|${id}`).digest('hex');

// El mismo criterio de estrato que imprime build-catalog.
const estratoDe = (entry) => {
  if (entry.estrato) return entry.estrato;
  if (!entry.brand_evidence) return 'operador_del_registro';
  const propia = evidencia[entry.establishment_id];
  return propia?.reference === entry.brand_evidence.reference ? (propia.estrato ?? 'distrito_declarado') : 'conservada_del_catalogo_base';
};
// Otra marca en el nombre de Maps o en la razón social: el caso que más cuesta.
const MARCAS = [['PRIMAX', 'Primax'], ['REPSOL', 'Repsol'], ['PECSA', 'Pecsa'], ['PETROPERU', 'Petroperú'], ['TERPEL', 'Terpel'], ['COESTI', 'Primax'], ['AVA', 'AVA']];
const otraMarca = (texto, brand) => MARCAS.find(([palabra, marca]) => new RegExp(`\\b${palabra}\\b`).test(sinTildes(texto)) && !misma(marca, brand))?.[1] ?? null;
const choqueDe = (entry) => {
  const sitio = sitios.get(entry.establishment_id) ?? {};
  const enMaps = otraMarca(nombreMaps.get(entry.establishment_id), entry.brand);
  const enRazon = otraMarca(sitio.razon_social, entry.brand);
  return enMaps ? `Maps dice ${enMaps}` : enRazon ? `razón social de ${enRazon}` : (entry.choque ?? null);
};

// Un veredicto habla de la marca que se revisó: con otra marca no vale.
const vigente = new Map(veredictosGuardados.map((x) => [x.id, x]));
// Un choque sin veredicto no se publica (build-catalog lo deja en conflicto),
// pero se revisa aquí con la marca que propuso el directorio: confirmado, entra
// en la próxima construcción.
const nombreDeSede = new Map(catalogo.entries.map((entry) => [entry.establishment_id, entry.public_site_name]));
// Lo mismo vale para un estrato que todavía no tiene muestra al azar.
const choquesPendientes = (leer('brand-conflicts.json', { conflictos: [] }).conflictos ?? [])
  .filter((conflicto) => ['choque_sin_revisar', 'estrato_sin_muestra'].includes(conflicto.motivo) && conflicto.propuesta)
  .map((conflicto) => ({ establishment_id: conflicto.establishment_id, brand: conflicto.propuesta.brand, public_site_name: nombreDeSede.get(conflicto.establishment_id) ?? null, brand_evidence: { reference: conflicto.propuesta.reference }, estrato: conflicto.propuesta.estrato ?? 'distrito_declarado', choque: conflicto.motivo === 'choque_sin_revisar' ? conflicto.marcas.join(' ≠ ') : null }));
const conMarca = [...catalogo.entries.filter((entry) => entry.brand && entry.publication.status === 'publishable' && entry.entity_link.status === 'verified'), ...choquesPendientes];
const revisado = (entry) => { const v = vigente.get(entry.establishment_id); return v && (!v.marca || misma(v.marca, entry.brand)) ? v : null; };

const muestra = [];
const porEstrato = new Map();
for (const entry of [...conMarca].sort((a, b) => orden(a.establishment_id).localeCompare(orden(b.establishment_id)))) {
  const estrato = estratoDe(entry);
  porEstrato.set(estrato, [...(porEstrato.get(estrato) ?? []), entry]);
}
const resumen = [];
for (const [estrato, entradas] of [...porEstrato.entries()].sort(([a], [b]) => Object.keys(ETIQUETA).indexOf(a) - Object.keys(ETIQUETA).indexOf(b))) {
  // Lo ya revisado encabeza y no se vuelve a sortear: un error observado no se
  // borra cambiando la muestra.
  const hechas = entradas.filter(revisado);
  const riesgo = entradas.filter((entry) => !revisado(entry) && choqueDe(entry));
  const objetivo = OBJETIVO[estrato] ?? 0;
  const azar = entradas.filter((entry) => !revisado(entry) && !choqueDe(entry)).slice(0, Math.max(0, Math.min(entradas.length, objetivo) - hechas.length));
  for (const entry of hechas) muestra.push({ entry, estrato, motivo: revisado(entry).motivo ?? 'random_sample' });
  for (const entry of riesgo) muestra.push({ entry, estrato, motivo: 'risk_sample' });
  for (const entry of azar) muestra.push({ entry, estrato, motivo: 'random_sample' });
  resumen.push({ estrato, poblacion: entradas.length, ya_revisadas: hechas.length, riesgo: riesgo.length, al_azar: azar.length });
}

function tarjeta({ entry, estrato, motivo }) {
  const sitio = sitios.get(entry.establishment_id) ?? {};
  const acreditacion = detalle.get(entry.establishment_id);
  const logo = brandAssetFor(entry);
  const [, , fichaNombre, fichaDireccion] = entry.brand_evidence?.reference.split(' · ') ?? [];
  const s = acreditacion?.señales;
  const señales = s ? [
    s.numero_de_puerta?.length ? `puerta ${s.numero_de_puerta.join(', ')}` : '',
    s.via?.length ? `vía ${s.via.join(' ')}` : '',
    s.manzana_lote?.length ? s.manzana_lote.join(' ') : '',
    s.localidad?.length ? `localidad ${s.localidad.join(' ')}` : '',
    s.nombre_en_razon_social?.length ? `nombre ≙ razón social (${s.nombre_en_razon_social.join(' ')})` : '',
    s.operador_de_la_marca ? 'operador de la cadena' : '',
    acreditacion.distancia_m !== null ? `${acreditacion.distancia_m} m` : 'sin coordenada útil',
  ].filter(Boolean).join(' · ') : '';
  const choque = choqueDe(entry);
  const v = revisado(entry);
  return `<article class="c" data-id="${escapar(entry.establishment_id)}" data-marca="${escapar(entry.brand)}" data-estrato="${escapar(estrato)}" data-motivo="${escapar(motivo)}"${v ? ` data-v="${escapar(v.r)}"` : ''}>
  <header><span class="e">${escapar(entry.brand)}</span><span>${escapar(sitio.distrito ?? '')}</span></header>
  <div class="id">${logo ? `<img src="/logo/${escapar(logo.asset.file)}" alt="" height="20">` : '<span class="sinlogo">sin logo</span>'}<h3>${escapar(entry.public_site_name ?? 'sin nombre de sede')}</h3></div>
  <p class="dir">${escapar(sitio.direccion ?? '—')}</p>
  <p class="ev"><small>Razón social</small> <i>${escapar(sitio.razon_social ?? '—')}</i></p>
  ${nombreMaps.get(entry.establishment_id) ? `<p class="ev"><small>Nombre en Maps</small> <i>${escapar(nombreMaps.get(entry.establishment_id))}</i></p>` : ''}
  <p class="ev"><small>${escapar(ETIQUETA[estrato] ?? estrato)}</small>${fichaNombre ? ` <i>${escapar(fichaNombre)} · ${escapar(fichaDireccion)}</i>` : ''}${señales ? `<br>${escapar(señales)}` : ''}</p>
  ${choque ? `<p class="riesgo">Choque: ${escapar(choque)}</p>` : ''}
  <div class="acc">
    <button class="b b--si" data-v="verified" aria-pressed="false">Sí es ${escapar(entry.brand)}</button>
    <button class="b b--no" data-v="incorrect" aria-pressed="false">No lo es</button>
    <button class="b b--duda" data-v="pending" aria-pressed="false">En duda</button>
    ${sitio.street_view ? `<a class="b" href="${escapar(sitio.street_view)}" target="_blank" rel="noopener">Street View</a>` : ''}
  </div>
</article>`;
}

const clave = `veredictos-marca|${catalogo.catalog_id}`;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Revisión de bandera</title>
<style>
:root{color-scheme:light dark;--bg:#faf9f7;--fg:#1b1b1a;--mut:#6b6b68;--bd:#dedcd7;--card:#fff;--ok:#0f6b46;--no:#a3231f;--warn:#8a5a00}
@media(prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#f0efec;--mut:#a3a2a0;--bd:#33333a;--card:#1f1f25;--warn:#e0a84a}}
*{box-sizing:border-box}body{margin:0;padding:14px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,sans-serif}
h1{margin:0 0 4px;font-size:19px}h2{margin:22px 0 8px;font-size:15px;color:var(--mut)}.sub{margin:0 0 14px;color:var(--mut);font-size:13.5px}
.bar{position:sticky;top:0;z-index:9;margin:0 -14px 14px;padding:10px 14px;background:var(--bg);border-bottom:1px solid var(--bd);display:flex;gap:10px;align-items:center}
.bar b{font-size:17px}.bar span{color:var(--mut);font-size:13.5px}#estado{margin-left:auto;font-size:13px}
.c{margin:0 0 12px;padding:14px;background:var(--card);border:1px solid var(--bd);border-radius:14px}
.c[data-done]{opacity:.45}
header{display:flex;justify-content:space-between;margin-bottom:10px;font-size:12px;color:var(--mut)}
.e{padding:2px 8px;border-radius:99px;border:1px solid var(--bd);font-weight:700;color:var(--fg)}
.id{display:flex;align-items:center;gap:10px;margin-bottom:2px}
.id img{background:#fff;padding:3px 5px;border-radius:5px;box-shadow:0 0 0 1px rgba(128,128,128,.25)}
.id h3{margin:0;font-size:16px}.sinlogo{color:var(--mut);font-size:12px;border:1px dashed var(--bd);padding:2px 6px;border-radius:5px}
.dir{margin:0 0 8px;font-size:14px}
.ev{margin:0 0 4px;font-size:12.5px;color:var(--mut)}.ev i{font-style:normal;color:var(--fg)}
.ev small{text-transform:uppercase;letter-spacing:.05em;font-size:11px}
.riesgo{margin:6px 0 0;font-size:12.5px;font-weight:700;color:var(--warn)}
.acc{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:12px}
@media(min-width:560px){.acc{grid-template-columns:repeat(4,1fr)}}
.b{min-height:46px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bd);border-radius:99px;background:transparent;color:var(--fg);font:inherit;font-weight:700;font-size:14px;text-decoration:none;cursor:pointer;text-align:center}
.b--si{border-color:var(--ok);color:var(--ok)}.b--no{border-color:var(--no);color:var(--no)}.b--duda{border-color:var(--mut);color:var(--mut)}
.b[aria-pressed=true]{color:#fff}.b--si[aria-pressed=true]{background:var(--ok)}.b--no[aria-pressed=true]{background:var(--no)}.b--duda[aria-pressed=true]{background:var(--mut)}
</style></head><body>
<h1>¿Esta estación lleva esa marca?</h1>
<p class="sub">Muestra por estrato de ${muestra.length} de ${conMarca.length} estaciones con marca. La pregunta es solo por la <b>bandera del letrero</b>, no por el nombre de sede. Se guarda solo al pulsar; no hay que copiar nada.</p>
<div class="bar"><b id="prog">0/${muestra.length}</b> <span id="res"></span><span id="estado"></span></div>
${[...new Set(muestra.map((item) => item.estrato))].map((estrato) => `<h2>${escapar(ETIQUETA[estrato] ?? estrato)}</h2>${muestra.filter((item) => item.estrato === estrato).map(tarjeta).join('')}`).join('')}
<script>
const K=${JSON.stringify(clave)};
const v={};
// Lo guardado en el expediente manda; el navegador solo recuerda lo de esta hoja.
for(const c of document.querySelectorAll('.c[data-v]')) v[c.dataset.id]=c.dataset.v;
try{Object.assign(v,JSON.parse(localStorage.getItem(K)||'{}'))}catch{}
const estado=document.getElementById('estado');
const pintar=()=>{
  for(const c of document.querySelectorAll('.c')){
    const val=v[c.dataset.id];
    c.toggleAttribute('data-done', Boolean(val));
    for(const b of c.querySelectorAll('[data-v]')) b.setAttribute('aria-pressed', String(b.dataset.v===val));
  }
  const n=Object.keys(v).length;
  const ok=Object.values(v).filter(x=>x==='verified').length;
  const no=Object.values(v).filter(x=>x==='incorrect').length;
  const du=Object.values(v).filter(x=>x==='pending').length;
  document.getElementById('prog').textContent=n+'/${muestra.length}';
  document.getElementById('res').textContent=n?'· '+ok+' sí, '+no+' no'+(du?', '+du+' en duda':''):'';
};
async function guardar(){
  const entradas=[...document.querySelectorAll('.c')].filter(c=>v[c.dataset.id]).map(c=>({id:c.dataset.id,r:v[c.dataset.id],marca:c.dataset.marca,estrato:c.dataset.estrato,motivo:c.dataset.motivo}));
  estado.textContent='guardando…';
  try{
    const r=await fetch('/guardar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({entradas})});
    estado.textContent=r.ok?'guardado ✓':'no se pudo guardar';
  }catch{ estado.textContent='no se pudo guardar'; }
}
document.addEventListener('click',(e)=>{
  const b=e.target.closest('button[data-v]'); if(!b) return;
  const c=b.closest('.c'); v[c.dataset.id]=v[c.dataset.id]===b.dataset.v?undefined:b.dataset.v;
  if(!v[c.dataset.id]) delete v[c.dataset.id];
  try{localStorage.setItem(K,JSON.stringify(v))}catch{}
  pintar(); guardar();
  if(v[c.dataset.id]) c.nextElementSibling?.scrollIntoView({behavior:'smooth',block:'center'});
});
pintar();
</script></body></html>`;

const destino = path.join(identidad, 'brand-sample.html');
fs.writeFileSync(destino, html, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ hoja: path.relative(root, destino), catalogo: catalogo.catalog_id, muestra: muestra.length, poblacion: conMarca.length, estratos: resumen }, null, 2)}\n`);

if (process.argv.includes('--serve')) {
  const http = await import('node:http');
  const enHoja = new Set(muestra.map((item) => item.entry.establishment_id));
  const servidor = http.createServer((peticion, respuesta) => {
    if (peticion.method === 'POST' && peticion.url === '/guardar') {
      let cuerpo = '';
      peticion.on('data', (trozo) => { cuerpo += trozo; if (cuerpo.length > 400_000) peticion.destroy(); });
      peticion.on('end', () => {
        try {
          const { entradas } = JSON.parse(cuerpo);
          if (!Array.isArray(entradas)) throw new Error('entradas inválidas');
          for (const item of entradas) {
            if (!enHoja.has(item?.id) || !['verified', 'incorrect', 'pending'].includes(item?.r)) throw new Error('veredicto inválido');
            if (!['random_sample', 'risk_sample'].includes(item?.motivo)) throw new Error('motivo inválido');
          }
          // Se reemplaza solo lo que está en esta hoja: un veredicto anterior sobre
          // una estación que ya no aparece no se pierde por guardar otra muestra.
          const previos = (fs.existsSync(archivoVeredictos) ? JSON.parse(fs.readFileSync(archivoVeredictos, 'utf8')).entradas ?? [] : []).filter((item) => !enHoja.has(item.id));
          fs.writeFileSync(archivoVeredictos, `${JSON.stringify({ revisado_en: new Date().toISOString(), catalogo: catalogo.catalog_id, entradas: [...previos, ...entradas] }, null, 2)}\n`, { mode: 0o600 });
          process.stdout.write(`  ${entradas.length} veredicto(s) de esta hoja guardados (${previos.length} anteriores conservados) en ${path.relative(root, archivoVeredictos)}\n`);
          respuesta.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        } catch (error) { respuesta.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message })); }
      });
      return;
    }
    if (peticion.method !== 'GET') { respuesta.writeHead(405).end(); return; }
    const logo = peticion.url.match(/^\/logo\/([a-z0-9][a-z0-9-]*\.svg)$/);
    if (logo) {
      const archivoLogo = path.join(root, 'web', 'icons', 'brands', logo[1]);
      if (!fs.existsSync(archivoLogo)) { respuesta.writeHead(404).end(); return; }
      respuesta.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      respuesta.end(fs.readFileSync(archivoLogo));
      return;
    }
    if (!['/', '/index.html'].includes(peticion.url)) { respuesta.writeHead(404).end('No encontrado'); return; }
    respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    respuesta.end(fs.readFileSync(destino));
  });
  servidor.listen(PUERTO, '127.0.0.1', () => process.stdout.write(`\nRevisión de bandera en http://127.0.0.1:${PUERTO}  ·  Ctrl+C para cerrar\n`));
}
