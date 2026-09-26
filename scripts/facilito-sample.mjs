#!/usr/bin/env node

// La muestra que se revisa antes de habilitar la publicación de un grupo.
//
// El vínculo es una igualdad exacta de razón social + dirección + distrito, así
// que el emparejamiento en sí no admite opinión: o coincide o no. Lo que una
// revisión sí puede pillar es lo otro —que el establecimiento oficial no sea el
// mismo negocio, que un precio se haya leído mal, que la tabla consultada no sea
// el producto que creemos, o que un rechazo por ambigüedad estuviera
// injustificado— y para eso hace falta ver el texto.
//
// Por eso esta corrida es aparte, local y explícita: vuelve a leer unos pocos
// distritos conservando razón social y dirección, las cruza con lo que la
// composición publicaría y deja una hoja privada. Nada de esto entra en el
// expediente que viaja a la caché de Actions, y a consola solo salen conteos.
//
//   node scripts/facilito-sample.mjs [--group gasolina|diesel|glp] [--districts "ATE,SAN LUIS"] [--size 20]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { officialAnchorFromRegistration } from '../app/official-anchor.mjs';
import { readActivePointer } from '../app/snapshot-manifest.mjs';
import { agentBrowserSession, capturarLima } from '../pipeline/facilito/capture.mjs';
import { facilitoRoot } from '../pipeline/facilito/state.mjs';
import { loadSourceTables } from '../pipeline/gasolina-products.mjs';
import { describeGroup } from '../pipeline/groups.mjs';
import { composeGasolinaProjection, composeGroups, firstActivationBase } from '../pipeline/project-gasolina.mjs';
import { sourceById } from '../pipeline/sources.mjs';
import { PRODUCTS } from '../web/lib/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Un reparto deliberado: dos distritos grandes, uno chico, uno periférico y dos
// de operadores con varias sedes. No es aleatorio y no se presenta como tal.
const DISTRITOS = ['ATE', 'SAN LUIS', 'MIRAFLORES', 'SAN JUAN DE LURIGANCHO', 'PUENTE PIEDRA', 'SANTIAGO DE SURCO'];
// Otras variedades que el CSV registra aparte: las demás de diésel, y en GLP el
// mismo `GLP - G` en kilogramos y los cilindros. No se unen a ninguna vista; en
// la hoja sirven para ver que la tabla consultada calza con el producto
// publicado y no con otro que el mismo establecimiento también reporta.
const PARECIDAS = Object.freeze({ diesel: /diesel|d2|db5|b5/i, glp: /glp/i });

function parseArgs(argv) {
  const opciones = { group: 'gasolina', districts: DISTRITOS, size: 20, excluir: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--group') opciones.group = String(argv[++i] ?? '');
    else if (argv[i] === '--districts') opciones.districts = String(argv[++i] ?? '').split(',').map((d) => d.trim()).filter(Boolean);
    else if (argv[i] === '--size') opciones.size = Number(argv[++i]);
    // Para completar una muestra ya revisada sin repetir lo que ya se miró.
    else if (argv[i] === '--excluir-revisados') opciones.excluir.push(String(argv[++i] ?? ''));
    else throw new Error(`argumento desconocido: ${argv[i]}`);
  }
  if (!Number.isInteger(opciones.size) || opciones.size < 1) throw new Error('tamaño de muestra inválido');
  return opciones;
}

const opciones = parseArgs(process.argv.slice(2));
const grupo = describeGroup(opciones.group);
// Los establecimientos que otra hoja ya revisó. La muestra se completa, no se
// rehace: lo revisado sigue contando.
const yaRevisados = new Set(opciones.excluir.flatMap((archivo) => {
  const hoja = JSON.parse(fs.readFileSync(path.isAbsolute(archivo) ? archivo : path.join(ROOT, archivo), 'utf8'));
  return (hoja.seleccion ?? []).map((item) => item.establishment_id);
}));

