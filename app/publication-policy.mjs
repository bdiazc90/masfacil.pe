/** Decisión pequeña y cerrada entre refresco de datos y despliegue público. */

const decision = (action, { project = false, verify = false, deploy = false, reason }) => Object.freeze({ action, project, verify, deploy, reason });

/**
 * ¿`candidato` se quedó atrás frente a lo que ya sirve producción?
 *
 * Dos comprobaciones, y las DOS se hacen siempre:
 *
 * 1. El CSV. Si el snapshot publicado es posterior al del candidato, se rechaza
 *    sin más: `snapshot_id` es monótono por construcción y publicar hacia atrás
 *    devolvería precios oficiales viejos a todas las tarjetas.
 * 2. La consulta web, unidad por unidad. Esto se mira **también cuando el CSV
 *    del candidato es nuevo**: traer un archivo más reciente no autoriza a
 *    retroceder seis horas en un distrito. Un máximo tampoco sirve, porque lo
 *    esconde: producción con dos distritos leídos a las 12:00 y un candidato con
 *    uno a las 13:00 y otro a las 06:00 tiene un máximo mayor y publicaría hacia
 *    atrás en el segundo.
 *
 * Basta que UNA unidad retroceda —o que falte, porque perderla es perder esa
 * captura— para conservar la entrega vigente.
 */
export function dataStateIsBehind(candidato, publicado) {
  const aSnap = candidato?.snapshot_id ?? '';
  const bSnap = publicado?.snapshot_id ?? '';
  if (aSnap < bSnap) return true;
  return dataStateRegressions(candidato, publicado).length > 0;
}

/**
 * Las unidades del candidato que irían hacia atrás, para explicar el rechazo.
 *
 * No depende del snapshot: un CSV nuevo no exime de comparar las consultas.
 */
export function dataStateRegressions(candidato, publicado) {
  const aUnidades = candidato?.facilito?.units_observed ?? {};
  return Object.entries(publicado?.facilito?.units_observed ?? {})
    .filter(([clave, publicada]) => !aUnidades[clave] || Date.parse(aUnidades[clave]) < Date.parse(publicada))
    .map(([clave, publicada]) => `${clave}: ${aUnidades[clave] ?? 'ausente'} < ${publicada}`);
}

/**
 * Rutas que no dependen de la fuente. `docs` no publica nada; `shell` publica el
 * cliente nuevo sobre el bundle público ya validado, y por eso no recibe —ni
 * necesita— un resultado de refresco: antes una caída de Osinergmin dejaba un
 * cambio de CSS sin publicar, porque la única rama que reutilizaba el bundle
 * vivía dentro del estado `unchanged`.
 */
export function publicationDecisionForRoute(route, refresh, { forceProject = false, reusedSnapshot = null, facilitoAvailable = false, officialSnapshotUsable = false } = {}) {
  if (route === 'docs') return decision('no_op', { reason: 'solo documentación; cero bytes de datos y cero deploy' });
  if (route === 'shell') return decision('deploy_existing_bundle', { verify: true, deploy: true, reason: 'shell nuevo sobre el último bundle público validado; sin refresco ni proyección' });
  // Reproyectar no necesita precios nuevos: con un snapshot privado utilizable
  // la ruta de proyección tampoco consulta la fuente.
  if (route === 'project' && reusedSnapshot) return decision('reproject_verify_deploy', { project: true, verify: true, deploy: true, reason: `reproyección desde el snapshot privado ${reusedSnapshot}; la fuente no se consultó` });
  return publicationDecision(refresh, { forceProject, facilitoAvailable, officialSnapshotUsable });
}

export function publicationDecision(refresh, { forceProject = false, facilitoAvailable = false, officialSnapshotUsable = false } = {}) {
  if (!refresh || typeof refresh.status !== 'string') throw new Error('Resultado de refresco ausente o inválido');
  if (refresh.status === 'unchanged') {
    // El diseño asumía que solo un dato nuevo justifica reproyectar. Pero un
    // cambio en el CÓDIGO de proyección —un campo nuevo, un catálogo de
    // identidad distinto— también lo exige, y nada lo disparaba: el contrato
    // 2.2.0 con dirección quedó construido y sin publicar. Este forzado lo
    // cubre, y solo aplica cuando el refresco fue limpio: si falla, manda el
    // fail_closed de abajo.
    if (forceProject) return decision('force_project_verify_deploy', { project: true, verify: true, deploy: true, reason: 'reproyección forzada sobre el snapshot activo; los datos no cambiaron' });
    // El CSV es semanal y la consulta web es de horas: que el archivo no haya
    // cambiado ya no significa que los precios que mostramos sigan siendo los
    // mismos. Se compone para mirar, no para publicar a ciegas: si la capa no
    // mueve ningún precio efectivo, quien decide más arriba degrada a `no_op`.
    if (facilitoAvailable) return decision('facilito_project_verify_deploy', { project: true, verify: true, deploy: true, reason: 'la fuente CSV no cambió; se compone con la consulta web y se publica solo si cambia algún precio efectivo' });
    return decision('no_op', { reason: 'validadores sin cambio; cero bytes de datos y cero deploy' });
  }
  if (refresh.status === 'promoted') {
    // `promoted: false` con estado `promoted` no es una combinación esperada; se
    // cierra con el último deployment bueno en vez de caer por una excepción que
    // el llamador tenía que traducir a fail_closed por su cuenta.
    if (refresh.promoted !== true) return decision('fail_closed', { reason: 'refresco promovido sin confirmar la promoción; se conserva el último deployment bueno' });
    return decision('project_verify_deploy', { project: true, verify: true, deploy: true, reason: 'snapshot nuevo promovido y apto para proyectar' });
  }
  if (['unverifiable', 'needs_review', 'rejected'].includes(refresh.status)) {
    // Un fallo del CSV no tiene por qué apagar la otra fuente. El pointer activo
    // sigue apuntando al último snapshot oficial VALIDADO —un candidato que no
    // pasa los guardrails no se promueve— así que hay referencia oficial con la
    // que resolver el vínculo y publicar la consulta de hoy. Sin esa referencia
    // no se publica ningún vínculo nuevo: se conserva la entrega anterior.
    if (facilitoAvailable && officialSnapshotUsable) {
      return decision('facilito_over_last_valid_snapshot', { project: true, verify: true, deploy: true, reason: `refresco ${refresh.status}; se compone la consulta web sobre el último snapshot oficial válido y se publica solo si cambia algún precio efectivo` });
    }
    return decision('fail_closed', { reason: `refresco ${refresh.status}; se conserva el último deployment bueno` });
  }
  throw new Error(`Estado de refresco no permitido: ${refresh.status}`);
}
