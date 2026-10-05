# UI-v2 · Marca a primera vista, Pulso de precios y CSS mantenible

**Estado:** cerrado. Implementado en `7953851` (14/09/2026). Su sistema de
estilos lo sustituyó `docs/SPEC-ui-react.md` (React, Vite y Tailwind).

Fecha: 13 de septiembre de 2026. Encargo único de implementación, definido con
Bruno en tres rondas de conversación. Builder previsto: Claude Opus.

Ampliación aprobada por Bruno tras la auditoría inicial: simplificar el CSS
nativo conservando la apariencia de UI-v2 y sus correcciones de accesibilidad.
La sección 10 cierra este encargo dentro del mismo WIP y gobierna su sistema
de estilos. La futura migración a un framework no tiene destino ni fecha.

## 1. Resultado buscado

Mejorar la decisión a través de la presentación. En resultados, reconocer la
marca de un grifo de un vistazo y comparar precios con facilidad. En el
histórico, ver el último promedio de cada combustible, su evolución reciente y
su posición respecto del promedio del periodo, sin leer una interpretación.

Los dos frentes comparten un sistema visual. Se implementan como un solo hito,
con una revisión conjunta de la portada, las tarjetas y ambos temas.

### Acuerdos de Bruno que gobiernan este encargo

- Conservar el vidrio, el logo de masfacil y las formas redondeadas. Pulir radios
  y bordes; no convertir la app en una composición de cajas cuadradas ni de
  superficies opacas de color sólido. Botones y controles pueden conservar el
  relleno necesario para distinguir sus estados.
- En la composición inicial se pueden mejorar tipografía, tamaños, espaciado,
  jerarquía, fondo y tokens. Para la simplificación posterior de la sección 10,
  la apariencia de UI-v2 ya es la referencia, con sus correcciones de
  accesibilidad. DESIGN se actualiza con el sistema final.
- La marca gana presencia manteniendo aproximadamente la altura de las
  tarjetas. Isotipo grande y traslúcido, parcialmente recortado, más un halo
  localizado de color. La esquina superior derecha es la intención inicial;
  su posición final depende de la convivencia con precio y distancia.
- Los activos visuales de marca quedan a discreción del owner. Se admiten
  aportes, adaptaciones y recreaciones SVG con procedencia real declarada.
- Histórico en dos franjas apiladas: Regular arriba, Premium abajo. Cada una
  muestra una curva con degradado tenue debajo y una recta horizontal
  discontinua para el promedio del periodo.
- 14 días por defecto, opción de siete. Se retira 30 del selector y se elimina
  la tabla visible. Se conservan los datos que ya almacena el sistema.
- Cero palabras interpretativas: sin «bajo», «alto», «normal», «conviene cargar»,
  recomendaciones, semáforos ni titulares de tendencia. Solo datos y las
  etiquetas mínimas para entenderlos. Último valor visible sin interacción.
- Los días de semana y la comparación histórica pertenecen al histórico; no
  se añaden a las tarjetas de estaciones. No habrá conclusiones automáticas
  sobre el día más conveniente para cargar en este hito: solo calendario para
  que el usuario observe, sin agrupar ni comparar medias por día de semana.

Estos acuerdos sustituyen las alternativas anteriores del chat: no se harán
dos curvas superpuestas, no se pondrá una cifra permanente en cada punto, y no
se añadirá una frase que juzgue el precio. No se reabre el grill.

## 2. Base y alcance

Base inspeccionada: `main` en `f98de8f`. El 404 y el cierre del histórico ya están
commiteados. `docs/SPEC-piloto-facilito.md` y `scripts/pilots/` son trabajo ajeno sin
seguimiento; conservarlos intactos y no incorporarlos a esta entrega.

La PWA es Vanilla ESM. Este hito se resuelve con HTML, CSS y SVG locales, sin
cambio de stack ni librería de gráficos. Conserva búsqueda por GPS/distrito,
orden, radio, paginación, actualización de ubicación, detalle y navegación.
La portada sigue en `/` y `/gasolina/historial` enfoca el mismo histórico.

Incluye renderer de tarjetas, activos visuales necesarios, renderer/modelo de
vista del histórico, estilos comunes y documentación viva afectada. Puede
extender el registro de assets y su validación/precache cuando sea necesario.

Quedan fuera adquisición de precios, scraping, matching de identidades,
catálogo privado, cálculo/persistencia de medias diarias, backfill, cambios del
bucket y workflows del histórico, recomendaciones de compra y análisis de
patrones semanales. No cambia el contrato público de gasolina ni sus precios.

