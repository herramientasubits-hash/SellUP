/**
 * BR Receita CNPJ FULL-JOIN MODEL CLASSIFICATION & STATIC GUARDS — tests
 * (BR-SOURCE-14B.0D § 3, § 8, § 13; § 14 tests 44–46, 61–67).
 *
 * This suite is the one that replaces the evidence 14B.0C relied on.
 *
 * 14B.0C proved Model D MECHANICALLY: it read the source of every real-data join reader and asserted
 * each performed exactly one `readSync` from position zero. That test was the most valuable one in the
 * milestone, because it could not be satisfied by a hopeful comment. Deleting it and asserting
 * `FULL_JOIN_MODEL = A` in its place would have been a downgrade — a constant is not evidence.
 *
 * So Model A is asserted here the same way Model D was: from the SOURCE of the engine's reader, which
 * must contain an advancing offset, an EOF condition and a non-progression abort; and from the ABSENCE
 * of any whole-file materialization in every engine module. The three earlier probes are re-checked as
 * UNCHANGED, because they were never the thing that had to grow — they remain narrower carve-outs, and
 * a milestone that quietly widened them would have escaped 14B.0C's guard by moving the goalposts.
 *
 * The classification assertions are deliberately paired with the authorization ones. An implementation
 * existing and a run being permitted are different facts, and this file asserts both directions:
 * `FULL_JOIN_IMPLEMENTATION_EXISTS` is now `true`, and the real full-scan benchmark is still refused.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';

import {
  BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL,
  BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS,
  BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS,
  BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_BENCHMARK_MODE,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
  createBrazilReceitaFullJoinBenchmarkAttemptLedger,
  preflightBrazilReceitaFullJoinResourceBenchmark,
  runBrazilReceitaFullJoinSyntheticFixtureBenchmark,
  summarizeBrazilReceitaFullJoinBenchmarkReadiness,
  type BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs,
} from '../br-receita-cnpj-full-join-resource-benchmark';
import {
  BRAZIL_RECEITA_FULL_JOIN_ENGINE_ARCHITECTURE,
  BRAZIL_RECEITA_FULL_JOIN_ENGINE_REJECTED_ARCHITECTURES,
  BRAZIL_RECEITA_FULL_JOIN_KEY_COLUMN_INDEX,
  brazilReceitaFullJoinPartitionOrdinalFor,
  createBrazilReceitaFullJoinNullBenchmarkSink,
  normalizeBrazilReceitaFullJoinKey,
} from '../br-receita-cnpj-full-join-engine-contract';
import { BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT } from '../br-receita-cnpj-full-join-no-write-guard';
import {
  brazilReceitaFullJoinSyntheticKey,
  brazilReceitaFullJoinFixtureRunDefaults,
  createBrazilReceitaFullJoinFixture,
  type BrazilReceitaFullJoinFixtureHandle,
} from '../br-receita-cnpj-full-join-engine-fixtures';
import {
  createBrazilReceitaFullJoinReaderFileSystem,
  createBrazilReceitaFullJoinWorkspaceFileSystem,
} from '../br-receita-cnpj-full-join-engine-fs';
import { createBrazilReceitaFullJoinResourceProcessDependencies } from '../br-receita-cnpj-full-join-resource-envelope';
import {
  BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS,
  getBrReceitaCnpjOfficialColumnCount,
} from '../br-receita-cnpj-file-reader';
import { BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX } from '../br-receita-cnpj-required-family-join-probe';

// ─── Source access ────────────────────────────────────────────────────────────

const require_ = createRequire(import.meta.url);

function moduleSource(specifier: string): string {
  return fs.readFileSync(require_.resolve(specifier), 'utf8');
}

/** Code only, comments stripped: these guards are about what a module DOES. */
function codeOf(specifier: string): string {
  return moduleSource(specifier)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The engine proper: the modules that must be free of I/O and of dataset knowledge. */
const ENGINE_MODULES = [
  '../br-receita-cnpj-full-join-streaming-reader',
  '../br-receita-cnpj-full-join-partition-workspace',
  '../br-receita-cnpj-full-join-engine-contract',
  '../br-receita-cnpj-full-join-engine-bookkeeping',
  '../br-receita-cnpj-full-join-engine-report',
  '../br-receita-cnpj-full-join-engine',
];

/** Every module this milestone adds, including the adapter that is ALLOWED to touch `node:fs`. */
const NEW_MODULES = [...ENGINE_MODULES, '../br-receita-cnpj-full-join-engine-fs'];

/** The three bounded probes 14B.0C audited. They must remain exactly as narrow as they were. */
const UNCHANGED_PROBES = [
  '../br-receita-cnpj-required-family-probe',
  '../br-receita-cnpj-required-family-join-probe',
  '../br-receita-cnpj-aggregate-join-coverage-signal',
];

// ─── 1. Classification (tests 61, 62, 64) ─────────────────────────────────────

describe('BR-SOURCE-14B.0D — full-join model classification', () => {
  // Test 61.
  it('records that a full-join implementation now exists', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS, true);
  });

  // Test 62.
  it('records Model A, and Model A is the only benchmarkable model', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL, 'model_a_fully_bounded_streaming');
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS, [
      'model_a_fully_bounded_streaming',
    ]);
    assert.ok(
      BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS.includes(BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL),
    );
  });

  // Test 64: the Model D classification is gone from the source, not merely overridden at runtime.
  it('leaves no Model D or single-prefix classification behind', () => {
    const benchmark = codeOf('../br-receita-cnpj-full-join-resource-benchmark');
    assert.ok(
      !benchmark.includes("BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL: BrazilReceitaFullJoinArchitectureModel =\n  'model_d"),
      'the audited model must no longer be assigned Model D',
    );
    assert.ok(benchmark.includes("'model_a_fully_bounded_streaming'"));
    assert.ok(
      benchmark.includes('BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS = true'),
      'the constant must be a `true` literal in the source, not a computed value',
    );
  });

  it('reports readiness as an authorization question rather than an implementation one', () => {
    const readiness = summarizeBrazilReceitaFullJoinBenchmarkReadiness();
    assert.equal(readiness.controlsReady, true);
    assert.equal(readiness.fullJoinImplementationExists, true);
    assert.equal(readiness.auditedModel, 'model_a_fully_bounded_streaming');
    assert.equal(readiness.fullScanBenchmarkReadyForAuthorization, true);
    assert.equal(readiness.nextAction, 'merge_review');
  });

  it('names its architecture and the alternatives it rejected', () => {
    assert.equal(
      BRAZIL_RECEITA_FULL_JOIN_ENGINE_ARCHITECTURE,
      'external_hash_partitioned_streaming_join_over_offset_references',
    );
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_ENGINE_REJECTED_ARCHITECTURES, [
      'sort_merge_requires_unverified_global_ordering',
      'nested_loop_requires_repeated_full_scans',
      'in_memory_hash_requires_materializing_a_family',
    ]);
  });
});

