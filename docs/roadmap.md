# Roadmap

Última revisión: 22 de agosto de 2026.

## Ahora

La PWA de Gasohol Regular y Premium ya está desplegada. El siguiente objetivo es publicar Identidad Comercial de forma progresiva, empezando por una sola estación verificada por el owner.

La búsqueda web secundaria terminó sin puentes válidos. No se reabre salvo una pista concreta. La vía actual es `owner_verified`: marca visible y Registro oficial observados en el mismo establecimiento.

## Capa 5 — identidad y datos vivos

Objetivo: releases públicos frecuentes que aumenten utilidad sin esperar cobertura completa.

Orden previsto:

1. Publicar la primera identidad comercial verificada.
2. Añadir nuevas identidades en lotes pequeños, conservando fallback neutral.
3. Elegir con el owner una frecuencia de actualización de datos varias veces al día.
4. Automatizar refresh, promoción conjunta de Regular/Premium y deploy.
5. Observar uso real, errores y comprensión de frescura.

No se construyen reportes comunitarios, cuentas o backoffice hasta que el mantenimiento manual sea un problema real.

## Capa 6 — producto y plataforma

Objetivo: convertir el MVP validado en una app reconocible e instalable.

- Adoptar un framework solo si reduce complejidad real del producto ya usado.
- Definir nombre, sistema visual y marca pública.
- Optimizar instalación PWA, onboarding, actualizaciones y recuperación offline.
- Preparar componentes y datos para nuevas rutas sin crear una plataforma abstracta antes de tiempo.

## Más adelante

Posibles rutas: GLP envasado, playas y piscinas. Ninguna entra a implementación hasta que Capa 5 produzca uso real y exista una fuente autorizada que permita responder una decisión concreta.

## Regla de avance

Cada release sigue un loop: hipótesis única → implementación → prueba del owner → máximo cinco casos borde → una calibración → `GO`, `FIX` o `KILL`.
