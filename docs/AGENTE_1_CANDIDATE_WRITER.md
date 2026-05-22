# Agente 1 — Candidate Writer (Hito 5)

## Objetivo

`candidate_writer` es la tool server-side que persiste el output de `runProspectingPipeline()` en la base de datos de SellUp. Convierte los candidatos evaluados por el pipeline en registros reales de `prospect_batches` y `prospect_candidates`, listos para revisión humana.

## Archivos

| Archivo | Rol |
|---------|-----|
| `src/server/agents/prospecting-toolkit/candidate-writer.ts` | Implementación principal |
| `src/server/agents/prospecting-toolkit/types.ts` | Tipos `CandidateWriterInput`, `CandidateWriterOutput`, etc. |
| `src/server/agents/prospecting-toolkit/index.ts` | Exportaciones públicas |

## Qué escribe

- **1 `prospect_batch`** por llamada, con `status = ready_for_review` y `source = agent_1`
- **N `prospect_candidates`** (uno por candidato elegible, excluyendo `discard`)
- **Auditoría** en `prospect_candidate_audit`: `batch_created` + `candidate_created` por candidato

## Qué NO escribe / hace

| Acción prohibida | Estado |
|-----------------|--------|
| Crear `accounts` | ❌ Nunca |
| Actualizar HubSpot | ❌ Nunca |
| Llamar Apollo | ❌ Nunca |
| Llamar Lusha | ❌ Nunca |
| Llamar proveedor IA | ❌ Nunca |
| Guardar HTML completo | ❌ Nunca |
| Guardar tokens/secretos | ❌ Nunca |

La conversión de candidato → account solo puede hacerla un usuario humano vía `convertCandidateToAccount()`.

## Input

```typescript
type CandidateWriterInput = {
  pipelineOutput: ProspectingPipelineOutput; // Output de runProspectingPipeline()
  triggeredByUserId?: string | null;         // UUID de internal_users (opcional)
  ownerId?: string | null;                   // UUID del responsable del lote
  batchName?: string | null;                 // Nombre personalizado del lote
  source?: "agent_1" | "mock" | "web_search"; // Fuente del lote (default: agent_1)
  dryRun?: boolean;                          // true = simula sin escribir
};
```

## Output

```typescript
type CandidateWriterOutput = {
  dryRun: boolean;
  batchId: string | null;           // null si dryRun o error
  candidatesCreated: number;
  candidatesSkipped: number;
  createdCandidateIds: string[];
  skipped: Array<{ name: string; reason: string }>;
  status: "success" | "partial_success" | "failed" | "dry_run";
  errors: string[];
};
```

## Mapeo de estados (scoring → DB)

### Quality Label → `prospect_candidates.status`

| `qualityLabel` del scorer | `status` en DB | Notas |
|--------------------------|----------------|-------|
| `high_quality_new` | `needs_review` | Candidato para revisión humana |
| `needs_review` | `needs_review` | Revisión requerida |
| `duplicate` | `duplicate` | Duplicado detectado |
| `insufficient_data` | `needs_review` | Con `review_notes` explicando blockers |
| `discard` | — | **No se crea registro** |

### DuplicateStatus (toolkit) → `duplicate_status` (DB)

| Toolkit | DB |
|---------|-----|
| `new_candidate` | `no_match` |
| `existing_in_sellup` | `exact_duplicate` |
| `existing_in_hubspot` | `exact_duplicate` |
| `possible_duplicate` | `possible_duplicate` |
| `insufficient_data` | `insufficient_data` |
| `unchecked` | `unchecked` |
| `error` | `unchecked` (fallback seguro) |

## Metadata guardada en el candidato

El campo `metadata` de cada `prospect_candidate` incluye:

```json
{
  "generated_by": "agent_1_candidate_writer",
  "source_url": "https://...",
  "source_snippet": "Primeros 300 caracteres del snippet...",
  "website_verification": {
    "status": "verified | inferred | ...",
    "confidence": 85,
    "domain": "empresa.com",
    "redirected": false,
    "http_status": 200,
    "skipped": false
  },
  "duplicate_check": {
    "status": "new_candidate",
    "confidence": 0,
    "sources_checked": ["sellup"],
    "summary": "..."
  },
  "scoring": {
    "confidence_score": 75,
    "fit_score": 80,
    "data_completeness": 60,
    "quality_label": "high_quality_new",
    "recommended_action": "approve_for_review",
    "reasons": [...],
    "warnings": [...],
    "blockers": [...]
  }
}
```

**NO se guarda:** HTML completo, tokens de acceso, cookies, respuestas crudas de APIs pagas.

## Metadata del lote

El campo `metadata` del `prospect_batch` incluye:

```json
{
  "generated_by": "agent_1_candidate_writer",
  "pipeline_version": "0.4.0",
  "pipeline_summary": { "requested": 5, "returned": 5, ... },
  "web_search_provider": "mock",
  "search_depth": "standard",
  "catalog_sources": ["co_rues", "co_supersociedades"],
  "warnings": [],
  "generated_at": "2026-05-22T...",
  "dry_run": false
}
```

## Reglas de seguridad

- Usa **service role key** (`SUPABASE_SERVICE_ROLE_KEY`) para escritura directa sin sesión de usuario
- El `matched_account_id` solo se persiste si el match es un UUID válido de SellUp
- El snippet de fuente se trunca a 300 chars
- Los `source_primary` solo puede ser valores del CHECK constraint del schema: `web_ai` para candidatos del pipeline

## Modo dry run

Con `dryRun: true`:
- No se crea ningún registro en DB
- Se simula el mapeo de quality labels
- `batchId` siempre es `null`
- `candidatesCreated` siempre es `0`
- `status` siempre es `dry_run`

## Helper de alto nivel

```typescript
const { pipeline, writer } = await runAndWriteProspectingPipeline({
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  targetCount: 5,
  webSearchProvider: 'mock',
  dryRun: false,
});
```

Combina `runProspectingPipeline()` + `writeProspectingCandidates()` en un solo paso.

## Casos de prueba

### Caso 1 — Dry Run

```typescript
const pipeline = await runProspectingPipeline({ country: 'Colombia', countryCode: 'CO', industry: 'Tecnología', targetCount: 5, webSearchProvider: 'mock' });
const result = await writeProspectingCandidates({ pipelineOutput: pipeline, dryRun: true });

// Esperado:
assert(result.status === 'dry_run');
assert(result.dryRun === true);
assert(result.batchId === null);
assert(result.candidatesCreated === 0);
assert(result.errors.length === 0);
```

### Caso 2 — Write real QA

```typescript
const result = await writeProspectingCandidates({
  pipelineOutput: pipeline,
  batchName: 'QA Pipeline Writer Colombia Tecnología',
  source: 'agent_1',
  dryRun: false,
});

// Esperado:
assert(result.status !== 'failed');
assert(result.batchId !== null);
assert(result.candidatesCreated > 0 && result.candidatesCreated <= 5);
// Verificar en Supabase: prospect_batches + prospect_candidates creados
// Verificar: ninguna account creada
// Verificar: ninguna operación a HubSpot
```

## Próximo paso — Hito 6

Conectar `candidate_writer` al flujo UI: permitir al usuario disparar el pipeline + write desde la interfaz de Prospección, reemplazando la llamada actual a `runProspectGenerationAgent()` (pipeline Apollo) por el nuevo pipeline de búsqueda web cuando se configure `webSearchProvider: 'mock' | 'tavily'`.
