/**
 * tavily-usage-logging.ts — Trazabilidad económica por ronda Tavily (Hito 16AB.43.10)
 *
 * Contiene:
 * - Tipos de contexto de uso (TavilyUsageContext, TavilyUsageBaseContext)
 * - Tipos de dependencias inyectables (TavilyUsageDeps)
 * - Error identificable de pricing (TavilyPricingUnavailableError)
 * - Helpers puros: buildTavilyUsageKey, creditsForSearchDepth, validateTavilyPricing
 * - Cálculo de estado agregado: computeAggregateStatus
 * - Logger real con manejo de 23505: realLogTavilyUsage
 *
 * REGLAS DE SEGURIDAD:
 * - Nunca imprime queries, API keys, credenciales ni resultados completos.
 * - La metadata sanitizada no contiene PII innecesaria.
 * - real_cost_usd nunca se escribe (permanece NULL hasta conciliación).
 *
 * LIMITACIÓN CONOCIDA:
 * Tavily no devuelve créditos facturados reales ni un request ID externo.
 * El costo estimado se calcula con base en la tarifa activa y los credits_used estimados.
 * Si el log falla después de que Tavily respondió, el costo consumido se pierde de la
 * observabilidad sin reintentos (riesgo residual documentado en § 20 del hito).
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { LogProviderUsageInput, ProviderUsageStatus } from '@/modules/usage-tracking/types';
import type { ActivePricingConfig } from '@/modules/usage-tracking/provider-pricing';
import type { WebSearchInput, WebSearchOutput, WebSearchProviderKey, MultiQueryQueryResult } from './types';
import type { LinkedInUsageLogPayload, LinkedInUsageLoggerFn } from './linkedin-company-search';

// ─── Tipos de contexto ────────────────────────────────────────────────────────

/** Contexto base que provee el wizard antes de asignar roundNumber. */
export type TavilyUsageBaseContext = {
  batchId: string;
  triggeredByUserId: string;
  agentRunId?: string | null;
  agentRunStepId?: string | null;
};

/** Contexto completo por ronda: incluye roundNumber asignado por incremental-search. */
export type TavilyUsageContext = TavilyUsageBaseContext & {
  roundNumber: number;
};

// ─── Tipos de dependencias inyectables ────────────────────────────────────────

export type PricingLoader = () => Promise<ActivePricingConfig | null>;

export type UsageLogResult =
  | { kind: 'logged' }
  | { kind: 'already_logged' }
  | { kind: 'failed'; error: string };

export type UsageLogger = (input: LogProviderUsageInput) => Promise<UsageLogResult>;

export type ProviderDispatcher = (
  provider: WebSearchProviderKey,
  input: WebSearchInput,
  maxResults: number,
) => Promise<WebSearchOutput>;

export type TavilyUsageDeps = {
  loadPricing: PricingLoader;
  logUsage: UsageLogger;
  dispatchQuery: ProviderDispatcher;
};

// ─── Error de pricing ─────────────────────────────────────────────────────────

export class TavilyPricingUnavailableError extends Error {
  readonly code = 'TAVILY_PRICING_UNAVAILABLE' as const;
  constructor(msg?: string) {
    super(msg ?? 'Tavily pricing configuration unavailable or invalid');
    this.name = 'TavilyPricingUnavailableError';
  }
}

// ─── Helpers puros ────────────────────────────────────────────────────────────

/**
 * Clave determinística de uso por ronda.
 * Formato: tavily:{batchId}:multi_query:round:{roundNumber}
 * Misma ronda + mismo lote → misma clave. Impide doble conteo.
 */
export function buildTavilyUsageKey(batchId: string, roundNumber: number): string {
  return `tavily:${batchId}:multi_query:round:${roundNumber}`;
}

/**
 * Créditos por query según profundidad de búsqueda.
 * Tavily billing: basic → 1 crédito, advanced → 2 créditos.
 * SellUp mapea: 'deep' → advanced (2), todo lo demás → basic (1).
 */
export function creditsForSearchDepth(searchDepth: string | undefined): number {
  return searchDepth === 'deep' ? 2 : 1;
}

/**
 * Valida la configuración de pricing.
 * Lanza TavilyPricingUnavailableError si no es válida.
 */
export function validateTavilyPricing(
  config: ActivePricingConfig | null,
): asserts config is ActivePricingConfig {
  if (!config) {
    throw new TavilyPricingUnavailableError('No active pricing config for tavily/multi_query_web_search/per_credit');
  }
  if (config.unit !== 'per_credit') {
    throw new TavilyPricingUnavailableError(`Incompatible pricing unit: ${config.unit}`);
  }
  if (!Number.isFinite(config.unitCostUsd) || config.unitCostUsd < 0) {
    throw new TavilyPricingUnavailableError(`Invalid unitCostUsd: ${config.unitCostUsd}`);
  }
}

// ─── Cálculo de estado agregado ───────────────────────────────────────────────

type AggregateStatusResult = {
  status: ProviderUsageStatus;
  errorCode: string | null;
};

/**
 * Determina el status del log a partir de los resultados de todas las queries.
 *
 * Al menos una exitosa → 'success' (con partial_failure en metadata si hubo fallos).
 * Todas fallidas con HTTP 429 → 'rate_limited'.
 * Todas fallidas por quota → 'quota_exceeded'.
 * Resto → 'error'.
 */
