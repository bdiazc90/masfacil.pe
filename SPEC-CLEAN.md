# SPEC-CLEAN — menos instrucciones contradictorias, entregas pequeñas

Encargo aprobado por Bruno tras cinco preguntas de grilling. Este documento es
el encargo temporal para Claude Code, no un nuevo manual permanente.

## Resultado buscado

Lanzar mejoras con el modelo Líder/Builder que Bruno eligió, sin repetir
decisiones, producir documentos por sesión ni depender de datos nuevos para
publicar una corrección visual. Una identidad comercial defectuosa tampoco debe
congelar precios que sí son válidos.

En ultra sencillo: **menos papeles que se contradicen; un problema de nombres no
detiene los precios; un problema de precios no detiene un botón. Bruno conserva
la decisión de publicar cambios de código.**

## 1. Alcance y autorización de este encargo

- Builder: plan breve por chat, implementar este SPEC, comprobar lo cambiado y
  entregar un resumen corto para la auditoría del Líder. No crear otro SPEC,
  documento de planificación, handoff ni bitácora de esta ejecución.
- La aprobación del SPEC autoriza implementación local, incluida la poda
  documental descrita aquí. **No autoriza commit, push, deploy ni actualización
  de secretos.** Eso se solicita después del veredicto del Líder.
- El árbol es compartido. Inspeccionar su estado antes de trabajar, preservar
  cambios ajenos y no usar staging global ni comandos destructivos de limpieza.
- `web/icons/brands/petroperu.svg` fue repuesto por Bruno y estaba sin seguimiento
  al iniciar este encargo. **No borrarlo, sobrescribirlo, registrarlo, incorporarlo
  al commit ni hacerlo visible como parte de esta limpieza.** No es un archivo
  sobrante. Su integración será otro cambio aprobado.
- No ampliar cobertura de marcas, resolver candidatos Primax, cambiar reglas de
  atribución, rediseñar la UI, migrar de framework, añadir backend/base de datos,
  modificar la frecuencia del cron ni reemplazar el transporte de secretos.

## 2. Hechos encontrados que hay que resolver

Referencias observadas al redactar; verificar el estado actual antes de editar.

| Problema | Evidencia local | Cambio requerido |
| --- | --- | --- |
| Roles, calibraciones y pruebas del owner como pasos universales | `AGENTS.md`, `CLAUDE.md` | Sustituir por el flujo aprobado de la sección 3. |
| Estado obsoleto e instrucciones incompatibles | README/CLAUDE dicen 0/717; HANDOFF y SPEC antiguo conservan la puerta estadística de logos | Retirar estado volátil y encargos superados del árbol activo. |
| Se promete publicar interfaz sin refrescar, pero siempre se refresca | `scripts/publish.mjs` ejecuta `refresh.mjs` antes de decidir; `app/publication-policy.mjs` bloquea ante rechazo | Crear una ruta de interfaz realmente independiente. |
| Un cambio pequeño necesita seed y expediente privado | `.github/workflows/refresh-pages.yml` instala ambos antes de decidir la ruta | Pedirlos solo donde sean necesarios. |
| Cambios de varios commits o mixtos pueden quedar sin publicar | El workflow compara `HEAD^..HEAD` y considera todo `scripts/` como posible proyección | Resolver el rango completo y la ruta adecuada, sin falsos éxitos. |
| Una auditoría de nombres bloquea el bundle entero | `assertCommercialPublicationReady` al comienzo de `buildGasolinaProjectionCandidate`; instalación/carga estrictas anteriores | Aislar fallos comerciales sin desactivar validaciones. |
| Se vuelve a exigir SVG exclusivamente oficial desde comentarios | `web/brand-logos.js`, `scripts/install-brand-logo.mjs`, comentarios de catálogo | Alinear comentarios con la decisión vigente; comprobar el archivo, no inventar procedencia. |
| Se repiten comprobaciones y se serializa demasiado | Dos llamadas de auditoría con historial; concurrencia global de PR/push/cron | Evitar trabajo repetido conservando cobertura y protección de publicación. |

## 3. Contrato operativo aprobado

