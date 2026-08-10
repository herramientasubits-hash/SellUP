/**
 * BR Receita CNPJ — REAL FULL-SCAN EXECUTION PATH — tests
 * (BR-SOURCE-14B.0F § 5–§ 12; § 13 tests 1–18, 34–45).
 *
 * The claim under test is narrow and easy to overstate, so it is worth stating exactly: the path from
 * a manifest to a bucketed report is now WIRED end to end, and it is still REFUSED. Those are two
 * facts, this file checks both, and it is careful never to let the first imply the second.
 *
 * ── Nothing here opens the real manifest, and that is structural ────────────────
 * Every filesystem effect the entry point can have arrives through a port, and every port in this
 * file is a scripted double that RECORDS the paths it was asked about. Several tests then assert the
 * recording is EMPTY — not that the paths were synthetic, but that the port was never called at all,
 * which is the stronger claim § 15 asks for. The one suite that exercises the engine for real uses
 * the 14B.0D synthetic fixtures: invented rows, opaque `SYN_K` join markers, in a temp directory the
 * fixture created and removes.
 *
 * ── The static scans are not decoration ─────────────────────────────────────────
 * Three of them read this milestone's own source files as TEXT and assert what is absent: no
 * Supabase, no runtime, no Agent 1, no provider, no `child_process`. A comment promising those
 * absences is worth nothing; a test that greps for them fails the moment someone adds an import.
 *
 * No repository write, no operator home, no dataset, no real manifest, no Supabase, no network, no git.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  brazilReceitaFullJoinFixtureRunDefaults,
  brazilReceitaFullJoinSyntheticKey,
  createBrazilReceitaFullJoinFixture,
  type BrazilReceitaFullJoinFixtureHandle,
  type BrazilReceitaFullJoinFixtureScenario,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import { runBrazilReceitaFullJoinStreamingEngineOnce } from '../br-receita-cnpj-full-join-engine';
import { createBrazilReceitaFullJoinNullBenchmarkSink } from '../br-receita-cnpj-full-join-engine-contract';
import {
  BRAZIL_RECEITA_FULL_JOIN_BRIDGE_ARCHIVE_EXTENSIONS,
  resolveBrazilReceitaFullJoinManifestSources,
  type BrazilReceitaFullJoinBridgeFileSystem,
  type BrazilReceitaFullJoinBridgeManifestValidator,
} from '../br-receita-cnpj-full-join-manifest-source-bridge';
import { BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT } from '../br-receita-cnpj-full-join-no-write-guard';
import {
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_ENABLED,
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_TTL_MS,
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE,
  resolveBrazilReceitaFullJoinPrivateChannel,
  toBrazilReceitaFullJoinPrivateOperatorMeasurements,
  validateBrazilReceitaFullJoinPrivateContent,
  writeBrazilReceitaFullJoinPrivateArtifact,
  type BrazilReceitaFullJoinPrivateChannelFileSystem,
} from '../br-receita-cnpj-full-join-operator-metric-channel';
import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import {
  BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
  createBrazilReceitaFullJoinResourceEnforcer,
  type BrazilReceitaFullJoinResourceDependencies,
} from '../br-receita-cnpj-full-join-resource-envelope';
import {
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
  createBrazilReceitaFullJoinBenchmarkAttemptLedger,
} from '../br-receita-cnpj-full-join-resource-benchmark';
import {
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
  BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_FIGURE_KIND,
  BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_IS_ESTIMATED,
  BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_IS_OBSERVED,
  brazilReceitaProposedFullScanResourceCaps,
  findBrazilReceitaRealFullScanMissingDeclarations,
  runBrazilReceitaRealFullScanResourceBenchmark,
  summarizeBrazilReceitaRealFullScanReadiness,
  type BrazilReceitaRealFullScanBenchmarkRequest,
  type BrazilReceitaRealFullScanDeclarations,
} from '../br-receita-cnpj-real-full-scan-benchmark';
import {
  buildBrazilReceitaRealFullScanDeclarations,
  parseBrazilReceitaRealFullScanCliArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark';

// ─── Harness ──────────────────────────────────────────────────────────────────

const CONNECTOR_DIRECTORY = path.resolve(__dirname, '..');
const SCRIPTS_DIRECTORY = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'scripts', 'source-catalog');

/** The files this milestone added or rewired. The static scans read exactly these. */
const MILESTONE_SOURCE_FILES: readonly string[] = [
  'br-receita-cnpj-full-join-open-handle-ledger.ts',
  'br-receita-cnpj-full-join-partition-handle-pool.ts',
  'br-receita-cnpj-full-join-free-disk.ts',
  'br-receita-cnpj-full-join-manifest-source-bridge.ts',
  'br-receita-cnpj-full-join-manifest-bridge-fs.ts',
  'br-receita-cnpj-real-full-scan-benchmark.ts',
  'br-receita-cnpj-full-join-partition-workspace.ts',
  'br-receita-cnpj-full-join-engine.ts',
];

const CLI_FILE = 'run-br-receita-cnpj-real-full-scan-resource-benchmark.ts';

function readMilestoneSource(name: string): string {
  return fs.readFileSync(path.join(CONNECTOR_DIRECTORY, name), 'utf8');
}

/**
 * Removes block and line comments, so a scan sees CODE.
 *
 * Every module in this connector documents what it does not touch — "this module NEVER touches
 * Supabase, the runtime, Agent 1, a provider" — and a scan over raw text would fail on exactly the
 * modules that took the trouble to say so. Worse, it would push authors to delete the sentence.
 * Stripping comments first means the scans assert what the module DOES, which is the claim worth
 * making, and it makes them strictly stronger: prose can no longer hide a violation either.
 */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * A bridge filesystem that RECORDS every path it is asked about and answers from a script.
 *
 * The recording is the point: several tests assert it is empty, which proves the refusal happened
 * before any filesystem question was asked — a stronger claim than "the paths were synthetic".
 */
interface RecordingBridgeFileSystem {
  readonly fileSystem: BrazilReceitaFullJoinBridgeFileSystem;
  readonly touched: string[];
}

function recordingBridgeFileSystem(
  script: {
    document?: string;
    symlinks?: readonly string[];
    realPaths?: Readonly<Record<string, string>>;
    nonRegular?: readonly string[];
    throwOnRead?: boolean;
  } = {},
): RecordingBridgeFileSystem {
  const touched: string[] = [];
  return {
    touched,
    fileSystem: {
      readManifestDocument(manifestPath) {
        touched.push(manifestPath);
        if (script.throwOnRead === true) throw new Error('unreadable');
        return script.document ?? '{}';
      },
      isSymbolicLink(targetPath) {
        touched.push(targetPath);
        return (script.symlinks ?? []).includes(targetPath);
      },
      realPath(targetPath) {
        touched.push(targetPath);
        return script.realPaths?.[targetPath] ?? targetPath;
      },
      isRegularFile(targetPath) {
        touched.push(targetPath);
        return !(script.nonRegular ?? []).includes(targetPath);
      },
    },
  };
}

/** A private-channel filesystem backed by a map. No disk, and every write is inspectable. */
interface MemoryPrivateChannel {
  readonly fileSystem: BrazilReceitaFullJoinPrivateChannelFileSystem;
  readonly files: Map<string, string>;
}

function memoryPrivateChannel(
  overrides: Partial<BrazilReceitaFullJoinPrivateChannelFileSystem> = {},
): MemoryPrivateChannel {
  const files = new Map<string, string>();
  const modes = new Map<string, number>();
  return {
    files,
    fileSystem: {
      writeFileExclusive(filePath, contents, mode) {
        if (files.has(filePath)) throw new Error('EEXIST');
        files.set(filePath, contents);
        modes.set(filePath, mode);
      },
      chmod(filePath, mode) {
        modes.set(filePath, mode);
      },
      statMode(filePath) {
        const mode = modes.get(filePath);
        if (mode === undefined) throw new Error('ENOENT');
        return mode;
      },
      rename(fromPath, toPath) {
        const contents = files.get(fromPath);
        if (contents === undefined) throw new Error('ENOENT');
        files.delete(fromPath);
        files.set(toPath, contents);
        modes.set(toPath, modes.get(fromPath) ?? 0);
      },
      exists(filePath) {
        return files.has(filePath);
      },
      unlink(filePath) {
        files.delete(filePath);
      },
      ...overrides,
    },
  };
}

