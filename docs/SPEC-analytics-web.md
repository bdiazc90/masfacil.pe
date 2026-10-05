# Analytics web: reparar el beacon y leer visitas medidas

**Estado:** cerrado. Implementado en `d40b42b` (23/09/2026): Web Analytics carga
y envía.

Decisión de Bruno del 23 de septiembre de 2026: usar **Cloudflare Web Analytics**, sin proveedor de pago. Este SPEC
cubre la reparación y la configuración de lectura en Cloudflare. No autoriza
commit, push, deploy ni cambios de credenciales. Leer `AGENTS.md` y `CLAUDE.md`.

## 1. Resultado

Bruno puede abrir Cloudflare Web Analytics para `masfacil.pe` y consultar visitas,
páginas, países y fuentes **medidos por el navegador**, con el filtro `Exclude
Bots` activado cuando corresponda. El panel HTTP de Cloudflare queda identificado
como tráfico de red: sus solicitudes, países y «Unique Visitors» no se presentan
como personas que usaron la PWA.

«Visita medida» significa lo que Cloudflare Web Analytics define como visita
recibida por su beacon. No significa persona única ni censo exacto: bloqueadores,
fallos de red y el filtro de bots pueden omitir visitas; un bot que ejecute
JavaScript puede sobrevivir al filtro. Los datos anteriores a la reparación no
se reconstruyen. En rangos largos Cloudflare puede agregar o muestrear datos;
no prometer conteos exactos por día o país.

## 2. Hecho comprobado y alcance

Bruno comprobó en Chrome incógnito, sobre la página servida en producción:

- Cloudflare Pages inyecta **una** etiqueta para
  `https://static.cloudflareinsights.com/beacon.min.js`.
- La respuesta lleva `script-src 'self'`; DevTools muestra
  `beacon.min.js (blocked:csp)` y el error de esa directiva.
- No sale una petición a `/cdn-cgi/rum` porque el script no se ejecuta.

La causa está en `web/_headers`. La app no contiene una instalación manual del
beacon.

**Corrección del Builder (23/09/2026), pendiente de validar por el Líder:** el
`connect-src 'self'` no basta. La etiqueta que inyecta Pages solo declara el
token (`data-cf-beacon='{"token": …}'`), y el beacon publicado, sin `send.to` ni
`version`, envía a `https://cloudflareinsights.com/cdn-cgi/rum`, no al
`/cdn-cgi/rum` del propio dominio (eso lo hace la inyección de zonas proxied, que
declara `version`). Con `script-src` arreglado, el script carga y el envío queda
bloqueado por `connect-src`: comprobado con el beacon real bajo la CSP nueva. Es
la petición realmente bloqueada del punto 3 del §3.

Este cambio no toca adquisición de precios, rutas, identidad,
histórico, datos privados ni el cron. No incorpora GA4, Plausible, un backend,
cookies, eventos personalizados ni otra etiqueta de analytics. Cloudflare Web
Analytics no admite eventos personalizados; las interacciones dentro de una
misma ruta no se deben describir como conversiones medidas.

`docs/SPEC-combustibles.md` está en implementación paralela. Preservar sus cambios
sin incorporarlos por comodidad. Si sus rutas nuevas ya están activas al hacer
la comprobación final, verificar también una navegación entre vistas; no
modificar sus reglas de navegación en este encargo.

## 3. Implementación mínima

1. En `web/_headers`, conservar la CSP actual y añadir **solo**
   `https://static.cloudflareinsights.com/beacon.min.js` a `script-src`, junto a
   `'self'`. No abrir `script-src` con `*` ni `unsafe-inline`.
2. Mantener la inyección automática de Cloudflare Pages. No añadir un segundo
   `<script>` en `web/index.html`, ni guardar el token del sitio en otro archivo.
3. Mantener `connect-src 'self'` y el destino Neon ya autorizado, y añadir solo
   la ruta exacta `https://cloudflareinsights.com/cdn-cgi/rum` (ver la corrección
   del §2). Cualquier otra ampliación se justifica con una petición realmente
   bloqueada.
4. Conservar el verificador del shell: el bloque de Pages Analytics que inyecta
   Cloudflare se descuenta al comparar el HTML público con el árbol local; no
   se ignoran otras diferencias.
5. Incluir `web/_headers` en la huella del shell (`pipeline/shell-manifest.mjs`).
   El service worker guarda la portada con su CSP y la sirve así: sin esto, un
   cambio solo de `_headers` no reinstala el service worker y quien ya tiene la
   app instalada sigue con `script-src 'self'` y el beacon bloqueado.
6. `npm run verify:web` exige que `script-src` sea exactamente `'self'` más el
   beacon, y `connect-src` exactamente `'self'`, Neon y el endpoint del beacon,
   sin comodines ni `unsafe-inline`. La regla 10 de `DESIGN.md` declara Web
   Analytics como segunda excepción de red de terceros.
7. En «Sobre los datos», junto a la línea de ubicación: «Contamos visitas de
   forma anónima y sin cookies, para mejorar la app.» Web Analytics no usa
   cookies; no escribir «usamos cookies».
8. **Añadido por el Builder, pendiente de validar por el Líder.** En
   `web/sw.js`, la precache pide cada archivo con `cache: 'reload'`. La zona
   sirve JS, CSS e imágenes con `max-age=14400` (medido el 23/09/2026; el
   `no-cache` de `/sw.js` en `_headers` también llega como `max-age=14400`), y
   `cache.addAll` consulta la caché HTTP: en emulación, una actualización dentro
   de esas 4 h guardó el `app.js` anterior en el shell nuevo. El cambio también
   modifica los bytes de `sw.js`, y eso es lo que permite que esta entrega llegue
   a las instalaciones existentes (ver el riesgo abierto del §5).

