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
  isMissingProviderUsageCorrelationColumnError,
  RUN_CORRELATION_METADATA_KEY,
  type RunCorrelationMetadata,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-correlation';
import type { ApolloUsageOperationContextMetadata } from './apollo-usage-operation-context';
import { APOLLO_SPEND_OBSERVABILITY_KEY as APOLLO_SPEND_OBSERVABILITY_METADATA_KEY } from './apollo-spend-observability';

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
  /**
   * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX § 2: ronda, operación y sujeto de
   * ESTA llamada.
   *
   * Aterriza en `metadata` (no en columnas: la migración 100 no añadió
   * `round_number` ni `operation_subject`, y este hito no crea esquema para un
   * dato que el JSONB transporta) y además entra en el `usage_key`, para que la
   * búsqueda de la ronda 1 y la de la ronda 2 no puedan colapsar en la misma
   * clave y hacer que la segunda se lea como `already_logged` cuando en realidad
   * hubo un segundo cargo.
   *
   * Ausente en todos los llamadores previos ⇒ nada cambia para ellos.
   */
  operationContext?: ApolloUsageOperationContextMetadata | null;
};

export type ApolloOrgsUsageLogResult =
  | { kind: 'logged'; correlationColumnsFallback?: true }
  | { kind: 'already_logged'; correlationColumnsFallback?: true }
  | { kind: 'failed'; error: string }
  | { kind: 'skipped_no_supabase' };

/** Shape of the DB error this module reasons about. */
export type ProviderUsageInsertError = { message: string; code?: string };

/**
 * Minimal insert surface. Narrow on purpose: the real admin client satisfies it,
 * and a test can satisfy it without a database or a module mock.
 */
export type ProviderUsageInsertClient = {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: ProviderUsageInsertError | null }>;
  };
};

export type ApolloOrgsUsageLogDeps = {
  /** Injected DB client. Defaults to the service-role admin client. */
  client?: ProviderUsageInsertClient | null;
  /** Injected sink for the fallback signal. Defaults to console.warn. */
  warn?: (signal: string, detail: Record<string, unknown>) => void;
};

/**
 * Stable signal emitted when the correlation columns turned out not to exist.
 *
 * Grep-able on purpose: it is the one observable difference between "the columns
 * are live" and "the flag is on but migration 100 has not been applied here".
 */
export const CORRELATION_COLUMNS_FALLBACK_SIGNAL =
  'provider_usage_log.correlation_columns_missing.fallback_to_metadata' as const;

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
 * A1-APOLLO-BUDGET-RECONCILIATION-1: extrae la correlación que el provider dejó
 * en `metadata.run_correlation` y la proyecta a las columnas de la migración 100.
 *
 * Devuelve `{}` cuando el flag está apagado (el caso por defecto, y el único
 * válido mientras la migración no esté aplicada) o cuando no hay correlación.
 * `batch_id` no se proyecta: ya es una columna propia del insert.
 */
export function buildCorrelationColumns(metadata: unknown): Record<string, unknown> {
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
    billing_state: resolveProviderUsageBillingState(metadata),
  };
}

/**
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 9 — un solo estado de cobro por fila.
 *
 * El defecto observado: las filas de `organizations_search` llevaban
 * `metadata.spend_observability.billing_state = 'recorded'` y, al mismo tiempo,
 * `provider_usage_logs.billing_state = NULL`. Dos representaciones del mismo
 * hecho, una vacía.
 *
 * Precedencia: lo que la correlación de la corrida declare gana; si no declara
 * nada, se adopta lo que la observabilidad de gasto de ESA MISMA fila observó.
 * Ninguna de las dos se inventa: sin ninguna, queda null.
 *
 * No hace backfill: sólo gobierna filas nuevas.
 */
export function resolveProviderUsageBillingState(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const root = metadata as Record<string, unknown>;

  const correlation = root[RUN_CORRELATION_METADATA_KEY];
  if (correlation && typeof correlation === 'object') {
    const declared = (correlation as Partial<RunCorrelationMetadata>).billing_state;
    if (typeof declared === 'string' && declared.trim() !== '') return declared;
  }

  const spend = root[APOLLO_SPEND_OBSERVABILITY_METADATA_KEY];
  if (spend && typeof spend === 'object') {
    const observed = (spend as Record<string, unknown>)['billing_state'];
    if (typeof observed === 'string' && observed.trim() !== '') return observed;
  }

  return null;
}

