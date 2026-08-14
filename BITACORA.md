# BITÁCORA

> Estado temporal del gate activo.
>
> Este archivo es el canal de coordinación entre Codex A, Codex B y Claude.
> No es documentación histórica ni fuente automática de verdad.
>
> Codex A debe consolidarlo y limpiarlo al cerrar cada gate.

---

# Diseño vigente de la Capa 0 — Codex A

**Objetivo de cierre de capa:** decidir con evidencia reproducible si datos oficiales accesibles pueden sostener una experiencia independiente sustancialmente mejor y, de ser así, proponer el experimento mínimo y medible de Capa 1 sin elegir todavía UI, framework, base de datos o infraestructura de producción.

- **Gate 0.1 — Producto observado y frontera pública: CERRADO.** Evidencia vigente en `docs/descubrimiento.md` y `docs/arquitectura.html`.
- **Gate 0.2 — Fuentes oficiales y modelo de datos observado: ACTIVO.**
- **Gate 0.3 — Factibilidad medida y experimento de Capa 1: PENDIENTE.**

---

# Gate actual

**Capa:** 0 — descubrimiento y factibilidad  
**Gate:** 0.2 — Fuentes oficiales y modelo de datos observado  
**Modo:** FULL  
**Estado:** PENDIENTE — listo para Codex B

## Pregunta material

¿Qué fuentes oficiales relevantes existen, mediante qué mecanismos legítimos se accede a ellas y qué semántica, cobertura, frescura, identificadores y geografía ofrecen para los siete journeys observados y para una futura identidad reconocible por marca/nombre comercial?

## Objetivo

Construir desde fuentes primarias un catálogo verificable y un modelo de datos observado que permita distinguir entidades, precios, tiempo y geografía. El gate debe establecer qué puede usarse legítima y reproduciblemente, qué permanece incierto y qué relaciones exactas deberán medirse en Gate 0.3.

## Criterios de salida

- [ ] Existe un inventario reproducible de fuentes oficiales candidatas relevantes para los siete journeys, incluyendo la ruta “PRICE / Datos Abiertos” enlazada por Facilito y otras superficies oficiales encontradas desde cero. Cada fuente registra propietario, URL, fecha de acceso, propósito y evidencia de oficialidad.
- [ ] Cada fuente retenida está clasificada por mecanismo de acceso —descarga, API/servicio documentado, servicio geoespacial, página o handler interno—, formato, disponibilidad observada, autenticación, límites, licencia/condiciones de reutilización y fragilidad. La ausencia de documentación o licencia queda explícita, no inferida.
- [ ] Para cada fuente accesible existe schema observado en el boundary y un perfil cuantitativo reproducible: universo de filas/features, campos, tipos, nulos, unicidad, duplicados exactos, cobertura geográfica/producto y rango/distribución temporal cuando aplique. Los conteos siempre nombran snapshot y corte.
- [ ] Se propone un modelo de entidades basado en evidencia que distinga al menos: operador/razón social, establecimiento o punto de venta, marca/nombre comercial, producto, precio/reporte, tipo de comercializador y geografía. Cada campo queda trazado a fuente y su semántica se marca como documentada, inferida o desconocida.
- [ ] Se identificaron los candidatos a identificador estable y se midieron unicidad, nulos y colisiones dentro de cada fuente. No se asume que RUC, nombre o dirección identifican un establecimiento. No se usa fuzzy matching.
- [ ] La disponibilidad de marca/nombre comercial se estudió explícitamente: fuente legítima, quién declara el dato, relación con establecimiento/operador y cobertura medible. Si no existe una relación determinística suficiente, el gate lo concluye como límite en vez de fabricar nombres.
- [ ] Se estableció qué significa cada timestamp material —reporte, recepción, publicación o snapshot— usando documentación oficial o dejándolo como semántica no resuelta. Se cuantificó la frescura por fuente donde los datos lo permitan.
- [ ] Toda relación entre fuentes se presenta como `DEMOSTRADA`, `CANDIDATA` o `DESCARTADA`. No se afirma una relación demostrada sin join determinístico medido sobre el universo: filas, matches, unmatched, ambiguos, porcentajes y casos especiales. Las relaciones candidatas quedan reservadas para Gate 0.3.
- [ ] Existe un mapa de correspondencia entre fuentes y journeys/campos visibles de Facilito, con nivel de evidencia; similitud de contenido no prueba que una fuente alimente el producto.
- [ ] Snapshots raw, datos derivados y scripts están separados cuando existan. Cada adquisición conserva URL, fecha/hora, parámetros, checksum y procedimiento; el material raw no se modifica para producir derivados.
- [ ] Los riesgos de acceso, actualización, semántica, cobertura, identidad, calidad y reutilización quedaron priorizados por capacidad de invalidar el futuro producto.
- [ ] El conocimiento permanente quedó consolidado en un documento vivo de datos, sin reportes por evento ni infraestructura de producción.
- [ ] Claude completó revisión adversarial, Codex B respondió los hallazgos que lo requieran y Codex A resolvió el gate.
- [ ] Antes del cierre, Codex A actualizó `README.md` y `docs/arquitectura.html`, limpió esta bitácora, ejecutó el Quality Gate y realizó el commit de cierre.

