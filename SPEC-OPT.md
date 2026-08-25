# SPEC-OPT — home directo, dos precios por tarjeta, header fijo, paginación adaptativa

> Aprobado por Bruno el 25 de agosto de 2026. Es el documento de referencia del
> agente implementador: todo el detalle está aquí, el prompt que lo invoca es corto.

## Contexto

La PWA está en producción con 545 identidades y las direcciones publicadas.
Cuatro fricciones de uso, decididas por Bruno el 25 de agosto de 2026:

1. **`/` redirige a `/gasolina/`**, una pantalla que pide elegir combustible.
   Con una sola propuesta ese paso no aporta: es un clic antes de ver nada.
2. **La app carga un producto a la vez.** Ver el precio de Premium exige
   cambiar de ruta y recargar. Los dos bundles son idénticos salvo precio y
   fecha —0 diferencias en 697 establecimientos—, así que el modelo natural es
   **una tarjeta por grifo con los dos precios**.
3. **El header se va al hacer scroll.** Slider y toggles deben verse siempre.
4. **La lista carga de 3 en 3.** En Lima Cercado a 5 km hay 120 estaciones:
   38 clics. El incremento fijo ignora la densidad.

Medidas de apoyo (25/08/2026): Regular 714 · Premium 700 · ambos 697 · solo
Regular 17 · solo Premium 3 · 682 de 697 reportan los dos productos a la vez.

## Decisiones cerradas

| Tema | Decisión |
| --- | --- |
| Home | `/` sirve la app directamente. `/gasolina/` y `/gasolina/{regular,premium}/` **redirigen a `/`** (301) para no romper enlaces guardados ni la PWA instalada |
| Selector | `web/gasolina/index.html` y `web/selector.js` se eliminan |
| Datos | Se cargan **los dos bundles siempre**, en paralelo, y se fusionan por `establishment_id` en un solo arreglo |
| Tarjeta | Muestra **ambos precios**; si falta uno, «—» |
| «Más barata» | Ordena por el producto que fija un **sub-toggle Regular/Premium**, visible solo cuando el orden es por precio |
| Header fijo | Un solo bloque `position: sticky; top: 0` con: barra de marca, slider y toggles. **Compactado** para no clavar más de ~200 px |
| Paginación | Adaptativa: **muestra 6, luego duplica** (6 → 12 → 24 → todo); si quedan ≤ 4, los muestra todos sin botón |

---

## 1. Rutas

### Cambios

| Archivo | Cambio |
| --- | --- |
| `web/_redirects` | `/` deja de redirigir. Nuevas líneas: `/gasolina/ / 301`, `/gasolina/regular/ / 301`, `/gasolina/premium/ / 301` (y sin barra final). Se elimina la regla `200` a `/index.html` |
| `web/sw.js` | Línea 42: quitar `if (url.pathname === '/') respondWith(redirect)`. Array `SHELL`: quitar `/gasolina/`, `/gasolina/regular/`, `/gasolina/premium/`, `/selector.js`; añadir `/` |
| `scripts/serve-web.mjs` | Líneas 14-16: quitar los tres redirects; `/` sirve `index.html`; `/gasolina/*` responde 301 a `/` para reproducir Cloudflare en local |
| `web/index.html` | El `<a class="brand" href="/gasolina/">` pasa a `href="/"`. Quitar el listener de `masfacil-selector-intent` en `app.js` (línea 181) |
| `web/app.js` | Eliminar `routeProduct`, `switchProduct` y la lectura de `masfacil-product` en `localStorage` |
| `web/gasolina/index.html`, `web/selector.js` | **Borrar** |
| `web/index.html` línea 26 | Borrar `#product-toggle` (vive fuera de `#compare-step`, entre la appbar y `#start-step`); quitar `'product-toggle'` del arreglo `nodes` en `app.js` línea 14 |
| `web/manifest.webmanifest` | `start_url: "/gasolina/"` → `"/"`; `name: "masfacil.pe/gasolina"` → `"masfacil.pe"` |
| `scripts/verify-shell.mjs` línea 30 | `public_url_after_upload` pasa de `…/gasolina/` a `…/`. `scripts/static-shell.mjs` tolera la ausencia de `gasolina/index.html` (`continue` si no existe): no hay que tocarlo |
| `web/sw-cache-policy.js` | Subir `SHELL_CACHE` a `v17` |

### Por qué 301 y no borrar

Hay usuarios con la PWA instalada apuntando a `/gasolina/regular/`. Un 404
rompe el icono de su pantalla de inicio; un 301 lo lleva a `/` sin que note nada.

---

## 2. Datos: dos bundles, una lista

### `web/data-client.js`

Nueva función `loadGasolina()`:

