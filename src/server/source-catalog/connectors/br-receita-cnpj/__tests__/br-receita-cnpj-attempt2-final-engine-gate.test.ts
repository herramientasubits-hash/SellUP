/**
 * BR-SOURCE-ATTEMPT2-FINAL — THE ENGINE GATE AND THE REAL BOUNDARY.
 *
 * Two defects, and this suite is the proof that both are closed and that nothing else moved.
 *
 *   A. THE ENGINE'S TEMPORARY-STORAGE WALL WAS DEAF. BR-SOURCE-ATTEMPT2-OPS made an owner decision
 *      expressible per invocation, and the benchmark's authorization stage learned to read it. The
 *      workspace's own wall did not: it consulted a tracked `false as const` and nothing else, so attempt
 *      #2's third authorization refused at `before_first_read` with
 *      `temporary_storage_policy_not_approved`, having read zero bytes. § A and § B establish that the
 *      wall now accepts an invocation-scoped approval, that the constant did NOT move, that an
 *      invocation with no grant is still refused, and that nothing persists between invocations.
 *
 *   B. THE BOUNDARY WAS COMMITTED BEFORE THE WORK. `commitCrossing()` fired immediately before the
 *      engine call, so every pre-read abort INSIDE the engine — including defect A's — recorded a
 *      crossing for a run that read nothing. § C establishes that the crossing now coincides with the
 *      first `read` of a source file, fires at most once across twenty parts, and that a failure before
 *      it spends nothing while a failure after it spends the attempt.
 *
 * ── What this suite must never do ───────────────────────────────────────────────
 * No Receita dataset, no real manifest, no real row, and no benchmark. Every source file it reads is a
 * synthetic fixture this process wrote to a temp directory seconds earlier; every other filesystem effect
 * arrives through a scripted port. The durable attempt ledger is READ and never written — § D asserts it
 * still stands at one consumed, attempt #2 unauthorized, attempt #3 prohibited.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  buildBrazilReceitaObservedInputInventory,
  type BrazilReceitaObservedInputInventoryFileSystem,
} from '../br-receita-cnpj-attempt2-observed-input-inventory';
import {
  BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
  resolveBrazilReceitaAttempt2OperatorAuthorization,
  type BrazilReceitaAttempt2OperatorAuthorization,
} from '../br-receita-cnpj-attempt2-operator-authorization';
import {
  runBrazilReceitaFullJoinStreamingEngineOnce,
  type BrazilReceitaFullJoinEngineRequest,
} from '../br-receita-cnpj-full-join-engine';
import { createBrazilReceitaFullJoinNullBenchmarkSink } from '../br-receita-cnpj-full-join-engine-contract';
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
import {
  BRAZIL_RECEITA_FULL_JOIN_MAX_BOUNDARY_CROSSINGS,
  BRAZIL_RECEITA_FULL_JOIN_NON_CROSSING_READER_OPERATIONS,
  BRAZIL_RECEITA_FULL_JOIN_REAL_SOURCE_READ_OPERATION,
  withBrazilReceitaFullJoinFirstSourceReadBoundary,
} from '../br-receita-cnpj-full-join-first-source-read-boundary';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../br-receita-cnpj-full-join-open-handle-ledger';
import {
  BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED,
  createBrazilReceitaFullJoinPartitionWorkspace,
  resolveBrazilReceitaFullJoinTemporaryStoragePolicy,
  type BrazilReceitaFullJoinWorkspaceBoundaries,
} from '../br-receita-cnpj-full-join-partition-workspace';
import type { BrazilReceitaFullJoinBridgeManifestValidator } from '../br-receita-cnpj-full-join-manifest-source-bridge';
import { BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT } from '../br-receita-cnpj-full-join-operator-metric-channel';
import {
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  createBrazilReceitaFullJoinBenchmarkAttemptLedger,
} from '../br-receita-cnpj-full-join-resource-benchmark';
import { createBrazilReceitaFullJoinResourceProcessDependencies } from '../br-receita-cnpj-full-join-resource-envelope';
import { BR_RECEITA_CNPJ_NATIONAL_PART_COUNT } from '../br-receita-cnpj-manifest';
import {
  BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_LIFETIME,
  BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_PERSISTED,
  brazilReceitaFullJoinInvocationTemporaryStorageApprovalPresent,
  mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval,
} from '../br-receita-cnpj-full-join-temporary-storage-approval';
import {
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED,
  BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED,
  BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS,
  brazilReceitaNextRealAttemptNumber,
  createBrazilReceitaRealBenchmarkAttemptBoundaryLedger,
  evaluateBrazilReceitaRealBenchmarkAttemptRequest,
} from '../br-receita-cnpj-real-benchmark-attempt-ledger';
import {
  BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS,
  runBrazilReceitaRealFullScanResourceBenchmark as runSyntheticBenchmark,
} from '../br-receita-cnpj-real-full-scan-benchmark';

import {
  buildBrazilReceitaRealFullScanDeclarations,
  parseBrazilReceitaRealFullScanCliArgs,
} from '../../../../../../scripts/source-catalog/run-br-receita-cnpj-real-full-scan-resource-benchmark';

// ─── Source scanning helpers ──────────────────────────────────────────────────

const CONNECTOR_DIRECTORY = path.resolve(__dirname, '..');

function readConnectorSource(name: string): string {
  return fs.readFileSync(path.join(CONNECTOR_DIRECTORY, name), 'utf8');
}

/** Removes comments so a scan asserts what a module DOES rather than what its prose says. */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// ─── Grants ───────────────────────────────────────────────────────────────────

