# Combustibles: arquitectura sencilla y entregas incrementales

**Estado:** cerrado el 27/09/2026: fases desplegadas, funcionamiento verificado y
correcciones de cierre reauditadas (ver §9).

Decisiones cerradas con Bruno al 23 de septiembre de 2026; división de Fase 2 aprobada por el Líder el
24 de septiembre de 2026. Este es el único SPEC de esta ampliación;
leer las reglas comunes de `AGENTS.md` y el contrato del Builder en `CLAUDE.md`.
No ejecutar todas las fases como una sola entrega ni interpretar este documento
como autorización de commit, push o deploy.

## 1. Resultado y referencia aprobada

Una persona puede consultar Gasolina, Diésel, GLP o GNV con la navegación actual:
ubicación o distrito, resultados comparables y cómo llegar. La elección de
combustible no introduce una pantalla obligatoria antes de pedir ubicación.

El [mockup aprobado](prototypes/combustibles.html) es la referencia de distribución
y controles. Huella SHA-256 de la versión aprobada:
`c8351bae92838dff6abf5bebdebf9646800153c2f48e1fb04ebffc4999e91d7f`.
Su aspecto monocromo no sustituye los estilos de producción ni `DESIGN.md`.
Se implementan sus recorridos con datos reales: no se copian precios, nombres,
direcciones, distritos de muestra, GPS simulado, histórico ficticio, herramientas
de exploración ni enlaces simulados.

Las decisiones de este SPEC sobre nuevas vistas y rutas sustituyen únicamente
las restricciones de gasolina que impedían esa ampliación. Se conservan los
demás principios de `DESIGN.md`, especialmente la tarjeta conjunta Regular/Premium,
la cabecera que se contrae y la honestidad de precios, unidades e identidad.

Decisiones cerradas:

- Cuatro vistas del mismo nivel: **Gasolina, Diésel, GLP, GNV**. Sin categoría
  intermedia «Gas» o «Petróleo»; sin cinco vistas que separen Regular y Premium.
- Solo se muestran las vistas ya activadas y publicadas. Sin opciones
  deshabilitadas de «próximamente». Con una sola vista no hay selector inútil.
- Cabecera **A**: al desplazarse muestra combustible, lugar y criterio; el
  selector completo se abre con **Ajustar**. Se conserva espacio para evitar saltos.
- Se recuerda el último combustible, con almacenamiento tolerante a fallos.
  No se persisten coordenadas. La URL específica tiene prioridad sobre la preferencia.
- Primero se amplía el producto en Vanilla JavaScript/HTML/CSS. **React + Vite +
  Tailwind es el destino posterior de UI**, con encargo y comprobaciones propios.
  No se incorporan ahora ni se elige Preact como sustituto.

## 2. Base y límites de este encargo

Base inspeccionada: `6ba60de`. La integración de Facilito existente se considera
cerrada; no repetir su discovery ni reabrir su método de adquisición, vínculo o
política de frescura. Se extiende y acredita solo lo nuevo. Conservar el cron y
las correcciones operativas vigentes; este SPEC no cambia horarios de refresco.

En el árbol inspeccionado hay modificaciones ajenas en
`.github/workflows/refresh-pages.yml` y `README.md`, además de SPECs, prototipos y
pilotos sin seguimiento. No revertirlas ni incorporarlas por comodidad. Al
comenzar cada fase, volver a inspeccionar el estado y trabajar sobre la base real.

No se descargaron fuentes nuevas para este SPEC. El discovery local confirmó
productos, pero **no acredita cobertura publicable actual**: los últimos archivos
analizados fueron líquidos del 06/09 y GLP del 13/08. Los conteos exploratorios
no son umbrales de aceptación ni cantidades que deban forzarse en producción.

| Vista | Producto objetivo, nombre exacto observado | Unidad | Base CSV |
| --- | --- | --- | --- |
| Gasolina | `GASOHOL REGULAR` y `GASOHOL PREMIUM` | Galones | Líquidos existente |
| Diésel | `Diesel B5 S-50 UV` | Galones | Líquidos existente |
| GLP | `GLP - G`, restringido a actividad automotora acreditada | Galones | GLP vigente del catálogo de fuentes |
| GNV | `GAS NATURAL VEHICULAR COMPRIMIDO` | Metros Cúbicos | Líquidos existente |

No unir variedades de diésel por parecido de nombre ni renombrarlas «D2».
No mezclar gasohol con los registros distintos `GASOLINA REGULAR/PREMIUM`.
GLP por peso o en cilindros queda fuera; filtrar por nombre y galones no basta
para acreditar la actividad automotora. GNV licuefactado y filas con unidades
anómalas quedan fuera. No convertir unidades ni comparar precios entre productos.

Los códigos de los nuevos productos en Facilito, sus unidades de tabla y los
cruces Registro/GIS son comprobaciones de implementación pendientes, no decisiones
que deba volver a tomar Bruno. Descubrirlos en las fuentes correspondientes;
no inventar códigos ni heredar las actividades autorizadas para gasolina.

Fuera de alcance: cambio de geografía, tipo de cambio, backend, autenticación,
base de datos, migración del stack de UI, rediseño visual, una nueva campaña de
identidad comercial y un sistema genérico para cualquier utilitario futuro.

## 3. Arquitectura mínima, preparada para otra UI

Separar responsabilidades aprovechando los módulos existentes. Los nombres de
archivos nuevos son decisión del Builder; las siguientes separaciones son obligatorias.

1. **Catálogo.** Un único origen para los metadatos públicos de vista/producto:
   claves estables, nombre, unidad, moneda, productos que se muestran juntos y
   rutas. Gasolina tiene dos productos; cada nueva vista tiene uno. La activación
   es explícita por entrega, no un efecto de encontrar cualquier archivo.
   Los códigos de adquisición, actividades, reglas de vínculo y datos privados
   permanecen del lado de operación; no publicar un catálogo privado en `web/`.
2. **Reglas de consulta.** Funciones que reciben datos, selección y reloj y
   devuelven filas, orden, contadores y estados. Sin DOM, HTML, acceso implícito a
   almacenamiento o imports de un framework. Reutilizar selección de fuente,
   frescura, distancia, radio y orden existentes en lugar de duplicarlos.
