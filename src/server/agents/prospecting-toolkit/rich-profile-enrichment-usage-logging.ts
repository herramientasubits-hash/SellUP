/**
 * Rich Profile Enrichment Usage Logger Adapter — Agent 1 v1.16C
 *
 * Adapter que mapea RichProfileEnrichmentUsagePayload → LogProviderUsageInput
 * y delega en realLogTavilyUsage (o en override inyectado para tests).
 *
 * REGLAS:
 * - batch_id null → lanza error antes de llamar al logger (Guard pre-call).
 * - already_logged → resuelve sin lanzar (idempotencia 23505).
 * - failed → lanza error sanitizado.
 * - query completa NO se persiste; solo query_length.
 * - operation_key = 'rich_profile_enrichment' siempre.
 * - provider_key = payload.provider.
 */

import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import { realLogTavilyUsage } from './tavily-usage-logging';
import type { UsageLogResult } from './tavily-usage-logging';
import type {
  RichProfileEnrichmentUsagePayload,
  RichProfileEnrichmentUsageLoggerFn,
} from './rich-profile-enrichment';

export type { RichProfileEnrichmentUsageLoggerFn };

/**
 * Fábrica que retorna un RichProfileEnrichmentUsageLoggerFn conectado a realLogTavilyUsage.
 *
 * @param userId - Fallback de triggered_by cuando payload.user_id es null.
 * @param logUsageOverride - Inyectable solo para tests — omitir en producción.
 */
export function createRichProfileEnrichmentUsageLoggerFn(
  userId?: string | null,
  logUsageOverride?: (input: LogProviderUsageInput) => Promise<UsageLogResult>,
): RichProfileEnrichmentUsageLoggerFn {
  const logUsage = logUsageOverride ?? realLogTavilyUsage;

  return async (payload: RichProfileEnrichmentUsagePayload): Promise<void> => {
    if (!payload.batch_id) {
      throw new Error('missing_batch_id_for_rich_profile_enrichment_usage_log');
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
        query_type: payload.query_type,
        search_depth: payload.search_depth,
        max_results: payload.max_results,
        selected_status: payload.selected_status,
        selected_url: payload.selected_url,
        query_length: payload.query.length,
      },
    };

    const result = await logUsage(input);

    if (result.kind === 'failed') {
      throw new Error(`rich_profile_enrichment_usage_log_failed: ${result.error.slice(0, 100)}`);
    }
    // 'logged' and 'already_logged' both resolve successfully
  };
}
