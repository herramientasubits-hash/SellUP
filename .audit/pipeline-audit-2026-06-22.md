# Auditoría Técnica — Pipeline Agente 1
**Fecha:** 2026-06-22  
**Scope:** incremental_multi_round, search_plan null, 19 queries, metadata contradictoria  
**Estado:** Solo lectura. Sin implementación.

---

## 1. Mapa exacto del flujo real (chat wizard)

```
UI "Generar empresas candidatas con IA"
  └─ Server Action / API route
       └─ runWizardTavilySearch()         [wizard-tavily-executor.ts]
            │  targetInternal = 25
            │  maxRounds = 4
            │  targetPersistibleCandidates = 10
            │  webSearchProvider = 'tavily'   (forzado)
            │  dryRun = false
            │
            └─ runIncrementalProspectingSearch()   [incremental-search.ts]
                 │
                 ├─ buildDiscoveryQueryPlan()      [query-planner.ts]  ← solo metadata / gating decisions
                 ├─ loadDiscoveryNegativeMemory()  ← DB read
                 │
                 ├─ ROUND 1
                 │   ├─ buildCleanMultiQueryDiscoveryQueries()  [query-builder.ts]
                 │   └─ runProspectingPipeline(queryOverrides=[...])  [prospecting-pipeline.ts]
                 │        ├─ buildSearchPlan()      ← LLAMA AL SEARCH PLANNER
                 │        ├─ getExecutableQueriesFromSearchPlan()  ← extrae queries del plan
                 │        ├─ PERO queryOverrides != null → ignora executableQueries, usa los de incremental
                 │        └─ runMultiQueryWebSearch(queryOverrides)  ← ejecuta queries de incremental
                 │
                 ├─ ROUND 2
                 │   ├─ buildExpandedMultiQueryDiscoveryQueries()   [query-builder.ts]
                 │   └─ runProspectingPipeline(queryOverrides=[...])
                 │
                 ├─ ROUND 3
                 │   ├─ hardcoded partner/implementation queries (4 queries)
                 │   └─ runProspectingPipeline(queryOverrides=[...])
                 │
                 ├─ ROUND 4
                 │   ├─ hardcoded corporate buyer/ecosystem queries (4 queries)
                 │   └─ runProspectingPipeline(queryOverrides=[...])
                 │
                 ├─ estimatePersistableAfterNovelty()   ← novelty precheck por ronda
                 │
                 └─ writeProspectingCandidates()        [candidate-writer.ts]
                      ├─ Path A: UPDATE prospect_batches (reuse existingBatchId)
                      ├─ 9-gate quality funnel
                      ├─ INSERT prospect_candidates
                      └─ UPDATE prospect_batches con metadata final + reconciliación
```

**Pipeline usado:** `incremental_multi_round` vía `runIncrementalProspectingSearch()`.  
**No hay un pipeline alternativo** — el wizard siempre usa este path.

---

## 2. Archivos y funciones involucradas

| Archivo | Función clave | Rol |
|---|---|---|
| `wizard-tavily-executor.ts` | `runWizardTavilySearch()` | Entry point del wizard |
| `incremental-search.ts` | `runIncrementalProspectingSearch()` | Orquestador multi-ronda |
| `query-planner.ts` | `buildDiscoveryQueryPlan()` | Genera plan de gating/metadata |
| `query-builder.ts` | `buildCleanMultiQueryDiscoveryQueries()` | Queries R1 |
| `query-builder.ts` | `buildExpandedMultiQueryDiscoveryQueries()` | Queries R2 |
| `prospecting-pipeline.ts` | `runProspectingPipeline()` | Ejecuta 1 ronda con 1 set de queries |
| `search-planner.ts` | `buildSearchPlan()` | Llamado dentro de pipeline pero NO gobierna |
| `candidate-writer.ts` | `writeProspectingCandidates()` | Persiste + genera metadata final |

---

## 3. Por qué `search_plan` quedó null

### Diagnóstico

`buildSearchPlan()` **sí se llama** dentro de cada `runProspectingPipeline()`. Genera un plan completo y lo empaqueta en `ProspectingPipelineOutput.metadata.search_plan`.

**Pero:**

