# SPEC-OPT — tres simplificaciones: un módulo de preparación, una caché derivada, un solo camino de datos

Encargo aprobado por Bruno a partir del top-5 de simplificaciones del Líder.
Cubre los puntos 5, 3 y 4 de esa lista, en ese orden de entrega. Es el único
artefacto de encargo: no se encadenan documentos de discovery, diseño ni handoff.

## Resultado buscado

Que publicar se pueda entender y probar en local con una sola función; que
cambiar un CSS o registrar un logo no exija recordar otro archivo ni subir un
número de versión a mano; y que los precios se procesen por **un** camino, el
de Regular/Premium, sin arrastrar el experimento de agosto.

En ultra sencillo: **una función que prepara; una caché que se versiona sola;
un solo procesamiento de datos. Bruno conserva la decisión de publicar.**

## 1. Alcance y autorización de este encargo

- Builder: plan breve por chat, implementar este SPEC en tres bloques y en el
  orden de la sección 3, comprobar lo cambiado y entregar un resumen corto para
  la auditoría del Líder. No crear otro SPEC, documento de planificación,
  handoff ni bitácora.
- La aprobación autoriza implementación local, incluidas las retiradas de
  archivos descritas aquí. **No autoriza commit, push, deploy ni actualización
  de secretos.** Eso se solicita después del veredicto del Líder.
- Tres bloques → tres commits reversibles por separado (el bloque de datos
  puede ser dos). El Líder audita por bloque; Bruno decide si el release es
  conjunto o escalonado.
- El árbol es compartido. Inspeccionar su estado antes de trabajar, preservar
  cambios ajenos, sin staging global ni comandos destructivos de limpieza.
- `web/icons/brands/petroperu.svg` sigue sin seguimiento y sin registrar:
  **no tocarlo, no registrarlo, no incluirlo en ningún commit ni precache.**
- `SPEC-CLEAN.md` y `scripts/probe-spec-clean.mjs` se retiran en el cierre de
  SPEC-CLEAN, no en este encargo. Si la sonda sigue en el árbol cuando entre el
  bloque de caché, su caso de precache se ajusta o se retira; no bloquea.
- No ampliar cobertura de marcas, no cambiar reglas de atribución, no
  rediseñar la UI, no migrar de framework, no añadir backend/base de datos, no
  modificar la cadencia del cron, no cambiar el esquema público 2.6.0, no
  reemplazar el transporte de secretos.

## 2. Hechos encontrados que hay que resolver

Referencias observadas al redactar; verificar el estado actual antes de editar.

