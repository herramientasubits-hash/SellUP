/**
 * BR Receita CNPJ — SECOND REAL BENCHMARK ATTEMPT CONTROL + NATIONAL INPUT GATE — tests
 * (BR-SOURCE-14B.0J § 13 tests 1–30).
 *
 * Two claims are under test and they must not be allowed to imply each other:
 *
 *   1. Attempt #2 is now STRUCTURALLY EXPRESSIBLE — the durable count exists, the attempt number is
 *      declared and judged, and the boundary accounting is defined.
 *   2. Attempt #2 is NOT AUTHORIZED, attempt #3 is impossible, and nothing here opened a real row.
 *
 * ── Nothing in this file reads real data, and that is structural ────────────────
 * Both modules under test are pure: neither imports `node:fs`, neither takes a filesystem port, and the
 * static scans at the bottom read their source as TEXT and assert those absences. The completeness gate
 * is a function over records the caller already holds, so "the preflight reads no rows" is a property of
 * the file rather than a promise about it.
 *
 * No real manifest, no dataset, no Supabase, no runtime, no Agent 1, no Agent 2A, no provider, no
 * network, no git, no repository write.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT } from '../br-receita-cnpj-full-join-no-write-guard';
import { BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT } from '../br-receita-cnpj-full-join-operator-metric-channel';
import {
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
  createBrazilReceitaFullJoinBenchmarkAttemptLedger,
} from '../br-receita-cnpj-full-join-resource-benchmark';
import {
  BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN,
  brazilReceitaNationalInputSatisfiesAttempt2,
  evaluateBrazilReceitaNationalInputCompleteness,
  summarizeBrazilReceitaNationalInputGate,
  type BrazilReceitaNationalInputCompletenessResult,
  type BrazilReceitaNationalInputFindingCode,
} from '../br-receita-cnpj-national-input-completeness';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
  brazilReceitaNextRealAttemptIsStructurallySupported,
  brazilReceitaNextRealAttemptNumber,
  brazilReceitaRealBenchmarkAttemptBudgetExhausted,
  brazilReceitaRealBenchmarkAttemptsConsumed,
  brazilReceitaRealBenchmarkExecuted,
  createBrazilReceitaRealBenchmarkAttemptBoundaryLedger,
  evaluateBrazilReceitaRealBenchmarkAttemptRequest,
  summarizeBrazilReceitaRealBenchmarkAttemptModel,
} from '../br-receita-cnpj-real-benchmark-attempt-ledger';
import {
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_CODES,
  BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES,
  brazilReceitaProposedFullScanResourceCaps,
  runBrazilReceitaRealFullScanResourceBenchmark,
  summarizeBrazilReceitaRealFullScanReadiness,
  type BrazilReceitaRealFullScanBenchmarkRequest,
  type BrazilReceitaRealFullScanDeclarations,
} from '../br-receita-cnpj-real-full-scan-benchmark';
import {
  BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_REFUSALS,
  buildBrazilReceitaRealFullScanDeclarations,
  parseBrazilReceitaRealFullScanCliArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PERIOD = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD;
const SOURCE_KEY = 'br_receita_cnpj_dados_abertos';
const JOIN_FAMILIES = ['empresas', 'estabelecimentos'] as const;
const NATIONAL_PART_COUNT = 10;

const partKeys = (count: number): readonly string[] =>
  Array.from({ length: count }, (_unused, index) => String(index));

/** A national observed inventory: both join families present, with the expected part count each. */
function observedNational(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceKey: SOURCE_KEY,
    period: PERIOD,
    encoding: 'latin1',
    delimiter: ';',
    layoutMode: 'official_headerless',
    families: JOIN_FAMILIES.map((family) => ({
      family,
      declaredPartKeys: partKeys(NATIONAL_PART_COUNT),
    })),
    forbiddenFamilyCount: 0,
    ...overrides,
  };
}

/** An EVIDENTIAL expected inventory. Synthetic — the repository has none, which is the standing gap. */
function expectedNational(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sourceKey: SOURCE_KEY,
    period: PERIOD,
    provenance: 'declared_local_inventory_contract',
    families: JOIN_FAMILIES.map((family) => ({
      family,
      expectedPartCount: NATIONAL_PART_COUNT,
    })),
    ...overrides,
  };
}

function completeness(
  observed: Record<string, unknown> = observedNational(),
  expected: Record<string, unknown> | null = expectedNational(),
): BrazilReceitaNationalInputCompletenessResult {
  return evaluateBrazilReceitaNationalInputCompleteness({
    period: PERIOD,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures deliberately pass malformed shapes
    observed: observed as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ditto, to exercise fail-closed paths
    expected: expected as any,
  });
}

function codes(
  result: BrazilReceitaNationalInputCompletenessResult,
): readonly BrazilReceitaNationalInputFindingCode[] {
  return result.findings.map((finding) => finding.code);
}

const SAFE_WORKING_DIRECTORY = {
  currentWorkingDirectory: '/workspaces/sellup-worktrees/br-14b0j/scripts',
  homeDirectory: '/home/operator',
  repositoryRoot: '/workspaces/sellup-worktrees/br-14b0j',
  datasetRoot: '/srv/receita',
  repositoryPackageName: 'sellup',
};

/** Declarations that pass every stage up to `authorization`, so a test can target one stage at a time. */
function declarations(
  overrides: Partial<BrazilReceitaRealFullScanDeclarations> = {},
): BrazilReceitaRealFullScanDeclarations {
  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  return {
    temporaryStoragePolicyApproved: true,
    capInputPolicyApproved: true,
    benchmarkAuthorization: true,
    attemptCount: 1,
    requestedRealAttemptNumber: brazilReceitaNextRealAttemptNumber(),
    nationalInputCompleteness: completeness(),
    datasetPeriod: PERIOD,
    manifestPath: '/synthetic/14b0j/manifest.json',
    privateMetricChannelAcknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
    resourceCaps: brazilReceitaProposedFullScanResourceCaps(),
    maxOpenPartitionFiles: proposal.maxOpenPartitionFiles,
    minimumFreeDiskBeforeStart: proposal.minimumFreeDiskBeforeStart,
    minimumFreeDiskReserve: proposal.minimumFreeDiskReserve,
    readerCaps: {
      maxChunkBytes: proposal.maxChunkBytes,
      maxCarryBytes: proposal.maxCarryBytes,
      maxRowBytes: proposal.maxRowBytes,
      maxColumnsPerRow: proposal.maxColumnsPerRow,
    },
    partitioningCaps: {
      partitionCount: proposal.partitionCount,
      maxPartitionCount: proposal.maxPartitionCount,
      maxPartitionDepth: proposal.maxPartitionDepth,
      maxReferencesPerPartition: proposal.maxReferencesPerPartition,
      maxReferenceBytesPerPartition: proposal.maxReferenceBytesPerPartition,
    },
    workspaceParentDirectory: '/synthetic/14b0j/scratch',
    workspaceBoundaries: {
      repositoryRoot: SAFE_WORKING_DIRECTORY.repositoryRoot,
      homeDirectory: SAFE_WORKING_DIRECTORY.homeDirectory,
      datasetRoot: null,
    },
    privateMetricDestinationDirectory: '/synthetic/14b0j/private',
    privateMetricArtifactSlug: 'brfj-14b0j',
    privateMetricArtifactTtlMs: proposal.privateMetricArtifactTtlMs,
    noWriteContract: BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
    ...overrides,
  };
}

