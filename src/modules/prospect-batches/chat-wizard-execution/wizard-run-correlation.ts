/**
 * wizard-run-correlation.ts — Correlation contract between a wizard run, its
 * budget reservation, and the provider usage rows it produced.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * What already worked before this file:
 *   `provider_usage_logs.batch_id` exists and the Apollo rows of the QA batch
 *   WERE linked to their batch. This module does not add a second batch id.
 *
 * What was missing:
 *   Reconciliation could not tie a usage row to the *reservation* that paid for
 *   it. With `agent_run_id` null and only `batch_id` available, two concurrent
 *   runs over the same batch — or a retry that reuses one — cannot be told
 *   apart, leaving the row timestamp as the only discriminator. Timestamps are
 *   not a correlation key: clock skew, retries and out-of-order logging all
 *   break them.
 *
 * Transport:
 *   The correlation travels in `provider_usage_logs.metadata.run_correlation`,
 *   which works today with no schema change. Migration 100 adds the same fields
 *   as real columns for indexed queries; writing them is gated behind
 *   ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS, which stays OFF until the
 *   migration is applied. Readers accept either source, so the flag can be
 *   flipped without a backfill.
 *
 * Pure: `node:crypto` hashing only. No Date.now(), no randomness, no I/O — the
 * same inputs always produce the same correlation, which is what makes
 * reconciliation idempotent.
 */

import { createHash } from 'node:crypto';

/**
 * How confident we are about what the provider actually billed.
 *
 * `unknown`            — no usable usage evidence (missing or null credits).
 * `estimated`          — only the pre-flight reservation estimate is available.
 * `recorded`           — our own provider_usage_logs rows say what was spent.
 * `provider_confirmed` — an external provider statement confirmed the spend.
 *
 * `recorded` is never promoted to `provider_confirmed` automatically: internal
 * logging is our accounting, not Apollo's invoice.
 */
export type WizardRunBillingState =
  | 'unknown'
  | 'estimated'
  | 'recorded'
  | 'provider_confirmed';

export type WizardRunCorrelationInput = {
  userId: string;
  clientRequestId: string;
  /** prospect_batches.id once the slot is reserved; null before that. */
  batchId?: string | null;
  /** wizard_budget_reservations.id; null when no reservation exists yet. */
  reservationId?: string | null;
  /** agent_runs.id when one exists. Stays nullable — wizard runs have none. */
  agentRunId?: string | null;
  /** Discovery provider that will spend credits. */
  providerKey: string;
  /** Stable description of what was requested (country, industry, caps…). */
  requestSignature: string;
};

export type WizardRunCorrelation = {
  /** Deterministic id of this wizard run. Same user + clientRequestId ⇒ same id. */
  wizardRunId: string;
  clientRequestId: string;
  batchId: string | null;
  reservationId: string | null;
  agentRunId: string | null;
  providerKey: string;
  /** Hash of what was requested — detects a "same run id, different request". */
  requestFingerprint: string;
  /** Key that makes reconciliation of this run repeatable without duplicating. */
  idempotencyKey: string;
};

/** Short enough to read in a log line, long enough to avoid collisions. */
const DIGEST_LENGTH = 32;

/**
 * Hashes an ordered list of parts.
 *
 * The parts are JSON-encoded before hashing so the encoding is injective: no
 * separator character has to be assumed absent from ids, and the source file
 * stays free of control characters.
 */
function digest(parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, DIGEST_LENGTH);
}

/**
 * Deterministic run id, derived from (userId, clientRequestId): together they
 * already identify one user-visible "Generar" press, and the client request id
 * is what the budget RPC keys its reservation on.
 */
export function buildWizardRunId(userId: string, clientRequestId: string): string {
  return digest(['wizard_run', userId, clientRequestId]);
}

/**
 * Fingerprint of the request parameters. Two runs sharing a run id but not a
 * fingerprint mean a client replayed an id with different parameters.
 */
