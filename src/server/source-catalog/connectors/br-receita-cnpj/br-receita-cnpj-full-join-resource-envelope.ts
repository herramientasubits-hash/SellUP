/**
 * BR Receita CNPJ — FULL-JOIN HARD RESOURCE ENVELOPE (BR-SOURCE-14B.0C).
 *
 * The ENFORCEMENT half of the resource story. BR-SOURCE-14B.0A built the instrument that
 * measures a bounded run; this module builds the caps that STOP one. They are deliberately
 * separate modules with opposite duties, and the difference is not cosmetic:
 *
 *   14B.0A observes. A broken ruler is not a broken run, so a throwing sampler is CONTAINED:
 *           the sample is dropped, the measurement reports itself incomplete, control flow is
 *           untouched.
 *   14B.0C enforces. A cap you cannot measure is not a cap. So a throwing sampler here is
 *           TERMINAL (`measurement_unavailable`): the run is stopped, because the alternative is
 *           to continue while unable to prove the envelope still holds — which is precisely the
 *           failure mode the envelope exists to prevent.
 *
 * That asymmetry is the single most important design decision in this file. Anyone tempted to
 * "make the two modules consistent" should change neither: they are consistent already, in the
 * only sense that matters — both fail in the direction that cannot cause an unbounded run.
 *
 * ── Absent is not unlimited ─────────────────────────────────────────────────────
 * Every cap is REQUIRED. There is no default, no partial cap set, and no `null`. A cap that is
 * missing, `null`, `undefined`, non-finite, negative or fractional is a REFUSAL to start, not a
 * permission to run without a bound. This is the reason `resolveBrazilReceitaFullJoinResourceCaps`
 * returns a discriminated result instead of filling gaps: a filled gap is an invented
 * authorization.
 *
 * ── What a breach may and may not do ────────────────────────────────────────────
 * A breach stops the run cleanly and reports a fixed terminal code. It may NOT:
 *   - widen the cap it just broke (there is no setter; caps are frozen at resolution);
 *   - retry (`BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT` is 0 and is not configurable);
 *   - fall back to a different algorithm;
 *   - continue past a cleanup that failed or could not be verified.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - performs I/O: no open, no read, no write, no stat, no directory listing, no network.
 *   - reads an environment variable, a hostname, a username or a path.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider or HubSpot.
 *   - emits a path, a file name, a row, a cell, a join key or any dataset value — it is never
 *     handed one. It counts bytes and rows; it never sees them.
 *   - emits an exact magnitude into a public report. Exact figures leave only through the
 *     private operator channel (BR-SOURCE-14B.0C § 6), and only on explicit declaration.
 */

// ─── Version ──────────────────────────────────────────────────────────────────

/**
 * The ENVELOPE CONTRACT version. Bumped when a cap changes meaning, a terminal code changes
 * trigger, or a checkpoint moves — a consumer comparing two runs must be able to tell that the
 * fence itself moved.
 */
export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION = 1 as const;

/**
 * Retries are structurally zero, not configurably zero.
 *
 * A retry after a resource breach is the worst possible response: the first attempt proved the
 * work does not fit, and a second attempt spends the same resources to reach the same wall. Worse,
 * under a memory cap a retry runs in a process whose heap is already grown, so attempt two is
 * strictly more likely to breach than attempt one.
 */
export const BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT = 0 as const;

/**
 * The policy, stated so a report can carry it and a reviewer can check it against behaviour.
 */
export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BREACH_POLICY =
  'breach_stops_run_cleanly_without_retry_widening_or_algorithm_change' as const;

/**
 * The deliberate divergence from BR-SOURCE-14B.0A's containment policy, named so that a reader who
 * knows the other module does not read this one as a regression.
 */
export const BRAZIL_RECEITA_FULL_JOIN_MEASUREMENT_FAILURE_POLICY =
  'measurement_failure_is_terminal_because_an_unmeasurable_cap_is_not_a_cap' as const;

// ─── Caps ─────────────────────────────────────────────────────────────────────

/**
 * The closed set of cap keys. Order is the declaration order used in reports and in refusal
 * messages, so two runs list their caps identically.
 */
export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS = [
  'maxRssBytes',
  'maxHeapUsedBytes',
  'maxExternalMemoryBytes',
  'maxRuntimeMs',
  'maxPhaseRuntimeMs',
  'maxTemporaryStorageBytes',
  'maxFilesOpened',
  'maxBytesRead',
  'maxRowsRead',
  'maxJoinKeysInMemory',
  'maxOutputRows',
] as const;

