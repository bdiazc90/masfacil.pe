# DESIGN.md

Contrato de diseño de `masfacil.pe`. Fuente canónica de los principios de interfaz y del
sistema visual de **todas** las rutas.

Agnóstico al stack en sus principios (hoy: React, Vite y Tailwind). Los valores viven
solo en el código; aquí están el papel de cada token y sus reglas.

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
| 10 | Cero red de terceros, con dos excepciones declaradas: el origen público del histórico y Cloudflare Web Analytics, que Pages inyecta y cuenta visitas sin cookies (su beacon y su envío, por ruta exacta) | aparece en el CSP un host que no sea `'self'` ni esas dos excepciones |
| 11 | El origen del dato y la no afiliación se leen sin buscarlos | se llega a resultados sin haber podido saber de dónde salen y quién hizo esto |

Sobre el principio 8: el card de controles que se contrae al hacer scroll responde a un
gesto de la persona, no llama; por lo mismo, el bloque del histórico reserva su alto desde
el primer pintado.

Sobre el principio 10: el resumen del histórico se sirve desde su propio bucket a
propósito, para que el service worker, que ignora lo cross-origin, no lo cachee como shell.
`scripts/verify-web.mjs` exige que la CSP de `_headers` no admita nada más.

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

**Tokens.** La fuente de verdad son las custom properties de `ui/styles.css`, con sus
valores escritos ahí y solo ahí: claro en `:root`, oscuro en `:root[data-theme="dark"]`.
`ui/theme.js` fija siempre `light` o `dark` («sistema» se resuelve ahí), así que el CSS no
depende de `prefers-color-scheme`; antes del primer pintado repite la regla
`web/theme-boot.js`, y el tema oscuro nunca arranca en claro. `theme-color` sigue al tema
con el hex de `--background` escrito en el `<meta>`, y un test exige que coincidan.

**Qué conserva un nombre.** Un token existe solo si gana algo real: cambia con el tema; es
contrato con JavaScript (`--expand-at`, en px porque `useControlsCard.js` lo lee con
`parseFloat`; `--controls-slot-h`, que ese módulo escribe; la duración, el paso y la curva
que lee `ui/results/entrada.js`); lo mide `scripts/contrast.mjs`; o se reutiliza entre
reglas. Cualquier otra medida va junto a su propiedad, con su variación agrupada debajo.
**Un número repetido por casualidad no obliga a crear un token.**

| Token | Rol |
|---|---|
| `--background` / `--foreground` | papel / tinta: el dato que decide |
| `--muted-foreground` | dato secundario |
| `--card` → `--card-2` | superficies de vidrio; en claro, más blancas que el papel para separarse de él |
| `--border` → `--border-2` | canto del vidrio |
| `--primary` / `--primary-foreground` | la acción, una vez por pantalla |
| `--accent` | enlaces, etiquetas, tag de tarjeta |
| `--ring` | anillo de foco |
| `--brand` | la palabra «masfacil» del logotipo, igual en ambos temas |
| `--product-<combustible>` / `-strong` | relleno del chip / tinta del chip y de la cifra activa |
| `--halo-<marca>` / `--brand-halo-alpha` | halo de la marca del grifo, uno por marca registrada, y cuánto pesa |
| `--chart-fill-alpha` | tope del degradado de área del histórico |
| `--glow-1…3` / `--glow-alpha` / `--glow-blur` | las tres manchas del fondo, su intensidad y su difusión |
| `--glass-*` | vidrio: desenfoque de lo grande y de lo chico, saturación y sombra de lo grande |
| `--motion-*` / `--ease-out` / `--motion-ease` | movimiento (ver «Movimiento») |
| `--logo-halo` | contorno del logo para que el aro no se funda con el fondo |
| `--surface`, `--rim`, `--pill-fill`, `--pill-rim` | recetas de superficie del vidrio y de las píldoras de la barra |
| `--s1`…`--s5`, `--radius-small`, `--font` | escala de espaciado, radio y fuente (Roboto → stack del sistema) |
| `--collapse-at`, `--expand-at`, `--controls-compact-h` | umbrales del card de controles y alto de su fila compacta |

**Tokens y Tailwind.** Sin paleta ni escala propias: `ui/tailwind.css` declara alias
`inline` de estos tokens y borra el resto (`p-5` o `text-red-500` no existen). `estrecho:`
es 340 px o menos; `dark:` sigue a `data-theme`, nunca a la media query.

**Cuatro roles de color, separados:** identidad de masfacil (`--brand`), acción
(`--primary`, `--accent`, `--ring`), combustible (`--product-*`) y marca del grifo
(`--halo-*` y el isotipo). **El color de una marca comercial no tiñe botones, precios,
estados de selección ni series del histórico**: vive solo en la capa decorativa de su
tarjeta. Regular y Premium conservan el mismo color en la tarjeta y en el gráfico, para
leerlos sin leyenda. El halo va en la dirección que aleja la superficie de la tinta —tinte
claro sobre papel, oscuro sobre carbón— porque el color pleno le quitaba contraste al
texto; el color real de la marca lo lleva el isotipo.

