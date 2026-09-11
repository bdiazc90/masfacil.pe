# Histórico de precios y gráfico de portada

Encargo para el Builder · 9 de septiembre de 2026 · enmendado el 10 de septiembre
de 2026 (ver «Enmiendas» al final).

## 1. Resultado acordado con Bruno

Conservar snapshots públicos en Neon Object Storage, un almacén S3 sin tarjeta,
y mostrar en la pantalla inicial dos líneas: promedio diario de Gasohol Regular
y de Premium en Lima provincia. Eje X: días, desde hoy menos 29 hasta hoy por
defecto. Selectores 7/14/30 días. Eje Y: soles por galón, con rango dinámico
compartido por ambas líneas. «Ver historial» es la entrada a este gráfico (§8).

Cada punto representa el promedio de precios mostrables en ese día; no es una
media móvil ni el promedio de todos los reportes recibidos durante el día.
Cada estación pesa lo mismo. No depende de GPS, distrito elegido ni marca.

Este SPEC incluye persistencia, cálculo y UI. No autoriza por sí solo crear
credenciales, habilitar acceso público, modificar DNS, hacer push o desplegar:
la configuración externa y el release requieren autorización del Owner.

## 2. Convivencia con las simplificaciones 1 y 2

Claude está planificando el entorno de contribución y el contrato compartido.
Este cambio debe aprovecharlos, no implementar versiones alternativas:

- Reutilizar el contrato público compartido resultante del punto 2. No crear
  una tercera copia de las reglas de ofertas. El pequeño formato histórico sí
  tiene su propio validador, compartido entre productor y navegador.
- Integrar fixtures históricos sintéticos al modo demo y los casos acotados al
  comando de comprobación del punto 1. Ningún colaborador necesita Neon ni secretos.
- Se pueden preparar módulos independientes mientras aquellos cambios avanzan.
  Integrar después sobre su resultado; coordinar los cambios a `package.json`,
  entrada del cliente, estilos y caché. No sobrescribir trabajo del otro agente.
- No reabrir SPEC-CLEAN ni SPEC-OPT ni introducir framework, base de datos,
  backend, autenticación o plataforma ETL.
- Un SPEC y un resumen final por chat son suficientes. No producir otro SPEC,
  documento de discovery o ceremonia de aceptación para implementar este.

Las simplificaciones 3, 4 y 5 ya están en `main@41d0c3c` y se parte de ahí: la
precache y su versión se derivan del contenido (`pipeline/shell-manifest.mjs`),
hay un solo camino de datos y la preparación es un módulo (`prepareRelease`).

## 3. Decisiones técnicas para esta entrega

Mantener el histórico fuera del camino crítico del deploy de precios:

```text
Bundle que YA sirve producción
    → observador programado: descarga pequeña + validación
    → almacén S3: snapshots inmutables + observaciones fechadas
    → almacén S3: resumen estático de los últimos 30 días
    → portada: una petición pequeña al bucket público → dos líneas SVG
```

El navegador consulta únicamente el resumen, no los snapshots completos. Para
evitar redeploys de toda la PWA cada vez que cambia el resumen, el bucket lo
sirve como JSON estático desde su propia URL pública. No hay Worker, proxy ni
endpoint dinámico: ningún código corre entre la app y el archivo.

Proveedor: **Neon Object Storage** (beta, S3), en un proyecto de Neon dedicado,
bucket público `masfacil-datos`. Motivo: es el único almacén S3 verificado que
no exige tarjeta ni para el plan gratuito ni para un bucket público; Cloudflare
R2 exige medio de pago y Backblaze B2 cobra un dólar de verificación por
bucket público. Al exceder la cuota Neon suspende, no cobra. El código habla S3
y no conoce al proveedor: endpoint, región, bucket y prefijo son variables (§7),
y cambiar de proveedor es cambiar variables y una constante de origen.

