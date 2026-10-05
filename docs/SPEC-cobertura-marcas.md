# Más marcas en las tarjetas con precios

**Estado:** cerrado. Implementado en `b792d24` (17/09/2026) y ampliado en
`d8f11c4` (20/09/2026).

Encargo de Bruno, septiembre de 2026. Base inspeccionada: `7953851`. Este documento es el único encargo de este
cambio; leer también las reglas comunes de `AGENTS.md` y el contrato del Builder
en `CLAUDE.md`.

## Resultado buscado y decisiones cerradas

Un grifo que opera bajo una marca debe mostrar esa marca y su logo cuando haya
evidencia suficiente. El resultado se mide en **establecimientos con precio que
ganan marca**, incluyendo marcas adicionales, no en logos descargados ni en
candidatos cosechados.

Bruno confirmó:

- Cubrir Lima provincia, empezando por asociaciones faltantes de Primax y las
  demás marcas existentes; incorporar también marcas adicionales respaldadas
  por los datos y fuentes disponibles.
- Los **logos nuevos de este encargo serán siempre recreaciones fieles en SVG**.
  Registrar `faithful_recreation` y su referencia real. Esto no obliga a rehacer
  los logos existentes ni permite inventar el diseño de una marca.

No rediseñar las tarjetas. Sin referencia visual suficiente, conservar la marca
confirmada en texto y declarar el activo pendiente; ese caso no frena los demás.
El permiso permanente de descubrimiento en Google Maps ya consta en `AGENTS.md`.
No repetir el grilling ni volver a pedir esas decisiones.

## Lo que ya existe

El bundle **local del 9 de septiembre de 2026**, que no acredita el estado actual
de producción, contiene 728 establecimientos únicos: 277 con marca y 451 sin
marca. Las marcas son Primax (80), Repsol (115), Petroperú (64) y AVA (18). Las
cuatro tienen SVG. El catálogo privado tiene 596 entradas, 319 solo con nombre.
Actualizar la base de comparación al ejecutar; estos conteos no son metas.

La causa concreta encontrada para el directorio Primax está en
`scripts/brand-directory.mjs`: la fuente no declara distrito, el normalizador
lo deja vacío y el matcher exige distrito idéntico. Esa ruta acredita cero
fichas Primax. Además, 448 de las 720 coordenadas del padrón inspeccionado tienen
dos decimales o menos: ampliar el radio y aceptar el más cercano sería incorrecto.

Hay trabajo privado aprovechable en
`.local-cache/identity/primax-candidatos.json` y `primax-revisar.json`. Una propuesta
previa separó 65 casos de menor riesgo, 20 de ellos sin bandera actual. Son
**candidatos pendientes de validación**, no veinte incorporaciones garantizadas.
Pecsa, Terpel y Gazel aparecen en la cosecha; su presencia tampoco acredita una
bandera. No convertir automáticamente una razón social como Coesti en marca.

Puntos de trabajo existentes:

| Pieza | Uso en este cambio |
| --- | --- |
| `scripts/brand-directory.mjs` | Adquirir y emparejar directorios; corregir la limitación de fuentes sin distrito. |
| `scripts/match-identities.mjs` | Reutilizar candidatos y reglas de corroboración ya disponibles. |
| `scripts/build-catalog.mjs` | Incorporar bandera preservando nombre respaldado; registrar conflictos. |
| `scripts/brand-sample.mjs`, `app/commercial-audit.mjs` | Muestrear y registrar precisión real de las afirmaciones nuevas. |
| `app/commercial-catalog.mjs`, `app/commercial-resolution.mjs` | Validar el catálogo y aislar afirmaciones defectuosas. |
| `pipeline/project-gasolina.mjs` | Validar anclas contra Registro y unir identidad a ofertas por `establishment_id`. |
| `web/brand-logos.js`, `scripts/install-brand-logo.mjs` | Registrar, sanear y mostrar las recreaciones SVG. |
| `scripts/identity-pack.mjs`, `scripts/identity-install.mjs` | Preparar el paquete privado consumible por el flujo existente. |

## Alcance de implementación

1. **Fijar una base comparable.** Usar el snapshot autorizado disponible y una
   copia de trabajo del catálogo mediante `IDENTITY_ROOT`. Identificar qué se
   pierde por falta de evidencia, conflicto, ancla desconocida, falta de oferta
   o asset ausente. Medir por establecimiento único y por producto; no contar
   Regular y Premium como dos grifos. Distinguir ofertas vigentes de vencidas.
2. **Resolver pendientes conocidos.** Aprovechar primero los directorios y
   candidatos privados ya disponibles. Revalidar evidencia envejecida con los
   mecanismos existentes. Completar Primax y luego pendientes de Repsol,
   Petroperú y AVA. No iniciar un nuevo barrido general de Lima si los pendientes
   identificados pueden resolverse con consultas dirigidas.
3. **Añadir marcas adicionales.** Revisar las candidatas ya cosechadas y sus
   fuentes verificables. Incorporar las que superen los mismos requisitos de
   identidad; una palabra en el nombre o la razón social no basta. Reutilizar el
   catálogo y los importadores, extendiéndolos solo donde exista una fuente
   concreta que lo justifique.
4. **Terminar la entrega de datos y activos.** Reconstruir catálogo y auditoría,
   proyectar ambos productos, preparar el paquete privado e incorporar los SVG
   de las marcas nuevas con referencia visual suficiente. Dejar el resultado
   listo para auditar y publicar, no solo un matcher que podría producirlo.

