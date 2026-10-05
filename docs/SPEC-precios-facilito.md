# Precios de Facilito en el refresco de seis horas

**Estado:** cerrado. Implementado en `6ba60de` (20/09/2026): los precios de
Facilito entran en el refresco.

Decisiones cerradas con Bruno en septiembre de 2026. Base inspeccionada: `7953851`, más los scripts locales del
piloto. Este es el único encargo de integración; `docs/SPEC-piloto-facilito.md` conserva
la evidencia del piloto, no impone repetirlo ni abrir otro ciclo documental.
Leer las reglas comunes de `AGENTS.md` y el contrato del Builder en `CLAUDE.md`.

## Resultado y decisiones cerradas

Si Facilito muestra S/22,39 para el mismo grifo y producto y nuestra base CSV
mantiene S/22,99, usar la consulta válida de Facilito conforme a las reglas de
selección de este SPEC. Conservar el precio CSV como respaldo. El importe de la
tarjeta, su orden y el histórico deben aplicar la misma selección.

Bruno confirmó:

- Consultar **cada seis horas**, Regular y Premium, en Lima provincia.
- No investigar ahora la fecha original del reporte en Facilito. Usar el precio
  capturado y mostrar **«Consultado hace X»**; su `reported_at` permanece `null`.
  `observed_at` significa exclusivamente cuándo se leyó la tabla.
- Habilitar vínculos por **razón social + dirección + distrito exactos**, únicos
  en ambos sentidos, después de comprobar una muestra real. No exigir descubrir
  un número de Registro que la tabla del piloto no entrega.
- Una captura válida se puede reutilizar hasta **24 horas** desde su consulta.
  Después se usa el CSV con reporte de hasta 30 días; si tampoco existe un precio
  válido, la tarjeta permanece sin precio. Un fallo de distrito no frena los demás.

La selección de Facilito es una política de fuente respaldada por su consulta;
no demuestra la fecha en que el operador cambió el precio, ni garantiza el precio
del surtidor. No inferir stock, horario o descuentos. No repetir el grilling.

## Base disponible y límites comprobados

El piloto local del 10 de septiembre recuperó 127 filas completas, identificó
121 candidatos textuales únicos y midió 17 diferencias frente al bundle local
del 9 de septiembre. No validó disponibilidad diaria, fecha original ni ejecución
desde GitHub Actions. La autorización del criterio de vínculo en este SPEC
permite convertirlo en una ruta publicable **tras la comprobación indicada**;
los resultados diagnósticos antiguos no pasan a ser acreditaciones por renombrarlos.

Reutilizar `scripts/pilots/scrap-facilito.mjs` como base del extractor: ya descubre
distritos, conduce el formulario público con `agent-browser` y lee todos los
nodos DOM cargados por DataTables, contrastándolos con el total anunciado. Fija
Lima/Lima y productos 126/127. Tiene límites de filas, tiempo y reintentos.
`facilito.mjs` conserva la prueba inicial; `compare-facilito.mjs` aporta la clave
textual y comprobaciones de identidad. Extraer módulos pequeños de esas piezas
si hace falta; no mantener dos extractores productivos con reglas divergentes.

Los tres scripts están sin tracking en el árbol inspeccionado. Preservarlos e
incorporar al diff de implementación solo los archivos necesarios y revisados.
El extractor genérico imprime JSON y CSV con datos privados: no conectar su
stdout directamente al log público de Actions.

## Arquitectura mínima

Extender la adquisición y proyección existentes: **captura privada → vínculo
exacto → composición con respaldo CSV → bundle estático habitual**. Un solo
workflow de precios, un solo manifest público y una tarjeta por establecimiento.
No introducir API, base de datos, servicio de scraping, cron adicional ni
consultas de Facilito desde el navegador de los usuarios.

| Pieza existente | Cambio necesario |
| --- | --- |
| `scripts/pilots/scrap-facilito.mjs` | Reutilizar navegación y extracción completas; salida estructurada privada. |
| `pipeline/gasolina-products.mjs` | Producir/reutilizar la referencia privada de identidad del snapshot oficial seleccionado. |
| `pipeline/refresh-snapshot.mjs`, `app/snapshot-manifest.mjs` | Integrar la captura en inputs privados reproducibles, con persistencia y promoción segura. |
| `pipeline/project-gasolina.mjs` | Añadir la consulta vinculada antes de calcular contenido, hash y manifest. |
| `pipeline/prepare-release.mjs`, `app/publication-policy.mjs` | Considerar cambios de Facilito aunque el CSV permanezca igual o no se pueda refrescar. |
| `pipeline/gasolina-contract.mjs`, `web/gasolina-contract.js` | Extender y validar el contrato, manteniendo lectura de bundles anteriores. |
| `web/lib/freshness.js`, `web/lib/merge-products.js`, `web/offer-card.js`, `web/app.js` | Seleccionar fuente, aplicar vencimiento y mostrar la fecha con su significado real. |
| `pipeline/history/daily-mean.mjs` | Consumir la misma selección con el reloj de la observación histórica. |
| `.github/workflows/refresh-pages.yml`, `scripts/preflight-deploy.mjs` | Instalar el navegador donde corresponde y evitar regresión de capturas. |

