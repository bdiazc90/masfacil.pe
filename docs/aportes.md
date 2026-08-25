# Aportes de quien usa la app

Diseño acordado con Bruno el 24 de agosto de 2026. **Todavía no implementado.**

## Por qué existe

La identidad comercial se publica con una precisión medida, no certificada:
54 revisiones del owner sin un solo error dan una cota inferior de 89 % en
`verified` y 86 % en `nearby`. Publicar con esa incertidumbre solo es honesto si
el error tiene por dónde aflorar.

La auditoría manual no escala: 54 casos costaron una tarde y el universo son 717.
Quien está parado frente al grifo tiene mejor evidencia que cualquier heurística
y la aporta en un segundo.

También cierra tres huecos que hoy no tienen ninguna señal propia:

- **cierres y cambios de marca** entre barridos semestrales (`docs/datos.md`);
- **los 171 marcados «por confirmar»**, que son una pregunta disfrazada de dato;
- **los 411 sin marca**, donde el letrero de la calle es la única fuente fiable.

Y resuelve un techo operativo: el catálogo viaja hoy en un secret de GitHub que
usa 43.5 de 48 KB. No aguanta crecer.

## Infraestructura

Cloudflare Pages Functions + D1, el mismo proveedor que ya sirve la PWA.

```
tarjeta  ──POST──>  /api/reporte   (Pages Function, mismo dominio)
                          │
                          v
                    D1 (SQLite gestionado)
                          │
              npm run reportes:pull
                          v
                cola de revisión del owner
                          │
                   npm run build:catalog
                          v
                secret  ──>  proyección  ──>  deploy
```

Mismo dominio, así que no hay CORS ni preflight. El plan gratuito da 100k
lecturas y 1k escrituras diarias, muy por encima de lo previsible.

## Qué se puede reportar

Cinco tipos, desde la propia tarjeta:

| tipo | pregunta | dato |
| --- | --- | --- |
| `nombre_confirma` | ¿este grifo se llama así? | sí / no |
| `nombre_corrige` | ¿cómo se llama? | texto |
| `marca` | ¿qué marca tiene el letrero? | Primax, Repsol, Pecsa, AVA, otra |
| `cerrado` | ¿sigue operando? | sí / no |
| `precio` | ¿el precio es otro? | número |

## Qué puede y qué nunca puede cambiar cada tipo

Esta tabla es el contrato del sistema, no una guía:

| tipo | puede | **nunca puede** |
| --- | --- | --- |
| `nombre_confirma` | ascender `nearby` → `verified` | inventar un nombre |
| `nombre_corrige` | cambiar `public_site_name` | publicarse sin revisión del owner |
| `marca` | fijar `brand` | contradecir la razón social sin revisión |
| `cerrado` | ocultar la tarjeta | borrar el establecimiento del Registro |
| `precio` | **marcar el precio como disputado** | **reemplazar el precio oficial** |

La última fila merece énfasis. El precio viene de Osinergmin y es el único dato
del producto con fuente oficial verificable. Un reporte de precio **no lo
sustituye**: solo puede señalar que ese precio parece viejo, lo que es una señal
de frescura, no de valor. Aceptar precios de terceros abriría la puerta a que un
grifo publique el suyo, y eso destruiría la única garantía dura que tiene la app.

## Contra el abuso, sin cuentas

Anónimo: no hay login, ni correo, ni dato personal almacenado.

Para deduplicar sin identificar se guarda `cliente_hash`, el SHA-256 de
`IP + User-Agent + sal del día`. La sal rota cada día, así que el hash **no sirve
para seguir a nadie entre días** y no se puede revertir a una IP. Solo responde a
una pregunta: «¿este reporte viene de quien ya reportó hoy?».

Umbral de coincidencia: un reporte aislado se guarda pero no cambia nada.
Cuando **tres `cliente_hash` distintos coinciden**, la propuesta entra en la cola
de revisión del owner. Nada se publica sin su aprobación.

```
1 reporte    → se guarda, no cambia nada
3 coinciden  → cola de revisión
owner aprueba → entra al catálogo como known_contributor
```

`known_contributor` ya existe en el contrato del catálogo desde el principio,
con `acquisition_method: contributor_submission`. No hay que inventar una
procedencia nueva.

## Esquema

```sql
CREATE TABLE reportes (
  id               TEXT PRIMARY KEY,   -- uuid v4 generado en el Worker
  establishment_id TEXT NOT NULL,      -- est_[a-f0-9]{24}, validado contra el bundle
  tipo             TEXT NOT NULL,      -- nombre_confirma | nombre_corrige | marca | cerrado | precio
  valor            TEXT,               -- propuesta; null en confirma y cerrado
  confianza_vista  TEXT,               -- qué decía la tarjeta cuando reportaron
  revision_vista   TEXT NOT NULL,      -- revision_id del bundle: detecta reportes sobre datos viejos
  cliente_hash     TEXT NOT NULL,      -- SHA-256(IP + UA + sal del día)
  creado_en        TEXT NOT NULL
);

CREATE INDEX reportes_por_establecimiento ON reportes (establishment_id, tipo);
CREATE UNIQUE INDEX reportes_sin_duplicar ON reportes (establishment_id, tipo, cliente_hash, creado_en);
```

`revision_vista` importa: un reporte sobre un bundle de hace tres semanas dice
menos que uno sobre el de hoy, y sin ese campo no habría cómo distinguirlos.

## Validación en el Worker

Antes de escribir nada:

- `establishment_id` debe existir en el bundle público vigente —si no, se
  rechaza: nadie puede crear establecimientos;
- `tipo` dentro del catálogo cerrado;
- `valor` acotado: 60 caracteres para nombre, marca dentro de una lista, precio
  entre 1 y 100;
- límite por `cliente_hash`: 20 reportes al día;
- sin `valor` para `nombre_confirma` y `cerrado`.

## Lo que no se construye todavía

- cuentas, perfiles ni reputación de quien reporta;
- publicación automática sin revisión del owner;
- reportes de horario, servicios o stock: el producto no los afirma y no va a
  empezar por esta vía.

## Efecto colateral que conviene aprovechar

Una vez exista D1, el catálogo puede vivir ahí en vez de en un secret de 48 KB.
Eso quita el techo que hoy impide sumar los 169 establecimientos restantes y un
expediente más rico. No es la motivación del cambio, pero sí su mejor consecuencia.
