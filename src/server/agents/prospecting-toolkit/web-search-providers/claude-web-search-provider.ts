/**
 * Proveedor de búsqueda web «claude» — Agente 1 · Fase B, paso 2 (sólo servidor).
 *
 * Misma firma que Tavily: `(input, maxResults) ⇒ WebSearchOutput`. La corrida que lo
 * usa (`company-search-run.server.ts`) abre un CONTEXTO con el modelo y la credencial
 * de Configuración → IA y un colector de uso; sin ese contexto el proveedor no llama a
 * nadie (`skipped`). Así una ruta que no sea el piloto nunca gasta en Claude por error.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { runAnthropicConversation } from '../claude-classifier/anthropic-messages-client';
import { searchCompaniesWithClaude, type CompanySearchOutcome } from '../claude-classifier/company-search';
import type { WebSearchInput, WebSearchOutput } from '../types';
import { fetchSafePageHtml } from '../website-verifier';
import { CLAUDE_PAGE_MAX_HTML_BYTES } from '../claude-classifier/page-text';

/** Tope por petición HTTP: con 5 búsquedas web, Claude tarda 20–45 s. */
const CLAUDE_COMPANY_SEARCH_REQUEST_TIMEOUT_MS = 45_000;
/** No se empieza una consulta nueva si queda menos que esto antes del límite de la corrida. */
export const CLAUDE_COMPANY_SEARCH_MIN_TIME_FOR_CALL_MS = 50_000;
/** Para comprobar un sitio que no salió de la búsqueda (se bajan en paralelo). */
const OUTSIDE_SEARCH_PAGE_TIMEOUT_MS = 8_000;

export type ClaudeSearchRunContext = {
  model: string;
  apiKey: string;
  countryName: string;
  industryName: string;
  subindustries: readonly string[];
  additionalCriteria: string | null;
  /** Ya vistas para este país × industria; la corrida suma las que Claude va trayendo. */
  excludeDomains: string[];
  /** Una entrada por llamada (para el resumen de la corrida). */
  calls: Array<CompanySearchOutcome & { query: string; durationMs: number }>;
  /**
   * Límite para EMPEZAR llamadas (epoch ms): deja tiempo a la verificación y al
   * escritor dentro de los 300 s de Vercel (revisión 01-10).
   */
  deadlineAtMs: number;
  /** Registra el uso de cada llamada APENAS termina: si Vercel corta después, lo pagado queda. */
  onCall?: (call: CompanySearchOutcome & { query: string; durationMs: number }) => Promise<void>;
  /** Para pruebas: reloj. */
  nowMs?: () => number;
  /** Para pruebas: reemplaza la conversación real. */
  runConversation?: Parameters<typeof searchCompaniesWithClaude>[2]['runConversation'];
  /** Para pruebas: reemplaza la descarga de páginas. */
  fetchPage?: Parameters<typeof searchCompaniesWithClaude>[2]['fetchPage'];
};

const runContext = new AsyncLocalStorage<ClaudeSearchRunContext>();

export function withClaudeSearchContext<T>(context: ClaudeSearchRunContext, fn: () => Promise<T>): Promise<T> {
  return runContext.run(context, fn);
}

export async function runClaudeWebSearch(input: WebSearchInput, maxResults: number): Promise<WebSearchOutput> {
  const ctx = runContext.getStore();
  if (!ctx) {
    return {
      provider: 'claude',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'claude_search_context_missing',
      estimatedCostUsd: null,
      metadata: {},
    };
  }
  const now = ctx.nowMs ?? Date.now;
  const startedMs = now();
  const remainingMs = ctx.deadlineAtMs - startedMs;
  if (remainingMs < CLAUDE_COMPANY_SEARCH_MIN_TIME_FOR_CALL_MS) {
    return {
      provider: 'claude',
      query: input.query,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'claude_time_budget',
      estimatedCostUsd: null,
      metadata: {},
    };
  }
  const timeoutMs = Math.min(CLAUDE_COMPANY_SEARCH_REQUEST_TIMEOUT_MS, remainingMs);
  const outcome = await searchCompaniesWithClaude(
    {
      query: input.query,
      countryName: ctx.countryName,
      countryCode: input.countryCode ?? '',
      industryName: ctx.industryName,
      subindustries: ctx.subindustries,
      additionalCriteria: ctx.additionalCriteria,
      excludeDomains: [...ctx.excludeDomains, ...(input.excludeDomains ?? [])],
      maxCompanies: maxResults,
    },
    ctx.model,
    {
      runConversation:
        ctx.runConversation ??
        ((body) => runAnthropicConversation({ apiKey: ctx.apiKey, body, timeoutMs })),
      fetchPage: ctx.fetchPage ?? ((url) => fetchSafePageHtml(url, OUTSIDE_SEARCH_PAGE_TIMEOUT_MS, CLAUDE_PAGE_MAX_HTML_BYTES)),
    },
  );
  const call = { ...outcome, query: input.query, durationMs: now() - startedMs };
  ctx.calls.push(call);
  await ctx.onCall?.(call).catch((err) => {
    console.error('[claude-company-search] usage log failed:', err instanceof Error ? err.message : err);
  });
  // La siguiente consulta de la corrida no repite lo que ésta ya trajo.
  for (const r of outcome.results) ctx.excludeDomains.push(new URL(r.url).hostname);

  return {
    provider: 'claude',
    query: input.query,
    results: outcome.results,
    resultsCount: outcome.results.length,
    skipped: outcome.errorCode !== null && outcome.results.length === 0,
    skipReason: outcome.errorCode ? `claude_${outcome.errorCode}` : null,
    estimatedCostUsd: outcome.usage?.estimatedCostUsd ?? null,
    metadata: { proposed: outcome.proposed, rejected: outcome.rejected },
  };
}