| Problema | Evidencia local | Cambio requerido |
| --- | --- | --- |
| El workflow es un segundo programa | El paso «Preparar la entrega» de `.github/workflows/refresh-pages.yml` son 55 líneas de shell + `node --input-type=module` inline que releen `refresh-result.json` para decidir `deploy` | Un módulo devuelve el resultado; el YAML solo encadena pasos. |
| La decisión se reconstruye leyendo logs | `scripts/publish.mjs:25-45` (`firstJson`, `parseRefresh`) rebusca una línea JSON en stdout **y** stderr de `refresh.mjs`, porque el refresco comunica su rechazo por stderr | Llamar al refresco en proceso y recibir un objeto. |
| El refresco solo existe como proceso | `scripts/refresh.mjs:23-38` lee env y argv en el nivel superior; `scripts/verify-web.mjs` es un guion sin función exportable | Función con opciones + envoltorio CLI. |
| La precache se enumera y se versiona a mano | `web/sw.js:4` enumera 27 rutas; `web/sw-cache-policy.js:1` fija `masfacil-shell-v23` (v23 lo exigió el verificador en el ciclo FIX: el olvido es estructural); `web/sw.js:38` `cache.addAll` es atómico; `sw-cache-policy.js:3-7` cache-first nunca revalida | Lista y versión derivadas del contenido, generadas al preparar. |
| El SW puede leer sus imports de la caché HTTP | `web/service-worker-ready.js:55` registra sin `updateViaCache` | `updateViaCache: 'none'` y `no-cache` para el módulo generado. |
| Listar el directorio precachearía basura | `web/icons/icon-192.svg` existe y nada lo referencia; `web/contrast.mjs` es herramienta de desarrollo | Derivar de referencias y de reglas, no del directorio. |
| El experimento sigue en producción | `scripts/refresh.mjs:239-265` (`runBuilder`) ejecuta `scripts/build-dataset.mjs` (539 líneas) en `:315`, antes de la proyección | Retirarlo; conservar solo lo que el público consume. |
| El público consume dos campos de todo eso | `pipeline/project-gasolina.mjs:62,64` usa `temporal_context.cutoff_at` y `.source_max_reported_at`; nada más del dataset privado ni de la evidencia viaja al bundle | Recomputarlos sin el constructor y guardarlos en el pointer. |
| Controles congelados y contradictorios | `build-dataset.mjs:436-451,533-534`: Surco `26/30`, umbral `90`, control del owner `28/28` del `2026-08-12`, regresión sellada del `2026-08-14`; `fixtures/dataset.synthetic.json` exige rechazar `age = 31`, cuando desde 2.5.0 los precios vencidos viajan a propósito | Retirar con motivo; conservar como prueba solo lo que aún protege. |
| El control legacy no corre donde importa | `compareSnapshotQuality` (`app/snapshot-refresh.mjs:26-59`) solo se evalúa con `previousEvidence`, que en CI es `null` (`refresh.mjs:104`) | Un solo guardrail: `compareGasolinaQuality`. |
| Lógica duplicada y raw leído cinco veces | `csvRows`, `parseTimestamp`, `clean`, esquemas y selección de oferta en `build-dataset.mjs`, `pipeline/gasolina-products.mjs` y `scripts/minimize.mjs`; esquemas también en `dump-establishments.mjs` y `app/bootstrap-seed.mjs`. El raw de 1,2 GB se recorre en `minimize.mjs:48,61`, `build-dataset.mjs:311` y `gasolina-products.mjs:141` ×2 | Un módulo CSV; una pasada de raw para ambos productos. |
| El camino nuevo elige arbitrariamente | `gasolina-products.mjs:138` toma `matches[0]` en un cruce ambiguo; `:147` «última gana» ante `ID3` repetido; no comprueba encabezados exactos | Excluir y contar; nunca elegir. |
| Código muerto | `toClientDataset` (`app/contract.mjs:70`); `buildRefreshState`, `validateRefreshState`, `evidenceFromRefreshState` (`pipeline/refresh-state.mjs:12-41`); rama legacy de `rollbackSnapshot` (`snapshot-refresh.mjs:126-135`); allowlist de `audit-publication.mjs:10` para un archivo inexistente | Retirar. |

## 3. Orden de entrega

1. **Preparación como módulo** (sección 4). Deja la función en la que se
   apoyan los otros dos bloques y saca el segundo programa del YAML.
2. **Caché derivada del contenido** (sección 5). Se engancha a esa función.
3. **Un solo camino de datos** (sección 6). El más delicado; va último y en
   dos pasos: A) retirar con equivalencia byte a byte, B) trasladar los
   controles que aún protegen, con efecto medido.

## 4. Preparación como módulo: GitHub Actions ejecuta, no decide

Modificar lo existente; no introducir una plataforma de entrega nueva.

- Nuevo `pipeline/prepare-release.mjs` con
  `prepareRelease({ root, route, routeReason, forceProject, identityRoot, deps })`
  que devuelve **un objeto**: `{ ok, route, route_reason, refresh, decision,
  execution, informe, identity }` — la forma que hoy escribe `publish.mjs`, para
  que `scripts/publication-summary.mjs` siga leyendo igual — más `ok`. Sin
  `spawnSync`, sin leer stdout ni stderr de nadie.
- `scripts/refresh.mjs` se parte. `pipeline/refresh-snapshot.mjs` exporta
  `refreshSnapshot(options)`; las env y argv de hoy pasan a opciones con los
  mismos defaults (`root`, `sourceId`, `forceRefresh`, `publicRefreshStatePath`,
  `referenceMinimizedRoot`, `testSourceUrl`, `probeTimeoutMs`, `identityRoot`)
  y devuelve el resultado; si lanza, **quien llama** lo traduce a
  `{ status: 'rejected', error }`. El guion `scripts/refresh.mjs` queda como
  envoltorio CLI de `npm run refresh`: imprime el JSON y conserva los códigos
  0/1/2 de hoy. El lock exclusivo sigue dentro de la función.
- `scripts/verify-web.mjs` → `verifyWeb({ root, origin })` devuelve
  `{ errors, notas, summary }`; el guion solo imprime o lanza.
- `prepareRelease` llama en proceso a `refreshSnapshot`, `projectGasolina`,
  `verifyWeb` y —cuando exista— `writeShellManifest` (sección 5). `deps`
  inyectable: todas las rutas y estados se prueban sin red ni 1,2 GB.