```js
export async function loadGasolina(fetchImpl = fetch) {
  const [regular, premium] = await Promise.all(
    GASOLINA_KEYS.map((key) => loadGasolinaProduct(key, fetchImpl)),
  );
  return mergeProducts(regular, premium);
}
```

`loadGasolinaProduct` **se conserva tal cual**: valida manifest y SHA-256 por
producto, y el service worker ya cachea ambos. No se toca `sw.js` en su lógica
de datos.

### Fusión — `web/lib/merge-products.js` (nuevo, puro, sin DOM)

Una fila por `establishment_id`:

```js
{
  establishment_id, address, district, latitude, longitude, commercial_identity,
  prices: {
    regular: { price, reported_at, id } | null,
    premium: { price, reported_at, id } | null,
  },
}
```

Reglas:

- `address`, coordenadas e identidad se toman del primer bundle que tenga el
  establecimiento; son idénticos en ambos (medido).
- **Frescura por producto.** `filterFreshOffers` de `web/lib/freshness.js` se
  aplica **a cada bundle antes de fusionar**, no al resultado. Un grifo con
  Regular fresco y Premium vencido conserva la fila, con `premium: null`.
- `age_days` de la fila = el menor de los dos productos vigentes; es lo que
  muestra «Hace N días».
- El `id` de oferta (`g2_…`) se conserva dentro de cada precio; el detalle y
  las acciones usan `establishment_id` como clave de la tarjeta.

### Estado en `app.js`

- Desaparecen `state.product`, `state.otherPrices`, `state.otherPending`.
- `state.dataset` pasa a ser la lista fusionada; `state.cutoff_at` toma el
  cutoff más antiguo de los dos manifests (no cambian entre sí, pero se declara).
- `toggleDetail` deja de pedir el otro producto: los dos precios ya están en la
  fila. `renderOfferDetail` recibe `prices` directamente.
- `state.sort` pasa a tener tres valores: `distance`, `price:regular`,
  `price:premium`. `state.priceProduct` guarda el último producto elegido
  (por defecto `regular`) para que el sub-toggle recuerde la elección.

### `web/lib/haversine.js` — `orderOffers`

El accesor `price` se parametriza por producto. Una fila **sin ese producto** va
**al final**, no se descarta: sigue siendo un grifo cercano con el otro precio.

```js
const accessor = {
  distance: (row) => row.distance_km,
  'price:regular': (row) => row.prices.regular?.price ?? Infinity,
  'price:premium': (row) => row.prices.premium?.price ?? Infinity,
};
```

`decisionTag` («Más barata en N km») se calcula sobre el producto activo.

---

## 3. Tarjeta

### `web/offer-card.js`

Layout objetivo (ancho 360 px):

```
Regular  S/ 19.85    Premium  S/ 21.45           628 m
Primax Granada                    Av. Mariscal Castilla 905
Hace 1 día                              Santiago de Surco
  [   Ver detalle   ]          [   Cómo llegar   ]
```

- Los dos precios en la línea superior, etiquetados. El del **producto activo en
  «Más barata» va en negrita**; en «Más cerca» ambos iguales.
- Producto ausente: `Premium —`, atenuado, sin romper la fila.
- `renderOfferDetail` ya soporta `prices: { regular, premium }`: se le pasan
  directo, sin cambios de firma.
- `formatPrice`, `stationIdentity`, `isUnconfirmedIdentity`, `displayDistrict`:
  sin cambios.

---

## 4. Header fijo

### Estructura en `web/index.html`

Un contenedor `<div id="sticky-head" class="sticky-head">` que envuelve, en
este orden: `header.appbar`, `#radius-control`, `#sort-toggle` y el nuevo
`#price-product-toggle`. Vive dentro de `#compare-step` **salvo la appbar**, que
es común a todas las pantallas; por eso el contenedor sticky se monta en
`app.js` moviendo los nodos, o —más simple— la appbar queda fuera y solo los
controles de `#compare-step` son sticky. **Elegir lo segundo**: la marca no
necesita verse durante el scroll; los controles sí.

```html
<section id="compare-step">
  <div class="sticky-controls">
    <div class="results-head">…Cerca de ti · Cambiar…</div>
    <div id="radius-control">…</div>
    <div id="sort-toggle">…</div>
    <div id="price-product-toggle" class="toggle toggle--sub" hidden>
      <button data-price-product="regular">Regular</button>
      <button data-price-product="premium">Premium</button>
    </div>
  </div>
  <ol id="offers">…</ol>
</section>
```

### CSS en `web/styles.css`

```css
.sticky-controls{position:sticky;top:0;z-index:5;padding-top:8px;padding-bottom:10px;
  background:var(--background);backdrop-filter:blur(var(--blur))}
```

Compactado para que el bloque no pase de ~200 px: slider `height:36px`,
readout en la misma línea que la etiqueta, toggles `min-height:40px`, el
sub-toggle de producto más bajo (`min-height:36px`) y con `margin-top:6px`.

