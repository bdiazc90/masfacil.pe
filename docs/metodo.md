# Método de trabajo

## Misión

Este proyecto explora una experiencia independiente para decidir con datos públicos oficiales —hoy, dónde cargar combustible según precio, cercanía y frescura. Construye para aprender: una hipótesis pequeña debe producir un artefacto tangible, una prueba rápida y una decisión de incorporar, corregir o eliminar.

El contrato normativo completo para agentes vive en [`AGENTS.md`](../AGENTS.md). Este documento resume el método para quien lo lea desde fuera y no lo contradice.

## Principio rector

**El rigor se aplica en proporción a la incertidumbre y al daño posible.**

Un artefacto privado, reversible o curado no se bloquea con requisitos propios de una infraestructura pública automatizada. Un dato que puede dirigir a una persona al establecimiento equivocado sí exige controles materiales.

## Clasificar antes de controlar

Cada dato se clasifica en dos ejes independientes; uno solo no basta.

**Eje 1 — tasa y señal de cambio.** Con qué frecuencia cambia y si el cambio emite una señal detectable. El precio cambia seguido y la fuente expone validadores HTTP que lo delatan con cero bytes. El nombre comercial de una sede cambia poco y **nada avisa** cuando cambia. Cambiar poco no es estar vigilado.

**Eje 2 — daño de estar equivocado y detectabilidad del error.** El caso grave es el **daño atributivo**: adjudicar un precio, una calificación sanitaria o una inspección al tercero equivocado, sin que la persona ni el establecimiento puedan notarlo antes de la consecuencia.

**El eje 2 fija el nivel de control; el eje 1 fija la cadencia de refresco y re-verificación.** La identidad comercial es estable, sin señal propia y de daño atributivo alto: se cura a mano y se revisa poco, pero su exactitud no se relaja.

## Evidencia práctica

Una identidad verificada por una persona no es una identidad inventada. El catálogo admite `owner_verified`, `first_party`, `public_web_observed`, `open_reusable` y `known_contributor`. Cada entrada conserva en privado la fuente o descripción, método, fecha y responsable; la interfaz no necesita exponer ese expediente.

Una observación en un directorio web público puede servir como evidencia sin convertir a ese directorio en arquitectura del producto. Descubrimiento, exactitud del vínculo, modo de obtención, publicación y frescura son dimensiones separadas.

Los aportes anónimos no forman parte del primer catálogo. Si se habilitan más adelante, solo abrirán una revisión y nunca promoverán ni invalidarán automáticamente una entrada.

## `unknown` es una cola accionable

`unknown` significa «todavía no lo sabemos». No bloquea ni autoriza por sí solo. Cuando afecte una decisión material, se registra qué falta, qué evidencia lo resolvería y quién decide.

Todo NO-GO o exclusión registra razón actual, alcance, **evidencia que lo reabriría** y responsable o trigger de revisión. El registro vigente está en [factibilidad.md](factibilidad.md).

## Catálogos canónicos y su invalidación

Las entidades estables pueden mantenerse en un catálogo curado por el proyecto. La clave es la **entidad oficial** —el código Osinergmin—, no la oferta; el tamaño del universo se mide en cada refresco y no se hereda del conteo de un producto.

Se separan tres capas con políticas distintas: evidencia privada de verificación, catálogo mantenido y proyección pública mínima. Se acepta cobertura parcial con fallback honesto; una entrada sin identidad verificada muestra el marcador honesto y nunca un nombre inferido.

Un catálogo curado envejece en silencio. Mientras Registro y GIS no se refresquen, una fecha de verificación y una revisión manual ocasional son una limitación aceptable y declarada, no un bloqueante. Las señales automáticas de altas, bajas, titular o coordenada se incorporarán cuando exista necesidad operativa.

## Controles que no se relajan

Vínculo exacto antes que cobertura; no inferir marca por proximidad, coordenada compartida, razón social ni dirección; separar descubrimiento, exactitud, modo de obtención, publicación y frescura; no inferir stock; no publicar datos personales; conservar procedencia internamente; no afiliación y fallback honesto.

## Roles y responsabilidad

- **Lead / Architect / Gatekeeper:** define alcance y criterios de salida, revisa evidencia y objeciones, resuelve gates, conserva conocimiento vigente y realiza el commit de cierre.
- **Planner / Builder / Integrator / Tester:** convierte el gate en artefactos, implementa, prueba y deja el árbol listo para revisión. No cierra gates ni hace commits salvo encargo explícito.
- **Challenger / Reviewer:** intenta falsificar el resultado, revisa riesgos y entrega objeciones como evidencia. No implementa.
- **Owner:** decide producto, alcance, publicación, licencias, credenciales y otros cambios materiales.

Las decisiones humanas no se sustituyen por agentes. El trabajo de agentes produce código, documentación y pruebas; la evidencia automatizada prueba condiciones reproducibles, no licencias, respaldo institucional ni utilidad universal.

## Gates y protocolos

Un gate declara una hipótesis principal, como máximo un riesgo crítico, un artefacto ejecutable o consumible y criterios observables:

```text
hipótesis → artefacto → prueba → incorporar / corregir / eliminar
```

**FAST** es el modo normal para cambios privados, reversibles y sobre patrones conocidos. Una decisión reversible de interfaz o presentación no justifica una revisión reforzada.

**FULL** se reserva para publicación, secretos, nuevas fuentes o contratos centrales, privacidad, seguridad, permisos, corrupción de datos, promoción de snapshots y decisiones costosas de revertir. No es ceremonia: en Gate 4.3 una segunda ronda encontró que la primera carga escapaba al service worker y rompía la recarga offline.

## Contratos y sucesión

Un contrato cerrado no se muta en silencio para que parezca que siempre permitió lo que hoy permitimos. Cuando cambia una política, el contrato anterior se describe como histórico con su alcance y fecha, el gate que estrena la política crea un contrato sucesor versionado, y la documentación indica qué artefactos esperan migración.

## Bitácora, handoff y cierre

`BITACORA.md` es el canal temporal del gate activo. Distingue hechos, inferencias, hipótesis, decisiones, riesgos, pruebas y preguntas abiertas. No es un historial ni una fuente automática de verdad.

Al preparar un handoff, el Builder entrega el artefacto, archivos cambiados, comandos y resultados, riesgos/deuda y un árbol entendible. El Challenger revisa. El Lead solo cierra cuando comprueba criterios, pruebas, diff, privacidad, documentación y arquitectura; entonces traslada conocimiento útil a código, tests o documentos vivos, limpia la bitácora y hace el commit de cierre.

## Reproducir el método en otro proyecto

1. Definir una decisión de usuario y el límite de evidencia aceptable.
2. Clasificar cada dato en los dos ejes antes de elegir controles.
3. Formular un gate pequeño con salida observable y un único riesgo crítico.
4. Mantener raw, normalización y derivados separados; validar contratos en boundaries.
5. Construir el mínimo artefacto para probar la hipótesis y automatizar las invariantes que evitan fallos silenciosos.
6. Registrar fuente, fecha, observación, inferencia, confianza y reproducción cuando el hallazgo sea material.
7. Dejar toda exclusión con su condición de reapertura, y todo `unknown` con dueño.
8. Someter cambios sensibles a revisión Challenger y dejar decisiones irreversibles para el owner.

El método no garantiza que una fuente sea completa, que una interfaz sea superior ni que una decisión sea correcta fuera de su evidencia. Evita presentar esas inferencias como hechos.
