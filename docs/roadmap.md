# Roadmap

Última revisión: 24 de agosto de 2026.

## Ahora

La PWA de Gasohol Regular y Premium está desplegada, con refresco y deploy
automáticos funcionando. La primera identidad comercial —Primax Granada— llegó a
producción por el camino completo: catálogo, auditoría, gate de publicación,
proyección y despliegue.

El barrido de Google Maps autorizado por Bruno cosechó 1,560 fichas sobre 229
centros y emparejó **396 de los 717** establecimientos con evidencia suficiente.
Auditoría del owner: **40 de 40 correctos, cero errores**; cota inferior de
Wilson al 95 % sobre la muestra aleatoria de 25: **86.7 %**.

Siguiente: publicar esos 396 declarando la precisión medida, en vez de esperar a
una muestra que certifique 99 %.

## Capa 5 — identidad y datos vivos

Objetivo: releases públicos frecuentes que aumenten utilidad sin esperar
cobertura completa.

1. ~~Publicar la primera identidad comercial verificada.~~ Hecho.
2. Publicar el lote de 396 con la precisión medida declarada en la app.
3. ~~Elegir frecuencia de actualización.~~ Hecho: cron 4 veces al día.
4. ~~Automatizar refresh, promoción conjunta y deploy.~~ Hecho.
5. Observar uso real, errores y comprensión de frescura.

### Verificación por quien usa la app — decidido el 24/08/2026

Bruno definió la vía para cerrar el ciclo de confianza: **la gente que usa la app
confirma o corrige con un clic** lo que el algoritmo propuso —marca, existencia,
frescura del precio— y esas señales se acumulan en un almacén simple.

Por qué importa: la auditoría del owner no escala más allá de unas decenas de
casos, y publicar con una cota del 87 % solo es honesto si existe un camino para
que el error aflore. Quien está parado frente al grifo tiene mejor evidencia que
cualquier heurística, y la aporta en un segundo.

Lo que habilita, en orden de valor:

- corregir un nombre equivocado sin esperar al siguiente barrido semestral;
- detectar cierres y cambios de marca, que hoy no tienen ninguna señal propia;
- ascender a `known_contributor` las entradas que hoy quedan en `candidate`;
- medir precisión de forma continua en vez de por muestreo puntual.

Restricción que no se relaja: un reporte es **evidencia, no verdad**. Alimenta el
mismo catálogo y la misma auditoría; no publica por su cuenta. Un solo clic anónimo
no basta para cambiar una identidad publicada.

Esta es la primera necesidad real de base de datos del proyecto: hasta hoy todo
se resolvió con archivos estáticos y eso fue correcto. Se introduce cuando se
implemente este paso, no antes.

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
