/**
 * BR Receita CNPJ — DURABLE REAL-BENCHMARK ATTEMPT LEDGER (BR-SOURCE-14B.0J § 4, § 5, § 6, § 11).
 *
 * BR-SOURCE-14B.0G ran the one authorized real full-scan benchmark and then wrote down, in its own
 * evidence § 7.5, the gap this module closes:
 *
 *   > `BrazilReceitaFullJoinBenchmarkAttemptLedger` is an in-process closure counter, constructed
 *   > fresh on every CLI invocation, so it does not survive a process exit. […] Durable enforcement of
 *   > single-attempt semantics does not exist and would have to be built.
 *
 * That was accurate and it was load-bearing. The control that actually stopped a second attempt was
 * `..._AUTHORIZED = false` — a flag whose whole purpose is to be flipped when an attempt IS authorized.
 * The moment it flips, nothing downstream knows that attempt #1 already happened, because the only
 * memory of it was a closure in a process that exited months earlier. An authorization for "the second
 * benchmark" would have permitted an unbounded number of them.
 *
 * ── What is durable here, and why it is a source constant ───────────────────────
 * `BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED` is `1`, in source, under review. It is not a
 * database row, not a file on disk and not an environment variable, and each of those was considered
 * and rejected for the same reason: this connector touches no Supabase, and a counter living in a file
 * the run itself may write is a counter the run can reset. A source constant can only be changed by an
 * edit, a PR and a review — which is exactly the ceremony an attempt record should require. "Durable"
 * here means "survives the process and cannot be rewritten by the process", and that is what a
 * reviewed constant is.
 *
 * ── One source of truth, and `_EXECUTED` now DERIVES from it (§ 4) ──────────────
 * § 4 forbids two contradictory sources. Before this module there were two half-sources: the boolean
 * `..._BENCHMARK_EXECUTED` and the 14B.0G document. This module makes the COUNT canonical and
 * `..._BENCHMARK_EXECUTED` a derivation of it (`attemptsConsumed > 0`), so the pair cannot disagree:
 * there is nothing to keep in sync, because one is computed from the other.
 *
 * ── STRUCTURALLY SUPPORTED is not AUTHORIZED (§ 4) ──────────────────────────────
 * `..._STRUCTURALLY_SUPPORTED_ATTEMPTS` is `2`. That is a statement about what this code can express,
 * and it is deliberately kept in a different constant, with a different name, from anything an owner
 * approves. Authorization remains `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`, it remains
 * `false`, and this module neither reads it as permission nor exports anything that could be mistaken
 * for it. Support says "attempt #2 has a shape"; authorization says "run it". Only the owner says the
 * second thing.
 *
 * ── No reset, and no way to impersonate attempt #1 (§ 3, § 6) ───────────────────
 * There is no `reset()`, no `setAttemptsConsumed()`, no `clear()` and no writable counter anywhere in
 * this module's surface. The history is a frozen record. `requestedAttemptNumber` must equal
 * `nextRealAttemptNumber()` exactly — not `<=`, not `>=` — so attempt #2 cannot present itself as #1
 * (which would leave the count at 1 and make a third run look like a second), and #3 is refused with
 * `real_benchmark_attempt_limit_reached` before any source row could be opened.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`, `node:child_process`, or any I/O module. It decides; it does not read.
 *   - opens, stats or names a data file, a manifest or a path.
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - authorizes anything, defaults an authorization to `true`, or reads an environment variable.
 */

// ─── The durable record ───────────────────────────────────────────────────────

/**
 * How many REAL full-scan benchmark attempts have been consumed, for all time. `1`.
 *
 * Consumed under BR-SOURCE-14B.0G. This number only ever moves UP, only by a reviewed source edit, and
 * only after the corresponding attempt has crossed the real-data boundary. Lowering it would erase an
 * attempt that really happened and hand the operator a budget they have already spent.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED = 1 as const;

/**
 * How many real attempts this code can EXPRESS. `2`.
 *
 * Not an authorization and not a grant — see the module header. It is the number that makes attempt #2
 * describable so that an owner decision can be about a concrete, already-reviewed control path rather
 * than about a code change nobody has written yet.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS = 2 as const;

/** Whether a third real attempt is permitted, in any configuration, ever. It is not. */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED = false as const;

