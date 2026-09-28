// El panel que se despliega bajo una tarjeta. Pinta lo que decide
// `offerDetailView`: no calcula textos ni pide nada a la red, así que se abre
// igual sin conexión.

function Chip({ chipKey, text, label }) {
  return <span className={`chip chip--${chipKey}`} role="img" aria-label={label}>{text}</span>;
}

export function OfferDetail({ detail }) {
  return (
    <div className="offer__detail">
      {detail.rows.map((row) => (row.amount === null ? (
        <div key={row.key} className="detail__row detail__row--empty"><Chip chipKey={row.key} text={row.text} label={row.label} /><span className="detail__price">sin precio vigente</span><span className="detail__when"></span></div>
      ) : (
        <div key={row.key} className="detail__row"><Chip chipKey={row.key} text={row.text} label={row.label} /><span className="detail__price"><small>S/</small>{row.unit ? `${row.amount} ` : row.amount}{row.unit ? <small className="detail__unit">{row.unit}</small> : null}</span><span className="detail__when">{row.when}</span></div>
      )))}
      <p className="detail__meta">
        {detail.lastReported ? <span>Último precio reportado el <b>{detail.lastReported}</b></span> : null}
        {detail.lastObserved ? <span>Última consulta el <b>{detail.lastObserved}</b></span> : null}
        <span>Coordenada oficial <b>{detail.coordinate}</b></span>
        {detail.attribution ? <span>{detail.attribution}</span> : null}
      </p>
      <a className="button--text" href={detail.streetViewUrl} target="_blank" rel="noopener noreferrer">Ver en Street View</a>
    </div>
  );
}
