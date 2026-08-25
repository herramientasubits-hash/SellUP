# SellUp — Protocolo Permanente de Desarrollo Paralelo e Integración

**Autoridad:** Instrucción permanente de la dueña del proyecto (registrada 2026-08-25)
**Alcance:** Todo trabajo realizado en este repositorio, por cualquier agente (Claude Code, Antigravity, OpenCode, u otro) o sesión humana.
**Precedencia:** Este protocolo tiene prioridad sobre hábitos anteriores de manejo de ramas, PRs, sincronización con `main` y migraciones. No sobrescribe ni reemplaza las reglas técnicas existentes de Agent1, Agent2A o BR-SOURCE (ver `AGENTS.md` y `docs/DESIGN_SYSTEM_FOUNDATION.md` para gobernanza de UI; ver memoria de proyecto para el estado técnico vigente de cada track) — se aplica **junto con** ellas.

---

## MODELO DE TRABAJO

SellUP tiene actualmente varias líneas que pueden desarrollarse simultáneamente:

1. AGENTE 1
2. AGENTE 2A
3. CATÁLOGO / FUENTES

Pueden existir varias sesiones Claude simultáneas, además de chats GPT que realizan coordinación y revisión.

La regla principal es:

**PARALLEL DEVELOPMENT, SERIAL INTEGRATION.**

## 1. AISLAMIENTO OBLIGATORIO

Cada tarea activa debe tener:

- una rama propia;
- un worktree propio;
- un único escritor activo.

Nunca dos sesiones deben escribir sobre el mismo worktree.
Nunca una sesión debe cambiar de branch en el worktree de otra.
Nunca reutilices cambios sin commit de otra sesión.
Nunca limpies, stashees, resetees o descartes modificaciones que no hayas creado tú.
Si detectas WIP ajeno, DETENTE y repórtalo.

## 2. ONE WRITER PER BRANCH

Una rama tiene un único escritor activo.
Si detectas que GPT, otro Claude u otro proceso está modificando la misma branch:
STOP.
No intentes coordinar escrituras simultáneas.
La otra implementación debe usar otra rama/worktree.

## 3. INICIO DE TODA TAREA

Antes de modificar código:

1. `git fetch origin`
2. obtener SHA actual de `origin/main`
3. comprobar worktree limpio
4. identificar branch actual
5. comprobar PR relacionados
6. crear rama nueva desde `origin/main` actual si es una tarea nueva
7. confirmar que no existe otra sesión escribiendo esa rama

Reportar al inicio:
`TASK =`
`TRACK = AGENT1 | AGENT2A | SOURCES`
`BASE_MAIN =`
`BRANCH =`
`WORKTREE =`
`TREE_CLEAN = YES/NO`

## 4. MAIN PUEDE AVANZAR DURANTE EL DESARROLLO

No actualices automáticamente la rama cada vez que `origin/main` avance.
Que una rama quede detrás durante desarrollo es normal.
No hagas ciclos repetidos de actualización únicamente para mantenerla artificialmente al día.
Sincroniza con `main` cuando:

- exista una dependencia técnica real que lo requiera; o
- el PR llegue a su turno de integración.

## 5. INTEGRACIÓN SECUENCIAL

Aunque existan varios PR listos, se integran uno por uno.
Cuando un PR llegue a su turno:

1. `git fetch origin`
2. registrar nuevo SHA de `origin/main`
3. integrar el `origin/main` actual en la rama
4. resolver conflictos conservando ambas intenciones cuando corresponda
5. revisar nuevamente el diff
6. ejecutar las validaciones requeridas
7. push del nuevo HEAD
8. esperar CI FINAL
9. reportar estado
10. esperar `MERGE APROBADO`

Mientras ese PR está haciendo su validación final de integración, no iniciar voluntariamente el proceso final de otro PR competidor.

## 6. NO REBASE / NO FORCE POR DEFECTO

Preferir merge normal de `origin/main` dentro de la rama.
No usar:

- `git push --force`
- `git push --force-with-lease`
- rebase destructivo
- reset de ramas compartidas
- modificación de historia publicada

sin autorización explícita.

## 7. MIGRACIONES

Las migraciones son un recurso GLOBAL.
Nunca asumas que el número pensado inicialmente sigue libre.
Antes de crear/finalizar una migración:

