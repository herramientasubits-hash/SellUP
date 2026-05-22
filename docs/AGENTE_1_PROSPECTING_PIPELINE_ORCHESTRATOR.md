# Agente 1 — Prospecting Pipeline Orquestador (Hito 4)

## Objetivo

Conectar las tools del `sellup_prospecting_toolkit` en un flujo mínimo server-side que, dado un país + industria, ejecuta discovery de empresas candidatas, verifica websites, deduplica contra SellUp y HubSpot, y califica cada candidato — sin guardar nada en base de datos y sin usar APIs pagadas por defecto.

---

## Tools conectadas

| Paso | Tool | Función |
|------|------|---------|
| 1 | Catalog Context Retriever (Hito 2) | `getCatalogContext()` |
| 2 | Web Search Tool (Hito 3A) | `buildCompanyDiscoveryQuery()` + `runWebSearch()` |
| 3 | Website Verifier (Hito 3B) | `verifyWebsite()` |
| 4 | Duplicate Checker (Hito 1) | `checkCompanyDuplicate()` |
| 5 | Candidate Scorer (Hito 3C) | `scoreCandidate()` |

---

## Input / Output

### Input: `ProspectingPipelineInput`

```typescript
{
  country: string;           // Nombre legible: "Colombia", "México"
  countryCode: string;       // ISO 3166-1 alpha-2: "CO", "MX"
  industry: string;          // Sector: "Tecnología", "Textil / manufactura"
  searchDepth?: SearchDepth; // "basic" | "standard" | "deep" — default: "standard"
  targetCount?: number;      // Cuántos candidatos buscar — default: 10, max: 25
  webSearchProvider?: WebSearchProviderKey; // "mock" | "tavily" | ... — default: "mock"
}
```

### Output: `ProspectingPipelineOutput`

```typescript
{
  input: ProspectingPipelineInput;
  catalogContext: CatalogContextResult;   // Fuentes, riesgos, reglas del país/sector
  searchQuery: string;                    // Query construida
  webSearch: WebSearchOutput;             // Resultados crudos de búsqueda
  candidates: ProspectingPipelineCandidate[];
  summary: {
    requested: number;      // targetCount efectivo (post-capping)
    searched: number;       // Resultados que retornó el web search
    returned: number;       // Candidatos procesados
    highQualityNew: number; // label = high_quality_new
    needsReview: number;    // label = needs_review
    duplicates: number;     // label = duplicate
    insufficientData: number;
    discarded: number;
    unchecked: number;      // duplicateCheck.status = unchecked (subconjunto de needsReview)
  };
  warnings: string[];
  metadata?: Record<string, unknown>;
}
```

### Candidato: `ProspectingPipelineCandidate`

```typescript
{
  name: string;
  website: string | null;
  domain: string | null;
  country: string;
  countryCode: string;
  industry: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSnippet: string | null;
  websiteVerification: WebsiteVerificationOutput | null;
  duplicateCheck: DuplicateCheckResult | null;
  scoring: CandidateScoringOutput;
}
```

---

## Flujo paso a paso

```
runProspectingPipeline(input)
  │
  ├─ 1. getCatalogContext({ country, countryCode, industry, searchDepth })
  │      → fuentes recomendadas, riesgos, reglas operativas, promptContext
  │
  ├─ 2. buildCompanyDiscoveryQuery({ industry, country, countryCode })
  │      → query string ("empresas Tecnología Colombia B2B software")
  │
  ├─ 3. runWebSearch({ query, country, countryCode, industry, maxResults, provider })
  │      → WebSearchOutput con results[]
  │
  └─ 4. Por cada result (hasta targetCount):
         │
         ├─ verifyWebsite({ candidateName, websiteOrDomain, country, countryCode })
         │    → WebsiteVerificationOutput (verified|inferred|mismatch|not_found|error)
         │
         ├─ checkCompanyDuplicate({ name, website, domain, country, countryCode })
         │    → DuplicateCheckResult (new_candidate|unchecked|existing_in_*|...)
         │
         └─ scoreCandidate({ name, website, domain, websiteVerification,
                             duplicateCheck, catalogContext, ... })
              → CandidateScoringOutput (qualityLabel, confidenceScore, ...)

  → ProspectingPipelineOutput (in-memory, sin escritura en DB)
```

