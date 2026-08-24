/**
 * BR Receita CNPJ — the typed publication-run handle.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-A — monthly Receita snapshot identity foundation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE WRITES NOTHING and READS NOTHING. No Supabase client, no
 * filesystem, no network, no env, no clock, no randomness.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a handle exists at all ──────────────────────────────────────────────
 *
 * A monthly rebuild has to be able to stage period P a second time while the first copy of P is
 * still the one readers see. That means rows are no longer identified by their period alone: two
 * physical row sets for 2026-07 must be able to coexist, one published and one still loading. The
 * dimension that separates them is the PUBLICATION RUN — `snapshot_run_id`.
 *
 * The run id is minted by the DATABASE at `begin_period` (`source_snapshot_runs.id` defaults to
 * `gen_random_uuid()`), so the planner cannot know it when the plan is built. The naive fix is for
 * the executor to remember "the run I just started" in a variable and stamp rows with it. That is
 * exactly the ambient-state inference this handle exists to make impossible: a batch that reads the
 * current run from somewhere other than its own operation is a batch that can be written into the
 * wrong run.
 *
 * So the handle is a TOKEN with a hole in it. It is created unresolved, `begin_period` fills it
 * with the id the database returned, and the batch stream refuses to produce a single row until it
 * is filled. There is no module-level "current run", no default, and no fallback to the period.
 *
 * ── Single assignment ───────────────────────────────────────────────────────
 *
 * The one mutation this module permits is the resolution itself, and it is single-assignment:
 * resolving twice with the SAME id is a tolerated no-op (a retried executor step), resolving with a
 * DIFFERENT id throws. A handle that could be re-pointed mid-stream would let the first half of a
 * period land in run A and the second half in run B — a torn run, which is the failure the whole
 * run dimension is meant to prevent.
 *
 * ── 🔴 The run id is NOT an identity representation ─────────────────────────
 *
 * `snapshot_run_id` is a PUBLICATION/VERSION identifier. It is not a CNPJ representation, it is
 * never derived from a CNPJ, and it does not count against GATE-4 sub-decision 4A's "exactly ONE
 * persisted representation" — which remains `normalized_tax_id`, alone. Nothing in this module
 * accepts, reads, hashes, encodes or returns tax material; `assertRunIdIsNotDerivedFrom` exists so
 * a test can prove that rather than trust it.
 */

/**
 * Canonical UUID form, any version. The id is whatever `gen_random_uuid()` produced; this module
 * validates its SHAPE so a caller cannot smuggle a period, a counter or a tax-derived string into
 * the run dimension.
 */
export const SNAPSHOT_RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The column that carries the run dimension on both tables. */
export const SNAPSHOT_RUN_ID_COLUMN = 'snapshot_run_id' as const;

export type SnapshotRunIdRejectionReason =
  | 'missing'
  | 'not_a_string'
  | 'malformed'
  | 'derived_from_forbidden_material';

/**
 * Thrown when a value offered as a run id is not one.
 *
 * 🔴 The message carries the REASON only, never the rejected value. This class is on the same code
 * path as tax material, and `derived_from_forbidden_material` is by definition raised on a value
 * that contains a CNPJ — echoing it would turn the guard into the leak.
 */
export class InvalidSnapshotRunIdError extends Error {
  readonly reason: SnapshotRunIdRejectionReason;

  constructor(reason: SnapshotRunIdRejectionReason) {
    super(
      `snapshot_run_id is invalid (${reason}): expected the canonical UUID a publication run was minted with`,
    );
    this.name = 'InvalidSnapshotRunIdError';
    this.reason = reason;
  }
}

/** Thrown when a batch is requested before `begin_period` resolved the run. */
export class SnapshotRunHandleUnresolvedError extends Error {
  constructor() {
    super(
      'snapshot run handle is unresolved: begin_period must return its run id before any row is stamped — a batch may never infer its run from the period or from ambient state',
    );
    this.name = 'SnapshotRunHandleUnresolvedError';
  }
}

