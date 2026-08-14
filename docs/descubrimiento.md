# Descubrimiento de Facilito

> Documento vivo de la Capa 0. Observa el producto público; no define la aplicación futura ni declara fuentes canónicas.
>
> Proyecto independiente y no oficial. No está afiliado, aprobado ni producido por Osinergmin, Facilito o el Estado peruano.

## Alcance y estado de la evidencia

Este documento describe la superficie pública de `facilito.gob.pe` observada sin autenticación el **2026-08-14** desde macOS y Chromium. La reproducción principal usó viewport desktop efectivo de **1280×720**; las comprobaciones responsive usaron viewports efectivos de **800×885** para la entrada territorial y **559×931** para una tabla. También se hicieron solicitudes HTTP directas, breves y seriales, con cookies separadas por caso.

La investigación partió de la navegación pública. No utilizó `fetch-gis.mjs`, `gis-osinergmin.json` ni conclusiones de otros agentes como evidencia. No se resolvió ni eludió reCAPTCHA, no se conservaron tokens o cookies y no se hizo crawling.

### Regla de medición

- **Acción:** clic, selección o envío deliberado que cambia el estado o navega. Scroll y lectura no cuentan.
- **Input:** dato elegido por el usuario; abrir una categoría no cuenta.
- **Primer resultado útil:** primera pantalla que permite comparar al menos una oferta real con vendedor y precio.
- Los conteos parten de la portada ya cargada. Los reintentos por error se informan por separado.
- Los conteos de filas describen únicamente el caso observado Lima → provincia Lima; no representan cobertura nacional.

## Qué producto se observa

**HECHO.** La portada se titula “Selecciona los productos a consultar” y presenta cuatro categorías: Diesel y Gasolinas, Gas Natural Vehicular, GLP Automotor y GLP Envasado. GLP Envasado se divide en Locales de Venta, Estaciones de Servicio, Plantas Envasadoras y Distribuidores en Cilindros.

**HECHO.** Las pantallas atribuyen los precios a reportes de los operadores mediante PRICE y piden denunciar diferencias ante Osinergmin. J7 muestra una fecha por fila para el último precio; J1–J6 no muestran fecha junto al precio.

**INFERENCIA (confianza alta).** El trabajo principal aparente es comparar vendedor y precio de un combustible o cilindro dentro de una ubicación administrativa. La interfaz no parte de ubicación actual ni ordena por distancia.

**PREGUNTA ABIERTA.** La mención y el enlace a PRICE no demuestran que sea la fuente inmediata o canónica de cada resultado; esa relación corresponde a Gate 0.2.

## Navegación pública

| Entrada visible | Destino observado | Journey | Diferencia material |
|---|---|---|---|
| Diesel y Gasolinas | `/facilito/pages/facilito/buscadorEESS.jsp` | J1 | Tres productos; precio en soles por galón. |
| Gas Natural Vehicular | `/facilito/pages/facilito/buscadorGNV.jsp` | J2 | Producto fijo GNV; precio en soles/m³. |
| GLP Automotor | `/facilito/pages/facilito/buscadorAGranelGLP.jsp` | J3 | Producto fijo GLP a granel; precio y unidad por fila. |
| GLP Envasado | `menuPrecios.jsp#services` | Ancla | Desplaza a los cuatro tipos de comercializador. |
| Locales de Venta | `buscadorEnvasadoGLP.jsp?tipoEnvasado=LV` | J4 | Tabla de cilindros con marca. |
| Estaciones de Servicio | `buscadorEnvasadoGLP.jsp?tipoEnvasado=ES` | J5 | Mismo schema visible, universo separado por tipo. |
| Plantas Envasadoras | `buscadorEnvasadoGLP.jsp?tipoEnvasado=PE` | J6 | Mismo schema visible, universo separado por tipo. |
| Distribuidores en Cilindros | `/facilito/actions/PreciosMinoristaAction.do?method=inicioGLP&GLPproducto=EN` | J7 | Precio anterior, último precio y fecha por fila. |

