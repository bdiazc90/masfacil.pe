/** Decisión pequeña y cerrada entre refresco de datos y despliegue público. */
export function publicationDecision(refresh, { shellChanged = false } = {}) {
  if (!refresh || typeof refresh.status !== 'string') throw new Error('Resultado de refresco ausente o inválido');
  if (refresh.status === 'unchanged') {
    return {
      action: shellChanged ? 'deploy_existing_bundle' : 'no_op',
      download_data: false,
      project: false,
      verify: Boolean(shellChanged),
      deploy: Boolean(shellChanged),
      reason: shellChanged ? 'shell cambió; se conserva el último bundle público validado' : 'validadores sin cambio; cero bytes de datos y cero deploy',
    };
  }
  if (refresh.status === 'promoted' && refresh.promoted === true) {
    return {
      action: 'project_verify_deploy',
      download_data: true,
      project: true,
      verify: true,
      deploy: true,
      reason: 'snapshot nuevo promovido y apto para proyectar',
    };
  }
  if (['unverifiable', 'needs_review', 'rejected'].includes(refresh.status)) {
    return {
      action: 'fail_closed',
      download_data: false,
      project: false,
      verify: false,
      deploy: false,
      reason: `refresco ${refresh.status}; se conserva el último deployment bueno`,
    };
  }
  throw new Error(`Estado de refresco no permitido: ${refresh.status}`);
}
