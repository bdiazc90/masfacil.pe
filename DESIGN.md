# DESIGN.md

Contrato de diseño de `masfacil.pe`. Fuente canónica de los principios de interfaz y del
sistema visual de **todas** las rutas.

Agnóstico al stack: hoy se implementa en HTML, CSS y JavaScript sin dependencias; debe
seguir siendo válido cuando la interfaz se construya con un framework.

Cada principio declara **cómo se detecta que se violó**: uno que no se puede falsificar
es decoración. `mockup.html`, en la raíz, es la maqueta histórica de la pantalla de
resultados; sirve de referencia, no de autoridad.

---

## 1 · Qué se está diseñando

`masfacil.pe` es una colección de **utilitarios cívicos**: herramientas pequeñas que
ayudan a decidir algo concreto con datos públicos oficiales. Gasolina es la primera y vive
en `/`; el horizonte incluye balones, playas, piscinas y otras, cada una en su ruta.

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
| 3 | Lo que no cambia la decisión sale del camino principal (no se borra: vive en «Sobre los datos» o en «Ver detalle») | hay texto en el camino principal que no responde «¿esto cambia lo que voy a hacer?» |
| 4 | La incertidumbre es contenido, no advertencia: «hace 3 días» informa | aparecen *puede*, *podría*, *aproximado*, *no garantizamos* |
| 5 | Apagarse antes que mentir | se muestra un dato sin poder afirmar su antigüedad en ese instante |
| 6 | Una sola acción de color por pantalla y por tarjeta | el color de acción aparece dos veces compitiendo |
| 7 | Lo tocable, abajo | la acción primaria vive en la mitad superior de la pantalla |
| 8 | Nada invita a mirar el teléfono: sin auto-refresh, sin alertas, sin animación que llame | el layout cambia sin que la persona haya hecho nada |
| 9 | Accesibilidad de origen, no de fase | un target bajo 44 px, un contraste bajo el mínimo, un cambio de estado sin anuncio |
| 10 | Cero red de terceros | aparece un host distinto de `'self'` en el CSP |
| 11 | El origen del dato y la no afiliación se leen sin buscarlos | se llega a resultados sin haber podido saber de dónde salen y quién hizo esto |

Sobre el principio 8: el card de controles se contrae al hacer scroll y se expande al
volver arriba. Es una respuesta a un gesto de la persona, no una animación que llama, y su
hueco conserva el alto para que la lista no salte.

## 4 · Honestidad del dato

El piso común de todas las rutas. No son preferencias estéticas: son promesas del
producto. Se puede mejorar **cómo se comunican**, nunca eliminarlas.

- **Identidad verificada o marcador neutral.** Un nombre nunca se infiere por proximidad,
  coordenada, razón social ni dirección. Sin catálogo verificado, marcador honesto
  («Estación sin nombre verificado»). Un nombre con cercanía comprobada pero sin
  corroboración se muestra marcado «· por confirmar».
- **Sin ruta, ETA, tráfico ni costo de desvío.** La distancia es geodésica en línea recta
  y debe leerse como tal.
- **Sin stock, disponibilidad ni condición presente.** Solo lo que la fuente observó.
- **Sin scoring oculto.** Solo órdenes explicables. Nada de «recomendado para ti».
- **Frescura visible y recalculada al consultar**, también sin conexión.
- **Ventana de vigencia por ruta.** Fuera de ella el PRECIO no se muestra: un dato viejo es
  peor que ninguno. Lo que no caduca es el establecimiento; el Registro oficial lo sigue
  autorizando, así que su tarjeta permanece sin precios y dice desde cuándo calla. Borrarla
  afirmaría que cerró, y eso el dato no lo dice. Cuando no queda ningún precio comparable,
  entonces sí manda el estado vacío honesto que deriva a la fuente oficial.
- **Ausencia no es juicio.** Lo no evaluado, no cubierto o no reportado se dice así; nunca
  se presenta como resultado negativo. Un producto sin precio vigente muestra «—», no cero.
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
| Radio sin resultados | dice que no hay grifos en ese radio y que ampliarlo los trae |
| Sin datos vigentes | explica la ventana de vigencia y deriva a la fuente oficial |
| Sin conexión con datos guardados | muestra lo guardado, con su fecha, dicho de frente |
| Fallo de carga | mensaje sin jerga y un reintento; el detalle técnico va a consola |

