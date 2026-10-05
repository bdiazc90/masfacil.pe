# UI mantenible: React, Vite y Tailwind en cinco gates

**Estado:** cerrado el 05/10/2026. G1–G5 en producción (`719bd56`, `c740ca7`, `1a47a8b`, `c8021fd`,
`54a8d18`; shell vigente `masfacil-shell-ada72eba2eda`, deploy del 05/10/2026,
corrida 37364254238 al tercer intento: los dos primeros los frenó un incidente
de GitHub Actions). G4 comprobado: Bruno lo revisó en Safari de iPhone el
05/10/2026 y los crones del 04/10 y del 05/10 conservaron el shell. G5 (§8 bis,
con los ajustes que Bruno aceptó a partir de las skills de Emil Kowalski) lo
revisó Bruno en su iPhone sobre el candidato servido por HTTPS en la red local.
En producción pasaron `verify:web --origin`, la sonda de visitante nuevo y la
actualización real desde G4 con reapertura sin red. Falta un cron que conserve
el shell.

Fecha: 27/09/2026; gate 5 añadido el 04/10/2026.
Decisión de Bruno: migrar gradualmente la UI al stack que conoce, conservando
el producto ya validado. Builder: Claude Code, conforme a `CLAUDE.md` y a las
reglas comunes de `AGENTS.md`. Este SPEC es el único artefacto de encargo.

**Cada gate termina con su propio despliegue comprobado.** No comenzar el
siguiente hasta cerrar el anterior. Aprobar este SPEC autoriza la implementación
por ese flujo; no autoriza commit, push, deploy ni cambios de credenciales.

## 1. Resultado y alcance

Bruno puede localizar y modificar una parte de la interfaz en componentes React
legibles, con estilos Tailwind y CSS específico donde convenga. Catálogo,
contratos, búsqueda, vigencia, carga y publicación conservan sus responsabilidades.
Quien usa masfacil conserva el diseño, los recorridos, los precios y la PWA.

Se implementa:

- Vite para compilar la presentación y React para renderizarla.
- Migración de resultados primero; controles, pantallas e histórico después.
- Tailwind al final, con los tokens y la apariencia existentes.
- Adaptaciones necesarias de compilación, precache, verificación, comandos,
  clasificación de cambios, CI y documentación operativa.

No se incorpora otra categoría, rediseño, cambio de textos de producto, nueva
analítica, backend, autenticación, base de datos, SSR ni cambio del hosting.
Tampoco se reorganiza todo el repositorio, se lo hace público, se migra todo a
TypeScript ni se añade una librería de componentes, router, estado global o
gráficos. JavaScript ESM y JSX bastan para este encargo.

**Ampliación del 04/10/2026.** El gate 5 (§8 bis) añade, por decisión de Bruno,
un upgrade visual acotado —movimiento, estados, color y vidrio— sobre la
implementación de G4. Sigue sin rediseño de layout, textos ni recorridos.

La autorización de React/Vite/Tailwind de este SPEC sucede a la decisión de
conservar CSS nativo en `docs/SPEC-ui-v2.md`: aquella gobernaba un hito ya terminado.
No habilita otras dependencias de producto por asociación.

## 2. Base y referencia de equivalencia

Base publicada inspeccionada: `7568619`, cuatro vistas de Combustibles cerradas.
`docs/SPEC-combustibles.md` §9 registra la auditoría y la corrección de cierre.
La referencia visual y funcional es esa aplicación, junto a `DESIGN.md` y las
decisiones de Combustibles; no la maqueta monocroma ni las rutas antiguas de
documentos históricos. No hace falta otro mockup para conservar esa interfaz.

Hay trabajo local ajeno en workflows, reglas de ruta, documentación, mapa,
pruebas y prototipos. Antes de implementar, identificar la base y los hunks
necesarios. Integrar solo los aprobados; no incorporarlos por compartir archivo.
Los fixes de cierre de Combustibles se conservan. Si la base avanzó, declarar
el commit real y comprobar la diferencia que afecte al gate, sin reabrir todo.

La UI ya está separada: `web/lib/` contiene reglas; `data-client.js`,
`geolocation.js` y `preference.js` encapsulan operaciones; `app.js` coordina;
`offer-card.js`, `controls-card.js`, `history-chart.js` y `theme.js` presentan.
Se aprovecha esa separación. Cambiar un renderer no exige reescribir las reglas.

## 3. Decisiones de arquitectura

### Fuentes y salida pública

- `ui/` será la raíz de las fuentes de presentación que se compilan: entradas,
  plantillas, componentes, coordinación de UI y estilos. En G1 puede contener
  presentación Vanilla; no anticipar componentes de gates posteriores.
- `web/` continúa siendo exactamente la raíz publicada. Conserva datos
  generados, iconos, manifiesto PWA, cabeceras/rutas y módulos compartidos que
  requieren Node o el worker. Recibe el HTML y los assets compilados de la UI.
