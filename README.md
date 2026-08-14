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

**Capa 0 — descubrimiento y factibilidad.** Gate 0.1 estableció qué producto público se observa y su frontera técnica. Gate 0.2 investiga fuentes oficiales, procedencia, semántica e identidad de los datos.

Hallazgos vigentes de Gate 0.1:

- siete journeys públicos entregaron ofertas reales en el caso Lima / provincia Lima;
- las consultas devuelven el resultset dentro de HTML y DataTables pagina en cliente;
- J1–J6 no muestran fecha junto al precio;
- en J7, 224 de 444 filas observadas tenían más de un año al 2026-08-14;
- mobile y desktop ofrecen universos territoriales distintos: el mapa desktop omite Callao;
- los handlers observados son implementación pública, no una API estable ni una fuente canónica demostrada.

La evidencia completa está en [docs/descubrimiento.md](docs/descubrimiento.md). El estado visual vigente del sistema está en [docs/arquitectura.html](docs/arquitectura.html).

## Reproducción disponible

El snapshot agregado y sanitizado de J7 permite recalcular antigüedad y consistencia interna:

```bash
node scripts/analyze-j7-snapshot.mjs
```

El snapshot no conserva filas crudas ni identidades; por tanto, reproduce los agregados guardados, no audita nuevamente la extracción desde Facilito.

## Estructura actual

```text
docs/        conocimiento vigente y mapa visual
evidence/    evidencia mínima sanitizada
scripts/     research reproducible de Capa 0
BITACORA.md  coordinación del gate activo
```