/**
 * A request whose every filesystem port RECORDS what it was asked about and returns nothing usable.
 *
 * `touched` is then asserted EMPTY: not that the ports were given synthetic paths, but that they were
 * never called at all — the stronger claim § 9 requires.
 */
function benchmarkRequest(overrides: { declarations?: BrazilReceitaRealFullScanDeclarations } = {}): {
  request: BrazilReceitaRealFullScanBenchmarkRequest;
  touched: string[];
} {
  const touched: string[] = [];
  const record = <T>(label: string, value: T) => {
    touched.push(label);
    return value;
  };
  const request = {
    declarations: overrides.declarations ?? declarations(),
    workingDirectory: SAFE_WORKING_DIRECTORY,
    attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
    bridgeFileSystem: {
      realpathSync: (target: string) => record(`realpath:${target}`, target),
      statSync: (target: string) => record(`stat:${target}`, { isFile: () => true, size: 0 }),
      lstatSync: (target: string) => record(`lstat:${target}`, { isSymbolicLink: () => false }),
    },
    validateManifest: () => record('validateManifest', { ok: false, findings: [] }),
    readerFileSystem: { open: (target: string) => record(`open:${target}`, null) },
    workspaceFileSystem: { mkdtempSync: (target: string) => record(`mkdtemp:${target}`, target) },
    privateChannelFileSystem: {
      mkdirSync: (target: string) => record(`mkdir:${target}`, undefined),
      writeFileSync: (target: string) => record(`write:${target}`, undefined),
      renameSync: (target: string) => record(`rename:${target}`, undefined),
      unlinkSync: (target: string) => record(`unlink:${target}`, undefined),
      existsSync: (target: string) => record(`exists:${target}`, false),
    },
    privateChannelBoundaries: {
      repositoryRoot: SAFE_WORKING_DIRECTORY.repositoryRoot,
      homeDirectory: SAFE_WORKING_DIRECTORY.homeDirectory,
      datasetRoot: null,
    },
    freeDiskProbe: () => record('freeDisk', 1_000_000_000_000),
    nowMs: 1_760_000_000_000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- scripted ports, deliberately partial
  } as any as BrazilReceitaRealFullScanBenchmarkRequest;
  return { request, touched };
}

const CONNECTOR_DIRECTORY = path.resolve(__dirname, '..');

function sourceOf(moduleBasename: string): string {
  return fs.readFileSync(path.join(CONNECTOR_DIRECTORY, `${moduleBasename}.ts`), 'utf8');
}

/**
 * The module's source with COMMENTS STRIPPED.
 *
 * Necessary because these modules document what they never touch, by name: their headers say "touches no
 * Supabase, … Agent 1, Agent 2A, a provider, HubSpot or the UI". A naive text scan for `HubSpot` therefore
 * fails on the very sentence promising the absence. Stripping comments makes the scan test the CODE, which
 * is what the guarantee is actually about — and it keeps the scan honest in the other direction too: an
 * import cannot hide inside a comment.
 */
