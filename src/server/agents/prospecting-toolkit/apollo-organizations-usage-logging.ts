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
 * AGENT1-LUSHA-PROVIDER-USAGE-OBSERVABILITY-1 § 2 — el MOTOR de inserción (23505,
 * degradación por columna de correlación ausente, aviso sin secretos) se EXTRAJO a
 * `@/modules/usage-tracking/correlated-provider-usage-log` para que la ruta Lusha
 * lo REUTILICE en vez de fabricar un segundo mecanismo con las mismas decisiones.
 * Aquí no cambia nada observable: los mismos nombres, las mismas firmas y el mismo
 * comportamiento. Lo que es específico de Apollo —la precedencia de `billing_state`
 * entre `run_correlation` y `spend_observability`— se queda donde vive.
 *
 * REGLAS DE SEGURIDAD:
 * - Nunca imprime API keys, queries completas ni resultados de empresa.
 * - real_cost_usd siempre NULL (conciliación post-factura).
 * - usage_key único por (batchId, query-hash) previene doble conteo.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import {
  buildCorrelationColumnsWithBillingState,
  buildProviderUsageLogRowWithBillingState,
  insertCorrelatedProviderUsageRow,
  CORRELATION_COLUMNS_FALLBACK_SIGNAL,
  type CorrelatedProviderUsageLogDeps,
  type CorrelatedProviderUsageLogResult,
  type ProviderUsageInsertClient,
  type ProviderUsageInsertError,
} from '@/modules/usage-tracking/correlated-provider-usage-log';
import {
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

/**
 * Resultado del registro. Alias del contrato NEUTRAL extraído: la misma union
 * de siempre, con UNA sola definición para las dos rutas.
 */
export type ApolloOrgsUsageLogResult = CorrelatedProviderUsageLogResult;

/** Shape of the DB error this module reasons about. */
export type { ProviderUsageInsertError };

/**
 * Minimal insert surface. Narrow on purpose: the real admin client satisfies it,
 * and a test can satisfy it without a database or a module mock.
 */
export type { ProviderUsageInsertClient };

/** Dependencias inyectables. `client` ausente ⇒ el cliente admin de service-role. */
export type ApolloOrgsUsageLogDeps = CorrelatedProviderUsageLogDeps;

/**
 * Stable signal emitted when the correlation columns turned out not to exist.
 *
 * Grep-able on purpose: it is the one observable difference between "the columns
 * are live" and "the flag is on but migration 100 has not been applied here".
 */
export { CORRELATION_COLUMNS_FALLBACK_SIGNAL };

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

// ─── Fila y columnas: lo específico de Apollo ─────────────────────────────────

/**
 * A1-APOLLO-BUDGET-RECONCILIATION-1: extrae la correlación que el provider dejó
 * en `metadata.run_correlation` y la proyecta a las columnas de la migración 100.
 *
 * Devuelve `{}` cuando el flag está apagado (el caso por defecto, y el único
 * válido mientras la migración no esté aplicada) o cuando no hay correlación.
 * `batch_id` no se proyecta: ya es una columna propia del insert.
 */
export function buildCorrelationColumns(metadata: unknown): Record<string, unknown> {
  return buildCorrelationColumnsWithBillingState(
    metadata,
    resolveProviderUsageBillingState(metadata),
  );
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
  //
  // ── P1-1 (AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1) ────────────────────────────
  //
  // 🔴 `preserveUnknownEstimatedCost` deja de estar apagado en la ruta Apollo.
  //
  // El defecto: `buildApolloEnrichmentUsageLogInput` escribe
  // `estimated_cost_usd: input.unitCostUsd ?? null` —un null EXPLÍCITO que dice
  // «no había tarifa viva, el costo es DESCONOCIDO»— y esta fila lo colapsaba a
  // 0 con `?? 0`. Un panel de gasto sumaba entonces cero dólares por operaciones
  // que sí se cobraron, y la misma fila llevaba
  // `pricing_missing_warning: true` al lado, contradiciéndose.
  //
  // El contrato que se adopta es el canónico, y es exactamente el que la ruta
  // Lusha ya usa (`lusha-provider-usage-recorder`):
  //
  //   omitido (undefined) ⇒ 0        — el defecto histórico, intacto;
  //   null EXPLÍCITO      ⇒ SQL NULL — costo desconocido, jamás 0 fabricado;
  //   número              ⇒ tal cual — 0 sigue siendo un costo CONOCIDO válido.
  //
  // Ninguna fila de `organizations_search` cambia: esa ruta siempre calcula un
  // número. Cambian las de `organization_enrichment` sin tarifa activa, que son
  // precisamente las que estaban mintiendo.
  return buildProviderUsageLogRowWithBillingState(
    input,
    resolveProviderUsageBillingState(input.metadata),
    { preserveUnknownEstimatedCost: true },
  );
}

// ─── Logger real ──────────────────────────────────────────────────────────────

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
  return insertCorrelatedProviderUsageRow(
    {
      baseRow: buildProviderUsageLogRow(input),
      correlationColumns: buildCorrelationColumns(input.metadata),
      providerKey: input.provider_key,
      operationKey: input.operation_key,
    },
    {
      client: deps?.client ?? (tryGetAdminClient() as ProviderUsageInsertClient | null),
      ...(deps?.warn ? { warn: deps.warn } : {}),
    },
  );
}
