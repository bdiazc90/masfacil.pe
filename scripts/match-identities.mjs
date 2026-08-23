#!/usr/bin/env node
// Empareja fichas cosechadas de Google Maps con establecimientos del Registro
// oficial y clasifica cada resultado por la fuerza de su evidencia.
//
// Regla que gobierna todo (AGENTS.md, autorizado por Bruno el 23/08/2026):
// la coordenada SELECCIONA candidatos; lo que CONFIRMA es el número de puerta,
// el nombre de la vía, la razón social o la marca. Un match sin corroboración
// ajena a la distancia nunca llega a `verified`, por cerca que esté.
//
// Entrada : .local-cache/identity/harvest/<fecha>/raw.ndjson
//           .local-cache/identity/establecimientos.csv
// Salida  : .local-cache/identity/matches.json
//
// Formato esperado de cada línea del NDJSON, tal como lo emite el barrido:
//   {"center":"c001","term":"grifo","places":[
//      {"id":"<!19s>","name":"Primax Granada","lat":-12.13,"lng":-77.00",
//       "info":["Gasolinera","Av. Mariscal Ramón Castilla 905"]}]}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cosechaFlag = process.argv.indexOf('--harvest');
const cosechaDir = cosechaFlag >= 0 ? process.argv[cosechaFlag + 1] : null;

const RADIO_CANDIDATO = 150;   // más allá de esto no se considera candidato
const DISTANCIA_FIRME = 80;    // requisito de distancia para `verified`
const MARGEN_MINIMO = 100;     // el 2º candidato debe quedar a esta distancia extra

