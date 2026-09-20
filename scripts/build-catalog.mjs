#!/usr/bin/env node
// Construye el catálogo de identidad comercial y su auditoría a partir de los
// emparejamientos y de los veredictos del owner.
//
// Dos tiers, por la fuerza de la evidencia sobre el NOMBRE:
//   verified  corroboración ajena a la distancia (número de puerta, razón
//             social o marca del operador) + margen frente a otro establecimiento
//   nearby    solo cercanía comprobada (<=40 m); la interfaz lo marca
//
// La marca solo se publica cuando la respalda el directorio oficial de la cadena
// o, sin directorio, cuando la razón social del operador dice lo mismo que el
// nombre visible. Google permite editar el nombre de una ficha, así que un
// "REPSOL" ahí dentro no prueba que la estación esté abanderada: el letrero de
// GSI en Chorrillos lo demostró. La marca emitida es exactamente la que respalda
// la evidencia; la razón social corrobora, nunca sustituye la del directorio.
//
// `IDENTITY_ROOT` construye sobre una copia del expediente. Si existe
// `base/commercial-identity-catalog.json` —el catálogo publicado—, un conflicto
// conserva la marca que ya estaba respaldada y un nombre revisado no cambia por
// añadir una bandera. Nada se escribe si el resultado incumple su contrato.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_SCHEMA_VERSION, validateCommercialCatalog } from '../app/commercial-catalog.mjs';
import { AUDIT_SCHEMA_VERSION, BRAND_THRESHOLD, commercialClaimSha256, commercialNameBacking, validateCommercialAudit, wilsonLowerBound } from '../app/commercial-audit.mjs';
import { OFFICIAL_ANCHOR_SCHEME } from '../app/official-anchor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identidad = path.resolve(root, process.env.IDENTITY_ROOT || path.join('.local-cache', 'identity'));
const RADIO_NEARBY = 40;
const UMBRALES = { verified: 0.80, nearby: 0.70 };
const RESPONSABLE = 'Bruno Diaz';
const OBSERVADO = '2026-08-23T20:00:00.000-05:00';
const REVISADO = '2026-08-24T13:00:00.000-05:00';
// La revisión de bandera es posterior y propia: no reutiliza la fecha del
// nombre, para que se vea cuándo se acreditó cada afirmación.
const REVISADO_MARCA = process.env.REVISADO_MARCA ?? '2026-09-06T12:00:00.000-05:00';
const CATALOG_ID = process.env.CATALOG_ID ?? 'commercial-identity-catalog-2026-08-24';
const AUDIT_ID = process.env.AUDIT_ID ?? 'commercial-identity-audit-2026-08-24';

const sinTildes = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const misma = (a, b) => Boolean(a && b) && sinTildes(a) === sinTildes(b);
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