## Restricciones / decisiones ya tomadas

- **HECHO DE ENTRADA:** Gate 0.1 confirmó siete journeys, resultados server-rendered, paginación DataTables en cliente, ausencia de fecha visible en J1–J6 y fecha materialmente antigua en el caso J7 Lima/10 kg. La evidencia vigente está en `docs/descubrimiento.md`.
- **DECISIÓN HUMANA:** la futura experiencia será mobile-first. Marca y/o nombre comercial serán identidad principal para el público; razón social y RUC serán trazabilidad secundaria. Esto depende de una relación legítima y determinística que este gate debe investigar.
- **DECISIÓN:** buscar desde cero y priorizar fuentes primarias oficiales. No usar `fetch-gis.mjs` ni `gis-osinergmin.json` como evidencia; pueden contrastarse únicamente después de descubrir y reproducir independientemente su posible fuente.
- **DECISIÓN:** usar acceso público legítimo, solicitudes conservadoras, descargas reutilizables y caché local. No evadir controles, resolver/bypassear CAPTCHA, autenticar sin autorización ni hacer crawling agresivo.
- **DECISIÓN:** un endpoint observado en network no se considera API soportada ni fuente canónica sin evidencia adicional.
- **DECISIÓN:** no usar fuzzy matching, geocodificación de terceros ni scraping de sitios comerciales para fabricar marca/nombre comercial o cobertura.
- **DECISIÓN:** no crear aplicación, database, auth, deployment, servicios o pipeline productivo. Scripts y datos existen solo para research reproducible.
- **DECISIÓN:** Gate 0.2 caracteriza fuentes y contratos. Gate 0.3 hará la decisión integrada de factibilidad y los joins cruzados pendientes; si B demuestra una relación en este gate, debe medirla sobre el universo según los criterios anteriores.
- **RIESGO:** el snapshot J7 de Gate 0.1 conserva agregados sanitizados, no filas raw; reproduce métricas internas pero no audita nuevamente la extracción. No usarlo como evidencia de otra fuente.
- **HECHO:** Codex A inicializó Git al cerrar Gate 0.1; su commit de cierre constituye el baseline que Codex B debe usar para inspeccionar el working tree. B no realiza commits.

---

# Encargo — Codex A

## Contexto mínimo

Gate 0.1 demostró que Facilito permite comparar cientos de ofertas por producto y geografía, pero no demostró de dónde vienen los datos ni si pueden reutilizarse de forma estable. La principal incertidumbre ya no es si aparecen precios: es si conocemos su procedencia, vigencia, identidad y cobertura con suficiente certeza para construir sobre ellos.

La interfaz usa razón social o establecimiento como etiqueta en varios journeys. El producto futuro debe priorizar una identidad reconocible por marca/nombre comercial, pero esa mejora solo es válida si existe una fuente legítima y un vínculo determinístico con el punto de venta. No asumir que marca, operador y establecimiento son la misma entidad.

## Qué debe quedar demostrado

1. **Descubrimiento oficial completo y acotado.** Partir de Facilito/Osinergmin y portales públicos oficiales. Registrar el procedimiento de búsqueda y por qué cada fuente se retiene o descarta. No asumir que la primera descarga o servicio encontrado es principal.
2. **Acceso legítimo y estabilidad.** Distinguir mecanismo oficialmente publicado de implementación interna. Documentar condiciones de uso, licencia o ausencia de ellas; frecuencia declarada; historial disponible; límites y señales de fragilidad.
3. **Schemas reales.** Inspeccionar metadata/documentación y respuestas. Registrar nombres y tipos observados, ejemplos sanitizados, opcionalidad y cambios o inconsistencias. Los nombres de campos no bastan para afirmar semántica.
4. **Universos por fuente.** Adquirir una vez o consultar conservadoramente cada fuente relevante. Medir filas/features, fechas, productos, territorios, coordenadas, nulos, unicidad y duplicados con scripts reproducibles y assertions.
5. **Identidad.** Evaluar todos los candidatos exactos: IDs oficiales, códigos de registro, RUC, UBIGEO, claves de producto y combinaciones documentadas. Separar persona jurídica, establecimiento físico, marca, nombre comercial y reporte.
6. **Marca/nombre comercial.** Buscar campos o catálogos declarados por el operador o por la autoridad; medir cobertura y cardinalidad. Si la fuente solo contiene razón social, registrar el gap. No completar manualmente ejemplos ni usar similitud textual.
7. **Tiempo y calidad.** Confirmar qué representa cada fecha y medir distribución de antigüedad. Identificar reportes sin fecha, precios cero/extremos, duplicados y estados inactivos sin clasificarlos como error cuando falte semántica oficial.
8. **Geografía.** Identificar catálogos territoriales, UBIGEO y coordenadas; medir presencia, validez básica, sistema de referencia y precisión documentada. No geocodificar direcciones con terceros.
9. **Relaciones.** Registrar claves compartidas y relaciones candidatas. Solo elevar una relación a demostrada si B ejecuta un join exacto de universo y reporta matches, unmatched, ambiguos y excepciones; de lo contrario, dejarla para Gate 0.3.
10. **Conocimiento vigente.** Consolidar el catálogo, schemas, modelo y riesgos preferentemente en `docs/datos.md`. Mantener `docs/descubrimiento.md` enfocado en el producto observado y enlazar ambos documentos sin duplicar contenido.