- Mantener inicialmente `web/lib/`, contratos, registro de marcas y grafo del
  worker en sus rutas actuales. No moverlos todos para conseguir un árbol bonito.
  Los imports de Node no deben depender de JSX, React ni del resultado de Vite.
- Una sola fuente de cada regla y registro. La inclusión de un módulo puro en
  el bundle compilado es válida; copiar su implementación para React no lo es.
- Toda salida generada tiene propietario y lista explícita de destinos; se
  ignora en Git. Cuando una plantilla pase a `ui/`, retirar su salida generada
  del índice: no mantener dos versiones editables del mismo HTML o CSS.

El Builder concreta los nombres internos y los movimientos mínimos en su plan
de G1. Las decisiones anteriores y `web/` como destino son el contrato.

### Propiedad del estado y del DOM

- Las reglas siguen siendo funciones ajenas a React. Una tarjeta recibe los
  datos de vista ya calculados y acciones; no decide fuentes, vigencia o ranking.
- G2 admite una raíz React de resultados, alimentada por el coordinador actual.
  El adaptador temporal expone renderizar/retirar y callbacks pequeños; no crea
  un bus de eventos ni una segunda copia del estado de búsqueda.
- Un nodo tiene un solo dueño. Vanilla no modifica descendientes de la raíz
  React ni mantiene listeners de tarjetas que React ya controla, y viceversa.
- En G3 la coordinación de la interfaz pasa a React. Usar estado local y, si
  ayuda, un reducer para transiciones relacionadas; no almacenar resultados
  derivados duplicados que puedan contradecir búsqueda, vista o datos.
- El DOM queda para foco, scroll, medición y observadores. No se lee para decidir
  combustible, orden, paginación o pantalla. Refs no sustituyen ese estado.
- Hooks y adaptadores de navegador cancelan o descartan respuestas tardías y
  limpian listeners, temporizadores y observadores. El montaje repetido no debe
  duplicar cargas, geolocalización, historial de URL ni registro del worker.
- Al terminar G3 se retiran los renderizadores y el puente sustituidos. No queda
  una segunda aplicación Vanilla activa ni un flag permanente para elegir UI.
  El rollback es una entrega anterior, no dos productos mantenidos en paralelo.

### Estilos y dependencias

En G1–G3 se conserva el CSS existente. G4 adopta Tailwind compilado, sin CDN ni
runtime de estilos. Se mantienen CSS específico para vidrio, halos, SVG,
controles especiales y mediciones cuando resulte más claro, y una sola fuente
de los colores y temas. No hay cuota de utilidades ni prohibición de CSS nativo.

Fijar versiones compatibles y lockfile con el gestor declarado en el proyecto.
Comprobar la compatibilidad con el Node de CI, hoy 22.20.0, antes de escogerlas;
no depender de `latest`. React se empaqueta una sola vez. No introducir descarga
de librerías al abrir la app ni imports privados en el cliente.

## 4. Contratos que permanecen en los cinco gates

| Área | Resultado que se conserva |
| --- | --- |
| Vistas | Gasolina con Regular/Premium juntos; Diésel, GLP y GNV con un precio. S/ por galón o S/ por m³ según catálogo. |
| Rutas | `/` recuerda vista; URL explícita manda. Cuatro `/combustibles/<vista>`, historial solo en Gasolina, enlaces antiguos y barra final con 301, ruta desconocida con 404 real. |
| Contexto | Cambiar combustible conserva GPS o distrito, radio elegido y reglas actuales del orden por vista. No exige una pantalla previa ni solicita GPS de nuevo por renderizar. |
| Búsqueda | Mismos pool, orden, desempates, tags, radio inicial, paginación, estados vacíos y alternativa por distrito. |
| Vigencia | Mismas reglas de 24 h/30 días y precedencia de fuentes, incluso al volver de segundo plano o sin red. Un reloj recibido por las reglas no se sustituye por fechas implícitas del renderer. |
| Tarjetas | Identidad y logo desde el registro existente; fallback, precios ausentes, tarjeta sin precio, detalle y enlaces seguros conservados. |
| Navegación | Cabecera full/compact/overlay, menú, retorno de foco, scroll y atrás/adelante se comportan como en la base. |
| Histórico | Misma fuente, series, periodos y tratamiento de ausencias. Su carga o fallo no bloquea precios ni GPS. No se agrega histórico a otros combustibles. |
| PWA | Mismo registro `/sw.js`, scope y caché de datos compatible; instalaciones existentes actualizan sin borrar datos o preferencias. |
| Privacidad | GPS local, sin solicitudes externas nuevas; beacon único de Pages y CSP con las excepciones exactas vigentes. |

A 320 y 390 px no hay scroll horizontal ni controles perdidos. Se conserva
tema claro/oscuro/sistema, contraste, targets, labels, anuncios y teclado. Los
IDs y clases pueden cambiar si preservan asociaciones accesibles y comportamiento;
la equivalencia no exige markup byte a byte.

