# Roadmap de producto

Última revisión: 21 de agosto de 2026.

## Norte

`masfacil.pe` será una colección abierta de herramientas pequeñas para tomar decisiones cotidianas con datos públicos oficiales. Cada ruta debe responder una pregunta concreta con el camino confiable más corto, no convertirse en un portal general ni replicar la interfaz de la entidad fuente.

El patrón común es:

```text
fuente oficial → transformación auditable → snapshot público inmutable
→ frescura visible → cercanía calculada en el dispositivo → acción práctica
```

El proyecto es independiente y no está afiliado, aprobado ni producido por Osinergmin, Facilito, Minsa, Digesa ni otra entidad del Estado peruano.

## Reglas para aceptar una ruta

Una ruta entra a construcción solo si cumple estos criterios:

1. Responde una decisión concreta que una persona pueda tomar.
2. Las **observaciones dinámicas** de la ruta —precio, condición sanitaria, inspección— provienen de una fuente primaria oficial accesible de forma autorizada, reproducible y razonable en carga. Este requisito aplica a la observación que cambia, no a toda columna de la ruta.
3. Las **entidades estables** de la ruta —el establecimiento, la playa, la piscina, su nombre— pueden provenir de un catálogo canónico curado con evidencia registrada por nivel, incluida la observación humana. La ausencia de una fuente bulk licenciada para la entidad no descarta la ruta.
4. La fecha de observación o actualización puede conservarse y explicarse, y la fecha de verificación de la entidad se conserva por separado.
5. La geografía y la unidad de cada registro están claras.
6. El contrato puede distinguir dato observado, dato derivado y dato ausente sin fabricar cobertura, y admite cobertura parcial con fallback honesto.
7. El caso cabe primero en batch/ETL, JSON precomputado y PWA estática.
8. La atribución, los límites de uso y la no afiliación pueden publicarse con honestidad.
9. Es posible probar los errores silenciosos que cambiarían la decisión del usuario, en especial los de **atribución**: adjudicar una observación al establecimiento equivocado.

Una interfaz pública no basta como fuente de observaciones dinámicas. Si no existe descarga, API o servicio oficial reutilizable para ellas, el gate siguiente es descubrir y validar el acceso; no se autoriza por defecto el scraping de una web frágil, ni eludir controles de acceso, ni presentar como propio un dato que depende materialmente de contenido restringido.

Estas reglas no exigen automatización total ni una licencia bulk para cada campo. Exigen que cada dato declare su origen, su método y su fecha, y que el riesgo de atribución esté controlado.

## Forma prevista del producto

```text
masfacil.pe/
├── gasolina/       precio y cercanía de Regular y Premium
├── balones/        precio y cercanía de GLP envasado
├── playas/         condición sanitaria e inspección vigente
├── piscinas/       condición sanitaria e inspección vigente
└── agents/         contratos y documentación Markdown para agentes
```

La raíz podrá ser un catálogo breve de herramientas cuando exista una segunda ruta pública. No se construirá un sistema de cuentas, recomendaciones personalizadas ni un backend dinámico para sostener el catálogo.

Las capacidades compartidas serán pequeñas y explícitas:

- contratos públicos versionados por dominio;
- manifest activo pequeño y snapshots inmutables por ruta;
- edad recalculada al consultar, incluso offline;
- ubicación procesada en el navegador, sin enviarla a un servidor de `masfacil.pe`;
- atribución y enlace a la fuente en cada ruta;
- estados separados para disponible, desactualizado, no evaluado y no disponible;
- shell compartido solo donde reduzca complejidad real, sin acoplar los pipelines de fuentes distintas.

## Rutas comprometidas

### `/gasolina`

Primera versión pública. Responde: **¿dónde encuentro Gashol Regular o Premium cerca de mí y a qué precio reportado?**

El alcance inicial es Lima provincia. La publicación debe conservar producto, precio, unidad, fecha reportada, distrito, coordenadas, procedencia y atribución. La ubicación del usuario permanece local.

