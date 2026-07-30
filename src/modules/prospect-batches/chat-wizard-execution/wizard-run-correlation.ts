/**
 * wizard-run-correlation.ts — Stable correlation contract between a wizard run
 * and the provider usage logs it is billed for.
 *
 * A1-APOLLO-BUDGET-RECONCILIATION-1 (§3).
 *
 * The problem this replaces
 * -------------------------
 * In A1-APOLLO-LIVE-QA-1 the two Apollo logs for batch
 * `7a75df68-aaa2-4558-9118-0846486a3e97` carried `batch_id` but no
 * `agent_run_id` (the batch itself had `agent_run_id = NULL`) and no link to the
 * budget reservation at all. Tying spend to the reservation was only possible by
 * comparing `created_at` timestamps, which is not a correlation — two runs a
 * second apart, or a retry, and the attribution is wrong.
 *
 * The contract
 * ------------
 * The MINIMUM identifier required to reconcile a run is:
 *
 *     clientRequestId + batchId + reservationId
 *
 * All three are known before the first paid Apollo call. `agentRunId` and
 * `wizardRunId` stay nullable and reconciliation NEVER depends on them.
 *
 * Attribution is decided by {@link isUsageLogAttributableToRun}, which reads only
 * identifiers. It has no access to timestamps by construction — the row type it
 * accepts does not carry one.
 *
 * Pure: no I/O, no env, no Supabase.
 */

import type { WizardDiscoveryProviderKey } from './wizard-provider-resolver';

export const WIZARD_RUN_CORRELATION_VERSION = 'wizard_run_correlation_v1';

/** Key under which the correlation block is persisted in `metadata` jsonb. */
export const RUN_CORRELATION_METADATA_KEY = 'run_correlation';

/** The three identifiers without which a run cannot be reconciled. */
export const REQUIRED_CORRELATION_FIELDS = [
  'clientRequestId',
  'batchId',
  'reservationId',
] as const;

export type RequiredCorrelationField = (typeof REQUIRED_CORRELATION_FIELDS)[number];

export type WizardRunCorrelation = {
  clientRequestId: string;
  batchId: string;
  reservationId: string;
  /** Nullable by contract — reconciliation must not depend on it. */
  wizardRunId: string | null;
  /** Nullable by contract — reconciliation must not depend on it. */
  agentRunId: string | null;
  provider: WizardDiscoveryProviderKey;
  correlationVersion: string;
};

export type WizardRunCorrelationInput = {
  clientRequestId: string | null | undefined;
  batchId: string | null | undefined;
  reservationId: string | null | undefined;
  wizardRunId?: string | null;
  agentRunId?: string | null;
  provider: WizardDiscoveryProviderKey;
};

/** Thrown when a paid operation would run without a reconcilable identity. */
export class MissingRunCorrelationError extends Error {
  readonly missingFields: readonly RequiredCorrelationField[];

  constructor(missingFields: readonly RequiredCorrelationField[]) {
    super(`missing_run_correlation:${missingFields.join(',')}`);
    this.name = 'MissingRunCorrelationError';
    this.missingFields = missingFields;
  }
}

function cleanId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Builds the correlation, failing closed when any required identifier is absent.
 * Callers run this BEFORE the first paid provider call, so a missing identity
 * costs zero credits instead of producing unattributable spend.
 */
export function buildWizardRunCorrelation(
  input: WizardRunCorrelationInput,
): WizardRunCorrelation {
  const clientRequestId = cleanId(input.clientRequestId);
  const batchId = cleanId(input.batchId);
  const reservationId = cleanId(input.reservationId);

  const missing: RequiredCorrelationField[] = [];
  if (clientRequestId === null) missing.push('clientRequestId');
  if (batchId === null) missing.push('batchId');
  if (reservationId === null) missing.push('reservationId');
  if (missing.length > 0) throw new MissingRunCorrelationError(missing);

  return {
    clientRequestId: clientRequestId as string,
    batchId: batchId as string,
    reservationId: reservationId as string,
    wizardRunId: cleanId(input.wizardRunId),
    agentRunId: cleanId(input.agentRunId),
    provider: input.provider,
    correlationVersion: WIZARD_RUN_CORRELATION_VERSION,
  };
}

// ── Persistence shapes ───────────────────────────────────────────────────────

/**
 * Correlation block persisted inside `provider_usage_logs.metadata`.
 *
 * This is the shape that works TODAY, before migration 100 is applied: it needs
 * no new columns. The migration adds the same identifiers as indexed columns for
 * admin/analytics queries; see `toProviderUsageCorrelationColumns`.
 */
export type RunCorrelationMetadata = {
  correlation_version: string;
  client_request_id: string;
  batch_id: string;
  reservation_id: string;
  wizard_run_id: string | null;
  agent_run_id: string | null;
  provider: string;
  request_fingerprint: string | null;
  idempotency_key: string | null;
};

