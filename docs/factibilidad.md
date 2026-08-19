# Factibilidad y contrato privado

Decisión vigente construida con el [producto observado](descubrimiento.md), las [fuentes](datos.md) y mediciones del **14 de agosto de 2026**.

## Veredicto

**GO CON LÍMITES para un vertical slice privado de Gasohol Regular en Lima provincia.**

La cadena precio → Registro → GIS permite comparar precio, cercanía y frescura. La publicación de coordenadas GIS y distancia derivada fue aprobada explícitamente por el owner para Gate 4.1; la identidad comercial sigue fuera del JSON público y la operación sostenible de actualización queda para publicación posterior. J7 queda excluido.

## Política de oferta

- Grano líquidos: `Registro × actividad × producto × unidad`.
- Elegir el máximo `FECHA_DE_REGISTRO` por grano.
- Si el timestamp máximo contiene precios distintos, excluir como conflicto.
- Exigir precio positivo, fecha interpretable, edad `0..30 días`, Registro y GIS exactos.
- Mapear capa GIS por actividad; no por journey completo.
- No inferir stock, marca, disponibilidad ni joins fuzzy.

El límite de 30 días es conservador y coincide con la ventana de publicación PRICE observada. Una fila más antigua no es necesariamente falsa; queda fuera de este producto.

## Factibilidad por journey

| Journey | Ofertas | `<=30 d` | Registro | Geo / Registro | Decisión |
| --- | ---: | ---: | ---: | ---: | --- |
| J1 Gasolinas | 15,640 | 13,662 | 13,287 | 12,954 (97.49 %) | slice privado |
| J2 GNV | 373 | 304 | 283 | 281 (99.29 %) | no seleccionado |
| J3 GLP Automotor | 1,961 | 1,750 | 1,711 | 1,689 (98.71 %) | no seleccionado |
| J4 GLP Locales | 6,504 | 3,816 | 3,785 | 3,684 (97.33 %) | no seleccionado |
| J5 GLP EESS | 1,269 | 941 | 924 | 909 (98.38 %) | no seleccionado |
| J6 GLP Plantas | 814 | 461 | 455 | 429 (94.29 %) | no seleccionado |
| J7 Distribuidores | 8 | 0 | 0 | 0 | excluido |

Ningún journey tiene identidad comercial reconocible demostrada en una fuente bulk oficial.

## Contrato de Gate 1.1

Para Lima/provincia Lima, actividades urbanas 1/2/5/6 y `GASOHOL REGULAR` en galones:

```text
5,336 filas fuente
→ 821 últimas ofertas
→ 741 frescas
→ 722 con Registro exacto
→ 714 con GIS seguro y contrato completo
```

Resultado: **714/741 = 96.356 %**, 42 distritos, 0 ambiguos y 0 conflictos. La población previa solo Surco quedó en **26/30 = 86.667 %** y continúa como NO-GO separado; no se cambió su denominador.

El schema `contracts/gate-1.1-experiment-dataset.schema.json` permite precio, fecha/edad, distrito, coordenada, procedencia e identidad provisional rotulada como razón social/dirección. Rechaza propiedades adicionales como marca, stock, RUC, descuentos, convenios o scoring.

El dataset real vive en `.local-cache/gate-1.1/2026-08-14/`, ignorado por Git y con permisos `0600`. Git conserva schema, fixture sintético y métricas agregadas.

## Producto construido en Capa 1

La web local consume las 714 ofertas o un fixture de cuatro casos:

1. solicita ubicación o usa un origen simulado;
2. forma un pool estable con las 20 estaciones más cercanas mediante Haversine;
3. muestra seis alternativas ordenables por cercanía, precio o frescura;
4. permite elegir y abrir el destino en Google Maps.

Ordenar nunca repuebla el pool. Haversine se presenta como línea recta, no ruta ni ETA. El handoff a Google solo ocurre tras un tap y envía únicamente coordenadas de destino, nunca origen personal, identidad ni tracking.

## Hipótesis de producto pendientes

La búsqueda debe partir de la ubicación actual y cruzar distritos. Conveniencia no equivale siempre al menor precio: descuentos por marca pueden cambiar el precio efectivo y justificar un pequeño desvío.

Para avanzar se necesita:

- identidad first-party determinística por código Osinergmin;
- beneficios declarados por el usuario, sin cuenta inicialmente;
- separación entre precio de lista, descuento y precio efectivo;
- una política explícita para esfuerzo/desvío antes de crear scoring.

Estas hipótesis no autorizan inferir marca desde razón social ni afirmar convenios todavía.

## Permiso de publicación por campo

Medido en Gate 2.2. El permiso no es uniforme: se evalúa campo por campo, contra la licencia real de su fuente.

| Campo | Veredicto | Base |
| --- | --- | --- |
| Precio, fecha de reporte, frescura, distrito | publicable | ODC-By declarado en las fichas de los datasets de precio |
| Coordenada | publicable | aprobación explícita del owner para el contrato público downstream; se conserva procedencia y atribución a Osinergmin |
| Distancia derivada | publicable | Haversine local a partir de coordenada cuya publicación fue aprobada |
| Razón social, dirección | desconocido | la declaración ODC-By observada describe los datasets de precio, no columnas de identidad |
| Identidad comercial | gobernada por Gate 2.1 | entrada por entrada; hoy ninguna es `public_safe` |

Consecuencia: el JSON público Gate 4.1 contiene precio, fecha, distrito y coordenadas de las 714 ofertas contractuales; no contiene identidad, razón social ni dirección. La edad se recalcula en el navegador desde `reported_at`.

El contrato privado Gate 1.1 mantiene por compatibilidad su clasificación histórica; Gate 4.1 no la reescribe ni la propaga. El contrato público versionado es downstream, con allowlist y hash verificable.

La matriz vive congelada en `app/publication-matrix.mjs`, con la evidencia citada por fila. La proyección pública se reproduce con:

```bash
npm run project:gate-4.1
npm run verify:web
```

## Validación y límites

El protocolo formal A/B contra Facilito permanece disponible, pero no es una puerta entre incrementos. Se ejecutará solo si puede cambiar una decisión material. Para cambios privados, seguros y reversibles, el uso directo del owner puede bastar.

Límites vigentes:

- razón social, dirección e identidad comercial conservan límites de publicación documentados; las coordenadas GIS y la distancia derivada están aprobadas downstream;
- identidad comercial demostrada solo en un piloto de 11 sedes, con publicación desconocida;
- 27/741 ofertas frescas excluidas por joins exactos;
- categorías rurales/flotantes con menor cobertura;
- licencia y términos propios del proyecto pendientes de decisión del owner; la procedencia GIS queda registrada en `NOTICE` y la aprobación de coordenadas está cerrada;
- sin stock, mecanismo incremental, SLA ni linaje CSV→Facilito demostrado;
- datos reales y servidor restringidos a uso local privado.

## Reproducción

```bash
node scripts/verify-gate-0.2.mjs
node scripts/analyze-gate-0.3.mjs
node scripts/analyze-j7-snapshot.mjs
node scripts/build-gate-1.1.mjs
npm test
```

Los scripts y JSON sanitizados conservan el detalle cuantitativo que ya no se duplica en este documento.