### `/balones`

Es la extensión preferida después de estabilizar la plataforma multi-ruta porque reutiliza conocimiento ya adquirido de Osinergmin. Debe responder: **¿qué puntos cercanos reportan GLP envasado y a qué precio/unidad exacta?**

Antes de construir se debe confirmar en el CSV oficial el universo, presentaciones, unidad comercial, cobertura geográfica y posibilidad de una comparación homogénea. No se inferirá reparto, stock ni disponibilidad.

### `/playas`

Debe responder: **¿qué playas de Lima provincia tienen una evaluación sanitaria vigente y cuáles están cerca?**

La ficha mínima propuesta incluye:

- calificación oficial sin reinterpretarla;
- resultado de calidad microbiológica, limpieza y servicios higiénicos cuando la fuente los exponga;
- fecha de inspección y edad al momento de consulta;
- distancia en línea recta y salida a navegación;
- enlace a la evaluación oficial.

No se tratará una playa ausente o no inspeccionada como “no saludable”. Tampoco se prometerán condiciones actuales del oleaje, seguridad, aforo o calidad fuera de lo observado por la fuente.

Minsa indica que la evaluación de playas usa tres criterios y se realiza semanalmente en verano y mensualmente el resto del año. También publica reportes semanales de vigilancia. Sin embargo, el 21 de agosto de 2026 la entrada anunciada de Verano Saludable redirigía al portal general de Minsa. Por ello, el acceso técnico estable es una hipótesis que debe probarse antes de diseñar el pipeline.

### `/piscinas`

Debe responder: **¿qué piscinas de uso colectivo tienen una evaluación sanitaria vigente cerca de mí?**

Comparte fuente y parte del adaptador de `/playas`, pero no su contrato semántico. Minsa describe para piscinas criterios de calidad del agua, limpieza, equipamiento/operatividad y documentación sanitaria. La ruta debe mostrar esos componentes por separado cuando estén disponibles y conservar la fecha de inspección.

No afirmará horario, precio de entrada, aforo, disponibilidad ni calidad presente más allá de la última evaluación oficial. Una piscina no evaluada o sin fecha interpretable no se convertirá en una opción “saludable”.

### `/agents`

Será una superficie estática de documentación y contratos para que un agente pueda consumir los datos sin deducir su semántica desde la UI. No será un runtime de agentes, un chatbot, un MCP ni una API dinámica.

Estructura inicial propuesta:

```text
/agents/index.md
/agents/gasolina.md
/agents/changelog.md
/llms.txt
```

Cada nueva ruta pública añadirá su documento en el mismo commit que publica su contrato:

```text
/agents/balones.md
/agents/playas.md
/agents/piscinas.md
```

Cada documento debe declarar:

- propósito y pregunta que permite responder;
- fuente primaria, atribución y no afiliación;
- alcance geográfico y temporal;
- URL del manifest activo y patrón de snapshot inmutable;
- versión del schema, campos, unidades y ejemplos mínimos;
- reglas de caché, reintento y detección de cambio;
- significado de estados ausentes, vencidos o no evaluados;
- transformaciones derivadas, incluido el cálculo de distancia;
- límites y afirmaciones que el consumidor no debe fabricar;
- historial de cambios incompatibles.

`llms.txt` funcionará como índice corto hacia esos documentos. Es una convención emergente y opcional, no una garantía de descubrimiento ni un estándar suficiente por sí solo. No hace falta publicar `llms-full.txt` mientras la documentación sea pequeña.

## Roadmap por capas

Cada capa mantiene un máximo de tres gates. Las fechas no se fijan hasta cerrar la capa anterior.

### Capa 2 — Identidad, reabierta

Capa 2 se cerró el 18 de agosto de 2026 con la conclusión de que no existía un subconjunto publicable útil. Esa conclusión describía el resultado de **una sola vía** —una fuente bulk automatizable y explícitamente licenciada— y no el agotamiento del problema. El owner la reabrió el **21 de agosto de 2026** con un tercer gate; es exactamente el mecanismo de reapertura que ahora exige el método.