/** The period 14B.0K transcribed a publisher listing for. Declared once, used by manifest and CLI alike. */
const SYNTHETIC_PERIOD = '2026-07';

/** The source key the connector's own manifests carry. A key, never a URL and never a file name. */
const SYNTHETIC_SOURCE_KEY = 'br_receita_cnpj_dados_abertos';

const ALL_THREE_FLAGS: readonly string[] = [
  '--second-real-attempt-owner-authorized',
  '--temporary-storage-policy-approved',
  '--cap-input-policy-approved',
];

/** A COMPLETE grant, produced the only way an operator can produce one: from argv. */
function completeGrant(): BrazilReceitaAttempt2OperatorAuthorization {
  const resolution = resolveBrazilReceitaAttempt2OperatorAuthorization(ALL_THREE_FLAGS);
  assert.equal(resolution.ok, true);
  return resolution.authorization;
}

function grantWithout(flag: string): BrazilReceitaAttempt2OperatorAuthorization {
  return resolveBrazilReceitaAttempt2OperatorAuthorization(
    ALL_THREE_FLAGS.filter((candidate) => candidate !== flag),
  ).authorization;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let handles: BrazilReceitaFullJoinFixtureHandle[] = [];
let temporaryDirectories: string[] = [];

afterEach(() => {
  for (const handle of handles) handle.dispose();
  handles = [];
  for (const directory of temporaryDirectories.reverse()) {
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories = [];
});

function temporaryParent(): string {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'brfj-final-gate-'));
  temporaryDirectories.push(directory);
  return directory;
}

function fixture(scenario: BrazilReceitaFullJoinFixtureScenario): BrazilReceitaFullJoinFixtureHandle {
  const handle = createBrazilReceitaFullJoinFixture(scenario);
  handles.push(handle);
  return handle;
}

function rows(count: number, startIndex = 1) {
  return Array.from({ length: count }, (_unused, index) => ({
    key: brazilReceitaFullJoinSyntheticKey(startIndex + index),
  }));
}

/** A small two-family synthetic scenario, plus `partCount` files per family when asked for more. */
function syntheticScenario(partsPerFamily = 1): BrazilReceitaFullJoinFixtureScenario {
  const files = [];
  for (const family of ['empresas', 'estabelecimentos'] as const) {
    for (let part = 0; part < partsPerFamily; part += 1) {
      files.push({ family, rows: rows(3, part * 3 + 1) });
    }
  }
  return { files };
}

const MEGABYTE = 1024 * 1024;

function engineRequest(
  handle: BrazilReceitaFullJoinFixtureHandle,
  overrides: Partial<BrazilReceitaFullJoinEngineRequest> = {},
): BrazilReceitaFullJoinEngineRequest {
  return {
    sources: handle.sources,
    readerCaps: { maxChunkBytes: 512, maxCarryBytes: 4096, maxRowBytes: 4096, maxColumnsPerRow: 64 },
    partitioningCaps: {
      partitionCount: 4,
      maxPartitionCount: 32,
      maxPartitionDepth: 3,
      maxReferencesPerPartition: 1000,
      maxReferenceBytesPerPartition: 64 * 1024,
    },
    resourceCaps: {
      maxRssBytes: 8 * 1024 * MEGABYTE,
      maxHeapUsedBytes: 2 * 1024 * MEGABYTE,
      maxExternalMemoryBytes: 2 * 1024 * MEGABYTE,
      maxRuntimeMs: 10 * 60 * 1000,
      maxPhaseRuntimeMs: 10 * 60 * 1000,
      maxTemporaryStorageBytes: 64 * 1024,
      maxFilesOpened: 64,
      maxBytesRead: 10 * 1000 * 1000,
      maxRowsRead: 100 * 1000,
      maxJoinKeysInMemory: 1000,
      maxOutputRows: 0,
    },
    duplicateKeyPolicy: 'pair_with_every_duplicate',
    sink: createBrazilReceitaFullJoinNullBenchmarkSink(),
    readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
    workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    workspaceParentDirectory: handle.workspaceParentDirectory,
    workspaceBoundaries: {
      repositoryRoot: '/workspaces/sellup-worktrees/attempt2-final',
      homeDirectory: '/home/operator',
      datasetRoot: handle.datasetRoot,
    },
    resourceDependencies: createBrazilReceitaFullJoinResourceProcessDependencies(),
    ...brazilReceitaFullJoinFixtureRunDefaults(),
    realDataRun: false,
    sinkMaterializesRows: false,
    ...overrides,
  };
}

function workspaceBoundaries(): BrazilReceitaFullJoinWorkspaceBoundaries {
  return {
    repositoryRoot: '/workspaces/sellup-worktrees/attempt2-final',
    homeDirectory: '/home/operator',
    datasetRoot: '/srv/receita',
  };
}

function openWorkspace(options: {
  realDataRun: boolean;
  invocationTemporaryStorageApproval?: unknown;
}) {
  return createBrazilReceitaFullJoinPartitionWorkspace({
    parentDirectory: temporaryParent(),
    boundaries: workspaceBoundaries(),
    fileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
    maxTemporaryStorageBytes: 64 * 1024,
    maxOpenPartitionFiles: 32,
    openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(64),
    minimumFreeDiskBeforeStart: 1024 * 1024,
    minimumFreeDiskReserve: 1024 * 1024,
    freeDiskProbe: () => 64 * 1024 * 1024 * 1024,
    realDataRun: options.realDataRun,
    invocationTemporaryStorageApproval:
      options.invocationTemporaryStorageApproval as never,
  });
}

