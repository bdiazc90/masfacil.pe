#!/usr/bin/env node
// Acredita BANDERA —no nombre— contra el directorio oficial vigente de la cadena.
//
//   node scripts/brand-directory.mjs fetch repsol     descarga y normaliza el padrón
//   node scripts/brand-directory.mjs match            empareja y escribe brand-evidence.json
//
// La coordenada solo selecciona candidatos. Lo que confirma es el número de
// puerta o el nombre de la vía, comparados contra la dirección del Registro; el
// distrito por sí solo no basta y la proximidad tampoco. Si el segundo candidato
// queda demasiado cerca en puntaje, el resultado es conflicto y no se acredita.
// Todo lo cosechado vive en .local-cache/ y no se commitea.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identidad = path.join(root, '.local-cache', 'identity');
const directorios = path.join(identidad, 'directories');
const UA = 'Mozilla/5.0 (compatible; masfacil.pe/4.3; public-data-research)';

// Radio de selección: los padrones publican coordenadas aproximadas, así que se
// abre la ventana y se exige corroboración textual dentro de ella.
const RADIO_M = 200;
// Margen de unicidad: el mejor candidato debe superar al segundo por esto.
const MARGEN_MINIMO = 15;

const FUENTES = Object.freeze({
  repsol: {
    brand: 'Repsol',
    url: 'https://www.repsol.pe/content/dam/aplicaciones/repsol-paises/pe/es/estaciones-de-servicio/data/data.json',
    referer: 'https://www.repsol.pe/es/es/productos-servicios/estaciones-servicio/localizador-de-estaciones/index.cshtml',
    // El padrón de Repsol invierte los nombres: `lng` lleva la latitud.
    normalize: (row) => ({ name: row.name, address: row.address, district: row.city, latitude: row.location?.lng, longitude: row.location?.lat, scope: `${row.department}/${row.state}` }),
    inScope: (row) => row.department === 'LIMA' && row.state === 'LIMA',
  },
});