3. **Operaciones.** Carga y validación, ubicación y preferencias tienen interfaces
   pequeñas. Mantener implementaciones concretas y dependencias sustituibles
   donde sirven para comprobarlas; no crear contenedores de dependencias.
4. **Presentación Vanilla.** Recibe resultados y emite acciones. El estado de
   búsqueda declara vista, origen o distrito, radio, orden y producto para ordenar.
   No deducirlo del texto de un botón ni de clases CSS. El DOM y los listeners
   quedan aquí; el futuro React podrá reutilizar los módulos anteriores.
5. **Fuentes y publicación.** Cada lector interpreta su fuente y entrega una
   estructura normalizada con procedencia. El módulo de publicación conserva los
   contratos, snapshots, promoción y recuperación. El parecido entre combustibles
   no autoriza compartir un cruce de identidad que no haya sido comprobado.

No fabricar un sistema de componentes, store reactivo, bus de eventos, router
genérico o framework propio que luego se desecharía. Tampoco mover archivos solo
para obtener una jerarquía elegante. Se permite mantener adaptadores y nombres
de entrada antiguos para compatibilidad durante la migración.

Los módulos de validación estructural y metadatos comunes deben poder compartirse
sin introducir `node:crypto`, `fs`, secretos o red en el navegador. Los detalles
de hash y E/S siguen teniendo implementaciones apropiadas para cada entorno.

## 4. Contrato de navegación

Rutas canónicas del alcance final:

```text
/combustibles/gasolina
/combustibles/diesel
/combustibles/glp
/combustibles/gnv
```

- `/` resuelve la última vista activada recordada; sin preferencia válida, Gasolina.
  No agregar una portada general de categorías. Una ruta específica siempre manda.
- Cambiar de vista actualiza la URL. Los cambios de combustible usan
  `replaceState`; no llenar el historial con cada ajuste. Resolver carga directa,
  recarga y `popstate` con las mismas reglas. No serializar coordenadas en la URL.
- Conservar los enlaces antiguos `/gasolina`, `/gasolina/regular` y
  `/gasolina/premium` mediante redirecciones a Gasolina canónica. No volver a
  separar su tarjeta en dos pantallas.
- `/combustibles/gasolina/historial` abre el histórico existente; redirigir
  `/gasolina/historial` conservando ese significado, aunque la preferencia sea otra.
- Definir normalización consistente de barra final. Reescrituras solo para rutas
  conocidas y activadas, tanto en servidor local como hosting y service worker.
  Una ruta no existente, no activada o ajena al alcance responde 404; no usar un
  fallback universal de SPA que convierta cualquier dirección en portada con 200.
- Las rutas de tipo de cambio quedan reservadas conceptualmente: no crear páginas,
  componentes ni reescrituras para ellas.

Los cuatro estados del recorrido son Inicio, Distritos, Resultados por ubicación
y Resultados por distrito. Son estados de la misma interfaz; no cuatro copias
de la aplicación ni cuatro rutas adicionales obligatorias.

En inicio, elegir combustible no pide GPS ni abre otra pantalla. «Ver en mi
ubicación» conserva el gesto y la gestión de permisos actuales; «Ver distritos»
permanece como alternativa. Al volver se recuerda el combustible, no una ubicación
guardada ni una solicitud automática de permiso.

En resultados, cambiar combustible conserva ubicación/distrito, radio elegido y
orden compatible; reinicia paginación y lleva al comienzo de los resultados con
foco coherente. Una carga tardía de la vista anterior no puede reemplazar la nueva.
No mostrar precios del combustible anterior bajo la etiqueta del nuevo durante
la carga. No ampliar silenciosamente un radio elegido para ocultar un vacío.

- **Con ubicación:** radio 1–5 km en pasos de 0.5; inicial según la política actual
  y las ofertas de la vista. «Más cerca»/«Más barata». Distancia en línea recta.
- **Por distrito:** sin radio, distancia ni opción «Más cerca»; orden por precio.
  Los distritos se derivan de la cobertura válida de esa vista, no de una lista
  parcial del prototipo. Si el distrito conservado no tiene resultados en la nueva
  vista, explicar el vacío y permitir cambiarlo; no sustituirlo automáticamente.
- **Gasolina:** ambos precios, Regular/Premium, visibles en cada tarjeta; el
  selector de producto solo decide el orden por precio. Un precio ausente no es cero.
- **Otras vistas:** un precio por tarjeta, nombre preciso y unidad visible:
  S/ por galón para Diésel/GLP, S/ por m³ para GNV. Sin subselector de un solo producto.
- **Cabecera A:** full/compact/overlay, espacio reservado, Ajustar/Listo, cierre
  exterior y Escape, foco recuperable y controles ocultos fuera del teclado.
  Combustible y criterio siguen siendo comprensibles en el resumen compacto.
  Abrir Ajustar lleva el foco al primer control visible; cerrar con Listo,
  Escape o fondo exterior lo devuelve a Ajustar. Cambiar combustible conserva
  el foco en el selector utilizado; cargar resultados no lo desplaza.
- Mantener tarjetas sin precio cuando corresponda, frescura por producto,
  identidad neutral cuando falte respaldo, detalle y «Cómo llegar» reales.
  No arrastrar grifos de gasolina a otra vista solo porque comparten una zona.

Objetivo visual: el mockup aprobado con los estilos existentes, targets de al
menos 44 px, teclado utilizable y sin scroll horizontal a 320 y 390 px. No añadir
opciones o cambiar distribución solo porque se esté refactorizando.

El histórico de Gasolina debe seguir funcionando. En las otras vistas no mostrar
su serie ni los números ficticios del mockup: omitir el bloque y la acción si no
existe un resumen válido del producto. La ampliación de series históricas no es
requisito ni trabajo de este SPEC; el observador actual sigue independiente.

## 5. Datos, fuentes e integridad entre entregas

### Grupos de publicación

