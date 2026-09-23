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
| 10 | Cero red de terceros, con una excepción declarada: el origen público del histórico en `connect-src` | aparece en el CSP un host que no sea `'self'` ni ese origen |
| 11 | El origen del dato y la no afiliación se leen sin buscarlos | se llega a resultados sin haber podido saber de dónde salen y quién hizo esto |

Sobre el principio 8: el card de controles se contrae al hacer scroll y se expande al
volver arriba. Es una respuesta a un gesto de la persona, no una animación que llama, y su
hueco conserva el alto para que la lista no salte. Por lo mismo, el bloque del histórico
reserva su alto desde el primer pintado.

Sobre el principio 10: el resumen del histórico se sirve desde su propio bucket, y eso es
deliberado —así el service worker, que ignora lo cross-origin, no puede cachear como shell
un JSON que cambia cada pocas horas—. Es la única excepción, está escrita en `_headers` y
`scripts/verify-web.mjs` cruza esa cabecera con la constante del cliente en cada
verificación. No hay analítica, ni fuentes, ni imágenes, ni scripts de terceros.

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
- **Sin cuenta, login, favoritos, historial personal, alertas, backend ni analítica de terceros.**

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
`prefers-color-scheme`.

**Qué conserva un nombre y qué se escribe directo.** Un nombre no es gratis: cada uno es
una cadena más que hay que seguir para saber de qué color es algo. Se conserva cuando
gana algo real:

- **cambia de verdad con el tema** — todos los colores de la tabla de abajo;
- **es contrato con JavaScript** — `--expand-at`, que `controls-card.js` lee de la raíz
  con `parseFloat` y por eso conserva su unidad px, y `--controls-slot-h`, que ese mismo
  módulo escribe;
- **lo mide `scripts/contrast.mjs`** — si el CSS y su comprobación comparten un valor,
  ese valor tiene nombre;
- **se reutiliza entre reglas** — la escala de espaciado, `--product`, `--serie`,
  `--brand-halo`, en el ámbito donde se reutilizan.

Cualquier otra medida se escribe junto a su propiedad, y su variación en móvil o en un
estado se agrupa debajo de la regla que modifica. **Un número repetido por casualidad no
obliga a crear un token**, y una opacidad fija no necesita un parámetro global más una
multiplicación para llegar a otra constante.

**Papel y tinta.** Los neutros son `oklch()` con sus tres valores escritos. Antes salían
de tres knobs compartidos (`--paper-hue`, `--paper-chroma`, `--ink-chroma`); se retiraron
porque para saber de qué color era una superficie había que resolver la cadena entera, y
porque el verificador terminó copiándolos. Cada neutro fija su luminosidad y comparte
matiz y croma por escrito.