**Flujo:** Bruno pide → Líder aclara y especifica → Builder planifica e implementa
→ Builder resume → Líder audita → veredicto → Bruno autoriza → ejecución acotada
de commit/push/deploy → comprobación de producción.

### Líder: ChatGPT, instrucciones en `AGENTS.md`

- Usa grilling solo para decisiones realmente pendientes: **máximo cinco
  preguntas por cambio, no una cuota de cinco**. Busca los hechos por su cuenta;
  no pide a Bruno información que pueda inspeccionar. No reabre permisos o
  decisiones ya confirmadas. Si faltase una decisión indispensable al alcanzar
  el límite, delimita lo pendiente; no inventa autorización.
- Crea un SPEC técnico proporcional al cambio y explica el resultado a Bruno en
  lenguaje ultra sencillo. El SPEC es el único artefacto de encargo; no se
  encadenan documentos de discovery, diseño, planning, aceptación y handoff.
- Audita la implementación con subagentes económicos y sondas acotadas: cada
  uno recibe una pregunta verificable sobre el diff y su riesgo. Sin cuotas de
  revisores, auditorías exhaustivas por defecto ni duplicación de exploraciones.
- Usa el modelo económico disponible adecuado a la sonda, sin fijar nombres o
  precios de modelos en el repo. Escala análisis solo si la evidencia lo exige.
- Emite `GO`, `FIX` o `KILL`, explicando en sencillo los problemas reales, cuándo
  ocurrirían y la corrección concreta. Distingue bloqueos de mejoras opcionales.
- Con `FIX`, devuelve correcciones al Builder y reaudita lo afectado; no abre
  obligatoriamente otra hipótesis, SPEC, calibración o ciclo completo.
- Con `GO`, pregunta una vez si Bruno autoriza commit, push y deploy del alcance
  auditado. No confunde conformidad con un plan con permiso para publicar.

### Builder: Claude Code, instrucciones en `CLAUDE.md`

- Lee el SPEC activo y las reglas comunes; planifica brevemente por chat y
  construye. No repite el grilling ni solicita decisiones ya resueltas.
- Elige comprobaciones proporcionales al riesgo. Se elimina la prohibición
  absoluta de tests automatizados: se permiten pruebas puntuales si evitan una
  regresión o ahorran trabajo. No hay suite, cobertura, cantidad de casos ni
  prueba del owner obligatorias para todas las entregas.
- Entrega por chat: qué cambió, qué comprobó y el resultado, qué no pudo
  comprobar, riesgos/bloqueos y archivos relevantes. No escribe un informe por
  sesión. Una prueba en celular se propone cuando aporta evidencia necesaria,
  no como trámite universal.
- No hace commit/push/deploy salvo encargo explícito posterior a la aprobación.

### Ejecución final económica

- Una sonda o ejecutor económico realiza las operaciones deterministas ya
  aprobadas. No rediseña, corrige código ni amplía el alcance durante el release.
- Comprueba que el diff sigue siendo el auditado; incorpora solo archivos
  autorizados. Un cambio ajeno o nuevo requiere revisar únicamente lo afectado,
  no ignorarlo ni incluirlo por comodidad.
- Usa las credenciales configuradas para el destino aprobado. Nuevas
  credenciales, cambios de permisos u operaciones destructivas requieren
  autorización específica; nunca imprime secretos.
- Comprueba que la ejecución terminó y que producción sirve lo esperado. Informa
  commit, ejecución y resultado real; una corrida verde sin deploy no es un
  release. Si falla, informa la causa y conserva el último deployment válido.
- El cron de actualización de datos ya autorizado sigue automático. No pide una
  aprobación de Bruno por cada nuevo reporte de la fuente.

## 4. Poda documental y fuente única de cada regla

`AGENTS.md` contendrá reglas comunes y el rol del Líder, claramente separados.
`CLAUDE.md` referenciará las reglas comunes y contendrá el rol del Builder: leer
AGENTS no debe convertir accidentalmente al Builder en Líder. No duplicar en
ambos archivos el proceso, el estado del producto ni todas las restricciones.

