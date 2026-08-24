#!/usr/bin/env node
// Genera la hoja de auditoría: una página local donde el owner revisa una
// muestra de emparejamientos y marca correcto o incorrecto.
//
// La muestra es estratificada a propósito. Auditar los 378 no aporta más que
// auditar 40 bien elegidos: lo que se busca no es corregir uno por uno, sino
// MEDIR la precisión del tier para decidir si se publica entero.
//
// Contiene razón social y dirección: privada, vive en .local-cache/ y no se
// commitea. La salida de la revisión alimenta commercial-identity-audit.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODOS = process.argv.includes('--todos');
// En modo candidatos la pregunta es otra: no si el sitio es el mismo —casi
// siempre lo es— sino si la ficha es el NOMBRE DEL GRIFO o el de otro negocio
// dentro del predio: la tienda, el lavado, el módulo de GNV.
const CANDIDATOS = process.argv.includes('--candidatos');
const TAMANO = Number(process.env.MUESTRA ?? (CANDIDATOS ? 20 : 40));

const matches = JSON.parse(fs.readFileSync(path.join(root, '.local-cache', 'identity', 'matches.json'), 'utf8'));
const porEstado = (estado) => matches.resultados.filter((r) => r.estado === estado);

// Muestreo determinista: sin Math.random, para que dos corridas den la misma
// hoja y una auditoría a medias se pueda retomar.
const repartir = (lista, cuantos) => {
  if (lista.length <= cuantos) return [...lista];
  const paso = lista.length / cuantos;
  return Array.from({ length: cuantos }, (_, i) => lista[Math.floor(i * paso)]);
};

const verified = porEstado('verified');
const conflict = porEstado('conflict');
const ajustados = [...verified].sort((a, b) => (a.margen_m ?? 1e9) - (b.margen_m ?? 1e9)).slice(0, 40);

const muestra = CANDIDATOS
  ? repartir(porEstado('candidate'), TAMANO).map((r) => ({ ...r, motivo: 'risk_sample' }))
  : TODOS ? matches.resultados.filter((r) => r.estado !== 'unmatched') : [
    ...repartir(verified, Math.round(TAMANO * 0.62)).map((r) => ({ ...r, motivo: 'random_sample' })),
    ...repartir(conflict, Math.round(TAMANO * 0.25)).map((r) => ({ ...r, motivo: 'risk_sample' })),
    ...repartir(ajustados, Math.round(TAMANO * 0.13)).map((r) => ({ ...r, motivo: 'risk_sample' })),
  ];
const unicos = [...new Map(muestra.map((r) => [r.establishment_id, r])).values()];

