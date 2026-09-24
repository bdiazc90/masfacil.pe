# masfacil.pe

PWA independiente para comparar Gasohol Regular y Premium en Lima provincia por precio reportado, cercanía y frescura. No está afiliada, aprobada ni producida por Osinergmin, Facilito ni el Estado peruano.

Una sola pantalla por vista, con los dos productos en la misma tarjeta: hoy la única vista activa es `/combustibles/gasolina`, y `/` abre la última vista recordada en el dispositivo (sin preferencia, Gasolina). `/combustibles/gasolina/historial` abre esa misma portada con el gráfico del histórico enfocado. Los enlaces antiguos (`/gasolina`, `/gasolina/regular`, `/gasolina/premium`, `/gasolina/historial`) y la barra final redirigen con 301 a su ruta canónica. Una vista no activada o cualquier otra ruta responde 404 con una página mínima que devuelve a la portada, también sin conexión.

La app nunca afirma stock, horario, descuentos o disponibilidad. Los precios de más de 30 días no se muestran ni compiten al ordenar; el grifo permanece en una tarjeta compacta que dice desde cuándo calla.

## Cómo decide la interfaz

- Cada precio sale de una de dos fuentes, y la tarjeta dice cuál: **«Consultado hace X»** cuando viene de la consulta web de Facilito, que vale 24 horas, y **«Reportado hace X»** cuando viene del CSV oficial, que vale 30 días. Un reporte oficial posterior a la consulta siempre gana.
- Con ubicación: fija un pool de estaciones cercanas y muestra las primeras, ordenables por cercanía o precio.
- Sin ubicación: permite elegir distrito y no fabrica distancia.
- La edad del precio y su fuente se recalculan en el navegador: cruzar las 24 horas activa el respaldo del CSV **aunque no haya conexión**, con el bundle ya guardado.
- `Cómo llegar` abre Google Maps con el destino tras una acción explícita.
- La ubicación de quien usa la app no se envía a servidores de masfacil.pe.
- Cada tarjeta muestra la marca cuando el catálogo la respalda, con su logo si está en la lista controlada del cliente. Sin identidad con respaldo se muestra `Estación sin nombre verificado`.

## Uso local

Requiere Node.js. Servir la PWA y proyectar datos no necesita dependencias; el
observador del histórico sí, porque firma peticiones S3:

```bash
npm run serve          # http://127.0.0.1:4173
pnpm install           # solo para npm run history:observe
```

Para ver datos reales hace falta el bundle. Dos formas:

```bash
npm run fetch:live -- https://masfacil.pe   # trae el bundle público ya validado
npm run project                              # o proyecta desde .local-cache/ autorizado
```

`web/data/`, `web/shell-manifest.js` y `web/sw.js` se generan y nunca viven en
Git. Los dos últimos son la precache del service worker y el script que lleva su
versión (la lógica vive en `web/sw-main.js`): `npm run serve` y `npm run publish`
los derivan del contenido, así que cambiar un CSS o registrar un logo no exige
recordar ningún número de versión.

## Operación

Cuatro caminos, y el workflow elige el que corresponde según lo que cambió:

| Qué cambió | Qué pasa |
| --- | --- |
| Solo documentación | Se comprueba y no se publica nada. |
| Interfaz o assets | Se recupera el último bundle público válido, se comprueba que el cliente nuevo lo acepte y se publica. **No se consulta la fuente de datos.** |
| Refresco programado | Se consulta Facilito, y se adquiere, valida y promueve un snapshot nuevo si el CSV cambió; Regular y Premium van juntos. |
| Solo cambió la consulta web | Se compone con la capa nueva y se publica **solo si cambia algún precio efectivo**, entra o sale un vínculo, o la consulta publicada se acerca a las 24 h. Si no, la entrega anterior sigue siendo correcta y se queda. |
| Código de proyección o catálogo | Se reproyecta desde el snapshot privado ya restaurado, **sin consultar ninguna de las dos fuentes**: se reutiliza también la última consulta guardada. Solo si falta ese snapshot se refresca, y lo dice. |
| Falla el CSV pero hay consulta | Se compone sobre el último snapshot oficial válido y se publica la consulta de hoy. Sin snapshot utilizable no se publica ningún vínculo nuevo: se conserva la entrega anterior y se informa la causa. |
| Falla la consulta pero hay CSV | Se publica el CSV. Un fallo del navegador o de Facilito nunca detiene la corrida. |

```bash
npm run refresh                # refresca y promueve snapshot privado
npm run project                # proyecta Regular + Premium
npm run publish                # prepara la entrega según ROUTE
npm run verify:web             # bundle, compatibilidad de cliente y logos
npm run verify:web -- --origin https://masfacil.pe   # además, contra producción
npm run rollback -- <snapshot-id>
npm run audit                  # bloquea material privado
npm run dump:establishments    # vuelca los establecimientos con dirección y coordenada
npm run facilito:capture       # consulta Facilito y guarda lo comprobado en el expediente privado
node scripts/facilito-sample.mjs   # muestra privada de vínculos para revisar a ojo
```

