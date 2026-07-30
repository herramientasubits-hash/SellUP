/**
 * wizard-economic-contract.ts — Keeps the three credit concepts separate.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§4, §6).
 *
 *   estimatedCredits         Conservative ceiling reserved BEFORE executing.
 *   recordedUsageCredits     Sum of internal logs unambiguously attributable to the run.
 *   confirmedProviderCredits Credits confirmed by reliable EXTERNAL provider evidence.
 *                            May stay `null` (unknown) forever.
 *
 * The defect this closes: the previous reconciliation treated an internal
 * `credits_used` sum as if it were a settled charge, and when it could not read
 * one it silently confirmed the reserved amount instead. In A1-APOLLO-LIVE-QA-1
 * that produced `credits_reserved = 3`, `credits_consumed = 3` while the internal
 * logs recorded 4 — an excess that was hidden rather than surfaced.
 *
 * `recordedUsageCredits` is NEVER promoted to `confirmedProviderCredits`
 * automatically. Only an explicit external-evidence input can set the latter.
 *
 * Pure: no I/O, no env, no Supabase, no clock.
 */

import {
  APOLLO_BILLABLE_OPERATION_KEYS,
  type ApolloBillableOperationKey,
} from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';

/** Operations reconciliation is allowed to attribute spend from. */
export const RECONCILABLE_APOLLO_OPERATION_KEYS: readonly ApolloBillableOperationKey[] =
  APOLLO_BILLABLE_OPERATION_KEYS;

/**
 * Whether a single logged call actually resulted in a charge.
 *   charged      → the provider billed for it.
 *   not_charged  → provably free (skipped, flag off, cache hit, pre-call failure).
 *   unknown      → indeterminate; MUST NOT be silently treated as either.
 */
export type ProviderBillingState = 'charged' | 'not_charged' | 'unknown';

export const PROVIDER_BILLING_STATES: readonly ProviderBillingState[] = [
  'charged',
  'not_charged',
  'unknown',
];

export function isProviderBillingState(
  value: unknown,
): value is ProviderBillingState {
  return (
    typeof value === 'string' &&
    (PROVIDER_BILLING_STATES as readonly string[]).includes(value)
  );
}

/** Minimal projection of a usage log needed to reconcile. No timestamps. */
export type RunUsageLogRecord = {
  /** Row id — the dedupe fallback when `usageKey` is null. */
  id: string;
  /** Unique per (run, operation, discriminator); the real idempotency anchor. */
  usageKey: string | null;
  providerKey: string;
  operationKey: string;
  /** `null` means the log did not record a credit amount — indeterminate. */
  creditsUsed: number | null;
  status: string;
  billingState: ProviderBillingState | null;
};

export type RecordedUsageSummary = {
  recordedUsageCredits: number;
  chargedLogCount: number;
  notChargedLogCount: number;
  /** Logs whose billing outcome could not be determined. */
  unknownBillingLogCount: number;
  /** Duplicate rows collapsed by `usageKey` — retries must not double-count. */
  deduplicatedLogCount: number;
  /** Rows dropped because the operation is not reconcilable here. */
  ignoredOperationCount: number;
  perOperationCredits: Record<string, number>;
  /** True when at least one attributable log had indeterminate billing. */
  hasIndeterminateSpend: boolean;
  /** True when no attributable log was found at all. */
  isEmpty: boolean;
};

/**
 * Derives the billing state of a log when the writer did not stamp one.
 *
 * Conservative by design:
 *   - a positive recorded credit count means the call happened and was billed;
 *   - an explicit 0 on a successful call means provably free;
 *   - a failed/rate-limited call with 0 credits is free (nothing was served);
 *   - anything else — notably `credits_used = null` — is `unknown`, never 0.
 */
export function inferBillingState(
  log: Pick<RunUsageLogRecord, 'creditsUsed' | 'status' | 'billingState'>,
): ProviderBillingState {
  if (log.billingState !== null && isProviderBillingState(log.billingState)) {
    return log.billingState;
  }
  if (log.creditsUsed === null || !Number.isFinite(log.creditsUsed)) return 'unknown';
  if (log.creditsUsed > 0) return 'charged';
  return 'not_charged';
}