```
incremental-search.ts  →  runProspectingPipeline(queryOverrides=[...])
                                │
                                ↓
                          buildSearchPlan()   ✓ se ejecuta
                          getExecutableQueriesFromSearchPlan()  ✓ extrae
                          if (queryOverrides) { usar overrides }  ← FORK
                          searchPlanMeta.usedForExecution = FALSE
```

El plan existe pero `usedForExecution = false`.

### El problema real: la "synthetic pipeline output"

`runIncrementalProspectingSearch()` acumula candidatos de múltiples rondas y luego construye un **synthetic `ProspectingPipelineOutput`** para pasárselo a `writeProspectingCandidates()`. Este output sintético:

- Contiene los candidatos acumulados de todas las rondas ✓
- Contiene la metadata de `extraBatchMetadata`: `incremental_search`, `discovery_strategy`, `adaptive_discovery` ✓
- **NO replica `metadata.search_plan`** de los outputs individuales de cada ronda ✗

`extraBatchMetadata` que se pasa al writer incluye:
```
{ incremental_search, discovery_strategy, adaptive_discovery, additional_criteria, subindustries }
```

`search_plan` no está en `extraBatchMetadata`. Tampoco se copia del output de la última ronda al output sintético.

**Resultado:** `prospect_batches.metadata.search_plan = null`.

### Por qué Search Planner v1.2 no aparece en metadata

El Search Planner (`search-planner.ts`) es una capa de planificación **orquestal**, pero en el flujo incremental:

1. Se llama dentro de `runProspectingPipeline()`
2. Genera `search_plan` con `usedForExecution = false`
3. El output individual sí contiene el plan — pero el output sintético lo descarta
4. `query_trace_summary` del batch muestra qué queries se ejecutaron (fuente real: `query-builder.ts`)
5. `discovery_strategy.version = 'novelty_aware_v1'` refleja el orquestador (`incremental-search.ts`)

En términos de trazabilidad: el Search Planner corre pero es **invisible** en la metadata final del batch.

---

## 4. Por qué se ejecutaron 19 queries en `searchDepth = standard`

### Raíz del problema: dos sistemas de presupuesto desconectados

**Sistema A — Search Planner** (`search-planner.ts` → `getExecutableQueriesFromSearchPlan()`):
```
standard = max 10 queries
deep     = max 18 queries
```

**Sistema B — Incremental Search** (`incremental-search.ts` → `buildClean...` + `buildExpanded...`):
- No consulta `searchDepth` para limitar queries
- Genera queries por ronda según `query-builder.ts`
- El wizard fija `targetInternal = 25` y `maxRounds = 4`

Cuando el wizard llama a `runIncrementalProspectingSearch()`, **no pasa `searchDepth` como parámetro**. El `searchDepth = standard` que el usuario ve en la UI está en la metadata del batch, pero **no limita el número de queries** que el orquestador incremental genera.

### Conteo de queries por ronda

| Ronda | Función | Queries estimadas |
|---|---|---|
| R1 | `buildCleanMultiQueryDiscoveryQueries()` Colombia/Tech | ~5–6 |
| R2 | `buildExpandedMultiQueryDiscoveryQueries()` Colombia/Tech | ~5 |
| R3 | partner/implementation hardcoded | ~4 |
| R4 | corporate buyer/ecosystem hardcoded | ~4 |
| **Total** | | **~18–19** |

Cada ronda llama a `runProspectingPipeline()` con esas queries como `queryOverrides`, que llama a `runMultiQueryWebSearch()` ejecutando **una Tavily call por query**.

### ¿Es correcto que standard llegue a 19?

**Técnicamente sí** bajo el diseño actual del orquestador. El presupuesto de `searchDepth` solo restringe el Search Planner, que no gobierna el flujo incremental. El adaptive discovery puede ejecutar hasta `maxRounds * queries_per_round` queries totales.

**Pero no es el comportamiento esperado.** El usuario eligió `standard` esperando un consumo más acotado. El cap real está en `maxTotalRawToEvaluate = 50`, no en el número de queries.

### ¿Hay cap por ronda?

**No hay cap de queries por ronda.** Solo existe:
- `maxTotalRawToEvaluate` (50 resultados totales) → para el orquestador
- `targetPersistibleCandidates` (10) → stopping criterion
- `maxRounds` (4) → límite de rondas