/** Automatic retries, restated here as data so the ledger's own report can carry it. Zero. */
export const BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT = 0 as const;

/**
 * The dataset period attempt #2 must target, if it is ever run.
 *
 * Named rather than inferred: the owner decision is about 2026-07 specifically, and a run against a
 * different period would be a different benchmark wearing this one's authorization.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD = '2026-07' as const;

/**
 * The input scope attempt #2 must have. `full_national`.
 *
 * Attempt #1 was a staged subset (see the history below), and 14B.0J § 8 is explicit that the second
 * run must not repeat over a calibration subset. This constant is what makes that a gate rather than
 * an intention.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE = 'full_national' as const;

// ─── Attempt history (§ 3: never reset, never overwritten) ─────────────────────

/** How a real attempt ended. Closed set; every member is a TERMINAL state. */
export type BrazilReceitaRealBenchmarkAttemptTerminalStatus =
  | 'completed'
  | 'resource_cap_breached'
  | 'aborted_before_real_data_boundary';

/**
 * Whether an attempt's input was the national whole or a subset of it.
 *
 * `indeterminate` is a first-class member and not a failure of record-keeping: for an attempt whose
 * expected national inventory was never declared, "we do not know" is the only true answer, and a
 * ledger that had to choose between `full_national` and `staged_subset` would have to guess.
 */
export type BrazilReceitaRealBenchmarkAttemptInputScope =
  | 'full_national'
  | 'staged_subset'
  | 'indeterminate';

/** One consumed attempt, as recorded. Read-only, and never edited once written. */
export interface BrazilReceitaRealBenchmarkAttemptRecord {
  readonly attemptNumber: number;
  readonly milestone: string;
  readonly datasetPeriod: string;
  readonly terminalStatus: BrazilReceitaRealBenchmarkAttemptTerminalStatus;
  readonly crossedRealDataBoundary: boolean;
  readonly inputScope: BrazilReceitaRealBenchmarkAttemptInputScope;
  /** The public bucketed evidence document. A slug, never an absolute path. */
  readonly evidenceDocument: string;
  readonly retriesPerformed: typeof BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT;
  readonly rowsEmitted: 0;
}

/**
 * Attempt #1, exactly as BR-SOURCE-14B.0G reported it.
 *
 * `inputScope` is `staged_subset` on that document's own authority: its § 2 coverage caveat states that
 * each join family was a single part of a dataset the Receita publishes in roughly ten parts per
 * family, so a complete traversal of that manifest was a traversal of approximately one tenth of the
 * national universe. Recording it as `full_national` would have made the second attempt look like a
 * repeat instead of the first national run.
 *
 * `terminalStatus` is `resource_cap_breached`: the six-hour owner budget ceiling (`maxRuntimeMs`) was
 * exhausted during the Empresas reference pass. § 3 of this milestone forbids changing any of it.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY: readonly BrazilReceitaRealBenchmarkAttemptRecord[] =
  Object.freeze([
    Object.freeze({
      attemptNumber: 1,
      milestone: 'BR-SOURCE-14B.0G',
      datasetPeriod: '2026-07',
      terminalStatus: 'resource_cap_breached',
      crossedRealDataBoundary: true,
      inputScope: 'staged_subset',
      evidenceDocument: 'br-receita-cnpj-14b0g-real-full-scan-benchmark-evidence',
      retriesPerformed: BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT,
      rowsEmitted: 0,
    } as const),
  ] as const);

// ─── Derived state (§ 4: derive, do not duplicate) ────────────────────────────

/**
 * How many real attempts have been consumed. The one accessor callers should use.
 *
 * A function rather than a re-exported constant so that no caller can hold a copy that drifts from the
 * record when the record changes.
 */
export function brazilReceitaRealBenchmarkAttemptsConsumed(): number {
  return BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED;
}

/**
 * Whether a real benchmark has ever been executed — DERIVED, per § 4, from the count.
 *
 * This is the function `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED` is now computed from, which
 * is why there is no second boolean to keep in step with the first.
 */
export function brazilReceitaRealBenchmarkExecuted(): boolean {
  return BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED > 0;
}

/**
 * Which attempt number a next run would be. `2` today.
 *
 * Derived, so it cannot disagree with the history: there is no separate "next" constant to forget to
 * bump when an attempt is recorded.
 */
