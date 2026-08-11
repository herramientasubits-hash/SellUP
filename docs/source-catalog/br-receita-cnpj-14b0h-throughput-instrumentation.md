# BR-SOURCE-14B.0H — synthetic throughput root-cause + abort-path instrumentation

**Status:** synthetic-only root-cause investigation and optimization. No real dataset touched, no
second real benchmark, no authorization changed.
**Merge base:** `634f354db840e5701b9f26750d78fdb114cfb4a0` (14B.0G, PR #249, merged).
**Scope:** `src/server/source-catalog/connectors/br-receita-cnpj/`, its `__tests__/`, and
`scripts/source-catalog/`.

---

## 1. The question this milestone answers

BR-SOURCE-14B.0G's one authorized real benchmark attempt measured **~642 rows/s** on the reference
pass before hitting `maxRuntimeMs`. That figure implied 68 GiB would take well past the 6-hour owner
budget. This milestone asks *why* — with measurement, not assumption — and fixes the dominant cause it
finds, entirely against synthetic fixtures.

---

## 2. Root-cause verdict

```
PRIMARY_ROOT_CAUSE =
  LRU partition-handle churn (open + write + eviction, once per reference), not the write
  syscall itself.

SECONDARY_ROOT_CAUSE =
  A first design (buffer lifetime tied to the handle pool's own 32-slot LRU) inherits the
  same churn: under near-uniform hash routing with partitionCount (1024-2048) far above
  maxOpenPartitionFiles (32), the handle-pool's own cache hit rate measures under 1%, so a
  handle-tied buffer is evicted (and flushed) before it accumulates more than ~1 reference.

REJECTED_HYPOTHESES = see §4.
```

The initial hypothesis — "one `fs.write` syscall per 16-byte reference is the bottleneck" — is
**PARTIAL, not the whole story.** It is true in isolation (confirmed at low partition counts, §5), but
at the *proposed production profile* (1024+ partitions, 32 open handles) it is not what dominates: the
handle pool evicts and reopens on almost every reference regardless of how the write itself is done, so
a buffer whose lifetime is tied to that same handle never gets the chance to fill.

---

## 3. What actually shipped

### 3.1 Buffered partition writer, decoupled from handle lifetime

`br-receita-cnpj-full-join-partition-workspace.ts`'s `appendReference` no longer issues one
`fs.write`-shaped syscall per reference. Two structural changes:

1. **A write buffer per partition, independent of that partition's open FILE HANDLE.** The handle
   pool's own 32-slot LRU (`maxOpenPartitionFiles`) is completely unchanged; a partition's buffer
   survives however many *unrelated* handle evictions happen while it accumulates. The handle pool is
   only touched again when the buffer actually fills, is evicted by its OWN (much larger, independent)
   ceiling, or the run reads/disposes.
2. **Fail-fast preserved, once per distinct partition.** The very first reference to a partition still
   opens its destination and hardens/verifies its permissions immediately — a genuinely broken
   destination is still discovered on the first reference to it, not silently deferred.

Bounds (`BRAZIL_RECEITA_FULL_JOIN_MAX_BUFFERED_PARTITIONS` = 4 096, `..._PARTITION_WRITE_BUFFER_BYTES`
= 8 192): worst case `4_096 * 8_192 = 33_554_432` bytes (32 MiB), half of `maxExternalMemoryBytes`
(64 MiB in the proposed profile). `maxOpenPartitionFiles` (32) and `maxFilesOpened` (64) are untouched.

### 3.2 Temporary storage peak, measurable on abort (§13)

`br-receita-cnpj-full-join-resource-envelope.ts` gained a `temporaryStorageCurrentBytes` field
alongside the existing (Math.max-folded) `temporaryStoragePeakBytes`. The engine now calls
`noteTemporaryStorageBytes` after **every** successful append (previously: once, at final cleanup) —
so a run that aborts mid-pass reports the peak it actually spilled, not zero. `recordCleanup` zeroes
`current` on a verified `completed`/`not_needed` outcome (bypassing the latch, matching its existing
cleanup-outcome recording).

### 3.3 Phase duration, measurable after a latched breach (§14)

`beginPhase`/`endPhase` used to refuse entirely once the enforcer had latched a breach — meaning
`cleanup`, the one phase that runs on **every** abort, could never get a measured `durationMs` once
something else had already failed. Both methods now record timing whenever armed and the clock reads
successfully, regardless of latch status, while still reporting the already-latched breach in their
return value. `engine.ts`'s two early-abort paths (`referencePassFailure`, `partition_capacity_exceeded`)
now wrap their `releaseWorkspace()` call in the same `beginPhase('cleanup')`/`endPhase('cleanup')`
boundaries the success path already used.

### 3.4 The sanitizer actually runs (§16)

`br-receita-cnpj-real-full-scan-benchmark.ts` used to derive `sanitizerResult` as a string label from
`abortCode` (`'passed'`/`'not_run'`) — `sanitizeBrazilReceitaFullJoinReport` was never called on this
path at all. `applyBrazilReceitaRealFullScanReportSanitizer` now runs the real sanitizer against the
engine's public report on **every** terminal outcome; a failing verdict withholds `engine_report`
(`null`) and sets `public_report_released: false`, while the run's own `abort_code` — the reason it
actually stopped — is untouched.

---

## 4. Hypothesis audit (§6)

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| 1 | One `fs.write` per 16-byte reference | **CONFIRMED (secondary)** | §5: 625x write-call reduction at 32 partitions; ~1x at 1024 partitions under the (superseded) handle-tied design |
| 2 | Excessive `fs.open`/`fs.close` from LRU | **CONFIRMED (primary)** | Cache hit rate measured <1% at 1024 partitions / 32 handles (`CACHE_HIT_RATE_APPROX` in the profiler output) |
| 3 | Excessive partition eviction | **CONFIRMED**, same root as #2 | `evictions ≈ appends` at production partition counts before the fix |
| 4 | `statfs` too frequent | **REJECTED** | Already gated by `freeDiskCheckDue`, once per write block, not per record (`partition-workspace.ts`, pre-existing) |
| 5 | Resource envelope sampled per row | **REJECTED** | Already gated by the exponentially-widening periodic checkpoint schedule, not per row (`engine-bookkeeping.ts`, pre-existing) |
| 6 | Allocations/copies per row | **PARTIAL / not dominant** | The encoder allocates one 16-byte `Buffer` per reference; not measured as dominant relative to syscall cost |
| 7 | `Buffer.alloc` per reference | **PARTIAL** | Same as #6; the new buffer amortizes this over 512 references per flush |
| 8 | Hash/digest string conversions | **REJECTED** | Partition routing operates on the already-normalized string key once per row; not syscall-bound |
| 9 | Column-by-column parsing overhead | **REJECTED** | Reader already extracts one field via direct index into the row buffer, no per-column split |
| 10 | Source reads too small | **REJECTED** | Chunked at `maxChunkBytes` (4 MiB proposed), unrelated to the write-side bottleneck |
| 11 | Sync FS ops in hot loop | **CONFIRMED**, same root as #1/#2 | `fs.writeSync`/open/close are exactly the sync ops in question |
| 12-15 | FS metadata/flush/path/permission checks per reference | **REJECTED (after fix), PARTIAL (before)** | Permission hardening was already once-per-file; now open/close is also once-per-distinct-partition rather than once-per-reference |

`PRIMARY_THROUGHPUT_BOTTLENECK = true` for hypothesis #2 (LRU churn), not #1 (write syscall) alone.

---

## 5. Performance report (§26)

Measured on this development machine, this session, same process family for baseline and optimized
(`scripts/source-catalog/run-br-receita-cnpj-14b0h-throughput-profiler.ts`). `REFERENCE_RECORD_BYTES`
= 16. Baseline = a small, non-productive reimplementation of the exact pre-14B.0H write pattern (one
`fs.write` syscall per reference through the same handle pool, encoder and partition naming the
production workspace uses) — not a second engine.

### 5.0 THE TWO DENOMINATORS ARE NOT INTERCHANGEABLE — read this before any MiB/s figure

Every MiB/s number in this document is one of exactly two quantities, and they are never mixed,
converted into each other, or compared:

```
SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND
  = reference bytes WRITTEN per second, at 16 bytes per reference.
    What this milestone's synthetic profiler and its engineering target measure.
    Every figure in § 5.1 / § 5.2 / § 5.3 is in this unit.

SOURCE_READ_MIB_PER_SECOND
  = Receita SOURCE bytes READ per second.
    The unit the 68 GiB / 6 h owner budget is expressed in (~3.2 MiB/s required).
    NO figure in this milestone is in this unit. It was not measured here.
```

One source row is tens to hundreds of bytes READ and yields exactly one 16-byte reference WRITTEN, so
the ratio between the two units is a property of the real dataset's row widths — which this milestone
never touched. **No conversion between them is performed anywhere in this document, and none is valid
from the evidence collected here.** In particular, `7.1–7.6 MiB/s` of synthetic reference-write
throughput is **not** a claim about the `~3.2 MiB/s` of source read the budget requires.

### 5.1 Direct baseline-vs-optimized comparison (same run, same machine)

```
SYNTHETIC_FIXTURE_ROWS:            100,000
PARTITION_COUNT:                   1,024
MAX_OPEN_PARTITION_FILES:          32

BASELINE_ROWS_PER_SECOND:          795      (historical 14B.0G reference: ~642)
OPTIMIZED_ROWS_PER_SECOND:         81,401
SPEEDUP_ROWS_RATIO:                102.36x

BASELINE_SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND:   0.012
OPTIMIZED_SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND:  1.242
SOURCE_READ_MIB_PER_SECOND:                          not measured (no source bytes were read)

BASELINE_PARTITION_WRITE_CALLS:    100,000  (1 per reference)
OPTIMIZED_PARTITION_WRITE_CALLS:   2,048
WRITE_CALL_REDUCTION_RATIO:        48.83x

BASELINE_EVICTIONS / REOPENS:      99,746 / 97,730
OPTIMIZED_EVICTIONS / REOPENS:     4,064 / 2,048
CACHE_HIT_RATE_APPROX:             95.94%   (handle pool)
```

### 5.2 Engineering-target scale (1,000,000 references — optimized only; baseline's per-row cost was
already confirmed stable/constant across 5k/20k/100k/200k rows in this same session, so a ~20+ minute
baseline re-run at 1M rows was not repeated — see §5.3)

