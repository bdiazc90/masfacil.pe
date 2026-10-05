// El panel que se despliega bajo una tarjeta. Pinta lo que decide
// `offerDetailView`: no calcula textos ni pide nada a la red, así que se abre
// igual sin conexión.

// Una clase completa por producto (el color sale de `ui/styles.css`): nada se interpola.
const CHIP = Object.freeze({
  regular: 'chip chip--regular',
  premium: 'chip chip--premium',
  diesel: 'chip chip--diesel',
  glp: 'chip chip--glp',
  gnv: 'chip chip--gnv',
});
// «S/» y la unidad acompañan a la cifra sin competir con ella.
const ACOMPANANTE = 'mr-[2px] text-[12px] font-semibold text-muted-foreground';

function Chip({ chipKey, text, label }) {
  return (
    <span className={`${CHIP[chipKey] ?? 'chip'} self-center`} role="img" aria-label={label}>
      {text}
    </span>
  );
}

export function OfferDetail({ detail }) {
  const fila = 'grid grid-cols-[auto_1fr_auto] items-baseline gap-s3';
  const cuando = 'text-[13px] whitespace-nowrap text-muted-foreground';
  return (
    <div className="offer__detail">
      {detail.rows.map((row) =>
        row.amount === null ? (
          <div key={row.key} className={fila}>
            <Chip chipKey={row.key} text={row.text} label={row.label} />
            <span className="text-[16px] font-medium text-muted-foreground">sin precio vigente</span>
            <span className={cuando}></span>
          </div>
        ) : (
          <div key={row.key} className={fila}>
            <Chip chipKey={row.key} text={row.text} label={row.label} />
            <span className="text-[16px] font-bold">
              <small className={ACOMPANANTE}>S/</small>
              {row.unit ? `${row.amount} ` : row.amount}
              {row.unit ? <small className={ACOMPANANTE}>{row.unit}</small> : null}
            </span>
            <span className={cuando}>{row.when}</span>
          </div>
        ),
      )}
      <p className="m-0 mt-s1 grid gap-[2px] text-[12.5px] leading-[1.5] text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
        {detail.lastReported ? (
          <span>
            Último precio reportado el <b>{detail.lastReported}</b>
          </span>
        ) : null}
        {detail.lastObserved ? (
          <span>
            Última consulta el <b>{detail.lastObserved}</b>
          </span>
        ) : null}
        <span>
          Coordenada oficial <b>{detail.coordinate}</b>
        </span>
        {detail.attribution ? <span>{detail.attribution}</span> : null}
      </p>
      <a className="button--text" href={detail.streetViewUrl} target="_blank" rel="noopener noreferrer">
        Ver en Street View
      </a>
    </div>
  );
}