/** A manifest validator double. Never touches a disk; never the official one. */
function scriptedValidator(
  outcome: { ok: boolean; sourceYear?: number; sourcePeriod?: string } = { ok: true },
): BrazilReceitaFullJoinBridgeManifestValidator {
  return async () =>
    ({
      ok: outcome.ok,
      sourceKey: 'br_receita_cnpj_dados_abertos',
      countryCode: 'BR',
      sourceYear: outcome.sourceYear ?? 2026,
      sourcePeriod: outcome.sourcePeriod ?? '2026-07',
      filesSeen: 2,
      filesAccepted: outcome.ok ? 2 : 0,
      filesRejected: outcome.ok ? 0 : 2,
      fileReports: [],
      safety: {
        datasetDownload: false,
        supabaseWrite: false,
        productionImport: false,
        runtimeIntegration: false,
        agent1Integration: false,
        hubspot: false,
        slack: false,
        liveProspectGeneration: false,
      },
    }) as Awaited<ReturnType<BrazilReceitaFullJoinBridgeManifestValidator>>;
}

const SYNTHETIC_MANIFEST_DIRECTORY = '/synthetic/br-14b0f/manifest';
const SYNTHETIC_MANIFEST_PATH = `${SYNTHETIC_MANIFEST_DIRECTORY}/synthetic-manifest.json`;

function syntheticManifestDocument(
  files: readonly Record<string, unknown>[] = [
    { fileType: 'empresas', path: 'synthetic-empresas.csv' },
    { fileType: 'estabelecimentos', path: 'synthetic-estabelecimentos.csv' },
  ],
): string {
  return JSON.stringify({
    mode: 'local_manifest_validation',
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    layoutMode: 'official_headerless',
    files: files.map((file) => ({
      encoding: 'latin1',
      delimiter: ';',
      layoutMode: 'official_headerless',
      ...file,
    })),
  });
}

const SAFE_WORKING_DIRECTORY = {
  currentWorkingDirectory: '/workspaces/sellup-worktrees/br-14b0f/scripts',
  homeDirectory: '/home/operator',
  repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
  datasetRoot: '/srv/receita',
  repositoryPackageName: 'sellup',
};

function completeDeclarations(
  overrides: Partial<BrazilReceitaRealFullScanDeclarations> = {},
): BrazilReceitaRealFullScanDeclarations {
  const proposal = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
  return {
    temporaryStoragePolicyApproved: true,
    capInputPolicyApproved: true,
    benchmarkAuthorization: true,
    attemptCount: 1,
    datasetPeriod: '2026-07',
    manifestPath: SYNTHETIC_MANIFEST_PATH,
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
    workspaceParentDirectory: '/synthetic/scratch',
    workspaceBoundaries: {
      repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
      homeDirectory: '/home/operator',
      datasetRoot: '/srv/receita',
    },
    privateMetricDestinationDirectory: '/synthetic/private',
    privateMetricArtifactSlug: 'brfj-metrics',
    privateMetricArtifactTtlMs: proposal.privateMetricArtifactTtlMs,
    noWriteContract: BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
    ...overrides,
  };
}

function benchmarkRequest(
  overrides: Partial<BrazilReceitaRealFullScanBenchmarkRequest> = {},
  bridge = recordingBridgeFileSystem({ document: syntheticManifestDocument() }),
): { request: BrazilReceitaRealFullScanBenchmarkRequest; bridge: RecordingBridgeFileSystem } {
  const request: BrazilReceitaRealFullScanBenchmarkRequest = {
    declarations: completeDeclarations(),
    workingDirectory: SAFE_WORKING_DIRECTORY,
    attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
    bridgeFileSystem: bridge.fileSystem,
    validateManifest: scriptedValidator(),
    readerFileSystem: {
      size() {
        throw new Error('no test may read a real file');
      },
      open() {
        throw new Error('no test may open a real file');
      },
      read() {
        throw new Error('no test may read a real file');
      },
      close() {},
    },
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    privateChannelFileSystem: memoryPrivateChannel().fileSystem,
    privateChannelBoundaries: {
      repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
      homeDirectory: '/home/operator',
      datasetRoot: '/srv/receita',
    },
    freeDiskProbe: () => 64 * 1024 * 1024 * 1024,
    nowMs: 1_700_000_000_000,
    ...overrides,
  };
  return { request, bridge };
}

let fixtures: BrazilReceitaFullJoinFixtureHandle[] = [];

function fixture(scenario: BrazilReceitaFullJoinFixtureScenario): BrazilReceitaFullJoinFixtureHandle {
  const handle = createBrazilReceitaFullJoinFixture(scenario);
  fixtures.push(handle);
  return handle;
}

afterEach(() => {
  for (const handle of fixtures) handle.dispose();
  fixtures = [];
});

// ─── § 5, § 6 — the entry point ───────────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 5 — the real entry point exists', () => {
  // Test 1.
  it('exposes a real full-scan entry point wired to the 14B.0D engine', () => {
    assert.equal(typeof runBrazilReceitaRealFullScanResourceBenchmark, 'function');
    // Wired to the ENGINE, not to a copy of it: the module imports the engine's one-shot runner and
    // the null sink, and a grep is how that stays true.
    const source = readMilestoneSource('br-receita-cnpj-real-full-scan-benchmark.ts');
    assert.ok(source.includes("from './br-receita-cnpj-full-join-engine'"));
    assert.ok(source.includes('runBrazilReceitaFullJoinStreamingEngineOnce'));
    assert.ok(source.includes('createBrazilReceitaFullJoinNullBenchmarkSink'));
    assert.ok(source.includes("from './br-receita-cnpj-full-join-manifest-source-bridge'"));
    assert.ok(source.includes("from './br-receita-cnpj-full-join-resource-envelope'"));
  });

  it('reports its readiness without claiming an authorization or a Gate 2 review', () => {
    const readiness = summarizeBrazilReceitaRealFullScanReadiness();
    assert.equal(readiness.fullScanEngineReady, true);
    assert.equal(readiness.fullScanExecutionPathReady, true);
    assert.equal(readiness.benchmarkProfileImplementable, true);
    assert.equal(readiness.realFullScanBenchmarkReadyForOwnerAuthorization, true);
    // Ready to be authorized, and not authorized. Different facts.
    assert.equal(readiness.realFullScanBenchmarkAuthorized, false);
    assert.equal(readiness.realFullScanBenchmarkExecuted, false);
    // Gate 2 answers a question only the benchmark can answer, so it cannot be ready before it runs.
    assert.equal(readiness.gate2ReadyForOwnerReview, false);
    assert.equal(readiness.nextAction, 'merge_review');
  });
});