Hechos de partida que evitan investigaciones repetidas:

- Hay cuatro logos registrados: Primax, Repsol, AVA y Petroperú. Ya existen
  `official_asset`, `owner_supplied` y `faithful_recreation`.
- El logo actual tiene unos 14–15 px de alto y la gráfica usa un SVG de
  `320 × 148` para los dos productos. Ambos quedan pequeños en móvil.
- El resumen del histórico contiene medias diarias y número de estaciones por
  producto, hasta 30 días. La población participante puede cambiar.
- En la lectura pública del 13/09 había tres días registrados, del 11 al 13.
  Esto describe esa lectura, no es una constante que deba aparecer en código.

## 3. Dirección del sistema visual

Vidrio limpio, esquinas suaves, cifras claras y decoración localizada. La marca
de la estación es la firma visual de la tarjeta; el histórico usa el mismo
lenguaje de transparencia con áreas suaves debajo de las curvas.

Separar cuatro roles de color: identidad de masfacil, acción, combustible y
marca del grifo. Regular y Premium conservan correspondencias consistentes
entre tarjetas y gráfico, aunque se afinen sus tonos. Los colores de Primax o
Repsol no tiñen botones, precios, estados de selección ni series históricas.

Usar `web/styles.css` como fuente de verdad. Reservar las custom properties
para temas, decisiones compartidas y variantes que las necesiten, según la
sección 10; una medida particular puede ser un literal junto a su regla.
Conservar una sola implementación y los dos temas existentes.

La escala tipográfica prioriza precio, después identidad/distancia y luego
metadatos. Mantener cifras tabulares y una familia sans legible del stack local;
no hace falta descargar fuentes para resolver este cambio. Las etiquetas
necesarias para entender el precio deben leerse visualmente: un `aria-label`
no compensa un chip ilegible. Empezar con etiquetas de al menos 12 px y cifras
de unos 24–28 px, ajustando la composición antes de empequeñecerlas en móvil.

El Builder afina proporciones y opacidades durante la composición inicial con
capturas reales; en la simplificación comprueba que se conserven. Mantener
superficies translúcidas, foco visible y alternativas legibles si no hay soporte
de blur o se usan colores forzados.

## 4. Marca a primera vista

### Composición y comportamiento

Cada tarjeta conserva posiciones de datos comparables con las otras. La marca
se reconoce por forma y color sin crear una cabecera adicional de gran altura.
Usar una capa decorativa separada del contenido: isotipo amplio, halo tenue y
desvanecimiento hacia la zona de lectura. Recortar solo la decoración; nunca
anillos de foco, acciones o el detalle expandido.

El isotipo debe reconocerse a escala de tarjeta; bajar tanto su opacidad que
desaparezca no satisface el encargo. Tampoco lo satisface un logo nítido sobre
una gran mancha opaca que tape el vidrio. Probarlo en una lista de marcas
mezcladas, no solo en una tarjeta aislada.

Precio, distancia y frescura tienen fondo visualmente tranquilo. El halo no
debe interferir con la columna de distancia en GPS ni con Premium cuando se
elige distrito. La disposición puede cambiar respecto de la v1 para lograrlo.
No introducir una píldora alrededor de la distancia si el espacio o el
contraste ya resuelven su lectura.

Mantener un identificador textual inequívoco de la estación. El pequeño logo
actual puede integrarse, ampliarse o desaparecer si resulta redundante con el
isotipo; no es obligatorio duplicarlo. Si nombre de sede y marca difieren, la
marca debe seguir identificada de forma accesible. La capa decorativa usa
`aria-hidden`/`alt=""`, no captura eventos ni añade paradas de teclado.

Medir altura con la misma estación, estado, ancho y texto antes/después. Como
objetivo, conservar o reducir la altura habitual con un viewport de 390 px de
ancho; no crear filas extra solo para exhibir marca. A 320 px puede crecer por
legibilidad, sin truncar precios ni esconder información decisiva. Conservar
«Cómo llegar» y detalle.

### Casos que debe resolver

| Estado de la estación | Presentación |
| --- | --- |
| Marca publicada con activo visual | Tratamiento de marca completo, con el mismo orden de información que las demás. |
| Marca publicada sin activo | Marca en texto y superficie neutral; no adivinar isotipo o paleta. |
| Nombre de sede sin marca | Nombre y superficie neutral. |
| Identidad ausente | Fallback neutral existente, con idéntica calidad visual. |
| Nombre «por confirmar» y marca publicada | Conservar la indicación y la marca; no inventar una segunda acreditación visual. |
| Un combustible sin precio vigente | Mostrar «—» solo para ese combustible; nunca cero. |
| Ambos precios vencidos | Tarjeta compacta sin precios, con fecha de silencio, identidad y acciones; conserva la marca publicada y su activo disponible sin recuperar la fila de precios. |

