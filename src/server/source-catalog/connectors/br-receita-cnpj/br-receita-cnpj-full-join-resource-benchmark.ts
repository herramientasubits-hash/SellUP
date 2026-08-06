/**
 * BR Receita CNPJ — FULL-SCAN RESOURCE BENCHMARK, PREPARED AND NOT EXECUTED
 * (BR-SOURCE-14B.0C § 9 + § 10).
 *
 * This module defines the `full_join_resource_benchmark` mode: the ordered, fail-closed preflight a
 * real full-scan resource measurement would have to pass, the operator-safety guards that must hold
 * before any byte is read, and the hard refusal that stands in the way today.
 *
 * ── The finding that shapes this whole module ───────────────────────────────────
 * The § 3 audit looked for the full-join runner and did not find one. What exists is a family of
 * ULTRA-BOUNDED probes: every real-data reader in the join path performs a SINGLE bounded read from
 * byte offset zero into a pre-allocated buffer, and none of them ever advances a file position.
 * There is no loop over a file, no second read, and therefore no code path that observes more than
 * a fixed prefix of Empresas or Estabelecimentos. The only routine that joins companies to
 * establishments across a whole collection operates on a synthetic in-memory fixture.
 *
 * That is Model D: scaffolding, extensively; an executable full-scan route, not at all.
 *
 * The honest consequence is that a "full-scan benchmark" cannot be delivered as a measurement,
 * because there is nothing to measure — and a benchmark that quietly measured a 64 KiB prefix while
 * being named for a full scan would be the single most misleading artifact this milestone could
 * produce. GATE-2 would then be asked to approve production caps derived from a run that touched a
 * millionth of the input.
 *
 * So the mode is built completely — guards, caps, checkpoints, cleanup, single-attempt, both metric
 * channels — and its preflight REFUSES with `full_join_implementation_missing`. Every control is
 * ready and tested; the thing they would control does not exist yet.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports or touches Supabase, a migration, `source_company_snapshots`, the runtime, Agent 1,
 *     Agent 2A, a provider, HubSpot or the UI.
 *   - spawns a process. It has no `child_process` reference, which is how
 *     `noGitCommandMayRunWithCwdDatasetRoot` is guaranteed rather than promised: this module cannot
 *     run git from anywhere, so it cannot run git from the dataset root.
 *   - performs I/O. It decides; it does not read. Every path it examines is a string parameter, and
 *     it never resolves one against the filesystem.
 *   - emits a row, a snapshot, a temporary file, or an authorization.
 */

import * as path from 'node:path';

import {
  BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
  resolveBrazilReceitaFullJoinResourceCaps,
  type BrazilReceitaFullJoinCapRejection,
  type BrazilReceitaFullJoinResourceCapKey,
  type BrazilReceitaFullJoinResourceCaps,
} from './br-receita-cnpj-full-join-resource-envelope';

// ─── Mode identity ────────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_MODE =
  'full_join_resource_benchmark' as const;

export const BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_VERSION = 1 as const;

/**
 * The mode EXISTS. That is not an authorization, and these two constants say so in the only way a
 * reviewer can check mechanically.
 *
 * Both are `false` literals, not configuration: a run cannot flip them, an environment variable
 * cannot flip them, and a caller cannot pass something that flips them. Changing either requires a
 * source edit, a PR, and an owner decision — which is the point.
 */
export const BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false as const;
export const BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED = false as const;

// ─── § 3 audit result, as data ────────────────────────────────────────────────

/**
 * The architectural classification from § 4, recorded so the refusal below can cite it and so a
 * future milestone can detect that it has changed.
 */
export type BrazilReceitaFullJoinArchitectureModel =
  | 'model_a_fully_bounded_streaming'
  | 'model_b_streaming_with_growing_index'
  | 'model_c_partial_or_total_materialization'
  | 'model_d_full_join_not_implemented';

export const BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL: BrazilReceitaFullJoinArchitectureModel =
  'model_d_full_join_not_implemented';

/**
 * Whether an executable full-scan join route exists. `false` per the § 3 audit.
 *
 * Only Model A may proceed to a real benchmark. Model B or C would need an architecture fix first;
 * Model D needs an implementation, and an authorization would not produce one.
 */
