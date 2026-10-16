/**
 * IMPORT-FREE-FORMAT-1 — la lectura con Claude con sus dependencias reales (sólo
 * servidor): modelo y clave de Configuración → IA, cuota de Claude en Proveedores
 * y registro del gasto en «Uso de IA» como forma de búsqueda «Importación».
 */

import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { runAnthropicConversation } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { CLAUDE_CLASSIFIER_PROVIDER_KEY } from '@/server/agents/prospecting-toolkit/claude-classifier/types';
import { extractImportCompaniesWithAi, type ImportAiExtractionOutcome } from './import-ai-extraction';

const IMPORT_AI_EXTRACTION_TIMEOUT_MS = 120_000;
export const IMPORT_AI_EXTRACTION_OPERATION_KEY = 'import_company_extraction';

export type LiveImportAiExtraction =
  | ImportAiExtractionOutcome
  | { rows: []; errorCode: 'claude_not_configured' | 'claude_quota_exhausted' };

export async function runLiveImportAiExtraction(text: string, userId: string): Promise<LiveImportAiExtraction> {
  const active = await resolveActiveAnthropicModel();
  if ('error' in active) return { rows: [], errorCode: 'claude_not_configured' };
  if (!(await checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY)).allowed) {
    return { rows: [], errorCode: 'claude_quota_exhausted' };
  }

  const startedMs = Date.now();
  const outcome = await extractImportCompaniesWithAi(text, active.model, {
    runConversation: (body) =>
      runAnthropicConversation({ apiKey: active.apiKey, body, timeoutMs: IMPORT_AI_EXTRACTION_TIMEOUT_MS }),
  });
  if (outcome.usage) {
    await logProviderUsage({
      provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
      operation_key: IMPORT_AI_EXTRACTION_OPERATION_KEY,
      // Sin regla en la 147 ni ejecución: quedaba «Sin agente identificado».
      agent_key: 'agent1',
      agent_step: 'importar_ia',
      model: outcome.usage.model,
      input_tokens: outcome.usage.inputTokens,
      output_tokens: outcome.usage.outputTokens,
      results_returned: outcome.rows.length,
      estimated_cost_usd: outcome.usage.estimatedCostUsd,
      status: outcome.errorCode ? 'error' : 'success',
      error_code: outcome.errorCode ?? undefined,
      duration_ms: Date.now() - startedMs,
      triggered_by: userId,
      search_mode: 'import',
      metadata: {
        flow: 'import_free_format',
        input_chars: text.length,
        input_truncated: outcome.inputTruncated,
        dropped_unverified_values: outcome.droppedUnverifiedValues,
        pricing_source: outcome.usage.pricingSource,
      },
    }).catch(() => false);
  }
  return outcome;
}
