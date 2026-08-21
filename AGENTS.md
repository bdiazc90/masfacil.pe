# AGENTS.md

## Misión y norte

Este repositorio explora una experiencia independiente para tomar decisiones cotidianas con datos públicos oficiales, empezando por encontrar combustible por precio, cercanía y confianza.

No está afiliado, aprobado ni producido por Osinergmin, Facilito o el Estado peruano. Nunca debe insinuarlo.

El trabajo real del usuario manda. Facilito sirve como contexto y fuente de aprendizaje, no como arquitectura ni benchmark obligatorio.

Toda documentación se escribe en español neutro, sin voseo. Código e identificadores pueden conservar términos técnicos en inglés.

## Principio operativo

**Construir para aprender. Investigar solo lo que bloquea el siguiente artefacto tangible.**

El rigor se aplica en proporción a la incertidumbre y al daño posible, no de manera uniforme. Un artefacto privado, reversible o curado no se bloquea con requisitos propios de una infraestructura pública automatizada. Un dato que puede dirigir a una persona al establecimiento equivocado sí exige controles materiales.

Cada gate, salvo investigación fundacional excepcional, debe declarar:

- una hipótesis principal;
- como máximo un riesgo crítico;
- un artefacto ejecutable o directamente consumible;
- criterios de salida observables.

Flujo preferido:

```text
hipótesis pequeña → artefacto tangible → prueba rápida → incorporar, corregir o eliminar
```

No hace falta validar todas las hipótesis antes de producir valor. Tampoco se convierte una carencia de producción en bloqueante de un prototipo privado si está contenida y declarada.

## Proporcionalidad y catálogos curados

Antes de elegir controles se separan dos preguntas: cuánto cambia el dato y qué señal emite; cuánto daño causaría estar equivocado. **El daño fija la verificación; el cambio fija la cadencia.** No se exige a un catálogo pequeño y estable la automatización propia de precios que cambian a diario.

Para entidades relativamente estables:

- la clave es la entidad oficial, no la oferta; en combustible ya existe `establishment_id`, derivado del código de Registro;
- son evidencia válida `owner_verified`, `first_party`, `public_web_observed`, `open_reusable` y `known_contributor`, siempre con fuente o descripción, método, fecha y responsable conservados en privado;
- descubrimiento, exactitud del vínculo, modo de obtención, permiso de publicación y frescura se registran por separado;
- la proyección pública contiene solo lo necesario para el producto; minimizarla no autoriza a ocultar o falsear la procedencia interna;
- cobertura parcial con fallback es aceptable; un nombre nunca se infiere por proximidad, coordenada, razón social o dirección;
- la ausencia de automatización, cobertura completa o señal de cambio no bloquea un primer catálogo curado si la limitación queda medida;
- un reporte anónimo futuro solo abre revisión: nunca promueve ni invalida automáticamente una entrada.

`unknown` significa trabajo pendiente, no una prohibición automática. Un NO-GO material declara razón, alcance, evidencia que lo reabriría y responsable o trigger; no se mantienen como NO-GO vigente decisiones ya sustituidas.

Cuando una regla parezca bloquear, preguntar quién tendría que perdonarnos si se incumple. Una licencia, términos de un servicio o datos personales son restricciones externas; una convención propia reversible puede cambiarse por decisión del owner.

No se relajan: vínculo exacto antes que cobertura, no afiliación, no datos personales, no stock inferido, procedencia interna preservada y operaciones de datos publicables con staging, validación, promoción atómica y rollback.

## Roles

### CODEX A — Lead / Architect / Gatekeeper

A define la pregunta, el alcance y los criterios del gate; revisa el diff, las pruebas y las objeciones de Claude; resuelve el gate; mantiene el conocimiento vigente y realiza el commit de cierre.

A normalmente no implementa. Puede hacerlo para exploraciones breves, correcciones pequeñas, conflictos concretos o por pedido explícito del owner.

### CODEX B — Planner / Builder / Integrator / Tester

B convierte el gate en plan, implementa, prueba, mide y deja el working tree listo para revisión. Dentro del alcance de A, decide autónomamente lo local, seguro y reversible.

