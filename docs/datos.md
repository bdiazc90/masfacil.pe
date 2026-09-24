# Fuentes y modelo de datos observado

Conocimiento vigente medido principalmente el **14 de agosto de 2026**. Caracteriza fuentes oficiales y relaciones exactas; no demuestra el linaje técnico inmediato hacia cada pantalla de Facilito.

## Evidencia conservada y reproducción

El repositorio mantuvo durante un tiempo un directorio de evidencia con resultados agregados o sanitizados que sostenían las decisiones de cada corte. **Ese directorio ya no se conserva en el repositorio**; su contenido queda en el historial de Git. Ninguno de esos archivos contenía raw, RUC, razón social, dirección, overlay comercial privado, cachés, JSON público generado ni credenciales, y cada uno registraba, cuando aplicaba, fuente/fecha, observación, inferencia, confianza y el script que permitía reproducirla con inputs locales autorizados.

Lo que aportaban está recogido como hecho medido en este documento:

- perfiles y métricas agregadas de factibilidad del **14/08/2026**, incluido el corte de Lima provincia y el sondeo de J7; no probaban disponibilidad actual ni identidad comercial;
- cobertura y políticas agregadas del piloto de identidad comercial y del subconjunto público; no contenían el golden set privado ni autorizaban reutilizar contenido de terceros;
- resultado de detección y de refresco del **18/08/2026**, con hashes y decisiones operativas; no sustituían los raws locales;
- una observación acotada del producto público de Facilito del **14/08/2026**; no probaba arquitectura, afiliación ni equivalencia.

Ese conjunto agregado **ya no se produce**: el constructor privado que lo emitía se retiró junto con el dataset experimental y su schema, porque nada de lo que construía llegaba al público salvo dos campos temporales, que hoy viajan en el pointer del snapshot. Un snapshot nuevo no contiene dataset ni evidencia. Los scripts operativos siguen reproduciendo las transformaciones que sí se publican cuando existen los inputs autorizados en `.local-cache/`; un clon limpio no puede reconstruir un snapshot real.

## Fuentes de precio reproducidas

Las fichas de los cuatro datasets declaran ODC-By. Los archivos y sus catálogos son recursos distintos.

| Fuente | Filas | Alcance / corte material | Límite principal |
| --- | ---: | --- | --- |
| DMIN | 858 | 9 productos; fecha máx. 2026-08-13 | universo pequeño |
| Serie diaria anonimizada | 497,156 | corte 2026-03-01 | sin identidad ni territorio |
| GLP vigente | 522,380 | 6 productos; fecha máx. 2026-08-13 | mezcla unidades y actividades |
| Líquidos vigentes | 1,319,922 | 29 productos; fecha máx. 2026-08-13 | contiene historia y extremos |

Total perfilado: **2,340,316 filas**. Los extremos se conservan como anomalías; no se corrigen sin semántica. En GLP, `MARCA` aparece en 345,018/522,380 filas (66.047 %), pero su diccionario la define como producto o envasadora, no nombre comercial del establecimiento.

Los CSV vigentes de GLP y líquidos estuvieron disponibles por HTTP 206. Los fallos 403 previos fueron del cliente, no un límite de la fuente. Una adquisición completa observada transfirió 1.56 GB. La fuente expone `ETag`, `Last-Modified` y `Accept-Ranges`; todavía no se demostró respuesta 304, API incremental ni SLA.

### Detección barata de cambios

La URL canónica de `liquid-current` se comparte entre la adquisición y el probe (`app/source-catalog.mjs`). El detector (`app/validator-comparison.mjs` + `app/http-validator-probe.mjs`) compara ETag como valor opaco y Last-Modified sin descargar el cuerpo. Primero hace `HEAD` condicional; solo si el método no está soportado o una respuesta exitosa carece de validadores intenta `GET` con `Range: bytes=0-0` y cancela el cuerpo al recibir los headers. Un error HTTP definitivo no provoca una segunda petición. Ausencia, error, timeout o respuesta ambigua producen `unverifiable`, nunca `unchanged`.

Ejecución real única del **18/08/2026** sobre el snapshot local del **14/08/2026**: `HEAD` HTTP 200, 0 bytes consumidos, ETag remoto `"{FE76AA7F-4385-420E-8CBD-64AD7572DE90},238` frente a local `...,234`, y Last-Modified remoto **18 ago. 12:28:58 GMT** frente a local **14 ago. 12:28:52 GMT**. Resultado `changed`. La evidencia sanitizada de esa corrida ya no se conserva en el repositorio y queda en el historial de Git; no se descargó ni promovió un snapshot.

Conclusión aceptada: **B — viable con fallback seguro**. La detección de cambio es barata y reproducible; los tests probaron `unchanged` tanto por 304 como por HEAD 200 con validadores idénticos. Falta observar un ciclo real sin cambios para caracterizar cuál de esas respuestas usa la fuente.

### Refresco seguro y promoción atómica

