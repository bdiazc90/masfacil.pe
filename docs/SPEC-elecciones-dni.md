**Estado:** obsoleto desde el 04/10/2026; sustituido por `docs/SPEC-elecciones.md`, que a su vez quedó deprecado el 05/10/2026. Se conserva como antecedente.

# /elecciones — MVP

04/10/2026 · Alcance definido. API interna ONPE identificada; integración pendiente.
Este documento sustituye el borrador anterior.

## Experiencia

1. **Dónde voto.** En `/elecciones`, ingresar únicamente el DNI —ocho dígitos—
   y pulsar `Consultar`. Mostrar el local y su dirección con datos de ONPE;
   incluir mesa si la respuesta la ofrece. Obtener de esa misma consulta el
   **ubigeo electoral de la persona** para el siguiente paso.
2. **Candidatos.** Tras una consulta válida, mostrar el botón
   `Quiénes son los candidatos`. Al pulsarlo, mostrar las candidaturas de ONPE
   que corresponden a ese ubigeo y sus cargos: nombre y organización política.
   Respetar los niveles regional, provincial y distrital que realmente aplican.
3. **Resultados.** En el inicio de `/elecciones`, mostrar el aviso solicitado:
   **«Desde las 6 p. m. podrás ver los resultados en vivo de ONPE»**,
   referido al 4 de octubre de 2026, hora de Perú (`America/Lima`). Su publicación
   requiere confirmar ese horario y el acceso oficial para estas ERM. Desde esa
   hora, ofrecer `Ver resultados en vivo` cuando ONPE los publique; mostrar su
   estado real si todavía no hay datos. Para este MVP basta abrir el servicio
   oficial. Retirar la promesa futura cuando pase la hora.
4. **Fuente única: ONPE.** Identificar y enlazar la fuente de cada consulta,
   con una aclaración breve de que masfacil.pe es independiente de ONPE.

## Viabilidad que debe comprobar el Builder primero

**Comprobado el 04/10:** [Consulta Electoral](https://consultaelectoral.onpe.gob.pe/inicio)
abre en navegador, identifica ERM del 4/10/2026 y pide solo DNI. Su
[JavaScript oficial, CLV 1.5.1](https://consultaelectoral.onpe.gob.pe/main-6HME2IEX.js)
define, sobre ese mismo dominio:

- `POST /v1/api/busqueda/dni`, cuerpo `{"numeroDocumento":"<DNI>"}`; el cliente
  espera `data.token` y lo usa como `Authorization: Bearer …`.
- `POST /v1/api/consulta/definitiva`, cuerpo `{}` y ese token. El cliente espera
  `localVotacion`, `direccion`, `mesaSufragio`, `orden` y `ubigeo` en `data`.

Es la API interna del sitio; no se encontró documentación pública para terceros.
No se consultó ningún DNI: falta comprobar una respuesta autorizada y si `ubigeo`
es código electoral o texto territorial. Las sondas HTTP a configuración y al
preflight desde `https://masfacil.pe` recibieron 403; la raíz recibió un desafío
AWS WAF. **No acreditan CORS ni integración directa**, aunque el formulario abre
en navegación normal. El cliente también contempla CAPTCHA de AWS.

Siguen pendientes la integración desde masfacil, las candidaturas de ONPE por
ubigeo y la confirmación oficial de las 18:00. Si hacen falta otra fuente, más
datos personales, servidor o credenciales, comunicar la incompatibilidad antes
de ampliar el alcance. Usar únicamente datos de estas ERM, sin mezclar primarias
o generales. El aviso de las 18:00 aún no es un horario oficial verificado.

## Implementación y aceptación mínimas

- Página propia sobre React/Vite y el resultado de G4; integrar rutas, build y
  PWA sin mezclar estado electoral con combustibles ni pisar trabajo en curso.
- DNI y respuesta personal solo en memoria: fuera de URL, almacenamiento,
  analytics, logs y caché del worker. Cambiar DNI borra el resultado y candidatos
  anteriores; descartar respuestas tardías de otra consulta.
- Mostrar carga, DNI inválido, consulta sin resultado, fallo de ONPE y falta de
  conexión. El paso 2 se habilita únicamente con ubigeo electoral válido.
- Comprobar ambos pasos, correspondencia territorial, aviso antes/después de
  las 18:00, rutas/404 y funcionamiento de Combustibles. Ejecutar build, audit y
  verify:web; revisar el mapa de arquitectura en el alcance afectado.
- Entregar evidencia breve y bloqueos reales por chat. Commit, push y deploy
  requieren autorización explícita de Bruno.
