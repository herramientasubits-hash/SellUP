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

/** Tiempo por llamada: con 5 búsquedas web, Claude tarda 20–60 s. */
const CLAUDE_COMPANY_SEARCH_TIMEOUT_MS = 90_000;

export type ClaudeSearchRunContext = {
  model: string;
  apiKey: string;
  countryName: string;
  industryName: string;
  subindustries: readonly string[];
  additionalCriteria: string | null;
  /** Ya vistas para este país × industria; la corrida suma las que Claude va trayendo. */
  excludeDomains: string[];
  /** Una entrada por llamada, para registrar el uso al final con el lote ya creado. */
  calls: Array<CompanySearchOutcome & { query: string; durationMs: number }>;
  /** Para pruebas: reemplaza la conversación real. */
  runConversation?: Parameters<typeof searchCompaniesWithClaude>[2]['runConversation'];
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
  const startedMs = Date.now();
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
        ((body) => runAnthropicConversation({ apiKey: ctx.apiKey, body, timeoutMs: CLAUDE_COMPANY_SEARCH_TIMEOUT_MS })),
    },
  );
  ctx.calls.push({ ...outcome, query: input.query, durationMs: Date.now() - startedMs });
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