El refresco manual reproducible es `npm run refresh -- liquid-current`. Resuelve la fuente desde `app/source-catalog.mjs`, compara validadores, descarga solo si el estado es `changed`, escribe en un staging único, sella bytes y SHA-256, ejecuta el builder y sus contratos/joins, compara cobertura y excepciones contra el snapshot activo y solo entonces mueve el staging a `.local-cache/snapshots/<snapshot-id>/`. El pointer pequeño `.local-cache/snapshots/active.json` se actualiza con escritura + rename atómico; `npm run rollback -- <snapshot-id>` cambia únicamente ese pointer.

El refresco correctivo real restauró primero `2026-08-14`, tomó ETag/Last-Modified del probe, encontró una adquisición local con esos validators exactos y verificó sus bytes y SHA-256 antes de reutilizarla. El raw tiene **1,078,782,427 bytes**, SHA-256 `9404f2910141efb2a4199ac446f547f43c5dad912958b33fdcc711ee5df18a55`; el CSV minimizado quedó con SHA-256 `231f3969613af4f357df0fc44c8e404089c9c5bf7d76792e8b0f114d25c3f89e`, **1,351,248 filas** y `source_max_reported_at=2026-08-18T04:59:36Z`. El snapshot promovido es `2026-08-18-20260819T003213952Z-7928-71e6ba`; su `source_last_modified_at` es `2026-08-18T12:28:58Z` y su `acquired_at` `2026-08-18T20:48:25.837Z`. La detección consumió 0 bytes y no hubo redescarga.

El candidato produjo **740** ofertas frescas, **714** listas para contrato y **96.486 %** de cobertura, frente a **741**, **714** y **96.356 %**. Registro y GIS siguieron fijados al **14/08/2026**. En aquella corrida los 11 anchors del piloto Repsol se revalidaron y reanclaron al `dataset_id` nuevo. **Ese reanclaje ya no existe:** se retiró del código junto con el overlay privado, así que el refresco de hoy no arrastra ni reancla identidad alguna. Los dos candidatos supersedidos permanecen inactivos y no son elegibles para rollback. Una segunda ejecución fue `unchanged`, sin descarga ni promoción. La reutilización es genérica: si cambian los validators, el raw anterior no coincide y no se reutiliza.

Más tarde la promoción se amplió al contrato público v2: el staging construye y valida **Regular y Premium** contra una misma revisión antes de mover el pointer privado. Los guardrails comprueban por producto ofertas frescas/publicables, distritos, cobertura y conflictos; también exigen que avance `source_max_reported_at`. El manifest público común se escribe después de sus dos snapshots inmutables. `npm run rollback -- <snapshot-id>` reconstruye y valida el mismo par antes de cambiar el pointer. La simulación de runner limpio verificó `changed` con 714 Regular y 700 Premium, y luego `unchanged` con un HEAD y 0 bytes de raw.

Registro y GIS se reutilizaron como inputs de referencia fijados al **14/08/2026**; no fueron refrescados ni se afirma lo contrario. Los originales y derivados grandes viven solo en `.local-cache/`; la evidencia agregada de ese refresco ya no se conserva en el repositorio y queda en el historial de Git.

## Evidencia externa verificada por el owner: EVPC

`OWNER-VERIFIED / TRUSTED INPUT`, snapshot aproximado **12 de agosto de 2026**. Sus artefactos no viven en este repo y sus números no son permanentes.

`Ultimos-Precios-Registrados-EVPC.xlsx` contenía **17,472 filas** y **5,685 `CODIGO_OSINERG` únicos**, aproximadamente establecimiento × producto × último precio. Frescura:

- 330 dentro de una hora;
- 9,540 (≈55 %) dentro de 24 horas;
- 15,924 (≈91 %) dentro de 7 días;
- 16,966 (≈97 %) dentro de 30 días;
- 506 por encima de 30 días.

La regulación PRICE aportada por el owner indica actualización cuando cambia el precio y publicación en Facilito hasta por 30 días. Por política conservadora, una fila raw más antigua no se muestra automáticamente.

## Registro, GIS y geografía

El snapshot minimizado del Registro contiene 17,742 autorizaciones de diez actividades. `REGISTRO` no siempre es fila-única; RUC identifica al titular, no a una sede, y no se conserva en derivados.

Las capas GIS perfiladas suman 11,215 features:

- capa 28: 117;
- capa 34: 5,663;
- capa 35: 5,284;
- capa 36: 151.

`N` es completo y único en las capas 34/35/36. La capa 31 no existe en el servicio observado. Las geometrías son válidas y están dentro de una caja conservadora de Perú. El servicio atribuye copyright a Osinergmin, pero no expone licencia explícita. Ese es un hecho de procedencia; el owner aprobó expresamente publicar las coordenadas GIS en el contrato público downstream. La atribución pública resultante es “Datos de precios y coordenadas: Osinergmin.”

Solapamientos exactos del snapshot, sin fuzzy matching:

| Join | Match | Estado |
| --- | ---: | --- |
| GIS 34 `N` ↔ Registro actividad 16 | 5,611/5,663 (99.082 %) | 1 uno-a-muchos |
| GIS 35 `N` ↔ Registro actividades 1/2/5/6 | 5,198/5,284 (98.372 %) | 7 uno-a-muchos |
| GIS 36 `N` ↔ Registro actividades 5/6/15/59 | 142/151 (94.040 %) | uno-a-uno en matches |
| GIS 28 `COD_OSINERGMIN` ↔ Registro actividad 20 | 109/117 (93.162 %) | uno-a-uno en matches |

Son relaciones candidatas del snapshot: los no-matches y la multiplicidad impiden declararlas universales.

La evidencia EVPC del owner verificó además:

- `CODIGO_OSINERG` ↔ Registro: 5,659/5,685 (**99.54 %**);
- `NRO_REGISTRO` ↔ GIS `N`: 5,279/5,685 (**92.86 %**);
- geografía segura con bridges estrictos: 5,345/5,685 (**94.02 %**);
- excluyendo 144 grifos flotantes y 101 rurales: 5,345/5,440 (**98.25 %**);
- control Santiago de Surco: 28/28 con coordenada segura.

El catálogo UBIGEO INEI contiene 1,891 distritos e IDs únicos, bajo ODbL. Las fuentes observadas usan territorio textual y no ofrecen un campo UBIGEO compatible para join directo.

## Identidad comercial

### Qué expone y qué no expone cada fuente

Ninguna fuente bulk oficial expone identidad comercial de la sede:

- EVPC tenía `MARCA` vacía en 17,472/17,472 filas;
- el Registro aporta razón social y dirección, no garantiza nombre público de la sede;
- el formulario RHO y el Padrón Reducido SUNAT no exponen nombre comercial;
- la consulta individual SUNAT requiere CAPTCHA y no se evade.

Este es un hecho sobre las fuentes bulk, **no una conclusión sobre el proyecto**. Que una fuente automatizable no entregue el dato no implica que el dato sea desconocido ni que obtenerlo por otra vía sea ilegítimo: la observación directa, la confirmación del owner y el aporte moderado de colaboradores son evidencia válida, registrada por nivel según [`AGENTS.md`](../AGENTS.md).

Se conservan intactos los controles que protegen la exactitud: no se infiere marca desde razón social ni RUC, y no se interpretan `PRODUCTO_ACTIVO`, `ULT_PRECIO_DIF_CERO` u otros campos como stock sin semántica demostrada.

### Google Maps como fuente de descubrimiento — autorizado el 23/08/2026

Bruno autorizó de forma explícita y permanente usar Google Maps, incluido el
raspado con `agent-browser`, para descubrir identidad comercial. La regla previa
—«no unir por dirección o coordenada»— queda sustituida por una más precisa: la
coordenada oficial **selecciona candidatos**; lo que **confirma** el vínculo es el
número de puerta, el nombre de la vía, la razón social o una observación visual,
más unicidad por margen frente al segundo candidato.

Primera medición, 23/08/2026, sobre un barrido de 68 fichas en un radio de 3 km
desde `-12.1326704,-77.0123699`. Se cruzaron las 5 fichas más cercanas al centro
contra los 717 establecimientos del contrato vigente:

| Ficha de Maps | Registro emparejado | Distancia | Corroboración independiente |
| --- | --- | ---: | --- |
| EDS Servicentro Germanico SAC | SERVICENTRO GERMANICO F.H. S.A.C. | 30 m | el nombre es la razón social |
| Primax Alegría · Benavides 2116 | COESTI S.A. · AV. BENAVIDES N° 2116 | 15 m | número de puerta exacto |
| Primax Granada · M. Castilla 905 | COESTI GRANADA · AV. MARISCAL CASTILLA N° 905 | 26 m | vía, número y la palabra «Granada» |
| Gasolinera Repsol | REPSOL COMERCIAL S.A.C. | 22 m | la marca aparece en la razón social |
| Primax El Cortijo gnv · Panamá 6901 | SERVICENTRO GERMANICO · PANAMA N° 6901-A | 18 m | número de puerta exacto |

Las cinco resultaron únicas por margen: el segundo candidato quedó entre 370 m y
753 m. **Ninguna se apoyó solo en la distancia.**

La primera y la quinta apuntan al **mismo** Registro: Google mantiene dos fichas
para una sola esquina (Panamá 6901 con Mariscal Castilla). Es un caso de
**abanderamiento** observado con nombre propio —marca Primax sobre la razón
social de un tercero— y confirma que la asignación debe ser bipartita: dos fichas
no pueden reclamar un mismo `establishment_id`. También resuelve qué publicar: el
conductor reconoce «Primax El Cortijo», no la razón social.

Cinco casos en un distrito denso no son una tasa de precisión. Antes de publicar
cualquier tier hace falta una muestra auditada por el owner, con cota inferior
medida. Esa medición todavía no existe.

Procedencia: lo cosechado de Google vive solo en `.local-cache/` y no se
commitea. Raspar Google Maps contraviene sus términos de servicio y Bruno asume
esa decisión con conocimiento de causa. Para el dato publicado se prefiere una
vía redistribuible —OpenStreetMap bajo ODbL, o la observación directa del
owner—; el catálogo registra el `source.kind` real de cada entrada.