## 5. Gate 1 — Vite y cadena de publicación, UI todavía Vanilla

**Resultado:** la interfaz existente llega compilada a producción y la PWA
actualiza correctamente. React y Tailwind todavía no cambian la presentación.

### Implementación

1. Separar las fuentes de UI y definir un único comando `npm run build`.
   Compilar en staging fuera de `web/`, comprobar éxito y reemplazar solo los
   destinos propiedad de ese build. Nunca vaciar `web/`, usarlo como `outDir`
   destructivo ni borrar `web/data/`. Retirar assets obsoletos del build mediante
   su inventario, sin barrer datos, marcas, módulos compartidos u otros archivos.
2. `npm run serve` construye y sirve el artefacto público con las reglas reales
   de rutas. Puede añadirse `npm run dev` con Vite/HMR, separado: no registrar el
   worker de producción allí. HMR no acredita CSP, 404 ni funcionamiento offline.
3. Toda preparación que vaya a publicar sigue el orden: datos disponibles →
   build de UI → derivación de shell/worker → verificación → artefacto de deploy.
   Aplica a `shell`, `project`, `data` y recuperación que prepare un sitio.
   Instalar dependencias con lockfile también en los caminos de cron que las
   necesiten. No recompilar después de verificar ni en el job que sube el
   artefacto: se publica exactamente lo comprobado.
4. Adaptar la clasificación de `ui/`, configuración Vite y herramientas de
   build según su efecto. UI pura usa `shell`, sin seed, identidad privada ni
   consulta a CSV/Facilito. No clasificar a ciegas todo `scripts/`, cambios
   mixtos de dependencias o contratos como interfaz. El commit de integración
   puede ser `project` por sus cambios operativos; declararlo en el plan.
5. Derivar la precache desde las referencias reales y el manifiesto del build:
   HTML, CSS, módulos y dependencias emitidas, más recursos PWA y marcas
   registradas. No depender de escanear solo `web/*.js` ni de una lista manual
   de hashes. No copiar `node_modules`, fuentes JSX, `.env`, mapas de fuentes
   ni el manifiesto interno de herramientas al árbol público sin necesidad.
6. Separar el recorrido de assets compilados del recorrido estricto del worker.
   `moduleGraph` no es un parser de JavaScript minificado de Vite. El worker
   conserva su grafo estático, `cache: 'reload'`, registro y versión en los bytes
   de `/sw.js`. No instalar un segundo worker mediante un plugin PWA.
7. Actualizar `verify:web` para validar el artefacto compilado, sus referencias
   y el grafo del worker. La 404 y sus recursos deben verificarse por lo que
   usan, sin exigir los antiguos nombres `/styles.css` o `/404.js` si cambian.
   `--origin` compara los bytes finales, descontando solo la inyección de Pages
   ya admitida. Verificar no compila ni repara silenciosamente lo que falta.
   Comprobar también que la salida corresponde a las fuentes, configuración y
   lockfile actuales: un build viejo internamente coherente no acredita fuentes
   nuevas. La evidencia de build queda fuera del árbol público y no usa la hora
   de ejecución para versionar assets o shell.

### Criterios de éxito de G1

- Checkout aislado + instalación congelada + build producen el shell sin raws
  ni credenciales. Para verificar precios se pueden añadir los bundles públicos
  o fixtures locales coherentes; compilar no necesita descargarlos.
- Dos builds de las mismas fuentes y lockfile producen los mismos bytes
  publicados y la misma versión. Cambiar solo datos no cambia el shell; cambiar
  una fuente UI, `_headers`, asset usado o módulo exclusivo del worker sí.
- Con cuatro bundles presentes, sus bytes son idénticos antes/después del build.
  Un fallo de compilación no se publica, no destruye esos bundles y no deja
  una entrega parcialmente válida aceptada por el verificador.
- Una referencia compilada ausente o un asset alterado se detectan. Compilar
  incluye todos los recursos para funcionar offline y las rutas anidadas no
  intentan cargar assets desde `/combustibles/.../assets/`.
  Modificar una fuente sin reconstruir debe invalidar la verificación local;
  comprobar solo que existe un directorio de salida no basta.
- Comparación contra la base con mismos datos/reloj: interfaz y recorridos
  conservados. Precios proyectados y contratos no cambian por la compilación.
- Emulación de actualización desde `7568619`, con caché HTTP de 4 h: precache
  fresca, uso de una pestaña que permaneció abierta, cierre/reapertura sin red
  y rollback local a la base seguido de vuelta pasan. Cubrir los cuatro grupos
  previamente guardados. No exigir offline de un grupo nunca consultado.
- No hay chunks antiguos solicitados que terminen en 404 tras actualizar.
  Evitar introducir carga diferida de código en este SPEC. Si el build requiere
  recursos tardíos, resolver su compatibilidad antes de publicar; no aceptar
  recargas en bucle ni retención ilimitada de shells como solución.