const VARIANTES = Object.freeze({ A: 'aáàäâ', E: 'eéèëê', I: 'iíìïî', O: 'oóòöô', U: 'uúùüû', N: 'nñ' });
const patronDeMarca = (marca) => sinTildes(marca).split('').map((letra) => (VARIANTES[letra] ? `[${VARIANTES[letra]}]` : letra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
const soloGenerico = (texto) => !String(texto ?? '').split(/[\s.,()"]+/).filter((p) => p && !GENERICAS.has(p.toLocaleLowerCase('es-PE')) && !FORMAS_LEGALES.test(p) && !MARCAS.some((marca) => sinTildes(marca) === sinTildes(p))).length;

function nombreParaPantalla(bruto, marcaSoportada) {
  let texto = String(bruto ?? '').replace(/\s+/g, ' ').trim();
  const marca = marcaEnNombre(texto);
  // Una marca que nadie respalda se retira: publicarla le atribuiría al negocio
  // una bandera que quizá no tiene. El letrero de GSI en Chorrillos lo mostró.
  if (marca && !marcaSoportada) {
    // Sin distinguir tildes: `\b` no reconoce la «ú» como letra y «Petroperú»
    // sobrevivía entera en el nombre de sedes sin bandera acreditada.
    texto = texto.replace(new RegExp(`\\s*(?<![\\p{L}\\p{N}])${patronDeMarca(marca)}(?![\\p{L}\\p{N}])\\s*`, 'giu'), ' ');
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
// Evidencia de bandera acreditada aparte del nombre: directorio oficial vigente
// o letrero observado. Sin archivo, ninguna marca obtiene logo y todo sigue
// publicándose como hasta ahora.
const expedienteDeMarca = fs.existsSync(path.join(identidad, 'brand-evidence.json'))
  ? JSON.parse(fs.readFileSync(path.join(identidad, 'brand-evidence.json'), 'utf8'))
  : { entradas: {}, conflictos: [] };
const evidenciaDeMarca = new Map(Object.entries(expedienteDeMarca.entradas));
// Establecimientos que dos directorios, o un directorio y la razón social de otra
// cadena, reclaman con banderas distintas. No se acreditan con esa evidencia.
const conflictosDeDirectorio = new Map((expedienteDeMarca.conflictos ?? []).map((conflicto) => [conflicto.establishment_id, conflicto]));
// El catálogo publicado: lo que ya estaba respaldado antes de este cambio.
const rutaBase = process.env.CATALOGO_BASE ? path.resolve(root, process.env.CATALOGO_BASE) : path.join(identidad, 'base', 'commercial-identity-catalog.json');
const base = fs.existsSync(rutaBase) ? new Map(JSON.parse(fs.readFileSync(rutaBase, 'utf8')).entries.map((entrada) => [entrada.establishment_id, entrada])) : null;
const rutaAuditoriaBase = path.join(path.dirname(rutaBase), 'commercial-identity-audit.json');
const auditoriaBase = base && fs.existsSync(rutaAuditoriaBase) ? JSON.parse(fs.readFileSync(rutaAuditoriaBase, 'utf8')) : null;
const evidenciaBase = base && fs.existsSync(path.join(path.dirname(rutaBase), 'brand-evidence.json')) ? JSON.parse(fs.readFileSync(path.join(path.dirname(rutaBase), 'brand-evidence.json'), 'utf8')).entradas ?? {} : {};
// Veredictos de BANDERA. Son otra afirmación que la del nombre y por eso viven
// en su propio archivo: un visto bueno al nombre nunca acredita la marca.
const veredictosMarca = fs.existsSync(path.join(identidad, 'veredictos-marca.json'))
  ? JSON.parse(fs.readFileSync(path.join(identidad, 'veredictos-marca.json'), 'utf8')).entradas.map((x) => ({ establishment_id: x.id, result: x.r, selection_reason: x.motivo ?? 'random_sample', marca: x.marca ?? null, revisor: x.revisor ?? null, revisado_en: x.revisado_en ?? null }))
  : [];

const tierDe = (r) => (r.estado === 'verified' ? 'verified' : (r.estado === 'candidate' && r.distancia_m <= RADIO_NEARBY ? 'nearby' : null));

// Choque: el nombre en Maps o la razón social dicen otra marca que la del
// directorio. En la revisión del 17/09 la mitad de esos casos resultó falsa —un
// padrón viejo, una bandera Pecsa que Primax aún lista—, mientras la muestra al
// azar salió entera correcta. Sin un veredicto del owner que confirme la marca
// del directorio, un choque no se acredita: queda en conflicto y se conserva la
// marca anterior hasta resolverlo.
const PALABRAS_DE_MARCA = [['PRIMAX', 'Primax'], ['COESTI', 'Primax'], ['REPSOL', 'Repsol'], ['PECSA', 'Pecsa'], ['PETROPERU', 'Petroperú'], ['TERPEL', 'Terpel'], ['AVA', 'AVA'], ['ENERGIGAS', 'Energigas']];
const marcasEn = (texto) => [...new Set(PALABRAS_DE_MARCA.filter(([palabra]) => new RegExp(`\\b${palabra}\\b`).test(sinTildes(texto))).map(([, marca]) => marca))];
const filaDeMatches = new Map(matches.resultados.map((r) => [r.establishment_id, r]));
function choqueCon(establishmentId, marca) {
  const fila = filaDeMatches.get(establishmentId);
  if (!fila) return null;
  const enNombre = marcasEn(fila.nombre_maps);
  if (enNombre.length && !enNombre.some((otra) => misma(otra, marca))) return enNombre[0];
  const operador = marcaDelOperador(fila.razon_social);
  return operador && !misma(operador, marca) ? operador : null;
}
const veredictoDeMarca = (establishmentId, marca, resultado) => veredictosMarca.some((v) => v.establishment_id === establishmentId && v.result === resultado && (!v.marca || misma(v.marca, marca)));
for (const [establishmentId, evidencia] of [...evidenciaDeMarca]) {
  const otra = choqueCon(establishmentId, evidencia.brand);
  if (!otra || veredictoDeMarca(establishmentId, evidencia.brand, 'verified')) continue;
  evidenciaDeMarca.delete(establishmentId);
  conflictosDeDirectorio.set(establishmentId, {
    establishment_id: establishmentId,
    motivo: veredictoDeMarca(establishmentId, evidencia.brand, 'incorrect') ? 'choque_rechazado_por_owner' : 'choque_sin_revisar',
    marcas: [evidencia.brand, otra],
    propuesta: { brand: evidencia.brand, reference: evidencia.reference, estrato: evidencia.estrato ?? null },
  });
}
// Un estrato sin ninguna revisión al azar no se publica: AGENTS.md prohíbe
// publicar un tier cuya precisión no se muestreó. Basta una revisión para que el
// estrato se declare; su cota se informa y no decide. Mientras tanto la evidencia
// queda retenida y se conserva la marca anterior.
const estratosMuestreados = new Set(veredictosMarca
  .filter((v) => v.selection_reason === 'random_sample' && ['verified', 'incorrect'].includes(v.result))
  .map((v) => evidenciaDeMarca.get(v.establishment_id)?.estrato)
  .filter(Boolean));
for (const [establishmentId, evidencia] of [...evidenciaDeMarca]) {
  if (!evidencia.estrato || estratosMuestreados.has(evidencia.estrato)) continue;
  evidenciaDeMarca.delete(establishmentId);
  conflictosDeDirectorio.set(establishmentId, { establishment_id: establishmentId, motivo: 'estrato_sin_muestra', marcas: [evidencia.brand], propuesta: { brand: evidencia.brand, reference: evidencia.reference, estrato: evidencia.estrato } });
}

// Letrero observado: la vía de las marcas sin directorio vigente. Vale como un
// directorio —12 meses desde la fecha de la IMAGEN, no de la consulta— y solo
// sobre la ficha de Maps ya emparejada con el grifo, cuya identidad corroboró la
// auditoría de nombres. Cada incorporación exige además una revisión
// independiente verificada. Lo que choque con otra evidencia queda en conflicto y
// conserva la marca anterior; no se resuelve por orden de llegada.
const MARCAS_OBSERVABLES = ['Pecsa', 'Energigas', 'Terpel', 'Petroamérica', 'Gazel', 'Picorp', 'GESA', 'Primax', 'Repsol', 'Petroperú', 'AVA'];
const DOCE_MESES_MS = 365 * 24 * 60 * 60 * 1000;
const observaciones = fs.existsSync(path.join(identidad, 'observaciones-letrero.json'))
  ? JSON.parse(fs.readFileSync(path.join(identidad, 'observaciones-letrero.json'), 'utf8')).entradas ?? []
  : [];
const letrerosRetenidos = [];
const letrerosIncorporados = [];
for (const observacion of observaciones) {
  const establishmentId = observacion.establishment_id;
  const marca = MARCAS_OBSERVABLES.find((conocida) => misma(conocida, observacion.marca)) ?? null;
  const fila = filaDeMatches.get(establishmentId);
  const evidencedAt = /^\d{4}-(0[1-9]|1[0-2])$/.test(observacion.fecha_imagen ?? '') ? `${observacion.fecha_imagen}-01T00:00:00.000-05:00` : null;
  const motivo = !marca ? 'marca_desconocida'
    : !evidencedAt ? 'sin_fecha_de_imagen'
      : Date.parse(REVISADO_MARCA) - Date.parse(evidencedAt) > DOCE_MESES_MS ? 'imagen_de_mas_de_12_meses'
        : !(Date.parse(observacion.consultado_en) >= Date.parse(evidencedAt)) ? 'consulta_anterior_a_la_imagen'
          : !fila || fila.place_id !== observacion.place_id ? 'ficha_de_otro_establecimiento'
            : !tierDe(fila) ? 'identidad_sin_corroborar'
              : veredictoDeMarca(establishmentId, marca, 'incorrect') ? 'rechazada_en_revision'
                : !veredictoDeMarca(establishmentId, marca, 'verified') ? 'sin_revision_independiente'
                  : null;
  if (motivo) { letrerosRetenidos.push({ establishment_id: establishmentId, marca: observacion.marca, motivo }); continue; }
  const actual = evidenciaDeMarca.get(establishmentId);
  const previa = base?.get(establishmentId)?.brand ?? null;
  const pendiente = conflictosDeDirectorio.get(establishmentId);
  // Un directorio que el owner ya rechazó no contradice: el letrero lo confirma.
  const pendienteContradice = pendiente && pendiente.motivo !== 'choque_rechazado_por_owner' && !misma(pendiente.propuesta?.brand ?? pendiente.marcas?.[0], marca);
  const contradice = (actual && !misma(actual.brand, marca)) || (previa && !misma(previa, marca)) || pendienteContradice;
  if (contradice) {
    conflictosDeDirectorio.set(establishmentId, { establishment_id: establishmentId, motivo: 'letrero_contra_otra_evidencia', marcas: [marca, actual?.brand ?? previa ?? pendiente?.propuesta?.brand ?? pendiente?.marcas?.[0]], propuesta: { brand: marca, reference: observacion.referencia, estrato: 'letrero_observado' } });
    letrerosRetenidos.push({ establishment_id: establishmentId, marca, motivo: 'contradice_otra_evidencia' });
    continue;
  }
  if (pendiente) conflictosDeDirectorio.delete(establishmentId);
  letrerosIncorporados.push({ establishment_id: establishmentId, marca });
  // Si el directorio ya acredita esa misma marca, su evidencia se queda.
  if (actual) continue;
  evidenciaDeMarca.set(establishmentId, { brand: marca, method: 'storefront_observation', reference: observacion.referencia, evidenced_at: evidencedAt, consulted_at: observacion.consultado_en, estrato: 'letrero_observado', responsable: observacion.responsable ?? RESPONSABLE });
}
// Una marca que ya se publica en algún grifo entra a la limpieza de nombres: su
// palabra no puede quedar en el nombre de una sede donde nadie la respalda.
//
// Energigas es la excepción, por decisión de Bruno del 18/09/2026: se publica en
// dos grifos, pero otros siete llevan su palabra en el nombre, con el letrero
// legible en fotos de 2020 a 2025 —fuera del plazo de doce meses— y figuran en su
// lista oficial. Retirarles el nombre costaría más información de la que protege.
// La limpieza entra cuando esas sedes tengan su letrero confirmado.
const LIMPIEZA_DIFERIDA = ['Energigas'];
for (const { marca } of letrerosIncorporados) if (!MARCAS.some((conocida) => misma(conocida, marca)) && !LIMPIEZA_DIFERIDA.some((diferida) => misma(diferida, marca))) MARCAS.push(marca);

const publicables = matches.resultados.filter((r) => tierDe(r));

function construirEntrada(r) {
  const confidence = tierDe(r);
  const operador = marcaDelOperador(r.razon_social);
  const marca = marcaEnNombre(r.nombre_maps);
  // El directorio oficial de la cadena respalda la bandera igual que el
  // operador del Registro: si el padrón vigente lista este establecimiento, la
  // marca del nombre visible deja de estar huérfana. Se emite la marca de quien
  // la respalda: antes se emitía la del operador aunque respaldara el directorio,
  // y un nombre «Repsol» con razón social de Coesti salía publicado como Primax.
  const delDirectorio = evidenciaDeMarca.get(r.establishment_id)?.brand ?? null;
  const respaldadaPor = misma(marca, delDirectorio) ? delDirectorio : misma(marca, operador) ? operador : null;
  const nombre = nombreParaPantalla(r.nombre_maps, Boolean(respaldadaPor));
  if (!nombre) return null;
  // Cuando solo el directorio sostiene la marca, «Grifo Primax» no nombra una
  // sede: la entrada se publica con la bandera y sin nombre, y no infla la
  // población de nombres. Un nombre ya publicado no se toca.
  if (misma(respaldadaPor, delDirectorio) && !misma(marca, operador) && !base?.get(r.establishment_id)?.public_site_name && soloGenerico(nombre)) return null;
  const señales = r.señales.map((s) => s.tipo).join('+') || 'proximidad';
  return {
    establishment_id: r.establishment_id,
    brand: respaldadaPor,
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
    brand_evidence: null,
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
// El directorio oficial acredita la bandera. Donde el nombre y la razón social ya
// sostienen otra marca no se sobrescribe: eso es un conflicto y se registra sin
// acreditar nada.
const conflictosDeMarca = [];
const conNombre = new Set(entradas.map((e) => e.establishment_id));
for (const entrada of entradas) {
  const evidencia = evidenciaDeMarca.get(entrada.establishment_id);
  if (!evidencia) continue;
  if (entrada.brand && !misma(entrada.brand, evidencia.brand)) { conflictosDeMarca.push({ establishment_id: entrada.establishment_id, motivo: 'nombre_y_operador_contra_directorio', marcas: [entrada.brand, evidencia.brand], conserva: entrada.brand }); continue; }
  entrada.brand = evidencia.brand;
  entrada.brand_evidence = { method: evidencia.method, reference: evidencia.reference, evidenced_at: evidencia.evidenced_at, consulted_at: evidencia.consulted_at };
}
// Un conflicto del emparejador no acredita nada nuevo, pero tampoco borra lo que
// ya estaba respaldado: se conserva la marca publicada, con su evidencia, hasta
// resolverlo con otra fuente u observación.
const porId = new Map(entradas.map((e) => [e.establishment_id, e]));
const conservadas = [];
for (const [establishmentId, conflicto] of conflictosDeDirectorio) {
  const entrada = porId.get(establishmentId);
  const previa = base?.get(establishmentId);
  const registro = { establishment_id: establishmentId, motivo: conflicto.motivo, marcas: conflicto.marcas, conserva: entrada?.brand ?? previa?.brand ?? null, propuesta: conflicto.propuesta ?? null };
  conflictosDeMarca.push(registro);
  if (entrada?.brand || !previa?.brand) continue;
  if (entrada) { entrada.brand = previa.brand; entrada.brand_evidence = previa.brand_evidence; }
  else { entradas.push(structuredClone(previa)); conNombre.add(establishmentId); }
  conservadas.push(establishmentId);
}
// Un establecimiento del padrón oficial sin ficha de nombre utilizable sigue
// teniendo bandera acreditada: se publica la marca sin nombre de sede, que el
// contrato admite y la tarjeta sabe presentar.
const soloMarca = [...evidenciaDeMarca.entries()].filter(([id]) => !conNombre.has(id)).map(([establishment_id, evidencia]) => ({
  establishment_id,
  brand: evidencia.brand,
  public_site_name: null,
  confidence: 'verified',
  // Procedencia real: un padrón de la cadena, o una imagen pública revisada.
  source: evidencia.method === 'storefront_observation'
    ? { kind: 'public_web_observed', source_or_description: evidencia.reference, acquisition_method: 'public_web_review', observed_at: evidencia.consulted_at, responsible: evidencia.responsable ?? RESPONSABLE }
    : { kind: 'first_party', source_or_description: evidencia.reference, acquisition_method: 'first_party_publication', observed_at: evidencia.evidenced_at, responsible: RESPONSABLE },
  entity_link: { method: 'official_establishment_id_exact', status: 'verified', verified_at: REVISADO_MARCA },
  identity_freshness: 'current',
  publication: { status: 'publishable', reviewed_at: REVISADO_MARCA, responsible: RESPONSABLE },
  brand_evidence: { method: evidencia.method, reference: evidencia.reference, evidenced_at: evidencia.evidenced_at, consulted_at: evidencia.consulted_at },
}));
entradas.push(...soloMarca);
entradas.sort((a, b) => a.establishment_id.localeCompare(b.establishment_id));

// Un nombre ya publicado no cambia por añadir una bandera: si lo único que lo
// distingue del catálogo base es el token de marca, se conserva el publicado. Un
// nombre que cambia de verdad pierde su veredicto, porque se revisó otra cosa.
const soloSede = (nombre) => MARCAS.reduce((texto, marca) => texto.replace(new RegExp(`\\b${sinTildes(marca)}\\b`, 'g'), ' '), sinTildes(nombre)).replace(/[^A-Z0-9]+/g, ' ').trim();
const nombresConservados = [];
const nombresCambiados = new Set();
for (const entrada of entradas) {
  const previa = base?.get(entrada.establishment_id);
  if (!previa?.public_site_name || previa.public_site_name === entrada.public_site_name) continue;
  const marcaDelPrevio = marcaEnNombre(previa.public_site_name);
  const previoRespaldado = !marcaDelPrevio || misma(marcaDelPrevio, entrada.brand);
  if (entrada.public_site_name && previoRespaldado && soloSede(previa.public_site_name) === soloSede(entrada.public_site_name)) {
    entrada.public_site_name = previa.public_site_name;
    nombresConservados.push(entrada.establishment_id);
  } else nombresCambiados.add(entrada.establishment_id);
}
const catalogo = {
  schema_version: CATALOG_SCHEMA_VERSION,
  catalog_id: CATALOG_ID,
  anchor_scheme: OFFICIAL_ANCHOR_SCHEME,
  entries: entradas,
};

// La auditoría solo puede hablar de entradas que existan en el catálogo.
const porAnchor = new Map(entradas.map((e) => [e.establishment_id, e]));
// Los veredictos del owner se aplican ANTES de auditar, pero el hash se toma de
// la entrada TAL COMO SE REVISÓ: corregirla no puede borrar lo que se observó.
const marcaRevisada = new Map(entradas.filter((e) => e.brand).map((e) => [e.establishment_id, commercialClaimSha256(e, 'brand')]));
// También el método TAL COMO ERA al revisar: si el veredicto retira la marca,
// el error tiene que contarse en el grupo que la propuso, no caer en otro.
const metodoRevisado = new Map(entradas.filter((e) => e.brand).map((e) => [e.establishment_id, e.brand_evidence?.method ?? 'operador_del_registro']));
// Un veredicto habla de la marca que se revisó: si hoy la entrada lleva otra,
// ese veredicto no la acredita ni la retira.
const marcaAlRevisar = new Map(entradas.filter((e) => e.brand).map((e) => [e.establishment_id, e.brand]));
const hablaDeEsaMarca = (v) => marcaAlRevisar.has(v.establishment_id) && (!v.marca || misma(v.marca, marcaAlRevisar.get(v.establishment_id)));
const nombreMapsDe = new Map(publicables.map((r) => [r.establishment_id, r.nombre_maps]));
const corregidas = [];
for (const v of veredictosMarca.filter((x) => x.result === 'incorrect' && hablaDeEsaMarca(x))) {
  const entrada = porAnchor.get(v.establishment_id);
  if (!entrada?.brand) continue;
  corregidas.push({ establishment_id: entrada.establishment_id, marca_retirada: entrada.brand, conservaba_nombre: Boolean(entrada.public_site_name) });
  // Sin la marca, su palabra tampoco puede quedarse en el nombre de la sede.
  if (entrada.public_site_name && misma(marcaEnNombre(entrada.public_site_name), entrada.brand) && nombreMapsDe.has(entrada.establishment_id)) {
    entrada.public_site_name = nombreParaPantalla(nombreMapsDe.get(entrada.establishment_id), false);
    nombresCambiados.add(entrada.establishment_id);
  }
  entrada.brand = null;
  entrada.brand_evidence = null;
}
// Una entrada que solo publicaba bandera se queda sin nada que decir: sale del
// catálogo en vez de quedar como una fila vacía que el contrato rechazaría.
const vacias = new Set(entradas.filter((e) => !e.brand && !e.public_site_name).map((e) => e.establishment_id));
if (vacias.size) { for (let i = entradas.length - 1; i >= 0; i -= 1) if (vacias.has(entradas[i].establishment_id)) entradas.splice(i, 1); }

const veredictoA = (v, claim, revisadoEn) => {
  const entrada = porAnchor.get(v.establishment_id);
  return {
    establishment_id: v.establishment_id,
    // El hash cubre solo los campos de esta afirmación: incorporar una marca no
    // hereda el visto bueno del nombre ni al revés.
    entry_sha256: claim === 'brand' ? marcaRevisada.get(v.establishment_id) : commercialClaimSha256(entrada, claim),
    claim,
    confidence: entrada.confidence,
    selection_reason: v.selection_reason ?? 'random_sample',
    // Quien revisó de verdad: el owner o una sonda independiente, con su fecha.
    reviewer: v.revisor ?? RESPONSABLE,
    reviewed_at: v.revisado_en ?? revisadoEn,
    result: v.result,
  };
};
const revisadas = [
  // Un veredicto de nombre solo vale sobre una entrada que publica nombre.
  ...[...veredictos, ...veredictosCandidatos].filter((v) => porAnchor.get(v.establishment_id)?.public_site_name && !nombresCambiados.has(v.establishment_id)).map((v) => veredictoA(v, 'name', REVISADO)),
  // Todo veredicto de bandera cuenta, tenga o no expediente: desde que marca y
  // logo son la misma afirmación, la revisión mide la marca publicada, no el
  // método por el que llegó.
  ...veredictosMarca.filter((v) => marcaRevisada.has(v.establishment_id) && hablaDeEsaMarca(v)).map((v) => veredictoA(v, 'brand', REVISADO_MARCA)),
];
// Una corrección ya publicada no se borra del registro: si el catálogo base dejó
// de publicar una marca por un veredicto `incorrect`, ese veredicto se conserva
// tal cual y sigue contando en el grupo que la propuso.
const heredadas = (auditoriaBase?.entries ?? []).filter((r) => r.claim === 'brand' && r.result === 'incorrect' && !marcaRevisada.has(r.establishment_id) && !revisadas.some((x) => x.establishment_id === r.establishment_id && x.claim === 'brand'));
revisadas.push(...heredadas);
for (const r of heredadas) metodoRevisado.set(r.establishment_id, evidenciaBase[r.establishment_id]?.method ?? 'operador_del_registro');

// El tier de nombre mide precisión de NOMBRES: una entrada que solo publica
// bandera no tiene nombre que auditar y no entra en su población.
const tiers = ['verified', 'nearby'].map((confidence) => {
  const poblacion = entradas.filter((e) => e.confidence === confidence && e.public_site_name).length;
  // Solo veredictos de NOMBRE: un error de bandera no es un error de sede.
  const muestra = revisadas.filter((r) => r.claim === 'name' && r.confidence === confidence);
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

// Tiers de bandera: ya no son una puerta. Reportan qué se revisó y con qué
// resultado; ni el umbral ni el tamaño de muestra deciden si algo se publica.
const metodoDe = (id) => metodoRevisado.get(id) ?? 'operador_del_registro';
const metodos = [...new Set(entradas.filter((e) => e.brand).map((e) => e.brand_evidence?.method ?? 'operador_del_registro'))];
const brandTiers = metodos.filter((m) => m !== 'operador_del_registro').map((method) => {
  const poblacion = entradas.filter((e) => e.brand && e.brand_evidence?.method === method).length;
  const muestra = revisadas.filter((r) => r.claim === 'brand' && metodoDe(r.establishment_id) === method);
  const correctas = muestra.filter((r) => r.result === 'verified').length;
  return {
    method,
    population: poblacion,
    sampled: muestra.length,
    correct: correctas,
    lower_bound_95: Number(wilsonLowerBound(correctas, muestra.length).toFixed(3)),
    threshold: BRAND_THRESHOLD,
    reviewer: [...new Set(muestra.map((r) => r.reviewer))].join('; ') || RESPONSABLE,
    reviewed_at: muestra.map((r) => r.reviewed_at).sort().at(-1) ?? REVISADO_MARCA,
  };
// Un grupo sin revisar no se declara: aparecer con muestra cero solo rompería
// el contrato de la auditoría. Sin tier, el grupo queda pendiente y sin logo.
}).filter((t) => t.population > 0 && t.sampled > 0);

const auditoria = { schema_version: AUDIT_SCHEMA_VERSION, audit_id: AUDIT_ID, catalog_id: catalogo.catalog_id, tiers, brand_tiers: brandTiers, entries: revisadas };

// Antes de escribir, la pareja pasa por los mismos contratos que la aplicarán en
// CI. Una sola entrada aislada desfasaría la población de su tier y retiraría
// TODOS sus nombres; un catálogo así no se escribe.
const erroresDeContrato = [...validateCommercialCatalog(catalogo), ...validateCommercialAudit(auditoria)];
const evidenciaMasReciente = entradas.map((e) => e.brand_evidence?.evidenced_at).filter(Boolean).sort().at(-1);
if (evidenciaMasReciente && Date.parse(REVISADO_MARCA) < Date.parse(evidenciaMasReciente)) erroresDeContrato.push(`REVISADO_MARCA (${REVISADO_MARCA}) es anterior a la evidencia más reciente (${evidenciaMasReciente})`);
// Una observación no puede publicarse con una revisión anterior a la consulta.
const consultaMasReciente = entradas.filter((e) => e.brand_evidence?.method === 'storefront_observation').map((e) => e.brand_evidence.consulted_at).sort().at(-1);
if (consultaMasReciente && Date.parse(REVISADO_MARCA) < Date.parse(consultaMasReciente)) erroresDeContrato.push(`REVISADO_MARCA (${REVISADO_MARCA}) es anterior a la última consulta de letrero (${consultaMasReciente})`);
if (!erroresDeContrato.length) erroresDeContrato.push(...commercialNameBacking(catalogo, auditoria).problems.map((problema) => `nombres sin respaldo: ${problema.reason} (${problema.affected})`));
if (erroresDeContrato.length) throw new Error(`No se escribe el catálogo:\n- ${[...new Set(erroresDeContrato)].join('\n- ')}`);

fs.writeFileSync(path.join(identidad, 'commercial-identity-catalog.json'), `${JSON.stringify(catalogo, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(identidad, 'commercial-identity-audit.json'), `${JSON.stringify(auditoria, null, 2)}\n`, { mode: 0o600 });

const conMarca = entradas.filter((e) => e.brand).length;
// Siempre se escribe: un archivo de una corrida anterior contaría conflictos que ya no existen.
fs.writeFileSync(path.join(identidad, 'brand-conflicts.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), conflictos: conflictosDeMarca }, null, 2)}\n`, { mode: 0o600 });
const limpiados = publicables.filter((r) => marcaEnNombre(r.nombre_maps) && !(marcaDelOperador(r.razon_social) && sinTildes(marcaEnNombre(r.nombre_maps)) === sinTildes(marcaDelOperador(r.razon_social)))).length;
// El universo sale del propio cruce, no de un número escrito a mano: el padrón
// cambia y un denominador fijo convierte el informe en una cifra falsa.
const universo = matches.establecimientos;
// Estrato de cada marca publicada: con qué regla llegó, para muestrear cada una.
const estratoDe = (entrada) => {
  if (!entrada.brand_evidence) return 'operador_del_registro';
  const evidencia = evidenciaDeMarca.get(entrada.establishment_id);
  return evidencia?.reference === entrada.brand_evidence.reference ? (evidencia.estrato ?? 'official_directory') : 'conservada_del_catalogo_base';
};
const porEstrato = new Map();
for (const entrada of entradas.filter((e) => e.brand)) {
  const clave = estratoDe(entrada);
  const fila = porEstrato.get(clave) ?? { poblacion: 0, revisadas: 0, correctas: 0 };
  fila.poblacion += 1;
  porEstrato.set(clave, fila);
}
for (const revision of revisadas.filter((r) => r.claim === 'brand')) {
  const entrada = porAnchor.get(revision.establishment_id);
  const fila = porEstrato.get(entrada?.brand ? estratoDe(entrada) : 'retirada_por_veredicto') ?? { poblacion: 0, revisadas: 0, correctas: 0 };
  fila.revisadas += 1;
  if (revision.result === 'verified') fila.correctas += 1;
  porEstrato.set(entrada?.brand ? estratoDe(entrada) : 'retirada_por_veredicto', fila);
}
const porMarca = {};
for (const entrada of entradas.filter((e) => e.brand)) porMarca[entrada.brand] = (porMarca[entrada.brand] ?? 0) + 1;

process.stdout.write(`Catálogo         ${entradas.length} entradas de ${universo} (${(entradas.length / universo * 100).toFixed(1)} %)
  verified       ${entradas.filter((e) => e.confidence === 'verified').length}
  nearby         ${entradas.filter((e) => e.confidence === 'nearby').length}

Marca publicada  ${conMarca}   ${Object.entries(porMarca).map(([marca, n]) => `${marca} ${n}`).join(' · ')}
Nombres limpiados ${limpiados}  (marca sin respaldo retirada del nombre)

AUDITORÍA DE NOMBRE  (mide si la sede publicada es la correcta; decide qué nombres se publican, ya no los precios)
${tiers.map((t) => `  ${t.confidence.padEnd(9)} ${t.correct}/${t.sampled} correctos · cota ${(t.lower_bound_95 * 100).toFixed(1)} % · umbral ${(t.threshold * 100).toFixed(0)} % ${t.lower_bound_95 >= t.threshold ? '✅' : '❌'}`).join('\n')}

REVISIÓN DE MARCA    (mide la bandera publicada; NO es una puerta)
  con evidencia  ${entradas.filter((e) => e.brand_evidence).length} de ${conMarca}   (el resto sale del operador del Registro)
  solo bandera   ${soloMarca.filter((e) => entradas.includes(e)).length}   (del padrón oficial, sin nombre de sede publicable)
  conflictos     ${conflictosDeMarca.length}   ${Object.entries(conflictosDeMarca.reduce((cuenta, c) => ({ ...cuenta, [c.motivo]: (cuenta[c.motivo] ?? 0) + 1 }), {})).map(([motivo, n]) => `${motivo} ${n}`).join(' · ')}
  conservadas    ${conservadas.length}   (marca del catálogo base mantenida por conflicto)
  letreros       ${letrerosIncorporados.length} incorporados ${Object.entries(letrerosIncorporados.reduce((c, l) => ({ ...c, [l.marca]: (c[l.marca] ?? 0) + 1 }), {})).map(([m, n]) => `${m} ${n}`).join(' · ')} · ${letrerosRetenidos.length} retenidos ${Object.entries(letrerosRetenidos.reduce((c, l) => ({ ...c, [l.motivo]: (c[l.motivo] ?? 0) + 1 }), {})).map(([m, n]) => `${m} ${n}`).join(' · ')}
  corregidas     ${corregidas.length}   ${corregidas.map((c) => `−${c.marca_retirada}${c.conservaba_nombre ? '' : ' (entrada retirada)'}`).join(', ')}
  nombres base   ${nombresConservados.length} conservados · ${nombresCambiados.size} cambiados (sin veredicto) · ${base ? [...base.keys()].filter((id) => !entradas.some((e) => e.establishment_id === id)).length : 0} entradas del base ya no se publican${base ? '' : '   ⚠ sin catálogo base: no se protegen nombres ni marcas previas'}

POR ESTRATO          (población · revisadas · correctas · cota 95 %)
${[...porEstrato.entries()].map(([estrato, f]) => `  ${estrato.padEnd(36)} ${String(f.poblacion).padStart(4)} · ${f.revisadas} · ${f.correctas} · ${f.revisadas ? `${(wilsonLowerBound(f.correctas, f.revisadas) * 100).toFixed(1)} %` : 'sin muestra'}`).join('\n')}
${revisadas.filter((r) => r.claim === 'brand').length ? [...brandTiers.map((t) => `  ${t.method.padEnd(24)} ${t.correct}/${t.sampled} revisadas de ${t.population}`), `  ${'operador_del_registro'.padEnd(24)} ${revisadas.filter((r) => r.claim === 'brand' && metodoDe(r.establishment_id) === 'operador_del_registro' && r.result === 'verified').length}/${revisadas.filter((r) => r.claim === 'brand' && metodoDe(r.establishment_id) === 'operador_del_registro').length} revisadas de ${entradas.filter((e) => e.brand && !e.brand_evidence).length}`].join('\n') : '  (sin revisiones del owner todavía)'}
`);