El Builder elige los nombres de módulos nuevos y el detalle interno. No crear un
framework de conectores ni reescribir adquisición CSV, identidad comercial o
publicación para uniformarlos.

## Adquisición completa y acotada

- Usar el mismo mecanismo validado: navegador normal, sesión aislada, selectores
  públicos y DOM de DataTables. Descubrir distritos del selector Lima/Lima, con
  códigos y nombres explícitos; no incluir Callao ni Lima región por similitud.
- Consultas secuenciales, con reintentos y presupuesto total acotados y declarados.
  Reutilizar los límites del extractor y establecer un límite de corrida que
  evite ejecuciones interminables. No añadir paralelismo para disimular fallos.
- Cada resultado declara distrito, producto, unidad, hora de consulta, cantidad
  anunciada y extraída, estado y huella. Comprobar cabeceras, producto, distrito,
  precio positivo y finito, soles por galón y completitud. Cero filas solo es
  válido si la tabla cargada confirma explícitamente ese total.
- La unidad de aceptación es **distrito × producto**. Una tabla parcial o de
  estructura desconocida no actualiza unas filas sí y otras no. Puede fallar
  Premium de un distrito sin invalidar el Regular comprobado ni otros distritos.
- Ante un fallo transitorio, conservar la última captura válida con su hora
  original; no renovar `observed_at` porque el proceso se ejecutó. Una consulta
  exitosa del mismo precio sí acredita una nueva observación, no un nuevo reporte.
- Ante desafío, rechazo explícito o rate limit, detener la adquisición afectada
  y no continuar golpeando el mismo bloqueo con otros distritos. No resolver
  desafíos, reutilizar tokens, usar proxies ni sustituir el método por endpoints
  no validados. Procesar lo ya válido y aplicar respaldo al resto.
- Si una tabla completa nueva omite una fila antes capturada, esa consulta nueva
  deja de respaldarla: retirar su capa Facilito y usar el respaldo CSV. No
  interpretar la ausencia como cierre del grifo ni falta de stock.

## Identidad del precio

Construir la referencia desde el **snapshot oficial realmente utilizado**, con
su revisión y la identidad correspondiente al registro seleccionado. No usar
ciegamente `dump-establishments.mjs`: hoy toma la primera fila del raw por
Registro y no garantiza representar la identidad del reporte más reciente.

La normalización permitida es la del comparador: mayúsculas, tildes y espacios.
Exigir las tres partes no vacías, igualdad exacta y unicidad en ambas fuentes
por producto. Verificar que el ID corresponde al Registro mediante
`officialAnchorFromRegistration`. Una fila no se asigna a dos establecimientos;
un establecimiento/producto no recibe dos precios Facilito incompatibles.
No resolver con distancia, nombre comercial, fuzzy matching ni expansión libre
de abreviaturas. Los conflictos y no vinculados quedan fuera, con conteos y
evidencia privada para diagnóstico.
Al cambiar la referencia oficial, revalidar también los vínculos de capturas
reutilizadas; una asociación que dejó de ser exacta vuelve al respaldo CSV.

La primera entrega actualiza pares **establecimiento × producto que la base
oficial ya puede proyectar**, incluyendo sus precios CSV vencidos. No crea IDs
desde Facilito ni amplía el universo de estaciones por esa vía. Una fila sin
par oficial publicable se registra como no cubierta.

Antes de habilitar la publicación, revisar una muestra reproducible de al menos
20 establecimientos vinculados —todos si hubiera menos—, repartida entre
distritos, ambos productos y operadores con varias sedes; incluir diferencias
de precio y casos rechazados por ambigüedad. Guardar selección, evidencia,
revisor y resultado en privado. Un vínculo incorrecto obliga a corregir la causa
y repetir la comprobación afectada, no a forzar la fila. La muestra no se presenta
como garantía estadística de toda Lima.

## Contrato, prioridad y vencimiento

Mantener disponible el respaldo CSV **en el propio bundle**, para que el cambio
de fuente al vencer funcione también offline, sin otra descarga ni deploy.
La extensión mínima propuesta conserva los campos CSV de cada oferta y añade
una capa opcional, validada en productor y navegador:

```text
price / reported_at       → precio y fecha reales del CSV, sin alterarlos
facilito                 → null o { price, observed_at, reported_at: null }
```

El nombre exacto de la capa es decisión de implementación; su separación y
semántica son obligatorias. Versionar el contrato porque el validador actual
rechaza campos adicionales. `establishment_id`, producto y coordenadas siguen
siendo oficiales; la identidad comercial sigue viniendo del catálogo existente.

Una única función de selección, con reloj inyectable, decide el precio efectivo:

1. Si el CSV tiene un reporte válido **posterior** a la consulta Facilito, usar
   el CSV: una consulta anterior no desplaza un reporte posterior conocido.
2. En otro caso, usar Facilito si su consulta es válida y tiene una edad entre
   cero y 24 horas, ambos límites incluidos.
3. Sin consulta elegible, usar CSV si su reporte tiene entre cero y 30 días,
   ambos límites incluidos.
4. Sin ninguno elegible, no mostrar ni ordenar por precio; conservar la tarjeta.

Fechas futuras, ilegibles o fuentes sin el vínculo validado no hacen elegible un
precio. Una consulta Facilito no hereda la fecha del CSV aunque el importe sea
igual. `source_max_reported_at` sigue describiendo reportes del CSV, no consultas
web; `cutoff_at` conserva su significado de corte del bundle. Registrar por
separado la versión y tiempos de adquisición de Facilito.

Aplicar la selección antes de filtros, ranking, contadores y fusión de productos.
Cada producto conserva fuente y fecha propias. Mostrar **«Consultado hace X»**
cuando corresponde a Facilito y **«Reportado hace X»** cuando corresponde al CSV;
el detalle identifica la fuente y fecha por producto. Si conviven fuentes o
edades distintas, la etiqueta general de tarjeta no debe atribuir a ambos la
frescura del más reciente. Ajuste mínimo de texto y detalle, sin rediseño.

Cuando ambos precios vencen, conservar las fechas disponibles distinguiendo
última consulta y último reporte. No decir que el operador lleva cierto tiempo
sin reportar basándose en un fallo de nuestra consulta. Recalcular elegibilidad
en las actualizaciones normales del cliente y al volver a la app desde segundo
plano; cruzar las 24 horas debe activar el respaldo incluso offline.
Actualizar también la caché temporal `freshUntil` de `web/app.js`, que hoy calcula
su próximo vencimiento únicamente con la ventana de 30 días del CSV.

## Persistencia y publicación

- Conservar capturas válidas y su estado por distrito/producto dentro de los
  inputs privados persistidos del flujo actual. Integrarlas con los snapshots
  inmutables y la caché de Actions existente; no depender de archivos temporales
  que desaparezcan entre corridas. Declarar rutas, hashes y referencia al snapshot
  CSV usado. No usar credenciales ni almacenamiento del histórico para esto.
  Cada composición publicada debe tener una referencia privada inequívoca y
  recuperable; puede reutilizar los bytes CSV inmutables sin copiarlos otra vez.
- Una ejecución de datos consulta Facilito aunque los validadores CSV indiquen
  `unchanged`. No activar `forceRefresh` permanentemente ni descargar el CSV de
  1,2 GB para forzar una reproyección. Una captura válida nueva puede generar una
  revisión nueva; una corrida fallida no fabrica cambios de datos ni de fecha.
- Un fallo al refrescar el CSV permite usar el último snapshot oficial válido
  como respaldo y referencia. Un fallo de Facilito permite publicar novedades
  CSV válidas. Sin referencia oficial utilizable no se publican vínculos nuevos;
  se conserva la entrega anterior y se informa la causa.
- Conservar los guardrails del CSV. Su máximo temporal no necesita avanzar para
  incorporar una captura web nueva comprobada; sí debe impedirse que retroceda.
  Medir por separado cobertura de captura, vínculos y precios efectivos para no
  confundir respaldo CSV con éxito del scraping.
- Regular y Premium se componen y validan juntos con una sola revisión derivada
  de los bytes. Escribir snapshots inmutables antes del manifest común. Una
  captura parcial aceptada por distritos no equivale a publicar medio bundle.
- La ruta `shell` sigue reutilizando datos publicados sin consultas de origen.
  `project` reutiliza el estado privado completo, incluyendo la captura, sin
  borrarla al actualizar marcas. Preservar compatibilidad con snapshots CSV
  anteriores y bundles guardados por clientes ya instalados.
- La comprobación previa al deploy debe ordenar **todo el estado de datos**, no
  solo el `snapshot_id` del CSV: dos capturas sobre el mismo CSV no pueden quedar
  empatadas. No aceptar una corrida que retroceda una consulta de un distrito/
  producto por haber terminado después. Si el candidato quedó atrás frente a
  producción, abortar sin pisarla; no crear un reconciliador distribuido.
