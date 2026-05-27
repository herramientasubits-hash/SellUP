/**
 * Web Search Provider — Google Custom Search Engine (CSE)
 *
 * Adapter para la Google Custom Search JSON API.
 *
 * Credenciales: gestionadas via Supabase Vault a través de
 * google-cse-connection.ts. Nunca se leen desde process.env en
 * producción. El fallback a process.env solo aplica en desarrollo local.
 *
 * Si las credenciales no están disponibles, retorna skipped: true
 * sin lanzar error ni romper el build.
 *
 * Límites API:
 *   - Máximo 10 resultados por query (restricción del API).
 *   - 100 queries/día gratis; $5 por 1000 consultas adicionales.
 *
 * Pricing:
 *   - Free tier: 100 queries/day
 *   - Paid: $5 / 1000 queries (estimado $0.005/query)
 */

import type { WebSearchInput, WebSearchOutput, WebSearchResult } from '../types';
import { getGoogleCSECredentials } from '@/server/services/google-cse-connection';

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const GOOGLE_CSE_MAX_RESULTS = 10;
const ESTIMATED_COST_PER_QUERY_USD = 0.005;

// ─── Tipos internos de respuesta Google CSE ───────────────────────────────────

type GoogleCseItem = {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
};

type GoogleCseResponse = {
  items?: GoogleCseItem[];
  searchInformation?: {
    searchTime?: number;
    totalResults?: string;
  };
  error?: {
    code?: number;
    message?: string;
  };
};

function normalizeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isValidUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function mapCseResults(items: GoogleCseItem[], maxResults: number): WebSearchResult[] {
  const clampedMax = Math.min(maxResults, GOOGLE_CSE_MAX_RESULTS);

  return items
    .filter((item) => isValidUrl(item.link))
    .slice(0, clampedMax)
    .map((item, i) => {
      const url = item.link!;
      return {
        title: item.title ?? url,
        url,
        snippet: item.snippet ?? null,
        source: 'google_cse',
        rank: i + 1,
        provider: 'google_cse' as const,
        confidence: null,
        metadata: {
          domain: normalizeDomain(url),
        },
      };
    });
}

// ─── Provider público ─────────────────────────────────────────────────────────

export async function runGoogleCseWebSearch(
  input: WebSearchInput,
  maxResults: number,
): Promise<WebSearchOutput> {
  const creds = await getGoogleCSECredentials();

  if (!creds) {
    return {
      provider: 'google_cse',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'google_cse_credentials_missing',
      estimatedCostUsd: null,
      metadata: {
        hint: 'Configure Google CSE credentials in Settings > Integrations',
      },
    };
  }

  const clampedMax = Math.min(maxResults, GOOGLE_CSE_MAX_RESULTS);

  const url = new URL(GOOGLE_CSE_ENDPOINT);
  url.searchParams.set('key', creds.apiKey);
  url.searchParams.set('cx', creds.cx);
  url.searchParams.set('q', input.query);
  url.searchParams.set('num', String(clampedMax));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        provider: 'google_cse',
        query: input.query,
        results: [],
        resultsCount: 0,
        skipped: true,
        skipReason: `google_cse_http_error_${response.status}`,
        estimatedCostUsd: null,
        metadata: {},
      };
    }

    const data = (await response.json()) as GoogleCseResponse;

    if (data.error) {
      return {
        provider: 'google_cse',
        query: input.query,
        results: [],
        resultsCount: 0,
        skipped: true,
        skipReason: `google_cse_api_error_${data.error.code ?? 'unknown'}`,
        estimatedCostUsd: null,
        metadata: { api_error: data.error.message ?? 'unknown' },
      };
    }

    const results = mapCseResults(data.items ?? [], clampedMax);

    return {
      provider: 'google_cse',
      query: input.query,
      results,
      resultsCount: results.length,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: ESTIMATED_COST_PER_QUERY_USD,
      metadata: {
        search_time_ms: data.searchInformation?.searchTime
          ? Math.round(data.searchInformation.searchTime * 1000)
          : null,
        total_results_reported: data.searchInformation?.totalResults ?? null,
      },
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      provider: 'google_cse',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: isTimeout ? 'google_cse_timeout' : 'google_cse_fetch_error',
      estimatedCostUsd: null,
      metadata: {},
    };
  }
}
