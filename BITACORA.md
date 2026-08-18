# BITÁCORA

> Estado temporal del gate activo. El conocimiento cerrado vive en código, tests, README, `docs/` y evidencia reproducible.

## Estado

**Sin gate activo.**

- Gate 3.2, detección barata de cambios, cerrado por Codex A el 18 de agosto de 2026.
- Resultado: una petición `HEAD` detectó un snapshot nuevo mediante ETag y Last-Modified, con 0 bytes de cuerpo consumidos y sin descargar ni promover el CSV.
- Contrato: `unchanged`, `changed` o `unverifiable`; la ambigüedad nunca degrada a “sin cambios”. El fallback `GET Range` cancela el cuerpo al recibir headers y no se ejecuta ante errores HTTP definitivos.
- Verificación: 54/54 tests. El probe real cambió ETag `...,234 → ...,238` y Last-Modified del 14 al 18 de agosto.
- Próximo gate tentativo: Gate 3.3, descarga en staging, validación completa y promoción atómica conservando el último snapshot bueno.

Decisión vigente del owner: una ambigüedad de licencia o permiso se registra como área gris y no bloquea el avance. Solo una infracción explícita y material, privacidad, seguridad, corrupción/pérdida de datos o una afirmación dañina justifican detenerse.