// ─── § A — the temporary-storage policy ───────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-FINAL § A — the temporary-storage policy', () => {
  // Test 1.
  it('1 — defaults to refusing a real run, and needs no approval for a synthetic one', () => {
    const noGrant = resolveBrazilReceitaFullJoinTemporaryStoragePolicy({ realDataRun: true });
    assert.equal(noGrant.approved, false);
    assert.equal(noGrant.source, 'none');

    // Explicit `null` and explicit `undefined` are the same absence, not a third state.
    for (const absent of [null, undefined]) {
      const verdict = resolveBrazilReceitaFullJoinTemporaryStoragePolicy({
        realDataRun: true,
        invocationTemporaryStorageApproval: absent,
      });
      assert.equal(verdict.approved, false);
      assert.equal(verdict.source, 'none');
    }

    // A synthetic run never needed the approval and still does not: the whole partition mechanism was
    // built against synthetic data, and gating that would gate the tests rather than the dataset.
    const synthetic = resolveBrazilReceitaFullJoinTemporaryStoragePolicy({ realDataRun: false });
    assert.equal(synthetic.approved, true);
    assert.equal(synthetic.source, 'not_required');
  });

  // Test 2.
  it('2 — leaves the tracked constant a `false` literal that nothing in the connector assigns', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);

    const workspace = readConnectorSource('br-receita-cnpj-full-join-partition-workspace.ts');
    assert.ok(
      workspace.includes('BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED = false'),
      'the constant must remain a false literal',
    );

    // Nowhere in the connector may anything ASSIGN it. The declaration above is the only occurrence of
    // the name followed by `=`, and every other reference must be a read.
    const connectorFiles = fs
      .readdirSync(CONNECTOR_DIRECTORY)
      .filter((name) => name.endsWith('.ts'));
    for (const name of connectorFiles) {
      const code = codeWithoutComments(readConnectorSource(name));
      const assignments = [
        ...code.matchAll(/BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED\s*=[^=]/g),
      ];
      const allowed = name === 'br-receita-cnpj-full-join-partition-workspace.ts' ? 1 : 0;
      assert.equal(
        assignments.length,
        allowed,
        `${name} must not assign the tracked temporary-storage constant`,
      );
    }
  });

  // Test 3.
  it('3 — refuses without an invocation grant, and refuses a forged approval', () => {
    // No grant at all.
    assert.equal(mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(null), null);
    assert.equal(mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(undefined), null);
    assert.equal(
      mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(
        BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
      ),
      null,
    );

    // A grant missing ANY of the three, including its own flag. § 5's three approvals stay three.
    for (const flag of ALL_THREE_FLAGS) {
      assert.equal(
        mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(grantWithout(flag)),
        null,
        `a grant without ${flag} must not mint an approval`,
      );
    }

    // A truthy non-`true` is not an owner decision.
    for (const impostor of [1, 'true', {}, []]) {
      const forged = { ...completeGrant(), temporaryStoragePolicyApproved: impostor } as unknown;
      assert.equal(
        mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(
          forged as BrazilReceitaAttempt2OperatorAuthorization,
        ),
        null,
      );
    }

    // And an object SHAPED like an approval, built anywhere but the mint, fails the brand check. This is
    // the runtime half of the type-level guarantee: the brand symbol is not exported.
    for (const forged of [
      { lifetime: 'invocation_scoped', grantedBy: 'operator_grant' },
      { approved: true },
      JSON.parse(JSON.stringify(mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(completeGrant()))),
      'invocation_scoped',
      true,
      null,
    ]) {
      assert.equal(brazilReceitaFullJoinInvocationTemporaryStorageApprovalPresent(forged), false);
      assert.equal(
        resolveBrazilReceitaFullJoinTemporaryStoragePolicy({
          realDataRun: true,
          invocationTemporaryStorageApproval: forged,
        }).approved,
        false,
      );
    }
  });

  // Test 4.
  it('4 — accepts a minted approval on a real run, without touching the constant', () => {
    const approval = mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(completeGrant());
    assert.notEqual(approval, null);
    assert.equal(brazilReceitaFullJoinInvocationTemporaryStorageApprovalPresent(approval), true);

    const verdict = resolveBrazilReceitaFullJoinTemporaryStoragePolicy({
      realDataRun: true,
      invocationTemporaryStorageApproval: approval,
    });
    assert.equal(verdict.approved, true);
    // Named for what it is. A report that said only `true` could not distinguish an owner's per-run
    // decision from a repository-wide flip, and those are different facts.
    assert.equal(verdict.source, 'invocation_grant');
    // The other wall did not move to get here.
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);
  });

  // Test 5.
  it('5 — persists nothing between invocations, and reads no ambient state', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_LIFETIME, 'invocation_scoped');
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_PERSISTED, false);

    // Minting once must not make the NEXT mint succeed. If anything were cached, this would.
    const first = mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(completeGrant());
    assert.notEqual(first, null);
    assert.equal(
      mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(
        BRAZIL_RECEITA_ATTEMPT_2_OPERATOR_AUTHORIZATION_DEFAULT,
      ),
      null,
      'a previous mint must not authorize a later invocation',
    );
    // Nor may a workspace refuse and then accept, or accept and then refuse, on its own history.
    assert.equal(resolveBrazilReceitaFullJoinTemporaryStoragePolicy({ realDataRun: true }).approved, false);

    // Structural: no ambient source, no persistence, no module-level mutable binding.
    const source = codeWithoutComments(
      readConnectorSource('br-receita-cnpj-full-join-temporary-storage-approval.ts'),
    );
    for (const pattern of [
      /node:fs/,
      /process\.env/,
      /child_process/,
      /globalThis/,
      /^let /m,
      /^var /m,
      /new Map\(/,
      /new Set\(/,
    ]) {
      assert.ok(!pattern.test(source), `the approval module must not use ${String(pattern)}`);
    }
    // The brand is the enforcement, so it must NOT be exported.
    assert.ok(
      !/export const BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_APPROVAL_BRAND/.test(source),
      'the brand symbol must stay private to the module',
    );
  });
});