Origen público: la URL de la rama del bucket, con la forma
`https://br-<rama>.storage.c-<N>.us-east-2.aws.neon.tech`. Es un valor público,
va como constante en el cliente y en `connect-src`, y no es un subdominio
propio: Neon no ofrece dominio propio y ponerle Cloudflare delante exigiría un
Worker, descartado. `datos.masfacil.pe` queda reservado para cuando un
proveedor lo permita sin backend; entonces cambia la constante y se publica un
release de shell. Un solo bucket para todos los utilitarios futuros; cada uno
bajo su prefijo, el histórico bajo `gasolina/`.

Neon no pone CDN delante. Sí sirve los buckets públicos con CORS abierto de
lectura (`Access-Control-Allow-Origin: *`, `GET`, preflight respondido),
comprobado el 10 de septiembre contra el bucket real: no hay regla que escribir
ni comando que mantener. La frescura del resumen la garantiza la revalidación
del cliente (§8), no un TTL de borde.

El bucket solo contiene material apto para publicación: los JSON ya públicos y
los agregados descritos aquí. Habilitar la lectura pública es una operación
explícita del release, hecha por Bruno.

La caída de Neon, del observador o del gráfico nunca impide consultar
estaciones, actualizar GPS, publicar precios ni hacer rollback de la app.

## 4. Definición exacta de cada punto

### Reloj y selección diaria

- El calendario es `America/Lima`, también si el visitante está en otro huso.
  Guardar instantes en ISO UTC y derivar la fecha local con una función probada.
- `observed_at` es cuando el observador obtuvo un bundle público completo y
  válido. No usar como fecha del punto `reported_at`, `snapshot_date`, la hora
  de una reproyección ni la fecha en que se ejecutó una importación histórica.
- Si hay varias observaciones válidas en un día, usar la última por
  `observed_at`, con desempate determinista por ID. No promediar observaciones.
- Hoy es provisional y puede cambiar con la siguiente observación. En días
  anteriores queda la última observación disponible, no un supuesto cierre
  exactamente a medianoche. Mostrar el concepto «al último corte de cada día».
- Observar también cuando la fuente no cambió: puede seguir publicado el mismo
  bundle mientras algunos precios superan los 30 días. Esto no fabrica datos:
  se vuelve a comprobar lo que la app podía mostrar en ese instante.

### Cálculo por producto

1. Validar manifest y ambos productos: misma revisión, hashes, bytes y contrato.
   No mezclar Regular de una revisión con Premium de otra.
2. Evaluar frescura con la regla compartida de la UI y un reloj inyectado igual
   a `observed_at`: edad entre 0 y 30 días, inclusivos. El instante no puede ser
   anterior al corte del snapshot. Los precios vencidos o futuros no participan.
3. Contar una sola vez cada `establishment_id` por producto. Duplicados exactos
   no aumentan el peso; duplicados contradictorios invalidan esa observación y
   se informan, sin afectar la publicación principal.
4. `mean = suma(precios elegibles) / n`. Calcular sin redondear cada sumando;
   persistir hasta cuatro decimales y mostrar dos. Regular y Premium tienen
   denominadores independientes. Sin precios elegibles: `mean: null, n: 0`.
5. Marca, logo y nombre no intervienen. No ponderar por número de reportes,
   ventas, distrito o popularidad; no aplicar recortes estadísticos nuevos.

Ejemplo: Regular 10 y 20 → S/ 15.00, n=2. Premium 15 y 25 → S/ 20.00, n=2.
Repetir una descarga o un reporte de la primera estación no altera la media.

Este indicador describe las estaciones participantes, no un índice de precios
de población fija ni una garantía de precio en surtidor. El cambio del promedio
también puede deberse a entradas/salidas de estaciones. La fuente se publica
los martes: entre martes y martes la media se mueve por estaciones que entran
o salen de la ventana de 30 días, no por precios nuevos. Explicar ambas cosas
brevemente en «Cómo se calcula», mostrar `n` junto a cada media y conservarlo
para cada producto y día.

## 5. Archivo durable en el almacén S3

Organización orientativa; conservar estas responsabilidades, no necesariamente
estos nombres exactos:

```text
gasolina/bundles/<archive_hash>/manifest.json
gasolina/bundles/<archive_hash>/regular.json
gasolina/bundles/<archive_hash>/premium.json
gasolina/bundles/<archive_hash>/complete.json
gasolina/observations/AAAA-MM-DD/<observation_id>.json
gasolina/series/daily-v1.json
```

El prefijo `gasolina/` lo antepone el almacén, no quien lo usa: el resto del
código sigue hablando de `bundles/`, `observations/` y `series/`. La copia
local en `.local-cache/history/` refleja la misma disposición.

- Archivar los bytes originales del bundle público. `archive_hash` identifica
  el contenido completo, incluyendo el manifest; no depende solo de un nombre
  de revisión ni de la hora de ejecución. Un mismo contenido se guarda una vez.
- Subir primero ambos productos y manifest; escribir `complete.json` al final,
  con revisión, versión, rutas internas, hashes y tamaños. Solo un archivo
  completo y verificado puede respaldar una observación.
- Los objetos de archivo y las observaciones son inmutables: repetir los mismos
  bytes es idempotente; encontrar bytes distintos bajo la misma clave es error.
  No sobrescribir silenciosamente ni borrar el objeto en conflicto. Neon no
  documenta el PUT condicional (`If-None-Match: *`), así que «escribir si no
  estaba» es HEAD y después PUT; la carrera entre ambos la cierra el escritor
  único serializado de §7, no el proveedor. La huella se guarda como metadato
  `x-amz-meta-sha256` y, si el proveedor no lo devuelve, se compara el hash del
  cuerpo leído; nunca el ETag. No hay versionado en el proveedor: la única red
  de seguridad es que la interfaz del almacén no tiene `delete` y que la llave
  del observador es la única con escritura.
- Cada observación conserva ID estable, fecha local, `observed_at`, revisión,
  referencia al archivo completo, corte del bundle, fecha máxima de la fuente,
  versión del método y `{mean, n}` por producto. Un retry de una operación ya
  completada no crea otra observación ni cambia su instante original.
- Retener snapshots y observaciones sin borrado automático en esta entrega.
  La ventana de 30 días limita la descarga de la UI, no lo que se conserva.
  No guardar raws, seeds, expedientes comerciales, secretos ni volcados privados.
- No usar Git, GitHub Actions cache o artefactos temporales como archivo durable.
  Las copias de trabajo viven en `.local-cache/history/`, ignorada por Git.

El resumen mutable es reconstruible desde las observaciones y se reemplaza en
una sola escritura al terminar. Un único escritor CI serializado genera los
resúmenes; todos los modos con escritura, incluidos importación/reparación,
usan ese mismo camino. Una ejecución atrasada no puede hacer retroceder la
serie ni perder observaciones que otra ejecución ya guardó.

Para reconstruir la ventana, listar observaciones por prefijos de fechas y
resolver paginación. No recorrer todos los snapshots de todos los años ni
volver a descargar sus cuerpos: los agregados ya están en las observaciones.

## 6. Contrato del resumen para la UI

Formato JSON pequeño, versionado e independiente del manifest de precios:

- Cabecera: `schema_version`, `method_version`, `timezone`, `scope` LIMA/LIMA,
  `currency: PEN`, unidad de galón, `generated_at` y `days`.
- Hasta 30 fechas consecutivas, ordenadas y sin duplicados, terminando en el día
  local de generación. Cada fecha contiene la última observación y sus datos
  por producto, o `observation: null` si ese día no se logró observar.
- La observación incluye los campos de trazabilidad de §5; la UI necesita al
  menos hora, corte, revisión y los dos pares `{mean, n}`.
- `observation: null` distingue una ausencia de captura de una captura válida
  cuyo producto tenga `mean: null, n: 0`. Ninguno se representa como precio cero.
- Validar estructura, fechas reales, orden, alcance, unidades, números finitos
  y positivos, enteros de conteo, coherencia null/0 y límites de tamaño.
- Rechazar versiones desconocidas y resúmenes corruptos sin romper la app.
  No duplicar dentro de este formato las ofertas ni el expediente comercial.

La UI vuelve a encuadrar la ventana respecto a hoy en Lima: si el resumen quedó
viejo, los días posteriores son huecos, no puntos repetidos. La antigüedad se
calcula desde la última observación, no desde la regeneración del JSON.

