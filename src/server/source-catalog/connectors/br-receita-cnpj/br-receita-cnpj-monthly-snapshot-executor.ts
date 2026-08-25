/**
 * BR Receita CNPJ — the EXECUTOR: the dumb loop CUT A designed its plan to be driven by.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B — runtime snapshot → published reader → Agent 1 adapter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO invariants live here. Ordering, run scoping, duplicate policy and the
 * refusal to publish a partial period are all properties of the PLAN. This
 * module pulls operations and hands them to a gateway; if it ever needed a
 * rule of its own, the rule would be in the wrong place.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 Bounded, and bounded on purpose ──────────────────────────────────────
 *
 * The plan is an async generator whose own memory is O(BATCH_SIZE). An executor that collected
 * its operations first — `for await` into an array, `Array.fromAsync`, "let me count the batches
 * to report a total" — would restore exactly the O(NATIONAL_ROWS) footprint CUT A removed, and it
 * would do so invisibly, because the plan would still look lazy.
 *
 * So this executor holds AT MOST ONE batch at a time, and the one it holds is the one it has not
 * executed yet. That single-slot lookahead exists for one reason:
 *
 *   `publish_period` must COMMIT WITH THE FINAL BATCH (CUT A, `mustCommitWithFinalBatch`).
 *
 * A streaming executor cannot know a batch is the last one when it receives it — only the arrival
 * of `publish_period` proves that. So each batch is held back by one step: when the NEXT operation
 * turns out to be another batch, the held one is written on its own; when it turns out to be
 * `publish_period`, the held one goes into the publish transaction. Earlier batches committing
 * separately is CORRECT and not a compromise: a `preparing` run is invisible to every reader, so
 * a crash after batch 7 leaves an unreadable partial run, which is recoverable. A crash after a
 * PROMOTED run with a missing final batch would not be.
 *
 * ── 🔴 A failure never throws a driver error outward ────────────────────────
 *
 * PostgreSQL's `23505` message and `detail` quote the conflicting key — for a Brazil row that key
 * CONTAINS THE CNPJ. So this executor never propagates a driver error and never puts one in its
 * result. Failures are reported as a reason CATEGORY plus, at most, a five-character SQLSTATE.
 * `BrReceitaSnapshotStreamError` is already ordinal-only by CUT A's design and is reported as
 * such.
 *
 * ── What "failed" means here ────────────────────────────────────────────────
 *
 * A failed execution leaves the PREVIOUSLY PUBLISHED run exactly as it was — untouched, still
 * published, still the run every reader resolves. That is not something this module arranges: the
 * demotion of the outgoing run lives INSIDE the publish transaction, so a build that never
 * reaches the publish never demotes anything.
 */

import {
  BrReceitaSnapshotStreamError,
  type BrReceitaSnapshotWritePlan,
  type UpsertBatchOperation,
} from './br-receita-cnpj-monthly-snapshot-write-plan';
import {
  BrReceitaGatewayError,
  toSafeGatewayFailure,
  type BrReceitaSnapshotWriteGateway,
} from './br-receita-cnpj-monthly-snapshot-write-gateway';

// ─── Result ─────────────────────────────────────────────────────────────────

export type BrReceitaExecutionFailureKind =
  /** The plan refused the period mid-stream (period mismatch, in-batch duplicate, empty period). */
  | 'plan_refused_period'
  /** The gateway or the database refused an operation. */
  | 'gateway_failed'
  /** Anything else, reported without its message. */
  | 'unexpected_error';

/**
 * Why an execution failed.
 *
 * 🔴 Every field here is a CATEGORY, an ORDINAL or a SQLSTATE. There is deliberately nowhere to
 * put a message, a row, a legal name or a CNPJ — the same "make it unrepresentable" technique
 * CUT A used for the persisted projection.
 */
export interface BrReceitaExecutionFailure {
  readonly kind: BrReceitaExecutionFailureKind;
  /** The plan's or the gateway's reason code. Never free text. */
  readonly reason: string;
  /** Ordinal of the offending record when the PLAN refused one. Never an identifier. */
  readonly recordIndex: number | null;
  /** Five-character SQLSTATE when the database reported one. */
  readonly sqlState: string | null;
}

export interface BrReceitaSnapshotExecutionResult {
  readonly status: 'published' | 'failed';
  readonly sourceKey: string;
  readonly countryCode: string;
  readonly sourcePeriod: string;
  /** `null` only when the failure happened before `begin_period` returned an id. */
  readonly snapshotRunId: string | null;
  /** The run demoted by this publication, when the period already had one. */
  readonly supersededRunId: string | null;
  readonly batchesExecuted: number;
  readonly rowsWritten: number;
  /** Rows removed by the run-scoped reset at the start of this run, plus cleanup on failure. */
  readonly rowsDiscarded: number;
  readonly failure: BrReceitaExecutionFailure | null;
  /** Invariants this executor asserts about itself, so a caller can assert on them too. */
  readonly heldWholePeriodInMemory: false;
  readonly maxBatchesHeldAtOnce: 1;
}

export interface BrReceitaSnapshotExecutionInput {
  readonly plan: BrReceitaSnapshotWritePlan;
  readonly gateway: BrReceitaSnapshotWriteGateway;
}

// ─── Failure translation ────────────────────────────────────────────────────

/**
 * Turns any thrown value into a sanitised failure.
 *
 * 🔴 The `unexpected_error` branch reports the ERROR CLASS NAME and nothing else. Even a
 * `TypeError` raised deep inside a driver can carry a query fragment in its message.
 */
