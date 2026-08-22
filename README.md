# masfacil.pe

PWA independiente para comparar Gasohol Regular y Premium en Lima provincia por precio reportado, cercanía y frescura. No está afiliada, aprobada ni producida por Osinergmin, Facilito ni el Estado peruano.

## Estado

- Primera versión desplegada en Cloudflare Pages y funcionando.
- Rutas: `/gasolina/`, `/gasolina/regular/` y `/gasolina/premium/`.
- 714 establecimientos Regular, 700 Premium y 717 en la unión actual.
- Identidad Comercial preparada en el bundle 2.1, pero todavía en **0/717**.
- Sin identidad verificada se muestra `Estación sin nombre verificado`.

La app nunca afirma stock, horario, descuentos o disponibilidad. Las ofertas de más de 30 días se ocultan antes de ordenar.

## Uso local

Requiere Node.js.

```bash
npm run serve:web
```

Abre <http://127.0.0.1:4173>. Para una demo sin datos reales:

```bash
npm run demo
```

La proyección real requiere los inputs privados autorizados de `.local-cache/`:

```bash
npm run project:gasolina
npm run serve:web
```

`web/data/` se genera localmente y no vive en Git.

## Cómo decide la interfaz

- Con ubicación: fija un pool de 20 estaciones cercanas y muestra 4, ordenables por cercanía o precio.
- Sin ubicación: permite elegir distrito y no fabrica distancia.
- La edad se recalcula en el navegador.
- `Cómo llegar` abre Google Maps con el destino tras una acción explícita.
- La ubicación del usuario no se envía a servidores de masfacil.pe.

## Identidad Comercial

El pipeline ya admite `{brand, public_site_name}` unido a `establishment_id`. La investigación web terminó sin un puente válido: una razón social no se convierte en marca y no se une por dirección, coordenada o similitud.

El siguiente release necesita una primera observación `owner_verified` que muestre en el mismo establecimiento:

1. marca visible;
2. Registro oficial exacto;
3. fecha y responsable de verificación.

El expediente permanece privado; el JSON público contiene solo la identidad mínima.

## Operación

```bash
npm run refresh:gate-3.3       # refresca y promueve snapshot privado
npm run project:gasolina       # proyecta Regular + Premium
npm run prepare:gate-4.3       # prepara publicación automatizada
npm run rollback:gate-4.3 -- <snapshot-id>
npm run audit:publication      # bloquea material privado
```

El workflow `.github/workflows/refresh-pages.yml` comprueba cambios y despliega ambos productos juntos. Secretos de Cloudflare, seed, raws y cachés nunca se versionan.

Bootstrap manual, si fuera necesario:

```bash
npm run project:gasolina
npm run prepare:pages-bootstrap
npx --yes wrangler@4.31.0 pages deploy .local-cache/gate-4.3/pages-bootstrap-web --project-name masfacil-pe --branch main
```

## Proyecto

```text
web/         PWA estática
pipeline/    transformación a snapshots públicos
app/         utilidades y catálogo privado
contracts/   validación en runtime
scripts/     refresh, publicación, auditoría y rollback
docs/        fuentes, decisiones y roadmap
evidence/    métricas agregadas y sanitizadas
```

Diseño: [DESIGN.md](DESIGN.md). Fuentes y límites: [docs/datos.md](docs/datos.md). Próximos releases: [docs/roadmap.md](docs/roadmap.md).

Código original bajo Apache-2.0. La licencia no cubre datos o materiales de terceros; ver [NOTICE](NOTICE).
