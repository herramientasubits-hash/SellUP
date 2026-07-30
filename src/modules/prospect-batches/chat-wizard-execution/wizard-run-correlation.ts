/**
 * wizard-run-correlation.ts — Correlation contract between a wizard run, its
 * budget reservation, and the provider usage rows it produced.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1.
 *
 * What already worked before this file:
 *   `provider_usage_logs.batch_id` exists and the Apollo rows of the QA batch
 *   WERE linked to their batch. Do not add a second batch_id.
 *
 * What was missing:
 *   Reconciliation could not tie a usage row to the *reservation* that paid for
 *   it. With `agent_run_id` null and only `batch_id` available, two concurrent
 *   runs of the same batch, or a retry that reuses a batch, cannot be told
 *   apart — and the only remaining discriminator was the row timestamp.
 *   Timestamps are not a correlation key: clock skew, retries and out-of-order
 *   logging all break them.
 *
 * This module defines the keys, builds them deterministically, and maps them to
 * the nullable columns added by migration 100. `agent_run_id` stays nullable and
 * is deliberately NOT part of the minimum correlation set.
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
 * `recorded` must never be promoted to `provider_confirmed` automatically:
 * internal logging is our accounting, not Apollo's invoice.
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
  providerKey: string;
  /** Hash of what was requested — detects a "same run id, different request". */
  requestFingerprint: string;
  /** Key that makes reconciliation of this run repeatable without duplicating. */
  idempotencyKey: string;
};

/** Length kept short enough to read in logs, long enough to avoid collisions. */
const DIGEST_LENGTH = 32;

function digest(...parts: string[]): string {
  const hash = createHash('sha256');
  // NUL separator: cannot appear in the inputs, so concatenation is unambiguous.
  hash.update(parts.join('\u0000'));
  return hash.digest('hex').slice(0, DIGEST_LENGTH);
}

/**
 * Deterministic run id. Derived from (userId, clientRequestId) because those
 * two already identify one user-visible "Generar" press, and the client request
 * id is what the budget RPC keys its reservation on.
 */
export function buildWizardRunId(userId: string, clientRequestId: string): string {
  return digest('wizard_run', userId, clientRequestId);
}

/**
 * Fingerprint of the request parameters. Two runs with the same run id but a
 * different fingerprint indicate a client replaying an id with new parameters.
 */
export function buildWizardRequestFingerprint(
  providerKey: string,
  requestSignature: string,
): string {
  return digest('wizard_request', providerKey, requestSignature);
}

/**
 * Key under which one reconciliation of one run is recorded. Includes the
 * reservation so a retry that produced a *new* reservation reconciles
 * separately, and stays stable for repeated reconciliation of the same one.
 */
export function buildWizardReconciliationIdempotencyKey(
  wizardRunId: string,
  reservationId: string | null,
): string {
  return digest('wizard_reconciliation', wizardRunId, reservationId ?? 'no_reservation');
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
    providerKey: input.providerKey,
    requestFingerprint: buildWizardRequestFingerprint(
      input.providerKey,
      input.requestSignature,
    ),
    idempotencyKey: buildWizardReconciliationIdempotencyKey(wizardRunId, reservationId),
  };
}

/**
 * Returns a copy of the correlation with the ids that only exist after the
 * reservation and slot were created. Immutable — never mutates the input.
 */
export function withResolvedIds(
  correlation: WizardRunCorrelation,
  ids: { batchId?: string | null; reservationId?: string | null },
): WizardRunCorrelation {
  const reservationId =
    ids.reservationId !== undefined ? ids.reservationId : correlation.reservationId;
  return {
    ...correlation,
    batchId: ids.batchId !== undefined ? ids.batchId : correlation.batchId,
    reservationId,
    idempotencyKey: buildWizardReconciliationIdempotencyKey(
      correlation.wizardRunId,
      reservationId,
    ),
  };
}

// ── provider_usage_logs projection ───────────────────────────────────────────

/**
 * Nullable correlation columns added by migration 100. Every field is optional
 * at the database level, so a writer that predates the migration keeps working
 * and a row written without them is still readable.
 */
export type ProviderUsageCorrelationColumns = {
  batch_id: string | null;
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
    batch_id: correlation.batchId,
    reservation_id: correlation.reservationId,
    client_request_id: correlation.clientRequestId,
    wizard_run_id: correlation.wizardRunId,
    request_fingerprint: correlation.requestFingerprint,
    idempotency_key: correlation.idempotencyKey,
    billing_state: billingState,
  };
}

// ── Row matching ─────────────────────────────────────────────────────────────

/** Subset of a provider_usage_logs row needed to decide ownership. */
export type CorrelatableUsageRow = {
  batch_id?: string | null;
  reservation_id?: string | null;
  client_request_id?: string | null;
  wizard_run_id?: string | null;
};

export type UsageRowMatch =
  | { matched: true; matchedOn: 'reservation_id' | 'client_request_id' | 'batch_id' }
  | { matched: false; reason: 'no_shared_correlation_key' | 'contradicts_correlation' };

/**
 * Decides whether a usage row belongs to this run.
 *
 * Precedence is strongest-key-first: a reservation id is unique per reservation,
 * a client request id per user press, a batch id per batch (which a retry may
 * legitimately share). Timestamps are never consulted.
 *
 * A row that shares one key but *contradicts* another (same batch, different
 * reservation) is rejected — that is exactly the concurrent-run case.
 */
export function matchUsageRowToRun(
  row: CorrelatableUsageRow,
  correlation: WizardRunCorrelation,
): UsageRowMatch {
  const contradicts =
    (row.reservation_id != null &&
      correlation.reservationId != null &&
      row.reservation_id !== correlation.reservationId) ||
    (row.client_request_id != null &&
      row.client_request_id !== correlation.clientRequestId) ||
    (row.wizard_run_id != null && row.wizard_run_id !== correlation.wizardRunId) ||
    (row.batch_id != null &&
      correlation.batchId != null &&
      row.batch_id !== correlation.batchId);

  if (contradicts) return { matched: false, reason: 'contradicts_correlation' };

  if (correlation.reservationId != null && row.reservation_id === correlation.reservationId) {
    return { matched: true, matchedOn: 'reservation_id' };
  }
  if (row.client_request_id === correlation.clientRequestId) {
    return { matched: true, matchedOn: 'client_request_id' };
  }
  if (correlation.batchId != null && row.batch_id === correlation.batchId) {
    return { matched: true, matchedOn: 'batch_id' };
  }

  return { matched: false, reason: 'no_shared_correlation_key' };
}
