# Factibilidad medida y contrato experimental

Estado: conocimiento vigente de Capa 0 y contrato de Gate 1.1, medido el 14 de agosto de 2026 (America/Lima). Integra el [producto observado](descubrimiento.md) y las [fuentes oficiales](datos.md); define un experimento privado, pero no construye UI ni el vertical slice.

## Veredicto

**GO CON LÍMITES únicamente para un experimento privado, mobile-first, de J1 en Lima provincia, desde una ubicación actual real o simulada.** La evidencia permite probar si presentar conjuntamente precio, distancia y frescura mejora una decisión frente a Facilito. No autoriza un producto público, publicación de datos, expansión a otros journeys ni elección de UI, framework, base de datos o pipeline.

El norte público continúa bloqueado: **0/7 journeys** dispone de una fuente oficial y determinística para el nombre comercial reconocible del establecimiento. En el experimento privado, razón social y dirección pueden usarse como identidad provisional, siempre rotuladas como tales y nunca como nombre comercial. J7 permanece excluido porque el CSV GLP vigente no explica su oferta pública.

## Evidencia y método

`node scripts/analyze-gate-0.3.mjs` recorre íntegramente los snapshots minimizados e íntegros del 2026-08-14 y genera `evidence/feasibility-2026-08-14.json`. Conserva particiones por journey, actividad, producto y departamento, sensibilidad del embudo, no-matches, ambigüedades, conflictos y extremos, sin filas identificables. El corte se deriva del fin real de la última adquisición vigente: `2026-08-14T11:32:44.301-05:00`.

La evidencia `OWNER-VERIFIED` de EVPC permanece externa y separada: snapshot 2026-08-12, 17,472 observaciones y 5,685 establecimientos. No hay artefacto local para recalcularla ni se repitieron sus joins.

## Unidad de oferta y selección

Los CSV vigentes son históricos. En líquidos, 15,435/15,640 claves J1 y 361/373 claves J2 tienen múltiples timestamps; en GLP sucede en 5,630/6,504 claves J4, 1,161/1,269 J5 y 760/814 J6.

- Líquidos: `Registro × actividad × producto × unidad`.
- GLP: `Registro × actividad × producto × tipo de cliente × MARCA × unidad`.
- Selección: máximo `FECHA_DE_REGISTRO`; si el máximo contiene precios distintos, la oferta queda como conflicto y no se elige.
- Política conservadora: precio numérico positivo, fecha interpretable, antigüedad no negativa y `<=30 días`. Actividad o precio distinto de cero no significan stock.

`MARCA` distingue producto o envasadora, no nombre comercial del punto. Se preservaron 20 conflictos de último precio en J4, 4 en J5 y 115 en J6. Descontados los conflictos, hubo **0 precios últimos inválidos o no positivos**; el artefacto los etiqueta por separado.

## Cadena exacta por actividad y journey

La geografía directa se deriva de la actividad, no del journey completo:

- GIS 35: estaciones/grifos, estaciones con GLP, estaciones GLP+GNV y estaciones GNV.
- GIS 36: establecimientos de venta GNV, gasocentros GLP y combinaciones gasocentro+EVP GNV.
- GIS 34: locales de venta de cilindros.
- GIS 28: plantas mediante `Registro.CODIGO_OSINERGMIN`.

Los conjuntos `N` de las capas 34, 35 y 36 son disjuntos en este snapshot. La corrección por actividad reproduce J2 `281/283` y J3 `1,689/1,711`; el análisis anterior por journey los subestimaba.

| Journey | Precio → autorización → geografía | Ofertas | `<=30 d` | Registro exacto | Geo sobre Registro | Identidad reconocible | Alcance |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| J1 | Líquidos → act. 1/2/5/6 → GIS 35 según actividad | 15,640 | 13,662 | 13,287 | 12,954/13,287 (97.49 %) | 0 | experimento privado |
| J2 | Líquidos → act. 5/6/15/59 → GIS 35/36 según actividad | 373 | 304 | 283 | 281/283 (99.29 %) | 0 | no seleccionado |
| J3 | GLP-G → act. 2/6/15 → GIS 35/36 según actividad | 1,961 | 1,750 | 1,711 | 1,689/1,711 (98.71 %) | 0 | no seleccionado |
| J4 | Cilindros → act. 16 → GIS 34 | 6,504 | 3,816 | 3,785 | 3,684/3,785 (97.33 %) | 0 | no seleccionado |
| J5 | Cilindros → act. 1/2/6 → GIS 35 | 1,269 | 941 | 924 | 909/924 (98.38 %) | 0 | no seleccionado |
| J6 | Cilindros → act. 20 → código → GIS 28 | 814 | 461 | 455 | 429/455 (94.29 %) | 0 | no seleccionado |
| J7 | GLP act. 13 → Registro act. 13 → sin capa observada | 8 | 0 | 0 | 0 | 0 | excluido |

