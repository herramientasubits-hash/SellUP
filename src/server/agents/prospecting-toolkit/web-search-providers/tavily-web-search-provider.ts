/**
 * Web Search Provider — Tavily
 *
 * Adapter real para la Tavily Search API.
 *
 * Prioridad de credencial:
 *   1. Supabase Vault (integración administrable desde Configuración)
 *   2. process.env.TAVILY_API_KEY (solo en desarrollo local como fallback)
 *
 * Si la key no está disponible en ninguna fuente, retorna skipped: true
 * sin lanzar error ni romper el build.
 *
 * Pricing: pendiente de configurar en cost config (no se inventa costo).
 */

import type { WebSearchInput, WebSearchOutput, WebSearchResult } from '../types';
import { getTavilyApiKey } from '@/server/services/tavily-connection';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 15_000;

// ─── Tipos internos de respuesta Tavily ──────────────────────────────────────

type TavilyResultItem = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  raw_content?: string | null;
};

type TavilySearchResponse = {
  results?: TavilyResultItem[];
  query?: string;
  answer?: string | null;
  response_time?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function mapTavilyResults(
  items: TavilyResultItem[],
  maxResults: number,
): WebSearchResult[] {
  return items
    .filter((item) => isValidUrl(item.url))
    .slice(0, maxResults)
    .map((item, i) => ({
      title: item.title ?? item.url!,
      url: item.url!,
      snippet: item.content ?? item.raw_content ?? null,
      source: 'tavily',
      rank: i + 1,
      provider: 'tavily' as const,
      confidence: typeof item.score === 'number' ? Math.min(item.score, 1) : null,
      metadata: {},
    }));
}

// ─── Provider público ─────────────────────────────────────────────────────────

export async function runTavilyWebSearch(input: WebSearchInput, maxResults: number): Promise<WebSearchOutput> {
  // Prioridad: Vault (integración administrable) → env local (desarrollo)
  const apiKey = await getTavilyApiKey();

  if (!apiKey) {
    return {
      provider: 'tavily',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'tavily_api_key_missing',
      estimatedCostUsd: null,
      metadata: {
        cost_tracking: 'pending_provider_pricing_config',
      },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: input.query,
        max_results: maxResults,
        search_depth: input.searchDepth === 'deep' ? 'advanced' : 'basic',
        include_raw_content: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        provider: 'tavily',
        query: input.query,
        results: [],
        resultsCount: 0,
        skipped: true,
        skipReason: `tavily_http_error_${response.status}`,
        estimatedCostUsd: null,
        metadata: {
          cost_tracking: 'pending_provider_pricing_config',
        },
      };
    }

    const data = (await response.json()) as TavilySearchResponse;
    const results = mapTavilyResults(data.results ?? [], maxResults);

    return {
      provider: 'tavily',
      query: input.query,
      results,
      resultsCount: results.length,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: null,
      metadata: {
        cost_tracking: 'pending_provider_pricing_config',
        response_time_ms: data.response_time ?? null,
      },
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      provider: 'tavily',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: isTimeout ? 'tavily_timeout' : 'tavily_fetch_error',
      estimatedCostUsd: null,
      metadata: {
        cost_tracking: 'pending_provider_pricing_config',
      },
    };
  }
}