| Token | Rol | Claro | Oscuro |
|---|---|---|---|
| `--background` | papel | `oklch(95% .01 130)` | `oklch(20% .02 130)` |
| `--foreground` | tinta: el dato que decide | `oklch(30% .01 130)` | `oklch(78% .01 130)` |
| `--muted-foreground` | dato secundario | `oklch(46% .01 130)` | `oklch(75% .01 130)` |
| `--card` → `--card-2` | superficies de vidrio | L 98 % → 90 % | L 30 % → 23 % |
| `--border` → `--border-2` | canto del vidrio | L 40 % → 30 % | L 62 % → 85 % |
| `--primary` / `--primary-foreground` | la acción, una vez por pantalla | `#074b3f` / `#ffffff` | `#32b988` / `#052611` |
| `--accent` | enlaces, etiquetas, tag de tarjeta | `#17615d` | `#63d0c9` |
| `--ring` | anillo de foco | `#2e7d32` | `#4caf50` |
| `--brand` | la palabra «masfacil» del logotipo, en ambos temas | `#b8071b` | `#b8071b` |
| `--product-regular` / `-strong` | Regular: el tono base tiñe el relleno del chip; `-strong` es la tinta del chip y la cifra activa | `#708d3a` / `#207461` | `#7fc9a0` / `#8fe3b3` |
| `--product-premium` / `-strong` | Premium, igual | `#4a78a8` / `#1d4e8e` | `#8fb4e0` / `#a4c6f2` |
| `--halo-<marca>` | halo de la marca del grifo, un token por marca registrada | tintes claros: `#d0d2fa` `#ffe0cb` `#ebd5f0` `#cdefdd` | tintes oscuros: `#171a52` `#5a2a0c` `#3a1244` `#0d3b29` |
| `--brand-halo-alpha` | cuánto pesa el halo de marca | .38 | .38 |
| `--chart-fill-alpha` | tope del degradado de área del histórico | .28 | .18 |
| `--glow-1` `--glow-2` `--glow-3` | las tres manchas del fondo | `#bfb6a7` `#d7d2c3` `#bb9978` | `#815a48` `#585b48` `#8d6c5e` |
| `--glow-alpha` / `--glow-blur` | intensidad y difusión del glow | .6 / 80 px | .6 / 80 px |
| `--blur` / `--glass-saturate` | vidrio: desenfoque y cuánto glow deja pasar | 30 px / 35 % | 30 px / 35 % |
| `--logo-halo` | contorno del logo para que el aro no se funda con el fondo | transparente | blanco al 45 % |

Compartidos: `--font` (Roboto → stack del sistema), la escala de espaciado
`--s1`…`--s5` (4 · 8 · 12 · 16 · 24 px), `--radius-small` 12 px, `--blur` y
`--glass-saturate`, los dos umbrales del card de controles (`--collapse-at` 96 px,
`--expand-at` 8 px) y las dos recetas de superficie, `--surface` y `--rim`. El resto de
medidas —tamaños de cifra, alto del trazado, desvanecidos, duraciones— vive escrito en
su regla, con su variación agrupada debajo.

**Cuatro roles de color, separados.** Identidad de masfacil (`--brand`), acción
(`--primary`, `--accent`, `--ring`), combustible (`--product-*`) y marca del grifo
(`--halo-*` y el isotipo). **El color de una marca comercial no tiñe botones, precios,
estados de selección ni series del histórico**: vive en la capa decorativa de su tarjeta
y en ningún sitio más. Regular y Premium conservan su correspondencia entre la tarjeta y
el gráfico, que es lo que permite leer los dos sin descifrar una leyenda.

**El halo va en la dirección que aleja la superficie de la tinta**: tinte claro sobre
papel, tinte oscuro sobre carbón. Con el color pleno de la marca, el texto que cae en esa
esquina perdía hasta punto y medio de contraste. El color real de la marca no se pierde:
lo lleva el isotipo, que es el activo.

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
ancho), con el «S/» reducido a 13 px porque la moneda acompaña, no decide. En el histórico
el dato que decide es el último promedio de cada franja: 26 px y peso 800. Texto de
lectura nunca bajo 12 px, **sin excepciones**: las etiquetas en mayúsculas (LUGAR, RADIO)
y los chips de producto van a 12 px, los chips además monoespaciados y pegados a la cifra
que acompañan. Su nombre completo en `aria-label` es refuerzo, no sustituto: un
`aria-label` no vuelve legible un chip que no se lee.

**Las etiquetas de un SVG también son texto.** Dentro de un `viewBox` el tamaño se escala
con el ancho: `--chart-label-size` sube a 15 unidades bajo 340 px justo para que siga
midiendo 12 px reales. Una etiqueta ilegible no se compensa con un `aria-label`.

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
- **La decoración vive en su propia capa, detrás del contenido.** La marca del
  grifo es una capa aparte: `aria-hidden`, sin eventos y sin parada de teclado.
  Recorta solo la decoración —nunca el anillo de foco, las acciones ni el detalle
  desplegado—, así que el `overflow` va en la capa y no en la tarjeta. Una marca
  sin activo registrado no tiene capa: superficie neutral, misma calidad visual.
  La marca se dice siempre en texto, de modo que reconocerla no depende de ver el
  isotipo.