function codeOnly(moduleBasename: string): string {
  return sourceOf(moduleBasename)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// ─── § 13 tests 1–10: the attempt model ───────────────────────────────────────

describe('BR-SOURCE-14B.0J § 3–§ 6 — the durable attempt model', () => {
  it('1 — keeps both attempts consumed', () => {
    // BR-SOURCE-ATTEMPT2-CLOSURE: attempt #2 ran, crossed the boundary and breached a cap, so the durable
    // count is 2. It moved UP, by a reviewed edit, which is the only direction and the only mechanism.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED, 2);
    assert.equal(brazilReceitaRealBenchmarkAttemptsConsumed(), 2);
    // Derived, per § 4: `executed` is the count being positive, not an independent boolean.
    assert.equal(brazilReceitaRealBenchmarkExecuted(), true);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED, true);
    assert.equal(
      BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
      BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED > 0,
    );
  });

  it('2 — leaves attempt #1 evidence unchanged, including its staged-subset scope', () => {
    // Two records now, and attempt #1 is still the first of them — appended to, never rewritten.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.length, 2);
    const [attempt1] = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY;
    assert.equal(attempt1.attemptNumber, 1);
    assert.equal(attempt1.milestone, 'BR-SOURCE-14B.0G');
    assert.equal(attempt1.datasetPeriod, '2026-07');
    assert.equal(attempt1.terminalStatus, 'resource_cap_breached');
    assert.equal(attempt1.crossedRealDataBoundary, true);
    // § 8: attempt #1 ran over one part per family, not the national whole.
    assert.equal(attempt1.inputScope, 'staged_subset');
    assert.equal(attempt1.rowsEmitted, 0);
    assert.equal(attempt1.retriesPerformed, 0);
    assert.equal(
      attempt1.evidenceDocument,
      'br-receita-cnpj-14b0g-real-full-scan-benchmark-evidence',
    );
    // Frozen: the history cannot be rewritten by a caller that got hold of it.
    assert.equal(Object.isFrozen(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY), true);
    assert.equal(Object.isFrozen(attempt1), true);
    assert.throws(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- probing immutability on purpose
      (attempt1 as any).terminalStatus = 'completed';
    });
    // BR-SOURCE-ATTEMPT2-CLOSURE § 3, mechanically: attempt #1's record carries EXACTLY the nine fields
    // 14B.0J froze into it. The three fields the closure added are optional precisely so this stays true —
    // backfilling `abortStage` or a `resourceObservation` onto attempt #1 from the 14B.0G document would
    // be reconstructing an attempt record from a second source, which is what the ledger exists to stop.
    assert.deepEqual(Object.keys(attempt1).sort(), [
      'attemptNumber',
      'crossedRealDataBoundary',
      'datasetPeriod',
      'evidenceDocument',
      'inputScope',
      'milestone',
      'retriesPerformed',
      'rowsEmitted',
      'terminalStatus',
    ]);
  });

  it('3 — keeps the attempt counter monotonic and never derives a lower count', () => {
    // The count is a constant, so monotonicity is checked where it could actually be violated: every
    // accessor and every ledger state must report at least the durable figure, never less.
    assert.ok(brazilReceitaRealBenchmarkAttemptsConsumed() >= 2);
    // The in-process ledger is the § 11 accounting object, not the record. With the budget spent it can
    // still be constructed — nothing about it is gated — and the property that matters is that it never
    // reports a count BELOW the durable one, in either boundary state.
    const ledger = createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(2);
    assert.equal(ledger.resultingAttemptsConsumed(), 2);
    ledger.commitCrossing();
    assert.equal(ledger.resultingAttemptsConsumed(), 2);
    assert.ok(
      ledger.resultingAttemptsConsumed() >= BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
      'the ledger must never derive a count below the durable record',
    );
    // And the durable record itself moved up, never down: attempt #1's count was 1.
    assert.ok(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED > 1);
  });

  it('4 — resolves the next attempt number as 3, and refuses it as unsupported', () => {
    // The exhausted case, spelled through the contract that already existed rather than a new sentinel:
    // `nextAttemptNumber` answers "what would a next run claim?" (3), and the companion predicate answers
    // "may it?" (no). See the ledger's note on why this is not a `null`.
    assert.equal(brazilReceitaNextRealAttemptNumber(), 3);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS, 2);
    assert.equal(brazilReceitaNextRealAttemptIsStructurallySupported(), false);
    assert.equal(brazilReceitaRealBenchmarkAttemptBudgetExhausted(), true);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED, true);
    // The asserted constant and the derivation agree — the constant is documentation, not a second source.
    assert.equal(
      BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_BUDGET_EXHAUSTED,
      brazilReceitaRealBenchmarkAttemptBudgetExhausted(),
    );
    // No number is eligible any more. Not the one just spent, not the next one, not any beyond it.
    for (const requested of [2, 3, 4]) {
      const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested);
      assert.equal(eligibility.eligible, false);
      assert.equal(eligibility.attemptNumber, null);
      assert.equal(eligibility.authorized, false);
      assert.equal(
        eligibility.rejectionCode,
        requested === 2 ? 'real_attempt_number_already_consumed' : 'real_benchmark_attempt_limit_reached',
      );
    }
  });

  it('5 — refuses the exhausted attempt budget BEFORE the authorization stage is reached', async () => {
    // This test used to prove the opposite ordering: every earlier stage passed and the run stopped at
    // `authorization`, the one gate only an owner could open. BR-SOURCE-ATTEMPT2-CLOSURE inverts it, and
    // the inversion IS the closure — the attempt wall is stage 3, the authorization wall is stage 11, so
    // with the budget spent no configuration of approvals can reach the gate that approvals unlock.
    const { request, touched } = benchmarkRequest();
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.failedStage, 'real_attempt_eligibility');
    assert.notEqual(outcome.failedStage, 'authorization');
    assert.equal(outcome.abortCode, 'real_benchmark_attempt_limit_reached');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_REAL_FILE_OPEN');
    // The declarations above carry every approval set to `true`. They change nothing.
    assert.equal(request.declarations.benchmarkAuthorization, true);
    assert.equal(request.declarations.temporaryStoragePolicyApproved, true);
    assert.equal(request.declarations.capInputPolicyApproved, true);
    assert.deepEqual(touched, []);
    // And the stage that fired really does precede the one that used to.
    assert.ok(
      BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES.indexOf('real_attempt_eligibility') <
        BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES.indexOf('authorization'),
    );
  });

  it('6 — spends nothing when attempt #2 aborts before the real-data boundary', async () => {
    // § 5 and § 11: a preflight abort leaves the durable count where it was — 2 now. Checked across a
    // spread of declarations that used to fail at different stages; with the budget spent they all stop at
    // the attempt wall, and the invariant under test (a refusal spends nothing) is unchanged by that.
    const cases: readonly BrazilReceitaRealFullScanDeclarations[] = [
      declarations({ requestedRealAttemptNumber: 3 }),
      declarations({ nationalInputCompleteness: completeness(observedNational(), null) }),
      declarations({ resourceCaps: {} }),
      declarations(),
    ];
    for (const candidate of cases) {
      const { request, touched } = benchmarkRequest({ declarations: candidate });
      const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
      assert.equal(outcome.ok, false);
      if (outcome.ok) continue;
      assert.equal(outcome.realDataBoundaryCrossed, false);
      assert.equal(outcome.attemptsConsumedAfterRefusal, 2);
      assert.equal(outcome.realDataAccessed, false);
      assert.equal(outcome.realManifestOpened, false);
      assert.equal(outcome.rowsEmitted, 0);
      assert.deepEqual(touched, []);
    }
  });

  it('7 — would consume the attempt on crossing the real-data boundary, success or breach alike', () => {
    // § 11's rule, exercised on the ledger the entry point commits: crossing spends the attempt, and the
    // outcome afterwards is irrelevant. There is no `recordSuccess`/`recordFailure` pair to diverge.
    for (const outcome of ['completed', 'resource_cap_breached'] as const) {
      assert.ok(outcome.length > 0);
      const ledger = createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(2);
      assert.equal(ledger.boundaryState(), 'before_real_data_boundary');
      assert.equal(ledger.committedAttemptNumber(), null);
      assert.equal(ledger.commitCrossing(), true);
      assert.equal(ledger.boundaryState(), 'crossed_real_data_boundary');
      assert.equal(ledger.committedAttemptNumber(), 2);
      assert.equal(ledger.resultingAttemptsConsumed(), 2);
      // Single-flight: a second crossing in one process is refused, so a caller cannot inflate its own
      // accounting past 2 either.
      assert.equal(ledger.commitCrossing(), false);
      assert.equal(ledger.resultingAttemptsConsumed(), 2);
    }
  });

  it('8 — refuses attempt #3, and every number above it, before any source row', async () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);
    for (const requested of [3, 4, 99, 1_000_000]) {
      const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested);
      assert.equal(eligibility.eligible, false);
      assert.equal(eligibility.rejectionCode, 'real_benchmark_attempt_limit_reached');

      const { request, touched } = benchmarkRequest({
        declarations: declarations({ requestedRealAttemptNumber: requested }),
      });
      const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
      assert.equal(outcome.ok, false);
      if (outcome.ok) continue;
      assert.equal(outcome.abortCode, 'real_benchmark_attempt_limit_reached');
      assert.equal(outcome.failedStage, 'real_attempt_eligibility');
      assert.equal(outcome.attemptRejectionCode, 'real_benchmark_attempt_limit_reached');
      assert.equal(outcome.realManifestOpened, false);
      assert.deepEqual(touched, []);
    }
  });

  it('8b — refuses a run impersonating an already-consumed attempt, and every invalid number', async () => {
    // § 6's anti-impersonation rule, now load-bearing for BOTH consumed numbers: a run declaring itself #1
    // or #2 would leave the durable count where it is and let the run after it present itself as the one
    // just spent. `2` joining this list is the whole point of the closure edit — before it, `2` was
    // eligible, and only operator discipline stood between that and a second execution of attempt #2.
    for (const requested of [1, 2, 0, -1]) {
      const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested);
      assert.equal(eligibility.eligible, false);
      assert.equal(
        eligibility.rejectionCode,
        requested >= 1 ? 'real_attempt_number_already_consumed' : 'real_attempt_number_invalid',
      );
    }
    // A non-integer, a string, a NaN and an absent value are unanswered questions, never defaults.
    for (const requested of [1.5, '2', Number.NaN, null, undefined, true]) {
      assert.equal(evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested).eligible, false);
    }
    // `1` reaches the entry point as an attempt-number rejection, not as a paperwork error.
    const { request, touched } = benchmarkRequest({
      declarations: declarations({ requestedRealAttemptNumber: 1 }),
    });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.abortCode, 'real_attempt_number_already_consumed');
      assert.equal(outcome.failedStage, 'real_attempt_eligibility');
      assert.equal(outcome.attemptsConsumedAfterRefusal, 2);
    }
    assert.deepEqual(touched, []);
    // An omitted number is a MISSING DECLARATION rather than a rejected one — the operator is told the
    // field is absent instead of being told a number they never wrote is wrong.
    const { request: bare } = benchmarkRequest({
      declarations: declarations({ requestedRealAttemptNumber: undefined }),
    });
    const bareOutcome = await runBrazilReceitaRealFullScanResourceBenchmark(bare);
    assert.equal(bareOutcome.ok, false);
    if (!bareOutcome.ok) {
      assert.equal(bareOutcome.abortCode, 'declaration_missing');
      assert.ok(bareOutcome.missingDeclarations.includes('requestedRealAttemptNumber'));
    }
  });

  it('9 — exposes no reset path anywhere on the ledger surface', () => {
    const summary = summarizeBrazilReceitaRealBenchmarkAttemptModel();
    assert.equal(summary.resetPathExists, false);
    // Static scan over CODE: a reset would have to be spelled, and none of these spellings appear.
    // Deliberately writer-shaped tokens only — `const attemptsConsumed = ...` is a local READ and would
    // trip a looser pattern, which is how a guard like this ends up being weakened rather than fixed.
    const source = codeOnly('br-receita-cnpj-real-benchmark-attempt-ledger');
    for (const forbidden of [
      'reset(',
      'setAttempts',
      'clearAttempts',
      'rollbackAttempt',
      'ATTEMPTS_CONSUMED = 0',
      'ATTEMPTS_CONSUMED -',
      'consumed--',
      'consumed -=',
    ]) {
      assert.ok(!source.includes(forbidden), `the ledger must not expose "${forbidden}"`);
    }
    // And the boundary ledger's runtime surface is exactly four read/commit members — no writer.
    const ledger = createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(2);
    assert.deepEqual(Object.keys(ledger).sort(), [
      'boundaryState',
      'commitCrossing',
      'committedAttemptNumber',
      'resultingAttemptsConsumed',
    ]);
  });

  it('10 — keeps automatic retries at zero and performs none', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT, 0);
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.automaticRetryCount, 0);
    assert.equal(summarizeBrazilReceitaRealBenchmarkAttemptModel().automaticRetryCount, 0);
    const source = codeOnly('br-receita-cnpj-real-benchmark-attempt-ledger');
    for (const forbidden of ['setTimeout', 'setInterval', 'retry(', 'while (', 'for (;;)']) {
      assert.ok(!source.includes(forbidden), `the ledger must not contain "${forbidden}"`);
    }
  });
});