La unidad atómica de Gasolina sigue siendo **Regular + Premium**. Diésel, GLP y
GNV son grupos independientes de un producto. No imponer una única revisión o
fecha de fuente común a los cuatro: líquidos y GLP pueden tener cortes distintos.

Conservar `/data/gasolina/` y su contrato compatible durante este alcance. Los
nuevos grupos tienen namespaces separados, por ejemplo `/data/diesel/`, con
manifest, estado operativo y snapshots inmutables propios. No cambiar la forma
de una ruta versionada existente ni reinterpretar sus bytes. La URL de navegación
`/combustibles/...` no obliga a trasladar físicamente los datos de gasolina.

- Validar producto, nombre canónico, unidad, moneda, ámbito, campos permitidos,
  valores, identidad, fechas, revisión, hashes y rutas tanto al proyectar como
  en el navegador. No relajar el contrato para aceptar cualquier producto.
- Primero escribir snapshots completos, luego estado y al final manifest. Obtener
  todos los productos de una vista contra el mismo manifest/revisión; rechazar o
  reintentar lecturas cruzadas. El modo guardado también exige un conjunto coherente.
- La ruta `shell` recupera y valida **todos los grupos activados** y publica sin
  consultar los CSV ni Facilito. Reutiliza sus bytes y no pierde grupos por usar
  el descargador antiguo de gasolina. Un shell nuevo puede convivir con bundles
  antiguos válidos; compatibilidad y migración se prueban antes de publicarlo.
- Un fallo de adquisición, proyección o cobertura de un grupo conserva su última
  versión válida y permite preparar cambios válidos de los otros. Un grupo nuevo
  sin primera versión válida no se activa. Una vista ya activada con un fallo de
  carga no desaparece del selector: usa su copia validada o muestra su error propio.
- Antes de subir el árbol completo, comparar contra producción por grupo y por
  unidad Facilito distrito/producto. La novedad de Diésel no permite retroceder
  Gasolina; la novedad de un CSV no permite perder consultas más recientes.
  Actualizar/revalidar los grupos reutilizados si producción avanzó durante la
  preparación; si no puede construirse una entrega coherente, abortar ese deploy.
- La precaché sigue derivándose de los archivos reales y sus bytes. Las claves de
  caché de datos distinguen grupo, producto, contrato y revisión. No borrar copias
  de otros grupos al refrescar uno. Una instalación existente debe poder actualizar
  el shell y conservar datos compatibles; no prometer offline de vistas nunca cargadas.

### Política de fuente, sin cambios de significado

Reutilizar `selectOfferPrice` y sus consumidores. CSV con reporte válido posterior
a la consulta gana; en otro caso, consulta elegible hasta 24 horas; después CSV
hasta 30 días; sin fuente elegible se apaga el precio. Conservar ambos respaldos
en el bundle para que el cambio también ocurra offline. No renovar fechas por
republicar, no aceptar fechas futuras y no equiparar «Consultado» con «Reportado».

Cada fase de producto incluye acreditar su lectura CSV, cruce Registro/GIS y
extensión de Facilito. La tabla web se acepta por distrito/producto completo,
con nombre, unidad y total comprobados. Reutilizar el vínculo exacto autorizado
de `docs/SPEC-precios-facilito.md` y su comprobación de muestra para el producto nuevo;
no repetir la acreditación de gasolina. Nunca crear IDs desde Facilito.

Los fallos transitorios de Facilito siguen usando CSV y no impiden publicar datos
válidos. Pero no declarar terminada la extensión de una fuente que nunca se ha
comprobado: si un código, unidad o vínculo nuevo no puede acreditarse, delimitar
ese bloqueo antes de activar el producto; no anunciar una fase completa basada
únicamente en el mockup o en supuesta equivalencia con gasolina.

Excepción aprobada por Bruno en el plan de Fase 3: GLP puede activarse solo con
CSV si la sonda de su formulario Facilito no resulta viable y el bloqueo queda
declarado. Eso no acredita ni da por terminada su integración Facilito. Si la
captura es viable, el vínculo debe comprobarse antes de publicar esa capa.

Usar adquisiciones reutilizables y el catálogo oficial existente. Las sondas que
resuelvan códigos o semántica son acotadas; no redescargar originales disponibles
ni hacer barridos ajenos a la pregunta. Capturas, evidencia y mapas privados
permanecen fuera de Git y de logs públicos.

### Primera activación y recuperación

Para un producto nuevo, producir el embudo completo: filas del producto/unidad y
actividad objetivo → último reporte por clave → Registro único → GIS seguro →
ofertas publicables → precios elegibles. Declarar exclusiones y cobertura por
distrito. No publicar solo una muestra ni presentar conteos del raw como cobertura
del producto. Debe existir al menos un precio elegible y toda pérdida no explicada,
unidad equivocada o asociación incorrecta bloquea la activación.

Los guardrails actuales de gasolina se conservan. Los de cada nuevo grupo parten
de su primera base auditada y quedan explícitos en su configuración; no copiar un
conteo absoluto de gasolina ni ajustar tolerancias para aprobar un candidato.

Mantener `npm run rollback` compatible con sus usos actuales. Ampliar la selección
de grupo/revisión de forma explícita, sin restaurar una captura web actual sobre
un snapshot antiguo. La recuperación de un grupo no cambia los demás; la de
Gasolina siempre restaura el par. Conservar el release previo completo para
recuperar conjuntamente shell, catálogo de vistas y datos si falla una entrega
de código. Un rollback ensayado localmente no equivale a restaurar producción.

## 6. Fases: una entrega verificada y desplegada cada vez

El Builder trabaja **solo la fase indicada**, entrega su diff y comprobaciones,
y se detiene antes de construir la siguiente. No acumular implementación futura
detrás de flags para llamarla una entrega pequeña. Si una fase crece, el Líder
puede dividirla en subentregas completas con sus propios criterios y despliegue,
actualizando este mismo SPEC; no combinar fases para ahorrar publicaciones.

