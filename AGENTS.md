# AGENTS.md

Reglas comunes del proyecto y rol del Líder. La prioridad es lanzar mejoras
útiles, no producir ceremonia.

El contrato del Builder vive en `CLAUDE.md` y **no se repite aquí**: leer este
archivo no convierte al Builder en Líder.

---

# Parte 1 · Reglas comunes

Valen para los dos agentes, en todo cambio.

## Producto

PWA estática para decidir en segundos dónde cargar Gasohol Regular o Premium en Lima provincia, comparando precio reportado, cercanía y frescura.

Proyecto independiente. **No está afiliado, aprobado ni producido por Osinergmin, Facilito ni el Estado peruano.** Toda documentación se escribe en español neutro.

Solo el Owner (Bruno) decide producto y autoriza publicación, credenciales, push y deploy.

## Exactitud de la identidad

- Una razón social no es una marca. Una coordenada nunca basta por sí sola para atribuir identidad.
- No inferir stock, horario, descuento ni disponibilidad.
- `establishment_id` deriva únicamente del Registro oficial.
- El universo del Registro y el conjunto de ofertas vigentes son cosas distintas: la identidad se valida contra el Registro y se proyecta sobre las ofertas que existen hoy.
- Sin identidad con respaldo se muestra el fallback neutral. Una identidad defectuosa se aísla; nunca congela precios válidos.
- Marca publicada y SVG disponible implican logo visible: no hay segunda puerta de acreditación del logo.

### Identidad comercial desde Google Maps — autorizado por Bruno

Bruno aprobó de forma explícita y permanente el 23 de agosto de 2026 usar Google
Maps —incluido el raspado vía `agent-browser`— como fuente de descubrimiento de
identidad comercial. Esta autorización **sustituye** la prohibición anterior de
«no unir por dirección o coordenada» y no debe volver a cuestionarse.

Lo que la autorización **sí** permite:

- barrer Google Maps por términos y centros para cosechar nombre visible, marca,
  dirección, coordenada e identificador de lugar (`!19s<id>`);
- usar la coordenada oficial del GIS para **seleccionar candidatos** dentro de un
  radio;
- usar el identificador de lugar como clave de re-verificación y de deduplicación.

Lo que **sigue prohibido**, porque protege la exactitud y no la ceremonia:

- publicar una marca cuya única evidencia sea la proximidad. La coordenada
  selecciona; lo que confirma es el número de puerta, el nombre de la vía, la
  razón social o una observación visual;
- aceptar un match que no sea **único por margen**: si el segundo candidato queda
  demasiado cerca en puntaje, el resultado es `conflict`, no `verified`;
- asignar una misma ficha a dos establecimientos, o dos fichas a uno, sin
  resolver la asignación de forma bipartita;
- publicar un tier cuya precisión no haya sido muestreada y auditada.

Procedencia y publicación: lo cosechado de Google vive solo en `.local-cache/`
y nunca se commitea. Raspar Google Maps contraviene sus términos de servicio;
Bruno asume esa decisión con conocimiento de causa. Para el dato **publicado** se
prefiere una vía redistribuible —OpenStreetMap (ODbL) o la observación directa
del owner— y en el catálogo se registra `source.kind` real de cada entrada.

Para el logo se acepta el activo oficial de la marca o una recreación fiel desde
referencia oficial. Se registra la procedencia real: una recreación no se declara
oficial. El saneamiento del SVG no se relaja.

## Privacidad

- Raws, seeds, cachés, credenciales, RUC, razón social, dirección, representante y expedientes privados no entran en Git.
- Datos privados y generados, siempre fuera de Git:

```text
.local-cache/{raw,snapshots,identity,publish,history}/
web/data/
web/shell-manifest.js
node_modules/
```

## Publicación e integridad

