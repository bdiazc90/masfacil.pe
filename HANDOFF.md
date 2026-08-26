# HANDOFF — estado al 25 de agosto de 2026

Para el ClaudeLíder que retoma. Lee primero `AGENTS.md` y `CLAUDE.md`; esto es
el contexto vivo que esos documentos no cuentan. Todo lo que sigue está en
producción o en el repo, salvo lo marcado como pendiente.

## Producción, ahora mismo

`https://masfacil.pe/` — dominio propio (Punto.pe, DNS en Cloudflare) desde el
25/08/2026; `masfacil-pe.pages.dev` sigue vivo como alias del mismo proyecto.
Home directo, schema público **2.3.0**. El pipeline lee el bundle publicado
desde `vars.PUBLIC_ORIGIN` (`https://masfacil.pe`).

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

## Cómo funciona el flujo (lo que hay que saber para operar)

- **Datos:** Osinergmin publica UN CSV de 1.078 GB con todo el Perú. El refresh
  pregunta con HEAD si cambió (0 bytes); solo baja si cambió. Lima se filtra a
  717 establecimientos. Registro y GIS van en un seed (`BOOTSTRAP_SEED_B64`).
- **Identidad comercial:** catálogo privado en `.local-cache/identity/`, viaja
  al CI en el secret `COMMERCIAL_IDENTITY_B64` (gzip; **43.5 de 48 KB**: casi
  lleno). Se regenera con `npm run build:catalog` y se sube con
  `npm run identity:pack | gh secret set COMMERCIAL_IDENTITY_B64 --env pages-production`.
- **Gate de publicación:** `app/commercial-audit.mjs` v2 exige muestra por
  tier (≥20 revisiones) con cota recalculada; nada se publica sin pasar.
- **Cache entre corridas:** `actions/cache` guarda `.local-cache/snapshots`.
  Medido: un `force_project` con cache caliente tarda **4 min 52 s**; sin
  cache, 27 min. El giga solo se baja cuando hay precios nuevos.
- **Local:** `npm run serve` en `:4173`. En Chrome, DevTools → Application →
  Service Workers → «Bypass for network», o el SW sirve el shell viejo.

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
3. Después: aportes de usuarios + catálogo en D1 (`docs/aportes.md`, diseño
   listo, **no** implementar aún); marca desde directorios first-party; los 169
   sin nombre.

## Decisiones que no se reabren

- Google Maps como fuente de identidad está **autorizado por Bruno** (23/08);
  condiciones en `AGENTS.md`. La coordenada selecciona; confirman número de
  puerta, vía, razón social o el owner.
- `brand` solo se publica con respaldo de la razón social o `owner_verified`.
  Un nombre que queda genérico («Grifo») no se publica.
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
