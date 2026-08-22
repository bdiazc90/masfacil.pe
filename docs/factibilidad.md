# Factibilidad y contrato experimental

La primera mitad conserva la decisión experimental del **14 de agosto de 2026**; las secciones de publicación y límites reflejan el estado vigente. Se apoya en el [producto observado](descubrimiento.md) y las [fuentes](datos.md).

## Veredicto histórico de Gate 1.1

**GO CON LÍMITES para un vertical slice privado de Gasohol Regular en Lima provincia.**

La cadena precio → Registro → GIS permitió comparar precio, cercanía y frescura. Después, el owner aprobó explícitamente la publicación downstream de coordenadas GIS y distancia derivada. La identidad comercial sigue fuera del JSON público vigente y J7 continúa excluido.

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

Ningún journey obtiene identidad comercial reconocible **desde una fuente bulk oficial**. Eso describe el límite de esas fuentes, no el de los métodos aceptables: el catálogo curado con evidencia observada es la vía prevista, y su gate está en [roadmap.md](roadmap.md).

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
3. muestra exactamente cuatro alternativas; tras fijar el pool de 20, solo permite ordenar por cercanía o precio;
4. permite elegir y abrir el destino en Google Maps.

Ordenar nunca repuebla el pool. Haversine se presenta como línea recta, no ruta, ETA, tráfico ni costo del desvío. Si no hay coordenada de origen, el fallback por distrito no fabrica distancia ni orden de cercanía. El handoff a Google solo ocurre tras un tap y envía únicamente coordenadas de destino, nunca origen personal, identidad ni tracking.

## Hipótesis de producto pendientes

La búsqueda debe partir de la ubicación actual y cruzar distritos. Conveniencia no equivale siempre al menor precio: descuentos por marca pueden cambiar el precio efectivo y justificar un pequeño desvío.

Para avanzar se necesita:

- un catálogo canónico de identidad anclado al código Osinergmin, alimentado por evidencia de cualquier nivel admitido —observación del owner, fuente first-party, fuente abierta reutilizable o colaborador conocido corroborado—, con vínculo exacto y sin fuzzy matching;
- beneficios declarados por el usuario, sin cuenta inicialmente;
- separación entre precio de lista, descuento y precio efectivo;
- una política explícita para esfuerzo/desvío antes de crear scoring.

Estas hipótesis no autorizan inferir marca desde razón social, coordenada ni proximidad, ni afirmar convenios todavía.

## Permiso de publicación por campo

Medido en Gate 2.2. El permiso no es uniforme: se evalúa campo por campo, contra la licencia real de su fuente.

| Campo | Veredicto | Base |
| --- | --- | --- |
| Precio, fecha de reporte, frescura, distrito | publicable | ODC-By declarado en las fichas de los datasets de precio |
| Coordenada | publicable | aprobación explícita del owner para el contrato público downstream; se conserva procedencia y atribución a Osinergmin |
| Distancia derivada | publicable | Haversine local a partir de coordenada cuya publicación fue aprobada |
| Razón social, dirección | desconocido — en cola | la declaración ODC-By observada describe los datasets de precio, no columnas de identidad |
| Identidad comercial | gobernada por el catálogo | entrada por entrada, con evidencia privada, vínculo exacto y fecha de verificación |

**`desconocido` no es un veredicto terminal.** Significa que falta una decisión, y toda fila en ese estado mantiene una entrada accionable con qué falta, qué evidencia lo resolvería y quién decide:

| Campo | Qué falta | Qué lo resolvería | Decide |
| --- | --- | --- | --- |
| Razón social, dirección | Saber si la declaración ODC-By del dataset cubre sus columnas de identidad, y si el producto realmente las necesita en público | Lectura de la ficha del dataset y de sus términos; o la decisión de no publicarlas porque el catálogo cubre mejor la necesidad | Owner |
| Identidad comercial | Un contrato sucesor que represente evidencia observada y un catálogo con cobertura medida | Gate 2.3: contrato, curación inicial, cobertura total y muestra auditada | Owner, con el gate |

El precedente relevante: la coordenada estuvo en `desconocido` y salió mediante una decisión explícita del owner, con procedencia y atribución conservadas. Ese es el circuito previsto, no una excepción.