```
SYNTHETIC_FIXTURE_ROWS:            1,000,000
SYNTHETIC_FIXTURE_BYTES:           16,000,000
PARTITION_COUNT:                   1,024

OPTIMIZED_DURATION_MS:             2,007.37
OPTIMIZED_ROWS_PER_SECOND:         498,163
OPTIMIZED_SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND:  7.601
SOURCE_READ_MIB_PER_SECOND:                          not measured

REFERENCE_RECORDS:                 1,000,000
OPTIMIZED_PARTITION_WRITE_CALLS:   2,392       (417x reduction vs. 1 syscall/reference)
OPTIMIZED_FULL_BUFFER_FLUSHES:     360
OPTIMIZED_FLUSH_COUNT:             2,392

OPTIMIZED_EVICTIONS / REOPENS:     4,408 / 2,392
CACHE_HIT_RATE_APPROX:             99.56%      (handle pool)
```

### 5.3 Baseline extrapolation at 1M rows (labeled, not fabricated)

Baseline's rows/s was measured at 5k (714), 20k (908/739 across two runs), and 100k (795) references —
clustered tightly around the historical 642 rows/s 14B.0G figure, confirming it is a per-row-constant
cost (one syscall per reference) independent of scale. Extrapolating that measured, stable rate to 1M
rows: **~1,300s (≈21.7 min), ≈0.0117 MiB/s of synthetic reference-write throughput** — not re-run at
1M scale in this session because it would re-confirm an already-established constant at a ~20-minute
cost with no new information. Speedup at 1M scale, computed from this extrapolation: **≈27.5x** rows/s,
**≈27.6x** reference-write MiB/s — consistent with the directly-measured 100k-scale ratio (102x
write-call reduction, ~103x rows/s speedup at a smaller absolute row count where more of the run's
total time is measurement/dispose overhead relative to actual I/O).

