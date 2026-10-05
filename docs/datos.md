# Fuentes y modelo de datos observado

Conocimiento vigente medido principalmente el **14 de agosto de 2026**. Caracteriza fuentes oficiales y relaciones exactas; no demuestra el linaje técnico inmediato hacia cada pantalla de Facilito.

Las mediciones fechadas, embudos auditados, pilotos y contratos históricos que sostienen este documento viven en [docs/evidencia-datos.md](evidencia-datos.md); un clon limpio no puede reconstruir un snapshot real sin los inputs autorizados de `.local-cache/` ([detalle](evidencia-datos.md#evidencia-conservada-y-reproducción)).

## Fuentes de precio reproducidas

Las fichas de los cuatro datasets declaran ODC-By. Los archivos y sus catálogos son recursos distintos.

- **Datasets:** DMIN, serie diaria anonimizada, GLP vigente y líquidos vigentes; el producto usa los dos últimos ([perfil del 14/08/2026](evidencia-datos.md#fuentes-de-precio-reproducidas--perfil-del-14082026)).
- **Cadencia:** el CSV de líquidos ya es diario, y `FECHA_DE_REGISTRO` es por norma el inicio de vigencia del precio: la app puede decir «precio desde» esa fecha ([medición](evidencia-datos.md#cadencia-de-la-fuente-y-frescura--medido-el-2526082026)).
- **Ventana de 30 días:** la regulación PRICE publica en Facilito hasta por 30 días y, por política conservadora, una fila raw más antigua no se muestra automáticamente ([EVPC](evidencia-datos.md#evidencia-externa-verificada-por-el-owner-evpc)).
- **Consulta web de Facilito:** lee el mismo registro PRICE con horas de retraso y es una capa sobre el CSV, nunca un reemplazo: vale 24 horas, la tarjeta dice «Consultado hace X» y un reporte del CSV posterior a la consulta gana siempre. El teléfono no se emite, y la razón social y la dirección solo quedan como huella SHA-256 ([reglas y medición](evidencia-datos.md#consulta-web-de-facilito--medido-el-20092026)).
- **PRICE y J7:** el enlace PRICE de Facilito no ofrece una interfaz estructurada y J7 sigue fuera del producto ([evidencia](evidencia-datos.md#price-y-j7)).

### Detección barata de cambios

La URL canónica de `liquid-current` se comparte entre la adquisición y el probe (`app/source-catalog.mjs`). El detector (`app/validator-comparison.mjs` + `app/http-validator-probe.mjs`) compara ETag como valor opaco y Last-Modified sin descargar el cuerpo. Primero hace `HEAD` condicional; solo si el método no está soportado o una respuesta exitosa carece de validadores intenta `GET` con `Range: bytes=0-0` y cancela el cuerpo al recibir los headers. Un error HTTP definitivo no provoca una segunda petición. Ausencia, error, timeout o respuesta ambigua producen `unverifiable`, nunca `unchanged`.

La primera ejecución real, el 18/08/2026, consumió 0 bytes, y la detección quedó aceptada como viable con fallback seguro ([evidencia](evidencia-datos.md#detección-barata-de-cambios--ejecución-real-del-18082026)).

### Refresco seguro y promoción atómica

El refresco manual reproducible es `npm run refresh -- liquid-current`. Resuelve la fuente desde `app/source-catalog.mjs`, compara validadores, descarga solo si el estado es `changed`, escribe en un staging único, sella bytes y SHA-256, ejecuta el builder y sus contratos/joins, compara cobertura y excepciones contra el snapshot activo y solo entonces mueve el staging a `.local-cache/snapshots/<snapshot-id>/`. El pointer pequeño `.local-cache/snapshots/active.json` se actualiza con escritura + rename atómico; `npm run rollback -- <snapshot-id>` cambia únicamente ese pointer.

En el refresco correctivo del 18/08/2026 se fijó que un raw local solo se reutiliza si coinciden validators, bytes y SHA-256; el refresco de hoy no arrastra ni reancla identidad alguna ([evidencia](evidencia-datos.md#refresco-correctivo-del-18082026)).

Más tarde la promoción se amplió al contrato público v2: el staging construye y valida **Regular y Premium** contra una misma revisión antes de mover el pointer privado. Los guardrails comprueban por producto ofertas frescas/publicables, distritos, cobertura y conflictos; también exigen que avance `source_max_reported_at`. El manifest público común se escribe después de sus dos snapshots inmutables. `npm run rollback -- <snapshot-id>` reconstruye y valida el mismo par antes de cambiar el pointer. La simulación de runner limpio verificó `changed` con 714 Regular y 700 Premium, y luego `unchanged` con un HEAD y 0 bytes de raw.

**Un pointer por grupo (Fase 2B).** Desde que hay dos grupos, la carpeta del snapshot sigue siendo una sola —el raw y el minimizado traen todos los productos—, pero la decisión de usarla es de cada grupo:

- **Gasolina** conserva `active.json` y su significado de siempre: el último snapshot que Gasolina aprobó.
- **Diésel** tiene `active-diesel.json`.

El refresco construye los dos grupos con **una sola** pasada por el raw y juzga cada uno con su línea base y sus tolerancias. La carpeta se promueve si la aprueba al menos un grupo, y solo se mueven los pointers de los que la aprobaron: un CSV que Gasolina rechaza puede publicarse en Diésel, y al revés. Un grupo que se queda atrás espera al próximo CSV, sin ponerse al día solo, para no deshacer un rollback. `npm run rollback -- <snapshot-id> [<revisión>] --group diesel` mueve solo el pointer de Diésel y escribe solo `web/data/diesel`; sin `--group` es el rollback de Gasolina de siempre.

**Una fuente, un refresco (Fase 3A).** Desde GLP hay dos fuentes de precio (`pipeline/sources.mjs`), y cada una se refresca por su cuenta:

| Fuente | CSV | ID de fila | Grupos | Descarga máx. |
| --- | --- | --- | --- | ---: |
| `liquid-current` | `CL-Registro-precios-DMA-V-CCA-CCE.csv`, ~1,35 GB | `ID3` | Gasolina, Diésel, GNV | 60 min |
| `glp-current` | `GLP-Registro-precios-PIC-PE-V.csv`, ~0,74 GB | `ID4` | GLP | 30 min |

- **Cada fuente tiene lo suyo:** su línea base de detección, su descarga, su minimizado, sus grupos y sus pointers. Un refresco de una nunca lee ni mueve nada de la otra.
- **Pointer por fuente:** `source-<id>.json` guarda el último snapshot de la fuente que aprobó algún grupo.
  - Es la línea base de una fuente cuyos grupos todavía no tienen base propia.
  - Es la base de la primera activación de un grupo que no es de líquidos. En los líquidos, esa base sigue siendo el snapshot de Gasolina.
- **Orden y fallos:** `npm run refresh` recorre las dos fuentes bajo un solo lock, primero los líquidos; `npm run refresh -- glp-current` refresca solo una. El fallo de una fuente queda en su resultado como `rejected` y no detiene a la otra. Los campos de siempre del resultado hablan de los líquidos; `sources` trae los de cada fuente, y el resumen de CI los muestra en la tabla «Fuentes».
- **Referencia de Registro y GIS:** antes de descargar, el refresco exige que traiga los códigos y las capas de todos los grupos de la fuente. Con la semilla v1, GLP se rechaza sin bajar nada.
- **Recuperación:** el rollback, la adopción y la composición rechazan un snapshot de otra fuente antes de tocar un pointer.

**Grupos que se preparan en privado.** Un grupo sin vista en el catálogo público se adquiere y se juzga sin publicarse; hoy no queda ninguno ([detalle](evidencia-datos.md#grupos-que-se-preparan-en-privado-fase-3a)).

**Grupos publicados.** Diésel, GLP y GNV tienen estado, guardrails y rollback (`--group`) propios; sin versión publicada, cada uno se juzga contra su embudo auditado del 24/09/2026 ([Diésel](evidencia-datos.md#grupo-diésel--embudo-auditado-el-24092026), [GLP](evidencia-datos.md#grupo-glp--embudo-auditado-el-24092026-publicado-desde-la-fase-3b), [GNV](evidencia-datos.md#grupo-gnv--embudo-auditado-el-24092026-publicado-desde-la-fase-4)).

**Semilla de Registro y GIS.** Viaja como secret (`BOOTSTRAP_SEED_B64`) con las tablas del 14/08/2026, ampliadas sin refrescar; la vigente, v3, suma el Registro 59 que el refresco de los líquidos exige antes de descargar, y el cambio de secret y el push van seguidos ([v2](evidencia-datos.md#semilla-de-registro-y-gis-v2-fase-3a), [v3](evidencia-datos.md#semilla-v3-fase-4)).

**Poda de snapshots en CI.** Conserva por grupo publicado su producción y un destino de rollback con otro CSV, no borra nada si hay un refresco en curso o algo no se puede comprobar, y en local no se poda ([detalle](evidencia-datos.md#poda-de-snapshots-en-ci-fase-3a)).

## Registro, GIS y geografía

El snapshot minimizado del Registro contiene 17,742 autorizaciones de diez actividades. `REGISTRO` no siempre es fila-única; RUC identifica al titular, no a una sede, y no se conserva en derivados.

`N` es completo y único en las capas 34/35/36. La capa 31 no existe en el servicio observado. Las geometrías son válidas y están dentro de una caja conservadora de Perú. El servicio atribuye copyright a Osinergmin, pero no expone licencia explícita. Ese es un hecho de procedencia; el owner aprobó expresamente publicar las coordenadas GIS en el contrato público downstream. La atribución pública resultante es “Datos de precios y coordenadas: Osinergmin.”

Solapamientos exactos del snapshot, sin fuzzy matching:

| Join | Match | Estado |
| --- | ---: | --- |
| GIS 34 `N` ↔ Registro actividad 16 | 5,611/5,663 (99.082 %) | 1 uno-a-muchos |
| GIS 35 `N` ↔ Registro actividades 1/2/5/6 | 5,198/5,284 (98.372 %) | 7 uno-a-muchos |
| GIS 36 `N` ↔ Registro actividades 5/6/15/59 | 142/151 (94.040 %) | uno-a-uno en matches |
| GIS 28 `COD_OSINERGMIN` ↔ Registro actividad 20 | 109/117 (93.162 %) | uno-a-uno en matches |

Son relaciones candidatas del snapshot: los no-matches y la multiplicidad impiden declararlas universales.

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

La primera medición, del 23/08/2026, confirmó que la asignación debe ser bipartita; como cinco casos no son una tasa de precisión, publicar un tier exige una muestra auditada por el owner con cota inferior medida ([medición](evidencia-datos.md#google-maps-como-fuente-de-descubrimiento--primera-medición-del-23082026)).

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

Los hard negatives que midió el piloto del 17/08/2026 siguen vigentes —coordenada compartida, abanderamiento y dirección ambigua o compartida—, y la separación del piloto entre vínculo, permiso y frescura la sostiene hoy el catálogo sucesor ([hard negatives](evidencia-datos.md#hard-negatives-medidos-que-siguen-vigentes), [piloto](evidencia-datos.md#piloto-de-identidad-comercial--contrato-histórico)).

### Permiso de publicación campo por campo

El permiso no es uniforme: se evalúa campo por campo, contra la licencia real de su fuente.

| Campo | Veredicto | Base |
| --- | --- | --- |
| Precio, fecha de reporte, frescura, distrito | publicable | ODC-By declarado en las fichas de los datasets de precio |
| Coordenada | publicable | aprobación explícita del owner para el contrato público downstream; se conserva procedencia y atribución a Osinergmin |
| Distancia derivada | publicable | Haversine local a partir de coordenada cuya publicación fue aprobada |
| Dirección de la vía | publicable | admitida por el contrato público vigente, acotada a texto corto para la tarjeta |
| Razón social, RUC, representante | no se publica | la declaración ODC-By observada describe los datasets de precio, no columnas de identidad legal; además una razón social no es una marca |
| Identidad comercial (`brand`, `public_site_name`) | gobernada por el catálogo | entrada por entrada, con evidencia privada, vínculo exacto y fecha de verificación |

Esta tabla es el registro del permiso campo por campo; en código lo hacen cumplir la allowlist cerrada `PUBLIC_OFFER_FIELDS` (`pipeline/gasolina-contract.mjs`) y `publication.status` (`app/commercial-catalog.mjs`), y `unknown` es una cola accionable ([antecedente](evidencia-datos.md#piloto-de-identidad-comercial--contrato-histórico)).

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

El universo es la unión de códigos con oferta contractual en todos los productos publicados y se cuenta en cada corrida; con Registro y GIS fijados al 14/08/2026 no hay señal de cambio a nivel de entidad, así que 0 altas y 0 bajas son un piso ([medición](evidencia-datos.md#catálogo-canónico-de-entidades--cortes-del-1408-y-el-18082026)).

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

La cobertura inicial salió de la fuente de identidad autorizada el 23/08/2026; los 11 vínculos Repsol del piloto no pasan al sucesor sin revalidación autorizada ([antecedentes](evidencia-datos.md#catálogo-sucesor-y-cobertura-inicial)).

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
