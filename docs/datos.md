# Fuentes y modelo de datos observado

Conocimiento vigente medido principalmente el **14 de agosto de 2026**. Caracteriza fuentes oficiales y relaciones exactas; no demuestra el linaje técnico inmediato hacia cada pantalla de Facilito.

## Evidencia conservada y reproducción

`evidence/` conserva solo resultados agregados o sanitizados que sostienen decisiones vigentes. No contiene raw, RUC, razón social, dirección, overlay comercial privado, caches, JSON público generado ni credenciales. Cada archivo conserva, cuando aplica, fuente/fecha, observación, inferencia, confianza y el script que permite reproducirla con inputs locales autorizados.

- `feasibility-2026-08-14.json`, `gate-1.1-lima-province-2026-08-14.json` y `j7-lima-10kg-2026-08-14.json`: perfiles y métricas agregadas de factibilidad; no prueban disponibilidad actual ni identidad comercial.
- `gate-2.1-commercial-identity-summary.json` y `gate-2.2-public-subset-summary.json`: cobertura y políticas agregadas; no contienen el golden set privado ni autorizan reutilizar contenido de terceros.
- `gate-3.2-http-probe-2026-08-18.json` y `gate-3.3-refresh-2026-08-18.json`: resultado de detección/refresco, hashes y decisiones operativas; no sustituyen los raws locales.
- `facilito-contrast-2026-08-14.json`: observación acotada del producto público; no prueba arquitectura, afiliación ni equivalencia.

Los scripts indicados junto a cada gate reproducen las transformaciones cuando existen los inputs autorizados en `.local-cache/`. Un clon limpio puede ejecutar tests y demo sintética, pero no puede reconstruir un snapshot real ni presentar un fixture como tal.

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

### Gate 3.2 — detección barata de cambios

La URL canónica de `liquid-current` se comparte entre la adquisición y el probe (`app/source-catalog.mjs`). El detector (`app/validator-comparison.mjs` + `app/http-validator-probe.mjs`) compara ETag como valor opaco y Last-Modified sin descargar el cuerpo. Primero hace `HEAD` condicional; solo si el método no está soportado o una respuesta exitosa carece de validadores intenta `GET` con `Range: bytes=0-0` y cancela el cuerpo al recibir los headers. Un error HTTP definitivo no provoca una segunda petición. Ausencia, error, timeout o respuesta ambigua producen `unverifiable`, nunca `unchanged`.

Ejecución real única del **18/08/2026** sobre el snapshot local del **14/08/2026**: `HEAD` HTTP 200, 0 bytes consumidos, ETag remoto `"{FE76AA7F-4385-420E-8CBD-64AD7572DE90},238` frente a local `...,234`, y Last-Modified remoto **18 ago. 12:28:58 GMT** frente a local **14 ago. 12:28:52 GMT**. Resultado `changed`. Evidencia sanitizada en `evidence/gate-3.2-http-probe-2026-08-18.json`; no se descargó ni promovió un snapshot.

Conclusión aceptada: **B — viable con fallback seguro**. La detección de cambio es barata y reproducible; los tests prueban `unchanged` tanto por 304 como por HEAD 200 con validadores idénticos. Falta observar un ciclo real sin cambios para caracterizar cuál de esas respuestas usa la fuente.

### Gate 3.3 — refresco seguro y promoción atómica

El refresco manual reproducible es `npm run refresh:gate-3.3 -- liquid-current`. Resuelve la fuente desde `app/source-catalog.mjs`, compara validadores, descarga solo si el estado es `changed`, escribe en un staging único, sella bytes y SHA-256, ejecuta el builder y sus contratos/joins, compara cobertura y excepciones contra el snapshot activo y solo entonces mueve el staging a `.local-cache/gate-3.3/snapshots/<snapshot-id>/`. El pointer pequeño `.local-cache/gate-3.3/active.json` se actualiza con escritura + rename atómico; `npm run rollback:gate-3.3 -- <snapshot-id>` cambia únicamente ese pointer.

El refresco correctivo real restauró primero `2026-08-14`, tomó ETag/Last-Modified del probe, encontró una adquisición local con esos validators exactos y verificó sus bytes y SHA-256 antes de reutilizarla. El raw tiene **1,078,782,427 bytes**, SHA-256 `9404f2910141efb2a4199ac446f547f43c5dad912958b33fdcc711ee5df18a55`; el CSV minimizado quedó con SHA-256 `231f3969613af4f357df0fc44c8e404089c9c5bf7d76792e8b0f114d25c3f89e`, **1,351,248 filas** y `source_max_reported_at=2026-08-18T04:59:36Z`. El snapshot promovido es `2026-08-18-20260819T003213952Z-7928-71e6ba`; su `source_last_modified_at` es `2026-08-18T12:28:58Z` y su `acquired_at` `2026-08-18T20:48:25.837Z`. La detección consumió 0 bytes y no hubo redescarga.