export const BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS = false as const;

/** The models a real benchmark could be run against. Deliberately just one. */
export const BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS: readonly BrazilReceitaFullJoinArchitectureModel[] =
  ['model_a_fully_bounded_streaming'];

// ─── Zero-effect invariants ───────────────────────────────────────────────────

/**
 * What the mode must not do, stated as data so a report can carry the claims and a test can assert
 * each one individually rather than trusting a prose paragraph.
 */
export const BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_ZERO_EFFECT_INVARIANTS = {
  emitsZeroRows: true,
  persistsZeroRecords: true,
  createsZeroSnapshots: true,
  writesZeroSupabase: true,
  usesZeroTemporaryStorage: true,
  touchesRuntime: false,
  touchesAgent1: false,
  performsImport: false,
  allowsRetry: false,
  allowsSecondAttempt: false,
  automaticRetryCount: BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
} as const;

// ─── Operator working-directory safety (§ 10) ─────────────────────────────────

/**
 * The § 10 invariants, named exactly as the milestone states them.
 *
 * The dataset sits inside an operator `$HOME` that is itself a git repository. That makes the
 * working directory a real hazard rather than a hypothetical one: a stray `git add` from the wrong
 * cwd would stage gigabytes of Receita data into someone's home repository. This mode's defence is
 * to refuse to run from anywhere it could happen — and, more fundamentally, to be incapable of
 * running git at all (see the module header).
 */
export const BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_CWD_INVARIANTS = {
  currentWorkingDirectoryMustNotBeHome: true,
  repositoryRootMustBeSellUpWorktree: true,
  datasetRootMustNotEqualRepositoryRoot: true,
  noGitCommandMayRunWithCwdDatasetRoot: true,
} as const;

/** The abort marker the milestone requires when the working directory is unsafe. */
export const BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_ABORT_STAGE = 'ABORT_BEFORE_DATA_ACCESS' as const;

/** The prefix every SellUp worktree's package name carries. */
const SELLUP_PACKAGE_NAME_PREFIX = 'sellup';

export interface BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs {
  readonly currentWorkingDirectory: string;
  readonly homeDirectory: string;
  readonly repositoryRoot: string;
  readonly datasetRoot: string | null;
  /** The repository's declared package name, read by the CLI — never by this module. */
  readonly repositoryPackageName: string;
}

export type BrazilReceitaFullJoinBenchmarkCwdViolation =
  | 'cwd_not_absolute'
  | 'cwd_is_home_directory'
  | 'cwd_inside_dataset_root'
  | 'cwd_outside_repository_root'
  | 'repository_root_not_sellup_worktree'
  | 'dataset_root_equals_repository_root';

/** True when `candidate` is `parent` or lives beneath it. Path-only; touches no filesystem. */
function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative === '') return true;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function isSamePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/**
 * Evaluates every § 10 invariant and returns ALL violations.
 *
 * All of them, not the first: an operator running from the wrong directory in the wrong tree should
 * learn both facts at once rather than fixing one and being refused again.
 */
export function evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory(
  inputs: BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs,
): readonly BrazilReceitaFullJoinBenchmarkCwdViolation[] {
  const violations: BrazilReceitaFullJoinBenchmarkCwdViolation[] = [];

  const { currentWorkingDirectory: cwd, homeDirectory, repositoryRoot, datasetRoot } = inputs;

  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
    // Without an absolute cwd nothing below can be decided, so this is reported alone.
    return ['cwd_not_absolute'];
  }

  if (isSamePath(cwd, homeDirectory)) violations.push('cwd_is_home_directory');

  if (datasetRoot !== null && isInside(cwd, datasetRoot)) {
    violations.push('cwd_inside_dataset_root');
  }

  if (
    typeof inputs.repositoryPackageName !== 'string' ||
    !inputs.repositoryPackageName.startsWith(SELLUP_PACKAGE_NAME_PREFIX)
  ) {
    violations.push('repository_root_not_sellup_worktree');
  }

  if (datasetRoot !== null && isSamePath(datasetRoot, repositoryRoot)) {
    violations.push('dataset_root_equals_repository_root');
  }

  if (!isInside(cwd, repositoryRoot)) violations.push('cwd_outside_repository_root');

  return violations;
}

