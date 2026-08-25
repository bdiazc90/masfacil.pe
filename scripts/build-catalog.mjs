#!/usr/bin/env node
// Construye el catálogo de identidad comercial y su auditoría a partir de los
// emparejamientos y de los veredictos del owner.
//
// Dos tiers, por la fuerza de la evidencia sobre el NOMBRE:
//   verified  corroboración ajena a la distancia (número de puerta, razón
//             social o marca del operador) + margen frente a otro establecimiento
//   nearby    solo cercanía comprobada (<=40 m); la interfaz lo marca
//
// La marca solo se publica cuando la razón social la respalda. Google permite
// editar el nombre de una ficha, así que un "REPSOL" ahí dentro no prueba que la
// estación esté abanderada: el letrero de GSI en Chorrillos lo demostró.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_SCHEMA_VERSION } from '../app/commercial-catalog.mjs';
import { AUDIT_SCHEMA_VERSION, commercialEntrySha256, wilsonLowerBound } from '../app/commercial-audit.mjs';
import { OFFICIAL_ANCHOR_SCHEME } from '../app/official-anchor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identidad = path.join(root, '.local-cache', 'identity');
const RADIO_NEARBY = 40;
const UMBRALES = { verified: 0.80, nearby: 0.70 };
const RESPONSABLE = 'Bruno Diaz';
const OBSERVADO = '2026-08-23T20:00:00.000-05:00';
const REVISADO = '2026-08-24T13:00:00.000-05:00';

const sinTildes = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const MARCAS = ['Primax', 'Repsol', 'Pecsa', 'Petroperú', 'Petroperu', 'Terpel', 'Coesti'];
const OPERADORES = [[/\bCOESTI\b/, 'Primax'], [/\bPERUANA DE ESTACIONES DE SERVICIO\b|\bPECSA\b/, 'Pecsa'], [/\bREPSOL\b/, 'Repsol'], [/\bPETROPERU\b|\bPETROLEOS DEL PERU\b/, 'Petroperú'], [/\bPRIMAX\b/, 'Primax']];
const marcaDelOperador = (razonSocial) => OPERADORES.find(([patron]) => patron.test(sinTildes(razonSocial)))?.[1] ?? null;
const marcaEnNombre = (nombre) => MARCAS.find((marca) => sinTildes(nombre).includes(sinTildes(marca))) ?? null;

const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'el', 'en', 'con', 'a']);
const FORMAS_LEGALES = /^(s\.?a\.?c?\.?|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|ltda\.?)$/i;
// Palabras que no distinguen: si al quitar la marca solo queda esto, no hay
// nombre que publicar.
const GENERICAS = new Set(['grifo', 'grifos', 'estacion', 'estación', 'estaciones', 'servicio', 'servicios', 'gasolinera', 'combustible', 'combustibles', 'gas', 'gnv', 'glp', 'de', 'del', 'la', 'el', 'y', 'ee.ss', 'eess']);

function recasear(texto) {
  // Solo se re-escribe lo que viene GRITADO o todo en minúsculas: 98 y 3 casos.
  // El casing mixto de Google suele ser intencional —"GaSpetrol", "AHV"— y
  // tocarlo destruye información.
  const gritado = texto === texto.toLocaleUpperCase('es-PE') && /[A-ZÁÉÍÓÚÑ]/.test(texto);
  const susurrado = texto === texto.toLocaleLowerCase('es-PE');
  if (!gritado && !susurrado) return texto;
  return texto.split(' ').filter(Boolean).map((palabra, indice) => {
    const minuscula = palabra.toLocaleLowerCase('es-PE');
    if (FORMAS_LEGALES.test(palabra)) return palabra.toLocaleUpperCase('es-PE');
    if (indice > 0 && MINUSCULAS.has(minuscula)) return minuscula;
    // Sigla corta sin puntos: GSI, AVA, GNV, KYT. Capitalizarlas las destruye.
    if (gritado && palabra.length <= 4 && !/[.]/.test(palabra) && !MINUSCULAS.has(minuscula)) return palabra;
    return `${minuscula[0].toLocaleUpperCase('es-PE')}${minuscula.slice(1)}`;
  }).join(' ');
}