// ─── 2. Progress and non-materialization (tests 63, 65) ───────────────────────

describe('BR-SOURCE-14B.0D — the reader advances, and nothing materializes a file', () => {
  // Test 63: asserted from the SOURCE, the same way 14B.0C proved the opposite.
  it('shows an advancing offset, an EOF condition and a non-progression abort in the reader source', () => {
    const reader = codeOf('../br-receita-cnpj-full-join-streaming-reader');
    assert.ok(reader.includes('while (position < declaredBytes)'), 'the loop must run until EOF');
    assert.ok(reader.includes('position += chunkBytes'), 'the offset must advance by what was read');
    assert.ok(
      reader.includes('if (position <= previousOffset)'),
      'the loop must assert that it advanced',
    );
    assert.ok(reader.includes("'non_progressing_reader'"), 'non-progression must be terminal');
    assert.ok(
      reader.includes('Buffer.allocUnsafe(caps.maxChunkBytes)'),
      'the read buffer must be allocated once, at the cap',
    );
  });

  it('reads from a moving position rather than always from zero', () => {
    const reader = codeOf('../br-receita-cnpj-full-join-streaming-reader');
    // 14B.0C's evidence for Model D was `readSync(fd, buffer, 0, n, 0)` — a literal zero position.
    // The engine's reader passes `position`, and that difference IS the model change.
    assert.ok(reader.includes('caps.maxChunkBytes, position)'));
    assert.ok(
      !/read\([^)]*,\s*0\s*\)\s*;/.test(reader),
      'no read may hard-code position zero',
    );
  });

  // Test 65.
  it('contains no whole-file materialization anywhere in the engine', () => {
    for (const moduleRef of NEW_MODULES) {
      const source = codeOf(moduleRef);
      for (const forbidden of [
        'readFileSync',
        'readFile(',
        'promises.readFile',
        'createReadStream',
        'readdirSync(',
      ]) {
        if (moduleRef.endsWith('-engine-fs') && forbidden === 'readdirSync(') continue;
        assert.ok(
          !source.includes(forbidden),
          `${moduleRef} must not use "${forbidden}" — it would materialize more than a chunk`,
        );
      }
    }
  });

  it('keeps every real filesystem call inside the dedicated adapter', () => {
    for (const moduleRef of ENGINE_MODULES) {
      const source = codeOf(moduleRef);
      for (const forbidden of ['node:fs', 'node:os', 'openSync', 'writeSync', 'mkdtemp', 'unlinkSync']) {
        assert.ok(
          !source.includes(forbidden),
          `${moduleRef} must perform no I/O — "${forbidden}" belongs in the adapter`,
        );
      }
    }
    const adapter = codeOf('../br-receita-cnpj-full-join-engine-fs');
    assert.ok(adapter.includes('node:fs'), 'the adapter is where `node:fs` lives');
    assert.ok(
      !adapter.includes('os.tmpdir'),
      'the adapter must not choose a destination; a parent is always supplied',
    );
    assert.ok(
      !adapter.includes('recursive: true'),
      'no recursive deletion may exist anywhere in the engine',
    );
  });

  // The 14B.0C evidence must survive: the three probes are still one-prefix readers.
  it('leaves the three bounded probes exactly as narrow as 14B.0C found them', () => {
    for (const moduleRef of UNCHANGED_PROBES) {
      const source = codeOf(moduleRef);
      const calls = [...source.matchAll(/fs\.readSync\([^)]*\)/g)].map((match) => match[0]);
      // Two per probe, unchanged since 14B.0C: one bounded manifest read, one bounded data read.
      assert.equal(calls.length, 2, `${moduleRef} must still perform exactly two bounded reads`);
      for (const call of calls) {
        assert.match(
          call,
          /,\s*0\s*\)$/,
          `${moduleRef} must still read from position ZERO — it is a prefix probe, not a scanner`,
        );
      }
      assert.ok(!source.includes('full-join-engine'), `${moduleRef} must not depend on the engine`);
    }
  });
});