export type SummarizeRecordedUsageOptions = {
  /** Operations to reconcile. Defaults to the Apollo billable set. */
  allowedOperationKeys?: readonly string[];
};

/**
 * Collapses attributable logs into a recorded-usage summary.
 *
 * Idempotent: running it again over the same rows — or over rows that include a
 * retry of the same `usageKey` — yields the same credit total. Each successful
 * log is counted exactly once; failed calls with no charge add nothing.
 */
export function summarizeRecordedUsage(
  logs: readonly RunUsageLogRecord[],
  options?: SummarizeRecordedUsageOptions,
): RecordedUsageSummary {
  const allowed =
    options?.allowedOperationKeys ?? (RECONCILABLE_APOLLO_OPERATION_KEYS as readonly string[]);

  const seenKeys = new Set<string>();
  let recordedUsageCredits = 0;
  let chargedLogCount = 0;
  let notChargedLogCount = 0;
  let unknownBillingLogCount = 0;
  let deduplicatedLogCount = 0;
  let ignoredOperationCount = 0;
  let attributableLogCount = 0;
  const perOperationCredits: Record<string, number> = {};

  for (const log of logs) {
    if (!allowed.includes(log.operationKey)) {
      ignoredOperationCount += 1;
      continue;
    }

    // usage_key is the idempotency anchor; fall back to the row id so a null key
    // never collapses two genuinely distinct calls into one.
    const dedupeKey = log.usageKey !== null && log.usageKey.trim() !== ''
      ? `key:${log.usageKey.trim()}`
      : `row:${log.id}`;
    if (seenKeys.has(dedupeKey)) {
      deduplicatedLogCount += 1;
      continue;
    }
    seenKeys.add(dedupeKey);
    attributableLogCount += 1;

    const billingState = inferBillingState(log);
    if (billingState === 'charged') {
      chargedLogCount += 1;
      const credits = Number.isFinite(log.creditsUsed) ? (log.creditsUsed as number) : 0;
      recordedUsageCredits += credits;
      perOperationCredits[log.operationKey] =
        (perOperationCredits[log.operationKey] ?? 0) + credits;
    } else if (billingState === 'not_charged') {
      notChargedLogCount += 1;
    } else {
      unknownBillingLogCount += 1;
    }
  }

  return {
    recordedUsageCredits,
    chargedLogCount,
    notChargedLogCount,
    unknownBillingLogCount,
    deduplicatedLogCount,
    ignoredOperationCount,
    perOperationCredits,
    hasIndeterminateSpend: unknownBillingLogCount > 0,
    isEmpty: attributableLogCount === 0,
  };
}

// ── Run economic summary ─────────────────────────────────────────────────────

/**
 * Reconciliation outcome. Reuses the vocabulary the reservation lifecycle
 * already speaks (`confirmed` / `released`) and adds the two states the previous
 * implementation had no way to express.
 */
export type RunReconciliationState =
  | 'confirmed'
  | 'pending_reconciliation'
  | 'billing_unknown'
  | 'failed'
  | 'released';

export type RunEconomicAnomaly =
  /** Internal logs recorded more spend than was reserved. */
  | 'recorded_exceeds_reserved'
  /** At least one attributable log had indeterminate billing. */
  | 'indeterminate_spend'
  /** Nothing attributable was found, so spend cannot be verified either way. */
  | 'no_attributable_usage_logs';

export type ConfirmedProviderEvidence = {
  /** Credits the provider itself confirmed. */
  confirmedProviderCredits: number;
  /** Where the confirmation came from — an invoice id, an export, a ticket. */
  evidenceSource: string;
};

export type RunEconomicSummaryInput = {
  estimatedCredits: number;
  recorded: RecordedUsageSummary;
  /**
   * External confirmation. Absent (the normal case) leaves
   * `confirmedProviderCredits = null`; internal logs never fill this in.
   */
  confirmedProviderEvidence?: ConfirmedProviderEvidence | null;
  /** True when the pipeline itself failed, independent of spend. */
  executionFailed?: boolean;
};