- **Una decoración que gana presencia no puede costar altura.** La firma visual se
  mide con la misma estación, estado, ancho y texto antes y después: si la tarjeta
  crece para exhibir marca, la marca sobra.
- **Un gráfico se lee en reposo.** El valor principal, su fecha y su población
  están visibles sin tocar. La interacción añade el detalle de un día; no es el
  camino para enterarse de lo que el bloque dice.
- **Una escala por serie cuando las series no comparten rango.** Compartirla
  aplasta las dos curvas contra sus bordes. Cada escala declara sus referencias
  numéricas en la unidad real; no se normaliza a porcentajes.
- **Un patrón de trazo significa una cosa sola.** El discontinuo está reservado al
  promedio de referencia, así que ninguna serie observada es discontinua.

## 8 · Accesibilidad

Piso no negociable, verificado y no asumido.

- HTML semántico: `<main>`, `<section>`, encabezados en orden, listas para las opciones.
- Todo tocable ≥ 44 px; acción primaria de pantalla ≥ 52 px.
- Contraste **medido en el peor caso real**, y el peor caso incluye lo que se pinta
  detrás. Dos juegos de fondos, porque el texto y el gráfico no viven en el mismo sitio:
  **tarjeta**, el vidrio en sus tres mezclas y el card fijo sobre el papel liso y sobre
  cada mancha del glow, y sobre cualquiera de esos el halo de cualquiera de las marcas
  registradas; **trazado**, ese mismo vidrio y además el relleno de área de cada serie al
  tope de su degradado, que es lo más denso que llega a haber bajo una línea.
  Texto ≥ 4.5:1; texto grande (la cifra a peso 800, lo único que lleva el color «strong»)
  ≥ 3:1; anillo de foco, botón como forma y **gráfico necesario para entender el dato**
  —la curva y la recta del promedio— ≥ 3:1. La prueba es `node scripts/contrast.mjs`:
  imprime cada razón y falla bajo el mínimo. Se corre a mano al tocar un token, no en CI.
  Añadir un fondo nuevo sin añadirlo ahí deja el script en verde sin acreditar nada.
  **La sonda no guarda paleta: lee los valores vigentes de `web/styles.css`** —los colores
  de tema, las opacidades y los pesos de cada mezcla, sacados de la receta que de verdad
  los pinta—. Lo que sí declara son los nombres de los roles y los mínimos: ese es su
  contrato, no una segunda configuración visual. Un rol ausente o un valor que no sepa
  leer produce error explícito, nunca una medición con un hueco. Mientras la paleta estuvo
  duplicada se desincronizó dos veces sin que nadie lo notara: `--border-2` no llegó a
  copiarse nunca y el peso del vidrio era `.144` frente al 14 % del CSS. Fuera
  del piso, a propósito: la palabra «masfacil» en `--brand` (marca, exenta), el canto del
  vidrio (nunca se pinta sólido), el degradado de área (decoración declarada) y el isotipo
  de marca (imagen recortada y desvanecida, no un color plano).
- **El chip se mide como texto, en sus dos tintas.** Tinta y relleno nunca salen del mismo
  token —dos valores del mismo color no se separan— y un estado apagado no se dice con
  `opacity`, que hunde tinta y relleno a la vez: se dice con la tinta neutral, el peso y
  el borde. Como el relleno se mezcla con `--card`, que es opaco, la pareja es directa y
  no depende del vidrio ni del halo.
- `:focus-visible` siempre visible; foco al encabezado al cambiar de paso (en resultados,
  el nombre del lugar); orden de tabulación que no obliga a atravesar controles
  secundarios para llegar a la decisión. Al contraerse el card, nadie queda enfocado
  dentro de un panel oculto.