## Reglas del cruce y de la evidencia

- `establishment_id` sigue derivando exclusivamente del Registro. Validar
  identidad contra ese universo y medir su efecto sobre ofertas actuales.
- Un distrito ausente es un dato desconocido; no inventarlo desde una coordenada
  redondeada. Un distrito explícito contradictorio sí descarta el vínculo.
- Para directorios sin distrito, permitir una selección de candidatos acorde
  con la precisión real de la fuente. Confirmar con evidencia textual o visual
  discriminante: vía y puerta, dirección suficientemente específica, vínculo
  inequívoco con el operador o revisión visual. No aceptar solo distancia, una
  vía genérica, el nombre de la marca o un número común aislado.
- Conservar unicidad por margen y asignación uno a uno. Antes de elegir, comparar
  también propuestas de distintos directorios para un mismo establecimiento.
  El orden de archivos, el primer candidato o el desempate por distancia no
  resuelven una contradicción de bandera. Registrar `conflict` y conservar la
  marca previa respaldada hasta resolverla.
- Una evidencia de nombre no acredita automáticamente la bandera. Auditar una
  muestra trazable de cada método/tier nuevo o modificado, incluyendo casos de
  distrito ausente, coordenada imprecisa y choques entre marcas. Aplicar las
  reglas existentes de muestreo y declarar población, muestra, aciertos y
  limitaciones; no fabricar revisiones ni rebajar umbrales para subir cobertura.
- Revisar `marcaSoportada` y la elección `operador ?? delDirectorio` en
  `build-catalog.mjs`: la marca emitida debe ser exactamente la que respalda la
  evidencia. La razón social sirve para buscar/corroborar identidad, no para
  sustituir la bandera confirmada por un directorio o un letrero. Cubrir también
  el caso en que operador y directorio sugieren marcas diferentes.
- Si crece la población de nombres, actualizar la auditoría que la describe.
  Añadir una bandera no debe invalidar por accidente nombres ya respaldados.
- Conservar procedencia real en `source.kind` y en `brand_evidence`. Google queda
  en caché privada; preferir la corroboración redistribuible o del owner prevista
  por `AGENTS.md`, sin etiquetar una fuente como otra.
- Una identidad defectuosa se aísla sin bloquear precios válidos. Un candidato
  sin confirmar permanece pendiente, aunque eso limite la ganancia de cobertura.

## SVG y tarjeta

Crear recreaciones fieles, locales y saneadas. Registrar cada variante `mark`
en `web/brand-logos.js`, con archivo, dimensiones, `source_kind`, referencia y
fecha. No llamar oficial a una recreación ni inventar una URL de origen.

Usar el recorrido único de activos existente para tarjeta, verificador y
precache. **Marca publicada más SVG registrado implica logo visible**, sin una
segunda acreditación del logo. Preservar nombre de sede, accesibilidad y estilo
actual. No introducir descargas externas desde el navegador.

## Comprobación y aceptación

- Mostrar un antes/después sobre el mismo conjunto de ofertas y el mismo reloj:
  establecimientos con marca por bandera, ganancia neta, marcas nuevas,
  pendientes/conflictos y marcas publicadas con/sin SVG. Usar el reporte privado
  de cobertura existente; en chat solo conteos y motivos.
- Verificar casos concretos de Primax antes sin bandera, una marca adicional
  cuando exista evidencia y una contradicción que siga aislada. La mejora debe
  llegar al bundle y a la tarjeta. Si no se logra acreditar alguna marca nueva,
  declararlo como alcance no alcanzado, sin inventar identidades para cerrarlo.
- Comprobar que, con los mismos inputs de precios, no cambian importes,
  productos, fechas, IDs oficiales ni coordenadas por este trabajo de marcas.
- Añadir únicamente pruebas puntuales del matcher que eviten atribuciones
  erróneas: distrito ausente, coordenada imprecisa, margen insuficiente,
  duplicidad y conflicto entre directorios. No crear una suite de infraestructura.
- Ejecutar `npm run project`, `npm run audit` y `npm run verify:web` con los
  inputs autorizados. Revisar visualmente tarjetas con las nuevas recreaciones
  en pantalla estrecha y ancha. Comprobar instalación del paquete privado en un
  directorio temporal para no entregar un catálogo que CI no pueda consumir.

No fijar un porcentaje ficticio de cobertura: la referencia es el incremento
real respaldado y la explicación reproducible de lo que quedó fuera.

## Límites y entrega

Sin framework, base de datos, canal de reportes de usuarios, rediseño ni cambios
de precio. Este SPEC puede implementarse antes o después de
`docs/SPEC-precios-facilito.md`; ambos conservan el mismo `establishment_id` y no deben
crear dos catálogos comerciales.

Conservar raws, catálogo, auditoría, paquetes y datos generados fuera de Git.
Preservar los archivos ajenos ya presentes, incluidos los SPEC y scripts del
piloto sin tracking. La carga del paquete privado al secreto configurado forma
parte del release posterior autorizado; no basta subir código para ampliar las
marcas de producción.

El Builder planifica brevemente por chat, implementa y entrega archivos,
comprobaciones, conteos y límites. Actualiza documentación viva solo si cambia
la operación. No crea documentos adicionales de planificación o handoff.
Este encargo no autoriza commit, push, actualización de secretos ni deploy.