1. actualizar conocimiento de `origin/main`;
2. revisar la última migración oficial;
3. revisar PR paralelos con migraciones;
4. detectar colisiones.

Durante integración:
Sólo un PR con migración nueva debe atravesar la fase final de integración a la vez.
Si otro PR tomó el número:
renumerar de forma controlada y actualizar referencias/tests antes del merge.
Nunca resolver una colisión sobrescribiendo la migración de otra línea.

## 8. ARCHIVOS GLOBALES DE ALTO RIESGO

Considerar compartidos/globales:

- `.github/workflows/*`
- migraciones
- `package.json`
- lockfiles
- configuración común
- arquitectura
- contratos comunes
- guard tests globales
- migration ceilings
- listas globales de suites

Antes de editarlos, revisar si otro PR abierto también los toca.
Mantener el cambio mínimo posible.

## 9. PR

Un PR listo para revisión puede permanecer detrás de `main`.
No actualizarlo repetidamente mientras espera turno.
Cuando el PR llegue a integración final, reconciliarlo UNA VEZ con el `main` vigente y volver a validar.
Si `main` vuelve a cambiar antes del merge porque entró otro PR, reportarlo; no ocultarlo.

## 10. CI

Cada cambio de HEAD invalida la idea de que el CI anterior representa el estado final.
Siempre reportar:
`HEAD_SHA =`
`CI_VALIDATED_HEAD =`
No declarar un PR listo basándose únicamente en checks de un SHA anterior.

## 11. VERCEL

Un preview exitoso no equivale a Producción.
Distinguir siempre:

- branch code
- PR
- CI
- Vercel Preview
- merge a `main`
- Production deployment
- migration state
- runtime flags

Nunca usar "deployed" como sinónimo de "production active" sin comprobar el entorno.
La validación visual final de la UI la hace la dueña; no declarar QA visual de Producción como realizada por Claude.

## 12. PRODUCCIÓN

Prohibido sin autorización explícita:

- escrituras en Production;
- aplicar migraciones;
- modificar ledger;
- activar/desactivar flags;
- consumir créditos reales;
- llamar proveedores reales;
- escribir en HubSpot;
- ejecutar QA destructiva;
- alterar configuración de Vercel Production.

Un merge NO constituye autorización para estas acciones.

## 13. MERGE

Nunca mergear porque el PR esté verde.
Únicamente mergear si la dueña escribe explícitamente:
**MERGE APROBADO**
Sin esa autorización:
`MERGE_AUTHORIZED = NO`
aunque todo esté verde.

## 14. NO TRABAJAR FUERA DEL TRACK SIN DECLARARLO

Una tarea de Agent1 no debe "aprovechar" para corregir Agent2A.
Una tarea de Sources no debe limpiar código de Agent1.
Una tarea de Agent2A no debe modificar una migración de Sources salvo necesidad estricta de integración y claramente reportada.
Si detectas un problema ajeno:
repórtalo y deja evidencia; no expandas silenciosamente el scope.

## 15. REPORTE FINAL OBLIGATORIO

Al terminar cada fase importante, reportar:

```
TASK =
TRACK =
BASE_MAIN_AT_START =
CURRENT_ORIGIN_MAIN =
BRANCH =
WORKTREE =
HEAD =
PR =
MAIN_ADVANCED_SINCE_START = YES/NO
FINAL_MAIN_SYNC_DONE = YES/NO
CONFLICTS_RESOLVED =
GLOBAL_FILES_TOUCHED =
MIGRATION_CREATED =
MIGRATION_NUMBER =
MIGRATION_APPLIED =
CI =
VERCEL_PREVIEW =
PROD_WRITES =
PROVIDER_CALLS =
FLAGS_CHANGED =
HUBSPOT_WRITES =
READY_FOR_INTEGRATION_QUEUE = YES/NO
MERGE_AUTHORIZED = YES/NO
NEXT_ACTION =
```

## REGLA DE DECISIÓN

Cuando exista una duda entre:

A. hacer algo automáticamente para avanzar más rápido;
o
B. detenerse y preservar aislamiento/trazabilidad;

elige B.

Objetivo: no perder trabajo, no cruzar ramas, no competir por migraciones, no esconder conflictos y no integrar contra una versión obsoleta de `main`.
