/**
 * Agente 1 · «Competidores de una empresa» — el juez de Claude con sus
 * dependencias reales (sólo servidor): modelo y clave de Configuración → IA, cuota
 * de Claude en Proveedores y registro de uso con agente, lote y forma de búsqueda.
 *
 * Nunca lanza: sin modelo, sin cuota o con un error devuelve `null` y la corrida
 * sigue sin lo gratuito filtrado (Claude en la web hace el resto).
 */

import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { runAnthropicConversation } from './anthropic-messages-client';
import { resolveActiveAnthropicModel } from './classify-batch-candidates.server';
import { judgeCompetitors, type CompetitorJudgeInput, type CompetitorJudgeOutcome } from './competitor-judge';
import { CLAUDE_CLASSIFIER_CONTRACT_VERSION, CLAUDE_CLASSIFIER_PROVIDER_KEY } from './types';

const COMPETITOR_JUDGE_TIMEOUT_MS = 45_000;
/** Con la operación de «Claude busca empresas» (paso del agente sin migración). */
const COMPETITOR_JUDGE_OPERATION_KEY = 'company_search';

export type LiveCompetitorJudge = (
  input: CompetitorJudgeInput & { batchId: string | null; source: 'free_layer' | 'company_bank' | 'apollo' },
) => Promise<CompetitorJudgeOutcome | null>;

export function buildLiveCompetitorJudge(userId: string): LiveCompetitorJudge {
  return async (input) => {
    try {
      const active = await resolveActiveAnthropicModel();
      if ('error' in active) return null;
      if (!(await checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY)).allowed) return null;
      const startedMs = Date.now();
      const outcome = await judgeCompetitors(input, active.model, {
        runConversation: (body) =>
          runAnthropicConversation({ apiKey: active.apiKey, body, timeoutMs: COMPETITOR_JUDGE_TIMEOUT_MS }),
      });
      if (outcome.usage) {
        await logProviderUsage({
          ...(input.batchId ? { batch_id: input.batchId } : {}),
          provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
          operation_key: COMPETITOR_JUDGE_OPERATION_KEY,
          model: outcome.usage.model,
          input_tokens: outcome.usage.inputTokens,
          output_tokens: outcome.usage.outputTokens,
          results_returned: outcome.competitors.length,
          estimated_cost_usd: outcome.usage.estimatedCostUsd,
          status: outcome.errorCode ? 'error' : 'success',
          error_code: outcome.errorCode ?? undefined,
          duration_ms: Date.now() - startedMs,
          triggered_by: userId,
          search_mode: 'competitors',
          metadata: {
            contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
            flow: 'competitor_judge',
            source: input.source,
            judged: outcome.judged,
            selected: outcome.competitors.length,
            reference_company_name: input.reference.name,
            pricing_source: outcome.usage.pricingSource,
          },
        }).catch(() => false);
      }
      return outcome.errorCode ? null : outcome;
    } catch (err) {
      console.error('[competitor-judge] failed (non-critical):', err instanceof Error ? err.message : err);
      return null;
    }
  };
}