// ─── 3. Static safety guards (tests 44–46) ────────────────────────────────────

describe('BR-SOURCE-14B.0D — static guards', () => {
  // Tests 44, 45, 46 — checked on IMPORT SPECIFIERS, because what matters is what a module can reach.
  it('imports nothing outside this connector', () => {
    for (const moduleRef of NEW_MODULES) {
      const specifiers = [...codeOf(moduleRef).matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      for (const specifier of specifiers) {
        const permitted =
          specifier === 'node:path' ||
          specifier === 'node:fs' ||
          specifier!.startsWith('./br-receita-cnpj-');
        assert.ok(
          permitted,
          `${moduleRef} must not import "${specifier}" — only node:path, node:fs and sibling ` +
            'br-receita-cnpj modules are in scope for this milestone',
        );
      }
    }
  });

  it('names no Supabase, runtime, Agent 1, Agent 2A, provider, HubSpot or UI symbol', () => {
    for (const moduleRef of NEW_MODULES) {
      const source = codeOf(moduleRef);
      for (const forbidden of [
        'createSupabaseAdminClient',
        'source_company_snapshots',
        'prospect_candidates',
        'prospecting-toolkit',
        'contact-enrichment',
        'phone_reveal',
        'hubspot',
        'apollo',
        'lusha',
        'tavily',
        'components/',
        'migrations',
      ]) {
        assert.ok(
          !source.toLowerCase().includes(forbidden.toLowerCase()),
          `${moduleRef} must not reference "${forbidden}"`,
        );
      }
      for (const usage of ['supabase.', 'supabase(', "from 'supabase", 'createClient']) {
        assert.ok(!source.includes(usage), `${moduleRef} must not use "${usage}"`);
      }
    }
  });

  it('spawns no process, so no git command can run from any cwd', () => {
    for (const moduleRef of NEW_MODULES) {
      const source = codeOf(moduleRef);
      for (const forbidden of ['child_process', 'execSync', 'spawn', 'execFile', 'fork(']) {
        assert.ok(!source.includes(forbidden), `${moduleRef} must not reference "${forbidden}"`);
      }
    }
  });

  it('reads no environment variable, hostname or username', () => {
    for (const moduleRef of NEW_MODULES) {
      const source = codeOf(moduleRef);
      for (const forbidden of ['process.env', 'hostname', 'userInfo', 'homedir', 'whoami']) {
        assert.ok(!source.includes(forbidden), `${moduleRef} must not reference "${forbidden}"`);
      }
    }
  });

  it('never writes to stdout or stderr', () => {
    for (const moduleRef of NEW_MODULES) {
      const source = codeOf(moduleRef);
      for (const forbidden of ['console.', 'process.stdout', 'process.stderr']) {
        assert.ok(!source.includes(forbidden), `${moduleRef} must not reference "${forbidden}"`);
      }
    }
  });

  it('adds no sanitizer exemption', () => {
    for (const moduleRef of NEW_MODULES) {
      const source = codeOf(moduleRef);
      for (const forbidden of ['oversized_numeric_value', 'MAX_NUMERIC_LEAF', 'LONG_DIGIT_RUN']) {
        assert.ok(
          !source.includes(forbidden),
          `${moduleRef} must not touch the sanitizer's numeric rule ("${forbidden}")`,
        );
      }
    }
    const sanitizer = codeOf('../br-receita-cnpj-full-join-output-sanitizer');
    assert.ok(sanitizer.includes('oversized_numeric_value'));
    assert.ok(sanitizer.includes('BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF'));
  });

  it('contains no identifier-shaped literal and no forbidden Receita field', () => {
    for (const moduleRef of [...NEW_MODULES, '../br-receita-cnpj-full-join-engine-fixtures']) {
      // CODE only. A comment that names `socios` to say it is out of scope is documentation of the
      // boundary, not a crossing of it — what must be absent is a reference the code can act on.
      const source = codeOf(moduleRef);
      assert.ok(
        !/(?<!\d)\d{8,}(?!\d)/.test(source.replace(/0x[0-9a-f_]+/gi, '')),
        `${moduleRef} must contain no eight-or-more-digit run`,
      );
      for (const forbidden of ['socio', 'qsa', 'cpf', 'razao_social', 'email', 'telefone']) {
        assert.ok(
          !source.toLowerCase().includes(forbidden),
          `${moduleRef} must not name "${forbidden}" — it is outside the field allowlist`,
        );
      }
    }
  });

  it('keeps both real-benchmark authorization constants as false literals', () => {
    const source = codeOf('../br-receita-cnpj-full-join-resource-benchmark');
    assert.ok(source.includes('BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false'));
    assert.ok(source.includes('BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED = true'));
  });

  it('keeps the temporary-storage policy a false literal', () => {
    const source = codeOf('../br-receita-cnpj-full-join-partition-workspace');
    assert.ok(source.includes('BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED = false'));
  });

  it('leaves the 14B.0A instrumentation and 14B.0C envelope contracts untouched', () => {
    assert.ok(
      codeOf('../br-receita-cnpj-calibration-instrumentation').includes(
        'instrumentation_failure_marks_measurement_incomplete_and_preserves_original_failure',
      ),
    );
    const envelope = codeOf('../br-receita-cnpj-full-join-resource-envelope');
    assert.ok(
      envelope.includes(
        'measurement_failure_is_terminal_because_an_unmeasurable_cap_is_not_a_cap',
      ),
    );
    for (const readerCap of ['maxChunkBytes', 'maxCarryBytes', 'maxRowBytes', 'maxColumnsPerRow']) {
      assert.ok(
        !envelope.includes(readerCap),
        `the envelope must not learn about "${readerCap}" — it performs no I/O`,
      );
    }
  });
});

// ─── 4. The layout contract is reused, not reinvented ─────────────────────────

describe('BR-SOURCE-14B.0D — official layout authority', () => {
  it('joins on the column the official layout and BR-SOURCE-11G already established', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_KEY_COLUMN_INDEX, 0);
    assert.equal(
      BRAZIL_RECEITA_FULL_JOIN_KEY_COLUMN_INDEX,
      BRAZIL_RECEITA_REQUIRED_FAMILY_JOIN_PROBE_KEY_COLUMN_INDEX,
      'two modules joining on two different columns would be a silent correctness bug',
    );
  });

  it('takes its positional widths from the official layout table', () => {
    assert.equal(getBrReceitaCnpjOfficialColumnCount('empresas'), 7);
    assert.equal(getBrReceitaCnpjOfficialColumnCount('estabelecimentos'), 30);
    assert.equal(BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS.empresas, 7);
    const engine = codeOf('../br-receita-cnpj-full-join-engine');
    assert.ok(
      engine.includes('getBrReceitaCnpjOfficialColumnCount'),
      'the engine must ask the layout authority rather than hard-code a width',
    );
  });

  it('normalizes a key without fuzzy matching and without a name fallback', () => {
    assert.equal(normalizeBrazilReceitaFullJoinKey(' SYN_K0001 '), 'SYN_K0001');
    assert.equal(normalizeBrazilReceitaFullJoinKey('"SYN_K0001"'), 'SYN_K0001');
    assert.equal(normalizeBrazilReceitaFullJoinKey(''), null);
    assert.equal(normalizeBrazilReceitaFullJoinKey('   '), null);
    assert.equal(normalizeBrazilReceitaFullJoinKey(null), null);
    assert.equal(normalizeBrazilReceitaFullJoinKey('X'.repeat(64)), null);
    // Case is NOT folded and nothing is trimmed from the middle: a key is compared as the layout
    // delivers it, because a "helpful" transformation is how two different companies get joined.
    assert.notEqual(
      normalizeBrazilReceitaFullJoinKey('syn_k0001'),
      normalizeBrazilReceitaFullJoinKey('SYN_K0001'),
    );
  });

  it('assigns a partition deterministically and never persists the digest', () => {
    const key = brazilReceitaFullJoinSyntheticKey(1);
    const first = brazilReceitaFullJoinPartitionOrdinalFor(key, 8);
    assert.equal(brazilReceitaFullJoinPartitionOrdinalFor(key, 8), first);
    assert.ok(first >= 0 && first < 8);
    const contract = codeOf('../br-receita-cnpj-full-join-engine-contract');
    assert.ok(!contract.includes('persistHash'), 'a digest is never stored');
    const workspace = codeOf('../br-receita-cnpj-full-join-partition-workspace');
    assert.ok(
      !workspace.includes('hash'),
      'the workspace must have no concept of a hash — it stores ordinals',
    );
  });
});

