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
import { resolveTavilyCountryTargeting } from '../tavily-query-plan';
import { TAVILY_EXCLUDE_DOMAINS_MAX } from '../tavily-exclude-domains';

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
  /** Presente con `include_usage: true`. */
  usage?: { credits?: unknown } | null;
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

/**
 * Cuerpo de `POST /search`. Puro, para poder fijarlo en tests sin red.
 *
 * AGENT1-TAVILY-V2-1 § 1 — `country` realza resultados del país pedido y
 * `language` sólo viaja donde la consulta está escrita en ese idioma (ver
 * `resolveTavilyCountryTargeting`). § 2 — `exclude_domains` deja fuera lo ya
 * visto y el ruido fijo. Nada de esto cambia el costo: la búsqueda `basic`
 * sigue costando 1 crédito.
 */
export function buildTavilySearchRequestBody(
  input: WebSearchInput,
  maxResults: number,
): Record<string, unknown> {
  const targeting = resolveTavilyCountryTargeting(input.countryCode);
  // AGENT1-TAVILY-V2-1 § 2 — nunca más de lo que Tavily acepta.
  const excludeDomains = (input.excludeDomains ?? []).slice(0, TAVILY_EXCLUDE_DOMAINS_MAX);
  return {
    query: input.query,
    max_results: maxResults,
    search_depth: input.searchDepth === 'deep' ? 'advanced' : 'basic',
    include_raw_content: false,
    // § 3 — la respuesta trae `usage.credits` (no cobra créditos extra).
    include_usage: true,
    ...(targeting.country ? { country: targeting.country } : {}),
    ...(targeting.language ? { language: targeting.language } : {}),
    ...(excludeDomains.length > 0 ? { exclude_domains: excludeDomains } : {}),
  };
}

/**
 * AGENT1-TAVILY-V2-1 § 3 — créditos que Tavily informa haber cobrado por esta
 * búsqueda (`usage.credits`, con `include_usage: true`). `null` si no vino o no
 * es un número válido: nunca se inventa.
 */
export function readTavilyReportedCredits(data: unknown): number | null {
  const credits = (data as TavilySearchResponse | null)?.usage?.credits;
  return typeof credits === 'number' && Number.isFinite(credits) && credits >= 0 ? credits : null;
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
      body: JSON.stringify(buildTavilySearchRequestBody(input, maxResults)),
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
        provider_reported_credits: readTavilyReportedCredits(data),
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
