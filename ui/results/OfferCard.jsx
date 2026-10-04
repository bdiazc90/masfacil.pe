// Una tarjeta de resultados. Pinta lo que decide `offerCardView` y guarda un solo
// estado propio: si su detalle está abierto. Su clave es vista y establecimiento,
// así que ordenar o paginar la conserva, y cambiar de combustible la reinicia: un
// detalle de Gasolina nunca queda abierto con datos de Diésel.
//
// La maquetación va en utilidades; el vidrio, la capa de marca, el chip y los
// estados de la cifra (activa, apagada, sin precio) son CSS de componente en
// `ui/styles.css`, porque mezclan colores que mide `scripts/contrast.mjs`.

import { useState } from 'react';
import { UNCONFIRMED_LABEL, offerCardView, offerDetailView } from '../offer-view.js';
import { OfferDetail } from './OfferDetail.jsx';

// Una clase completa por estado: Tailwind y grep las encuentran, nada se interpola.
const CELDA_PRECIO = Object.freeze({ on: 'offer__price offer__price--on', muted: 'offer__price offer__price--muted', absent: 'offer__price offer__price--absent' });
// A 340 px o menos los dos botones de la tarjeta se aprietan para caber.
const BOTON_ESTRECHO = 'estrecho:px-[10px] estrecho:text-[14px] estrecho:tracking-[.02em]';

function PriceCell({ cell }) {
  return (
    <p className={CELDA_PRECIO[cell.state] ?? 'offer__price'} data-key={cell.key}>
      <span className="chip" role="img" aria-label={cell.label}>{cell.chip}</span>
      <b>{cell.amount === null ? <><span aria-hidden="true">—</span><span className="sr-only">sin precio vigente</span></> : <><small>S/</small>{cell.amount}</>}</b>
      {cell.unit ? <small className="text-[12.5px] font-semibold text-muted-foreground">{cell.unit}</small> : null}
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
  // nodo, y partirlo movía el renglón un píxel. El tamaño es el de todo `h3`.
  return <h3 className="font-bold leading-[1.35]">{card.identity}{card.unconfirmed ? <span className="text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground">{` · ${UNCONFIRMED_LABEL}`}</span> : null}</h3>;
}

// Identidad y dirección arriba, frescura (o silencio) y distrito abajo; la
// columna derecha se alinea a la derecha. Ninguna celda empuja el ancho.
function Datos({ card, silenciosa }) {
  return (
    <div className={`m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-s3 gap-y-[2px] *:m-0 *:min-w-0 *:[overflow-wrap:anywhere] ${silenciosa ? 'mb-s3' : 'mb-s4'}`}>
      <Identity card={card} />
      <p className="text-right text-[14.5px] leading-[1.35]">{card.address}</p>
      {silenciosa
        ? <p className="text-[13.5px] font-semibold text-muted-foreground"><time dateTime={card.silence.dateTime ?? undefined}>{card.silence.text}</time></p>
        : <p className="text-[13.5px] text-muted-foreground">{card.freshness}</p>}
      <p className="text-right text-[13.5px] text-muted-foreground">{card.district}</p>
    </div>
  );
}

export function OfferCard({ offer, options, detailOptions }) {
  const [abierto, setAbierto] = useState(false);
  const card = offerCardView(offer, options);
  const acciones = card.detail || card.directions ? (
    <div className="grid grid-cols-[1fr_1fr] gap-s3">
      {card.detail ? <button type="button" className={`button button--ghost ${BOTON_ESTRECHO}`} aria-expanded={abierto} aria-label={card.detail.label} onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar' : 'Ver detalle'}</button> : null}
      {card.directions ? <a className={`button button--primary ${BOTON_ESTRECHO}`} href={card.directions.url} target="_blank" rel="noopener noreferrer" aria-label={card.directions.label}>Cómo llegar</a> : null}
    </div>
  ) : null;
  const detalle = card.detail ? <div hidden={!abierto}>{abierto ? <OfferDetail detail={offerDetailView(offer, detailOptions)} /> : null}</div> : null;
  // El `tabIndex={-1}` no entra al tabulador: es el destino de foco al paginar.
  if (card.silent) {
    return (
      <li className="offer offer--silent glass" data-brand={card.brand?.key} tabIndex={-1}>
        {card.brand ? <BrandMark brand={card.brand} /> : null}
        <Datos card={card} silenciosa />
        {acciones}
        {detalle}
      </li>
    );
  }
  return (
    <li className="offer glass" data-brand={card.brand?.key} tabIndex={-1}>
      {card.brand ? <BrandMark brand={card.brand} /> : null}
      {card.tag ? <p className="m-0 mb-s2 text-[13px] font-bold text-accent">{card.tag}</p> : null}
      {/* Los tres datos que se comparan, en una fila y repartidos: la esquina
          superior derecha queda libre para que la marca sangre sin pisar nada. */}
      <div className="mb-s3 flex items-center justify-around gap-s2 estrecho:gap-s1">
        {card.prices.map((cell) => <PriceCell key={cell.key} cell={cell} />)}
        {card.distance ? <p className="m-0 grid justify-items-start gap-s1"><span className="chip chip--distance" role="img" aria-label="Distancia">DIST</span><b className="text-[18px] leading-none font-semibold whitespace-nowrap text-muted-foreground estrecho:text-[16px]">{card.distance}</b></p> : null}
      </div>
      <Datos card={card} />
      {acciones}
      {detalle}
    </li>
  );
}
