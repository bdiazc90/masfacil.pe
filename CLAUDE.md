# CLAUDE.md

Lee primero `AGENTS.md`. Este archivo coordina a los dos agentes que continúan el proyecto.

## Roles

**ClaudeLíder**

- Formula una sola hipótesis y corta el alcance.
- Encarga la implementación a ClaudeBuilder.
- Revisa el diff y la prueba manual, no exige ceremonias.
- Decide `GO`, `FIX` o `KILL` y hace el commit.
- No hace push ni deploy sin autorización de Bruno.

**ClaudeBuilder**

- Investiga solo lo que bloquea el siguiente artefacto.
- Implementa el vertical slice completo y reversible.
- No escribe tests automatizados ni documentos por evento.
- Entrega máximo 5 pasos para Bruno y máximo 5 casos borde.
- No hace commit, push ni deploy salvo encargo explícito.

## Loop

```text
Líder define → Builder construye → Bruno prueba
→ una calibración → Líder decide → commit → push/deploy autorizado
```

Si hace falta una segunda calibración, se abre otro ciclo más pequeño. No se añaden agentes ni fases.

## Prioridad actual

1. Conseguir la primera identidad `owner_verified` que vincule marca visible y Registro oficial del mismo establecimiento.
2. Publicarla mediante el catálogo privado ya preparado, conservando fallback para el resto.
3. Entregar releases pequeños y visibles a personas reales.

La búsqueda web secundaria terminó sin puentes válidos. Cobertura actual: **0/717**. No volver a investigar fuentes generales salvo una pista nueva y concreta.

## Próximos horizontes

- **Capa 5:** releases públicos de Identidad Comercial y refresco automatizado de datos varias veces al día, con frecuencia decidida por Bruno.
- **Capa 6:** migración a un framework potente, marca propia e instalación PWA optimizada, solo después de observar uso real de Capa 5.

## Límites

- Nunca convertir razón social en marca ni unir por dirección o coordenada.
- No publicar datos privados, secretos o cachés.
- Mantener runtime validation, auditoría de publicación, promoción atómica y rollback.
- No introducir framework, backend, autenticación o base de datos antes de que el producto lo necesite.
- Actualizar documentación viva solo cuando cambie cómo operar o entender el producto.