**Vidrio.** El canto se lee por diferencia con lo que hay detrás: sobre fondo oscuro es
luz; sobre fondo claro, sombra. El relleno no separa la tarjeta del fondo; la separa el
canto. Por eso **ningún estado depende solo de una diferencia de fondo o de una sombra**:
el activo de un selector usa relleno, color de texto y peso. El card de controles, fijo,
se rellena al 90 % y lleva sombra para separarse de la lista que pasa debajo. Lo grande
—tarjetas y plates— es más grueso (desenfoque pleno y `--glass-shadow`); lo chico —chips,
selectores sueltos— usa `--glass-blur-small`. **Nunca vidrio sobre vidrio**: dentro de un
plate, selectores y tema no llevan desenfoque propio. Con «Aumentar contraste»
(`prefers-contrast: more`) el vidrio es opaco, sin desenfoque y con borde real.

**Movimiento** (skills de Emil Kowalski). Se anima solo
lo que tiene motivo —respuesta, de dónde viene algo, evitar un salto— y solo `opacity` y
`transform` (el alto del panel de controles es la excepción heredada). Entradas y presión
usan `--ease-out`; los cambios de color, `ease`; nunca `ease-in`, `transition: all` ni
`scale(0)`, y nada dura más de 300 ms salvo el giro de la carga, lo único en bucle. Al
pulsar, lo que tiene forma de botón se hunde al 97 % y el texto o la fila se atenúa. El
menú entra desde su botón y el detalle con un fundido; los dos se cierran al instante. Las
tarjetas nuevas de una lista suben 8 px y aparecen con 50 ms entre una y otra hasta la
sexta; reordenar no anima, y el cambio de tema tampoco. Con `prefers-reduced-motion:
reduce` hay menos movimiento, no cero: sin desplazamientos, escalas ni scroll suave;
quedan fundidos de opacidad y color.

**Fondo.** Papel liso pintado por `html` y tres manchas difusas (`.glow`) en `z-index:-1`;
`body` no pinta fondo porque las taparía. La violación se ve: el glow desaparece.

**Tipografía.** Roboto donde el sistema ya la tiene (Android); si no, el stack nativo.
Ninguna fuente se descarga. `tabular-nums` en cifras. El dato que decide va a 24 px y peso
800 (21 px hasta 340 px), con «S/» a 13 px porque la moneda acompaña; en el histórico, el
último promedio de cada franja a 26 px. **Ningún texto de lectura baja de 12 px**: tampoco
las etiquetas en mayúsculas ni los chips —monoespaciados y pegados a la cifra que
acompañan—, ni las etiquetas de un SVG, cuyo tamaño (`--chart-label-size`) se compensa con
el ancho para medir 12 px reales. Un `aria-label` no vuelve legible lo que no se lee.

**Rendimiento como decisión de diseño.** Sesiones de diez segundos: el shell arranca en
pocos KB y funciona offline con el último bundle validado. Un efecto que cueste en un
Android de gama baja se paga solo si mejora la decisión.

## 7 · Componentes

Principios, no catálogo. Dónde vive cada pieza lo dice `README.md` («Dónde se cambia la
interfaz»).

- **Un control, una cosa.** Ordenar no filtra; filtrar no ordena. Si su efecto no se
  nombra en una línea, hace dos cosas.
- **Estado visible sin depender del color:** relleno, peso o forma, declarado en el marcado
  (`aria-pressed`, `aria-current`), no solo en el estilo.
- **Elección binaria con botones, no con `<select>`.**
- **Si un control no cambia nada, se deshabilita y lo dice.**
- **Objetivos táctiles:** llamada principal de pantalla ≥ 52 px, acción dentro de una
  tarjeta ≥ 48 px, botón de texto ≥ 44 px.
- **El card de controles tiene tres estados** —completo, compacto y superpuesto—: se
  contrae al hacer scroll, se expande al volver arriba y su hueco conserva el alto para que
  la lista no salte.
- **Nada se repite:** lo que la tarjeta ya dice no se anuncia encima de la lista.
- **La tarjeta ordena por lo que decide:** primero lo que distingue una opción, después lo
  que la identifica, al final las acciones. Un dato ausente se dice («—», «por confirmar»,
  marcador neutral); la fila no se oculta.
- **La decoración vive en su propia capa, detrás del contenido:** la marca del grifo es
  `aria-hidden`, sin eventos ni parada de teclado, y recorta solo la decoración —nunca el
  foco, las acciones ni el detalle—, así que el `overflow` va en la capa. Sin activo
  registrado no hay capa: superficie neutral. La marca se dice siempre en texto.