- En producción: visitante nuevo e instalación previa correctos, `verify:web
  --origin` pasa y una corrida real de datos confirma que CI también construye
  y conserva el shell esperado. Una corrida sin deploy verifica preparación,
  pero no sustituye el deploy del gate.

## 6. Gate 2 — React en resultados y tarjetas

**Resultado:** lista, tarjetas, detalle, vacíos de resultados y paginación se
renderizan en React; el resto de la interfaz conserva su coordinador actual.

### Implementación

- Montar una raíz de resultados con componentes por responsabilidad, por
  ejemplo `Results`, `OfferCard`, `OfferDetail` y `LoadMore`. No crear componentes
  por cada etiqueta HTML ni por cada combustible: las variantes vienen del
  catálogo y de props. Nombres concretos a criterio del Builder.
- Reutilizar las reglas y formateadores útiles. Sustituir el renderer de strings;
  envolver `renderOfferCard` en `dangerouslySetInnerHTML` no satisface el gate.
- La raíz recibe una vista coherente y acciones. Solo la UI local, como el
  detalle abierto, reside allí; búsqueda y orden siguen teniendo un solo dueño.
  Claves estables por vista/establecimiento, nunca índice de la lista.
- Pasar también a React los handlers y el foco que pertenecen a esa lista,
  incluido el destino tras «Ver más». El coordinador externo no busca botones
  dentro de React ni conserva delegación de eventos sobre ellos.
- Mantener clases y CSS para aislar el cambio de renderer. Retirar el renderer
  sustituido y adaptar sus pruebas a la nueva interfaz sin congelar strings HTML.

### Criterios de éxito de G2

- Con inputs y reloj idénticos, mismos establecimientos, orden, importes,
  unidades, tags, detalle y cantidad visible en las cuatro vistas.
- Cubiertos marca/fallback, un precio ausente, todos vencidos, vacío por radio,
  paginación final y detalle offline. No aparecen datos HTML interpretados como
  código ni URLs construidas fuera de las reglas existentes.
- Ordenar, paginar y cambiar de combustible no mezclan detalles, pierden el foco
  de forma indebida ni aumentan peticiones de datos por renderizar tarjetas.
- No quedan dos dueños de la lista. Montar/retirar no acumula listeners y los
  controles Vanilla siguen funcionando. React usa build de producción.
- Comparación visual y de interacción pasa; actualización desde G1 y comprobación
  pública de las cuatro vistas pasan. El gate queda desplegado antes de G3.

## 7. Gate 3 — React en pantallas, controles e histórico

**Resultado:** React controla la presentación completa de la aplicación. La
404 puede seguir siendo HTML estático con su pequeño módulo de tema.

### Implementación

- Migrar inicio, ubicación, distrito, estados de carga/error, cabecera,
  selectores, radio, menú, tema e histórico. Integrar la raíz de resultados de
  G2 en la aplicación React y retirar el puente temporal.
- Conservar catálogo, rutas y operaciones existentes como dependencias. La
  URL y la preferencia se resuelven con la misma política; no añadir router.
- Conservar los turnos de carga y localización. La respuesta de una vista
  anterior puede guardar su caché pero nunca pintar bajo la etiqueta nueva.
  Cancelar GPS, elegir distrito o salir al inicio invalida lo que corresponda.
- Los efectos se usan para sistemas externos; cálculos de lista y transiciones
  iniciadas por un gesto no se encadenan en efectos para mantener estados copia.
  Limpiar efectos y comprobar montaje repetido, incluyendo Strict Mode en
  desarrollo cuando aplique. No desactivarlo para esconder duplicaciones.
- El histórico conserva cálculos puros y SVG, presentado en React sin librería
  gráfica. Su carga sigue independiente; un fallo queda en su bloque.
- Conservar entrada visual estable, avisos de carga y espacio reservado del
  gráfico. No introducir una portada vacía esperando una cadena de efectos.

### Criterios de éxito de G3

- Tabla de contratos de §4 comprobada con navegación real, teclado y móvil
  emulado, no solo llamadas directas a callbacks.
- Secuencia rápida entre vistas con red lenta, error y reintento: gana la última
  elección. GPS tardío tras cancelar o cambiar contexto no lo sobrescribe.
- URL directa, preferencia, atrás/adelante, historial y retorno conservan sus
  resultados; un render no añade entradas de navegador o páginas vistas extra.
- Full/compact/overlay y menú mantienen foco, Escape, cierre exterior,
  histéresis y espacio de la cabecera. El input de distrito no pierde foco al
  escribir; cambiar radio no remonta toda la aplicación.
- Al avanzar reloj y volver de segundo plano, se reevalúan vigencia y respaldo
  de fuente, también offline. El memoizado no congela precios vencidos.
- Ciclos repetidos de navegación no acumulan listeners/observadores/cargas.
  Mismo número de solicitudes de producto para recorridos equivalentes, salvo
  diferencia justificada por la base y documentada en la entrega.
