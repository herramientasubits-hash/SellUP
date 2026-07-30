/**
 * wizard-run-reconciliation.ts — Reconciles what a wizard run reserved against
 * what its provider usage rows say it actually spent.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * What was wrong: `readWizardConsumedCreditsFromDb` filters on
 * `provider_key='tavily'` AND `operation_key='multi_query_web_search'`. An
 * Apollo run therefore always reconciled as "0 rows found" and fell back to
 * confirming the full reservation — which is why the QA batch's real 4 credits
 * (3 organizations_search + 1 organization_enrichment) never showed up against
 * its 3-credit reservation. The Apollo operations were simply not in the query.
 *
 * What this module adds:
 *   - both Apollo billable operations, under their canonical keys;
 *   - correlation on batch_id + reservation_id + client_request_id, never on
 *     timestamps, so two concurrent runs cannot claim each other's rows;
 *   - three separate quantities that are routinely conflated:
 *       estimatedCredits         — what preflight predicted;
 *       recordedUsageCredits     — what OUR logs recorded;
 *       confirmedProviderCredits — what the PROVIDER confirmed it billed.
 *     The third is never derived from the second. Internal accounting is not an
 *     Apollo invoice, and silently promoting it would manufacture certainty.
 *
 * Pure: takes rows, returns a verdict. No DB access, no clock, no randomness —
 * which is what makes repeated reconciliation of the same run idempotent.
 */

import { APOLLO_BILLABLE_OPERATION_KEYS } from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';
import {
  matchUsageRowToRun,
  type CorrelatableUsageRow,
  type WizardRunBillingState,
  type WizardRunCorrelation,
} from './wizard-run-correlation';

// ── Operation allowlist ──────────────────────────────────────────────────────

/** Tavily's single billable discovery operation. */
export const TAVILY_RECONCILED_OPERATIONS = ['multi_query_web_search'] as const;

/**
 * provider_usage_logs.provider_key per wizard discovery provider.
 * The wizard calls Apollo's provider `apollo_organizations`; the usage rows are
 * written under the provider account key `apollo`.
 */
const USAGE_PROVIDER_KEY_BY_DISCOVERY_PROVIDER: Readonly<Record<string, string>> = {
  apollo_organizations: 'apollo',
  tavily: 'tavily',
};

/** Operations reconciled for each usage provider key. */
const RECONCILED_OPERATIONS_BY_USAGE_PROVIDER: Readonly<Record<string, readonly string[]>> = {
  apollo: APOLLO_BILLABLE_OPERATION_KEYS,
  tavily: TAVILY_RECONCILED_OPERATIONS,
};

export function resolveUsageProviderKey(discoveryProvider: string): string | null {
  return USAGE_PROVIDER_KEY_BY_DISCOVERY_PROVIDER[discoveryProvider] ?? null;
}

export function resolveReconciledOperations(usageProviderKey: string): readonly string[] {
  return RECONCILED_OPERATIONS_BY_USAGE_PROVIDER[usageProviderKey] ?? [];
}

// ── Input / output ───────────────────────────────────────────────────────────

/** Subset of a provider_usage_logs row the reconciliation reads. */
export type ReconcilableUsageRow = CorrelatableUsageRow & {
  provider_key: string;
  operation_key: string;
  credits_used?: number | null;
  /** Unique per logged call. Used to collapse duplicates. */
  usage_key?: string | null;
  status?: string | null;
};

export type WizardRunReconciliationAnomaly =
  /** Our own logs recorded more spend than the reservation held. */
  | 'recorded_usage_exceeds_reservation'
  /** At least one matched row has a null credits_used — total unverifiable. */
  | 'usage_credits_unknown'
  /** Rows exist for this batch that belong to a different run. */
  | 'foreign_usage_rows_present'
  /** No usage row matched — logging may have failed after real spend. */
  | 'no_usage_rows_found'
  /** A row of this provider used an operation outside the reconciled set. */
  | 'unexpected_operation_for_provider';

export type WizardRunReconciliationInput = {
  correlation: WizardRunCorrelation;
  /** Wizard discovery provider key, e.g. 'apollo_organizations'. */
  discoveryProvider: string;
  /** Credits preflight predicted. */
  estimatedCredits: number;
  /** Credits the reservation actually holds. */
  reservedCredits: number;
  rows: readonly ReconcilableUsageRow[];
  /**
   * Credits an EXTERNAL provider statement confirmed. Only a real provider
   * invoice or API statement may set this — never our own usage rows.
   */
  providerConfirmedCredits?: number | null;
};

