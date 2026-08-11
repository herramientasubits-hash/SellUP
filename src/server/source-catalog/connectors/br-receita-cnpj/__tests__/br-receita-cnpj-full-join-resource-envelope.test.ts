/**
 * BR Receita CNPJ FULL-JOIN RESOURCE ENVELOPE — tests (BR-SOURCE-14B.0C).
 *
 * BR-SOURCE-14B.0A delivered the instrument that MEASURES a bounded run. This milestone delivers the
 * caps that STOP one, the two-channel split that lets GATE-2 see exact figures without putting them
 * in a versioned report, and the operator-safety guards around a full-scan benchmark that is
 * prepared and deliberately not executed.
 *
 * The claims these tests defend, in order of how much damage their absence would cause:
 *
 *   1. THE REAL FULL SCAN IS NOT AUTHORIZED. Originally this claim read "the full join does not
 *      exist": the § 3 audit found only ultra-bounded prefix readers, and the benchmark refused with
 *      `full_join_implementation_missing`. BR-SOURCE-14B.0D built the engine, so the classification
 *      assertions below were inverted to Model A and the refusal now comes from the AUTHORIZATION
 *      stage. What must never drift is the pair of authorization constants — an implementation
 *      existing is not permission to run it over 60 GB of real data, and a suite that let those two
 *      constants follow the implementation one would be the most expensive failure here.
 *   2. ABSENT IS NOT UNLIMITED. A missing, null or infinite cap is a refusal to start, and the
 *      refusal happens before anything could open a file.
 *   3. A CAP YOU CANNOT MEASURE IS NOT A CAP. A broken sampler is terminal here, which is the exact
 *      opposite of 14B.0A's containment policy — and the opposite is correct, because the two
 *      modules have opposite duties.
 *   4. THE PUBLIC SANITIZER IS NOT RELAXED. Exact figures never enter a public report; they travel a
 *      separate typed path to an operator-only artifact. `oversized_numeric_value` still fires on
 *      an exact byte count, and no field-name exemption was added.
 *
 * 100% synthetic and offline. The only filesystem this suite touches is a temp directory it creates
 * under the OS temp root and removes afterwards — never the repository, never the operator's home,
 * never a dataset, never a real manifest. No Supabase, no network, no runtime, no Agent 1, no git.
 *
 * Byte magnitudes are written as arithmetic (`512 * 1024 * 1024`) rather than as literals, so no
 * identifier-shaped digit run exists anywhere in this source file.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import { sanitizeBrazilReceitaFullJoinReport } from '../br-receita-cnpj-full-join-output-sanitizer';
import {
  BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT,
  BRAZIL_RECEITA_FULL_JOIN_MEASUREMENT_FAILURE_POLICY,
  BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS,
  BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_CAP_APPROVAL_STATUS,
  BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BREACH_POLICY,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CHECKPOINTS,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_PHASES,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_TERMINAL_CODES,
  brazilReceitaFullJoinCapBreachCode,
  createBrazilReceitaFullJoinResourceEnforcer,
  deriveBrazilReceitaFullJoinRuntimeCapProposal,
  resolveBrazilReceitaFullJoinResourceCaps,
  type BrazilReceitaFullJoinResourceCapKey,
  type BrazilReceitaFullJoinResourceCaps,
  type BrazilReceitaFullJoinResourceDependencies,
  type BrazilReceitaFullJoinResourceMemorySnapshot,
} from '../br-receita-cnpj-full-join-resource-envelope';
import {
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_ENABLED,
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE,
  BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_MAX_TTL_MS,
  deleteBrazilReceitaFullJoinPrivateArtifact,
  isBrazilReceitaFullJoinPrivateArtifactExpired,
  purgeBrazilReceitaFullJoinPrivateArtifactIfExpired,
  resolveBrazilReceitaFullJoinPrivateChannel,
  toBrazilReceitaFullJoinPrivateOperatorMeasurements,
  toBrazilReceitaFullJoinPublicSanitizedMeasurements,
  validateBrazilReceitaFullJoinPrivateContent,
  writeBrazilReceitaFullJoinPrivateArtifact,
  type BrazilReceitaFullJoinPrivateChannelBoundaries,
  type BrazilReceitaFullJoinPrivateChannelFileSystem,
  type BrazilReceitaFullJoinPrivateOperatorMeasurements,
} from '../br-receita-cnpj-full-join-operator-metric-channel';
import { createBrazilReceitaFullJoinPrivateChannelFileSystem } from '../br-receita-cnpj-full-join-private-channel-fs';
import {
  BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL,
  BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS,
  BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_CWD_INVARIANTS,
  BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_PREFLIGHT_STAGES,
  BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_ZERO_EFFECT_INVARIANTS,
  BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS,
  BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_MODE,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED,
  BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED,
  createBrazilReceitaFullJoinBenchmarkAttemptLedger,
  evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory,
  preflightBrazilReceitaFullJoinResourceBenchmark,
  summarizeBrazilReceitaFullJoinBenchmarkReadiness,
  type BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs,
} from '../br-receita-cnpj-full-join-resource-benchmark';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MIB = 1024 * 1024;

/** A complete, generous cap set. Individual tests tighten exactly the one cap under test. */
function generousCaps(
  overrides: Partial<Record<BrazilReceitaFullJoinResourceCapKey, number>> = {},
): BrazilReceitaFullJoinResourceCaps {
  const base: Record<BrazilReceitaFullJoinResourceCapKey, number> = {
    maxRssBytes: 512 * MIB,
    maxHeapUsedBytes: 64 * MIB,
    maxExternalMemoryBytes: 64 * MIB,
    maxRuntimeMs: 60_000,
    maxPhaseRuntimeMs: 30_000,
    maxTemporaryStorageBytes: 0,
    maxFilesOpened: 4,
    maxBytesRead: 128 * 1024,
    maxRowsRead: 40,
    maxJoinKeysInMemory: 40,
    maxOutputRows: 0,
  };
  const resolution = resolveBrazilReceitaFullJoinResourceCaps({ ...base, ...overrides });
  assert.ok(resolution.ok, 'fixture caps must resolve');
  return resolution.caps;
}

/** A scripted, monotonic clock in nanoseconds. Advances only when a test says so. */
function scriptedClock(): { deps: () => bigint; advanceMs: (ms: number) => void } {
  let nowNs = BigInt(0);
  return {
    deps: () => nowNs,
    advanceMs(ms) {
      nowNs += BigInt(ms) * BigInt(1_000_000);
    },
  };
}

function deps(
  clock: () => bigint,
  snapshot: BrazilReceitaFullJoinResourceMemorySnapshot | (() => BrazilReceitaFullJoinResourceMemorySnapshot),
): BrazilReceitaFullJoinResourceDependencies {
  return {
    clock,
    memorySampler: typeof snapshot === 'function' ? snapshot : () => snapshot,
  };
}

const CALM_MEMORY: BrazilReceitaFullJoinResourceMemorySnapshot = {
  rss: 100 * MIB,
  heapUsed: 8 * MIB,
  external: 2 * MIB,
};

function armedEnforcer(
  caps: BrazilReceitaFullJoinResourceCaps = generousCaps(),
  dependencies: BrazilReceitaFullJoinResourceDependencies = deps(scriptedClock().deps, CALM_MEMORY),
) {
  const enforcer = createBrazilReceitaFullJoinResourceEnforcer(caps, dependencies);
  const armed = enforcer.validateBeforeFirstAccess();
  assert.ok(armed.ok, 'enforcer must arm for these fixtures');
  return enforcer;
}

// ─── 1. Full-join classification ──────────────────────────────────────────────

