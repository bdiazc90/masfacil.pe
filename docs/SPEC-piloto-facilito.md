# Piloto local: precios de Facilito

**Estado:** cerrado. El piloto dio paso a `docs/SPEC-precios-facilito.md`, en
producción desde `6ba60de` (20/09/2026).

Fecha: 10 de septiembre de 2026. Alcance: investigar, ejecutar una muestra real
y decidir si merece una siguiente prueba. **No sustituye la fuente de producción.**

## Pregunta que queremos responder

¿Podemos consultar automáticamente pocos grifos en Facilito, recuperar sus
precios sin alterar los controles del sitio y vincularlos inequívocamente con
nuestro Registro para medir la diferencia frente al CSV?

El owner ya comprobó que Facilito puede mostrar datos más recientes. Esta prueba
busca verificar nuestro acceso reproducible y la calidad del dato extraído,
no volver a discutir esa observación ni diseñar todavía una migración.

## Hechos relevantes del discovery

- La [consulta web oficial](https://www.facilito.gob.pe/facilito/pages/facilito/buscadorEESS.jsp)
  sigue disponible. Hay selectores de departamento, provincia, distrito y producto.
- El navegador observó formularios POST a
  `/facilito/actions/PreciosCombustibleAutomotorAction.do`, no una API JSON de precios.
  Cada cambio de filtro puede navegar y reemplazar el documento completo.
- **Mejor que paginar:** la tabla usa DataTables y carga las filas del distrito
  en el navegador. Su API documentada permite leer los nodos DOM de todas las
  páginas; la sonda comprobó `serverSide: false` y que los nodos coinciden con el
  total anunciado. No son peticiones a una API privada ni consultas adicionales.
- Códigos observados: Lima departamento `150000`, Lima provincia `150100`,
  San Luis `150134`, Ate `150103`, Gasohol Regular `126`, Gasohol Premium `127`.
- El sitio carga reCAPTCHA v3 y genera su respuesta con su propio JavaScript.
  Eso **no demuestra por sí solo** que un navegador automatizado sea rechazado.
- La cabecera de la tabla dice distrito, establecimiento, dirección, teléfono y
  precio en soles por galón. No anuncia fecha de reporte ni número de Registro.
  Las 127 filas capturadas no ofrecieron fecha de reporte ni enlaces con Registro.
  Esto no demuestra que esos campos sean imposibles de conseguir por otra vía.
- La exploración inicial obtuvo respuestas de filtros en aproximadamente
  0,2–0,3 segundos. Una consulta de producto volvió al buscador; otra acabó en
  `ERR_TIMED_OUT`. Después hubo corridas completas sin resolver desafíos. No hay
  evidencia suficiente para atribuir los fallos iniciales a reCAPTCHA.
- Un HEAD al CSV oficial devolvió HTTP 403 desde este entorno. Por tanto, esta
  sesión no verificó su sello actual ni su frecuencia de publicación. La cadencia
  semanal documentada en agosto no prueba una cadencia fija en septiembre.
- Nuestro `establishment_id` sale del Registro, no del nombre del grifo.
  El seed reducido ya no conserva `CODIGO_OSINERGMIN`: si Facilito solo entrega
  ese código, hará falta un puente oficial exacto; no se igualan namespaces.

## Hipótesis y prueba mínima

1. **Navegación:** un navegador normal, esperando la carga de cada formulario,
   puede obtener la tabla. Probar con sesión aislada, sin perfiles personales,
   proxies, stealth, servicios de resolución ni reutilización de tokens.
2. **Extracción, confirmada en Ate:** leer todos los TR ya cargados mediante
   DataTables permite superar las 50 filas visibles sin OCR ni fichas individuales.
   Exigir coincidencia con el total anunciado; no confundir 50 filas con el total.
3. **Utilidad:** algunos precios difieren de nuestra base CSV. Solo comparar
   pares con establecimiento y producto confirmados; una diferencia por sí sola
   no prueba cuál fue reportado después.

## Piloto ejecutable

Entrada: `scripts/pilots/facilito.mjs`. Node y `agent-browser` instalado; no añade
dependencias al producto ni modifica `package.json`.

```bash
node scripts/pilots/facilito.mjs --help
node scripts/pilots/facilito.mjs --self-test
node scripts/pilots/facilito.mjs --district SAN_LUIS
# Segunda muestra, solo si la primera obtuvo resultados válidos:
node scripts/pilots/facilito.mjs --district ATE
node scripts/pilots/compare-facilito.mjs --self-test
node scripts/pilots/compare-facilito.mjs .local-cache/facilito-pilot/<corrida>/capture.json
```

- Primera muestra: un distrito, Regular y Premium. Ate sirve como segunda muestra
  para comprobar que no funciona únicamente en una tabla pequeña.
- Una sesión aislada, consultas secuenciales y límites de tiempo, páginas y filas.
  Sin barrido de Lima, sin cron ni workflow nuevo en esta fase.
- Esperar el formulario correcto y su carga; dejar que el sitio realice su propia
  validación. No copiar tokens al cliente HTTP ni llamar directamente al evaluador.
- Ante bloqueo explícito, desafío, rate limit o estructura desconocida: parar y
  registrar el motivo. Un timeout es un fallo de consulta, no prueba de bloqueo.
- La captura queda únicamente en `.local-cache/facilito-pilot/`, ignorada por Git,
  con permisos privados. El chat y el resumen muestran conteos, no RUC, nombres,
  direcciones, teléfonos, cookies ni respuestas de reCAPTCHA.
- `observed_at` significa cuándo leímos la pantalla. `reported_at` permanece
  `null` salvo que el sitio proporcione una fecha explícita y verificable.
- No se escribe en `web/data/`, catálogo, histórico R2 ni pipeline de publicación.
  No cambia ningún precio que vea un usuario.

## Comparación diagnóstica implementada

1. Identificar si la tabla o sus enlaces proporcionan Registro o código oficial.
2. Mientras no haya clave oficial en Facilito, obtener **candidatos**, no vínculos
   publicables, mediante razón social + dirección + distrito idénticos al volcado
   privado del CSV. Solo se normalizan mayúsculas, tildes y espacios: nada de
   cercanía, fuzzy matching o abreviaturas. Se exige unicidad en ambos lados y que
   el ID del volcado realmente derive de su Registro. Las ambigüedades quedan fuera.
3. Comparar los candidatos por producto, misma unidad. Guardar valor
   Facilito, valor CSV, fecha de reporte CSV, fecha de observación Facilito y
   revisión/fecha de la base comparada. No presentar el bundle local antiguo como
   el CSV más reciente.
4. Separar diferencias frente a precios que nuestra UI muestra de diferencias
   frente a precios que conserva pero oculta por antigüedad. Se reutiliza la regla
   de frescura del cliente, con el reloj fijado al instante de la captura.
5. El comparador verifica manifest y hashes del bundle. Su resultado declara
   `publishable: false` y `freshness_proven: false`: muestra diferencias medibles,
   no inventa respaldo de identidad ni fecha de actualización de Facilito.

## Cierre del piloto

El resultado distingue tres cosas: acceso a la tabla, identidad exacta y evidencia
de mejora de precios. Conseguir solo la primera no equivale a estar listo para
publicar; fallar hoy tampoco demuestra que la web sea imposible de automatizar.

Como conseguimos filas útiles, la siguiente prueba propuesta es repetir las
mismas dos muestras una vez al día durante tres días, conservando sus resultados.
Esto es una propuesta, **no un cron activado**. La ejecución desde GitHub Actions,
respaldo CSV y publicación se deciden **después**, con esos resultados; un éxito
en el Mac no acredita funcionamiento desde las IP de GitHub ni fiabilidad diaria.

No se crean más documentos de planning o handoff: este SPEC reúne el discovery,
la prueba y su conclusión. El histórico se sigue implementando por separado.

## Resultado medido

**Viabilidad de extracción: confirmada localmente. Publicación de estos precios:
todavía no autorizada ni validada.**

| Muestra | Regular / Premium | Candidatos textuales únicos | Diferencias frente al bundle |
|---|---:|---:|---:|
| San Luis, 00:57 Lima | 6 / 6 | 12 | 2, ambas de un precio CSV vencido |
| Ate, 09:14 Lima | 60 / 55 | 109 | 15, todas frente a precios vigentes |
| Total | 127 precios | 121 | 17 |

- Cada corrida exitosa tardó aproximadamente 11 segundos. Son **dos muestras**,
  no un porcentaje acreditado de disponibilidad. Hubo fallos de red/formulario y
  se corrigieron dos problemas del scraper con los controles de paginación.
- En Ate se recuperaron 60 y 55 filas completas desde el DOM cargado por
  DataTables. Se contrastaron esos conteos con el total de la propia tabla.
- Base comparada: bundle local validado del **9 de septiembre**, revisión
  `gasolina-2026-09-09-20260909T125818618Z-2389-253647-b1617b9c25a8`, corte
  `2026-09-09T13:17:30.598Z`. No se verificó que fuera el último CSV disponible.
- Ejemplo de Ate: un candidato de Regular figura a **S/20,19** en esa base y
  **S/19,49** en Facilito. El dato CSV fue reportado el 8 de septiembre;
  Facilito no expone aquí su fecha original.
- En San Luis, las dos diferencias corresponden a un mismo candidato cuyo
  reporte CSV es del 31 de julio: nuestra app oculta esos precios por vencidos,
  pero Facilito muestra Regular a S/20,48 y Premium a S/21,58.
- Seis filas de Ate no coincidieron exactamente con el volcado privado; no se
  forzó su emparejamiento. No son seis establecimientos necesariamente: un grifo
  puede aparecer en ambos productos.
- Pasaron las autopruebas locales: encabezados, distrito equivocado, precio cero
  o ilegible, ausencia de fecha inferida, clave textual y CSV con campos citados.
  No se ejecutó una auditoría global del trabajo ajeno del histórico.

Evidencia privada, no subir ni compartir el HAR (puede contener tokens efímeros):

```text
.local-cache/facilito-pilot/20260910T055734Z-99070/{capture,report,comparison}.json
.local-cache/facilito-pilot/20260910T141356Z-3810/{capture,report,comparison}.json
```

**Hipótesis que sigue abierta:** el desfase del canal CSV explica esas diferencias
y el sondeo diario recuperaría parte de ellas antes. Para medirlo hay que repetir
la captura, conservar la base contemporánea y observar cuándo el CSV alcanza los
valores de Facilito. No hace falta diseñar todavía toda la integración.

Referencias del mecanismo de extracción:
[DataTables: rows().nodes()](https://datatables.net/reference/api/rows().nodes()) y
[page.info()](https://datatables.net/reference/api/page.info()).