- El rollback debe reconstruir los inputs CSV y Facilito correspondientes a la
  revisión elegida, sin consultar la web ni añadirle la captura activa de otra
  revisión. Snapshots antiguos sin Facilito continúan funcionando como CSV puro.
  La hora original de consulta tampoco se renueva al recuperar.

## Workflow, histórico y privacidad

Mantener la cadencia del workflow existente. Instalar una versión comprobada
del navegador y `agent-browser` solo en el camino que adquiere Facilito; fijar
versiones de las dependencias de ejecución. Ninguna dependencia del scraper
viaja a `web/` ni se necesita para servir la PWA.

El histórico sigue observando producción desde fuera. Usar la misma selección
de fuente con el instante de observación del histórico, incluyendo el respaldo
al superar 24 horas. Preservar lectura de bundles antiguos y los archivos ya
archivados; no recalcular el pasado usando el reloj actual. Su fallo continúa
sin bloquear precios, GPS, deploy ni rollback.

Raws, nombres, direcciones, referencias privadas, cookies y tokens quedan en
caché privada ignorada por Git. No subir HAR ni capturas crudas como artefactos
públicos de Actions. Los logs y el resumen de publicación muestran conteos por
producto/distrito, cobertura, duración, precios efectivos por fuente, consultas
reutilizadas y fallos. Una corrida que solo publicó CSV debe decirlo claramente.

## Aceptación de la implementación

Comprobaciones puntuales sobre el flujo completo, con fixtures pequeños y reloj
inyectado; no una suite de scraping ni una repetición documental del piloto:

1. Caso del usuario: mismo par oficial, CSV S/22,99 y Facilito S/22,39. La tarjeta,
   el orden y el histórico usan S/22,39 durante su ventana y lo llaman consulta.
2. Mismo precio observado otra vez, reporte CSV posterior a la captura, captura
   futura/inválida y límites de 24 horas/30 días. Al vencer Facilito, el navegador
   offline cambia al CSV elegible o apaga el precio sin borrar el grifo.
3. Tabla con más de 50 filas completa, total cero explícito, tabla truncada,
   producto/distrito incorrecto y fila ambigua. Ninguno mezcla o inventa precios.
4. Fallo de un distrito/producto: conservar su captura anterior sin rejuvenecerla;
   otros resultados válidos avanzan. Una omisión en tabla completa retira solo
   esa consulta y activa el respaldo. Un bloqueo explícito detiene los intentos.
5. CSV `unchanged` más captura nueva publica una revisión distinta sin descargar
   el CSV. CSV nuevo más Facilito fallido conserva su camino válido. Verificar
   persistencia con un entorno temporal equivalente a runner limpio.
6. Dos corridas sobre el mismo CSV terminan en orden inverso: la antigua no pisa
   la consulta nueva. Una reproyección de marcas conserva la capa Facilito;
   `shell` no consulta fuentes y rollback reproduce la revisión seleccionada.

Ejecutar las autopruebas reutilizables del piloto, las nuevas comprobaciones
proporcionales, `npm run audit`, `npm run verify:web` y `npm test` cuando afecte
al histórico. Revisar visualmente una tarjeta mixta y otra sin precio.

Como evidencia real, obtener una captura de Lima provincia con resultados por
distrito/producto y comparación contra la base contemporánea. Verificar también
la ejecución desde **GitHub Actions** en modo sin deploy antes de dar por
acreditada su operación automática. Los accesos del Mac no prueban los del
runner. Preparar esa comprobación dentro del trabajo; ejecutarla cuando exista
autorización para las operaciones remotas necesarias. Si queda pendiente,
declararlo expresamente y no afirmar que la integración ya opera en producción.

## Entrega y fuera de alcance

Entregar código, workflow preparado, captura/estado privados reproducibles,
comprobaciones y comparación agregada por chat. Actualizar `README.md` y
`docs/datos.md` solo en lo que cambia fuente, frescura, operación y recuperación.
No crear documentos de discovery, planificación o handoff adicionales.

No descubrir APIs nuevas, fecha original, otros combustibles, regiones o IDs
desde Facilito. No recoger precios de usuarios ni tocar credenciales del
histórico. No modificar la identidad comercial para que coincida un precio.
Este SPEC es independiente de `docs/SPEC-cobertura-marcas.md`; la única coordinación
es conservar anclas oficiales y no sobrescribir cambios compartidos.

El Builder planifica brevemente por chat e implementa; no hace commit, push,
cambios de secretos ni deploy con este encargo. El release exige la auditoría y
la autorización de Bruno previstas en `AGENTS.md`.
