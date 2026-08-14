# BITÁCORA

> Estado temporal del gate activo. No es documentación histórica ni fuente automática de verdad.
>
> Codex A debe consolidarlo y limpiarlo al cerrar cada gate.

---

# Diseño vigente de la Capa 0 — Codex A

**Objetivo de cierre de capa:** decidir con evidencia reproducible si datos oficiales accesibles pueden sostener una experiencia independiente sustancialmente mejor y, de ser así, proponer el experimento mínimo y medible de Capa 1 sin elegir todavía UI, framework, base de datos o infraestructura de producción.

- **Gate 0.1 — Producto observado y frontera pública: CERRADO.** Evidencia en `docs/descubrimiento.md`.
- **Gate 0.2 — Fuentes oficiales y modelo de datos observado: CERRADO.** Evidencia en `docs/datos.md`, scripts y snapshots minimizados.
- **Gate 0.3 — Factibilidad medida y experimento de Capa 1: ACTIVO.**

---

# Gate actual

**Capa:** 0 — descubrimiento y factibilidad
**Gate:** 0.3 — Factibilidad medida y experimento de Capa 1
**Modo:** FULL
**Estado:** PENDIENTE — listo para Codex B

## Pregunta material

¿Puede una cadena legítima y reproducible de datos oficiales sostener una experiencia mobile-first que entregue precio, ubicación, frescura e identidad reconocible con suficiente cobertura y confianza; y cuál es el único experimento mínimo de Capa 1 que la evidencia justifica?

## Objetivo

Integrar las fuentes ya caracterizadas, medir sus relaciones exactas por journey y convertir los límites observados en una decisión explícita `GO`, `GO CON LÍMITES` o `NO-GO`. Si corresponde avanzar, especificar un solo experimento de Capa 1 con alcance, contrato de datos y métricas; no construirlo.

## Criterios de salida

- [ ] Existe una cadena exacta, reproducible y fechada `precio → autorización/establecimiento → geografía` para cada journey donde sea posible, sin fuzzy matching. Por cada join se reportan universos, matches, unmatched, ambiguos, cardinalidades, porcentajes y casos especiales.
- [ ] Se determinó la unidad real de cada CSV vigente: qué hace única una oferta, qué significan múltiples filas por Registro/producto/fecha/cliente y qué regla documentada permite seleccionar una observación útil sin borrar incertidumbre.
- [ ] La cobertura se mide por journey, producto/actividad y territorio. No se usa el porcentaje nacional agregado para ocultar segmentos sin datos.
- [ ] La frescura se cuantifica con distribuciones y sensibilidad a umbrales explícitos —al menos 1, 7, 30, 90 y 365 días— sobre la observación que se propondría mostrar. Fecha de reporte, corte, publicación y adquisición permanecen separadas.
- [ ] Se mide cuánto del universo conserva simultáneamente precio utilizable, fecha, autorización exacta y coordenada. Los resultados sin match, ambiguos, extremos o desactualizados se conservan y clasifican; no se corrigen silenciosamente.
- [ ] La identidad pública se resuelve honestamente: `MARCA` de producto/envasadora no se presenta como nombre del establecimiento. Si no existe fuente legítima y determinística para marca/nombre comercial del punto, se cuantifica el límite y su efecto sobre el norte aprobado, sin completar manualmente ni usar similitud textual.
- [ ] J7 recibe una decisión explícita: incluido con evidencia suficiente, excluido con límite visible o bloqueante del alcance. No se infiere su fuente desde similitud con GLP.
- [ ] Se evalúan factibilidad operativa y reutilización: tamaño/frecuencia de adquisición, estabilidad del mecanismo, costo de carga sobre la fuente, licencias existentes y ausencia de licencia para Registro/GIS. No se presenta conclusión legal donde solo existe evidencia técnica.
- [ ] Existe una comparación acotada con Facilito suficiente para comprobar compatibilidad o divergencia material en casos controlados, sin crawling, bypass ni tratar handlers internos como API soportada.
- [ ] Se comparan los siete journeys mediante criterios homogéneos y se emite un veredicto `GO`, `GO CON LÍMITES` o `NO-GO`, con condiciones observables que podrían cambiarlo.
- [ ] Si el veredicto permite avanzar, se especifica **un solo** experimento mínimo de Capa 1: usuario/trabajo, journey y territorio, inputs, outputs, fuentes/corte, política de confianza, exclusiones, métricas de éxito y criterios de abandono. Si no permite avanzar, se define el mínimo experimento de desbloqueo o la evidencia externa requerida.
- [ ] El conocimiento permanente queda consolidado preferentemente en `docs/factibilidad.md`, enlazado sin duplicar `docs/descubrimiento.md` ni `docs/datos.md`.
- [ ] Claude completó revisión adversarial, Codex B respondió cuando corresponda y Codex A resolvió el gate y el cierre de Capa 0.
- [ ] Antes del cierre, Codex A actualizó README y `docs/arquitectura.html`, limpió esta bitácora, ejecutó el Quality Gate y realizó el commit.

## Restricciones / decisiones vigentes