export function brazilReceitaNextRealAttemptNumber(): number {
  return BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED + 1;
}

/** Whether the next attempt number is one this code can express at all. `true` for 2, `false` for 3. */
export function brazilReceitaNextRealAttemptIsStructurallySupported(): boolean {
  return (
    brazilReceitaNextRealAttemptNumber() <= BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS
  );
}

// ─── Attempt-request evaluation ───────────────────────────────────────────────

/** Why an attempt request was refused. Fixed codes; never echoes a value. */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_REJECTION_CODES = [
  'real_attempt_number_invalid',
  'real_attempt_number_already_consumed',
  'real_attempt_number_not_next',
  'real_benchmark_attempt_limit_reached',
] as const;

export type BrazilReceitaRealBenchmarkAttemptRejectionCode =
  (typeof BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_REJECTION_CODES)[number];

export interface BrazilReceitaRealBenchmarkAttemptEligibility {
  readonly eligible: boolean;
  readonly attemptNumber: number | null;
  readonly rejectionCode: BrazilReceitaRealBenchmarkAttemptRejectionCode | null;
  readonly attemptsConsumed: number;
  readonly nextAttemptNumber: number;
  readonly structurallySupportedAttempts: typeof BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS;
  /** Always `false`. Eligibility is about the attempt NUMBER and never about permission. */
  readonly authorized: false;
}

/**
 * Decides whether `requestedAttemptNumber` is a structurally admissible real attempt.
 *
 * The order of the three refusals is the interesting part, because it is what makes attempt #3
 * unreachable rather than merely unlikely:
 *
 *   1. Not a positive integer → `real_attempt_number_invalid`. A `1.5`, a `NaN`, a `'2'` or a `-1` is
 *      not a smaller version of a valid request; it is an unanswered question, and defaulting it would
 *      be the whole bug.
 *   2. `<= attemptsConsumed` → `real_attempt_number_already_consumed`. This is the anti-impersonation
 *      rule from § 6: a second run declaring itself attempt #1 would leave the durable count at 1 and
 *      make a THIRD run present itself as the second.
 *   3. Over the structural ceiling → `real_benchmark_attempt_limit_reached`. Checked before
 *      `not_next` so that a request for #3 gets the limit code the milestone names, rather than a
 *      vaguer sequencing complaint.
 *   4. Anything else that is not exactly `next` → `real_attempt_number_not_next`. Gaps are refused in
 *      both directions: a jump to #4 is not a licence to skip #2.
 *
 * `authorized` is hardcoded `false` in the result. A caller that wanted to shortcut the authorization
 * gate by reading this function's verdict finds nothing here that says yes.
 */
export function evaluateBrazilReceitaRealBenchmarkAttemptRequest(
  requestedAttemptNumber: unknown,
): BrazilReceitaRealBenchmarkAttemptEligibility {
  const attemptsConsumed = brazilReceitaRealBenchmarkAttemptsConsumed();
  const nextAttemptNumber = brazilReceitaNextRealAttemptNumber();

  const base = {
    attemptsConsumed,
    nextAttemptNumber,
    structurallySupportedAttempts: BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
    authorized: false,
  } as const;

  const reject = (
    rejectionCode: BrazilReceitaRealBenchmarkAttemptRejectionCode,
  ): BrazilReceitaRealBenchmarkAttemptEligibility => ({
    ...base,
    eligible: false,
    attemptNumber: null,
    rejectionCode,
  });

  if (
    typeof requestedAttemptNumber !== 'number' ||
    !Number.isInteger(requestedAttemptNumber) ||
    requestedAttemptNumber < 1
  ) {
    return reject('real_attempt_number_invalid');
  }

  if (requestedAttemptNumber <= attemptsConsumed) {
    return reject('real_attempt_number_already_consumed');
  }

  if (requestedAttemptNumber > BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS) {
    return reject('real_benchmark_attempt_limit_reached');
  }

  if (requestedAttemptNumber !== nextAttemptNumber) {
    return reject('real_attempt_number_not_next');
  }

  return { ...base, eligible: true, attemptNumber: requestedAttemptNumber, rejectionCode: null };
}

// ─── The boundary commit (§ 11) ───────────────────────────────────────────────