- No queda coordinador Vanilla manipulando descendientes de React, ni renderer
  viejo mantenido solo para pasar pruebas. CSS todavía equivalente al de G2.
- Producción y actualización desde G2 verificadas, incluida apertura offline.

## 8. Gate 4 — Tailwind y cierre de mantenimiento

**Resultado:** la UI React utiliza Tailwind donde mejora la lectura; conserva
el sistema visual y deja una única implementación mantenible de cada estilo.

### Implementación

- Añadir Tailwind al build de Vite. Migrar por componente dentro del gate,
  conservando medidas, tipografía, temas y estados aprobados.
- Mantener el reset existente al integrar: no activar Preflight globalmente por
  defecto. Si luego se reemplaza alguna regla base, hacerlo explícitamente y
  verificar controles, títulos, listas y SVG afectados.
- Tema claro/oscuro/sistema sigue respondiendo a `data-theme` y a la preferencia
  existente. No crear una segunda selección oscura por media query ni duplicar
  paleta en configuración, JSX y CSS.
- Utilidades con nombres completos detectables; variantes por combustible o
  marca desde mapas controlados. No interpolar clases como `bg-${marca}` ni
  generar CSS a partir de datos públicos. Assets siguen saliendo del registro.
- CSS específico y custom properties siguen siendo válidos. Eliminar reglas
  sustituidas; no mantenerlas y superponer utilidades con `!important` para
  ganar la cascada. Evitar cadenas repetidas mediante componentes con sentido.
- Adaptar contraste a la fuente real de tokens y comprobar estilos calculados
  cuando la cascada pueda alterar el resultado; no copiar colores a la prueba.
  No relajar CSP para estilos en línea o herramientas de desarrollo.
- Actualizar README, DESIGN, reglas de generados y mapa según el resultado real.
  Explicar dónde cambiar una tarjeta, control, tema y regla de negocio. No crear
  una segunda guía de arquitectura ni otro documento de encargo.

### Criterios de éxito de G4

- Comparación con G3 y revisión contra la base inicial: misma apariencia y
  comportamiento a 320/390 px y un ancho de escritorio, en ambos temas.
- Contraste pasa. Teclado, foco visible, tamaños táctiles, reduced motion,
  modo de colores forzados y fallback sin blur conservan acceso al contenido.
- Selector de cuatro vistas, range, chips, tarjeta sin precio, decoración de
  marcas e histórico no cambian por reset, especificidad o utilidades ausentes.
- Build final solo contiene CSS usado y específico necesario, sin framework de
  estilos en runtime, paleta duplicada ni CSS viejo sustituyendo silenciosamente
  a Tailwind. No se exige convertir a utilidades toda regla especial.
- No se reduce silenciosamente compatibilidad. Registrar versiones objetivo de
  navegador y ensayar Chrome y Safari/WebKit disponibles. Tailwind v4 exige
  capacidades de navegadores modernos: si excluye un entorno antes soportado,
  resolver versión/implementación compatible o elevar esa decisión antes del
  deploy, sin prometer que bajar el target JavaScript transforma su CSS.
- En producción: cuatro vistas, temas, rutas, analytics, actualización desde G3
  y reapertura offline pasan; verificador y mapa reflejan el artefacto final.

## 8 bis. Gate 5 — Upgrade visual ligero: movimiento, estados, color y vidrio

**Resultado:** la misma app, con respuesta al tocar, tarjetas que llegan en vez
de aparecer, estados de carga, vacío y error más claros, color corregido y un
vidrio más nítido. No cambian recorridos, textos, datos, precios, rutas ni PWA.

