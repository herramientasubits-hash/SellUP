# Agente 1 — Web Search Tool (Hito 3A)

**Versión:** 0.1  
**Estado:** Implementado, pendiente validación manual  
**Fecha:** 2026-05-22  

---

## Objetivo

Proveer al Agente 1 de prospección una herramienta de búsqueda web configurable que permita descubrir empresas reales por país e industria sin depender inicialmente de Apollo ni de Lusha.

La herramienta abstrae el proveedor de búsqueda para que el agente no quede acoplado a ningún vendor específico.

---

## Por qué existe

- El agente necesita descubrir candidatos antes de saber si tienen dominio o LinkedIn.
- Apollo está reservado para enrichment/fallback deep (no discovery).
- Lusha está excluida de todo el pipeline.
- Se necesita un modo seguro (`mock`) que no consuma créditos durante desarrollo.
- Se necesita un modo real (`tavily`) que funcione sin romper el build si no hay API key.

---

## Arquitectura — Provider Abstraction

```
runWebSearch(input: WebSearchInput)
    │
    ├── provider: mock   → runMockWebSearch()     [sin costo, sin red]
    ├── provider: tavily → runTavilyWebSearch()   [real, requiere TAVILY_API_KEY]
    │
    └── providers futuros (no implementados aún):
        brave | serpapi | exa | firecrawl
```

El `runWebSearch` orquesta:
1. Sanitiza la query.
2. Aplica hard limit de `maxResults` (máx. 20).
3. Despacha al provider correcto.
4. Post-filtra resultados sin URL válida.
5. Re-normaliza ranks.

---

## Provider: Mock

**Archivo:** `web-search-providers/mock-web-search-provider.ts`

- No realiza ninguna llamada externa.
- Genera resultados sintéticos realistas por industria y país.
- Costo estimado: `$0`.
- Todos los resultados tienen `metadata.mock: true`.
- Útil para: desarrollo local, tests, CI sin credenciales.

**Ejemplo de resultado:**
```json
{
  "title": "Software Colombia Mock 01 S.A.S",
  "url": "https://example.com/mock-software-co-01",
  "snippet": "Empresa de Tecnología ubicada en Colombia. Resultado generado por mock provider...",
  "provider": "mock",
  "rank": 1,
  "metadata": { "mock": true }
}
```

---

## Provider: Tavily

**Archivo:** `web-search-providers/tavily-web-search-provider.ts`