function nombreParaPantalla(bruto, marcaSoportada) {
  let texto = String(bruto ?? '').replace(/\s+/g, ' ').trim();
  const marca = marcaEnNombre(texto);
  // Una marca que nadie respalda se retira: publicarla le atribuiría al negocio
  // una bandera que quizá no tiene. El letrero de GSI en Chorrillos lo mostró.
  if (marca && !marcaSoportada) {
    texto = texto.replace(new RegExp(`\\s*\\b${marca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*`, 'gi'), ' ');
    texto = texto.replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').replace(/^[-·,(\s]+|[-·,(\s]+$/g, '').trim();
    // Si lo que queda no distingue nada —"Grifo", "Estación de Servicio"— es
    // preferible no publicar nombre a publicar una palabra genérica.
    const distintivas = texto.split(/[\s.,()"]+/).filter((p) => p && !GENERICAS.has(p.toLocaleLowerCase('es-PE')) && !FORMAS_LEGALES.test(p));
    if (!distintivas.length) return null;
  }
  // Google añade «gnv»/«glp» al final como si fuera parte del nombre. Se retira
  // solo cuando lo que queda sigue distinguiendo al grifo: «El Cortijo gnv» pasa
  // a «El Cortijo», pero «Grifo GNV» se queda, porque «Grifo» solo no es nombre.
  const sinCola = texto.replace(/[\s·,-]*\b(?:gnv|glp)\b\s*$/i, '').trim();
  if (sinCola !== texto) {
    const queda = sinCola.split(/[\s.,()"]+/).filter((p) => p && !GENERICAS.has(p.toLocaleLowerCase('es-PE')) && !FORMAS_LEGALES.test(p));
    if (queda.length) texto = sinCola;
  }
  if (!texto) return null;
  const salida = recasear(texto);
  return salida.length > 44 ? `${salida.slice(0, 43).replace(/[\s,]+\S*$/, '')}…` : salida;
}

const matches = JSON.parse(fs.readFileSync(path.join(identidad, 'matches.json'), 'utf8'));
const veredictos = JSON.parse(fs.readFileSync(path.join(identidad, 'veredictos.json'), 'utf8')).entradas;
const veredictosCandidatos = fs.existsSync(path.join(identidad, 'veredictos-candidatos.json'))
  ? JSON.parse(fs.readFileSync(path.join(identidad, 'veredictos-candidatos.json'), 'utf8')).entradas.map((x) => ({ establishment_id: x.id, result: x.r, selection_reason: 'risk_sample' }))
  : [];

const tierDe = (r) => (r.estado === 'verified' ? 'verified' : (r.estado === 'candidate' && r.distancia_m <= RADIO_NEARBY ? 'nearby' : null));
const publicables = matches.resultados.filter((r) => tierDe(r));

function construirEntrada(r) {
  const confidence = tierDe(r);
  const operador = marcaDelOperador(r.razon_social);
  const marca = marcaEnNombre(r.nombre_maps);
  const marcaSoportada = Boolean(marca && operador && sinTildes(marca) === sinTildes(operador));
  const nombre = nombreParaPantalla(r.nombre_maps, marcaSoportada);
  if (!nombre) return null;
  const señales = r.señales.map((s) => s.tipo).join('+') || 'proximidad';
  return {
    establishment_id: r.establishment_id,
    brand: marcaSoportada ? operador : null,
    public_site_name: nombre,
    confidence,
    source: {
      kind: 'public_web_observed',
      source_or_description: `Google Maps ${r.place_id} · ${r.distancia_m} m · ${señales}`,
      acquisition_method: 'public_web_review',
      observed_at: OBSERVADO,
      responsible: RESPONSABLE,
    },
    entity_link: { method: 'official_establishment_id_exact', status: 'verified', verified_at: REVISADO },
    identity_freshness: 'current',
    publication: { status: 'publishable', reviewed_at: REVISADO, responsible: RESPONSABLE },
  };
}

const entradas = publicables.map(construirEntrada).filter(Boolean);
// Correcciones del owner sobre lo que el algoritmo propuso. La razón social no
// respalda la marca, pero Bruno la ve en el letrero: es un abanderado, y la vía
// para eso es owner_verified, igual que Primax Granada.
const OWNER_OVERRIDES = new Map([
  ['est_05db4a610415de20ebbc5a14', {
    brand: 'Primax',
    public_site_name: 'El Cortijo',
    description: 'Bandera Primax visible en el letrero, confirmada por el owner de forma presencial. Av. República de Panamá 6901, Santiago de Surco. Registro 9573-107-130426.',
    observed_at: '2026-08-25T09:00:00.000-05:00',
  }],
]);
for (const entrada of entradas) {
  const fix = OWNER_OVERRIDES.get(entrada.establishment_id);
  if (!fix) continue;
  entrada.brand = fix.brand;
  entrada.public_site_name = fix.public_site_name;
  entrada.confidence = 'verified';
  entrada.source = { kind: 'owner_verified', source_or_description: fix.description, acquisition_method: 'direct_observation', observed_at: fix.observed_at, responsible: RESPONSABLE };
  // El vínculo y la publicación no pueden ser anteriores a la observación que
  // los sustenta; el contrato lo exige y tiene razón.
  entrada.entity_link = { ...entrada.entity_link, verified_at: fix.observed_at };
  entrada.publication = { ...entrada.publication, reviewed_at: fix.observed_at };
}
const catalogo = {
  schema_version: CATALOG_SCHEMA_VERSION,
  catalog_id: 'commercial-identity-catalog-2026-08-24',
  anchor_scheme: OFFICIAL_ANCHOR_SCHEME,
  entries: entradas,
};

// La auditoría solo puede hablar de entradas que existan en el catálogo.
const porAnchor = new Map(entradas.map((e) => [e.establishment_id, e]));
const revisadas = [...veredictos, ...veredictosCandidatos]
  .filter((v) => porAnchor.has(v.establishment_id))
  .map((v) => {
    const entrada = porAnchor.get(v.establishment_id);
    return {
      establishment_id: v.establishment_id,
      entry_sha256: commercialEntrySha256(entrada),
      confidence: entrada.confidence,
      selection_reason: v.selection_reason ?? 'random_sample',
      reviewer: RESPONSABLE,
      reviewed_at: REVISADO,
      result: v.result,
    };
  });

const tiers = ['verified', 'nearby'].map((confidence) => {
  const poblacion = entradas.filter((e) => e.confidence === confidence).length;
  const muestra = revisadas.filter((r) => r.confidence === confidence);
  const correctas = muestra.filter((r) => r.result === 'verified').length;
  return {
    confidence,
    population: poblacion,
    sampled: muestra.length,
    correct: correctas,
    lower_bound_95: Number(wilsonLowerBound(correctas, muestra.length).toFixed(3)),
    threshold: UMBRALES[confidence],
    reviewer: RESPONSABLE,
    reviewed_at: REVISADO,
  };
}).filter((t) => t.population > 0);

const auditoria = { schema_version: AUDIT_SCHEMA_VERSION, audit_id: 'commercial-identity-audit-2026-08-24', catalog_id: catalogo.catalog_id, tiers, entries: revisadas };

fs.writeFileSync(path.join(identidad, 'commercial-identity-catalog.json'), `${JSON.stringify(catalogo, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(identidad, 'commercial-identity-audit.json'), `${JSON.stringify(auditoria, null, 2)}\n`, { mode: 0o600 });

const conMarca = entradas.filter((e) => e.brand).length;
const limpiados = publicables.filter((r) => marcaEnNombre(r.nombre_maps) && !(marcaDelOperador(r.razon_social) && sinTildes(marcaEnNombre(r.nombre_maps)) === sinTildes(marcaDelOperador(r.razon_social)))).length;
process.stdout.write(`Catálogo         ${entradas.length} entradas de 717 (${(entradas.length / 717 * 100).toFixed(1)} %)
  verified       ${entradas.filter((e) => e.confidence === 'verified').length}
  nearby         ${entradas.filter((e) => e.confidence === 'nearby').length}

Marca publicada  ${conMarca}   (respaldada por la razón social)
Nombres limpiados ${limpiados}  (marca sin respaldo retirada del nombre)

Auditoría
${tiers.map((t) => `  ${t.confidence.padEnd(9)} ${t.correct}/${t.sampled} correctos · cota ${(t.lower_bound_95 * 100).toFixed(1)} % · umbral ${(t.threshold * 100).toFixed(0)} % ${t.lower_bound_95 >= t.threshold ? '✅' : '❌'}`).join('\n')}
`);