Gate 2.3 no bloquea ni depende del cierre de Gate 4.3: opera sobre el catálogo y su contrato, no sobre el pipeline de publicación vigente.

| Gate | Hipótesis | Artefacto | Riesgo crítico | Salida observable |
| --- | --- | --- | --- | --- |
| 2.3 | Un catálogo canónico pequeño, anclado al código Osinergmin existente, puede publicar identidad reconocible sin inventarla ni exigir automatización total | Contrato sucesor, catálogo curado inicial y proyección mínima con fallback | Atribuir una identidad al establecimiento equivocado | Unión Regular/Premium medida, cobertura total declarada, muestra auditada sin vínculos incorrectos y fallback verificado |

Criterios de salida detallados:

- **Universo medido.** Una pasada sobre los datos privados reporta la unión de códigos Osinergmin con oferta contractual Regular/Premium. No se hereda el conteo de un producto.
- **Contrato sucesor.** Un schema versionado representa `owner_verified`, `first_party`, `public_web_observed`, `open_reusable` y `known_contributor`, con fuente o descripción, método, `observed_at`, `verified_at` y responsable privados. El schema del piloto permanece histórico.
- **Catálogo inicial tangible.** Una primera cobertura útil se cura con vínculo exacto al `establishment_id` existente. No se exige cobertura completa ni fuente bulk.
- **Proyección mínima.** El JSON público añade únicamente la identidad necesaria; no publica el expediente privado ni razón social, dirección o RUC.
- **Muestra auditada.** La selección y tamaño se declaran, no contiene vínculos incorrectos y conserva como negativos coordenada compartida, abanderamiento por razón social y dirección ambigua.
- **Cobertura y fallback.** Se reporta cobertura total. Una entrada no cubierta conserva el marcador neutral y la UI nunca infiere marca ni afiliación.

No bloquean Gate 2.3: automatizar el refresco de Registro/GIS, definir una cadencia definitiva, construir reportes comunitarios o medir equidad distrital. Esas capacidades se incorporarán solo cuando la operación o el uso real las justifiquen; un reporte anónimo futuro abrirá revisión y no modificará el catálogo por sí solo.

### Capa 4 — Primera publicación

| Gate | Hipótesis | Artefacto | Riesgo crítico | Salida observable |
| --- | --- | --- | --- | --- |
| 4.3 | `/gasolina` puede refrescarse y desplegarse de forma segura desde un runner limpio | PWA pública en Pages, workflow y smoke HTTPS | bootstrap o deploy no reproducible | URL pública, snapshot válido, online/offline y rollback verificados |

La ampliación a rutas no cambia ni bloquea el cierre de Capa 4.

### Capa 5 — Plataforma multi-ruta

| Gate | Hipótesis | Artefacto | Riesgo crítico | Salida observable |
| --- | --- | --- | --- | --- |
| 5.1 | Los contratos existentes pueden documentarse para agentes sin crear una API dinámica | `/agents/index.md`, `/agents/gasolina.md`, `llms.txt` y pruebas de enlaces/schema | divergencia entre docs y contrato real | un agente puede localizar, validar y explicar el bundle de gasolina solo con la documentación publicada |
| 5.2 | La fuente conocida de Osinergmin permite una vertical homogénea de GLP envasado | proyección ejecutable y piloto `/balones` para Lima provincia | mezclar presentaciones o unidades no comparables | universo, cobertura, unidad y ofertas válidas medidos; UI o descarte decidido con evidencia |
| 5.3 | Dos verticales pueden convivir sin duplicar navegación, caché ni contratos | raíz-catálogo y convención de rutas/datos con compatibilidad hacia atrás | invalidar URLs o cachés ya públicas | instalación, enlaces directos y offline de cada ruta funcionan de forma independiente |

### Capa 6 — Salud ambiental recreativa