- `scripts/publish.mjs` = CLI fino: env → `prepareRelease` → escribe
  `prepare-result.json` (sustituye a `refresh-result.json`; env
  `PREPARE_RESULT`) → si existe `GITHUB_OUTPUT`, anexa `deploy=…` → imprime
  una línea JSON. **Siempre escribe el archivo antes de salir**: ante un error
  interno escribe `{ ok: false, decision: { deploy: false }, error }`. Códigos
  de salida: 0 = decidido (deploy o no-op); 1 = entrega pedida que no se
  publicó o error interno. La guarda «resultado ilegible» vive aquí.
- El paso del workflow queda en `run: npm run publish`. Desaparecen `set +e`,
  la relectura inline y el bloque `node --input-type=module`. `resolve-route`,
  `preflight-deploy` y el resumen ya siguen ese patrón: cada guion escribe sus
  propios outputs y el YAML solo los encadena.
- Se conservan: los dos jobs, el artefacto entre jobs, `preflight-deploy`
  contra lo publicado y contra `origin/main`, los dos resúmenes.

## 5. Caché derivada del contenido: registrar una vez, versionar sola

Modificar el mecanismo existente; el service worker sigue siendo el mismo.

- Módulo **generado** `web/shell-manifest.js`, ignorado por Git y prohibido en
  `scripts/audit-publication.mjs` (`FORBIDDEN_PATHS` y `REQUIRED_IGNORES`,
  como `web/data/`). Exporta `SHELL` y
  `SHELL_CACHE = 'masfacil-shell-<sha256, 12 hex>'`. El prefijo se mantiene
  para que `activate` (`web/sw.js:39`) siga borrando cachés anteriores.
  `web/sw.js` importa ambos de ahí; `web/sw-cache-policy.js` conserva
  `DATA_CACHE` y las estrategias y pierde la constante manual.
- **Regla de derivación**, explícita y determinista. Sobre el árbol actual
  reproduce las 27 entradas de hoy, ni una más:
  - `/` (index.html);
  - `web/*.js` salvo `sw.js` y el propio manifest; `web/lib/*.js`. `*.mjs`
    queda fuera por regla (excluye `contrast.mjs`);
  - `styles.css` y `manifest.webmanifest`;
  - los iconos **referenciados** por `index.html` (`href` de `<link>`) y por
    `manifest.webmanifest` (`icons[].src`) — no el directorio;
  - `icons/brands/<slug>.svg` **por cada slug de `BRAND_LOGOS`**
    (`web/brand-logos.js`). Registrar un logo una vez con su procedencia deriva
    su precache. Un SVG no registrado —Petroperú— no entra.
- **Huella**: sha256 sobre la lista ordenada más los bytes de cada archivo
  listado. Excluye `web/data/**`, `sw.js`, el manifest, `_headers` y
  `_redirects`: la versión del shell no cambia con los precios.
- Generación en dos puntos: `scripts/serve-web.mjs` al arrancar y
  `prepareRelease` antes de verificar, en toda ruta que publica. `verifyWeb`
  **no genera**: deriva y compara con el archivo en disco; ausente o
  desactualizado es error. Un logo registrado sin archivo o que no pase
  `svgProblems` hace fallar la generación: no se publica un `addAll` roto.
- Mecanismo de actualización cerrado: `web/_headers` sirve
  `/shell-manifest.js` con `Cache-Control: no-cache` (como `/sw.js`) y el
  registro pasa a `{ type: 'module', updateViaCache: 'none' }`.
- Se retiran de `app/shell-assets.mjs` y `verify-web`: `precacheVersionProblems`,
  `parseShellList`, `parseShellCacheVersion`, la comparación contra `git show`
  y la env `RANGE_BEFORE` de ese paso. `serviceWorkerUpdateProblems` pasa a
  exigir el import de `./shell-manifest.js`. Se conservan íntegros el
  saneamiento SVG (`svgProblems`, `scripts/install-brand-logo.mjs`) y
  `brandAssetProblems`.
- Transición: la primera huella derivada sustituye a `v23`; nada más que hacer.

## 6. Un solo camino de datos: retirar el experimento con equivalencia

### Paso A — retirar con equivalencia byte a byte

- Los dos campos temporales pasan al pointer del snapshot:
  `temporal_context: { cutoff_at, source_max_reported_at, snapshot_date }`,
  escrito por `makeSnapshotPointer` durante el refresco. `cutoff_at` es el
  `completed_at` de la adquisición (`refresh.mjs:197`);
  `source_max_reported_at` es el máximo de `FECHA_DE_REGISTRO` sobre **todas**
  las filas del minimizado, antes de cualquier filtro, calculado **una vez** al
  cargarlo (`gasolina-products.mjs:97` ya lo carga entero). Mismo valor que
  hoy, mismo anclaje `-05:00`.