export function computeAggregateStatus(queryResults: MultiQueryQueryResult[]): AggregateStatusResult {
  const failed = queryResults.filter((q) => q.skipped);

  if (failed.length === 0) return { status: 'success', errorCode: null };

  // Al menos una exitosa: success con partial_failure en metadata
  const successful = queryResults.filter((q) => !q.skipped);
  if (successful.length > 0) return { status: 'success', errorCode: null };

  // Todas fallidas — determinar causa dominante
  const reasons = failed.map((q) => q.skipReason ?? '');
  const hasRateLimit = reasons.some((r) => r.includes('429') || r.includes('rate_limit'));
  const hasQuota = reasons.some((r) => r.includes('quota'));

  if (hasRateLimit) return { status: 'rate_limited', errorCode: 'tavily_rate_limited' };
  if (hasQuota) return { status: 'quota_exceeded', errorCode: 'tavily_quota_exceeded' };
  return { status: 'error', errorCode: 'tavily_all_queries_failed' };
}

// ─── Logger real con manejo de 23505 ─────────────────────────────────────────

function tryGetAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key);
}

/**
 * Inserta un registro en provider_usage_logs con manejo de conflicto por usage_key.
 *
 * - SQLSTATE 23505 en usage_key → ya_registrado (already_logged), no error.
 * - Otros errores → failed.
 * - real_cost_usd nunca se escribe.
 */
export async function realLogTavilyUsage(input: LogProviderUsageInput): Promise<UsageLogResult> {
  try {
    const admin = tryGetAdminClient();
    if (!admin) return { kind: 'failed', error: 'Supabase not configured' };

    const { error } = await admin.from('provider_usage_logs').insert({
      agent_run_id: input.agent_run_id ?? null,
      agent_run_step_id: input.agent_run_step_id ?? null,
      batch_id: input.batch_id ?? null,
      usage_key: input.usage_key ?? null,
      provider_key: input.provider_key,
      operation_key: input.operation_key,
      model: input.model ?? null,
      input_tokens: input.input_tokens ?? 0,
      output_tokens: input.output_tokens ?? 0,
      credits_used: input.credits_used ?? null,
      results_returned: input.results_returned ?? 0,
      estimated_cost_usd: input.estimated_cost_usd ?? 0,
      real_cost_usd: null,
      status: input.status ?? 'success',
      error_code: input.error_code ?? null,
      error_message: input.error_message ? input.error_message.slice(0, 500) : null,
      duration_ms: input.duration_ms ?? null,
      triggered_by: input.triggered_by ?? null,
      metadata: input.metadata ?? {},
    });

    if (!error) return { kind: 'logged' };

    if (error.code === '23505') {
      return { kind: 'already_logged' };
    }

    return { kind: 'failed', error: error.message };
  } catch (err: unknown) {
    return {
      kind: 'failed',
      error: err instanceof Error ? err.message : 'unknown logging error',
    };
  }
}

// ─── LinkedIn Usage Logger Adapter (v1.15.8-pre) ─────────────────────────────

/**
 * Fábrica que retorna un LinkedInUsageLoggerFn conectado a realLogTavilyUsage.
 *
 * Mapea LinkedInUsageLogPayload → LogProviderUsageInput y delega en el logger
 * real (o en el override inyectado para tests).
 *
 * Reglas:
 *   - batch_id null → lanza error antes de llamar al logger (Guard pre-call).
 *   - already_logged → resuelve sin lanzar (idempotencia 23505).
 *   - failed → lanza error sanitizado; el caller (runControlledLinkedInCompanySearch)
 *     lo captura y registra en batchMeta.usage_log_errors.
 *   - query completa NO se persiste; solo query_length (evita ruido/sensibilidad).
 *
 * TODO(v1.15.8): verificar que provider_pricing_config tenga row activa con
 *   operation_key='linkedin_company_search' o reutilizar 'multi_query_web_search'.
 *   unitCostUsd se resuelve en el caller vía usageContext, no en este adapter.
 *
 * @param userId  Fallback de triggered_by cuando payload.user_id es null/undefined.
 * @param logUsageOverride  Inyectable solo para tests — omitir en producción.
 */
export function createLinkedInUsageLoggerFn(
  userId?: string | null,
  logUsageOverride?: (input: LogProviderUsageInput) => Promise<UsageLogResult>,
): LinkedInUsageLoggerFn {
  const logUsage = logUsageOverride ?? realLogTavilyUsage;

  return async (payload: LinkedInUsageLogPayload): Promise<void> => {
    if (!payload.batch_id) {
      throw new Error('missing_batch_id_for_linkedin_usage_log');
    }

    const input: LogProviderUsageInput = {
      batch_id: payload.batch_id,
      usage_key: payload.usage_key,
      provider_key: payload.provider,
      operation_key: payload.feature,
      results_returned: payload.result_count,
      estimated_cost_usd: payload.estimated_cost_usd ?? 0,
      status: payload.status === 'success' ? 'success' : 'error',
      triggered_by: payload.user_id ?? userId ?? undefined,
      metadata: {
        feature: payload.feature,
        agent: payload.agent,
        candidate_name: payload.candidate_name,
        candidate_domain: payload.candidate_domain,
        search_depth: payload.search_depth,
        max_results: payload.max_results,
        selected_status: payload.selected_status,
        selected_url: payload.selected_url,
        query_length: payload.query.length,
      },
    };

    const result = await logUsage(input);

    if (result.kind === 'failed') {
      throw new Error(`linkedin_usage_log_failed: ${result.error.slice(0, 100)}`);
    }
    // 'logged' and 'already_logged' both resolve successfully
  };
}
