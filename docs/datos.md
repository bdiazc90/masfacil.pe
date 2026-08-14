# Fuentes oficiales y modelo de datos observado

Estado: conocimiento vigente de Gate 0.2, observado el 14 de agosto de 2026 (America/Lima). Caracteriza fuentes públicas y relaciones medidas; no diseña la aplicación futura ni demuestra que un CSV sea la fuente técnica inmediata de Facilito.

## Método, procedencia e integridad

Las adquisiciones nuevas se hicieron sin autenticación, serialmente y con baja carga. `scripts/acquire-gate-0.2.mjs` transmite cada recurso una vez hacia `/.local-cache/`, rechaza sobrescrituras y registra durante la solicitud: URL y parámetros reales, tiempos de inicio/fin, cabeceras materiales, cadena HTTP, bytes y SHA-256. El log está fuera de `raw`, en `data/provenance/2026-08-14/acquisitions.jsonl`.

Los originales reutilizables —incluidos los CSV grandes y exports con datos personales— permanecen solo en la caché local ignorada. `scripts/minimize-gate-0.2.mjs` produjo snapshots **derivados/minimizados**: conserva campos necesarios para métricas y joins exactos, pero elimina RUC, razón social, dirección, representante, teléfono, correo y placa. Los CSV minimizados se comprimen con `gzip -n`; las 2,340,316 filas de precio siguen presentes.

`scripts/profile-gate-0.2.mjs` solo lee snapshots minimizados y nunca escribe procedencia. `scripts/verify-gate-0.2.mjs` compara una lista previa exacta de 12 archivos contra `data/provenance/2026-08-14/integrity-manifest.json`: falla ante archivos alterados, nuevos, ausentes o con checksum/tamaño distinto. Con la caché presente también verifica los nueve originales adquiridos. El manifiesto se creó una sola vez con `--seal` y el script rechaza regenerarlo.

Límite explícito: las fuentes pequeñas heredadas de la primera pasada —DMIN, serie anonimizada, Registro y GIS— no tenían procedencia de request confiable. Antes de retirar `raw`, la corrección registró sus hashes observados en `transformations.json`, con clasificación `legacy_no_verificable`; no se inventaron URL solicitada ni timestamps retroactivos. Las nueve adquisiciones nuevas sí tienen procedencia completa.

## Catálogo oficial frente a recurso real

La ficha del catálogo y el archivo de datos son recursos distintos. La licencia corresponde a la ficha; no se deriva de la URL del CSV.

