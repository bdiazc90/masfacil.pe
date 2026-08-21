# DESIGN.md

Contrato de diseño de `masfacil.pe`. Fuente canónica de los principios de interfaz y del
sistema visual de **todas** las rutas.

Agnóstico al stack: hoy se implementa en HTML, CSS y JavaScript sin dependencias; debe
seguir siendo válido cuando la interfaz se construya con un framework.

**Autoridad.** Si este documento y el código discrepan, gana el código que pasa sus
pruebas, y este documento se corrige en el mismo commit. Un principio que no se puede
falsificar es decoración: por eso cada uno declara **cómo se detecta que se violó**.

---

## 1 · Qué se está diseñando

`masfacil.pe` es una colección de **utilitarios cívicos**: herramientas pequeñas que
ayudan a decidir algo concreto con datos públicos oficiales. `/gasolina` es la primera;
el horizonte incluye `/balones`, `/playas`, `/piscinas` y otras.

Todas comparten la misma forma:

```text
una pregunta concreta → opciones comparables → una acción práctica
```

y el mismo patrón de datos: fuente oficial → snapshot público → cercanía calculada en el
dispositivo → frescura visible.

Lo que cambia entre rutas es el dominio. Lo que no cambia es este documento.

Proyecto independiente. No está afiliado, aprobado ni producido por ninguna entidad del
Estado peruano, y la interfaz nunca debe insinuarlo.

## 2 · Los cuatro anclajes

En este orden. Cuando dos choquen, gana el de arriba.

1. **Decisión acertada.** La persona debe elegir bien, no solo rápido. Los datos que
   deciden tienen que ser comparables de un vistazo, y un dato viejo o ausente debe verse
   como tal en vez de disfrazarse.
2. **Rapidez.** De abrir a decidir en el menor número de acciones y segundos posible. Cada
   tap, cada pantalla intermedia y cada texto de más se paga.
3. **Contexto hostil.** Se usa afuera: una mano, poca atención, movimiento, sol o de
   noche, a veces sin señal. Áreas táctiles generosas, jerarquía brutal, cero lectura
   obligatoria, cero interacción fina.
4. **Mobile-first.** Se diseña para pantalla chica primero. 320 px de ancho debe funcionar
   sin scroll horizontal. Lo demás es adaptación.

La rapidez nunca justifica una decisión peor informada.

## 3 · Principios

| # | Principio | Se violó cuando… |
|---|---|---|
| 1 | Una decisión por pantalla | dos acciones primarias compiten en la misma vista |
| 2 | El dato que decide domina | no es el elemento más grande de su tarjeta |
| 3 | Lo que no cambia la decisión sale del camino principal (no se borra: vive en «Sobre los datos») | hay texto en el camino principal que no responde «¿esto cambia lo que voy a hacer?» |
| 4 | La incertidumbre es contenido, no advertencia: «hace 3 días» informa | aparecen *puede*, *podría*, *aproximado*, *no garantizamos* |
| 5 | Apagarse antes que mentir | se muestra un dato sin poder afirmar su antigüedad en ese instante |
| 6 | Una sola acción de color por pantalla y por tarjeta | el color de acción aparece dos veces compitiendo |
| 7 | Lo tocable, abajo | la acción primaria vive en la mitad superior de la pantalla |
| 8 | Nada invita a mirar el teléfono: sin auto-refresh, sin alertas, sin animación que llame | el layout cambia después del primer render |
| 9 | Accesibilidad de origen, no de fase | un target bajo 44 px, un contraste bajo el mínimo, un cambio de estado sin anuncio |
| 10 | Cero red de terceros | aparece un host distinto de `'self'` en el CSP |
| 11 | El origen del dato y la no afiliación se leen sin buscarlos | se llega a resultados sin haber podido saber de dónde salen y quién hizo esto |

## 4 · Honestidad del dato

El piso común de todas las rutas. No son preferencias estéticas: son promesas del
producto. Se puede mejorar **cómo se comunican**, nunca eliminarlas.