“Identidad reconocible = 0” no es una medición de filas: el JSON la clasifica como **constante de política no medida**, derivada de la ausencia estructural de una fuente oficial observada.

La cadena EVPC owner-verified aporta un control independiente: Registro exacto 5,659/5,685; geografía segura 5,345/5,685; y 5,345/5,440 (98.25 %) al excluir 144 grifos flotantes y 101 rurales. Santiago de Surco dio 28/28. `MARCA` estaba vacía en 17,472/17,472.

## Frescura y sensibilidad del embudo

Distribución acumulada de la observación seleccionada:

| Journey | `<=1 d` | `<=7 d` | `<=30 d` | `<=90 d` | `<=365 d` |
| --- | ---: | ---: | ---: | ---: | ---: |
| J1 | 21.38 % | 80.58 % | 87.35 % | 91.32 % | 100 % |
| J2 | 26.81 % | 79.36 % | 81.50 % | 86.60 % | 100 % |
| J3 | 28.15 % | 86.69 % | 89.24 % | 92.25 % | 100 % |
| J4 | 13.50 % | 37.46 % | 58.85 % | 78.16 % | 100 % |
| J5 | 18.81 % | 67.35 % | 74.39 % | 79.84 % | 100 % |
| J6 | 8.01 % | 54.36 % | 65.95 % | 87.70 % | 100 % |
| J7 | 0 % | 0 % | 0 % | 87.50 % | 100 % |

Porcentaje de ofertas con precio utilizable que completa `fecha → Registro exacto → coordenada`:

| Journey | `<=30 d` | `<=90 d` | Sin límite de edad |
| --- | ---: | ---: | ---: |
| J1 | 82.83 % | 83.47 % | 84.08 % |
| J2 | 75.34 % | 77.75 % | 86.06 % |
| J3 | 86.13 % | 86.74 % | 87.46 % |
| J4 | 56.82 % | 74.69 % | 91.78 % |
| J5 | 71.86 % | 74.94 % | 87.59 % |
| J6 | 61.37 % | 82.55 % | 91.56 % |
| J7 | 0 % | 0 % | 0 % |

`<=30 días` se mantiene como política conservadora y coherente con la ventana de publicación de Facilito. El artículo 18 no define qué ocurre después del vencimiento: una observación `>30 d` es antigua y no se mostraría bajo esta política, pero **no equivale automáticamente a precio falso**.

EVPC owner-verified fue más fresco en otro universo: 55 % `<=24 h`, 91 % `<=7 d`, 97 % `<=30 d` y 506 filas raw `>30 d`. No se mezcla con las particiones reproducidas del CSV.

Las diferencias territoriales y categorías especiales se conservan en el JSON. En J1, flotantes y rurales tienen 29/42 (69.05 %) y 65/120 (54.17 %) ofertas `<=30 d`, respectivamente, y 0 Registro bajo las actividades urbanas seleccionadas.

## Contraste público acotado

Se reutilizaron los siete resultados públicos de Gate 0.1, sin nuevas consultas. “Oferta” y “fila pública” no se declaran equivalentes:

| Journey | Filas públicas | Ofertas reconstruidas `<=30 d` | Establecimientos | Diferencia absoluta contra filas públicas | Supuesto material |
| --- | ---: | ---: | ---: | ---: | --- |
| J1 | 726 | 715 | 715 | 1.52 % | una fila por establecimiento/producto |
| J2 | 272 | 233 | 232 | 14.34 % | UI S/m³; reconstrucción conserva una condición adicional en kg |
| J3 | 432 | 445 | 445 | 3.01 % | UI observada en galones; se agrega GLP-G del territorio |
| J4 | 553 | 549 | 335 | 0.72 % | la columna Marca hace plausible, no demuestra, establecimiento×marca |
| J5 | 172 | 177 | 142 | 2.91 % | mismo schema visible que J4 |
| J6 | 42 | 51 | 22 | 21.43 % | mismo schema visible que J4 |
| J7 | 444 | 0 | 0 | 100 % | rango público incompatible con oferta puntual CSV |

