/**
 * Prospecting Toolkit — Web Search Tool (Hito 3A, actualizado 7C)
 *
 * Herramienta de búsqueda web configurable con abstracción de providers.
 * Provider default: mock (sin costo, sin llamadas externas).
 * Provider real inicial: tavily (requiere TAVILY_API_KEY en entorno).
 *
 * Hito 7C: integra filtro anti-ruido post-search y query builder mejorado.
 *
 * Reglas críticas:
 * - No llama a Apollo, Lusha ni HubSpot.
 * - No usa proveedor IA para generar resultados.
 * - No crea prospect_candidates.
 * - No falla el build si el API key de Tavily no está configurado.
 * - No imprime API keys en logs ni metadata.
 * - maxResults se limita a MAX_RESULTS_HARD_LIMIT.
 */

import type { WebSearchInput, WebSearchOutput, WebSearchProviderKey } from './types';
import { runMockWebSearch } from './web-search-providers/mock-web-search-provider';
import { runTavilyWebSearch } from './web-search-providers/tavily-web-search-provider';
import { filterNoiseResults } from './noise-filter';

// Re-exportar desde query-builder para mantener la API pública estable
export {
  buildCompanyDiscoveryQuery,
  buildSectorSpecificSearchTerms,
  buildNoiseExclusionTerms,
} from './query-builder';
export type { CompanyDiscoveryQueryOptions } from './query-builder';

// ─── Constantes ───────────────────────────────────────────────────────────────

const DEFAULT_PROVIDER: WebSearchProviderKey = 'mock';
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_HARD_LIMIT = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeQuery(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

function resolveMaxResults(requested: number | undefined): number {
  const n = requested ?? DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(1, n), MAX_RESULTS_HARD_LIMIT);
}

// ─── Enrutador de providers ───────────────────────────────────────────────────

async function dispatchToProvider(
  provider: WebSearchProviderKey,
  input: WebSearchInput,
  maxResults: number,
): Promise<WebSearchOutput> {
  switch (provider) {
    case 'mock':
      return runMockWebSearch(input, maxResults);
    case 'tavily':
      return runTavilyWebSearch(input, maxResults);
    default:
      return {
        provider,
        query: input.query,
        results: [],
        resultsCount: 0,
        skipped: true,
        skipReason: `provider_not_implemented_${provider}`,
        estimatedCostUsd: null,
        metadata: {},
      };
  }
}

// ─── Función pública ──────────────────────────────────────────────────────────

export async function runWebSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const query = sanitizeQuery(input.query);
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const maxResults = resolveMaxResults(input.maxResults);

  const normalizedInput: WebSearchInput = { ...input, query };

  const raw = await dispatchToProvider(provider, normalizedInput, maxResults);

  // Post-filtro 1: eliminar resultados sin URL válida
  const validResults = raw.results.filter((r) => {
    try {
      new URL(r.url);
      return true;
    } catch {
      return false;
    }
  });

  // Post-filtro 2: clasificación anti-ruido (Hito 7C)
  const { kept, filtered, rawCount, keptCount, filteredCount } =
    filterNoiseResults(validResults);

  return {
    ...raw,
    query,
    results: kept,
    resultsCount: keptCount,
    metadata: {
      ...raw.metadata,
      noise_filter: {
        raw_results_count: rawCount,
        kept_count: keptCount,
        filtered_out_count: filteredCount,
        filtered_domains: filtered.map((f) => {
          try { return new URL(f.result.url).hostname; } catch { return f.result.url; }
        }),
      },
    },
  };
}
