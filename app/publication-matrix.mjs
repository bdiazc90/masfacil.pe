// Gate 2.2 — matriz campo → fuente → permiso → veredicto, y su proyección.
//
// Extiende el patrón public_safe/private_preview de Gate 2.1 (app/commercial-overlay.mjs)
// más allá de la identidad comercial, a todos los campos que hoy llegan al cliente.
//
// La matriz es evidencia congelada: cada entrada cita el documento del repositorio en el
// que se apoya (docs/datos.md, contracts/*.schema.json). No se deriva de código en runtime
// ni se recalcula: es una decisión declarada, auditable por Claude L. Nada aquí modifica
// las constantes congeladas de los schemas de Gate 1.1 o Gate 2.1.
//
// "identidad_comercial" no tiene un veredicto único: ya la gobierna Gate 2.1, entrada por
// entrada (verification_status + identity_freshness + publication_status). Esta matriz no
// la reevalúa; su fila existe solo para que el campo quede documentado en un único lugar.

export const FIELD_PUBLICATION_POLICIES = Object.freeze(['private_experiment', 'public_safe']);
export const PUBLICATION_VERDICTS = Object.freeze(['publishable', 'not_publishable', 'unknown']);
const GOVERNED_UPSTREAM = 'governed_upstream';

export const FIELD_PUBLICATION_MATRIX = Object.freeze([
  Object.freeze({
    field: 'precio',
    client_fields: Object.freeze(['price']),
    source: 'liquid-current — ficha "Líquidos vigentes", una de las cuatro fichas de datasets de precio',
    permission: 'ODC-By declarado en la ficha del dataset',
    verdict: 'publishable',
    evidence: 'docs/datos.md § Fuentes de precio reproducidas: "Las fichas de los cuatro datasets de precio declaran ODC-By."',
  }),
  Object.freeze({
    field: 'fecha_de_reporte',
    client_fields: Object.freeze(['reported_at']),
    source: 'liquid-current — misma ficha ODC-By que precio (columna FECHA_DE_REGISTRO)',
    permission: 'ODC-By declarado en la ficha del dataset',
    verdict: 'publishable',
    evidence: 'docs/datos.md § Fuentes de precio reproducidas',
  }),
  Object.freeze({
    field: 'frescura',
    client_fields: Object.freeze(['age_days']),
    source: 'derivado de fecha_de_reporte y del corte interno de adquisición (cutoff_at); no proviene de una fuente externa distinta',
    permission: 'hereda el permiso de fecha_de_reporte; el cálculo no reutiliza ningún dato adicional con licencia propia',
    verdict: 'publishable',
    evidence: 'app/contract.mjs (age_days_at_cutoff se deriva de price_reported_at y temporal_context.cutoff_at)',
  }),
  Object.freeze({
    field: 'coordenada',
    client_fields: Object.freeze(['longitude', 'latitude']),
    source: 'servicio GIS de Osinergmin, capa 35 (N ↔ REGISTRO exacto)',
    permission: 'servicio con copyright de Osinergmin sin licencia explícita; además, el contrato de Gate 1.1 clasifica el campo de forma congelada como "coordenada oficial exacta; reutilización pública no autorizada"',
    verdict: 'not_publishable',
    evidence: 'docs/datos.md § Registro, GIS y geografía; contracts/gate-1.1-experiment-dataset.schema.json → offer.coordinate.classification (const)',
  }),
  Object.freeze({
    field: 'distancia_derivada',
    client_fields: Object.freeze([]),
    source: 'calculada en el cliente (Haversine) a partir de coordenada oficial exacta y del origen del usuario',
    permission: 'sin fuente ni licencia propia: depende por completo de coordenada, cuya reutilización pública no está autorizada',
    verdict: 'not_publishable',
    evidence: 'hereda el veredicto de coordenada; no hay evidencia de un permiso independiente para exponer la distancia sin exponer la coordenada que la origina',
  }),
  Object.freeze({
    field: 'razon_social',
    client_fields: Object.freeze(['legal_name']),
    source: 'extracto crudo de Líquidos vigentes con RAZON_SOCIAL/DIRECCION (vive solo en .local-cache; nunca versionado)',
    permission: 'la declaración ODC-By observada describe "los datasets de precio"; no hay evidencia de que cubra columnas de identidad/dirección de esa misma ficha. El propio contrato Gate 1.1 la rotula IDENTIDAD PROVISIONAL con advertencia explícita de que no equivale a nombre comercial, y scope.usage congela "experimento privado; no publicar" para todo el dataset',
    verdict: 'unknown',
    evidence: 'docs/datos.md § Fuentes de precio reproducidas; contracts/gate-1.1-experiment-dataset.schema.json → scope.usage y offer.provisional_identity.label (const)',
  }),
  Object.freeze({
    field: 'direccion',
    client_fields: Object.freeze(['address']),
    source: 'mismo extracto crudo que razón social (columna DIRECCION)',
    permission: 'mismo razonamiento que razón social',
    verdict: 'unknown',
    evidence: 'docs/datos.md § Fuentes de precio reproducidas; contracts/gate-1.1-experiment-dataset.schema.json → scope.usage y offer.provisional_identity.label (const)',
  }),
  Object.freeze({
    field: 'distrito',
    client_fields: Object.freeze(['district']),
    source: 'liquid-current — misma ficha ODC-By que precio (columna DISTRITO de la fila de precio seleccionada)',
    permission: 'ODC-By declarado en la ficha del dataset',
    verdict: 'publishable',
    evidence: 'docs/datos.md § Fuentes de precio reproducidas',
  }),
  Object.freeze({
    field: 'identidad_comercial',
    client_fields: Object.freeze(['commercial_identity']),
    source: 'overlay de identidad comercial (Gate 2.1), evaluado entrada por entrada',
    permission: 'ya gobernado campo-por-entrada por verification_status + identity_freshness + publication_status; esta matriz no reevalúa ni sobrescribe ese veredicto',
    verdict: GOVERNED_UPSTREAM,
    evidence: 'app/commercial-overlay.mjs → buildCommercialIdentityIndex; ya aplica public_safe/private_preview antes de llegar aquí',
  }),
]);