| Fase | Alcance visible al desplegar | Límite del cambio |
| --- | --- | --- |
| 0A | Gasolina idéntica | Catálogo y reglas/validación comunes |
| 0B | Gasolina idéntica | Estado, operaciones y presentación separados |
| 1A | Gasolina con su ruta canónica | Rutas, preferencia, 404 y recuperación compatible; datos sin cambios |
| 1B | Gasolina idéntica | Carga, caché y publicación por grupo; solo Gasolina activa |
| 2A | Gasolina sin cambios | Captura privada de Diésel y aislamiento |
| 2B | Gasolina + Diésel | Primer producto nuevo y selector de dos vistas |
| 3A | Gasolina + Diésel sin cambios funcionales | GLP privado, semilla v2 y aislamiento de fuentes |
| 3B | Se añade GLP | Grupo público y tercera vista |
| 4 | Se añade GNV | Producto comprimido y cuarta vista |

Son **nueve entregas de este alcance**, cada una con su despliegue y verificación,
no un único despliegue al terminar la tabla.
La Fase 1 se dividió en 1A y 1B porque navegación y datos son riesgos
independientes. GLP y GNV tienen entregas separadas para acotar revisión y
recuperación.

### Fase 0A — Catálogo y reglas comunes sin cambio de contrato

Centralizar metadatos repetidos y extraer únicamente reglas ya compartidas.
Reutilizar `buildGasolinaProducts`, selección de fuente, frescura, identidad y
geografía existentes. Conservar adaptadores legacy, rutas, CLI y contrato 2.7.0.
No añadir productos publicables ni cambiar el formato de los bundles.

Criterios de éxito:

- Con los mismos inputs locales, identidad, capa Facilito y reloj fijo, la
  proyección anterior y la nueva producen los mismos bytes de snapshots y
  manifest. No esconder diferencias cambiando orden, fechas o versión de contrato.
- Mantener rechazo de datos inválidos en productor y navegador y la política
  de elección/vencimiento de ambas fuentes.
- Gasolina conserva cobertura, IDs, identidad y unidades. Pasan auditoría y
  verificación aplicables; el shell sigue teniendo precaché derivada.
- Tras deploy, producción sirve el código nuevo con Gasolina válida; confirmar
  precios, detalle y copia guardada. No exigir que los precios de producción
  coincidan con un fixture viejo si el cron avanzó: comparar la revisión efectiva.

### Fase 0B — Separación de la UI sin rediseño

Separar estado explícito y consulta de la manipulación del DOM, los listeners y
las operaciones de ubicación/carga. Conservar HTML/CSS, comportamiento, rutas
y bundles públicos. Sin componentes caseros ni dependencias nuevas de UI.

Criterios de éxito:

- Los módulos de reglas funcionan sin navegador con datos y reloj dados; no
  leen DOM, almacenamiento ni estado global para calcular resultados.
- Recorridos de Gasolina equivalentes: inicio, GPS/fallo de permiso, distritos,
  radio, ambos órdenes, Regular/Premium, tarjetas mudas, detalle e histórico.
- Cabecera, foco y scroll mantienen comportamiento a 320/390 px. No duplicar
  listeners ni peticiones tras cambiar de pantalla o reintentar.
- Actualización desde una instalación anterior y lectura offline de datos
  guardados pasan. Tras deploy, comprobar ambos recorridos principales y el
  histórico existentes. La equivalencia es el resultado, no solo que cargue la página.

### Fase 1A — Rutas y preferencia, con los datos sin cambios

Introducir el catálogo de vistas y una sola tabla de rutas que resuelvan igual
el navegador, el service worker, el servidor local y el hosting. Guardar la
preferencia de vista de forma tolerante a fallos. Gasolina es la única vista
activa y sus datos, su carga y su caché no cambian. Sin selector de una opción.

Criterios de éxito:

- `/combustibles/gasolina` funciona por entrada directa, recarga e instalación
  existente. `/` y los enlaces antiguos tienen el comportamiento definido.
- Histórico canónico y enlace antiguo abren Gasolina. `/combustibles/diesel`,
  `/combustibles/glp`, `/combustibles/gnv` y rutas inventadas responden 404.
- La 404 también funciona sin conexión: para una navegación desconocida o a una
  vista inactiva, el service worker devuelve la página 404 guardada con estado
  404, nunca un error de conexión ni la portada.
- No aparece selector de una sola opción. Una preferencia desconocida no rompe
  la entrada. Browser, servidor local, hosting y SW resuelven las mismas rutas.
- La recuperación mantiene las URLs nuevas. Restaurar tal cual el deployment
  anterior rompería `/combustibles/gasolina` y los 301 que los navegadores ya
  guardaron, así que la recuperación de 1A se define, se prepara antes del
  deploy y se ensaya: vuelve al código anterior conservando las reglas que sirven
  las rutas nuevas. Comprobar la URL del deployment anterior no basta.
- Ensayar la transición desde el service worker actual con Gasolina guardada:
  actualizar el shell con red y después navegar sin red por la ruta canónica.
  Sin conexión para actualizar, la instalación anterior debe seguir funcionando.
- Tras deploy, verificar códigos HTTP, redirecciones, assets y funcionamiento
  offline de la ruta canónica ya visitada. El job debe haber desplegado realmente.

### Fase 1B — Carga, caché y publicación por grupo

Introducir los contratos de carga, publicación y caché por grupo. Mantener
Gasolina legacy como único grupo activo y no mover sus datos. Preparar las
interfaces necesarias para la siguiente fase, sin agregar conectores vacíos
para productos futuros. La orquestación del refresco y la proyección por grupo
queda para la Fase 2, que tendrá un segundo producto real con el que probarla.

Criterios de éxito:

- Carga coherente y fallback de Regular/Premium se comprueban con revisión
  cambiante y red ausente. La ruta `shell` funciona sin acceso a las fuentes.
- Recuperación del grupo completo: si llega un manifest nuevo y falla uno de sus
  snapshots, tras los reintentos se recupera entero el conjunto anterior
  validado. Nunca se combina Regular nuevo con Premium antiguo, ni se falla
  teniendo una copia completa utilizable.
- Primera carga durante la actualización: con el service worker anterior todavía
  activo, el cliente nuevo espera un controlador compatible o mantiene la
  compatibilidad de las peticiones durante la transición. Se prueba la primera
  carga tras el deploy, no solo después de varias recargas.