// 1. La composición que se publicaría: de ahí salen el vínculo, la identidad
//    publicada y el precio del CSV con su fecha. Antes de su primera activación
//    un grupo nuevo no tiene pointer propio y se compone sobre la base que
//    usaría: el último snapshot aprobado de su fuente.
const base = readActivePointer(ROOT, { group: grupo.key }) ? null : firstActivationBase(ROOT, grupo.key);
if (base && !base.ok) throw new Error(`${grupo.key}: sin snapshot utilizable: ${base.missing.join('; ')}`);
const pointer = base?.pointer ?? readActivePointer(ROOT, { group: grupo.key });
const candidate = grupo.key === 'gasolina'
  ? await composeGasolinaProjection({ root: ROOT })
  : (await composeGroups({ root: ROOT, plan: [{ pointer, groups: [grupo.key] }] }))[grupo.key];
// Todas las ofertas de cada huella, no la última: dos ofertas con la misma
// huella son una ambigüedad del lado oficial y el vínculo las rechaza.
const porHuella = new Map();
for (const key of grupo.products) {
  const offers = new Map(candidate.datasets[key].offers.map((offer) => [offer.id, offer]));
  for (const [offerId, huella] of candidate.results[key].linkKeys) {
    const offer = huella ? offers.get(offerId) : null;
    if (offer) porHuella.set(`${huella}:${key}`, [...(porHuella.get(`${huella}:${key}`) ?? []), offer]);
  }
}

// Lo que cada establecimiento reporta de otras variedades, con el último precio
// de cada una, y con qué actividad reporta el producto publicado. Un grupo de
// Gasolina no tiene variedades que confundir.
const otrasVariantes = new Map();
const actividades = new Map();
if (PARECIDAS[grupo.key]) {
  const minimizedRoot = path.join(ROOT, '.local-cache', 'snapshots', pointer.snapshot_id, 'minimized');
  const { prices } = await loadSourceTables({ source: sourceById(grupo.config.source), minimizedRoot });
  const ultimo = new Map();
  for (const row of prices) {
    // El mismo nombre en otra unidad también es otra variedad: `GLP - G` en kg.
    const publicado = grupo.products.some((key) => PRODUCTS[key].canonical === row.PRODUCTO && PRODUCTS[key].unit === row.UNIDAD);
    if (publicado && Object.hasOwn(grupo.config.activities, row.ACTIVIDAD)) {
      const anchor = officialAnchorFromRegistration(row.REGISTRO_DE_HIDROCARBUROS);
      actividades.set(anchor, new Set([...(actividades.get(anchor) ?? []), grupo.config.activities[row.ACTIVIDAD]]));
    }
    if (!PARECIDAS[grupo.key].test(row.PRODUCTO) || publicado) continue;
    const clave = `${row.REGISTRO_DE_HIDROCARBUROS}|${row.PRODUCTO}|${row.UNIDAD}`;
    const previo = ultimo.get(clave);
    if (!previo || String(row.FECHA_DE_REGISTRO) > String(previo.FECHA_DE_REGISTRO)) ultimo.set(clave, row);
  }
  for (const row of ultimo.values()) {
    const anchor = officialAnchorFromRegistration(row.REGISTRO_DE_HIDROCARBUROS);
    otrasVariantes.set(anchor, [...(otrasVariantes.get(anchor) ?? []), { producto: row.PRODUCTO, unidad: row.UNIDAD, precio: Number(String(row.PRECIO_DE_VENTA_SOLES).replace(',', '.')), reportado: row.FECHA_DE_REGISTRO }]);
  }
}

// 2. La lectura con texto, que es la única parte que no se puede revisar a
//    ciegas. Vive en esta corrida y en la hoja; no toca el expediente.
const lectura = capturarLima({
  ejecutar: agentBrowserSession({ cwd: ROOT, session: `facilito-muestra-${process.pid}-${Date.now()}` }),
  log: (linea) => process.stderr.write(`${linea}\n`),
  soloDistritos: opciones.districts,
  soloProductos: grupo.products,
  conTexto: true,
});

