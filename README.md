# Facilito UX Lab

Experimento independiente y no oficial para encontrar combustible desde el celular usando precio, cercanía y frescura. No está afiliado, aprobado ni producido por Osinergmin, Facilito o el Estado peruano.

## Estado

**Capas 1, 2 y 3 completas · Gate 4.1 cerrado · PWA static-first construida.**

Ya se puede:

- usar ubicación actual o simulada;
- comparar seis alternativas dentro de un pool estable de veinte estaciones cercanas;
- ordenar por cercanía, precio o frescura sin introducir estaciones remotas;
- elegir una estación y abrir su destino en Google Maps;
- mostrar marca y nombre de sede cuando existe una identidad comercial verificada y publicable; conservar razón social/dirección provisional en cualquier otro caso;
- recalcular la antigüedad real al usar la app y ocultar ofertas futuras, inválidas o mayores de 30 días;
- detectar mediante validadores HTTP si existe un CSV nuevo sin descargar su cuerpo;
- refrescar manualmente el snapshot: detectar, descargar a staging, validar, comparar calidad y promover atómicamente; el pointer permite rollback sin borrar el anterior.
- proyectar el snapshot activo a un contrato público mínimo e inmutable, servido desde `web/` con manifest, PWA instalable y fallback offline honesto.

El slice usa Gasohol Regular en Lima provincia. El snapshot activo del 18/08/2026 contiene 714 de 740 ofertas frescas elegibles (**96.486 %**) en 42 distritos. La ubicación personal vive solo en memoria y no se envía a Google; el handoff comparte únicamente las coordenadas del destino tras un tap explícito.

El owner aprobó la publicación de coordenadas GIS y de la distancia derivada para el contrato público downstream. Precio, fecha, frescura, distrito y coordenadas se publican con procedencia y atribución a Osinergmin; razón social, dirección e identidad comercial no entran al JSON público. La ausencia de una licencia GIS explícita se conserva como hecho de procedencia, no como prohibición. Ver [factibilidad](docs/factibilidad.md).

## Probar

Requiere Node.js y la caché privada del snapshot activo. La PWA no sustituye un pointer inválido por un fixture sintético.

```bash
npm run project:gate-4.1
npm run serve:web
```

Abrir <http://127.0.0.1:4173>. `web/` es la raíz publicable; el navegador consume `data/manifest.json` y el snapshot estático señalado, nunca `/api/dataset`. Verifica el bundle con `npm run verify:web`. El servidor local escucha únicamente en loopback.

Por defecto la identidad comercial usa la política `public_safe` (solo verificada + vigente + publicable). Para inspeccionar candidatos verificados con publicación desconocida: `node app/server.mjs --private-preview`. Con `?debug=1` en la URL aparece un control para simular el origen cerca de una oferta con identidad comercial proyectada, sin depender de la ubicación real ni de la simulada por defecto.

```bash
npm test
```

## Norte de producto

- **Mobile-first:** resolver desde la ubicación actual, sin recortar por fronteras distritales ni incentivar uso durante la conducción.
- **Identidad reconocible:** mostrar marca y nombre de sede solo cuando exista una relación legítima y determinística.
- **Conveniencia personal:** distinguir precio de lista, descuentos declarados y costo del desvío; no asumir que lo más barato es lo mejor.
- **Incertidumbre útil:** mostrar frescura o límites solo cuando cambien una decisión o prevengan daño.
- **Tangibilidad primero:** hipótesis pequeña, producto usable, prueba rápida; research únicamente si bloquea el siguiente incremento.

Facilito aporta contexto, no una arquitectura ni un benchmark obligatorio.

## Conocimiento vigente

- [Arquitectura y gates](docs/arquitectura.html)
- [Producto público observado](docs/descubrimiento.md)
- [Fuentes y modelo de datos](docs/datos.md)
- [Factibilidad y contrato privado](docs/factibilidad.md)

Reproducción de evidencia:

```bash
node scripts/analyze-j7-snapshot.mjs
node scripts/profile-gate-0.2.mjs
node scripts/verify-gate-0.2.mjs
node scripts/analyze-gate-0.3.mjs
node scripts/build-gate-1.1.mjs
node scripts/verify-gate-3.1.mjs
npm run probe:gate-3.2 -- liquid-current
npm run refresh:gate-3.3 -- liquid-current
npm run rollback:gate-3.3 -- <snapshot-id>
```

El refresco usa `.local-cache/gate-3.3/active.json` como pointer y conserva snapshots inmutables y el last-known-good. `unchanged` no descarga; `unverifiable` rechaza de forma visible; una degradación material queda en `needs_review`. Registro y GIS se reutilizan como inputs fijados y fechados, no se declaran refrescados. Los CSV originales, derivados identificables y caches grandes permanecen ignorados por Git.

Los originales grandes o identificables permanecen en `.local-cache/`, ignorada por Git. El repositorio conserva schemas, fixtures, métricas y evidencia sanitizada.

## Estructura

```text
web/         raíz pública PWA (shell, manifest, worker y datos generados ignorados)
pipeline/    proyección del contrato privado hacia JSON público inmutable
app/         utilidades y preview privado legado
contracts/   schemas de boundaries
data/        derivados minimizados y procedencia
docs/        conocimiento vigente
evidence/    evidencia agregada y sanitizada
fixtures/    casos sintéticos
scripts/     adquisición, transformación y análisis reproducible
tests/       invariantes del vertical slice
BITACORA.md  trabajo del gate activo
```