### Activos y libertad del owner

Resolver el tratamiento de las cuatro marcas registradas. Puede extraerse un
isotipo del SVG existente o recrearse una variante adecuada para el nuevo uso,
con fidelidad reconocible. No es un encargo de ampliar cobertura comercial ni
de buscar nuevas identidades.

La selección del activo es editorial, a discreción de Bruno. No exigir que todo
SVG provenga de una descarga oficial, ni revalidar el uso ya autorizado cada
vez que se muestra. Registrar qué es realmente: activo oficial, recreación o
aporte del owner. Describir la referencia disponible; no inventar una URL
oficial ni atribuir autoría oficial a una recreación. Ajustar comentarios y
reglas documentadas que todavía exijan una referencia oficial como única vía.

Se conserva el saneamiento técnico: sin scripts, eventos, recursos externos,
`foreignObject` ni bitmap incrustado. Los datos públicos solo eligen una marca
conocida, nunca inyectan HTML, rutas ni estilos. Usar un identificador permitido
en el renderer y CSS por marca, compatible con `style-src 'self'`.

Extender el registro existente con los recursos opcionales que realmente haga
falta declarar; evitar una segunda lista manual de marcas. Si se crea un SVG
de isotipo separado, el instalador/verificador y la derivación de precache
deben reconocerlo. Cada variante renderizable se declara en ese registro con
su función visual; el renderer elige allí el recurso, sin deducir rutas por
convención fuera del registro. Su archivo y sus bytes intervienen en la huella del shell,
igual que los logos actuales. No escanear indiscriminadamente todo el directorio
ni editar el manifest generado a mano.

## 5. Pulso de precios

### Composición acordada

Un solo bloque de histórico en la portada, después de las acciones principales.
Título breve que identifique el promedio de Lima, unidad `S/ por galón` una vez,
selector `7 d / 14 d` y dos franjas apiladas, también en escritorio. Regular
primero y Premium después. Ambas comparten calendario y ancho de trazado.

Cada franja contiene:

1. Etiqueta del combustible y último promedio diario disponible, grande y
   visible en reposo, con fecha/hora de su `observed_at` en America/Lima. No
   sustituirla por generación, descarga, corte o último reporte de la fuente.
2. Curva continua del promedio diario observado, con el último punto destacado.
3. Relleno suave bajo la curva, degradado hacia transparente en la parte baja.
4. Recta horizontal discontinua del promedio del periodo, con valor más discreto.

La curva de Premium pasa a ser continua: el patrón discontinuo se reserva al
promedio de referencia. Etiquetas de combustible y franjas separadas permiten
distinguir productos sin depender únicamente del color.

Usar un identificador mínimo como `Prom.` junto al valor de referencia o una
leyenda única. No dejar dos cifras sin indicar qué representa cada una. El
último valor puede estar en la cabecera de su franja para evitar que choque
con la línea de referencia. Las cifras conservan dos decimales; sus etiquetas
no se superponen cuando actual y promedio coinciden.

El número de estaciones pertenece al último valor diario y se muestra pequeño
junto a sus metadatos, por ejemplo `715 grifos`. No atribuir ese denominador a
todo el periodo. Con cobertura incompleta, indicar discretamente los días
válidos como `k/W días`: k es el número de fechas con dato válido del producto
y W la ventana seleccionada (véase la fórmula siguiente). Calcularlo por
combustible; no contar observaciones generales sin precio de ese producto.

No hay cifras permanentes en todos los puntos, tabla desplegable ni instrucciones
visibles de «Toca o usa las flechas». Fechas, producto, unidad, promedio y estados
de datos son etiquetas informativas; no añadir frases sobre lo conveniente de
cargar, porcentajes interpretativos ni calificaciones del precio.

### Referencia visual del owner

La imagen adjunta en la última respuesta del grill muestra trazos finos azules,
curvas suaves, área azul translúcida degradada hacia el fondo, líneas de guía
muy ligeras y fechas espaciadas. Es referencia de **trazo y relleno**. No copiar
sus dos series superpuestas, sus cifras inexistentes ni su patrón de subidas y
bajadas. Aquí se implementan dos franjas, colores de producto y datos reales.