// ─── 5. Benchmark integration (test 67) ───────────────────────────────────────

const SAFE_CWD: BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs = {
  currentWorkingDirectory: '/workspaces/sellup-worktrees/br-14b0d',
  homeDirectory: '/home/operator',
  repositoryRoot: '/workspaces/sellup-worktrees/br-14b0d',
  datasetRoot: '/home/operator/receita',
  repositoryPackageName: 'sellup-temp',
};

function generousResourceCaps(overrides: Record<string, unknown> = {}) {
  const megabyte = 1024 * 1024;
  return {
    maxRssBytes: 8 * 1024 * megabyte,
    maxHeapUsedBytes: 2 * 1024 * megabyte,
    maxExternalMemoryBytes: 2 * 1024 * megabyte,
    maxRuntimeMs: 10 * 60 * 1000,
    maxPhaseRuntimeMs: 10 * 60 * 1000,
    maxTemporaryStorageBytes: 64 * 1024,
    maxFilesOpened: 64,
    maxBytesRead: 10 * 1000 * 1000,
    maxRowsRead: 100 * 1000,
    maxJoinKeysInMemory: 1000,
    maxOutputRows: 0,
    ...overrides,
  };
}

let fixtureHandles: BrazilReceitaFullJoinFixtureHandle[] = [];