Las decisiones explícitas vigentes de Bruno prevalecen sobre documentos antiguos
del proyecto. Un SPEC solo encarga su cambio activo; un comentario o documento
histórico no puede resucitar una restricción derogada. Estas reglas del repo no
modifican permisos de herramientas ni instrucciones superiores del entorno.

| Documento | Destino |
| --- | --- |
| `AGENTS.md` | Reescribir con reglas comunes, flujo/rol Líder y referencias mínimas. Quitar calibraciones obligatorias, prohibición de tests y estado volátil. |
| `CLAUDE.md` | Contrato breve del Builder, sin primera identidad pendiente, capas futuras ni reglas duplicadas. |
| `README.md` | Producto, arranque y operación actuales: publicar interfaz, refrescar/reproyectar datos, verificar y recuperar. Sin copiar conteos de producción o versiones cambiantes. |
| `docs/datos.md` | Fuentes, procedencia, privacidad y contratos conceptuales vigentes. Registro ≠ conjunto de ofertas vigentes. Documentar degradación de identidad y límites reales. |
| `DESIGN.md` | Conservar principios visuales, reutilización y accesibilidad útiles. Quitar anatomía obsoleta y obligación de documentar cada componente/cambio de UI. |
| `docs/roadmap.md` | Backlog corto, explícitamente no autorizante; sin capas obligatorias ni proceso repetido. |
| `HANDOFF.md`, `BITACORA.md`, `SPEC-OPT.md`, `SPEC-precios-marcas-ubicacion.md`, `docs/descubrimiento.md`, `docs/factibilidad.md` | Rescatar solo decisiones/información todavía útiles en su documento vivo y eliminar estos archivos. Historial en Git, no carpeta `archive/`. |
| `docs/aportes.md` | Rescatar en backlog únicamente la idea pendiente útil, sin diseño de backend obligatorio, y retirar el documento extenso. |

Actualizar enlaces rotos y comentarios normativos contradictorios en el código
relacionado. No reescribir por estilo todo el repo. Conservar `LICENSE`, `NOTICE`,
atribuciones y restricciones materiales de fuentes. Documentar solo cuando cambia
cómo operar o entender algo que no resulta evidente del código.

Este `SPEC-CLEAN.md` sigue disponible durante implementación y auditoría. Una vez
aceptado e incorporadas sus reglas a los documentos vivos, se retira del árbol
activo como parte del cierre aprobado; no se transforma en otro manual paralelo.

## 5. Publicación de interfaz independiente de la fuente

Modificar el mecanismo existente; no introducir una plataforma de entrega nueva.
Puntos de entrada: workflow, `scripts/publish.mjs`,
`app/publication-policy.mjs`, `scripts/fetch-live-bundle.mjs` y verificadores.

| Ruta | Comportamiento |
| --- | --- |
| Solo documentación | Comprobaciones pertinentes; no descarga de raws, proyección ni deploy del sitio por ese push. |
| Interfaz/assets compatibles | Recupera el último bundle público válido, comprueba compatibilidad con el nuevo cliente y publica. No ejecuta `refresh`, probe de la fuente, seed privado ni instalación de identidad. |
| Refresco programado de datos | Conserva adquisición, validación, guardrails y promoción conjunta. Sin cambios válidos, no inventa un release. |
| Catálogo/proyección/contrato | Reproyecta desde un snapshot privado válido compatible cuando sea posible, sin exigir novedades en la fuente. Si falta un input necesario, informa cuál. No disfraza el cambio como interfaz. |

Requisitos concretos:

- La ruta `deploy_shell` debe cumplir lo que promete incluso con la fuente caída
  o lenta y sin secretos de identidad/bootstrap presentes. Solo necesita el
  bundle público compatible y credenciales de publicación ya configuradas.
- Reutilizar datos no significa fingir frescura: conservar bytes, revisión,
  fechas, hashes y estado del bundle. Validar manifest, ambos productos y
  compatibilidad cliente/datos. Si no existe un bundle compatible, no publicar.
- Calcular todos los commits del push, no solo el último. Cubrir el caso sin
  commit anterior válido con una decisión explícita, no una comparación parcial.