Entradas secundarias observadas: sitio de Osinergmin, correo de atención y enlace oficial “Acceso a la Base de Datos del Registro de información de precios (PRICE)” en el footer. No se observaron login, cuenta, compra, reserva o pago.

## Cobertura ejecutada

| ID | Caso reproducido | Acciones / inputs | Universo observado | Primera oferta visible |
|---|---|---:|---:|---|
| J1 | Lima → prov. Lima → Gasohol Regular (`126`) | 4 / 3 | 726 filas | Villa El Salvador · Petrosur · S/ 17.89/galón |
| J2 | Lima → prov. Lima → GNV (`131`, fijo) | 3 / 2 | 272 filas | La Victoria · Grifos Ges · S/ 1.50/m³ |
| J3 | Lima → prov. Lima → GLP a granel (`49`, fijo) | 3 / 2 | 432 filas | La Victoria · Servicentro Tacna 2 · S/ 5.99 · “Galones” |
| J4 | Local de Venta → Lima → prov. Lima → 10 kg (`52`, predeterminado) | 3 / 2 | 553 filas | Surquillo · Masgas · Solgas · S/ 36.40 |
| J5 | Estación de Servicio → Lima → prov. Lima → 10 kg (`52`, predeterminado) | 3 / 2 | 172 filas | San Martín de Porres · Z Gas · S/ 37.00 |
| J6 | Planta Envasadora → Lima → prov. Lima → 10 kg (`52`, predeterminado) | 3 / 2 | 42 filas | Lurigancho · Ambo Gas · S/ 28.50 |
| J7 | Lima → prov. Lima → 10 kg (`52`) | 4 / 3 | 444 filas | Mega Gas · Yapa Gas · fecha 04/12/2023 · último S/ 21.19–48.31 |

**HECHO.** Los siete journeys produjeron oferta real. En todos, la primera página visible estuvo en orden no decreciente del precio usado como referencia y todas las columnas hoja tenían `sorting_disabled`; el usuario puede buscar y cambiar entre 10/20/50 filas, pero no elegir otro orden desde los encabezados.

## Fichas comparables

### J1 — Diesel y Gasolinas

- **Intención inferida:** comparar estaciones o grifos para Gasohol Regular, Gasohol Premium o DB5 S-50 UV.
- **Precondición observada:** departamento; provincia y producto fueron necesarios para el caso reproducido. Distrito quedó en `9999999`.
- **Output:** Distrito, Establecimiento, Dirección, Teléfono y Precio de Venta (Soles por galón).
- **Comparación:** búsqueda textual, 10/20/50 filas y primera página 17.89–18.37; no permite reordenar.
- **Frescura:** no existe fecha junto al precio ni fecha global visible.

### J2 — Gas Natural Vehicular

- **Intención inferida:** comparar estaciones y precio de GNV por geografía.
- **Precondición observada:** departamento y provincia; el producto `131` aparece seleccionado sin acción adicional.
- **Output:** Distrito, Establecimiento, Dirección, Teléfono y Precio de Venta (Soles/m³).
- **Comparación:** búsqueda, 10/20/50 filas y primera página 1.50–1.58; no permite reordenar.
- **Frescura:** no existe fecha junto al precio.

### J3 — GLP Automotor

- **Intención inferida:** comparar puntos de venta de GLP para vehículo.
- **Precondición observada:** departamento y provincia; producto `49` fijo.
- **Output:** Distrito, Establecimiento, Dirección, Teléfono, Precio de Venta (Soles) y Unidad de Medida. Las diez primeras filas indicaron “Galones”.
- **Comparación:** búsqueda, 10/20/50 filas y primera página 5.99–6.15; no permite reordenar.
- **Frescura:** no existe fecha junto al precio.

### J4–J6 — GLP envasado por tipo de comercializador