// ─── § B — the engine's second wall ───────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-FINAL § B — the engine wall', () => {
  it('refuses a real workspace with no approval, and creates one with a minted approval', () => {
    const refused = openWorkspace({ realDataRun: true });
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.deepEqual([...refused.rejections], ['temporary_storage_policy_not_approved']);

    const granted = openWorkspace({
      realDataRun: true,
      invocationTemporaryStorageApproval:
        mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(completeGrant()),
    });
    assert.equal(granted.ok, true, 'a minted approval must satisfy the second wall');
    if (!granted.ok) return;
    // Cleaned up immediately: this test is about the gate, not about holding a workspace open. Nothing
    // was written, so `not_needed` is the honest outcome — never `unverified` or `failed`.
    const cleanup = granted.workspace.dispose();
    assert.ok(
      cleanup.outcome === 'completed' || cleanup.outcome === 'not_needed',
      `cleanup must be verified, saw ${cleanup.outcome}`,
    );
    assert.equal(cleanup.foreignEntriesLeftInPlace, 0);
  });

  // Test 9 — the exact failure attempt #2 hit, reproduced at the layer that produced it.
  it('9 — a real engine run with no approval aborts pre-read, reading nothing', async () => {
    const handle = fixture(syntheticScenario());
    const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(
      createBrazilReceitaFullJoinReaderFileSystem(),
      () => {
        throw new Error('the boundary must not be reached by a pre-read abort');
      },
    );

    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, { realDataRun: true, readerFileSystem: boundary.fileSystem }),
    );

    // The terminal code observed in production, and the stage that proves nothing was read.
    assert.equal(result.abortCode, 'temporary_storage_policy_not_approved');
    assert.equal(result.abortStage, 'before_first_read');
    assert.deepEqual([...result.workspaceRejections], ['temporary_storage_policy_not_approved']);

    // Zero bytes, zero rows, boundary uncrossed. This is the whole of defect B stated as data.
    assert.equal(result.exact.resource.bytesRead, 0);
    assert.equal(result.exact.resource.rowsRead, 0);
    assert.equal(result.exact.empresaRowsTraversed, 0);
    assert.equal(result.exact.estabelecimentoRowsTraversed, 0);
    assert.equal(boundary.crossed(), false);
    assert.equal(boundary.notificationCount(), 0);
  });

  // Test 12 — the approved path, stopped at the first synthetic read.
  it('12 — a real engine run WITH a minted approval passes the wall and reaches a read', async () => {
    const handle = fixture(syntheticScenario());
    let crossings = 0;
    const sentinelReader = createBrazilReceitaFullJoinReaderFileSystem();
    const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(
      {
        ...sentinelReader,
        // § 12: the test stops at the boundary. The first read fails deliberately, so this suite never
        // traverses a file even though the file is synthetic.
        read() {
          throw new Error('SYNTHETIC STOP: first read');
        },
      },
      () => {
        crossings += 1;
      },
    );

    const result = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(handle, {
        realDataRun: true,
        readerFileSystem: boundary.fileSystem,
        invocationTemporaryStorageApproval:
          mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(completeGrant()),
      }),
    );

    // The wall did NOT stop this run — that is the fix. It stopped at the synthetic reader instead.
    assert.notEqual(result.abortCode, 'temporary_storage_policy_not_approved');
    assert.notEqual(result.abortStage, 'before_first_read');
    assert.deepEqual([...result.workspaceRejections], []);
    // And the constant is still what it was.
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);

    // The boundary fired, exactly once, at the read.
    assert.equal(crossings, 1);
    assert.equal(boundary.notificationCount(), 1);
    assert.equal(boundary.crossed(), true);

    // Debris check: a run that crossed and failed still deletes its workspace and verifies the deletion.
    assert.ok(
      result.cleanupOutcome === 'completed' || result.cleanupOutcome === 'not_needed',
      `cleanup must be verified, saw ${String(result.cleanupOutcome)}`,
    );
  });
});