- **Una decoración que gana presencia no puede costar altura:** si la tarjeta crece para
  exhibir marca, la marca sobra.
- **Un gráfico se lee en reposo:** valor principal, fecha y población visibles sin tocar;
  la interacción solo añade el detalle de un día.
- **Una escala por serie cuando las series no comparten rango**, con referencias en la
  unidad real, nunca en porcentajes.
- **Un patrón de trazo significa una cosa:** el discontinuo es solo el promedio de
  referencia.

## 8 · Accesibilidad

Piso no negociable, verificado y no asumido.

- HTML semántico: `<main>`, `<section>`, encabezados en orden, listas para las opciones.
- Todo tocable ≥ 44 px; acción primaria de pantalla ≥ 52 px. Sin scroll horizontal a
  320 px. Tema claro, oscuro y del sistema.
- Contraste **medido en el peor caso real**, con lo que se pinta detrás: **tarjeta** —el
  vidrio en sus tres mezclas y el card fijo, sobre el papel y cada mancha del glow, con el
  halo de cualquier marca— y **trazado** —además, el relleno de área de cada serie en su
  tope—. Texto ≥ 4.5:1; la cifra a peso 800 ≥ 3:1; foco, botón como forma y **gráfico
  necesario para entender el dato** ≥ 3:1. Lo prueba `node scripts/contrast.mjs`, que **no
  guarda paleta**: lee `ui/styles.css` y la receta que de verdad pinta, y falla bajo el
  mínimo o ante un rol que no sepa leer. Se corre a mano al tocar un token; un fondo nuevo
  que no se añade ahí queda sin acreditar. Exentos a propósito: «masfacil» en `--brand`, el
  canto del vidrio, el degradado de área y el isotipo de marca.
- **El chip se mide como texto, en sus dos tintas:** tinta y relleno nunca salen del mismo
  token, y un estado apagado se dice con tinta neutral, peso y borde, no con `opacity`, que
  hunde las dos a la vez.
- `:focus-visible` siempre visible; foco al encabezado al cambiar de paso (en resultados,
  el nombre del lugar); la tabulación no obliga a atravesar controles secundarios; al
  contraerse el card, nadie queda enfocado en un panel oculto.
- Nombres accesibles en cada acción y regiones vivas para los cambios de estado. **Una
  región viva no se repinta**: se crea una vez y solo se le escribe lo que la persona acaba
  de elegir; recrearla hace que unos lectores callen y otros lean la pantalla entera.
- **Una selección repinta lo que cambia, no el nodo que tiene el foco**, y un control que
  repinta su propio bloque devuelve el foco. Una descripción larga no se cuelga del foco
  con `aria-describedby`: va en una región hermana con nombre propio.
- **Retirar una vista no puede quitar el acceso al dato:** donde se quita una tabla queda
  una lectura equivalente (día, media y población), sin una parada de teclado por punto.
  Un nombre accesible o una instrucción para lector no son frases interpretativas visibles.
- Movimiento según `prefers-reduced-motion` (§6, «Movimiento»); `forced-colors` con bordes
  visibles; `prefers-contrast: more` con vidrio opaco.
- En el teléfono, un control responde con su `:active` y no con el destello gris de iOS, y
  mantenerlo pulsado no selecciona su texto (el contenido sí).

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

**Se conserva:** los colores de tema como custom properties de CSS, sin duplicar sus
valores en JavaScript ni en la sonda de contraste; los nombres, la anatomía y los estados
de los componentes; el HTML semántico y los atributos de accesibilidad; los estados
obligatorios; el microcopy; el presupuesto de rendimiento y el funcionamiento offline.
Nada de CSS-in-JS en tiempo de ejecución.

**Se puede reorganizar:** la estructura de archivos, el mecanismo de render y el
empaquetado. Una medida de un solo uso se escribe junto a su propiedad, en cualquier stack.

**Tailwind** (desde `docs/SPEC-ui-react.md`, gate 4): sin Preflight ni tema por defecto,
solo alias de los tokens; `ui/styles.css` llega tal cual, así que la sonda de contraste mide
lo que se sirve. Navegadores objetivo: Chrome/Edge 111, Safari/iOS 16.4 y Firefox 128.

## 12 · Decisiones cerradas de gasolina

Viven en `docs/SPEC-combustibles.md` §10. Reabrir cualquiera exige un hallazgo material
medido, no una opinión.

## 13 · Cómo se cambia este documento

Este documento se corrige cuando cambia un principio, un anclaje, la honestidad
del dato o un estado obligatorio. Una decisión reversible de copy, de orden de
pantallas o de presentación no lo toca y no necesita ceremonia.

Si el documento y el código discrepan, gana el código que funciona; el documento
se corrige cuando alguien lo note, no en un commit obligatorio por cada cambio de
UI.