- **Intención inferida:** comparar marca, establecimiento y precio de un cilindro dentro de un tipo de vendedor.
- **Precondición observada:** departamento y provincia; 10 kg quedó seleccionado por defecto. J4 y J6 ofrecen 3/5/10/15/45 kg; J5 solo 10 kg en la respuesta observada.
- **Output común observado:** Distrito, Marca, Establecimiento, Dirección, Teléfono y Precio de Venta (Soles).
- **Comparación:** búsqueda y 10/20/50 filas; primera oferta S/ 36.40 en J4, S/ 37.00 en J5 y S/ 28.50 en J6; no permite reordenar.
- **Frescura:** no existe fecha junto al precio.

### J7 — Distribuidores en Cilindros

- **Intención inferida:** comparar distribuidores, marcas y rangos de precio de cilindros.
- **Precondición observada:** departamento, provincia y tamaño de envase.
- **Output:** Distribuidor, Marca, Teléfono, precio anterior (mínimo/máximo) y último precio reportado (fecha/mínimo/máximo).
- **Comparación:** búsqueda y 10/20/50 filas; no permite reordenar. El rango mínimo/máximo agrega incertidumbre sobre la condición concreta de venta.
- **Frescura:** existe fecha por fila y su distribución es un riesgo material, detallado abajo.

## Frescura y calidad visible de J7

Se recorrieron las 444 filas con DataTables en páginas de 50, sin solicitudes adicionales de negocio. La antigüedad se calculó contra **2026-08-14**, en días UTC enteros. Los percentiles usan interpolación R7.

| Métrica | Resultado |
|---|---:|
| Antigüedad mínima / P25 / mediana / P75 / máxima | 3 / 98 / 387 / 861.5 / 1191 días |
| Más de 180 días | 291/444 (65.5 %) |
| Más de 365 días | 224/444 (50.5 %) |
| Fechas por año | 2023: 67 · 2024: 111 · 2025: 90 · 2026: 176 |
| Etiquetas distintas de distribuidor | 148 (no equivalen a entidades verificadas) |
| Duplicados exactos | 36 grupos; 121 apariciones; 85 filas excedentes |
| Rango visible “precio anterior” | mínimo: S/ 0.00–71.00 · máximo: S/ 0.00–80.00 |
| Rango visible “último precio” | mínimo: S/ 21.19–208.20 · máximo: S/ 22.00–208.20 |

**HECHO.** La primera fila mostró precio anterior S/ 0.00–0.00 y último precio S/ 21.19–48.31, con fecha 04/12/2023. Los valores cero, los extremos altos y los duplicados son anomalías visibles que requieren interpretación; no se los clasifica como errores sin semántica oficial.

**RIESGO P0.** La mitad del universo observado tiene un último reporte de más de un año. Además, J1–J6 no exponen fecha por precio. Cualquier afirmación de vigencia o comparación temporal requiere resolver esta incertidumbre antes de cerrar la factibilidad de Capa 0.

La evidencia agregada y sanitizada está en `evidence/j7-lima-10kg-2026-08-14.json`; excluye nombres, marcas, teléfonos y filas crudas. `node scripts/analyze-j7-snapshot.mjs` recalcula conteos, percentiles, duplicados y assertions.

## Ubicación y accesibilidad observable

**HECHO.** No se observó control “usar mi ubicación” ni solicitud de geolocalización. La selección es administrativa y manual.

**HECHO en HTML servido.** Las entradas J1–J6 contienen 24 `<area>` con `alt` y `title`, no 25. El mapa omite Callao (`70000`). El select contiene 26 opciones: placeholder más 25 territorios, incluido Callao. Los dos controles no ofrecen el mismo universo.

**HECHO en DOM transformado.** Cuando Mapify se inicia con popover, `_initSingleZone` ejecuta `removeAttr("alt")`, copia `title` a `data-title` y luego ejecuta `removeAttr("title")`. El DOM resultante tiene 24 áreas sin `alt`, `title` ni `aria-label`. El `<select id="departmento">` tampoco tiene `label`, `aria-label` o `aria-labelledby`.

