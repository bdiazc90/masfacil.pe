# Facilito UX Lab

Investigación independiente sobre si la experiencia pública de `facilito.gob.pe` puede mejorarse sustancialmente mediante producto, UX y uso responsable de datos públicos.

Este proyecto **no está afiliado, aprobado ni producido** por Osinergmin, Facilito o el Estado peruano.

## Norte del producto

Permitir que una persona encuentre desde el celular, en segundos, un establecimiento reconocible por su marca o nombre comercial, conozca el precio, la ubicación y la vigencia del dato, y entienda cuánto puede confiar en esa información.

Principios ya aprobados:

- **Tangibilidad primero:** pocas hipótesis, un slice que se pueda usar, validación rápida e incorporación únicamente de lo que demuestre valor.
- **Mobile-first real:** priorizar el contexto de consulta desde un celular, sin incentivar interacción mientras se conduce.
- **Identidad reconocible:** marca y/o nombre comercial como etiqueta principal; razón social y RUC como trazabilidad secundaria. La relación debe provenir de una fuente legítima y determinística, nunca de fuzzy matching.
- **Incertidumbre visible:** frescura, cobertura y límites deben formar parte de la experiencia, no quedar ocultos.
- **Evidencia proporcional:** un prototipo privado puede ser manual, local y descartable; publicar exige resolver permisos, privacidad, identidad, frescura y operación.

## Forma de trabajo

**Construir para aprender. Investigar solo lo que bloquea el siguiente artefacto tangible.**

Cada gate posterior al descubrimiento debe declarar una hipótesis principal, como máximo un riesgo crítico y algo ejecutable o directamente consumible. El ciclo preferido es:

```text
hipótesis pequeña → artefacto tangible → prueba rápida → incorporar, corregir o eliminar
```

FAST es el loop predeterminado. El research aislado y FULL requieren un bloqueo concreto de seguridad, acceso legítimo, publicación o decisión difícil de revertir. No se exige infraestructura productiva para aprender con un experimento privado y honesto.

## Estado

**Capa 1 — vertical slice privado.** Gate 1.2 cerró una web mobile-first utilizable con ubicación actual, comparación local y medición opcional. El alcance continúa siendo privado y no autoriza publicación.

Hallazgos vigentes de Gate 0.1:

- siete journeys públicos entregaron ofertas reales en el caso Lima / provincia Lima;
- las consultas devuelven el resultset dentro de HTML y DataTables pagina en cliente;
- J1–J6 no muestran fecha junto al precio;
- en J7, 224 de 444 filas observadas tenían más de un año al 2026-08-14;
- mobile y desktop ofrecen universos territoriales distintos: el mapa desktop omite Callao;
- los handlers observados son implementación pública, no una API estable ni una fuente canónica demostrada.

La evidencia completa está en [docs/descubrimiento.md](docs/descubrimiento.md). El estado visual vigente del sistema está en [docs/arquitectura.html](docs/arquitectura.html).

Hallazgos vigentes de Gate 0.2:

- cuatro fuentes de precio suman 2,340,316 filas; los CSV vigentes de GLP y líquidos llegan al 2026-08-13;
- Registro y GIS comparten identificadores exactos candidatos con 93.162 %–99.082 % de cobertura según actividad, todavía con no-matches y casos uno-a-muchos;
- `MARCA` cubre 66.047 % del CSV GLP, pero significa producto o envasadora, no nombre comercial del establecimiento;
- el enlace PRICE de Facilito conduce a una biblioteca documental, no a una descarga estructurada observada;
- J7 no tiene una fuente estructurada nominal demostrada y permanece como brecha P0;
- los originales grandes o con datos personales no se versionan; Git conserva únicamente evidencia minimizada, procedencia y métricas sanitizadas.

El catálogo y modelo observado se mantienen en [docs/datos.md](docs/datos.md).

Resultado vigente de Gate 0.3:

- J1 conserva 12,954 ofertas con precio `<=30 días`, autorización exacta y coordenada segura en el snapshot reproducido;
- la geografía sobre Registro exacto alcanza 94.29 %–99.29 % en J1–J6; el control externo de Surco cubrió 28/28 establecimientos;
- ninguna fuente bulk oficial observada aporta el nombre comercial reconocible del establecimiento: el producto público continúa bloqueado por identidad y por permisos de reutilización aún ambiguos para GIS/EVPC;
- J7 permanece excluido: la fuente estructurada observada no reproduce su oferta pública;
- el experimento autorizado debe medir acciones, tiempo y comprensión antes de decidir cualquier arquitectura o producto.

El veredicto, las políticas de confianza, los embudos y los umbrales del experimento están en [docs/factibilidad.md](docs/factibilidad.md).

Resultado vigente de Gate 1.1:

- 741 ofertas de Gasohol Regular tenían precio válido `<=30 días`; 714 completaron Registro exacto, coordenada segura e identidad provisional: **96.356 %** en 42 distritos;
- la medición previa de Surco permanece como población fallida separada: 26/30 (86.667 %), sin cambiar su denominador;
- el contrato real con 714 ofertas permanece ignorado y con permisos privados; Git conserva schema, fixture sintético y evidencia agregada;
- el protocolo compara ambas condiciones desde el mismo origen y permite todos los controles nativos de Facilito;
- marca, descuentos y convenios quedan como hipótesis posterior.

Resultado vigente de Gate 1.2:

- la web local funciona con el dataset privado de 714 ofertas o con 4 alternativas sintéticas, sin dependencias ni llamadas externas;
- desde el origen se forma primero un pool estable de las 20 estaciones más cercanas y se muestran 6 por cercanía, precio o frescura;
- en el control simulado, el pool quedó entre 0.478 y 2.030 km; ordenar por precio o frescura ya no introduce estaciones remotas;
- Haversine se presenta como distancia en línea recta, nunca como ruta o tiempo de viaje;
- la UI normal oculta el protocolo; `?debug=1` habilita medición sanitizada sin coordenadas personales ni identidad del establecimiento;
- el owner validó la utilidad y limpieza de la experiencia; Claude Challenger la aceptó sin bloqueantes. Identidad comercial y permiso de reutilización continúan bloqueando un producto público.

## Reproducción disponible

El snapshot agregado y sanitizado de J7 permite recalcular antigüedad y consistencia interna:

```bash
node scripts/analyze-j7-snapshot.mjs
```

El snapshot no conserva filas crudas ni identidades; por tanto, reproduce los agregados guardados, no audita nuevamente la extracción desde Facilito.

Gate 0.2 puede recalcularse y verificarse sin repetir descargas públicas:

```bash
node scripts/profile-gate-0.2.mjs
node scripts/verify-gate-0.2.mjs
```

La factibilidad integrada de Gate 0.3 se recalcula sobre los snapshots minimizados:

```bash
node scripts/analyze-gate-0.3.mjs
```

El contrato experimental privado de Gate 1.1 se reconstruye con la caché local sellada:

```bash
node scripts/build-gate-1.1.mjs
```

## Probar la web local de Gate 1.2

El modo normal usa el dataset privado validado cuando existe y, si está ausente, inicia con el fixture sintético. No realiza llamadas externas y escucha únicamente en `127.0.0.1`:

```bash
npm start
```

Abrir `http://127.0.0.1:4173`. Para forzar una demostración sin datos reales: `npm run demo`. El recorrido normal es: elegir ubicación real o simulada → comparar por cercanía, precio o frescura → elegir una estación. La ubicación real permanece solo en memoria. Para habilitar los controles de investigación y copiar la medición sanitizada, agregar `?debug=1` a la URL.

## Estructura actual

```text
docs/        conocimiento vigente y mapa visual
contracts/   schemas de boundaries experimentales
data/        snapshots minimizados, métricas y procedencia verificable
evidence/    evidencia mínima sanitizada
fixtures/    datos sintéticos para validar contratos sin propagar identidades
scripts/     research y transformaciones reproducibles
app/         web local privada y servidor sin dependencias
tests/       invariantes del vertical slice
BITACORA.md  coordinación del gate activo
```
