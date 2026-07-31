/**
 * wizard-run-reconciliation.ts — Reconciles what a wizard run reserved against
 * what its provider usage rows say it actually spent.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * What was wrong: `readWizardConsumedCreditsFromDb` filters on
 * `provider_key='tavily'` AND `operation_key='multi_query_web_search'`. An
 * Apollo run therefore always reconciled as "0 rows found" and fell back to
 * confirming its whole reservation — which is why the QA batch's real 4 credits
 * (3 organizations_search + 1 organization_enrichment) never showed up against
 * its 3-credit reservation. The Apollo operations were simply not in the query.
 *
 * What this adds:
 *   - both Apollo billable operations, under their canonical keys;
 *   - correlation on batch_id + reservation_id + client_request_id, read from
 *     columns or from metadata, never from timestamps, so two concurrent runs
 *     cannot claim each other's rows;
 *   - three quantities that are routinely conflated:
 *       estimatedCredits         — what preflight predicted;
 *       recordedUsageCredits     — what OUR logs recorded;
 *       confirmedProviderCredits — what the PROVIDER confirmed it billed.
 *     The third is never derived from the second. Internal accounting is not an
 *     Apollo invoice, and promoting it would manufacture certainty we lack.
 *
 * Pure: takes rows, returns a verdict. No DB access, no clock, no randomness —
 * which is what makes repeated reconciliation of the same run idempotent.
 */

import { APOLLO_BILLABLE_OPERATION_KEYS } from '@/server/agents/prospecting-toolkit/apollo-operation-pricing';
import {
  isMissingProviderUsageCorrelationColumnError,
  matchUsageRowToRun,
  readRowCorrelationKeys,
  PROVIDER_USAGE_CORRELATION_COLUMN_NAMES,
  type CorrelatableUsageRow,
  type RowCorrelationSource,
  type WizardRunBillingState,
  type WizardRunCorrelation,
} from './wizard-run-correlation';

// ── Operation allowlist ──────────────────────────────────────────────────────

/** Tavily's single billable discovery operation. */
export const TAVILY_RECONCILED_OPERATIONS = ['multi_query_web_search'] as const;

/**
 * provider_usage_logs.provider_key per wizard discovery provider.
 * The wizard names Apollo's provider `apollo_organizations`; usage rows are
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
  | 'unexpected_operation_for_provider'
  /**
   * A matched row's migration-100 column disagrees with its
   * metadata.run_correlation. Columns win; the disagreement is reported because
   * it means one of the two writers attributed the spend to the wrong run.
   */
  | 'column_metadata_correlation_mismatch';

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
  /**
   * How the matched rows were correlated. Lets an operator tell "the columns
   * are live" from "we are still answering out of metadata" without reading the
   * flag or the migration state.
   */
  correlationSources: Record<RowCorrelationSource, number>;
  anomalies: WizardRunReconciliationAnomaly[];
};

/**
 * Collapses rows describing the same logged call.
 *
 * Reconciliation may be handed the same row twice (a retry re-reading the
 * table, a caller concatenating two queries). `usage_key` is unique per logged
 * call, so deduplicating on it makes the result idempotent. Rows without a
 * usage_key cannot be proven duplicates and are all kept.
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
 * (no rows, unknown credits) the full reservation is confirmed rather than a
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
  const correlationSources: Record<RowCorrelationSource, number> = {
    columns: 0,
    metadata: 0,
    none: 0,
  };

  let matchedRowCount = 0;
  let foreignRowCount = 0;
  let ignoredOperationRowCount = 0;
  let creditsAreKnown = true;
  let recordedTotal = 0;
  let sawColumnMetadataMismatch = false;

  for (const row of dedupeRows(input.rows)) {
    // Rows of another provider are not this reconciliation's business.
    if (usageProviderKey === null || row.provider_key !== usageProviderKey) continue;

    const match = matchUsageRowToRun(row, correlation);
    if (!match.matched) {
      // A row sharing the batch but contradicting the reservation belongs to a
      // concurrent run. Count it; never spend it against this reservation.
      if (match.reason === 'contradicts_correlation') foreignRowCount++;
      continue;
    }

    if (!reconciledOperations.includes(row.operation_key)) {
      ignoredOperationRowCount++;
      continue;
    }

    const keys = readRowCorrelationKeys(row);
    correlationSources[keys.correlationSource]++;
    if (keys.columnMetadataMismatch) sawColumnMetadataMismatch = true;

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
  if (sawColumnMetadataMismatch) anomalies.push('column_metadata_correlation_mismatch');

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
      // amount so the budget reflects reality, and surface the overrun rather
      // than clamping it away.
      anomalies.push('recorded_usage_exceeds_reservation');
    }
  }

  // External confirmation outranks everything above. It is never inferred from
  // recordedUsageCredits.
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
    correlationSources,
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
  correlation_sources: Record<RowCorrelationSource, number>;
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
    correlation_sources: result.correlationSources,
    anomalies: result.anomalies,
  };
}

/** Metadata key under which the audit record is persisted. */
export const WIZARD_RUN_RECONCILIATION_KEY = 'wizard_run_reconciliation' as const;