- **Identidad verificada o marcador neutral.** Un nombre nunca se infiere por proximidad,
  coordenada, razón social ni dirección. Sin catálogo verificado, marcador honesto.
- **Sin ruta, ETA, tráfico ni costo de desvío.** La distancia es geodésica en línea recta
  y debe leerse como tal.
- **Sin stock, disponibilidad ni condición presente.** Solo lo que la fuente observó.
- **Sin scoring oculto.** Solo órdenes explicables. Nada de «recomendado para ti».
- **Frescura visible y recalculada al consultar**, también sin conexión.
- **Ventana de vigencia por ruta.** Fuera de ella el dato no se muestra: un estado vacío
  honesto que deriva a la fuente oficial es preferible a un dato viejo.
- **Ausencia no es juicio.** Lo no evaluado, no cubierto o no reportado se dice así; nunca
  se presenta como resultado negativo.
- **La ubicación no sale del dispositivo.** Los servicios externos reciben solo el
  destino, y solo tras un tap explícito.
- **Atribución y enlace a la fuente en cada ruta**, sin insinuar afiliación oficial.
- **Sin cuenta, login, favoritos, historial, alertas, backend ni analítica de terceros.**

## 5 · Estados obligatorios de una ruta

Ninguno puede verse como un error descuidado. Los estados vacíos son los que garantizan
que el producto no miente: se diseñan con el mismo cuidado que el camino feliz.

| Estado | Qué resuelve |
|---|---|
| Inicio | una sola pregunta y dos caminos: mi ubicación o elegir zona |
| Cargando | dice que está trabajando, sin bloquear ni prometer |
| Pidiendo ubicación | explica qué espera y ofrece salida sin ubicación |
| Resultados | las opciones comparables y la acción, sin configuración previa |
| Ubicación denegada o fallida | dice qué pasó y ofrece la alternativa y el reintento |
| Sin datos vigentes | explica la ventana de vigencia y deriva a la fuente oficial |
| Sin conexión con datos guardados | muestra lo guardado, con su fecha, dicho de frente |
| Fallo de carga | mensaje sin jerga y un reintento; el detalle técnico va a consola |

## 6 · Sistema visual

**Tokens.** La fuente de verdad son las custom properties de `web/styles.css`
(`:root` y `:root[data-theme="dark"]`). Ningún color ni medida se escribe suelto en un
componente: si hace falta un valor nuevo, primero es un token. La transparencia sale de
`color-mix` sobre un token, nunca de un `rgba` a mano.

| Token | Rol | Claro | Oscuro |
|---|---|---|---|
| `--primary` / `--primary-foreground` | la acción, una vez por pantalla | `#074b3f` / `#ffffff` | `#4caf50` / `#052611` |
| `--background` | lienzo | `#f3f4f4` | `#0e1417` |
| `--card` → `--card-2` | superficies de vidrio | `#e8f2f1` → `#d1dfe4` | `#304143` → `#1a2426` |
| `--foreground` | el dato que decide | `#12232b` | `#e7ecec` |
| `--muted-foreground` | dato secundario | `#515f66` | `#9aaab0` |
| `--accent` | enlaces, etiquetas, marca | `#17615d` | `#63d0c9` |
| `--border` → `--border-2` | canto del vidrio | `#095445` → `#1f4652` | `#728186` → `#d7e6ea` |
| `--ring` | anillo de foco | `#2e7d32` | `#4caf50` |
| `--scrim` / `--bg-dim` | velo sobre el fondo | `#ffffff` / `0.5` | `#000000` / `0.40` |
| `--bgx-1` … `--bgx-8` | las ocho paradas del fondo CSS | — | — |

Compartidos: `--font` (Roboto → stack del sistema), `--radius` 36 px, `--radius-small`
12 px, `--blur` 30 px, y los degradados derivados `--surface` y `--rim`.

