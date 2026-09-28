export function visibleDistricts(districts, query = '', showAll = false) {
  const normalizedQuery = query.trim().toLocaleLowerCase('es-PE');
  if (!normalizedQuery && !showAll) return [];
  return districts.filter((district) => district.toLocaleLowerCase('es-PE').includes(normalizedQuery));
}