Esta descripción debe bastar para implementar sin depender del archivo temporal
del chat. No incorporar esa captura a `web/` como asset del producto.

### Qué significan curva y promedio

Se consume el resumen existente, validado con `history-contract.js`. Cada punto
es la media de precios mostrables de las estaciones participantes al último
corte observado de ese día en Lima; no es una medición nueva del surtidor.
La población puede cambiar. El cálculo de esos puntos no se modifica.

Para cada producto y ventana visible de W días, terminada en hoy (America/Lima):

```text
D = fechas de la ventana con mean finito y n > 0 para ese producto
k = número de fechas en D
promedio_periodo = suma(mean_diario[d] para d en D) / k
```

Cada día disponible pesa una vez. No ponderar por el `n` de cada día, promediar
capturas intradía, convertir huecos a cero ni dividir por W cuando faltan días.
Incluir el día actual si tiene observación; seguirá siendo un corte en curso.
Calcular con la precisión recibida y redondear solo para presentar. Cambiar
7/14 recalcula la referencia con los puntos de esa ventana, sin nueva descarga.

La ventana del cliente se limita a siete/catorce; el contrato, el resumen y el
almacén siguen admitiendo 30. No bajar `HISTORY_MAX_DAYS` ni migrar datos para
ocultar una opción de interfaz. No inferir patrones semanales ni asignar valores
históricos a las tarjetas de estaciones.

### Geometría, escala y calendario

- Una escala Y por franja, en soles reales. Incluir sus datos y promedio, con
  margen para marcadores/etiquetas. Mostrar referencias numéricas suficientes
  para leer cada escala; no normalizar a porcentajes ni ocultar la unidad.
- Mantener un piso de amplitud de **S/0.50 por galón** por franja, incluso si la
  variación es minúscula o toda la serie es constante. Es una regla de dibujo,
  no un umbral de precio «bajo». Evita que una diferencia de milésimas ocupe
  toda la altura. La escala crece cuando el rango observado lo necesita.
- Curva suave que pase por todos los puntos observados, sin sobrepasar los
  extremos de cada par de días contiguos. Usar interpolación monótona acotada
  (p. ej. Hermite con pendientes limitadas), no un spline libre. La curva es
  presentación; ni la media ni la consulta de valores se calculan desde ella.
- Dos puntos se unen con una recta; uno se representa como punto. Una serie
  constante permanece plana. No fabricar ondas para imitar la referencia.
- Los huecos cortan curva y relleno. No unir fechas separadas por un día sin
  dato ni comprimirlas; la recta del promedio es una referencia del periodo y
  puede atravesar el ancho completo sin fingir una observación en el hueco.
- El relleno cierra hacia el borde inferior de la propia franja, con su extremo
  bajo transparente; no es un área apilada entre productos ni una suma.
- Eje X con fechas reales y días de semana abreviados cuando quepan. En siete
  días pueden etiquetarse todos; en catorce se espacian las etiquetas para
  conservar legibilidad. La consulta puntual muestra siempre día y fecha.
- `Hoy` solo identifica la fecha actual del calendario. Si hoy carece de dato,
  dejar el hueco y fechar el último valor disponible; no desplazarlo al borde
  de hoy. El último punto se calcula por producto, no suponiendo fechas iguales.

Como inicio para la composición móvil, asignar unos 110–140 px de trazado a
cada franja y valores principales de unos 24–28 px, con etiquetas legibles al
ancho real. Ajustar tras verla a 320/390 px; no reducir todo el SVG hasta volver
a tener etiquetas de ocho píxeles. Reservar el espacio del bloque para evitar
saltos al cargar. Se admite scroll vertical para ver ambas franjas; las acciones
de ubicación y distrito siguen siendo accesibles antes del gráfico.

### Interacción, accesibilidad y ausencia de datos

El estado inicial satisface la lectura principal sin tocar. Un toque sobre la
franja consulta el día más cercano sin exigir acertar en un punto diminuto.
Flechas, Home y End permiten recorrer las fechas con teclado. Mantener scroll
vertical natural y foco estable; no capturar gestos para una interacción nueva
de zoom/pan. La selección sincroniza la fecha en ambas franjas y muestra solo
los datos de esa fecha. Se distingue del último valor, que sigue identificado.

Retirar la tabla visual no puede eliminar el acceso a los valores. Proveer
semántica y una lectura accesible de producto, día, media y número de estaciones;
controles operables con teclado y lector de pantalla, sin un tab-stop por punto.
Se admite un listado semántico solo para tecnologías de asistencia o una
lectura navegable equivalente. Nombres accesibles e instrucciones para lector
no son frases interpretativas visibles. Anunciar selecciones del usuario, no
toda la gráfica repetidamente durante un render.