// ─── § C — the real boundary ──────────────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-FINAL § C — the first real source read', () => {
  /** Records every port operation, so a test can assert which ones did NOT cross. */
  function recordingPort(onRead: () => void = () => {}) {
    const calls: string[] = [];
    return {
      calls,
      port: {
        size(): number {
          calls.push('size');
          return 0;
        },
        open(): number {
          calls.push('open');
          return 1;
        },
        read(): number {
          calls.push('read');
          onRead();
          return 0;
        },
        close(): void {
          calls.push('close');
        },
      },
    };
  }

  // Tests 6, 7, 8.
  it('6, 7, 8 — nothing but a read crosses: not size, not open, not close', () => {
    let crossings = 0;
    const { port, calls } = recordingPort();
    const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(port, () => {
      crossings += 1;
    });

    // The whole exclusion list from § 8, exercised through the only port a source travels on. Manifest
    // validation, SHA hashing, workspace creation, partition-workspace policy validation and the engine
    // invocation itself do not use this port AT ALL, which is a stronger statement than "they do not
    // cross": the wrapper cannot see them.
    boundary.fileSystem.size('/synthetic/part.csv');
    const handle = boundary.fileSystem.open('/synthetic/part.csv');
    boundary.fileSystem.close(handle);
    assert.equal(crossings, 0);
    assert.equal(boundary.crossed(), false);
    assert.equal(boundary.notificationCount(), 0);
    assert.deepEqual(calls, ['size', 'open', 'close']);

    // Named as data so the exclusion list cannot drift from the implementation.
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_REAL_SOURCE_READ_OPERATION, 'read');
    assert.deepEqual([...BRAZIL_RECEITA_FULL_JOIN_NON_CROSSING_READER_OPERATIONS], [
      'size',
      'open',
      'close',
    ]);
  });

  // Tests 10, 11, 12 (crossing arithmetic).
  it('10, 11 — the first read crosses, and it crosses exactly once', () => {
    let crossings = 0;
    const { port } = recordingPort();
    const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(port, () => {
      crossings += 1;
    });

    boundary.fileSystem.read(1, Buffer.alloc(8), 0, 8, 0);
    assert.equal(crossings, 1);
    assert.equal(boundary.crossed(), true);
    assert.equal(boundary.notificationCount(), 1);

    for (let index = 0; index < 64; index += 1) {
      boundary.fileSystem.read(1, Buffer.alloc(8), 0, 8, index * 8);
    }
    assert.equal(crossings, 1);
    assert.equal(boundary.notificationCount(), BRAZIL_RECEITA_FULL_JOIN_MAX_BOUNDARY_CROSSINGS);
  });

  // Test 12 — twenty parts, one crossing.
  it('12 — twenty source parts produce one crossing, not twenty', () => {
    let crossings = 0;
    const { port } = recordingPort();
    const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(port, () => {
      crossings += 1;
    });

    // The attempt #2 input shape: ten Empresas parts and ten Estabelecimentos parts, each opened, read
    // several times and closed.
    for (let part = 0; part < 20; part += 1) {
      const handle = boundary.fileSystem.open(`/synthetic/part-${part}.csv`);
      for (let chunk = 0; chunk < 5; chunk += 1) {
        boundary.fileSystem.read(handle, Buffer.alloc(8), 0, 8, chunk * 8);
      }
      boundary.fileSystem.close(handle);
    }
    assert.equal(crossings, 1);
    assert.ok(boundary.notificationCount() <= BRAZIL_RECEITA_FULL_JOIN_MAX_BOUNDARY_CROSSINGS);
  });

  it('latches before delegating, so a throwing notifier still leaves the boundary crossed', () => {
    let reads = 0;
    const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(
      {
        size: () => 0,
        open: () => 1,
        read: () => {
          reads += 1;
          return 0;
        },
        close: () => {},
      },
      () => {
        throw new Error('notifier failed');
      },
    );

    assert.throws(() => boundary.fileSystem.read(1, Buffer.alloc(8), 0, 8, 0), /notifier failed/);
    // The run was about to pull bytes. The accounting must not depend on the notifier's reliability.
    assert.equal(boundary.crossed(), true);
    assert.equal(boundary.notificationCount(), 1);
    // And the read never happened, so no second notification can follow a retry that does.
    assert.equal(reads, 0);
    boundary.fileSystem.read(1, Buffer.alloc(8), 0, 8, 0);
    assert.equal(reads, 1);
    assert.equal(boundary.notificationCount(), 1);
  });

  it('propagates a port failure unchanged, and does not read the buffer it forwards', () => {
    const forwarded: unknown[] = [];
    const boundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(
      {
        size: () => 0,
        open: () => 1,
        read(handle, buffer, bufferOffset, length, position) {
          forwarded.push([handle, buffer.length, bufferOffset, length, position]);
          throw new Error('EIO');
        },
        close: () => {},
      },
      () => {},
    );

    assert.throws(() => boundary.fileSystem.read(7, Buffer.alloc(16), 1, 15, 32), /EIO/);
    // Every argument arrives untouched. The decorator observes THAT a read happens, never what it moves.
    assert.deepEqual(forwarded, [[7, 16, 1, 15, 32]]);
  });

  // Tests 13, 14 — what the crossing does to the attempt.
  it('13, 14 — a failure before the boundary spends nothing; after it, the attempt is spent', () => {
    const attemptNumber = brazilReceitaNextRealAttemptNumber();

    // BEFORE: the ledger is built and the run dies without a read.
    const unspent = createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(attemptNumber);
    const beforeBoundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(
      recordingPort().port,
      () => {
        unspent.commitCrossing();
      },
    );
    beforeBoundary.fileSystem.size('/synthetic/part.csv');
    beforeBoundary.fileSystem.close(beforeBoundary.fileSystem.open('/synthetic/part.csv'));
    assert.equal(unspent.boundaryState(), 'before_real_data_boundary');
    assert.equal(unspent.committedAttemptNumber(), null);
    assert.equal(unspent.resultingAttemptsConsumed(), BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED);

    // AFTER: one read, then the run fails. § 11's rule is that the failure is irrelevant — the crossing
    // is what spent it.
    const spent = createBrazilReceitaRealBenchmarkAttemptBoundaryLedger(attemptNumber);
    const afterBoundary = withBrazilReceitaFullJoinFirstSourceReadBoundary(
      {
        size: () => 0,
        open: () => 1,
        read: () => {
          throw new Error('the join failed after the first read');
        },
        close: () => {},
      },
      () => {
        spent.commitCrossing();
      },
    );
    assert.throws(() => afterBoundary.fileSystem.read(1, Buffer.alloc(8), 0, 8, 0));
    assert.equal(spent.boundaryState(), 'crossed_real_data_boundary');
    assert.equal(spent.committedAttemptNumber(), attemptNumber);
    assert.equal(spent.resultingAttemptsConsumed(), attemptNumber);
    assert.ok(spent.resultingAttemptsConsumed() > BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED);
  });

  it('wires the benchmark boundary to the reader port rather than to the engine call', () => {
    // Structural, because the defect was a LINE POSITION and a passing behavioural test could coexist
    // with the old placement if the scenario happened to read something.
    const benchmark = codeWithoutComments(
      readConnectorSource('br-receita-cnpj-real-full-scan-benchmark.ts'),
    );
    assert.ok(
      benchmark.includes('withBrazilReceitaFullJoinFirstSourceReadBoundary(request.readerFileSystem'),
      'the boundary must decorate the reader port',
    );
    assert.ok(
      benchmark.includes('readerFileSystem: boundary.fileSystem'),
      'the engine must receive the decorated port',
    );
    // The bare pre-engine commit is gone: the only `commitCrossing()` left is inside the callback.
    const commits = [...benchmark.matchAll(/commitCrossing\(\)/g)];
    assert.equal(commits.length, 1, 'exactly one commit site');
    const callbackSite = benchmark.indexOf('withBrazilReceitaFullJoinFirstSourceReadBoundary');
    const engineSite = benchmark.indexOf('runBrazilReceitaFullJoinStreamingEngineOnce({');
    const commitSite = benchmark.indexOf('commitCrossing()');
    assert.ok(commitSite > callbackSite, 'the commit must live inside the boundary callback');
    assert.ok(commitSite < engineSite, 'the callback is declared before the engine call it feeds');
    // And the crossed flag is no longer asserted into existence with a cast.
    assert.ok(
      !/'crossed_real_data_boundary'\) as true/.test(benchmark),
      'the completion must report the ledger, not a cast',
    );
  });
});