describe('BR-SOURCE-14B.0F § 6 — the real run is still blocked', () => {
  // Tests 2 and 3.
  it('refuses at the authorization stage without opening anything', async () => {
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG, false);

    const { request, bridge } = benchmarkRequest();
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'benchmark_not_authorized');
    assert.equal(outcome.failedStage, 'authorization');
    assert.equal(outcome.abortStage, BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN);
    assert.equal(outcome.realManifestOpened, false);
    assert.equal(outcome.realDataAccessed, false);
    assert.equal(outcome.rowsEmitted, 0);
    assert.equal(outcome.realFullScanBenchmarkExecuted, false);
    // The strong form of test 3: the bridge port was never CALLED. Not "it was called with a
    // synthetic path" — never called, because the refusal happens before the manifest is reached.
    assert.deepEqual(bridge.touched, []);
  });

  it('refuses every incomplete declaration, and infers none from another', async () => {
    // Each declaration removed on its own. A run that inferred `temporaryStoragePolicyApproved`
    // from `capInputPolicyApproved`, or the acknowledgement from the authorization, would pass one
    // of these and that is exactly the failure § 6 names.
    const cases: readonly [keyof BrazilReceitaRealFullScanDeclarations, unknown][] = [
      ['temporaryStoragePolicyApproved', false],
      ['capInputPolicyApproved', undefined],
      ['benchmarkAuthorization', 'yes'],
      ['attemptCount', 2],
      ['datasetPeriod', '2026-13'],
      ['manifestPath', ''],
      ['privateMetricChannelAcknowledgement', 'ACKNOWLEDGED'],
      ['resourceCaps', null],
      ['maxOpenPartitionFiles', undefined],
      ['minimumFreeDiskBeforeStart', undefined],
      ['minimumFreeDiskReserve', undefined],
      ['readerCaps', undefined],
      ['partitioningCaps', undefined],
      ['workspaceParentDirectory', ''],
      ['workspaceBoundaries', undefined],
      ['privateMetricDestinationDirectory', ''],
      ['privateMetricArtifactSlug', ''],
      ['privateMetricArtifactTtlMs', undefined],
      ['noWriteContract', undefined],
    ];

    for (const [key, value] of cases) {
      const missing = findBrazilReceitaRealFullScanMissingDeclarations(
        completeDeclarations({ [key]: value } as Partial<BrazilReceitaRealFullScanDeclarations>),
      );
      assert.ok(missing.includes(key), `${key} must be reported missing when it is ${String(value)}`);

      const { request, bridge } = benchmarkRequest({
        declarations: completeDeclarations({
          [key]: value,
        } as Partial<BrazilReceitaRealFullScanDeclarations>),
      });
      const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
      assert.equal(outcome.ok, false);
      if (outcome.ok) continue;
      assert.equal(outcome.abortCode, 'declaration_missing', `${key} must abort before authorization`);
      assert.equal(outcome.abortStage, BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN);
      assert.deepEqual(bridge.touched, [], `${key} must abort before any filesystem question`);
    }
  });

  /**
   * A PRESENT-but-incomplete cap set is a different failure from an absent one, and it has its own
   * stage.
   *
   * The declaration check above only asks whether `resourceCaps` is an object — which a set missing
   * `maxRssBytes` still is. Without this test the gap between "declared" and "complete" would be
   * unguarded, and a run could pass the declarations stage carrying a cap set that authorizes an
   * unbounded quantity of whatever key was left out.
   */
  it('refuses a present but incomplete cap set at the resource_caps stage', async () => {
    for (const omitted of ['maxRssBytes', 'maxRuntimeMs', 'maxFilesOpened', 'maxOutputRows']) {
      const caps = { ...brazilReceitaProposedFullScanResourceCaps() } as Record<string, unknown>;
      delete caps[omitted];

      const { request, bridge } = benchmarkRequest({
        declarations: completeDeclarations({ resourceCaps: caps }),
      });
      const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);

      assert.equal(outcome.ok, false);
      if (outcome.ok) continue;
      assert.equal(outcome.abortCode, 'resource_caps_incomplete', `${omitted} must be required`);
      assert.equal(outcome.failedStage, 'resource_caps');
      assert.ok(outcome.capRejections.length > 0, `${omitted} must produce a cap rejection`);
      assert.equal(outcome.abortStage, BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN);
      assert.deepEqual(bridge.touched, []);
    }
  });

  /**
   * The § 3 handle caps are validated as a RELATION, and the failure is its own stage.
   *
   * `maxOpenPartitionFiles = 128` against `maxFilesOpened = 64` is a partition pool allowed to
   * exhaust the entire descriptor budget on its own, leaving nothing for the source file the join
   * has to re-read. Each figure alone is a perfectly ordinary integer, which is precisely why the
   * declarations stage passes it and this stage must not.
   */
  it('refuses a partition handle cap above the global one, at its own stage', async () => {
    const { request, bridge } = benchmarkRequest({
      declarations: completeDeclarations({ maxOpenPartitionFiles: 128 }),
    });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);

    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'handle_caps_invalid');
    assert.equal(outcome.failedStage, 'handle_caps');
    assert.equal(outcome.abortStage, BRAZIL_RECEITA_REAL_FULL_SCAN_ABORT_BEFORE_REAL_FILE_OPEN);
    assert.deepEqual(bridge.touched, []);

    // Zero and negative caps are INTEGERS, so they satisfy the declarations stage and are refused
    // here instead: a run that may hold zero descriptors cannot read its own input, so zero is a
    // typo rather than a tight budget.
    for (const wrong of [0, -1]) {
      const broken = benchmarkRequest({
        declarations: completeDeclarations({ maxOpenPartitionFiles: wrong }),
      });
      const refused = await runBrazilReceitaRealFullScanResourceBenchmark(broken.request);
      assert.equal(refused.ok, false);
      if (refused.ok) continue;
      assert.equal(refused.abortCode, 'handle_caps_invalid', `${wrong} must be refused`);
    }

    // A FRACTIONAL cap is refused one stage earlier, by the declaration shape check. Asserted
    // explicitly rather than folded in above, because "refused somewhere" is not the claim: each
    // stage owns a distinct failure, and a test that accepted either code would not notice if one
    // of the two checks disappeared.
    const fractional = benchmarkRequest({
      declarations: completeDeclarations({ maxOpenPartitionFiles: 3.5 }),
    });
    const refusedFractional = await runBrazilReceitaRealFullScanResourceBenchmark(fractional.request);
    assert.equal(refusedFractional.ok, false);
    if (refusedFractional.ok) return;
    assert.equal(refusedFractional.abortCode, 'declaration_missing');
    assert.ok(refusedFractional.missingDeclarations.includes('maxOpenPartitionFiles'));
  });

  it('refuses an unsafe working directory before it even looks at the declarations', async () => {
    const { request, bridge } = benchmarkRequest({
      workingDirectory: { ...SAFE_WORKING_DIRECTORY, currentWorkingDirectory: '/home/operator' },
      declarations: completeDeclarations({ attemptCount: 99 }),
    });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    // The cwd hazard wins over the declaration error: it is the one that can damage something
    // outside this run, so it is checked first.
    assert.equal(outcome.abortCode, 'unsafe_operator_working_directory');
    assert.ok(outcome.cwdViolations.includes('cwd_is_home_directory'));
    assert.deepEqual(bridge.touched, []);
  });

  // Tests 35, 36, 37.
  it('consumes exactly one attempt and refuses the second', async () => {
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.attemptCount, 1);
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.automaticRetryCount, 0);
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT, 0);

    const ledger = createBrazilReceitaFullJoinBenchmarkAttemptLedger();
    const first = await runBrazilReceitaRealFullScanResourceBenchmark(
      benchmarkRequest({ attemptLedger: ledger }).request,
    );
    assert.equal(first.ok, false);
    if (!first.ok) assert.equal(first.abortCode, 'benchmark_not_authorized');

    const second = await runBrazilReceitaRealFullScanResourceBenchmark(
      benchmarkRequest({ attemptLedger: ledger }).request,
    );
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.abortCode, 'single_attempt_already_consumed');
    assert.equal(ledger.attemptsConsumed(), 1);
  });

  // Test 38.
  it('refuses any output-row cap other than exactly zero', async () => {
    assert.equal(BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.maxOutputRows, 0);
    const { request } = benchmarkRequest({
      declarations: completeDeclarations({
        resourceCaps: { ...brazilReceitaProposedFullScanResourceCaps(), maxOutputRows: 1 },
      }),
    });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.abortCode, 'output_rows_cap_must_be_zero');
  });

  it('refuses a no-write contract that carries any escalation or provider capability', async () => {
    for (const contract of [
      { ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT, supabaseWrite: true },
      { ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT, apolloApiKey: 'present' },
      { ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT, importMode: 'production' },
    ]) {
      const { request } = benchmarkRequest({
        declarations: completeDeclarations({ noWriteContract: contract }),
      });
      const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.abortCode, 'no_write_guard_failed');
    }
  });

  it('refuses a private destination inside the repository, home or the dataset', async () => {
    for (const [directory, rejection] of [
      ['/workspaces/sellup-worktrees/br-14b0f/tmp', 'destination_inside_repository'],
      ['/home/operator/metrics', 'destination_inside_home'],
      ['/srv/receita/metrics', 'destination_inside_dataset'],
      ['/dev/stdout', 'destination_is_standard_stream'],
    ] as const) {
      const { request } = benchmarkRequest({
        declarations: completeDeclarations({ privateMetricDestinationDirectory: directory }),
      });
      const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
      assert.equal(outcome.ok, false);
      if (outcome.ok) continue;
      assert.equal(outcome.abortCode, 'private_metric_channel_not_ready');
      assert.ok(outcome.privateChannelRejections.includes(rejection));
    }
  });
});