// ─── § 13 tests 11–18: national input completeness ────────────────────────────

describe('BR-SOURCE-14B.0J § 7 — the national input completeness gate', () => {
  it('11 — returns complete for a full national fixture with an evidential inventory', () => {
    const result = completeness();
    assert.equal(result.verdict, 'complete');
    assert.equal(result.inputScope, 'full_national');
    assert.deepEqual(result.findings, []);
    assert.equal(result.expectedInventoryKnown, true);
    assert.equal(brazilReceitaNationalInputSatisfiesAttempt2(result), true);
  });

  it('12 — reports incomplete when an Empresas part is missing', () => {
    const result = completeness(
      observedNational({
        families: [
          { family: 'empresas', declaredPartKeys: partKeys(NATIONAL_PART_COUNT - 1) },
          { family: 'estabelecimentos', declaredPartKeys: partKeys(NATIONAL_PART_COUNT) },
        ],
      }),
    );
    assert.equal(result.verdict, 'incomplete');
    assert.ok(codes(result).includes('family_part_count_short'));
    assert.equal(
      result.findings.find((finding) => finding.code === 'family_part_count_short')?.family,
      'empresas',
    );
    assert.equal(brazilReceitaNationalInputSatisfiesAttempt2(result), false);
  });

  it('13 — reports incomplete when an Estabelecimentos part is missing', () => {
    const result = completeness(
      observedNational({
        families: [
          { family: 'empresas', declaredPartKeys: partKeys(NATIONAL_PART_COUNT) },
          { family: 'estabelecimentos', declaredPartKeys: partKeys(NATIONAL_PART_COUNT - 3) },
        ],
      }),
    );
    assert.equal(result.verdict, 'incomplete');
    assert.equal(
      result.findings.find((finding) => finding.code === 'family_part_count_short')?.family,
      'estabelecimentos',
    );
    // A family declared but EMPTY is a missing family, not a zero-length success.
    const empty = completeness(
      observedNational({
        families: [
          { family: 'empresas', declaredPartKeys: partKeys(NATIONAL_PART_COUNT) },
          { family: 'estabelecimentos', declaredPartKeys: [] },
        ],
      }),
    );
    assert.equal(empty.verdict, 'incomplete');
    assert.ok(codes(empty).includes('required_family_missing'));
  });

  it('14 — reports incomplete on a duplicate part, and does not count it toward the total', () => {
    const duplicated = [...partKeys(NATIONAL_PART_COUNT - 1), '0'];
    assert.equal(duplicated.length, NATIONAL_PART_COUNT);
    const result = completeness(
      observedNational({
        families: [
          { family: 'empresas', declaredPartKeys: duplicated },
          { family: 'estabelecimentos', declaredPartKeys: partKeys(NATIONAL_PART_COUNT) },
        ],
      }),
    );
    assert.equal(result.verdict, 'incomplete');
    assert.ok(codes(result).includes('duplicate_part_declared'));
    // The decisive part: ten declared parts of which one is a repeat is NINE parts. A gate that counted
    // the array length would have called this national.
    assert.ok(codes(result).includes('family_part_count_short'));
  });

  it('15 — returns indeterminate when the expected inventory is unknown', () => {
    // BR-SOURCE-14B.0K landed a publisher-derived inventory, so the repository-level flag is now `true`.
    // The behaviour under test is unchanged and is the point: the flag is descriptive, the gate reads the
    // CALLER's records, and a caller that supplies no expectation is still refused.
    assert.equal(BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN, true);
    const absent = completeness(observedNational(), null);
    assert.equal(absent.verdict, 'indeterminate');
    assert.equal(absent.inputScope, 'indeterminate');
    assert.ok(codes(absent).includes('expected_inventory_absent'));
    assert.equal(absent.expectedInventoryKnown, false);
    assert.equal(brazilReceitaNationalInputSatisfiesAttempt2(absent), false);

    // The OPERATIONAL standing case: nothing inspected at all. It must read as missing evidence, not as a
    // set of diagnosed defects — that distinction is what keeps `--readiness` honest, since the CLI has no
    // way to inspect anything in this milestone.
    const notInspected = evaluateBrazilReceitaNationalInputCompleteness({
      period: PERIOD,
      observed: null,
      expected: null,
    });
    assert.equal(notInspected.verdict, 'indeterminate');
    assert.equal(notInspected.inputScope, 'indeterminate');
    assert.deepEqual(
      [...codes(notInspected)].sort(),
      ['expected_inventory_absent', 'observed_inventory_absent'],
    );
    // And crucially NOT any of the defect codes an all-null record would otherwise manufacture.
    for (const manufactured of [
      'source_key_mismatch',
      'period_mismatch',
      'encoding_incompatible',
      'delimiter_incompatible',
      'layout_incompatible',
      'required_family_missing',
      'family_part_count_short',
    ] as const) {
      assert.ok(
        !codes(notInspected).includes(manufactured),
        `an uninspected input must not report "${manufactured}"`,
      );
    }
    assert.equal(brazilReceitaNationalInputSatisfiesAttempt2(notInspected), false);

    // Even WITH an evidential expected inventory, an uninspected observed side stays indeterminate: the
    // part counts cannot be compared against something nobody read.
    const evidentialButUnread = evaluateBrazilReceitaNationalInputCompleteness({
      period: PERIOD,
      observed: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic fixture
      expected: expectedNational() as any,
    });
    assert.equal(evidentialButUnread.verdict, 'indeterminate');
    assert.deepEqual([...codes(evidentialButUnread)], ['observed_inventory_absent']);

    // An operator's own assertion is the claim under test, not evidence for it.
    for (const provenance of ['operator_assertion', 'unknown', undefined, 'trust_me']) {
      const asserted = completeness(observedNational(), expectedNational({ provenance }));
      assert.equal(asserted.verdict, 'indeterminate');
      assert.ok(codes(asserted).includes('expected_inventory_provenance_not_evidential'));
    }

    // A count nobody declared is not a satisfied count.
    const undeclared = completeness(
      observedNational(),
      expectedNational({
        families: [{ family: 'empresas', expectedPartCount: NATIONAL_PART_COUNT }],
      }),
    );
    assert.equal(undeclared.verdict, 'indeterminate');
    assert.ok(codes(undeclared).includes('expected_inventory_part_count_undeclared'));
    assert.equal(
      undeclared.findings.find(
        (finding) => finding.code === 'expected_inventory_part_count_undeclared',
      )?.family,
      'estabelecimentos',
    );
  });

  it('16 — never calls a staged subset full national', () => {
    // Attempt #1's shape: one part per family. With a known expectation this is a diagnosed subset.
    const staged = completeness(
      observedNational({
        families: JOIN_FAMILIES.map((family) => ({ family, declaredPartKeys: ['0'] })),
      }),
    );
    assert.equal(staged.verdict, 'incomplete');
    assert.equal(staged.inputScope, 'staged_subset');
    assert.notEqual(staged.inputScope, 'full_national');
    assert.equal(brazilReceitaNationalInputSatisfiesAttempt2(staged), false);

    // Without a known expectation the SAME input is `indeterminate`, never `staged_subset`: the refusal
    // must rest on missing evidence rather than on a diagnosis nobody could make.
    const unknown = completeness(
      observedNational({
        families: JOIN_FAMILIES.map((family) => ({ family, declaredPartKeys: ['0'] })),
      }),
      null,
    );
    assert.equal(unknown.verdict, 'indeterminate');
    assert.equal(unknown.inputScope, 'indeterminate');
  });

  it('17 — accepts a full inventory as full_national, and refuses substitutions and bad shapes', () => {
    assert.equal(completeness().inputScope, 'full_national');

    // Excess parts are as wrong as missing ones: it is not the expected collection.
    const excess = completeness(
      observedNational({
        families: JOIN_FAMILIES.map((family) => ({
          family,
          declaredPartKeys: partKeys(NATIONAL_PART_COUNT + 1),
        })),
      }),
    );
    assert.equal(excess.verdict, 'incomplete');
    assert.ok(codes(excess).includes('family_part_count_excess'));

    // An unrecognized family standing in for a required one.
    const substituted = completeness(
      observedNational({
        families: [
          { family: 'empresas_v2', declaredPartKeys: partKeys(NATIONAL_PART_COUNT) },
          { family: 'estabelecimentos', declaredPartKeys: partKeys(NATIONAL_PART_COUNT) },
        ],
      }),
    );
    assert.equal(substituted.verdict, 'incomplete');
    assert.ok(codes(substituted).includes('unexpected_family_substitution'));
    assert.ok(codes(substituted).includes('required_family_missing'));

    // Encoding, delimiter, layout, source key and period must all match what the join path can read.
    for (const [key, value, expectedCode] of [
      ['encoding', 'utf8', 'encoding_incompatible'],
      ['delimiter', ',', 'delimiter_incompatible'],
      ['layoutMode', 'header', 'layout_incompatible'],
      ['sourceKey', 'br_other_source', 'source_key_mismatch'],
      ['period', '2026-06', 'period_mismatch'],
    ] as const) {
      const result = completeness(observedNational({ [key]: value }));
      assert.equal(result.verdict, 'incomplete');
      assert.ok(codes(result).includes(expectedCode), `${key} must yield ${expectedCode}`);
    }
  });

  it('18 — reads no row, opens no file, and cannot: the module has no I/O at all', () => {
    const result = completeness();
    assert.equal(result.rowsRead, 0);
    assert.equal(result.filesOpened, 0);
    assert.equal(result.filesStatted, 0);
    const standing = summarizeBrazilReceitaNationalInputGate();
    assert.equal(standing.readsRows, false);
    assert.equal(standing.opensFiles, false);
    assert.equal(standing.gateImplemented, true);
    // 14B.0K: known for 2026-07 and no other period, and knowing it still blocks a caller who has not
    // inspected anything.
    assert.equal(standing.expectedInventoryKnown, true);
    assert.deepEqual(standing.expectedInventoryKnownPeriods, ['2026-07']);
    assert.equal(standing.standingVerdictWithoutInventory, 'indeterminate');
    assert.equal(standing.attempt1InputScope, 'staged_subset');
    assert.equal(standing.attempt2RequiredInputScope, 'full_national');

    // Structural, not aspirational: there is no import through which a row could arrive.
    const source = codeOnly('br-receita-cnpj-national-input-completeness');
    for (const forbidden of [
      'node:fs',
      "from 'fs'",
      'node:child_process',
      'readFileSync',
      'createReadStream',
      'statSync',
      'openSync',
      'process.env',
    ]) {
      assert.ok(!source.includes(forbidden), `the completeness gate must not reference ${forbidden}`);
    }

    // A part key that looks like a file name is refused rather than reported.
    const leaky = completeness(
      observedNational({
        families: [
          { family: 'empresas', declaredPartKeys: ['K3241_EMPRECSV.csv'] },
          { family: 'estabelecimentos', declaredPartKeys: ['/srv/receita/estab0'] },
        ],
      }),
    );
    assert.equal(leaky.verdict, 'incomplete');
    assert.ok(codes(leaky).includes('part_key_not_opaque'));
    // And no finding carries the offending string.
    const serialized = JSON.stringify(leaky.findings);
    assert.ok(!serialized.includes('EMPRECSV'));
    assert.ok(!serialized.includes('/srv/receita'));
  });
});