- `buildGasolinaProjectionForPointer` lee `pointer.temporal_context`; si no
  existe (snapshot anterior), lee los mismos dos campos del `dataset_path`
  legado, sin validar contra el schema retirado. `validateSnapshotPointer`
  exige `temporal_context` **o** `dataset_path` existente; `lineage` no cambia
  (`app/raw-reuse.mjs` depende de él).
- Se retiran: `scripts/build-dataset.mjs`, `app/dataset-schema.mjs`,
  `app/contract.mjs`, el directorio `fixtures/`, `runBuilder`,
  `loadValidatedDataset`, `compareSnapshotQuality` y `material_conflicts`,
  `ensureInitialPointer`, `resolveActiveSnapshot` y `candidateDatasets`
  (descubren el dataset legado bajo `data/` y `evidence/`, rutas que no
  existen en el árbol), los exportes muertos de `refresh-state.mjs`, la rama
  legacy de `rollbackSnapshot`, el allowlist fantasma de
  `audit-publication.mjs` y la evidencia agregada. Un snapshot nuevo deja de
  contener `dataset/` y `evidence/`. Sin pointer y sin `refresh-state` público
  el refresco se detiene con un error explícito: no hay línea base.
- `refresh.mjs`: `quality` es solo `compareGasolinaQuality`; `report.dataset`
  desaparece (los conteos ya están en `report.gasolina.products`); la línea
  base local usa `pointer.temporal_context` y el `refresh-state.json` público.
- Un solo módulo de lectura CSV, `pipeline/csv.mjs` (`csvRows` en streaming,
  `clean`, `normalizeHeader`, `parseTimestamp`, esquemas de raw y minimizado),
  usado por `scripts/minimize.mjs`, `pipeline/gasolina-products.mjs`,
  `scripts/dump-establishments.mjs` y `app/bootstrap-seed.mjs`. El raw se
  recorre **una vez** para ambos productos: la pasada de identidades no
  depende del producto.
- **Prueba de equivalencia obligatoria**, sin ella no se pasa al paso B: con
  el snapshot promovido actual, la proyección sin constructor produce
  `manifest.json`, `refresh-state.json`, `regular.json` y `premium.json`
  **byte a byte idénticos** a los actuales, con la misma `revision_id`; y el
  `temporal_context` derivado coincide con los campos del dataset legado en
  los dos snapshots locales (`2026-08-18-…` y `2026-09-06-…`).

### Paso B — trasladar los controles que aún protegen, con efecto medido

Se traslada solo lo que protege algo que hoy se publica y no tiene equivalente:

- Encabezados exactos de raw y minimizado → fallo duro al cargar (antes
  aserciones `source-minimized-schema-exact` y `source-raw-schema-exact`).
- Cruce con Registro o GIS de cardinalidad ≠ 1 → la oferta se excluye y se
  cuenta en `conflicts.registry_ambiguous` / `conflicts.gis_ambiguous`; nunca
  `matches[0]` (antes `joins-exact-and-unambiguous`; coherente con «no elegir
  arbitrariamente»).
- `ID3` repetido en el raw dentro del alcance → se excluye y se cuenta en
  `conflicts.raw_duplicate`; nunca «última gana» (antes
  `scope-source-row-ids-unique` y `raw-identity-row-reconciles…`).
- Los conteos van dentro de `conflicts` en `refresh-state`, que ya admite
  claves de exclusión: el esquema público **no** cambia. No se exige cero: la
  caída que provoquen la miden los guardrails vigentes.
- El Builder **mide y reporta** el efecto del paso B sobre el snapshot actual:
  ofertas excluidas por regla y por producto. Si es mayor que cero, la
  decisión de promoverlo es del Líder y de Bruno en la auditoría, no del
  Builder.
- Se retiran sin sustituto, con motivo: Surco, umbral 90 y control del owner
  (mediciones congeladas de agosto); regresión sellada del 14/08 (inerte con
  cualquier fecha real); fixture y controles negativos (contradicen 2.5.0);
  `boundary` del schema privado (el público ya tiene `PUBLIC_OFFER_FIELDS`);
  permisos y gitignore del dataset (ya no se escribe); evidencia sin
  identidades (ya no hay evidencia). La reconciliación raw↔minimizado campo a
  campo queda como prueba bajo demanda sobre una muestra, no como trabajo de
  cada refresco.

### Rollback