// ─── Attempt ledger ───────────────────────────────────────────────────────────

/**
 * A single-use token for ONE benchmark attempt.
 *
 * A benchmark that can be run twice is not a single-attempt benchmark, and "the operator will only
 * run it once" is not a control. The ledger is the control: the second `consume()` fails, and there
 * is no reset.
 */
export interface BrazilReceitaFullJoinBenchmarkAttemptLedger {
  consume(): boolean;
  attemptsConsumed(): number;
}

export function createBrazilReceitaFullJoinBenchmarkAttemptLedger(): BrazilReceitaFullJoinBenchmarkAttemptLedger {
  let consumed = 0;
  return {
    consume() {
      if (consumed >= 1) return false;
      consumed += 1;
      return true;
    },
    attemptsConsumed() {
      return consumed;
    },
  };
}

// ─── Preflight ────────────────────────────────────────────────────────────────

/**
 * Why the benchmark refused. Ordered by the stage that raised it, and every one of them fires
 * BEFORE any data access.
 */
export type BrazilReceitaFullJoinBenchmarkAbortCode =
  | 'unsafe_operator_working_directory'
  | 'resource_caps_incomplete'
  | 'single_attempt_already_consumed'
  | 'benchmark_not_authorized'
  | 'full_join_implementation_missing';

export const BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_ABORT_CODES: readonly BrazilReceitaFullJoinBenchmarkAbortCode[] =
  [
    'unsafe_operator_working_directory',
    'resource_caps_incomplete',
    'single_attempt_already_consumed',
    'benchmark_not_authorized',
    'full_join_implementation_missing',
  ];

/**
 * The ordered preflight stages. The order is a safety property, not a style choice:
 *
 *   1. `operator_working_directory` — first, because an unsafe cwd is the one hazard that can
 *      damage something outside this run, and it must be caught before any other work happens.
 *   2. `resource_caps`             — second, because § 5 requires caps to be validated before the
 *      first real access, and a run with an incomplete envelope must never reach a descriptor.
 *   3. `single_attempt`            — third: consume the attempt only once the run is otherwise
 *      well-formed, so a caps typo does not burn the operator's single attempt.
 *   4. `authorization`             — fourth.
 *   5. `full_join_implementation`  — last, because it is the deepest fact: there is nothing to run.
 */
export const BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_PREFLIGHT_STAGES = [
  'operator_working_directory',
  'resource_caps',
  'single_attempt',
  'authorization',
  'full_join_implementation',
] as const;

export type BrazilReceitaFullJoinBenchmarkPreflightStage =
  (typeof BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_PREFLIGHT_STAGES)[number];

export interface BrazilReceitaFullJoinBenchmarkPreflightRequest {
  readonly workingDirectory: BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs;
  readonly caps: Readonly<Partial<Record<BrazilReceitaFullJoinResourceCapKey, unknown>>> | null;
  readonly attemptLedger: BrazilReceitaFullJoinBenchmarkAttemptLedger;
}

export interface BrazilReceitaFullJoinBenchmarkRefusal {
  readonly ok: false;
  readonly mode: typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_MODE;
  readonly abortStage: typeof BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_ABORT_STAGE;
  readonly abortCode: BrazilReceitaFullJoinBenchmarkAbortCode;
  readonly failedStage: BrazilReceitaFullJoinBenchmarkPreflightStage;
  readonly cwdViolations: readonly BrazilReceitaFullJoinBenchmarkCwdViolation[];
  readonly capRejections: readonly BrazilReceitaFullJoinCapRejection[];
  readonly auditedModel: BrazilReceitaFullJoinArchitectureModel;
  readonly dataAccessed: false;
  readonly rowsEmitted: 0;
  readonly retriesPerformed: typeof BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT;
  readonly realFullScanBenchmarkExecuted: typeof BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED;
}

/**
 * A preflight that PASSED. Unreachable while
 * `BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS` is `false`, and kept in the type so the shape a
 * future milestone must satisfy is written down rather than imagined.
 */
