# Facilito UX Lab

Experimento independiente y no oficial para encontrar combustible desde el celular usando precio, cercanía y frescura. No está afiliado, aprobado ni producido por Osinergmin, Facilito o el Estado peruano.

## Estado

**Capas 1 y 2 completas · Capa 3 en curso · vertical slice privado.**

Ya se puede:

- usar ubicación actual o simulada;
- comparar seis alternativas dentro de un pool estable de veinte estaciones cercanas;
- ordenar por cercanía, precio o frescura sin introducir estaciones remotas;
- elegir una estación y abrir su destino en Google Maps;
- mostrar marca y nombre de sede cuando existe una identidad comercial verificada y publicable; conservar razón social/dirección provisional en cualquier otro caso;
- recalcular la antigüedad real al usar la app y ocultar ofertas futuras, inválidas o mayores de 30 días.

El slice usa Gasohol Regular en Lima provincia. El contrato contiene 714 de 741 ofertas frescas elegibles (**96.356 %**) en 42 distritos. La ubicación personal vive solo en memoria y no se envía a Google; el handoff comparte únicamente las coordenadas del destino tras un tap explícito.

El permiso de publicación se midió campo por campo: precio, fecha, frescura y distrito tienen permiso demostrado; coordenada, razón social, dirección e identidad comercial conservan límites o áreas grises documentadas. Esas ambigüedades no frenan el experimento: se preservan procedencia y capacidad de sustituir fuentes. Ver [factibilidad](docs/factibilidad.md).

## Probar

Requiere Node.js y la caché privada para datos reales. Sin ella usa un fixture sintético.

```bash
npm start
```

Abrir <http://127.0.0.1:4173>. Para forzar el fixture: `npm run demo`. El servidor escucha únicamente en loopback; un celular físico distinto no puede abrir esa URL.

Por defecto la identidad comercial usa la política `public_safe` (solo verificada + vigente + publicable). Para inspeccionar candidatos verificados con publicación desconocida: `node app/server.mjs --private-preview`. Con `?debug=1` en la URL aparece un control para simular el origen cerca de una oferta con identidad comercial proyectada, sin depender de la ubicación real ni de la simulada por defecto.

Para ver el producto bajo publicación estricta, con cada campo filtrado por su permiso real: `node app/server.mjs --public-strict`. Las dos banderas son contradictorias y no pueden combinarse.

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
```

Los originales grandes o identificables permanecen en `.local-cache/`, ignorada por Git. El repositorio conserva schemas, fixtures, métricas y evidencia sanitizada.

## Estructura

```text
app/         web local privada
contracts/   schemas de boundaries
data/        derivados minimizados y procedencia
docs/        conocimiento vigente
evidence/    evidencia agregada y sanitizada
fixtures/    casos sintéticos
scripts/     adquisición, transformación y análisis reproducible
tests/       invariantes del vertical slice
BITACORA.md  trabajo del gate activo
```
