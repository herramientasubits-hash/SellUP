/**
 * wizard-reconciliation-audit.ts — Which operations reconcile per provider, and
 * how a reconciliation outcome becomes administrative evidence.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§6).
 *
 * An overspend must not vanish. When recorded spend exceeds the reservation the
 * wizard keeps the recorded amount, blocks further paid operations and writes the
 * economic summary onto `wizard_budget_reservations.metadata` so administration can
 * find it later without replaying logs by timestamp.
 *
 * The operation allowlists live here so the reader, the writer and the pricing
 * module cannot drift apart. Names are the ones already used in the repo — no new
 * variants were invented.
 */

import { RECONCILABLE_APOLLO_OPERATION_KEYS } from './wizard-economic-contract';
import type { RunEconomicSummary } from './wizard-economic-contract';
import { toRunEconomicSummaryMetadata } from './wizard-economic-contract';
import type { WizardDiscoveryProviderKey } from './wizard-provider-resolver';
import type { WizardRunCorrelation } from './wizard-run-correlation';

/**
 * Tavily's single billable operation for wizard discovery, as written by
 * `tavily-usage-logging.ts`.
 */
export const RECONCILABLE_TAVILY_OPERATION_KEYS: readonly string[] = [
  'multi_query_web_search',
];

/**
 * Operations reconciliation must sum for a provider.
 *
 * Apollo returns BOTH `organizations_search` and `organization_enrichment`, so a
 * single reservation reconciles both — the gap that made the enrichment credit
 * invisible to the wizard.
 */
export function resolveReconcilableOperationKeys(
  provider: WizardDiscoveryProviderKey,
): readonly string[] {
  return provider === 'apollo_organizations'
    ? (RECONCILABLE_APOLLO_OPERATION_KEYS as readonly string[])
    : RECONCILABLE_TAVILY_OPERATION_KEYS;
}

// ── Administrative record ────────────────────────────────────────────────────

export type RunReconciliationOutcomeRecord = {
  correlation: WizardRunCorrelation;
  summary: RunEconomicSummary;
  /** Operations the reconciliation was allowed to attribute. */
  operationKeys: readonly string[];
  usageLogsUnavailableReason: string | null;
};

/** Key under which the outcome is stored in the reservation's metadata. */
export const RESERVATION_RECONCILIATION_METADATA_KEY = 'reconciliation';

/** Secret-free metadata payload for `wizard_budget_reservations.metadata`. */
export function buildReservationReconciliationMetadata(
  record: RunReconciliationOutcomeRecord,
): Record<string, unknown> {
  return {
    [RESERVATION_RECONCILIATION_METADATA_KEY]: {
      ...toRunEconomicSummaryMetadata(record.summary),
      provider: record.correlation.provider,
      correlation_version: record.correlation.correlationVersion,
      client_request_id: record.correlation.clientRequestId,
      batch_id: record.correlation.batchId,
      reservation_id: record.correlation.reservationId,
      wizard_run_id: record.correlation.wizardRunId,
      agent_run_id: record.correlation.agentRunId,
      reconciled_operation_keys: [...record.operationKeys].join(','),
      usage_logs_unavailable_reason: record.usageLogsUnavailableReason,
    },
  };
}

type UpdateResult = { error: { message: string } | null };
type UpdateEqBuilder = Promise<UpdateResult>;
type UpdateBuilder = { eq(col: string, val: string): UpdateEqBuilder };

export type ReservationMetadataDbClient = {
  from(table: string): { update(values: Record<string, unknown>): UpdateBuilder };
};

/**
 * Writes the outcome onto the reservation row. Never throws: reconciliation
 * bookkeeping must not turn a successful generation into a failure, and the
 * economic decision has already been applied by the time this runs.
 */
export async function recordWizardReservationReconciliation(
  record: RunReconciliationOutcomeRecord,
  db: ReservationMetadataDbClient,
): Promise<void> {
  try {
    await db
      .from('wizard_budget_reservations')
      .update({ metadata: buildReservationReconciliationMetadata(record) })
      .eq('id', record.correlation.reservationId);
  } catch {
    // Best-effort audit trail only.
  }
}