- Recuperación del release anterior está ensayada. Pruebas sintéticas pequeñas
  pueden comprobar aislamiento de grupos sin publicar productos ficticios.
- Ensayar la transición desde el service worker actual con Gasolina guardada:
  actualizar el shell con red y después consultar sin red. Conservar o migrar
  las entradas compatibles del caché anterior antes de limpiarlo. Sin conexión
  para actualizar, la instalación anterior debe seguir funcionando.
- Tras deploy, verificar grupos servidos, assets y funcionamiento offline de la
  ruta canónica ya visitada. El job debe haber desplegado realmente.

### Fase 2A — Captura privada de Diésel y aislamiento de Gasolina

Decisión del Líder (24/09/2026): dividir Fase 2 en **dos entregas con despliegue
propio**. 2A permite comprobar la adquisición desde el runner antes de publicar
Diésel; 2B incorpora el grupo público y su navegación. La base auditada de 2A es
`6483256`, con el arreglo del service worker ya integrado.

En 2A, consultar Diésel después de Gasolina en una pasada independiente. Conservar
un expediente privado, pero contar y comparar únicamente los productos propios
de cada grupo. No activar Diésel en el catálogo público, generar su bundle ni
modificar `web/`: Gasolina sigue siendo la única vista y `/combustibles/diesel`
sigue respondiendo 404. No cambiar el cron ni incorporar GLP/GNV.

Criterios para autorizar el despliegue de 2A:

- Códigos de captura fijos y etiqueta elegida comprobada en cada unidad:
  `126` Gasohol Regular, `127` Gasohol Premium y `40` «DB5 S-50 UV».
  Aceptar solo tablas completas con la cabecera de soles por galón. La lectura
  acotada de San Luis y Ate acredita el formulario, no el vínculo oficial ni
  la cobertura publicable de Diésel: esas comprobaciones corresponden a 2B.
- Gasolina conserva su primera pasada y su presupuesto de 20 min; Diésel tiene
  una segunda de hasta 10 min. Un fallo de tabla o de etiqueta queda en su
  unidad; un bloqueo explícito detiene toda adquisición restante. No aumentar
  reintentos ni esquivar el bloqueo cambiando de producto.
- Con inputs y reloj fijos, añadir consultas Diésel más recientes no altera el
  manifest, snapshots, refresh-state, métricas ni vínculos de Gasolina. Su
  disponibilidad de capa, conteos, `state_id` y unidades observadas solo usan
  Regular/Premium; conservar compatibilidad con el expediente anterior.
- El preflight sigue rechazando una unidad propia ausente o más antigua, incluso
  con CSV nuevo; ignora claves ajenas que hubiera arrastrado un código anterior.
  Un expediente compartido no debe impedir recuperar ni volver a desplegar 2A.
- Logs por producto y pasada muestran conteos, duración y fallos, sin filas ni
  identidad privada. `--products` permite limitar una comprobación; la muestra
  existente de Gasolina sigue consultando únicamente Regular/Premium.
- Pruebas pertinentes, auditoría y verificación pasan en el árbol exclusivo de
  la entrega. Se incluye la corrección de reloj de las pruebas de publicación.
  La huella del shell permanece `masfacil-shell-68a8793818ea` respecto a esta
  base, derivada normalmente, sin fijarla a mano. La ruta del release es
  `project`; no se exige congelar los datos públicos mientras el cron avanza.

Cierre operativo de 2A, **después del despliegue y antes de empezar 2B**:

- Ejecutar una corrida `facilito_only` y observar dos corridas consecutivas del
  cron. La corrida manual requiere autorización de Bruno; observar el cron
  existente no cambia su autorización ni su frecuencia.
- Acreditar desde el runner la pasada completa de Diésel: el catálogo actual
  contiene 43 distritos, con una unidad aceptada por distrito, incluido cero
  filas cuando la tabla lo confirma. Medir su duración real dentro del
  presupuesto; no extrapolar la sonda de dos distritos como resultado de CI.
- En las corridas observadas, Gasolina conserva sus unidades esperadas y no
  presenta pérdidas ni aumento de duración atribuibles a la pasada nueva.
  No debe aparecer un bloqueo por la carga añadida. Ante una incidencia,
  explicar y resolver la causa y repetir la observación afectada antes de 2B.
- Comprobar que Gasolina sigue funcionando en producción, que el shell no cambió
  y que su refresh-state solo contiene claves Regular/Premium. Si una corrida
  decide `no_op`, comprobar además el estado preparado en privado: no forzar un
  deploy de precios para obtener evidencia.
- Conservar el deployment previo y el revert del alcance como recuperación.
  El revert conserva los expedientes privados; no borrar capturas para conseguir
  un preflight favorable. Si el código anterior publica conteos mezclados,
  reponer el filtro de 2A antes de considerar esa operación normalizada.

El GO de código permite solicitar la publicación; no declara ya comprobados el
runner, el presupuesto real ni el efecto de las consultas adicionales.

### Fase 2B — Diésel público y primer selector real

Acreditar `Diesel B5 S-50 UV` desde líquidos y su correspondiente producto en
Facilito. Mantener revisión y guardrails de Gasolina independientes. Publicar el
grupo nuevo y activar su ruta/selector en la misma entrega completa, una vez
cerrada 2A. La captura privada por sí sola no autoriza mostrar sus precios.

Criterios de éxito:

- Embudo y pérdidas explicados; precios positivos/finitos en galones, Registro
  y GIS únicos. Las otras variedades de diésel no se incorporan por alias.
- Tabla y vínculo Facilito nuevos comprobados con el método existente y una
  captura real desde el runner, sin confundir hora de consulta con reporte.
- El grupo cumple validación en proyección y navegador; CSV, Facilito, vencimiento
  y ausencia de precio siguen la misma política. Un fallo del nuevo grupo no
  borra ni retrocede Gasolina.
- Selector Gasolina/Diésel en inicio y controles; una tarjeta diésel de un precio;
  URL manda sobre preferencia; contexto y radio se conservan al cambiar; un
  resultado tardío de Gasolina no aparece como Diésel.