## 6 · Sistema visual

**Tokens.** La fuente de verdad son las custom properties de `web/styles.css`: el tema
claro en `:root`, el oscuro en `:root[data-theme="dark"]`. `web/theme.js` fija siempre
`light` o `dark` (la opción «sistema» se resuelve ahí), así que el CSS nunca depende de
`prefers-color-scheme`. Ningún color ni medida se escribe suelto en un componente: si hace
falta un valor nuevo, primero es un token. La transparencia sale de `color-mix` sobre un
token, nunca de un `rgba` a mano.

**Papel y tinta.** Los neutros no son hex sueltos: salen de tres knobs OKLCH, matiz del
papel (`--paper-hue` 130), croma del papel (`--paper-chroma` .01 claro / .02 oscuro) y
croma de la tinta (`--ink-chroma` .010). Cada neutro solo fija su luminosidad. Para
cambiar la familia entera se mueven los knobs, no los tokens.

| Token | Rol | Claro | Oscuro |
|---|---|---|---|
| `--background` | papel | L 95 % (`#ecf0e9`) | L 20 % (`#13180e`) |
| `--foreground` | tinta: el dato que decide | L 30 % (`#2c2f2a`) | L 78 % (`#b0b3ad`) |
| `--muted-foreground` | dato secundario | L 46 % (`#565953`) | L 75 % (`#acafa9`) |
| `--card` → `--card-2` | superficies de vidrio | L 98 % → 90 % | L 30 % → 23 % |
| `--border` → `--border-2` | canto del vidrio | L 40 % → 30 % | L 62 % → 85 % |
| `--primary` / `--primary-foreground` | la acción, una vez por pantalla | `#074b3f` / `#ffffff` | `#32b988` / `#052611` |
| `--accent` | enlaces, etiquetas, tag de tarjeta | `#17615d` | `#63d0c9` |
| `--ring` | anillo de foco | `#2e7d32` | `#4caf50` |
| `--brand` | la palabra «masfacil» del logotipo, en ambos temas | `#b8071b` | `#b8071b` |
| `--product-regular` / `-strong` | Regular: chip en reposo / cifra y chip activos | `#708d3a` / `#207461` | `#7fc9a0` / `#8fe3b3` |
| `--product-premium` / `-strong` | Premium: chip en reposo / cifra y chip activos | `#4a78a8` / `#1d4e8e` | `#8fb4e0` / `#a4c6f2` |
| `--glow-1` `--glow-2` `--glow-3` | las tres manchas del fondo | `#bfb6a7` `#d7d2c3` `#bb9978` | `#815a48` `#585b48` `#8d6c5e` |
| `--glow-alpha` / `--glow-blur` | intensidad y difusión del glow | .6 / 80 px | .6 / 80 px |
| `--blur` / `--glass-saturate` | vidrio: desenfoque y cuánto glow deja pasar | 30 px / 35 % | 30 px / 35 % |
| `--logo-halo` | contorno del logo para que el aro no se funda con el fondo | transparente | blanco al 45 % |

Compartidos: `--font` (Roboto → stack del sistema), `--mono` (stack monoespaciado del
sistema, solo para chips), `--radius` 36 px, `--radius-small` 12 px, tamaños
`--price-size` 24 px, `--distance-size` 18 px, `--chip-size` 8 px, la escala de espaciado
`--s1`…`--s5` (4 · 8 · 12 · 16 · 24 px), los tokens del card de controles
(`--controls-top`, `--controls-compact-h` 52 px, `--collapse-at` 96 px, `--expand-at`
8 px, `--controls-ease` 200 ms, `--controls-fixed-fill` 90 %) y los degradados derivados
`--surface` y `--rim`.

**Vidrio.** El canto se lee por diferencia con lo que hay detrás, y solo en la dirección
que la superficie deja libre: tarjeta oscura sobre fondo oscuro → **el canto es luz**;
tarjeta clara sobre fondo claro → **el canto es sombra**. El relleno nunca separa la
tarjeta del fondo; lo que la hace visible es el canto. Por eso **ningún estado depende
solo de una diferencia de fondo o de una sombra**: el elemento activo de un switch usa
relleno, color de texto y peso, y dos de esas tres son independientes del fondo. El card
de controles, cuando va fijo, se rellena al 90 % y lleva sombra: ahí sí hay que separarlo
de la lista que pasa por debajo.