// ─── § 13 tests 19–21: person-linked families ─────────────────────────────────

describe('BR-SOURCE-14B.0J § 7 — person-linked families are refused', () => {
  it('19–21 — refuses QSA, Sócios and every CPF/person-linked family label', () => {
    for (const family of [
      'qsa',
      'socios',
      'socio',
      'cpf',
      'pessoa_fisica',
      'person_links',
      'partners',
      'shareholders',
      'representante_legal',
    ]) {
      const result = completeness(
        observedNational({
          families: [
            ...JOIN_FAMILIES.map((join) => ({
              family: join,
              declaredPartKeys: partKeys(NATIONAL_PART_COUNT),
            })),
            { family, declaredPartKeys: ['0'] },
          ],
        }),
      );
      assert.equal(result.verdict, 'incomplete', `${family} must not yield a passing verdict`);
      assert.ok(
        codes(result).includes('forbidden_person_linked_family'),
        `${family} must be refused as person-linked`,
      );
      assert.equal(brazilReceitaNationalInputSatisfiesAttempt2(result), false);
    }

    // A non-zero forbidden-family COUNT from the metadata reader is decisive on its own, even when the
    // family labels themselves were filtered out before this gate saw them.
    const counted = completeness(observedNational({ forbiddenFamilyCount: 1 }));
    assert.equal(counted.verdict, 'incomplete');
    assert.ok(codes(counted).includes('forbidden_person_linked_family'));

    // And it stays `incomplete` rather than being softened to `indeterminate` when evidence is also
    // missing: a person-linked family means the same thing whether or not an inventory exists.
    const withoutInventory = completeness(observedNational({ forbiddenFamilyCount: 2 }), null);
    assert.equal(withoutInventory.verdict, 'incomplete');
    assert.ok(codes(withoutInventory).includes('forbidden_person_linked_family'));
  });
});