/**
 * The row as it can always be inserted — every column here predates migration
 * 100. `metadata` carries the full correlation, so this row alone is enough to
 * reconcile the run.
 */
export function buildProviderUsageLogRow(
  input: LogProviderUsageInput,
): Record<string, unknown> {
  // § 9 — el estado de cobro resuelto viaja SIEMPRE en el metadata, exista o no
  // la columna. Con las columnas de correlación apagadas, ésta es la única
  // representación disponible, y dejarla implícita es lo que produjo una fila
  // con `spend_observability.billing_state = 'recorded'` y la columna en NULL.
  const resolvedBillingState = resolveProviderUsageBillingState(input.metadata);
  const metadata =
    resolvedBillingState === null
      ? (input.metadata ?? {})
      : { ...(input.metadata ?? {}), provider_usage_billing_state: resolvedBillingState };

  return {
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
    metadata,
  };
}

function defaultWarn(signal: string, detail: Record<string, unknown>): void {
  console.warn(signal, detail);
}

/**
 * Inserts one provider_usage_logs row, surviving a not-yet-applied migration 100.
 *
 * 23505 handling: a usage_key that already exists is `already_logged`, not an
 * error — that is what makes logging idempotent. `real_cost_usd` is never
 * written; it stays NULL until an external statement reconciles it.
 *
 * Why the retry exists: with the columns flag on but the migration unapplied,
 * the insert fails on an unknown column and the usage log is lost — losing
 * precisely the spend record this milestone exists to reconcile, after the
 * credits were already charged. So a missing correlation column downgrades the
 * row to its always-insertable form and writes it. The correlation is not lost
 * either: it is in `metadata.run_correlation` in both shapes.
 *
 * What it deliberately does not do:
 *   - retry any other error (permissions, constraints, connection). Those are
 *     returned as failures, loudly;
 *   - retry more than once, or call the provider again. The first insert never
 *     created a row, and `usage_key` uniqueness catches a genuine duplicate as
 *     `already_logged`.
 */
export async function realLogApolloOrgsUsage(
  input: LogProviderUsageInput,
  deps?: ApolloOrgsUsageLogDeps,
): Promise<ApolloOrgsUsageLogResult> {
  try {
    const client = deps?.client ?? (tryGetAdminClient() as ProviderUsageInsertClient | null);
    if (!client) return { kind: 'skipped_no_supabase' };

    const baseRow = buildProviderUsageLogRow(input);
    const correlationColumns = buildCorrelationColumns(input.metadata);
    const correlationColumnNames = Object.keys(correlationColumns);

    const { error } = await client
      .from('provider_usage_logs')
      .insert({ ...correlationColumns, ...baseRow });

    if (!error) return { kind: 'logged' };
    if (error.code === '23505') return { kind: 'already_logged' };

    const canStripCorrelationColumns =
      correlationColumnNames.length > 0 &&
      isMissingProviderUsageCorrelationColumnError(error);
    if (!canStripCorrelationColumns) return { kind: 'failed', error: error.message };

    // Sanitized on purpose: schema-level facts only — no query text, no
    // organization payload, no credentials, no raw error body.
    (deps?.warn ?? defaultWarn)(CORRELATION_COLUMNS_FALLBACK_SIGNAL, {
      provider_key: input.provider_key,
      operation_key: input.operation_key,
      error_code: error.code ?? null,
      stripped_columns: correlationColumnNames,
      correlation_preserved_in: `metadata.${RUN_CORRELATION_METADATA_KEY}`,
    });

    const retry = await client.from('provider_usage_logs').insert(baseRow);
    if (!retry.error) return { kind: 'logged', correlationColumnsFallback: true };
    if (retry.error.code === '23505') {
      return { kind: 'already_logged', correlationColumnsFallback: true };
    }
    return { kind: 'failed', error: retry.error.message };
  } catch (err: unknown) {
    return {
      kind: 'failed',
      error: err instanceof Error ? err.message : 'unknown logging error',
    };
  }
}