### Clasificación de riesgo del campo

Según los dos ejes del método:

| Eje | Nivel | Consecuencia operativa |
| --- | --- | --- |
| Tasa y señal de cambio | Baja tasa, **sin señal propia** | Se puede curar a mano y revisar con poca frecuencia, pero necesita `verified_at` explícito y disparadores propios |
| Daño y detectabilidad | **Daño atributivo alto**, error poco detectable | Cero falsos positivos en el vínculo; el fallback honesto es preferible a una atribución dudosa |

Publicar un nombre convierte una tarjeta anónima —«SURQUILLO · S/ 16.89»— en una afirmación sobre un negocio identificable. El mismo error que antes solo confundía a quien conduce, después atribuye un precio al establecimiento equivocado. Por eso la identidad **sube** el estándar de exactitud de los campos que la acompañan.

### Hard negatives medidos, que siguen vigentes

El piloto midió modos de fallo reales; no son cautela abstracta:

- **coordenada compartida:** dos establecimientos con razón social distinta —COESTI y Repsol— sobre la misma coordenada exacta. Una coordenada no puede ser anchor de identidad por sí sola;
- **abanderamiento:** una marca operando sobre la razón social de un tercero. Se excluyó correctamente como conflicto, no como verificado;
- **dirección normalizada ambigua o compartida** entre candidatos.

### Piloto de identidad comercial — contrato histórico

Trabajo realizado y verificado el **17 de agosto de 2026**. Estos hechos no se reescriben.

Un golden set privado, construido por un research scout independiente, vinculó identidad comercial fuera de las fuentes bulk oficiales:

- universo predefinido de 64 ofertas (Surco + 3 distritos aledaños) del dataset privado de Lima provincia;
- 14 candidatos con razón social corporativa Repsol exacta; 11 vinculados por dirección normalizada exacta a una fuente first-party (PDF "Relación de Estaciones – Repsol You"), 3 sin contraparte (unmatched, no forzado);
- 0 vínculos Primax: no se encontró directorio first-party con nombre de sede accesible sin evadir controles ni renderizar JS;
- método en dos pasos deterministas, sin fuzzy matching: igualdad exacta de razón social corporativa, luego dirección normalizada exacta con candidato único;
- fuente con antigüedad declarada (~4 años, Last-Modified 2022-11-02): las 11 entradas quedaron `identity_freshness=stale`, sin inferir vigencia desde esa fecha;
- permiso de publicación de las 11 identidades: `unknown`. No hay licencia ni prohibición explícita en la fuente; un robots.txt permisivo autoriza rastreo, no reutilización de contenido.

Aquel overlay separaba siempre exactitud del vínculo (`verification_status`) de permiso de publicación (`publication_status`) y de frescura (`identity_freshness`), y nunca derivaba frescura desde la fecha de acceso o de modificación de la fuente. **Esa separación se conserva** y hoy la sostiene el catálogo sucesor. El overlay vivió únicamente en una carpeta privada de `.local-cache/`, con permisos `0600` e ignorada por Git; esa carpeta ya no existe y el repositorio tampoco conserva el schema ni la evidencia agregada de ese piloto, que quedan en el historial de Git.

**Límite del contrato histórico.** El schema del overlay describía ese piloto y se conservó sin modificar mientras existió. Su forma solo admitía el método que el piloto usó: `discovery_method` estaba congelado en `normalized_address_exact`, `integration_method` en `official_anchor_exact`, y `source.url` exigía patrón `^https://` incluso cuando `source.kind` era `owner_verified`. Una verificación presencial del owner no tiene URL y, por lo tanto, **no era representable** en ese contrato. El bloqueo de identidad no fue solo una decisión de criterio: quedó codificado en el artefacto. Ese schema nunca se mutó para simular lo contrario; en su lugar se escribió un contrato sucesor capaz de representar evidencia observada sin URL obligatoria, y el histórico ya no se conserva en el repositorio.

**Límite de la política de publicación.** Existió un módulo de matriz de publicación campo por campo, que trataba `unknown` como campo suprimible. Bajo el método vigente `unknown` es una cola accionable y no un veredicto terminal, así que esa matriz requería migración. Hoy ese módulo ya no se conserva en el repositorio y su función quedó repartida en dos artefactos vivos: la **allowlist cerrada** del contrato público (`PUBLIC_OFFER_FIELDS` en `pipeline/gasolina-contract.mjs`), que rechaza cualquier campo fuera del conjunto exacto, y el **contrato de catálogo** (`app/commercial-catalog.mjs`), donde `publication.status` distingue `publishable`, `pending` y `not_publishable`. El registro del permiso campo por campo no está codificado en ningún artefacto ejecutable: es esta tabla.

#### Permiso de publicación campo por campo

El permiso no es uniforme: se evalúa campo por campo, contra la licencia real de su fuente.