// ─── § 8 — manifest → descriptors ─────────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 8 — the manifest bridge', () => {
  const bridgeRequest = (
    document: string,
    script: Parameters<typeof recordingBridgeFileSystem>[0] = {},
  ) => {
    const bridge = recordingBridgeFileSystem({ document, ...script });
    return {
      bridge,
      run: () =>
        resolveBrazilReceitaFullJoinManifestSources({
          manifestPath: SYNTHETIC_MANIFEST_PATH,
          fileSystem: bridge.fileSystem,
          validateManifest: scriptedValidator(),
          allowRealLocalFiles: true,
        }),
    };
  };

  // Test 4.
  it('turns a well-formed synthetic manifest into engine descriptors', async () => {
    const outcome = await bridgeRequest(syntheticManifestDocument()).run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    assert.equal(outcome.joinSources.length, 2);
    assert.deepEqual(
      outcome.joinSources.map((source) => source.family),
      ['empresas', 'estabelecimentos'],
    );
    // Ordinals are positions in the join list — technical indices the reference records carry.
    assert.deepEqual(
      outcome.joinSources.map((source) => source.sourceFileOrdinal),
      [0, 1],
    );
    for (const source of outcome.joinSources) {
      assert.equal(source.encoding, 'latin1');
      assert.equal(path.dirname(source.filePath), SYNTHETIC_MANIFEST_DIRECTORY);
    }
    assert.equal(outcome.sourcePeriod, '2026-07');
    // Held-absence assertions: the bridge resolves, it does not read.
    assert.equal(outcome.rowsRead, 0);
    assert.equal(outcome.dataFilesOpened, 0);
  });

  it('keeps reference families as LOOKUPS, out of the join descriptor list', async () => {
    const outcome = await bridgeRequest(
      syntheticManifestDocument([
        { fileType: 'empresas', path: 'synthetic-empresas.csv' },
        { fileType: 'estabelecimentos', path: 'synthetic-estabelecimentos.csv' },
        { fileType: 'cnaes', path: 'synthetic-cnaes.csv' },
        { fileType: 'municipios', path: 'synthetic-municipios.csv' },
      ]),
    ).run();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    // Two join sources, whatever else the manifest describes. A reference family that reached
    // `joinSources` would be traversed to EOF, which is not what a lookup is for.
    assert.equal(outcome.joinSources.length, 2);
    assert.deepEqual(
      outcome.lookupSources.map((source) => source.family).sort(),
      ['cnaes', 'municipios'],
    );
  });

  // Test 5.
  it('rejects path traversal, absolute paths and anything that escapes the manifest root', async () => {
    for (const declaredPath of ['../outside/empresas.csv', 'a/../../empresas.csv']) {
      const outcome = await bridgeRequest(
        syntheticManifestDocument([
          { fileType: 'empresas', path: declaredPath },
          { fileType: 'estabelecimentos', path: 'synthetic-estabelecimentos.csv' },
        ]),
      ).run();
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.ok(outcome.findings.some((finding) => finding.rejection === 'path_traversal_blocked'));
      }
    }

    const absolute = await bridgeRequest(
      syntheticManifestDocument([
        { fileType: 'empresas', path: '/srv/receita/empresas.csv' },
        { fileType: 'estabelecimentos', path: 'synthetic-estabelecimentos.csv' },
      ]),
    ).run();
    assert.equal(absolute.ok, false);
    if (!absolute.ok) {
      assert.ok(absolute.findings.some((f) => f.rejection === 'path_absolute_not_allowed'));
    }
  });

  // Test 6.
  it('rejects a symlinked data file, and one whose realpath escapes the root', async () => {
    const symlinked = await bridgeRequest(syntheticManifestDocument(), {
      symlinks: [`${SYNTHETIC_MANIFEST_DIRECTORY}/synthetic-empresas.csv`],
    }).run();
    assert.equal(symlinked.ok, false);
    if (!symlinked.ok) {
      assert.ok(symlinked.findings.some((f) => f.rejection === 'path_is_symlink'));
    }

    // The declared string looks clean and resolves elsewhere — the case a path-only check misses.
    const escaping = await bridgeRequest(syntheticManifestDocument(), {
      realPaths: {
        [`${SYNTHETIC_MANIFEST_DIRECTORY}/synthetic-empresas.csv`]: '/srv/receita/empresas.csv',
      },
    }).run();
    assert.equal(escaping.ok, false);
    if (!escaping.ok) {
      assert.ok(escaping.findings.some((f) => f.rejection === 'path_realpath_escapes_root'));
    }
  });

  // Test 7.
  it('rejects every archive extension by name', async () => {
    for (const extension of BRAZIL_RECEITA_FULL_JOIN_BRIDGE_ARCHIVE_EXTENSIONS) {
      const outcome = await bridgeRequest(
        syntheticManifestDocument([
          { fileType: 'empresas', path: `synthetic-empresas${extension}` },
          { fileType: 'estabelecimentos', path: 'synthetic-estabelecimentos.csv' },
        ]),
      ).run();
      assert.equal(outcome.ok, false, `${extension} must be refused`);
      if (!outcome.ok) {
        assert.ok(
          outcome.findings.some((f) => f.rejection === 'archive_not_allowed'),
          `${extension} must be refused AS AN ARCHIVE, not merely as an unknown extension`,
        );
      }
    }
  });

  // Test 8.
  it('rejects an unauthorized family, and never turns one into a descriptor', async () => {
    for (const family of ['socios', 'qsa', 'cpf', 'invented']) {
      const outcome = await bridgeRequest(
        syntheticManifestDocument([
          { fileType: 'empresas', path: 'synthetic-empresas.csv' },
          { fileType: 'estabelecimentos', path: 'synthetic-estabelecimentos.csv' },
          { fileType: family, path: `synthetic-${family}.csv` },
        ]),
      ).run();
      assert.equal(outcome.ok, false, `${family} must be refused`);
      if (!outcome.ok) {
        const finding = outcome.findings.find((f) => f.rejection === 'family_not_authorized');
        assert.ok(finding, `${family} must be refused as an unauthorized family`);
        assert.equal(finding?.family, family);
      }
    }
  });

  it('rejects a missing required family, a duplicate family, and a wrong declaration', async () => {
    const missing = await bridgeRequest(
      syntheticManifestDocument([{ fileType: 'empresas', path: 'synthetic-empresas.csv' }]),
    ).run();
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.ok(missing.findings.some((f) => f.rejection === 'required_family_missing'));
    }

    const duplicated = await bridgeRequest(
      syntheticManifestDocument([
        { fileType: 'empresas', path: 'a.csv' },
        { fileType: 'empresas', path: 'b.csv' },
        { fileType: 'estabelecimentos', path: 'c.csv' },
      ]),
    ).run();
    assert.equal(duplicated.ok, false);
    if (!duplicated.ok) {
      assert.ok(duplicated.findings.some((f) => f.rejection === 'family_duplicated'));
    }

    for (const [override, rejection] of [
      [{ encoding: 'utf8' }, 'encoding_not_official'],
      [{ delimiter: ',' }, 'delimiter_not_official'],
      [{ layoutMode: 'header' }, 'layout_mode_not_official'],
    ] as const) {
      const outcome = await bridgeRequest(
        syntheticManifestDocument([
          { fileType: 'empresas', path: 'synthetic-empresas.csv', ...override },
          { fileType: 'estabelecimentos', path: 'synthetic-estabelecimentos.csv' },
        ]),
      ).run();
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.ok(outcome.findings.some((f) => f.rejection === rejection));
    }
  });

  it('runs the official validator FIRST, and refuses without resolving a path when it fails', async () => {
    const bridge = recordingBridgeFileSystem({ document: syntheticManifestDocument() });
    const outcome = await resolveBrazilReceitaFullJoinManifestSources({
      manifestPath: SYNTHETIC_MANIFEST_PATH,
      fileSystem: bridge.fileSystem,
      validateManifest: scriptedValidator({ ok: false }),
      allowRealLocalFiles: true,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.deepEqual(
        outcome.findings.map((f) => f.rejection),
        ['manifest_validation_failed'],
      );
    }
    // Not one path resolved. Resolving paths out of a document that has not been established as a
    // manifest is how a JSON file full of arbitrary paths becomes a list of files to open.
    assert.deepEqual(bridge.touched, []);
  });

  it('never reports a path or a file name in a finding', async () => {
    const outcome = await bridgeRequest(
      syntheticManifestDocument([
        { fileType: 'socios', path: 'secret/place/socios.csv' },
        { fileType: 'empresas', path: '../escape/empresas.csv' },
      ]),
    ).run();
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    const rendered = JSON.stringify(outcome.findings);
    for (const fragment of ['secret', 'escape', '.csv', '/', SYNTHETIC_MANIFEST_DIRECTORY]) {
      assert.ok(!rendered.includes(fragment), `a finding must not carry "${fragment}"`);
    }
  });
});