- Nombres accesibles en cada acción; regiones vivas para los cambios de estado; los chips
  declaran su nombre completo. **Una región viva no se repinta**: si el nodo se recrea en
  cada render, unos lectores no anuncian nada y otros anuncian la pantalla entera. Se crea
  una vez y solo se le escribe lo que la persona acaba de elegir.
- **Una selección repinta lo que cambia, no el nodo que tiene el foco.** Reconstruir el
  elemento enfocado obliga al lector a releer su nombre —y su descripción, si la tiene—
  en cada pulsación, y devuelve el foco a un nodo recién nacido. Lo que se mueve vive en
  capas propias que se reescriben solas. Por lo mismo, una descripción larga no se cuelga
  del foco con `aria-describedby`: una lista de catorce días es una región hermana con
  nombre propio, que se alcanza navegando y no se recita al entrar.
- **Un control que repinta su propio bloque devuelve el foco.** Si el botón que se pulsó
  se destruye en el repintado, el foco cae al cuerpo del documento y hay que volver a
  tabular hasta ahí.
- **Retirar una vista no puede quitar el acceso al dato.** Donde se quita una tabla queda
  una lectura equivalente para tecnologías de asistencia: día, media y población de cada
  fecha, sin una parada de teclado por punto. Un nombre accesible o una instrucción para
  lector no son frases interpretativas visibles.
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

**Se conserva:** los colores de tema como custom properties de CSS; los nombres, la
anatomía y los estados de los componentes; el HTML semántico y los atributos de
accesibilidad; los estados obligatorios; el microcopy; el presupuesto de rendimiento y el
funcionamiento offline.

**Se puede reorganizar:** la estructura de archivos, el mecanismo de render y el
empaquetado.

**Reglas del puente:** los colores de tema siguen siendo CSS custom properties, sin
duplicar sus valores en JavaScript ni en la sonda de contraste; nada de CSS-in-JS en
tiempo de ejecución; el HTML que hoy genera cada renderer es el contrato de aceptación de
su componente equivalente. **No hay obligación de tokenizar toda medida**: una medida de
un solo uso se escribe junto a su propiedad, aquí y en cualquier stack futuro. Lo que sí
se exige de una utilidad de clases es que los colores y el espaciado sigan saliendo de
esta paleta y de esta escala, no de una tabla paralela.

Tailwind v4 se evaluó y no se adoptó: incorporarlo obligaría a compilar antes de derivar
y verificar el shell, y sus variables de tema no ahorran elegir paleta ni roles. Una
futura migración se evalúa por su necesidad concreta, no por anticiparla.

## 12 · Decisiones cerradas de gasolina

Primera ruta. Reabrir cualquiera exige un hallazgo material medido, no una
opinión. Las cifras que las justificaron se midieron sobre bundles concretos y no
se copian aquí: envejecen y el motivo no.