| Datos de una franja en la ventana | Resultado |
| --- | --- |
| Ningún día válido | Sin curva ni promedio; ausencia breve y factual, nunca cero. |
| Un día válido | Punto, cifra y fecha; sin recta de promedio redundante ni tendencia inventada. |
| Dos o más días válidos | Tramos observados y promedio de esos días; declarar cobertura si incompleta. |
| Días ausentes entre observaciones | Huecos en su lugar real y sin relleno que los atraviese. |
| Producto sin datos, el otro válido | Resolver cada franja; conservar la que sí tiene datos. |
| Última observación vieja o copia local | Mantener fecha real y aviso factual breve; conservar la detección de antigüedad/copia existente. |
| Resumen inválido, inaccesible y sin copia válida | Estado de error solo en el histórico; búsqueda y GPS siguen funcionando. |

Conservar validación de la copia local, límite de tamaño, carga independiente y
revalidación de red. Al volver de segundo plano o cambiar ventana, recalcular
el calendario contra hoy; no agregar polling ni refresco periódico. Si se
cruzó medianoche, el dato de ayer deja de etiquetarse hoy.

La explicación del método puede vivir en una ayuda secundaria voluntaria,
accesible desde el bloque o desde «Sobre los datos», fuera del trazado. Explicar
allí media diaria, media de días y población variable. Retirar del componente
la afirmación fija «la fuente publica los martes»: el resumen informa fechas,
no acredita una cadencia permanente.

## 6. Implementación y límites entre módulos

| Zona | Responsabilidad en UI-v2 |
| --- | --- |
| `web/styles.css`, `web/theme.js` | Tokens comunes, contraste, superficies, marca y gráfico; cambiar theme.js solo si hace falta para el comportamiento acordado. |
| `web/offer-card.js`, `web/brand-logos.js`, `web/icons/brands/` | Composición de tarjetas, selección controlada de tratamiento y recursos SVG. |
| `web/lib/history-series.js` | Recorte, último valor por producto, media del periodo, escalas y tramos puros. Helpers nuevos solo si simplifican realmente el módulo. |
| `web/history-chart.js` | Dos franjas, curva/relleno/promedio, selección y estados; conservar la interfaz de montaje/foco/destrucción. |
| `web/index.html`, `web/app.js` | Contenedor del histórico y ajustes mínimos de integración/copy; preservar navegación y flujos existentes. |
| `pipeline/shell-manifest.mjs`, `app/shell-assets.mjs`, `scripts/install-brand-logo.mjs`, `scripts/verify-web.mjs` | Extensión coherente de assets/precache/saneamiento si se añaden variantes; sin segunda acreditación del logo. |
| `scripts/contrast.mjs` | Comprobar colores y fondos vigentes, eliminar la copia manual de la paleta y exigir contraste de etiquetas; véase sección 10. |
| `DESIGN.md`, comentarios/reglas de logos afectados | Documentar las reglas finales, retirar restricciones visuales reemplazadas y alinear la libertad de activos. |

El cálculo histórico de presentación es una función pura del resumen y reloj;
no depende de GPS, distrito, marca, DOM ni almacén. Los datos de prueba no se
persisten como precios reales ni se añaden a `web/data/`.

El registro de variantes debe tener un único recorrido de assets compartido por
validación y precache. Revisar IDs de gradients/clips para que no colisionen
entre franjas o renderizados. El chart SVG generado por código confiable puede
tener gradientes internos; esto no habilita SVG arbitrario desde datasets.

## 7. Actualización de DESIGN.md

Actualizar el documento existente al acabar la composición y comprobarla. No
crear un manual paralelo ni conservar reglas v1 contradictorias junto a v2.

Documentar: vidrio y radios refinados, jerarquía legible, roles de color
separados, capa de marca frente a contenido, referencia de promedio discontinua,
gradiente de área, escalas explícitas y estilo factual sin interpretación.
Conservar principios generales reutilizables por otras rutas; las reglas de
media y combustible específicas de gasolina permanecen en su sección propia.

Alinear también estas contradicciones existentes cuando afecten el encargo:
la regla «cero red de terceros» ya tiene el origen público del histórico como
excepción explícita y controlada; la libertad del activo no equivale a inferir
identidad de una estación. El texto sobre identidad debe remitir a la política
vigente de AGENTS sin reintroducir prohibiciones de corroboración ya sustituidas.
Si se modifica AGENTS por la libertad de procedencia del activo, limitar el
cambio a ese punto; no alterar roles, permisos de publicación ni el catálogo.