Consecuencia vigente: el bundle activo contiene precio, fecha, distrito y coordenadas; **no tiene identidad publicada**. Los sucesores v2.1 de producto, manifest y refresh-state son compatibles con 2.0 y pueden exportar solamente `establishment_id` e identidad comercial verificable. La cobertura sigue en 0/717 y la auditoría informa `not_required` hasta recibir la primera observación `owner_verified`. Razón social y dirección no se exportan. La edad se recalcula en el navegador desde `reported_at`.

El contrato privado Gate 1.1 mantiene por compatibilidad su clasificación histórica; los contratos públicos posteriores no la reescriben ni la propagan. El contrato público versionado es downstream, con allowlist y hash verificable.

La matriz vive en `app/publication-matrix.mjs`, con la evidencia citada por fila. Es la **política vigente** y trata `unknown` como campo suprimible; bajo el método actual `unknown` es una cola, por lo que la matriz **requiere migración en el gate de catálogo**. Hasta ese gate sigue gobernando la proyección y no se altera de forma oportunista. La proyección pública se reproduce con:

```bash
npm run project:gate-4.1
```

## Registro de exclusiones y NO-GO

Ninguna exclusión se declara sin condición de reapertura. Un NO-GO sin ella se lee como «resuelto» cuando significa «bloqueado por la única vía que intentamos».

| Exclusión | Razón actual | Alcance | Evidencia que la reabriría | Responsable / trigger |
| --- | --- | --- | --- | --- |
| J7 Distribuidores | No se reprodujo una fuente nominal que explique distribuidor, marca, fecha y rangos de sus 444 filas públicas; 0 ofertas frescas | Solo el journey J7 de GLP envasado por distribuidores | Una fuente oficial que explique el grano y la frescura de esas filas | Owner, si aparece la fuente |
| Identidad comercial en la proyección pública | Catálogo sucesor y cobertura ya medidos, pero 0 entradas publicables | La publicación de un nombre; no la curación ni la evidencia privada | Observación `owner_verified`, vínculo exacto y revisión del Líder | Capa 5 |
| Razón social y dirección en público | Permiso `desconocido` y utilidad dudosa frente al catálogo | Publicación de esos dos campos | Lectura de términos de la ficha, o decisión del owner de sustituirlos por el catálogo | Owner |
| Capa GIS 31 | No existe en el servicio observado | Solo esa capa | Que el servicio la exponga en una observación posterior | Trigger: próximo refresco de GIS |
| Stock y disponibilidad | Ningún campo tiene semántica demostrada de stock | Toda afirmación de stock en cualquier ruta | Documentación oficial que defina el campo, o una fuente que lo declare | Owner |

## Validación y límites

El protocolo formal A/B contra Facilito permanece disponible, pero no es una puerta entre incrementos. Se ejecutará solo si puede cambiar una decisión material. Para cambios privados, seguros y reversibles, el uso directo del owner puede bastar.

Límites vigentes:

- las coordenadas GIS y la distancia derivada están aprobadas downstream; razón social y dirección siguen en cola de decisión; **ninguna identidad comercial está publicada hoy**;
- identidad comercial demostrada solo en un piloto de 11 sedes, con fuente stale; el catálogo sucesor curado aún no existe;
- el contrato del piloto no puede representar evidencia observada sin URL, y la matriz de publicación trata `unknown` como supresión: ambos requieren sucesión en el gate de catálogo;
- Registro y GIS no se refrescan, de modo que no hay señal de cambio a nivel de entidad y la rotación medida de códigos es un límite inferior;
- 27/741 ofertas frescas excluidas por joins exactos;
- categorías rurales/flotantes con menor cobertura;
- el código original usa Apache-2.0; la procedencia GIS queda registrada en `NOTICE` y la aprobación de coordenadas está cerrada;
- sin stock, mecanismo incremental, SLA ni linaje CSV→Facilito demostrado;
- raw, minimizados y evidencia de identidad permanecen privados; solo se publica la proyección mínima validada.

## Reproducción

```bash
node scripts/analyze-gate-0.3.mjs
node scripts/analyze-j7-snapshot.mjs
node scripts/build-gate-1.1.mjs
```

Los scripts y JSON sanitizados conservan el detalle cuantitativo que ya no se duplica en este documento.
