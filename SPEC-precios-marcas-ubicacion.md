# Recuperar precios y mejorar identificación y ubicación

Encargo aprobado por Bruno el 6 de septiembre de 2026 para Claude Code Opus.

## Objetivo y forma de trabajo

Dos entregas pequeñas: primero recuperar la actualización de precios; después incorporar marcas, logos SVG y actualización manual de ubicación.

Trabajar con el flujo ligero de `AGENTS.md`: implementar, comprobar y entregar una prueba breve para Bruno. Este SPEC es el encargo suficiente. Sin SDD, documentos por sesión, suites nuevas, comités de revisión ni refactorizaciones ajenas al cambio. No volver a entrevistar a Bruno sobre decisiones ya resueltas aquí. Resolver decisiones técnicas rutinarias con criterio y consultar solo bloqueos reales.

Leer `AGENTS.md` y `CLAUDE.md`, teniendo presente que algunos apartados históricos quedaron desfasados. Las decisiones de producto de este encargo prevalecen sobre los pendientes antiguos: la UI de precios ya está implementada y la identidad comercial ya está publicada.

Preservar los cambios locales preexistentes en iconos, logo y caché del service worker; no incorporarlos silenciosamente al cambio. Push, deploy y cambios de secretos requieren autorización de Bruno. No añadir D1, backend, framework, seguimiento continuo de ubicación ni aportes de usuarios en estas entregas.

## Entrega 1 — Desbloquear los precios

### Problema y evidencia

La validación exige que todas las identidades catalogadas aparezcan entre las ofertas vigentes. Cuando una estación queda fuera de esas ofertas, bloquea la actualización completa.

Al inspeccionar el 6 de septiembre se encontraron 27 ejecuciones fallidas consecutivas desde el 30 de agosto. La primera falló por 2 IDs fuera de la unión contractual; la más reciente, por 3. Producción conservaba el bundle del 29 de agosto. La ausencia temporal de esos establecimientos fue una hipótesis: todavía no se comprobó la causa individual de exclusión.

Puntos de entrada: `app/commercial-catalog.mjs`, `pipeline/project-gasolina.mjs` y `pipeline/gasolina-products.mjs`. El índice comercial recibe actualmente la unión de IDs de las ofertas ya filtradas, no el universo del Registro.

### Cambio esperado

- Separar el universo del Registro oficial del conjunto de ofertas vigentes. Validar las identidades contra el Registro; proyectarlas únicamente sobre las ofertas que correspondan.
- Usar la misma referencia oficial validada que alimenta la proyección —seed en CI o tablas oficiales locales—, sin inventar un universo a partir del propio catálogo.
- Conservar privadamente las identidades sin oferta vigente. Mantener el rechazo de IDs ajenos al Registro.
- Antes de cerrar el arreglo, identificar por qué quedaron excluidos los IDs del fallo actual. No borrar esas identidades como solución puntual.
- Mantener los controles de frescura, auditoría, publicación conjunta de Regular/Premium, manifest al final y rollback.
- Corregir el manejo de errores de publicación para conservar la causa original y producir un resultado estructurado también cuando el refresco sea rechazado. Evitar que la ausencia de `refresh-result.json` o un error de parseo oculte el rechazo original.
- Verificar una proyección con datos actuales y, tras autorización, publicar y confirmar que producción avanzó. No basta una ejecución verde que reutilice el bundle antiguo.

Éxito: se publica la última fuente oficial disponible. Esto no garantiza precios de menos de 24 horas. No cambiar la cadencia del cron ni silenciar notificaciones como sustituto de reparar el fallo.

Esta entrega sale antes que las marcas si su investigación o auditoría demora.

## Entrega 2 — Marcas, SVG y ubicación

### Identificación comercial

- Objetivo: más del 50 % de estaciones con precio vigente identificadas por marca. Contar establecimientos únicos de la unión de Regular y Premium, incluidos independientes con marca propia. **Publicar el avance acreditado aunque no alcance ese porcentaje.**
- Como referencia, el bundle inspeccionado tenía 719 establecimientos, 548 con nombre y solo 138 con marca. Nombre, marca y logo son métricas distintas; recalcularlas sobre los datos de la entrega.
- Priorizar directorios oficiales actuales de Primax, Repsol, AVA y Petroperú. Usar Maps como descubrimiento autorizado, conservando las condiciones de corroboración de `AGENTS.md`.
- Para acreditar una marca nueva o incorporarle logo, exigir directorio oficial actual o evidencia visual del letrero de hasta 12 meses, vinculada inequívocamente al establecimiento. Separar fecha de consulta de fecha de imagen o vigencia: abrir hoy una fuente histórica no la convierte en evidencia actual.
- No deducir bandera por proximidad, proveedor de combustible, compra empresarial o razón social por sí sola. Conservar unicidad del match, resolución de conflictos y anclaje al Registro.
- Mostrar SVG junto al nombre de sede y conservar la dirección. Obtener activos oficiales o vectorizar fielmente una referencia oficial. No inventar ni reinterpretar logos ni presentar un bitmap incrustado como vectorización.
- Servir archivos SVG locales, sanitizados y sin scripts ni recursos externos; resolverlos mediante una lista controlada de marcas. El contrato público ya contiene `commercial_identity.brand`: no introducir URLs arbitrarias de logos en los datos.
- Sin marca acreditada, usar presentación neutral. Una identidad de nombre «por confirmar» no acredita por sí sola el logo de una cadena. Mantener separados los conteos de marca identificada y logo disponible.
- Preparar una muestra aleatoria para Bruno, separada por método de acreditación —directorio o letrero—, con cota inferior de Wilson al 95 % de confianza ≥90 %. Con cero errores hacen falta al menos 35 revisiones por grupo; grupos menores se revisan completos.
- Corregir casos erróneos sin bloquear automáticamente todo su grupo, siempre que la auditoría siga cumpliendo. Conservar los resultados observados: corregir un caso no permite borrar el error de la muestra ni reutilizar aprobaciones antiguas para marcas nuevas. Si no alcanza el umbral, obtener una nueva evaluación suficiente antes de publicar ese grupo.
- La auditoría anterior de nombres no demuestra la precisión de las banderas nuevas. El constructor actual recalcula hashes usando veredictos antiguos: impedir que esto presente una afirmación nueva como ya revisada. La marca publicada con logo debe estar cubierta por la nueva comprobación de evidencia y auditoría.
- La evidencia que supere 12 meses después de incorporada pasa a una cola privada de revisión; la marca permanece visible, según decisión explícita de Bruno. Los 12 meses son requisito de incorporación, no retirada automática. Esa cola debe poder obtenerse al operar el catálogo, sin requerir backend.
- Mantener expedientes fuera de Git. Medir el paquete privado antes de publicarlo: el paquete observado ocupaba 44.700 bytes base64 y se aproxima al límite del secret. Si excede el límite, dividir su transporte en partes verificables y reconstruirlo antes de validar, sin introducir D1. La carga de secretos requiere autorización; conservar el formato existente si sigue siendo suficiente.

