/** Decisión pequeña y cerrada entre refresco de datos y despliegue público. */

const decision = (action, { project = false, verify = false, deploy = false, reason }) => Object.freeze({ action, project, verify, deploy, reason });

/**
 * Rutas que no dependen de la fuente. `docs` no publica nada; `shell` publica el
 * cliente nuevo sobre el bundle público ya validado, y por eso no recibe —ni
 * necesita— un resultado de refresco: antes una caída de Osinergmin dejaba un
 * cambio de CSS sin publicar, porque la única rama que reutilizaba el bundle
 * vivía dentro del estado `unchanged`.
 */
export function publicationDecisionForRoute(route, refresh, { forceProject = false, reusedSnapshot = null } = {}) {
  if (route === 'docs') return decision('no_op', { reason: 'solo documentación; cero bytes de datos y cero deploy' });
  if (route === 'shell') return decision('deploy_existing_bundle', { verify: true, deploy: true, reason: 'shell nuevo sobre el último bundle público validado; sin refresco ni proyección' });
  // Reproyectar no necesita precios nuevos: con un snapshot privado utilizable
  // la ruta de proyección tampoco consulta la fuente.
  if (route === 'project' && reusedSnapshot) return decision('reproject_verify_deploy', { project: true, verify: true, deploy: true, reason: `reproyección desde el snapshot privado ${reusedSnapshot}; la fuente no se consultó` });
  return publicationDecision(refresh, { forceProject });
}

export function publicationDecision(refresh, { forceProject = false } = {}) {
  if (!refresh || typeof refresh.status !== 'string') throw new Error('Resultado de refresco ausente o inválido');
  if (refresh.status === 'unchanged') {
    // El diseño asumía que solo un dato nuevo justifica reproyectar. Pero un
    // cambio en el CÓDIGO de proyección —un campo nuevo, un catálogo de
    // identidad distinto— también lo exige, y nada lo disparaba: el contrato
    // 2.2.0 con dirección quedó construido y sin publicar. Este forzado lo
    // cubre, y solo aplica cuando el refresco fue limpio: si falla, manda el
    // fail_closed de abajo.
    if (forceProject) return decision('force_project_verify_deploy', { project: true, verify: true, deploy: true, reason: 'reproyección forzada sobre el snapshot activo; los datos no cambiaron' });
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
    return decision('fail_closed', { reason: `refresco ${refresh.status}; se conserva el último deployment bueno` });
  }
  throw new Error(`Estado de refresco no permitido: ${refresh.status}`);
}
