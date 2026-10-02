/**
 * Agente 1 · Fase B, paso 2 — una corrida del piloto «Claude busca empresas» (puro;
 * dependencias inyectadas).
 *
 * Se lanza desde un lote existente (hereda país, industria, subindustrias y criterios)
 * y escribe en un lote NUEVO: así el piloto se mide por separado de Apollo, Lusha y
 * Tavily, y no toca la cuenta de aceptadas de la corrida original. El escritor es el
 * de siempre (mismas compuertas) y las empresas quedan como `web_ai`, igual que las de
 * Tavily; el origen se marca en la metadata del lote. Nada se aprueba solo.
 */

import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { ActiveAnthropicModel } from './classify-batch-candidates';
import type { CompanySearchOutcome } from './company-search';
import { CLAUDE_CLASSIFIER_CONTRACT_VERSION, CLAUDE_CLASSIFIER_PROVIDER_KEY } from './types';

export const CLAUDE_COMPANY_SEARCH_OPERATION_KEY = 'company_search';
/** Consultas por corrida (una llamada a Claude cada una, hasta 5 empresas por llamada). */
export const CLAUDE_COMPANY_SEARCH_MAX_QUERIES = 2;
export const CLAUDE_COMPANY_SEARCH_RESULTS_PER_QUERY = 5;
export const CLAUDE_COMPANY_SEARCH_TARGET = 10;
export const CLAUDE_COMPANY_SEARCH_METADATA_KEY = 'claude_company_search';
/**
 * Tiempo para EMPEZAR consultas a Claude desde que arranca la corrida. El resto de los
 * 300 s de Vercel queda para verificar sitios, revisar duplicados y escribir.
 */
export const CLAUDE_COMPANY_SEARCH_PHASE_MS = 170_000;

export type SourceBatch = {
  id: string;
  country: string;
  countryCode: string;
  industry: string;
  /** `metadata.industry_id`: lo usa el rescate para saber la macroindustria pedida. */
  industryId: string | null;
  /** Clave canónica de la macro (p. ej. 'technology'): para leer el banco de empresas. */
  macroIndustryKey: string | null;
  subindustries: string[];
  additionalCriteria: string | null;
};

export type CompanySearchCall = CompanySearchOutcome & { query: string; durationMs: number };

