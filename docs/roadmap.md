# Roadmap

Última revisión: 25 de agosto de 2026.

## Ahora

En producción: home directo en `/`, una tarjeta por grifo con Regular y
Premium, radio adaptativo, paginación que duplica y **548 identidades**
publicadas (377 confirmadas, 171 «por confirmar»), con la precisión medida
declarada en la app: 54 revisiones del owner sin un solo error, cota 89 % y 86 %.

## Roadmap corto — decidido por Bruno el 25/08/2026

1. **UI de precios.** Chips `[REG]` verde y `[PRE]` azul en vez de etiquetas de
   texto; los tres valores de la primera línea con `justify-between`; precios
   con estética de display de surtidor **sin perder legibilidad** a 360 px.
   Solo `web/offer-card.js` y `web/styles.css`; no toca datos ni contratos.
2. **Separar «datos» de «código» en el deploy.** Hoy un cambio de UI o de
   catálogo obliga a bajar el giga de Osinergmin aunque los precios no hayan
   cambiado, porque `force_project` mezcla ambos. Un cambio de `web/` debe
   reusar el bundle ya publicado y solo re-subir el shell; el giga solo se paga
   cuando hay precios nuevos. El cache entre corridas (`actions/cache`) es el
   paliativo mientras tanto.

## Capa 5 — identidad y datos vivos

1. ~~Publicar la primera identidad comercial verificada.~~ Hecho.
2. ~~Publicar el lote con la precisión medida declarada en la app.~~ Hecho: 548.
3. ~~Elegir frecuencia de actualización.~~ Hecho: cron 4 veces al día.
4. ~~Automatizar refresh, promoción conjunta y deploy.~~ Hecho.
5. Observar uso real, errores y comprensión de frescura.
6. Los 169 sin nombre: 66 quedaron en genérico, 42 sin ficha, 33 candidatos
   lejanos, 28 en conflicto. Necesitan Street View o presencia, no más barrido.
7. Marca desde directorios first-party (Primax, Repsol, Pecsa, AVA): hoy solo
   137 de 548 llevan marca, siempre respaldada por la razón social o el owner.

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
