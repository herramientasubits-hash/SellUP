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
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_AUTOMATIC_RETRY_COUNT,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
  brazilReceitaNextRealAttemptNumber,
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
  it('1 — keeps attempt #1 consumed', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED, 1);
    assert.equal(brazilReceitaRealBenchmarkAttemptsConsumed(), 1);
    // Derived, per § 4: `executed` is the count being positive, not an independent boolean.
    assert.equal(brazilReceitaRealBenchmarkExecuted(), true);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED, true);
    assert.equal(
      BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
      BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED > 0,
    );
  });

  it('2 — leaves attempt #1 evidence unchanged, including its staged-subset scope', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.length, 1);
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
  });

  it('3 — keeps the attempt counter monotonic and never derives a lower count', () => {
    // The count is a constant, so monotonicity is checked where it could actually be violated: every
    // accessor and every ledger state must report at least the durable figure, never less.
    assert.ok(brazilReceitaRealBenchmarkAttemptsConsumed() >= 1);
    const ledger = createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(2);
    assert.equal(ledger.resultingAttemptsConsumed(), 1);
    ledger.commitCrossing();
    assert.equal(ledger.resultingAttemptsConsumed(), 2);
    assert.ok(
      ledger.resultingAttemptsConsumed() > BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
      'crossing must increase the resulting count, never decrease it',
    );
  });

  it('4 — resolves the next attempt number as 2, and calls it structurally supported', () => {
    assert.equal(brazilReceitaNextRealAttemptNumber(), 2);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS, 2);
    const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(2);
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.attemptNumber, 2);
    assert.equal(eligibility.rejectionCode, null);
    // Structurally supported is NOT authorized, and the eligibility result says so itself.
    assert.equal(eligibility.authorized, false);
  });

  it('5 — refuses attempt #2 while it is unauthorized, at the authorization stage', async () => {
    const { request, touched } = benchmarkRequest();
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    // Every earlier stage passed — including attempt eligibility and the national input gate — and the
    // run still stops, at the one gate only an owner can open.
    assert.equal(outcome.failedStage, 'authorization');
    assert.equal(outcome.abortCode, 'benchmark_not_authorized');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_REAL_FILE_OPEN');
    assert.deepEqual(touched, []);
  });

  it('6 — spends nothing when attempt #2 aborts before the real-data boundary', async () => {
    // § 5 and § 11: a preflight abort leaves the durable count at 1. Checked across a spread of
    // refusals — an early one, a late one, and today's standing authorization refusal.
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
      assert.equal(outcome.attemptsConsumedAfterRefusal, 1);
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

  it('8b — refuses attempt #2 impersonating attempt #1, and every invalid number', async () => {
    // § 6's anti-impersonation rule. A run declaring itself #1 would leave the durable count at 1 and let
    // a THIRD run present itself as the second.
    for (const requested of [1, 0, -1]) {
      const eligibility = evaluateBrazilReceitaRealBenchmarkAttemptRequest(requested);
      assert.equal(eligibility.eligible, false);
      assert.equal(
        eligibility.rejectionCode,
        requested === 1 ? 'real_attempt_number_already_consumed' : 'real_attempt_number_invalid',
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
      assert.equal(outcome.attemptsConsumedAfterRefusal, 1);
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
    // The standing case, and the reason this milestone blocks: the repository has no inventory at all.
    assert.equal(BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN, false);
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
    assert.equal(standing.expectedInventoryKnown, false);
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
    assert.equal(readiness.attemptModel.attemptsConsumed, 1);
    assert.equal(readiness.attemptModel.nextAttemptNumber, 2);
    assert.equal(readiness.attemptModel.attempt3Allowed, false);
    assert.equal(readiness.nationalInputGate.expectedInventoryKnown, false);

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

  it('24 — records that the second real benchmark has not been executed', () => {
    // One attempt in the history, and it is attempt #1.
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.length, 1);
    assert.ok(
      !BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_HISTORY.some((entry) => entry.attemptNumber === 2),
    );
    assert.equal(brazilReceitaNextRealAttemptNumber(), 2);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_PERIOD, '2026-07');
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_2_REQUIRED_INPUT_SCOPE, 'full_national');
  });

  it('24b — refuses a period other than the one attempt #2 is scoped to', async () => {
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
      assert.equal(outcome.abortCode, 'dataset_period_not_authorized_for_attempt');
      assert.equal(outcome.failedStage, 'national_input_completeness');
      assert.equal(outcome.attemptsConsumedAfterRefusal, 1);
    }
    assert.deepEqual(touched, []);
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

  it('refuses an incomplete national input before the caps are even parsed', async () => {
    const { request, touched } = benchmarkRequest({
      declarations: declarations({
        nationalInputCompleteness: completeness(observedNational(), null),
        // Deliberately broken caps too: if the national gate fires first, this is never reached.
        resourceCaps: {},
      }),
    });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.abortCode, 'national_input_not_complete');
      assert.equal(outcome.failedStage, 'national_input_completeness');
      assert.deepEqual(outcome.capRejections, []);
    }
    assert.deepEqual(touched, []);
  });
});