export function buildWizardRequestFingerprint(
  providerKey: string,
  requestSignature: string,
): string {
  return digest(['wizard_request', providerKey, requestSignature]);
}

/**
 * Key under which one reconciliation of one run is recorded. Includes the
 * reservation, so a retry that produced a *new* reservation reconciles
 * separately while repeated reconciliation of the same one stays stable.
 */
export function buildWizardReconciliationIdempotencyKey(
  wizardRunId: string,
  reservationId: string | null,
): string {
  return digest(['wizard_reconciliation', wizardRunId, reservationId ?? 'no_reservation']);
}

export function buildWizardRunCorrelation(
  input: WizardRunCorrelationInput,
): WizardRunCorrelation {
  const wizardRunId = buildWizardRunId(input.userId, input.clientRequestId);
  const reservationId = input.reservationId ?? null;

  return {
    wizardRunId,
    clientRequestId: input.clientRequestId,
    batchId: input.batchId ?? null,
    reservationId,
    agentRunId: input.agentRunId ?? null,
    providerKey: input.providerKey,
    requestFingerprint: buildWizardRequestFingerprint(
      input.providerKey,
      input.requestSignature,
    ),
    idempotencyKey: buildWizardReconciliationIdempotencyKey(wizardRunId, reservationId),
  };
}

/**
 * Returns a copy of the correlation with the ids that only exist once the
 * reservation and slot have been created. Immutable — never mutates the input.
 */
export function withResolvedIds(
  correlation: WizardRunCorrelation,
  ids: { batchId?: string | null; reservationId?: string | null; agentRunId?: string | null },
): WizardRunCorrelation {
  const reservationId =
    ids.reservationId !== undefined ? ids.reservationId : correlation.reservationId;
  return {
    ...correlation,
    batchId: ids.batchId !== undefined ? ids.batchId : correlation.batchId,
    reservationId,
    agentRunId: ids.agentRunId !== undefined ? ids.agentRunId : correlation.agentRunId,
    idempotencyKey: buildWizardReconciliationIdempotencyKey(
      correlation.wizardRunId,
      reservationId,
    ),
  };
}

// ── metadata transport (works with no schema change) ─────────────────────────

/** Key under which the correlation travels inside provider_usage_logs.metadata. */
export const RUN_CORRELATION_METADATA_KEY = 'run_correlation' as const;

export type RunCorrelationMetadata = {
  wizard_run_id: string;
  client_request_id: string;
  batch_id: string | null;
  reservation_id: string | null;
  agent_run_id: string | null;
  provider_key: string;
  request_fingerprint: string;
  idempotency_key: string;
  billing_state: WizardRunBillingState | null;
};

export function toRunCorrelationMetadata(
  correlation: WizardRunCorrelation,
  billingState: WizardRunBillingState | null = null,
): RunCorrelationMetadata {
  return {
    wizard_run_id: correlation.wizardRunId,
    client_request_id: correlation.clientRequestId,
    batch_id: correlation.batchId,
    reservation_id: correlation.reservationId,
    agent_run_id: correlation.agentRunId,
    provider_key: correlation.providerKey,
    request_fingerprint: correlation.requestFingerprint,
    idempotency_key: correlation.idempotencyKey,
    billing_state: billingState,
  };
}

// ── column transport (migration 100, flag-gated) ─────────────────────────────

/**
 * Nullable correlation columns added by migration 100. Every field is optional
 * at the database level, so a writer predating the migration keeps working and
 * a row written without them stays readable.
 *
 * `batch_id` is deliberately absent: the column already exists and is already
 * written by every logger. Duplicating it was explicitly rejected.
 */
export type ProviderUsageCorrelationColumns = {
  reservation_id: string | null;
  client_request_id: string | null;
  wizard_run_id: string | null;
  request_fingerprint: string | null;
  idempotency_key: string | null;
  billing_state: WizardRunBillingState | null;
};