## 7. Captura y publicación independientes

Añadir un workflow pequeño de histórico, sin cola compartida con Pages:

- Cuatro observaciones programadas al día, por ejemplo `37 2,8,14,20 * * *`
  en UTC; además, ejecución manual y tras concluir con éxito el workflow de
  producción en `main`. La programación no garantiza horas exactas.
- El disparo posterior no prueba por sí solo que hubo deploy: siempre descargar
  y validar lo que realmente sirve el origen canónico. No archivar candidatos
  locales ni artefactos de una corrida abortada como si hubieran sido públicos.
- El disparo desde otro workflow solo admite el repositorio propio y su flujo
  de producción en `main`, nunca PRs/forks. Ejecutar código confiable de `main`;
  no consumir checkout ni artefactos controlados por un PR con credenciales.
- Obtener el bundle sin caché intermedia. Si cambia durante la lectura y faltan
  archivos o hashes coincidentes, reintentar de forma acotada desde el manifest.
  Sin pareja válida, no generar observación.
- Reutilizar la validación/descarga existente detrás de una interface que reciba
  destino o devuelva bytes. No ejecutar `fetch:live` sobre el `web/data/` que otro
  agente esté usando ni descargar el raw de Osinergmin.
- Credenciales únicamente en el observador, en el environment
  `datos-production`, que es el del bucket compartido y no el de este
  workflow: una llave de Neon con scopes `storage:read` y `storage:write`
  sobre la rama del bucket, en un proyecto de Neon que no contiene nada más;
  Neon no acota llaves por bucket ni prefijo, así que el proyecto dedicado es
  el límite. Nunca en frontend, fixtures, logs o PRs. No asumir que el token
  Pages sirve. Variables, neutrales al proveedor y nombradas por el bucket:
  `DATOS_S3_ENDPOINT`, `DATOS_S3_REGION` y `DATOS_S3_BUCKET` como variables,
  y `DATOS_S3_ACCESS_KEY_ID` y `DATOS_S3_SECRET_ACCESS_KEY` como secretos. Un
  utilitario futuro (tipo de cambio, playas, elecciones…) usa el mismo
  environment y las mismas cinco, con su propio workflow, su propio grupo de
  concurrencia y su propio prefijo. Lo único de este utilitario es
  `HISTORY_S3_PREFIX`, opcional, con valor por defecto `gasolina/`.
  Direccionamiento path-style siempre (Neon no admite virtual-hosted) y firma
  SigV4 con la región real. Las cuatro `R2_*` se retiran. Sin las cinco
  obligatorias el almacén es local y lo dice; con solo algunas, error.
- CORS: la lectura pública del bucket ya responde con
  `Access-Control-Allow-Origin: *` y atiende el preflight; es lo que un JSON
  público necesita y no hay nada que configurar. La sonda remota lo comprueba
  en cada release, porque es una propiedad del proveedor y no del código.
- Timeout acotado de aproximadamente 3 minutos para este proceso pequeño y
  reintentos limitados. Un fallo queda visible como fallo del histórico, sin
  cambiar el último resumen válido ni disparar rollback del sitio principal.
- El siguiente intento repara escrituras parciales y reconstruye la serie desde
  lo que sí quedó confirmado. Si se pierde una captura sin evidencia conservada,
  se acepta el hueco; no se promete recuperación de datos que nunca se guardaron.
- Informar por chat/resumen: observación nueva/reutilizada, revisión archivada,
  fecha/hora, n por producto y resultado efectivo de escritura del resumen.

Servir JSON con Content-Type correcto, fijado al subir. Archivo inmutable:
caché larga; resumen: `max-age` de como máximo cinco minutos, sin `immutable`.
Sin CDN delante, esas cabeceras solo las ve el navegador, y no está documentado
que Neon las devuelva: por eso el cliente revalida siempre (§8) y la primera
corrida real comprueba qué cabeceras llegan (§10). Añadir solo el origen del
bucket a `connect-src` en `web/_headers`; no abrir toda la CSP. Mantener los
recursos JS/SVG en el sitio. Una URL pública no es un secreto; las credenciales
de escritura sí.