- Comprobar `/` sin preferencia, con preferencia válida e inválida; una URL
  específica con preferencia distinta; recarga y `popstate`. Vista, selector y
  grupo de datos deben coincidir en todos los casos.
- Comprobar el cambio de combustible desde GPS y desde distrito por separado:
  GPS conserva coordenada, radio y orden; distrito conserva distrito y orden
  por precio, sin introducir distancia ni radio. Sin ofertas, se conserva ese
  contexto y se muestra el vacío correspondiente.
- La ruta `shell` preserva ambos grupos; preflight detecta retroceso en cualquiera;
  rollback selectivo conserva el grupo no seleccionado. Ensayar sin mutar producción.
- Tras deploy, comprobar `/combustibles/diesel`, precio/unidad/fuente contra el
  bundle servido, Gasolina intacta y copia offline de ambas vistas visitadas.
  GLP y GNV siguen sin aparecer ni tener rutas habilitadas.

### Fase 3A — GLP privado, semilla v2 y fuentes independientes

Bruno aprobó dividir Fase 3 en dos entregas e incluir desde ahora los gasocentros
puros. La base es `c1701db`, con Gasolina y Diésel ya publicados. 3A prepara y
verifica GLP en privado; 3B lo activa. El deploy de 3A usa la ruta `project`:
sí hay publicación técnica, aunque no se activa una vista nueva ni cambia el shell.

Criterios de éxito:

- Semilla v2 con actividad 15 y capa GIS 36, además de las existentes. Es una
  ampliación de la referencia del 14/08, no una actualización silenciosa del
  Registro/GIS. Restringirla a los filtros v1 reproduce exactamente la v1.
- Con inputs y reloj fijos, las variantes sin semilla, v2 y tablas materializadas
  conservan los bytes, métricas, exclusiones, vínculos y catálogo de Gasolina y
  Diésel. Cada grupo limita su referencia a sus actividades y capas propias.
- Adquirir el CSV GLP vigente y declarar el embudo por actividad, tipo de cliente,
  unidad y distrito. Solo `GLP - G` en galones para `Usuario Final`, con actividad
  automotora acreditada: 02/06 cruzan con capa 35; 15 con capa 36. Unir las dos
  etiquetas del código 15 antes de elegir el último reporte. No leer `MARCA` como
  identidad comercial. Las pérdidas por Registro antiguo quedan cuantificadas.
- Propagar ID4 por selección, desempate, duplicados y vínculo con el original;
  comprobar con un fixture que un acceso residual a ID3 no pase inadvertido.
- Detectar, adquirir, juzgar y promover por fuente. Sus validadores, raw,
  minimizado y pointers no se cruzan. GLP tiene base auditada y estado privado
  propio; sin base aprobada no se promueve. Un rechazo o timeout de GLP permite
  continuar con líquidos y viceversa. La primera activación y la recuperación
  rechazan snapshots de otra fuente antes de mover pointers.
- Sonda Facilito acotada a 1–2 distritos y tres cargas como máximo. Comprobar
  actividad automotora, galón, identidad textual y total; detener ante bloqueo.
  Si es viable, capturar en una pasada propia después de Diésel. Si no, aplicar
  la excepción CSV indicada en §5. Nunca trasladar consultas entre productos.
- La restauración de caché de la era v1 se ensaya con la semilla v2; todo estado
  restaurado sigue sujeto a validación y preflight. La sustitución del secret y
  el push requieren autorización de release y respaldo privado exacto de v1.
- **Condición de la poda:** conservar los snapshots activos, los de fuente,
  los que respaldan la producción vigente y un destino explícito de rollback
  por grupo, con todas sus dependencias y dueños de raws enlazados. Un pointer
  privado avanzado no prueba que el deploy haya terminado. Ensayar preparación
  nueva → poda → fallo de deploy → rollback, sin descargar ni perder los bytes
  previos. No borrar si falta o es incoherente una referencia protegida; una
  imposibilidad de limpiar debe conservar los datos y quedar informada.
- Auditoría, verificación, paridad de contratos y pruebas pertinentes pasan en
  el árbol exclusivo. Actualizar el mapa de arquitectura y registrar su revisión.

Después del deploy, verificar Gasolina/Diésel, el shell y las 404 de GLP. Observar
dos cron antes de 3B: promoción privada válida, consultas y tiempos por producto,
aislamiento de fuentes y tamaño real de la caché. Probar `unchanged` cuando los
validadores no cambien; no exigirlo si llega otro CSV. Un `needs_review` no cierra
3A para activar GLP. La reducción del total de caché se mide, no se promete en
un plazo fijo.

### Fase 3B — GLP automotor público y selector de tres vistas

Incorporar GLP vigente mediante el catálogo y mecanismo de adquisición reutilizable,
con su propio estado de fuente, después de cerrar 3A. Acreditar actividad
automotora y unidad; acreditar la capa Facilito si se incorpora, o declarar el
modo solo CSV aprobado en §5. No usar marca de envasadora como identidad del grifo.

Criterios de éxito:

- Se admiten únicamente filas automotoras acreditadas `GLP - G` en galones.
  Casos de cilindros y del mismo nombre con kilogramos son rechazados explícitamente.
- Cruces oficiales, embudo y capa Facilito, cuando se publique, cumplen los criterios de producto nuevo;
  los cortes propios no heredan la fecha de líquidos.
- Simular GLP fallido mientras líquidos/Facilito de otros grupos avanzan, y el
  caso inverso: cada uno conserva o actualiza solo su estado válido. No se pierde
  ningún grupo al publicar el árbol completo.
- `/combustibles/glp`, selector de tres vistas, tarjeta/unidad y vacíos por radio
  o distrito funcionan. Cambiar desde Gasolina no limita GLP a sus establecimientos.
- Tras deploy, verificar GLP y conservación de Gasolina/Diésel, actualización del
  cliente instalado y offline de la vista visitada. GNV permanece inactivo.

### Fase 4 — GNV comprimido

Incorporar el producto comprimido de líquidos con sus actividades y cruces
oficiales propios; no asumir el universo de gasolina. Acreditar su tabla Facilito.

