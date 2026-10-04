// La lista de resultados y lo que la rodea: el aviso de «sin precios recientes»,
// las tarjetas, el vacío por radio, «Ver más» y el recuento para lectores de
// pantalla.
//
// Recibe la vista ya calculada por las reglas (`resultsView` de `web/lib/search.js`)
// y una sola acción, `onLoadMore`: la búsqueda, el orden y cuántas tarjetas se
// ven tienen un único dueño, el coordinador. Aquí solo vive lo que es de esta
// lista: el detalle abierto de cada tarjeta y adónde va el foco al paginar.
//
// Los cinco nodos existen siempre y conmutan `hidden`, como antes: el recuento es
// una región viva y tiene que estar montado para anunciar.

import { useLayoutEffect, useRef } from 'react';
import { safeGoogleMapsDirectionsUrl } from '../../web/lib/directions.js';
import { resultsCopy } from '../offer-view.js';
import { OfferCard } from './OfferCard.jsx';

export function Results({ view = null, viewKey = null, products, priceUnit, withDistance = false, attribution = null, sourceUrl = null, onLoadMore = null }) {
  const lista = useRef(null);
  // Tras «Ver más», el botón puede desaparecer y el foco caería en <body>: pasa a
  // la primera tarjeta nueva, que es justo lo que se acaba de pedir.
  const focoPendiente = useRef(null);
  useLayoutEffect(() => {
    if (focoPendiente.current === null) return;
    const destino = lista.current?.children[focoPendiente.current];
    focoPendiente.current = null;
    destino?.focus();
  });
  const copy = resultsCopy(view, viewKey);
  const items = view?.items ?? [];
  const opciones = (offer, index) => ({ withDistance, directionsUrl: safeGoogleMapsDirectionsUrl(offer), tag: view.tags[index], activeProduct: view.activeProduct, products, priceUnit });
  const detalle = { attribution, products, priceUnit };
  return (
    <>
      {/* Acompaña a las tarjetas mudas, no las sustituye: el grifo sigue existiendo aunque hoy no diga a cuánto vende. */}
      <section id="empty-state" className="plate mt-s4" hidden={!view || view.hasPrices}>
        <p className="m-0 mb-s3 text-[12.5px] font-bold tracking-[.09em] text-accent uppercase">Sin precios recientes</p>
        <h2 className="mb-s3">Ningún grifo reportó precio en los últimos 30 días</h2>
        <p className="lede">Los grifos siguen ahí, pero hoy ninguno tiene un precio que sirva para decidir.</p>
        <a id="official-source" className="button button--primary" href={sourceUrl ?? undefined} target="_blank" rel="noopener noreferrer">Ver en la fuente oficial</a>
      </section>
      <ol id="offers" className="m-0 mt-s4 grid list-none gap-s3 p-0" ref={lista} hidden={items.length === 0}>
        {items.map((offer, index) => <OfferCard key={`${viewKey}:${offer.establishment_id}`} offer={offer} options={opciones(offer, index)} detailOptions={detalle} />)}
      </ol>
      <section id="radius-empty" className="plate mt-s4" hidden={!view?.radiusEmpty}>
        <h2 id="radius-empty-title" className="mb-s3">{copy.radiusEmpty.title}</h2>
        <p id="radius-empty-text" className="lede">{copy.radiusEmpty.text}</p>
      </section>
      <button id="load-more" className="button button--ghost mt-s3" type="button" hidden={!view || view.remaining <= 0} onClick={() => { focoPendiente.current = items.length; onLoadMore?.(); }}>{copy.loadMore}</button>
      <p id="offers-status" className="sr-only" role="status">{copy.status}</p>
    </>
  );
}