function toExecutionFailure(error: unknown): BrReceitaExecutionFailure {
  if (error instanceof BrReceitaSnapshotStreamError) {
    return {
      kind: 'plan_refused_period',
      reason: error.reason,
      recordIndex: error.recordIndex,
      sqlState: null,
    };
  }
  if (error instanceof BrReceitaGatewayError) {
    return {
      kind: 'gateway_failed',
      reason: error.reason,
      recordIndex: null,
      sqlState: error.sqlState,
    };
  }
  const wrapped = toSafeGatewayFailure(error);
  return {
    kind: 'unexpected_error',
    reason:
      typeof error === 'object' && error !== null && typeof (error as Error).name === 'string'
        ? (error as Error).name
        : 'non_error_thrown',
    recordIndex: null,
    sqlState: wrapped.sqlState,
  };
}

// ─── The executor ───────────────────────────────────────────────────────────

/**
 * Executes ONE monthly snapshot publication.
 *
 * 🔴 NEVER THROWS for an operational failure: it returns `status: 'failed'` with a sanitised
 * reason. Throwing would push the caller into `catch (err)`, and the most natural thing to do in
 * a `catch` is log `err` — which is precisely the driver error that quotes the CNPJ. Making the
 * failure a RETURN VALUE removes the tempting object from the caller's hands entirely.
 */
export async function executeBrReceitaMonthlySnapshotWrite(
  input: BrReceitaSnapshotExecutionInput,
): Promise<BrReceitaSnapshotExecutionResult> {
  const { plan, gateway } = input;

  let snapshotRunId: string | null = null;
  let supersededRunId: string | null = null;
  let batchesExecuted = 0;
  let rowsWritten = 0;
  let rowsDiscarded = 0;

  // The single-slot lookahead. At most ONE batch is ever held, and it is released the moment it
  // is written — see the module header for why one slot is both necessary and sufficient.
  let heldBatch: UpsertBatchOperation | null = null;
  let published = false;

  const base = {
    sourceKey: plan.source_key,
    countryCode: plan.country_code,
    sourcePeriod: plan.source_period,
    heldWholePeriodInMemory: false as const,
    maxBatchesHeldAtOnce: 1 as const,
  };

  try {
    for await (const operation of plan.operations()) {
      switch (operation.kind) {
        case 'begin_period': {
          const started = await gateway.beginPeriodRun(operation);
          snapshotRunId = started.snapshotRunId;
          // 🔴 Resolved BEFORE the next operation is pulled. The plan's generator calls
          // `runHandle.require()` immediately after yielding `begin_period`, so an executor that
          // deferred this would be refused at runtime rather than silently stamping rows with an
          // inferred run.
          plan.runHandle.resolve(started.snapshotRunId);
          break;
        }

        case 'discard_run_rows': {
          const discarded = await gateway.discardRunRows(operation);
          rowsDiscarded += discarded.deletedRows;
          break;
        }

        case 'upsert_batch': {
          if (heldBatch !== null) {
            const written = await gateway.upsertBatch(heldBatch);
            rowsWritten += written.writtenRows;
            batchesExecuted += 1;
          }
          // Release happens by REPLACEMENT: the previous batch is unreferenced the instant this
          // assignment lands, so two batches never coexist here either.
          heldBatch = operation;
          break;
        }

        case 'publish_period': {
          const result = await gateway.commitFinalBatchAndPublish(heldBatch, operation);
          if (heldBatch !== null) {
            rowsWritten += result.finalBatchRows;
            batchesExecuted += 1;
            heldBatch = null;
          }
          supersededRunId = result.supersededRunId;
          published = true;
          break;
        }
      }
    }
  } catch (error) {
    const failure = toExecutionFailure(error);

    // Cleanup is RUN-SCOPED and only possible once a run exists. Before `begin_period` returned
    // there is nothing to clean: no run row, and no snapshot row can have been written.
    if (snapshotRunId !== null) {
      try {
        const cleaned = await gateway.failPeriod(plan.onFailure, snapshotRunId);
        rowsDiscarded += cleaned.deletedRows;
      } catch {
        // A cleanup that fails must not replace the ORIGINAL failure with its own, and must not
        // surface a driver error either. The run was already marked unpublishable first, so the
        // worst residue is rows belonging to a `failed` run — invisible to every reader, and
        // removable later by `planBrReceitaSnapshotRunDiscard`.
      }
    }

    return {
      ...base,
      status: 'failed',
      snapshotRunId,
      supersededRunId: null,
      batchesExecuted,
      rowsWritten,
      rowsDiscarded,
      failure,
    };
  }

  if (!published || snapshotRunId === null) {
    // The plan guarantees `publish_period` is last and unreachable on a failure path, so this is
    // an impossible state rather than an expected one. It is still reported as a failure instead
    // of being asserted away: a silent "success" with no publication is the worst outcome here.
    return {
      ...base,
      status: 'failed',
      snapshotRunId,
      supersededRunId: null,
      batchesExecuted,
      rowsWritten,
      rowsDiscarded,
      failure: {
        kind: 'unexpected_error',
        reason: 'plan_completed_without_publish',
        recordIndex: null,
        sqlState: null,
      },
    };
  }

  return {
    ...base,
    status: 'published',
    snapshotRunId,
    supersededRunId,
    batchesExecuted,
    rowsWritten,
    rowsDiscarded,
    failure: null,
  };
}
