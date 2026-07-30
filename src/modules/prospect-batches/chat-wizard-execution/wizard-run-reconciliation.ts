/**
 * wizard-run-reconciliation.ts — Correlation-based credit reconciliation.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§6).
 *
 * Replaces the single-operation reader in `wizard-budget-reconciliation.ts`
 * (`provider_key = 'tavily' AND operation_key = 'multi_query_web_search'`), which
 * returned zero rows for every Apollo run and therefore fell through to
 * "confirm the reservation" — the reason batch
 * `7a75df68-aaa2-4558-9118-0846486a3e97` confirmed 3 credits while its logs
 * recorded 4.
 *
 * Guarantees:
 *   - Queries by run identifiers, never by `created_at`.
 *   - Search AND enrichment reconcile against the SAME reservation.
 *   - Idempotent: re-running produces the same numbers.
 *   - Works with `agentRunId = null`.
 *   - Works when zero candidates were created.
 *   - Works before migration 100 (correlation read from `metadata.run_correlation`).
 *
 * The DB read is injected; the decision logic is pure.
 */

import {
  extractUsageLogIdentity,
  isUsageLogAttributableToRun,
  type WizardRunCorrelation,
} from './wizard-run-correlation';
import {
  buildRunEconomicSummary,
  inferBillingState,
  isProviderBillingState,
  summarizeRecordedUsage,
  RECONCILABLE_APOLLO_OPERATION_KEYS,
  type ConfirmedProviderEvidence,
  type RecordedUsageSummary,
  type RunEconomicSummary,
  type RunUsageLogRecord,
} from './wizard-economic-contract';

/** Columns the reader selects. All exist today — no migration required. */
export const RUN_USAGE_LOG_SELECT =
  'id, usage_key, provider_key, operation_key, credits_used, status, batch_id, metadata';

/** Raw row shape as returned by Supabase. */
export type RunUsageLogRow = {
  id: string;
  usage_key?: string | null;
  provider_key?: string | null;
  operation_key?: string | null;
  credits_used?: number | string | null;
  status?: string | null;
  batch_id?: string | null;
  /** Present only after migration 100 has been applied. */
  reservation_id?: string | null;
  client_request_id?: string | null;
  billing_state?: string | null;
  metadata?: unknown;
};

type UsageLogQueryResult = { data: RunUsageLogRow[] | null; error: { message: string } | null };
type UsageLogInBuilder = Promise<UsageLogQueryResult>;
type UsageLogEqBuilder = { in(col: string, values: readonly string[]): UsageLogInBuilder };
type UsageLogSelectBuilder = { eq(col: string, val: string): UsageLogEqBuilder };

export type RunUsageLogDbClient = {
  from(table: string): { select(columns: string): UsageLogSelectBuilder };
};

/** `credits_used` arrives as a numeric string from PostgREST. */
function parseCredits(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Maps a raw row to the reconciliation projection. Drops nothing silently. */
export function toRunUsageLogRecord(row: RunUsageLogRow): RunUsageLogRecord {
  return {
    id: row.id,
    usageKey: row.usage_key ?? null,
    providerKey: row.provider_key ?? 'unknown',
    operationKey: row.operation_key ?? 'unknown',
    creditsUsed: parseCredits(row.credits_used),
    status: row.status ?? 'unknown',
    billingState: isProviderBillingState(row.billing_state) ? row.billing_state : null,
  };
}

export type ReadRunUsageLogsResult =
  | { status: 'ok'; logs: RunUsageLogRecord[]; rowsScanned: number; rowsRejected: number }
  | { status: 'unavailable'; reason: string };

/**
 * Reads every usage log attributable to the run.
 *
 * `batch_id` is the query key because it is the only correlation identifier that
 * already exists as a column on `provider_usage_logs`. Attribution is then
 * decided by the pure identifier predicate, so a row stamped with a different
 * reservation or client request is rejected even when it shares the batch.
 *
 * A DB error returns `unavailable` rather than an empty list — "could not read"
 * and "read nothing" lead to different reconciliation outcomes and must not be
 * conflated.
 */
export async function readRunUsageLogs(
  correlation: WizardRunCorrelation,
  db: RunUsageLogDbClient,
  options?: { operationKeys?: readonly string[] },
): Promise<ReadRunUsageLogsResult> {
  const operationKeys =
    options?.operationKeys ?? (RECONCILABLE_APOLLO_OPERATION_KEYS as readonly string[]);

  let result: UsageLogQueryResult;
  try {
    result = await db
      .from('provider_usage_logs')
      .select(RUN_USAGE_LOG_SELECT)
      .eq('batch_id', correlation.batchId)
      .in('operation_key', operationKeys);
  } catch (error: unknown) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message.slice(0, 200) : 'usage_log_read_threw',
    };
  }

  if (result.error) {
    return { status: 'unavailable', reason: result.error.message.slice(0, 200) };
  }
  if (!result.data) {
    return { status: 'unavailable', reason: 'usage_log_read_returned_no_data' };
  }

  const logs: RunUsageLogRecord[] = [];
  let rowsRejected = 0;
  for (const row of result.data) {
    if (isUsageLogAttributableToRun(extractUsageLogIdentity(row), correlation)) {
      logs.push(toRunUsageLogRecord(row));
    } else {
      rowsRejected += 1;
    }
  }

  return { status: 'ok', logs, rowsScanned: result.data.length, rowsRejected };
}

// ── Pure reconciliation ──────────────────────────────────────────────────────

export type ReconcileRunCreditsInput = {
  estimatedCredits: number;
  logsRead: ReadRunUsageLogsResult;
  confirmedProviderEvidence?: ConfirmedProviderEvidence | null;
  executionFailed?: boolean;
};

export type ReconcileRunCreditsOutput = {
  summary: RunEconomicSummary;
  recorded: RecordedUsageSummary;
  /** True when the usage-log read itself failed. */
  usageLogsUnavailable: boolean;
  usageLogsUnavailableReason: string | null;
};

/**
 * Turns a usage-log read into the reservation decision.
 *
 * When the read is unavailable the run is treated as "indeterminate spend", not
 * as "zero spend": real Apollo credits may already be gone.
 */
export function reconcileRunCredits(
  input: ReconcileRunCreditsInput,
): ReconcileRunCreditsOutput {
  const usageLogsUnavailable = input.logsRead.status === 'unavailable';
  const logs = input.logsRead.status === 'ok' ? input.logsRead.logs : [];

  const recorded = usageLogsUnavailable
    ? // An unreadable log table means indeterminate, not free.
      {
        ...summarizeRecordedUsage([]),
        unknownBillingLogCount: 1,
        hasIndeterminateSpend: true,
        isEmpty: false,
      }
    : summarizeRecordedUsage(logs);

  const summary = buildRunEconomicSummary({
    estimatedCredits: input.estimatedCredits,
    recorded,
    confirmedProviderEvidence: input.confirmedProviderEvidence ?? null,
    executionFailed: input.executionFailed,
  });

  return {
    summary,
    recorded,
    usageLogsUnavailable,
    usageLogsUnavailableReason:
      input.logsRead.status === 'unavailable' ? input.logsRead.reason : null,
  };
}

/** Re-exported so consumers need only this module for reconciliation. */
export { inferBillingState, summarizeRecordedUsage, buildRunEconomicSummary };