Un cap por ronda que respete `searchDepth` no está implementado.

---

## 5. Explicación de metadata contradictoria (`adaptive_discovery`)

### Los dos `adaptive_discovery` y de dónde vienen

```
prospect_batches.metadata = {
  // TOP-LEVEL — generado por candidate-writer.ts post-reconciliación
  adaptive_discovery: {
    enabled: true,
    persisted_count: 4,       ← candidatesCreated del writer (real)
    stop_reason: "max_rounds_exhausted",
    result_status: "success_partial"
  },
  
  // NESTED — generado por incremental-search.ts pre-writer
  incremental_search: {
    adaptive_discovery: {
      enabled: true,
      persisted_count: 0,     ← placeholder antes de que corra el writer
      stop_reason: "no_new_candidates",
      result_status: (sin reconciliar)
    }
  }
}
```

### Secuencia de eventos

1. `incremental-search.ts` construye `adaptiveDiscovery` con `persisted_count = 0` (pre-writer, es un placeholder)
2. Este objeto va en `extraBatchMetadata.adaptive_discovery` → guardado en batch
3. El writer corre, persiste 4 candidatos
4. El writer reconcilia `adaptive_discovery` y lo escribe en el **top-level** de la metadata del batch
5. El `adaptive_discovery` anidado dentro de `incremental_search` **no se actualiza** (queda como estaba)

**Resultado:** dos versiones del mismo objeto con valores distintos.

### Fuente de verdad

| Campo | Fuente de verdad |
|---|---|
| `persisted_count` real | **Top-level `adaptive_discovery`** (reconciliado por writer) |
| `stop_reason` real | **Top-level `adaptive_discovery`** |
| `rounds_executed` real | `incremental_search.rounds_executed` |
| `queries_executed` real | `incremental_search.rounds[n].query_trace_summary.queries_executed` |
| `credits_used` real | `tavily_usage_reconciliation.credits_used_logged` |
| `skipped` real | `precision_gate + novelty_summary + source_url_quality_gate` |
| `needs_review_persisted` | conteo de `prospect_candidates.status = 'needs_review'` para ese batch |

---

## 6. Fuente de verdad por campo (resumen operacional)

| Dato | Ubicación en metadata |
|---|---|
| Queries ejecutadas (textos) | `incremental_search.rounds[n].query_trace_summary.queries_executed[]` |
| Queries ejecutadas (conteo) | `tavily_usage_reconciliation.queries_executed_total` |
| Rondas | `incremental_search.rounds_executed` |
| Candidatos persistidos | `adaptive_discovery` (top-level, post-reconciliación) |
| Candidatos skipped (total) | `writer_summary.actual_skipped_count` |
| Skipped por novelty | `novelty_summary.skipped_count` |
| Skipped por gates | `precision_gate.*_exclusions` + `source_url_quality_gate.blocked_count` + ... |
| Credits Tavily usados | `tavily_usage_reconciliation.credits_used_logged` |
| Stop reason real | `adaptive_discovery.stop_reason` (top-level) |

---

## 7. Respuestas a las 14 preguntas

**1. ¿Qué función exacta ejecuta el chat wizard?**  
`runWizardTavilySearch()` en `wizard-tavily-executor.ts`.

**2. ¿Ese flujo llama prospecting-pipeline.ts o usa otro pipeline incremental?**  
Usa `runIncrementalProspectingSearch()` (incremental-search.ts), que a su vez llama `runProspectingPipeline()` por ronda como sub-unidad de ejecución.

**3. ¿Dónde se construye `incremental_search.rounds`?**  
En `runIncrementalProspectingSearch()` dentro de `incremental-search.ts`, acumulando metadata por ronda en el loop multi-round.

**4. ¿Dónde se construye `discovery_strategy.version = novelty_aware_v1`?**  
En `runIncrementalProspectingSearch()`, en el bloque de output assembly (post-rounds loop), como parte del objeto `discoveryStrategy`.

**5. ¿Dónde se debería inyectar `search_plan` para que quede en el batch?**  
En `extraBatchMetadata` que se construye en `incremental-search.ts` antes de llamar a `writeProspectingCandidates()`. Actualmente ese objeto no incluye `search_plan`. Debería agregarse la key `search_plan` tomando el plan de la primera ronda o construyéndolo una sola vez antes del loop.