| Campo | Veredicto | Base |
| --- | --- | --- |
| Precio, fecha de reporte, frescura, distrito | publicable | ODC-By declarado en las fichas de los datasets de precio |
| Coordenada | publicable | aprobación explícita del owner para el contrato público downstream; se conserva procedencia y atribución a Osinergmin |
| Distancia derivada | publicable | Haversine local a partir de coordenada cuya publicación fue aprobada |
| Dirección de la vía | publicable | admitida por el contrato público vigente, acotada a texto corto para la tarjeta |
| Razón social, RUC, representante | no se publica | la declaración ODC-By observada describe los datasets de precio, no columnas de identidad legal; además una razón social no es una marca |
| Identidad comercial (`brand`, `public_site_name`) | gobernada por el catálogo | entrada por entrada, con evidencia privada, vínculo exacto y fecha de verificación |

**`no se publica` no es un veredicto terminal para todo:** es la decisión vigente mientras el catálogo cubra mejor la necesidad. El precedente es la coordenada, que estuvo sin decisión y salió por una decisión explícita del owner con procedencia y atribución conservadas. Ese es el circuito previsto, no una excepción.

**Estado hoy.** El bundle público lleva identidad comercial para la mayoría de los establecimientos con oferta vigente, con marca cuando existe y nombre de sede cuando la auditoría lo respalda. Los conteos exactos cambian en cada corrida y viven en el reporte privado `.local-cache/publish/commercial-identity-coverage.json`; este documento no los copia. Una oferta sin identidad usa el marcador honesto y la tarjeta no infiere nombre.

### Registro ≠ conjunto de ofertas vigentes

Son dos cosas distintas y confundirlas ya congeló la publicación una vez: durante 27 corridas seguidas, una estación que dejaba de reportar precio salía de la unión de IDs con oferta, pasaba a «ID desconocido» y tumbaba la corrida entera, precios incluidos.

La regla vigente:

- La identidad se **valida** contra el universo del Registro oficial —el seed de CI o las tablas oficiales locales—, nunca contra el conjunto de ofertas del día.
- La identidad se **proyecta** solo sobre las ofertas que hoy existen.
- Una estación registrada que dejó de reportar precio no es un fallo del catálogo: se conserva en privado y su tarjeta queda sin precio, diciendo desde cuándo calla.
- Un ID comercial ajeno al Registro no crea una estación ni invalida sus precios: se descarta esa atribución y se cuenta en `unknown_anchors`.
- Un universo de Registro vacío sí bloquea: sin referencia oficial no hay nada contra lo que validar.

### Identidad completa, degradada y ausente

El enriquecimiento comercial dejó de ser un prerrequisito de los precios. `app/commercial-resolution.mjs` resuelve tres estados y `pipeline/project-gasolina.mjs` publica con cualquiera de ellos:

| Estado | Cuándo | Qué se publica |
| --- | --- | --- |
| `complete` | catálogo y auditoría válidos y correspondientes | precios + marcas + nombres respaldados |
| `degraded` | falta la auditoría, no corresponde al catálogo, un tier no alcanza su cota, una entrada quedó rancia, pendiente o con veredicto `incorrect`, o el catálogo traía entradas defectuosas o duplicadas que se aislaron | precios + marcas + los nombres que sí tienen respaldo |
| `absent` | no hay catálogo utilizable: paquete indecodificable, ausente o fuera de contrato | precios, con el marcador neutral en todas las tarjetas |

Lo que se retira es la afirmación sin respaldo, no la entrada entera: una marca válida se conserva aunque falle el nombre, y una entrada que queda sin marca y sin nombre desaparece del catálogo utilizable en vez de publicarse vacía. Un duplicado no se resuelve eligiendo una copia: se retiran todas las entradas con ese `establishment_id`. Al instalar el expediente en CI, la pareja anterior se aparta a `replaced/`: una instalación fallida deja la identidad ausente de verdad y un catálogo nuevo nunca convive con una auditoría vieja. La degradación nunca es silenciosa: sale con conteos y motivos en el resumen de la corrida, y el detalle queda en el reporte privado.

Lo que **sigue bloqueando** la publicación: Registro vacío, dataset o contrato inválido, errores de precio o de fecha, integridad rota, fuga de datos privados y los guardrails de caída. Un fallo comercial aísla identidades; nunca relaja la verdad de los precios.

## Catálogo canónico de entidades

El contrato sucesor puede registrar evidencia `owner_verified`, `first_party`, `public_web_observed`, `open_reusable` o `known_contributor`. En todos los casos conserva en privado fuente o descripción, método, fecha y responsable. La proyección pública mínima no necesita publicar ese expediente, pero el proyecto tampoco lo borra ni presenta el dato como propio.

### Clave y universo

La clave del catálogo es la **entidad oficial**, no la oferta. El anchor ya existe en el pipeline: `establishment_id` se deriva exclusivamente del código de Registro (`app/official-anchor.mjs`, `officialAnchorFromRegistration`, usado por `pipeline/gasolina-products.mjs`), de modo que un establecimiento con varios productos es una sola entrada.