Criterios de éxito:

- Solo se admite `GAS NATURAL VEHICULAR COMPRIMIDO` en Metros Cúbicos. GNV
  licuefactado y anomalías en galones/kilogramos quedan fuera con motivo registrado.
- Embudo, identidad, vínculo y selección de fuentes pasan. Reutilizar una
  adquisición de líquidos para los productos que corresponda, sin duplicar descargas.
- `/combustibles/gnv` y el selector completo de cuatro vistas funcionan; precio
  en S/ por m³ y cero comparaciones numéricas contra precios por galón.
- Se conserva el contexto al recorrer las cuatro vistas. Preferencia al reabrir,
  URL específica, vacíos, fallback y publicación/rollback por grupo pasan.
- Tras deploy, comprobar el producto contra su bundle servido y una regresión
  acotada de las tres vistas previas. El mockup aprobado queda realizado para
  búsqueda y resultados con las exclusiones de histórico indicadas.

## 7. Puerta de salida de cada fase

1. **Builder:** presenta diff exclusivo de la fase, comprobaciones y resultado,
   limitaciones y destino de rollback. Sin otro documento de discovery o handoff.
2. **Verificación:** `npm run audit`, `npm run verify:web` sobre un árbol completo
   coherente y comprobaciones puntuales de los riesgos cambiados. Ejecutar las
   pruebas existentes relevantes; contraste si cambia CSS. No crear una suite
   ceremonial ni usar solo que el proceso terminó como prueba de equivalencia.
3. **Líder:** sondas económicas con preguntas verificables sobre el diff; emite
   GO/FIX/KILL. Con FIX se corrige y revisa lo afectado, sin reiniciar todo el ciclo.
4. **Bruno:** con GO, autoriza una vez commit, push y deploy del alcance concreto.
   La aceptación del SPEC y la exigencia de entregas incrementales no sustituyen
   esa autorización. El cron previamente autorizado sigue automático.
5. **Ejecutor:** comprueba que el diff sigue siendo el auditado y usa el destino
   y credenciales ya configurados. Espera la finalización del deploy y verifica
   producción: revisión de shell/bytes servidos, bundles coherentes, rutas nuevas,
   ruta previa y PWA. Una corrida verde con `deploy=false` no cierra la fase.
6. **Cierre:** comunicar resultado y evidencia breve por chat. Solo entonces se
   pasa a la siguiente fase. Ante un fallo, conservar o recuperar el último
   deployment válido conforme al alcance autorizado; no continuar acumulando cambios.

La actualización automática de precios puede avanzar durante la revisión. Las
comparaciones de equivalencia usan inputs y reloj fijos en privado; la verificación
de producción usa la revisión realmente desplegada y respeta el preflight de
concurrencia. No congelar el cron para conseguir una comparación cómoda.

Actualizar documentación viva solo en la fase que cambie operación o producto.
El prototipo y este SPEC pueden acompañar al encargo versionado cuando se autorice;
el prototipo permanece fuera de `web/` y debe clasificarse como material de diseño,
sin provocar adquisición/proyección por sí solo. No incluir raw, métricas con
identidad privada ni artefactos generados en el commit.

## 8. Después de este SPEC

React/Vite/Tailwind tendrá un alcance posterior, una vez desplegadas estas fases.
Reutilizará catálogo, consulta, carga, rutas y política de datos; reemplazará la
presentación por partes. Su compilación, assets y adaptación de precaché se
resolverán entonces. Este SPEC no promete una migración visual automática ni
autoriza introducir dependencias de UI anticipadamente.

## 9. Auditoría de cierre — 26/09/2026

Base publicada: `7568619`. Veredicto: **GO funcional; FIX de cierre**. No se
requiere rollback de producción ni repetir la implementación por fases.

Evidencia comprobada por el Líder:

- `verify:web --origin https://masfacil.pe` sobre una copia aislada con los
  bundles públicos: cuatro grupos válidos, rutas y archivos publicados iguales
  al código; shell `masfacil-shell-3eb69b8e71bb`.