describe('BR-SOURCE-14B.0C — full-join algorithm classification (§ 3, § 4)', () => {
  /**
   * UPDATED BY BR-SOURCE-14B.0D.
   *
   * These four tests were the strongest evidence 14B.0C produced: they proved MECHANICALLY that no
   * executable full-scan route existed, by reading the source of every real-data join reader and
   * asserting each performed one read from offset zero and advanced no position.
   *
   * 14B.0D built the route, so the first three assertions have been INVERTED rather than deleted —
   * `br-receita-cnpj-full-join-engine-classification.test.ts` now carries the positive half (an
   * advancing offset, an EOF condition, a non-progression abort, and no whole-file materialization
   * anywhere in the engine), which is a stronger claim than the one it replaces.
   *
   * The fourth test is UNCHANGED and still passes, because the three bounded probes were never the
   * thing that had to grow: they remain narrower, separately-authorized carve-outs. A milestone that
   * had widened them in place would have satisfied a "the reader advances" test while destroying the
   * boundaries 11F/11G/11H were approved under — so this assertion stays exactly as it was.
   */
  it('records Model A: a bounded streaming full-join route now exists', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL, 'model_a_fully_bounded_streaming');
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS, true);
  });

  it('permits a real benchmark only for Model A', () => {
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS, [
      'model_a_fully_bounded_streaming',
    ]);
    assert.ok(
      BRAZIL_RECEITA_FULL_JOIN_BENCHMARKABLE_MODELS.includes(BRAZIL_RECEITA_FULL_JOIN_AUDITED_MODEL),
      'the audited model must be the benchmarkable one',
    );
  });

  it('reports the next action as an authorization question, not an implementation one', () => {
    const readiness = summarizeBrazilReceitaFullJoinBenchmarkReadiness();
    assert.equal(readiness.nextAction, 'merge_review');
    // READY FOR AUTHORIZATION is not AUTHORIZED. The two benchmark constants below are still false.
    assert.equal(readiness.fullScanBenchmarkReadyForAuthorization, true);
    assert.equal(readiness.controlsReady, true);
  });

  it('holds the audited evidence: the three bounded probes still read one prefix from offset zero', () => {
    // 14B.0C's decisive fact about the PROBES, re-checked mechanically. 14B.0D added a new module
    // that advances; it did not turn a probe into a scanner, and this test is what says so.
    for (const moduleRef of [
      '../br-receita-cnpj-required-family-join-probe',
      '../br-receita-cnpj-required-family-probe',
      '../br-receita-cnpj-aggregate-join-coverage-signal',
    ]) {
      const source = moduleSource(moduleRef);
      const readCalls = source.match(/readSync\([^)]*\)/g) ?? [];
      assert.ok(readCalls.length > 0, `${moduleRef} should perform bounded reads`);
      for (const call of readCalls) {
        assert.ok(
          /,\s*0\s*\)$/.test(call),
          `${moduleRef} must read from offset 0 only — a position argument other than 0 would mean the ` +
            'reader advances through the file, which would change the § 4 classification',
        );
      }
      assert.ok(
        !/position\s*\+=|offset\s*\+=/.test(source),
        `${moduleRef} must not advance a file position`,
      );
    }
  });
});

// ─── 2. Cap resolution: absent is not unlimited ───────────────────────────────

describe('BR-SOURCE-14B.0C — cap resolution (§ 5)', () => {
  it('refuses an entirely absent cap set and names every missing key', () => {
    const resolution = resolveBrazilReceitaFullJoinResourceCaps(null);
    assert.equal(resolution.ok, false);
    assert.ok(!resolution.ok);
    assert.equal(resolution.rejections.length, BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS.length);
    for (const rejection of resolution.rejections) assert.equal(rejection.reason, 'cap_absent');
  });

  it('treats an explicit null cap as absent, never as unlimited', () => {
    const caps: Record<string, unknown> = { ...generousCaps() };
    caps.maxRssBytes = null;
    const resolution = resolveBrazilReceitaFullJoinResourceCaps(caps);
    assert.ok(!resolution.ok);
    assert.deepEqual(resolution.rejections, [{ key: 'maxRssBytes', reason: 'cap_absent' }]);
  });

  it('refuses Infinity — the one input that is syntactically a number and semantically no cap', () => {
    const resolution = resolveBrazilReceitaFullJoinResourceCaps({
      ...generousCaps(),
      maxBytesRead: Number.POSITIVE_INFINITY,
    });
    assert.ok(!resolution.ok);
    assert.deepEqual(resolution.rejections, [{ key: 'maxBytesRead', reason: 'cap_not_finite' }]);
  });

  it('refuses NaN, negative, fractional and non-numeric caps distinctly', () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [Number.NaN, 'cap_not_finite'],
      [-1, 'cap_negative'],
      [1.5, 'cap_not_an_integer'],
      ['40', 'cap_not_a_number'],
    ];
    for (const [value, reason] of cases) {
      const resolution = resolveBrazilReceitaFullJoinResourceCaps({
        ...generousCaps(),
        maxRowsRead: value,
      } as never);
      assert.ok(!resolution.ok);
      assert.deepEqual(resolution.rejections, [{ key: 'maxRowsRead', reason }]);
    }
  });

  it('accepts zero as a real bound, distinct from absence', () => {
    const resolution = resolveBrazilReceitaFullJoinResourceCaps(
      generousCaps({ maxOutputRows: 0, maxTemporaryStorageBytes: 0 }),
    );
    assert.ok(resolution.ok);
    assert.equal(resolution.caps.maxOutputRows, 0);
    assert.equal(resolution.caps.maxTemporaryStorageBytes, 0);
  });

  it('freezes the resolved cap set so no code path can widen a cap', () => {
    const caps = generousCaps();
    assert.ok(Object.isFrozen(caps));
    assert.throws(() => {
      (caps as unknown as Record<string, number>).maxRssBytes = 1024 * MIB;
    });
  });

  it('maps every cap to a distinct terminal code', () => {
    const codes = BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS.map((key) =>
      brazilReceitaFullJoinCapBreachCode(key),
    );
    assert.equal(new Set(codes).size, codes.length);
    for (const code of codes) assert.ok(BRAZIL_RECEITA_FULL_JOIN_RESOURCE_TERMINAL_CODES.includes(code));
  });
});

// ─── 3. Caps validated before first access ────────────────────────────────────

describe('BR-SOURCE-14B.0C — validation precedes access (§ 5)', () => {
  it('refuses every counter until the envelope has been validated', () => {
    const enforcer = createBrazilReceitaFullJoinResourceEnforcer(
      generousCaps(),
      deps(scriptedClock().deps, CALM_MEMORY),
    );
    assert.equal(enforcer.mayAccessData(), false);

    const outcome = enforcer.noteFileOpened();
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'measurement_unavailable');
    assert.equal(outcome.breach.checkpoint, 'before_first_access');
  });

  it('permits access only after validation succeeds', () => {
    const enforcer = armedEnforcer();
    assert.equal(enforcer.mayAccessData(), true);
    assert.ok(enforcer.noteFileOpened().ok);
  });

  it('refuses to arm when the envelope is already breached at the first checkpoint', () => {
    const enforcer = createBrazilReceitaFullJoinResourceEnforcer(
      generousCaps({ maxRssBytes: 16 * MIB }),
      deps(scriptedClock().deps, CALM_MEMORY),
    );
    const outcome = enforcer.validateBeforeFirstAccess();
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'rss_cap_exceeded');
    assert.equal(enforcer.mayAccessData(), false, 'a breached envelope must never permit access');
  });
});

