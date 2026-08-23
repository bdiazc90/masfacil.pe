# AGENTS.md

Contrato operativo corto. La prioridad es lanzar mejoras útiles, no producir ceremonia.

## Producto

PWA estática para decidir en segundos dónde cargar Gasohol Regular o Premium en Lima provincia, comparando precio reportado, cercanía y frescura.

Proyecto independiente. **No está afiliado, aprobado ni producido por Osinergmin, Facilito ni el Estado peruano.** Toda documentación se escribe en español neutro.

## Equipo

- **ClaudeLíder:** define una hipótesis, delimita el cambio, revisa el diff, emite `GO`, `FIX` o `KILL` y hace el commit.
- **ClaudeBuilder:** investiga lo mínimo, planifica, implementa y entrega el cambio funcionando con instrucciones de prueba.
- **Owner (Bruno):** prueba en celular, decide producto y autoriza publicación, credenciales, push y deploy.

El contrato compartido de los dos agentes vive en `CLAUDE.md`.

## Loop MVP

1. Una hipótesis falsable.
2. Discovery solo si bloquea; máximo 45 minutos y 3 subagentes.
3. Implementación sin tests automatizados.
4. Prueba del owner en máximo 5 pasos.
5. Máximo 5 casos borde manuales, elegidos por daño.
6. Una calibración.
7. Veredicto `GO`, `FIX` o `KILL`.
8. Con `GO`: commit; push y deploy solo con autorización del owner.

No hay gates de proceso, revisores adicionales, documentos por sesión ni suites de tests.

## Seguridad funcional

- Una razón social no es una marca. No inferir marca desde dirección, coordenada, proximidad o texto parecido.
- No inferir stock, horario, descuento ni disponibilidad.
- `establishment_id` deriva únicamente del Registro oficial.
- Sin identidad verificada se muestra el fallback neutral.
- Raws, seeds, cachés, credenciales, RUC, razón social, dirección y expedientes privados no entran en Git.
- Los contratos se validan al proyectar y en el navegador. Es runtime, no testing.
- Regular y Premium se promueven juntos; el manifest se escribe al final.
- `npm run audit` y rollback se conservan.
- Las ofertas de más de 30 días se ocultan antes de ordenar.

## Comandos

```bash
npm run serve
npm run project
npm run refresh
npm run publish
npm run rollback
npm run audit
npm run dump:establishments
```

## Mapa

```text
web/         PWA Vanilla ESM
pipeline/    proyección privada a bundle público
app/         contratos, validación de runtime y catálogo privado
scripts/     operación, publicación y rollback
fixtures/    dataset sintético para controles negativos
docs/        fuentes, decisiones y roadmap
```

Datos privados y generados, siempre fuera de Git:

```text
.local-cache/{raw,datasets,snapshots,identity,publish}/
web/data/
```