- Cron automático [36277463835](https://github.com/bdiazc90/masfacil.pe/actions/runs/36277463835):
  215 unidades aceptadas, 43 por producto, ninguna fallida; ambas fuentes CSV
  sin cambios ni descarga, actualización de Facilito y deploy real. Poda sin
  avisos, con producción y rollback protegidos para los cuatro grupos.
- Auditoría de `HEAD` e historial: 160 archivos, ningún hallazgo. Contraste pasa.
- Sonda móvil de cuatro vistas a 320/390 px: rutas, preferencias, contexto GPS
  y distrito, radio elegido, cargas tardías, vacíos y foco pasan. Comprobación
  adicional en producción del cambio entre las cuatro vistas por distrito.
- Transición de 3B a Fase 4 con caché HTTP emulada: shell fresco, datos conservados
  y arranque de Gasolina/GNV sin red tras cerrar Chrome y apagar el servidor.
  Estas sondas de navegador no equivalen a probar un teléfono físico.

Pendientes acotados, antes de marcar este SPEC cerrado:

1. **Aislar dos pruebas de primera activación.** En el workspace pasan 192/192,
   pero el commit publicado, en una copia con los cuatro bundles públicos,
   pasa 189/191. Fallan las expectativas `production.glp === null` y
   `production.gnv === null` en `test/glp-group.test.mjs` y
   `test/gnv-group.test.mjs`: simulan ausencia de publicación, pero dejan que
   `produccionPublicada` consulte archivos del directorio real. Las pruebas
   pasan al retirar esos estados públicos en la copia temporal. Usar raíces
   temporales explícitas o una dependencia de lectura coherente, sin eliminar
   datos reales ni relajar la protección de producción. Comprobar con y sin
   bundles locales; no hace falta repetir toda la auditoría del producto.
2. **Actualizar el mapa de arquitectura.** `docs/arquitectura/modelo.json`
   todavía describe principalmente el par Regular/Premium. Reflejar cuatro
   grupos, dos fuentes, semilla v3, recuperación por grupo y poda protectora;
   actualizar referencias y registrar la revisión según `AGENTS.md`. El mapa
   está sin seguimiento y comparte cambios locales ajenos: no incluirlos ni
   sellarlos como revisados por comodidad. `check` detecta 50 entradas pendientes,
   lo que no significa 50 defectos de producción.

La corrección de estas pruebas y del mapa no requiere por sí misma un nuevo
despliegue de la aplicación. Su commit/publicación, si se solicita, conserva las
reglas de autorización y separación de cambios ajenos.

### Reauditoría de los fixes — 27/09/2026

**GO de cierre.** Las dos pruebas usan ahora raíces temporales explícitas en
todas sus llamadas a `prepareRelease`; las 21 comprobaciones de GLP/GNV pasan.
El mapa refleja los cuatro grupos, dos fuentes, semilla v3, recuperación por
grupo y poda protectora, con referencias válidas y revisión registrada sobre
`7568619`. La huella del modelo coincide con la revisión.

`check` mantiene cuatro avisos correspondientes al trabajo local ajeno:
los workflows de arquitectura/refresco, `AGENTS.md` y `app/route-policy.mjs`.
Las huellas revisadas de los tres archivos versionados coinciden con `HEAD`;
no se sellaron sus modificaciones locales ni el nuevo workflow por comodidad.
Esos avisos quedan en su propio alcance y no impiden cerrar Combustibles.
Este cierre no hace commit ni autoriza publicar los cambios locales.

## 10. Decisiones cerradas de gasolina

Trasladadas de `DESIGN.md` §12 el 05/10/2026: siguen vigentes.

Primera ruta. Reabrir cualquiera exige un hallazgo material medido, no una
opinión. Las cifras que las justificaron se midieron sobre bundles concretos y no
se copian aquí: envejecen y el motivo no.

| Decisión | Por qué |
|---|---|
| Cada vista vive en `/combustibles/<vista>` —hoy Gasolina, Diésel, GLP y GNV— y `/` abre la última vista recordada, sin pantalla de elegir producto. `/combustibles/gasolina/historial` reescribe a la misma portada con el gráfico del histórico enfocado; los enlaces viejos (`/gasolina`, `/gasolina/regular`, `/gasolina/premium`, `/gasolina/historial`) y la barra final responden 301 a su ruta canónica; una vista no activada o cualquier otra ruta responde 404 con una página mínima, también sin conexión. Navegador, service worker, servidor local y `_redirects` usan una sola tabla (`web/lib/routes.js`) | los dos bundles son idénticos salvo precio y fecha: elegir producto antes de ver nada era un tap sin información; el historial es contexto de la portada, no otra pantalla, y su URL existe solo para poder enlazarlo; una dirección que no existe no debe fingir ser la app: un enlace roto se ve, no se disimula; y si cada capa resolviera las rutas por su cuenta, un enlace funcionaría en un sitio y no en otro |
| Una tarjeta por grifo con Regular y Premium; «—» cuando falta uno | la gran mayoría de los grifos reporta los dos productos a la vez, y se decide comparándolos frente al surtidor |
| Radio de búsqueda de 1 a 5 km en pasos de 0.5; arranca en el menor que llena seis tarjetas | en Lima urbana cae en 1–1.5 km y en zonas dispersas sube solo. Un pool fijo mandaba a kilómetros de distancia por céntimos |
| «Más cerca» y «Más barata» solo ordenan; el sub-selector fija el producto de «Más barata» y recuerda la elección | cada control hace una cosa; en «Más cerca» el producto no ordena nada y el sub-selector se oculta |
| Etiqueta «Regular más barata en 1.5 km» sobre la más barata del radio; doble cuando también es la más cercana | sin decirlo, la interfaz inventaría un contraste que no existe |
| Paginación que duplica: 6 → 12 → 24 → todo; si quedan ≤ 4, se muestran sin botón | un distrito grande a 5 km son más de cien estaciones: pocos toques en vez de decenas |
| Card de controles fijo con tres estados en vez de un header pegajoso alto | el header fijo ocupaba un cuarto de la pantalla; la fila compacta conserva lugar, radio y criterio |
| Con más de un combustible, la fila compacta va en dos renglones: arriba el combustible y el lugar —radio o distrito, lo único que puede truncarse—, abajo el criterio entero. A 360 px o menos la píldora de la barra queda en icono | en un solo renglón, combustible, radio y criterio no cabían junto a «Ajustar» ni a 390 px; un criterio montado sobre el botón no se lee |
| Selector de combustible —Gasolina, Diésel, GLP, GNV— en Inicio y en «Ajustar», en una sola fila que cabe a 320 px, el mismo control segmentado que el orden; solo aparece con dos o más vistas activas y viene oculto en el HTML | elegir combustible no pide ubicación ni abre otra pantalla; un selector de una sola opción sería un control que no hace nada, y el `app.js` anterior al selector no sabe pintarlo |
| Cambiar de combustible conserva origen o distrito, el radio y el orden que la persona eligió; vuelve a la primera página. Un radio que nadie tocó se recalcula con los precios de la vista nueva. Mientras la vista nueva carga no se muestra ningún precio; un distrito sin grifos de ese combustible lo dice y ofrece cambiarlo; sin ninguna estación a 5 km, el vacío no pide ampliar el radio | el contexto es de la persona, no del combustible; un radio automático de Gasolina dejaría vacía la de GLP, que tiene muchas menos estaciones; un precio de la vista anterior bajo la etiqueta nueva sería falso, y cambiar el distrito o el radio elegido por su cuenta también |
| La tarjeta de Diésel lleva un solo precio con su nombre preciso (`B5 S-50 UV`, «Diésel B5 S-50 UV» para lectores) y «por galón» junto a la cifra; la de GLP, igual (`GLP`, «GLP automotor» para lectores); la de GNV dice «por m³» (`GNV`, «GNV comprimido» para lectores); la de Gasolina no cambia | fuera de Gasolina la unidad no se da por supuesta, y GNV se vende por metro cúbico: su precio nunca se compara con uno por galón; el nombre del CSV distingue esta variedad de las otras que el mismo grifo reporta, en GLP del mismo gas en kilogramos o en cilindros y en GNV del licuefactado |
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
