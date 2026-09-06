# HANDOFF — estado al 25 de agosto de 2026

Para el ClaudeLíder que retoma. Lee primero `AGENTS.md` y `CLAUDE.md`; esto es
el contexto vivo que esos documentos no cuentan. Todo lo que sigue está en
producción o en el repo, salvo lo marcado como pendiente.

## Producción, ahora mismo

`https://masfacil.pe/` — dominio propio (Punto.pe, DNS en Cloudflare) desde el
25/08/2026; `masfacil-pe.pages.dev` sigue vivo como alias del mismo proyecto.
Home directo, schema público **2.3.0**. El pipeline lee el bundle publicado
desde `vars.PUBLIC_ORIGIN` (`https://masfacil.pe`).

> **Al 6/09/2026 producción sirve el bundle del 29 de agosto** (revisión
> `…-2026-08-29-…-identity-v1`): ocho días de atraso por el fallo del refresco,
> ya arreglado. En local está proyectado y verificado el snapshot del 6/09 con
> schema **2.4.0**. **El deploy no está hecho: espera autorización de Bruno.**

- **715 ofertas**, todas con dirección; **545 con nombre** (374 `verified`,
  171 `nearby` marcadas «por confirmar»); 170 sin nombre con fallback honesto.
- Una tarjeta por grifo con **Regular y Premium**; radio de búsqueda adaptativo
  (1–5 km, arranca donde caben 6); paginación que duplica (6 → 12 → 24 → todo);
  controles fijos al hacer scroll; panel de detalle con ambos precios.
- Rutas viejas (`/gasolina/`, `/gasolina/{regular,premium}/`) → **301** a `/`.
- Precisión declarada en la app: 54 revisiones del owner sin un solo error,
  cota inferior de Wilson 89 % (`verified`) y 86 % (`nearby`).
- Refresco automático 4×/día (cron 03:17 · 09:17 · 15:17 · 21:17 Lima).
- **Datos y código van separados en el deploy.** Un push que solo toca `web/`
  se publica solo, en menos de un minuto: el runner baja el bundle ya publicado
  (~500 KB), lo verifica por SHA-256 y re-sube el shell. El giga de Osinergmin
  se paga únicamente cuando cambian los precios (cron) o cuando se fuerza una
  reproyección: `gh workflow run … -f force_project=true`, obligatorio para
  cambios de catálogo, contrato o código de `pipeline/`, `app/`, `scripts/`.
  Un push mixto (`web/` + código de proyección) no despliega y avisa en el log.
  Para re-publicar el shell a mano: `-f deploy_shell=true`.

## Dominio y borde (configurado el 25–26/08/2026)

- Registrar Punto.pe; DNS y borde en Cloudflare (nameservers `clayton` y
  `treasure`). Pages tiene como custom domains `masfacil.pe` y `www.masfacil.pe`.
- Una sola URL canónica: `https://masfacil.pe/`. Redirect Rule de zona
  `www → apex` (301, conserva query) y Bulk Redirect de cuenta
  `masfacil-pe.pages.dev → masfacil.pe` (301, sin subdominios: los previews
  `<hash>.masfacil-pe.pages.dev` siguen sirviendo para depurar).
- SSL Full (strict), TLS 1.3 activo, HTTP→HTTPS 301. Sin correo: MX nulo,
  `v=spf1 -all` y DMARC `p=reject`.
- **Pendiente:** DNSSEC habilitado en Cloudflare, esperando que Punto.pe
  publique el DS (ticket abierto el 26/08; comprobar con
  `dig DS masfacil.pe @1.1.1.1 +short`). **HSTS** recién a partir del
  2/09/2026 si nada falló: max-age 6 meses, subdominios sí, preload no.
- PWA instalable: iconos PNG 192/512 + maskable + `apple-touch-icon`,
  manifest con `id` y `scope` en `/`. Instalada por Bruno desde `masfacil.pe`.

## Cómo funciona el flujo (lo que hay que saber para operar)