```
WRITE_CALL_REDUCTION_RATIO (100k):  48.83x   (measured)
WRITE_CALL_REDUCTION_RATIO (1M):    417x     (measured, optimized only)
TARGET_5_MIB_S_REACHED:             true, at 1M-reference scale
                                    (7.601 SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND)
ENGINEERING_TARGET_ONLY = true — NOT_GATE2_EVIDENCE, NOT_REAL_DATA_EVIDENCE, NOT_PRODUCTION_SLA
REAL_14B0G_OBSERVED = ~642 rows/s (historical reference only)
```

### 5.4 The only cross-workload comparison this evidence supports, and its label

The synthetic write-path workload and 14B.0G's real reference pass are **different workloads**: one
writes 16-byte references from an in-memory fixture, the other also reads, parses and routes real
Receita rows. The single quantity they express in the SAME unit is rows per second:

```
REAL_14B0G_ROWS_PER_SECOND:            ~642        (real data, real reader, one authorized attempt)
SYNTHETIC_OPTIMIZED_ROWS_PER_SECOND:   ~466,968    (synthetic write path only, no source read)

LABEL = CROSS_WORKLOAD_DIRECTIONAL_COMPARISON_ONLY
        NOT_END_TO_END_PROOF
        NOT_GATE2_EVIDENCE
```