// ─── § 9 — the private exact channel ──────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 9 — the private exact metric channel', () => {
  const observations = {
    envelope_version: 1 as const,
    peakRssBytes: 402_653_184,
    peakHeapUsedBytes: 100_663_296,
    peakExternalMemoryBytes: 33_554_432,
    totalDurationMs: 19_800_000,
    phaseDurationsMs: {
      preflight: 12,
      manifest_validation: 240,
      empresas_read: 4_000_000,
      estabelecimentos_read: 15_000_000,
      cleanup: 900,
      sanitization: 3,
    },
    bytesRead: 68_719_476_736,
    rowsRead: 341_000_000,
    filesOpened: 6,
    outputRowsMaterialized: 0,
    joinKeysPeakInMemory: 98_304,
    temporaryStoragePeakBytes: 3_221_225_472,
    checkpointsEvaluated: ['before_first_access' as const, 'after_join' as const],
    cleanupOutcome: 'completed' as const,
  };

  const engineCounts = {
    partitionsCreated: 1_024,
    largestPartitionReferenceCount: 128_000,
    filesOpenedPeak: 34,
    partitionHandlePeakOpen: 32,
  };

  // Test 10.
  it('is disabled by default and refuses without the exact acknowledgement phrase', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_ENABLED, false);

    const absent = resolveBrazilReceitaFullJoinPrivateChannel(null, {
      repositoryRoot: '/repo',
      homeDirectory: '/home/operator',
      datasetRoot: null,
    });
    assert.equal(absent.ready, false);
    if (!absent.ready) assert.deepEqual(absent.rejections, ['acknowledgement_missing']);

    const nearlyRight = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: `${BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT} `,
        destinationDirectory: '/synthetic/private',
        artifactSlug: 'brfj',
        ttlMs: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_TTL_MS,
      },
      { repositoryRoot: '/repo', homeDirectory: '/home/operator', datasetRoot: null },
    );
    // One trailing space. A phrase, not a fuzzy match.
    assert.equal(nearlyRight.ready, false);
  });

  // Test 11.
  it('carries every exact figure § 9 requires', () => {
    const payload = toBrazilReceitaFullJoinPrivateOperatorMeasurements(
      observations,
      'passed',
      engineCounts,
    );
    // The § 9 list, item by item. Exact values, not buckets — this is the channel that exists so
    // GATE-2 has real numbers.
    assert.equal(payload.peakRssBytes, 402_653_184);
    assert.equal(payload.peakHeapUsedBytes, 100_663_296);
    assert.equal(payload.peakExternalMemoryBytes, 33_554_432);
    assert.equal(payload.totalDurationMs, 19_800_000);
    assert.equal(payload.phaseDurationsMs.estabelecimentos_read, 15_000_000);
    assert.equal(payload.bytesRead, 68_719_476_736);
    assert.equal(payload.rowsRead, 341_000_000);
    assert.equal(payload.temporaryStoragePeakBytes, 3_221_225_472);
    assert.equal(payload.partitionsCreated, 1_024);
    assert.equal(payload.largestPartitionReferenceCount, 128_000);
    assert.equal(payload.filesOpenedPeak, 34);
    assert.equal(payload.partitionHandlePeakOpen, 32);
    assert.equal(payload.cleanupResult, 'completed');
    assert.equal(payload.sanitizerResult, 'passed');
  });

  // Test 12.
  it('carries no Receita payload, and the runtime validator agrees', () => {
    const payload = toBrazilReceitaFullJoinPrivateOperatorMeasurements(
      observations,
      'passed',
      engineCounts,
    );
    assert.deepEqual(validateBrazilReceitaFullJoinPrivateContent(payload), []);

    const rendered = JSON.stringify(payload);
    // No CNPJ, no name, no key, no path, no file name. The type already forbids them; this checks
    // the SERIALIZED artifact, which is what would reach a disk.
    for (const fragment of ['cnpj', 'razao', 'razão', 'SYN_K', '/', '\\', 'empresas.csv']) {
      assert.ok(
        !rendered.toLowerCase().includes(fragment.toLowerCase()),
        `the private payload must not contain "${fragment}"`,
      );
    }

    // And a payload that DID carry one is refused, so the validator is not vacuously passing.
    const contaminated = { ...payload, cleanupResult: '/srv/receita/empresas.csv' } as never;
    const findings = validateBrazilReceitaFullJoinPrivateContent(contaminated);
    assert.ok(findings.some((finding) => finding.kind === 'path_like_value'));
  });

  // Test 9: the channel is WIRED — the entry point builds the payload from the run's observations.
  it('is wired into the entry point, owner-only, atomic and TTL-bounded', () => {
    const source = readMilestoneSource('br-receita-cnpj-real-full-scan-benchmark.ts');
    assert.ok(source.includes('toBrazilReceitaFullJoinPrivateOperatorMeasurements'));
    assert.ok(source.includes('writeBrazilReceitaFullJoinPrivateArtifact'));
    assert.ok(source.includes('resolveBrazilReceitaFullJoinPrivateChannel'));
    assert.ok(source.includes('engineResult.exact.filesOpenedPeak'));

    const channel = memoryPrivateChannel();
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: '/synthetic/private',
        artifactSlug: 'brfj-metrics',
        ttlMs: BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS.privateMetricArtifactTtlMs,
      },
      { repositoryRoot: '/repo', homeDirectory: '/home/operator', datasetRoot: null },
    );
    assert.equal(resolution.ready, true);
    if (!resolution.ready) return;
    assert.equal(resolution.ttlMs, 3_600_000);

    const write = writeBrazilReceitaFullJoinPrivateArtifact(
      resolution,
      toBrazilReceitaFullJoinPrivateOperatorMeasurements(observations, 'passed', engineCounts),
      channel.fileSystem,
      1_700_000_000_000,
    );
    assert.equal(write.written, true);
    if (!write.written) return;
    assert.equal(write.mode, BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE);
    assert.equal(write.expiresAtMs, 1_700_000_000_000 + 3_600_000);
    // The temporary file was renamed into place, so a reader never sees a half-written artifact.
    assert.equal(channel.files.has(resolution.temporaryFile), false);
    assert.equal(channel.files.has(resolution.destinationFile), true);

    const envelope = JSON.parse(channel.files.get(resolution.destinationFile) ?? '{}');
    assert.equal(envelope.expires_at_ms, write.expiresAtMs);
    assert.equal(envelope.measurements.filesOpenedPeak, 34);
  });

  it('leaves nothing on disk when the write fails', () => {
    const channel = memoryPrivateChannel({
      rename() {
        throw new Error('rename refused');
      },
    });
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: '/synthetic/private',
        artifactSlug: 'brfj-metrics',
        ttlMs: 3_600_000,
      },
      { repositoryRoot: '/repo', homeDirectory: '/home/operator', datasetRoot: null },
    );
    assert.equal(resolution.ready, true);
    if (!resolution.ready) return;

    const write = writeBrazilReceitaFullJoinPrivateArtifact(
      resolution,
      toBrazilReceitaFullJoinPrivateOperatorMeasurements(observations, 'not_run', engineCounts),
      channel.fileSystem,
      1_700_000_000_000,
    );
    assert.equal(write.written, false);
    // A failed write leaves NO exact figures behind — not even the temporary file.
    assert.equal(channel.files.size, 0);
  });
});

