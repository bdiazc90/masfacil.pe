#!/usr/bin/env node
// Calcula los centros de búsqueda mínimos que cubren todos los establecimientos
// del contrato vigente, para que el barrido de Google Maps no gaste cargas en
// zonas sin grifos.
//
// Requiere haber corrido antes `npm run dump:establishments`.
// La cosecha corre unas dos veces al año: no hay refresco incremental.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const radioMetros = Number(process.env.RADIO ?? 1000);
const zoom = process.env.ZOOM ?? '16z';
const terminos = (process.env.TERMINOS ?? 'grifo,gasolinera,estacion de servicio').split(',').map((t) => t.trim()).filter(Boolean);

const R = 6371000;
const rad = (grados) => grados * Math.PI / 180;
function distancia(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function leerCsv(file) {
  const partir = (linea) => {
    const campos = []; let valor = ''; let comilla = false;
    for (let i = 0; i < linea.length; i += 1) {
      const c = linea[i];
      if (comilla) { if (c === '"') { if (linea[i + 1] === '"') { valor += '"'; i += 1; } else comilla = false; } else valor += c; }
      else if (c === '"') comilla = true;
      else if (c === ',') { campos.push(valor); valor = ''; }
      else valor += c;
    }
    campos.push(valor); return campos;
  };
  const lineas = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split('\n');
  const cabecera = partir(lineas[0]);
  return lineas.slice(1).map(partir).map((fila) => Object.fromEntries(cabecera.map((k, i) => [k, fila[i]])));
}

// Cobertura golosa: en cada vuelta elige el establecimiento que cubre a más
// vecinos sin cubrir y lo usa como centro. No busca el óptimo global —el
// problema es NP— pero queda muy cerca y es reproducible.
function calcularCentros(puntos, radio) {
  const centros = [];
  let pendientes = [...puntos.keys()];
  while (pendientes.length) {
    let mejor = null; let mejorCubiertos = null;
    for (const i of pendientes) {
      const cubiertos = pendientes.filter((j) => distancia(puntos[i], puntos[j]) <= radio);
      if (!mejorCubiertos || cubiertos.length > mejorCubiertos.length) { mejor = i; mejorCubiertos = cubiertos; }
    }
    centros.push({ indice: mejor, cubre: mejorCubiertos });
    pendientes = pendientes.filter((j) => !mejorCubiertos.includes(j));
  }
  return centros;
}

const csv = path.join(root, '.local-cache', 'identity', 'establecimientos.csv');
if (!fs.existsSync(csv)) throw new Error('Falta .local-cache/identity/establecimientos.csv; corre antes: npm run dump:establishments');

const filas = leerCsv(csv);
const puntos = filas.map((f) => ({ lat: Number(f.latitud), lng: Number(f.longitud) }));
if (puntos.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) throw new Error('Hay coordenadas inválidas en el volcado');

const centros = calcularCentros(puntos, radioMetros);
const salida = {
  generado_en: filas.length ? undefined : undefined,
  radio_metros: radioMetros,
  zoom,
  terminos,
  establecimientos: puntos.length,
  centros: centros.length,
  cargas_fase_1: centros.length * terminos.length,
  items: centros.map((c, i) => {
    const p = puntos[c.indice];
    const id = `c${String(i + 1).padStart(3, '0')}`;
    return {
      id,
      lat: Number(p.lat.toFixed(7)),
      lng: Number(p.lng.toFixed(7)),
      cubre: c.cubre.length,
      urls: terminos.map((t) => `https://www.google.com/maps/search/${encodeURIComponent(t)}/@${p.lat},${p.lng},${zoom}?hl=es`),
    };
  }),
};
delete salida.generado_en;

const destino = path.join(root, '.local-cache', 'identity', 'harvest', 'centers.json');
fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
fs.writeFileSync(destino, `${JSON.stringify(salida, null, 2)}\n`, { mode: 0o600 });

const cubiertos = centros.map((c) => c.cubre.length);
process.stdout.write(`Establecimientos      ${puntos.length}
Radio                 ${radioMetros} m
Centros               ${centros.length}
Grifos por centro     ${(puntos.length / centros.length).toFixed(1)} promedio · ${Math.max(...cubiertos)} máximo
Términos              ${terminos.join(' · ')}
Cargas fase 1         ${centros.length * terminos.length}
Tiempo estimado       ~${Math.round(centros.length * terminos.length * 10 / 60)} min a 10 s por carga

Archivo: ${path.relative(root, destino)}
`);