**RIESGO.** En desktop el mapa es el control territorial visible y Callao no es seleccionable allí. En mobile se muestra el select, que sí incluye Callao, pero continúa sin nombre accesible. Esto no sustituye una auditoría WCAG completa.

## Desktop y responsive

| Aspecto | Desktop observado | Debajo de 992 px |
|---|---|---|
| Viewport efectivo | 1280×720 | 800×885 en entrada; 559×931 en tabla J1 |
| Selector territorial | Mapa visible; wrapper del select oculto | A 800 px, mapa `display:none`; wrapper `display:block`; select 696×38 px |
| Territorios | 24 áreas; falta Callao | 26 opciones: placeholder + 25 territorios; incluye Callao |
| Accesibilidad | Mapify deja 0/24 áreas con nombre accesible | Select visible, pero 0 labels y sin ARIA name |
| Tabla J1 | Tabla completa dentro de layout desktop | Tabla 629.13 px dentro de contenedor de 559 px; `scrollWidth` 641 px; 82 px de scroll horizontal interno |
| Overflow de página | No medido como problema | Documento 559/559 px: sin overflow global; el precio comienza en x=576.51 y requiere scroll interno |

**HECHO.** `style.css` cambia los controles en `@media (max-width: 991px)`: oculta `.mapaperu` y muestra `.mobile-nav-toggle`. Las medidas anteriores verifican ese comportamiento en el navegador; no son una inferencia solo desde CSS.

## Estados alternativos y recuperación

| Estado | Evidencia observada |
|---|---|
| Oferta válida | 7/7 journeys, con los universos del caso Lima indicados arriba. |
| Estado intermedio vacío | Antes de completar filtros, las tablas pueden indicar 0 registros; no se interpreta como ausencia de oferta. |
| Token reCAPTCHA vacío | POST inicial J1 y POST J7 respondieron 302 a su entrada, cuerpo de 0 bytes y sin mensaje propio. |
| Error de transporte del navegador | Se observaron `ERR_TIMED_OUT` tanto en GET puros como en algunos POST; la recuperación visible fue la página del navegador. |
| Recuperación del producto | Los filtros permanecen cuando la transición completa; el rebote 302 restablece la entrada sin explicar la causa. |

El 302 con token vacío fue reproducido en dos handlers, en 0.203 s (J1) y 0.264 s (J7). Esto demuestra un fallo de comunicación de error, no que reCAPTCHA explique los timeouts: también fallaron GET que no llevan token.

## Disponibilidad HTTP frente a comportamiento del navegador

Las observaciones se separan porque miden clientes y rutas distintas:

- **HTTP directo con UA de navegador:** 10/10 GET a portada/J1 respondieron 200 en 0.043–0.174 s. En una segunda pasada por las siete entradas hubo 6/7 éxitos; J5 agotó 10 s durante TLS y el reintento inmediato respondió 200 en 0.057 s.
- **HTTP directo sin UA:** 2/2 solicitudes (portada y CSS) respondieron 403 en 0.036 s. Se registra como filtrado por perfil de request, sin inferir su política.
- **Navegador:** 20 navegaciones GET iniciales realizadas durante los journeys y responsive produjeron 16 cargas y 4 `ERR_TIMED_OUT`. Los reintentos internos bloqueados desde una página `data:` de error no se contaron como requests.

**CONCLUSIÓN ACOTADA.** Las páginas estaban disponibles por HTTP durante las muestras y el navegador sufrió fallos esporádicos. No hay evidencia para afirmar “el sitio estuvo caído” ni para medir disponibilidad general.

## Frontera técnica pública observada

### Rutas, formularios y métodos

