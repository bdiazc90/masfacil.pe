// Mientras se pide la posición. «Ver distritos» la descarta: elegir distrito
// siempre gana a una respuesta que todavía no llegó.

export function LoadingScreen({ hidden, onDistricts }) {
  return (
    <section id="loading-step" className="screen-flow loading" aria-live="polite" hidden={hidden}>
      <div className="center"><span className="dot" aria-hidden="true"></span><p className="lede">Buscando tu ubicación…</p><button id="cancel-location" className="button--text" type="button" onClick={onDistricts}>Ver distritos</button></div>
    </section>
  );
}