## Secuencia mínima esperada

1. Leer completos `AGENTS.md`, `CLAUDE.md`, `BITACORA.md`, `README.md` y `docs/descubrimiento.md`.
2. Escribir en la sección de B un plan que mapee actividades a criterios de salida y defina de antemano las mediciones.
3. Inventariar fuentes oficiales y evidencia de acceso/licencia antes de descargar universos.
4. Seleccionar solo fuentes materialmente relevantes y adquirir snapshots con baja carga, provenance y checksum.
5. Implementar profiling reproducible con assertions; separar `raw → normalize/profile` sin alterar raw.
6. Construir el modelo de entidades y la matriz de campos/identificadores/semántica.
7. Evaluar marca/nombre comercial, fechas y geografía como preguntas explícitas, no como notas secundarias.
8. Consolidar conocimiento y riesgos; comprobar que ninguna relación o cobertura excede la evidencia.
9. Ejecutar validaciones, escaneo de secretos y revisión del working tree. Reportar todo en su sección y detenerse para Claude.

## Fuera de alcance

- Diseñar UI, wireframes o componentes; elegir framework, database, proveedor de mapas o despliegue.
- Construir el vertical slice o decidir todavía qué journey será el experimento de Capa 1.
- Usar handlers de Facilito como feed productivo o hacer extracción repetitiva de la web.
- Inventar marca/nombre comercial a partir de razón social, dirección, búsquedas web o fuzzy matching.
- Ejecutar joins aproximados o presentar ejemplos aislados como cobertura.
- Crear una infraestructura de ingestión continua, historial propio, monitoreo o almacenamiento productivo.
- Descargar datos no relevantes “por si acaso” o conservar secretos, cookies, tokens o datos personales innecesarios.
- Modificar `AGENTS.md`, `CLAUDE.md`, la revisión de Claude o la resolución de Codex A; realizar commits.

## Evidencia esperada

- Catálogo de fuentes con oficialidad, acceso, licencia, frescura declarada y fragilidad.
- Inventario de snapshots/respuestas con provenance y checksum.
- Diccionario de campos y modelo de entidades con semántica documentada/inferida/desconocida.
- Perfil cuantitativo reproducible por fuente y assertions contra errores silenciosos.
- Matriz de identificadores: unicidad, nulos, colisiones, alcance y estabilidad conocida.
- Evaluación cuantitativa de marca/nombre comercial, fechas y coordenadas.
- Matriz fuente ↔ journey/campo de Facilito con nivel de evidencia.
- Relaciones demostradas/candidatas/descartadas, sin fuzzy matching.
- Riesgos P0/P1 y preguntas exactas que Gate 0.3 debe resolver.
- Reporte de B en esta bitácora con archivos, comandos, métricas, limitaciones y dudas para review.

---

# Implementación — Codex B

## Plan

—

## Trabajo realizado

—

## Decisiones locales

—

## Evidencia / métricas

—

## Tests / validaciones ejecutadas

—

## Limitaciones conocidas

—

## Dudas para revisión

—

---

# Revisión adversarial — Claude

## Veredicto

—

## Bloqueantes

—

## Hallazgos importantes

—

## Enfoques alternativos

—

## Lo que está bien

—

## Recomendación para Codex A

—

---

# Respuesta / corrección — Codex B

> Completar solo cuando el FULL LOOP requiera una nueva intervención de B.

## Respuesta a hallazgos

—

## Cambios realizados

—

## Validaciones posteriores

—

## Riesgos restantes

—

---

# Resolución — Codex A

## Decisiones

—

## Findings de Claude

- Aceptados:
- Descartados:
- Diferidos:

## Validación del gate

—

## Conocimiento que debe persistir

—

## Estado final

**Gate:** ABIERTO

## Próximo paso

Codex B ejecuta Gate 0.2 y deja el working tree listo para revisión adversarial.