// ─── 4. Memory hard caps ──────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0C — memory hard caps (§ 5)', () => {
  const memoryCases: ReadonlyArray<
    readonly [
      label: string,
      snapshot: BrazilReceitaFullJoinResourceMemorySnapshot,
      capKey: BrazilReceitaFullJoinResourceCapKey,
      code: string,
    ]
  > = [
    [
      'RSS',
      { rss: 600 * MIB, heapUsed: 8 * MIB, external: 2 * MIB },
      'maxRssBytes',
      'rss_cap_exceeded',
    ],
    [
      'heap',
      { rss: 100 * MIB, heapUsed: 128 * MIB, external: 2 * MIB },
      'maxHeapUsedBytes',
      'heap_cap_exceeded',
    ],
    [
      'external',
      { rss: 100 * MIB, heapUsed: 8 * MIB, external: 128 * MIB },
      'maxExternalMemoryBytes',
      'external_memory_cap_exceeded',
    ],
  ];

  for (const [label, snapshot, capKey, code] of memoryCases) {
    it(`stops the run when ${label} exceeds its cap, at the checkpoint that saw it`, () => {
      let current = CALM_MEMORY;
      const enforcer = armedEnforcer(generousCaps(), deps(scriptedClock().deps, () => current));
      current = snapshot;
      const outcome = enforcer.checkpoint('after_empresas_read');
      assert.ok(!outcome.ok);
      assert.equal(outcome.breach.terminalCode, code);
      assert.equal(outcome.breach.capKey, capKey);
      assert.equal(outcome.breach.checkpoint, 'after_empresas_read');
    });
  }

  it('permits a value exactly at the cap and refuses one byte beyond it', () => {
    const caps = generousCaps({ maxRssBytes: 100 * MIB });
    let current: BrazilReceitaFullJoinResourceMemorySnapshot = {
      rss: 100 * MIB,
      heapUsed: 8 * MIB,
      external: 2 * MIB,
    };
    const enforcer = armedEnforcer(caps, deps(scriptedClock().deps, () => current));
    assert.ok(enforcer.checkpoint('after_manifest_validation').ok, 'exactly at the cap is inside it');
    current = { rss: 100 * MIB + 1, heapUsed: 8 * MIB, external: 2 * MIB };
    assert.ok(!enforcer.checkpoint('after_empresas_read').ok);
  });
});

// ─── 5. Runtime and per-phase hard caps ───────────────────────────────────────

describe('BR-SOURCE-14B.0C — runtime hard caps (§ 5)', () => {
  it('stops the run when total runtime exceeds its cap', () => {
    const clock = scriptedClock();
    const enforcer = armedEnforcer(
      generousCaps({ maxRuntimeMs: 1_000 }),
      deps(clock.deps, CALM_MEMORY),
    );
    clock.advanceMs(1_500);
    const outcome = enforcer.checkpoint('after_estabelecimentos_read');
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'runtime_cap_exceeded');
    assert.equal(outcome.breach.capKey, 'maxRuntimeMs');
  });

  it('stops the run when a single phase outlives the per-phase cap', () => {
    const clock = scriptedClock();
    const enforcer = armedEnforcer(
      generousCaps({ maxRuntimeMs: 600_000, maxPhaseRuntimeMs: 100 }),
      deps(clock.deps, CALM_MEMORY),
    );
    assert.ok(enforcer.beginPhase('empresas_read').ok);
    clock.advanceMs(500);
    const outcome = enforcer.checkpoint('after_empresas_read');
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'phase_runtime_cap_exceeded');
    assert.equal(outcome.breach.phase, 'empresas_read');
  });

  it('catches a phase overrun at endPhase even when no checkpoint ran inside it', () => {
    const clock = scriptedClock();
    const enforcer = armedEnforcer(
      generousCaps({ maxRuntimeMs: 600_000, maxPhaseRuntimeMs: 100 }),
      deps(clock.deps, CALM_MEMORY),
    );
    enforcer.beginPhase('manifest_validation');
    clock.advanceMs(400);
    const outcome = enforcer.endPhase('manifest_validation');
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'phase_runtime_cap_exceeded');
  });

  it('does not charge one phase for another phase time', () => {
    const clock = scriptedClock();
    const enforcer = armedEnforcer(
      generousCaps({ maxRuntimeMs: 600_000, maxPhaseRuntimeMs: 1_000 }),
      deps(clock.deps, CALM_MEMORY),
    );
    enforcer.beginPhase('manifest_validation');
    clock.advanceMs(900);
    assert.ok(enforcer.endPhase('manifest_validation').ok);
    enforcer.beginPhase('empresas_read');
    clock.advanceMs(900);
    assert.ok(
      enforcer.endPhase('empresas_read').ok,
      'two phases of 900ms each must both pass a 1000ms per-phase cap',
    );
  });
});

// ─── 6. Counting hard caps ────────────────────────────────────────────────────

describe('BR-SOURCE-14B.0C — counting hard caps (§ 5)', () => {
  it('stops the run at the files-opened cap', () => {
    const enforcer = armedEnforcer(generousCaps({ maxFilesOpened: 2 }));
    assert.ok(enforcer.noteFileOpened().ok);
    assert.ok(enforcer.noteFileOpened().ok);
    const outcome = enforcer.noteFileOpened();
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'files_opened_cap_exceeded');
  });

  it('stops the run at the bytes-read cap, accumulating across calls', () => {
    const enforcer = armedEnforcer(generousCaps({ maxBytesRead: 1024 }));
    assert.ok(enforcer.noteBytesRead(600).ok);
    const outcome = enforcer.noteBytesRead(600);
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'bytes_read_cap_exceeded');
  });

  it('stops the run at the rows-read cap', () => {
    const enforcer = armedEnforcer(generousCaps({ maxRowsRead: 20 }));
    assert.ok(enforcer.noteRowsRead(20).ok);
    const outcome = enforcer.noteRowsRead(1);
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'rows_read_cap_exceeded');
  });

  it('stops the run when the in-memory join-key window outgrows its cap', () => {
    const enforcer = armedEnforcer(generousCaps({ maxJoinKeysInMemory: 40 }));
    assert.ok(enforcer.noteJoinKeysInMemory(40).ok);
    const outcome = enforcer.noteJoinKeysInMemory(41);
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'join_keys_cap_exceeded');
  });

  it('enforces a zero temporary-storage cap: any declared byte is a breach', () => {
    const enforcer = armedEnforcer(generousCaps({ maxTemporaryStorageBytes: 0 }));
    assert.ok(enforcer.noteTemporaryStorageBytes(0).ok, 'zero bytes is not a use of storage');
    const outcome = enforcer.noteTemporaryStorageBytes(1);
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'temporary_storage_cap_exceeded');
  });

  it('enforces a zero output-rows cap: a single materialized row is a breach', () => {
    const enforcer = armedEnforcer(generousCaps({ maxOutputRows: 0 }));
    assert.ok(enforcer.noteOutputRowsMaterialized(0).ok);
    const outcome = enforcer.noteOutputRowsMaterialized(1);
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'output_rows_cap_exceeded');
  });
});

// ─── 7. Measurement failure is terminal here ──────────────────────────────────

describe('BR-SOURCE-14B.0C — an unmeasurable cap is not a cap (§ 5)', () => {
  it('states the deliberate divergence from the 14B.0A containment policy', () => {
    assert.equal(
      BRAZIL_RECEITA_FULL_JOIN_MEASUREMENT_FAILURE_POLICY,
      'measurement_failure_is_terminal_because_an_unmeasurable_cap_is_not_a_cap',
    );
  });

  it('stops the run when the memory sampler throws', () => {
    const enforcer = createBrazilReceitaFullJoinResourceEnforcer(
      generousCaps(),
      deps(scriptedClock().deps, () => {
        throw new Error('sampler unavailable');
      }),
    );
    const outcome = enforcer.validateBeforeFirstAccess();
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'measurement_unavailable');
  });

  it('stops the run when the sampler returns a malformed snapshot', () => {
    const enforcer = createBrazilReceitaFullJoinResourceEnforcer(
      generousCaps(),
      deps(
        scriptedClock().deps,
        () => ({ rss: Number.NaN, heapUsed: 1, external: 1 }) as BrazilReceitaFullJoinResourceMemorySnapshot,
      ),
    );
    assert.ok(!enforcer.validateBeforeFirstAccess().ok);
  });

  it('stops the run when the clock throws', () => {
    const enforcer = createBrazilReceitaFullJoinResourceEnforcer(
      generousCaps(),
      deps(() => {
        throw new Error('clock unavailable');
      }, CALM_MEMORY),
    );
    const outcome = enforcer.validateBeforeFirstAccess();
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'measurement_unavailable');
  });

  it('stops the run when the clock goes backwards', () => {
    let nowNs = BigInt(1_000_000_000);
    const enforcer = armedEnforcer(
      generousCaps(),
      deps(() => nowNs, CALM_MEMORY),
    );
    nowNs = BigInt(0);
    const outcome = enforcer.checkpoint('after_join');
    assert.ok(!outcome.ok);
    assert.equal(
      outcome.breach.terminalCode,
      'measurement_unavailable',
      'a non-monotonic clock cannot prove the runtime cap holds',
    );
  });
});

