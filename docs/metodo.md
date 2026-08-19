# Método de trabajo

## Misión

Este proyecto explora una experiencia independiente para decidir dónde cargar combustible según precio, cercanía y frescura, usando datos públicos de forma responsable. Construye para aprender: una hipótesis pequeña debe producir un artefacto tangible, una prueba rápida y una decisión de incorporar, corregir o eliminar.

## Roles y responsabilidad

- **CODEX A — Lead / Architect / Gatekeeper:** define alcance y criterios de salida, revisa evidencia y objeciones, resuelve gates, conserva conocimiento vigente y realiza el commit de cierre.
- **CODEX B — Planner / Builder / Integrator / Tester:** convierte el gate en artefactos, implementa, prueba y deja el árbol listo para revisión. No cierra gates ni hace commits salvo encargo explícito.
- **Claude — Challenger / Reviewer:** intenta falsificar el resultado, revisa riesgos y entrega objeciones como evidencia para A. No implementa.
- **Owner:** toma decisiones de producto, alcance, publicación, licencias, credenciales y otros cambios materiales.

Las decisiones humanas no se sustituyen por agentes. El trabajo de agentes produce código, documentación y pruebas; la evidencia automatizada prueba condiciones reproducibles, no licencias, respaldo institucional ni utilidad universal.

## Gates y protocolos

Un gate declara una hipótesis principal, como máximo un riesgo crítico, un artefacto ejecutable o consumible y criterios observables. El flujo normal es:

```text
hipótesis → artefacto → prueba → incorporar / corregir / eliminar
```

**FAST** se usa para cambios privados, reversibles y sobre patrones conocidos: A → B → Claude → A. **FULL** se usa para fuentes o contratos centrales, publicación, privacidad, seguridad, permisos, corrupción de datos o decisiones costosas de revertir: A → B → Claude → B → A. Se buscan como máximo dos rondas B ↔ Claude antes de que A resuelva.

## Bitácora, handoff y cierre

`BITACORA.md` es el canal temporal del gate activo. Distingue hechos, inferencias, hipótesis, decisiones, riesgos, pruebas y preguntas abiertas. No es un historial ni una fuente automática de verdad.

Al preparar un handoff, B entrega el artefacto, archivos cambiados, comandos y resultados, riesgos/deuda y un árbol entendible. Claude revisa. A solo cierra cuando comprueba criterios, pruebas, diff, privacidad, documentación y arquitectura; entonces traslada conocimiento útil a código, tests o documentos vivos, limpia la bitácora y hace el commit de cierre.

## Reproducir el método en otro proyecto

1. Definir una decisión de usuario y el límite de evidencia aceptable.
2. Formular un gate pequeño con salida observable y un único riesgo crítico.
3. Mantener raw, normalización y derivados separados; validar contratos en boundaries.
4. Construir el mínimo artefacto para probar la hipótesis y automatizar las invariantes que evitan fallos silenciosos.
5. Registrar en documentación viva la fuente, fecha, observación, inferencia, confianza y reproducción cuando el hallazgo sea material.
6. Someter cambios sensibles a revisión Challenger y dejar decisiones irreversibles para el owner.

El método no garantiza que una fuente sea completa, que una interfaz sea superior ni que una decisión sea correcta fuera de su evidencia. Evita presentar esas inferencias como hechos.
