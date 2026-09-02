/**
 * BR Receita CNPJ — NATIONAL CHUNK OPERATOR CLI: tests.
 *
 * Proves the operator front-end is safe and thin:
 *   - an incomplete or malformed declaration is refused BEFORE any port is touched;
 *   - `--mode benchmark` reaches the REAL `loadBrReceitaNationalChunk()` and exits 0;
 *   - publication and run creation are unreachable — asserted both at runtime (a gateway that
 *     counts every call) and statically (against the comment-stripped CLI source, so a mention
 *     in prose is never mistaken for a call).
 *
 * 100% synthetic. No Supabase, no real dataset, no download, no publication.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BR_RECEITA_OPERATOR_CHUNK_EXIT,
  BR_RECEITA_OPERATOR_CHUNK_MODES,
  BrReceitaOperatorChunkRefusalError,
  main,
  parseBrReceitaOperatorChunkArgs,
  runBrReceitaOperatorChunk,
  type BrReceitaOperatorChunkPorts,
} from '../br-receita-operator-chunk';
import type { BrazilReceitaFullJoinEngineResult } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-engine';
import { createBrazilReceitaFullJoinOpenHandleLedger } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-full-join-open-handle-ledger';
import type { BrReceitaNationalChunkEngineBaseRequest } from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-chunk-loader';
import type {
  BrReceitaSnapshotWriteGateway,
  BrReceitaSqlExecutor,
} from '../../../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-monthly-snapshot-write-gateway';

const CLI_FILE = 'br-receita-operator-chunk.ts';
const CLI_PATH = path.join(__dirname, '..', CLI_FILE);

const RUN_ID = '22222222-2222-4222-8222-222222222222';
const PERIOD = '2026-07';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;

const VALID_ARGS = [
  '--run-id',
  RUN_ID,
  '--period',
  PERIOD,
  '--fingerprint',
  FINGERPRINT,
  '--partition-start',
  '64',
  '--partition-count',
  '64',
  '--mode',
  'benchmark',
];

function argsWithout(flag: string): string[] {
  const index = VALID_ARGS.indexOf(flag);
  return [...VALID_ARGS.slice(0, index), ...VALID_ARGS.slice(index + 2)];
}

function argsWith(flag: string, value: string): string[] {
  const next = [...VALID_ARGS];
  next[next.indexOf(flag) + 1] = value;
  return next;
}

function refusalOf(argv: readonly string[]): string {
  try {
    parseBrReceitaOperatorChunkArgs(argv);
  } catch (error) {
    assert.ok(error instanceof BrReceitaOperatorChunkRefusalError);
    return error.code;
  }
  return assert.fail('expected a refusal');
}

// ─── Ports: every call is counted, publication and run creation throw ──────────

interface GatewaySpy {
  readonly gateway: BrReceitaSnapshotWriteGateway;
  readonly calls: Record<string, number>;
}

function gatewaySpy(): GatewaySpy {
  const calls: Record<string, number> = {
    beginPeriodRun: 0,
    discardRunRows: 0,
    upsertBatch: 0,
    commitFinalBatchAndPublish: 0,
    failPeriod: 0,
  };
  const gateway: BrReceitaSnapshotWriteGateway = {
    async beginPeriodRun() {
      calls.beginPeriodRun += 1;
      throw new Error('beginPeriodRun must never be reachable from the operator CLI');
    },
    async discardRunRows() {
      calls.discardRunRows += 1;
      throw new Error('discardRunRows must never be reachable from the operator CLI');
    },
    async upsertBatch(operation) {
      calls.upsertBatch += 1;
      return { writtenRows: operation.rows.length };
    },
    async commitFinalBatchAndPublish() {
      calls.commitFinalBatchAndPublish += 1;
      throw new Error('publication must never be reachable from the operator CLI');
    },
    async failPeriod() {
      calls.failPeriod += 1;
      throw new Error('failPeriod must never be reachable from the operator CLI');
    },
  };
  return { gateway, calls };
}

function sqlReady(): BrReceitaSqlExecutor {
  return {
    async query() {
      return { rows: [{ ready: true }] };
    },
  };
}

function engineRequest(): BrReceitaNationalChunkEngineBaseRequest {
  return {
    sources: [],
    readerCaps: {
      maxChunkBytes: 4_194_304,
      maxCarryBytes: 65_536,
      maxRowBytes: 65_536,
      maxColumnsPerRow: 64,
    },
    partitioningCaps: {
      partitionCount: 1024,
      maxPartitionCount: 1024,
      maxPartitionDepth: 1,
      maxReferencesPerPartition: 131_072,
      maxReferenceBytesPerPartition: 2_097_152,
    },
    resourceCaps: {},
    duplicateKeyPolicy: 'reject',
    readerFileSystem: {
      size: () => 0,
      open: () => {
        throw new Error('no source read expected in stub');
      },
      read: () => 0,
      close: () => undefined,
    },
    workspaceFileSystem: {},
    workspaceParentDirectory: '/opaque',
    workspaceBoundaries: {},
    resourceDependencies: {},
    openHandleLedger: createBrazilReceitaFullJoinOpenHandleLedger(64),
    maxOpenPartitionFiles: 32,
    minimumFreeDiskBeforeStart: 1,
    minimumFreeDiskReserve: 1,
    freeDiskProbe: {},
    realDataRun: true,
    invocationTemporaryStorageApproval: null,
  } as unknown as BrReceitaNationalChunkEngineBaseRequest;
}

function completedEngineResult(start: number, endExclusive: number) {
  return {
    exitStatus: 'completed',
    abortCode: null,
    abortStage: null,
    resourceBreach: null,
    readerCapRejections: [],
    partitioningCapRejections: [],
    partitionOrdinalRangeRejections: [],
    resourceCapRejections: [],
    workspaceRejections: [],
    exact: { partitionsCreated: 1024, partitionDepthReached: 0 },
    publicReport: {},
    partitionSummaries: [],
    executedPartitionOrdinalRange: { start, endExclusive },
    firstFileOffsetProgression: [],
    cleanupOutcome: null,
  } as unknown as BrazilReceitaFullJoinEngineResult;
}

function ports(spy: GatewaySpy): BrReceitaOperatorChunkPorts {
  return {
    sourceYear: 2026,
    sql: sqlReady(),
    gateway: spy.gateway,
    catalogs: { cnaesRows: [], municipiosRows: [], naturezasRows: [] },
    materializationCaps: {
      maxAdditionalBytesRead: 1_000_000,
      maxRowsRehydrated: 10_000,
    },
    engineRequest: engineRequest(),
    runEngine: async (request) => {
      await request.sink.finalize();
      return completedEngineResult(64, 128);
    },
  };
}

// ─── Declaration refusals ─────────────────────────────────────────────────────

describe('parseBrReceitaOperatorChunkArgs — required declarations', () => {
  it('refuses a missing run id', () => {
    assert.equal(refusalOf(argsWithout('--run-id')), 'run_id_not_declared');
  });

  it('refuses a run id that is not a run identifier', () => {
    assert.equal(refusalOf(argsWith('--run-id', 'not-a-run-id')), 'run_id_invalid');
  });

  it('refuses a missing or malformed period', () => {
    assert.equal(refusalOf(argsWithout('--period')), 'period_not_declared');
    assert.equal(refusalOf(argsWith('--period', '2026-13')), 'period_invalid');
  });

  it('refuses a missing fingerprint', () => {
    assert.equal(refusalOf(argsWithout('--fingerprint')), 'fingerprint_not_declared');
  });

  it('refuses a malformed fingerprint', () => {
    assert.equal(refusalOf(argsWith('--fingerprint', 'sha256:zzzz')), 'fingerprint_invalid');
    assert.equal(refusalOf(argsWith('--fingerprint', 'a'.repeat(64))), 'fingerprint_invalid');
    assert.equal(
      refusalOf(argsWith('--fingerprint', `sha256:${'A'.repeat(64)}`)),
      'fingerprint_invalid',
    );
  });

  it('refuses a missing mode', () => {
    assert.equal(refusalOf(argsWithout('--mode')), 'mode_not_declared');
  });
});

describe('parseBrReceitaOperatorChunkArgs — partition range', () => {
  it('refuses a missing start or count', () => {
    assert.equal(refusalOf(argsWithout('--partition-start')), 'partition_start_not_declared');
    assert.equal(refusalOf(argsWithout('--partition-count')), 'partition_count_not_declared');
  });

  it('refuses a negative, fractional or non-numeric ordinal', () => {
    assert.equal(refusalOf(argsWith('--partition-start', '-1')), 'partition_start_invalid');
    assert.equal(refusalOf(argsWith('--partition-start', '1.5')), 'partition_start_invalid');
    assert.equal(refusalOf(argsWith('--partition-count', '0x40')), 'partition_count_invalid');
  });

  it('refuses a zero-width window', () => {
    assert.equal(refusalOf(argsWith('--partition-count', '0')), 'partition_range_invalid');
  });

  it('refuses a window that runs past the pinned 1024-partition map', () => {
    assert.equal(refusalOf(argsWith('--partition-start', '1024')), 'partition_range_invalid');
    assert.equal(refusalOf(argsWith('--partition-count', '1024')), 'partition_range_invalid');
  });

  it('accepts the full map as one window', () => {
    const options = parseBrReceitaOperatorChunkArgs(
      argsWith('--partition-count', '1024').map((token, index, all) =>
        all[index - 1] === '--partition-start' ? '0' : token,
      ),
    );
    assert.equal(options.partitionOrdinalStart, 0);
    assert.equal(options.partitionOrdinalCount, 1024);
  });
});

// ─── Mode surface ─────────────────────────────────────────────────────────────

describe('mode surface', () => {
  it('recognises benchmark and nothing else', () => {
    assert.deepEqual([...BR_RECEITA_OPERATOR_CHUNK_MODES], ['benchmark']);
  });

  for (const deferred of ['publish', 'attach', 'begin-run', 'begin_run', 'beginRun']) {
    it(`refuses --mode ${deferred} at parse time`, () => {
      assert.equal(refusalOf(argsWith('--mode', deferred)), 'mode_not_supported');
    });
  }
});

// ─── Benchmark execution ──────────────────────────────────────────────────────

describe('--mode benchmark', () => {
  it('reaches the real chunk loader, reports a loaded-not-published chunk and exits 0', async () => {
    const spy = gatewaySpy();
    const exit = await main(VALID_ARGS, ports(spy));

    assert.equal(exit, BR_RECEITA_OPERATOR_CHUNK_EXIT.loaded);
    assert.equal(exit, 0);
  });

  it('forwards the operator window to the loader unchanged and never publishes', async () => {
    const spy = gatewaySpy();
    const report = await runBrReceitaOperatorChunk(
      parseBrReceitaOperatorChunkArgs(VALID_ARGS),
      ports(spy),
    );

    assert.equal(report.mode, 'benchmark');
    assert.equal(report.snapshotRunId, RUN_ID);
    assert.equal(report.sourcePeriod, PERIOD);
    assert.equal(report.inventoryFingerprint, FINGERPRINT);
    assert.equal(report.partitionOrdinalStart, 64);
    assert.equal(report.partitionOrdinalCount, 64);
    assert.equal(report.partitionOrdinalEndExclusive, 128);
    assert.equal(report.status, 'loaded_not_published');
    assert.equal(report.published, false);
  });

  it('never calls beginPeriodRun and never calls the publication commit', async () => {
    const spy = gatewaySpy();
    await main(VALID_ARGS, ports(spy));

    assert.equal(spy.calls.beginPeriodRun, 0);
    assert.equal(spy.calls.commitFinalBatchAndPublish, 0);
    assert.equal(spy.calls.discardRunRows, 0);
    assert.equal(spy.calls.failPeriod, 0);
  });

  it('refuses a loader-rejected declaration with exit 2 and touches no gateway method', async () => {
    const spy = gatewaySpy();
    // The map pin lives in the loader, not here: an unpinned engine request parses fine and is
    // refused downstream, which is what proves the CLI is not re-deciding the loader's rules.
    const request = engineRequest() as unknown as {
      partitioningCaps: { partitionCount: number; maxPartitionCount: number };
    };
    request.partitioningCaps.partitionCount = 512;

    const exit = await main(VALID_ARGS, {
      ...ports(spy),
      engineRequest: request as unknown as BrReceitaNationalChunkEngineBaseRequest,
    });

    assert.equal(exit, BR_RECEITA_OPERATOR_CHUNK_EXIT.refused);
    assert.equal(spy.calls.upsertBatch, 0);
    assert.equal(spy.calls.beginPeriodRun, 0);
    assert.equal(spy.calls.commitFinalBatchAndPublish, 0);
  });
});

// ─── No runtime, no run ───────────────────────────────────────────────────────

describe('runtime ports', () => {
  it('refuses a valid declaration that arrives with no runtime rather than inventing one', async () => {
    const exit = await main(VALID_ARGS, null);
    assert.equal(exit, BR_RECEITA_OPERATOR_CHUNK_EXIT.refused);
  });
});

// ─── Real process ─────────────────────────────────────────────────────────────

describe('spawned CLI', () => {
  it('exits non-zero when the run id is missing', () => {
    const spawned = spawnSync(
      process.execPath,
      ['--import', 'tsx', CLI_PATH, ...argsWithout('--run-id')],
      { encoding: 'utf8' },
    );
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, /REFUSED run_id_not_declared/);
  });
});

// ─── Static guards (comment-stripped, so prose is never read as a call) ───────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('static guards', () => {
  const code = stripComments(fs.readFileSync(CLI_PATH, 'utf8'));

  it('never references the publication commit or run creation in code', () => {
    assert.doesNotMatch(code, /commitFinalBatchAndPublish/);
    assert.doesNotMatch(code, /beginPeriodRun/);
    assert.doesNotMatch(code, /attachRunPartition|br_receita_attach_run_partition/);
    assert.doesNotMatch(code, /failPeriod|discardRunRows/);
  });

  it('never imports Supabase, a provider, HubSpot or a migration', () => {
    assert.doesNotMatch(code, /supabase|hubspot|apollo|lusha/i);
  });

  it('calls the existing loader instead of reimplementing it', () => {
    assert.match(code, /loadBrReceitaNationalChunk\(/);
  });
});