// ─── § 10 — the public report ─────────────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 10 — the public report stays bucketed', () => {
  // Tests 13 and 14.
  it('passes the untouched output sanitizer, with every magnitude in a bucket', async () => {
    const handle = fixture({
      files: [
        {
          family: 'empresas',
          rows: [1, 2, 3].map((index) => ({ key: brazilReceitaFullJoinSyntheticKey(index) })),
        },
        {
          family: 'estabelecimentos',
          rows: [1, 2].map((index) => ({ key: brazilReceitaFullJoinSyntheticKey(index) })),
        },
      ],
    });

    const result = await runBrazilReceitaFullJoinStreamingEngineOnce({
      sources: handle.sources,
      readerCaps: { maxChunkBytes: 4096, maxCarryBytes: 4096, maxRowBytes: 4096, maxColumnsPerRow: 64 },
      partitioningCaps: {
        partitionCount: 4,
        maxPartitionCount: 32,
        maxPartitionDepth: 2,
        maxReferencesPerPartition: 1000,
        maxReferenceBytesPerPartition: 64 * 1024,
      },
      resourceCaps: {
        ...brazilReceitaProposedFullScanResourceCaps(),
        maxTemporaryStorageBytes: 64 * 1024,
      },
      duplicateKeyPolicy: 'pair_with_every_duplicate',
      sink: createBrazilReceitaFullJoinNullBenchmarkSink(),
      readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
      workspaceParentDirectory: handle.workspaceParentDirectory,
      workspaceBoundaries: {
        repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
        homeDirectory: '/home/operator',
        datasetRoot: handle.datasetRoot,
      },
      resourceDependencies: {
        clock: () => process.hrtime.bigint(),
        memorySampler: () => ({ rss: 1024, heapUsed: 512, external: 256 }),
      },
      ...brazilReceitaFullJoinFixtureRunDefaults(),
      realDataRun: false,
      sinkMaterializesRows: false,
    });

    assert.equal(result.exitStatus, 'completed');
    // The § 10 field list, present and bucketed.
    const report = result.publicReport;
    assert.equal(report.resource_measurements.measurement_version >= 1, true);
    assert.ok(typeof report.resource_measurements.peak_rss_bucket === 'string');
    assert.ok(typeof report.resource_measurements.total_duration_bucket === 'string');
    assert.ok(typeof report.resource_measurements.bytes_read_bucket === 'string');
    assert.ok(typeof report.resource_measurements.rows_read_bucket === 'string');
    assert.ok(typeof report.resource_measurements.temporary_storage_peak_bucket === 'string');
    assert.ok(typeof report.partition_count_bucket === 'string');
    assert.ok(typeof report.largest_partition_reference_count_bucket === 'string');
    assert.ok(typeof report.files_opened_peak_bucket === 'string');
    assert.ok(typeof report.match_count_bucket === 'string');
    assert.ok(typeof report.cleanup.cleanup_status === 'string');
    assert.equal(report.exit_status, 'completed');
    assert.equal(report.abort_code, 'none');

    // The sanitizer is UNCHANGED and the report passes it. No exemption, no widened digit ceiling.
    const sanitized = sanitizeBrazilReceitaFullJoinReport(report);
    assert.equal(sanitized.ok, true, JSON.stringify(sanitized));
  });

  it('reports the descriptor peak as a bucket, never as an exact count', async () => {
    const handle = fixture({
      files: [
        { family: 'empresas', rows: [{ key: brazilReceitaFullJoinSyntheticKey(1) }] },
        { family: 'estabelecimentos', rows: [{ key: brazilReceitaFullJoinSyntheticKey(1) }] },
      ],
    });
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce({
      sources: handle.sources,
      readerCaps: { maxChunkBytes: 4096, maxCarryBytes: 4096, maxRowBytes: 4096, maxColumnsPerRow: 64 },
      partitioningCaps: {
        partitionCount: 2,
        maxPartitionCount: 8,
        maxPartitionDepth: 1,
        maxReferencesPerPartition: 100,
        maxReferenceBytesPerPartition: 4096,
      },
      resourceCaps: {
        ...brazilReceitaProposedFullScanResourceCaps(),
        maxTemporaryStorageBytes: 64 * 1024,
      },
      duplicateKeyPolicy: 'pair_with_every_duplicate',
      sink: createBrazilReceitaFullJoinNullBenchmarkSink(),
      readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
      workspaceParentDirectory: handle.workspaceParentDirectory,
      workspaceBoundaries: {
        repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
        homeDirectory: '/home/operator',
        datasetRoot: handle.datasetRoot,
      },
      resourceDependencies: {
        clock: () => process.hrtime.bigint(),
        memorySampler: () => ({ rss: 1024, heapUsed: 512, external: 256 }),
      },
      ...brazilReceitaFullJoinFixtureRunDefaults(),
      realDataRun: false,
      sinkMaterializesRows: false,
    });

    // The EXACT peak exists — for the private channel — and the public report carries only a bucket.
    assert.ok(result.exact.filesOpenedPeak > 0);
    assert.ok(result.exact.partitionHandlePeakOpen > 0);
    assert.equal(typeof result.publicReport.files_opened_peak_bucket, 'string');
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.publicReport, 'files_opened_peak'),
      false,
      'the public report must not carry the exact peak',
    );
  });
});