Medición sobre los snapshots privados autorizados, contando entidades y no ofertas:

| Medida | Valor |
| --- | ---: |
| Establecimientos distintos en el contrato Regular (14/08/2026) | 714 |
| Establecimientos distintos en el contrato Regular (18/08/2026) | 714 |
| Altas de código entre ambos cortes | 0 |
| Bajas de código entre ambos cortes | 0 |
| Precios que cambiaron entre ambos cortes | 239/714 (33.5 %) |

En Gasohol Regular la relación oferta↔establecimiento fue 1:1 en ambos cortes. **714 no es el tamaño del universo del catálogo:** es el conteo de un producto en un ámbito. El universo real es la unión de códigos con oferta contractual en todos los productos publicados; con Regular en 714 y Premium en 700 entradas, esa unión está acotada entre 714 y 1,414. Esa medición sí se completó después y se reporta más abajo: unión de **717** y solapamiento de **697**.

### La estabilidad observada es un límite inferior

Las cifras anteriores tienen un límite material que debe declararse: entre esos dos cortes, razón social, dirección y coordenada fueron **idénticas por construcción**, no por estabilidad observada. El refresco actualiza el CSV de precios y reutiliza Registro y GIS fijados al 14/08/2026. Además, un establecimiento nuevo en el CSV de precios sin autorización en ese Registro congelado se **excluye** (17 exclusiones) en lugar de contarse como alta.

Consecuencia directa: hoy **no existe señal alguna de cambio a nivel de entidad**. La rotación medida de 0 altas y 0 bajas es un piso, no una medición del mundo.

### Invalidación barata

Disparadores aceptados para re-verificar una entrada del catálogo:

| Disparador | Observable hoy | Qué falta |
| --- | --- | --- |
| Cambio de titular o razón social del código en el Registro | No | Refrescar Registro y comparar por código entre snapshots |
| Cambio significativo de coordenada del código | No | Refrescar GIS y fijar el umbral de desplazamiento |
| Alta, baja o desaparición del código | Parcial | Distinguir alta real de exclusión por Registro congelado |
| Vencimiento de `verified_at` | Sí, al existir el campo | Definir la ventana por ruta |
| Reporte de una persona usuaria | No | Evolución posterior a la primera versión del catálogo |

Una revisión manual ocasional es una red de seguridad, no garantía de vigencia. La falta de estos disparadores automáticos queda declarada, pero no bloquea un catálogo inicial pequeño y curado. Su cadencia se decidirá con rotación observada, no por adelantado.

### Catálogo sucesor y cobertura inicial

`app/commercial-catalog.mjs` sucede al contrato histórico sin mutarlo: declara su `CATALOG_SCHEMA_VERSION` y valida en JS lo que antes describía un schema JSON aparte. Separa procedencia y adquisición de la fuente, vínculo exacto a la entidad, frescura y permiso de publicación. Permite marca, sede pública o ambas; la proyección v2.1 solo permite `establishment_id` e identidad `{brand, public_site_name}` y nunca exporta expediente ni entidad legal. `app/commercial-audit.mjs` define la auditoría privada. Las versiones vigentes de ambos contratos viven en el código, no aquí: copiarlas a un documento solo produce una cifra que envejece.

Cada fila de auditoría conserva el SHA-256 de la representación canónica de la entrada completa. Si cambia identidad, fuente, vínculo, frescura o publicación, la auditoría pasa a `pending`; si no hay entradas publicables, informa `not_required`. El seam privado de candidatos existió como módulo aparte y separaba `commercial_identity_claim` de `legal_entity_claim`; ese módulo ya no se conserva en el repositorio, pero la regla que imponía sigue vigente dentro del catálogo, cuyo `entity_link.status` distingue `verified`, `pending` y `conflict`: una razón social y un Registro exacto pueden seguir como candidato o conflicto, pero **no se convierten en marca**. Solo identidad comercial explícita, anchor derivado exactamente del Registro, evidencia comercial específica y revisión permiten `verified`, y solo una entrada `verified` puede llegar a `publishable`. Ningún candidato se proyecta por esa vía.

La medición se hizo con el raw privado del runner limpio y el seed autorizado de Registro/GIS. El resultado sanitizado midió 714 establecimientos Regular, 700 Premium, una unión de **717** y solapamiento de **697**; ese archivo agregado ya no se conserva en el repositorio y queda en el historial de Git. La unión de **717** y el solapamiento de **697** describen ese corte, no el universo de hoy: el conteo vigente sale del propio cruce en cada corrida. Las tres waves públicas no encontraron un puente comercial válido; la cobertura actual se construyó después, con la fuente de identidad autorizada el 23/08/2026.

Los 11 vínculos Repsol del piloto siguen siendo antecedentes privados con fuente stale y permiso de publicación `unknown`; no se trasladan silenciosamente al sucesor. Además **ya no son recuperables desde el repositorio**: el overlay se eliminó y el `establishment_id` cambió de derivación, de modo que sus anchors antiguos no corresponden a los actuales. Para incorporarlos o añadir cualquier identidad hace falta revalidación autorizada que complete el expediente nuevo y un `publication_status=publishable`. La cobertura por distrito puede usarse como diagnóstico si aparece un sesgo material, pero no es una puerta para publicar la primera cobertura parcial con fallback.