// ─── § D — the attempt state ──────────────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-FINAL § D — attempt state', () => {
  // Tests 15, 16, 17.
  it('15, 16, 17 — attempt #1 stays consumed, #2 stays available and unauthorized, #3 prohibited', () => {
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED, 1);
    assert.equal(brazilReceitaNextRealAttemptNumber(), 2);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_STRUCTURALLY_SUPPORTED_ATTEMPTS, 2);
    assert.equal(BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED, false);

    // #1 cannot be re-requested, #2 is structurally eligible, #3 is refused by the limit.
    assert.equal(evaluateBrazilReceitaRealBenchmarkAttemptRequest(1).rejectionCode, 'real_attempt_number_already_consumed');
    const second = evaluateBrazilReceitaRealBenchmarkAttemptRequest(2);
    assert.equal(second.eligible, true);
    // Eligible is not authorized, and the ledger says so itself.
    assert.equal(second.authorized, false);
    assert.equal(
      evaluateBrazilReceitaRealBenchmarkAttemptRequest(3).rejectionCode,
      'real_benchmark_attempt_limit_reached',
    );

    // Nothing in this milestone authorized a benchmark.
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);

    // No reset path exists, and this PR did not add one.
    const ledger = codeWithoutComments(
      readConnectorSource('br-receita-cnpj-real-benchmark-attempt-ledger.ts'),
    );
    assert.ok(!/\breset\s*\(/.test(ledger), 'the attempt ledger must have no reset');
    assert.ok(
      ledger.includes('BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED = 1'),
      'the durable count must stay a literal one',
    );
  });
});

// ─── § E — nothing else moved ─────────────────────────────────────────────────