export type BrazilReceitaFullJoinResourceCapKey =
  (typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS)[number];

/**
 * A complete cap set. Every field is required and every field is a non-negative integer.
 *
 * `maxTemporaryStorageBytes: 0` and `maxOutputRows: 0` are meaningful values, not "unset": zero
 * means the run may not create temporary storage and may not materialize an output row at all.
 * That is why zero must be expressible and why absence must not be.
 */
export type BrazilReceitaFullJoinResourceCaps = Readonly<
  Record<BrazilReceitaFullJoinResourceCapKey, number>
>;

/**
 * The § 8 PROVISIONAL proposal — the five caps the milestone's evidence can justify, and only
 * those five.
 *
 * Justification, cap by cap:
 *   `maxRssBytes` 512 MiB      — the bounded 14B.0A calibration observed `peak_rss_bucket:
 *                                lte_256mb`, so 512 MiB is one bucket of headroom above the only
 *                                measurement that exists.
 *   `maxHeapUsedBytes` 64 MiB  — observed `lte_16mb`; 64 MiB is two buckets of headroom.
 *   `maxExternalMemory` 64 MiB — observed `lte_16mb`; buffers are the one allocation a reader
 *                                grows deliberately, so it gets the same headroom as the heap.
 *   `maxTemporaryStorageBytes` 0 — GATE-2 is not approved. Zero is the current authorization, not
 *                                a guess.
 *   `maxOutputRows` 0          — a resource benchmark answers a resource question. An emitted row
 *                                would be an import, and no import is authorized.
 *
 * This is a PROPOSAL. It is not approved for production, and nothing in this module treats it as
 * a default — see `BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS`.
 */
export const BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL: Readonly<
  Partial<BrazilReceitaFullJoinResourceCaps>
> = {
  maxRssBytes: 536_870_912,
  maxHeapUsedBytes: 67_108_864,
  maxExternalMemoryBytes: 67_108_864,
  maxTemporaryStorageBytes: 0,
  maxOutputRows: 0,
};

/** The proposal's standing. Stated as data so a report cannot imply approval by omission. */
export const BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_CAP_APPROVAL_STATUS =
  'proposed_for_synthetic_preparation_only_not_approved_for_production' as const;

/**
 * The caps the proposal deliberately does NOT fill.
 *
 * Each needs evidence this milestone does not have. `maxRuntimeMs` and `maxPhaseRuntimeMs` need a
 * throughput observation (see `deriveBrazilReceitaFullJoinRuntimeCapProposal`, which currently
 * refuses). `maxFilesOpened`, `maxBytesRead`, `maxRowsRead` and `maxJoinKeysInMemory` are
 * properties of a full-scan algorithm that does not exist yet — inventing them would describe a
 * runner nobody has written.
 *
 * An operator must supply all six explicitly. That is the point: the gap is visible, and it fails
 * closed rather than defaulting.
 */
export const BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS: readonly BrazilReceitaFullJoinResourceCapKey[] =
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS.filter(
    (key) => BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL[key] === undefined,
  );

// ─── Terminal codes ───────────────────────────────────────────────────────────

/**
 * The closed set of terminal codes. Fixed machine strings: never a path, never a value, never a
 * figure, and never a free-text explanation that could carry one.
 */
export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_TERMINAL_CODES = [
  'rss_cap_exceeded',
  'heap_cap_exceeded',
  'external_memory_cap_exceeded',
  'runtime_cap_exceeded',
  'phase_runtime_cap_exceeded',
  'temporary_storage_cap_exceeded',
  'files_opened_cap_exceeded',
  'bytes_read_cap_exceeded',
  'rows_read_cap_exceeded',
  'join_keys_cap_exceeded',
  'output_rows_cap_exceeded',
  'measurement_unavailable',
  'cleanup_failed',
  'cleanup_unverified',
] as const;

export type BrazilReceitaFullJoinResourceTerminalCode =
  (typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_TERMINAL_CODES)[number];

/** Maps each measurable cap to the code its breach raises. Exhaustive by construction. */
const CAP_BREACH_CODES: Readonly<
  Record<BrazilReceitaFullJoinResourceCapKey, BrazilReceitaFullJoinResourceTerminalCode>
> = {
  maxRssBytes: 'rss_cap_exceeded',
  maxHeapUsedBytes: 'heap_cap_exceeded',
  maxExternalMemoryBytes: 'external_memory_cap_exceeded',
  maxRuntimeMs: 'runtime_cap_exceeded',
  maxPhaseRuntimeMs: 'phase_runtime_cap_exceeded',
  maxTemporaryStorageBytes: 'temporary_storage_cap_exceeded',
  maxFilesOpened: 'files_opened_cap_exceeded',
  maxBytesRead: 'bytes_read_cap_exceeded',
  maxRowsRead: 'rows_read_cap_exceeded',
  maxJoinKeysInMemory: 'join_keys_cap_exceeded',
  maxOutputRows: 'output_rows_cap_exceeded',
};