La consulta web necesita `agent-browser` y su navegador; nada de eso viaja a
`web/` ni hace falta para servir la PWA. Un fallo de Facilito no impide publicar
el CSV, y el resumen de la corrida lo dice.

Recuperar: `npm run rollback -- <snapshot-id>` reconstruye y valida ambos productos **antes** de mover el pointer, y restaura el anterior si algo falla. Un fallo de identidad comercial no impide recuperar. El rollback vuelve a CSV puro y nunca consulta la web; para restaurar también la consulta exacta de una entrega, `npm run rollback -- <snapshot-id> <revision-id>`.

## Histórico de precios

Un observador aparte mira lo que **ya sirve producción**, archiva esos bytes y anota el promedio diario de Regular y Premium. La portada lo muestra en dos líneas. Si el histórico cae, buscar gasolina, actualizar GPS, publicar precios y hacer rollback siguen funcionando igual: son workflows distintos y no hay dependencia entre ellos.

```bash
npm run history:observe    # observa el bundle público, archiva y reconstruye el resumen
npm run history:summary    # solo reconstruye el resumen desde las observaciones
```

El archivo vive en un bucket S3 (hoy Neon Object Storage; el código no sabe cuál) bajo el prefijo `gasolina/`, y el navegador lee el resumen directamente de la URL pública del bucket. Variables. Sin las cinco del almacén el histórico es local, en `.local-cache/history/`, y lo dice:

| Variable | Para qué |
| --- | --- |
| `PUBLIC_ORIGIN` | origen público que se observa |
| `DATOS_S3_ENDPOINT`, `DATOS_S3_REGION`, `DATOS_S3_BUCKET` | el bucket compartido de datos públicos (path-style, SigV4); las mismas para cualquier utilitario |
| `DATOS_S3_ACCESS_KEY_ID`, `DATOS_S3_SECRET_ACCESS_KEY` | credenciales de escritura, **solo** en el workflow del histórico |
| `HISTORY_S3_PREFIX` | prefijo de este utilitario dentro del bucket; `gasolina/` si no se define |
| `HISTORY_STORE=fs`, `HISTORY_STORE_ROOT` | forzar el almacén local, para probar sin credenciales |

Diagnóstico. `npm run history:observe` imprime una línea JSON con `observation` (`new`/`reused`/`none`), `archive` (`stored`/`reused`), `summary_write` y los conteos por producto. Reconstruir el resumen es siempre seguro: sale de las observaciones guardadas, nunca del resumen anterior, y no se escribe si retrocedería la serie o si faltara una observación que ya estaba publicada.

El archivo es inmutable **por código**, no por el proveedor: el bucket no versiona ni tiene object-lock, y el almacén no tiene `delete`. Repetir los mismos bytes no escribe; encontrar bytes distintos bajo la misma clave es un error que se informa, nunca una sobrescritura.

El workflow `.github/workflows/refresh-pages.yml` tiene tres jobs: `verify` (auditoría), `prepare` (resuelve la ruta y prepara el sitio, sin hacer cola: un cambio de interfaz no espera a que termine un refresco de datos) y `deploy` (serializado, dura segundos: revalida contra lo publicado y contra la punta de `main` —ninguna ruta retrocede código ni datos— y sube). Secretos de Cloudflare, seed, raws y cachés nunca se versionan.

## Identidad comercial

El bundle público lleva `{brand, public_site_name}` unido a `establishment_id`, nunca el expediente. La identidad es opcional para publicar: si el catálogo o su auditoría fallan, se retira la afirmación sin respaldo y **los precios se publican igual**, con el marcador neutral donde corresponda. La corrida lo dice con conteos y motivos.

Detalle de fuentes, permisos y degradación: [docs/datos.md](docs/datos.md).

## Proyecto

```text
web/         PWA estática
pipeline/    transformación a snapshots públicos
app/         contratos, validación en runtime, política de ruta y catálogo privado
scripts/     refresh, publicación, auditoría y rollback
docs/        fuentes, decisiones y roadmap
```

Los datos privados y los JSON públicos generados viven solo en `.local-cache/`
y `web/data/`, ambos ignorados por Git:

```text
.local-cache/raw/        originales descargados
.local-cache/snapshots/  snapshots promovidos + active.json
.local-cache/identity/   catálogo, auditoría y volcados de identidad comercial
.local-cache/publish/    seed y artefactos de publicación
```

Diseño: [DESIGN.md](DESIGN.md). Fuentes y límites: [docs/datos.md](docs/datos.md). Backlog: [docs/roadmap.md](docs/roadmap.md).

Código original bajo Apache-2.0. La licencia no cubre datos o materiales de terceros; ver [NOTICE](NOTICE).