export type RunEconomicSummary = {
  estimatedCredits: number;
  recordedUsageCredits: number;
  /** `null` = unknown. Never derived from internal logs. */
  confirmedProviderCredits: number | null;
  confirmedProviderEvidenceSource: string | null;
  /** Amount to hand to `confirm_wizard_credits`. */
  creditsToConfirm: number;
  reconciliationState: RunReconciliationState;
  anomalies: readonly RunEconomicAnomaly[];
  /** True when no further paid operation may run inside this run. */
  blockFurtherPaidOperations: boolean;
  /** True only when recorded spend is exact, complete and within the reservation. */
  isExact: boolean;
};

/**
 * Combines the three concepts into the decision the wizard acts on.
 *
 * Precedence:
 *   1. Recorded > reserved → keep the recorded spend, raise
 *      `recorded_exceeds_reserved`, block further paid operations. The excess is
 *      never hidden by clamping consumption down to the reservation.
 *   2. Indeterminate spend → `billing_unknown`; confirm the conservative maximum
 *      of recorded and reserved, and never call the reservation exact.
 *   3. No attributable logs → `billing_unknown`; confirm the reservation, because
 *      "no log" can also mean "logging failed after real spend".
 *   4. Otherwise → `confirmed` with exactly what was recorded. Reserved-but-unused
 *      credits (e.g. an enrichment the gates skipped) are simply not consumed.
 */
export function buildRunEconomicSummary(
  input: RunEconomicSummaryInput,
): RunEconomicSummary {
  const estimatedCredits = Number.isFinite(input.estimatedCredits)
    ? Math.max(0, input.estimatedCredits)
    : 0;
  const { recordedUsageCredits } = input.recorded;

  const confirmedProviderCredits =
    input.confirmedProviderEvidence?.confirmedProviderCredits ?? null;
  const confirmedProviderEvidenceSource =
    input.confirmedProviderEvidence?.evidenceSource ?? null;

  const anomalies: RunEconomicAnomaly[] = [];
  if (recordedUsageCredits > estimatedCredits) anomalies.push('recorded_exceeds_reserved');
  if (input.recorded.hasIndeterminateSpend) anomalies.push('indeterminate_spend');
  if (input.recorded.isEmpty) anomalies.push('no_attributable_usage_logs');

  const overspent = anomalies.includes('recorded_exceeds_reserved');

  let creditsToConfirm: number;
  let reconciliationState: RunReconciliationState;

  if (overspent) {
    creditsToConfirm = recordedUsageCredits;
    reconciliationState = 'pending_reconciliation';
  } else if (input.recorded.hasIndeterminateSpend) {
    creditsToConfirm = Math.max(recordedUsageCredits, estimatedCredits);
    reconciliationState = 'billing_unknown';
  } else if (input.recorded.isEmpty) {
    creditsToConfirm = estimatedCredits;
    reconciliationState = 'billing_unknown';
  } else {
    creditsToConfirm = recordedUsageCredits;
    reconciliationState = 'confirmed';
  }

  if (input.executionFailed === true && reconciliationState === 'confirmed') {
    reconciliationState = 'failed';
  }

  return {
    estimatedCredits,
    recordedUsageCredits,
    confirmedProviderCredits,
    confirmedProviderEvidenceSource,
    creditsToConfirm,
    reconciliationState,
    anomalies,
    blockFurtherPaidOperations: overspent,
    isExact: anomalies.length === 0,
  };
}

/** Flat, secret-free metadata shape for reservation/batch logs. */
export function toRunEconomicSummaryMetadata(
  summary: RunEconomicSummary,
): Record<string, number | string | boolean | null> {
  return {
    estimated_credits: summary.estimatedCredits,
    recorded_usage_credits: summary.recordedUsageCredits,
    confirmed_provider_credits: summary.confirmedProviderCredits,
    confirmed_provider_evidence_source: summary.confirmedProviderEvidenceSource,
    credits_to_confirm: summary.creditsToConfirm,
    reconciliation_state: summary.reconciliationState,
    anomalies: summary.anomalies.length > 0 ? summary.anomalies.join(',') : null,
    block_further_paid_operations: summary.blockFurtherPaidOperations,
    is_exact: summary.isExact,
  };
}