## 8. Gráfico en la pantalla inicial

- Dentro de `start-step`, después de las acciones principales. Título «Precio
  promedio en Lima» y unidad «S/ por galón». Subtítulo «Al último corte de cada
  día». No rediseñar portada, controles ni tarjetas de resultados.
- Selector 7 / 14 / 30 días; **30 por defecto**. Cambia la ventana, no el
  cálculo. Fechas reales en X, con «Hoy» donde corresponda; no mostrar
  literalmente t-29.
- Dos líneas SVG, sin suavizados que inventen máximos/mínimos. Mismo eje Y,
  dinámico según ambas series visibles, con margen legible y ticks claros.
  No necesita empezar en cero. Si todos los valores son iguales, usar un rango
  no nulo que permita verlos. No usar doble eje ni proyecciones a futuro.
- Regular y Premium se distinguen por etiqueta, color accesible y tipo de trazo
  o marcador. Mostrar promedio, `n` y hora al seleccionar una fecha con toque o
  teclado, y el `n` del último punto de cada producto siempre visible en la
  leyenda; no depender exclusivamente de hover. Añadir tabla accesible plegable.
- Conservar huecos en sus fechas reales y cortar las líneas al faltar puntos;
  no comprimir el calendario, interpolar ni arrastrar el último valor.
- Un único punto se muestra como punto y cifra, no como tendencia. Con pocos
  días: «Estamos construyendo el histórico: X días registrados». No esperar 30
  días para lanzar. Hoy lleva indicación «En curso» y hora de observación.
- Cargar en paralelo y sin bloquear precios/GPS. Reservar espacio para evitar
  saltos. Manejar carga, ausencia de historial, error y resumen desactualizado
  dentro de este módulo, sin mandar la app a `fatal-state`.
- Puede reutilizarse el último resumen validado guardado localmente, con fecha
  y aviso de copia guardada. No tratarlo como actualizado ni añadir puntos hoy.
- Mantener tema claro/oscuro, ancho de 360 px sin desborde, foco visible y botones
  táctiles de al menos 44 px. Reutilizar tokens actuales, sin librería de charts
  pesada para un máximo de 60 puntos.
- «Ver historial» es la entrada a este gráfico, no otra pantalla: el botón deja
  de estar deshabilitado, pierde la etiqueta «próximo» y lleva el foco al
  gráfico, tercer bloque de la portada tras «Ver mi ubicación» y «Ver
  distritos». Tiene ruta propia `/gasolina/historial`, servida por reescritura
  a `index.html` (línea `/gasolina/historial /index.html 200` en `web/_redirects`
  antes de los 301, reproducida en `scripts/serve-web.mjs`); `app.js` abre con
  el gráfico enfocado cuando `location.pathname` es esa ruta y usa `pushState`
  al pulsar el menú. Sin HTML nuevo ni entrada extra en la precache. Actualizar
  la fila correspondiente de DESIGN.md §12.
- La precache y su versión se derivan del contenido: los módulos nuevos bajo
  `web/*.js` y `web/lib/*.js` entran solos y no hay número que subir a mano. El
  JSON histórico vive en otro origen y no entra en la precache; `verify:web` lo
  exige. No convertirlo en un asset cache-first eterno.
- El resumen se pide con `fetch(url, { cache: 'no-cache' })`: el navegador
  revalida por ETag en cada carga y una respuesta 304 cuesta casi nada. Así la
  frescura no depende de que el proveedor devuelva `Cache-Control`. Sin
  cabeceras propias en la petición, para no provocar preflight.

## 9. Arranque, datos antiguos y coste

No hay evidencia local de 30 días continuos conservados. Empezar a observar en
cuanto esté habilitado el servicio, aunque la UI se integre después.

