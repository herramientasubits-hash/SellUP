/**
 * Prospecting Toolkit — Web Search Tool (Hito 3A)
 *
 * Herramienta de búsqueda web configurable con abstracción de providers.
 * Provider default: mock (sin costo, sin llamadas externas).
 * Provider real inicial: tavily (requiere TAVILY_API_KEY en entorno).
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
      // Provider no implementado — retorna skipped sin lanzar error fatal
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

  const normalizedInput: WebSearchInput = {
    ...input,
    query,
  };

  const output = await dispatchToProvider(provider, normalizedInput, maxResults);

  // Post-filtro: eliminar resultados sin URL válida (defensa en profundidad)
  const validResults = output.results.filter((r) => {
    try {
      new URL(r.url);
      return true;
    } catch {
      return false;
    }
  });

  // Re-normalizar rank tras filtrado
  const rankedResults = validResults.map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    ...output,
    query,
    results: rankedResults,
    resultsCount: rankedResults.length,
  };
}

// ─── Query builder helper ─────────────────────────────────────────────────────

export type CompanyDiscoveryQueryOptions = {
  industry: string;
  country: string;
  countryCode?: string | null;
  intent?: 'general' | 'linkedin' | 'website';
};

/**
 * Genera queries de búsqueda para discovery de empresas.
 * Hito 3A: retorna una query principal. Multi-query en hitos futuros.
 */
export function buildCompanyDiscoveryQuery(opts: CompanyDiscoveryQueryOptions): string {
  const { industry, country, intent = 'general' } = opts;

  switch (intent) {
    case 'linkedin':
      return `site:linkedin.com/company ${industry} ${country} empresa`;
    case 'website':
      return `empresas ${industry} ${country} sitio web contacto`;
    default:
      return `empresas ${industry} ${country} B2B software`;
  }
}