export interface BrazilReceitaFullJoinBenchmarkClearance {
  readonly ok: true;
  readonly mode: typeof BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_MODE;
  readonly caps: BrazilReceitaFullJoinResourceCaps;
  readonly auditedModel: BrazilReceitaFullJoinArchitectureModel;
  readonly dataAccessed: false;
}

export type BrazilReceitaFullJoinBenchmarkPreflightOutcome =
  | BrazilReceitaFullJoinBenchmarkClearance
  | BrazilReceitaFullJoinBenchmarkRefusal;

function refuse(
  abortCode: BrazilReceitaFullJoinBenchmarkAbortCode,
  failedStage: BrazilReceitaFullJoinBenchmarkPreflightStage,
  cwdViolations: readonly BrazilReceitaFullJoinBenchmarkCwdViolation[],
  capRejections: readonly BrazilReceitaFullJoinCapRejection[],
): BrazilReceitaFullJoinBenchmarkRefusal {
  return {
    ok: false,
    mode: BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_MODE,
    abortStage: BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_ABORT_STAGE,
    abortCode,
    failedStage,
    cwdViolations,
    capRejections,
    auditedModel: BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL,
    dataAccessed: false,
    rowsEmitted: 0,
    retriesPerformed: BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
    realFullScanBenchmarkExecuted: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
  };
}

/**
 * Runs the whole ordered preflight. Pure, synchronous, and incapable of reaching data: it opens no
 * file, and it returns a decision rather than a running benchmark.
 *
 * Today it always refuses, and the last two stages are why. That is the milestone's actual finding,
 * expressed as behaviour instead of a paragraph in a document.
 */
export function preflightBrazilReceitaFullJoinResourceBenchmark(
  request: BrazilReceitaFullJoinBenchmarkPreflightRequest,
): BrazilReceitaFullJoinBenchmarkPreflightOutcome {
  const cwdViolations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory(
    request.workingDirectory,
  );
  if (cwdViolations.length > 0) {
    return refuse('unsafe_operator_working_directory', 'operator_working_directory', cwdViolations, []);
  }

  const capResolution = resolveBrazilReceitaFullJoinResourceCaps(request.caps);
  if (!capResolution.ok) {
    return refuse('resource_caps_incomplete', 'resource_caps', [], capResolution.rejections);
  }

  if (!request.attemptLedger.consume()) {
    return refuse('single_attempt_already_consumed', 'single_attempt', [], []);
  }

  if (!BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED) {
    return refuse('benchmark_not_authorized', 'authorization', [], []);
  }

  if (
    !BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS ||
    !BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS.includes(BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL)
  ) {
    return refuse('full_join_implementation_missing', 'full_join_implementation', [], []);
  }

  return {
    ok: true,
    mode: BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_MODE,
    caps: capResolution.caps,
    auditedModel: BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL,
    dataAccessed: false,
  };
}

// ─── Readiness summary ────────────────────────────────────────────────────────

/**
 * The milestone's own readiness, computed from the constants above rather than asserted.
 *
 * `fullScanBenchmarkReadyForAuthorization` is deliberately NOT "are the controls finished". The
 * controls are finished. It is false because the thing they would control is missing, and shipping a
 * `true` here would invite an authorization for a run that cannot happen.
 */
export interface BrazilReceitaFullJoinBenchmarkReadiness {
  readonly controlsReady: boolean;
  readonly fullJoinImplementationExists: boolean;
  readonly auditedModel: BrazilReceitaFullJoinArchitectureModel;
  readonly fullScanBenchmarkReadyForAuthorization: boolean;
  readonly nextAction: 'full_join_implementation_required' | 'merge_review' | 'architecture_fix_required';
}

export function summarizeBrazilReceitaFullJoinBenchmarkReadiness(): BrazilReceitaFullJoinBenchmarkReadiness {
  const model = BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL;
  const benchmarkable = BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS.includes(model);
  return {
    controlsReady: true,
    fullJoinImplementationExists: BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS,
    auditedModel: model,
    fullScanBenchmarkReadyForAuthorization:
      benchmarkable && BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS,
    nextAction:
      model === 'model_d_full_join_not_implemented'
        ? 'full_join_implementation_required'
        : benchmarkable
          ? 'merge_review'
          : 'architecture_fix_required',
  };
}
