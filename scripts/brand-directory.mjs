#!/usr/bin/env node
// Acredita BANDERA —no nombre— contra el directorio oficial vigente de la cadena.
//
//   node scripts/brand-directory.mjs fetch repsol     descarga y normaliza el padrón
//   node scripts/brand-directory.mjs match            empareja y escribe brand-evidence.json
//
// La coordenada solo selecciona candidatos, y su ventana se abre según los
// decimales que la fuente publica de verdad: una ficha con dos decimales puede
// estar a casi un kilómetro. Lo que confirma es texto discriminante comparado con
// el Registro —vía y puerta, vía y operador, manzana y lote—; la distancia, una
// vía sola, la marca o un número suelto no bastan. Un distrito declarado y
// distinto descarta el vínculo; uno ausente es desconocido y no se inventa.
// Si el segundo candidato queda demasiado cerca en puntaje, o dos directorios
// reclaman un mismo establecimiento con banderas distintas, el resultado es
// conflicto y no se acredita. Todo lo cosechado vive en .local-cache/ y no se
// commitea; `IDENTITY_ROOT` trabaja sobre una copia del expediente.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identidad = path.resolve(root, process.env.IDENTITY_ROOT || path.join('.local-cache', 'identity'));
const directorios = path.join(identidad, 'directories');
const UA = 'Mozilla/5.0 (compatible; masfacil.pe/4.3; public-data-research)';

// Margen de unicidad: el mejor candidato debe superar al segundo por esto.
export const MARGEN_MINIMO = 15;

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

