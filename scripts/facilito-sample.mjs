#!/usr/bin/env node

// La muestra que se revisa antes de habilitar la publicación.
//
// El vínculo es una igualdad exacta de razón social + dirección + distrito, así
// que el emparejamiento en sí no admite opinión: o coincide o no. Lo que una
// revisión humana sí puede pillar es lo otro —que el establecimiento oficial no
// sea el mismo negocio, que un precio se haya leído mal, o que un rechazo por
// ambigüedad estuviera injustificado— y para eso hace falta ver el texto.
//
// Por eso esta corrida es aparte, local y explícita: vuelve a leer unos pocos
// distritos conservando razón social y dirección, las cruza con lo que la
// composición publicaría y deja una hoja privada. Nada de esto entra en el
// expediente que viaja a la caché de Actions, y a consola solo salen conteos.
//
//   node scripts/facilito-sample.mjs [--districts "ATE,SAN LUIS"] [--size 20]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentBrowserSession, capturarLima } from '../pipeline/facilito/capture.mjs';
import { facilitoRoot } from '../pipeline/facilito/state.mjs';
import { composeGasolinaProjection } from '../pipeline/project-gasolina.mjs';
import { GASOLINA_KEYS } from '../pipeline/gasolina-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Un reparto deliberado: dos distritos grandes, uno chico, uno periférico y dos
// de operadores con varias sedes. No es aleatorio y no se presenta como tal.
const DISTRITOS = ['ATE', 'SAN LUIS', 'MIRAFLORES', 'SAN JUAN DE LURIGANCHO', 'PUENTE PIEDRA', 'SANTIAGO DE SURCO'];

function parseArgs(argv) {
  const opciones = { districts: DISTRITOS, size: 20, excluir: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--districts') opciones.districts = String(argv[++i] ?? '').split(',').map((d) => d.trim()).filter(Boolean);
    else if (argv[i] === '--size') opciones.size = Number(argv[++i]);
    // Para completar una muestra ya revisada sin repetir lo que ya se miró.
    else if (argv[i] === '--excluir-revisados') opciones.excluir.push(String(argv[++i] ?? ''));
    else throw new Error(`argumento desconocido: ${argv[i]}`);
  }
  if (!Number.isInteger(opciones.size) || opciones.size < 1) throw new Error('tamaño de muestra inválido');
  return opciones;
}

const opciones = parseArgs(process.argv.slice(2));
// Los establecimientos que otra hoja ya revisó. La muestra se completa, no se
// rehace: lo revisado sigue contando.
const yaRevisados = new Set(opciones.excluir.flatMap((archivo) => {
  const hoja = JSON.parse(fs.readFileSync(path.isAbsolute(archivo) ? archivo : path.join(ROOT, archivo), 'utf8'));
  return (hoja.seleccion ?? []).map((item) => item.establishment_id);
}));

// 1. La composición que se publicaría: de ahí salen el vínculo, la identidad
//    publicada y el precio del CSV con su fecha.
const candidate = await composeGasolinaProjection({ root: ROOT });
const porHuella = new Map();
for (const key of GASOLINA_KEYS) {
  const offers = new Map(candidate.datasets[key].offers.map((offer) => [offer.id, offer]));
  for (const [offerId, huella] of candidate.results[key].linkKeys) {
    if (!huella) continue;
    const offer = offers.get(offerId);
    if (offer) porHuella.set(`${huella}:${key}`, { producto: key, offer });
  }
}

// 2. La lectura con texto, que es la única parte que no se puede revisar a
//    ciegas. Vive en esta corrida y en la hoja; no toca el expediente.
const lectura = capturarLima({
  ejecutar: agentBrowserSession({ cwd: ROOT, session: `facilito-muestra-${process.pid}-${Date.now()}` }),
  log: (linea) => process.stderr.write(`${linea}\n`),
  soloDistritos: opciones.districts,
  conTexto: true,
});