La cercanía numérica de J1/J3/J4/J5 no demuestra linaje técnico ni igualdad de grano. J7 permanece excluido: el CSV contiene 38 filas históricas y 4 Registros para distribuidores, con 0 ofertas frescas en el caso controlado.

## Identidad, regulación y reutilización

**EVIDENCIA EXTERNA DE REVISIÓN, 2026-08-14.** El formulario RHO y el schema público del Padrón Reducido SUNAT no incluyen nombre comercial. La consulta individual SUNAT que sí puede exponerlo requiere CAPTCHA y queda fuera del acceso permitido. La ausencia de identidad reconocible en fuentes bulk legítimas es, por tanto, estructural para el alcance observado; razón social y dirección siguen siendo identidad provisional, no sustitutos semánticos.

La RCD 256-2021-OS/CD vincula funcionalmente PRICE, SCOP y la publicación en Facilito —artículo 4—, pero no demuestra que estos CSV sean el origen técnico inmediato de cada journey. El artículo 18 aporta la ventana de 30 días y guarda silencio sobre el estado posterior.

Los catálogos de precios declaran ODC-By. En contraste, el FeatureServer GIS expone `copyrightText: "OSINERGMIN"` sin licencia explícita y no se verificó licencia de EVPC; su reutilización pública permanece ambigua. Esto no impide investigación local, pero sí bloquea asumir permiso de publicación.

Una actualización completa observada descargó 1,557,769,613 bytes en 95.937 s. Una descarga diaria implicaría 43.524 GiB/30 días. Se observaron rangos, `ETag` y `Last-Modified`, pero no `304`, API incremental, SLA ni contrato de estabilidad.

## Matriz homogénea

Criterios: frescura alta `>=80 %` a 30 días, limitada `50–<80 %`, insuficiente `<50 %`; geografía alta `>=95 %` sobre Registro exacto, limitada `80–<95 %`; identidad reconocible es obligatoria para publicación.

| Journey | Valor inferido | Frescura | Registro | Geografía | Identidad pública | Riesgo dominante | Decisión |
| --- | --- | --- | --- | --- | --- | --- | --- |
| J1 | alto | alta | alta | alta salvo especiales | insuficiente | identidad/licencia | GO CON LÍMITES privado |
| J2 | alto | alta | limitada | alta | insuficiente | contraste/unidad | no seleccionado |
| J3 | alto | alta | alta | alta | insuficiente | identidad/licencia | no seleccionado |
| J4 | alto | limitada | alta | alta | insuficiente | sensibilidad temporal | no seleccionado |
| J5 | medio | limitada | alta | alta | insuficiente | identidad/frescura | no seleccionado |
| J6 | medio | limitada | alta | limitada | insuficiente | conflictos/frescura | no seleccionado |
| J7 | alto | insuficiente | insuficiente | inexistente | insuficiente | fuente no demostrada | excluido |

## Poblaciones reproducidas de Gate 1.1

`node scripts/build-gate-1.1.mjs` aplica una lista cerrada: actividades 1/2/5/6 urbanas, `PRODUCTO=GASOHOL REGULAR`, `UNIDAD=Galones`, territorio literal departamento/provincia `LIMA/LIMA`, cualquier distrito, último precio por oferta y antigüedad `0..30 días`. Después exige `ACTIVIDAD→SOURCE_ACTIVITY + REGISTRO` con cardinalidad uno y `REGISTRO→GIS 35.N` con cardinalidad uno, coordenada segura y departamento, provincia y distrito exactos concordantes en precio, Registro y GIS. No normaliza texto, no usa fuzzy matching y excluye flotantes y rurales.

Los granos permanecen separados: fila fuente = `ID3`; oferta = `Registro × actividad × producto × unidad` con máximo `FECHA_DE_REGISTRO`; establecimiento = `Registro`. La salida no expone esos identificadores: produce hashes estables distintos para fila, oferta y establecimiento.

### Población fallida conservada: Santiago de Surco

La medición anterior queda intacta: 33 ofertas últimas, 30 frescas, 28 con Registro exacto y 26 contract-ready. Su cobertura es **26/30 = 86.667 %**, con denominador 30 y umbral de abandono 90 %. Su decisión permanece **NO-GO para esa población**; no se reinterpreta como 26/28 ni se usa para calcular el resultado prospectivo.

