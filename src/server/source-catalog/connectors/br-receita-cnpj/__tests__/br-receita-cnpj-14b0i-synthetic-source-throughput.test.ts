/**
 * BR Receita CNPJ — SYNTHETIC END-TO-END SOURCE-READ THROUGHPUT QUALIFICATION — tests
 * (BR-SOURCE-14B.0I § 20).
 *
 * The STRUCTURAL CI MODE suite: deterministic, no wall-clock assertion, small fixtures. It exercises
 * the real generator, the real metering decorator, and the real production pipeline
 * (`runBrazilReceitaFullJoinSyntheticFixtureBenchmark` → the real streaming engine → the real
 * partition workspace, handle pool, resource envelope, cleanup and sanitizer) end to end, and
 * checks CORRECTNESS and COUNTERS. The LOCAL PERFORMANCE MODE — large fixtures, wall-clock timing,
 * min/median/max across repeated runs — is a separate, manual harness
 * (`scripts/source-catalog/br-receita-cnpj-14b0i-local-performance.ts`), never a CI timing gate.
 *
 * ── Scoping note on the buffered writer's own syscall counters ──────────────────
 * `partitionWriteSyscalls`, `fullBufferFlushes` and `flushCount` are internal to
 * `br-receita-cnpj-full-join-partition-workspace`'s workspace instance and are not part of the
 * engine's public/exact surface (`BrazilReceitaFullJoinEngineExactObservations` has no such field).
 * BR-SOURCE-14B.0H's own dedicated suite
 * (`br-receita-cnpj-full-join-buffered-writer.test.ts`) already covers the write-call-reduction
 * claim directly against the workspace; this suite does not re-verify it and instead asserts what
 * the engine DOES expose: `partitionHandlePeakOpen` and `filesOpenedPeak` stay within their caps
 * regardless of row count.
 *
 * No Receita dataset, no manifest, no Supabase, no runtime, no Agent 1, no provider, no HubSpot.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS,
  countBrReceitaCnpjDelimitedColumns,
} from '../br-receita-cnpj-file-reader';
import {
  brazilReceitaFullJoinPartitionOrdinalFor,
  normalizeBrazilReceitaFullJoinKey,
} from '../br-receita-cnpj-full-join-engine-contract';
import {
  BRAZIL_RECEITA_14B0I_SYNTHETIC_TARGET_ROW_BYTES,
  createBrazilReceita14B0ISyntheticFixture,
  type BrazilReceita14B0ISyntheticScenarioPlan,
} from '../br-receita-cnpj-14b0i-synthetic-source-generator';
import { createBrazilReceita14B0IMeteringReaderFileSystem } from '../br-receita-cnpj-14b0i-metering-reader-fs';
import {
  BRAZIL_RECEITA_14B0I_BORDERLINE_FLOOR_MIB_S,
  BRAZIL_RECEITA_14B0I_HEALTHY_MARGIN_TARGET_MIB_S,
  BRAZIL_RECEITA_14B0I_MINIMUM_ENGINEERING_SOURCE_READ_TARGET_MIB_S,
  brazilReceita14B0IPartitioningCaps,
  classifyBrazilReceita14B0ISourceReadThroughput,
  recommendBrazilReceita14B0ISecondRealBenchmark,
  runBrazilReceita14B0ISyntheticThroughputRun,
  type BrazilReceita14B0IHarnessRunReport,
} from '../br-receita-cnpj-14b0i-synthetic-throughput-harness';
import { BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES } from '../br-receita-cnpj-full-join-partition-handle-pool';
import { brazilReceitaProposedFullScanResourceCaps } from '../br-receita-cnpj-real-full-scan-benchmark';
import { BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED } from '../br-receita-cnpj-full-join-resource-benchmark';

// ─── Harness fixtures ─────────────────────────────────────────────────────────

const SAFE_WORKING_DIRECTORY = {
  currentWorkingDirectory: '/workspaces/sellup-worktrees/br-14b0i',
  homeDirectory: '/home/operator',
  repositoryRoot: '/workspaces/sellup-worktrees/br-14b0i',
  datasetRoot: null,
  repositoryPackageName: 'sellup',
};

function uniformPlan(
  overrides: Partial<BrazilReceita14B0ISyntheticScenarioPlan> = {},
): BrazilReceita14B0ISyntheticScenarioPlan {
  return {
    profile: 'typical',
    matchedCompanyCount: 30,
    establishmentsPerMatchedCompany: 1,
    companiesWithoutEstablishmentCount: 4,
    orphanEstablishmentCount: 5,
    invalidKeyCompanyRows: 2,
    invalidKeyEstablishmentRows: 2,
    malformedCompanyRows: 1,
    malformedEstablishmentRows: 1,
    distribution: 'uniform',
    ...overrides,
  };
}

async function runStructural(
  plan: BrazilReceita14B0ISyntheticScenarioPlan,
  overrides: Partial<Parameters<typeof runBrazilReceita14B0ISyntheticThroughputRun>[0]> = {},
): Promise<BrazilReceita14B0IHarnessRunReport> {
  return runBrazilReceita14B0ISyntheticThroughputRun({
    mode: 'structural_ci',
    plan,
    workingDirectory: SAFE_WORKING_DIRECTORY,
    ...overrides,
  });
}

// ─── 1–10: synthetic source generator ──────────────────────────────────────────

describe('BR-SOURCE-14B.0I — synthetic source generator', () => {
  it('is deterministic: the same plan produces byte-identical files', async () => {
    const plan = uniformPlan();
    const first = await createBrazilReceita14B0ISyntheticFixture(plan);
    const second = await createBrazilReceita14B0ISyntheticFixture(plan);
    try {
      assert.equal(first.totalSourceBytes, second.totalSourceBytes);
      assert.equal(first.totalRows, second.totalRows);
      for (let index = 0; index < first.sources.length; index += 1) {
        const contentA = fs.readFileSync(first.sources[index]!.filePath, 'utf8');
        const contentB = fs.readFileSync(second.sources[index]!.filePath, 'utf8');
        assert.equal(contentA, contentB);
      }
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it('never contains a real-identifier-shaped digit run (>= 10 consecutive digits)', async () => {
    const fixture = await createBrazilReceita14B0ISyntheticFixture(uniformPlan());
    try {
      for (const source of fixture.sources) {
        const content = fs.readFileSync(source.filePath, 'utf8');
        assert.equal(/\d{10,}/.test(content), false, `unexpected long digit run in ${path.basename(source.filePath)}`);
      }
    } finally {
      fixture.dispose();
    }
  });

  it('writes the official column count for every well-formed row', async () => {
    const fixture = await createBrazilReceita14B0ISyntheticFixture(uniformPlan());
    try {
      const empresasLines = fs
        .readFileSync(fixture.sources[0]!.filePath, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0);
      const wellFormed = empresasLines.filter(
        (line) => countBrReceitaCnpjDelimitedColumns(line, ';') === BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.empresas,
      );
      assert.ok(wellFormed.length > 0);
      for (const line of wellFormed) {
        assert.equal(countBrReceitaCnpjDelimitedColumns(line, ';'), 7);
      }

      const estabLines = fs
        .readFileSync(fixture.sources[1]!.filePath, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0);
      const wellFormedEstab = estabLines.filter(
        (line) => countBrReceitaCnpjDelimitedColumns(line, ';') === 30,
      );
      assert.ok(wellFormedEstab.length > 0);
    } finally {
      fixture.dispose();
    }
  });

  it('uses the official `;` delimiter — the row separator count is columnCount - 1', async () => {
    const fixture = await createBrazilReceita14B0ISyntheticFixture(uniformPlan());
    try {
      const [firstLine] = fs.readFileSync(fixture.sources[0]!.filePath, 'utf8').split('\n');
      const semicolons = (firstLine ?? '').split(';').length - 1;
      assert.equal(semicolons, BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.empresas - 1);
    } finally {
      fixture.dispose();
    }
  });

  it('declares utf8 encoding, and the content decodes cleanly as utf8', async () => {
    const fixture = await createBrazilReceita14B0ISyntheticFixture(uniformPlan());
    try {
      for (const source of fixture.sources) {
        assert.equal(source.encoding, 'utf8');
        const content = fs.readFileSync(source.filePath, 'utf8');
        assert.equal(content.includes('�'), false);
      }
    } finally {
      fixture.dispose();
    }
  });

  it('the typical profile lands rows near its target width', async () => {
    const fixture = await createBrazilReceita14B0ISyntheticFixture(uniformPlan({ profile: 'typical' }));
    try {
      const target = BRAZIL_RECEITA_14B0I_SYNTHETIC_TARGET_ROW_BYTES.typical;
      const averageRowBytes = fixture.totalSourceBytes / fixture.totalRows;
      assert.ok(
        averageRowBytes >= target * 0.5 && averageRowBytes <= target * 1.5,
        `average row bytes ${averageRowBytes} not near target ${target}`,
      );
    } finally {
      fixture.dispose();
    }
  });

  it('the wide profile is wider than the typical profile', async () => {
    const typical = await createBrazilReceita14B0ISyntheticFixture(uniformPlan({ profile: 'typical' }));
    const wide = await createBrazilReceita14B0ISyntheticFixture(uniformPlan({ profile: 'wide' }));
    try {
      const typicalAvg = typical.totalSourceBytes / typical.totalRows;
      const wideAvg = wide.totalSourceBytes / wide.totalRows;
      assert.ok(wideAvg > typicalAvg * 2, `wide (${wideAvg}) not comfortably wider than typical (${typicalAvg})`);
    } finally {
      typical.dispose();
      wide.dispose();
    }
  });

  it('the narrow profile is narrower than the typical profile', async () => {
    const narrow = await createBrazilReceita14B0ISyntheticFixture(uniformPlan({ profile: 'narrow' }));
    const typical = await createBrazilReceita14B0ISyntheticFixture(uniformPlan({ profile: 'typical' }));
    try {
      const narrowAvg = narrow.totalSourceBytes / narrow.totalRows;
      const typicalAvg = typical.totalSourceBytes / typical.totalRows;
      assert.ok(narrowAvg < typicalAvg);
    } finally {
      narrow.dispose();
      typical.dispose();
    }
  });

  it('the oracle matches the plan exactly: matches, orphans, invalid and malformed counts', async () => {
    const plan = uniformPlan({ matchedCompanyCount: 12, establishmentsPerMatchedCompany: 3 });
    const fixture = await createBrazilReceita14B0ISyntheticFixture(plan);
    try {
      assert.equal(fixture.oracle.expectedMatches, 12 * 3);
      assert.equal(fixture.oracle.expectedOrphanEstablishments, plan.orphanEstablishmentCount);
      assert.equal(fixture.oracle.expectedCompaniesWithoutEstablishment, plan.companiesWithoutEstablishmentCount);
      assert.equal(
        fixture.oracle.expectedInvalidKeyCount,
        plan.invalidKeyCompanyRows + plan.invalidKeyEstablishmentRows,
      );
      assert.equal(
        fixture.oracle.expectedMalformedRowCount,
        plan.malformedCompanyRows + plan.malformedEstablishmentRows,
      );
    } finally {
      fixture.dispose();
    }
  });

  it('skewed distribution routes every matched key to the same partition ordinal', async () => {
    // Under `skewed_single_partition`, matched keys are drawn from
    // `brazilReceitaFullJoinSyntheticKeysInOnePartition` (the engine's own established fixture
    // helper), whose keys carry ITS `SYN_K` prefix rather than this generator's `SYN_MATCH_`
    // namespace — reusing the real partitioner's own helper is the point (see the generator's
    // header), so every other row family in this plan is zeroed out here to isolate the matched
    // keys unambiguously, without depending on either module's prefix convention.
    const partitionCount = brazilReceita14B0IPartitioningCaps().partitionCount;
    const plan = uniformPlan({
      matchedCompanyCount: 10,
      companiesWithoutEstablishmentCount: 0,
      orphanEstablishmentCount: 0,
      invalidKeyCompanyRows: 0,
      invalidKeyEstablishmentRows: 0,
      malformedCompanyRows: 0,
      malformedEstablishmentRows: 0,
      distribution: 'skewed_single_partition',
      skewPartitionCount: partitionCount,
    });
    const fixture = await createBrazilReceita14B0ISyntheticFixture(plan);
    try {
      const empresasLines = fs
        .readFileSync(fixture.sources[0]!.filePath, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0);
      assert.equal(empresasLines.length, 10);
      const ordinals = new Set(
        empresasLines.map((line) => {
          const key = normalizeBrazilReceitaFullJoinKey(line.split(';')[0] ?? null);
          return brazilReceitaFullJoinPartitionOrdinalFor(key as string, partitionCount);
        }),
      );
      assert.equal(ordinals.size, 1);
    } finally {
      fixture.dispose();
    }
  });
});

// ─── 11–15: metering reader filesystem ────────────────────────────────────────

describe('BR-SOURCE-14B.0I — metering reader filesystem', () => {
  function fakeRealPort(fileByHandle: Map<number, string>) {
    let nextHandle = 1;
    const calls: string[] = [];
    return {
      port: {
        size(filePath: string) {
          calls.push(`size:${filePath}`);
          return 1000;
        },
        open(filePath: string) {
          const handle = nextHandle;
          nextHandle += 1;
          fileByHandle.set(handle, filePath);
          calls.push(`open:${filePath}`);
          return handle;
        },
        read(_handle: number, _buffer: Buffer, _bufferOffset: number, length: number) {
          calls.push(`read:${length}`);
          return length;
        },
        close(handle: number) {
          calls.push(`close:${handle}`);
        },
      },
      calls,
    };
  }

  it('delegates every operation to the real port', () => {
    const fileByHandle = new Map<number, string>();
    const { port, calls } = fakeRealPort(fileByHandle);
    const metering = createBrazilReceita14B0IMeteringReaderFileSystem({
      realFileSystem: port,
      sources: [{ filePath: '/a', family: 'empresas', sourceFileOrdinal: 0, encoding: 'utf8' }],
      maxChunkBytes: 4096,
    });
    metering.fileSystem.size('/a');
    const handle = metering.fileSystem.open('/a');
    metering.fileSystem.read(handle, Buffer.alloc(1), 0, 4096, 0);
    metering.fileSystem.close(handle);
    assert.deepEqual(calls, ['size:/a', 'open:/a', 'read:4096', `close:${handle}`]);
  });

  it('classifies a read requesting exactly maxChunkBytes as a chunk read', () => {
    const fileByHandle = new Map<number, string>();
    const { port } = fakeRealPort(fileByHandle);
    const metering = createBrazilReceita14B0IMeteringReaderFileSystem({
      realFileSystem: port,
      sources: [{ filePath: '/a', family: 'empresas', sourceFileOrdinal: 0, encoding: 'utf8' }],
      maxChunkBytes: 4096,
    });
    const handle = metering.fileSystem.open('/a');
    metering.fileSystem.read(handle, Buffer.alloc(1), 0, 4096, 0);
    const snapshot = metering.snapshot();
    assert.equal(snapshot.totalChunkReadCalls, 1);
    assert.equal(snapshot.totalRowFetchCalls, 0);
  });

  it('classifies a read requesting less than maxChunkBytes as a row fetch', () => {
    const fileByHandle = new Map<number, string>();
    const { port } = fakeRealPort(fileByHandle);
    const metering = createBrazilReceita14B0IMeteringReaderFileSystem({
      realFileSystem: port,
      sources: [{ filePath: '/a', family: 'empresas', sourceFileOrdinal: 0, encoding: 'utf8' }],
      maxChunkBytes: 4096,
    });
    const handle = metering.fileSystem.open('/a');
    metering.fileSystem.read(handle, Buffer.alloc(1), 0, 120, 0);
    const snapshot = metering.snapshot();
    assert.equal(snapshot.totalRowFetchCalls, 1);
    assert.equal(snapshot.totalChunkReadCalls, 0);
  });

  it('attributes bytes to the correct family via the descriptor list', () => {
    const fileByHandle = new Map<number, string>();
    const { port } = fakeRealPort(fileByHandle);
    const metering = createBrazilReceita14B0IMeteringReaderFileSystem({
      realFileSystem: port,
      sources: [
        { filePath: '/empresas', family: 'empresas', sourceFileOrdinal: 0, encoding: 'utf8' },
        { filePath: '/estab', family: 'estabelecimentos', sourceFileOrdinal: 1, encoding: 'utf8' },
      ],
      maxChunkBytes: 4096,
    });
    const empresasHandle = metering.fileSystem.open('/empresas');
    metering.fileSystem.read(empresasHandle, Buffer.alloc(1), 0, 4096, 0);
    const estabHandle = metering.fileSystem.open('/estab');
    metering.fileSystem.read(estabHandle, Buffer.alloc(1), 0, 4096, 0);
    metering.fileSystem.read(estabHandle, Buffer.alloc(1), 0, 4096, 4096);

    const snapshot = metering.snapshot();
    assert.equal(snapshot.byFamily.empresas?.chunkReadCalls, 1);
    assert.equal(snapshot.byFamily.estabelecimentos?.chunkReadCalls, 2);
  });

  it('the snapshot totals equal the sum of the per-family stats', () => {
    const fileByHandle = new Map<number, string>();
    const { port } = fakeRealPort(fileByHandle);
    const metering = createBrazilReceita14B0IMeteringReaderFileSystem({
      realFileSystem: port,
      sources: [
        { filePath: '/empresas', family: 'empresas', sourceFileOrdinal: 0, encoding: 'utf8' },
        { filePath: '/estab', family: 'estabelecimentos', sourceFileOrdinal: 1, encoding: 'utf8' },
      ],
      maxChunkBytes: 4096,
    });
    const empresasHandle = metering.fileSystem.open('/empresas');
    metering.fileSystem.read(empresasHandle, Buffer.alloc(1), 0, 4096, 0);
    const estabHandle = metering.fileSystem.open('/estab');
    metering.fileSystem.read(estabHandle, Buffer.alloc(1), 0, 100, 0);

    const snapshot = metering.snapshot();
    const summedBytes = Object.values(snapshot.byFamily).reduce(
      (sum, stats) => sum + stats.chunkReadBytes + stats.rowFetchBytes,
      0,
    );
    assert.equal(summedBytes, snapshot.totalBytesRead);
  });

  it('rejects a non-positive maxChunkBytes', () => {
    assert.throws(() =>
      createBrazilReceita14B0IMeteringReaderFileSystem({
        realFileSystem: fakeRealPort(new Map()).port,
        sources: [],
        maxChunkBytes: 0,
      }),
    );
  });
});

// ─── 16–35: end-to-end harness over the real production pipeline ─────────────

describe('BR-SOURCE-14B.0I — harness over the real production pipeline', () => {
  it('drives the real synthetic-fixture benchmark entry point (completes, not refused)', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    assert.equal(report.exitStatus, 'completed');
  });

  it('reader, parser, router, buffered writer and FD pool are the production implementations', () => {
    const harnessSource = fs.readFileSync(
      path.join(__dirname, '..', 'br-receita-cnpj-14b0i-synthetic-throughput-harness.ts'),
      'utf8',
    );
    assert.ok(harnessSource.includes('runBrazilReceitaFullJoinSyntheticFixtureBenchmark'));
    assert.ok(harnessSource.includes('createBrazilReceitaFullJoinReaderFileSystem'));
    assert.ok(harnessSource.includes('createBrazilReceitaFullJoinWorkspaceFileSystem'));
    // No parallel engine: this module never defines its own partition-ordinal or CSV-column function.
    assert.equal(harnessSource.includes('function brazilReceitaFullJoinPartitionOrdinalFor'), false);
    assert.equal(harnessSource.includes('function countBrReceitaCnpjDelimitedColumns'), false);
  });

  it('SYNTHETIC_SOURCE_BYTES_READ equals the exact on-disk size of the generated files', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    assert.equal(report.meteringSnapshot?.totalChunkReadBytes, report.synthetic.syntheticSourceBytesTotal);
  });

  it('the rows-traversed counter equals the generator\'s total row count', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    const traversed = (report.exact?.empresaRowsTraversed ?? 0) + (report.exact?.estabelecimentoRowsTraversed ?? 0);
    assert.equal(traversed, report.synthetic.syntheticRowsTotal);
  });

  it('partition handles stay at or below the proposed ceiling regardless of row count', async () => {
    const report = await runStructural(uniformPlan({ matchedCompanyCount: 200, orphanEstablishmentCount: 200 }));
    assert.equal(report.ok, true);
    assert.ok(report.exact !== null);
    assert.ok(report.exact!.partitionHandlePeakOpen <= BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MAX_OPEN_PARTITION_FILES);
  });

  it('global open-file handles stay at or below maxFilesOpened regardless of row count', async () => {
    const caps = brazilReceitaProposedFullScanResourceCaps();
    const report = await runStructural(uniformPlan({ matchedCompanyCount: 200, orphanEstablishmentCount: 200 }));
    assert.equal(report.ok, true);
    assert.ok(report.exact!.filesOpenedPeak <= caps.maxFilesOpened);
  });

  it('the free-disk probe is called on a fixed schedule, not once per reference', async () => {
    let probeCalls = 0;
    const plan = uniformPlan({ matchedCompanyCount: 500, establishmentsPerMatchedCompany: 1, orphanEstablishmentCount: 0 });
    const report = await runStructural(plan, {
      freeDiskProbeOverride: () => {
        probeCalls += 1;
        return 64 * 1024 * 1024 * 1024;
      },
    });
    assert.equal(report.ok, true);
    // ~500+ references written, checked every 4096 records (see br-receita-cnpj-full-join-free-disk):
    // a per-reference probe would be in the hundreds; this must stay tiny.
    assert.ok(probeCalls < 20, `expected a bounded probe count, got ${probeCalls}`);
  });

  it('memory is sampled on the checkpoint schedule, not once per row', async () => {
    // The partitioned-join stage calls `checkpoint('after_join')` once per PARTITION ORDINAL it
    // visits (see `br-receita-cnpj-full-join-engine`'s second per-partition loop), so at this
    // profile's fixed `partitionCount` (1 024) the sample count has a floor near 1 024 regardless
    // of row count — that floor is a property of the partition count, not evidence of a per-row
    // sample. The property this test actually checks is GROWTH: multiplying the row count by 20x
    // must NOT multiply the sample count by anywhere near 20x, which a per-row sampler would do.
    async function countSamples(matchedCompanyCount: number): Promise<number> {
      let sampleCalls = 0;
      const plan = uniformPlan({ matchedCompanyCount, establishmentsPerMatchedCompany: 1, orphanEstablishmentCount: 0 });
      const report = await runStructural(plan, {
        resourceDependencies: {
          clock: () => process.hrtime.bigint(),
          memorySampler: () => {
            sampleCalls += 1;
            const usage = process.memoryUsage();
            return { rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external };
          },
        },
      });
      assert.equal(report.ok, true);
      return sampleCalls;
    }

    const small = await countSamples(50);
    const large = await countSamples(1_000);
    const rowGrowth = 1_000 / 50;
    const sampleGrowth = large / small;
    assert.ok(
      sampleGrowth < rowGrowth / 2,
      `sample count grew ${sampleGrowth}x for a ${rowGrowth}x row-count increase (small=${small}, large=${large})`,
    );
  });

  it('temporary storage peak is positive while references are being written', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    assert.ok((report.exact?.resource.temporaryStoragePeakBytes ?? 0) > 0);
  });

  it('temporary storage current is zero after verified cleanup', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    assert.equal(report.exact?.resource.temporaryStorageCurrentBytes, 0);
    assert.equal(report.exact?.resource.cleanupOutcome === 'completed' || report.exact?.resource.cleanupOutcome === 'not_needed', true);
  });

  it('phase durations are populated for every phase this pipeline actually runs', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    const phases = report.exact?.resource.phaseDurationsMs;
    assert.notEqual(phases?.empresas_read, null);
    assert.notEqual(phases?.estabelecimentos_read, null);
    assert.notEqual(phases?.cleanup, null);
    assert.notEqual(phases?.sanitization, null);
  });

  it('the sanitizer runs and passes on a clean completed run', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    assert.equal(report.sanitizerPassed, true);
  });

  it('the sanitizer still runs on an aborted run (a forced resource-cap breach)', async () => {
    const tinyCaps = { ...brazilReceitaProposedFullScanResourceCaps(), maxRowsRead: 1 };
    const report = await runStructural(uniformPlan(), { resourceCapsOverride: tinyCaps });
    assert.equal(report.ok, true);
    assert.equal(report.exitStatus, 'aborted');
    assert.notEqual(report.sanitizerPassed, null);
  });

  it('cleanup reports a verified outcome on the success path', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    assert.equal(report.exact?.resource.cleanupOutcome !== null, true);
  });

  it('the null benchmark sink materializes zero output rows', async () => {
    const report = await runStructural(uniformPlan());
    assert.equal(report.ok, true);
    assert.equal(report.exact?.resource.outputRowsMaterialized, 0);
  });

  it('reports the exact match count for a uniform 1:1 scenario, matching the oracle', async () => {
    const report = await runStructural(uniformPlan({ matchedCompanyCount: 20, establishmentsPerMatchedCompany: 1 }));
    assert.equal(report.ok, true);
    assert.equal(report.matchCountMatchesOracle, true);
    assert.equal(report.actualMatches, 20);
  });

  it('reports the exact match count for a multi-establishment scenario', async () => {
    const report = await runStructural(uniformPlan({ matchedCompanyCount: 8, establishmentsPerMatchedCompany: 4 }));
    assert.equal(report.ok, true);
    assert.equal(report.matchCountMatchesOracle, true);
    assert.equal(report.actualMatches, 32);
  });

  it('reports the exact match count under a skewed single-partition distribution', async () => {
    const partitionCount = brazilReceita14B0IPartitioningCaps().partitionCount;
    const report = await runStructural(
      uniformPlan({
        matchedCompanyCount: 15,
        distribution: 'skewed_single_partition',
        skewPartitionCount: partitionCount,
      }),
    );
    assert.equal(report.ok, true);
    assert.equal(report.matchCountMatchesOracle, true);
  });

  it('reports the exact match count under a uniform distribution at a larger scale', async () => {
    const report = await runStructural(uniformPlan({ matchedCompanyCount: 300, establishmentsPerMatchedCompany: 1 }));
    assert.equal(report.ok, true);
    assert.equal(report.matchCountMatchesOracle, true);
    assert.equal(report.actualMatches, 300);
  });

  it('never authorizes a real benchmark: the source authorization constant stays false', () => {
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
  });

  it('the harness engine request always declares realDataRun: false, never true', () => {
    const harnessSource = fs.readFileSync(
      path.join(__dirname, '..', 'br-receita-cnpj-14b0i-synthetic-throughput-harness.ts'),
      'utf8',
    );
    assert.ok(harnessSource.includes('realDataRun: false'));
    assert.equal(harnessSource.includes('realDataRun: true'), false);
  });

  it('touches no real data path, no manifest, no runtime, no Agent 1, no provider, no Supabase, no HubSpot', () => {
    const files = [
      'br-receita-cnpj-14b0i-synthetic-source-generator.ts',
      'br-receita-cnpj-14b0i-metering-reader-fs.ts',
      'br-receita-cnpj-14b0i-synthetic-throughput-harness.ts',
    ];
    const forbidden = ['supabase', 'agent1', 'agent 1', 'hubspot', 'lusha', 'apollo', 'tavily', 'slack', 'child_process'];
    for (const file of files) {
      const source = fs
        .readFileSync(path.join(__dirname, '..', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
        .toLowerCase();
      for (const token of forbidden) {
        assert.equal(source.includes(token), false, `forbidden token "${token}" found in ${file}`);
      }
    }
  });

  it('is deterministic at the structural scale: identical plans yield identical counters', async () => {
    const plan = uniformPlan({ matchedCompanyCount: 25 });
    const first = await runStructural(plan);
    const second = await runStructural(plan);
    assert.equal(first.actualMatches, second.actualMatches);
    assert.equal(first.synthetic.syntheticSourceBytesTotal, second.synthetic.syntheticSourceBytesTotal);
    assert.equal(first.synthetic.syntheticRowsTotal, second.synthetic.syntheticRowsTotal);
  });
});

// ─── 36–40: classification & recommendation ───────────────────────────────────

describe('BR-SOURCE-14B.0I — source-read classification and recommendation', () => {
  it('classifies >= 10 MiB/s as A1', () => {
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(BRAZIL_RECEITA_14B0I_HEALTHY_MARGIN_TARGET_MIB_S), 'A1');
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(50), 'A1');
  });

  it('classifies [5, 10) MiB/s as A2', () => {
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(BRAZIL_RECEITA_14B0I_MINIMUM_ENGINEERING_SOURCE_READ_TARGET_MIB_S), 'A2');
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(9.99), 'A2');
  });

  it('classifies [3.2, 5) MiB/s as B', () => {
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(BRAZIL_RECEITA_14B0I_BORDERLINE_FLOOR_MIB_S), 'B');
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(4.99), 'B');
  });

  it('classifies < 3.2 MiB/s, and a null (no successful run), as C', () => {
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(3.19), 'C');
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(0), 'C');
    assert.equal(classifyBrazilReceita14B0ISourceReadThroughput(null), 'C');
  });

  it('recommends YES for A1/A2, DEFER for B, NO for C — advisory only', () => {
    assert.equal(recommendBrazilReceita14B0ISecondRealBenchmark('A1'), 'YES');
    assert.equal(recommendBrazilReceita14B0ISecondRealBenchmark('A2'), 'YES');
    assert.equal(recommendBrazilReceita14B0ISecondRealBenchmark('B'), 'DEFER');
    assert.equal(recommendBrazilReceita14B0ISecondRealBenchmark('C'), 'NO');
    // Advisory only: computing a recommendation never touches the source authorization constant.
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
  });
});