export function brazilReceitaFullJoinCapBreachCode(
  key: BrazilReceitaFullJoinResourceCapKey,
): BrazilReceitaFullJoinResourceTerminalCode {
  return CAP_BREACH_CODES[key];
}

// ─── Cap resolution ───────────────────────────────────────────────────────────

/** Why a cap set was refused. Never carries the offending value — only which key was wrong. */
export type BrazilReceitaFullJoinCapRejectionReason =
  | 'cap_absent'
  | 'cap_not_a_number'
  | 'cap_not_finite'
  | 'cap_negative'
  | 'cap_not_an_integer';

export interface BrazilReceitaFullJoinCapRejection {
  readonly key: BrazilReceitaFullJoinResourceCapKey;
  readonly reason: BrazilReceitaFullJoinCapRejectionReason;
}

export type BrazilReceitaFullJoinCapResolution =
  | { readonly ok: true; readonly caps: BrazilReceitaFullJoinResourceCaps }
  | { readonly ok: false; readonly rejections: readonly BrazilReceitaFullJoinCapRejection[] };

/**
 * Resolves an untrusted cap record into a complete, frozen cap set, or refuses.
 *
 * EVERY key is checked and EVERY rejection is reported, rather than failing on the first: an
 * operator completing a six-key gap should learn about all six in one refusal, not six times.
 *
 * The returned object is frozen. There is no widening path anywhere in this module, and freezing
 * removes the one an enterprising caller might otherwise reach for.
 */
export function resolveBrazilReceitaFullJoinResourceCaps(
  input: Readonly<Partial<Record<BrazilReceitaFullJoinResourceCapKey, unknown>>> | null | undefined,
): BrazilReceitaFullJoinCapResolution {
  const rejections: BrazilReceitaFullJoinCapRejection[] = [];
  const resolved = {} as Record<BrazilReceitaFullJoinResourceCapKey, number>;

  for (const key of BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS) {
    const raw = input?.[key];
    // `null` and `undefined` are the same refusal: an operator who omitted a cap and an operator
    // who explicitly wrote `null` have both declined to state a bound.
    if (raw === undefined || raw === null) {
      rejections.push({ key, reason: 'cap_absent' });
      continue;
    }
    if (typeof raw !== 'number') {
      rejections.push({ key, reason: 'cap_not_a_number' });
      continue;
    }
    if (!Number.isFinite(raw)) {
      // `Infinity` is the most dangerous input this function can receive: it is syntactically a
      // number and semantically "no cap". It is refused by name.
      rejections.push({ key, reason: 'cap_not_finite' });
      continue;
    }
    if (raw < 0) {
      rejections.push({ key, reason: 'cap_negative' });
      continue;
    }
    if (!Number.isInteger(raw)) {
      rejections.push({ key, reason: 'cap_not_an_integer' });
      continue;
    }
    resolved[key] = raw;
  }

  if (rejections.length > 0) return { ok: false, rejections };
  return { ok: true, caps: Object.freeze(resolved) };
}

// ─── Runtime cap derivation (§ 8) ──────────────────────────────────────────────

/**
 * The three runtime figures that must never be confused, kept as distinct names because collapsing
 * them is how an estimate becomes an authorization.
 *
 *   `estimated`  — what a model predicts the work will take.
 *   `authorized` — what an operator has agreed the run may consume. A cap.
 *   `observed`   — what a run actually took. Only exists after a run.
 */
export const BRAZIL_RECEITA_FULL_JOIN_RUNTIME_FIGURE_KINDS = [
  'estimated_runtime',
  'authorized_runtime_cap',
  'observed_runtime',
] as const;

/** The inputs a runtime estimate needs. Any missing input makes the estimate unavailable. */
export interface BrazilReceitaFullJoinRuntimeModelInputs {
  readonly datasetBytes: number | null;
  readonly readerThroughputBytesPerMs: number | null;
  readonly passesOverDataset: number | null;
  readonly catalogPasses: number | null;
  readonly cleanupAllowanceMs: number | null;
}

export type BrazilReceitaFullJoinRuntimeCapProposal =
  | {
      readonly available: false;
      readonly reason: 'insufficient_evidence';
      readonly missingInputs: readonly (keyof BrazilReceitaFullJoinRuntimeModelInputs)[];
    }
  | {
      readonly available: true;
      readonly estimatedRuntimeMs: number;
      readonly approvalStatus: typeof BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_CAP_APPROVAL_STATUS;
    };