// ── DB reader ────────────────────────────────────────────────────────────────

type UsageRowsResult = {
  data: ReconcilableUsageRow[] | null;
  error: { message: string; code?: string } | null;
};
type UsageRowsQuery = PromiseLike<UsageRowsResult> & {
  eq(col: string, val: string): UsageRowsQuery;
  in(col: string, vals: readonly string[]): UsageRowsQuery;
};

export type WizardRunUsageRowsClient = {
  from(table: string): { select(columns: string): UsageRowsQuery };
};

/**
 * Columns that exist regardless of migration 100.
 *
 * `metadata` is always selected: it is the transport that needs no schema
 * change, and it stays the fallback for every row written before the columns
 * went live.
 */
export const RECONCILIATION_BASE_SELECT_COLUMNS =
  'provider_key, operation_key, credits_used, usage_key, status, batch_id, metadata';

/**
 * Columns read for reconciliation, including migration 100's.
 *
 * Selecting the new columns is what makes them readable at all — writing them
 * without reading them would leave them write-only, which is exactly the gap
 * COND-3 closes. Because the migration is deliberately NOT applied yet, the
 * reader below treats an undefined-column error on this select as "not migrated
 * yet" and retries with `RECONCILIATION_BASE_SELECT_COLUMNS`. That keeps the
 * pre-migration behaviour byte-for-byte identical while making the post-
 * migration path a flag flip instead of a code change.
 */
export const RECONCILIATION_SELECT_COLUMNS =
  `${RECONCILIATION_BASE_SELECT_COLUMNS}, ${PROVIDER_USAGE_CORRELATION_COLUMN_NAMES.join(', ')}`;

/**
 * Reads the usage rows of one run, filtered to the reconciled operations of its
 * provider.
 *
 * Filters on batch_id because that column already exists and every writer
 * already populates it. The finer correlation keys are applied in memory by
 * `reconcileWizardRunSpend`, so a row written before migration 100 is still
 * reconciled instead of being dropped.
 *
 * Returns null on DB error so the caller can fall back conservatively — an
 * empty array means "the query worked and there were no rows", a different fact.
 */
export async function readWizardRunUsageRows(
  batchId: string,
  discoveryProvider: string,
  db: WizardRunUsageRowsClient,
): Promise<ReconcilableUsageRow[] | null> {
  const usageProviderKey = resolveUsageProviderKey(discoveryProvider);
  if (!usageProviderKey) return null;

  const operations = resolveReconciledOperations(usageProviderKey);
  const runQuery = (columns: string) =>
    db
      .from('provider_usage_logs')
      .select(columns)
      .eq('batch_id', batchId)
      .eq('provider_key', usageProviderKey)
      .in('operation_key', operations);

  const withColumns = await runQuery(RECONCILIATION_SELECT_COLUMNS);
  if (!withColumns.error) return withColumns.data ?? [];

  // Only "migration 100 is not applied here" earns a second read. Any other
  // error — permissions, connection, a genuinely broken query — is returned as a
  // failure, because retrying with fewer columns cannot fix it and pretending
  // the read succeeded would reconcile against rows we never saw.
  if (!isMissingProviderUsageCorrelationColumnError(withColumns.error)) return null;

  const withoutColumns = await runQuery(RECONCILIATION_BASE_SELECT_COLUMNS);
  if (withoutColumns.error) return null;
  return withoutColumns.data ?? [];
}