// ─── § 11 — the proposed profile ──────────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 11 — the proposed benchmark caps', () => {
  // Tests 15 and 16.
  it('proposes exactly the § 11 figures', () => {
    const caps = BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS;
    assert.equal(caps.maxRssBytes, 536_870_912);
    assert.equal(caps.maxHeapUsedBytes, 134_217_728);
    assert.equal(caps.maxExternalMemoryBytes, 67_108_864);
    assert.equal(caps.maxRuntimeMs, 21_600_000);
    assert.equal(caps.maxPhaseRuntimeMs, 21_600_000);
    assert.equal(caps.maxTemporaryStorageBytes, 4_294_967_296);
    assert.equal(caps.minimumFreeDiskBeforeStart, 12_884_901_888);
    assert.equal(caps.minimumFreeDiskReserve, 8_589_934_592);
    assert.equal(caps.maxFilesOpened, 64);
    assert.equal(caps.maxOpenPartitionFiles, 32);
    assert.equal(caps.maxBytesRead, 73_014_444_032);
    assert.equal(caps.maxRowsRead, 360_000_000);
    assert.equal(caps.maxJoinKeysInMemory, 131_072);
    assert.equal(caps.maxOutputRows, 0);
    assert.equal(caps.partitionCount, 1_024);
    assert.equal(caps.maxPartitionCount, 2_048);
    assert.equal(caps.maxPartitionDepth, 1);
    assert.equal(caps.maxReferencesPerPartition, 131_072);
    assert.equal(caps.maxReferenceBytesPerPartition, 2_097_152);
    assert.equal(caps.maxChunkBytes, 4_194_304);
    assert.equal(caps.maxCarryBytes, 65_536);
    assert.equal(caps.maxRowBytes, 65_536);
    assert.equal(caps.maxColumnsPerRow, 64);
    assert.equal(caps.privateMetricArtifactTtlMs, 3_600_000);
    assert.equal(caps.attemptCount, 1);
    assert.equal(caps.automaticRetryCount, 0);
    // Six hours, and named as what it is.
    assert.equal(caps.maxRuntimeMs / 3_600_000, 6);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_FIGURE_KIND, 'OWNER_BUDGET_CEILING');
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_IS_OBSERVED, false);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_RUNTIME_IS_ESTIMATED, false);
  });

  it('resolves as a complete 14B.0C cap set', () => {
    const resourceCaps = brazilReceitaProposedFullScanResourceCaps();
    // The envelope requires all eleven. A profile that could not be resolved would be a proposal for
    // a run that cannot start.
    assert.equal(Object.keys(resourceCaps).length, 11);
    for (const value of Object.values(resourceCaps)) {
      assert.equal(Number.isInteger(value), true);
      assert.equal(Number.isFinite(value), true);
    }
  });

  // Tests 17 and 18.
  it('makes a runtime or phase-runtime breach terminal, with no retry', () => {
    const caps = brazilReceitaProposedFullScanResourceCaps();
    const SIX_HOURS_NS = BigInt(21_600_000) * BigInt(1_000_000);

    // A clock that jumps past six hours between the arming call and the checkpoint.
    let tick = 0;
    const dependencies: BrazilReceitaFullJoinResourceDependencies = {
      clock: () => {
        tick += 1;
        return tick <= 1 ? BigInt(0) : SIX_HOURS_NS + BigInt(1_000_000);
      },
      memorySampler: () => ({ rss: 1024, heapUsed: 512, external: 256 }),
    };

    const enforcer = createBrazilReceitaFullJoinResourceEnforcer(caps, dependencies);
    assert.equal(enforcer.validateBeforeFirstAccess().ok, true);
    const outcome = enforcer.checkpoint('after_join');
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.breach.terminalCode, 'runtime_cap_exceeded');
    assert.equal(outcome.breach.capKey, 'maxRuntimeMs');
    assert.equal(outcome.breach.retriesPerformed, 0);
    // Terminal AND latched: no later call can produce a clean answer, so the run cannot continue.
    assert.equal(enforcer.mayAccessData(), false);
    assert.equal(enforcer.checkpoint('after_cleanup').ok, false);
    assert.equal(enforcer.noteBytesRead(1).ok, false);

    // The phase cap, breached on its own boundary.
    let phaseTick = 0;
    const phaseEnforcer = createBrazilReceitaFullJoinResourceEnforcer(
      { ...caps, maxRuntimeMs: Number.MAX_SAFE_INTEGER },
      {
        clock: () => {
          phaseTick += 1;
          return phaseTick <= 2 ? BigInt(0) : SIX_HOURS_NS + BigInt(1_000_000);
        },
        memorySampler: () => ({ rss: 1024, heapUsed: 512, external: 256 }),
      },
    );
    assert.equal(phaseEnforcer.validateBeforeFirstAccess().ok, true);
    assert.equal(phaseEnforcer.beginPhase('empresas_read').ok, true);
    const ended = phaseEnforcer.endPhase('empresas_read');
    assert.equal(ended.ok, false);
    if (!ended.ok) {
      assert.equal(ended.breach.terminalCode, 'phase_runtime_cap_exceeded');
      assert.equal(ended.breach.retriesPerformed, 0);
    }
  });
});

// ─── § 12, § 13 — sink, determinism, cleanup, scope ───────────────────────────

describe('BR-SOURCE-14B.0F § 12 — sink, determinism and cleanup', () => {
  const scenario: BrazilReceitaFullJoinFixtureScenario = {
    files: [
      {
        family: 'empresas',
        rows: [1, 2, 3, 4].map((index) => ({ key: brazilReceitaFullJoinSyntheticKey(index) })),
      },
      {
        family: 'estabelecimentos',
        rows: [1, 2, 3].map((index) => ({ key: brazilReceitaFullJoinSyntheticKey(index) })),
      },
    ],
  };

  async function runFixture(handle: BrazilReceitaFullJoinFixtureHandle) {
    const sink = createBrazilReceitaFullJoinNullBenchmarkSink();
    const result = await runBrazilReceitaFullJoinStreamingEngineOnce({
      sources: handle.sources,
      readerCaps: { maxChunkBytes: 4096, maxCarryBytes: 4096, maxRowBytes: 4096, maxColumnsPerRow: 64 },
      partitioningCaps: {
        partitionCount: 4,
        maxPartitionCount: 32,
        maxPartitionDepth: 2,
        maxReferencesPerPartition: 1000,
        maxReferenceBytesPerPartition: 64 * 1024,
      },
      resourceCaps: {
        ...brazilReceitaProposedFullScanResourceCaps(),
        maxTemporaryStorageBytes: 64 * 1024,
      },
      duplicateKeyPolicy: 'pair_with_every_duplicate',
      sink,
      readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
      workspaceParentDirectory: handle.workspaceParentDirectory,
      workspaceBoundaries: {
        repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
        homeDirectory: '/home/operator',
        datasetRoot: handle.datasetRoot,
      },
      resourceDependencies: {
        clock: () => process.hrtime.bigint(),
        memorySampler: () => ({ rss: 1024, heapUsed: 512, external: 256 }),
      },
      ...brazilReceitaFullJoinFixtureRunDefaults(),
      realDataRun: false,
      sinkMaterializesRows: false,
    });
    return { result, tally: sink.tally() };
  }

  // Test 39.
  it('retains nothing in the benchmark sink, and emits zero rows', async () => {
    const { result, tally } = await runFixture(fixture(scenario));
    assert.equal(result.exitStatus, 'completed');
    assert.equal(result.exact.matchesEmitted, 3);
    // Three matches counted, zero rows emitted and zero records retained. The tally is a map from a
    // bucket LABEL to a count, so there is nowhere for a record to be kept.
    assert.equal(tally.rowsEmitted, 0);
    assert.equal(tally.recordsRetained, 0);
    assert.equal(tally.finalized, true);
    assert.equal(result.exact.resource.outputRowsMaterialized, 0);
    const rendered = JSON.stringify(tally);
    assert.ok(!rendered.includes('SYN_K'), 'the tally must not carry a join key');
  });

  // Test 44.
  it('is deterministic across identical synthetic runs', async () => {
    const first = await runFixture(fixture(scenario));
    const second = await runFixture(fixture(scenario));

    // Counts, buckets and the sink tally all agree. The partition assignment is FNV-1a over the
    // normalized key with no clock and no randomness in it, so two runs over the same input must
    // produce the same partition map and the same per-partition results.
    assert.equal(first.result.exact.matchesEmitted, second.result.exact.matchesEmitted);
    assert.equal(first.result.exact.partitionsCreated, second.result.exact.partitionsCreated);
    assert.equal(
      first.result.exact.orphanEstabelecimentoCount,
      second.result.exact.orphanEstabelecimentoCount,
    );
    assert.deepEqual(first.tally.matchBuckets, second.tally.matchBuckets);
    assert.deepEqual(
      first.result.partitionSummaries.map((summary) => summary.matchesEmitted),
      second.result.partitionSummaries.map((summary) => summary.matchesEmitted),
    );
  });

  // Test 45.
  it('requires a VERIFIED cleanup for a successful result', async () => {
    const { result } = await runFixture(fixture(scenario));
    assert.equal(result.cleanupOutcome, 'completed');
    assert.equal(result.publicReport.cleanup_verified_absent, true);
    assert.equal(result.publicReport.cleanup.cleanup_status, 'completed');

    // And an unverifiable cleanup is NOT a success. `unverified` is kept distinct from `failed`
    // because they are different facts, and both stop the run.
    const handle = fixture(scenario);
    const base = createBrazilReceitaFullJoinWorkspaceFileSystem();
    const unverifiable = await runBrazilReceitaFullJoinStreamingEngineOnce({
      sources: handle.sources,
      readerCaps: { maxChunkBytes: 4096, maxCarryBytes: 4096, maxRowBytes: 4096, maxColumnsPerRow: 64 },
      partitioningCaps: {
        partitionCount: 4,
        maxPartitionCount: 32,
        maxPartitionDepth: 2,
        maxReferencesPerPartition: 1000,
        maxReferenceBytesPerPartition: 64 * 1024,
      },
      resourceCaps: {
        ...brazilReceitaProposedFullScanResourceCaps(),
        maxTemporaryStorageBytes: 64 * 1024,
      },
      duplicateKeyPolicy: 'pair_with_every_duplicate',
      sink: createBrazilReceitaFullJoinNullBenchmarkSink(),
      readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
      workspaceFileSystem: {
        ...base,
        // The directory is removed, but its absence cannot be confirmed.
        exists: () => true,
      },
      workspaceParentDirectory: handle.workspaceParentDirectory,
      workspaceBoundaries: {
        repositoryRoot: '/workspaces/sellup-worktrees/br-14b0f',
        homeDirectory: '/home/operator',
        datasetRoot: handle.datasetRoot,
      },
      resourceDependencies: {
        clock: () => process.hrtime.bigint(),
        memorySampler: () => ({ rss: 1024, heapUsed: 512, external: 256 }),
      },
      ...brazilReceitaFullJoinFixtureRunDefaults(),
      realDataRun: false,
      sinkMaterializesRows: false,
    });
    assert.equal(unverifiable.exitStatus, 'aborted');
    assert.equal(unverifiable.abortCode, 'cleanup_unverified');
    assert.equal(unverifiable.publicReport.cleanup_verified_absent, false);
  });
});