// ─── § 13 tests 22–24: authorization stays false ──────────────────────────────

describe('BR-SOURCE-14B.0J § 12 — authorization remains false', () => {
  it('22 — keeps the authorization constant false and reports it separately from readiness', () => {
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    const readiness = summarizeBrazilReceitaRealFullScanReadiness();
    assert.equal(readiness.realFullScanBenchmarkAuthorized, false);
    assert.equal(readiness.secondRealBenchmarkAuthorized, false);
    // The controls being finished and the run being permitted are separate fields with separate values.
    assert.equal(readiness.secondRealBenchmarkControlReady, true);
    assert.equal(readiness.gate2ReadyForOwnerReview, false);
    assert.equal(readiness.attemptModel.attemptsConsumed, 2);
    assert.equal(readiness.attemptModel.nextAttemptNumber, 3);
    assert.equal(readiness.attemptModel.nextAttemptStructurallySupported, false);
    assert.equal(readiness.attemptModel.attemptBudgetExhausted, true);
    assert.equal(readiness.attemptModel.attempt3Allowed, false);
    // BR-SOURCE-ATTEMPT2-CLOSURE § 2: `--readiness` must not advertise an authorization that is no longer
    // obtainable. This field was a hardcoded `true`; it is now derived, and with the budget spent it says
    // so. The CONTROLS being ready (asserted above) is a separate claim and stays `true`.
    assert.equal(readiness.realFullScanBenchmarkReadyForOwnerAuthorization, false);
    // 14B.0K supplied the expectation; the readiness path still inspects nothing, so its standing verdict
    // is still `indeterminate` and Gate 2 is still not ready.
    assert.equal(readiness.nationalInputGate.expectedInventoryKnown, true);
    assert.equal(readiness.nationalInputGate.standingVerdictWithoutInventory, 'indeterminate');

    // Nothing in the attempt model reports an authorization at all.
    assert.ok(!Object.keys(readiness.attemptModel).includes('authorized'));
    // And no source file in this milestone commits an authorization to `true`.
    for (const moduleName of [
      'br-receita-cnpj-real-benchmark-attempt-ledger',
      'br-receita-cnpj-national-input-completeness',
      'br-receita-cnpj-real-full-scan-benchmark',
      'br-receita-cnpj-full-join-resource-benchmark',
    ]) {
      const source = codeOnly(moduleName);
      assert.ok(!source.includes('BENCHMARK_AUTHORIZED = true'));
      assert.ok(!source.includes('AUTHORIZED = true'));
      assert.ok(!source.includes('process.env'), `${moduleName} must not read the environment`);
    }
  });

  it('23 — makes the CLI refuse a real attempt #2 by default', () => {
    const baseArgs = [
      '--real-full-scan-resource-benchmark',
      '--manifest',
      '/synthetic/14b0j/manifest.json',
      '--workspace-parent',
      '/synthetic/14b0j/scratch',
      '--private-metric-directory',
      '/synthetic/14b0j/private',
      '--dataset-period',
      PERIOD,
      '--private-metric-acknowledgement',
      BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
    ];

    // The attempt number is required and never defaulted.
    const withoutNumber = parseBrazilReceitaRealFullScanCliArgs(baseArgs);
    assert.equal(withoutNumber.ok, false);
    if (!withoutNumber.ok) {
      assert.equal(withoutNumber.refusal, 'real_attempt_number_not_declared');
    }
    for (const bad of ['two', '2.5', '0', '-1', '']) {
      const parsed = parseBrazilReceitaRealFullScanCliArgs([
        ...baseArgs,
        '--real-attempt-number',
        bad,
      ]);
      assert.equal(parsed.ok, false);
    }

    // With a valid number and no owner declaration, the parse succeeds and the owner flag stays false —
    // which is what `main()` refuses on, before any port is built.
    const parsed = parseBrazilReceitaRealFullScanCliArgs([
      ...baseArgs,
      '--real-attempt-number',
      '2',
    ]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.options.requestedRealAttemptNumber, 2);
    assert.equal(parsed.options.secondRealAttemptOwnerDeclared, false);

    // And the declarations the CLI builds still refuse: the three policy approvals mirror the
    // authorization constant, and the completeness verdict it can compute is `indeterminate`.
    const built = buildBrazilReceitaRealFullScanDeclarations(parsed.options);
    assert.equal(built.benchmarkAuthorization, false);
    assert.equal(built.temporaryStoragePolicyApproved, false);
    assert.equal(built.capInputPolicyApproved, false);
    assert.equal(built.requestedRealAttemptNumber, 2);
    const verdict = built.nationalInputCompleteness as BrazilReceitaNationalInputCompletenessResult;
    assert.equal(verdict.verdict, 'indeterminate');
    assert.equal(brazilReceitaNationalInputSatisfiesAttempt2(verdict), false);
  });

  it('23b — refuses attempt >= 3 at the CLI surface too, and declares the refusal code', () => {
    // Defence in depth for § 6. The entry point's `real_attempt_eligibility` stage is the guarantee; this
    // asserts the CLI declares the same code, so a `3` can never be answered with a generic "not
    // authorized" that sends an operator to fetch an authorization which cannot make the run legal.
    const cliRefusals = BRAZIL_RECEITA_REAL_FULL_SCAN_CLI_REFUSALS as readonly string[];
    assert.ok(cliRefusals.includes('real_benchmark_attempt_limit_reached'));
    assert.ok(cliRefusals.includes('real_attempt_owner_declaration_missing'));
    assert.ok(cliRefusals.includes('real_attempt_number_not_declared'));
    assert.ok(cliRefusals.includes('real_attempt_number_not_an_integer'));

    // And the ledger the CLI consults returns that code for every number at or above 3.
    for (const requested of [3, 4, 17]) {
      assert.equal(
        evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested).rejectionCode,
        'real_benchmark_attempt_limit_reached',
      );
    }
  });

  it('24 — records that the second real benchmark HAS been executed, with its own evidence', () => {
    // The inversion of what this test asserted before BR-SOURCE-ATTEMPT2-CLOSURE. Two attempts, both
    // consumed, and attempt #2 present under its own milestone.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.length, 2);
    const attempt2 = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.find(
      (entry) => entry.attemptNumber === 2,
    );
    assert.ok(attempt2, 'attempt #2 must be recorded');
    assert.equal(attempt2.milestone, 'BR-SOURCE-ATTEMPT2-RUN');
    assert.equal(attempt2.datasetPeriod, '2026-07');
    assert.equal(attempt2.terminalStatus, 'resource_cap_breached');
    // The boundary WAS crossed — that is what spent the attempt, per § 11, regardless of the terminal.
    assert.equal(attempt2.crossedRealDataBoundary, true);
    // Attempt #1 was a staged subset; this one was the national whole. That distinction is the reason
    // attempt #2 existed at all, so recording it wrongly would erase the milestone's only new fact.
    assert.equal(attempt2.inputScope, 'full_national');
    assert.equal(attempt2.rowsEmitted, 0);
    assert.equal(attempt2.retriesPerformed, 0);
    assert.equal(attempt2.abortStage, 'empresas_reference_pass');
    assert.equal(Object.isFrozen(attempt2), true);
    assert.equal(brazilReceitaNextRealAttemptNumber(), 3);
    // The attempt-2 scope constants stay as they were: they describe the run that happened.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD, '2026-07');
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE, 'full_national');
    assert.equal(attempt2.datasetPeriod, BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD);
    assert.equal(attempt2.inputScope, BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE);
  });

  it('24a — classifies attempt #2 as an external-memory envelope breach, not a throughput failure', () => {
    // BR-SOURCE-ATTEMPT2-CLOSURE § 5. The two consumed attempts share a terminal code and nothing else:
    // attempt #1 exhausted six hours, attempt #2 used 0.05 % of them and died on external memory.
    // Collapsing the two into "the national join is too slow" is the misreading this pins shut.
    const attempt2 = BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.find(
      (entry) => entry.attemptNumber === 2,
    );
    assert.ok(attempt2);
    assert.equal(attempt2.failureClassification, 'resource_envelope_external_memory');
    // NO record — neither attempt — is classified as a national throughput failure.
    assert.ok(
      !BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.some(
        (entry) => entry.failureClassification === 'national_throughput_failure',
      ),
      'no attempt may be recorded as a national throughput failure',
    );

    const observation = attempt2.resourceObservation;
    assert.ok(observation, 'attempt #2 must carry its sanitized resource observation');
    assert.equal(observation.breachedCapKey, 'maxExternalMemoryBytes');
    assert.equal(observation.breachedCapObservedValue, 67_725_759);
    assert.equal(observation.breachedCapLimitValue, 67_108_864);
    assert.equal(observation.breachedCapOverage, 616_895);
    // The overage is the arithmetic, not a separately typed number.
    assert.equal(
      observation.breachedCapOverage,
      observation.breachedCapObservedValue - observation.breachedCapLimitValue,
    );
    assert.ok(observation.breachedCapObservedValue > observation.breachedCapLimitValue);
    assert.equal(observation.durationMs, 9_737);
    assert.equal(observation.bytesRead, 205_520_896);
    assert.equal(observation.rowsRead, 2_555_904);
    assert.equal(observation.peakHeapUsedBytes, 115_595_544);
    assert.equal(observation.peakRssBytes, 337_002_496);
    assert.equal(observation.temporaryStoragePeakBytes, 40_894_464);
    assert.equal(observation.filesOpenedPeakConcurrent, 33);
    assert.equal(observation.partitionHandlesPeak, 32);
    assert.equal(observation.partitionsCreated, 1_024);
    assert.equal(observation.materializedOutputRows, 0);
    assert.equal(observation.sanitizerPassed, true);
    assert.equal(observation.cleanupPassed, true);
    // § 5's other prohibition: nothing here may be read as throughput having been proven.
    assert.equal(observation.throughputEvidenceProduced, false);
    assert.equal(Object.isFrozen(observation), true);

    // Privacy: the record is counters and slugs only. The checks are about VALUES — an identifier-shaped
    // digit run, a filesystem path, a person-linked family label. The connector's own name appears in the
    // evidence slug and is not what this guards; a check that tripped on it would be a check that gets
    // deleted rather than one that catches a leak.
    const serialized = JSON.stringify(attempt2);
    assert.ok(!/\d{14}/.test(serialized), 'no CNPJ-shaped digit run may appear');
    assert.ok(!serialized.includes('/'), 'no path separator may appear');
    for (const forbidden of ['razao', 'socio', 'qsa', 'nome_', 'cpf']) {
      assert.ok(!serialized.toLowerCase().includes(forbidden), `must not serialize "${forbidden}"`);
    }
    // Every leaf is a number, a boolean or a short slug — never free text.
    for (const value of Object.values(attempt2.resourceObservation ?? {})) {
      assert.ok(
        typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string',
        'the observation must be scalars only',
      );
    }
  });

  it('24b — preempts the period gate too, because the attempt wall precedes it', async () => {
    // This asserted `dataset_period_not_authorized_for_attempt` at the `national_input_completeness`
    // stage. That stage is stage 4 and the attempt wall is stage 3, so with the budget spent the period
    // gate is no longer reachable through the entry point. The period CONSTANT is still asserted (test 24),
    // and what is proven here is the preemption — a wrong period cannot sneak past a spent budget either.
    const { request, touched } = benchmarkRequest({
      declarations: declarations({
        datasetPeriod: '2026-06',
        nationalInputCompleteness: evaluateBrazilReceitaNationalInputCompleteness({
          period: '2026-06',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic fixture
          observed: observedNational({ period: '2026-06' }) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- synthetic fixture
          expected: expectedNational({ period: '2026-06' }) as any,
        }),
      }),
    });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.abortCode, 'real_benchmark_attempt_limit_reached');
      assert.equal(outcome.failedStage, 'real_attempt_eligibility');
      assert.equal(outcome.attemptsConsumedAfterRefusal, 2);
    }
    assert.deepEqual(touched, []);
    assert.ok(
      BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES.indexOf('real_attempt_eligibility') <
        BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES.indexOf('national_input_completeness'),
    );
  });
});

