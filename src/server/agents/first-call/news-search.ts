/**
 * Agente 3 · Primera llamada — noticias y señales del último año en Tavily.
 *
 * Modo `news` + `time_range: year`: lo que le pasó a la empresa en los últimos
 * 12 meses, con la fecha de publicación de cada resultado. Búsqueda `basic`
 * (1 crédito). `fetchImpl` es inyectable: las pruebas nunca salen a la red.
 */

import { resolveTavilyCountryTargeting } from '../prospecting-toolkit/tavily-query-plan';
import type { NewsResult, NewsSearchOutput } from './research-documents';

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
export const NEWS_MAX_RESULTS = 6;
const NEWS_TIMEOUT_MS = 15_000;

export interface NewsSearchInput {
  query: string;
  countryCode: string | null;
  topic: 'news' | 'general';
}

export function buildNewsSearchBody(input: NewsSearchInput): Record<string, unknown> {
  // Tavily sólo admite `country` en el modo general.
  const targeting = input.topic === 'general' ? resolveTavilyCountryTargeting(input.countryCode) : { country: null };
  return {
    query: input.query,
    topic: input.topic,
    time_range: 'year',
    search_depth: 'basic',
    max_results: NEWS_MAX_RESULTS,
    include_raw_content: false,
    include_usage: true,
    ...(targeting.country ? { country: targeting.country } : {}),
  };
}

function isoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

export function parseNewsResponse(data: unknown): Pick<NewsSearchOutput, 'results' | 'credits'> {
  const record = (data ?? {}) as { results?: unknown; usage?: { credits?: unknown } | null };
  const results: NewsResult[] = (Array.isArray(record.results) ? record.results : [])
    .map((r) => (r ?? {}) as Record<string, unknown>)
    .filter((r) => typeof r.url === 'string' && /^https?:\/\//i.test(r.url as string))
    .map((r) => ({
      url: r.url as string,
      title: typeof r.title === 'string' ? r.title : null,
      content: typeof r.content === 'string' ? r.content : null,
      publishedOn: isoDay(r.published_date),
    }));
  const credits = record.usage?.credits;
  return { results, credits: typeof credits === 'number' && Number.isFinite(credits) ? credits : null };
}

export async function runTavilyNewsSearch(
  input: NewsSearchInput,
  apiKey: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<NewsSearchOutput> {
  if (!apiKey) return { results: [], credits: null, skipped: true, error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(TAVILY_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildNewsSearchBody(input)),
      signal: controller.signal,
    });
    if (!response.ok) return { results: [], credits: null, skipped: false, error: `tavily_http_${response.status}` };
    return { ...parseNewsResponse(await response.json()), skipped: false, error: null };
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'AbortError';
    return { results: [], credits: null, skipped: false, error: timeout ? 'tavily_timeout' : 'tavily_fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}