| Decisión | Por qué |
|---|---|
| Cada vista vive en `/combustibles/<vista>` —hoy solo Gasolina— y `/` abre la última vista recordada, sin pantalla de elegir producto. `/combustibles/gasolina/historial` reescribe a la misma portada con el gráfico del histórico enfocado; los enlaces viejos (`/gasolina`, `/gasolina/regular`, `/gasolina/premium`, `/gasolina/historial`) y la barra final responden 301 a su ruta canónica; una vista no activada o cualquier otra ruta responde 404 con una página mínima, también sin conexión. Navegador, service worker, servidor local y `_redirects` usan una sola tabla (`web/lib/routes.js`) | los dos bundles son idénticos salvo precio y fecha: elegir producto antes de ver nada era un tap sin información; el historial es contexto de la portada, no otra pantalla, y su URL existe solo para poder enlazarlo; una dirección que no existe no debe fingir ser la app: un enlace roto se ve, no se disimula; y si cada capa resolviera las rutas por su cuenta, un enlace funcionaría en un sitio y no en otro |
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
| La app nunca se localiza sola, ni con el permiso ya concedido | un permiso concedido una vez no es una orden permanente. Arrancando solo, la portada dejaba de ser alcanzable: no se podía mirar el histórico ni elegir distrito sin que la localización secuestrara la pantalla. Localizar es siempre un gesto, y cada gesto lee el GPS sin posición cacheada |
| La marca del grifo es un isotipo amplio y traslúcido recortado en la esquina superior derecha, con halo tenue; el logo pequeño junto al nombre se retiró | se reconocía la bandera solo después de leer la tarjeta. Dos acreditaciones visuales de la misma marca no añadían nada, y la placa blanca del logo pequeño era el único fondo sólido de la tarjeta |
| Precio Regular, precio Premium y distancia se alinean a la izquierda en la misma fila | los tres datos que se comparan se leen de un barrido, y la esquina superior derecha queda libre para la marca sin pisar ningún dato |
| El histórico es un solo plano con las dos series y **una escala en soles reales**, con piso de amplitud de S/ 0.50 por galón | los dos precios son reales y separarlos en dos ejes obligaba a mirar dos veces; con uno se ve la brecha entre productos de un vistazo. El coste está aceptado y declarado: con los dos dentro, cada curva recorre unos 19 px en vez de 37. Sin piso, una diferencia de milésimas ocuparía toda la altura |
| Cuatro líneas, dos señales: el **color** dice el producto y el **trazo** dice la función —continuo lo observado, discontinuo el promedio—; cada curva lleva su nombre junto al último punto | con las dos series en el mismo plano, distinguirlas no puede depender del color solo, y una leyenda obliga a ir y volver |
| El relleno se apaga a poca distancia de su propia curva en vez de cerrar contra el suelo | cerrando abajo, el área de Premium taparía la curva de Regular y las dos tintas se apilarían: un área por producto no puede leerse como una suma |
| Curva monótona acotada (Hermite con pendientes limitadas), nunca un spline libre | un spline inventa un mínimo por debajo del día más barato, y eso sería un precio que nadie observó |
| Ventana fija de 7 días, sin selector; el contrato, el resumen y el almacén siguen en 30 | siete fechas caben etiquetadas una por una y se leen sin tocar nada; una ventana que no se elige no necesita un control. Bajar el máximo del almacén para esconder una opción de interfaz sería tirar dato |
| El subtítulo dice «últimos 7 días observados» y la meta de cada combustible solo lleva fecha y población | el título no puede prometer una cobertura que el dato no sostiene: con tres días registrados, afirmar «promedio de 7 días» sería falso. Describir la ventana en vez de afirmarla deja el `k/W` de sobra |
| El método de cálculo no se explica en la interfaz | el bloque dice qué es cada cifra con sus etiquetas; una ayuda desplegable era un segundo texto que nadie abría |
| Firma de autoría en el pie de todas las vistas, con enlace externo | un proyecto independiente se lee mejor firmado: refuerza la no afiliación en vez de dejarla enterrada en «Sobre los datos» |
| El promedio del periodo es la media de las medias diarias con dato: cada día pesa una vez | ponderar por la población de cada día describiría otra cosa, y un hueco convertido en cero mentiría |
| Sin tabla desplegable, sin cifra permanente en cada punto y sin frase que califique el precio | el bloque responde con datos y etiquetas mínimas; juzgar el precio es una recomendación de compra, y eso no se hace |

## 13 · Cómo se cambia este documento

Este documento se corrige cuando cambia un principio, un anclaje, la honestidad
del dato o un estado obligatorio. Una decisión reversible de copy, de orden de
pantallas o de presentación no lo toca y no necesita ceremonia.

Si el documento y el código discrepan, gana el código que funciona; el documento
se corrige cuando alguien lo note, no en un commit obligatorio por cada cambio de
UI.