describe('BR-SOURCE-ATTEMPT2-FINAL § E — nothing else moved', () => {
  // Test 18.
  it('18 — leaves every proposed cap exactly where it was', () => {
    // Pinned as literals rather than compared to themselves: a snapshot that read the source it guards
    // would agree with any edit.
    assert.deepEqual({ ...BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS }, {
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
    });
  });

  // Test 19.
  it('19 — adds no gate, no state and no I/O to the engine, and joins as it always did', async () => {
    // The engine's only new vocabulary is the field it FORWARDS. It must not decide anything about it.
    const engine = codeWithoutComments(readConnectorSource('br-receita-cnpj-full-join-engine.ts'));
    // Three occurrences and no fourth: the request field's declaration, and the two halves of the one
    // line that forwards it. A fourth would mean the engine started having an opinion.
    const mentions = [...engine.matchAll(/invocationTemporaryStorageApproval/g)];
    assert.equal(mentions.length, 3, 'declared on the request, forwarded to the workspace, and nowhere else');
    assert.ok(
      engine.includes(
        'invocationTemporaryStorageApproval: request.invocationTemporaryStorageApproval',
      ),
      'the forward must be verbatim — no interpretation, no default, no derivation',
    );
    for (const forbidden of [
      /brazilReceitaFullJoinInvocationTemporaryStorageApprovalPresent/,
      /mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval/,
      /BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED\s*=/,
      /node:fs/,
      /process\.env/,
    ]) {
      assert.ok(!forbidden.test(engine), `the engine must not reference ${String(forbidden)}`);
    }

    // Behavioural: a synthetic run still joins, and neither new field changes what it finds. Same
    // scenario, once with the field absent and once with a minted approval on a synthetic run — where
    // the approval is not even consulted.
    const scenario = syntheticScenario();
    const plain = await runBrazilReceitaFullJoinStreamingEngineOnce(engineRequest(fixture(scenario)));
    const decorated = await runBrazilReceitaFullJoinStreamingEngineOnce(
      engineRequest(fixture(scenario), {
        invocationTemporaryStorageApproval:
          mintBrazilReceitaFullJoinInvocationTemporaryStorageApproval(completeGrant()),
      }),
    );

    assert.equal(plain.exitStatus, 'completed', JSON.stringify(plain.abortCode));
    assert.equal(decorated.exitStatus, 'completed', JSON.stringify(decorated.abortCode));
    for (const field of [
      'matchesEmitted',
      'empresaRowsTraversed',
      'estabelecimentoRowsTraversed',
      'referencesPersisted',
      'orphanEstabelecimentoCount',
      'partitionsCreated',
      'partitionDepthReached',
    ] as const) {
      assert.equal(decorated.exact[field], plain.exact[field], field);
    }
  });

  // Test 20.
  it('20 — reaches no real data: every source this suite reads is one it wrote', () => {
    const handle = fixture(syntheticScenario(2));
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    for (const source of handle.sources) {
      const resolved = fs.realpathSync(source.filePath);
      assert.ok(
        resolved.startsWith(`${temporaryRoot}${path.sep}`),
        'every fixture source must live under the OS temp root',
      );
      // Not the dataset, not the repository, not the operator's home.
      assert.ok(!resolved.includes('receita'), 'no fixture may sit under a Receita path');
    }

    // Structural: this suite names no publisher artifact, no archive and no network destination. It
    // DOES drive the benchmark entry point in § F, and that is exactly why the port scripting below
    // matters — the entry point has no `node:fs` import, so a scripted port is the only way in.
    //
    // Each needle is ASSEMBLED from fragments rather than written whole, so the scan does not find
    // itself and report a violation it created. A literal list would fail on its own text.
    const suite = codeWithoutComments(fs.readFileSync(__filename, 'utf8'));
    const forbiddenNeedles = [
      ['.z', 'ip'],
      ['http', '://'],
      ['/srv/rece', 'ita/'],
      ['CNPJ', 'MEI'],
    ].map((fragments) => fragments.join(''));
    for (const needle of forbiddenNeedles) {
      assert.ok(!suite.includes(needle), `this suite must not reference "${needle}"`);
    }
  });
});

// ─── § F — the whole path, end to end ─────────────────────────────────────────

/**
 * Everything below drives the real benchmark entry point over SYNTHETIC files.
 *
 * § B and § C prove the two fixes at the layer each one lives in. This section proves the thing an
 * operator actually cares about: that a fully-granted invocation now gets PAST the engine's wall, and
 * that when the engine stops before reading, the outcome says so — `realDataBoundaryCrossed: false`,
 * with the durable count unmoved. That combination was unrepresentable before this milestone, because
 * the completion type declared the flag as the literal `true`.
 */