const vinculadas = [];
const sinPar = [];
const ambiguas = [];
for (const unidad of lectura.units) {
  if (unidad.status !== 'ok') continue;
  // Una huella que se repite en la misma tabla es ambigua del lado de la consulta.
  const repetidas = new Map();
  for (const fila of unidad.rows) repetidas.set(fila.key_hash, (repetidas.get(fila.key_hash) ?? 0) + 1);
  for (const fila of unidad.rows) {
    const pares = porHuella.get(`${fila.key_hash}:${unidad.product}`) ?? [];
    const comun = {
      distrito: unidad.district_name,
      producto: unidad.product,
      facilito: { razon_social: fila.establecimiento, direccion: fila.direccion, precio: fila.price, observado_en: unidad.observed_at },
    };
    if (repetidas.get(fila.key_hash) > 1 || pares.length > 1) {
      ambiguas.push({ ...comun, filas_con_la_huella: repetidas.get(fila.key_hash), ofertas_con_la_huella: pares.map((offer) => ({ establishment_id: offer.establishment_id, direccion: offer.address, precio_csv: offer.price })) });
      continue;
    }
    if (!pares.length) { sinPar.push(comun); continue; }
    const [offer] = pares;
    vinculadas.push({
      ...comun,
      establishment_id: offer.establishment_id,
      publicado: { nombre: offer.commercial_identity?.public_site_name ?? null, marca: offer.commercial_identity?.brand ?? null, direccion: offer.address },
      csv: { precio: offer.price, reportado_en: offer.reported_at },
      // Lo que la capa publicaría hoy para esa oferta, que puede venir de una
      // captura anterior a esta lectura: verlo separado evita confundir «el
      // precio cambió entre las dos lecturas» con «el vínculo está mal».
      capa_publicada: offer.facilito,
      diferencia: Number((fila.price - offer.price).toFixed(4)),
      ...(PARECIDAS[grupo.key] ? { actividad: [...(actividades.get(offer.establishment_id) ?? [])].sort().join('/') || null, otras_variantes_en_csv: otrasVariantes.get(offer.establishment_id) ?? [] } : {}),
    });
  }
}

// 3. Reparto estable, por distrito Y producto. Agrupar solo por distrito dejaba
//    la muestra entera en un producto, porque dentro de cada distrito el orden
//    ponía primero a uno de los dos. Dentro de cada grupo mandan las diferencias
//    de precio, que es donde un error se nota.
//
//    En GLP el riesgo no está en el producto sino en el establecimiento: las
//    estaciones con gasocentro (02/06) y los gasocentros puros (15) se cruzan
//    con capas distintas, y quien también reporta kg o cilindros podría tener en
//    la consulta el precio de otra presentación. El reparto es por esos estratos.
const estrato = (item) => (grupo.key === 'glp'
  ? `${item.actividad?.split('/').includes('15') ? '15' : '02/06'}:${item.otras_variantes_en_csv.length ? 'con_variantes' : 'sin_variantes'}`
  : `${item.distrito}:${item.producto}`);
const grupos = new Map();
for (const item of [...vinculadas].sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))) {
  const clave = estrato(item);
  grupos.set(clave, [...(grupos.get(clave) ?? []), item]);
}
// Un establecimiento aparece en varios productos, así que sin deduplicar una
// muestra de 20 filas puede cubrir 15 grifos distintos. Lo que se revisa es el
// grifo, no la fila: se cuenta una vez cada uno.
const claves = [...grupos.keys()].sort();
const seleccion = [];
const vistos = new Set(yaRevisados);
let vuelta = 0;
while (seleccion.length < opciones.size && vuelta < 200) {
  for (const clave of claves) {
    const item = grupos.get(clave)[vuelta];
    if (!item || seleccion.length >= opciones.size || vistos.has(item.establishment_id)) continue;
    vistos.add(item.establishment_id);
    seleccion.push(item);
  }
  vuelta += 1;
}