**Fondo.** Papel liso pintado por `html` y tres manchas difusas (`.glow`) en `z-index:-1`:
ámbar sobre papel en claro, terracota sobre carbón en oscuro. Sin velo encima y sin
imágenes: `body` no pinta fondo, porque lo taparía. Detectar la violación: el glow no se
ve.

**Tipografía.** Roboto primero porque en Android ya es la fuente del sistema y no descarga
nada; fuera de Android cae al stack nativo. Ninguna fuente se hospeda ni se descarga.
`tabular-nums` en cifras. El dato que decide, a 24 px y peso 800 (21 px hasta 340 px de
ancho), con el «S/» reducido a 13 px porque la moneda acompaña, no decide. Texto de
lectura nunca bajo 12 px; las etiquetas en mayúsculas (LUGAR, RADIO) a 12 px con
espaciado. Los chips de producto son la única excepción: 8 px monoespaciado, siempre
pegados a una cifra que es la que se lee, y con su nombre completo en `aria-label`.

**Rendimiento como decisión de diseño.** Sesiones de diez segundos: el shell arranca en
pocos KB y funciona offline con el último bundle validado. Un efecto que cueste en un
Android de gama baja se paga solo si mejora la decisión.

## 7 · Componentes

Principios, no catálogo. Un inventario cerrado de componentes con sus reglas
exige mantener a mano una copia del código y envejece en cada cambio de UI; lo
que sigue vigente es cómo debe comportarse cualquier control de esta interfaz.
El detalle de cada componente vive en `web/*.js` y `web/styles.css`.

- **Un control, una cosa.** Ordenar no filtra; filtrar no ordena. Un control cuyo
  efecto no se puede nombrar en una línea está haciendo dos cosas.
- **Estado visible sin depender del color.** Un elemento activo se distingue por
  relleno, peso o forma además del color, y lo declara en el marcado
  (`aria-pressed`, `aria-current`), no solo en el estilo.
- **Elección binaria con botones, no con `<select>`.** Dos opciones se tocan; no
  se despliegan.
- **Si un control no cambia nada, se deshabilita y lo dice.** No se deja activo
  fingiendo que hay algo que ajustar.
- **Objetivos táctiles:** llamada principal de pantalla ≥ 52 px, acción dentro de
  una tarjeta ≥ 48 px, botón de texto ≥ 44 px.
- **Nada se repite.** Lo que la tarjeta ya dice no se anuncia encima de la lista.
- **La tarjeta de resultado ordena de arriba abajo por lo que decide:** primero lo
  que distingue una opción de otra, después lo que la identifica, y al final las
  acciones. La ausencia de un dato se dice —«—», «por confirmar», marcador
  neutral—, nunca se oculta la fila.

## 8 · Accesibilidad

Piso no negociable, verificado y no asumido.

- HTML semántico: `<main>`, `<section>`, encabezados en orden, listas para las opciones.
- Todo tocable ≥ 44 px; acción primaria de pantalla ≥ 52 px.
- Contraste **medido en el peor caso real**: el vidrio al 20 %, 14 % y 8 % y el card fijo
  al 90 % sobre el papel liso y sobre cada mancha del glow, en los dos temas. Texto
  ≥ 4.5:1; texto grande (la cifra de 24 px a peso 800, lo único que lleva el color
  «strong») ≥ 3:1; anillo de foco y botón como forma ≥ 3:1. La prueba es
  `node web/contrast.mjs`: imprime cada razón y falla bajo el mínimo. Se corre a mano al
  tocar un token, no en CI. Deuda conocida: lee una copia de los tokens escrita en los
  mismos términos que `web/styles.css` (knobs OKLCH y hex); mover un color obliga a
  actualizar las dos. Fuera del piso, a propósito: la palabra «masfacil» en `--brand`
  (marca, exenta) y el texto de los chips (8 px, informativos, con `aria-label`).
- `:focus-visible` siempre visible; foco al encabezado al cambiar de paso (en resultados,
  el nombre del lugar); orden de tabulación que no obliga a atravesar controles
  secundarios para llegar a la decisión. Al contraerse el card, nadie queda enfocado
  dentro de un panel oculto.
- Nombres accesibles en cada acción; regiones vivas para los cambios de estado; los chips
  declaran su nombre completo.