// ─── § 14, § 15 — scope and sensitivity scans ─────────────────────────────────

describe('BR-SOURCE-14B.0F § 14 — the milestone stays in scope', () => {
  // Tests 40, 41, 42, 43.
  it('imports no Supabase, runtime, Agent 1, Agent 2A, provider or HubSpot module', () => {
    const forbidden: readonly [RegExp, string][] = [
      [/@supabase\//, 'Supabase client'],
      [/createSupabaseAdminClient|supabase-admin|from\s+'.*supabase/i, 'Supabase'],
      [/prospect_candidates|source_company_snapshots|wizard_budget_reservations/, 'a database table'],
      [/agents\/prospecting-toolkit|agent-?1|agent1/i, 'Agent 1'],
      [/phone-?reveal|contact-?enrichment|agent-?2a/i, 'Agent 2A'],
      [/apollo|lusha|tavily|hubspot|slack/i, 'a provider'],
      [/child_process/, 'a process spawn'],
      [/node:https?|fetch\(|axios/, 'the network'],
    ];

    for (const name of [...MILESTONE_SOURCE_FILES]) {
      const source = codeWithoutComments(readMilestoneSource(name));
      for (const [pattern, label] of forbidden) {
        assert.ok(!pattern.test(source), `${name} must not reference ${label}`);
      }
    }
  });

  it('keeps the CLI to the benchmark, with no import, production or Agent 1 mode', () => {
    const raw = fs.readFileSync(path.join(SCRIPTS_DIRECTORY, CLI_FILE), 'utf8');
    const source = codeWithoutComments(raw);
    for (const pattern of [/child_process/, /@supabase\//, /apollo|lusha|hubspot/i]) {
      assert.ok(!pattern.test(source), `the CLI must not reference ${String(pattern)}`);
    }
    // The only run modes it knows about.
    assert.ok(source.includes('--real-full-scan-resource-benchmark'));
    assert.ok(source.includes('--synthetic-smoke'));
    assert.ok(!source.includes('--import'), 'the CLI must not offer an import mode');
    assert.ok(!source.includes('--production'), 'the CLI must not offer a production mode');
  });

  it('touches only the directories § 14 permits', () => {
    // Every file this milestone added lives in the connector, its tests, scripts or docs. A test
    // that checks the files EXIST where they should is how a stray edit elsewhere becomes visible.
    for (const name of MILESTONE_SOURCE_FILES) {
      assert.ok(fs.existsSync(path.join(CONNECTOR_DIRECTORY, name)), `${name} must exist`);
    }
    assert.ok(fs.existsSync(path.join(SCRIPTS_DIRECTORY, CLI_FILE)));
  });

  // Test 34: the operator attestation, not a machine check.
  it('leaves the no-cloud-sync requirement as an operator attestation', () => {
    const source = readMilestoneSource('br-receita-cnpj-real-full-scan-benchmark.ts');
    // The workspace boundaries are DECLARED by the operator, and the module reads no environment
    // variable to discover them. Whether the chosen volume is cloud-synced is a fact about the
    // operator's machine that no code here can establish, so it stays an attestation rather than
    // becoming a check that would give false assurance.
    assert.ok(!source.includes('process.env'), 'the entry point must read no environment variable');
    assert.ok(source.includes('workspaceBoundaries'));
  });
});

describe('BR-SOURCE-14B.0F § 15 — no real data is reachable', () => {
  it('names no real dataset, manifest or operator path anywhere in the milestone', () => {
    // Fragments that would indicate the real dataset had been located again. § 15 forbids even that.
    const forbidden = [
      'Empresas0',
      'Estabelecimentos0',
      'K3241.K03200',
      'DADOS_ABERTOS_CNPJ',
      '/Users/',
      'Downloads',
      'receita_federal',
    ];
    for (const name of [...MILESTONE_SOURCE_FILES, 'br-receita-cnpj-full-join-manifest-bridge-fs.ts']) {
      const source = codeWithoutComments(readMilestoneSource(name));
      for (const fragment of forbidden) {
        assert.ok(!source.includes(fragment), `${name} must not contain "${fragment}"`);
      }
    }
  });

  it('cannot reach a real file through the entry point while the gate is closed', async () => {
    // The reader port throws on ANY call. A refusal that reached a data file would surface as that
    // throw rather than as a clean refusal, so this is a load-bearing assertion rather than a
    // restatement of the authorization test.
    const { request, bridge } = benchmarkRequest();
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.realManifestOpened, false);
    assert.deepEqual(bridge.touched, []);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED, false);
  });
});

// ─── § 7 — the CLI ────────────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0F § 7 — the operator CLI', () => {
  it('requires exactly one mode and refuses an ambiguous or absent one', () => {
    assert.equal(parseBrazilReceitaRealFullScanCliArgs([]).ok, false);
    const absent = parseBrazilReceitaRealFullScanCliArgs([]);
    if (!absent.ok) assert.equal(absent.refusal, 'mode_not_declared');

    const ambiguous = parseBrazilReceitaRealFullScanCliArgs([
      '--real-full-scan-resource-benchmark',
      '--synthetic-smoke',
    ]);
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.equal(ambiguous.refusal, 'mode_ambiguous');
  });

  it('refuses a relative manifest path and every missing declaration flag', () => {
    const relative = parseBrazilReceitaRealFullScanCliArgs([
      '--synthetic-smoke',
      '--manifest',
      'relative/manifest.json',
    ]);
    assert.equal(relative.ok, false);
    if (!relative.ok) assert.equal(relative.refusal, 'manifest_path_not_absolute');

    const noWorkspace = parseBrazilReceitaRealFullScanCliArgs([
      '--synthetic-smoke',
      '--manifest',
      SYNTHETIC_MANIFEST_PATH,
    ]);
    assert.equal(noWorkspace.ok, false);
    if (!noWorkspace.ok) assert.equal(noWorkspace.refusal, 'workspace_parent_not_declared');
  });

  it('parses a complete synthetic invocation and builds declarations that still refuse', async () => {
    const parsed = parseBrazilReceitaRealFullScanCliArgs([
      '--synthetic-smoke',
      '--manifest',
      SYNTHETIC_MANIFEST_PATH,
      '--workspace-parent',
      '/synthetic/scratch',
      '--private-metric-directory',
      '/synthetic/private',
      '--dataset-period',
      '2026-07',
      '--private-metric-acknowledgement',
      BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
    ]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.options.mode, 'synthetic-smoke');

    const declarations = buildBrazilReceitaRealFullScanDeclarations(parsed.options);
    // The three POLICY approvals mirror the authorization constant, which is `false`. The CLI cannot
    // approve GATE-2 or the CAP-input policy, and an operator running it is not approving them.
    assert.equal(declarations.temporaryStoragePolicyApproved, false);
    assert.equal(declarations.capInputPolicyApproved, false);
    assert.equal(declarations.benchmarkAuthorization, false);
    assert.equal(declarations.attemptCount, 1);
    assert.equal(declarations.datasetPeriod, '2026-07');

    // And the run they produce refuses at the declaration stage, before any file is touched.
    const { request, bridge } = benchmarkRequest({ declarations });
    const outcome = await runBrazilReceitaRealFullScanResourceBenchmark(request);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.abortCode, 'declaration_missing');
      assert.ok(outcome.missingDeclarations.includes('benchmarkAuthorization'));
    }
    assert.deepEqual(bridge.touched, []);
  });
});