// La comparación de precios de TODO lo vinculado, no solo de la muestra. Si la
// tabla consultada fuera otra variedad que el mismo grifo vende, las diferencias
// serían sistemáticas; con el mismo producto, un reporte reciente del CSV y la
// consulta de hoy suelen coincidir al céntimo.
const diferencias = vinculadas.map((item) => ({ d: Math.abs(item.diferencia), horas: (Date.parse(item.facilito.observado_en) - Date.parse(item.csv.reportado_en)) / 3_600_000 }));
function resumir(lista) {
  const ds = lista.map((item) => item.d).sort((a, b) => a - b);
  const cuantil = (p) => (ds.length ? ds[Math.min(ds.length - 1, Math.floor(p * ds.length))] : null);
  return { n: ds.length, iguales: ds.filter((d) => d === 0).length, hasta_10_centimos: ds.filter((d) => d <= 0.1).length, mediana: cuantil(0.5), p90: cuantil(0.9), maxima: ds.at(-1) ?? null };
}
const comparacion = { todas: resumir(diferencias), reporte_csv_hasta_72h: resumir(diferencias.filter((item) => item.horas <= 72)) };

const cuenta = (lista) => Object.fromEntries([...lista.reduce((mapa, item) => mapa.set(estrato(item), (mapa.get(estrato(item)) ?? 0) + 1), new Map())].sort());
const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
const destino = path.join(facilitoRoot(ROOT), `muestra-${grupo.key === 'gasolina' ? '' : `${grupo.key}-`}${stamp}.json`);
const hoja = {
  generado_en: new Date().toISOString(),
  grupo: grupo.key,
  revision_compuesta: candidate.manifest.revision_id,
  criterio: 'razón social + dirección + distrito exactos y únicos en ambos sentidos; normalización de mayúsculas, tildes y espacios',
  distritos: opciones.districts,
  poblacion: { vinculadas: vinculadas.length, establecimientos_vinculados: new Set(vinculadas.map((item) => item.establishment_id)).size, sin_par_oficial: sinPar.length, ambiguas: ambiguas.length, por_estrato: cuenta(vinculadas) },
  comparacion_precios: comparacion,
  ya_revisados_en_otra_hoja: [...yaRevisados],
  // Quién revisa y qué resolvió se escribe DESPUÉS, al revisar. Se deja el hueco
  // para que la hoja no se confunda con una revisión ya hecha.
  revision: { revisor: null, revisado_en: null, veredictos: {} },
  seleccion,
  // Los rechazos por ambigüedad se revisan todos: uno injustificado es un
  // precio que se deja de publicar sin motivo.
  ambiguas,
  sin_par_oficial: sinPar.slice(0, 20),
};
fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
fs.writeFileSync(destino, `${JSON.stringify(hoja, null, 2)}\n`, { mode: 0o600 });

process.stdout.write(`${JSON.stringify({
  hoja: path.relative(ROOT, destino),
  grupo: grupo.key,
  distritos: opciones.districts.length,
  unidades_leidas: lectura.units.filter((u) => u.status === 'ok').length,
  vinculadas: vinculadas.length,
  ambiguas: ambiguas.length,
  sin_par_oficial: sinPar.length,
  muestra: seleccion.length,
  establecimientos_distintos: new Set(seleccion.map((item) => item.establishment_id)).size,
  excluidos_por_ya_revisados: yaRevisados.size,
  con_diferencia_de_precio: seleccion.filter((item) => item.diferencia !== 0).length,
  con_otras_variantes: seleccion.filter((item) => item.otras_variantes_en_csv?.length).length,
  comparacion_precios: comparacion,
  por_producto: Object.fromEntries(grupo.products.map((key) => [key, seleccion.filter((item) => item.producto === key).length])),
  vinculadas_por_estrato: cuenta(vinculadas),
  muestra_por_estrato: cuenta(seleccion),
  distritos_en_la_muestra: new Set(seleccion.map((item) => item.distrito)).size,
  bloqueo: lectura.blocked,
}, null, 2)}\n`);
process.stdout.write('PRIVADO: la hoja contiene razón social y dirección. No commitear.\n');