- **Datos:** Osinergmin publica UN CSV de ~1.22 GB con todo el Perú. El refresh
  pregunta con HEAD si cambió (0 bytes); solo baja si cambió. Lima se filtra a
  ~720 establecimientos. Registro y GIS van en un seed (`BOOTSTRAP_SEED_B64`).
- **Universo del Registro ≠ ofertas vigentes** (arreglado el 6/09/2026). El
  índice comercial recibía la unión de IDs de las ofertas ya filtradas como si
  fuera el universo válido: una estación que dejaba de reportar precio salía de
  esa unión, pasaba a «ID desconocido» y tumbaba la corrida entera. Fueron 27
  fallos seguidos desde el 30/08 con producción congelada en el bundle del 29.
  Ahora la identidad se VALIDA contra el Registro (744 anchors Lima/Lima, del
  seed o de las tablas locales) y se PROYECTA solo sobre las ofertas que hoy
  existen. Las identidades sin oferta se conservan en privado, en
  `.local-cache/publish/commercial-identity-coverage.json`. Un ID ajeno al
  Registro sigue bloqueando.
- **Identidad comercial:** catálogo privado en `.local-cache/identity/`, viaja
  al CI en el secret `COMMERCIAL_IDENTITY_B64`. **Ya no cabe en uno solo:**
  53.252 bytes contra un límite de 48 KB. `npm run identity:pack` lo parte y
  deja los trozos en `.local-cache/identity/identity-secret-parts/`; el CI los
  reensambla desde `COMMERCIAL_IDENTITY_B64`, `_2`, `_3`. Si falta una parte o
  llegan desordenadas el gunzip falla y no se publica: la partición se verifica
  sola. `npm run identity:pack -- --measure` dice si todavía cabe en uno.
- **Gate de publicación:** `app/commercial-audit.mjs` **v3**. Cada veredicto
  declara qué AFIRMACIÓN revisó (`claim`: `name` o `brand`) y su hash cubre solo
  los campos de esa afirmación: incorporar una marca no hereda el visto bueno
  del nombre, y corregir un nombre no invalida una bandera aprobada. Tiers de
  nombre por confianza (≥20 revisiones); tiers de bandera por método de
  acreditación (umbral 0.90, muestra 35 o el grupo entero si es menor). Un grupo
  de bandera que no pasa **no bloquea la publicación**: pierde el logo y su
  marca se sigue publicando como texto.
- **Compatibilidad:** el contrato acepta catálogo 1.2.0 y 1.3.0, y auditoría
  2.0.0 y 3.0.0. Con el secret viejo todo sigue publicando igual que hoy, sin
  logos. No hace falta recargar el secret para desplegar.
- **Cache entre corridas:** `actions/cache` guarda `.local-cache/snapshots`.
  Medido: un `force_project` con cache caliente tarda **4 min 52 s**; sin
  cache, 27 min. El giga solo se baja cuando hay precios nuevos.
- **Local:** `npm run serve` en `:4173`. En Chrome, DevTools → Application →
  Service Workers → «Bypass for network», o el SW sirve el shell viejo.
- **Refresco rechazado:** `scripts/publish.mjs` conserva la causa original.
  Antes, un rechazo del refresh llegaba por stderr, el parseo de stdout fallaba
  y la excepción tapaba el motivo real sin dejar `refresh-result.json`; el paso
  de CI se caía después leyendo un archivo que no existía. Ahora cualquier
  salida produce un resultado estructurado, siempre se escribe el archivo y CI
  informa si aun así faltara.

## Roadmap corto, decidido por Bruno

1. **UI de precios — LISTO PARA IMPLEMENTAR.** Mockup aprobado en
   `mockup.html` (raíz del repo, autocontenido, con toggles funcionales).
   Variante B: chips `REG`/`PRE` mono 8 px desaturados; fila
   `justify-between`; cifra 24 px peso 800 con «S/» reducido; **énfasis en la
   tarjeta** según el sub-toggle (cifra y chip del producto activo en color
   fuerte, el otro a gris); sub-toggle genérico negro; fondo con tres brillos
   ámbar/naranja sin velo; escala de espaciado 4/8/12/16/24; fila
   `LUGAR · ◎ Mi ubicación · Cambiar` en el navbar; panel de detalle con chips.
   Tokens nuevos: `--product-regular` `#3d8a5f`/`#1f7a4a`, `--product-premium`
   `#4a78a8`/`#2860a8` (y sus variantes oscuras, en el mockup). Toca solo
   `web/offer-card.js`, `web/styles.css`, `web/index.html`.
   **Además:** quitar la leyenda `#offers-note` («Estación sin nombre
   verificado») sobre la lista, y revisar el resto de textos.