It says the write path is no longer the binding constraint it was; it does **not** say the real pass
now runs at any particular rate, because everything the real pass does besides writing references is
absent from the synthetic workload. The MiB/s figures are deliberately **not** brought into this
comparison at all — they are in the reference-write denominator (§ 5.0) and the real requirement is in
the source-read denominator, so no ratio between them would mean anything.

---

## 5b. Scale-awareness of the write-ratio target (LARGE_SCALE_STRUCTURAL_TARGET)

```
LARGE_SCALE_STRUCTURAL_TARGET:  partitionWriteCalls * 256 <= referenceRecordsEncoded
UNIVERSAL_INVARIANT_FOR_ANY_N:  false — this is NOT claimed at every scale
```

**Why the target does not apply to a small fixture.** The writer has exactly two flush triggers, and
only one of them amortizes:

- **Full-buffer flushes** carry `PARTITION_WRITE_BUFFER_BYTES / REFERENCE_RECORD_BYTES = 512`
  references each. A whole run can afford at most `floor(references / 512)` of them.
- **Finalization flushes** are a FIXED cost: up to ~1 024–2 048 partitions may be active at the
  proposed profile, and every partition holding a partial buffer owes exactly one flush at read/dispose
  time whether or not that buffer ever reached its 8 KiB fill. At low references-per-partition these
  fixed flushes are essentially the entire write count.

The scale-aware upper bound that **does** hold at every scale (given `activePartitions <=
MAX_BUFFERED_PARTITIONS = 4 096`, above which a buffer can be evicted and flushed partially more than
once):

```
partitionWriteCalls <= activePartitions + floor(referenceRecordsEncoded / 512)
```

Substituting it into the target gives the condition for the target to be **arithmetically reachable at
all**:

```
256 * (activePartitions + refs/512) <= refs   ⟺   refs >= 512 * activePartitions
```

i.e. the fixture must carry **at least one full buffer per active partition**. (Sufficient, not
necessary — a skewed distribution can clear it slightly earlier, as the profiler's 1M/2 048-partition
run did at 2 392 write calls. Nothing in the test suite relies on that.)

**Applied to the measured fixtures:**

| Fixture | Active partitions | References | `512 × partitions` | Target reachable? | Measured write calls | Ratio |
|---|---|---|---|---|---|---|
| § 5.1 (100k) | 2 048 | 100 000 | 1 048 576 | **no** — the 2 048-flush floor alone needs 524 288 references | 2 048 (= the floor exactly) | 1/48.8 |
| § 5.2 (1M) | 2 048 | 1 000 000 | 1 048 576 | marginal; cleared via skew | 2 392 | 1/418 |
| Test fixture | 1 024 | 1 048 576 | 524 288 | **yes**, 2x margin | 2 048 | 1/512 |

At 100k the writer hits the theoretical floor **exactly** — it cannot do better — and still misses
1/256 by construction. That is a property of the fixture, not a defect, and `1/48.8` is therefore not
evidence of weak buffering.

**How this is enforced rather than asserted in prose** — see
`br-receita-cnpj-full-join-buffered-writer.test.ts`:
- The large-scale test runs **1 048 576 references across 1 024 partition files** (512 ordinals × 2
  families, against the proposed 32-handle pool, round-robin so every partition is revisited only after
  all others — the worst case for the handle pool and the closest analogue of near-uniform hash routing
  without depending on a hash). It asserts `writeCalls * 256 <= references` by **integer
  multiplication, never division**, plus the scale-aware bound, plus the exact predicted figure
  (2 048 = one syscall per full buffer, no partial extra), plus a full byte-exact read-back of one
  partition so the ratio can never be a ratio over dropped references. No timing is used anywhere.
  Cost: ~2.6 s.
- A sibling test reproduces the **100k regime** (2 048 partitions × 48 references) and asserts the
  writer hits the floor exactly (`fullBufferFlushes === 0`, `writeCalls === 2 048`) **and** that
  `largeScaleTargetIsArithmeticallyReachable(...) === false` — so a future reader cannot "fix" the
  small fixture by tightening its ratio.
