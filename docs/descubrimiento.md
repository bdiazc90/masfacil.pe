# Producto público observado

Observación sin autenticación realizada el **14 de agosto de 2026** sobre `facilito.gob.pe`. Describe el producto visto, no define nuestra solución ni demuestra qué fuente alimenta cada pantalla.

Proyecto independiente y no oficial. No se eludió reCAPTCHA, no se conservaron tokens/cookies y no se hizo crawling.

## Qué intenta resolver

Facilito permite comparar vendedores y precios de combustibles dentro de una geografía administrativa. Sus entradas principales son Diesel/Gasolinas, GNV, GLP Automotor y cuatro tipos de venta de GLP Envasado.

La experiencia pide departamento/provincia y, según el journey, producto o tamaño. Devuelve tablas con establecimiento, dirección, teléfono y precio; GLP puede añadir marca de producto/envasadora. No parte de la ubicación actual, no muestra distancia y no permite ordenar las tablas desde sus encabezados.

## Journeys reproducidos en Lima

Los conteos corresponden solo a Lima → provincia Lima; no representan cobertura nacional.

| ID | Journey | Acciones / inputs | Filas públicas | Frescura visible |
| --- | --- | ---: | ---: | --- |
| J1 | Diesel y Gasolinas · Gasohol Regular | 4 / 3 | 726 | no |
| J2 | GNV | 3 / 2 | 272 | no |
| J3 | GLP Automotor | 3 / 2 | 432 | no |
| J4 | GLP Envasado · Locales de Venta · 10 kg | 3 / 2 | 553 | no |
| J5 | GLP Envasado · Estaciones · 10 kg | 3 / 2 | 172 | no |
| J6 | GLP Envasado · Plantas · 10 kg | 3 / 2 | 42 | no |
| J7 | GLP Envasado · Distribuidores · 10 kg | 4 / 3 | 444 | fecha por fila |

Los siete journeys entregaron ofertas reales. La primera página apareció ordenada por precio, pero el usuario solo dispone de búsqueda textual y paginación 10/20/50.

## Hallazgos materiales

### Frescura

J1–J6 muestran precio sin fecha. En J7, sobre 444 filas:

- mediana: 387 días;
- 224/444 (50.5 %) superaban un año;
- 85 filas eran duplicados excedentes;
- existían ceros y extremos que no pueden calificarse sin semántica oficial.

El snapshot agregado se recalcula con `node scripts/analyze-j7-snapshot.mjs`.

### Mobile y accesibilidad

Debajo de 992 px el mapa territorial cambia a un `select`. Los controles no son equivalentes:

- desktop: 24 áreas y Callao ausente;
- mobile: 25 territorios, incluido Callao;
- el mapa transformado pierde nombres accesibles y el select observado carece de etiqueta accesible;
- la tabla puede requerir scroll horizontal interno en viewport estrecho.

### Ubicación y decisión

No se observó geolocalización, distancia, ruta ni comparación fijada entre alternativas. La persona navega por límites administrativos aunque una estación conveniente pueda estar en un distrito vecino.

### Errores

Un POST con token vacío produjo un 302 silencioso a la entrada en J1 y J7. Los timeouts del navegador también ocurrieron en GET sin token; no se atribuyen a reCAPTCHA ni a una caída general. HTTP directo respondió normalmente en muestras breves.

## Frontera técnica observada

Cada cambio material de filtro navegó a otro documento HTML. No se observó XHR/fetch de precios: el resultset completo llega en la respuesta y DataTables pagina en cliente. Los handlers `.do`, sentinels y códigos observados son implementación pública, no API estable ni fuente canónica.

Implicaciones:

- una consulta puede transportar centenares de filas;
- automatizar los handlers sería frágil;
- etiquetas y direcciones no deben tratarse como identificadores;
- la fuente, semántica y frescura deben resolverse fuera de la UI.

## Reproducción mínima

1. Abrir la [portada de Facilito](https://www.facilito.gob.pe/facilito/pages/facilito/menuPrecios.jsp).
2. Recorrer las siete entradas visibles con Lima/provincia Lima; en J1 elegir Gasohol Regular y en J7 cilindro de 10 kg.
3. Registrar filtros, columnas, conteo DataTables, orden y fechas visibles sin conservar identidad ni sesión.
4. Repetir con viewport menor a 992 px y comparar mapa/select y overflow.
5. Separar observaciones de navegador y HTTP directo.

Las fuentes y relaciones posteriores viven en [datos.md](datos.md); la decisión de factibilidad, en [factibilidad.md](factibilidad.md).