Los pasos 4a/4b/4c de cada candidato se ejecutan en **paralelo** (`Promise.all`) sobre todos los candidatos. Los pasos 1-2-3 son secuenciales.

---

## Reglas de seguridad

| Regla | Estado |
|-------|--------|
| No escribe en DB (no prospect_candidates, no accounts) | ✅ |
| No llama Apollo | ✅ |
| No llama Lusha | ✅ |
| No usa proveedor IA | ✅ |
| No usa Tavily real por defecto (mock es default) | ✅ |
| HubSpot unchecked → scorer devuelve needs_review, nunca high_quality_new | ✅ |
| Hard limit targetCount = 25 | ✅ |
| No crea migraciones de base de datos | ✅ |
| No modifica UI | ✅ |

### Regla HubSpot unchecked

Si `checkCompanyDuplicate` retorna `status: "unchecked"` (porque HubSpot no está conectado al entorno), el `scoreCandidate` recibe ese resultado y aplica un blocker que impide `high_quality_new`. El candidato queda como `needs_review` y se cuenta en `summary.unchecked`.

---

## Qué NO hace todavía

- No guarda candidatos en `prospect_candidates`.
- No crea `prospect_batches` ni `accounts`.
- No llama Apollo para enriquecimiento.
- No llama Lusha para datos de contacto.
- No usa IA para clasificar o generar reasoning.
- No implementa multi-query (una sola query por ejecución, Hito futuro).
- No orquesta retry automático si web search falla.
- No expone endpoint HTTP (solo función server-side).

---

## Casos validados

| Caso | Input | Resultado obtenido |
|------|-------|--------------------|
| 1 — Mock CO/Tech | `CO, Tecnología, targetCount=5, mock` | 5 candidatos, todos `needs_review` (unchecked HubSpot), summary coherente |
| 2 — Hard limit | `targetCount=50` | `requested=25`, warning emitido, `candidates≤25` |
| 3 — MX Textil | `MX, Textil/manufactura, targetCount=5, mock` | Fuentes MX (DENUE, CANAIVE, SIEM), regla CANAIVE presente, 5 candidatos |

### Observación Caso 1

Todos los candidatos quedan como `needs_review` con `unchecked=5` porque:
1. El mock provider genera URLs de `example.com/mock-*` — el website verifier retorna `mismatch` o `error`.
2. HubSpot no está conectado en entorno local — `checkCompanyDuplicate` retorna `unchecked`.
3. El scorer detecta el `unchecked` y aplica el blocker de seguridad → `needs_review`.

Este comportamiento es **correcto y esperado**.

---

## Archivos creados / modificados

| Archivo | Cambio |
|---------|--------|
| `src/server/agents/prospecting-toolkit/prospecting-pipeline.ts` | Creado — orquestador principal |
| `src/server/agents/prospecting-toolkit/types.ts` | Tipos `ProspectingPipelineInput`, `ProspectingPipelineCandidate`, `ProspectingPipelineSummary`, `ProspectingPipelineOutput` |
| `src/server/agents/prospecting-toolkit/index.ts` | Exporta nuevos tipos y `runProspectingPipeline` |
| `docs/AGENTE_1_PROSPECTING_PIPELINE_ORCHESTRATOR.md` | Esta documentación |

---

## Validaciones técnicas

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ Sin errores |
| `npm run lint` | 32 errores preexistentes, 0 errores en archivos nuevos |
| `npm run build` | ✅ Build exitoso |
| Script validación | ✅ 3/3 casos pasados |

---

## Próximo paso — Hito 5

Crear el endpoint HTTP (API Route o Server Action) que invoque `runProspectingPipeline` y permita disparar el pipeline desde la UI, con opción de guardar los candidatos aprobados en `prospect_candidates` (con flag explícito `persist: true`).