**6. ¿Por qué `search_plan` quedó null en el SQL?**  
El output sintético que recibe el writer no propaga `metadata.search_plan` desde los outputs individuales de cada ronda. El campo no está en `extraBatchMetadata`. Ver sección 3.

**7. ¿Por qué se ejecutaron 19 queries en standard?**  
El orquestador incremental usa `buildClean...` y `buildExpanded...` directamente, sin respetar el cap de `searchDepth`. El wizard fija `maxRounds = 4`. Ver sección 4.

**8. ¿Es correcto que standard pueda llegar a 19 queries por adaptive discovery?**  
Por diseño actual: sí. Por intención del usuario: no. El parámetro `searchDepth` no limita el orquestador incremental. Es una desconexión arquitectónica.

**9. ¿Hay cap por ronda o solo cap total?**  
Solo cap total: `maxTotalRawToEvaluate = 50`. No hay cap de queries por ronda implementado.

**10. ¿Por qué hay dos `adaptive_discovery` con valores contradictorios?**  
El de `incremental_search.adaptive_discovery` es el placeholder pre-writer (persisted_count=0). El top-level es la versión reconciliada post-writer. Ver sección 5.

**11. ¿Cuál es la fuente de verdad para `persisted_count` y `stop_reason`?**  
**Top-level `adaptive_discovery`** en `prospect_batches.metadata` (reconciliado por `candidate-writer.ts`).

**12. ¿Qué cambio mínimo para que Search Planner v1.2 sea trazable y gobierne incremental_search?**  
Ver propuesta de hito en sección 8.

**13. ¿Qué cambio mínimo para reducir consumo de Tavily sin matar recall?**  
Ver propuesta de hito en sección 8.

**14. ¿Cómo marcar candidatos con tamaño desconocido sin bloquearlos?**  
El `search-planner.ts` ya define la política correcta: `employeeCountPolicy: 'unknown_allowed_for_manual_review'` y `sizePolicy.gateImplemented = false`. El gap es que el candidate-writer no escribe `size_unconfirmed = true` en el candidato ni lo refleja en `review_notes`. El candidato ya llega como `needs_review` cuando `data_completeness_score` es bajo, lo que cubre el caso de forma implícita. Para hacerlo explícito bastaría agregar un campo en `metadata.scoring.size_unconfirmed = true` cuando no se pudo determinar employee count.

---

## 8. Propuesta de hito mínimo siguiente

### Nombre
**Search Planner v1.3 — Trazabilidad y presupuesto de queries**

### Objetivo
Que el Search Planner v1.2 sea visible en `prospect_batches.metadata`, que `searchDepth` reduzca realmente el número de queries en el flujo incremental, y que la metadata de `adaptive_discovery` sea coherente (sin duplicidad contradictoria).

### Problemas que resuelve
| Problema | Solución |
|---|---|
| `search_plan` null | Inyectar en `extraBatchMetadata` |
| 19 queries en standard | Cap de queries por ronda según `searchDepth` |
| Dos `adaptive_discovery` contradictorios | Remover `adaptive_discovery` del nested `incremental_search`; dejar solo el top-level |
| Search Planner no trazable | Incluir `search_plan.version` y `used_for_execution` en metadata |

### Archivos involucrados

| Archivo | Cambio |
|---|---|
| `incremental-search.ts` | (A) Agregar `search_plan` a `extraBatchMetadata`. (B) Aplicar cap de queries por ronda según `searchDepth`. (C) Remover `adaptive_discovery` del objeto `incremental_search` en el output (dejarlo solo top-level). |
| `wizard-tavily-executor.ts` | Pasar `searchDepth` a `runIncrementalProspectingSearch()` |
| `incremental-search-types.ts` | Agregar `searchDepth` al `IncrementalSearchInput` si no existe |

### Cambio propuesto (detalle técnico)

