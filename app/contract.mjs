import fs from 'node:fs';

const clean = (value) => String(value ?? '').trim();
const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sameKeys = (value, properties) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(Object.keys(properties).sort());

function validateShape(value, definition, location, errors, schema) {
  const resolved = definition.$ref === '#/$defs/offer' ? schema.$defs.offer : definition;
  if (resolved.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${location}: debe ser objeto`);
      return;
    }
    if (resolved.additionalProperties === false && !sameKeys(value, resolved.properties)) {
      errors.push(`${location}: campos inesperados o ausentes`);
    }
    for (const required of resolved.required ?? []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}.${required}: requerido`);
    }
    for (const [key, child] of Object.entries(resolved.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateShape(value[key], child, `${location}.${key}`, errors, schema);
    }
  }
  if (resolved.type === 'array') {
    if (!Array.isArray(value)) errors.push(`${location}: debe ser arreglo`);
    else value.forEach((item, index) => validateShape(item, resolved.items, `${location}[${index}]`, errors, schema));
  }
  if (resolved.type === 'string' && typeof value !== 'string') errors.push(`${location}: debe ser texto`);
  if (resolved.type === 'number' && typeof value !== 'number') errors.push(`${location}: debe ser número`);
  if (Object.hasOwn(resolved, 'const') && JSON.stringify(value) !== JSON.stringify(resolved.const)) errors.push(`${location}: valor fuera del contrato`);
  if (resolved.pattern && typeof value === 'string' && !(new RegExp(resolved.pattern).test(value))) errors.push(`${location}: formato inválido`);
  if (resolved.format === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) errors.push(`${location}: fecha inválida`);
  if (resolved.format === 'date-time' && !isIso(value)) errors.push(`${location}: fecha/hora inválida`);
  if (resolved.minLength && typeof value === 'string' && clean(value).length < resolved.minLength) errors.push(`${location}: texto vacío`);
  if (typeof value === 'number' && resolved.minimum !== undefined && value < resolved.minimum) errors.push(`${location}: menor al mínimo`);
  if (typeof value === 'number' && resolved.maximum !== undefined && value > resolved.maximum) errors.push(`${location}: mayor al máximo`);
  if (typeof value === 'number' && resolved.exclusiveMinimum !== undefined && value <= resolved.exclusiveMinimum) errors.push(`${location}: debe superar el mínimo`);
}

export function validateDataset(dataset, schema) {
  const errors = [];
  validateShape(dataset, schema, 'dataset', errors, schema);
  const ids = new Set();
  for (const [index, offer] of (dataset?.offers ?? []).entries()) {
    if (ids.has(offer.experimental_id)) errors.push(`dataset.offers[${index}].experimental_id: duplicado`);
    ids.add(offer.experimental_id);
    if (isIso(offer.price_reported_at) && isIso(dataset?.temporal_context?.cutoff_at)) {
      const age = Number(((Date.parse(dataset.temporal_context.cutoff_at) - Date.parse(offer.price_reported_at)) / 86400000).toFixed(3));
      if (offer.age_days_at_cutoff !== age) errors.push(`dataset.offers[${index}].age_days_at_cutoff: inconsistente`);
    }
  }
  if (!Array.isArray(dataset?.offers) || dataset.offers.length === 0) errors.push('dataset.offers: no puede estar vacío');
  return errors;
}

export function loadValidatedDataset(datasetPath, schemaPath) {
  let dataset;
  let schema;
  try {
    dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer el dataset o contrato: ${error.message}`);
  }
  const errors = validateDataset(dataset, schema);
  if (errors.length) throw new Error(`Dataset fuera del contrato Gate 1.1:\n- ${errors.join('\n- ')}`);
  return dataset;
}

export function toClientDataset(dataset, mode) {
  return {
    mode,
    dataset_id: dataset.dataset_id,
    product: dataset.scope.product,
    display_unit: dataset.scope.display_unit,
    cutoff_at: dataset.temporal_context.cutoff_at,
    snapshot_date: dataset.temporal_context.snapshot_date,
    source_dataset: dataset.offers[0].source.dataset_id,
    warnings: dataset.offers[0].warnings,
    offers: dataset.offers.map((offer) => ({
      id: offer.experimental_id,
      price: offer.price,
      reported_at: offer.price_reported_at,
      age_days: offer.age_days_at_cutoff,
      district: offer.territory.district,
      longitude: offer.coordinate.longitude,
      latitude: offer.coordinate.latitude,
      identity_label: offer.provisional_identity.label,
      legal_name: offer.provisional_identity.legal_name,
      address: offer.provisional_identity.address,
    })),
  };
}