/**
 * Derives an ESTIMATE — never a cap — from an explicit model, or refuses for lack of evidence.
 *
 * Today it refuses on every real call, and that refusal is the honest output of this milestone:
 * the only throughput observation in existence comes from a 128 KiB bounded prefix read whose
 * duration is reported as a coarse bucket, which supports no bytes-per-millisecond figure at all.
 * Multiplying a bucket by a dataset size would produce a number with the shape of evidence and
 * none of the content.
 *
 * The function exists now, refusing, so the milestone that measures throughput has a defined place
 * to put it — and so nobody has to invent `maxRuntimeMs` in the meantime.
 */
export function deriveBrazilReceitaFullJoinRuntimeCapProposal(
  inputs: BrazilReceitaFullJoinRuntimeModelInputs,
): BrazilReceitaFullJoinRuntimeCapProposal {
  const missingInputs: (keyof BrazilReceitaFullJoinRuntimeModelInputs)[] = [];
  const keys: (keyof BrazilReceitaFullJoinRuntimeModelInputs)[] = [
    'datasetBytes',
    'readerThroughputBytesPerMs',
    'passesOverDataset',
    'catalogPasses',
    'cleanupAllowanceMs',
  ];
  for (const key of keys) {
    const value = inputs[key];
    if (value === null || !Number.isFinite(value) || value < 0) missingInputs.push(key);
  }
  // Throughput is additionally required to be positive: a zero-throughput reader never finishes,
  // and an estimate of `Infinity` must not be reachable through arithmetic.
  if (
    inputs.readerThroughputBytesPerMs !== null &&
    Number.isFinite(inputs.readerThroughputBytesPerMs) &&
    inputs.readerThroughputBytesPerMs <= 0 &&
    !missingInputs.includes('readerThroughputBytesPerMs')
  ) {
    missingInputs.push('readerThroughputBytesPerMs');
  }
  if (missingInputs.length > 0) {
    return { available: false, reason: 'insufficient_evidence', missingInputs };
  }

  const datasetBytes = inputs.datasetBytes as number;
  const throughput = inputs.readerThroughputBytesPerMs as number;
  const passes = inputs.passesOverDataset as number;
  const catalogPasses = inputs.catalogPasses as number;
  const cleanupAllowanceMs = inputs.cleanupAllowanceMs as number;

  const estimatedRuntimeMs = Math.ceil(
    (datasetBytes / throughput) * (passes + catalogPasses) + cleanupAllowanceMs,
  );
  return {
    available: true,
    estimatedRuntimeMs,
    approvalStatus: BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_CAP_APPROVAL_STATUS,
  };
}

// ─── Checkpoints ──────────────────────────────────────────────────────────────

/**
 * The deterministic instants at which memory and time are re-checked.
 *
 * Fixed call sites, never a timer. A periodic watchdog would be a live handle that could fire
 * inside a phase boundary, keep the process alive, or make two runs with identical inputs
 * disagree about where they stopped — and a non-deterministic abort point is not auditable.
 *
 * The names mirror BR-SOURCE-14B.0A's sample points on purpose: one run, one set of instants, two
 * observers with different duties.
 */
export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CHECKPOINTS = [
  'before_first_access',
  'after_manifest_validation',
  'after_empresas_read',
  'after_estabelecimentos_read',
  'after_join',
  'after_cleanup',
  'after_sanitization',
] as const;

export type BrazilReceitaFullJoinResourceCheckpoint =
  (typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CHECKPOINTS)[number];

/** The phases whose individual runtime is capped. Mirrors the 14B.0A phase contract. */
export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_PHASES = [
  'preflight',
  'manifest_validation',
  'empresas_read',
  'estabelecimentos_read',
  'cleanup',
  'sanitization',
] as const;

export type BrazilReceitaFullJoinResourcePhase =
  (typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_PHASES)[number];

// ─── Cleanup outcome ──────────────────────────────────────────────────────────

/**
 * What the enforcer was told about cleanup.
 *
 * `unverified` is separate from `failed` because they are different facts: `failed` means cleanup
 * ran and could not finish, `unverified` means nobody can say whether it finished. Both stop the
 * run, and collapsing them would lose the distinction a reviewer needs.
 */
export type BrazilReceitaFullJoinResourceCleanupOutcome =
  | 'not_needed'
  | 'completed'
  | 'failed'
  | 'unverified';