export function buildRunCorrelationMetadata(
  correlation: WizardRunCorrelation,
  extra?: { requestFingerprint?: string | null; idempotencyKey?: string | null },
): RunCorrelationMetadata {
  return {
    correlation_version: correlation.correlationVersion,
    client_request_id: correlation.clientRequestId,
    batch_id: correlation.batchId,
    reservation_id: correlation.reservationId,
    wizard_run_id: correlation.wizardRunId,
    agent_run_id: correlation.agentRunId,
    provider: correlation.provider,
    request_fingerprint: cleanId(extra?.requestFingerprint),
    idempotency_key: cleanId(extra?.idempotencyKey),
  };
}

/**
 * Column payload for the additive columns introduced by migration 100.
 *
 * NEVER spread this into an insert unless the migration has been applied — a
 * PostgREST insert naming an absent column fails, and a failed usage-log insert
 * after a real Apollo call means real credits with no record. The writer gates it
 * behind `ENABLE_PROVIDER_USAGE_CORRELATION_COLUMNS`, which stays off until the
 * migration lands.
 */
export function toProviderUsageCorrelationColumns(
  correlation: WizardRunCorrelation,
  extra?: { requestFingerprint?: string | null; idempotencyKey?: string | null },
): Record<string, string | null> {
  return {
    reservation_id: correlation.reservationId,
    client_request_id: correlation.clientRequestId,
    wizard_run_id: correlation.wizardRunId,
    request_fingerprint: cleanId(extra?.requestFingerprint),
    idempotency_key: cleanId(extra?.idempotencyKey),
  };
}

// ── Attribution ──────────────────────────────────────────────────────────────

/**
 * The identifier-only projection of a usage log used for attribution.
 * Deliberately carries NO timestamp: timestamp-based attribution is the defect
 * this contract exists to remove, and an absent field cannot be misused.
 */
export type AttributableUsageLogIdentity = {
  batchId: string | null;
  reservationId: string | null;
  clientRequestId: string | null;
};

/**
 * True when the log provably belongs to this run.
 *
 * Requires at least one strong identifier match, and rejects any log that
 * carries a CONTRADICTING identifier — a row stamped with another reservation
 * cannot be charged to this one even if it shares a batch.
 */
export function isUsageLogAttributableToRun(
  identity: AttributableUsageLogIdentity,
  correlation: WizardRunCorrelation,
): boolean {
  const rowBatchId = cleanId(identity.batchId);
  const rowReservationId = cleanId(identity.reservationId);
  const rowClientRequestId = cleanId(identity.clientRequestId);

  // Any populated identifier that disagrees disqualifies the row outright.
  if (rowBatchId !== null && rowBatchId !== correlation.batchId) return false;
  if (rowReservationId !== null && rowReservationId !== correlation.reservationId) return false;
  if (rowClientRequestId !== null && rowClientRequestId !== correlation.clientRequestId) {
    return false;
  }

  return (
    rowBatchId === correlation.batchId ||
    rowReservationId === correlation.reservationId ||
    rowClientRequestId === correlation.clientRequestId
  );
}

/**
 * Reads the correlation identity of a usage-log row from either source: the
 * additive columns (post-migration) or the `metadata.run_correlation` block
 * (available today). Columns win when both are present.
 */
export function extractUsageLogIdentity(row: {
  batch_id?: string | null;
  reservation_id?: string | null;
  client_request_id?: string | null;
  metadata?: unknown;
}): AttributableUsageLogIdentity {
  const meta =
    row.metadata !== null && typeof row.metadata === 'object'
      ? ((row.metadata as Record<string, unknown>)[RUN_CORRELATION_METADATA_KEY] as
          | Record<string, unknown>
          | undefined)
      : undefined;

  const fromMeta = (key: string): string | null =>
    meta !== undefined && typeof meta[key] === 'string' ? cleanId(meta[key] as string) : null;

  return {
    batchId: cleanId(row.batch_id) ?? fromMeta('batch_id'),
    reservationId: cleanId(row.reservation_id) ?? fromMeta('reservation_id'),
    clientRequestId: cleanId(row.client_request_id) ?? fromMeta('client_request_id'),
  };
}

// ── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Deterministic idempotency key for one billable Apollo operation within a run.
 *
 * Same run + same operation + same discriminator → same key, so a retry collides
 * on `provider_usage_logs.usage_key` (unique) instead of double-counting. The key
 * is derived only from identifiers already safe to log — never from an API key,
 * a full query or company data.
 */
export function buildRunScopedIdempotencyKey(input: {
  operationKey: string;
  batchId: string;
  discriminator: string | null;
}): string {
  const slug = (input.discriminator ?? 'default')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return `${input.operationKey}:${input.batchId}:${slug}`;
}