export type ClaudeCompanySearchDeps = {
  loadSourceBatch: (batchId: string) => Promise<SourceBatch | null>;
  /**
   * Dominios ya vistos en SellUp para este país × industria (candidatos, descartadas y,
   * si está disponible, el banco de empresas).
   */
  loadExcludedDomains: (source: SourceBatch) => Promise<string[]>;
  /** Corridas anteriores del piloto para este país × industria (para rotar regiones). */
  countPreviousRuns: (countryCode: string, industry: string) => Promise<number>;
  /** Regiones del país (las mismas que usa Tavily); vacío ⇒ sólo consultas nacionales. */
  resolveRegions: (countryCode: string) => readonly string[];
  resolveActiveModel: () => Promise<ActiveAnthropicModel | { error: string }>;
  checkQuota: () => Promise<{ allowed: boolean }>;
  /** Corre la cadena de siempre con el proveedor `claude`; devuelve las llamadas hechas. */
  runSearch: (params: {
    source: SourceBatch;
    queries: string[];
    excludeDomains: string[];
    active: ActiveAnthropicModel;
    deadlineAtMs: number;
    /** Se llama al terminar CADA llamada a Claude: registra lo pagado al instante. */
    onCall: (call: CompanySearchCall) => Promise<void>;
  }) => Promise<{ pipelineOutput: unknown; calls: CompanySearchCall[] }>;
  /** Escribe en un lote NUEVO; null si el escritor falló. */
  writeCandidates: (params: {
    pipelineOutput: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<{ batchId: string | null; candidatesCreated: number; errors: string[] }>;
  logUsage: (input: LogProviderUsageInput) => Promise<boolean>;
  newRunId: () => string;
  nowIso: () => string;
  nowMs: () => number;
};

export type ClaudeCompanySearchSummary =
  | {
      ok: true;
      batchId: string | null;
      candidatesCreated: number;
      proposed: number;
      passedPreFilter: number;
      rejected: Record<string, number>;
      estimatedCostUsd: number;
    }
  | {
      ok: false;
      error:
        | 'source_batch_not_found'
        | 'model_not_configured'
        | 'quota_exhausted'
        | 'exclusions_unavailable'
        | 'search_failed'
        | 'write_failed';
      detail?: string;
    };

/**
 * Consultas de la corrida.
 *  - 1.ª corrida de este país × industria: una general y, si hay, una por la primera
 *    subindustria (si no, «grandes empresas…»).
 *  - Siguientes: dos regiones del país por corrida, rotando (Antioquia, Valle del Cauca…).
 *    Una búsqueda nacional devuelve siempre las mismas empresas conocidas (Prod 01-10:
 *    CO×Tec, 8 de 10 ya vistas o sin sitio propio en la búsqueda).
 */
export function buildCompanySearchQueries(
  source: Pick<SourceBatch, 'country' | 'industry' | 'subindustries'>,
  previousRuns = 0,
  regions: readonly string[] = [],
): string[] {
  const subject = source.subindustries[0] ?? source.industry;
  if (previousRuns > 0 && regions.length > 0) {
    const start = ((previousRuns - 1) * CLAUDE_COMPANY_SEARCH_MAX_QUERIES) % regions.length;
    return Array.from({ length: Math.min(CLAUDE_COMPANY_SEARCH_MAX_QUERIES, regions.length) }, (_, i) => {
      const region = regions[(start + i) % regions.length];
      return `empresas de ${subject} en ${region}, ${source.country}`;
    });
  }
  const queries = [`empresas de ${source.industry} en ${source.country}`];
  for (const sub of source.subindustries) {
    if (queries.length >= CLAUDE_COMPANY_SEARCH_MAX_QUERIES) break;
    queries.push(`empresas de ${sub} en ${source.country}`);
  }
  if (queries.length < CLAUDE_COMPANY_SEARCH_MAX_QUERIES) {
    queries.push(`grandes empresas de ${source.industry} con sede en ${source.country}`);
  }
  return queries;
}

function addCounts(target: Record<string, number>, extra: Partial<Record<string, number>>): Record<string, number> {
  const next = { ...target };
  for (const [key, value] of Object.entries(extra)) next[key] = (next[key] ?? 0) + (value ?? 0);
  return next;
}

/**
 * El uso se registra al terminar cada llamada, antes de que exista el lote nuevo: va
 * sin `batch_id` y con `run_id` + `source_batch_id`; el lote nuevo guarda el mismo
 * `run_id` en `metadata.claude_company_search`.
 */
export function buildCompanySearchUsageLog(
  call: CompanySearchCall,
  context: { runId: string; sourceBatchId: string; triggeredBy: string; index: number },
): LogProviderUsageInput | null {
  if (!call.usage) return null;
  const isError = call.errorCode !== null;
  return {
    usage_key: `${CLAUDE_COMPANY_SEARCH_OPERATION_KEY}:${context.runId}:${context.index}`,
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: CLAUDE_COMPANY_SEARCH_OPERATION_KEY,
    model: call.usage.model,
    input_tokens: call.usage.inputTokens,
    output_tokens: call.usage.outputTokens,
    results_returned: call.results.length,
    estimated_cost_usd: call.usage.estimatedCostUsd,
    status: isError && call.errorCode === 'rate_limited' ? 'rate_limited' : isError ? 'error' : 'success',
    error_code: call.errorCode ?? undefined,
    duration_ms: call.durationMs,
    triggered_by: context.triggeredBy,
    metadata: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      flow: 'claude_company_search',
      run_id: context.runId,
      source_batch_id: context.sourceBatchId,
      query: call.query,
      proposed: call.proposed,
      rejected: call.rejected,
      web_search_requests: call.usage.webSearchRequests,
      pricing_source: call.usage.pricingSource,
    },
  };
}

export async function runClaudeCompanySearch(
  params: { sourceBatchId: string; triggeredBy: string },
  deps: ClaudeCompanySearchDeps,
): Promise<ClaudeCompanySearchSummary> {
  const source = await deps.loadSourceBatch(params.sourceBatchId);
  if (!source) return { ok: false, error: 'source_batch_not_found' };
  const active = await deps.resolveActiveModel();
  if ('error' in active) return { ok: false, error: 'model_not_configured', detail: active.error };
  if (!(await deps.checkQuota()).allowed) return { ok: false, error: 'quota_exhausted' };

  // Sin la lista de ya conocidas, Claude traería repetidas (y se pagarían): no se busca.
  let excludeDomains: string[];
  try {
    excludeDomains = await deps.loadExcludedDomains(source);
  } catch (err) {
    return { ok: false, error: 'exclusions_unavailable', detail: err instanceof Error ? err.message : String(err) };
  }
  const previousRuns = await deps.countPreviousRuns(source.countryCode, source.industry).catch(() => 0);
  const queries = buildCompanySearchQueries(source, previousRuns, deps.resolveRegions(source.countryCode));
  const runId = deps.newRunId();
  let callIndex = 0;
  const onCall = async (call: CompanySearchCall) => {
    const log = buildCompanySearchUsageLog(call, {
      runId,
      sourceBatchId: source.id,
      triggeredBy: params.triggeredBy,
      index: callIndex++,
    });
    if (log) await deps.logUsage(log);
  };

  let search: Awaited<ReturnType<ClaudeCompanySearchDeps['runSearch']>>;
  try {
    search = await deps.runSearch({
      source,
      queries,
      excludeDomains,
      active,
      deadlineAtMs: deps.nowMs() + CLAUDE_COMPANY_SEARCH_PHASE_MS,
      onCall,
    });
  } catch (err) {
    // Lo pagado ya quedó registrado por `onCall`, llamada a llamada.
    return { ok: false, error: 'search_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  const at = deps.nowIso();
  const proposed = search.calls.reduce((acc, c) => acc + c.proposed, 0);
  const passedPreFilter = search.calls.reduce((acc, c) => acc + c.results.length, 0);
  const rejected = search.calls.reduce<Record<string, number>>((acc, c) => addCounts(acc, c.rejected), {});
  const estimatedCostUsd =
    Math.round(search.calls.reduce((acc, c) => acc + (c.usage?.estimatedCostUsd ?? 0), 0) * 1_000_000) / 1_000_000;

  const written =
    passedPreFilter > 0
      ? await deps.writeCandidates({
          pipelineOutput: search.pipelineOutput,
          metadata: {
            ...(source.industryId ? { industry_id: source.industryId } : {}),
            ...(source.additionalCriteria ? { additional_criteria: source.additionalCriteria } : {}),
            [CLAUDE_COMPANY_SEARCH_METADATA_KEY]: {
              contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
              pilot: true,
              run_id: runId,
              ...(source.macroIndustryKey ? { macro_industry_key: source.macroIndustryKey } : {}),
              source_batch_id: source.id,
              queries,
              previous_runs: previousRuns,
              excluded_domains_count: excludeDomains.length,
              proposed,
              passed_pre_filter: passedPreFilter,
              rejected,
              estimated_cost_usd: estimatedCostUsd,
              searched_at: at,
            },
          },
        })
      : { batchId: null, candidatesCreated: 0, errors: [] };

  if (passedPreFilter > 0 && !written.batchId) {
    return { ok: false, error: 'write_failed', detail: written.errors.join('; ') };
  }
  return {
    ok: true,
    batchId: written.batchId,
    candidatesCreated: written.candidatesCreated,
    proposed,
    passedPreFilter,
    rejected,
    estimatedCostUsd,
  };
}