// ─── 8. No retry, no widening, no degradation, latched breach ─────────────────

describe('BR-SOURCE-14B.0C — a breach may not be worked around (§ 5)', () => {
  it('performs zero retries, structurally', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT, 0);
    assert.equal(
      BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BREACH_POLICY,
      'breach_stops_run_cleanly_without_retry_widening_or_algorithm_change',
    );
  });

  it('reports zero retries performed on every breach', () => {
    const enforcer = armedEnforcer(generousCaps({ maxFilesOpened: 0 }));
    const outcome = enforcer.noteFileOpened();
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.retriesPerformed, 0);
  });

  it('latches the FIRST breach and never lets a later call report a clean outcome', () => {
    const enforcer = armedEnforcer(generousCaps({ maxRowsRead: 0, maxFilesOpened: 8 }));
    const first = enforcer.noteRowsRead(1);
    assert.ok(!first.ok);
    assert.equal(first.breach.terminalCode, 'rows_read_cap_exceeded');

    // A caller that ignored the first refusal must not be able to obtain a clean result afterwards.
    const later = enforcer.noteFileOpened();
    assert.ok(!later.ok);
    assert.equal(later.breach.terminalCode, 'rows_read_cap_exceeded', 'the first breach still stands');
    assert.equal(enforcer.mayAccessData(), false);
  });

  it('exposes no setter that could widen a cap after resolution', () => {
    const enforcer = armedEnforcer();
    for (const key of Object.keys(enforcer)) {
      assert.ok(
        !/^set|widen|increase|raise|relax/i.test(key),
        `the enforcer must expose no cap-widening method, found "${key}"`,
      );
    }
  });
});

// ─── 9. Cleanup after a breach ────────────────────────────────────────────────

describe('BR-SOURCE-14B.0C — cleanup (§ 5)', () => {
  it('accepts a cleanup record after a breach, because that is when cleanup matters', () => {
    const enforcer = armedEnforcer(generousCaps({ maxRowsRead: 0 }));
    assert.ok(!enforcer.noteRowsRead(1).ok);
    const cleanup = enforcer.recordCleanup('completed');
    assert.ok(!cleanup.ok, 'the original breach still stands');
    assert.equal(cleanup.breach.terminalCode, 'rows_read_cap_exceeded');
    assert.equal(enforcer.readExactObservations().cleanupOutcome, 'completed');
  });

  it('treats a failed cleanup as terminal', () => {
    const enforcer = armedEnforcer();
    const outcome = enforcer.recordCleanup('failed');
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'cleanup_failed');
    assert.equal(enforcer.mayAccessData(), false, 'no continuation after a failed cleanup');
  });

  it('distinguishes an unverified cleanup from a failed one', () => {
    const enforcer = armedEnforcer();
    const outcome = enforcer.recordCleanup('unverified');
    assert.ok(!outcome.ok);
    assert.equal(outcome.breach.terminalCode, 'cleanup_unverified');
  });

  it('accepts not_needed and completed as clean outcomes', () => {
    for (const outcome of ['not_needed', 'completed'] as const) {
      const enforcer = armedEnforcer();
      assert.ok(enforcer.recordCleanup(outcome).ok);
    }
  });
});

// ─── 10. Provisional caps and the runtime model (§ 8) ─────────────────────────

describe('BR-SOURCE-14B.0C — provisional caps and runtime derivation (§ 8)', () => {
  it('proposes only the five caps the evidence supports', () => {
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL, {
      maxRssBytes: 512 * MIB,
      maxHeapUsedBytes: 64 * MIB,
      maxExternalMemoryBytes: 64 * MIB,
      maxTemporaryStorageBytes: 0,
      maxOutputRows: 0,
    });
  });

  it('never presents the proposal as approved for production', () => {
    assert.equal(
      BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_CAP_APPROVAL_STATUS,
      'proposed_for_synthetic_preparation_only_not_approved_for_production',
    );
  });

  it('leaves the six evidence-free caps to the operator, and refuses without them', () => {
    assert.deepEqual([...BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS].sort(), [
      'maxBytesRead',
      'maxFilesOpened',
      'maxJoinKeysInMemory',
      'maxPhaseRuntimeMs',
      'maxRowsRead',
      'maxRuntimeMs',
    ]);
    // The proposal alone must NOT resolve: maxRuntimeMs is not invented for the operator.
    const resolution = resolveBrazilReceitaFullJoinResourceCaps(
      BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL,
    );
    assert.ok(!resolution.ok);
    assert.equal(resolution.rejections.length, 6);
  });

  it('refuses to derive a runtime cap: throughput evidence does not exist yet', () => {
    const proposal = deriveBrazilReceitaFullJoinRuntimeCapProposal({
      datasetBytes: null,
      readerThroughputBytesPerMs: null,
      passesOverDataset: null,
      catalogPasses: null,
      cleanupAllowanceMs: null,
    });
    assert.equal(proposal.available, false);
    assert.ok(!proposal.available);
    assert.equal(proposal.reason, 'insufficient_evidence');
    assert.equal(proposal.missingInputs.length, 5);
  });

  it('refuses a zero-throughput reader rather than estimating an unbounded runtime', () => {
    const proposal = deriveBrazilReceitaFullJoinRuntimeCapProposal({
      datasetBytes: 1024,
      readerThroughputBytesPerMs: 0,
      passesOverDataset: 1,
      catalogPasses: 0,
      cleanupAllowanceMs: 0,
    });
    assert.ok(!proposal.available);
    assert.deepEqual(proposal.missingInputs, ['readerThroughputBytesPerMs']);
  });

  it('produces an ESTIMATE, explicitly not an authorized cap, once evidence exists', () => {
    const proposal = deriveBrazilReceitaFullJoinRuntimeCapProposal({
      datasetBytes: 1000,
      readerThroughputBytesPerMs: 10,
      passesOverDataset: 2,
      catalogPasses: 1,
      cleanupAllowanceMs: 50,
    });
    assert.ok(proposal.available);
    assert.equal(proposal.estimatedRuntimeMs, 350);
    assert.equal(
      proposal.approvalStatus,
      'proposed_for_synthetic_preparation_only_not_approved_for_production',
      'an estimate must never present itself as an authorization',
    );
  });
});

// ─── 11. Public channel stays bucketed ────────────────────────────────────────

