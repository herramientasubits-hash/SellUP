/**
 * apollo-organizations-usage-logging.ts — Trazabilidad económica Apollo Organizations (v1.16K-X)
 *
 * Módulo de usage logging para Agent 1 company discovery vía Apollo.
 *
 * Contiene:
 * - Tipos de contexto (ApolloOrgsUsageContext)
 * - Helper puro buildApolloOrgsUsageKey
 * - Logger real realLogApolloOrgsUsage con manejo de 23505 (idempotencia)
 *
 * REGLAS DE SEGURIDAD:
 * - Nunca imprime API keys, queries completas ni resultados de empresa.
 * - real_cost_usd siempre NULL (conciliación post-factura).
 * - usage_key único por (batchId, query-hash) previene doble conteo.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import { isProviderUsageCorrelationColumnsEnabled } from '@/lib/feature-flags.server';
import {
  RUN_CORRELATION_METADATA_KEY,
  type RunCorrelationMetadata,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/**
 * Contexto opcional de trazabilidad. Se pasa desde el orchestrator cuando disponible.
 *
 * Q3F-5AU.10S — contrato congelado de batchId:
 *   - batchId DEBE ser prospect_batches.id (UUID real y existente) o null.
 *   - NUNCA usar batchId como etiqueta humana/de test (ej. crypto.randomUUID()
 *     inventado) — provider_usage_logs.batch_id tiene FK a prospect_batches(id);
 *     un UUID bien formado pero inexistente viola la FK y el insert falla.
 *   - Para llamadas controladas/de diagnóstico sin prospect_batch real, pasar
 *     batchId: null explícitamente. buildApolloOrgsUsageKey() y
 *     realLogApolloOrgsUsage() ya soportan este caso (usage_key con sufijo
 *     "no_batch", batch_id NULL en el insert — ON DELETE SET NULL en la FK).
 */
export type ApolloOrgsUsageContext = {
  batchId?: string | null;
  agentRunId?: string | null;
  triggeredByUserId?: string | null;
  /**
   * Q3F-5AU.16: remaining Apollo organization_enrichment budget for the
   * current wizard execution (true run-level cap, accumulated across all
   * rounds/queries in incremental-search.ts). Absent → the provider falls
   * back to its own per-call cap (resolveApolloMaxEnrichmentsPerRun()),
   * preserving pre-Q3F-5AU.16 behavior.
   */
  remainingEnrichmentBudget?: number;
  /**
   * Q3F-5AU.16: live provider_pricing_config unit cost for
   * apollo/organization_enrichment/per_credit, resolved once per wizard
   * execution. null means pricing is missing — real enrichment calls are
   * blocked upstream (remainingEnrichmentBudget forced to 0) rather than
   * logging a fabricated cost.
   */
  organizationEnrichmentUnitCostUsd?: number | null;
  /**
   * A1-APOLLO-BUDGET-RECONCILIATION-1: correlación del run del wizard.
   *
   * Se escribe SIEMPRE en `metadata.run_correlation`, que no requiere cambio de
   * esquema. Las columnas equivalentes de la migración 100 sólo se escriben con
   * ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS en true — insertar una columna que
   * todavía no existe haría fallar el insert entero, y perder el log de uso es
   * perder justamente el registro de gasto que este hito busca conciliar.
   */
  runCorrelation?: RunCorrelationMetadata | null;
};

export type ApolloOrgsUsageLogResult =
  | { kind: 'logged' }
  | { kind: 'already_logged' }
  | { kind: 'failed'; error: string }
  | { kind: 'skipped_no_supabase' };

// ─── Helper puro: usage_key ───────────────────────────────────────────────────

/**
 * Clave determinística de uso.
 *
 * Con batchId: apollo_organizations:{batchId}:{querySlug}
 *   → misma llamada dentro del mismo batch → misma clave → 23505 impide doble log.
 *
 * Sin batchId: apollo_organizations:no_batch:{querySlug}:{timestampMs}
 *   → cada llamada real genera clave única (cada una consume créditos reales).
 */
export function buildApolloOrgsUsageKey(
  query: string,
  batchId: string | null | undefined,
  timestampMs: number,
): string {
  const slug = query.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 60);
  if (batchId) return `apollo_organizations:${batchId}:${slug}`;
  return `apollo_organizations:no_batch:${slug}:${timestampMs}`;
}

// ─── Admin client helper ──────────────────────────────────────────────────────

function tryGetAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key);
}

// ─── Logger real ──────────────────────────────────────────────────────────────

/**
 * Inserta un registro en provider_usage_logs para una llamada Apollo organizations_search.
 *
 * Manejo de 23505: si usage_key ya existe → already_logged (idempotente, no error).
 * real_cost_usd nunca se escribe — permanece NULL hasta conciliación.
 */
/**
 * A1-APOLLO-BUDGET-RECONCILIATION-1: extrae la correlación que el provider dejó
 * en `metadata.run_correlation` y la proyecta a las columnas de la migración 100.
 *
 * Devuelve `{}` cuando el flag está apagado (el caso por defecto, y el único
 * válido mientras la migración no esté aplicada) o cuando no hay correlación.
 * `batch_id` no se proyecta: ya es una columna propia del insert.
 */
function buildCorrelationColumns(metadata: unknown): Record<string, unknown> {
  if (!isProviderUsageCorrelationColumnsEnabled()) return {};
  if (!metadata || typeof metadata !== 'object') return {};
  const block = (metadata as Record<string, unknown>)[RUN_CORRELATION_METADATA_KEY];
  if (!block || typeof block !== 'object') return {};
  const c = block as Partial<RunCorrelationMetadata>;
  return {
    reservation_id: c.reservation_id ?? null,
    client_request_id: c.client_request_id ?? null,
    wizard_run_id: c.wizard_run_id ?? null,
    request_fingerprint: c.request_fingerprint ?? null,
    idempotency_key: c.idempotency_key ?? null,
    billing_state: c.billing_state ?? null,
  };
}

export async function realLogApolloOrgsUsage(
  input: LogProviderUsageInput,
): Promise<ApolloOrgsUsageLogResult> {
  try {
    const admin = tryGetAdminClient();
    if (!admin) return { kind: 'skipped_no_supabase' };

    const { error } = await admin.from('provider_usage_logs').insert({
      ...buildCorrelationColumns(input.metadata),
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
      triggered_by_role_key: null,
      triggered_by_group_id: null,
      metadata: input.metadata ?? {},
    });

    if (!error) return { kind: 'logged' };
    if (error.code === '23505') return { kind: 'already_logged' };

    return { kind: 'failed', error: error.message };
  } catch (err: unknown) {
    return {
      kind: 'failed',
      error: err instanceof Error ? err.message : 'unknown logging error',
    };
  }
}