## 8. Orden de construcción y evidencia de entrega

Primero definir tokens compartidos y resolver una tarjeta con marca, su fallback
y una franja del histórico. Revisarlas juntas a tamaño móvil para fijar el
lenguaje; después completar variantes y segunda franja. Es una comprobación de
trabajo del Builder, no otra fase documental ni una nueva aprobación por token.

Con esa base común, tarjetas e histórico pueden construirse en paralelo. Cada
frente limita sus selectores a su componente; una sola persona integra tokens,
estilos compartidos y DESIGN. Entregar el hito unido y visualmente coherente.

Comprobaciones proporcionales antes de entregar:

- Comparación visual antes/después a 390 px y comprobación sin desbordes a
  320 px, en claro/oscuro. Lista mixta con las cuatro marcas, fallback, nombre
  largo, modo GPS/distrito, precio parcial y tarjeta silenciosa. Revisar detalle
  abierto y controles compactos por el efecto de los estilos globales.
- Histórico real escaso y serie sintética de 14 días, una constante y una con
  huecos/datos parciales. Capturas deben mostrar cifra actual, curva, promedio y
  degradado legibles. Sintéticos claramente de demostración, fuera de los datos
  de producción. El modo demo respeta 14 por defecto y ofrece siete, nunca fuerza 30.
- Pruebas pequeñas de la media de días (con n diferentes), recorte 7/14, huecos,
  último dato distinto de hoy, escala constante y suavizado sin extremos nuevos.
  Ejemplo sintético: medias 20 y 22 con n distintos producen referencia 21;
  un día vacío no añade cero. No crear una suite general ni una cuota de tests.
- Comprobar teclado y lectura accesible tras retirar tabla, tamaño táctil y
  contraste de texto/líneas significativas sobre los fondos reales. La medición
  debe incluir halos y rellenos nuevos; el script viejo en verde por sí solo no
  acredita esos fondos. Texto normal ≥ 4.5:1, grande ≥ 3:1 y gráficos necesarios
  para entender el dato ≥ 3:1. El degradado decorativo puede ser más tenue.
- Ejecutar `npm run verify:web`, `npm run audit` y `node scripts/contrast.mjs`
  sobre el candidato pertinente, además de las comprobaciones acotadas elegidas.
  Derivar previamente el shell por la ruta existente; no versionar el generado.
  `audit` revisa por defecto el índice: declarar el alcance realmente revisado,
  sin atribuirle cobertura sobre archivos nuevos aún sin seguimiento.

Verificar el resultado como producto: se reconoce la marca sin leer toda la
tarjeta; precio y distancia se comparan con rapidez; cada histórico muestra
valor, fecha y posición respecto de su referencia sin tocar ni leer un juicio.

Entregar por chat alcance, capturas útiles, comprobaciones/resultados y límites
reales. No crear informes de sesión ni otro SPEC para cada componente.

## 9. Publicación posterior

Este SPEC encarga implementación; commit, push y deploy siguen el circuito de
AGENTS y la autorización de Bruno. El piloto de Facilito no se incluye.

La interfaz puede publicarse sobre el bundle válido existente. Atención a la
clasificación actual: cambios en `app/`, generador de shell o verificador se
clasifican como `project`, aunque el fin sea visual. En el handoff declarar qué
ruta resuelve el diff completo. Si requiere esos archivos, no prometer un deploy
automáticamente clasificado como `shell`, ni ampliar este hito para rediseñar
el enrutador. El release autorizado elegirá la ruta operativa apropiada y
comprobará shell/precache y datos servidos sin exigir una nueva fuente de precios.

## 10. Simplificación del CSS nativo · decisión cerrada

### Resultado y base de comparación

Bruno eligió conservar la apariencia de UI-v2, no anticipar una migración sin
fecha y mantener CSS nativo con pocas variables semánticas y reglas por
componente. Este apartado sustituye las reglas heredadas que obligan a generar
la paleta mediante parámetros del mockup o a convertir cada medida en token.

El resultado debe permitir cambiar un componente leyendo sus reglas y una
paleta pequeña, sin seguir una cadena de variables para conocer su aspecto.
La optimización buscada es de mantenimiento: no atribuir mejoras de velocidad
del navegador a reducir variables sin medirlas.

