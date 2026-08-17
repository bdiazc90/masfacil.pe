export function buildSanitizedMeasurement({ dataset, session, selected }) {
  if (!dataset || !session || !selected) throw new Error('La tarea aún no tiene una elección');
  return {
    schema_version: 1,
    condition: 'B',
    dataset_mode: dataset.mode,
    dataset_id: dataset.dataset_id,
    origin_kind: session.originKind,
    duration_ms: Math.round(selected.completedAt - session.startedAt),
    action_count: session.actions.length,
    actions: structuredClone(session.actions),
    choice: { offer_id: selected.offer.id, visible_rank: selected.rank, sort: selected.sort },
    privacy: 'sin coordenadas personales ni PII del participante',
  };
}