- The previous `writeSyscalls < TOTAL / 10` assertion has been **demoted to an explicitly-labelled
  secondary smoke check** and is no longer the structural guarantee; the scale-aware bound took its
  place at that shape.

**Regression sensitivity, verified by mutation:** quartering the effective buffer fill threshold in
`appendReference` (a 4x buffering regression) moves the large-scale fixture from 2 048 to 8 192 write
calls, and the target assertion fails with `observed ratio 1/128`. The mutation was reverted; the
production file is byte-identical to before it.

---

## 6. Instrumentation report (§27)

```
TEMP_STORAGE_PEAK_ON_ABORT_MEASURABLE:   true
PHASE_DURATION_ON_ABORT_MEASURABLE:      true
PUBLIC_SANITIZER_RUNS_ON_ABORT:          true
```

Demonstrated in `br-receita-cnpj-14b0h-abort-instrumentation.test.ts`:
- A run that spills references then aborts on a phase-runtime breach reports
  `temporaryStoragePeakBytes > 0` and `temporaryStorageCurrentBytes === 0` after cleanup.
- The SAME abort reports a measured `phaseDurationsMs.empresas_read` and `phaseDurationsMs.cleanup`
  (both numbers, not `null`), while `estabelecimentos_read` — never started — stays `null`.
- A non-resource abort (`reader_failed`, from a missing source file) also gets a measured cleanup
  duration, confirming the fix is not accidentally specific to one abort code.
- The enforcer-level unit test confirms `beginPhase`/`endPhase` record timing even when called AFTER
  the enforcer has already latched a breach from an unrelated cap (rows-read, in that test).
- The sanitizer wiring test confirms a structurally-safe report (built via the REAL
  `buildBrazilReceitaFullJoinEnginePublicReport` projection) passes and is released unchanged, while a
  report carrying an injected 8-digit numeric leaf fails and is withheld (`engine_report: null`,
  `public_report_released: false`) — with the primary `abort_code` on the report left untouched by the
  sanitizer verdict.

---

## 7. FD / disk

```
MAX_OPEN_PARTITION_FILES:            32   (unchanged)
GLOBAL_FILE_HANDLE_CAP:               64   (unchanged, maxFilesOpened)
PARTITION_HANDLE_PEAK_SYNTHETIC:      32   (measured, never exceeded)

STATFS_CALLS:                        unchanged cadence — gated by freeDiskCheckDue, once per write
                                      block, not touched by this milestone
FREE_DISK_GUARANTEES_PRESERVED:      true — the workspace's own pre-write cap check
                                      (`projected > maxTemporaryStorageBytes`) is unchanged; buffering
                                      only delays WHEN a byte reaches disk, never widens how much may
                                      be claimed before a check runs
```

---

## 8. Safety

```
REAL_DATA_ACCESSED = false
SECOND_REAL_BENCHMARK_EXECUTED = false

REAL_BENCHMARK_AUTHORIZED = false                        (unchanged)
REAL_BENCHMARK_EXECUTED_DURABLE_STATE = true              (unchanged; historical record of 14B.0G)

IMPORT_EXECUTED = false
SUPABASE_WRITE = false
RUNTIME_CHANGED = false
AGENT1_CHANGED = false
AGENT2A_CHANGED = false
PROVIDER_CALLS = false
```

The engine's own module-level `attemptsConsumed()` counter, the `BenchmarkAttemptLedger`, and
`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`/`_EXECUTED` are untouched by this milestone — no
edit anywhere in this diff references or modifies them.

---

## 9. Tests

