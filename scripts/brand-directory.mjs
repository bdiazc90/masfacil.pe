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
  petroperu: {
    brand: 'Petroperú',
    url: 'https://comercial.petroperu.com.pe/wp-json/wp/v2/estacion-de-servicio',
    referer: 'https://comercial.petroperu.com.pe/?contenido=nuestra-red-de-estaciones',
    // WordPress pagina de 100 en 100 y no manda `last-modified`: la vigencia sale
    // del `modified_gmt` más reciente que declara el propio padrón.
    cosechar: cosecharWordPress,
    // `title` es la razón social del operador, no la marca: solo viaja al texto de
    // referencia. La bandera que se acredita es la del directorio, no este nombre.
    normalize: (row) => ({ name: deHtml(row.title?.rendered), address: row.acf?.address, district: row.acf?.district, latitude: Number(row.acf?.lat), longitude: Number(row.acf?.long), scope: `${row.acf?.department}/${row.acf?.province}` }),
    inScope: (row) => row.acf?.department === 'LIMA' && row.acf?.province === 'LIMA',
  },
  ava: {
    brand: 'AVA',
    url: 'https://ava.pe/estaciones',
    referer: 'https://ava.pe/',
    // AVA no publica endpoint: el padrón viaja incrustado como literal JS dentro
    // de un bundle de Next.js cuyo hash cambia en cada build. Se redescubre desde
    // el HTML y la vigencia es el `last-modified` de ese bundle.
    cosechar: cosecharAva,
    normalize: (row) => ({ name: row.nombre, address: row.direccion, district: row.distrito, latitude: row.coordenadas?.latitud, longitude: row.coordenadas?.longitud, scope: `${row.departamento}/${row.ciudad}` }),
    // `ciudad` es la provincia, y el padrón la declara mal en 4 de las 28 fichas
    // (Ventanilla, Chancay y dos de Barranca figuran como LIMA/LIMA). El distrito
    // sigue mandando: ninguno de esos existe en el Registro de Lima/Lima.
    inScope: (row) => sinTildes(row.departamento) === 'LIMA' && sinTildes(row.ciudad) === 'LIMA',
  },
  primax: {
    brand: 'Primax',
    url: 'https://www.primax.com/en-ruta.data',
    referer: 'https://www.primax.com/en-ruta/',
    // Payload de datos de React Router (turbo-stream: array plano con referencias
    // por índice), servido desde Azure Blob. La vigencia es el `publishedAt` más
    // reciente del CMS, no el `last-modified` del blob, que solo dice cuándo se
    // recompiló el sitio.
    cosechar: cosecharPrimax,
    // ATENCIÓN: este padrón NO trae departamento, provincia ni distrito, así que
    // `district` sale vacío y el emparejador —que exige igualdad de distrito— no
    // acreditará ninguna ficha Primax. Además 448 de 720 coordenadas traen dos
    // decimales o menos, ~1 km de error, muy por encima del radio de selección.
    // `city` viene relleno en 5 de 720 fichas y una de ellas es el nombre de la
    // calle, no el distrito. Un distrito falso acredita mal: mejor ninguno.
    normalize: (row) => ({ name: row.name, address: row.address, district: '', latitude: row.y, longitude: row.x, scope: 'LIMA/LIMA (por caja geográfica, no declarado por la fuente)' }),
    // Sin campos administrativos solo queda recortar por caja de la provincia de
    // Lima. La caja selecciona candidatos; no declara ámbito ni confirma nada.
    inScope: (row) => row.y > -12.55 && row.y < -11.60 && row.x > -77.25 && row.x < -76.55,
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

const deHtml = (valor) => String(valor ?? '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .trim();

const traer = async (url, fuente, accept = 'application/json,text/plain,*/*') => {
  const respuesta = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept, Referer: fuente.referer } });
  if (!respuesta.ok) throw new Error(`${fuente.brand}: HTTP ${respuesta.status} en ${url}`);
  return respuesta;
};
const fechaDeCabecera = (respuesta) => {
  const modificado = respuesta.headers.get('last-modified');
  return modificado ? new Date(modificado).toISOString() : null;
};

// Cosecha por omisión: un JSON estático fechado por su propia cabecera.
async function cosecharJson(fuente) {
  const respuesta = await traer(fuente.url, fuente);
  const filas = JSON.parse((await respuesta.text()).replace(/^﻿/, ''));
  return { filas, evidencedAt: fechaDeCabecera(respuesta) };
}

// REST de WordPress: pagina por X-WP-TotalPages y se fecha con el `modified_gmt`
// más reciente que declara el propio padrón.
async function cosecharWordPress(fuente) {
  const filas = [];
  let paginas = 1;
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    const respuesta = await traer(`${fuente.url}?per_page=100&page=${pagina}`, fuente);
    if (pagina === 1) paginas = Number(respuesta.headers.get('x-wp-totalpages')) || 1;
    filas.push(...await respuesta.json());
  }
  const modificado = filas.map((fila) => fila.modified_gmt).filter(Boolean).sort().at(-1);
  return { filas, evidencedAt: modificado ? new Date(`${modificado}Z`).toISOString() : null };
}