export type WizardRunReconciliationResult = {
  idempotencyKey: string;
  discoveryProvider: string;
  usageProviderKey: string | null;
  estimatedCredits: number;
  reservedCredits: number;
  /** Sum over matched rows. Null when any matched row has unknown credits. */
  recordedUsageCredits: number | null;
  /** Only ever non-null from external evidence. */
  confirmedProviderCredits: number | null;
  /** What the caller should pass to confirm_wizard_credits. */
  creditsToConfirm: number;
  billingState: WizardRunBillingState;
  matchedRowCount: number;
  foreignRowCount: number;
  ignoredOperationRowCount: number;
  /** Credits per reconciled operation. Absent operations are omitted. */
  perOperationCredits: Record<string, number>;
  anomalies: WizardRunReconciliationAnomaly[];
};

/**
 * Collapses rows that describe the same logged call.
 *
 * Reconciliation may be handed the same row twice (a retry re-reading the
 * table, a caller concatenating two queries). `usage_key` is unique per logged
 * call, so deduplicating on it makes the result idempotent. Rows without a
 * usage_key cannot be proven to be duplicates and are all kept.
 */
function dedupeRows(rows: readonly ReconcilableUsageRow[]): ReconcilableUsageRow[] {
  const seen = new Set<string>();
  const out: ReconcilableUsageRow[] = [];
  for (const row of rows) {
    const key = row.usage_key;
    if (typeof key === 'string' && key !== '') {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(row);
  }
  return out;
}

/**
 * Reconciles one wizard run.
 *
 * Conservative by construction: whenever the real spend cannot be established
 * (no rows, unknown credits), the full reservation is confirmed rather than a
 * smaller number, because under-confirming silently returns budget that may
 * already have been spent.
 */
export function reconcileWizardRunSpend(
  input: WizardRunReconciliationInput,
): WizardRunReconciliationResult {
  const { correlation, discoveryProvider, estimatedCredits, reservedCredits } = input;

  const usageProviderKey = resolveUsageProviderKey(discoveryProvider);
  const reconciledOperations = usageProviderKey
    ? resolveReconciledOperations(usageProviderKey)
    : [];

  const anomalies: WizardRunReconciliationAnomaly[] = [];
  const perOperationCredits: Record<string, number> = {};

  let matchedRowCount = 0;
  let foreignRowCount = 0;
  let ignoredOperationRowCount = 0;
  let creditsAreKnown = true;
  let recordedTotal = 0;

  for (const row of dedupeRows(input.rows)) {
    // Rows of another provider are simply not this reconciliation's business.
    if (usageProviderKey === null || row.provider_key !== usageProviderKey) continue;

    const match = matchUsageRowToRun(row, correlation);
    if (!match.matched) {
      // A row that shares the batch but contradicts the reservation belongs to
      // a concurrent run. Count it, never spend it against this reservation.
      if (match.reason === 'contradicts_correlation') foreignRowCount++;
      continue;
    }

    if (!reconciledOperations.includes(row.operation_key)) {
      ignoredOperationRowCount++;
      continue;
    }

    matchedRowCount++;

    const credits = row.credits_used;
    if (credits === null || credits === undefined || !Number.isFinite(credits)) {
      creditsAreKnown = false;
      continue;
    }

    recordedTotal += credits;
    perOperationCredits[row.operation_key] =
      (perOperationCredits[row.operation_key] ?? 0) + credits;
  }

  if (foreignRowCount > 0) anomalies.push('foreign_usage_rows_present');
  if (ignoredOperationRowCount > 0) anomalies.push('unexpected_operation_for_provider');

  // ── Resolve the three quantities ───────────────────────────────────────────

  const providerConfirmed =
    input.providerConfirmedCredits !== undefined &&
    input.providerConfirmedCredits !== null &&
    Number.isFinite(input.providerConfirmedCredits)
      ? input.providerConfirmedCredits
      : null;

  let recordedUsageCredits: number | null;
  let billingState: WizardRunBillingState;
  let creditsToConfirm: number;

  if (matchedRowCount === 0) {
    // Zero rows is NOT proof of zero spend: usage logging can fail after a real
    // Apollo call (an FK violation on batch_id already did exactly that). A run
    // that produced zero candidates still reconciles here — candidates and
    // credits are unrelated quantities.
    anomalies.push('no_usage_rows_found');
    recordedUsageCredits = null;
    billingState = 'estimated';
    creditsToConfirm = reservedCredits;
  } else if (!creditsAreKnown) {
    anomalies.push('usage_credits_unknown');
    recordedUsageCredits = null;
    billingState = 'unknown';
    creditsToConfirm = reservedCredits;
  } else {
    recordedUsageCredits = recordedTotal;
    billingState = 'recorded';
    creditsToConfirm = recordedTotal;
    if (recordedTotal > reservedCredits) {
      // The exact QA defect: 4 charged against 3 reserved. Confirm the real
      // amount so the budget reflects reality, and surface the overrun instead
      // of clamping it away.
      anomalies.push('recorded_usage_exceeds_reservation');
    }
  }

  // External confirmation, when present, outranks everything above. It is never
  // inferred from recordedUsageCredits.
  if (providerConfirmed !== null) {
    billingState = 'provider_confirmed';
    creditsToConfirm = providerConfirmed;
  }

  return {
    idempotencyKey: correlation.idempotencyKey,
    discoveryProvider,
    usageProviderKey,
    estimatedCredits,
    reservedCredits,
    recordedUsageCredits,
    confirmedProviderCredits: providerConfirmed,
    creditsToConfirm,
    billingState,
    matchedRowCount,
    foreignRowCount,
    ignoredOperationRowCount,
    perOperationCredits,
    anomalies,
  };
}

// ── Audit projection ─────────────────────────────────────────────────────────

/** snake_case audit record persisted in batch metadata. No secrets, no PII. */
export type WizardRunReconciliationMetadata = {
  idempotency_key: string;
  discovery_provider: string;
  usage_provider_key: string | null;
  estimated_credits: number;
  reserved_credits: number;
  recorded_usage_credits: number | null;
  confirmed_provider_credits: number | null;
  credits_to_confirm: number;
  billing_state: WizardRunBillingState;
  matched_row_count: number;
  foreign_row_count: number;
  ignored_operation_row_count: number;
  per_operation_credits: Record<string, number>;
  anomalies: WizardRunReconciliationAnomaly[];
};

export function toWizardRunReconciliationMetadata(
  result: WizardRunReconciliationResult,
): WizardRunReconciliationMetadata {
  return {
    idempotency_key: result.idempotencyKey,
    discovery_provider: result.discoveryProvider,
    usage_provider_key: result.usageProviderKey,
    estimated_credits: result.estimatedCredits,
    reserved_credits: result.reservedCredits,
    recorded_usage_credits: result.recordedUsageCredits,
    confirmed_provider_credits: result.confirmedProviderCredits,
    credits_to_confirm: result.creditsToConfirm,
    billing_state: result.billingState,
    matched_row_count: result.matchedRowCount,
    foreign_row_count: result.foreignRowCount,
    ignored_operation_row_count: result.ignoredOperationRowCount,
    per_operation_credits: result.perOperationCredits,
    anomalies: result.anomalies,
  };
}

/** Metadata key under which the audit record is persisted. */
export const WIZARD_RUN_RECONCILIATION_KEY = 'wizard_run_reconciliation' as const;

// ── DB reader ────────────────────────────────────────────────────────────────

type UsageRowsResult = { data: ReconcilableUsageRow[] | null; error: { message: string } | null };
type UsageRowsQuery = PromiseLike<UsageRowsResult> & {
  eq(col: string, val: string): UsageRowsQuery;
  in(col: string, vals: readonly string[]): UsageRowsQuery;
};

export type WizardRunUsageRowsClient = {
  from(table: string): { select(columns: string): UsageRowsQuery };
};

export const RECONCILIATION_SELECT_COLUMNS =
  'provider_key, operation_key, credits_used, usage_key, status, batch_id, reservation_id, client_request_id, wizard_run_id';

/**
 * Reads the usage rows of one run, filtered to the reconciled operations of its
 * provider.
 *
 * Filters on batch_id because that is the column every existing writer already
 * populates; the finer correlation keys are applied in memory by
 * `reconcileWizardRunSpend`, so a row written before migration 100 (null in the
 * new columns) is still reconciled instead of being dropped.
 *
 * Returns null on DB error so the caller can fall back conservatively — an
 * empty array means "the query worked and there were no rows", which is a
 * different fact.
 */
export async function readWizardRunUsageRows(
  batchId: string,
  discoveryProvider: string,
  db: WizardRunUsageRowsClient,
): Promise<ReconcilableUsageRow[] | null> {
  const usageProviderKey = resolveUsageProviderKey(discoveryProvider);
  if (!usageProviderKey) return null;

  const { data, error } = await db
    .from('provider_usage_logs')
    .select(RECONCILIATION_SELECT_COLUMNS)
    .eq('batch_id', batchId)
    .eq('provider_key', usageProviderKey)
    .in('operation_key', resolveReconciledOperations(usageProviderKey));

  if (error) return null;
  return data ?? [];
}