const R = 6371000;
const rad = (g) => g * Math.PI / 180;
const distancia = (a, b) => {
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const sinTildes = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Normalización de direcciones peruanas: unifica abreviaturas de vía y descarta
// lo que no identifica (urbanización, manzana, lote, esquina).
const RUIDO = /\b(URB|URBANIZACION|MZA?|MANZANA|LOTE|LT|ESQ|ESQUINA|CON|Y|DEL|DE|LA|EL|LOS|LAS|ETAPA|SECTOR|ASOC|AAHH|PJ|INT|PISO|SN)\b/g;
const VIAS = [
  [/\b(AVENIDA|AV|AVDA)\b\.?/g, 'AV'],
  [/\b(JIRON|JR)\b\.?/g, 'JR'],
  [/\b(CALLE|CAL|CA)\b\.?/g, 'CA'],
  [/\b(PASAJE|PSJE|PSJ)\b\.?/g, 'PJ'],
  [/\b(CARRETERA|CARR)\b\.?/g, 'CARR'],
  [/\b(PROLONGACION|PROL)\b\.?/g, 'PROL'],
  [/\b(PANAMERICANA)\b/g, 'PANAM'],
];
function normalizarDireccion(valor) {
  let texto = sinTildes(valor).replace(/[.,;()#]/g, ' ').replace(/N[°º]|NRO|NO\b/g, ' ');
  for (const [patron, reemplazo] of VIAS) texto = texto.replace(patron, reemplazo);
  return texto.replace(RUIDO, ' ').replace(/\s+/g, ' ').trim();
}
// Los números de puerta: el Registro a veces lista varios ("6471, 6475, 6479")
// o usa sufijo ("6901-A"). Se comparan como conjuntos.
const numerosDePuerta = (valor) => new Set((sinTildes(valor).match(/\b\d{2,6}\b/g) ?? []).map(Number).filter((n) => n >= 10 && n <= 99999));
const palabras = (valor) => new Set(normalizarDireccion(valor).split(' ').filter((p) => p.length >= 4 && !/^\d+$/.test(p)));
const interseccion = (a, b) => [...a].filter((x) => b.has(x));

// Solo corrobora; nunca es evidencia suficiente por sí sola.
const OPERADORES = [
  [/\bCOESTI\b/, 'Primax'],
  [/\bPERUANA DE ESTACIONES DE SERVICIO\b|\bPECSA\b/, 'Pecsa'],
  [/\bREPSOL\b/, 'Repsol'],
  [/\bPETROPERU\b|\bPETROLEOS DEL PERU\b/, 'Petroperú'],
  [/\bPRIMAX\b/, 'Primax'],
];
const marcaDeOperador = (razonSocial) => OPERADORES.find(([p]) => p.test(sinTildes(razonSocial)))?.[1] ?? null;

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

// Señales que confirman un vínculo. La distancia NO entra aquí a propósito.
function corroboraciones(ficha, establecimiento) {
  const señales = [];
  const dirFicha = ficha.direccion ?? '';
  const numsFicha = numerosDePuerta(dirFicha);
  const numsReg = numerosDePuerta(establecimiento.direccion);
  const numeroComun = interseccion(numsFicha, numsReg);
  if (numeroComun.length) señales.push({ tipo: 'numero_de_puerta', valor: numeroComun.join('/'), peso: 50 });

  const viaComun = interseccion(palabras(dirFicha), palabras(establecimiento.direccion));
  if (viaComun.length >= 2) señales.push({ tipo: 'via', valor: viaComun.slice(0, 3).join(' '), peso: 20 });
  else if (viaComun.length === 1) señales.push({ tipo: 'via_parcial', valor: viaComun[0], peso: 8 });

  const nombreComun = interseccion(palabras(ficha.nombre), palabras(establecimiento.razon_social));
  if (nombreComun.length) señales.push({ tipo: 'nombre_es_razon_social', valor: nombreComun.join(' '), peso: 45 });

  const marcaOperador = marcaDeOperador(establecimiento.razon_social);
  if (marcaOperador && ficha.marca && sinTildes(marcaOperador) === sinTildes(ficha.marca)) {
    señales.push({ tipo: 'marca_coincide_operador', valor: marcaOperador, peso: 25 });
  }
  return señales;
}

const puntaje = (dist, señales) => Math.max(0, 100 - dist / 2) + señales.reduce((s, x) => s + x.peso, 0);

// --- carga de entradas -------------------------------------------------------
const csv = path.join(root, '.local-cache', 'identity', 'establecimientos.csv');
if (!fs.existsSync(csv)) throw new Error('Falta establecimientos.csv; corre antes: npm run dump:establishments');
const establecimientos = leerCsv(csv).map((f) => ({
  establishment_id: f.establishment_id,
  registro: f.registro,
  razon_social: f.razon_social,
  direccion: f.direccion,
  distrito: f.distrito,
  lat: Number(f.latitud),
  lng: Number(f.longitud),
}));

const baseCosecha = cosechaDir ? path.resolve(cosechaDir) : path.join(root, '.local-cache', 'identity', 'harvest');
const ndjson = fs.existsSync(path.join(baseCosecha, 'raw.ndjson'))
  ? path.join(baseCosecha, 'raw.ndjson')
  : fs.readdirSync(baseCosecha, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(baseCosecha, e.name, 'raw.ndjson'))
    .filter((p) => fs.existsSync(p)).sort().pop();
if (!ndjson) throw new Error(`No hay raw.ndjson bajo ${path.relative(root, baseCosecha)}`);

// El innerText de una tarjeta de Maps mezcla nombre, calificación, número de
// reseñas, categoría, dirección y horario, en orden variable. Hay que descartar
// lo que parece dirección pero no lo es: "4,1" es una calificación y "(216)" un
// conteo de reseñas, y ambos llevan dígitos.
const ES_CALIFICACION = /^\d[.,]\d\s*$/;
const ES_RESEÑAS = /^\(\s*[\d.,\s]+\)$/;
const ES_HORARIO = /abierto|cierra|cerrado|abre|24\s*horas|a\.\s?m\.|p\.\s?m\./i;
const ES_TELEFONO = /^\+?\s*\d[\d\s()-]{7,}$/;
const PREFIJO_VIA = /\b(AV|AVDA|AVENIDA|JR|JIRON|CALLE|CA|PSJE|PASAJE|CARR|CARRETERA|PROL|PANAMERICANA|MALECON|PLAZA|OVALO)\b\.?/i;

function direccionDeTarjeta(info) {
  const util = info.filter((t) => {
    const texto = String(t ?? '').trim();
    if (!texto || texto.length < 4) return false;
    return !ES_CALIFICACION.test(texto) && !ES_RESEÑAS.test(texto) && !ES_HORARIO.test(texto) && !ES_TELEFONO.test(texto);
  });
  // Preferir lo que empieza como una vía; si no, lo primero con un número de
  // puerta plausible. Nunca la calificación ni el horario.
  return util.find((t) => PREFIJO_VIA.test(t) && /\d/.test(t))
    ?? util.find((t) => PREFIJO_VIA.test(t))
    ?? util.find((t) => /\b\d{2,6}\b/.test(t) && !/gasoliner|grifo|combustible/i.test(t))
    ?? '';
}

// Deduplicación por identificador estable de lugar: sin esto un mismo grifo
// aparece una vez por término de búsqueda.
const fichas = new Map();
let lineas = 0;
for (const linea of fs.readFileSync(ndjson, 'utf8').split('\n')) {
  if (!linea.trim()) continue;
  lineas += 1;
  const bloque = JSON.parse(linea);
  for (const lugar of bloque.places ?? []) {
    if (!lugar.id) continue;
    const info = Array.isArray(lugar.info) ? lugar.info : [];
    const categoria = info.find((t) => /gasoliner|estaci[oó]n de servicio|grifo|combustible/i.test(t)) ?? info[0] ?? '';
    if (!/gasoliner|grifo|combustible|estaci[oó]n de servicio/i.test(`${categoria} ${lugar.name ?? ''}`)) continue;
    const marca = ['Primax', 'Repsol', 'Pecsa', 'Petroperú', 'Petroperu', 'Terpel', 'Gazel', 'Coesti']
      .find((m) => sinTildes(lugar.name).includes(sinTildes(m))) ?? null;
    fichas.set(lugar.id, {
      id: lugar.id,
      nombre: lugar.name ?? '',
      marca,
      categoria,
      direccion: direccionDeTarjeta(info),
      lat: Number(lugar.lat), lng: Number(lugar.lng),
    });
  }
}

// --- emparejamiento ----------------------------------------------------------
// Se construyen todos los pares posibles dentro del radio y se resuelve la
// asignación de forma bipartita: una ficha solo puede reclamar un
// establecimiento, y un establecimiento solo puede ser reclamado por una ficha.
const pares = [];
for (const ficha of fichas.values()) {
  if (!Number.isFinite(ficha.lat) || !Number.isFinite(ficha.lng)) continue;
  for (const est of establecimientos) {
    const d = distancia(ficha, est);
    if (d > RADIO_CANDIDATO) continue;
    const señales = corroboraciones(ficha, est);
    pares.push({ ficha, est, distancia: d, señales, puntaje: puntaje(d, señales) });
  }
}
pares.sort((a, b) => b.puntaje - a.puntaje);

const porFicha = new Map();
const porEst = new Map();
for (const par of pares) {
  if (!porFicha.has(par.ficha.id)) porFicha.set(par.ficha.id, []);
  if (!porEst.has(par.est.establishment_id)) porEst.set(par.est.establishment_id, []);
  porFicha.get(par.ficha.id).push(par);
  porEst.get(par.est.establishment_id).push(par);
}

const fichaTomada = new Set();
const estTomado = new Set();
const resultados = [];
for (const par of pares) {
  if (fichaTomada.has(par.ficha.id) || estTomado.has(par.est.establishment_id)) continue;
  const rivalesEst = porEst.get(par.est.establishment_id).filter((p) => p.ficha.id !== par.ficha.id && !fichaTomada.has(p.ficha.id));
  const rivalesFicha = porFicha.get(par.ficha.id).filter((p) => p.est.establishment_id !== par.est.establishment_id && !estTomado.has(p.est.establishment_id));
  const segundo = [...rivalesEst, ...rivalesFicha].sort((a, b) => a.distancia - b.distancia)[0] ?? null;
  const margen = segundo ? segundo.distancia - par.distancia : Infinity;
  const confirma = par.señales.filter((s) => s.peso >= 25);

  let estado;
  if (par.distancia <= DISTANCIA_FIRME && confirma.length && margen >= MARGEN_MINIMO) estado = 'verified';
  else if (margen < MARGEN_MINIMO) estado = 'conflict';
  else estado = 'candidate';

  fichaTomada.add(par.ficha.id);
  estTomado.add(par.est.establishment_id);
  // Las demás fichas que aspiraban a este mismo establecimiento se conservan.
  // Suelen ser el caso de abanderamiento —una marca sobre la razón social de un
  // tercero— y ahí la ficha perdedora puede llevar el nombre que la gente usa.
  const rivales = porEst.get(par.est.establishment_id)
    .filter((p) => p.ficha.id !== par.ficha.id)
    .map((p) => ({ place_id: p.ficha.id, nombre_maps: p.ficha.nombre, marca_maps: p.ficha.marca, distancia_m: Math.round(p.distancia) }));
  resultados.push({
    estado,
    establishment_id: par.est.establishment_id,
    registro: par.est.registro,
    razon_social: par.est.razon_social,
    direccion_registro: par.est.direccion,
    distrito: par.est.distrito,
    place_id: par.ficha.id,
    nombre_maps: par.ficha.nombre,
    marca_maps: par.ficha.marca,
    direccion_maps: par.ficha.direccion,
    distancia_m: Math.round(par.distancia),
    margen_m: Number.isFinite(margen) ? Math.round(margen) : null,
    sin_rival: !Number.isFinite(margen),
    fichas_rivales: rivales,
    señales: par.señales,
    lat: par.est.lat, lng: par.est.lng,
  });
}

const sinFicha = establecimientos.filter((e) => !estTomado.has(e.establishment_id));
const fichasSinUsar = [...fichas.values()].filter((f) => !fichaTomada.has(f.id));
const porEstado = (v) => resultados.filter((r) => r.estado === v);

const salida = {
  cosecha: path.relative(root, ndjson),
  bloques_leidos: lineas,
  fichas_unicas: fichas.size,
  establecimientos: establecimientos.length,
  umbrales: { radio_candidato_m: RADIO_CANDIDATO, distancia_firme_m: DISTANCIA_FIRME, margen_minimo_m: MARGEN_MINIMO },
  resumen: {
    verified: porEstado('verified').length,
    candidate: porEstado('candidate').length,
    conflict: porEstado('conflict').length,
    unmatched: sinFicha.length,
    fichas_sin_asignar: fichasSinUsar.length,
  },
  resultados: resultados.sort((a, b) => a.distrito.localeCompare(b.distrito) || a.distancia_m - b.distancia_m),
  unmatched: sinFicha.map((e) => ({ establishment_id: e.establishment_id, razon_social: e.razon_social, direccion: e.direccion, distrito: e.distrito })),
  fichas_sin_asignar: fichasSinUsar.map((f) => ({ place_id: f.id, nombre: f.nombre, marca: f.marca, direccion: f.direccion, lat: f.lat, lng: f.lng })),
};

const destino = path.join(root, '.local-cache', 'identity', 'matches.json');
fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
fs.writeFileSync(destino, `${JSON.stringify(salida, null, 2)}\n`, { mode: 0o600 });

const pct = (n) => `${(n / establecimientos.length * 100).toFixed(1)} %`;
process.stdout.write(`Cosecha            ${path.relative(root, ndjson)}
Bloques leídos     ${lineas}
Fichas únicas      ${fichas.size}   (deduplicadas por identificador de lugar)

verified           ${String(salida.resumen.verified).padStart(4)}   ${pct(salida.resumen.verified)}  distancia<=${DISTANCIA_FIRME}m + corroboración + margen>=${MARGEN_MINIMO}m
candidate          ${String(salida.resumen.candidate).padStart(4)}   ${pct(salida.resumen.candidate)}  emparejado pero sin evidencia suficiente
conflict           ${String(salida.resumen.conflict).padStart(4)}   ${pct(salida.resumen.conflict)}  margen insuficiente: el sistema se niega a adivinar
unmatched          ${String(salida.resumen.unmatched).padStart(4)}   ${pct(salida.resumen.unmatched)}  sin ficha dentro de ${RADIO_CANDIDATO} m

fichas sin asignar ${String(salida.resumen.fichas_sin_asignar).padStart(4)}        perdieron la asignación; suelen ser el rótulo de marca
                        de un establecimiento cuya razón social ya ganó

Ninguno se publica sin que audites una muestra. Archivo: ${path.relative(root, destino)}
`);