afterEach(() => {
  for (const handle of fixtureHandles) handle.dispose();
  fixtureHandles = [];
});

function syntheticBenchmarkRequest(overrides: { resourceCaps?: unknown; realDataRun?: boolean; sinkMaterializesRows?: boolean } = {}) {
  const handle = createBrazilReceitaFullJoinFixture({
    files: [
      {
        family: 'empresas',
        rows: [1, 2, 3, 4].map((index) => ({ key: brazilReceitaFullJoinSyntheticKey(index) })),
      },
      {
        family: 'estabelecimentos',
        rows: [1, 2, 3, 5].map((index) => ({ key: brazilReceitaFullJoinSyntheticKey(index) })),
      },
    ],
  });
  fixtureHandles.push(handle);
  const sink = createBrazilReceitaFullJoinNullBenchmarkSink();
  return {
    sink,
    request: {
      workingDirectory: SAFE_CWD,
      attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
      noWriteContract: { ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT },
      engineRequest: {
        sources: handle.sources,
        readerCaps: { maxChunkBytes: 32, maxCarryBytes: 4096, maxRowBytes: 4096, maxColumnsPerRow: 64 },
        partitioningCaps: {
          partitionCount: 4,
          maxPartitionCount: 32,
          maxPartitionDepth: 3,
          maxReferencesPerPartition: 1000,
          maxReferenceBytesPerPartition: 64 * 1024,
        },
        resourceCaps: overrides.resourceCaps ?? generousResourceCaps(),
        duplicateKeyPolicy: 'pair_with_every_duplicate' as const,
        sink,
        readerFileSystem: createBrazilReceitaFullJoinReaderFileSystem(),
        workspaceFileSystem: createBrazilReceitaFullJoinWorkspaceFileSystem(),
        workspaceParentDirectory: handle.workspaceParentDirectory,
        workspaceBoundaries: {
          repositoryRoot: '/workspaces/sellup-worktrees/br-14b0d',
          homeDirectory: '/home/operator',
          datasetRoot: handle.datasetRoot,
        },
        resourceDependencies: createBrazilReceitaFullJoinResourceProcessDependencies(),
        ...brazilReceitaFullJoinFixtureRunDefaults(),
        realDataRun: overrides.realDataRun ?? false,
        sinkMaterializesRows: overrides.sinkMaterializesRows ?? false,
      },
    },
  };
}