**Vidrio.** El canto se lee por diferencia con lo que hay detrás, y solo en la dirección
que la superficie deja libre: tarjeta oscura sobre fondo oscuro → **el canto es luz**;
tarjeta clara sobre fondo claro → **el canto es sombra**. El relleno nunca separa la
tarjeta del fondo; lo que la hace visible es el canto. Por eso **ningún estado depende
solo de una diferencia de fondo o de una sombra**: el elemento activo de un switch usa
relleno, color de texto y peso, y dos de esas tres son independientes del fondo.

**Fondo.** Capas CSS abstractas de la Costa Verde, con velo por tema. Sin imágenes de
fondo: la profundidad sale de que cada capa tiene su escala y difusión, no de sombras.

**Tipografía.** Roboto primero porque en Android ya es la fuente del sistema y no descarga
nada; fuera de Android cae al stack nativo. Ninguna fuente se hospeda ni se descarga.
`tabular-nums` en cifras. Nada bajo 14 px en el camino principal. El dato que decide, a
27 px o más.

**Rendimiento como decisión de diseño.** Sesiones de diez segundos: el shell arranca en
pocos KB y funciona offline con el último bundle validado. Un efecto que cueste en un
Android de gama baja se paga solo si mejora la decisión.

## 7 · Componentes

| Componente | Reglas |
|---|---|
| Barra superior | marca a la izquierda, controles secundarios a la derecha; nunca empuja la decisión fuera de pantalla |
| Selector de dos opciones | dos `<button>` con `aria-pressed`, nunca un `<select>`; el activo se distingue por relleno, color y peso |
| Botón | primario (relleno, ≥ 52 px), de texto (subrayado, para lo secundario), compacto (≥ 44 px) |
| **Tarjeta de opción** | la unidad de comparación de cualquier ruta; ver anatomía abajo |
| Etiqueta de tarjeta | explica en pocas palabras por qué esa opción destaca; usa `--accent`, nunca el color de acción |
| Placa | superficie para texto que no vive en una tarjeta |
| Chips | lista de zonas; se despliega por búsqueda o por acción explícita, no de golpe |
| Filtro con buscador | etiqueta visible, `type="search"`, estado vacío con mensaje propio |
| «Sobre los datos» | `<details>` cerrado: procedencia, límites, no afiliación y enlace a la fuente |
| Estado vacío / de fallo | encabezado, explicación en una línea y una salida útil |
| Nota de estado | una línea para offline, error o contexto; nunca un banner permanente |

**Anatomía de la tarjeta de opción**, de arriba abajo:

1. etiqueta opcional — por qué destaca;
2. **el dato que decide** y, a su derecha, la distancia, en una sola fila;
3. identidad — verificada o marcador neutral;
4. frescura — «actualizado hace …»;
5. una acción, al final.

## 8 · Accesibilidad

Piso no negociable, verificado y no asumido.

- HTML semántico: `<main>`, `<section>`, encabezados en orden, listas para las opciones.
- Todo tocable ≥ 44 px; acción primaria ≥ 52 px.
- Contraste **medido en el peor caso real** (el punto más transparente de la superficie
  sobre la zona más desfavorable del fondo): texto ≥ 4.5:1, elementos no textuales y foco
  ≥ 3:1, en los dos temas. Hay una prueba automática que lo comprueba en cada corrida.
  Deuda conocida: esa prueba lee una copia de los tokens, no `web/styles.css`; hasta que
  lea la fuente, mover un color obliga a actualizar las dos.
- `:focus-visible` siempre visible; foco al encabezado al cambiar de paso; orden de
  tabulación que no obliga a atravesar controles secundarios para llegar a la decisión.
- Nombres accesibles en cada acción; regiones vivas para los cambios de estado.
- `prefers-reduced-motion` en opt-in, no opt-out; `forced-colors` con bordes visibles.
- Sin scroll horizontal a 320 px. Tema claro, oscuro y del sistema.

## 9 · Microcopy

