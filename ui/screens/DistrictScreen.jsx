// Elegir distrito. El buscador acota una lista visible desde la entrada, no la
// revela; es un campo controlado que no se remonta, así que no pierde el foco
// mientras se escribe.

import { visibleDistricts } from '../district-list.js';
import { displayDistrict } from '../offer-view.js';

export function DistrictScreen({ hidden, districts, query, hint, onQuery, onPick }) {
  const texto = query.trim();
  const coinciden = visibleDistricts(districts, texto, true);
  return (
    <section id="district-step" className="screen-flow" aria-labelledby="district-title" hidden={hidden}>
      <h2 id="district-title" className="m-0 mb-[2px]" tabIndex={-1}>Elige un distrito</h2>
      <p id="district-hint" className="hint" role="status" hidden={!hint}>No pudimos usar tu ubicación. Elige un distrito o vuelve a intentarlo.</p>
      <div className="district-filter"><label htmlFor="district-search">Escribe tu distrito</label><input id="district-search" type="search" inputMode="search" autoComplete="off" spellCheck={false} placeholder="Escribe tu distrito" value={query} onChange={(event) => onQuery(event.target.value)} /><p id="district-empty" className="hint" role="status" hidden={!texto || coinciden.length > 0}>No encontramos ese distrito.</p></div>
      <div id="districts" className="chips" aria-label="Distritos disponibles">{coinciden.map((district) => <button key={district} type="button" onClick={() => onPick(district)}>{displayDistrict(district)}</button>)}</div>
    </section>
  );
}
