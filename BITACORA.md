# BITÁCORA

> Estado temporal del gate activo. El conocimiento cerrado vive en código, tests, README, `docs/` y evidencia reproducible.

## Estado

**Sin gate activo. Gate 4.1 cerrado por Codex A el 19 de agosto de 2026.**

- PWA static-first en `web/`: shell cache-first y bundle manifest+snapshot network-first con fallback offline validado.
- Proyección pública `1.0.0`: 714 ofertas, 42 distritos y 127,293 bytes; allowlist exacta, SHA-256 y manifest promovido al final. Los generados permanecen fuera de Git.
- El primer uso online controla el service worker antes de descargar datos; una recarga offline inmediata conserva el último bundle válido. Cold-offline falla de forma honesta.
- Challenger FULL: dos bloqueantes detectados y corregidos — primera carga sin caché de datos y preview legado con módulos 404. Segunda revisión aceptada sin bloqueantes.
- Cierre: 75/75 tests, proyección y verificación reales correctas, preview legado restaurado y `git diff --check` limpio.
- Próximo gate: 4.2, orden, licencias, atribución, método multiagente, evidencia explicada y poda previa a publicación.

Decisión vigente del owner: las coordenadas GIS y la distancia derivada están aprobadas para publicación downstream con procedencia y atribución a Osinergmin; no son un riesgo abierto. Razón social, dirección e identidad comercial conservan sus políticas separadas.