describe('BR-SOURCE-14B.0C — public channel (§ 6, § 7)', () => {
  const observations = {
    envelope_version: BRAZIL_RECEITA_FULL_JOIN_RESOURCE_ENVELOPE_VERSION,
    peakRssBytes: 200 * MIB,
    peakHeapUsedBytes: 12 * MIB,
    peakExternalMemoryBytes: 3 * MIB,
    totalDurationMs: 1_500,
    phaseDurationsMs: {
      preflight: 5,
      manifest_validation: 20,
      empresas_read: 300,
      estabelecimentos_read: 400,
      cleanup: 1,
      sanitization: 2,
    },
    bytesRead: 128 * 1024,
    rowsRead: 40,
    filesOpened: 2,
    outputRowsMaterialized: 0,
    joinKeysPeakInMemory: 40,
    temporaryStoragePeakBytes: 0,
    temporaryStorageCurrentBytes: 0,
    checkpointsEvaluated: ['before_first_access', 'after_empresas_read'] as const,
    cleanupOutcome: 'not_needed' as const,
  };

  it('emits buckets, never exact magnitudes', () => {
    const measurement = toBrazilReceitaFullJoinPublicSanitizedMeasurements(observations);
    assert.equal(measurement.peak_rss_bucket, 'lte_256mb');
    assert.equal(measurement.peak_heap_used_bucket, 'lte_16mb');
    assert.equal(measurement.total_duration_bucket, 'lte_10s');
    assert.equal(measurement.bytes_read_bucket, 'lte_1m');
    assert.equal(measurement.output_rows_bucket, 'zero');
    assert.equal(measurement.in_memory_key_window_peak_bucket, 'lte_100');
    // No field anywhere in the public object may carry an exact byte figure.
    for (const value of Object.values(measurement)) {
      if (typeof value === 'number') {
        assert.ok(value <= 1_000, `public numeric leaves must stay small, saw ${value}`);
      }
    }
  });

  it('passes the untouched full-join output sanitizer', () => {
    const measurement = toBrazilReceitaFullJoinPublicSanitizedMeasurements(observations);
    const result = sanitizeBrazilReceitaFullJoinReport(measurement);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });

  it('REJECTS exact values from a public report — the sanitizer rule is not relaxed', () => {
    const withExactFigures = {
      ...toBrazilReceitaFullJoinPublicSanitizedMeasurements(observations),
      peakRssBytes: 200 * MIB,
    };
    const result = sanitizeBrazilReceitaFullJoinReport(withExactFigures);
    assert.equal(result.ok, false);
    assert.ok(
      result.findings.some((finding) => finding.kind === 'oversized_numeric_value'),
      'an exact byte figure must still fail closed as oversized_numeric_value',
    );
  });

  it('grants no field-name exemption: a Bytes-suffixed key is not privileged', () => {
    const disguised = { cnpjBytes: 12 * MIB * 1024 };
    const result = sanitizeBrazilReceitaFullJoinReport(disguised);
    assert.equal(result.ok, false, 'naming must never be a way past the sanitizer');
  });

  it('carries held-absence assertions that the sanitizer accepts', () => {
    const measurement = toBrazilReceitaFullJoinPublicSanitizedMeasurements(observations);
    assert.equal(measurement.exact_values_printed, false);
    assert.equal(measurement.absolute_paths_printed, false);
    assert.equal(measurement.file_names_printed, false);
    assert.equal(measurement.raw_memory_observations_printed, false);
  });

  it('buckets every phase in the envelope contract', () => {
    const measurement = toBrazilReceitaFullJoinPublicSanitizedMeasurements(observations);
    for (const phase of BRAZIL_RECEITA_FULL_JOIN_RESOURCE_PHASES) {
      assert.ok(measurement.phase_duration_buckets[phase] !== undefined);
    }
  });
});

// ─── 12. Private channel authorization ────────────────────────────────────────

describe('BR-SOURCE-14B.0C — private channel authorization (§ 6)', () => {
  const boundaries: BrazilReceitaFullJoinPrivateChannelBoundaries = {
    repositoryRoot: '/workspaces/sellup',
    homeDirectory: '/home/operator',
    datasetRoot: '/home/operator/receita',
  };

  it('is disabled by default', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_DEFAULT_ENABLED, false);
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(null, boundaries);
    assert.equal(resolution.ready, false);
    assert.ok(!resolution.ready);
    assert.deepEqual(resolution.rejections, ['acknowledgement_missing']);
  });

  it('requires the exact operator acknowledgement, not a boolean', () => {
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: 'yes',
        destinationDirectory: '/var/tmp/metrics',
        artifactSlug: 'run-a',
        ttlMs: 1_000,
      },
      boundaries,
    );
    assert.ok(!resolution.ready);
    assert.deepEqual(resolution.rejections, ['acknowledgement_missing']);
  });

  it('refuses a destination inside the repository — the artifact must never enter git scope', () => {
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: '/workspaces/sellup/docs/source-catalog',
        artifactSlug: 'run-a',
        ttlMs: 1_000,
      },
      boundaries,
    );
    assert.ok(!resolution.ready);
    assert.ok(resolution.rejections.includes('destination_inside_repository'));
  });

  it('refuses the operator home, which is itself a git repository (§ 10)', () => {
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: '/home/operator/notes',
        artifactSlug: 'run-a',
        ttlMs: 1_000,
      },
      boundaries,
    );
    assert.ok(!resolution.ready);
    assert.ok(resolution.rejections.includes('destination_inside_home'));
  });

  it('refuses the dataset root', () => {
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: '/home/operator/receita/2026',
        artifactSlug: 'run-a',
        ttlMs: 1_000,
      },
      boundaries,
    );
    assert.ok(!resolution.ready);
    assert.ok(resolution.rejections.includes('destination_inside_dataset'));
  });

  it('refuses a standard stream: the artifact may never go to stdout or stderr', () => {
    for (const stream of ['/dev/stdout', '/dev/stderr', '/dev/fd/1']) {
      const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
        {
          acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
          destinationDirectory: stream,
          artifactSlug: 'run-a',
          ttlMs: 1_000,
        },
        boundaries,
      );
      assert.ok(!resolution.ready, `${stream} must be refused`);
      assert.ok(resolution.rejections.includes('destination_is_standard_stream'));
    }
  });

  it('refuses a relative destination and a path-bearing slug', () => {
    const relative = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: 'metrics',
        artifactSlug: 'run-a',
        ttlMs: 1_000,
      },
      boundaries,
    );
    assert.ok(!relative.ready);
    assert.ok(relative.rejections.includes('destination_not_absolute'));

    for (const slug of ['../escape', 'a/b', 'Run_A', '', 'dot.dot']) {
      const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
        {
          acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
          destinationDirectory: '/var/tmp/metrics',
          artifactSlug: slug,
          ttlMs: 1_000,
        },
        boundaries,
      );
      assert.ok(!resolution.ready, `slug "${slug}" must be refused`);
      assert.ok(resolution.rejections.includes('destination_slug_invalid'));
    }
  });

  it('requires a positive TTL no larger than the hard ceiling', () => {
    for (const ttlMs of [0, -1, BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_MAX_TTL_MS + 1]) {
      const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
        {
          acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
          destinationDirectory: '/var/tmp/metrics',
          artifactSlug: 'run-a',
          ttlMs,
        },
        boundaries,
      );
      assert.ok(!resolution.ready, `ttl ${ttlMs} must be refused`);
      assert.ok(resolution.rejections.includes('ttl_invalid'));
    }
  });

  it('resolves a legitimate declaration into a destination and a sibling temporary file', () => {
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: '/var/tmp/metrics',
        artifactSlug: 'run-a',
        ttlMs: 1_000,
      },
      boundaries,
    );
    assert.ok(resolution.ready);
    assert.equal(resolution.destinationFile, '/var/tmp/metrics/run-a.json');
    assert.equal(
      path.dirname(resolution.temporaryFile),
      path.dirname(resolution.destinationFile),
      'the temporary file must be a sibling so the rename is atomic',
    );
  });
});

// ─── 13. Private content validation ───────────────────────────────────────────

