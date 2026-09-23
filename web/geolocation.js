// Ubicación: un pedido a la vez, y solo vale la respuesta del último.
//
// Pedir la posición tarda, y mientras tanto la persona puede elegir un distrito,
// volver al inicio o reintentar. Cada pedido lleva su turno: una respuesta que
// llega cuando ya hubo otro pedido o una cancelación se entrega como `stale`,
// para que nadie la aplique. La app nunca se localiza sola: esto solo corre tras
// un gesto.

const OPCIONES = Object.freeze({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });

export function createLocator({ geolocation = globalThis.navigator?.geolocation, options = OPCIONES } = {}) {
  let turno = 0;
  return {
    /** Sin API de geolocalización no hay nada que pedir. */
    get available() { return Boolean(geolocation); },
    /** Descarta la respuesta del pedido en vuelo, si lo hay. */
    cancel() { turno += 1; },
    /** @returns {Promise<{status: 'ok', origin: {latitude: number, longitude: number}} | {status: 'error' | 'stale'}>} */
    request() {
      const mio = ++turno;
      return new Promise((resolve) => {
        geolocation.getCurrentPosition(
          (position) => resolve(mio !== turno ? { status: 'stale' } : { status: 'ok', origin: { latitude: position.coords.latitude, longitude: position.coords.longitude } }),
          () => resolve(mio !== turno ? { status: 'stale' } : { status: 'error' }),
          options,
        );
      });
    },
  };
}
