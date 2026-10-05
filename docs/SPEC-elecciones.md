**Estado:** deprecado el 05/10/2026 por decisión de Bruno; no se implementa ningún corte. La sonda del §2 confirmó que la API de resultados de ONPE (`/presentacion-backend/`) responde 403 fuera del navegador. Se conserva como antecedente.

# /elecciones — Resultados electorales

Sustituye `docs/SPEC-elecciones-dni.md`, conservado como obsoleto. Fuente única:
ONPE. Sin DNI, consultas personales ni promesa de resultados a las 18:00.

## 1. Corte 1: publicable sin datos electorales propios

En `/elecciones`, mostrar **Resultados electorales 2026**, identificar las
elecciones regionales y municipales del **4 de octubre de 2026** y ofrecer
**Ver resultados oficiales en ONPE**, hacia
[el portal oficial](https://resultadoelectoral.onpe.gob.pe/main/resumen).
Texto breve: «Consulta el avance publicado por ONPE para tu región, provincia
o distrito». Indicar que masfacil.pe es independiente de ONPE.

Este corte abre el servicio oficial. No mostrar cifras de ejemplo, porcentajes
en cero, una hora de apertura supuesta ni un estado «Próximamente» permanente.
La portada general y el comportamiento de Combustibles quedan fuera del cambio.

## 2. Comprobar la fuente para habilitar el corte 2

Sondas del 04/10: el navegador mostró **ONPE | Próximamente** para estas ERM;
no se acreditaron API, descarga de resultados ni horario de publicación. El
[portal ERM](https://erm2026.onpe.gob.pe/) confirma votación de 7:00 a 17:00,
lo que no fija la hora de resultados.

Cuando la fuente esté disponible, identificar un recurso público real y obtener
una captura de resultados agregados con proceso, territorio, cargo, opciones,
votos, avance de actas, denominadores y fechas que ONPE efectivamente publique.
Compararla con el portal y acreditar su lectura desde el entorno que actualizará
la web. No asumir que acceso desde el Mac implica acceso desde Actions, ni usar
endpoints de otra elección como evidencia de esta. Ante WAF/CAPTCHA o acceso
no reproducible, conservar el corte 1 y comunicar el bloqueo concreto.

## 3. Corte 2: resultados propios actualizados

Elegir territorio y cargo entre los disponibles en la captura validada. Mostrar
opciones electorales con nombre, organización, votos y porcentajes cuando su
base esté documentada. Orden por votos; empates sin destacar una opción.
Identificar siempre la circunscripción, el cargo, la cobertura disponible y
la fuente. No anunciar ganadores por un avance parcial.

Separar **actas procesadas** de **contabilizadas** y conservar el denominador
de cada porcentaje publicado. Mostrar fecha de consulta y, si existe, fecha de
actualización de ONPE, en `America/Lima`. Ausencia de información no equivale
a cero. Conservar el acceso a ONPE en todos los estados.

## 4. Datos y publicación

Un proceso privado adquiere y valida datos públicos, genera JSON bajo
`web/data/elecciones/` y publica archivos estáticos. La UI consulta esos JSON.
Capturas originales en `.local-cache/`; salidas generadas fuera de Git.

- Contrato mínimo: elección, territorio/identificador oficial, cargo, cobertura,
  opciones/votos, métricas de actas con sus bases, URL de origen, fecha de
  consulta y fecha de fuente si existe. Validar al generar y al leer.
- Publicar revisión inmutable y manifest al final. Un fallo o captura incompleta
  conserva el último válido sin rejuvenecer sus fechas. El cliente lo presenta
  como última información disponible, también sin conexión; no como dato vivo.
- Programar capturas solo al acreditar adquisición repetible desde el runner.
  Fijar frecuencia según cadencia y límites observados de ONPE; mostrar la
  antigüedad real. Solo desplegar cuando corresponda una revisión nueva.
- **Todo deploy debe conservar ambos productos.** Rehidratar el último bundle
  electoral antes de publicar interfaz o combustibles; una actualización
  electoral también conserva precios y shell vigentes. Usar la serialización
  existente y revalidar antes de subir para no borrar ni retroceder datos.
- La caída de ONPE conserva lo publicado y permite refrescar combustibles. Si
  no puede reconstruirse una entrega que preserve datos existentes, detener
  ese deploy y conservar producción. No publicar un árbol incompleto.

Riesgo comprobado: `refresh-pages.yml` despliega todo `web/`, pero
`scripts/fetch-live-bundle.mjs` solo recupera combustibles. El corte 2 exige
extender esa conservación y su preflight; no basta con añadir un cron electoral.

## 5. Integración y comprobación

Preparar en un worktree aislado; integrar sobre G4 terminado, preservando sus
cambios. Fuentes propias en `ui/elecciones/`, React/Vite y estilos de G4.
Resolver la categoría antes de la preferencia de combustible; no montar su
buscador ni pedir sus bundles al abrir Elecciones. Sin dependencias nuevas.

Ampliar de forma explícita rutas, build, prerenderizado, verificador y precache
para entregar contenido electoral propio. `/elecciones/` redirige a la canónica;
subrutas inexistentes devuelven 404. Los JSON electorales se actualizan aparte
del shell; el worker no debe inmovilizarlos en la precache. Revisar y registrar
el alcance afectado en el mapa de arquitectura.

Prueba manual de hasta diez minutos: abrir enlace directo en móvil, comprobar
destino ONPE, barra final y 404, y volver a Combustibles. Para el corte 2, cotejar
una captura con ONPE, cambiar territorio/cargo, verificar fechas y porcentajes,
simular fuente caída y modo sin red; comprobar que deploys intercalados conservan
los datos de ambos productos. Conservar build, audit y verify:web, con pruebas
puntuales de rutas, contrato y conservación de datos.

Entregar evidencia y limitaciones por chat. El Líder audita cada corte y emite
GO/FIX/KILL; commit, push y deploy necesitan autorización explícita de Bruno.