### Fuentes iniciales y límites de factibilidad

Estas rutas oficiales se localizaron durante la preparación; todavía no se ha comprobado su extracción completa ni su cobertura. No prometer el 50 % antes de vincular y auditar establecimientos.

- Primax: <https://creaturuta.primax.com.pe/estaciones-de-servicio>
- Repsol: <https://www.repsol.pe/es/es/productos-servicios/estaciones-servicio/localizador-de-estaciones/index.cshtml>
- AVA: <https://ava.pe/estaciones>
- Petroperú: <https://comercial.petroperu.com.pe/?contenido=nuestra-red-de-estaciones>

Los localizadores son dinámicos; una extracción textual sin filas no demuestra que estén vacíos. No se confirmó todavía la disponibilidad de SVG oficiales. Pecsa, Terpel e independientes requieren investigación específica cuando no exista directorio actual; no convertir adquisiciones empresariales en reasignaciones automáticas de marca.

### Actualizar ubicación

La app usa una sola llamada a `getCurrentPosition` y conserva esa coordenada. Al desplazarse el usuario, las distancias no cambian hasta obtener otra posición.

- Añadir «Actualizar ubicación» junto a «Mi ubicación» y acceso mediante icono etiquetado en la barra compacta fija. Visible en resultados basados en GPS; mantener «Cambiar» para elegir otro origen.
- Solicitar una posición nueva al tocarlo, sin aceptar una posición cacheada. Conservar radio, producto y criterio de orden; recalcular distancias y resultados, reiniciar paginación y volver al inicio de la lista cuando tenga éxito.
- No reutilizar sin ajustes el flujo inicial: hoy reinicia radio y orden y, ante un fallo, borra el origen y envía a elegir distrito.
- Mostrar «Actualizando…» y evitar solicitudes duplicadas. Conservar resultados mientras busca, con el progreso claramente indicado.
- Si falla, conservar la posición anterior y avisar: «No pudimos actualizar. Las distancias usan tu ubicación anterior». Permitir reintentar.
- Ignorar respuestas tardías si el usuario cambió a distrito u otro intento. Mantener un tiempo de espera acotado; puede reutilizarse el actual de 12 segundos.
- Si no hay estaciones en el radio conservado, mostrar el estado vacío y permitir ampliarlo; no cambiar el radio silenciosamente.
- Actualizar ubicación no descarga precios ni activa seguimiento continuo. Mantener el procesamiento local y la política existente sobre ubicación.
- Asegurar foco, etiqueta accesible y anuncio del resultado; el control compacto debe ser un botón independiente, no un botón anidado dentro de «Ajustar».

## Comprobación y cierre

Sin crear tests automatizados: usar validaciones existentes, `npm run audit`, verificación del bundle y comprobaciones manuales acotadas. Para UI, comprobar móvil de 360 px, temas claro/oscuro, barra compacta y actualización del shell mediante service worker.

Cinco casos de mayor daño:

1. Identidad registrada sin precio vigente: no bloquea; ID realmente desconocido: sí bloquea.
2. Refresco rechazado: conserva producción y comunica la causa correcta.
3. Marca sin evidencia suficiente o auditoría obsoleta: no obtiene logo.
4. Nueva ubicación: distancias y lista cambian conservando preferencias, incluido el caso de radio vacío.
5. GPS fallido, doble toque o cambio a distrito durante la solicitud: no sobrescribe el estado correcto.

Cada entrega termina con un diff enfocado, resultado de comprobaciones y máximo cinco pasos para Bruno. Actualizar únicamente documentación operativa afectada. No rehacer toda la documentación ni ampliar el alcance para «dejarlo perfecto».

Dejar la implementación comprobada y lista para aprobación de publicación. No confundir estar preparado para desplegar con haber desplegado; informar claramente qué pasos externos siguen pendientes de autorización.
