/**
 * LinkedIn Company Search — Tavily Provider (v1.15.6)
 *
 * Implementa LinkedInSearchProviderFn usando la Tavily Search API.
 * Solo busca URLs de empresa LinkedIn. Sin scraping. Sin login.
 * Sin Sales Navigator. Sin contactos. Sin decisores.
 *
 * Parámetros fijos (conservadores):
 *   max_results    = 1 por defecto, configurable para recall test (max 5)
 *   search_depth   = basic
 *   include_domains = ['linkedin.com']
 *
 * Credencial: Vault → process.env.TAVILY_API_KEY (dev fallback via getTavilyApiKey).
 * La key NUNCA se imprime en logs.
 *
 * Sin retry automático. Sin reintento. Error → retorna [].
 */

import { getTavilyApiKey } from '@/server/services/tavily-connection';
import type { LinkedInSearchProviderFn } from './linkedin-company-search';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const REQUEST_TIMEOUT_MS = 15_000;

type TavilyResultItem = {
  url?: string;
};

type TavilySearchResponse = {
  results?: TavilyResultItem[];
};

function isValidHttpUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Crea un LinkedInSearchProviderFn que usa Tavily para buscar URLs de empresa LinkedIn.
 *
 * Cada llamada hace exactamente 1 request POST a Tavily.
 * Sin retry. Sin cache. Sin estado interno.
 *
 * @param maxResultsPerQuery Número de resultados a solicitar a Tavily (1-5). Default 3.
 *   Tavily bills per query call, not per result, so requesting 3 costs the same
 *   1 credit as requesting 1. The orchestrator selects the best URL among the results.
 * @returns La función proveedora. Si no hay key disponible, retorna [] sin error fatal.
 */
export function createTavilyLinkedInSearchProvider(
  maxResultsPerQuery: number = 3,
): LinkedInSearchProviderFn {
  const effectiveMaxResults = Math.max(1, Math.min(maxResultsPerQuery, 5));

  return async (query: string): Promise<string[]> => {
    let apiKey: string | null;

    try {
      apiKey = await getTavilyApiKey();
    } catch {
      // Error al obtener key — falla controlada sin exponer secreto
      console.error('[tavily-linkedin] Error al obtener credencial Tavily. Sin retry.');
      return [];
    }

    if (!apiKey) {
      console.error('[tavily-linkedin] TAVILY_API_KEY no disponible. Sin retry.');
      return [];
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
          query,
          max_results: effectiveMaxResults,
          search_depth: 'basic',
          include_domains: ['linkedin.com'],
          include_raw_content: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`[tavily-linkedin] HTTP ${response.status} para query="${query.slice(0, 60)}..."`);
        return [];
      }

      const data = (await response.json()) as TavilySearchResponse;
      const items = data.results ?? [];

      const urls = items
        .map((item) => item.url)
        .filter(isValidHttpUrl);

      return urls.slice(0, effectiveMaxResults);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      console.error(
        isTimeout
          ? '[tavily-linkedin] Timeout en request Tavily. Sin retry.'
          : `[tavily-linkedin] Error en request Tavily: ${err instanceof Error ? err.message : 'desconocido'}`,
      );
      return [];
    }
  };
}