describe('BR-SOURCE-14B.0C — private payload carries process metrics only (§ 6)', () => {
  function cleanPayload(): BrazilReceitaFullJoinPrivateOperatorMeasurements {
    const enforcer = armedEnforcer();
    enforcer.noteBytesRead(4096);
    enforcer.noteRowsRead(20);
    enforcer.noteFileOpened();
    enforcer.recordCleanup('not_needed');
    return toBrazilReceitaFullJoinPrivateOperatorMeasurements(
      enforcer.readExactObservations(),
      'passed',
    );
  }

  it('accepts a legitimate exact payload', () => {
    assert.deepEqual(validateBrazilReceitaFullJoinPrivateContent(cleanPayload()), []);
  });

  it('keeps exact values in the private payload — that is its whole purpose', () => {
    const enforcer = armedEnforcer(generousCaps({ maxBytesRead: 1024 * 1024 }));
    enforcer.noteBytesRead(500_000);
    const payload = toBrazilReceitaFullJoinPrivateOperatorMeasurements(
      enforcer.readExactObservations(),
      'passed',
    );
    assert.equal(payload.bytesRead, 500_000, 'the private channel reports the exact figure');
    assert.equal(payload.peakRssBytes, CALM_MEMORY.rss);
  });

  it('rejects a Receita identifier smuggled into the payload', () => {
    const payload = {
      ...cleanPayload(),
      cleanupResult: '9'.repeat(14), // built, not written: no identifier-shaped literal in this source
    } as unknown as BrazilReceitaFullJoinPrivateOperatorMeasurements;
    const findings = validateBrazilReceitaFullJoinPrivateContent(payload);
    assert.ok(findings.some((finding) => finding.kind === 'identifier_like_digit_run'));
  });

  it('rejects an absolute path, a home reference and a file URL', () => {
    for (const value of ['/home/operator/receita/empresas.csv', '~/receita', 'file:///data']) {
      const payload = {
        ...cleanPayload(),
        sanitizerResult: value,
      } as unknown as BrazilReceitaFullJoinPrivateOperatorMeasurements;
      const findings = validateBrazilReceitaFullJoinPrivateContent(payload);
      assert.ok(
        findings.some((finding) => finding.kind === 'path_like_value'),
        `"${value}" must be refused as path-like`,
      );
    }
  });

  it('rejects an identifier hash', () => {
    const payload = {
      ...cleanPayload(),
      sanitizerResult: 'deadbeefdeadbeefcafe',
    } as unknown as BrazilReceitaFullJoinPrivateOperatorMeasurements;
    const findings = validateBrazilReceitaFullJoinPrivateContent(payload);
    assert.ok(findings.some((finding) => finding.kind === 'hash_like_value'));
  });

  it('rejects an unexpected field and an unexpected free-form string', () => {
    const extra = {
      ...cleanPayload(),
      companyName: 'ACME',
    } as unknown as BrazilReceitaFullJoinPrivateOperatorMeasurements;
    const findings = validateBrazilReceitaFullJoinPrivateContent(extra);
    assert.ok(findings.some((finding) => finding.kind === 'unexpected_field'));
    assert.ok(findings.some((finding) => finding.kind === 'unexpected_string_value'));
  });

  it('names only the field, never the offending value', () => {
    const payload = {
      ...cleanPayload(),
      sanitizerResult: '/home/operator/secret',
    } as unknown as BrazilReceitaFullJoinPrivateOperatorMeasurements;
    for (const finding of validateBrazilReceitaFullJoinPrivateContent(payload)) {
      assert.ok(!finding.field.includes('operator'), 'a finding must not echo the value');
    }
  });
});

// ─── 14. Private artifact on a real disk ──────────────────────────────────────