- Un cambio de SVG más su instalador no debe clasificarse automáticamente como
  cambio de precios solo porque tocó `scripts/`. La selección de ruta debe ser
  simple, explicable y con una opción explícita para cambios mixtos. El Builder
  resuelve detalles técnicos; no devuelve a Bruno un acertijo de flags.
- Informar ruta elegida, motivo, revisión reutilizada/generada y si hubo deploy.
  Distinguir `no-op` esperado de una entrega solicitada que no se publicó.
- Desacoplar preparación: un refresh largo no debe bloquear toda la preparación
  de interfaz ni verificaciones de PR. Serializar la publicación final donde sea
  necesario y revalidar el estado antes de subir: dos corridas concurrentes no
  pueden restaurar un shell anterior ni pisar un bundle más nuevo con uno viejo.
  No confiar en que las corridas terminen en el orden en que empezaron.
- Mantener manifest al final, snapshots inmutables y revisión determinista. No
  volver al incremento manual de sufijos. Evitar cambiar el esquema público por
  esta limpieza si el contrato público no necesita cambiar.
- Eliminar auditorías idénticas repetidas en una corrida conservando su cobertura
  efectiva de privacidad. No suprimir comprobaciones de secretos/historial sin
  reemplazo equivalente ni hacer una limpieza del historial Git.

## 6. Identidad opcional; integridad de precios obligatoria

Bruno aprobó aislar fallos comerciales, **no relajar la verdad de los datos**.
No alcanza con quitar `assertCommercialPublicationReady`: hay fallos anteriores
en `scripts/identity-install.mjs`, carga del catálogo/auditoría y en `refresh.mjs`,
que también construye candidatos de proyección.

Implementar una resolución explícita de identidad utilizable y problemas, usada
consistentemente por instalación/refresh/proyección. Reutilizar código existente;
no crear un sistema nuevo de acreditación ni un `catch` general que vuelva verde
cualquier excepción.

- Construir/validar precios y su vínculo con el Registro independientemente del
  enriquecimiento comercial. Un Registro vacío, inconsistente o inválido, errores
  de precios/fechas, integridad rota o filtración de privados siguen bloqueando
  la publicación afectada y conservan el último deployment bueno.
- Si el defecto está en una entrada comercial, aislarla. Un ID comercial ajeno
  a un Registro válido no crea una estación ni invalida sus precios: se descarta
  esa atribución. Si hay duplicados/conflictos, no elegir arbitrariamente uno.
- Si la auditoría de un nombre está pendiente, desactualizada o no coincide, no
  publicar esa afirmación sin respaldo. Conservar otras afirmaciones/entradas
  solo cuando puedan validarse por sus reglas vigentes; no borrar una marca
  válida únicamente porque falló el nombre, ni reutilizar una auditoría con hash
  o población incompatibles como si siguiera aprobada.
- Si falla un grupo, aislar las afirmaciones afectadas. Si un paquete no se puede
  decodificar, su formato es desconocido o no se puede delimitar lo confiable,
  puede quedar neutral toda la identidad dependiente de ese paquete, **no los
  precios**. Debe continuar también en CI, no solo en la función de proyección.
- Un catálogo anterior solo puede reutilizarse si está realmente disponible,
  conserva respaldo válido y es compatible con el Registro actual. No convertir
  texto del bundle público anterior en evidencia privada, ni revivir identidades
  conocidas como incorrectas. Sin respaldo suficiente, usar fallback neutral.
- Distinguir resultados de identidad completa, degradada y ausente, con conteos
  y razones accionables. Incluir advertencia visible en el resumen de CI y detalle
  privado donde ya se guardan reportes; no publicar expedientes, RUC, responsables
  ni secretos. Un deploy degradado puede ser correcto, pero no silencioso.
- Cuando se corrija el expediente, una reproyección debe recuperar identidades
  sin esperar nuevos precios ni editar sufijos. Mismas entradas válidas deben
  seguir produciendo contenido/revisión deterministas.