### Población prospectiva: Lima provincia

| Etapa del snapshot reproducible | Ofertas | Establecimientos |
| --- | ---: | ---: |
| Último precio con territorio Lima provincia | 821 | 821 |
| Precio válido `<=30 días` | 741 | 741 |
| Registro exacto por actividad | 722 | 722 |
| GIS 35 exacto y coordenada segura | 714 | 714 |
| Contrato completo con identidad provisional | 714 | 714 |

Excepciones: 80 ofertas últimas superaron 30 días; 19/741 no tuvieron Registro exacto y 8/722 no tuvieron GIS exacto. Hubo 0 ambiguos de Registro, 0 ambiguos GIS, 0 conflictos de último precio, 0 conflictos territoriales y 0 identidades provisionales faltantes entre las 714 filas finales. La cobertura de cadena completa es **714/741 (96.356 %)** sobre todas las ofertas frescas de Lima provincia. El contrato abarca 42 distritos y no selecciona distritos favorables.

Con el umbral congelado `<90 % = abandono`, Lima provincia obtiene **GO CON LÍMITES** para continuar la evaluación privada. El control EVPC `OWNER-VERIFIED` de 2026-08-12 permanece separado: 28/28 con geografía segura mediante otro universo y reglas adicionales; no es denominador de ninguna de las dos poblaciones.

### Contrato y privacidad

El boundary consumible está en `contracts/gate-1.1-experiment-dataset.schema.json` y tiene un fixture sintético. Cada oferta contiene IDs experimentales, producto, PEN, `S/ por galón`, precio, fecha y edad, distrito observado, coordenada, fuente/corte y razón social/dirección dentro de un objeto rotulado literalmente `IDENTIDAD PROVISIONAL — razón social/dirección`. `additionalProperties: false` y los controles negativos rechazan marca, stock, RUC, nombre comercial inferido, descuentos, convenios, scoring, edad `>30` o cambio de rótulo.

La salida real prospectiva vive solo en `.local-cache/gate-1.1/2026-08-14/experiment-dataset-lima-province.json`, ruta ignorada por Git y escrita con permisos `0600`. El repositorio conserva schema, fixture sintético y `evidence/gate-1.1-lima-province-2026-08-14.json`, que contiene métricas agregadas y la medición Surco preservada. Gate 1.2 puede leer este JSON local en modo solo lectura; el boundary no prescribe API, framework, database, proveedor de mapas ni red productiva.

La semántica temporal es explícita aunque dos valores compartan instante: `price_reported_at` proviene de la fila; `cutoff_at` es el fin de adquisición usado para calcular edad; `acquisition_started_at` y `acquisition_completed_at` proceden del log real; `source_last_modified_at` procede de HTTP. No se deriva adquisición desde nombres de archivo.

## Insight del owner para el modelo de conveniencia

**OWNER-INPUT / HIPÓTESIS DE PRODUCTO, 2026-08-16.** La búsqueda relevante parte de la ubicación actual, no del domicilio ni del distrito administrativo donde se encuentra la persona. Una estación cercana o conveniente puede estar en un distrito aledaño; por tanto, el futuro producto no debe recortar alternativas por frontera distrital cuando dispone de coordenadas.

Conveniencia personal tampoco equivale necesariamente al menor precio de lista. Convenios de marcas de estaciones con tarjetas, aseguradoras u otros programas pueden aplicar descuentos por galón y hacer preferible una marca aun con precio publicado ligeramente mayor o mayor distancia. Conceptualmente, la decisión futura deberá poder distinguir precio de lista, beneficio personal declarado, precio efectivo y costo/esfuerzo del desvío. Este insight proviene del owner y aún no está validado con participantes.

No se incorpora al contrato actual: depende de resolver identidad comercial determinística y de modelar beneficios declarados sin inferirlos desde razón social o RUC. Se conserva para capas posteriores; Gate 1.1 continúa midiendo únicamente precio oficial, distancia y frescura.

## Protocolo congelado del único experimento autorizado

**Hipótesis falsable:** para una persona estacionaria que busca combustible antes de conducir, una experiencia privada mobile-first que muestra juntas precio, cercanía y frescura reduce el esfuerzo hasta una primera decisión confiable frente a Facilito, aun usando identidad provisional explícita.