// Algunos padrones arrastran UTF-8 leído como CP-1252: «VIÃ‘EDOS».
const MOJIBAKE = Object.freeze([['Ã‘', 'Ñ'], ['Ã±', 'ñ'], ['Ã¡', 'á'], ['Ã©', 'é'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãº', 'ú'], ['Ã“', 'Ó'], ['Ã‰', 'É'], ['Ãš', 'Ú'], ['Ã¼', 'ü']]);
const sinTildes = (value) => MOJIBAKE.reduce((texto, [roto, sano]) => texto.replaceAll(roto, sano), String(value ?? '')).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const EARTH_M = 6371008.8;
const rad = (deg) => deg * Math.PI / 180;
function metros(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

// --- Precisión de la coordenada ------------------------------------------------

const decimales = (valor) => {
  const texto = String(valor ?? '');
  if (!Number.isFinite(Number(valor)) || /e/i.test(texto)) return 0;
  const punto = texto.indexOf('.');
  return punto < 0 ? 0 : texto.length - punto - 1;
};
/** Decimales que la ficha publica de verdad en su eje más pobre. */
export const precisionDe = (ficha) => Math.min(decimales(ficha.latitude), decimales(ficha.longitude));
/**
 * Tolerancia de selección por eje, en metros. Con 4 decimales o más el redondeo
 * es de metros y rige la ventana de siempre; con 3 añade ~55 m; con 2, ~555 m;
 * con 1, ~5,5 km; sin decimales la coordenada no selecciona y solo queda el
 * texto. Se mide por eje porque hay fichas con la latitud precisa y la longitud
 * redondeada: tomar el peor de los dos abría la ventana a toda la provincia.
 */
export const toleranciaDe = (decimalesDelEje) => (decimalesDelEje >= 4 ? 200 : decimalesDelEje === 3 ? 300 : decimalesDelEje === 2 ? 1000 : decimalesDelEje === 1 ? 6000 : Infinity);
const M_POR_GRADO = 111195;
function ventanaDe(ficha) {
  const latitud = toleranciaDe(decimales(ficha.latitude));
  const longitud = toleranciaDe(decimales(ficha.longitude));
  const precisa = latitud === 200 && longitud === 200;
  return {
    latitud_m: Number.isFinite(latitud) ? latitud : null,
    longitud_m: Number.isFinite(longitud) ? longitud : null,
    // Coordenada precisa: el radio de siempre. Si no, un rectángulo por eje.
    contiene: (sitio) => (precisa
      ? metros(ficha, sitio) <= 200
      : Math.abs(ficha.latitude - sitio.latitude) * M_POR_GRADO <= latitud
        && Math.abs(ficha.longitude - sitio.longitude) * M_POR_GRADO * Math.cos(rad(ficha.latitude)) <= longitud),
  };
}

// El mismo distrito escrito de otra forma. Solo alias observados en los
// padrones: Repsol y AVA escriben «Cercado de Lima» donde el Registro dice LIMA.
const ALIAS_DISTRITO = Object.freeze({ 'CERCADO DE LIMA': 'LIMA' });
const distritoCanonico = (valor) => {
  const limpio = sinTildes(valor).replace(/\s+/g, ' ').trim();
  return ALIAS_DISTRITO[limpio] ?? limpio;
};

/** Estrato de muestreo: cada regla de emparejamiento se audita por separado. */
export function estratoDe(ficha) {
  if (distritoCanonico(ficha.district)) return 'distrito_declarado';
  const precision = precisionDe(ficha);
  return precision >= 3 ? 'sin_distrito_coordenada_precisa' : precision === 2 ? 'sin_distrito_coordenada_aproximada' : 'sin_distrito_coordenada_inutil';
}

// --- Direcciones -----------------------------------------------------------------

const PREFIJOS_VIA = new Set(['AV', 'AVENIDA', 'AVDA', 'JR', 'JIRON', 'CA', 'CAL', 'CALLE', 'PSJE', 'PASAJE', 'PJE', 'PROL', 'PROLONGACION', 'MALECON', 'OVALO', 'BLVD', 'BOULEVARD', 'VIA']);
const PREFIJOS_CARRETERA = new Set(['CARR', 'CAR', 'CARRET', 'CARRETERA', 'AUTOPISTA', 'PAN', 'PANAM', 'PANAMERICANA']);
// Abren la localidad: lo que sigue ubica, pero no es la vía.
const LOCALIDAD = new Set(['URB', 'URBANIZACION', 'AAHH', 'AH', 'ASOC', 'ASOCIACION', 'COOP', 'COOPERATIVA', 'PJ', 'PUEBLO', 'PROGRAMA', 'RES', 'RESIDENCIAL', 'CONJ', 'CONJUNTO', 'CH', 'HABILITACION', 'HABILIT', 'LOTIZACION', 'FUNDO', 'FDO', 'PREDIO', 'PARCELA', 'PARC', 'PARCELACION', 'SECTOR', 'ZONA', 'GRUPO', 'ETAPA', 'COMUNIDAD', 'CP', 'ANEXO', 'BARRIO', 'APV', 'UNIDAD', 'UNID', 'SECCION', 'CASERIO']);
// Abren otra vía: la de la esquina o el nombre anterior de la misma.
const CRUCE = new Set(['ESQ', 'ESQUINA', 'CON', 'CRUCE', 'INTERSECCION', 'INTERSEC', 'INTER', 'Y', 'ENTRE', 'ANTES', 'EX']);
// Una referencia («altura del paradero») no es la dirección.
const REFERENCIA = new Set(['ALT', 'ALTURA', 'FRENTE', 'REF', 'REFERENCIA', 'PARADERO', 'COSTADO', 'ESPALDA', 'CERCA']);
const SALTA_NUMERO = new Set(['INT', 'INTERIOR', 'PISO', 'DPTO', 'DEPARTAMENTO', 'OF', 'OFICINA', 'TIENDA', 'LOCAL', 'PUESTO', 'CDRA', 'CUADRA', 'UC', 'SUB']);
const MANZANA = new Set(['MZ', 'MZA', 'MANZANA']);
const LOTE = new Set(['LT', 'LTS', 'LTE', 'LOTE', 'LOTES', 'LOT', 'SUBLOTE']);
const MESES = new Set(['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']);
const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'AL', 'EN', 'SIN', 'NOMBRE']);
// Nombres tan repetidos que solos no distinguen una vía: «Santa Rosa» y «Santa
// Cruz» no son la misma. Cuentan solo acompañados.
const DEBILES = new Set(['SAN', 'STA', 'STO', 'SANTA', 'SANTO', 'SENOR', 'SENORA', 'NUESTRA', 'VIRGEN', 'GENERAL', 'GRAL', 'MARISCAL', 'MCAL', 'PRESIDENTE', 'CORONEL', 'CAPITAN', 'ALMIRANTE', 'DOCTOR', 'INGENIERO', 'PADRE', 'JOSE', 'JUAN', 'MARIA', 'MANUEL', 'LUIS', 'CARLOS', 'REPUBLICA', 'PASEO', 'LIMA', 'PERU', 'INCA', 'HEROES']);
// Describen una carretera pero no la distinguen: valen junto al kilómetro.
const GENERICAS = new Set(['NORTE', 'SUR', 'ESTE', 'OESTE', 'CENTRAL', 'ANTIGUA', 'NUEVA', 'NUEVO', 'PRINCIPAL']);
const ORIENTACION = new Set(['NORTE', 'SUR', 'ESTE', 'OESTE']);
// Rubro de la localidad, no su nombre: «Programa de Vivienda», «Pueblo Joven».
const GENERICAS_LOCALIDAD = new Set(['JOVEN', 'PROYECTO', 'ESPECIAL', 'VIVIENDA', 'VIVIENDAS', 'POBLADO', 'ASENTAMIENTO', 'HUMANO', 'AGRUPACION', 'FAMILIAR', 'PRODUCTORES', 'AGROPECUARIA', 'AGRICOLA', 'INDUSTRIAL', 'INDUSTRIALES', 'PECUARIOS', 'INMOBILIARIA', 'RUSTICO', 'SEMI', 'MIXTA', 'NUEVO', 'NUEVA', 'VILLA', 'RESIDENCIAL', 'CAMPESINA', 'CAMPESINO', 'UNIDAD', 'VECINAL', 'SUBLOTE', 'PARCELA', 'LOTIZACION', 'HABILITACION', 'URBANA', 'COMERCIAL', 'TALLER', 'CASA'].concat([...LOCALIDAD]));

function normalizarDireccion(texto) {
  return sinTildes(texto)
    .replace(/\bA\s*\.?\s*A\s*\.?\s*H\s*\.?\s*H\b\.?/g, ' AAHH ')
    .replace(/\bA\s*\.\s*H\s*\./g, ' AAHH ')
    .replace(/\bP\s*\.\s*J\s*\./g, ' PJ ')
    .replace(/\bC\s*\.\s*H\s*\./g, ' CH ')
    .replace(/\bC\s*\.\s*P\s*\./g, ' CP ')
    .replace(/\bU\s*\.\s*C\s*\./g, ' UC ')
    .replace(/\bS\s*\/\s*N\b\.?/g, ' SN ')
    .replace(/([A-Z]{3,})KM(?=[\s.\d])/g, '$1 KM ')
    .replace(/\bN\s*[°º]/g, ' NRO ')
    .replace(/[°º]/g, ' ')
    .replace(/\b(?:NRO|NUMERO|NO|N)\b\.?(?=\s*\d)/g, ' NRO ')
    .replace(/(\d)\.(?=\d)/g, '$1§')
    .replace(/[^A-Z0-9§]+/g, ' ')
    .replace(/§/g, '.')
    .trim();
}

// «Q-1», «LL-1»: el guion partió el identificador de la manzana.
function leerManzana(tokens, desde, destino) {
  const id = tokens[desde];
  if (!id || MANZANA.has(id) || LOTE.has(id) || LOCALIDAD.has(id) || !/^[A-Z0-9]{1,4}$/.test(id)) return desde - 1;
  const tras = tokens[desde + 2];
  if (/^[A-Z]{1,2}$/.test(id) && /^\d{1,2}$/.test(tokens[desde + 1] ?? '') && (tras === undefined || LOTE.has(tras) || /^(?:LOTE?S?|LTS?|LTE)\d/.test(tras))) {
    destino.add(`${id}${Number(tokens[desde + 1])}`);
    return desde + 1;
  }
  destino.add(/^\d+$/.test(id) ? String(Number(id)) : id);
  return desde;
}

function leerLotes(tokens, desde, destino) {
  let indice = desde;
  for (; indice < tokens.length; indice += 1) {
    const token = tokens[indice];
    if (token === 'Y' || token === 'NRO' || token === 'SUB') continue;
    if (tokens[indice + 1] === 'ETAPA') break;
    if (/^\d{1,3}[A-Z]?$/.test(token)) { destino.add(token.replace(/^0+(?=\d)/, '')); continue; }
    if (/^[A-Z]$/.test(token)) { destino.add(token); continue; }
    break;
  }
  return indice - 1;
}

/**
 * Lo que una dirección peruana dice de sí misma, separado por función: vías,
 * puertas, kilómetro, manzana y lote, y localidad. Separarlo es lo que evita
 * confundir una urbanización «Leoncio Prado» con la antigua avenida del mismo
 * nombre, o el «28» de «Av. 28 de Julio» con un número de puerta.
 */
export function analizarDireccion(texto) {
  const tokens = normalizarDireccion(texto).split(' ').filter(Boolean);
  const r = { vias: new Set(), genericas: new Set(), localidad: new Set(), puertas: new Set(), km: new Set(), manzanas: new Set(), lotes: new Set() };
  let modo = 'via';
  let palabrasDeVia = 0;
  let puertaAbierta = false;
  const fuera = () => (modo === 'referencia' ? modo : 'resto');
  for (let indice = 0; indice < tokens.length; indice += 1) {
    const token = tokens[indice];
    const siguiente = tokens[indice + 1];
    if (token === 'SN') { modo = fuera(); puertaAbierta = false; continue; }
    if (PREFIJOS_VIA.has(token) || PREFIJOS_CARRETERA.has(token)) {
      if (PREFIJOS_CARRETERA.has(token)) r.genericas.add('CARRETERA');
      if (modo !== 'referencia') { modo = 'via'; palabrasDeVia = 0; }
      puertaAbierta = false;
      continue;
    }
    if (MANZANA.has(token)) { indice = leerManzana(tokens, indice + 1, r.manzanas); modo = fuera(); puertaAbierta = false; continue; }
    const loteJunto = /^(?:LOTE?S?|LTS?|LTE)(\d{1,3})$/.exec(token);
    if (LOTE.has(token) || loteJunto) {
      if (loteJunto) r.lotes.add(String(Number(loteJunto[1])));
      indice = leerLotes(tokens, indice + 1, r.lotes);
      modo = fuera(); puertaAbierta = false;
      continue;
    }
    const kmJunto = /^KM(\d+(?:\.\d+)?)$/.exec(token);
    if (token === 'KM' || kmJunto) {
      const valor = kmJunto?.[1] ?? (/^\d+(?:\.\d+)?$/.test(siguiente ?? '') ? siguiente : null);
      if (valor && modo !== 'referencia') r.km.add(String(Number(valor)));
      if (valor && !kmJunto) indice += 1;
      modo = fuera(); puertaAbierta = false;
      continue;
    }
    if (LOCALIDAD.has(token)) { if (modo !== 'referencia') modo = 'localidad'; puertaAbierta = false; continue; }
    if (CRUCE.has(token)) { if (modo !== 'referencia') { modo = 'via'; palabrasDeVia = 0; } puertaAbierta = false; continue; }
    if (REFERENCIA.has(token)) { modo = 'referencia'; puertaAbierta = false; continue; }
    if (SALTA_NUMERO.has(token)) { if (/^\d/.test(siguiente ?? '')) indice += 1; puertaAbierta = false; continue; }
    if (token === 'NRO') { puertaAbierta = modo !== 'referencia'; continue; }
    const numero = /^(\d+)(?:\.\d+)?(?:[A-Z]{1,4})?$/.exec(token);
    if (numero) {
      // «28 de Julio», «15 Julio»: el número nombra la vía, no la puerta.
      const mes = MESES.has(siguiente) ? siguiente : (siguiente === 'DE' && MESES.has(tokens[indice + 2]) ? tokens[indice + 2] : null);
      if (mes) {
        if (modo === 'via') { r.vias.add(`${Number(numero[1])}${mes}`); palabrasDeVia += 1; }
        indice += siguiente === 'DE' ? 2 : 1;
        continue;
      }
      if (!puertaAbierta && siguiente === 'ETAPA') continue;  // «3 Etapa»
      const esPuerta = modo !== 'referencia' && modo !== 'localidad' && (puertaAbierta || (modo === 'via' && palabrasDeVia > 0));
      // «Calle 15»: un número pegado al prefijo también nombra la vía.
      if (!esPuerta) { if (modo === 'via' && palabrasDeVia === 0) palabrasDeVia += 1; continue; }
      const valor = String(Number(numero[1]));
      if (valor.length >= 2 && valor.length <= 5) r.puertas.add(valor);
      modo = 'resto';
      puertaAbierta = true;
      continue;
    }
    puertaAbierta = false;
    if (token.length < 3 || VACIAS.has(token)) continue;
    if (GENERICAS.has(token)) { if (modo === 'via') { r.genericas.add(token); palabrasDeVia += 1; } continue; }
    if (modo === 'via') { r.vias.add(token); palabrasDeVia += 1; }
    else if (modo === 'localidad' && !GENERICAS_LOCALIDAD.has(token)) r.localidad.add(token);
  }
  return r;
}

function viaComun(a, b) {
  const orientacion = (analisis) => [...analisis.genericas].filter((palabra) => ORIENTACION.has(palabra));
  const [deA, deB] = [orientacion(a), orientacion(b)];
  // «Javier Prado Este» y «Javier Prado Oeste» son tramos distintos.
  if (deA.length && deB.length && !deA.some((palabra) => deB.includes(palabra))) return [];
  const comunes = [...a.vias].filter((palabra) => b.vias.has(palabra));
  return comunes.some((palabra) => !DEBILES.has(palabra)) || comunes.length >= 2 ? comunes : [];
}

// Lo que no identifica a un operador: forma legal, rubro, la propia cadena.
const GENERICAS_NOMBRE = new Set(['CORPORATION', 'COMPANY', 'CLUB', 'ASOCIACION', 'COOPERATIVA', 'GREMIO', 'PARQUE', 'ES', 'EESS', 'ESTACION', 'ESTACIONES', 'SERVICIO', 'SERVICIOS', 'GRIFO', 'GRIFOS', 'GASOCENTRO', 'SERVICENTRO', 'CENTRO', 'COMBUSTIBLE', 'COMBUSTIBLES', 'GAS', 'GNV', 'GLP', 'SAC', 'EIRL', 'SRL', 'SOCIEDAD', 'ANONIMA', 'CERRADA', 'EMPRESA', 'EMPRESAS', 'EMPRESARIAL', 'INVERSIONES', 'INVERSION', 'CORPORACION', 'GRUPO', 'NEGOCIACIONES', 'NEGOCIACION', 'COMERCIAL', 'COMERCIALIZADORA', 'DISTRIBUIDORA', 'GENERALES', 'MULTISERVICIOS', 'AUTOSERVICIOS', 'TRANSPORTES', 'LIMITADA', 'RESPONSABILIDAD', 'INDIVIDUAL', 'IMPORTACIONES', 'EXPORTACIONES', 'HERMANOS', 'HNOS', 'CIA', 'COMPANIA', 'ASOCIADOS', 'REPRESENTACIONES', 'OPERACIONES', 'PETROLEOS', 'PETROLEO', 'ENERGY', 'ENERGIA', 'OIL', 'TRADING', 'SERVICE', 'PERU', 'LIMA', 'PRIMAX', 'REPSOL', 'PETROPERU', 'AVA', 'COESTI', 'DEL', 'LAS', 'LOS', 'SAN', 'SANTA', 'SANTO', 'NORTE', 'SUR', 'ESTE', 'OESTE']);
const tokensDeNombre = (texto) => new Set(sinTildes(texto).replace(/[^A-Z0-9]+/g, ' ').split(' ').filter((palabra) => palabra.length >= 3 && !/^\d+$/.test(palabra) && !GENERICAS_NOMBRE.has(palabra)));
/** El nombre de la ficha es la razón social del operador: «CORGAS» y «CORGAS S.A.C.». */
function nombreEnRazonSocial(nombre, razonSocial) {
  const deRazon = tokensDeNombre(razonSocial);
  const comunes = [...tokensDeNombre(nombre)].filter((palabra) => deRazon.has(palabra));
  return comunes.some((palabra) => palabra.length >= 4) || comunes.length >= 2 ? comunes : [];
}

// Empresas que solo operan grifos de su propia cadena. Corroboran identidad; no
// convierten por sí solas una razón social en bandera.
const OPERADORES = [[/\bCOESTI\b/, 'Primax'], [/\bPERUANA DE ESTACIONES DE SERVICIOS?\b|\bPECSA\b/, 'Pecsa'], [/\bREPSOL\b/, 'Repsol'], [/\bPETROPERU\b|\bPETROLEOS DEL PERU\b/, 'Petroperú'], [/\bPRIMAX\b/, 'Primax']];
const marcaDelOperador = (razonSocial) => OPERADORES.find(([patron]) => patron.test(sinTildes(razonSocial)))?.[1] ?? null;

/**
 * Señales de una ficha frente a un establecimiento y si alcanzan para confirmar.
 *
 * Con distrito declarado y coincidente rige la regla de siempre: el distrito más
 * una señal textual. Sin distrito, la señal tiene que ser una combinación que un
 * vecino no comparta por casualidad.
 */
function señalesDe(ficha, sitio, { conDistrito }) {
  const a = ficha.analisis;
  const b = sitio.analisis;
  const via = viaComun(a, b);
  const puerta = [...a.puertas].filter((valor) => b.puertas.has(valor));
  const mismaCarretera = via.length > 0 || [...a.genericas].some((palabra) => palabra !== 'CARRETERA' && b.genericas.has(palabra));
  const kilometro = mismaCarretera ? [...a.km].filter((valor) => b.km.has(valor)) : [];
  const manzana = [...a.manzanas].filter((valor) => b.manzanas.has(valor));
  const lote = [...a.lotes].filter((valor) => b.lotes.has(valor));
  const manzanaLote = manzana.length && lote.length ? [`MZ ${manzana.join('/')}`, `LT ${lote.join('/')}`] : [];
  const localidad = [...a.localidad].filter((palabra) => b.localidad.has(palabra) && !DEBILES.has(palabra));
  const nombre = nombreEnRazonSocial(ficha.name, sitio.razon_social);
  const operador = Boolean(sitio.operador) && sinTildes(sitio.operador) === sinTildes(ficha.brand);
  const tieneVia = via.length > 0 || kilometro.length > 0;
  const tienePuerta = puerta.length > 0 || kilometro.length > 0;
  const tieneManzanaLote = manzanaLote.length > 0;
  const tieneNombre = nombre.length > 0;
  const confirma = conDistrito
    ? tienePuerta || tieneVia || tieneManzanaLote || tieneNombre || localidad.length >= 2
    : (tieneVia && (tienePuerta || tieneNombre || operador)) || (tieneManzanaLote && (tieneVia || localidad.length > 0 || tieneNombre)) || (tienePuerta && tieneNombre);
  const puntaje = (tienePuerta ? 45 : 0) + (tieneVia ? 35 : 0) + (tieneNombre ? 40 : 0) + (tieneManzanaLote ? 30 : 0) + (localidad.length ? 10 : 0) + (operador ? 10 : 0) + (conDistrito ? 10 : 0);
  return {
    confirma,
    puntaje,
    señales: { numero_de_puerta: [...puerta, ...kilometro.map((valor) => `km ${valor}`)], via, manzana_lote: manzanaLote, localidad, nombre_en_razon_social: nombre, operador_de_la_marca: operador },
  };
}

/**
 * Empareja fichas de directorios con establecimientos del Registro. Es puro:
 * recibe sitios y directorios ya leídos y devuelve lo acreditado, los conflictos
 * y lo pendiente con su motivo.
 *
 * @param {{sitios: Array<{establishment_id: string, distrito: string, direccion: string, razon_social: string, latitude: number, longitude: number}>, directorios: Array<{archivo: string, brand: string, source_url: string, evidenced_at: string, consulted_at: string, entries: Array<{name: string, address: string, district: string, latitude: number, longitude: number}>}>, marcasActivas?: Iterable<string>}} entrada
 */
export function emparejarDirectorios({ sitios, directorios: lista, marcasActivas = [] }) {
  const activas = new Set([...marcasActivas].map(sinTildes));
  const preparados = sitios
    .filter((sitio) => Number.isFinite(sitio.latitude) && Number.isFinite(sitio.longitude))
    .map((sitio) => ({ ...sitio, distritoCanonico: distritoCanonico(sitio.distrito), analisis: analizarDireccion(sitio.direccion), operador: marcaDelOperador(sitio.razon_social) }));
  const resumen = new Map(lista.map((directorio) => [directorio.archivo, { directorio: directorio.archivo, brand: directorio.brand, fichas: directorio.entries.length, acreditadas: 0, pendientes: {} }]));
  const pendientes = [];
  const anotar = (pendiente) => {
    pendientes.push(pendiente);
    const fila = resumen.get(pendiente.ficha.split('#')[0]);
    fila.pendientes[pendiente.motivo] = (fila.pendientes[pendiente.motivo] ?? 0) + 1;
  };

  const propuestas = [];
  for (const directorio of lista) {
    for (const [indice, ficha] of directorio.entries.entries()) {
      const clave = `${directorio.archivo}#${indice}`;
      const precision = precisionDe(ficha);
      const ventana = ventanaDe(ficha);
      const estrato = estratoDe(ficha);
      const distrito = distritoCanonico(ficha.district);
      const base = { ficha: clave, brand: directorio.brand, nombre: ficha.name, estrato };
      const conCoordenada = Number.isFinite(ficha.latitude) && Number.isFinite(ficha.longitude);
      const enVentana = preparados
        .filter((sitio) => !conCoordenada || ventana.contiene(sitio))
        .map((sitio) => ({ sitio, distancia: conCoordenada ? metros(ficha, sitio) : null }));
      if (!enVentana.length) { anotar({ ...base, motivo: 'sin_candidato' }); continue; }
      const compatibles = distrito ? enVentana.filter(({ sitio }) => sitio.distritoCanonico === distrito) : enVentana;
      if (!compatibles.length) { anotar({ ...base, motivo: 'distrito_contradictorio' }); continue; }
      const analisis = analizarDireccion(ficha.address);
      const confirmados = compatibles
        .map((candidato) => ({ ...candidato, ...señalesDe({ ...ficha, brand: directorio.brand, analisis }, candidato.sitio, { conDistrito: Boolean(distrito) }) }))
        .filter((candidato) => candidato.confirma)
        .sort((left, right) => right.puntaje - left.puntaje);
      if (!confirmados.length) { anotar({ ...base, motivo: 'sin_corroboracion' }); continue; }
      const [mejor, segundo] = confirmados;
      const margen = segundo ? mejor.puntaje - segundo.puntaje : null;
      if (segundo && margen < MARGEN_MINIMO) {
        anotar({ ...base, motivo: 'margen_insuficiente', candidatos: confirmados.filter((candidato) => mejor.puntaje - candidato.puntaje < MARGEN_MINIMO).map((candidato) => candidato.sitio.establishment_id) });
        continue;
      }
      const operador = mejor.sitio.operador;
      propuestas.push({
        establishment_id: mejor.sitio.establishment_id,
        brand: directorio.brand,
        method: 'official_directory',
        reference: `${directorio.brand} · directorio oficial · ${ficha.name} · ${ficha.address} · ${directorio.source_url}`,
        evidenced_at: directorio.evidenced_at,
        consulted_at: directorio.consulted_at,
        estrato,
        precision_decimales: precision,
        ventana_m: { latitud: ventana.latitud_m, longitud: ventana.longitud_m },
        puntaje: mejor.puntaje,
        margen,
        distancia_m: mejor.distancia === null ? null : Math.round(mejor.distancia),
        señales: mejor.señales,
        // La razón social pertenece a otra cadena con directorio propio: no se
        // decide aquí cuál de las dos fuentes quedó vieja.
        choque_con_operador: Boolean(operador && activas.has(sinTildes(operador)) && sinTildes(operador) !== sinTildes(directorio.brand)) ? operador : null,
        nombre_ficha: ficha.name,
        ficha: clave,
      });
    }
  }

  // Un establecimiento reclamado con banderas distintas no se resuelve por
  // puntaje, orden de archivos ni distancia: queda en conflicto.
  const porSitio = new Map();
  for (const propuesta of propuestas) porSitio.set(propuesta.establishment_id, [...(porSitio.get(propuesta.establishment_id) ?? []), propuesta]);
  const aceptadas = [];
  const conflictos = [];
  for (const [establishmentId, grupo] of [...porSitio.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const marcas = [...new Map(grupo.map((propuesta) => [sinTildes(propuesta.brand), propuesta.brand])).values()];
    const choque = grupo.find((propuesta) => propuesta.choque_con_operador);
    if (marcas.length > 1 || choque) {
      const motivo = marcas.length > 1 ? 'conflicto_entre_directorios' : 'choque_con_operador';
      conflictos.push({ establishment_id: establishmentId, motivo, marcas: choque && marcas.length === 1 ? [...marcas, choque.choque_con_operador] : marcas, fichas: grupo.map((propuesta) => propuesta.ficha) });
      for (const propuesta of grupo) anotar({ ficha: propuesta.ficha, brand: propuesta.brand, nombre: propuesta.nombre_ficha, estrato: propuesta.estrato, motivo, establishment_id: establishmentId });
      continue;
    }
    // Varias fichas de una misma cadena sobre un grifo —la ficha repetida del
    // padrón— acreditan una sola vez: gana la de más señales.
    const [ganadora, ...resto] = [...grupo].sort((left, right) => right.puntaje - left.puntaje || left.ficha.localeCompare(right.ficha));
    aceptadas.push(ganadora);
    resumen.get(ganadora.ficha.split('#')[0]).acreditadas += 1;
    for (const propuesta of resto) anotar({ ficha: propuesta.ficha, brand: propuesta.brand, nombre: propuesta.nombre_ficha, estrato: propuesta.estrato, motivo: 'perdio_asignacion', establishment_id: establishmentId, ganadora: ganadora.ficha });
  }
  return { aceptadas, conflictos, pendientes, resumen: [...resumen.values()] };
}

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
    distrito: row.distrito,
    direccion: row.direccion,
    razon_social: row.razon_social,
    latitude: Number(row.latitud),
    longitude: Number(row.longitud),
  }));
  // Los `raw-*.json` son el volcado crudo de cada fuente, guardado para auditar;
  // no son directorios normalizados y no se emparejan.
  const lista = fs.readdirSync(directorios)
    .filter((name) => name.endsWith('.json') && !name.startsWith('raw-'))
    .sort()
    .map((archivo) => ({ archivo, ...JSON.parse(fs.readFileSync(path.join(directorios, archivo), 'utf8')) }));
  const { aceptadas, conflictos, pendientes, resumen } = emparejarDirectorios({ sitios, directorios: lista, marcasActivas: Object.values(FUENTES).map((fuente) => fuente.brand) });

  const generado = new Date().toISOString();
  // `estrato` viaja con la entrada para muestrear cada regla por separado; el
  // catálogo solo toma los campos de su contrato.
  const entradas = Object.fromEntries(aceptadas.map((item) => [item.establishment_id, { brand: item.brand, method: item.method, reference: item.reference, evidenced_at: item.evidenced_at, consulted_at: item.consulted_at, estrato: item.estrato }]));
  fs.writeFileSync(path.join(identidad, 'brand-evidence.json'), `${JSON.stringify({ generated_at: generado, margen_minimo: MARGEN_MINIMO, resumen, entradas, conflictos }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(identidad, 'brand-evidence-detalle.json'), `${JSON.stringify({ generated_at: generado, aceptadas, conflictos, pendientes }, null, 2)}\n`, { mode: 0o600 });
  const porEstrato = {};
  for (const item of aceptadas) porEstrato[item.estrato] = (porEstrato[item.estrato] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({ acreditadas: aceptadas.length, por_estrato: porEstrato, conflictos: conflictos.length, resumen }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [comando, argumento] = process.argv.slice(2);
  if (comando === 'fetch') await descargar(argumento);
  else if (comando === 'match') emparejar();
  else throw new Error('Uso: brand-directory.mjs fetch <marca> | match');
}
