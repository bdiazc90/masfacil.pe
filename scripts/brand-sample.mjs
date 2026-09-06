#!/usr/bin/env node
// Hoja de revisión de BANDERA para el owner: una muestra aleatoria por método de
// acreditación —directorio o letrero—, con lo necesario para decidir si la
// estación lleva de verdad esa marca.
//
//   node scripts/brand-sample.mjs
//
// Con cero errores hacen falta 35 revisiones por grupo para que la cota inferior
// de Wilson al 95 % llegue a 90 %; un grupo menor se revisa entero. La muestra es
// determinista: dos corridas dan la misma hoja, así que una revisión a medias se
// retoma sin perder lo hecho, y los veredictos ya emitidos nunca salen de ella.
//
// Contiene dirección y razón social: privada, vive en .local-cache/ y no se
// commitea. Su salida alimenta veredictos-marca.json.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_MIN_SAMPLE } from '../app/commercial-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identidad = path.join(root, '.local-cache', 'identity');
const leer = (nombre, fallback = null) => (fs.existsSync(path.join(identidad, nombre)) ? JSON.parse(fs.readFileSync(path.join(identidad, nombre), 'utf8')) : fallback);
const escapar = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const catalogo = leer('commercial-identity-catalog.json');
if (!catalogo) throw new Error('Falta commercial-identity-catalog.json; ejecuta npm run build:catalog');
const yaRevisados = new Map((leer('veredictos-marca.json', { entradas: [] }).entradas ?? []).map((x) => [x.id, x.r]));
const detalle = new Map((leer('brand-evidence-detalle.json', { aceptadas: [] }).aceptadas ?? []).map((x) => [x.establishment_id, x]));

// El CSV privado aporta la dirección del Registro y el Street View para mirar el
// letrero: es lo que convierte la revisión en observación y no en tramite.
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

// Orden pseudoaleatorio pero estable: depende solo del identificador.
const orden = (id) => crypto.createHash('sha256').update(`muestra-marca|${id}`).digest('hex');

const acreditadas = catalogo.entries.filter((entry) => entry.brand && entry.brand_evidence && entry.publication.status === 'publishable' && entry.entity_link.status === 'verified');
const metodos = [...new Set(acreditadas.map((entry) => entry.brand_evidence.method))];
const grupos = metodos.map((method) => {
  const poblacion = acreditadas.filter((entry) => entry.brand_evidence.method === method);
  const objetivo = Math.min(BRAND_MIN_SAMPLE, poblacion.length);
  const ordenadas = [...poblacion].sort((a, b) => orden(a.establishment_id).localeCompare(orden(b.establishment_id)));
  // Lo ya revisado se conserva y encabeza: un error observado no se borra
  // volviendo a sortear.
  const revisadas = ordenadas.filter((entry) => yaRevisados.has(entry.establishment_id));
  const resto = ordenadas.filter((entry) => !yaRevisados.has(entry.establishment_id));
  const muestra = [...revisadas, ...resto].slice(0, Math.max(objetivo, revisadas.length));
  return { method, poblacion: poblacion.length, objetivo, muestra };
});

const fila = (entry) => {
  const sitio = sitios.get(entry.establishment_id);
  const evidencia = detalle.get(entry.establishment_id);
  const señales = evidencia ? `puerta ${evidencia.señales.numero_de_puerta.join(', ') || '—'} · vía ${evidencia.señales.via.join(', ') || '—'} · ${evidencia.distancia_m} m` : '—';
  return `<tr data-id="${escapar(entry.establishment_id)}">
    <td><b>${escapar(entry.brand)}</b><br><span class="tenue">${escapar(entry.public_site_name ?? 'sin nombre de sede')}</span></td>
    <td>${escapar(sitio?.direccion ?? '—')}<br><span class="tenue">${escapar(sitio?.distrito ?? '')} · ${escapar(sitio?.razon_social ?? '')}</span></td>
    <td class="tenue">${escapar(entry.brand_evidence.reference)}<br>${escapar(señales)}</td>
    <td>${sitio?.street_view ? `<a href="${escapar(sitio.street_view)}" target="_blank" rel="noopener">Street View</a>` : ''}${sitio?.mapa ? ` · <a href="${escapar(sitio.mapa)}" target="_blank" rel="noopener">Mapa</a>` : ''}</td>
    <td class="veredicto">${escapar(yaRevisados.get(entry.establishment_id) ?? 'pendiente')}</td>
  </tr>`;
};

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Revisión de bandera</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:24px;max-width:1200px}h1{font-size:22px}h2{font-size:17px;margin-top:28px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}
.tenue{color:#666;font-size:13px}.veredicto{white-space:nowrap}code{background:#f4f4f4;padding:2px 4px}</style></head><body>
<h1>Revisión de bandera · ${escapar(catalogo.catalog_id)}</h1>
<p>La pregunta es una sola: <b>¿esta estación lleva hoy esa marca en su letrero?</b> No se pregunta por el nombre de sede, que ya se auditó aparte.</p>
<p>Con cero errores hacen falta ${BRAND_MIN_SAMPLE} revisiones por grupo para que la cota inferior de Wilson al 95 % llegue al 90 %. Un grupo más pequeño se revisa entero.</p>
${grupos.map((grupo) => `<h2>${escapar(grupo.method)} · muestra ${grupo.muestra.length} de ${grupo.poblacion}</h2>
<table><thead><tr><th>Marca y sede</th><th>Dirección del Registro</th><th>Evidencia y corroboración</th><th>Mirar</th><th>Veredicto</th></tr></thead>
<tbody>${grupo.muestra.map(fila).join('')}</tbody></table>`).join('')}
<h2>Cómo devolver los veredictos</h2>
<p>Escribe <code>.local-cache/identity/veredictos-marca.json</code> con <code>{"entradas":[{"id":"est_…","r":"verified"|"incorrect"}]}</code> y vuelve a correr <code>npm run build:catalog</code>.</p>
</body></html>`;

const salida = path.join(identidad, 'brand-sample.html');
fs.writeFileSync(salida, html, { mode: 0o600 });
const plantilla = path.join(identidad, 'veredictos-marca.plantilla.json');
fs.writeFileSync(plantilla, `${JSON.stringify({ entradas: grupos.flatMap((grupo) => grupo.muestra.map((entry) => ({ id: entry.establishment_id, r: yaRevisados.get(entry.establishment_id) ?? 'pending', marca: entry.brand }))) }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ hoja: path.relative(root, salida), plantilla: path.relative(root, plantilla), grupos: grupos.map((g) => ({ method: g.method, poblacion: g.poblacion, muestra: g.muestra.length, revisados: g.muestra.filter((e) => yaRevisados.has(e.establishment_id)).length })) }, null, 2)}\n`);
