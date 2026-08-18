# BITÁCORA

> Estado temporal del gate activo. El conocimiento cerrado vive en código, tests, README, `docs/` y evidencia reproducible.

## Estado

**Sin gate activo.**

- Gate 3.1, frescura real y visible, cerrado por Codex A el 18 de agosto de 2026.
- Resultado: la app recalcula la edad desde `reported_at`, conserva ofertas de `0..30 días`, filtra antes del pool y declara de forma visible cuando no quedan precios recientes.
- Verificación: 47/47 tests, Gate 1.1 intacto (24/24 assertions), 714/714 ofertas vigentes al instante fijo del 18/08/2026 y recorrido mobile normal/vencido comprobado.
- Próximo gate tentativo: comprobar si `ETag`/`Last-Modified` permiten detectar cambios sin descargar nuevamente el CSV completo.

Decisión vigente del owner: una ambigüedad de licencia o permiso se registra como área gris y no bloquea el avance. Solo una infracción explícita y material, privacidad, seguridad, corrupción/pérdida de datos o una afirmación dañina justifican detenerse.