- **Tarea:** desde una ubicación actual real o simulada, idéntica en ambas condiciones y con la persona estacionaria, elegir una estación conveniente para Gasohol Regular y declarar su precio/unidad, distancia o cercanía, fecha o edad del reporte y razón de la decisión. “La interfaz no lo informa” es una respuesta válida y medible cuando corresponda.
- **Condiciones comparables:** A comienza en Facilito J1 y permite todos sus controles nativos, incluido distrito; no se fuerza el sentinel sin distrito ni una secuencia de filtros. B recibe las 714 ofertas contract-ready de Lima provincia y puede considerar estaciones de distritos vecinos mediante coordenadas. Ambas condiciones usan exactamente el mismo origen. El baseline observado de 4 acciones/3 inputs queda solo como referencia histórica: la sesión vuelve a medir todas las acciones realmente usadas.
- **Participantes y orden:** diseño intra-sujeto con mínimo 10 participantes. IDs impares usan A→B y pares B→A; la diferencia entre tamaños de grupo no puede exceder uno. Se usa el mismo origen por participante en ambas condiciones y no se cambia el enunciado. Así se contrabalancea el efecto de orden sin mezclar territorio ni producto.
- **Seguridad y privacidad:** la persona debe estar sentada y fuera de conducción durante toda la sesión. Se aborta si inicia conducción. La ubicación se usa con permiso o se sustituye por un punto fijo; no se conserva ubicación personal, nombre, teléfono ni matrícula del participante.
- **Cronometraje:** inicia cuando el enunciado y la condición están disponibles; termina cuando la persona anuncia la elección y responde las tres preguntas de comprensión. Pausas del facilitador e incidentes técnicos se registran y se excluyen del tiempo con razón explícita.
- **Acciones:** cada tap, clic, envío o selección que cambia el estado de la interfaz cuenta una acción. Escritura dentro de un mismo campo cuenta una entrada; scroll y navegador/chrome no cuentan. Retrocesos y correcciones sí cuentan.
- **Comprensión:** precio = importe y `S/ por galón` correctos; cercanía = distancia desde el origen común o reconocimiento correcto de que la condición no permite determinarla; frescura = fecha/edad correcta o reconocimiento correcto de que no está visible. Se puntúa 0/1 por dimensión contra lo mostrado en cada condición.
- **Conveniencia observable:** se limita a precio, distancia desde el origen y frescura. No se implementan marca, descuento, convenio, precio efectivo personal ni scoring de conveniencia.
- **Datos:** incluir todos los distritos de Lima provincia; excluir `>30 días`, no-matches, ambiguos, conflictos, flotantes, rurales y cualquier fila sin identidad provisional completa. No afirmar stock, marca ni nombre comercial.
- **Éxito de datos:** `>=95 %` del universo fresco completa Registro + coordenada; 100 % de ofertas muestra edad, fuente, corte y advertencias.
- **Éxito de tarea:** mediana B `<=2` acciones; tiempo mediano B al menos 30 % menor que A; `>=80 %` de participantes responde correctamente cada dimensión en B.
- **Abandono:** cobertura completa `<90 %`, identidad provisional presentada como nombre comercial, mejora de tiempo `<20 %`, comprensión B `<80 %` en cualquier dimensión, necesidad de fuente/licencia no autorizada o cualquier uso durante conducción.

Gate 1.1 congela el contrato y protocolo; no ejecuta el estudio ni autoriza publicación, diseño visual o expansión de alcance.

## Limitaciones abiertas

- EVPC y los deltas de revisión externa no tienen artefactos locales recalculables; permanecen etiquetados por procedencia.
- Los IDs exactos son relaciones candidatas del snapshot, no equivalencias universales o estables.
- El contraste compara agregados con granos declarados pero no demuestra linaje CSV→Facilito.
- No se verificaron stock, mecanismo incremental, SLA ni permiso de publicación de GIS/EVPC.

## Reproducción

```bash
node scripts/verify-gate-0.2.mjs
node scripts/analyze-gate-0.3.mjs
node scripts/analyze-j7-snapshot.mjs
node scripts/build-gate-1.1.mjs
```

El análisis de Gate 0.3 debe terminar con 14 assertions semánticas/integridad exitosas. Gate 1.1 debe terminar con 24 assertions, reconstruir 714 ofertas contract-ready y dejar la salida real únicamente en la caché ignorada. La verificación de Gate 0.2 reporta por separado 12 archivos, 9 adquisiciones y, cuando existe, 9 originales en caché.
