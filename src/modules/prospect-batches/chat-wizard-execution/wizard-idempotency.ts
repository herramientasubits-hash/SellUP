/**
 * wizard-idempotency.ts — Durable idempotency primitive for chat wizard executions.
 *
 * Implements an atomic reserve-or-return pattern using a database-level unique
 * constraint on (created_by, client_request_id). The reservation must be created
 * BEFORE any provider call (Tavily, Apollo, HubSpot, etc.).
 *
 * Design principles:
 * - Dependency injection: receives the DB client, never imports it globally.
 * - No in-memory state (Set, Map, module-level variable).
 * - Handles PostgreSQL error code '23505' (unique_violation) atomically.
 * - Non-23505 errors propagate as typed WizardIdempotencyError.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type WizardExecutionReservationInput = {
  /** UUID of the authenticated internal user performing the wizard execution. */
  userId: string;
  /** Client-generated UUID that identifies this specific wizard execution attempt. */
  clientRequestId: string;
  /** Payload for the initial prospect_batch row. */
  initialBatchPayload: {
    requestSource: 'chat_wizard';
    catalogVersionId: string;
    industryId: string;
    subindustryIds: string[];
    countryCode: string;
    additionalCriteria: string | null;
  };
};

export type WizardExecutionReservationResult =
  | { status: 'reserved'; batchId: string }
  | { status: 'already_reserved'; batchId: string };

export class WizardIdempotencyError extends Error {
  constructor(
    public readonly code: 'DB_INSERT_FAILED' | 'DB_LOOKUP_FAILED' | 'BATCH_NOT_FOUND',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WizardIdempotencyError';
  }
}

// ── Database client interface (injectable) ────────────────────────────────────
// Matches the minimal surface required from @supabase/supabase-js SupabaseClient.
// Declared as an interface so tests can inject lightweight fakes.

export interface IdempotencyDbClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id: string } | null; error: DbError | null }>;
      };
    };
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          single(): Promise<{ data: { id: string } | null; error: DbError | null }>;
        };
      };
    };
  };
}

export type DbError = {
  code?: string;
  message?: string;
  details?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

/** PostgreSQL error code for unique_violation */
const PG_UNIQUE_VIOLATION = '23505';

/** Initial status for a wizard-reserved batch (matches CHECK constraint in migration 040) */
const INITIAL_BATCH_STATUS = 'draft';

/** Source identifier stored in prospect_batches.source */
const WIZARD_SOURCE = 'agent_1';

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Atomically reserves a prospect_batch row for the given (userId, clientRequestId) pair.
 *
 * Flow:
 * 1. Attempt INSERT with client_request_id set.
 * 2. If INSERT succeeds → return { status: 'reserved', batchId }.
 * 3. If INSERT fails with code 23505 (unique_violation) → the slot was already reserved
 *    by a prior (or concurrent) request. Look up the existing row and return
 *    { status: 'already_reserved', batchId }.
 * 4. Any other error → throw WizardIdempotencyError.
 *
 * IMPORTANT: This function does NOT call any external provider. The caller must
 * check the result BEFORE invoking Tavily, Apollo, or any other provider.
 */
export async function reserveWizardExecutionSlot(
  input: WizardExecutionReservationInput,
  db: IdempotencyDbClient,
): Promise<WizardExecutionReservationResult> {
  const { userId, clientRequestId, initialBatchPayload } = input;

  const batchName = buildBatchName(initialBatchPayload);
  const metadataEntry = buildMetadata(initialBatchPayload);

  // ── Step 1: Attempt atomic INSERT ─────────────────────────────────────────
  const { data: insertedRow, error: insertError } = await db
    .from('prospect_batches')
    .insert({
      name: batchName,
      status: INITIAL_BATCH_STATUS,
      source: WIZARD_SOURCE,
      created_by: userId,
      client_request_id: clientRequestId,
      metadata: metadataEntry,
    })
    .select('id')
    .single();

  if (!insertError) {
    // INSERT succeeded — slot is freshly reserved
    if (!insertedRow) {
      throw new WizardIdempotencyError(
        'DB_INSERT_FAILED',
        'INSERT succeeded but returned no row.',
      );
    }
    return { status: 'reserved', batchId: insertedRow.id };
  }

  // ── Step 2: Handle unique_violation (23505) ───────────────────────────────
  if (insertError.code === PG_UNIQUE_VIOLATION) {
    // Another request (concurrent or prior) already reserved this slot.
    // Look up the existing batch by the idempotency key.
    const { data: existingRow, error: lookupError } = await db
      .from('prospect_batches')
      .select('id')
      .eq('created_by', userId)
      .eq('client_request_id', clientRequestId)
      .single();

    if (lookupError) {
      throw new WizardIdempotencyError(
        'DB_LOOKUP_FAILED',
        `Failed to look up existing batch after 23505: ${lookupError.message ?? 'unknown'}`,
        lookupError,
      );
    }

    if (!existingRow) {
      throw new WizardIdempotencyError(
        'BATCH_NOT_FOUND',
        'Received 23505 but the existing batch row could not be found.',
      );
    }

    return { status: 'already_reserved', batchId: existingRow.id };
  }

  // ── Step 3: Any other error — propagate ───────────────────────────────────
  throw new WizardIdempotencyError(
    'DB_INSERT_FAILED',
    `Unexpected database error during reservation: ${insertError.message ?? 'unknown'} (code: ${insertError.code ?? 'n/a'})`,
    insertError,
  );
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildBatchName(payload: WizardExecutionReservationInput['initialBatchPayload']): string {
  return `Wizard: ${payload.industryId} / ${payload.countryCode}`;
}

function buildMetadata(
  payload: WizardExecutionReservationInput['initialBatchPayload'],
): Record<string, unknown> {
  return {
    request_source: payload.requestSource,
    catalog_version_id: payload.catalogVersionId,
    industry_id: payload.industryId,
    subindustry_ids: payload.subindustryIds,
    country_code: payload.countryCode,
    additional_criteria: payload.additionalCriteria,
  };
}