**Decisiones de Bruno.** 04/10/2026: movimiento = respuesta de controles más
entrada de tarjetas; vidrio = pulir el actual; color = arreglos más ajuste fino;
estados = objetivos táctiles de 44 px, scroll con reduced motion,
carga/vacío/error con más presencia y desenfoque de los chips en Safari anterior
a 18. 05/10/2026: se adoptan como criterio las skills de Emil Kowalski
([emilkowalski/skills](https://github.com/emilkowalski/skills), `e8a175d`):
`animate` (con `emil-design-eng`) para construir el movimiento, `mobile-native`
para el toque en el teléfono, `apple-design` para el vidrio y la accesibilidad, y
`review-animations` como revisión final. Sus valores se copian aquí; no se
instalan. Con ellas se ajustaron los puntos de abajo, se sumaron el toque nativo
y «Aumentar contraste», y se quitó animar el cambio de tema.

Base: G4 desplegado y comprobado (`c8021fd`). Las capturas de G4 en
`.local-cache/ui-react/g4/capturas/` (390 y 1280 px, claro y oscuro) son el «antes».

### Alcance

1. **Movimiento** (`prefers-reduced-motion: no-preference`). Valores de
   `animate`; todos viven en los tokens de `ui/styles.css`.
   - Curvas: `--ease-out: cubic-bezier(.23, 1, .32, 1)` para entradas, presión y
     el panel «Ajustar» (hoy `ease`); `ease` queda solo para cambios de color.
   - Al pulsar (`:active`, al apoyar el dedo): lo que tiene forma de botón
     —botones, píldoras, selectores, chips, tema— baja a `scale(.97)` en 160 ms;
     lo que es texto o fila —enlaces de texto, ítems del menú, resumen «Ajustar»,
     «Sobre los datos»— se atenúa. Lo deshabilitado no responde.
   - Menú «Más opciones»: entra desde su botón (`transform-origin` arriba a la
     derecha), de `scale(.95)` y opacidad 0, en 200 ms; se cierra al instante.
   - Detalle de la tarjeta: su contenido entra con fundido y 4 px desde arriba en
     200 ms. La tarjeta crece al instante —animar el alto costaría layout en cada
     cuadro y recortaría el anillo de foco— y se cierra al instante.
   - Entrada de tarjetas: las tarjetas NUEVAS de la lista —resultados que llegan,
     cambio de combustible, «Ver más», un radio que suma grifos— suben 8 px con
     fundido en 300 ms, 50 ms entre una y otra hasta la sexta; las demás entran
     con la sexta. Solo anima una lista nueva o un agregado al final: si las que
     siguen cambian de orden o una nueva se intercala entre ellas («Más barata»),
     la lista cambia al instante. Va por Web Animations API, sin atributos en el
     DOM, y nunca bloquea el toque; el foco y los anuncios no esperan.
   - El indicador de carga gira rápido (una vuelta en 800 ms, lineal): una espera
     que se mueve rápido se siente más corta. Es lo único en bucle.
   - El cambio de tema no se anima: haría falta View Transitions, fuera de
     alcance, o transiciones de color en toda la página. Nada se mueve sin un
     gesto o sin la llegada de datos. Solo se animan `opacity` y `transform`,
     más el alto del panel «Ajustar», que ya lo hacía.
2. **Reducir movimiento** (`reduce`): menos y más suave, no cero. Sin
   desplazamientos, escalas ni scroll suave; quedan fundidos de opacidad y color
   de 200 ms en tarjetas, menú y detalle, sin escalonado. Al pulsar, todo se
   atenúa. El panel «Ajustar» y el salto al histórico son instantáneos. El
   indicador de carga late en opacidad, sin girar.
3. **Estados.**
   - La búsqueda de ubicación, el estado de la vista (cargando, error, distrito
     sin grifos) y el radio vacío ganan presencia con un icono decorativo
     (`aria-hidden`) por estado —en la carga, el indicador que gira—, con el mismo
     copy y los mismos anuncios. Una carga de vista no muestra precios de la
     vista anterior (§4).
   - El salto al histórico respeta reduced motion.
   - Objetivos táctiles de al menos 44 × 44 px: selector de tema, «Ver en Street
     View», el radio y «Ver fuente de Osinergmin», sin mover el layout más de lo
     necesario. Exentos: los enlaces dentro de una frase (la firma). «Listo» ya
     medía 44: su `min-height: 36px` no se aplicaba, porque `.button--text` le gana
     (se retira por muerto).
4. **Toque nativo** (`mobile-native`). Sin el destello gris de iOS al tocar
   (`-webkit-tap-highlight-color: transparent`: cada control ya responde con
   `:active`). Mantener pulsado un control no selecciona su texto
   (`user-select: none` solo en controles, nunca en el contenido) y un enlace con
   forma de botón no abre la vista previa. Las pantallas cortas no se desplazan
   de más (`100dvh`). Ya se cumplen y no se tocan: buscador a 16 px, sin
   `:hover`, sin la espera de 300 ms al tocar. Agregado tras la prueba en el
   iPhone (05/10): «Ir al contenido» queda transparente hasta recibir el foco,
   porque Safari pinta detrás de la barra de estado lo que queda encima del
   viewport, y el enlace, solo desplazado, asomaba ahí (venía de agosto,
   `0977f9d`).
5. **Color.**
   - El tema oscuro pinta oscuro desde el primer cuadro: un script clásico del
     mismo origen en `<head>` (`web/theme-boot.js`) fija `data-theme` antes de
     pintar, en la portada y en la 404. `theme-color` sigue al tema, también al
     elegirlo en el selector; el `<meta>` lleva el fondo de cada tema en hex
     (`data-light`, `data-dark`), porque la barra se pinta antes de que llegue la
     hoja.
   - El relleno del histórico lleva el color de su serie: hoy su degradado no
     hereda `--serie` y sale gris.
   - Ajuste fino de glows y neutros del tema claro, con más separación entre
     tarjeta y papel. Todo en los tokens; la sonda de contraste manda.
6. **Vidrio** (`apple-design`). Pulir el actual con los knobs de tokens: canto
   más nítido, más separación en claro y un glow algo más presente.
   - Jerarquía: lo grande (tarjetas, plates) lleva el desenfoque pleno y una
     sombra más profunda; lo chico (chips, selectores sueltos), uno menor.
   - Nunca vidrio sobre vidrio: dentro de un plate, los selectores y el tema no
     llevan desenfoque propio (el tema vive siempre en el card de controles).
   - Los chips de distrito llevan `-webkit-backdrop-filter` (Safari anterior a 18).
   - «Aumentar contraste» (`prefers-contrast: more`, en todos los navegadores
     declarados): superficies opacas, sin desenfoque y con borde marcado.

Fuera de G5: layout o componentes nuevos (salvo el icono de estado), cambios de
copy, librerías de animación o de componentes, View Transitions, animar el cambio
de tema, «Reducir transparencia» (Safari no la expone), `viewport-fit=cover` y
zonas seguras (cambian el layout), `overscroll-behavior` (aquí el
pull-to-refresh sirve), analítica nueva y cambios de datos, rutas o PWA.

### Contratos de G5

- §4 se conserva entero. El DOM puede ganar un envoltorio, un atributo o el icono
  de estado solo si un componente lo necesita para animar o para el estado, sin
  cambiar roles, nombres accesibles, orden de foco ni anuncios.
- Cada valor que G5 afina o repite va al bloque de tokens de `ui/styles.css`; no
  hay paleta, escala ni duraciones paralelas. El JS que anima lee su duración y
  su curva de esos tokens, como ya lee `--expand-at`. Las utilidades usan los
  alias de `ui/tailwind.css`.
- Contraste mínimo de 4.5:1 en texto y 3:1 en elementos gráficos, en ambos temas,
  según `node scripts/contrast.mjs`. Ningún margen baja del de G4 (texto
  secundario 4,56 en claro).
- Colores forzados, fallback sin desenfoque y teclado conservan el acceso al
  contenido. CSP sin cambios: el script de tema es un archivo propio y viaja en
  la precache.
- JS + CSS iniciales: como máximo +5 KiB gzip sobre G4 y dentro del tope de §9.
  Los tiempos, según §9.
- Antes de las capturas, el diff pasa la lista de `review-animations`: sin
  `transition: all`, sin `scale(0)`, sin `ease-in`, sin `:hover` sin acotar y
  nada de más de 300 ms salvo el giro de carga.

### Criterios de éxito de G5

- Con `reduce` y en reposo (`document.getAnimations()` vacío), la sonda de
  equivalencia contra G4 solo muestra las diferencias estáticas declaradas
  (color, vidrio, objetivos táctiles, toque nativo, icono de estado), en una
  lista cerrada por elemento y propiedad. Con `no-preference`, toda animación
  termina en esos mismos estilos calculados.
- Capturas antes y después en 320, 390 y 1280 px, claro y oscuro, revisadas por
  Bruno antes del release.
- Tema oscuro: el primer cuadro de la portada y de la 404 ya es oscuro, con el
  módulo de la app retrasado.
- Objetivos táctiles medidos de al menos 44 × 44 px, con la lista de exentos
  cerrada; contraste pasa.
- Chrome, y Safari en el iPhone de Bruno: antes del release, sobre el candidato
  servido por HTTPS en la red local con una CA de prueba (por HTTP, fuera de
  localhost, no hay `crypto.subtle` y la portada no carga precios), lo que la
  emulación no reproduce —destello, `:active`, selección al mantener pulsado—; y
  después, en producción.
- Carreras, ciclos, actualización de la PWA desde G4 con reapertura sin red,
  desarrollo con Strict Mode y la sonda de cuatro vistas, como en G4.
- En producción: cuatro vistas, temas, rutas, actualización desde G4 y reapertura
  sin red. Rollback: el deployment de G4.

## 9. Evidencia y presupuesto de regresión

Usar datos y reloj iguales para comparar comportamiento. Reutilizar las sondas
locales existentes cuando sirvan, adaptándolas al contrato visible; no conservar
selectores muertos para hacerlas pasar. Fixtures y evidencia no contienen datos
privados en Git. Cada prueba que simule ausencia usa una raíz temporal propia.

En G1 guardar una línea base breve en la entrega por chat: capturas comparables,
JS/CSS transferidos comprimidos, tamaño total de precache, solicitudes de datos
y tiempo hasta controles utilizables/resultados con red y CPU emuladas iguales.
Comparar builds de producción, no HMR, y excluir CSV/bundles de datos y beacon
del presupuesto JS/CSS. Mantener esa evidencia en `.local-cache/`.

El incremento conjunto de JS/CSS inicial de G4 respecto de G1 tiene un máximo
de **100 KiB gzip**; incluye React. G1 no debe aumentar más de **10 KiB gzip**
respecto de la base sin compilar. Son límites de este encargo, no metas que
haya que consumir. No meter gráficos, icon packs o bibliotecas de estado para
llenarlos, ni esconder peso mediante carga diferida que rompa offline.

Comparar varias ejecuciones antes de atribuir una diferencia a la migración.
Un empeoramiento reproducible superior a **20 % y 200 ms** en el tiempo hasta
controles utilizables o resultados, con iguales datos y condiciones, requiere
corrección o decisión explícita del Líder antes de GO. El reporte declara el
entorno y la limitación: una medición emulada no representa todos los celulares.

Verificación proporcional:

| Gate | Riesgo principal y evidencia necesaria |
| --- | --- |
| G1 | Build determinista, datos intactos, referencias completas, CI en las rutas publicadoras y transición/rollback de PWA. |
| G2 | Resultado y accesibilidad de tarjetas equivalentes, propiedad del DOM y coste de React. |
| G3 | Estado, efectos, carreras, navegación, foco, vigencia e histórico. |
| G4 | Cascada, temas, compatibilidad, contraste y peso final. |
| G5 | Movimiento y su versión reducida, primer cuadro del tema, contraste, objetivos táctiles, Safari real y peso. |

Ejecutar pruebas existentes afectadas, `npm run audit`, `npm run verify:web`
sobre el árbol coherente construido y contraste cuando cambie CSS. Añadir
pruebas puntuales que detecten riesgos nuevos; no una cuota de casos, porcentaje
de cobertura ni snapshots de toda la implementación. Al cerrar G4, ejecutar
las comprobaciones existentes completas para detectar dependencias rotas.

Los fallos previos se identifican con evidencia; no se convierten en una
excepción permanente. No hace falta repetir pruebas profundas del pipeline
de precios en cada gate si no cambió; sí verificar que sus contratos y comandos
siguen utilizables sin cargar React.

## 10. Puerta de salida, release y recuperación

1. **Builder:** plan breve del gate por chat, archivos/hunks y riesgo principal;
   implementar solo ese gate. Entregar qué cambió, evidencia, límites, alcance
   exacto y destino de rollback. No crear un plan o informe aparte del SPEC.
2. **Líder:** auditoría con sondas económicas acotadas; GO/FIX/KILL. Con FIX se
   corrige y revisa lo afectado, sin reiniciar los cuatro gates.
3. **Bruno:** con GO, autoriza una vez commit, push y deploy de ese alcance.
4. **Ejecutor:** confirmar diff auditado, publicar con credenciales existentes,
   esperar deploy real y comparar el artefacto servido con el verificado.
   Una corrida verde que decide no publicar no cierra un gate de interfaz.
5. **Cierre:** comprobar ruta nueva de compilación, cuatro vistas, PWA anterior
   y nueva, caché y recuperación. Registrar commit/deployment y resultado en
   este SPEC o en la entrega por chat. Solo entonces iniciar el siguiente gate.

El primer gate prepara un perfil con la versión publicada antes del despliegue;
los demás reutilizan la técnica con su gate previo. No depender de borrar el
almacenamiento, desinstalar la PWA o pedir a todas las personas hard reload.
Los crones de datos siguen automáticos y conservan preflight, poda y aislamiento
por grupo. No pausarlos para facilitar una comparación.

Destino normal de rollback: deployment verificado del gate anterior; para G1,
la entrega previa a esta migración. Distinguir rollback completo de Pages, que
tiene los datos de aquella entrega, de reconstruir UI anterior con datos
actuales compatibles. Identificar sus consecuencias antes de ejecutarlo; no
relajar el preflight ni las protecciones de datos para forzarlo. Un rollback
real requiere la autorización aplicable; ensayarlo en local no publica nada.

Actualizar el mapa solo respecto de lo revisado. No sellar ni integrar cambios
ajenos por comodidad. Al cerrar G5, el SPEC termina cuando React/Tailwind son
la implementación mantenida, los cinco deploys están comprobados y no quedan
puentes temporales, doble estado o pasos manuales de versión del shell.

## 11. Referencias técnicas

Consultadas al redactar; no sustituyen los contratos específicos anteriores:

- [React: incorporación a un proyecto existente](https://react.dev/learn/add-react-to-an-existing-project).
- [React: efectos y limpieza en Strict Mode](https://react.dev/reference/react/StrictMode).
- [Vite: build, rutas de assets y errores de chunks tras deploy](https://vite.dev/guide/build.html).
- [Vite: manifiesto de archivos emitidos](https://vite.dev/guide/backend-integration).
- [Tailwind: integración con Vite](https://tailwindcss.com/docs/installation/using-vite),
  [detección de clases](https://tailwindcss.com/docs/detecting-classes-in-source-files),
  [Preflight](https://tailwindcss.com/docs/preflight) y
  [compatibilidad de navegador](https://tailwindcss.com/docs/compatibility).
- [Emil Kowalski: skills de diseño e interfaz](https://github.com/emilkowalski/skills)
  (`e8a175d`, 02/10/2026): `animate`, `emil-design-eng`, `mobile-native`,
  `apple-design` y `review-animations`, base de los valores de G5.