// Recorta el literal que empieza en `desde` equilibrando corchetes y llaves,
// ignorando lo que caiga dentro de comillas.
function literalBalanceado(texto, desde) {
  let profundidad = 0; let enCadena = false; let escape = false;
  for (let indice = desde; indice < texto.length; indice += 1) {
    const char = texto[indice];
    if (enCadena) { if (escape) escape = false; else if (char === '\\') escape = true; else if (char === '"') enCadena = false; continue; }
    if (char === '"') { enCadena = true; continue; }
    if (char === '[' || char === '{') profundidad += 1;
    else if (char === ']' || char === '}') { profundidad -= 1; if (profundidad === 0) return texto.slice(desde, indice + 1); }
  }
  throw new Error('literal sin cerrar');
}

// AVA no expone endpoint: el padrón es un literal JS dentro de un bundle de
// Next.js. Se redescubren los chunks desde el HTML porque su hash cambia en cada
// build, y la vigencia es el `last-modified` del bundle que contiene las filas.
async function cosecharAva(fuente) {
  const html = await (await traer(fuente.url, fuente, 'text/html,*/*')).text();
  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9._%()-]+\.js/g)].map((m) => m[0]))];
  for (const chunk of chunks) {
    const respuesta = await traer(`https://ava.pe${chunk.replace(/\(/g, '%28').replace(/\)/g, '%29')}`, fuente, 'application/javascript,*/*');
    const js = await respuesta.text();
    const inicio = /\[\{"id":"\d+","departamento":/.exec(js);
    if (!inicio) continue;
    // El literal viene con escapes de JS (\xNN, \') que JSON no admite.
    const json = literalBalanceado(js, inicio.index).replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => `\\u00${hex}`).replace(/\\'/g, "'");
    return { filas: JSON.parse(json), evidencedAt: fechaDeCabecera(respuesta) };
  }
  throw new Error(`${fuente.brand}: el padrón ya no está en ningún chunk; cambió el bundle`);
}

// Payload de React Router (turbo-stream): un array plano donde cada valor se
// referencia por índice y las claves de objeto van prefijadas con `_`.
function hidratarTurboStream(plano) {
  const memoria = new Map();
  const CONSTANTES = { '-1': undefined, '-2': null, '-3': NaN, '-4': Infinity, '-5': -Infinity, '-6': -0 };
  const hidratar = (indice) => {
    if (typeof indice !== 'number') return indice;
    if (indice < 0) return CONSTANTES[String(indice)] ?? null;
    if (memoria.has(indice)) return memoria.get(indice);
    const valor = plano[indice];
    if (valor === null || typeof valor !== 'object') { memoria.set(indice, valor); return valor; }
    if (Array.isArray(valor)) {
      // Un primer elemento de tipo texto es un marcador de tipo, no un índice.
      if (typeof valor[0] === 'string') { const tipado = { __tipo: valor[0], valor: valor.slice(1).map(hidratar) }; memoria.set(indice, tipado); return tipado; }
      const lista = []; memoria.set(indice, lista);
      for (const referencia of valor) lista.push(hidratar(referencia));
      return lista;
    }
    const objeto = {}; memoria.set(indice, objeto);
    for (const [clave, referencia] of Object.entries(valor)) objeto[clave.startsWith('_') ? hidratar(Number(clave.slice(1))) : clave] = hidratar(referencia);
    return objeto;
  };
  return hidratar(0);
}

async function cosecharPrimax(fuente) {
  const respuesta = await traer(fuente.url, fuente);
  const datos = hidratarTurboStream(JSON.parse(await respuesta.text()))?.catchall?.data;
  const mapa = datos?.blocks?.find((bloque) => bloque?.props?.__component === 'shared.map');
  const filas = mapa?.props?.stations;
  if (!Array.isArray(filas)) throw new Error(`${fuente.brand}: el payload ya no trae el bloque de estaciones`);
  // El `last-modified` del blob solo dice cuándo se recompiló el sitio; la
  // vigencia del padrón es el `publishedAt` más reciente de sus fichas.
  const publicado = filas.map((fila) => fila.publishedAt ?? fila.updatedAt).filter(Boolean).sort().at(-1);
  return { filas, evidencedAt: publicado ? new Date(publicado).toISOString() : null };
}

async function descargar(clave) {
  const fuente = FUENTES[clave];
  if (!fuente) throw new Error(`Directorio no declarado: ${clave}. Disponibles: ${Object.keys(FUENTES).join(', ')}`);
  const { filas, evidencedAt } = await (fuente.cosechar ?? cosecharJson)(fuente);
  // La fecha de la EVIDENCIA es la del padrón, no la de la consulta: abrir hoy
  // una fuente vieja no la vuelve actual.
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
  // Los `raw-*.json` son el volcado crudo de cada fuente, guardado para auditar;
  // no son directorios normalizados y no se emparejan.
  for (const archivo of fs.readdirSync(directorios).filter((name) => name.endsWith('.json') && !name.startsWith('raw-'))) {
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