export function toProviderUsageCorrelationColumns(
  correlation: WizardRunCorrelation,
  billingState: WizardRunBillingState | null = null,
): ProviderUsageCorrelationColumns {
  return {
    reservation_id: correlation.reservationId,
    client_request_id: correlation.clientRequestId,
    wizard_run_id: correlation.wizardRunId,
    request_fingerprint: correlation.requestFingerprint,
    idempotency_key: correlation.idempotencyKey,
    billing_state: billingState,
  };
}

// ── Row matching ─────────────────────────────────────────────────────────────

/**
 * Subset of a provider_usage_logs row needed to decide ownership.
 *
 * Columns may be absent (migration not applied, or the columns flag OFF), in
 * which case the same fields are read from `metadata.run_correlation`.
 */
export type CorrelatableUsageRow = {
  batch_id?: string | null;
  reservation_id?: string | null;
  client_request_id?: string | null;
  wizard_run_id?: string | null;
  metadata?: unknown;
};

/** Correlation identifiers of a row, from columns first, metadata second. */
export type RowCorrelationKeys = {
  batchId: string | null;
  reservationId: string | null;
  clientRequestId: string | null;
  wizardRunId: string | null;
};

function readMetadataCorrelation(metadata: unknown): Partial<RunCorrelationMetadata> {
  if (!metadata || typeof metadata !== 'object') return {};
  const block = (metadata as Record<string, unknown>)[RUN_CORRELATION_METADATA_KEY];
  if (!block || typeof block !== 'object') return {};
  return block as Partial<RunCorrelationMetadata>;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/**
 * Extracts a row's correlation keys.
 *
 * Column values win over metadata: once migration 100 is applied and the flag
 * is on, the indexed columns are authoritative. Until then every field comes
 * from metadata, and reconciliation behaves identically.
 */
export function readRowCorrelationKeys(row: CorrelatableUsageRow): RowCorrelationKeys {
  const meta = readMetadataCorrelation(row.metadata);
  return {
    batchId: firstString(row.batch_id, meta.batch_id),
    reservationId: firstString(row.reservation_id, meta.reservation_id),
    clientRequestId: firstString(row.client_request_id, meta.client_request_id),
    wizardRunId: firstString(row.wizard_run_id, meta.wizard_run_id),
  };
}

export type UsageRowMatch =
  | { matched: true; matchedOn: 'reservation_id' | 'client_request_id' | 'batch_id' }
  | { matched: false; reason: 'no_shared_correlation_key' | 'contradicts_correlation' };

/**
 * Decides whether a usage row belongs to this run.
 *
 * Precedence is strongest-key-first: a reservation id is unique per
 * reservation, a client request id per user press, a batch id per batch (which
 * a retry may legitimately share). Timestamps are never consulted.
 *
 * A row that shares one key but *contradicts* another — same batch, different
 * reservation — is rejected. That is exactly the concurrent-run case.
 */
export function matchUsageRowToRun(
  row: CorrelatableUsageRow,
  correlation: WizardRunCorrelation,
): UsageRowMatch {
  const keys = readRowCorrelationKeys(row);

  const contradicts =
    (keys.reservationId !== null &&
      correlation.reservationId !== null &&
      keys.reservationId !== correlation.reservationId) ||
    (keys.clientRequestId !== null &&
      keys.clientRequestId !== correlation.clientRequestId) ||
    (keys.wizardRunId !== null && keys.wizardRunId !== correlation.wizardRunId) ||
    (keys.batchId !== null &&
      correlation.batchId !== null &&
      keys.batchId !== correlation.batchId);

  if (contradicts) return { matched: false, reason: 'contradicts_correlation' };

  if (correlation.reservationId !== null && keys.reservationId === correlation.reservationId) {
    return { matched: true, matchedOn: 'reservation_id' };
  }
  if (keys.clientRequestId === correlation.clientRequestId) {
    return { matched: true, matchedOn: 'client_request_id' };
  }
  if (correlation.batchId !== null && keys.batchId === correlation.batchId) {
    return { matched: true, matchedOn: 'batch_id' };
  }

  return { matched: false, reason: 'no_shared_correlation_key' };
}