La referencia visual es el WIP de UI-v2 con las correcciones de accesibilidad
que se están integrando. Antes de refactorizar, sincronizar esos cambios y
guardar capturas comparables fuera de Git. No usar el mockup antiguo ni HEAD
como referencia de apariencia, ni pisar el trabajo del agente que corrige.
La limpieza conserva también los chips legibles y el foco estable del histórico;
no cuenta como cumplimiento volver a la versión anterior a las correcciones.

Sondas de partida: 64 nombres globales y cuatro locales declarados en CSS;
solo `--chart-band-h` carecía de consumidor. `scripts/contrast.mjs` repetía 30
de los 31 hex únicos, además de parámetros OKLCH y opacidades. Son medidas del
WIP inspeccionado, no constantes del producto ni una cuota de reducción.

### Un archivo de estilos, pocas decisiones compartidas

Mantener `web/styles.css` como CSS escrito a mano y servido directamente.
Organizarlo en secciones legibles de tema, base, superficies compartidas y
componentes. Cada componente reúne reglas base, variantes, estados y ajustes
móviles; declarar los overrides después de la regla que modifican. Usar una
declaración por línea y comentarios cortos que expliquen decisiones vigentes.
El número de líneas no mide el éxito de esta limpieza.

Conservar los selectores de componente y los atributos de estado existentes
si sirven. Limitar el alcance de las reglas y su especificidad; no crear una
capa final de parches. Compartir una receta visual realmente repetida con una
regla común, sin inventar una biblioteca de utilidades. Las excepciones de
accesibilidad, como `[hidden]`, mantienen su prioridad.

No añadir Tailwind, Sass, CSS-in-JS, generadores de tokens ni un paso de build.
No dividir ahora el CSS mediante imports: la precache actual incluye
`/styles.css` y no recorre dependencias CSS. No hace falta ampliar ese mecanismo
para organizar las secciones de un archivo de este tamaño.

### Qué conserva una variable y qué pasa a ser un valor directo

| Caso | Regla final |
| --- | --- |
| Colores claro/oscuro | Literales finales por tema: se admite `oklch()` con sus tres valores explícitos o un equivalente fiel. Retirar `--paper-hue`, `--paper-chroma` y `--ink-chroma`. Conservar roles legibles para superficie, texto, acción y combustible. |
| Familia tipográfica, espaciado y radios comunes | Mantener solo las decisiones cuya coordinación entre componentes sea útil. La repetición casual de un número no obliga a crear un token. |
| Tamaño, posición, duración o intensidad de un solo uso | Escribir el valor junto a su propiedad. Si cambia en móvil o en un estado, agrupar allí el override. Retirar el parámetro global correspondiente. |
| Variante local de combustible o marca | Conservar `--product`, `--product-strong`, `--serie` y `--brand-halo` cuando permitan reutilizar la misma regla. Su ámbito es el componente y su origen sigue siendo controlado. |
| Alias sin decisión propia | Consumir directamente el rol original; por ejemplo, `--chart-ref` no necesita duplicar `--muted-foreground` si nunca difieren. |
| Token sin consumidor | Eliminarlo y retirar su documentación. `--chart-band-h` no controla el trazado de JS y no se conecta a él solo para justificar su existencia. |

Reducir también la cadena de cálculos. Resolver una vez las operaciones que
solo combinan constantes del mockup: por ejemplo, una opacidad fija no necesita
un token global y una multiplicación para obtener otra constante. En superficies
compartidas puede quedar una receta única; sus stops y opacidades deben poder
leerse sin atravesar varios parámetros de ajuste. Mantener `calc()` para
relaciones reales de layout y `color-mix()` cuando evita duplicar variantes
semánticas útiles, no por conservar la parametrización histórica.

Las variables que cambian de verdad con el tema siguen teniendo sentido. Las
de marca e histórico que solo se usan allí se definen en ese ámbito, también
sus overrides de tema. No trasladar automáticamente todos los antiguos tokens
globales a un bloque local: primero eliminar los alias y constantes indirectas.
Retirar overrides oscuros idénticos al valor heredado y comentarios del mockup.

### Contratos que no se pueden borrar como decoración

- `theme.js` continúa resolviendo claro/oscuro/sistema a `data-theme` y conserva
  la preferencia del usuario. No necesita un motor de temas nuevo.
- `controls-card.js` lee `--expand-at` de la raíz en píxeles y escribe
  `--controls-slot-h` en el slot. Conservar esos contratos en esta limpieza.
  `--collapse-at` dimensiona el sentinel observado; preservar su umbral y la
  histéresis. La altura y separación de la barra también deben seguir siendo
  coherentes con el desplazamiento al resultado y sus anillos de foco.