// ─── Enforcement result ───────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinResourceBreach {
  readonly terminalCode: BrazilReceitaFullJoinResourceTerminalCode;
  /** The cap that was broken, or `null` for codes with no cap behind them. */
  readonly capKey: BrazilReceitaFullJoinResourceCapKey | null;
  /** Where the breach was detected. `null` when detected outside a checkpoint. */
  readonly checkpoint: BrazilReceitaFullJoinResourceCheckpoint | null;
  readonly phase: BrazilReceitaFullJoinResourcePhase | null;
  readonly retriesPerformed: typeof BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT;
  readonly policy: typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BREACH_POLICY;
}

export type BrazilReceitaFullJoinResourceOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly breach: BrazilReceitaFullJoinResourceBreach };

const OK: BrazilReceitaFullJoinResourceOutcome = { ok: true };

// ─── Exact observations (private channel input only) ──────────────────────────

/**
 * The exact figures the enforcer accumulated. NOT a public report.
 *
 * This is the ONLY way exact magnitudes leave this module, it is typed as numbers-and-enums with
 * no string field that could carry a path or a value, and its consumer
 * (`br-receita-cnpj-full-join-operator-metric-channel`) refuses to persist it without an explicit
 * operator declaration. The public surface of a run is
 * `BrazilReceitaFullJoinResourceEnvelopeReport`, which is bucketed.
 */