No cambiar fórmulas de matching, umbrales de atribución o requisitos reales de
evidencia para inflar cobertura. Las comprobaciones comerciales deciden qué
identidades se publican; dejan de ser un veto global a precios válidos.

## 7. Decisiones de producto que no se reabren

- Marca publicada y SVG disponible implican logo visible: no hay segunda puerta
  de acreditación del logo ni requisito de 35 revisiones para encenderlo.
- Se aceptan activos oficiales o recreación/vectorización fiel desde referencia
  oficial. Registrar procedencia real; no llamar oficial a una recreación.
  Conservar saneamiento SVG: sin scripts, recursos remotos ni bitmap incrustado
  presentado como vectorización. Un defecto se comunica concretamente.
- Corregir comentarios que todavía digan que el catálogo legado o una marca sin
  `brand_evidence` nunca muestran logo, si eso contradice el comportamiento actual.
- La atribución no nace solo de coordenadas ni de equiparar razón social a marca.
  Conservar las condiciones sustantivas del uso de Maps ya autorizado y la
  privacidad de lo cosechado. No reabrir el permiso de descubrimiento.
- Los 12 meses de evidencia incorporada disparan revisión, no retirada automática
  de marcas previamente publicadas. No falsear la fecha de la fuente con la fecha
  de consulta. Publicar avance válido sin exigir una cuota global de cobertura.
- Precios de más de 30 días no se muestran ni ordenan; la estación del Registro
  permanece con tarjeta sin precio. No convertir ausencia de reporte en inexistencia.
- Mantener la independencia del proyecto y las atribuciones. La dirección oficial
  ya admitida por el contrato público no vuelve a tratarse como un permiso
  pendiente; raws, expedientes, secretos y datos generados siguen fuera de Git.

Para cambios de logos, una sonda útil comprueba registro→archivo→SVG válido y
consistencia del precache/versionado; el cambio debe llegar también a visitantes
con caché anterior. Comprobar contenido y tipo de respuesta, no solo HTTP 200:
una ruta inexistente puede responder con HTML. No exigir registrar todos los SVG
del directorio ni activar Petroperú para que pase la sonda.

## 8. Evidencia suficiente para auditar este cambio

Usar sondas sintéticas/fixtures y el bundle válido disponible. No hacer descargas
masivas ni publicar para demostrar localmente el desacoplamiento. Se permiten
pruebas automatizadas pequeñas; no construir una suite general. Estos cinco
casos son específicos de este cambio, no un ritual para entregas futuras:

1. **Interfaz independiente:** fuente inaccesible y secretos privados ausentes;
   preparar shell con bundle público válido sin invocar refresco, conservar bytes
   de datos y rechazar un bundle incompatible. Simular también el HTTP 200 con
   HTML para un asset esperado: no debe pasar por SVG válido.
2. **Aislamiento comercial:** precios/Registro válidos con un nombre pendiente,
   entrada conflictiva y paquete comercial ilegible. Verificar exclusión de lo
   no comprobable, conservación de lo válido y advertencias, sin frenar precios.
   Corregir el expediente y recuperar identidad mediante reproyección.
3. **Protecciones intactas:** un defecto real de Registro/precios/integridad sigue
   impidiendo promoción. No aparece un manifest parcial ni información privada.
   Mantener disponible la recuperación/rollback existente.
4. **Ruta y concurrencia:** push con UI en un commit anterior y documentación al
   final; cambio de logo+instalador; corridas de shell/datos que terminan al revés.
   Resolver la ruta correcta y no retroceder código/datos por una corrida vieja.
5. **Poda y operación:** enlaces vigentes; ausencia de normas superadas en entradas
   activas; roles claros sin permisos automáticos de deploy; Petroperú intacto y
   no registrado. Auditoría de publicación y verificaciones pertinentes pasan.

El Builder informa qué comprobó de verdad y cualquier límite de la simulación.
El Líder audita el diff y esos resultados, corrige solo lo necesario y solicita
aprobación de release cuando corresponda. Tras la aprobación, la sonda ejecutora
comprueba en producción la entrega y resume el resultado por chat. No se declara
terminado un deploy que no ocurrió ni se abre otro documento para describirlo.