2. ~~Separar «datos» de «código» en el deploy.~~ Hecho el 25/08:
   `scripts/fetch-live-bundle.mjs` + camino `deploy_existing_bundle`.
3. ~~Marca desde directorios first-party.~~ Repsol hecho el 6/09: su padrón
   oficial (`scripts/brand-directory.mjs`) acredita 110 establecimientos y la
   marca publicada sube de 138 a 197 de 717. Primax exige autenticación en su
   localizador; AVA y Petroperú cargan por JS. **Los logos siguen apagados**
   hasta que Bruno revise la muestra de 35 en
   `.local-cache/identity/brand-sample.html` y devuelva
   `.local-cache/identity/veredictos-marca.json`.
4. Después: aportes de usuarios + catálogo en D1 (`docs/aportes.md`, diseño
   listo, **no** implementar aún); los que siguen sin nombre.

## Frescura de precios (medido y decidido el 26/08/2026)

- La fuente oficial automatizable es **semanal**: el CSV de `Reporte-Diario`
  se regenera los martes ~07:30 Lima (18 y 25 ago; cuatro sondas del lunes 24
  sin cambio) y trae registros hasta el lunes 23:59. Un cambio de mitad de
  semana tarda hasta 6 días. Facilito sí muestra el registro PRICE en horas,
  pero no tiene API pública y su web lleva reCAPTCHA: no se automatiza.
- Por norma (RCD 050-2017 y 256-2021-OS/CD, art. 3) el grifo registra el cambio
  **inmediatamente** y el precio registrado debe ser igual al del surtidor:
  `FECHA_DE_REGISTRO` es el inicio de vigencia. La tarjeta puede decir «Precio
  desde el 24 ago.» con verdad. Detalle en `docs/datos.md`.
- Camino a ≤ 24 h: pedir a Osinergmin la publicación diaria (la carpeta se llama
  «Reporte-Diario» y se publica semanal) o un acceso; y los aportes de usuarios
  (`docs/aportes.md`) como evidencia junto al precio oficial.

## Decisiones que no se reabren

- Google Maps como fuente de identidad está **autorizado por Bruno** (23/08);
  condiciones en `AGENTS.md`. La coordenada selecciona; confirman número de
  puerta, vía, razón social o el owner.
- `brand` se publica con respaldo de la razón social del operador, del
  directorio oficial vigente de la cadena o de `owner_verified`. Un nombre que
  queda genérico («Grifo») no se publica. El **logo** exige además que el grupo
  de acreditación pase su propia auditoría de bandera: sin eso, la marca sale
  como texto y sin logo.
- Un reporte de precio de usuario **nunca** reemplaza el oficial.
- Auditar por muestra, no entrada por entrada.

## Herramientas que ya existen (no reinventar)

`npm run dump:establishments` (717 con dirección/coord) · `harvest:centers` /
`harvest:match` (barrido y matcher de Google) · `audit:sheet` (hoja de
auditoría en `:4174`; `--candidatos` en `:4175`) · `build:catalog` ·
`identity:pack` / `identity:install` · `rollback`.

## Cabos sueltos conocidos

- `/selector.js` aún responde 200 en Cloudflare (CDN cacheado); se purga solo.
- «El Cortijo» es la única entrada `owner_verified` con override en
  `scripts/build-catalog.mjs` (`OWNER_OVERRIDES`); el patrón sirve para más.
- `scripts/build-dataset.mjs` (539 líneas, pipeline de agosto 14) sigue
  corriendo en cada refresh y `project` solo lee dos fechas de su salida.
  Podable, pero entrelazado con `legacyQuality` y rollback: ciclo propio.
