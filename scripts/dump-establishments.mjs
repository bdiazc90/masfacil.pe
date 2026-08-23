#!/usr/bin/env node
// Diagnóstico local: vuelca los establecimientos del contrato vigente con
// razón social, dirección y coordenada oficial, para revisarlos a ojo.
//
// El pipeline de proyección carga razón social y dirección desde el raw, las
// usa solo como filtro y las descarta. Este script conserva esos campos.
//
// La salida contiene RUC, razón social y dirección: es privada y queda en
// .local-cache/ (ignorado por Git). No se publica ni se commitea.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGasolinaProjectionForPointer } from '../pipeline/project-gasolina.mjs';
import { csvRows } from '../pipeline/gasolina-products.mjs';
import { officialAnchorFromRegistration } from '../app/official-anchor.mjs';
import { resolveGasolinaRaw } from '../pipeline/project-gasolina.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clean = (value) => String(value ?? '').replace(/\r/g, '').trim();
const rawFields = ['ID3', 'ACTIVIDAD', 'REGISTRO_DE_HIDROCARBUROS', 'RUC', 'RAZON_SOCIAL', 'DEPARTAMENTO', 'PROVINCIA', 'DISTRITO', 'DIRECCION', 'FECHA_DE_REGISTRO', 'PRODUCTO', 'PRECIO_DE_VENTA_SOLES', 'UNIDAD'];

const limaTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return parts.replace('T', ' ');
};

const cell = (value) => {
  const text = String(value ?? '');
  return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

async function main() {
  const pointer = JSON.parse(fs.readFileSync(path.join(root, '.local-cache', 'snapshots', 'active.json'), 'utf8'));
  process.stdout.write(`Snapshot activo: ${pointer.snapshot_id}\nProyectando Regular y Premium...\n`);

  const candidate = await buildGasolinaProjectionForPointer({ root, pointer });

  // Unión por establecimiento: un lugar físico puede vender los dos productos.
  const byAnchor = new Map();
  for (const key of ['regular', 'premium']) {
    for (const offer of candidate.datasets[key].offers) {
      const current = byAnchor.get(offer.establishment_id) ?? {
        establishment_id: offer.establishment_id,
        distrito: offer.district,
        latitud: offer.latitude,
        longitud: offer.longitude,
      };
      current[`precio_${key}`] = offer.price;
      current[`fecha_${key}`] = limaTime(offer.reported_at);
      byAnchor.set(offer.establishment_id, current);
    }
  }
  process.stdout.write(`Unión de establecimientos: ${byAnchor.size}\n`);

  // El raw sí trae REGISTRO, RUC, razón social y dirección. Se recorre una vez
  // y se conserva la primera fila cuyo anchor pertenezca a la unión.
  const rawPath = resolveGasolinaRaw(root, pointer);
  process.stdout.write(`Leyendo raw (${(fs.statSync(rawPath).size / 1e9).toFixed(2)} GB), una pasada...\n`);

  let header;
  let pending = new Set(byAnchor.keys());
  for await (const row of csvRows(rawPath)) {
    if (!header) {
      header = row.map((value) => clean(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replaceAll(' ', '_').replace(/[^A-Z0-9_]/g, ''));
      if (JSON.stringify(header) !== JSON.stringify(rawFields)) throw new Error('Schema raw inesperado');
      continue;
    }
    if (!pending.size) break;
    const registro = clean(row[2]);
    if (!registro) continue;
    const anchor = officialAnchorFromRegistration(registro);
    if (!pending.has(anchor)) continue;
    const target = byAnchor.get(anchor);
    target.registro = registro;
    target.ruc = clean(row[3]);
    target.razon_social = clean(row[4]);
    target.direccion = clean(row[8]);
    pending.delete(anchor);
  }
  if (pending.size) process.stdout.write(`Aviso: ${pending.size} establecimientos sin fila en el raw\n`);

  const columns = ['establishment_id', 'registro', 'ruc', 'razon_social', 'direccion', 'distrito', 'latitud', 'longitud', 'precio_regular', 'fecha_regular', 'precio_premium', 'fecha_premium', 'mapa', 'street_view'];
  const rows = [...byAnchor.values()]
    .sort((a, b) => (a.distrito ?? '').localeCompare(b.distrito ?? '') || (a.razon_social ?? '').localeCompare(b.razon_social ?? ''))
    .map((item) => ({
      ...item,
      mapa: `https://www.google.com/maps/search/?api=1&query=${item.latitud},${item.longitud}`,
      street_view: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${item.latitud},${item.longitud}`,
    }));

  const body = `﻿${[columns.join(','), ...rows.map((row) => columns.map((key) => cell(row[key])).join(','))].join('\n')}\n`;
  const out = path.join(root, '.local-cache', 'identity', 'establecimientos.csv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body, { mode: 0o600 });

  const ambos = rows.filter((row) => row.precio_regular && row.precio_premium).length;
  const distritos = new Map();
  for (const row of rows) distritos.set(row.distrito, (distritos.get(row.distrito) ?? 0) + 1);
  const top = [...distritos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  process.stdout.write(`\n${'='.repeat(58)}\n`);
  process.stdout.write(`Establecimientos           ${rows.length}\n`);
  process.stdout.write(`Con Regular y Premium      ${ambos}\n`);
  process.stdout.write(`Solo un producto           ${rows.length - ambos}\n`);
  process.stdout.write(`Distritos                  ${distritos.size}\n`);
  process.stdout.write(`\nTop distritos: ${top.map(([name, count]) => `${name} ${count}`).join(' · ')}\n`);
  process.stdout.write(`\nArchivo: ${path.relative(root, out)} (${(body.length / 1024).toFixed(0)} KB, modo 0600)\n`);
  process.stdout.write(`PRIVADO: contiene RUC, razón social y dirección. No commitear.\n`);
  process.stdout.write(`${'='.repeat(58)}\n`);
}

main().catch((error) => { process.stderr.write(`Falló el volcado: ${error.message}\n`); process.exitCode = 1; });