**Por qué `sticky` y no `fixed`:** `sticky` no saca el bloque del flujo, así que
no hay que calcular un `padding-top` compensatorio ni se rompe con el teclado
virtual. El fondo con `backdrop-filter` evita que las tarjetas se lean por
debajo mientras pasan.

### Sub-toggle de producto

- Oculto en «Más cerca». Visible en «Más barata».
- Al cambiar de producto: reordena, recalcula el tag y reinicia la paginación.
- Persistencia: **ninguna**. Vuelve a `regular` en cada carga; la decisión se
  toma en el momento y no vale la pena la complejidad.

---

## 5. Paginación adaptativa

### Regla, en `web/lib/haversine.js`

```js
export const PAGE_SIZE = 6;
export const SHOW_ALL_THRESHOLD = 4;

export function nextVisibleCount(current, total) {
  const doubled = current * 2;
  return total - doubled <= SHOW_ALL_THRESHOLD ? total : doubled;
}
```

`PAGE_INCREMENT` desaparece. Progresión: 6 → 12 → 24 → 48 → todo. Lima
Cercado a 5 km (120): **5 clics** en vez de 38. Surquillo (7): **0 clics**, porque
7 − 6 ≤ 4 muestra los 7 de una.

### Botón `#load-more`

Texto: `Ver 6 más (114 restantes)` / `Ver las 3 restantes`. Cuando el
siguiente paso es "todo", el texto lo dice.

Al pulsar, el foco pasa a la **primera tarjeta nueva** (`tabindex="-1"` +
`focus()`), y un `role="status"` anuncia «Se muestran N de M estaciones». Sin
esto, un lector de pantalla se queda en el botón sin saber qué cambió.

`visibleCount` se reinicia a `PAGE_SIZE` al mover el radio, cambiar el orden o
cambiar el producto del sub-toggle.

---

## 6. Lo que NO cambia

- Pipeline, contratos públicos (2.3.0), catálogo, matcher, `.local-cache/`.
- `loadGasolinaProduct`, `validGasolinaBundle`, la lógica de datos de `sw.js`.
- `filterFreshOffers`: se reutiliza tal cual, dos veces.
- El modo «Elegir distrito» sin ubicación: sigue mostrando 4 más baratas del
  distrito, ahora con ambos precios y orden por el sub-toggle.
- Sin dependencias nuevas. Vanilla ESM. Español en textos y comentarios.

---

## Verificación

1. `node --check` en todo `web/` y `web/lib/`.
2. `npm run project` y `npm run verify:web`: bundles idénticos a los actuales
   —no se tocan datos, los SHA-256 deben coincidir.
3. `npm run serve`:
   - `/` sirve la app; `/gasolina/`, `/gasolina/regular/`, `/gasolina/premium/`
     responden 301 a `/`.
   - `/selector.js` y `/gasolina/index.html` responden 404.
4. Con ubicación concedida, desde Surquillo:
   - la lista muestra 7 tarjetas de una, sin botón;
   - cada tarjeta trae Regular y Premium;
   - «Más barata» muestra el sub-toggle; cambiar a Premium reordena y el tag
     dice «Más barata en 1 km» sobre Premium;
   - un grifo con un solo producto aparece con «—» y va al final al ordenar
     por el que le falta.
5. Radio a 5 km desde Lima Cercado (simular con coordenadas de
   `.local-cache/identity/establecimientos.csv`): 120 resultados, botón
   «Ver 6 más (114 restantes)», luego 12, 24, 48, y al final «Ver las 24
   restantes». Nunca más de 5 clics.
6. Scroll hasta abajo con 120 tarjetas: slider y toggles siguen visibles; el
   bloque fijo no supera ~200 px en un viewport de 360×640.
7. Sin conexión (DevTools → Offline) tras una carga: la app abre en `/`, con
   ambos productos desde cache. Es la prueba de que el `SHELL` nuevo es correcto.
8. Lector de pantalla o inspección del DOM: al pulsar «Ver más», el foco cae en
   la primera tarjeta nueva y el `role="status"` cambia.
9. `npm run audit` sin hallazgos.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| PWA instalada con `start_url` viejo | 301 desde las tres rutas antiguas |
| El SW viejo sigue sirviendo `/gasolina/` desde cache | Bump de `SHELL_CACHE` a `v17`; `activate` ya borra caches anteriores |
| Header fijo demasiado alto en pantallas pequeñas | Compactado + medición explícita en viewport 360×640 |
| Duplicar la carga de datos (2 × ~250 KB) | Los dos ya viajaban bajo demanda; ahora en paralelo. El SW los sirve de cache tras la primera visita |
| `Infinity` en el orden por precio rompe `decisionTag` | El tag se calcula solo sobre filas con el producto activo presente |