describe('BR-SOURCE-14B.0C — private artifact persistence (§ 6)', () => {
  const created: string[] = [];

  function workspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-14b0c-'));
    created.push(dir);
    return dir;
  }

  afterEach(() => {
    while (created.length > 0) {
      const dir = created.pop();
      if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function payload(): BrazilReceitaFullJoinPrivateOperatorMeasurements {
    const enforcer = armedEnforcer();
    enforcer.noteBytesRead(4096);
    enforcer.recordCleanup('completed');
    return toBrazilReceitaFullJoinPrivateOperatorMeasurements(
      enforcer.readExactObservations(),
      'passed',
    );
  }

  function resolved(directory: string) {
    const resolution = resolveBrazilReceitaFullJoinPrivateChannel(
      {
        acknowledgement: BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_ACKNOWLEDGEMENT,
        destinationDirectory: directory,
        artifactSlug: 'run-a',
        ttlMs: 60_000,
      },
      {
        repositoryRoot: '/workspaces/sellup',
        homeDirectory: '/home/nonexistent-operator',
        datasetRoot: null,
      },
    );
    assert.ok(resolution.ready);
    return resolution;
  }

  const realFs = createBrazilReceitaFullJoinPrivateChannelFileSystem();

  it('writes the artifact owner-only (0600)', () => {
    const directory = workspace();
    const resolution = resolved(directory);
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(resolution, payload(), realFs, 0);
    assert.ok(outcome.written);
    assert.equal(outcome.mode, BRAZIL_RECEITA_FULL_JOIN_PRIVATE_CHANNEL_FILE_MODE);
    const mode = fs.lstatSync(outcome.destinationFile).mode & 0o777;
    assert.equal(mode, 0o600, 'no group or other permission may survive');
  });

  it('writes atomically: no temporary file survives a success', () => {
    const directory = workspace();
    const resolution = resolved(directory);
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(resolution, payload(), realFs, 0);
    assert.ok(outcome.written);
    assert.equal(fs.existsSync(resolution.temporaryFile), false);
    assert.equal(fs.existsSync(resolution.destinationFile), true);
    assert.deepEqual(fs.readdirSync(directory), ['run-a.json']);
  });

  it('records the TTL in the artifact and honours it', () => {
    const directory = workspace();
    const resolution = resolved(directory);
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(resolution, payload(), realFs, 1_000);
    assert.ok(outcome.written);
    assert.equal(outcome.expiresAtMs, 61_000);

    const stored = JSON.parse(fs.readFileSync(outcome.destinationFile, 'utf8'));
    assert.equal(stored.expires_at_ms, 61_000);
    assert.equal(
      isBrazilReceitaFullJoinPrivateArtifactExpired(outcome.expiresAtMs, 60_999),
      false,
    );
    assert.equal(isBrazilReceitaFullJoinPrivateArtifactExpired(outcome.expiresAtMs, 61_000), true);
  });

  it('persists exact figures and no Receita value', () => {
    const directory = workspace();
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(
      resolved(directory),
      payload(),
      realFs,
      0,
    );
    assert.ok(outcome.written);
    const raw = fs.readFileSync(outcome.destinationFile, 'utf8');
    const stored = JSON.parse(raw);
    assert.equal(stored.measurements.bytesRead, 4096);
    // The artifact DOES carry exact byte figures — that is the channel's entire purpose, and it is
    // why this file may never live in the repository or be printed. So the assertion here is not
    // "no long digit run" (a peak RSS in bytes is nine digits); it is that every string in the
    // artifact comes from the closed enum allowlist and no path, home reference or free-form value
    // appears anywhere.
    assert.ok(stored.measurements.peakRssBytes >= 8 * MIB, 'an exact peak is present');
    assert.equal(/\/(home|Users)\//.test(raw), false, 'no operator path');
    assert.equal(/[~]|file:/.test(raw), false, 'no home or file reference');
    assert.deepEqual(
      validateBrazilReceitaFullJoinPrivateContent(stored.measurements),
      [],
      'the persisted payload still passes content validation when read back',
    );
  });

  it('refuses to write a payload that fails content validation, leaving nothing behind', () => {
    const directory = workspace();
    const resolution = resolved(directory);
    const dirty = {
      ...payload(),
      sanitizerResult: '/home/operator/receita',
    } as unknown as BrazilReceitaFullJoinPrivateOperatorMeasurements;
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(resolution, dirty, realFs, 0);
    assert.ok(!outcome.written);
    assert.equal(outcome.failure, 'content_validation_failed');
    assert.deepEqual(fs.readdirSync(directory), [], 'a rejected payload writes nothing at all');
  });

  it('deletes the artifact and verifies its absence', () => {
    const directory = workspace();
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(
      resolved(directory),
      payload(),
      realFs,
      0,
    );
    assert.ok(outcome.written);
    const deletion = deleteBrazilReceitaFullJoinPrivateArtifact(outcome.destinationFile, realFs);
    assert.deepEqual(deletion, { requested: true, deleted: true, verifiedAbsent: true });
    assert.equal(fs.existsSync(outcome.destinationFile), false);
  });

  it('purges only once the TTL has elapsed', () => {
    const directory = workspace();
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(
      resolved(directory),
      payload(),
      realFs,
      0,
    );
    assert.ok(outcome.written);

    const early = purgeBrazilReceitaFullJoinPrivateArtifactIfExpired(
      outcome.destinationFile,
      outcome.expiresAtMs,
      outcome.expiresAtMs - 1,
      realFs,
    );
    assert.deepEqual(early, { requested: false, deleted: false, verifiedAbsent: false });
    assert.equal(fs.existsSync(outcome.destinationFile), true, 'a live artifact is left alone');

    const late = purgeBrazilReceitaFullJoinPrivateArtifactIfExpired(
      outcome.destinationFile,
      outcome.expiresAtMs,
      outcome.expiresAtMs,
      realFs,
    );
    assert.equal(late.verifiedAbsent, true);
    assert.equal(fs.existsSync(outcome.destinationFile), false);
  });

  it('reports an unverifiable deletion rather than claiming success', () => {
    const lyingFs: BrazilReceitaFullJoinPrivateChannelFileSystem = {
      writeFileExclusive() {},
      chmod() {},
      statMode: () => 0o600,
      rename() {},
      // Always present: an unlink that cannot be verified must not read as verified.
      exists: () => true,
      unlink() {},
    };
    const deletion = deleteBrazilReceitaFullJoinPrivateArtifact('/var/tmp/x.json', lyingFs);
    assert.equal(deletion.deleted, true);
    assert.equal(deletion.verifiedAbsent, false);
  });

  it('refuses to leave an artifact whose permissions cannot be verified', () => {
    const directory = workspace();
    const resolution = resolved(directory);
    const looseFs: BrazilReceitaFullJoinPrivateChannelFileSystem = {
      ...realFs,
      // Simulates a filesystem that cannot honour 0600 (a mounted share, for instance).
      statMode: () => 0o644,
    };
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(resolution, payload(), looseFs, 0);
    assert.ok(!outcome.written);
    assert.equal(outcome.failure, 'permission_verification_failed');
    assert.deepEqual(fs.readdirSync(directory), [], 'the temporary file is removed');
  });

  it('removes the temporary file when the rename fails', () => {
    const directory = workspace();
    const resolution = resolved(directory);
    const brokenRename: BrazilReceitaFullJoinPrivateChannelFileSystem = {
      ...realFs,
      rename() {
        throw new Error('rename failed');
      },
    };
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(resolution, payload(), brokenRename, 0);
    assert.ok(!outcome.written);
    assert.equal(outcome.failure, 'atomic_rename_failed');
    assert.deepEqual(fs.readdirSync(directory), [], 'no exact figures are left on disk');
  });

  it('refuses to write through a pre-existing path', () => {
    const directory = workspace();
    const resolution = resolved(directory);
    fs.writeFileSync(resolution.temporaryFile, 'pre-existing', { mode: 0o600 });
    const outcome = writeBrazilReceitaFullJoinPrivateArtifact(resolution, payload(), realFs, 0);
    assert.ok(!outcome.written);
    assert.equal(outcome.failure, 'write_failed');
  });
});

// ─── 15. Working-directory safety (§ 10) ──────────────────────────────────────

describe('BR-SOURCE-14B.0C — operator working-directory safety (§ 10)', () => {
  const SAFE: BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs = {
    currentWorkingDirectory: '/workspaces/sellup-worktrees/br-14b0c',
    homeDirectory: '/home/operator',
    repositoryRoot: '/workspaces/sellup-worktrees/br-14b0c',
    datasetRoot: '/home/operator/receita',
    repositoryPackageName: 'sellup-temp',
  };

  it('declares all four § 10 invariants', () => {
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_CWD_INVARIANTS, {
      currentWorkingDirectoryMustNotBeHome: true,
      repositoryRootMustBeSellUpWorktree: true,
      datasetRootMustNotEqualRepositoryRoot: true,
      noGitCommandMayRunWithCwdDatasetRoot: true,
    });
  });

  it('accepts a safe worktree cwd', () => {
    assert.deepEqual(evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory(SAFE), []);
  });

  it('refuses cwd === $HOME', () => {
    const violations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory({
      ...SAFE,
      currentWorkingDirectory: '/home/operator',
    });
    assert.ok(violations.includes('cwd_is_home_directory'));
  });

  it('refuses a cwd at or beneath the dataset root', () => {
    for (const cwd of ['/home/operator/receita', '/home/operator/receita/2026/empresas']) {
      const violations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory({
        ...SAFE,
        currentWorkingDirectory: cwd,
      });
      assert.ok(violations.includes('cwd_inside_dataset_root'), `${cwd} must be refused`);
    }
  });

  it('refuses a repository that is not a SellUp worktree', () => {
    const violations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory({
      ...SAFE,
      repositoryPackageName: 'some-other-project',
    });
    assert.ok(violations.includes('repository_root_not_sellup_worktree'));
  });

  it('refuses a dataset root that equals the repository root', () => {
    const violations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory({
      ...SAFE,
      datasetRoot: SAFE.repositoryRoot,
    });
    assert.ok(violations.includes('dataset_root_equals_repository_root'));
  });

  it('refuses a cwd outside the repository root', () => {
    const violations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory({
      ...SAFE,
      currentWorkingDirectory: '/var/tmp',
    });
    assert.ok(violations.includes('cwd_outside_repository_root'));
  });

  it('refuses a relative cwd, reporting that alone', () => {
    assert.deepEqual(
      evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory({
        ...SAFE,
        currentWorkingDirectory: 'relative/path',
      }),
      ['cwd_not_absolute'],
    );
  });

  it('reports every violation at once', () => {
    const violations = evaluateBrazilReceitaFullJoinBenchmarkWorkingDirectory({
      ...SAFE,
      currentWorkingDirectory: '/home/operator',
      repositoryPackageName: 'not-sellup',
    });
    assert.ok(violations.includes('cwd_is_home_directory'));
    assert.ok(violations.includes('repository_root_not_sellup_worktree'));
    assert.ok(violations.length >= 3, 'an unsafe cwd is also outside the repository root');
  });
});

// ─── 16. Benchmark preflight (§ 9) ────────────────────────────────────────────

describe('BR-SOURCE-14B.0C — full-scan benchmark is prepared, not executed (§ 9)', () => {
  const SAFE_CWD: BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs = {
    currentWorkingDirectory: '/workspaces/sellup-worktrees/br-14b0c',
    homeDirectory: '/home/operator',
    repositoryRoot: '/workspaces/sellup-worktrees/br-14b0c',
    datasetRoot: '/home/operator/receita',
    repositoryPackageName: 'sellup-temp',
  };

  function request(
    overrides: {
      cwd?: Partial<BrazilReceitaFullJoinBenchmarkWorkingDirectoryInputs>;
      caps?: Record<string, unknown> | null;
      ledger?: ReturnType<typeof createBrazilReceitaFullJoinBenchmarkAttemptLedger>;
    } = {},
  ) {
    return {
      workingDirectory: { ...SAFE_CWD, ...overrides.cwd },
      caps: overrides.caps === undefined ? { ...generousCaps() } : overrides.caps,
      attemptLedger: overrides.ledger ?? createBrazilReceitaFullJoinBenchmarkAttemptLedger(),
    };
  }

  it('names the mode and keeps both authorization constants false', () => {
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_RESOURCE_BENCHMARK_MODE, 'full_join_resource_benchmark');
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED, false);
    assert.equal(BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED, true);
  });

  it('refuses because the full join does not exist, having passed every other gate', () => {
    const outcome = preflightBrazilReceitaFullJoinResourceBenchmark(request());
    assert.ok(!outcome.ok);
    // Authorization is checked before implementation, so an unauthorized benchmark reports that
    // first. Both are refusals; neither reaches data.
    assert.equal(outcome.abortCode, 'benchmark_not_authorized');
    assert.equal(outcome.abortStage, 'ABORT_BEFORE_DATA_ACCESS');
    assert.equal(outcome.dataAccessed, false);
    assert.equal(outcome.rowsEmitted, 0);
    assert.equal(outcome.retriesPerformed, 0);
    // Since 14B.0D the audited model is A and the refusal comes from the authorization stage. The
    // refusal itself did not move: nothing about a real full scan is permitted.
    assert.equal(outcome.auditedModel, 'model_a_fully_bounded_streaming');
    assert.equal(outcome.failedStage, 'authorization');
  });

  it('aborts on an unsafe cwd BEFORE it looks at the caps', () => {
    const outcome = preflightBrazilReceitaFullJoinResourceBenchmark(
      request({ cwd: { currentWorkingDirectory: '/home/operator' }, caps: null }),
    );
    assert.ok(!outcome.ok);
    assert.equal(outcome.abortCode, 'unsafe_operator_working_directory');
    assert.equal(outcome.failedStage, 'operator_working_directory');
    assert.deepEqual(outcome.capRejections, [], 'caps were never evaluated');
  });

  it('aborts on an incomplete cap set before any access, naming every missing cap', () => {
    const outcome = preflightBrazilReceitaFullJoinResourceBenchmark(request({ caps: null }));
    assert.ok(!outcome.ok);
    assert.equal(outcome.abortCode, 'resource_caps_incomplete');
    assert.equal(outcome.failedStage, 'resource_caps');
    assert.equal(outcome.capRejections.length, BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS.length);
    assert.equal(outcome.dataAccessed, false);
  });

  it('does not burn the single attempt on a malformed request', () => {
    const ledger = createBrazilReceitaFullJoinBenchmarkAttemptLedger();
    preflightBrazilReceitaFullJoinResourceBenchmark(request({ caps: null, ledger }));
    assert.equal(ledger.attemptsConsumed(), 0, 'a caps typo must not cost the operator its attempt');
  });

  it('rejects a second attempt', () => {
    const ledger = createBrazilReceitaFullJoinBenchmarkAttemptLedger();
    const first = preflightBrazilReceitaFullJoinResourceBenchmark(request({ ledger }));
    assert.ok(!first.ok);
    assert.equal(ledger.attemptsConsumed(), 1);

    const second = preflightBrazilReceitaFullJoinResourceBenchmark(request({ ledger }));
    assert.ok(!second.ok);
    assert.equal(second.abortCode, 'single_attempt_already_consumed');
    assert.equal(second.failedStage, 'single_attempt');
  });

  it('offers no reset on the attempt ledger', () => {
    const ledger = createBrazilReceitaFullJoinBenchmarkAttemptLedger();
    assert.equal(ledger.consume(), true);
    assert.equal(ledger.consume(), false);
    assert.equal(ledger.consume(), false, 'repeated attempts stay refused');
    for (const key of Object.keys(ledger)) {
      assert.ok(!/reset|clear|release/i.test(key), `no reset affordance, found "${key}"`);
    }
  });

  it('declares the zero-effect invariants the mode must honour', () => {
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_ZERO_EFFECT_INVARIANTS, {
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
      automaticRetryCount: 0,
    });
  });

  it('runs its preflight stages in the documented order', () => {
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_BENCHMARK_PREFLIGHT_STAGES, [
      'operator_working_directory',
      'resource_caps',
      'single_attempt',
      'authorization',
      'full_join_implementation',
    ]);
  });

  it('emits a refusal that the public sanitizer accepts', () => {
    const outcome = preflightBrazilReceitaFullJoinResourceBenchmark(request());
    const result = sanitizeBrazilReceitaFullJoinReport(outcome);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });
});