Solo importar días pasados si existe un bundle público validable y evidencia
del instante en que se observó. Una fecha dentro del raw o un snapshot privado
reproyectado hoy no demuestra lo que la app mostraba entonces. Sin esa
evidencia, no hay backfill automático ni bloqueo del lanzamiento: se lanza fino
y la serie crece desde el primer día observado. Queda fuera de esta entrega,
como encargo aparte y opcional, un paso separado de importación desde los
deployments de producción de Cloudflare Pages en `main`: `observed_at` = fecha
del deployment, `source: 'pages_deployment'`, mismo camino de escritura
serializado, procedencia conservada y nunca por encima de una observación real
del mismo día. Los snapshots se guardan completos para futuras comparaciones
por estación o distrito, pero esas vistas quedan fuera de este cambio.

Plan gratuito de Neon sin tarjeta: 5 GB de almacenamiento por proyecto y
5 GB de transferencia al mes, compartidos con lo demás del proyecto, que aquí
es nada. Como orden de magnitud, 0,5 MB por bundle único y cuatro bundles
nuevos por día son aproximadamente 0,73 GB al año, más metadatos: unos seis
años de tope; un resumen de 20 KB da más de 250 000 lecturas completas al mes,
y las revalidadas no cuentan. Es una estimación, no el consumo medido. Al
exceder, Neon suspende y no cobra ni borra; el observador falla visible. No
contratar plan, registrar tarjeta ni configurar borrado sin decisión de Bruno.

Riesgo asumido: Neon Object Storage está en beta y su documentación no lo
recomienda aún para producción; el host del bucket depende de la rama y no
está garantizado estable. Lo que protege: el archivo es una copia de lo que
producción ya sirvió, la app funciona igual sin él, el adaptador es S3 genérico
y exportar el bucket a otro proveedor es un `list` más `get` por clave. Un
cambio de host es una constante y un release de shell. Si Neon cierra el
producto o lo restringe, se migra; no se rediseña.

El Builder deja en el README solo la operación imprescindible: variables de
bucket/origen, credenciales necesarias sin valores, ejecución manual, diagnóstico
y cómo reconstruir el resumen. No crear un manual paralelo de arquitectura.

## 10. Comprobaciones proporcionales y entrega

Fixtures pequeñas, reloj inyectado y almacenamiento local/en memoria. Integrar
al camino del top-1, sin expediente real, raw gigante ni Neon para comprobar:

1. Medias conocidas, n distintos entre productos, identidad ausente y repetidos.
2. Edad exacta de 30 días, un instante posterior, fecha futura y cruce UTC/Lima.
3. Varias capturas del día: gana la última, no la media de medias. Bundle sin
   cambios en dos días: reevaluar edad con cada observación; no duplicar archivo.
4. Pareja mezclada/corrupta y duplicados contradictorios: no generan histórico;
   n=0, día sin captura y huecos se representan correctamente.
5. Retry idempotente, escritura parcial reparable y ejecución atrasada: no
   sobreescribir archivo, perder observaciones ni retroceder resumen.
6. Bucket/JSON ausente o inválido: búsqueda y precios siguen funcionando. Demo y
   comprobaciones no solicitan credenciales ni salen a la red.
7. Ventanas 7/14/30, eje Y compartido/constante, hoy provisional, huecos, tema
   oscuro, teclado, toque y 360 px. No gráfico suavizado ni media móvil.
8. Ruta `/gasolina/historial`: la reescritura sirve la portada con el gráfico
   enfocado, en local y en producción; los 301 de las rutas viejas siguen.
9. Adaptador S3 contra un doble en memoria que imite a Neon: path-style, sin
   PUT condicional, HEAD antes de PUT, huella por metadato o por cuerpo,
   prefijo antepuesto también en disco, listado con prefijo y paginación,
   endpoint y región variables, reintentos acotados y errores sin secretos.

Conservar auditoría de privacidad y verificación web; extenderlas solo donde
este cambio lo requiera. La sonda remota, ya autorizado el release, comprueba
archivo recuperable con hashes correctos, resumen servido desde el bucket con
`Content-Type` JSON, `Access-Control-Allow-Origin` para `https://masfacil.pe`
y CSP válidos, un `GET` con `If-None-Match` que devuelve 304, fecha/n/medias
coincidentes y portada funcional. La primera corrida manual del workflow contra
el bucket real es parte del release: PUT, HEAD, GET, LIST, PUT repetido y PUT
con bytes distintos deben comportarse como en la sonda local, y se anota qué
cabeceras (`Cache-Control`, `x-amz-meta-sha256`, `ETag`) devuelve Neon de
verdad. Un HTTP 200 o workflow verde por sí solo no demuestra ese resultado.