| Journey | Entrada / handler inicial | Transporte verificado | Handler posterior |
|---|---|---|---|
| J1 | `buscadorEESS.jsp` → `PreciosCombustibleAutomotorAction.do?method=inicio` | Form inicial POST URL-encoded; token generado por la página | `PreciosCombustibleAutomotorAction.do` |
| J2 | `buscadorGNV.jsp` → `PreciosGNVAction.do?method=inicio` | Form inicial POST | `PreciosGNVAction.do` |
| J3 | `buscadorAGranelGLP.jsp` → `PreciosGLPAction.do?method=inicio` | Form inicial POST | `PreciosGLPAction.do` |
| J4–J6 | `buscadorEnvasadoGLP.jsp?tipoEnvasado=LV|ES|PE` → `PreciosGLPAction.do?method=inicio` | Form inicial POST; conserva `GLPproducto=EN` y tipo | `PreciosGLPAction.do` |
| J7 | `PreciosMinoristaAction.do?method=inicioGLP&GLPproducto=EN` | GET de entrada; filtros en form POST | `PreciosMinoristaAction.do` |

Los formularios posteriores se llaman `PreciosForm`, declaran `method="POST"` y tienen un campo oculto `method`. Los `onchange` asignan `cambiarDepartamento`, `cambiarProvincia`, `cambiarDistrito` o `cambiarProducto`, actualizan los códigos seleccionados y envían el formulario. `9999999` funciona como sentinel visible de “sin selección” en estos recorridos.

Campos iniciales observados: `departamento_elegido`, `nameRedirectfile`, campos de tipo/producto cuando aplican y `g-recaptcha-response`. No se publican valores de token, cookies ni identificadores de sesión.

### Render y DataTables

**HECHO.** Cada cambio de filtro material produjo navegación de documento HTML; no apareció XHR/fetch de precios. La página invoca `initDataTable(...)` sin configuración `ajax` o `serverSide`. El resultset completo llega con el documento y DataTables pagina en cliente: J1 mostró “1 a 10 de 726” con 10 `<tr>` en el DOM renderizado; equivalentes 272/432/553/172/42/444 para J2–J7. Cambiar J7 a 50 filas y recorrer 9 páginas no generó una nueva consulta de negocio.

**RIESGO.** Una consulta geográfica puede transportar centenares de filas en una respuesta. Los handlers `.do` son implementación pública observada, no una API estable ni una fuente canónica demostrada.

## Fricción medible

| Dimensión | Observación |
|---|---|
| Acciones | J1/J7: 4; J2–J6: 3 hasta primera oferta útil. |
| Inputs | J1/J7: 3; J2–J6: 2. Productos fijos o 10 kg predeterminado no cuentan como input. |
| Comparación | Búsqueda y 10/20/50 filas en los siete journeys; sin orden seleccionable ni comparación fijada entre ofertas. |
| Geografía | Selección administrativa; sin ubicación actual, distancia o coordenadas visibles. |
| Unidades | J1 S/ por galón; J2 S/m³; J3 separa soles y unidad “Galones”; J4–J7 usan tamaño de envase y soles. |
| Frescura | J7 tiene fecha, pero mediana 387 días; J1–J6 no muestran fecha por precio. |
| Estado de error | Token vacío produce rebote silencioso; errores de transporte salen del contexto del producto. |
| Mobile | Intercambio mapa/select funcional bajo 992 px; asimetría territorial y etiqueta accesible ausente. |

## Afirmaciones, riesgos y preguntas

- **HECHO:** existen siete journeys materiales y un ancla de agrupación.
- **HECHO:** los siete journeys entregaron oferta para un caso Lima/provincia Lima; eso no demuestra cobertura de otros lugares o productos.
- **HECHO:** J7 expone fechas y problemas visibles de antigüedad, duplicados y extremos; J1–J6 no exponen fecha junto al precio.
- **INFERENCIA (alta):** el producto soporta una decisión local por producto, vendedor y geografía administrativa.
- **RIESGO P0:** procedencia, vigencia y cobertura pueden invalidar una comparación confiable si no se resuelven.
- **RIESGO:** los códigos de producto, territorio y tipo son observados, pero su estabilidad y semántica oficial no están demostradas.
- **RIESGO:** etiquetas repetidas no son identificadores de entidad; no se usó fuzzy matching.

