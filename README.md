# masfacil.pe

Experimento independiente para comparar combustible desde el celular por precio, cercanía y frescura. No está afiliado, aprobado ni producido por Osinergmin, Facilito ni el Estado peruano.

## Estado y alcance

Gates 4.1 y 4.2 están cerrados. El candidato de Gate 4.3 está listo para su primer deployment, pero el gate sigue abierto hasta verificar la URL pública. La PWA vive en `/gasolina/` (la raíz redirige allí) y ofrece Gasohol Regular y Premium con acceso simétrico, solo para DEPARTAMENTO LIMA y PROVINCIA LIMA. No afirma stock, descuentos ni disponibilidad.

**Identidad comercial: hoy no se publica.** Las tarjetas muestran un marcador neutral. Gate 2.3 construirá un catálogo inicial anclado al código Osinergmin existente, con evidencia humana, first-party o web pública registrada en privado y cobertura parcial declarada. El proyecto nunca infiere una marca desde razón social, dirección, coordenada ni proximidad.

El snapshot autorizado del 18/08/2026 produjo para Regular 740 ofertas frescas, 714 listas para el contrato público y 42 distritos. Premium mide 726 frescas, 700 listas y 42 distritos. Esos conteos son de ofertas por producto, no del universo de establecimientos: la unión de códigos Osinergmin entre ambos productos está acotada entre 714 y 1,414 y todavía no se mide. El JSON público generado no vive en Git: cada snapshot solo contiene precio, fecha de reporte, distrito y coordenadas; producto, corte, procedencia y atribución viven en su descriptor/dataset.

## Empezar desde un clon limpio

Requiere Node.js. Los tests y la demo no requieren `.local-cache`.

```bash
npm test
npm run audit:publication
npm run demo
```

Abre <http://127.0.0.1:4173>. La demo se identifica como sintética: no representa precios, estaciones ni disponibilidad reales.

Para generar y servir la PWA con el snapshot real se necesita una caché local autorizada, que no forma parte del repositorio:

```bash
npm run project:gasolina
npm run verify:web
npm run serve:web
```

`web/` es la raíz publicable. `/gasolina/` no carga snapshots; sus dos acciones llevan a `/gasolina/regular/` o `/gasolina/premium/`, y cada ruta solicita únicamente su producto. El navegador consume `data/gasolina/manifest.json` y un snapshot inmutable verificado por hash; nunca consume `/api/dataset`. Sin un snapshot local autorizado, la proyección falla y no usa el fixture como dato real.

La interfaz solicita geolocalización de alta precisión, forma una vez el pool de 20 más cercanas y muestra cuatro tarjetas con los únicos órdenes «Más cercas» y «Más baratas». Si se niega el permiso, permite elegir distrito sin fabricar una distancia. La edad se recalcula con el reloj real y las ofertas fuera de 0–30 días se ocultan antes de ordenar. No calcula ruta, ETA, tráfico ni costo del desvío; Google Maps recibe solo el destino tras un tap explícito.

## Operación de Gate 4.3

El workflow [`.github/workflows/refresh-pages.yml`](.github/workflows/refresh-pages.yml) se ejecuta en `main`, manualmente y cuatro veces al día fuera del minuto cero. Empieza solo después del bootstrap público inicial; no usa caches ni artifacts como fuente durable: recupera de Pages el `refresh-state` agregado y validado, instala el seed privado mínimo y decide de forma cerrada.

- `unchanged`: un HEAD, cero bytes de raw y cero deploy.
- `changed` válido: descarga y construye ambos productos en staging; solo promueve el pointer si Regular y Premium pasan juntos. Después proyecta el mismo par, verifica y realiza Direct Upload.
- `unverifiable`, `needs_review` o `rejected`: error visible y conserva el último deployment bueno.

Para habilitarlo, el owner configura `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT` (variable) y `GATE_4_3_BOOTSTRAP_SEED_B64` (secret). Los valores no viven en Git. El proyecto Pages recomendado es `masfacil-pe`; la URL resultante será `https://masfacil-pe.pages.dev` hasta que exista una decisión separada sobre dominio propio.

### Bootstrap manual inicial de Pages

El workflow no puede crear su propio origen de verdad: antes de activarlo debe existir un bundle público completo y verificable. Desde un entorno con el snapshot local autorizado:

```bash
npm run project:gasolina
npm run verify:web
npm run verify:pages-bootstrap
npm run prepare:pages-bootstrap
```

Solo si los cuatro comandos pasan, el owner crea el proyecto de Direct Upload llamado `masfacil-pe` y realiza el primer upload desde la raíz temporal sellada con una versión fijada de Wrangler:

```bash
npx --yes wrangler@4.31.0 pages project create masfacil-pe --production-branch main
npx --yes wrangler@4.31.0 pages deploy .local-cache/gate-4.3/pages-bootstrap-web --project-name masfacil-pe --branch main
```

La carpeta temporal de bootstrap contiene únicamente el shell trackeado y `web/data/` generado. Así, archivos locales no versionados bajo `web/` no entran accidentalmente al primer upload.

Después verifica `https://masfacil-pe.pages.dev/gasolina/`, `data/gasolina/manifest.json`, ambos snapshots indicados y `data/gasolina/refresh-state.json`. A partir de ahí el workflow puede recuperar el estado agregado. Si esos archivos no existen, falla con «Bootstrap público de Pages ausente» y no descarga datos ni despliega: no hay circularidad ni fallback sintético.

Con la caché autorizada se puede reconstruir el seed privado byte a byte y simular el runner limpio:

```bash
npm run seed:gate-4.3
GATE_4_3_TEST_MODE=1 npm run make:clean-runner-raw:gate-4.3 -- <raw-autorizado.csv>
GATE_4_3_TEST_MODE=1 npm run verify:clean-runner:gate-4.3 -- .local-cache/gate-4.3/clean-runner-liquid.csv
```

El último comando usa solamente un temporal, un servidor `localhost` y artefactos ignorados con permisos privados; verifica `changed`, `unchanged` y la ausencia de estado. Nunca convierte este fixture de prueba en dato público.

Un rollback operativo también valida y reconstruye ambos productos antes de cambiar el pointer:

```bash
npm run rollback:gate-4.3 -- <snapshot-id>
npm run verify:web
```

## Datos, atribución y límites

Los precios y coordenadas derivan de fuentes públicas de Osinergmin. La publicación downstream de coordenadas fue aprobada por el owner para este proyecto; no equivale a una licencia de Osinergmin ni a respaldo oficial. La atribución, procedencia y límites de reutilización están centralizados en [NOTICE](NOTICE) y explicados en [docs/datos.md](docs/datos.md).

No se versionan raws, minimizados, cachés locales, JSON públicos generados, razón social, dirección, RUC ni overlay comercial privado. `npm run audit:publication` inspecciona por defecto el índice staged (`:`), leyendo sus blobs Git y sus reglas de ignore; `--treeish <rev>` permite revisar un árbol confirmado. Además recorre el historial alcanzable desde ramas, tags y remotos publicables, separando contenido de paths históricos; no confunde refs privadas de herramientas locales con material distribuible. La evidencia agregada y sanitizada que sí permanece se describe en [docs/datos.md](docs/datos.md).

El código, documentación e iconos originales se distribuyen bajo [Apache License 2.0](LICENSE). La licencia no cubre ni relicencia datos o materiales de terceros; ver [NOTICE](NOTICE).

## Verificar

```bash
npm test
npm run audit:publication
node scripts/audit-publication.mjs --treeish HEAD --strict-history
git diff --check
```

Para hacer fallar la verificación cuando existan hallazgos históricos que requerirían una reescritura aprobada:

```bash
node scripts/audit-publication.mjs --strict-history
```

## Estructura

```text
web/         PWA Vanilla ESM y shell instalable
pipeline/    proyección privada → contrato público inmutable
app/         utilidades y preview sintético/privado legado
contracts/   contratos versionados
docs/        producto, fuentes, factibilidad, roadmap, arquitectura y método
evidence/    evidencia agregada y sanitizada
fixtures/    casos sintéticos para tests y demo
scripts/     reproducción, operación local y auditoría
tests/       invariantes y regresiones
LICENSE      Apache License 2.0 para material original del proyecto
NOTICE       atribución, procedencia y límites de terceros
```

## Método y próximos pasos

El método multiagente, roles y gates están en [docs/metodo.md](docs/metodo.md); el contrato normativo completo para agentes, en [AGENTS.md](AGENTS.md). El rigor se aplica en proporción al daño y a la velocidad de cambio. La observación humana o web pública registrada es evidencia válida para un catálogo curado; cobertura completa y automatización total no son requisitos universales. Ningún NO-GO material se conserva sin una condición concreta de reapertura.

Gate 4.3 está listo para desplegar: la promoción conjunta y el runner limpio ya están verificados. El deployment, URL, smoke HTTPS y captura real requieren la acción explícita del owner descrita arriba. Gate 2.3 —el catálogo canónico de identidad— es independiente y no bloquea ese cierre.

Facilito aporta contexto de investigación, no una arquitectura ni un benchmark obligatorio.