## 4. Lectura y dashboard en Cloudflare

Después de comprobar que el beacon envía datos, usar **Web Analytics** como
fuente principal. Seleccionar el sitio correcto y un periodo posterior al
arreglo. Aplicar `Exclude Bots = Yes`; revisar el desglose por host y dejar
fuera previsualizaciones o pruebas si aparecen. Conservar la vista global por
país y una vista de Perú; no excluir países enteros para hacer parecer normal
el tráfico. Registrar en lenguaje simple qué filtros y periodo se usaron al
compartir una cifra.

Configurar un Custom Dashboard solo si, en la cuenta de Bruno, el editor
ofrece un dataset de **Web Analytics/RUM**, permite aplicar filtros equivalentes
y muestra magnitudes compatibles con Web Analytics para el mismo periodo y host.
Documentar cualquier diferencia de muestreo o definición antes de usarlo como
panel principal.

No llamar «visitas humanas» a un gráfico basado en `HTTP requests` o
`Unique Visitors` de la zona. Si el dataset RUM o el filtro de bots no están
disponibles en Custom Dashboards, usar el panel nativo de Web Analytics para
visitas. Un dashboard personalizado de HTTP Traffic puede servir aparte para
diagnosticar bots, 4xx, rutas y países, rotulado como **solicitudes HTTP**.

No crear tokens de API ni una exportación GraphQL solo para personalizar la
vista. Si la interfaz disponible exige credenciales nuevas o un plan de pago,
detener esa parte y conservar Web Analytics nativo como resultado útil.

## 5. Comprobación y criterio de aceptación

- Revisar el diff y ejecutar `npm run audit` y `npm run verify:web` sobre el
  árbol integrado, sin modificar ni incluir cambios ajenos al SPEC.
- Antes de publicar, comprobar la sintaxis de la CSP y que los scripts propios
  siguen funcionando. La inyección de Pages y el envío real se comprueban en
  producción después del deploy; la lectura de `_headers` no los acredita.
- Tras el deploy autorizado por Bruno, repetir en Chrome incógnito la sonda:
  encabezado CSP con el origen permitido; una sola etiqueta inyectada;
  `beacon.min.js` cargado, sin `blocked:csp`; al cargar o salir de la página,
  `POST /cdn-cgi/rum` aceptado y sin error de CSP. Verificar también el host
  canónico y una ruta activa cargada directamente.
- Con una instalación anterior de la PWA, comprobar que la actualización del
  service worker entrega la CSP nueva y el beacon ya no queda bloqueado.
- Comprobar si abrir el historial (cambio de URL sin recarga) produce un
  segundo `POST /cdn-cgi/rum`. Si no, las páginas vistas solo reflejan entradas
  directas; decidir en la Fase 2 si hace falta medir el cambio de vista.
- Confirmar que Web Analytics recibe una visita de comprobación en un periodo
  posterior al deploy. Si tarda en aparecer, no inventar datos: conservar la
  evidencia de red y repetir la consulta más tarde. No comparar numéricamente
  ese panel con HTTP Traffic para exigir igualdad.
- Entregar a Bruno la ubicación del panel y los filtros elegidos. Si se creó
  un Custom Dashboard válido, entregar su nombre y explicar su dataset; si no,
  dejar explícito que el panel nativo es la fuente principal.

**Riesgo abierto, fuera de este encargo:** Chrome 153 no actualiza un service
worker de módulos cuando `sw.js` no cambia y solo cambia un import, si un módulo
se alcanza directamente y a través de una cadena de imports. Es nuestro caso:
`lib/catalog.js` lo importan `sw.js` y
`group-contracts.js → gasolina-contract.js → lib/bundle-contract.js`. El
registro falla con «ServiceWorker cannot be started» y la instalación sigue en
el shell anterior. Reproducido con un caso mínimo ajeno al proyecto y con
`be9d5ee` más un byte en `styles.css`. Hoy el mecanismo de actualización es
justamente importar `shell-manifest.js`. Esta entrega cambia `sw.js` (punto 8);
cualquier deploy posterior que no lo cambie no llegará a las instalaciones
existentes en Chrome. Resolverlo antes de la Fase 2. **Arreglo implementado
como entrega aparte (GO del Líder, 23/09/2026), pendiente de deploy:** `/sw.js`
se genera con la versión del shell e importa la lógica (`web/sw-main.js`), y la
huella cubre todo el grafo del worker.

El arreglo se considera incompleto si el script carga pero no hay un envío
aceptado, si se crean dos beacons o si el dashboard de «visitas» usa solicitudes
HTTP. Un problema de la configuración de Custom Dashboards no bloquea la
reparación del beacon ni la lectura en Web Analytics nativo.

## 6. Referencias de comportamiento

- [CSP necesaria para el beacon automático y destino `/cdn-cgi/rum`](https://developers.cloudflare.com/web-analytics/faq/).
- [Filtros de Web Analytics y desglose por país](https://developers.cloudflare.com/web-analytics/configuration-options/filters/).
- [Dimensión `Exclude Bots`](https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/).
- [Métricas de visitas y páginas](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/).
- [Custom Dashboards y datasets disponibles](https://developers.cloudflare.com/analytics/custom-dashboards/).