| Dataset | Catálogo oficial | URL realmente solicitada para datos | Acceso y licencia declarada |
| --- | --- | --- | --- |
| DMIN | [package `20921426…`](https://www.datosabiertos.gob.pe/api/3/action/package_show?id=20921426-6c40-4b86-af69-802066bd55ea) | [CL-Registro-precios-DMIN.csv](https://www.osinergmin.gob.pe/seccion/centro_documental/hidrocarburos/SCOP/SCOP-DOCS/Reporte-Diario/CL-Registro-precios-DMIN.csv) | Ficha pública; ODC-By |
| Serie diaria anonimizada | [package `288e1362…`](https://www.datosabiertos.gob.pe/api/3/action/package_show?id=288e1362-0bf8-448f-8665-45058674ec5f) | [precios_combustibles_anonimizados_20260301_part1.csv](https://www.datosabiertos.gob.pe/sites/default/files/precios_combustibles_anonimizados_20260301_part1.csv) | Ficha pública; ODC-By |
| GLP vigente | [package `a5326a6b…`](https://www.datosabiertos.gob.pe/api/3/action/package_show?id=a5326a6b-7064-4cec-a78f-6f3680e9eee2) | [GLP-Registro-precios-PIC-PE-V.csv](https://www.osinergmin.gob.pe/seccion/centro_documental/hidrocarburos/SCOP/SCOP-DOCS/Reporte-Diario/GLP-Registro-precios-PIC-PE-V.csv) | Ficha pública; ODC-By |
| Líquidos vigentes | [package `35e929b0…`](https://www.datosabiertos.gob.pe/api/3/action/package_show?id=35e929b0-085a-47a3-86a4-483da58fda25) | [CL-Registro-precios-DMA-V-CCA-CCE.csv](https://www.osinergmin.gob.pe/seccion/centro_documental/hidrocarburos/SCOP/SCOP-DOCS/Reporte-Diario/CL-Registro-precios-DMA-V-CCA-CCE.csv) | Ficha pública; ODC-By |

Los cuatro JSON de catálogo devolvieron `private: true`, aunque sus fichas visibles declaran acceso público. Se registra como contradicción de metadatos, no como restricción efectiva.

## Adquisición de los CSV vigentes

Ambos archivos aceptaron `Range: bytes=0-` y se descargaron completos una sola vez, en serie:

| Dataset | HTTP | Bytes | `Content-Range` | `Last-Modified` | SHA-256 |
| --- | ---: | ---: | --- | --- | --- |
| GLP | 206 | 504,023,467 | `0-504023466/504023467` | 2026-08-14 12:27:11 GMT | `9c48b851…d2929` |
| Líquidos | 206 | 1,053,746,146 | `0-1053746145/1053746146` | 2026-08-14 12:28:52 GMT | `0ce68cd7…1906b` |

HTTP 206 demuestra disponibilidad durante esta adquisición, no un SLA ni estabilidad futura. Los 403 de la primera pasada fueron fallos del cliente usado y no una propiedad de la fuente.

## Perfil cuantitativo de precios

Todos los universos se recorrieron completos. “Duplicados 0” se demuestra porque el ID de control de cada fila es no nulo y único; por ello una fila exacta duplicada no puede existir.

| Dataset | Filas × columnas minimizadas | ID / Registro | Producto y territorio | Fecha máxima | Calidad material |
| --- | --- | --- | --- | --- | --- |
| DMIN | 858 × 13 | `ID1` 858/858 único; 83 Registros | 9 productos; 2 actividades; 19 dep., 35 prov., 57 dist. | 2026-08-13 | 0 anchos inválidos, 0 nulos, 0 duplicados; precios S/10.17–38 |
| Serie anonimizada | 497,156 × 11 | `id` único; 8,825 locales anónimos | Sin identidad ni territorio público | `FE_EVAL` 2026-02-28; corte/emisión 2026-03-01 | 0 anchos inválidos y 0 duplicados; nulos estructurales por producto; 4 valores líquidos >S/100, 3 >S/1,000; GLP-E tiene 49 >S/100 |
| GLP vigente | 522,380 × 12 | `ID4` único; 5,955 Registros | 6 productos; 16 actividades; 25 dep., 174 prov., 754 dist. | 2026-08-13 | 0 anchos inválidos; solo `MARCA` tiene nulos; precio S/1.59–525; 76,920 >S/100 |
| Líquidos vigentes | 1,319,922 × 10 | `ID3` único; 6,588 Registros | 29 productos; 14 actividades; 25 dep., 187 prov., 902 dist. | 2026-08-13 | 0 anchos inválidos o nulos; precio S/0.01–4,500; 8 >S/100 y 5 >S/1,000 |

Los extremos se conservan como anomalías observadas; no se corrigen ni califican de error sin semántica adicional. GLP mezcla cilindros y granel/unidades, por lo que un umbral único no implica comparabilidad.

### `MARCA`

El diccionario define `MARCA` como **nombre comercial del producto o envasadora**. No es el nombre comercial del establecimiento y no resuelve la identidad reconocible del punto de venta.

En GLP, `MARCA` está presente en 345,018/522,380 filas (66.047 %), con 188 valores distintos; falta en 177,362. Aparece en 4,465 Registros: 3,237 tienen una marca y 1,228 tienen entre 2 y 11. Esto mide cobertura/cardinalidad dentro del snapshot, pero no demuestra un catálogo canónico ni estabilidad temporal.

## Registro y GIS

El Registro minimizado conserva 17,742 autorizaciones de actividades 1, 2, 5, 6, 13, 15, 16, 20, 24 y 59. `REGISTRO` no es universalmente fila-única: hay 7 valores repetidos en actividad 1, 17 en 13, 1 en 16 y 78 en 24. RUC permanece descartado como identidad única del establecimiento: identifica al titular y su multiplicidad ya fue observada; además no se conserva en los snapshots.

El FeatureServer observado publica 27 entradas de capa; los IDs saltan del 29 al 32. **La capa 31 no existe en ese servicio**, no está “rota”. Las capas perfiladas suman 11,215 features: 28=117, 34=5,663, 35=5,284 y 36=151; `OBJECTID` y geometría son completos/únicos dentro de cada capa, sin coordenadas fuera de la caja conservadora de Perú.

Campos de identidad medidos:

- GIS 34/35/36: `N` tiene 0 nulos y es único en 5,663/5,284/151 filas.
- GIS 28: `COD_OSINERGMIN` y `CODIGO_DGH` tienen 0 nulos y 117/117 valores únicos cada uno.
- `OBJECTID` sigue siendo técnico de capa; no se eleva a identidad transversal.

## Relaciones exactas candidatas

Los solapamientos se recalcularon desde los snapshots minimizados, sin fuzzy matching ni normalización textual:

| Join exacto | Cobertura izquierda | Cardinalidad entre claves coincidentes | Estado |
| --- | ---: | --- | --- |
| GIS 34 `N` ↔ Registro act. 16 `REGISTRO` | 5,611/5,663 (99.082 %); 52 sin match | 5,610 uno-a-uno; 1 uno-a-muchos | CANDIDATA |
| GIS 35 `N` ↔ Registro act. 1+2+5+6 | 5,198/5,284 (98.372 %); 86 sin match | 5,191 uno-a-uno; 7 uno-a-muchos | CANDIDATA |
| GIS 36 `N` ↔ Registro act. 5+6+15+59 | 142/151 (94.040 %); 9 sin match | 142 uno-a-uno | CANDIDATA |
| GIS 28 `COD_OSINERGMIN` ↔ Registro act. 20 | 109/117 (93.162 %); 8 sin match | 109 uno-a-uno | CANDIDATA |
| Control negativo: GIS 34 `N` ↔ Registro act. 13 | 0/5,663 | 0 claves | DESCARTADA para ese par |

La alta cobertura demuestra equivalencia de valores en este snapshot, no identidad semántica universal ni estabilidad entre snapshots. Los no-matches y siete casos uno-a-muchos impiden elevar la relación general a DEMOSTRADA.

## UBIGEO oficial

El [catálogo UBIGEO del INEI](https://www.datosabiertos.gob.pe/api/3/action/package_show?id=fd98ecaf-c53c-44ed-be1c-a37b7afc6f3e) declara licencia ODbL y publica `UBIGEO 2022_1891 distritos.xlsx`. Se adquirieron 109,193 bytes por HTTP 206 (SHA-256 `42707940…d77e`) y se conservaron 1,891 distritos.

Schema: `IDDIST`, `NOMBDEP`, `NOMBPROV`, `NOMBDIST`, `NOM_CAPITAL_LEGAL`, `COD_REG_NAT`, `REGION_NATURAL`. `IDDIST` es no nulo y único 1,891/1,891; existen 25 departamentos y 196 pares departamento/provincia.

Las fuentes de precio, Registro y GIS observadas expresan territorio como texto y no contienen un campo UBIGEO numérico. La relación es semánticamente candidata, pero la cobertura por código exacto es todavía 0 campos compatibles. No se ejecutó join textual ni fuzzy.

## PRICE y frontera pública

El stub oficial de 244 bytes contiene un `meta refresh` hacia `https://www.osinergmin.gob.pe/empresas/hidrocarburos/scop/documentos-scop`. El destino real respondió 200 por HTTP directo: 738,520 bytes, 1,479 `href` (1,439 distintos), 1,337 enlaces a PDF/XLS/XLSX/ZIP, **0 enlaces CSV** y **0 rutas `Reporte-Diario`**. Es una biblioteca documental, no una interfaz estructurada de precios observada.

El navegador reprodujo `ERR_TIMED_OUT` tanto al stub como al destino, mientras HTTP directo respondió 200. Se separa disponibilidad HTTP del fallo del navegador; el timeout no invalida el contenido adquirido ni demuestra caída del sitio.

La RCD 256-2021-OS/CD establece la relación funcional PRICE → publicación en Facilito, pero no prueba que estos CSV sean el linaje técnico inmediato de cada journey.

## Modelo de entidades observado

| Entidad | Atributos materiales | Identidad y límite |
| --- | --- | --- |
| Operador legal | RUC, razón social | RUC identifica titular, no establecimiento; descartado como clave única |
| Autorización/actividad | Registro, código Osinergmin, actividad | `REGISTRO`/`N` y códigos GIS son candidatos medidos; existen repeticiones/no-matches |
| Observación de precio | ID de control, Registro, producto, precio, unidad, fecha, tipo de cliente, a veces marca | `ID1/ID3/ID4/id` es único en el snapshot; estabilidad futura desconocida |
| Establecimiento | autorización, territorio y dirección en originales | No se observó un ID universal independiente de la autorización |
| Marca de producto/envasadora | `MARCA` | No equivale a establecimiento ni garantiza catálogo canónico |
| Feature geográfica | `OBJECTID`, `N`/códigos y geometría | `OBJECTID` solo dentro de capa; `N`/códigos son candidatos exactos |
| Local anonimizado | `ANON_CO_LOCAL_VENTA` | Sirve para serie interna; no permite identificar/ubicar oferta |
| Distrito INEI | `IDDIST` y nombres oficiales | Catálogo oficial exacto; aún sin campo código compatible en fuentes observadas |

## Correspondencia con journeys

| Journey | Precio candidato | Identidad/geografía | Estado y brecha |
| --- | --- | --- | --- |
| J1 Diesel/gasolinas | Líquidos vigentes | Registro 1/2/5/6 + GIS 35 | Contrato y datos disponibles; linaje técnico a Facilito no demostrado |
| J2 GNV | Líquidos incluye productos GNV; serie para historia | Registro 5/6/59/15 + GIS 36 | Cobertura por producto/actividad requiere partición semántica; no se asume equivalencia de todo el archivo |
| J3 GLP automotor | GLP `GLP - G` | Registro 2/6/15 + GIS 36 | Fuente candidata con filas actuales; linaje no demostrado |
| J4 Locales de venta | GLP en cilindros | Registro 16 + GIS 34 | `N↔REGISTRO` cubre 99.082 %; marca es producto/envasadora |
| J5 Estaciones | GLP en cilindros | Registro 1/2/6 + GIS 35 | Fuente candidata; clasificación exacta pendiente |
| J6 Plantas envasadoras | GLP en cilindros | Registro 20 + GIS 28 | Código cubre 93.162 %; marca/planta no son equivalentes demostrados |
| J7 Distribuidores en cilindros | Ninguna fuente nominal demostrada | Registro 13; sin capa 31 | **Brecha P0 real:** no se reprodujo una fuente estructurada que explique distribuidor, marca, fecha y rangos visibles |

Los CSV vigentes eliminan el antiguo P0 de “inaccesibilidad”. **J7 permanece como P0**: el archivo GLP incluye actividad distribuidor, pero su contrato de precio puntual no demuestra los rangos, fechas y filas nominales observados en J7, y el destino PRICE no ofrece descarga estructurada visible.

## Reproducción y límites

```sh
node scripts/profile-gate-0.2.mjs
node scripts/verify-gate-0.2.mjs
```

El primer comando recalcula métricas desde snapshots minimizados; el segundo verifica manifiesto previo, lista exacta, hashes, fuentes, caché disponible y privacidad. La adquisición/minimización no debe repetirse si ya existen sus registros.

Quedan abiertas: estabilidad temporal de claves; explicación de no-matches y casos uno-a-muchos; semántica de extremos de precio; linaje CSV→Facilito; y fuente estructurada de J7. No se eligieron framework, base de datos, arquitectura de producción ni joins fuzzy.
