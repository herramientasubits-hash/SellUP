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
 * ── BR-SOURCE-ATTEMPT2-CLOSURE: the count is now `2`, and the budget is spent ───
 * Attempt #2 ran on 2026-08-12 against the full national 2026-07 input, crossed the real-data boundary,
 * and aborted on `maxExternalMemoryBytes` 9,737 ms in. Under § 11 that spent the attempt, so this module's
 * count is `2` and its history has two entries.
 *
 * The reason that edit is a milestone of its own is the gap it closes. `commitCrossing()` is in-process:
 * it can report what a run DID, and `resultingAttemptsConsumed()` can compute what the durable record
 * would have to become, but neither can write this file. Between the run and this edit, the durable count
 * still read `1`, which means `evaluateBrazilReceitaRealBenchmarkAttemptRequest(2)` still returned
 * `eligible: true` — the code would have admitted a SECOND run of attempt #2, and the only thing standing
 * in the way was the operator's own discipline. That window is what this edit closes: with the count at
 * `2`, a request for `2` is refused as `real_attempt_number_already_consumed`, a request for `3` as
 * `real_benchmark_attempt_limit_reached`, and no configuration of authorization flags reaches either,
 * because the attempt wall sits ahead of the authorization wall in the entry point's preflight order.
 *
 * ── What is durable here, and why it is a source constant ───────────────────────
 * `BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED` is in source, under review. It is not a
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
 * ── STRUCTURALLY SUPPORTED is not AUTHORIZED, and neither is now available ──────
 * `..._STRUCTURALLY_SUPPORTED_ATTEMPTS` stays `2`. That is a statement about what this code can express,
 * and it is deliberately kept in a different constant, with a different name, from anything an owner
 * approves. Authorization remains `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`, it remains
 * `false`, and this module neither reads it as permission nor exports anything that could be mistaken
 * for it. Support says "attempt #2 has a shape"; authorization says "run it". Only the owner says the
 * second thing.
 *
 * ── No reset, and no way to impersonate attempt #1 (§ 3, § 6) ───────────────────
 * There is no `reset()`, no `setAttemptsConsumed()`, no `clear()` and no writable counter anywhere in
 * this module's surface. The history is a frozen record. `requestedAttemptNumber` must equal
 * `nextRealAttemptNumber()` exactly — not `<=`, not `>=` — so no attempt can present itself as an earlier
 * one (which would leave the count where it was and make the run after it look like the one just spent),
 * and #3 is refused with `real_benchmark_attempt_limit_reached` before any source row could be opened.
 *
 * With the count at `2`, that same `<=` rule is now what makes attempt #2 unrepeatable: it is refused as
 * `real_attempt_number_already_consumed`, from the durable count, so restarting the process does not help
 * and no flag can argue with it. No route to attempt #3 was added to compensate, and none should be — the
 * next real run of this benchmark requires a resource-envelope decision and a fresh owner budget, not a
 * larger number in `..._STRUCTURALLY_SUPPORTED_ATTEMPTS`.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`, `node:child_process`, or any I/O module. It decides; it does not read.
 *   - opens, stats or names a data file, a manifest or a path.
 *   - touches Supabase, a migration, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - authorizes anything, defaults an authorization to `true`, or reads an environment variable.
 */

// ─── The durable record ───────────────────────────────────────────────────────

/**
 * How many REAL full-scan benchmark attempts have been consumed, for all time. `2`.
 *
 * Consumed under BR-SOURCE-14B.0G (attempt #1) and BR-SOURCE-ATTEMPT2-RUN (attempt #2). This number only
 * ever moves UP, only by a reviewed source edit, and only after the corresponding attempt has crossed the
 * real-data boundary. Lowering it would erase an attempt that really happened and hand the operator a
 * budget they have already spent.
 *
 * It now equals `..._STRUCTURALLY_SUPPORTED_ATTEMPTS`, which is what exhaustion looks like in this model:
 * the budget is spent, `brazilReceitaNextRealAttemptNumber()` derives `3`, and `3` is the number this
 * code refuses unconditionally. See `..._ATTEMPT_BUDGET_EXHAUSTED` below.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED = 2 as const;

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

/**
 * Whether the real-attempt budget is spent. `true`.
 *
 * DERIVED at the point of use (`brazilReceitaRealBenchmarkAttemptBudgetExhausted()`); this constant is
 * the assertion that today's derivation is `true`, kept so a reader of this file does not have to run the
 * arithmetic. It is not a second source: the function below computes it from the two constants above, and
 * a test pins the two together.
 *
 * "Exhausted" is deliberately a separate word from "not allowed". `..._ATTEMPT_3_ALLOWED` was always
 * `false` — a third attempt has never had a shape. Exhaustion is the newer fact: the attempts that DID
 * have a shape have both been spent, so there is no next attempt to authorize, and nothing in this module
 * should be read as offering one.
 */
export const BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED = true as const;

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

/**
 * Which resource envelope decided a `resource_cap_breached` terminal, named rather than inferred.
 *
 * `national_throughput_failure` is a member of this union that NO record uses, and that is the point.
 * Both consumed attempts ended on a cap, but neither measured national throughput: attempt #1 spent its
 * six hours inside the Empresas reference pass without reaching the join, and attempt #2 died on external
 * memory after 9.7 seconds and 0.92 % of the national volume. Keeping the wrong classification spellable,
 * and asserting mechanically that nothing is spelled with it, is stronger than leaving it unsaid — the
 * misreading this guards against ("two attempts, both breached, therefore the national join is too slow")
 * is the one a reader arrives with.
 */
export type BrazilReceitaRealBenchmarkAttemptFailureClassification =
  | 'resource_envelope_runtime_budget'
  | 'resource_envelope_external_memory'
  | 'national_throughput_failure';

/**
 * A consumed attempt's sanitized resource observation.
 *
 * Every field is a counter, a byte figure or a millisecond figure produced by the run's own metering.
 * There is deliberately no field that could carry a CNPJ, a company name, a filesystem path, a join key
 * or a source row: this record exists so an owner can read what the envelope did, and none of those are
 * part of that answer. `rowsRead` and `bytesRead` are volumes, not contents.
 */
export interface BrazilReceitaRealBenchmarkAttemptResourceObservation {
  /** The cap that decided the terminal, as its envelope key. */
  readonly breachedCapKey: string;
  readonly breachedCapObservedValue: number;
  readonly breachedCapLimitValue: number;
  /** `observed - limit`. Positive by construction for a breach. */
  readonly breachedCapOverage: number;
  readonly peakHeapUsedBytes: number;
  readonly peakRssBytes: number;
  readonly durationMs: number;
  readonly bytesRead: number;
  readonly rowsRead: number;
  readonly temporaryStoragePeakBytes: number;
  readonly filesOpenedPeakConcurrent: number;
  readonly partitionHandlesPeak: number;
  readonly partitionsCreated: number;
  readonly materializedOutputRows: 0;
  readonly sanitizerPassed: boolean;
  readonly cleanupPassed: boolean;
  /**
   * Whether this attempt produced usable end-to-end throughput evidence.
   *
   * `false` on both attempts, and it is not a formality. An attempt that reads under one per cent of the
   * volume before dying on an unrelated cap has measured the cap, not the throughput, and a GATE-2
   * decision resting on it would be resting on nothing.
   */
  readonly throughputEvidenceProduced: false;
}

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
  /**
   * The stage the attempt aborted in. OPTIONAL, and the reason it is optional is § 3 of
   * BR-SOURCE-ATTEMPT2-CLOSURE: attempt #1's record must stay exactly as 14B.0J froze it, so every field
   * this milestone adds is one attempt #1 does not carry. Backfilling it from the 14B.0G document would
   * be rewriting an attempt record from a second source, which is the thing the ledger exists to prevent.
   */
  readonly abortStage?: string;
  /** Which envelope decided the terminal. Optional for the same § 3 reason as `abortStage`. */
  readonly failureClassification?: BrazilReceitaRealBenchmarkAttemptFailureClassification;
  /** The sanitized metering. Optional for the same § 3 reason as `abortStage`. */
  readonly resourceObservation?: BrazilReceitaRealBenchmarkAttemptResourceObservation;
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
 *
 * ── Attempt #2, as BR-SOURCE-ATTEMPT2-RUN reported it ──────────────────────────
 * Recorded by BR-SOURCE-ATTEMPT2-CLOSURE, whose § 3 is equally explicit that attempt #1's entry is not to
 * be touched: the entry below is APPENDED, and attempt #1's literal above is unchanged, field for field.
 *
 * `inputScope` is `full_national` on the strength of the run's own preflight, which resolved 10 + 10 part
 * descriptors against the authoritative 2026-07 publisher inventory and reported
 * `NATIONAL_INPUT_COMPLETENESS = complete`. That is the distinction attempt #1 could not make.
 *
 * `terminalStatus` is again `resource_cap_breached`, and the resemblance is where the misreading lives:
 * the two attempts broke DIFFERENT caps, for different reasons, and only one of them was about time.
 * Attempt #2 spent 9,737 ms of a 21,600,000 ms budget — 0.05 % — and died on `maxExternalMemoryBytes` by
 * 616,895 bytes, with `partitionHandlesPeak` sitting exactly on `maxOpenPartitionFiles`. Hence
 * `failureClassification: 'resource_envelope_external_memory'`, and hence
 * `throughputEvidenceProduced: false` on a run that read 0.92 % of the national volume.
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
    Object.freeze({
      attemptNumber: 2,
      milestone: 'BR-SOURCE-ATTEMPT2-RUN',
      datasetPeriod: '2026-07',
      terminalStatus: 'resource_cap_breached',
      crossedRealDataBoundary: true,
      inputScope: 'full_national',
      evidenceDocument: 'br-receita-cnpj-attempt2-durable-closure',
      retriesPerformed: BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT,
      rowsEmitted: 0,
      abortStage: 'empresas_reference_pass',
      failureClassification: 'resource_envelope_external_memory',
      resourceObservation: Object.freeze({
        breachedCapKey: 'maxExternalMemoryBytes',
        breachedCapObservedValue: 67_725_759,
        breachedCapLimitValue: 67_108_864,
        breachedCapOverage: 616_895,
        peakHeapUsedBytes: 115_595_544,
        peakRssBytes: 337_002_496,
        durationMs: 9_737,
        bytesRead: 205_520_896,
        rowsRead: 2_555_904,
        temporaryStoragePeakBytes: 40_894_464,
        filesOpenedPeakConcurrent: 33,
        partitionHandlesPeak: 32,
        partitionsCreated: 1_024,
        materializedOutputRows: 0,
        sanitizerPassed: true,
        cleanupPassed: true,
        throughputEvidenceProduced: false,
      } as const),
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
 * Which attempt number a next run WOULD be. `3` today.
 *
 * Derived, so it cannot disagree with the history: there is no separate "next" constant to forget to
 * bump when an attempt is recorded.
 *
 * Read this together with `brazilReceitaNextRealAttemptIsStructurallySupported()`, which is `false`. The
 * pair is how this contract has always spelled "there is no next attempt", and no new sentinel was
 * introduced for the exhausted case: a `null` or a `'none'` here would be a second encoding of the same
 * fact, and every caller that currently does arithmetic on this number would have to learn about it.
 * `3` is the honest answer to "what number would a next run claim?" — and `3` is refused unconditionally.
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

/**
 * Whether every attempt this code can express has been consumed. `true` today.
 *
 * The same fact as `!brazilReceitaNextRealAttemptIsStructurallySupported()`, named positively because that
 * is how the callers that need it read: a report saying `attemptBudgetExhausted: true` cannot be skimmed
 * as permission, whereas a report saying `nextAttemptStructurallySupported: false` has been skimmed that
 * way before — it looks like a capability note rather than a terminal state.
 */
export function brazilReceitaRealBenchmarkAttemptBudgetExhausted(): boolean {
  return (
    brazilReceitaRealBenchmarkAttemptsConsumed() >=
    BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS
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
  /** Derived. `true` once both expressible attempts are consumed — see the accessor's note on naming. */
  readonly attemptBudgetExhausted: boolean;
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
    attemptBudgetExhausted: brazilReceitaRealBenchmarkAttemptBudgetExhausted(),
    attempt3Allowed: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
    realBenchmarkExecuted: brazilReceitaRealBenchmarkExecuted(),
    automaticRetryCount: BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT,
    attemptHistory: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY,
    attempt2RequiredPeriod: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD,
    attempt2RequiredInputScope: BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE,
    resetPathExists: false,
  };
}