New: `br-receita-cnpj-full-join-buffered-writer.test.ts` (12 tests — 10, plus the two
`LARGE_SCALE_STRUCTURAL_TARGET` tests added by the merge-review patch, § 5b),
`br-receita-cnpj-14b0h-abort-instrumentation.test.ts` (9 tests). Combined suite
(`npm run test:br-source:14b0h-throughput-instrumentation`): **493 passing, 0 failing.**
Full connector regression: 14B.0A **236/0**, 14B.0C **367/0**, 14B.0D **584/0**, 14B.0F **472/0**
(**1,659 passing, 0 failing**). `test:agent2a:automatic-routing` (the required GitHub check's suite):
**50 passing, 0 failing.**

No test in this suite uses timing, a sleep, or a wall-clock threshold — every structural claim is an
integer count comparison.

---

## 10. Architecture decision

```
MODEL_A_CLASSIFICATION            = A
IDENTIFIED_BOTTLENECK_FIXED       = true
END_TO_END_REAL_THROUGHPUT_PROVEN = false
GATE2_EVIDENCE_COMPLETE           = false
```

**What `A` means here, precisely.** Model A (fully-bounded three-pass streaming join) remains the
classification after this milestone because the bottleneck that 14B.0G's one authorized real attempt
exposed was **identified by measurement and fixed** — the write path no longer issues one syscall per
16-byte reference, and the handle-pool churn that dominated it is gone — while every bound Model A
depends on stayed exactly where it was: `maxOpenPartitionFiles` (32), `maxFilesOpened` (64),
`partitionCount`, join semantics, the reference-record format and every 14B.0C resource cap are all
unchanged. The synthetic engineering target (>= 5 MiB/s of **synthetic reference-write** bytes, § 5.0)
was reached at 1M references / 1 024 partitions (7.6 MiB/s in that unit).

**What `A` does NOT mean.** It is **not** a claim that the national full join now fits inside the
six-hour owner budget. That claim would require an end-to-end real measurement — source read, parse,
route, write, and the two later passes — and no such measurement exists: only one real benchmark
attempt was ever authorized, it was consumed by 14B.0G, and this milestone deliberately performed no
second one. The fixed bottleneck was real and it was dominant in the write path; whether what remains
(source read and parse throughput above all) fits the budget is **unmeasured and therefore unclaimed**.

```
SIX_HOUR_NATIONAL_FULL_JOIN_FEASIBILITY = UNPROVEN — no end-to-end real measurement exists
```

---

## 11. Gates

```
GATE2_APPROVED = false
GATE7_APPROVED = false
```

## 11b. Merge-review patch (three caveats closed)

The merge review accepted the productive implementation as-is and asked for three caveats to be closed
without redesigning the engine, changing buffering, the FD pool, the caps, the Receita data, or running
a second benchmark. What the patch contains:

```
PRODUCTION_LOGIC_CHANGED_BY_REVIEW_PATCH = false
```

| Caveat | Closure | Where |
|---|---|---|
| 1. Structural regression test too weak | `LARGE_SCALE_STRUCTURAL_TARGET` test at 1 048 576 references / 1 024 partitions asserting `writeCalls * 256 <= references` by integer multiplication; `writeSyscalls < TOTAL / 10` demoted to a labelled secondary smoke check | `br-receita-cnpj-full-join-buffered-writer.test.ts` |
| 2. Scale-aware bound | Bound `writeCalls <= activePartitions + floor(refs / 512)` derived, documented and asserted at every scale; the 1/256 target reclassified as `LARGE_SCALE_STRUCTURAL_TARGET`, reachable only when `refs >= 512 × activePartitions`; the 100k regime's unreachability asserted, not merely explained | § 5b + the same test file |
| 3. MiB/s denominator ambiguity | `SYNTHETIC_REFERENCE_WRITE_MIB_PER_SECOND` separated from `SOURCE_READ_MIB_PER_SECOND` everywhere; profiler output keys renamed and a `THROUGHPUT_DENOMINATOR_NOTE` emitted; cross-workload rows/s comparison labelled `CROSS_WORKLOAD_DIRECTIONAL_COMPARISON_ONLY` | § 5.0, § 5.4, profiler script |
| 4. Performance claim | `MODEL_A_CLASSIFICATION = A` kept, with `IDENTIFIED_BOTTLENECK_FIXED = true`, `END_TO_END_REAL_THROUGHPUT_PROVEN = false`, `GATE2_EVIDENCE_COMPLETE = false`, and the six-hour feasibility claim explicitly withdrawn | § 10 |

Files touched by the review patch: this document, the buffered-writer test, the profiler script, and
**seven comment lines** in `br-receita-cnpj-full-join-partition-workspace.ts` (the MiB/s denominator
disambiguation of caveat 3). That production file's diff contains **zero non-comment changed lines** —
verified mechanically, not asserted — so no executable production token changed. The engine, the
buffering, the FD pool, every cap and every constant are byte-identical to the reviewed head.

```
ENGINE_REDESIGNED            = false
BUFFERING_CHANGED            = false
FD_POOL_CHANGED              = false
CAPS_CHANGED                 = false
RECEITA_DATA_TOUCHED         = false
SECOND_BENCHMARK_EXECUTED    = false
```

## 12. Next action

```
MERGE REVIEW — BR-SOURCE-14B.0H

NO REAL BENCHMARK AUTHORIZATION SOUGHT OR GRANTED.
```