El candidato produjo **740** ofertas frescas, **714** listas para contrato y **96.486 %** de cobertura, frente a **741**, **714** y **96.356 %**. Registro y GIS siguieron fijados al **14/08/2026**. Los 11 anchors de Gate 2.1 fueron revalidados y reanclados al nuevo `dataset_id`; `--private-preview` proyecta 11/11. Los dos candidatos supersedidos permanecen inactivos y no son elegibles para rollback. Una segunda ejecución fue `unchanged`, sin descarga ni promoción. La reutilización es genérica: si cambian los validators, el raw anterior no coincide y no se reutiliza.

Registro y GIS se reutilizaron como inputs de referencia fijados al **14/08/2026**; no fueron refrescados ni se afirma lo contrario. Los originales y derivados grandes viven solo en `.local-cache/`; la evidencia agregada queda en `evidence/gate-3.3-refresh-2026-08-18.json`.

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

`N` es completo y único en las capas 34/35/36. La capa 31 no existe en el servicio observado. Las geometrías son válidas y están dentro de una caja conservadora de Perú. El servicio atribuye copyright a Osinergmin, pero no expone licencia explícita. Ese es un hecho de procedencia; el owner aprobó expresamente publicar las coordenadas GIS en el contrato público downstream de Gate 4.1. La atribución pública resultante es “Datos de precios y coordenadas: Osinergmin.”

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

## Identidad y disponibilidad

Ninguna fuente bulk oficial expone identidad comercial:

- EVPC tenía `MARCA` vacía en 17,472/17,472 filas;
- el Registro aporta razón social y dirección, no garantiza nombre público de la sede;
- el formulario RHO y el Padrón Reducido SUNAT no exponen nombre comercial;
- la consulta individual SUNAT requiere CAPTCHA y no se evade.

No se inventa marca desde razón social, RUC o dirección. Tampoco se interpreta `PRODUCTO_ACTIVO`, `ULT_PRECIO_DIF_CERO` u otros campos como stock sin semántica demostrada.

### Piloto de identidad comercial (Gate 2.1)

Un golden set privado, construido por un research scout independiente y verificado el **17 de agosto de 2026**, vinculó identidad comercial fuera de las fuentes bulk oficiales:

- universo predefinido de 64 ofertas (Surco + 3 distritos aledaños) del dataset Gate 1.1;
- 14 candidatos con razón social corporativa Repsol exacta; 11 vinculados por dirección normalizada exacta a una fuente first-party (PDF "Relación de Estaciones – Repsol You"), 3 sin contraparte (unmatched, no forzado);
- 0 vínculos Primax: sin directorio first-party con nombre de sede accesible sin evadir controles ni renderizar JS;
- método en dos pasos deterministas, sin fuzzy matching: igualdad exacta de razón social corporativa, luego dirección normalizada exacta con candidato único;
- caso probado de coordenada compartida entre dos establecimientos con razón social distinta (COESTI vs. Repsol): confirma que coordenada exacta no puede usarse sola como anchor de identidad;
- caso probado de abanderamiento (marca operando sobre razón social de tercero): correctamente excluido como conflicto, no verificado;
- fuente con antigüedad declarada (~4 años, Last-Modified 2022-11-02): las 11 entradas quedan `identity_freshness=stale`, sin inferir vigencia desde esa fecha;
- permiso de publicación de las 11 identidades: `unknown`. No hay licencia ni prohibición explícita en la fuente; robots.txt permisivo autoriza rastreo, no reutilización de contenido.

El overlay separa siempre exactitud del vínculo (`verification_status`) de permiso de publicación (`publication_status`), y nunca deriva frescura desde la fecha de acceso o de modificación de la fuente. Vive únicamente en `.local-cache/gate-2.1/`, con permisos `0600`, ignorado por Git; el repositorio conserva solo schema, fixtures sintéticos y evidencia agregada sin identidades reales.

## PRICE y J7

El enlace PRICE visible en Facilito redirige a una biblioteca documental. En la página observada había 1,337 enlaces a PDF/XLS/XLSX/ZIP, pero cero CSV y cero rutas `Reporte-Diario`. Esto no contradice que el archivo EVPC sea material para precios retail; indica que ese enlace concreto no ofrece una interfaz estructurada visible.

J7 permanece fuera del producto: no se reprodujo una fuente nominal que explique distribuidor, marca, fecha y rangos de sus 444 filas públicas. La capa GIS 31 que se suponía asociada tampoco existe.

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

## Procedencia, privacidad y reproducción

Los originales grandes o con datos personales viven solo en `.local-cache/`. Los snapshots versionados eliminan RUC, razón social, dirección, representante, teléfono, correo y placa. Un manifiesto previo sella lista, tamaño y SHA-256; la verificación falla ante archivos nuevos, alterados o ausentes.

```bash
node scripts/profile-gate-0.2.mjs
node scripts/verify-gate-0.2.mjs
```

Riesgos abiertos: estabilidad temporal de claves, no-matches, semántica de extremos, mecanismo incremental y linaje CSV→Facilito. La publicación downstream de coordenadas GIS fue aprobada por el owner; se conserva procedencia y atribución, pero no se trata como permiso pendiente ni prohibición.