const sinTildes = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const EARTH_M = 6371008.8;
const rad = (deg) => deg * Math.PI / 180;
function metros(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

// Palabras que no distinguen una vía de otra.
const VACIAS = new Set(['AV', 'AVENIDA', 'JR', 'JIRON', 'CA', 'CALLE', 'MZ', 'MZA', 'LOTE', 'LT', 'URB', 'URBANIZACION', 'ASOC', 'ESQUINA', 'ESQ', 'CON', 'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'S/N', 'SN', 'KM', 'NRO', 'N', 'SUB', 'ETAPA', 'SECTOR', 'PARCELA', 'CUADRA', 'ALTURA', 'FRENTE', 'A', 'PANAMERICANA']);
const palabras = (texto) => sinTildes(texto).replace(/[^A-Z0-9ÑÜ ]+/g, ' ').split(/\s+/).filter(Boolean);
const distintivas = (texto) => new Set(palabras(texto).filter((palabra) => palabra.length >= 4 && !VACIAS.has(palabra) && !/^\d+$/.test(palabra)));
// Número de puerta: se toman los números de 2 a 5 cifras, que es lo que suele
// ser una numeración de vía; se descartan los de manzana y lote por su prefijo.
const numeros = (texto) => {
  const limpio = sinTildes(texto).replace(/\bMZ[A]?\.?\s*[A-Z0-9-]+/g, ' ').replace(/\b(?:LOTE|LT)\.?\s*[A-Z0-9-]+/g, ' ').replace(/\bKM\.?\s*[\d.]+/g, ' ');
  return new Set((limpio.match(/\b\d{2,5}\b/g) ?? []));
};

function establecimientos() {
  const texto = fs.readFileSync(path.join(identidad, 'establecimientos.csv'), 'utf8').replace(/^﻿/, '');
  const filas = [];
  let campo = ''; let fila = []; let comillas = false;
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
  return filas.filter((f) => f.length === cabecera.length).map((f) => Object.fromEntries(cabecera.map((k, i) => [k, f[i]])));
}

async function descargar(clave) {
  const fuente = FUENTES[clave];
  if (!fuente) throw new Error(`Directorio no declarado: ${clave}. Disponibles: ${Object.keys(FUENTES).join(', ')}`);
  const respuesta = await fetch(fuente.url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', Referer: fuente.referer } });
  if (!respuesta.ok) throw new Error(`${clave}: HTTP ${respuesta.status}`);
  const cuerpo = (await respuesta.text()).replace(/^﻿/, '');
  const filas = JSON.parse(cuerpo);
  // La fecha de la EVIDENCIA es la del padrón, no la de la consulta: abrir hoy
  // una fuente vieja no la vuelve actual.
  const modificado = respuesta.headers.get('last-modified');
  const evidencedAt = modificado ? new Date(modificado).toISOString() : null;
  if (!evidencedAt) throw new Error(`${clave}: el padrón no declara fecha de vigencia; no se puede fechar la evidencia`);
  const entradas = filas.filter(fuente.inScope).map(fuente.normalize).filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
  const salida = { brand: fuente.brand, source_url: fuente.url, evidenced_at: evidencedAt, consulted_at: new Date().toISOString(), total_source_rows: filas.length, entries: entradas };
  fs.mkdirSync(directorios, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directorios, `${clave}.json`), `${JSON.stringify(salida, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ directorio: clave, brand: fuente.brand, en_ambito: entradas.length, de: filas.length, evidenced_at: evidencedAt })}\n`);
}

function emparejar() {
  if (!fs.existsSync(directorios)) throw new Error('No hay directorios descargados; ejecuta primero `fetch`');
  const sitios = establecimientos().map((row) => ({
    establishment_id: row.establishment_id,
    distrito: sinTildes(row.distrito),
    direccion: row.direccion,
    razon_social: row.razon_social,
    latitude: Number(row.latitud),
    longitude: Number(row.longitud),
    vias: distintivas(row.direccion),
    numeros: numeros(row.direccion),
  })).filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));

  const propuestas = [];
  const resumen = [];
  for (const archivo of fs.readdirSync(directorios).filter((name) => name.endsWith('.json'))) {
    const directorio = JSON.parse(fs.readFileSync(path.join(directorios, archivo), 'utf8'));
    let conflictos = 0; let sinCorroborar = 0;
    for (const [indice, ficha] of directorio.entries.entries()) {
      const fichaVias = distintivas(ficha.address);
      const fichaNumeros = numeros(ficha.address);
      const fichaDistrito = sinTildes(ficha.district);
      const candidatos = sitios
        .map((sitio) => ({ sitio, distancia: metros(ficha, sitio) }))
        .filter(({ distancia }) => distancia <= RADIO_M)
        .map(({ sitio, distancia }) => {
          const via = [...fichaVias].filter((palabra) => sitio.vias.has(palabra));
          const numero = [...fichaNumeros].filter((valor) => sitio.numeros.has(valor));
          const distrito = fichaDistrito === sitio.distrito;
          // La proximidad no puntúa: solo abre la ventana. Puntúan la vía, el
          // número de puerta y el distrito, que es soporte y no confirmación.
          const puntaje = (numero.length ? 45 : 0) + (via.length ? 35 : 0) + (distrito ? 10 : 0);
          return { sitio, distancia, via, numero, distrito, puntaje };
        })
        .filter((candidato) => candidato.distrito && (candidato.numero.length || candidato.via.length))
        .sort((left, right) => right.puntaje - left.puntaje || left.distancia - right.distancia);
      if (!candidatos.length) { sinCorroborar += 1; continue; }
      const [mejor, segundo] = candidatos;
      const margen = segundo ? mejor.puntaje - segundo.puntaje : Infinity;
      if (margen < MARGEN_MINIMO) { conflictos += 1; continue; }
      propuestas.push({
        establishment_id: mejor.sitio.establishment_id,
        brand: directorio.brand,
        method: 'official_directory',
        reference: `${directorio.brand} · directorio oficial · ${ficha.name} · ${ficha.address} · ${directorio.source_url}`,
        evidenced_at: directorio.evidenced_at,
        consulted_at: directorio.consulted_at,
        puntaje: mejor.puntaje,
        margen: margen === Infinity ? null : margen,
        distancia_m: Math.round(mejor.distancia),
        señales: { numero_de_puerta: mejor.numero, via: mejor.via },
        ficha: `${archivo}#${indice}`,
      });
    }
    resumen.push({ directorio: archivo, fichas: directorio.entries.length, conflictos, sin_corroborar: sinCorroborar });
  }

  // Asignación bipartita codiciosa: una ficha por establecimiento y un
  // establecimiento por ficha. Lo que empate se descarta, no se reparte.
  const porPuntaje = [...propuestas].sort((a, b) => b.puntaje - a.puntaje || a.distancia_m - b.distancia_m);
  const sitiosTomados = new Set(); const fichasTomadas = new Set(); const aceptadas = [];
  for (const propuesta of porPuntaje) {
    if (sitiosTomados.has(propuesta.establishment_id) || fichasTomadas.has(propuesta.ficha)) continue;
    sitiosTomados.add(propuesta.establishment_id); fichasTomadas.add(propuesta.ficha);
    aceptadas.push(propuesta);
  }

  const entradas = Object.fromEntries(aceptadas.map((item) => [item.establishment_id, { brand: item.brand, method: item.method, reference: item.reference, evidenced_at: item.evidenced_at, consulted_at: item.consulted_at }]));
  fs.writeFileSync(path.join(identidad, 'brand-evidence.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), radio_m: RADIO_M, margen_minimo: MARGEN_MINIMO, resumen, entradas }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(identidad, 'brand-evidence-detalle.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), aceptadas }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ propuestas: propuestas.length, acreditadas: aceptadas.length, resumen }, null, 2)}\n`);
}

const [comando, argumento] = process.argv.slice(2);
if (comando === 'fetch') await descargar(argumento);
else if (comando === 'match') emparejar();
else throw new Error('Uso: brand-directory.mjs fetch <marca> | match');
