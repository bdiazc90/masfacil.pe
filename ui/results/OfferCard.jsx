// Una tarjeta de resultados. Pinta lo que decide `offerCardView` y guarda un solo
// estado propio: si su detalle está abierto. Su clave es vista y establecimiento,
// así que ordenar o paginar la conserva, y cambiar de combustible la reinicia: un
// detalle de Gasolina nunca queda abierto con datos de Diésel.

import { useState } from 'react';
import { UNCONFIRMED_LABEL, offerCardView, offerDetailView } from '../offer-view.js';
import { OfferDetail } from './OfferDetail.jsx';

function PriceCell({ cell }) {
  const clases = ['offer__price', cell.state ? `offer__price--${cell.state}` : null].filter(Boolean).join(' ');
  return (
    <p className={clases} data-key={cell.key}>
      <span className="chip" role="img" aria-label={cell.label}>{cell.chip}</span>
      <b>{cell.amount === null ? <><span aria-hidden="true">—</span><span className="sr-only">sin precio vigente</span></> : <><small>S/</small>{cell.amount}</>}</b>
      {cell.unit ? <small className="offer__unit">{cell.unit}</small> : null}
    </p>
  );
}

// La marca es decoración: `aria-hidden` y `alt` vacío, porque la tarjeta ya la
// dice en texto. Va primera en el marcado y detrás en pintura.
function BrandMark({ brand }) {
  return <div className="offer__brandmark" aria-hidden="true"><img src={brand.src} alt="" width={brand.width} height={brand.height} loading="lazy" decoding="async" /></div>;
}

function Identity({ card }) {
  // Un solo nodo de texto por frase, como antes: Chrome da forma al texto por
  // nodo, y partirlo movía el renglón un píxel.
  return <h3 className="offer__identity">{card.identity}{card.unconfirmed ? <span className="offer__unconfirmed">{` · ${UNCONFIRMED_LABEL}`}</span> : null}</h3>;
}

export function OfferCard({ offer, options, detailOptions }) {
  const [abierto, setAbierto] = useState(false);
  const card = offerCardView(offer, options);
  const acciones = card.detail || card.directions ? (
    <div className="offer__actions">
      {card.detail ? <button type="button" className="button button--ghost" aria-expanded={abierto} aria-label={card.detail.label} onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar' : 'Ver detalle'}</button> : null}
      {card.directions ? <a className="button button--primary" href={card.directions.url} target="_blank" rel="noopener noreferrer" aria-label={card.directions.label}>Cómo llegar</a> : null}
    </div>
  ) : null;
  const detalle = card.detail ? <div className="offer__detail-slot" hidden={!abierto}>{abierto ? <OfferDetail detail={offerDetailView(offer, detailOptions)} /> : null}</div> : null;
  // El `tabIndex={-1}` no entra al tabulador: es el destino de foco al paginar.
  if (card.silent) {
    return (
      <li className="offer offer--silent glass" data-brand={card.brand?.key} tabIndex={-1}>
        {card.brand ? <BrandMark brand={card.brand} /> : null}
        <div className="offer__grid"><Identity card={card} /><p className="offer__address">{card.address}</p><p className="offer__silence"><time dateTime={card.silence.dateTime ?? undefined}>{card.silence.text}</time></p><p className="offer__district">{card.district}</p></div>
        {acciones}
        {detalle}
      </li>
    );
  }
  return (
    <li className="offer glass" data-brand={card.brand?.key} tabIndex={-1}>
      {card.brand ? <BrandMark brand={card.brand} /> : null}
      {card.tag ? <p className="offer__tag">{card.tag}</p> : null}
      <div className="offer__topline">
        {card.prices.map((cell) => <PriceCell key={cell.key} cell={cell} />)}
        {card.distance ? <p className="offer__distance"><span className="chip chip--distance" role="img" aria-label="Distancia">DIST</span><b>{card.distance}</b></p> : null}
      </div>
      <div className="offer__grid"><Identity card={card} /><p className="offer__address">{card.address}</p><p className="offer__freshness">{card.freshness}</p><p className="offer__district">{card.district}</p></div>
      {acciones}
      {detalle}
    </li>
  );
}