- **DECISIÓN HUMANA:** la experiencia futura debe ser realmente mobile-first y usar marca/nombre comercial del establecimiento como identidad principal; razón social/RUC son trazabilidad secundaria. No incentivar interacción mientras se conduce.
- **HECHO:** los CSV oficiales vigentes de GLP y líquidos son accesibles, suman 1,842,302 filas y llegan al 2026-08-13; junto con DMIN y la serie anonimizada existen 2,340,316 filas perfiladas.
- **HECHO:** `N`/códigos GIS y Registro tienen solapamientos exactos de 93.162 %–99.082 % según actividad, con no-matches y siete claves uno-a-muchos en las comparaciones principales.
- **HECHO:** `MARCA` cubre 66.047 % de GLP y significa producto o envasadora, no nombre comercial del establecimiento. Ninguna fuente observada aporta ese nombre comercial del punto.
- **HECHO:** J7 no tiene fuente estructurada nominal demostrada ni capa GIS observada. La capa 31 no existe en el servicio perfilado.
- **HECHO:** el enlace PRICE termina en una biblioteca documental; los CSV viven en recursos enlazados por Datos Abiertos. El linaje técnico CSV → journeys de Facilito no está demostrado.
- **RIESGO:** una actualización completa observada exige descargar aproximadamente 1.56 GB sin API incremental documentada. Registro y GIS no mostraron licencia explícita.
- **DECISIÓN:** los originales grandes o con datos personales permanecen en `/.local-cache/` ignorada. Solo evidencia minimizada y sanitizada puede versionarse.
- **DECISIÓN:** no usar fuzzy matching, geocodificación de terceros, scraping comercial para fabricar identidad, CAPTCHA bypass ni extracción repetitiva de Facilito.
- **DECISIÓN:** no diseñar UI, elegir framework/database/map provider ni construir pipeline productivo. Scripts nuevos solo si hacen medible la factibilidad.
- **DECISIÓN:** Codex B no realiza commits ni modifica `AGENTS.md`, `CLAUDE.md`, la revisión de Claude o la resolución de A.

---

# Encargo — Codex A

## Qué debe quedar demostrado

1. **Oferta utilizable.** Definir con evidencia la clave de una oferta y una política determinística para elegir el precio relevante por establecimiento/producto/condición, conservando duplicidad y conflicto como métricas.
2. **Cadena completa.** Medir precio↔Registro↔GIS sobre los universos minimizados, particionada según la semántica de actividades/productos de J1–J7. Reportar ambos lados del join, no solo cobertura izquierda.
3. **Frescura y calidad.** Distribuir antigüedad, no solo fecha máxima. Separar datos frescos, antiguos, sin fecha, extremos y no comparables por unidad/presentación.
4. **Cobertura útil.** Medir el embudo acumulado: precio válido → fecha interpretable → Registro exacto → coordenada no ambigua → identidad permitida. Mostrar dónde cae cada journey y territorio.
5. **Identidad reconocible.** Buscar únicamente si queda una vía oficial/legítima concreta no evaluada; no repetir búsqueda abierta indefinida. Si no existe, tratarlo como restricción del producto y evaluar si invalida o limita Capa 1.
6. **Contraste con Facilito.** Usar pocas consultas controladas y reutilizables para comprobar si productos, unidades, conteos o fechas reconstruidos divergen materialmente. Un resultado compatible no demuestra linaje técnico.
7. **Factibilidad de acceso.** Cuantificar bytes, tiempo registrado, actualización declarada/observada, condicionales/rangos disponibles y fragilidad. No implementar ingestión continua.
8. **Decisión.** Puntuar los journeys con la misma matriz: valor al usuario, cobertura útil, frescura, identidad, geografía, acceso/reutilización y riesgo. Elegir un alcance o concluir que ninguno cumple.
9. **Experimento.** Especificar una prueba falsable, no una solución: qué supuesto valida, población/territorio, dato de entrada, resultado mínimo, baseline, métricas y umbrales de éxito/abandono.

## Secuencia mínima esperada

1. Leer completos `AGENTS.md`, `BITACORA.md`, `README.md`, `docs/descubrimiento.md` y `docs/datos.md`.
2. Escribir aquí, en la sección de B, un plan que mapee mediciones a criterios de salida.
3. Auditar schemas/categorías existentes antes de decidir particiones de journeys y claves de oferta.
4. Implementar solo análisis reproducibles necesarios sobre datos minimizados; reutilizar scripts y provenance existentes.
5. Ejecutar joins exactos, embudos, frescura y casos especiales; añadir assertions contra cambios silenciosos.
6. Hacer un contraste público pequeño con Facilito, con acceso conservador y evidencia sanitizada.
7. Construir la matriz de decisión y redactar `docs/factibilidad.md` con veredicto y experimento propuesto o desbloqueo requerido.
8. Ejecutar tests, integridad, privacidad, secretos y revisión completa del diff. Reportar en la bitácora y detenerse para Claude.

## Fuera de alcance

- Construir el producto, prototipo visual, componentes, API, base de datos, mapa o despliegue.
- Resolver nombres comerciales mediante fuzzy matching, búsqueda manual, marca de producto o suposición desde razón social.
- Elegir arquitectura productiva o convertir scripts de research en pipeline continuo.
- Descargar nuevamente los universos si los snapshots minimizados responden la medición.
- Declarar que CSV alimenta técnicamente Facilito sin evidencia directa.
- Ocultar resultados desfavorables para forzar un `GO` o proponer múltiples experimentos alternativos.

## Evidencia esperada

- Perfiles de oferta y frescura por journey/territorio.
- Matrices completas de joins y embudos acumulados.
- Inventario de no-matches, ambigüedades y extremos por categoría, sin PII.
- Contraste controlado con Facilito y límites de interpretación.
- Evaluación de acceso/reutilización y dependencias P0/P1.
- Matriz homogénea de decisión para J1–J7.
- Veredicto de Capa 0 y especificación falsable de un único experimento o desbloqueo.

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

Codex B ejecuta Gate 0.3 y deja el working tree listo para revisión adversarial.