const vinculadas = [];
const sinPar = [];
for (const unidad of lectura.units) {
  if (unidad.status !== 'ok') continue;
  for (const fila of unidad.rows) {
    const par = porHuella.get(`${fila.key_hash}:${unidad.product}`);
    const comun = {
      distrito: unidad.district_name,
      producto: unidad.product,
      facilito: { razon_social: fila.establecimiento, direccion: fila.direccion, precio: fila.price, observado_en: unidad.observed_at },
    };
    if (!par) { sinPar.push(comun); continue; }
    vinculadas.push({
      ...comun,
      establishment_id: par.offer.establishment_id,
      publicado: { nombre: par.offer.commercial_identity?.public_site_name ?? null, marca: par.offer.commercial_identity?.brand ?? null, direccion: par.offer.address },
      csv: { precio: par.offer.price, reportado_en: par.offer.reported_at },
      // Lo que la capa publicaría hoy para esa oferta, que puede venir de una
      // captura anterior a esta lectura: verlo separado evita confundir «el
      // precio cambió entre las dos lecturas» con «el vínculo está mal».
      capa_publicada: par.offer.facilito,
      diferencia: Number((fila.price - par.offer.price).toFixed(4)),
    });
  }
}

// 3. Reparto estable, por distrito Y producto. Agrupar solo por distrito dejaba
//    la muestra entera en un producto, porque dentro de cada distrito el orden
//    ponía primero a uno de los dos. Dentro de cada grupo mandan las diferencias
//    de precio, que es donde un error se nota.
const grupos = new Map();
for (const item of [...vinculadas].sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))) {
  const clave = `${item.distrito}:${item.producto}`;
  grupos.set(clave, [...(grupos.get(clave) ?? []), item]);
}
// Un establecimiento aparece en los dos productos, así que sin deduplicar una
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

const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
const destino = path.join(facilitoRoot(ROOT), `muestra-${stamp}.json`);
const hoja = {
  generado_en: new Date().toISOString(),
  revision_compuesta: candidate.manifest.revision_id,
  criterio: 'razón social + dirección + distrito exactos y únicos en ambos sentidos; normalización de mayúsculas, tildes y espacios',
  distritos: opciones.districts,
  poblacion: { vinculadas: vinculadas.length, establecimientos_vinculados: new Set(vinculadas.map((item) => item.establishment_id)).size, sin_par_oficial: sinPar.length },
  ya_revisados_en_otra_hoja: [...yaRevisados],
  // Quién revisa y qué resolvió se escribe DESPUÉS, al revisar. Se deja el hueco
  // para que la hoja no se confunda con una revisión ya hecha.
  revision: { revisor: null, revisado_en: null, veredictos: {} },
  seleccion,
  sin_par_oficial: sinPar.slice(0, 20),
};
fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
fs.writeFileSync(destino, `${JSON.stringify(hoja, null, 2)}\n`, { mode: 0o600 });

process.stdout.write(`${JSON.stringify({
  hoja: path.relative(ROOT, destino),
  distritos: opciones.districts.length,
  unidades_leidas: lectura.units.filter((u) => u.status === 'ok').length,
  vinculadas: vinculadas.length,
  sin_par_oficial: sinPar.length,
  muestra: seleccion.length,
  establecimientos_distintos: new Set(seleccion.map((item) => item.establishment_id)).size,
  excluidos_por_ya_revisados: yaRevisados.size,
  con_diferencia_de_precio: seleccion.filter((item) => item.diferencia !== 0).length,
  por_producto: Object.fromEntries(GASOLINA_KEYS.map((key) => [key, seleccion.filter((item) => item.producto === key).length])),
  distritos_en_la_muestra: new Set(seleccion.map((item) => item.distrito)).size,
  bloqueo: lectura.blocked,
}, null, 2)}\n`);
process.stdout.write('PRIVADO: la hoja contiene razón social y dirección. No commitear.\n');