| Gate | Hipótesis | Artefacto | Riesgo crítico | Salida observable |
| --- | --- | --- | --- | --- |
| 6.1 | Verano Saludable dispone de una fuente oficial reutilizable y suficientemente fresca | probe de bajo costo, contrato experimental y medición de playas/piscinas de Lima provincia | no existe acceso oficial estable distinto de la interfaz | endpoint/descarga, schema, fechas, coordenadas, cobertura, atribución y carga documentados; o ruta descartada sin scraping |
| 6.2 | La última inspección oficial permite decidir entre playas cercanas sin ocultar incertidumbre | `/playas` ejecutable con snapshot y estados honestos | confundir ausencia o antigüedad con calificación sanitaria | casos saludable/no saludable/no evaluada/desactualizada probados con corte visible y navegación funcional |
| 6.3 | El adaptador común puede sostener el contrato distinto de piscinas | `/piscinas` ejecutable y documentación de agente | perder criterios o identidad de una piscina al proyectar | cuatro componentes, fecha, cobertura y estados límite verificados; sin inferir horarios ni disponibilidad |

La radiación UV de Senamhi se investigará primero como contexto de `/playas`, no como ruta independiente. Solo se integrará si existe una fuente oficial reutilizable y si su granularidad se muestra correctamente; un pronóstico urbano no se presentará como medición de una playa específica.

### Capa 7 — Servicios urbanos cercanos

Esta capa no está comprometida. Comparará pilotos y construirá como máximo el que demuestre mayor utilidad y mejor fuente.

| Candidato | Decisión concreta | Fuente oficial conocida | Incertidumbre principal |
| --- | --- | --- | --- |
| `/cortes-agua` | ¿mi zona tiene una interrupción vigente y cuál es su alcance? | servicio de Sedapal para Lima y Callao | acceso reutilizable, geometría, frecuencia y semántica de inicio/fin |
| `/parques` | ¿qué área verde pública identificada queda cerca? | capas ArcGIS REST del Geoservidor de Minam | actualidad, acceso real y si “área verde” implica uso público |
| `/centros-salud` | ¿qué establecimiento cercano figura autorizado y para qué categoría? | directorio público y RENIPRESS de Susalud | ubicación, vigencia y riesgo de confundir registro con disponibilidad o calidad |

`/cortes-agua` es preferible a una ruta genérica `/agua`: mantiene clara la decisión y evita prometer calidad o continuidad que la fuente no mide. `/parques` tiene buen encaje static-first porque el servicio oficial admite JSON/GeoJSON y consultas geográficas, pero requiere validar primero la semántica de sus subcapas.

### Capa 8 — Backlog de mayor riesgo

Estas rutas solo avanzarán mediante un gate de descubrimiento independiente:

| Candidato | Valor posible | Razón para postergar |
| --- | --- | --- |
| `/medicamentos` | comparar precios reportados por farmacias y boticas autorizadas | alta sensibilidad sanitaria; exige identidad exacta por principio activo, concentración y presentación, además de una fuente reutilizable estable |
| `/aire` | mostrar la estación oficial cercana, contaminantes y edad del dato | continuidad de la red, granularidad espacial y mantenimiento; no se debe interpolar un barrio sin modelo válido |
| `/transporte` | encontrar información oficial reutilizable de rutas de Lima y Callao | planificación y tiempo real elevan mucho la complejidad; el portal ATU abierto no prueba por sí solo un feed adecuado |
| `/sismos` | explicar reportes oficiales recientes del IGP | no responde naturalmente al patrón de elegir una opción cercana y las alertas crearían una carga operativa de seguridad |

El Observatorio de Precios de Digemid confirma una necesidad real de comparación y filtros geográficos, pero la ruta no dará recomendaciones terapéuticas, sustituciones ni garantías de stock. RENIPRESS puede confirmar registro y categoría, no tiempos de espera, atención disponible ni calidad clínica.

## Orden recomendado

El orden combina reutilización, utilidad y riesgo de fuente:

1. Cerrar y observar `/gasolina` en producción.
2. Construir el catálogo canónico de identidad (Gate 2.3) sobre la ruta ya publicada.
3. Publicar `/agents` con el contrato real de gasolina, incluido el estado de identidad y su cobertura.
4. Medir `/balones` sobre la fuente ya conocida.
5. Ejecutar el descubrimiento común de Verano Saludable.
6. Construir `/playas` si la fuente supera el gate.
7. Reutilizar el adaptador para `/piscinas` sin mezclar sus criterios.
8. Comparar `/cortes-agua` y `/parques` como siguientes pilotos.
9. Evaluar una sola vertical de alto riesgo después de tener evidencia operativa multi-ruta.

El catálogo va antes que las rutas sanitarias por una razón de riesgo, no de comodidad: en `/playas` y `/piscinas` el daño atributivo deja de ser un precio equivocado y pasa a ser una calificación sanitaria adjudicada al lugar equivocado. Conviene que el método de identidad esté probado antes de esa capa.

## Contrato de commits

Este archivo es un documento vivo. Se actualiza cuando cambia la prioridad, aparece evidencia material de una fuente o una ruta supera o falla su gate; no se crea un reporte nuevo por cada investigación.

El commit que publique una ruta debe incluir, como una unidad revisable:

- adaptador/proyección y contrato versionado;
- validación de boundary y tests de errores silenciosos;
- PWA o artefacto consumible con estados de frescura y error;
- atribución, procedencia, límites y no afiliación;
- actualización de `README.md`, `docs/datos.md` y `docs/arquitectura.html` cuando corresponda;
- documento `/agents/<ruta>.md` y actualización de `/agents/index.md` y `llms.txt`;
- limpieza de `BITACORA.md` al cierre del gate;
- evidencia agregada o sanitizada suficiente para reproducir la decisión.

No se incluyen en Git los JSON públicos generados, snapshots, raw, minimizados, cachés, ubicaciones de usuarios, secretos ni copias personales de fuentes. La publicación de datos derivados sigue el patrón de snapshot inmutable más manifest activo pequeño.

## Fuentes primarias para los próximos gates

- Minsa, [Verano Saludable 2026](https://www.gob.pe/institucion/minsa/noticias/1330503-playas-y-piscinas-seguras-para-todos-minsa-lanza-campana-verano-saludable-2026).
- Minsa, [criterios para identificar una piscina saludable](https://www.gob.pe/institucion/minsa/noticias/686937-como-identificar-una-piscina-saludable).
- Digesa, [vigilancia sanitaria de playas 2026](https://www.digesa.minsa.gob.pe/dcovi/mapas/DIGESA_PLY_MR_VSPLY2026.html).
- Sedapal, [consulta de interrupciones actuales en Lima y Callao](https://www.gob.pe/35074-consultar-las-zonas-donde-hay-cortes-de-agua-en-lima-y-callao).
- Minam, [servicio ArcGIS REST de áreas verdes](https://geoservidorperu.minam.gob.pe/arcgis/rest/services/CS/Desarrollo_Urbano/MapServer/33).
- Digemid, [Observatorio de Precios de Medicamentos](https://www.digemid.minsa.gob.pe/webDigemid/notas/2026/ahorra-en-salud-conoce-donde-comprar-medicamentos-de-calidad-a-buen-precio-en-todo-el-peru-con-el-observatorio-de-precios-de-la-digemid/).
- Susalud, [directorio oficial de establecimientos de salud](https://www.gob.pe/establecimientosdesalud).
- ATU, [portal de datos abiertos](https://sistemas.protransporte.gob.pe/DatosAbiertos).
- Chrome for Developers, [`llms.txt` como convención emergente y opcional](https://developer.chrome.com/docs/lighthouse/agentic-browsing/llms-txt?hl=es-419).
- Cloudflare, [documentación Markdown para agentes](https://developers.cloudflare.com/docs-for-agents/).