/**
 * The two sides of the real-data attempt boundary, named so a report cannot blur them.
 *
 * § 11 is precise about the accounting rule and it is the opposite of the intuitive one: the attempt is
 * spent by CROSSING the boundary, not by finishing well. A run that crosses and then breaches a cap at
 * one per cent has spent it; a run that refuses in preflight has not spent anything, however complete
 * its declarations were.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_BOUNDARY_STATES = [
  'before_real_data_boundary',
  'crossed_real_data_boundary',
] as const;

export type BrazilReceitaRealBenchmarkBoundaryState =
  (typeof BRAZIL_RECEITA_REAL_BENCHMARK_BOUNDARY_STATES)[number];

/**
 * A monotonic, per-process record of whether THIS run crossed the real-data boundary.
 *
 * It exists to make the § 11 accounting observable and testable, and its scope is deliberately modest:
 * it reports what the current run did. The durable count is the source constant above, and this object
 * cannot change it — which is why `commitCrossing()` returns the count the durable record WOULD have to
 * be edited to, rather than pretending to have written anything.
 *
 * There is no `reset()`. Crossing twice in one process is refused, so a caller cannot inflate its own
 * accounting either.
 */
export interface BrazilReceitaRealBenchmarkAttemptBoundaryLedger {
  /**
   * Records that this run is about to open a real source. Returns `false` if already recorded — the
   * single-flight guard for one process.
   */
  commitCrossing(): boolean;
  boundaryState(): BrazilReceitaRealBenchmarkBoundaryState;
  /** The attempt number this run is spending, or `null` before the crossing. */
  committedAttemptNumber(): number | null;
  /**
   * What the durable consumed count must become. Equals the durable constant before the crossing, and
   * the committed attempt number after it — which is the § 11 rule stated as arithmetic.
   */
  resultingAttemptsConsumed(): number;
}

export function createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(
  attemptNumber: number,
): BrazilReceitaRealBenchmarkAttemptBoundaryLedger {
  let crossed = false;
  return {
    commitCrossing() {
      if (crossed) return false;
      crossed = true;
      return true;
    },
    boundaryState() {
      return crossed ? 'crossed_real_data_boundary' : 'before_real_data_boundary';
    },
    committedAttemptNumber() {
      return crossed ? attemptNumber : null;
    },
    resultingAttemptsConsumed() {
      return crossed ? attemptNumber : brazilReceitaRealBenchmarkAttemptsConsumed();
    },
  };
}

// ─── Reportable summary ───────────────────────────────────────────────────────

export interface BrazilReceitaRealBenchmarkAttemptModelSummary {
  readonly attemptsConsumed: number;
  readonly structurallySupportedAttempts: typeof BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS;
  readonly nextAttemptNumber: number;
  readonly nextAttemptStructurallySupported: boolean;
  readonly attempt3Allowed: typeof BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED;
  readonly realBenchmarkExecuted: boolean;
  readonly automaticRetryCount: typeof BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT;
  readonly attemptHistory: readonly BrazilReceitaRealBenchmarkAttemptRecord[];
  readonly attempt2RequiredPeriod: typeof BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD;
  readonly attempt2RequiredInputScope: typeof BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE;
  /** There is no reset path. Asserted as data so a test can check the claim mechanically. */
  readonly resetPathExists: false;
}

/**
 * The attempt model, computed rather than asserted.
 *
 * Nothing here reports an authorization, and that omission is deliberate: a summary that carried an
 * `authorized` field would eventually be read as the place to look for permission, and permission does
 * not live in this module.
 */
export function summarizeBrazilReceitaRealBenchmarkAttemptModel(): BrazilReceitaRealBenchmarkAttemptModelSummary {
  return {
    attemptsConsumed: brazilReceitaRealBenchmarkAttemptsConsumed(),
    structurallySupportedAttempts: BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
    nextAttemptNumber: brazilReceitaNextRealAttemptNumber(),
    nextAttemptStructurallySupported: brazilReceitaNextRealAttemptIsStructurallySupported(),
    attempt3Allowed: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
    realBenchmarkExecuted: brazilReceitaRealBenchmarkExecuted(),
    automaticRetryCount: BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT,
    attemptHistory: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY,
    attempt2RequiredPeriod: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD,
    attempt2RequiredInputScope: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE,
    resetPathExists: false,
  };
}
