const DEFAULT_CONTROL_TIMEOUT_MS = 8_000;

function whenActivated(registration, timeoutMs, setTimer, clearTimer) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker || worker.state === 'activated') return Promise.resolve(Boolean(worker));
  return new Promise((resolve) => {
    let done = false; let timer = null;
    const finish = (activated) => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimer(timer);
      worker.removeEventListener('statechange', onStateChange);
      resolve(activated);
    };
    const onStateChange = () => {
      if (worker.state === 'activated') finish(true);
    };
    worker.addEventListener('statechange', onStateChange);
    timer = setTimer(() => finish(false), timeoutMs);
    // Cubre la transición entre la lectura inicial de state y el listener.
    queueMicrotask(onStateChange);
  });
}

function whenControlled(serviceWorker, timeoutMs, setTimer, clearTimer) {
  if (serviceWorker.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onControllerChange = () => {
      clearTimer(timer);
      serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(Boolean(serviceWorker.controller));
    };
    const timer = setTimer(() => {
      serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(false);
    }, timeoutMs);
    serviceWorker.addEventListener('controllerchange', onControllerChange);
    if (serviceWorker.controller) onControllerChange();
  });
}

/**
 * Instala el shell y espera su control antes del primer fetch de datos.
 * Si el navegador rechaza SW o no logra controlar a tiempo, la app conserva
 * una carga online normal; nunca declara datos guardados sin control real.
 */
export async function prepareServiceWorker({
  serviceWorker = globalThis.navigator?.serviceWorker,
  timeoutMs = DEFAULT_CONTROL_TIMEOUT_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!serviceWorker?.register) return { available: false, controlled: false, reason: 'unsupported' };
  try {
    const registration = await serviceWorker.register('/sw.js', { type: 'module' });
    const activated = await whenActivated(registration, timeoutMs, setTimer, clearTimer);
    if (!activated) return { available: true, controlled: false, reason: 'activation_timeout' };
    const controlled = await whenControlled(serviceWorker, timeoutMs, setTimer, clearTimer);
    return { available: true, controlled, reason: controlled ? 'controlled' : 'control_timeout' };
  } catch {
    return { available: true, controlled: false, reason: 'rejected' };
  }
}