export function fieldVerdict(field) {
  const entry = FIELD_PUBLICATION_MATRIX.find((item) => item.field === field);
  if (!entry) throw new Error(`Campo desconocido en la matriz de publicación: ${field}`);
  return entry.verdict;
}

function suppressibleEntries() {
  return FIELD_PUBLICATION_MATRIX.filter((entry) => entry.verdict !== GOVERNED_UPSTREAM && entry.verdict !== 'publishable');
}

export function projectClientOfferFields(offer, policy) {
  if (!FIELD_PUBLICATION_POLICIES.includes(policy)) throw new Error(`Política de publicación de campos desconocida: ${policy}`);
  if (policy === 'private_experiment') return offer;

  const projected = { ...offer };
  const suppressed = [];
  for (const entry of suppressibleEntries()) {
    for (const key of entry.client_fields) {
      if (Object.hasOwn(projected, key) && projected[key] !== null) {
        projected[key] = null;
        suppressed.push(key);
      }
    }
  }
  return { ...projected, suppressed_fields: suppressed.sort() };
}

export function measurePublicSubset(offers) {
  const total = offers.length;
  const identifiable = offers.filter((offer) => offer.commercial_identity !== null || offer.legal_name !== null).length;
  const locatable = offers.filter((offer) => offer.longitude !== null && offer.latitude !== null).length;
  const decisionReady = offers.filter((offer) => (offer.commercial_identity !== null || offer.legal_name !== null)
    && offer.longitude !== null && offer.latitude !== null).length;
  return Object.freeze({
    total,
    with_price: offers.filter((offer) => offer.price !== null).length,
    identifiable,
    locatable,
    decision_ready: decisionReady,
  });
}

export function applyFieldPublicationPolicy(clientDataset, policy) {
  if (!FIELD_PUBLICATION_POLICIES.includes(policy)) throw new Error(`Política de publicación de campos desconocida: ${policy}`);
  const offers = clientDataset.offers.map((offer) => projectClientOfferFields(offer, policy));
  return {
    ...clientDataset,
    field_publication_policy: policy,
    publication_subset: measurePublicSubset(offers),
    offers,
  };
}
