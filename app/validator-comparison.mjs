export const VALIDATOR_FIELDS = Object.freeze(['etag', 'last_modified']);
export const VALIDATOR_STATES = Object.freeze(['unchanged', 'changed', 'unverifiable']);

function validatorsOf(value) {
  return Object.fromEntries(VALIDATOR_FIELDS.map((field) => {
    const candidate = value?.[field];
    return [field, typeof candidate === 'string' && candidate.length > 0 ? candidate : null];
  }));
}

/**
 * Clasifica dos conjuntos de validadores sin interpretar ETag ni sus comillas.
 * unchanged solo es posible si cada validador local está presente y coincide.
 */
export function compareSnapshotValidators(local, remote) {
  const expected = validatorsOf(local);
  const observed = validatorsOf(remote);
  const comparable = VALIDATOR_FIELDS.filter((field) => expected[field] !== null && observed[field] !== null);
  if (comparable.length === 0) return 'unverifiable';
  if (comparable.some((field) => expected[field] !== observed[field])) return 'changed';
  if (VALIDATOR_FIELDS.some((field) => expected[field] !== null && observed[field] === null)) return 'unverifiable';
  return 'unchanged';
}