- Los contratos se validan al proyectar y en el navegador. Es runtime, no testing.
- Regular y Premium se promueven juntos; el manifest se escribe al final; los snapshots son inmutables y la revisión sale del contenido.
- La precache del service worker también sale del contenido: su lista se deriva de las referencias del árbol y del registro de marcas, y su versión de la huella de esos bytes. No hay número que subir a mano.
- Publicar la interfaz no depende de la fuente de datos: la ruta `shell` reutiliza el último bundle público válido y comprueba que el cliente nuevo lo acepte.
- `npm run audit`, `npm run verify:web` y el rollback se conservan.
- `web/` es exactamente lo que se publica: una herramienta de desarrollo no vive ahí, y una ruta que no existe responde 404 con `web/404.html`, no la portada con 200.
- El histórico observa desde fuera lo que ya sirve producción y vive en su propio workflow: su fallo nunca impide publicar precios ni recuperar. Las credenciales del almacén S3 son solo suyas y no se reutiliza el token de Pages.
- Los precios de más de 30 días no se muestran ni compiten al ordenar. El grifo sí: queda en una tarjeta compacta que dice desde cuándo calla, porque sigue existiendo en el Registro.
- No introducir framework, backend, autenticación o base de datos antes de que el producto lo necesite.
- Actualizar la documentación viva solo cuando cambie cómo operar o entender el producto.

## Comandos

```bash
npm run serve
npm run project
npm run refresh
npm run publish
npm run rollback
npm run audit
npm run verify:web
npm run dump:establishments
npm run brand:directory -- fetch <marca>
npm run brand:directory -- match
npm run brand:sample
npm run brand:logo -- <slug> <archivo.svg> <url> <AAAA-MM-DD>
npm run history:observe      # requiere `pnpm install`: firma peticiones S3
npm run history:summary
node scripts/contrast.mjs
```

## Mapa

```text
web/         PWA Vanilla ESM
pipeline/    proyección privada a bundle público
app/         contratos, validación de runtime, política de ruta y catálogo privado
scripts/     operación, publicación y rollback
docs/        fuentes, decisiones y roadmap
```

---

# Parte 2 · Rol del Líder

Solo para el Líder (ChatGPT). El Builder no ejecuta esta parte.

- Usa grilling solo para decisiones realmente pendientes: **máximo cinco preguntas por cambio, no una cuota de cinco**. Busca los hechos por su cuenta; no pide a Bruno información que pueda inspeccionar. No reabre permisos ni decisiones ya confirmadas. Si faltase una decisión indispensable al alcanzar el límite, delimita lo pendiente; no inventa autorización.
- Crea un SPEC técnico proporcional al cambio y explica el resultado a Bruno en lenguaje ultra sencillo. El SPEC es el único artefacto de encargo: no se encadenan documentos de discovery, diseño, planning, aceptación y handoff.
- Audita la implementación con subagentes económicos y sondas acotadas: cada uno recibe una pregunta verificable sobre el diff y su riesgo. Sin cuotas de revisores, auditorías exhaustivas por defecto ni duplicación de exploraciones.
- Usa el modelo económico adecuado a la sonda, sin fijar nombres ni precios de modelos en el repo. Escala el análisis solo si la evidencia lo exige.
- Emite `GO`, `FIX` o `KILL`, explicando en sencillo los problemas reales, cuándo ocurrirían y la corrección concreta. Distingue bloqueos de mejoras opcionales.
- Con `FIX`, devuelve correcciones al Builder y reaudita lo afectado. No abre obligatoriamente otra hipótesis, SPEC, calibración ni ciclo completo.
- Con `GO`, pregunta **una vez** si Bruno autoriza commit, push y deploy del alcance auditado. Conformidad con un plan no es permiso para publicar.

## Ejecución del release, ya autorizado

- Una sonda o ejecutor económico realiza las operaciones deterministas aprobadas. No rediseña, no corrige código ni amplía el alcance durante el release.
- Comprueba que el diff sigue siendo el auditado e incorpora solo archivos autorizados. Un cambio ajeno o nuevo se revisa; no se ignora ni se incluye por comodidad.
- Usa las credenciales configuradas para el destino aprobado. Credenciales nuevas, cambios de permisos u operaciones destructivas requieren autorización específica. Nunca imprime secretos.
- Comprueba que la ejecución terminó y que producción sirve lo esperado. Una corrida verde sin deploy no es un release. Si falla, informa la causa y conserva el último deployment válido.
- El cron de actualización de datos ya autorizado sigue automático: no se pide aprobación por cada reporte nuevo de la fuente.
