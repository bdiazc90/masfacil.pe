# BITÁCORA

> Estado temporal del gate activo. El conocimiento cerrado vive en código, tests, README, `docs/` y evidencia reproducible.

## Estado

**Gate 4.3 activo: candidato listo para el primer deployment.** Gates 4.1 y 4.2 están cerrados. El gate no se cierra hasta tener URL pública, smoke HTTPS, recorrido online/offline y captura real.

La UI simplificada de `/gasolina/`, `/gasolina/regular/` y `/gasolina/premium/` fue validada por el owner el 21 de agosto de 2026. No se reabre en este gate. Regular y Premium tienen acceso simétrico; cada ruta carga únicamente su producto.

## CODEX A — resolución técnica previa al deploy (21 de agosto de 2026)

**Hipótesis.** Un runner limpio puede aceptar un cambio, promover Regular y Premium como una sola revisión y dejar un bundle desplegable sin exponer el seed privado.

**Riesgo crítico.** Promover el snapshot privado después de validar solo Regular y descubrir después que Premium es inválido.

**Resolución.** La proyección del par se separó de su escritura. Durante `changed`, el staging construye ambos productos, valida contratos, hashes y métricas, compara guardrails por producto y exige avance de `source_max_reported_at`; el pointer privado solo se mueve si el par completo queda `ready`. El manifest público común continúa siendo el último archivo lógico del bundle. `rollback:gate-4.3` reconstruye y valida ambos productos antes de cambiar el pointer y restaura el pointer anterior si la publicación local falla.

**Evidencia.** Proyección real: Regular 714 ofertas/42 distritos/126,598 bytes; Premium 700/42/124,094 bytes. La simulación sin `.local-cache`, `data/` ni `web/data/` produjo `changed → promoted` con ambos productos y bundle verificable; la ejecución siguiente hizo un solo HEAD, descargó 0 bytes y no desplegó. Estado público ausente fue rechazado. El fixture privado contiene 740 Regular y 726 Premium frescas, vive ignorado y no se publica.

**Pendiente externo.** Crear `masfacil-pe` en Cloudflare Pages, hacer el bootstrap inicial de `web/`, verificar `https://masfacil-pe.pages.dev`, configurar secretos/variable de GitHub y ejecutar el workflow. Tras el smoke se agrega URL/captura, se limpia esta bitácora y se realiza el commit de cierre del gate.