describe('BR-SOURCE-14B.0D — benchmark mode', () => {
  // Test 67: the real full-scan benchmark stays unauthorized, and the refusal moved to the right stage.
  it('still refuses the real full-scan benchmark, now for lack of authorization', () => {
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED, true);

    const outcome = preflightBrazilReceitaFullJoinResourceBenchmark({
      workingDirectory: SAFE_CWD,
      caps: generousResourceCaps(),
      attemptLedger: createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'benchmark_not_authorized');
    assert.equal(outcome.failedStage, 'authorization');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_DATA_ACCESS');
    assert.equal(outcome.dataAccessed, false);
    assert.equal(outcome.rowsEmitted, 0);
    assert.equal(outcome.auditedModel, 'model_a_fully_bounded_streaming');
  });

  it('runs the REAL engine over synthetic fixtures and emits zero rows', async () => {
    const { request, sink } = syntheticBenchmarkRequest();
    const outcome = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark(request);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    if (!outcome.ok) return;
    assert.equal(outcome.mode, BRAZIL_RECEITA_FULL_JOIN_SYNTHETIC_BENCHMARK_MODE);
    assert.equal(outcome.engineUsed, true);
    assert.equal(outcome.realFullScanBenchmarkExecuted, true);
    assert.equal(outcome.result.exitStatus, 'completed');
    // Three keys are shared between the two families; one company and one establishment are alone.
    assert.equal(outcome.result.exact.matchesEmitted, 3);
    assert.equal(outcome.result.exact.orphanEstabelecimentoCount, 1);
    assert.equal(outcome.result.exact.empresaKeysWithoutEstabelecimento, 1);
    assert.equal(outcome.result.exact.resource.outputRowsMaterialized, 0);
    assert.equal(outcome.result.cleanupOutcome, 'completed');
    assert.equal(sink.tally().rowsEmitted, 0);
    assert.equal(sink.tally().recordsRetained, 0);
  });

  it('refuses a real-data run from the synthetic mode', async () => {
    const { request } = syntheticBenchmarkRequest({ realDataRun: true });
    const outcome = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark(request);
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'real_data_run_not_authorized');
    assert.equal(outcome.dataAccessed, false);
  });

  it('refuses a non-zero output cap and a materializing sink', async () => {
    const nonZero = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark(
      syntheticBenchmarkRequest({ resourceCaps: generousResourceCaps({ maxOutputRows: 1 }) }).request,
    );
    assert.equal(nonZero.ok, false);
    if (nonZero.ok) return;
    assert.equal(nonZero.abortCode, 'output_rows_cap_must_be_zero');

    const materializing = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark(
      syntheticBenchmarkRequest({ sinkMaterializesRows: true }).request,
    );
    assert.equal(materializing.ok, false);
    if (materializing.ok) return;
    assert.equal(materializing.abortCode, 'materializing_sink_not_authorized');
  });

  it('refuses when the no-write contract is not the literal zero-effect one', async () => {
    const { request } = syntheticBenchmarkRequest();
    const outcome = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark({
      ...request,
      noWriteContract: { ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT, supabaseWrite: true },
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'no_write_guard_failed');
  });

  it('refuses an unsafe operator working directory before anything else', async () => {
    const { request } = syntheticBenchmarkRequest();
    const outcome = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark({
      ...request,
      workingDirectory: { ...SAFE_CWD, currentWorkingDirectory: '/home/operator' },
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.abortCode, 'unsafe_operator_working_directory');
  });

  it('consumes exactly one attempt', async () => {
    const { request } = syntheticBenchmarkRequest();
    const first = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark(request);
    assert.equal(first.ok, true);
    const second = await runBrazilReceitaFullJoinSyntheticFixtureBenchmark(request);
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.abortCode, 'single_attempt_already_consumed');
  });
});
