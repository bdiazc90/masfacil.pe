import crypto from 'node:crypto';
import { officialAnchorFromRegistration } from '../app/official-anchor.mjs';
import { GIS_FIELDS, MINIMIZED_FIELDS, RAW_FIELDS, REGISTRY_FIELDS, assertHeader, clean, csvRows, normalizeHeader, parseTimestamp, readTable } from './csv.mjs';
import { facilitoLinkKey } from './facilito/link.mjs';

export const GASOLINA_PRODUCTS = Object.freeze({
  regular: Object.freeze({ canonical: 'GASOHOL REGULAR', label: 'Gasohol Regular' }),
  premium: Object.freeze({ canonical: 'GASOHOL PREMIUM', label: 'Gasohol Premium' }),
});
export const GASOLINA_PRODUCT_KEYS = Object.freeze(Object.keys(GASOLINA_PRODUCTS));
const activities = Object.freeze({ 'ESTACIÓN DE SERVICIOS / GRIFOS': '01', 'ESTACIÓN DE SERVICIO CON GASOCENTRO DE GLP': '02', 'EE.SS con GNV': '05', 'EE.SS con GLP y GNV': '06' });
const sep = '\u001f';

// La dirección del Registro viene en mayúsculas y mezcla la vía con la
// descripción del predio: manzana, lote, urbanización, referencias. Para la
// tarjeta se conserva solo el tramo que ubica —vía y número— con mayúsculas de
// nombre propio. El original nunca sale de la caché privada.
const MINUSCULAS = new Set(['de', 'del', 'y', 'con', 'en', 'a']);
const PREFIJO_RUIDO = /^\s*(?:ESQUINA|ESQ\.?|FRENTE\s+A|ALTURA\s+DE|INTERSECCION\s+DE)\s*(?:DE\s+)?(?:LA\s+|EL\s+|LOS\s+|LAS\s+)?/i;
const CORTE_DESCRIPCION = /\s*(?:,|\(|\bESQ\b|\bESQUINA\b|\bURB\b|\bURBANIZACI[OÓ]N\b|\bASOC\b|\bAA\.?HH\b|\bSUB\s*LOTE\b|\bDENOMINADO\b|\bANTES\b|\bSECTOR\b|\bETAPA\b|\bCON\s+FRENTE\b|\bFRENTE\s+A\b|\bCOMITE\b|\bAGRUPAMIENTO\b|\bPARCELA\b|\bCENTRO\s+POBLADO\b)/i;
const ABREVIATURAS = /^(av|jr|mz|mza|lt|km|ca)\.?$/;

export function direccionParaPantalla(bruta) {
  let texto = String(bruta ?? '').replace(/\s+/g, ' ').trim().replace(PREFIJO_RUIDO, '');
  if (!texto) return null;
  const cortado = texto.split(CORTE_DESCRIPCION)[0].trim();
  texto = cortado.length >= 6 ? cortado : texto;
  texto = texto.replace(/\bN[°º¿]\s*/gi, '').replace(/\bNRO\.?\s*/gi, '');
  texto = texto.replace(/(\d+)\s*[-–]\s*[\dA-Z]+(?:\s*[-–]\s*[\dA-Z]+)*/gi, '$1'); // 3810-A y 1294-1298-1302
  // Si ya hay vía con número, la manzana y el lote sobran para ubicarse.
  if (/\d/.test(texto.split(/\bMZ|\bLOTE|\bLT\b/i)[0])) texto = texto.split(/\s*\bMZ\b|\s*\bMZA\b|\s*\bLOTE\b|\s*\bLT\b/i)[0];
  texto = texto.replace(/\bKM\.?\s*/i, 'Km. ').replace(/[-–.,;\s]+$/, '').trim();
  if (!texto) return null;
  const palabras = texto.toLocaleLowerCase('es-PE').split(' ').filter(Boolean).map((palabra, indice, todas) => {
    const previa = indice > 0 ? todas[indice - 1] : null;
    if (indice > 0 && MINUSCULAS.has(palabra)) return palabra;
    // El artículo va en minúscula solo cuando sigue a "de" o "del".
    if (previa && /^del?$/.test(previa) && ['la', 'las', 'los', 'el'].includes(palabra)) return palabra;
    if (/^a{2}\.?h{2}\.?$/.test(palabra)) return 'AA.HH.';
    if (ABREVIATURAS.test(palabra)) return `${palabra[0].toLocaleUpperCase('es-PE')}${palabra.slice(1).replace('.', '')}.`;
    return `${palabra[0].toLocaleUpperCase('es-PE')}${palabra.slice(1)}`;
  });
  let salida = palabras.join(' ').replace(/[-–.,;\s]+$/, '');
  if (salida.length > 46) salida = `${salida.slice(0, 45).replace(/[\s,]+\S*$/, '')}…`;
  return salida || null;
}

const lima = (row) => row.DEPARTAMENTO === 'LIMA' && row.PROVINCIA === 'LIMA';

function seedRows(seed, name, fields, mapRow) {
  if (!seed || !Array.isArray(seed[name])) return null;
  const declared = seed[`${name}_fields`];
  const expected = name === 'registry'
    ? ['source_activity', 'registro', 'department', 'province', 'district']
    : ['n', 'department', 'province', 'district', 'longitude', 'latitude'];
  if (JSON.stringify(declared) !== JSON.stringify(expected)) throw new Error(`Seed ${name} fuera de contrato`);
  return seed[name].map((row) => {
    if (!Array.isArray(row) || row.length !== expected.length) throw new Error(`Fila seed ${name} inválida`);
    return Object.fromEntries(fields.map((field, index) => [field, mapRow(row, index)]));
  });
}

/**
 * Precios minimizados, Registro y GIS: las tres tablas que comparten los dos
 * productos, cargadas UNA vez.
 *
 * De la misma pasada sale `sourceMaxReportedAt`: el máximo de
 * `FECHA_DE_REGISTRO` sobre TODAS las filas, antes de cualquier filtro. Lo
 * calculaba el constructor privado; ahora se calcula donde ya se recorre el
 * archivo y viaja en el pointer del snapshot.
 */
export async function loadGasolinaSources({ minimizedRoot, bootstrapSeed = null }) {
  let maximo = null;
  const prices = await readTable(`${minimizedRoot}/prices/liquid-current.csv.gz`, MINIMIZED_FIELDS, {
    onRow: (row) => { const time = parseTimestamp(row.FECHA_DE_REGISTRO); if (time && (!maximo || time > maximo)) maximo = time; },
  });
  const registry = seedRows(bootstrapSeed, 'registry', REGISTRY_FIELDS, (row, index) => [row[0], row[1], '', '', row[2], row[3], row[4], ''][index])
    ?? await readTable(`${minimizedRoot}/registry/authorizations.csv.gz`, REGISTRY_FIELDS);
  const gis = seedRows(bootstrapSeed, 'gis', GIS_FIELDS, (row, index) => ['35', '', row[0], '', '', row[1], row[2], row[3], row[4], row[5]][index])
    ?? await readTable(`${minimizedRoot}/gis/features.csv.gz`, GIS_FIELDS);
  return { prices, registry, gis, sourceMaxReportedAt: maximo ? maximo.toISOString() : null };
}

/**
 * Embudo de un producto hasta el cruce geográfico. No toca el original de 1,2 GB:
 * solo declara qué ID3 necesita de él.
 */
function selectProductCandidates({ sources, productKey, cutoffAt }) {
  const product = GASOLINA_PRODUCTS[productKey]; if (!product) throw new Error(`Producto gasolina no permitido: ${productKey}`);
  const byRegistry = new Map(); for (const row of sources.registry) { const key = `${row.SOURCE_ACTIVITY}${sep}${row.REGISTRO}`; byRegistry.set(key, [...(byRegistry.get(key) ?? []), row]); }
  const byGis = new Map(); for (const row of sources.gis.filter((item) => item.LAYER === '35')) byGis.set(row.N, [...(byGis.get(row.N) ?? []), row]);
  const grouped = new Map(); let sourceRows = 0;
  for (const row of sources.prices) {
    if (!Object.hasOwn(activities, row.ACTIVIDAD) || row.PRODUCTO !== product.canonical || row.UNIDAD !== 'Galones') continue;
    sourceRows += 1; const time = parseTimestamp(row.FECHA_DE_REGISTRO); const key = [row.REGISTRO_DE_HIDROCARBUROS, row.ACTIVIDAD, row.PRODUCTO, row.UNIDAD].join(sep); const current = grouped.get(key) ?? { rows: [], max: null };
    const numericPrice = Number(row.PRECIO_DE_VENTA_SOLES.replace(',', '.')); const candidate = { ...row, time, numericPrice };
    if (time && (!current.max || time > current.max)) { current.max = time; current.rows = [candidate]; } else if (time && current.max && time.getTime() === current.max.getTime()) current.rows.push(candidate);
    grouped.set(key, current);
  }
  const latest = [...grouped.values()].map((group) => {
    const selected = [...group.rows].sort((a, b) => a.ID3.localeCompare(b.ID3))[0] ?? null;
    const pricesAtLatest = new Set(group.rows.map((row) => row.numericPrice)); const territories = new Set(group.rows.map((row) => `${row.DEPARTAMENTO}|${row.PROVINCIA}|${row.DISTRITO}`));
    return { selected, priceConflict: pricesAtLatest.size !== 1, territoryConflict: territories.size !== 1 };
  }).filter((item) => item.selected);
  const latestLima = latest.filter((item) => lima(item.selected));
  const cutoff = new Date(cutoffAt); const desde = new Date(cutoff.getTime() - 30 * 86400000);
  // Un reporte inservible y un reporte viejo son cosas distintas. El inservible
  // —sin fecha, del futuro, o con la fuente contradiciéndose en precio o
  // territorio— no se publica nunca. El viejo sí se publica, y el navegador le
  // apaga el precio: el grifo sigue existiendo en el Registro y borrarlo de la
  // lista afirmaría que cerró, que es justo lo que el dato no dice.
  const motivoNoPublicable = (item) => {
    if (!item.selected.time || item.selected.time > cutoff) return 'reporte_invalido';
    if (item.priceConflict || item.territoryConflict || !(item.selected.numericPrice > 0)) return 'conflicto_precio_o_territorio';
    return null;
  };
  const vencido = (item) => item.selected.time < desde;
  const fresco = (item) => !vencido(item);
  const motivoNoFresco = (item) => motivoNoPublicable(item) ?? (vencido(item) ? 'reporte_vencido' : null);
  const publicables = latestLima.filter((item) => !motivoNoPublicable(item));
  const fresh = publicables.filter(fresco);
  // Cardinalidad ≠ 1 excluye y se cuenta; nunca `matches[0]`. Elegir una fila
  // arbitraria de un cruce ambiguo publicaría una identidad que la fuente no
  // afirma.
  const conCruceRegistro = publicables.map((item) => ({ ...item, matches: byRegistry.get(`${activities[item.selected.ACTIVIDAD]}${sep}${item.selected.REGISTRO_DE_HIDROCARBUROS}`) ?? [] }));
  const registryAmbiguous = conCruceRegistro.filter((item) => item.matches.length > 1).length;
  const registered = conCruceRegistro.filter((item) => item.matches.length === 1 && lima(item.matches[0]) && item.matches[0].DISTRITO === item.selected.DISTRITO);
  const conCruceGis = registered.map((item) => {
    const matches = byGis.get(item.selected.REGISTRO_DE_HIDROCARBUROS) ?? [];
    const coordinate = matches.length === 1 ? matches[0] : null;
    return { ...item, gisMatches: matches, coordinate, longitude: Number(coordinate?.LONGITUDE), latitude: Number(coordinate?.LATITUDE) };
  });
  const gisAmbiguous = conCruceGis.filter((item) => item.gisMatches.length > 1).length;
  const geo = conCruceGis.filter((item) => item.coordinate && lima(item.coordinate) && item.coordinate.DISTRITO === item.selected.DISTRITO && Number.isFinite(item.longitude) && item.longitude >= -82 && item.longitude <= -68 && Number.isFinite(item.latitude) && item.latitude >= -19 && item.latitude <= 1);
  return { product, sourceRows, latest, latestLima, publicables, fresh, registered, geo, fresco, vencido, motivoNoFresco, registryAmbiguous, gisAmbiguous, registry: sources.registry };
}

/**
 * Una sola pasada por el original para los DOS productos: la identidad de un
 * ID3 no depende del producto que lo trajo. Antes el archivo de 1,2 GB se leía
 * dos veces por proyección.
 *
 * Un `ID3` que aparece más de una vez dentro del alcance se marca: no hay forma
 * de saber cuál de las filas describe al establecimiento, y quedarse con «la
 * última» era elegir por orden de archivo.
 */
export async function readRawIdentities({ rawPath, targetIds }) {
  const identities = new Map();
  const duplicates = new Set();
  let header;
  for await (const row of csvRows(rawPath)) {
    if (!header) { header = row.map(normalizeHeader); assertHeader(header, RAW_FIELDS, rawPath); continue; }
    const id = clean(row[0]);
    if (!targetIds.has(id)) continue;
    if (identities.has(id)) { duplicates.add(id); continue; }
    identities.set(id, Object.fromEntries(RAW_FIELDS.map((key, index) => [key, clean(row[index])])));
  }
  return { identities, duplicates };
}

function finishProduct({ candidates, productKey, identities, duplicates, snapshotId, cutoffAt, sourceMaxReportedAt, sourceUrl }) {
  const { product, geo, registered, publicables, latestLima, fresh, latest, fresco, vencido, motivoNoFresco, sourceRows } = candidates;
  const repetidos = geo.filter((item) => duplicates.has(item.selected.ID3));
  const ready = geo.filter((item) => {
    if (duplicates.has(item.selected.ID3)) return false;
    const identity = identities.get(item.selected.ID3);
    return identity?.RAZON_SOCIAL && identity?.DIRECCION;
  });
  // La huella del vínculo con la consulta web sale de la MISMA fila que da el
  // precio publicado, no de la primera fila que el original traiga para ese
  // Registro: la razón social y la dirección tienen que ser las del reporte que
  // se está publicando, o estaríamos emparejando con una identidad de otra
  // fecha. No viaja al bundle; se queda en la proyección.
  const linkKeys = new Map();
  const offers = ready.map((item) => {
    const identity = identities.get(item.selected.ID3);
    const id = `g2_${crypto.createHash('sha256').update(`masfacil-pe|gasolina-v2|${snapshotId}|${productKey}|${item.selected.REGISTRO_DE_HIDROCARBUROS}|${item.selected.ACTIVIDAD}`).digest('hex').slice(0, 24)}`;
    linkKeys.set(id, facilitoLinkKey(identity.RAZON_SOCIAL, identity.DIRECCION, item.selected.DISTRITO));
    return {
      id,
      establishment_id: officialAnchorFromRegistration(item.selected.REGISTRO_DE_HIDROCARBUROS),
      address: direccionParaPantalla(identity.DIRECCION),
      price: item.selected.numericPrice,
      reported_at: item.selected.time.toISOString(),
      district: item.selected.DISTRITO,
      longitude: item.longitude,
      latitude: item.latitude,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const metric = (items) => ({ offers: items.length, districts: new Set(items.map((item) => item.selected?.DISTRITO ?? item.district)).size });
  // El universo del Registro es la referencia oficial contra la que se valida
  // la identidad comercial. No depende de que hoy haya precio vigente: una
  // estación que deja de reportar sigue existiendo en el Registro.
  const registryAnchors = new Set(candidates.registry.map((row) => clean(row.REGISTRO)).filter(Boolean).map(officialAnchorFromRegistration));
  // Que una identidad no llegue a oferta ya no bloquea, pero sigue mereciendo
  // explicación: sin esta traza el hueco solo se ve como un número y no se puede
  // decidir si sobra la identidad o falta el dato. Se anota la etapa MÁS profunda
  // que alcanzó cada anchor del Registro.
  const anchorDe = (item) => { const registro = clean(item.selected.REGISTRO_DE_HIDROCARBUROS); return registro ? officialAnchorFromRegistration(registro) : null; };
  const anchorsDe = (items) => new Set(items.map(anchorDe).filter(Boolean));
  const publicados = anchorsDe(ready);
  const noFrescos = new Map();
  for (const item of latestLima) { const anchor = anchorDe(item); const motivo = motivoNoFresco(item); if (anchor && motivo && !noFrescos.has(anchor)) noFrescos.set(anchor, motivo); }
  const etapas = [['id_repetido_en_el_raw', anchorsDe(repetidos)], ['sin_razon_social_o_direccion', anchorsDe(geo)], ['sin_gis_unico', anchorsDe(registered)], ['no_cruza_registro', anchorsDe(publicables)]];
  const exclusions = new Map();
  for (const anchor of registryAnchors) {
    if (publicados.has(anchor)) continue;
    exclusions.set(anchor, etapas.find(([, alcanzados]) => alcanzados.has(anchor))?.[0] ?? noFrescos.get(anchor) ?? 'sin_reporte_en_lima');
  }
  // El embudo declarado sigue midiendo lo VIGENTE, con las mismas definiciones de
  // siempre: así el contrato conserva `fresh >= ready`, la cobertura no se mueve
  // por publicar más, y los guardrails de caída siguen comparando lo mismo entre
  // corridas. Lo publicado de más se cuenta aparte.
  const registeredFresco = registered.filter(fresco); const geoFresco = geo.filter(fresco); const readyFresco = ready.filter(fresco);
  return {
    product,
    offers,
    linkKeys,
    registryAnchors,
    exclusions,
    metrics: {
      exact_scope_source_rows: sourceRows,
      latest_offers: metric(latest),
      latest_lima_lima: metric(latestLima),
      fresh_0_30_days: metric(fresh),
      registry_exact: metric(registeredFresco),
      gis_safe: metric(geoFresco),
      contract_ready: metric(readyFresco),
      coverage_percent: fresh.length ? Number((readyFresco.length / fresh.length * 100).toFixed(3)) : 0,
      published: metric(ready),
      silent_over_30_days: metric(ready.filter(vencido)),
      conflicts: {
        latest_price_conflicts: latestLima.filter((item) => item.priceConflict).length,
        latest_territory_conflicts: latestLima.filter((item) => item.territoryConflict).length,
        // Exclusiones por cardinalidad, medidas sobre la población que sí se
        // habría publicado. El esquema público admite claves nuevas dentro de
        // `conflicts`, así que no sube de versión.
        registry_ambiguous: candidates.registryAmbiguous,
        gis_ambiguous: candidates.gisAmbiguous,
        raw_duplicate: repetidos.length,
        registry_excluded: fresh.length - registeredFresco.length,
        gis_excluded: registeredFresco.length - geoFresco.length,
        identity_excluded: geoFresco.length - readyFresco.length,
      },
    },
    context: { snapshot_id: snapshotId, cutoff_at: cutoffAt, source_max_reported_at: sourceMaxReportedAt, source_url: sourceUrl },
  };
}

/**
 * Regular y Premium desde las mismas tablas y la misma pasada de original.
 *
 * @param {object} entrada
 * @param {object} [entrada.sources]  tablas ya cargadas; si faltan se cargan aquí
 */
export async function buildGasolinaProducts({ sources = null, minimizedRoot, rawPath, cutoffAt, snapshotId, sourceMaxReportedAt, sourceUrl, bootstrapSeed = null, productKeys = GASOLINA_PRODUCT_KEYS }) {
  const tablas = sources ?? await loadGasolinaSources({ minimizedRoot, bootstrapSeed });
  const candidates = Object.fromEntries(productKeys.map((key) => [key, selectProductCandidates({ sources: tablas, productKey: key, cutoffAt })]));
  const targetIds = new Set(productKeys.flatMap((key) => candidates[key].geo.map((item) => item.selected.ID3)));
  const { identities, duplicates } = await readRawIdentities({ rawPath, targetIds });
  const results = Object.fromEntries(productKeys.map((key) => [key, finishProduct({
    candidates: candidates[key], productKey: key, identities, duplicates, snapshotId, cutoffAt, sourceMaxReportedAt, sourceUrl,
  })]));
  return { sources: tablas, results };
}