export interface BrazilReceitaFullJoinResourceExactObservations {
  readonly envelope_version: typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION;
  readonly peakRssBytes: number | null;
  readonly peakHeapUsedBytes: number | null;
  readonly peakExternalMemoryBytes: number | null;
  readonly totalDurationMs: number | null;
  readonly phaseDurationsMs: Readonly<Record<BrazilReceitaFullJoinResourcePhase, number | null>>;
  readonly bytesRead: number;
  readonly rowsRead: number;
  readonly filesOpened: number;
  readonly outputRowsMaterialized: number;
  readonly joinKeysPeakInMemory: number;
  readonly temporaryStoragePeakBytes: number;
  readonly checkpointsEvaluated: readonly BrazilReceitaFullJoinResourceCheckpoint[];
  readonly cleanupOutcome: BrazilReceitaFullJoinResourceCleanupOutcome | null;
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

/** A MONOTONIC clock in nanoseconds. Only differences are meaningful. */
export type BrazilReceitaFullJoinResourceClock = () => bigint;

export interface BrazilReceitaFullJoinResourceMemorySnapshot {
  readonly rss: number;
  readonly heapUsed: number;
  readonly external: number;
}

export type BrazilReceitaFullJoinResourceMemorySampler =
  () => BrazilReceitaFullJoinResourceMemorySnapshot;

export interface BrazilReceitaFullJoinResourceDependencies {
  readonly clock: BrazilReceitaFullJoinResourceClock;
  readonly memorySampler: BrazilReceitaFullJoinResourceMemorySampler;
}

/**
 * The real process-backed dependencies, behind a factory so every test drives scripted values
 * instead of racing a real clock. `process.hrtime.bigint()` is monotonic; `Date.now()` is
 * deliberately not used for durations.
 */
export function createBrazilReceitaFullJoinResourceProcessDependencies(): BrazilReceitaFullJoinResourceDependencies {
  return {
    clock: () => process.hrtime.bigint(),
    memorySampler: () => {
      const usage = process.memoryUsage();
      return { rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external };
    },
  };
}

// ─── Enforcer ─────────────────────────────────────────────────────────────────

/**
 * The live cap enforcer for ONE attempt.
 *
 * Every method returns an outcome instead of throwing, because a cap breach is an expected
 * result — the caller must route it into a terminal report, and an exception would invite a
 * `catch` that continues.
 *
 * Once breached, the enforcer is LATCHED: every subsequent call returns the SAME first breach.
 * That is deliberate. A second breach reported over the first would rewrite history, and a caller
 * that ignored the first outcome must not be able to obtain a clean one afterwards.
 */
export interface BrazilReceitaFullJoinResourceEnforcer {
  /**
   * The mandatory gate before ANY real access. Validates that the run is inside its memory and
   * (zero-elapsed) time envelope before a descriptor exists, and arms the enforcer.
   *
   * Until this has returned `ok`, every counter method refuses with the latched breach, and
   * `mayAccessData()` is false. A caller cannot reach data by skipping it.
   */
  validateBeforeFirstAccess(): BrazilReceitaFullJoinResourceOutcome;
  /** Whether real access is currently permitted: armed, and not latched on a breach. */
  mayAccessData(): boolean;
  beginPhase(phase: BrazilReceitaFullJoinResourcePhase): BrazilReceitaFullJoinResourceOutcome;
  endPhase(phase: BrazilReceitaFullJoinResourcePhase): BrazilReceitaFullJoinResourceOutcome;
  /** Re-checks memory, total runtime and the open phase's runtime at a deterministic instant. */
  checkpoint(
    checkpoint: BrazilReceitaFullJoinResourceCheckpoint,
  ): BrazilReceitaFullJoinResourceOutcome;
  noteFileOpened(): BrazilReceitaFullJoinResourceOutcome;
  noteBytesRead(bytes: number): BrazilReceitaFullJoinResourceOutcome;
  noteRowsRead(rows: number): BrazilReceitaFullJoinResourceOutcome;
  /** Reports the CURRENT size of the in-memory join-key window, not a delta. */
  noteJoinKeysInMemory(size: number): BrazilReceitaFullJoinResourceOutcome;
  noteOutputRowsMaterialized(rows: number): BrazilReceitaFullJoinResourceOutcome;
  noteTemporaryStorageBytes(peakBytes: number): BrazilReceitaFullJoinResourceOutcome;
  /** Records the cleanup outcome. `failed`/`unverified` latch a terminal breach. */
  recordCleanup(
    outcome: BrazilReceitaFullJoinResourceCleanupOutcome,
  ): BrazilReceitaFullJoinResourceOutcome;
  /** The first breach, or `null`. */
  breach(): BrazilReceitaFullJoinResourceBreach | null;
  /** Exact figures for the private operator channel. Never for a public report. */
  readExactObservations(): BrazilReceitaFullJoinResourceExactObservations;
}

const NANOSECONDS_PER_MILLISECOND = BigInt(1_000_000);

interface PhaseTiming {
  startedAtNs: bigint | null;
  durationNs: bigint | null;
}

export function createBrazilReceitaFullJoinResourceEnforcer(
  caps: BrazilReceitaFullJoinResourceCaps,
  dependencies: BrazilReceitaFullJoinResourceDependencies,
): BrazilReceitaFullJoinResourceEnforcer {
  let armed = false;
  let latched: BrazilReceitaFullJoinResourceBreach | null = null;
  let startedAtNs: bigint | null = null;
  let totalDurationNs: bigint | null = null;

  const phaseTimings = new Map<BrazilReceitaFullJoinResourcePhase, PhaseTiming>();
  let openPhase: BrazilReceitaFullJoinResourcePhase | null = null;
  const checkpointsEvaluated: BrazilReceitaFullJoinResourceCheckpoint[] = [];

  let peakRss: number | null = null;
  let peakHeapUsed: number | null = null;
  let peakExternal: number | null = null;
  let bytesRead = 0;
  let rowsRead = 0;
  let filesOpened = 0;
  let outputRows = 0;
  let joinKeysPeak = 0;
  let temporaryStoragePeak = 0;
  let cleanupOutcome: BrazilReceitaFullJoinResourceCleanupOutcome | null = null;

  /** Latches the first breach and returns it. Subsequent breaches never overwrite it. */
  function fail(
    terminalCode: BrazilReceitaFullJoinResourceTerminalCode,
    capKey: BrazilReceitaFullJoinResourceCapKey | null,
    checkpoint: BrazilReceitaFullJoinResourceCheckpoint | null,
  ): BrazilReceitaFullJoinResourceOutcome {
    if (latched === null) {
      latched = {
        terminalCode,
        capKey,
        checkpoint,
        phase: openPhase,
        retriesPerformed: BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
        policy: BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BREACH_POLICY,
      };
    }
    return { ok: false, breach: latched };
  }

  /** The latched breach as an outcome, or `null` when clean. */
  function latchedOutcome(): BrazilReceitaFullJoinResourceOutcome | null {
    return latched === null ? null : { ok: false, breach: latched };
  }

  /**
   * Reads the monotonic clock. A throwing or non-bigint clock is `measurement_unavailable` — the
   * run cannot prove it is inside its runtime cap, so it stops.
   */
  function readClockOrFail(): bigint | null {
    try {
      const now = dependencies.clock();
      if (typeof now !== 'bigint') return null;
      return now;
    } catch {
      return null;
    }
  }

  function nsToMs(ns: bigint): number {
    return Number(ns / NANOSECONDS_PER_MILLISECOND);
  }

  /**
   * Samples memory and folds the peaks, then checks the three memory caps.
   *
   * A failed sample is terminal here. See
   * `BRAZIL_RECEITA_FULL_JOIN_MEASUREMENT_FAILURE_POLICY`.
   */
  function enforceMemory(
    checkpoint: BrazilReceitaFullJoinResourceCheckpoint | null,
  ): BrazilReceitaFullJoinResourceOutcome {
    let snapshot: BrazilReceitaFullJoinResourceMemorySnapshot;
    try {
      snapshot = dependencies.memorySampler();
    } catch {
      return fail('measurement_unavailable', null, checkpoint);
    }
    if (
      typeof snapshot?.rss !== 'number' ||
      typeof snapshot?.heapUsed !== 'number' ||
      typeof snapshot?.external !== 'number' ||
      !Number.isFinite(snapshot.rss) ||
      !Number.isFinite(snapshot.heapUsed) ||
      !Number.isFinite(snapshot.external)
    ) {
      return fail('measurement_unavailable', null, checkpoint);
    }

    peakRss = peakRss === null ? snapshot.rss : Math.max(peakRss, snapshot.rss);
    peakHeapUsed =
      peakHeapUsed === null ? snapshot.heapUsed : Math.max(peakHeapUsed, snapshot.heapUsed);
    peakExternal =
      peakExternal === null ? snapshot.external : Math.max(peakExternal, snapshot.external);

    if (snapshot.rss > caps.maxRssBytes) return fail('rss_cap_exceeded', 'maxRssBytes', checkpoint);
    if (snapshot.heapUsed > caps.maxHeapUsedBytes) {
      return fail('heap_cap_exceeded', 'maxHeapUsedBytes', checkpoint);
    }
    if (snapshot.external > caps.maxExternalMemoryBytes) {
      return fail('external_memory_cap_exceeded', 'maxExternalMemoryBytes', checkpoint);
    }
    return OK;
  }

  /** Checks total runtime and, when a phase is open, that phase's runtime. */
  function enforceTime(
    checkpoint: BrazilReceitaFullJoinResourceCheckpoint | null,
  ): BrazilReceitaFullJoinResourceOutcome {
    const now = readClockOrFail();
    if (now === null) return fail('measurement_unavailable', null, checkpoint);
    if (startedAtNs === null) startedAtNs = now;

    const elapsedNs = now - startedAtNs;
    // A negative interval means the injected clock is not monotonic. The honest response is that
    // nothing was measured, and an unmeasurable runtime cap stops the run.
    if (elapsedNs < BigInt(0)) return fail('measurement_unavailable', null, checkpoint);
    totalDurationNs = elapsedNs;
    if (nsToMs(elapsedNs) > caps.maxRuntimeMs) {
      return fail('runtime_cap_exceeded', 'maxRuntimeMs', checkpoint);
    }

    if (openPhase !== null) {
      const timing = phaseTimings.get(openPhase);
      if (timing?.startedAtNs != null) {
        const phaseElapsedNs = now - timing.startedAtNs;
        if (phaseElapsedNs < BigInt(0)) return fail('measurement_unavailable', null, checkpoint);
        if (nsToMs(phaseElapsedNs) > caps.maxPhaseRuntimeMs) {
          return fail('phase_runtime_cap_exceeded', 'maxPhaseRuntimeMs', checkpoint);
        }
      }
    }
    return OK;
  }

  /** The guard every counter shares: latched breaches win, and unarmed access is refused. */
  function requireArmed(): BrazilReceitaFullJoinResourceOutcome | null {
    const already = latchedOutcome();
    if (already !== null) return already;
    if (!armed) {
      // Not a cap breach: an unvalidated envelope is an unmeasurable one.
      return fail('measurement_unavailable', null, 'before_first_access');
    }
    return null;
  }

  return {
    validateBeforeFirstAccess() {
      const already = latchedOutcome();
      if (already !== null) return already;

      const timed = enforceTime('before_first_access');
      if (!timed.ok) return timed;
      const memory = enforceMemory('before_first_access');
      if (!memory.ok) return memory;

      checkpointsEvaluated.push('before_first_access');
      armed = true;
      return OK;
    },

    mayAccessData() {
      return armed && latched === null;
    },

    beginPhase(phase) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      const now = readClockOrFail();
      if (now === null) return fail('measurement_unavailable', null, null);
      const existing = phaseTimings.get(phase);
      // The first boundary wins: a re-open would silently discard the earlier start.
      if (existing === undefined) phaseTimings.set(phase, { startedAtNs: now, durationNs: null });
      openPhase = phase;
      return OK;
    },

    endPhase(phase) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      const timing = phaseTimings.get(phase);
      const now = readClockOrFail();
      if (now === null) return fail('measurement_unavailable', null, null);
      if (timing?.startedAtNs != null && timing.durationNs === null) {
        const elapsedNs = now - timing.startedAtNs;
        if (elapsedNs < BigInt(0)) return fail('measurement_unavailable', null, null);
        timing.durationNs = elapsedNs;
        if (nsToMs(elapsedNs) > caps.maxPhaseRuntimeMs) {
          const outcome = fail('phase_runtime_cap_exceeded', 'maxPhaseRuntimeMs', null);
          openPhase = null;
          return outcome;
        }
      }
      if (openPhase === phase) openPhase = null;
      return OK;
    },