- Usa la [Tavily Search API](https://docs.tavily.com/).
- Requiere `TAVILY_API_KEY` en el entorno del servidor.
- Si la key **no está presente**: retorna `skipped: true`, `skipReason: "tavily_api_key_missing"` — **no lanza error, no rompe el build**.
- Si Tavily responde con error HTTP o timeout: retorna `skipped: true` con `skipReason` descriptivo.
- Timeout: 15 segundos.
- La API key **nunca se loguea** ni se incluye en `metadata`.

**Nota de seguridad:** `TAVILY_API_KEY` se lee de `process.env`. Para producción, moverla a Vault cuando el proyecto adopte gestión de secretos centralizada. Por ahora, env server-side es aceptable como MVP.

**Costo:** `estimatedCostUsd: null` — pendiente de configurar en cost config. No se inventa costo.

---

## Inputs / Outputs

### `WebSearchInput`

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `query` | `string` | — | Query de búsqueda (requerida) |
| `country` | `string \| null` | — | País objetivo |
| `countryCode` | `string \| null` | — | ISO 2-letras (CO, MX, PE…) |
| `industry` | `string \| null` | — | Industria objetivo |
| `intent` | `WebSearchIntent` | — | Intención: `company_discovery`, `website_discovery`… |
| `maxResults` | `number` | `10` | Máximo resultados (hard limit: 20) |
| `provider` | `WebSearchProviderKey` | `"mock"` | Provider a usar |
| `searchDepth` | `SearchDepth` | — | `basic` / `standard` / `deep` |

### `WebSearchOutput`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `provider` | `WebSearchProviderKey` | Provider que ejecutó la búsqueda |
| `query` | `string` | Query sanitizada |
| `results` | `WebSearchResult[]` | Resultados normalizados |
| `resultsCount` | `number` | Cantidad de resultados válidos |
| `skipped` | `boolean` | `true` si la búsqueda fue omitida |
| `skipReason` | `string \| null` | Razón del skip |
| `estimatedCostUsd` | `number \| null` | Costo estimado (null si no hay pricing config) |
| `metadata` | `Record<string, unknown>` | Metadata adicional del provider |

### `WebSearchResult`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `title` | `string` | Título del resultado |
| `url` | `string` | URL del resultado (siempre válida) |
| `snippet` | `string \| null` | Extracto de contenido |
| `source` | `string \| null` | Fuente del resultado |
| `rank` | `number` | Posición (1-based, secuencial) |
| `provider` | `WebSearchProviderKey` | Provider que generó el resultado |
| `confidence` | `number \| null` | Score de relevancia 0-1 |
| `metadata` | `Record<string, unknown>` | Metadata del resultado |

---

## Reglas de seguridad

1. **No loguear API keys** — La key de Tavily nunca aparece en logs ni metadata.
2. **No crear prospect_candidates** — Esta tool solo retorna raw results.
3. **No llamar Apollo** — Apollo está reservado para enrichment deep.
4. **No llamar Lusha** — Excluida de todo el pipeline.
5. **No llamar HubSpot** — Esta tool no hace verificación de duplicados.
6. **No fallar el build** — Si Tavily no tiene key, retorna `skipped: true`.
7. **Hard limit de resultados** — Máximo 20 resultados por llamada.
8. **Validación de URLs** — Solo se retornan resultados con URL válida.

---

## Costos

| Provider | Costo por llamada | Estado |
|----------|-------------------|--------|
| `mock` | $0.00 | Implementado |
| `tavily` | pendiente pricing config | `estimatedCostUsd: null` |
| `brave` | pendiente | No implementado |
| `serpapi` | pendiente | No implementado |
| `exa` | pendiente | No implementado |
| `firecrawl` | pendiente | No implementado |

---

## Casos de prueba

### Caso 1 — Mock Colombia Tecnología

```js
runWebSearch({
  query: 'empresas tecnología Colombia software B2B',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  provider: 'mock',
  maxResults: 5,
})
```

Esperado: `skipped: false`, `resultsCount: 5`, `provider: "mock"`, `metadata.mock: true`.

### Caso 2 — Tavily sin API key

```js
runWebSearch({
  query: 'empresas tecnología Colombia software B2B',
  provider: 'tavily',
  maxResults: 5,
})
// Sin TAVILY_API_KEY en el entorno
```

Esperado: `skipped: true`, `skipReason: "tavily_api_key_missing"`, `resultsCount: 0`.

### Caso 3 — Hard limit maxResults

```js
runWebSearch({ query: '...', provider: 'mock', maxResults: 50 })
```

Esperado: `resultsCount <= 20`.

### Caso 4 — Query sanitization

```js
runWebSearch({ query: '  empresas   tecnología   Colombia  ', provider: 'mock' })
```

Esperado: `query: "empresas tecnología Colombia"`.

---

## Helper: buildCompanyDiscoveryQuery

Genera queries para discovery de empresas:

```ts
buildCompanyDiscoveryQuery({
  industry: 'Tecnología',
  country: 'Colombia',
  intent: 'general',   // → "empresas Tecnología Colombia B2B software"
  // intent: 'linkedin' → "site:linkedin.com/company Tecnología Colombia empresa"
  // intent: 'website'  → "empresas Tecnología Colombia sitio web contacto"
})
```

Hito 3A: una query por llamada. Multi-query en hitos futuros.

---

## Próximo paso: Hito 3B — Website Verifier

La Web Search Tool retorna URLs crudas. El siguiente hito implementará un **Website Verifier** que:
1. Visita cada URL retornada.
2. Verifica que corresponde a una empresa real.
3. Extrae nombre, descripción, país, sector.
4. Descarta resultados que no sean páginas de empresa.

Esto transforma los raw results en candidatos verificables para el pipeline de prospección.

---

## Archivos del hito

```
src/server/agents/prospecting-toolkit/
├── web-search-tool.ts                              ← Tool principal
├── web-search-providers/
│   ├── index.ts                                    ← Barrel
│   ├── mock-web-search-provider.ts                 ← Provider mock
│   └── tavily-web-search-provider.ts               ← Provider Tavily
├── types.ts                                        ← Tipos ampliados
└── index.ts                                        ← Exports públicos

scripts/
└── tmp-test-web-search.mjs                         ← Script validación (eliminar post-commit)

docs/
└── AGENTE_1_WEB_SEARCH_TOOL.md                     ← Este archivo
```