B escribe únicamente en su sección de `BITACORA.md` y no cierra gates ni hace commits salvo encargo explícito.

### Claude — Challenger / Reviewer

Su contrato vive en `CLAUDE.md`. Revisa y falsifica; no implementa. Sus objeciones son evidencia para que A decida, no autoridad automática.

Cuando el owner ejecuta el proyecto con una configuración distinta —por ejemplo Claude como Lead y Builder—, los contratos de esa configuración viven en archivos propios y heredan este archivo sin excepción.

### Owner

Decide producto, alcance, publicación, licencias, credenciales y cualquier cambio material. Las decisiones humanas no se sustituyen por agentes.

## Capas y gates

Capas previstas:

- Capa 0 — descubrimiento y factibilidad;
- Capa 1 — vertical slice;
- Capa 2 — personalización e identidad;
- Capa 3 — operación de datos;
- Capa 4 — primera versión pública;
- Capa 5 y siguientes — plataforma multi-ruta, según `docs/roadmap.md`.

Una capa tiene idealmente un máximo de tres gates. Un cuarto requiere un hallazgo material o aprobación del owner. Un gate es una unidad de aprendizaje tangible, no un conjunto de tickets.

## Progressive Protocol

La complejidad del proceso debe bajar cuando baja la incertidumbre.

### FAST — predeterminado

Para cambios privados, reversibles y sobre patrones conocidos:

```text
A → B → Claude → A
```

Si Claude demuestra un bloqueante, A devuelve el trabajo a B. El objetivo es una sola revisión.

Una decisión reversible de interfaz, copy, orden de pantallas o presentación **no** justifica FULL. Aplicarlo ahí gasta rondas sin producir hallazgos.

### FULL — excepcional y justificado

Para publicación, secretos y credenciales, nuevas fuentes o contratos centrales, privacidad, seguridad, permisos, corrupción de datos, promoción de snapshots o decisiones costosas de revertir:

```text
A → B → Claude → B → A
```

Máximo recomendado: dos rondas B ↔ Claude. A resuelve después.

FULL no es ceremonia: en Gate 4.3 la segunda ronda encontró que la primera carga escapaba al service worker y rompía la recarga offline. Ese es el tipo de hallazgo que lo justifica.

Una comparación formal contra Facilito se ejecuta solo si puede cambiar una decisión material. Para incrementos privados de bajo riesgo, el uso directo del owner puede aportar evidencia suficiente.

## Contratos y sucesión

Un contrato cerrado **no se muta en silencio** para que parezca que siempre permitió lo que hoy permitimos. Cuando una política cambia:

1. el contrato anterior se describe como **histórico**, con el alcance y la fecha de su piloto;
2. el gate que estrena la política crea un **contrato sucesor** versionado;
3. la documentación dice qué artefactos siguen vigentes y cuáles esperan migración.

Falsificar o borrar hechos históricos está prohibido, incluso cuando el hecho histórico es un error de método propio.

## BITACORA.md

Es el canal temporal del gate activo, no memoria histórica ni fuente automática de verdad. Debe distinguir hechos, inferencias, hipótesis, decisiones, riesgos y preguntas abiertas.

Al cerrar un gate, A:

1. conserva el conocimiento útil en código, tests, README o documentos vivos;
2. actualiza `docs/arquitectura.html`;
3. elimina de la bitácora el detalle resuelto;
4. ejecuta las validaciones finales;
5. realiza el commit.

Git conserva la historia; el repositorio conserva el conocimiento vigente; la bitácora solo conserva el trabajo activo.

## Documentación

No crear documentos por evento. Antes de crear un `.md`, actualizar uno existente si alberga razonablemente el conocimiento.

Documentos vivos:

- `README.md`: entrada rápida, estado y ejecución;
- `DESIGN.md`: contrato de diseño de interfaz, común a todas las rutas;
- `docs/descubrimiento.md`: producto público observado;
- `docs/datos.md`: fuentes, relaciones y límites;
- `docs/factibilidad.md`: decisiones cuantitativas y contrato experimental;
- `docs/metodo.md`: versión pública y resumida del método;
- `docs/roadmap.md`: rutas y gates futuros vigentes;
- `docs/arquitectura.html`: mapa compacto para el owner;
- `BITACORA.md`: gate activo.