    checkpoint(checkpoint) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      checkpointsEvaluated.push(checkpoint);
      const timed = enforceTime(checkpoint);
      if (!timed.ok) return timed;
      return enforceMemory(checkpoint);
    },

    noteFileOpened() {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      filesOpened += 1;
      if (filesOpened > caps.maxFilesOpened) {
        return fail('files_opened_cap_exceeded', 'maxFilesOpened', null);
      }
      return OK;
    },

    noteBytesRead(bytes) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      if (!Number.isFinite(bytes) || bytes < 0) return fail('measurement_unavailable', null, null);
      bytesRead += bytes;
      if (bytesRead > caps.maxBytesRead) {
        return fail('bytes_read_cap_exceeded', 'maxBytesRead', null);
      }
      return OK;
    },

    noteRowsRead(rows) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      if (!Number.isFinite(rows) || rows < 0) return fail('measurement_unavailable', null, null);
      rowsRead += rows;
      if (rowsRead > caps.maxRowsRead) return fail('rows_read_cap_exceeded', 'maxRowsRead', null);
      return OK;
    },

    noteJoinKeysInMemory(size) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      if (!Number.isFinite(size) || size < 0) return fail('measurement_unavailable', null, null);
      joinKeysPeak = Math.max(joinKeysPeak, size);
      if (size > caps.maxJoinKeysInMemory) {
        return fail('join_keys_cap_exceeded', 'maxJoinKeysInMemory', null);
      }
      return OK;
    },

    noteOutputRowsMaterialized(rows) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      if (!Number.isFinite(rows) || rows < 0) return fail('measurement_unavailable', null, null);
      outputRows += rows;
      if (outputRows > caps.maxOutputRows) {
        return fail('output_rows_cap_exceeded', 'maxOutputRows', null);
      }
      return OK;
    },

    noteTemporaryStorageBytes(peakBytes) {
      const blocked = requireArmed();
      if (blocked !== null) return blocked;
      if (!Number.isFinite(peakBytes) || peakBytes < 0) {
        return fail('measurement_unavailable', null, null);
      }
      temporaryStoragePeak = Math.max(temporaryStoragePeak, peakBytes);
      if (temporaryStoragePeak > caps.maxTemporaryStorageBytes) {
        return fail('temporary_storage_cap_exceeded', 'maxTemporaryStorageBytes', null);
      }
      return OK;
    },

    recordCleanup(outcome) {
      cleanupOutcome = outcome;
      // Deliberately NOT behind `requireArmed`: cleanup must be recordable after a breach, because
      // the breach path is exactly when cleanup matters. A latched breach still wins the report.
      if (outcome === 'failed') return fail('cleanup_failed', null, 'after_cleanup');
      if (outcome === 'unverified') return fail('cleanup_unverified', null, 'after_cleanup');
      const already = latchedOutcome();
      return already !== null ? already : OK;
    },

    breach() {
      return latched;
    },

    readExactObservations() {
      const phaseDurationsMs = {} as Record<BrazilReceitaFullJoinResourcePhase, number | null>;
      for (const phase of BRAZIL_RECEITA_FULL_JOIN_RESOURCE_PHASES) {
        const durationNs = phaseTimings.get(phase)?.durationNs ?? null;
        phaseDurationsMs[phase] = durationNs === null ? null : nsToMs(durationNs);
      }
      return {
        envelope_version: BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION,
        peakRssBytes: peakRss,
        peakHeapUsedBytes: peakHeapUsed,
        peakExternalMemoryBytes: peakExternal,
        totalDurationMs: totalDurationNs === null ? null : nsToMs(totalDurationNs),
        phaseDurationsMs,
        bytesRead,
        rowsRead,
        filesOpened,
        outputRowsMaterialized: outputRows,
        joinKeysPeakInMemory: joinKeysPeak,
        temporaryStoragePeakBytes: temporaryStoragePeak,
        checkpointsEvaluated: [...checkpointsEvaluated],
        cleanupOutcome,
      };
    },
  };
}