// ─── § 13 tests 25–30: caps, scope and blast radius ───────────────────────────

describe('BR-SOURCE-14B.0J § 10, § 15 — caps unchanged and scope respected', () => {
  it('25 — leaves every § 10 cap exactly as it was', () => {
    // The full § 10 table, transcribed. A cap widened to make attempt #2 fit would be the milestone
    // failing at its own premise.
    assert.deepEqual(
      { ...BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS },
      {
        maxRssBytes: 536_870_912,
        maxHeapUsedBytes: 134_217_728,
        maxExternalMemoryBytes: 67_108_864,
        maxRuntimeMs: 21_600_000,
        maxPhaseRuntimeMs: 21_600_000,
        maxTemporaryStorageBytes: 4_294_967_296,
        minimumFreeDiskBeforeStart: 12_884_901_888,
        minimumFreeDiskReserve: 8_589_934_592,
        maxFilesOpened: 64,
        maxOpenPartitionFiles: 32,
        maxBytesRead: 73_014_444_032,
        maxRowsRead: 360_000_000,
        maxJoinKeysInMemory: 131_072,
        maxOutputRows: 0,
        partitionCount: 1_024,
        maxPartitionCount: 2_048,
        maxPartitionDepth: 1,
        maxReferencesPerPartition: 131_072,
        maxReferenceBytesPerPartition: 2_097_152,
        maxChunkBytes: 4_194_304,
        maxCarryBytes: 65_536,
        maxRowBytes: 65_536,
        maxColumnsPerRow: 64,
        privateMetricArtifactTtlMs: 3_600_000,
        attemptCount: 1,
        automaticRetryCount: 0,
      },
    );
  });

  it('26 — keeps the output-row cap at exactly zero', () => {
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxOutputRows, 0);
    assert.equal(brazilReceitaProposedFullScanResourceCaps().maxOutputRows, 0);
  });

  it('27–30 — touches no Supabase, runtime, Agent 1, Agent 2A or provider', () => {
    const forbidden = [
      '@supabase',
      'supabase',
      'createSupabaseAdminClient',
      'source_company_snapshots',
      'prospect_candidates',
      'hubspot',
      'HubSpot',
      'apollo',
      'Apollo',
      'lusha',
      'Lusha',
      'tavily',
      'openai',
      'anthropic',
      'fetch(',
      'axios',
      'node:http',
      'child_process',
      'migrations',
    ];
    for (const moduleName of [
      'br-receita-cnpj-real-benchmark-attempt-ledger',
      'br-receita-cnpj-national-input-completeness',
    ]) {
      const source = codeOnly(moduleName);
      for (const token of forbidden) {
        assert.ok(
          !source.includes(token),
          `${moduleName} must not reference "${token}" — it is outside this milestone's blast radius`,
        );
      }
    }
  });

  it('exposes every new abort code and preflight stage the milestone requires', () => {
    for (const code of [
      'real_attempt_number_invalid',
      'real_attempt_number_already_consumed',
      'real_attempt_number_not_next',
      'real_benchmark_attempt_limit_reached',
      'dataset_period_not_authorized_for_attempt',
      'national_input_not_complete',
    ] as const) {
      assert.ok(
        (BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_CODES as readonly string[]).includes(code),
        `${code} must be a declared abort code`,
      );
    }
    // The two new stages sit BEFORE the caps, so a third attempt dies as early as the data allows.
    const stages = BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES as readonly string[];
    assert.ok(stages.includes('real_attempt_eligibility'));
    assert.ok(stages.includes('national_input_completeness'));
    assert.ok(stages.indexOf('real_attempt_eligibility') < stages.indexOf('resource_caps'));
    assert.ok(
      stages.indexOf('real_attempt_eligibility') < stages.indexOf('national_input_completeness'),
    );
    // And authorization is still last.
    assert.equal(stages[stages.length - 1], 'authorization');
  });

  it('refuses before the national gate and the caps alike, at the attempt wall', async () => {
    // Previously: the national gate fired before the caps were parsed. Both of those stages sit behind the
    // attempt wall, so the ordering claim is now made one stage earlier — and made more strongly, since
    // NEITHER a broken input nor broken caps can produce a different answer while the budget is spent.
    const { request, touched } = benchmarkRequest({
      declarations: declarations({
        nationalInputCompleteness: completeness(observedNational(), null),
        // Deliberately broken caps too: nothing downstream of stage 3 is consulted.
        resourceCaps: {},
      }),
    });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.abortCode, 'real_benchmark_attempt_limit_reached');
      assert.equal(outcome.failedStage, 'real_attempt_eligibility');
      // Neither later stage ran, so neither reported a finding.
      assert.deepEqual(outcome.capRejections, []);
      assert.deepEqual(outcome.missingDeclarations, []);
    }
    assert.deepEqual(touched, []);
    // The declared stage order is what makes that inevitable rather than incidental.
    const order = BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES;
    assert.ok(order.indexOf('real_attempt_eligibility') < order.indexOf('national_input_completeness'));
    assert.ok(order.indexOf('national_input_completeness') < order.indexOf('resource_caps'));
  });
});