Entregar resumen corto: archivos/alcance, pruebas ejecutadas, limitaciones,
configuración externa pendiente y primer día realmente disponible. No incluir
cambios de top-1/top-2 ajenos por comodidad en el commit del histórico.

## Referencias de implementación

Puntos actuales del repo: `pipeline/gasolina-contract.mjs`,
`web/lib/freshness.js`, `scripts/fetch-live-bundle.mjs`, `web/index.html`,
`web/_headers` y `.github/workflows/refresh-pages.yml`. Sus rutas pueden cambiar
con top-1/top-2; buscar las interfaces resultantes, no restaurar copias antiguas.

Documentación oficial consultada el 10 de septiembre de 2026:

- [Neon Object Storage: overview y límites](https://neon.com/docs/storage/overview); [buckets y URL pública](https://neon.com/docs/storage/buckets).
- [Neon: compatibilidad S3](https://neon.com/docs/storage/s3-compatibility) (path-style, SigV4, CORS, sin versionado); [autenticación y scopes](https://neon.com/docs/storage/authentication).
- [Neon: planes y cuotas del plan gratuito](https://neon.com/docs/introduction/plans); [estado beta](https://neon.com/docs/get-started/backend-beta).
- Descartados el 10 de septiembre: R2 exige medio de pago para su capa gratuita ([facturación](https://developers.cloudflare.com/billing/understand/billing-policy/)); B2 cobra un dólar de verificación por bucket público; Tebi cerró el 31 de marzo de 2026.

## Enmiendas del 10 de septiembre de 2026

Decisiones de Bruno tras el grill del 9 de septiembre y el cambio de proveedor.
La implementación entregada contra la versión anterior sigue valiendo salvo en
estos puntos, que son el FIX pendiente del Builder:

1. **Proveedor y origen** (§1, §3, §7, §9): Neon Object Storage en vez de R2,
   sin subdominio propio. `HISTORY_ORIGIN` pasa a la URL de la rama del bucket
   y `HISTORY_SUMMARY_PATH` a `/masfacil-datos/gasolina/series/daily-v1.json`;
   `connect-src`, README y AGENTS.md sin R2. Bruno entrega el endpoint por
   chat; el Builder no lo inventa ni lo deja en blanco.
2. **Almacén S3 genérico** (§5, §7): el adaptador de R2 pasa a un adaptador S3
   path-style con endpoint, región y prefijo configurables, HEAD antes de PUT
   y huella por metadato o por hash del cuerpo. Variables `HISTORY_S3_*` en
   código, workflow y README; las `R2_*` desaparecen. El almacén local aplica
   el mismo prefijo.
3. **Ventana y `n`** (§1, §4, §8): 30 días por defecto, `n` visible y la nota
   de cadencia semanal en «Cómo se calcula».
4. **«Ver historial»** (§8): entrada al gráfico y ruta `/gasolina/historial`
   por reescritura; fila de DESIGN.md §12.
5. **Caché** (§8): nada que versionar a mano; retirar cualquier bump manual.
   El resumen se pide con revalidación (`cache: 'no-cache'`).
6. **Backfill** (§9): fuera de esta entrega, encargo aparte y opcional.
7. **Comprobaciones** (§10): doble en memoria que imita a Neon, la ruta nueva
   y la sonda remota ampliada con la primera corrida real y las cabeceras que
   Neon devuelve de verdad.

Configuración externa, de Bruno y fuera del código: proyecto de Neon dedicado
con el bucket público `masfacil-datos`, llave con `storage:read` y
`storage:write`, y variables y secretos del environment `datos-production`.
Nada que tocar en DNS, en la zona de Cloudflare ni en el bucket.