`npm run rollback -- 2026-08-18-…` sigue funcionando sobre el snapshot antiguo
(lee su `dataset_path` legado); un snapshot nuevo se revierte con
`temporal_context`. Los dos casos son sonda. Los snapshots existentes no se
reescriben.

## 7. Decisiones que no se reabren

Las de SPEC-CLEAN §7 íntegras, y además:

- La identidad comercial es opcional para publicar; los precios y su vínculo
  con el Registro, obligatorios. Un fallo comercial aísla; nunca frena.
- La ruta se decide por efecto (`app/route-policy.mjs`); `project` reproyecta
  desde el snapshot privado sin consultar la fuente cuando es utilizable.
- El pre-vuelo compara con lo publicado y con `origin/main` en **todas** las
  rutas; solo un adelanto de documentación no aborta.
- Instalar identidad es reemplazar la pareja; no se reutiliza por accidente.
- Petroperú sigue sin registrar. Marca publicada y SVG registrado implican
  logo visible; no hay segunda puerta.
- Sin framework, backend, autenticación ni base de datos.
- El esquema público sigue en 2.6.0; los conteos nuevos van dentro de
  `conflicts`, no en campos nuevos.

## 8. Evidencia suficiente para auditar este cambio

Sondas sintéticas y el bundle válido disponible. Sin descargas masivas ni
publicación. Todo lo mutable en un directorio temporal: el expediente real, el
bundle y `.local-cache/snapshots` no se tocan. Se permiten pruebas automatizadas
pequeñas; no una suite general. Estos cinco casos son de este cambio, no un
ritual para entregas futuras.

1. **Preparación en proceso.** `prepareRelease` con `deps` falsos recorre las
   cuatro rutas y los estados `unchanged`, `promoted`, `unverifiable` y
   `rejected` sin red; `publish.mjs` escribe siempre `prepare-result.json` y
   `deploy=` aunque el módulo lance; el YAML no contiene `node -e` ni `set +e`.
   `refreshSnapshot({ root: <temporal> })` corre aislado sobre una copia del
   snapshot (raw enlazado, no copiado) contra un servidor local cuyos
   validadores igualan el raw en caché: reutiliza sin descargar y promueve.
2. **Caché derivada.** La lista derivada del árbol actual es idéntica a las 27
   entradas de hoy; cambiar un byte de `styles.css` cambia `SHELL_CACHE`;
   cambiar `web/data/` no; registrar un logo lo añade solo; un logo
   registrado sin archivo o con SVG no saneado hace fallar la generación;
   `verifyWeb` rechaza un manifest ausente o desactualizado; `icon-192.svg` y
   Petroperú fuera; `sw.js` importa el módulo generado.
3. **Equivalencia y rollback.** Con el snapshot promovido actual, los cuatro
   archivos públicos son byte a byte iguales y la `revision_id` es la misma;
   `temporal_context` derivado coincide con el dataset legado en los dos
   snapshots locales; el refresco aislado del caso 1 termina sin que
   `build-dataset.mjs` exista en el árbol; rollback en seco sobre
   `2026-08-18-…` y sobre un snapshot nuevo.
4. **Protecciones intactas y controles trasladados.** Registro vacío, precio
   inválido, guardrails de caída, `codeRegression`, identidad degradada y
   auditoría de publicación siguen bloqueando o aislando como en SPEC-CLEAN;
   un encabezado distinto en raw o minimizado falla al cargar; un cruce
   ambiguo o un `ID3` repetido se excluye y se cuenta; el efecto del paso B
   sobre el snapshot actual queda medido por producto y regla.
5. **Operación y documentación.** `npm run serve`, `npm run publish` por ruta,
   `npm run verify:web` y `npm run rollback` funcionan en local sin leer YAML.
   `README.md`, `AGENTS.md` (comandos y mapa, sin `fixtures/`) y
   `docs/datos.md` no mencionan la versión manual de la caché,
   `refresh-result.json`, `build-dataset`, el dataset experimental ni la
   evidencia agregada; sin enlaces rotos; `audit-publication --strict-history`
   en verde.

El Builder informa qué comprobó de verdad y cualquier límite de la simulación
—el split de jobs, los artefactos y el pre-vuelo contra `origin/main` real solo
se comprueban en GitHub Actions tras un release autorizado—. El Líder audita
el diff y esos resultados por bloque, corrige solo lo necesario y solicita
aprobación de release cuando corresponda. No se declara terminado un deploy
que no ocurrió.

Este `SPEC-OPT.md` sigue disponible durante implementación y auditoría. Una vez
aceptado, se retira del árbol activo como parte del cierre aprobado; lo que
cambie cómo operar o entender el producto pasa a la documentación viva.