**(A) Propagar search_plan:**
```typescript
// incremental-search.ts — donde se construye extraBatchMetadata
// Tomar el plan de la primera ronda (ya generado, solo reutilizar)
const firstRoundSearchPlan = rounds[0]?.pipelineOutput?.metadata?.search_plan ?? null;

const extraBatchMetadata = {
  incremental_search: incrementalSearchMeta,
  discovery_strategy: discoveryStrategy,
  adaptive_discovery: adaptiveDiscovery,   // SOLO top-level
  additional_criteria: input.additionalCriteria,
  subindustries: input.subindustries,
  search_plan: firstRoundSearchPlan,       // ← NUEVO
};
```

**(B) Cap de queries por ronda:**
```typescript
// incremental-search.ts — al construir queries por ronda
const queriesPerRoundCap = input.searchDepth === 'standard' ? 5 : 9;

// R1
let r1Queries = buildCleanMultiQueryDiscoveryQueries(...);
r1Queries = r1Queries.slice(0, queriesPerRoundCap);

// R2
let r2Queries = buildExpandedMultiQueryDiscoveryQueries(...);
r2Queries = r2Queries.slice(0, queriesPerRoundCap);

// R3/R4
const r3r4Cap = input.searchDepth === 'standard' ? 3 : 4;
```

Efecto: `standard` → máx 16 queries (5+5+3+3). Mejor que 19, sin matar recall.

**(C) Remover duplicidad de adaptive_discovery:**
```typescript
// En el objeto incremental_search que va en extraBatchMetadata:
incremental_search: {
  rounds_executed,
  stopped_reason,
  total_raw_evaluated,
  rounds: [...],
  discovery_strategy,     // ← se mantiene aquí como referencia
  // adaptive_discovery: ← ELIMINAR de aquí; quedará solo en top-level
}
```

### Tests requeridos

1. Test unitario: `search_plan` presente en batch metadata cuando se usa wizard flow (mock del writer)
2. Test unitario: con `searchDepth = standard`, R1 no excede 5 queries
3. Test unitario: con `searchDepth = deep`, R1 puede llegar a 9 queries
4. Test existente: verificar que fintech guard sigue operativo tras el cambio
5. Test existente: verificar que `discovery_strategy` sigue presente en batch metadata

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Reducir queries puede reducir recall | El standard con 16 queries sigue siendo suficiente para Colombia/Tech. Si el target no se alcanza, adaptive discovery ya gestiona el escalamiento. |
| `firstRoundSearchPlan` puede ser null si la primera ronda falla | Null-check: `?? null` ya lo cubre; el campo quedará null (igual que ahora) pero sin romper. |
| Remover `adaptive_discovery` de `incremental_search` puede romper lectores actuales | Verificar si hay queries SQL o código frontend que lee `metadata->incremental_search->adaptive_discovery`. Si no los hay, es seguro. |

### Criterios de aceptación

- [ ] `prospect_batches.metadata.search_plan` no es null en un run real
- [ ] `search_plan.version = 'search_planner_v1'` visible en metadata
- [ ] Con `searchDepth = standard`, Tavily credits ≤ 16 en un run de 4 rondas
- [ ] Solo un `adaptive_discovery` en la metadata (top-level), sin duplicidad
- [ ] `adaptive_discovery.persisted_count` refleja el count real post-writer
- [ ] Tests unitarios pasan
- [ ] `npm run typecheck` y `npm run build` pasan

---

## Anexo: queries contra la BD recomendadas para validar

```sql
-- Ver search_plan actual
SELECT id, metadata->>'search_plan' FROM prospect_batches
WHERE id = 'bbb1c03a-4d63-446f-85cd-66efd384540d';

-- Ver adaptive_discovery top-level vs nested
SELECT
  metadata->'adaptive_discovery' AS top_level,
  metadata->'incremental_search'->'adaptive_discovery' AS nested
FROM prospect_batches
WHERE id = 'bbb1c03a-4d63-446f-85cd-66efd384540d';

-- Ver queries ejecutadas por ronda
SELECT
  jsonb_array_elements(metadata->'incremental_search'->'rounds') AS round
FROM prospect_batches
WHERE id = 'bbb1c03a-4d63-446f-85cd-66efd384540d';

-- Ver fuente de verdad de credits
SELECT metadata->'tavily_usage_reconciliation' FROM prospect_batches
WHERE id = 'bbb1c03a-4d63-446f-85cd-66efd384540d';
```
