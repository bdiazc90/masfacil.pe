# Facilito UX Lab

Experimento independiente para comparar combustible desde el celular por precio, cercanía y frescura. No está afiliado, aprobado ni producido por Osinergmin, Facilito ni el Estado peruano.

## Estado y alcance

Gate 4.2 está cerrado. La PWA static-first, sus contratos públicos y la proyección desde el snapshot autorizado ya existen; el despliegue público y su automatización corresponden a Gate 4.3. El alcance actual es Gasohol Regular en Lima provincia. No afirma stock, descuentos, marca comercial ni disponibilidad.

El snapshot autorizado del 18/08/2026 produjo 714 de 740 ofertas contractuales, en 42 distritos. El JSON público generado no vive en Git: contiene solo precio, fecha de reporte, distrito y coordenadas, además de metadatos de corte, producto, procedencia y atribución.

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
npm run project:gate-4.1
npm run verify:web
npm run serve:web
```

`web/` es la raíz publicable. Su navegador consume `data/manifest.json` y un snapshot inmutable verificado por hash; nunca consume `/api/dataset`. Sin un snapshot local autorizado, la proyección falla con una instrucción honesta y no usa el fixture como dato real.

## Datos, atribución y límites

Los precios y coordenadas derivan de fuentes públicas de Osinergmin. La publicación downstream de coordenadas fue aprobada por el owner para este proyecto; no equivale a una licencia de Osinergmin ni a respaldo oficial. La atribución, procedencia y límites de reutilización están centralizados en [NOTICE](NOTICE) y explicados en [docs/datos.md](docs/datos.md).

No se versionan raws, minimizados, cachés locales, JSON públicos generados, razón social, dirección, RUC ni overlay comercial privado. `npm run audit:publication` inspecciona por defecto el índice staged (`:`), leyendo sus blobs Git y sus reglas de ignore; `--treeish <rev>` permite revisar un árbol confirmado. Además recorre el historial alcanzable desde ramas, tags y remotos publicables, separando contenido de paths históricos; no confunde refs privadas de herramientas locales con material distribuible. La evidencia agregada y sanitizada que sí permanece se describe en [docs/datos.md](docs/datos.md).

El código, documentación e iconos originales se distribuyen bajo [Apache License 2.0](LICENSE). La licencia no cubre ni relicencia datos o materiales de terceros; ver [NOTICE](NOTICE).

## Verificar

```bash
npm test
npm run audit:publication
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
docs/        producto, fuentes, factibilidad, arquitectura y método
evidence/    evidencia agregada y sanitizada
fixtures/    casos sintéticos para tests y demo
scripts/     reproducción, operación local y auditoría
tests/       invariantes y regresiones
LICENSE      Apache License 2.0 para material original del proyecto
NOTICE       atribución, procedencia y límites de terceros
```

## Método y próximos pasos

El método multiagente, roles y gates están en [docs/metodo.md](docs/metodo.md). Gate 4.3 decidirá publicación, Cloudflare Pages, automatización y smoke tests; no están implementados ni comprometidos en este candidato.

Facilito aporta contexto de investigación, no una arquitectura ni un benchmark obligatorio.