## PRICE y J7

El enlace PRICE visible en Facilito redirige a una biblioteca documental. En la página observada había 1,337 enlaces a PDF/XLS/XLSX/ZIP, pero cero CSV y cero rutas `Reporte-Diario`. Esto no contradice que el archivo EVPC sea material para precios retail; indica que ese enlace concreto no ofrece una interfaz estructurada visible.

J7 permanece fuera del producto: no se reprodujo una fuente nominal que explique distribuidor, marca, fecha y rangos de sus 444 filas públicas. La capa GIS 31 que se suponía asociada tampoco existe.

## Cadencia de la fuente y frescura — medido el 25–26/08/2026

**La fuente es semanal.** `CL-Registro-precios-DMA-V-CCA-CCE.csv` cambió de `Last-Modified` **mar. 18 ago 12:28:58 GMT** a **mar. 25 ago 12:29:26 GMT** (ETag `,238` → `,245`), y las cuatro sondas HEAD del lunes 24 devolvieron `unchanged`. El archivo del martes contiene registros hasta el lunes 23:59 Lima (`source_max_reported_at` 2026-08-25T04:54:33Z). Un precio cambiado un miércoles aparece el martes siguiente: hasta 6 días de retraso, que ningún cron nuestro puede acortar. La carpeta se llama `Reporte-Diario`, pero se publica semanalmente. Distribución en el bundle del 25/08: 522 de 715 grifos registraron el lunes 24 (ajuste semanal de las cadenas), 43 el 25, 128 entre 3 y 6 días, 14 con más de una semana.

**Qué es `FECHA_DE_REGISTRO`.** Por RCD 050-2017-OS/CD (leída del PDF firmado, art. 1 que modifica el art. 2 del Anexo A del procedimiento PRICE de 2005) el registro «debe ser actualizado inmediatamente después de los cambios efectuados en la lista de precios» del establecimiento, y «los precios registrados en el PRICE deben ser iguales a los que son publicados en su establecimiento». El procedimiento vigente, RCD 256-2021-OS/CD (deroga la 394-2005; modificada por RCD 051-2023-OS/CD, que añade alertas de cumplimiento), conserva la regla en su art. 3: el registro se actualiza inmediatamente cuando el precio se modifica. Conclusión: la fecha de registro es, por norma, el **inicio de vigencia** del precio en el surtidor. La app puede decir «precio desde el <fecha>»; lo que no puede afirmar es cuánto tardó el archivo semanal en recogerlo.

**Fuentes evaluadas para una frescura ≤ 24 h** (cuatro agentes de lectura pública, 26/08; ninguna sonda escribió ni saltó controles):

| Canal | Frescura | Automatizable | Motivo |
|---|---|---|---|
| CSV semanal de `Reporte-Diario` (actual) | martes; hasta 6 días | sí | única fuente oficial nominal por establecimiento |
| `CL-Registro-precios-DMIN.csv` (misma carpeta) | mismo sello semanal | sí | distribuidores minoristas, no grifos |
| Otras rutas de `SCOP-DOCS` | — | — | variantes probadas 404; el listado SharePoint exige autenticación |
| Facilito web | horas (lee PRICE) | sí, medido el 10 y el 20/09/2026 | formulario Struts con reCAPTCHA v3; un navegador normal lo atraviesa sin resolver ningún desafío |
| Facilito app | horas | no | sin API pública; no se decompila |
| PRICE/SCOP (`pvo.osinergmin.gob.pe`) | inmediato | no | credenciales de operador |
| datosabiertos.gob.pe «Lista de precios diaria» | mensual | sí | anonimizado: sin establecimiento |
| Precios de referencia PR1/PR2 | semanal | condicional | promedios nacionales, no por grifo |
| ArcGIS de Osinergmin | — | — | `gis.osinergmin.gob.pe` no resuelve; `gisem` 404 |

**Decisión de agosto, ya superada en parte.** Se mantuvo el CSV semanal como única fuente y la app declaraba su cadencia. La fila de Facilito decía «no automatizable»; el piloto del 10/09/2026 y el barrido del 20/09/2026 lo desmintieron, y desde entonces la consulta web es una **capa sobre** el CSV, nunca un reemplazo. Siguen abiertos los dos caminos no técnicos: pedir a Osinergmin la publicación diaria del reporte o un acceso al módulo PRICE, y los aportes de quien usa la app junto al precio oficial, nunca en su lugar (backlog en [roadmap.md](roadmap.md)).

## Consulta web de Facilito — medido el 20/09/2026

**Qué es.** El buscador público de Facilito lee el mismo registro PRICE que alimenta el CSV, pero con horas de retraso en vez de días. Se conduce con un navegador normal sobre sus selectores públicos —departamento, provincia, distrito, producto— y se lee la tabla que DataTables ya cargó en el cliente, contrastando las filas contra el total que la propia tabla anuncia. No se llaman endpoints, no se reutiliza el token de reCAPTCHA, no se resuelve ningún desafío y no se usan proxies.