- Español neutro, sin voseo. Segunda persona («tu zona»), verbos en presente.
- Sin jerga interna: nada de *snapshot*, *manifest*, *bundle*, *contrato* en la interfaz.
- Sin lenguaje defensivo ni disclaimers repetidos. La incertidumbre se dice en datos.
- Los títulos dicen qué se está viendo, no qué hizo el sistema.
- Un término, una palabra: si algo se llama «zona», se llama así en toda la ruta.
- Los botones dicen el resultado («Cómo llegar»), no el mecanismo.

## 10 · Checklist de ruta nueva

1. La pregunta que responde cabe en una línea.
2. Se nombran los datos que deciden y cuál domina visualmente.
3. Se define la ventana de vigencia y qué se muestra fuera de ella.
4. Se define qué es identidad verificada y cuál es el marcador cuando no la hay.
5. Los ocho estados de la sección 5 están diseñados y escritos.
6. Los órdenes disponibles son explicables y no ocultan un ranking.
7. La acción final es una, y es práctica.
8. Reutiliza los componentes de la sección 7; si necesita uno nuevo, se agrega aquí.
9. Recorrido medido en taps y segundos hasta la decisión, a 320 y a 390 px.
10. Contraste verificado en ambos temas y accesibilidad de la sección 8 comprobada.
11. Atribución, límites y no afiliación visibles sin buscarlos.

## 11 · Cuando cambie el stack

**Se conserva:** los tokens como custom properties de CSS; los nombres, la anatomía y los
estados de los componentes; el HTML semántico y los atributos de accesibilidad; los
estados obligatorios; el microcopy; el presupuesto de rendimiento y el funcionamiento
offline.

**Se puede reorganizar:** la estructura de archivos, el mecanismo de render y el
empaquetado.

**Reglas del puente:** los tokens siguen siendo CSS custom properties, sin duplicar los
valores en JavaScript; nada de CSS-in-JS en tiempo de ejecución; el HTML que hoy genera
cada renderer es el contrato de aceptación de su componente equivalente; una utilidad de
clases solo se adopta si se mapea a estos tokens y se prohíben los valores arbitrarios.

## 12 · Decisiones cerradas de `/gasolina`

Primera ruta, medida sobre las 714 ofertas contractuales de Gasohol Regular de Lima
provincia, corte del 18 de agosto de 2026. Reabrir cualquiera exige un hallazgo material
medido, no una opinión.

| Decisión | Evidencia |
|---|---|
| Pool: siempre las 20 más cercanas primero; ordenar nunca lo repuebla | sin pool, «las 4 más baratas» manda a 19 km por S/ 1.20; dentro del pool el radio típico es 2.6 km y ya hay S/ 4.00 de dispersión mediana |
| Vista principal: las 4 más cercanas **más la más barata del pool**, marcada | la más barata del pool aparece entre las 4 más cercanas solo en 22.5 % de los orígenes; su rango mediano es 10 de 20 |
| Etiqueta doble cuando la más barata también es la más cercana | ocurre en 6 % de los orígenes; sin decirlo, la interfaz inventaría un contraste que no existe |
| Ventana de frescura: 30 días | fuera de ella el precio ya no sirve para decidir |
| Ubicación de alta precisión | un error de 300 m reordena las tarjetas y el producto mentiría sin saberlo |
| Sin ubicación: elegir distrito, sin distancia, ordenado por precio | no se confunde límite distrital con cercanía |
| Handoff a Google Maps con solo el destino, tras un tap | es navegación, no carga de recurso; la ubicación no sale del dispositivo |

## 13 · Cómo se cambia este documento

Un cambio de diseño es **un solo commit** que trae: la evidencia que lo justifica
(medición o captura), el token o el componente modificado, las pruebas en verde y este
documento corregido. No se crean documentos de diseño por evento.

Una decisión reversible de copy, orden de pantallas o presentación no necesita ceremonia;
un cambio en los anclajes, en la honestidad del dato o en los estados obligatorios sí, y
lo decide el owner.
