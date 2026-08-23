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
npm run serve
```

Abre <http://127.0.0.1:4173>. La proyección requiere los inputs privados
autorizados de `.local-cache/`:

```bash
npm run project
npm run serve
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
npm run refresh                # refresca y promueve snapshot privado
npm run project                # proyecta Regular + Premium
npm run publish                # prepara publicación automatizada
npm run rollback -- <snapshot-id>
npm run audit                  # bloquea material privado
npm run dump:establishments    # vuelca los 717 con dirección y coordenada
```

El workflow `.github/workflows/refresh-pages.yml` comprueba cambios y despliega ambos productos juntos. Secretos de Cloudflare, seed, raws y cachés nunca se versionan.

Deploy manual, si fuera necesario:

```bash
npm run project
npm run deploy:manual
npx --yes wrangler@4.31.0 pages deploy .local-cache/publish/pages-bootstrap-web --project-name masfacil-pe --branch main
```

## Proyecto

```text
web/         PWA estática
pipeline/    transformación a snapshots públicos
app/         contratos, validación en runtime y catálogo privado
scripts/     refresh, publicación, auditoría y rollback
fixtures/    dataset sintético para los controles negativos
docs/        fuentes, decisiones y roadmap
```

Los datos privados y los JSON públicos generados viven solo en `.local-cache/`
y `web/data/`, ambos ignorados por Git:

```text
.local-cache/raw/        originales descargados
.local-cache/datasets/   datasets privados construidos
.local-cache/snapshots/  snapshots promovidos + active.json
.local-cache/identity/   catálogo, auditoría y volcados de identidad comercial
.local-cache/publish/    seed y artefactos de publicación
```

Diseño: [DESIGN.md](DESIGN.md). Fuentes y límites: [docs/datos.md](docs/datos.md). Próximos releases: [docs/roadmap.md](docs/roadmap.md).

Código original bajo Apache-2.0. La licencia no cubre datos o materiales de terceros; ver [NOTICE](NOTICE).