Evitar reportes, notas y revisiones versionadas por evento. La evidencia detallada pertenece a scripts, tests y artefactos sanitizados.

## Evidencia e investigación

Para un hallazgo material registrar, cuando aplique: fuente, fecha, observación, inferencia, confianza y reproducción. Preferir fuentes primarias y separar explícitamente evidencia externa verificada por el owner.

Al investigar datos:

- usar identificadores oficiales y joins determinísticos;
- medir universo, matches, no-matches, ambiguos y cobertura;
- separar raw, normalización y derivados;
- validar schemas en boundaries y fallar de forma visible;
- tratar frescura, unidades y granularidad como semántica, no como nombres confiables;
- no usar fuzzy matching para fabricar cobertura;
- no afirmar stock, marca o disponibilidad sin evidencia.

Evitar crawling agresivo, bypass de autenticación, evasión de controles y carga innecesaria. Preferir una descarga reutilizable, caché local y consultas seriales conservadoras.

Los originales grandes o con datos personales no se versionan. Conservar solo evidencia mínima, agregada o sanitizada necesaria para reproducir decisiones.

## Producto y UX

`DESIGN.md` es la fuente canónica del diseño de interfaz: anclajes, principios falsables, honestidad del dato, estados obligatorios, sistema visual, componentes y accesibilidad. Toda ruta se diseña contra ese contrato; una decisión de interfaz que lo contradiga se resuelve actualizándolo en el mismo commit, nunca en silencio.

Para cada capacidad preguntar:

- ¿qué intenta decidir la persona?;
- ¿cuál es el camino confiable más corto?;
- ¿qué información cambia esa decisión?;
- ¿qué incertidumbre debe mostrarse?;
- ¿qué sabremos después de usar el artefacto?

El producto es mobile-first y debe partir de la ubicación actual cuando corresponda, sin confundir límites distritales con cercanía. Nunca debe incentivar interacción durante la conducción.

No afirmar “mejor UX” sin evidencia. Preferir utilidad observable, pasos hasta resultado, comprensión, relevancia geográfica, accesibilidad, frescura y recuperación ante errores.

La interfaz no debe llenarse de disclaimers. Mostrar solo información que cambie una decisión o prevenga un daño real; el contexto experimental puede vivir fuera de la UI normal.

## Principios técnicos

Preferir arquitectura simple, inspeccionable, reversible y con pocas dependencias. Los tests deben proteger errores silenciosos y decisiones materiales, no inflar conteos.

No introducir sin una necesidad actual:

- base de datos;
- autenticación;
- colas o microservicios;
- cloud o despliegue;
- framework pesado;
- runtime LLM;
- SDK de mapas o proveedor pago.

No elegir infraestructura productiva durante un experimento privado salvo que sea justamente lo que se está validando.

## Comunicación con el owner

Por defecto, máximo aproximado de 3,500 caracteres. Comunicar estado, 3–5 hallazgos, decisión necesaria, recomendación e impacto. No copiar la bitácora ni narrar el proceso.

A resuelve autónomamente lo seguro y reversible. Escala decisiones materiales de producto, alcance, servicios pagos, credenciales, publicación, arquitectura difícil de revertir o contradicciones que cambien el resultado.

## Mapa visual

`docs/arquitectura.html` representa el estado actual, no un historial exhaustivo. Debe mostrar de un vistazo capas, flujo construido, logros por gate, próximos tres gates y riesgos de publicación.

## Cierre de gate

Antes de aceptar, A comprueba:

- artefacto y criterios de salida;
- tests y evidencia relevantes;
- diff y working tree entendidos;
- objeciones de Claude resueltas o descartadas con razón;
- privacidad, secretos y datos versionables;
- documentación vigente sin duplicación;
- arquitectura y bitácora actualizadas.

La deuda conocida puede permanecer si no invalida la hipótesis y queda visible.

**Cuando la evidencia sea suficiente: decidir, construir y avanzar.**