- `prefers-reduced-motion` en opt-in, no opt-out; `forced-colors` con bordes visibles.
- Sin scroll horizontal a 320 px. Tema claro, oscuro y del sistema.

## 9 · Microcopy

- Español neutro, sin voseo. Segunda persona («tu zona»), verbos en presente.
- Sin jerga interna: nada de *snapshot*, *manifest*, *bundle*, *contrato* en la interfaz.
- Sin lenguaje defensivo ni disclaimers repetidos. La incertidumbre se dice en datos.
- Los títulos dicen qué se está viendo, no qué hizo el sistema.
- Un término, una palabra: si algo se llama «zona», se llama así en toda la ruta.
- Los botones dicen el resultado («Cómo llegar»), no el mecanismo.
- Nada se repite: lo que la tarjeta ya dice no se anuncia encima de la lista.

## 10 · Checklist de ruta nueva

1. La pregunta que responde cabe en una línea.
2. Se nombran los datos que deciden y cuál domina visualmente.
3. Se define la ventana de vigencia y qué se muestra fuera de ella.
4. Se define qué es identidad verificada y cuál es el marcador cuando no la hay.
5. Los nueve estados de la sección 5 están diseñados y escritos.
6. Los órdenes disponibles son explicables y no ocultan un ranking.
7. La acción final es una, y es práctica.
8. Reutiliza los componentes existentes y respeta los principios de la sección 7.
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

## 12 · Decisiones cerradas de gasolina

Primera ruta. Reabrir cualquiera exige un hallazgo material medido, no una
opinión. Las cifras que las justificaron se midieron sobre bundles concretos y no
se copian aquí: envejecen y el motivo no.

| Decisión | Por qué |
|---|---|
| `/` es la app; sin pantalla de elegir producto. Las rutas viejas (`/gasolina/…`) responden 301 | los dos bundles son idénticos salvo precio y fecha: elegir producto antes de ver nada era un tap sin información |
| Una tarjeta por grifo con Regular y Premium; «—» cuando falta uno | la gran mayoría de los grifos reporta los dos productos a la vez, y se decide comparándolos frente al surtidor |
| Radio de búsqueda de 1 a 5 km en pasos de 0.5; arranca en el menor que llena seis tarjetas | en Lima urbana cae en 1–1.5 km y en zonas dispersas sube solo. Un pool fijo mandaba a kilómetros de distancia por céntimos |
| «Más cerca» y «Más barata» solo ordenan; el sub-selector fija el producto de «Más barata» y recuerda la elección | cada control hace una cosa; en «Más cerca» el producto no ordena nada y el sub-selector se oculta |
| Etiqueta «Regular más barata en 1.5 km» sobre la más barata del radio; doble cuando también es la más cercana | sin decirlo, la interfaz inventaría un contraste que no existe |
| Paginación que duplica: 6 → 12 → 24 → todo; si quedan ≤ 4, se muestran sin botón | un distrito grande a 5 km son más de cien estaciones: pocos toques en vez de decenas |
| Card de controles fijo con tres estados en vez de un header pegajoso alto | el header fijo ocupaba un cuarto de la pantalla; la fila compacta conserva lugar, radio y criterio |
| Ventana de frescura: 30 días | fuera de ella el precio ya no sirve para decidir; el grifo se queda sin precio, porque desaparecer diría que cerró |
| Ubicación de alta precisión | un error de 300 m reordena las tarjetas y el producto mentiría sin saberlo |
| Sin ubicación: elegir distrito, sin distancia ni radio, ordenado por precio | no se confunde límite distrital con cercanía |
| Nombre de estación solo desde el catálogo con respaldo; «por confirmar» con cercanía comprobada; la dirección oficial siempre | la precisión medida se declara en «Sobre los datos», con la cifra de la corrida vigente |
| Handoff a Google Maps con solo el destino, tras un tap | es navegación, no carga de recurso; la ubicación no sale del dispositivo |

## 13 · Cómo se cambia este documento

Este documento se corrige cuando cambia un principio, un anclaje, la honestidad
del dato o un estado obligatorio. Una decisión reversible de copy, de orden de
pantallas o de presentación no lo toca y no necesita ceremonia.

Si el documento y el código discrepan, gana el código que funciona; el documento
se corrige cuando alguien lo note, no en un commit obligatorio por cada cambio de
UI.
