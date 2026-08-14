# Facilito UX Lab

Investigación independiente sobre si la experiencia pública de `facilito.gob.pe` puede mejorarse sustancialmente mediante producto, UX y uso responsable de datos públicos.

Este proyecto **no está afiliado, aprobado ni producido** por Osinergmin, Facilito o el Estado peruano.

## Norte del producto

Permitir que una persona encuentre desde el celular, en segundos, un establecimiento reconocible por su marca o nombre comercial, conozca el precio, la ubicación y la vigencia del dato, y entienda cuánto puede confiar en esa información.

Principios ya aprobados:

- **Mobile-first real:** priorizar el contexto de consulta desde un celular, sin incentivar interacción mientras se conduce.
- **Identidad reconocible:** marca y/o nombre comercial como etiqueta principal; razón social y RUC como trazabilidad secundaria. La relación debe provenir de una fuente legítima y determinística, nunca de fuzzy matching.
- **Incertidumbre visible:** frescura, cobertura y límites deben formar parte de la experiencia, no quedar ocultos.
- **Evidencia antes que arquitectura:** no elegir aplicación, framework, base de datos o proveedor antes de demostrar necesidad y factibilidad.

## Estado

**Capa 0 — descubrimiento y factibilidad.** Gate 0.1 estableció el producto público observado. Gate 0.2 confirmó fuentes oficiales, contratos, frescura e identificadores candidatos. Gate 0.3 medirá la factibilidad integrada y propondrá —solo si la evidencia lo permite— el experimento mínimo de Capa 1.

Hallazgos vigentes de Gate 0.1:

- siete journeys públicos entregaron ofertas reales en el caso Lima / provincia Lima;
- las consultas devuelven el resultset dentro de HTML y DataTables pagina en cliente;
- J1–J6 no muestran fecha junto al precio;
- en J7, 224 de 444 filas observadas tenían más de un año al 2026-08-14;
- mobile y desktop ofrecen universos territoriales distintos: el mapa desktop omite Callao;
- los handlers observados son implementación pública, no una API estable ni una fuente canónica demostrada.

La evidencia completa está en [docs/descubrimiento.md](docs/descubrimiento.md). El estado visual vigente del sistema está en [docs/arquitectura.html](docs/arquitectura.html).

Hallazgos vigentes de Gate 0.2:

- cuatro fuentes de precio suman 2,340,316 filas; los CSV vigentes de GLP y líquidos llegan al 2026-08-13;
- Registro y GIS comparten identificadores exactos candidatos con 93.162 %–99.082 % de cobertura según actividad, todavía con no-matches y casos uno-a-muchos;
- `MARCA` cubre 66.047 % del CSV GLP, pero significa producto o envasadora, no nombre comercial del establecimiento;
- el enlace PRICE de Facilito conduce a una biblioteca documental, no a una descarga estructurada observada;
- J7 no tiene una fuente estructurada nominal demostrada y permanece como brecha P0;
- los originales grandes o con datos personales no se versionan; Git conserva únicamente evidencia minimizada, procedencia y métricas sanitizadas.

El catálogo y modelo observado se mantienen en [docs/datos.md](docs/datos.md).

## Reproducción disponible

El snapshot agregado y sanitizado de J7 permite recalcular antigüedad y consistencia interna:

```bash
node scripts/analyze-j7-snapshot.mjs
```

El snapshot no conserva filas crudas ni identidades; por tanto, reproduce los agregados guardados, no audita nuevamente la extracción desde Facilito.

Gate 0.2 puede recalcularse y verificarse sin repetir descargas públicas:

```bash
node scripts/profile-gate-0.2.mjs
node scripts/verify-gate-0.2.mjs
```

## Estructura actual

```text
docs/        conocimiento vigente y mapa visual
data/        snapshots minimizados, métricas y procedencia verificable
evidence/    evidencia mínima sanitizada
scripts/     research reproducible de Capa 0
BITACORA.md  coordinación del gate activo
```