**Barrido completo medido.** 43 distritos de Lima provincia × 2 productos = **86 unidades, 86 comprobadas, 1452 filas, en 109 segundos**. La unidad de aceptación es distrito × producto: una tabla parcial o de forma desconocida tumba esa unidad y no las demás. Un rechazo explícito —401/403/429 o un desafío— detiene la adquisición entera en vez de seguir probando distritos.

**Diésel, capturado sin publicarse (24/09/2026).** El select de producto ofrece `126` Gasohol Regular, `127` Gasohol Premium y `40` «DB5 S-50 UV»; nada de GLP ni GNV en este formulario. Los códigos se fijan y en cada lectura se comprueba que la opción elegida muestre su etiqueta: la tabla no tiene columna de producto y su cabecera es la misma para todos, así que es la única prueba de qué se leyó. Diésel se recorre en una **pasada propia**, después de la de Gasolina —que no cambia— y con su propio presupuesto (10 min): un problema de su tabla no le cuesta a Gasolina ningún distrito, y un bloqueo detiene las dos. Primera lectura local: San Luis y Ate, 2 de 2 unidades, 66 filas, unos 5 s por distrito. «DB5 S-50 UV» no es el nombre del CSV (`Diesel B5 S-50 UV`): que sean el mismo producto lo acredita la muestra de vínculos antes de publicar Diésel, no el parecido. El expediente es uno, pero cada grupo cuenta solo sus unidades: el `refresh-state` de Gasolina no lleva consultas de Diésel y el preflight no las compara como suyas. El resumen de cada corrida sale por producto y por pasada; `--products` limita una corrida de comprobación.

**Qué NO entrega.** La tabla no publica el número de Registro ni la fecha en que el operador registró el precio. Por eso el vínculo con el establecimiento oficial es textual —razón social + dirección + distrito exactos y únicos en ambos sentidos, normalizando solo mayúsculas, tildes y espacios— y por eso la capa lleva `reported_at: null` y la tarjeta dice **«Consultado hace X»**, nunca «Reportado». Medido sobre el snapshot del 06/09: **684 de 726 ofertas Regular y 673 de 711 Premium** quedaron vinculadas, con **cero ambigüedades** y 95 filas sin par oficial.

**Cuánto vale una consulta.** 24 horas desde que se leyó la tabla. Después manda el respaldo del CSV mientras su reporte tenga 30 días o menos, y si tampoco, la tarjeta se queda sin precio. Un reporte del CSV posterior a la consulta gana siempre: una consulta anterior no desplaza un cambio de precio más nuevo que sí conocemos. Un fallo de consulta no rejuvenece nada —la captura anterior conserva su hora— y no se presenta nunca como silencio del operador.

**Privacidad.** La tabla trae razón social, dirección y teléfono. El teléfono se valida por posición y no se emite nunca; la razón social y la dirección se convierten en huella SHA-256 para comparar y no se persisten. El expediente privado (`.local-cache/facilito/`) guarda huella, precio y hora, nada más. Solo `node scripts/facilito-sample.mjs`, local y explícito, conserva el texto para revisar una muestra a ojo.

## Modelo útil

```text
observación de precio
  → autorización / código Osinergmin
  → establecimiento provisional (razón social + dirección)
  → feature GIS
  → oferta con precio, fecha, unidad y coordenada
```

Granos que no deben mezclarse:

- fila histórica de precio;
- última oferta por establecimiento/producto/unidad;
- autorización de una actividad;
- establecimiento físico;
- operador legal;
- marca de producto/envasadora;
- nombre comercial de sede.

El catálogo canónico se ancla al **establecimiento físico mediante su código oficial**, nunca a la oferta, a la coordenada ni al operador legal.

## Procedencia, privacidad y reproducción

Los originales grandes o con datos personales viven solo en `.local-cache/`: `raw/` guarda las adquisiciones, `snapshots/` los snapshots promovidos con su pointer, `identity/` el catálogo y la auditoría comercial, `facilito/` el expediente de consultas web, y `publish/` los artefactos de publicación. Los snapshots versionados eliminan RUC, razón social, dirección, representante, teléfono, correo y placa. Un manifiesto previo sella lista, tamaño y SHA-256; la verificación falla ante archivos nuevos, alterados o ausentes.

La auditoría de publicación comprueba que nada de eso llegue a Git —rutas prohibidas, ignores requeridos y tamaño máximo por archivo rastreado:

```bash
npm run audit
```

Riesgos abiertos: estabilidad temporal de claves, no-matches, semántica de extremos, mecanismo incremental y linaje CSV→Facilito. A ellos se suma la ausencia de refresco de Registro y GIS, que hoy impide observar cambios a nivel de entidad. La publicación downstream de coordenadas GIS fue aprobada por el owner; se conserva procedencia y atribución, pero no se trata como permiso pendiente ni prohibición.