- Preservar estados `data-state`, `data-screen`, `data-key`, `data-serie` y
  `data-brand`, además de atributos ARIA. La CSP y el origen controlado de los
  colores y activos comerciales siguen vigentes.
- Mantener `/styles.css`, su huella en el shell y el estilo de `404.html`.
  Esta ampliación no cambia adquisición, datos, proyección, rutas ni workflows.

### Contraste con una sola fuente visual

`node scripts/contrast.mjs` sigue siendo la entrada de comprobación y falla
cuando no cumple. Debe leer los valores vigentes de `web/styles.css` en vez de
guardar otra paleta de colores, incluidos los tonos claros/oscuros y alphas que
intervengan en la medición. Los nombres de los roles y los mínimos exigidos sí
pueden declararse en la sonda: son su contrato, no una segunda configuración
visual. Un valor ausente o no interpretable debe producir error explícito.

Mantener la extracción acotada al CSS que usa este proyecto; no construir un
intérprete general de CSS ni añadir una capa de configuración para facilitar
el verificador. Las recetas medidas deben corresponder a las reglas vigentes.
Si una composición necesita comprobación en navegador, realizarla con las
herramientas existentes y declarar qué acredita la sonda numérica y qué acredita
la captura. No sustituir la paleta duplicada por capturas de valores guardadas
a mano que puedan quedar obsoletas.

Conservar mínimos de 4.5:1 para texto normal y 3:1 para texto grande y gráficos
significativos. REG/PRE/DIST y las etiquetas del gráfico se evalúan como texto,
incluidos sus estados atenuados: no exceptuarlos por disponer de `aria-label`.
La referencia del promedio necesita comprobar tanto su línea como su etiqueta.
Verificar los fondos reales de vidrio, halo, isotipo y área que coincidan con
el contenido; distinguir lo decorativo de lo necesario para leer el dato.

### Entrega y comprobación de la simplificación

Alcance principal: `web/styles.css`, `scripts/contrast.mjs` y `DESIGN.md`.
Helpers de comprobación, si hacen falta, viven fuera de `web/`. No reescribir
renderers o lógica de controles por una preferencia de organización del CSS.
Actualizar DESIGN para retirar los knobs y su copia de paleta, describir la
regla final de tokens y alinear su sección de futura migración; no conservar
una obligación de tokenizar todas las medidas ni una configuración paralela.

Comprobar antes/después con el mismo viewport, datos, tema, estado y reloj:
320/390 px y un ancho de escritorio; portada, tarjetas mixtas GPS/distrito,
detalle abierto, barra full/compact/overlay, histórico y 404. Reutilizar los
casos de la sección 8. Revisar geometría, texto, vidrio, marca y gráfico, además
de navegación por teclado, ambos temas, movimiento reducido y colores forzados.
Los cambios visuales deliberados se limitan a las correcciones de accesibilidad
pendientes; no normalizar tamaños o colores por conveniencia de la limpieza.

Ejecutar las comprobaciones de la sección 8 sobre el WIP integrado, sin crear
tests que congelen nombres de tokens o reflejen la estructura del CSS. Añadir
una sonda pequeña al extractor de contraste solo si introduce lógica que pueda
aceptar una paleta incompleta o desactualizada sin avisar.

Entregar por chat conteo antes/después de variables globales y locales, ejemplos
de cadenas eliminadas y capturas comparables. No hay porcentaje obligatorio;
no satisface el encargo borrar solo el token muerto, cambiar nombres, minificar
o mover toda la complejidad a otros archivos. Deben desaparecer los parámetros
de paleta del mockup, las constantes globales de uso particular, los alias
innecesarios y la copia manual de colores del verificador.

### Tailwind v4 evaluado, no adoptado en este hito

La [CLI oficial](https://tailwindcss.com/docs/installation/tailwind-cli) permite
generar CSS estático sin framework; sus [variables de tema](https://tailwindcss.com/docs/theme)
no sustituyen la necesidad de elegir una paleta y roles. Aquí incorporarlo
requeriría compilar antes de derivar/verificar el shell, instalar herramientas
en el workflow y revisar el marcado y el reset. La detección de utilidades
requiere [clases completas en las fuentes](https://tailwindcss.com/docs/detecting-classes-in-source-files).

Bruno eligió CSS nativo por el objetivo actual de mantenimiento. Una futura
migración se evaluará por su necesidad concreta; esta entrega conserva CSS
estándar, HTML semántico y estados de componente sin preparar otro stack.
La autorización de commit, push y deploy continúa siendo la de la sección 9.