describe('BR-SOURCE-ATTEMPT2-FINAL § F — the benchmark, end to end', () => {
  /**
   * Every fixture source, as manifest entries the bridge will accept.
   *
   * Part ordinals are assigned per family in fixture order — the fixture writes files, not manifests,
   * so the 10 + 10 identity the national gate checks is composed here rather than read off a descriptor.
   */
  function manifestEntriesFor(handle: BrazilReceitaFullJoinFixtureHandle) {
    const nextOrdinal = new Map<string, number>();
    return handle.sources.map((source) => {
      const ordinal = nextOrdinal.get(source.family) ?? 0;
      nextOrdinal.set(source.family, ordinal + 1);
      return {
        fileType: source.family,
        partOrdinal: ordinal,
        path: path.basename(source.filePath),
        encoding: 'latin1',
        delimiter: ';',
        layoutMode: 'official_headerless',
      };
    });
  }

  function manifestDocumentFor(handle: BrazilReceitaFullJoinFixtureHandle): string {
    return JSON.stringify({
      mode: 'local_manifest_validation',
      sourceKey: SYNTHETIC_SOURCE_KEY,
      countryCode: 'BR',
      sourceYear: 2026,
      sourcePeriod: SYNTHETIC_PERIOD,
      layoutMode: 'official_headerless',
      inputScope: 'full_national',
      files: manifestEntriesFor(handle),
    });
  }

  /** A validator double that ACCEPTS. It touches no disk and is never the official validator. */
  function acceptingValidator(): BrazilReceitaFullJoinBridgeManifestValidator {
    return async () =>
      ({
        ok: true,
        sourceKey: SYNTHETIC_SOURCE_KEY,
        countryCode: 'BR',
        sourceYear: 2026,
        sourcePeriod: SYNTHETIC_PERIOD,
        inputScope: 'full_national',
        filesSeen: 20,
        filesAccepted: 20,
        filesRejected: 0,
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

  /**
   * Drives the entry point with a COMPLETE grant against a synthetic 10 + 10 input.
   *
   * `readerScript` decides what the first source read does, which is the only variable that matters
   * here: `'never'` arranges an engine abort BEFORE any read, `'throw'` fails ON the first read.
   */
  async function runEndToEnd(readerScript: 'never' | 'throw'): Promise<{
    outcome: Awaited<ReturnType<typeof runSyntheticBenchmark>>;
    reads: number;
  }> {
    const handle = fixture(syntheticScenario(BR_RECEITA_CNPJ_NATIONAL_PART_COUNT));
    const manifestPath = path.join(handle.datasetRoot, 'synthetic-manifest.json');
    fs.writeFileSync(manifestPath, manifestDocumentFor(handle));

    const inventoryFileSystem: BrazilReceitaObservedInputInventoryFileSystem = {
      readManifestDocument: (target) => fs.readFileSync(target, 'utf8'),
      isSymbolicLink: (target) => fs.lstatSync(target).isSymbolicLink(),
      isRegularFile: (target) => fs.statSync(target).isFile(),
    };
    const observedInventory = buildBrazilReceitaObservedInputInventory({
      manifestPath,
      fileSystem: inventoryFileSystem,
    });
    assert.equal(observedInventory.ok, true, JSON.stringify(observedInventory.refusals));

    const parsed = parseBrazilReceitaRealFullScanCliArgs([
      '--real-full-scan-resource-benchmark',
      '--manifest',
      manifestPath,
      '--workspace-parent',
      handle.workspaceParentDirectory,
      '--private-metric-directory',
      '/synthetic/private',
      '--dataset-period',
      SYNTHETIC_PERIOD,
      '--private-metric-acknowledgement',
      BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
      '--real-attempt-number',
      String(brazilReceitaNextRealAttemptNumber()),
      ...ALL_THREE_FLAGS,
    ]);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) throw new Error('fixture args must parse');

    const declarations = {
      ...buildBrazilReceitaRealFullScanDeclarations(parsed.options, observedInventory),
      workspaceParentDirectory: handle.workspaceParentDirectory,
      workspaceBoundaries: {
        // `'never'` puts the workspace parent INSIDE the declared repository root, which the workspace
        // refuses at `before_first_read` — an engine abort that is not the temporary-storage one, so it
        // isolates the boundary question from the policy question.
        repositoryRoot:
          readerScript === 'never'
            ? handle.workspaceParentDirectory
            : '/workspaces/sellup-worktrees/attempt2-final',
        homeDirectory: '/home/operator',
        datasetRoot: handle.datasetRoot,
      },
    };
    // The gate's own verdict, restated here so a fixture that quietly stopped being 10 + 10 fails loudly
    // instead of being waved through by an `indeterminate` nobody looked at.
    assert.equal(
      (declarations.nationalInputCompleteness as { readonly verdict: string }).verdict,
      'complete',
    );

    let reads = 0;
    const realReader = createBrazilReceitaFullJoinReaderFileSystem();
    const outcome = await runSyntheticBenchmark({
      declarations,
      operatorAuthorization: completeGrant(),
      workingDirectory: {
        currentWorkingDirectory: '/workspaces/sellup-worktrees/attempt2-final/scripts',
        homeDirectory: '/home/operator',
        repositoryRoot: '/workspaces/sellup-worktrees/attempt2-final',
        datasetRoot: handle.datasetRoot,
        repositoryPackageName: 'sellup',
      },
      attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
      bridgeFileSystem: {
        readManifestDocument: (target) => fs.readFileSync(target, 'utf8'),
        isSymbolicLink: (target) => fs.lstatSync(target).isSymbolicLink(),
        realPath: (target) => fs.realpathSync(target),
        isRegularFile: (target) => fs.statSync(target).isFile(),
      },
      validateManifest: acceptingValidator(),
      readerFileSystem: {
        ...realReader,
        read() {
          reads += 1;
          // § 15: this suite never traverses a file. The first read is where it stops, always.
          throw new Error('SYNTHETIC STOP: first read');
        },
      },
      workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
      privateChannelFileSystem: {
        writeFileExclusive() {},
        chmod() {},
        statMode: () => 0o600,
        rename() {},
        exists: () => false,
        unlink() {},
      },
      privateChannelBoundaries: {
        repositoryRoot: '/workspaces/sellup-worktrees/attempt2-final',
        homeDirectory: '/home/operator',
        datasetRoot: handle.datasetRoot,
      },
      freeDiskProbe: () => 64 * 1024 * 1024 * 1024,
      nowMs: 1_700_000_000_000,
    });

    return { outcome, reads };
  }

  it('gets a fully-granted invocation PAST the engine wall, which used to be the hard stop', async () => {
    const { outcome, reads } = await runEndToEnd('throw');
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) return;

    // The exact terminal code attempt #2 died on, and it is gone.
    assert.notEqual(outcome.publicReport.abort_code, 'temporary_storage_policy_not_approved');
    // It reached a source read instead — the first one, and only the first.
    assert.equal(reads, 1);
    assert.equal(outcome.realDataBoundaryCrossed, true);
    assert.equal(outcome.realAttemptNumber, brazilReceitaNextRealAttemptNumber());
    // Crossed, then failed. § 11: the attempt is spent regardless of the verdict.
    assert.equal(outcome.attemptsConsumedAfterRun, brazilReceitaNextRealAttemptNumber());
    // The constant that could not be flipped was not flipped.
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED, false);
  });

  it('reports a pre-read engine abort as an UNCROSSED boundary that spent nothing', async () => {
    const { outcome, reads } = await runEndToEnd('never');
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) return;

    // The engine ran and refused before reading anything.
    assert.equal(outcome.publicReport.abort_stage, 'engine');
    assert.equal(outcome.publicReport.exit_status, 'aborted');
    assert.equal(reads, 0);

    // The whole of defect B: reaching the engine is not crossing the boundary, and the durable count
    // stays where it was. Before this milestone both of these were `true` and `2`.
    assert.equal(outcome.realDataBoundaryCrossed, false);
    assert.equal(outcome.attemptsConsumedAfterRun, BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED);
  });
});
