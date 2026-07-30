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
import { parseBooleanEnvFlag } from '@/lib/env-flag-parser';

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
   * A1-APOLLO-BUDGET-RECONCILIATION-1 (§3): pre-built, secret-free correlation
   * block (`clientRequestId` + `batchId` + `reservationId`, plus the nullable
   * `wizardRunId` / `agentRunId`). Travels as a plain object so the prospecting
   * toolkit never has to import the wizard module.
   *
   * Absent for callers outside the wizard (diagnostics, benchmarks): those runs
   * keep `batch_id`-only traceability exactly as before.
   */
  runCorrelation?: Record<string, string | null> | null;
  /** Identity keys already enriched earlier in this run (cross-query). */
  processedIdentityKeys?: ReadonlySet<string>;
  /** Identity keys under a recent-activity cooldown. */
  identityCooldownKeys?: ReadonlySet<string>;
};

/**
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§3) — flag that authorises writing the
 * additive correlation COLUMNS introduced by migration 100.
 *
 * MUST stay off until that migration is applied: a PostgREST insert naming a
 * column that does not exist fails, and a failed usage-log insert AFTER a real
 * Apollo call means real credits with no record. While it is off, the same
 * identifiers are still persisted inside `metadata.run_correlation`, which needs
 * no schema change — so reconciliation works today either way.
 */
export const PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG =
  'ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS';

export function areProviderUsageCorrelationColumnsEnabled(): boolean {
  return parseBooleanEnvFlag(process.env[PROVIDER_USAGE_CORRELATION_COLUMNS_FLAG]);
}

/**
 * Usage-log input plus the optional additive-column payload.
 * `correlationColumns` is written ONLY when the flag above is on.
 */
export type ApolloOrgsUsageLogInput = LogProviderUsageInput & {
  correlationColumns?: Record<string, string | null> | null;
  /**
   * A1-APOLLO-BUDGET-RECONCILIATION-1 (§10): the observability block projected
   * onto the additive columns of migration 100 (http_status, latency_ms, page,
   * pagination_*, rate_limit_*, retry_after_seconds, estimated_credits,
   * recorded_usage_credits). Written under the SAME flag as the correlation
   * columns, and — like them — the identical data is always persisted inside
   * `metadata.spend_observability`, which needs no schema change.
   *
   * A `null` value means "not measured" and is written as SQL NULL. It is never
   * coerced to 0.
   */
  observabilityColumns?: Record<string, string | number | null> | null;
  /** `charged` | `not_charged` | `unknown` — never inferred as 0. */
  billingState?: 'charged' | 'not_charged' | 'unknown' | null;
};

export type ApolloOrgsUsageLogResult =
  | { kind: 'logged' }
  | { kind: 'already_logged' }
  | { kind: 'failed'; error: string }
  | { kind: 'skipped_no_supabase' };

/**
 * Key bajo la que el bloque de correlación viaja dentro de `metadata`.
 *
 * Se declara aquí, y no se importa del módulo del wizard, porque el toolkit de
 * prospecting no debe depender de ese módulo (la correlación llega como objeto
 * plano justamente por eso). El contrato está fijado por
 * `RUN_CORRELATION_METADATA_KEY` en wizard-run-correlation.ts y hay un test que
 * comprueba que ambos coinciden.
 */
export const APOLLO_RUN_CORRELATION_METADATA_KEY = 'run_correlation';

/** Columnas aditivas de correlación (migración 100), en orden estable. */
export const APOLLO_CORRELATION_COLUMN_KEYS = [
  'reservation_id',
  'client_request_id',
  'wizard_run_id',
  'request_fingerprint',
  'idempotency_key',
] as const;

/**
 * Proyecta el bloque plano de correlación sobre las columnas aditivas.
 *
 * Sólo copia las claves que existen como columna; `batch_id`, `agent_run_id` y
 * `provider` ya son columnas propias o metadata, así que no se duplican aquí.
 * Devuelve `null` cuando no hay correlación, para que el caller no escriba nada.
 */
export function toApolloCorrelationColumns(
  runCorrelation: Record<string, string | null> | null | undefined,
): Record<string, string | null> | null {
  if (runCorrelation === null || runCorrelation === undefined) return null;
  const columns: Record<string, string | null> = {};
  for (const key of APOLLO_CORRELATION_COLUMN_KEYS) {
    if (key in runCorrelation) columns[key] = runCorrelation[key] ?? null;
  }
  return Object.keys(columns).length > 0 ? columns : null;
}

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
export async function realLogApolloOrgsUsage(
  input: ApolloOrgsUsageLogInput,
): Promise<ApolloOrgsUsageLogResult> {
  try {
    const admin = tryGetAdminClient();
    if (!admin) return { kind: 'skipped_no_supabase' };

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
      triggered_by_role_key: null,
      triggered_by_group_id: null,
      metadata: input.metadata ?? {},
      // Additive columns from migration 100 — omitted entirely while the flag is
      // off so the insert only ever names columns that exist.
      ...(areProviderUsageCorrelationColumnsEnabled()
        ? {
            ...(input.correlationColumns ?? {}),
            ...(input.observabilityColumns ?? {}),
            ...(input.billingState !== undefined && input.billingState !== null
              ? { billing_state: input.billingState }
              : {}),
          }
        : {}),
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