// Para juzgar una ficha dudosa hace falta ver lo que Google dice de ella tal
// cual: la categoría revela si es la tienda, el lavado o el grifo.
const infoPorLugar = new Map();
if (CANDIDATOS) {
  const ndjson = fs.readdirSync(path.join(root, '.local-cache', 'identity', 'harvest'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => path.join(root, '.local-cache', 'identity', 'harvest', e.name, 'raw.ndjson'))
    .filter((p) => fs.existsSync(p)).sort().pop();
  if (ndjson) for (const linea of fs.readFileSync(ndjson, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    for (const lugar of JSON.parse(linea).places ?? []) if (lugar.id && !infoPorLugar.has(lugar.id)) infoPorLugar.set(lugar.id, lugar.info ?? []);
  }
}

const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const lugarUrl = (r) => (/^ChIJ/.test(r.place_id)
  ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}&query_place_id=${encodeURIComponent(r.place_id)}`
  : `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`);

const tarjeta = (r, i) => `
<article class="c" data-id="${esc(r.establishment_id)}" data-motivo="${esc(r.motivo ?? 'publishable_candidate')}" data-estado="${esc(r.estado)}">
  <header><span class="n">${i + 1}/${unicos.length}</span><span class="e e--${esc(r.estado)}">${esc(r.estado)}</span></header>
  <div class="par">
    <div><h3>${esc(r.nombre_maps)}</h3><p>${esc(r.direccion_maps || '—')}</p><small>Google Maps</small></div>
    <div><h3>${esc(r.razon_social)}</h3><p>${esc(r.direccion_registro)}</p><small>Registro oficial · ${esc(r.distrito)}</small></div>
  </div>
  <p class="ev"><b>${r.distancia_m} m</b> · margen ${r.margen_m === null ? 'sin rival' : `${r.margen_m} m`} · ${r.señales.map((s) => `${esc(s.tipo)} <i>${esc(s.valor)}</i>`).join(' + ') || 'sin señales'}</p>
  ${r.fichas_rivales.length ? `<p class="riv">Otras fichas aquí: ${r.fichas_rivales.map((x) => `${esc(x.nombre_maps)} (${x.distancia_m} m)`).join(' · ')}</p>` : ''}
  ${CANDIDATOS && infoPorLugar.has(r.place_id) ? `<p class="raw">Google dice: ${infoPorLugar.get(r.place_id).filter(Boolean).map((t) => esc(t)).join(' · ')}</p>` : ''}
  <div class="acc">
    <a class="b b--g" href="${esc(lugarUrl(r))}" target="_blank" rel="noopener noreferrer">Ver en Maps</a>
    <button class="b b--duda" data-v="pending" type="button">? No sé</button>
    <button class="b b--no" data-v="incorrect" type="button">${CANDIDATOS ? '✗ Otro negocio' : '✗ Otro sitio'}</button>
    <button class="b b--si" data-v="verified" type="button">${CANDIDATOS ? '✓ Es el grifo' : '✓ Correcto'}</button>
  </div>
</article>`;

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${CANDIDATOS ? 'Auditoría de candidatos' : 'Auditoría de identidad comercial'}</title>
<style>
:root{color-scheme:light dark;--bg:#faf9f7;--fg:#1b1b1a;--mut:#6b6b68;--bd:#dedcd7;--card:#fff;--ok:#0f6b46;--no:#a3231f}
@media(prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#f0efec;--mut:#a3a2a0;--bd:#33333a;--card:#1f1f25}}
*{box-sizing:border-box}body{margin:0;padding:14px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,sans-serif}
h1{margin:0 0 4px;font-size:19px}.sub{margin:0 0 14px;color:var(--mut);font-size:13.5px}
.bar{position:sticky;top:0;z-index:9;margin:0 -14px 14px;padding:10px 14px;background:var(--bg);border-bottom:1px solid var(--bd)}
.bar b{font-size:17px}#exp{float:right}
.c{margin:0 0 12px;padding:14px;background:var(--card);border:1px solid var(--bd);border-radius:14px}
.c[data-done]{opacity:.42}
header{display:flex;justify-content:space-between;margin-bottom:10px;font-size:12px;color:var(--mut)}
.e{padding:2px 8px;border-radius:99px;border:1px solid var(--bd);font-weight:700}
.e--conflict{color:#8a5a00;border-color:#8a5a00}
.par{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:520px){.par{grid-template-columns:1fr;gap:8px}.acc{grid-template-columns:1fr 1fr}}
.par h3{margin:0 0 2px;font-size:15px}.par p{margin:0;font-size:13.5px;color:var(--fg)}
.par small{color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em}
.ev{margin:10px 0 0;font-size:13px;color:var(--mut)}.ev i{font-style:normal;color:var(--fg)}
.riv{margin:4px 0 0;font-size:12.5px;color:#8a5a00}
.raw{margin:6px 0 0;padding:6px 9px;border-radius:8px;background:rgba(128,128,128,.12);font-size:12.5px;color:var(--fg)}
.acc{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}
.b{min-height:46px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bd);border-radius:99px;background:transparent;color:var(--fg);font:inherit;font-weight:700;font-size:14px;text-decoration:none;cursor:pointer}
.b--si{border-color:var(--ok);color:var(--ok)}.b--no{border-color:var(--no);color:var(--no)}.b--duda{border-color:var(--mut);color:var(--mut)}
.b[aria-pressed=true]{color:#fff}.b--si[aria-pressed=true]{background:var(--ok)}.b--no[aria-pressed=true]{background:var(--no)}.b--duda[aria-pressed=true]{background:var(--mut)}
#out{width:100%;height:150px;margin-top:8px;font:12px ui-monospace,monospace}
</style></head><body>
<h1>${CANDIDATOS ? 'Candidatos: ¿es el nombre del grifo?' : 'Auditoría de identidad comercial'}</h1>
<p class="sub">${CANDIDATOS ? `Muestra de ${unicos.length} de ${porEstado('candidate').length} candidatos. Estos están en el sitio correcto pero sin evidencia de que la ficha sea <b>el grifo</b> y no la tienda, el lavado o el módulo de GNV de adentro. Mira la ficha en Maps y decide.` : `Muestra de ${unicos.length} de ${matches.resultados.filter((r) => r.estado !== 'unmatched').length} emparejamientos. Marca cada uno mirando la ficha en Maps. No corriges: mides.`}</p>
<div class="bar"><b id="prog">0/${unicos.length}</b> <span id="res"></span><button class="b" id="exp" style="width:auto;padding:0 16px;min-height:36px">Exportar</button></div>
${unicos.map(tarjeta).join('')}
<textarea id="out" hidden readonly placeholder="Aquí sale el JSON al pulsar Exportar"></textarea>
<script>
const K='${CANDIDATOS ? 'auditoria-candidatos' : 'auditoria-identidad'}';
const v=JSON.parse(localStorage.getItem(K)||'{}');
const pintar=()=>{
  for(const c of document.querySelectorAll('.c')){
    const val=v[c.dataset.id];
    c.toggleAttribute('data-done', Boolean(val));
    for(const b of c.querySelectorAll('[data-v]')) b.setAttribute('aria-pressed', String(b.dataset.v===val));
  }
  const n=Object.keys(v).length, ok=Object.values(v).filter(x=>x==='verified').length, du=Object.values(v).filter(x=>x==='pending').length;
  document.getElementById('prog').textContent=n+'/'+${unicos.length};
  document.getElementById('res').textContent=n?'· '+ok+' ok, '+(n-ok-du)+' otro sitio'+(du?', '+du+' en duda':''):'';
};
document.addEventListener('click',(e)=>{
  const b=e.target.closest('[data-v]'); if(!b) return;
  const c=b.closest('.c'); v[c.dataset.id]=v[c.dataset.id]===b.dataset.v?undefined:b.dataset.v;
  if(!v[c.dataset.id]) delete v[c.dataset.id];
  localStorage.setItem(K,JSON.stringify(v)); pintar();
  if(v[c.dataset.id]) c.nextElementSibling?.scrollIntoView({behavior:'smooth',block:'center'});
});
document.getElementById('exp').addEventListener('click',async()=>{
  const filas=[...document.querySelectorAll('.c')].filter(c=>v[c.dataset.id]).map(c=>({establishment_id:c.dataset.id,selection_reason:c.dataset.motivo,estado_algoritmo:c.dataset.estado,result:v[c.dataset.id]}));
  const texto=JSON.stringify({revisado_en:new Date().toISOString(),entradas:filas},null,2);
  const out=document.getElementById('out');
  out.hidden=false; out.value=texto;
  // El textarea vivía al final de la página, debajo de las 40 tarjetas: se
  // llenaba fuera de la vista y parecía que el botón no hacía nada.
  out.scrollIntoView({behavior:'smooth',block:'center'});
  out.focus(); out.select();
  const boton=document.getElementById('exp'); const antes=boton.textContent;
  try{ await navigator.clipboard.writeText(texto); boton.textContent='¡Copiado!'; }
  catch{ boton.textContent='Selecciona y copia ↓'; }
  setTimeout(()=>{boton.textContent=antes;},2500);
});
pintar();
</script></body></html>`;

const destino = path.join(root, '.local-cache', 'identity', CANDIDATOS ? 'audit-sheet-candidatos.html' : 'audit-sheet.html');
fs.writeFileSync(destino, html, { mode: 0o600 });

const cuenta = (estado) => unicos.filter((r) => r.estado === estado).length;
process.stdout.write(`Muestra          ${unicos.length} de ${matches.resultados.filter((r) => r.estado !== 'unmatched').length}
  verified       ${cuenta('verified')}   mide la precisión del tier publicable
  conflict       ${cuenta('conflict')}   confirma que el sistema acierta al negarse
  candidate      ${cuenta('candidate')}

Archivo: ${path.relative(root, destino)} (privado, 0600)
`);

// Servidor propio en otro puerto: la hoja lleva razón social y dirección, así
// que no puede salir por el mismo servidor que sirve el sitio público. Además
// localStorage —donde se guarda el avance— no funciona sobre file:// en Chrome.
if (process.argv.includes('--serve')) {
  const http = await import('node:http');
  const cuerpo = fs.readFileSync(destino);
  const servidor = http.createServer((peticion, respuesta) => {
    if (peticion.method !== 'GET' || !['/', '/index.html'].includes(peticion.url)) { respuesta.writeHead(404).end('No encontrado'); return; }
    respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
    respuesta.end(cuerpo);
  });
  servidor.listen(CANDIDATOS ? 4175 : 4174, '127.0.0.1', () => process.stdout.write(`\nHoja de auditoría en http://127.0.0.1:${CANDIDATOS ? 4175 : 4174}  ·  Ctrl+C para cerrar\n`));
}