/** Thrown when a resolved handle is re-pointed at a different run. */
export class SnapshotRunHandleReassignedError extends Error {
  constructor() {
    super(
      'snapshot run handle is already resolved to a different run: a handle is single-assignment, because a re-pointed handle would tear one period across two runs',
    );
    this.name = 'SnapshotRunHandleReassignedError';
  }
}

/** Shape-only validation of a run id. PURE, never throws. */
export function parseSnapshotRunId(
  value: unknown,
): { readonly valid: true; readonly runId: string } | { readonly valid: false; readonly reason: SnapshotRunIdRejectionReason } {
  if (value === null || value === undefined) {
    return { valid: false, reason: 'missing' };
  }
  if (typeof value !== 'string') {
    return { valid: false, reason: 'not_a_string' };
  }
  if (value.length === 0) {
    return { valid: false, reason: 'missing' };
  }
  if (!SNAPSHOT_RUN_ID_PATTERN.test(value)) {
    return { valid: false, reason: 'malformed' };
  }
  return { valid: true, runId: value };
}

/**
 * Refuses a run id that carries the material it must never carry.
 *
 * 🔴 This is a belt-and-braces check, not the primary defence: the primary defence is that a
 * canonical UUID is `[0-9a-f-]` only, so a 14-character alphanumeric CNPJ cannot be embedded in a
 * well-formed one in the first place. The explicit test exists because "cannot happen by shape" is
 * the kind of claim that quietly stops being true when a shape is relaxed, and because a reviewer
 * asking "what stops the run id from being a hash of the CNPJ?" deserves a line of code as the
 * answer rather than a comment.
 *
 * @throws {InvalidSnapshotRunIdError} when the candidate contains the forbidden material.
 */
export function assertRunIdIsNotDerivedFrom(runId: string, forbiddenMaterial: string): void {
  if (forbiddenMaterial.length === 0) {
    return;
  }
  const haystack = runId.toLowerCase().replace(/-/g, '');
  const needle = forbiddenMaterial.toLowerCase().replace(/-/g, '');
  if (haystack.includes(needle)) {
    throw new InvalidSnapshotRunIdError('derived_from_forbidden_material');
  }
}

/**
 * The publication run a batch belongs to, as an explicit token.
 *
 * Created unresolved by `createSnapshotRunHandle()`; resolved once, by the executor, from what
 * `begin_period` returned. `require()` is what every row-producing path calls, so "the run is
 * explicit" is enforced at runtime and not merely documented.
 */
export interface SnapshotRunHandle {
  /** True once `begin_period`'s id has been supplied. */
  readonly isResolved: boolean;
  /** Records the id the database minted. Idempotent for the same id; throws for a different one. */
  resolve(runId: unknown): void;
  /**
   * The resolved id.
   *
   * @throws {SnapshotRunHandleUnresolvedError} when `begin_period` has not reported its run yet.
   */
  require(): string;
}

/**
 * Mints an unresolved handle.
 *
 * 🔴 Deliberately NOT a "current run" singleton and deliberately not defaulted: every plan gets its
 * own handle, passed explicitly, so two concurrent rebuilds of the same period cannot share one.
 */
export function createSnapshotRunHandle(): SnapshotRunHandle {
  let resolved: string | null = null;

  return {
    get isResolved(): boolean {
      return resolved !== null;
    },

    resolve(runId: unknown): void {
      const parsed = parseSnapshotRunId(runId);
      if (!parsed.valid) {
        throw new InvalidSnapshotRunIdError(parsed.reason);
      }
      if (resolved !== null && resolved !== parsed.runId) {
        throw new SnapshotRunHandleReassignedError();
      }
      resolved = parsed.runId;
    },

    require(): string {
      if (resolved === null) {
        throw new SnapshotRunHandleUnresolvedError();
      }
      return resolved;
    },
  };
}