Preguntas prioritarias para Gate 0.2, sin iniciarlo aquí:

1. ¿Qué fuente oficial alimenta cada journey y qué timestamp representa la vigencia del precio?
2. ¿Qué identificador oficial estable existe para establecimientos, distribuidores y reportes?
3. ¿Qué cobertura y antigüedad presentan otros departamentos/productos, con una muestra definida antes de medir?
4. ¿Cómo deben interpretarse rangos, ceros, duplicados y valores extremos de J7?
5. ¿Los códigos geográficos/producto y `LV|ES|PE|EN` tienen un catálogo oficial y estabilidad documentada?
6. ¿La base PRICE enlazada ofrece descarga o interfaz pública soportada y con qué licencia/frecuencia?

## Procedimiento de reproducción

1. Abrir la portada oficial sin autenticación y seguir únicamente los links visibles.
2. Para J1–J6, esperar a que la página genere su token invisible y seleccionar Lima; para J7, abrir su action de entrada.
3. Seleccionar provincia Lima; en J1 elegir Gasohol Regular y en J7 elegir 10 kg. Registrar valores predeterminados sin contarlos como inputs.
4. Anotar encabezados, mensaje DataTables, primera página, controles de búsqueda/longitud, clases de orden y URL/form tras cada transición.
5. Para J7, elegir 50 filas, recorrer las nueve páginas y agregar fechas y multiplicidades. No conservar tokens, cookies, teléfonos o filas crudas.
6. Recalcular el snapshot: `node scripts/analyze-j7-snapshot.mjs`. Para otro corte: `node scripts/analyze-j7-snapshot.mjs evidence/j7-lima-10kg-2026-08-14.json 2026-08-13`.
7. Para mobile, aplicar viewport menor a 992 px después de abrir el tab y medir `innerWidth`, displays, opciones, dimensiones y `scrollWidth` real.
8. Para HTTP, usar muestras pequeñas con timeout, UA explícita y cookie jar temporal; informar por separado HTTP y navegador.

## Fuentes primarias observadas

- Portada: <https://www.facilito.gob.pe/facilito/pages/facilito/menuPrecios.jsp>
- Diesel y Gasolinas: <https://www.facilito.gob.pe/facilito/pages/facilito/buscadorEESS.jsp>
- GNV: <https://www.facilito.gob.pe/facilito/pages/facilito/buscadorGNV.jsp>
- GLP Automotor: <https://www.facilito.gob.pe/facilito/pages/facilito/buscadorAGranelGLP.jsp>
- GLP envasado: `buscadorEnvasadoGLP.jsp?tipoEnvasado=LV|ES|PE`.
- Distribuidores: `PreciosMinoristaAction.do?method=inicioGLP&GLPproducto=EN`.
- Activos que gobiernan responsive/accesibilidad: `/facilito/assets/css/style.css` y `/facilito/assets/js/jquery.mapify.js`.
- PRICE: enlace oficial visible en el footer; su contenido no fue investigado en este gate.

## Límites

- Solo se midió un caso geográfico por journey; ningún conteo se extrapola a cobertura nacional.
- Las muestras HTTP y de navegador son diagnósticas, no una medición de disponibilidad.
- El snapshot J7 conserva agregados recalculables, no el HTML ni filas crudas; no permite reconstruir identidades.
- Responsive se comprobó en la entrada territorial y tabla J1, no en cada pantalla del sitio.
- No se verificaron fuente canónica, licencia, identificadores, joins, coordenadas o semántica regulatoria.
- No se diseñó la aplicación futura ni se eligieron framework, base de datos o arquitectura de producción.