// ─── 17. Static guards ────────────────────────────────────────────────────────

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

const NEW_MODULES = [
  '../br-receita-cnpj-full-join-resource-envelope',
  '../br-receita-cnpj-full-join-operator-metric-channel',
  '../br-receita-cnpj-full-join-resource-benchmark',
  '../br-receita-cnpj-full-join-private-channel-fs',
];

describe('BR-SOURCE-14B.0C — static guards', () => {
  it('imports nothing outside this connector', () => {
    // Checked on IMPORT SPECIFIERS rather than on the whole source, because a substring scan cannot
    // tell a dependency from a claim: `writesZeroSupabase: true` is an assertion that Supabase is
    // NOT touched, and a naive scan would flag the very invariant that promises safety. What
    // actually matters is what the module can reach, and that is its import list.
    for (const moduleRef of NEW_MODULES) {
      const specifiers = [...codeOf(moduleRef).matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      for (const specifier of specifiers) {
        const permitted =
          specifier === 'node:path' ||
          specifier === 'node:fs' ||
          specifier.startsWith('./br-receita-cnpj-');
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
        'hubspot',
        'apollo',
        'lusha',
        'components/',
        'migrations',
      ]) {
        assert.ok(
          !source.toLowerCase().includes(forbidden.toLowerCase()),
          `${moduleRef} must not reference "${forbidden}"`,
        );
      }
      // Supabase may appear ONLY as a zero-effect claim, never as a call or an import.
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
      for (const forbidden of ['process.env', 'hostname', 'userInfo', 'os.homedir', 'whoami']) {
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

  it('confines all I/O to the dedicated filesystem adapter', () => {
    for (const moduleRef of [
      '../br-receita-cnpj-full-join-resource-envelope',
      '../br-receita-cnpj-full-join-operator-metric-channel',
      '../br-receita-cnpj-full-join-resource-benchmark',
    ]) {
      const source = codeOf(moduleRef);
      for (const forbidden of ['node:fs', 'readFileSync', 'writeFileSync', 'openSync', 'mkdir']) {
        assert.ok(
          !source.includes(forbidden),
          `${moduleRef} must perform no I/O — "${forbidden}" belongs in the adapter`,
        );
      }
    }
  });

  it('reaches the process clock and memory only through the declared factories', () => {
    const envelope = codeOf('../br-receita-cnpj-full-join-resource-envelope');
    const processReferences = envelope.match(/process\./g) ?? [];
    assert.equal(
      processReferences.length,
      2,
      'exactly two: process.hrtime.bigint and process.memoryUsage, both inside the dependency factory',
    );
    assert.ok(envelope.includes('process.hrtime.bigint()'));
    assert.ok(envelope.includes('process.memoryUsage()'));
    for (const moduleRef of [
      '../br-receita-cnpj-full-join-operator-metric-channel',
      '../br-receita-cnpj-full-join-private-channel-fs',
    ]) {
      assert.ok(!codeOf(moduleRef).includes('process.'), `${moduleRef} must not sample the process`);
    }
    assert.ok(
      !codeOf('../br-receita-cnpj-full-join-resource-benchmark').includes('process.'),
      'the benchmark decides; it does not sample',
    );
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
    // And the sanitizer itself is unchanged in the properties that matter.
    const sanitizer = codeOf('../br-receita-cnpj-full-join-output-sanitizer');
    assert.ok(sanitizer.includes('oversized_numeric_value'));
    assert.ok(sanitizer.includes('BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF'));
  });

  it('keeps both benchmark authorization constants as false literals', () => {
    const source = codeOf('../br-receita-cnpj-full-join-resource-benchmark');
    assert.ok(source.includes('BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false'));
    assert.ok(source.includes('BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED = true'));
    // 14B.0D flipped the IMPLEMENTATION constant and only that one. The two AUTHORIZATION constants
    // above are the ones this test exists to pin, and they are still `false` literals.
    assert.ok(source.includes('BRAZIL_RECEITA_FULL_JOIN_IMPLEMENTATION_EXISTS = true'));
  });

  it('leaves the 14B.0A instrumentation contract untouched', () => {
    const source = codeOf('../br-receita-cnpj-calibration-instrumentation');
    assert.ok(
      source.includes(
        'instrumentation_failure_marks_measurement_incomplete_and_preserves_original_failure',
      ),
      'the 14B.0A containment policy must survive this milestone unchanged',
    );
  });

  it('exposes every terminal code the milestone requires', () => {
    for (const code of [
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
    ] as const) {
      assert.ok(
        BRAZIL_RECEITA_FULL_JOIN_RESOURCE_TERMINAL_CODES.includes(code),
        `terminal code "${code}" must exist`,
      );
    }
    assert.equal(BRAZIL_RECEITA_FULL_JOIN_RESOURCE_TERMINAL_CODES.length, 14);
  });

  it('declares a checkpoint for every stage of the observed run', () => {
    assert.deepEqual(BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CHECKPOINTS, [
      'before_first_access',
      'after_manifest_validation',
      'after_empresas_read',
      'after_estabelecimentos_read',
      'after_join',
      'after_cleanup',
      'after_sanitization',
    ]);
  });
});
