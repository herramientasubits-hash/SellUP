/**
 * Importar archivo — detección de país con sus dependencias reales (sólo
 * servidor): modelo y clave de Configuración → IA, cuota de Claude en
 * Proveedores y registro del gasto en «Uso de IA» (forma de búsqueda
 * «Importación»). Sin modelo o sin cuota, sólo corre el paso sin IA.
 */

import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { runAnthropicConversation } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { CLAUDE_CLASSIFIER_PROVIDER_KEY } from '@/server/agents/prospecting-toolkit/claude-classifier/types';
import {
  detectCountryWithoutAi,
  detectImportCountries,
  type CountryDetectionRow,
  type ImportCountryDetectionOutcome,
} from './import-country-detection';

const IMPORT_COUNTRY_DETECTION_TIMEOUT_MS = 90_000;
export const IMPORT_COUNTRY_DETECTION_OPERATION_KEY = 'import_country_detection';

export async function runLiveImportCountryDetection(
  rows: readonly CountryDetectionRow[],
  userId: string,
): Promise<ImportCountryDetectionOutcome> {
  // Sólo se busca modelo y cuota si de verdad hay filas que el paso sin IA no resuelve.
  const needsAi = rows.some((row) => !detectCountryWithoutAi(row));
  let model: string | null = null;
  let apiKey: string | null = null;
  if (needsAi) {
    const active = await resolveActiveAnthropicModel();
    const quota = 'error' in active ? null : await checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY);
    if (!('error' in active) && quota?.allowed) {
      model = active.model;
      apiKey = active.apiKey;
    }
  }

  const startedMs = Date.now();
  const outcome = await detectImportCountries(rows, {
    model,
    runConversation:
      model && apiKey
        ? (body) => runAnthropicConversation({ apiKey: apiKey as string, body, timeoutMs: IMPORT_COUNTRY_DETECTION_TIMEOUT_MS })
        : null,
  });
  if (outcome.usage) {
    await logProviderUsage({
      provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
      operation_key: IMPORT_COUNTRY_DETECTION_OPERATION_KEY,
      agent_key: 'agent1',
      agent_step: 'importar_pais',
      model: outcome.usage.model,
      input_tokens: outcome.usage.inputTokens,
      output_tokens: outcome.usage.outputTokens,
      results_returned: outcome.detections.filter((d) => d.source === 'ai').length,
      estimated_cost_usd: outcome.usage.estimatedCostUsd,
      status: outcome.errorCode ? 'error' : 'success',
      error_code: outcome.errorCode ?? undefined,
      duration_ms: Date.now() - startedMs,
      triggered_by: userId,
      search_mode: 'import',
      metadata: { flow: 'import_country_detection', asked_ai: outcome.askedAi, pricing_source: outcome.usage.pricingSource },
    }).catch(() => false);
  }
  return outcome;
}
