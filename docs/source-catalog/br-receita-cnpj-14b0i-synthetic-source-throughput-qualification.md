# BR-SOURCE-14B.0I — Synthetic end-to-end source-read throughput qualification

**Mode:** synthetic only. No Receita dataset, no manifest, no Supabase, no runtime, no Agent 1, no
provider, no HubSpot, no UI. `REAL_DATA_ACCESSED = false` throughout.

## VERDICT

| | |
|---|---|
| status | `SOURCE_READ_THROUGHPUT_QUALIFIED_SYNTHETIC_A2` |
| branch | `br-source/14b0i-synthetic-source-throughput` |
| commit | pending (see PR) |
| PR | pending |
| can_merge_now | pending owner review (`MERGE APROBADO`) |

## SOURCE THROUGHPUT

- **profile:** `typical` (target ~90 bytes/row; measured average ≈ 85 bytes/row)
- **rows:** 979,500 (480,000 matched companies × 1 establishment each + 9,600 companies without an
  establishment + 9,600 orphan establishments + 300 invalid/malformed edge rows)
- **source bytes:** 83,283,000 (≈ 79.4 MiB), exact — equals the on-disk size of both generated
  files, verified byte-for-byte against the metering decorator's chunk-read total
  (`test:br-source:14b0i-synthetic-source-throughput`, "SYNTHETIC_SOURCE_BYTES_READ equals the
  exact on-disk size of the generated files")

| run | SOURCE_MIB_S |
|---|---|
| 1 | 8.244 |
| 2 | 9.787 |
| 3 | 8.452 |

- **median:** 8.452 MiB/s
- **min / max:** 8.244 / 9.787 MiB/s
- **rows/s (median run):** 104,235

**classification: A2 — adequate synthetic margin** (`>= 5 MiB/s and < 10 MiB/s`)

## PHASES (median run)

| phase | source MiB/s | duration |
|---|---|---|
| empresas (reference pass) | 61.222 | — |
| estabelecimentos (reference pass) | 54.076 | — |
| partitioned_join (derived by subtraction, see note below) | — | 7,592 ms |
| cleanup | — | 429 ms |
| sanitization | — | 0 ms (sub-millisecond) |

**The two reference passes are each individually far above the healthy-margin target (10 MiB/s)** —
61 and 54 MiB/s respectively. The gap between those phase-level rates and the ~8.5 MiB/s OVERALL
rate is the partitioned-join stage: at `partitionCount = 1024` (unchanged from 14B.0H), the join
stage's fixed per-partition overhead (one `checkpoint('after_join')` call and up to two handle-pool
acquisitions per partition ordinal, regardless of how many references that partition holds) took
6.2–7.6 seconds across the three runs — roughly 80–85% of total wall clock at this row count. This
is the SAME mechanism 14B.0H's own header documents for the buffered writer at this partition count:
fixed-cost-per-partition overhead that a bigger dataset amortizes and a smaller one does not. At a
much smaller scale (a 41,100-row smoke run during this milestone's own development) the same
mechanism drove overall throughput down to 0.6 MiB/s even though both reference passes individually
measured 5.7–6.5 MiB/s — evidence that **the per-partition floor, not the reader, is what a smaller
synthetic run would misrepresent**, and part of why this milestone targeted ≥ 1,000,000 rows.

**Partitioned-join duration is DERIVED, not directly reported.** The engine's resource enforcer only
records the FIRST `beginPhase`/`endPhase` window for a given phase name
(`br-receita-cnpj-full-join-resource-envelope.ts`'s `beginPhase`), and the join stage reuses the
`estabelecimentos_read` phase name for its own second `beginPhase`/`endPhase` pair — so
`phaseDurationsMs.estabelecimentos_read` ends up holding ONLY the reference pass's duration (which
is exactly what this report needed for `ESTABELECIMENTOS_SOURCE_MIB_S`), and the join stage's own
duration is recovered by subtracting every accounted-for phase from
`exact.resource.totalDurationMs`. See
`derivePartitionedJoinDurationMs` in `br-receita-cnpj-14b0i-synthetic-throughput-harness.ts` for the
exact computation and the comment explaining why.

## RESOURCES (median run)

- rss peak: 301,334,528 bytes (≈ 287 MiB) — well under `maxRssBytes` (512 MiB)
- heap peak: 83,404,344 bytes (≈ 79.5 MiB) — under `maxHeapUsedBytes` (128 MiB)
- external peak: 50,688,197 bytes (≈ 48.3 MiB) — under `maxExternalMemoryBytes` (64 MiB)
- temp storage peak: 15,667,200 bytes (≈ 14.9 MiB) — far under `maxTemporaryStorageBytes` (4 GiB)
- files opened peak: 34 — under `maxFilesOpened` (64)
- partition handles peak: 32 — exactly at `maxOpenPartitionFiles` (32), by construction (the pool's
  own ceiling); 4,394 evictions recorded, evidence the bound is doing work rather than merely never
  being reached

**A measurement note on heap, not an engine finding.** The FIRST attempt at this scale, run without
`--expose-gc`, aborted with `resource_cap_breached` at `heap_cap_exceeded` (137 MiB observed vs. the
128 MiB cap) — but the abort happened at the FIRST checkpoint, before the estabelecimentos file was
even opened. That heap included reachable-but-not-yet-collected batched strings from this harness's
OWN fixture generator (`GENERATOR_WRITE_BATCH_ROWS` batches, discarded but not yet swept by V8). A
single `global.gc()` call inserted between fixture generation and the benchmark call — guarded by
`typeof globalThis.gc === 'function'`, a no-op everywhere `--expose-gc` is absent, including every
`structural_ci` test — resolved it; every run reported above used it. This is a property of the test
harness's own garbage, not of the engine, and no engine or workspace cap was changed to produce it.

## STRUCTURAL

- sourceReadCalls: metered separately from row-fetch calls; chunk reads always request exactly
  `maxChunkBytes` (4,194,304 bytes), verified as an exact-equality classification, not a heuristic
- partitionWriteCalls / flushCalls / evictions: NOT re-measured by this milestone — BR-SOURCE-14B.0H's
  own dedicated suite (`br-receita-cnpj-full-join-buffered-writer.test.ts`) already covers the
  buffered writer's syscall-reduction claim directly, and the engine's public/exact surface has no
  field for it (see the test suite's own header comment on this scoping decision)
- statfsCalls: bounded, on the fixed 4,096-record interval — not once per reference
  (`test:br-source:14b0i-synthetic-source-throughput`, "the free-disk probe is called on a fixed
  schedule")
- resourceSampleCalls: grows far sub-linearly with row count (verified at 50 vs. 1,000 matched
  companies: a 20x row increase produced well under a 10x sample-count increase, dominated by the
  fixed `partitionCount = 1024` checkpoint floor rather than by row count)

## INSTRUMENTATION

- TEMP_STORAGE_PEAK_INTEGRATION_VERIFIED: true (`temporaryStoragePeakBytes > 0` during writes,
  `temporaryStorageCurrentBytes === 0` after verified cleanup — both asserted end to end)
- PHASE_DURATION_INTEGRATION_VERIFIED: true (`empresas_read`, `estabelecimentos_read`, `cleanup`,
  `sanitization` all populated on every completed run)
- SANITIZER_ABORT_INTEGRATION_VERIFIED: true (the real sanitizer runs and is checked on both a clean
  completed run and a deliberately forced `resource_cap_breached` abort — see
  "the sanitizer still runs on an aborted run" in the test suite)

## SAFETY

- REAL_DATA_ACCESSED: false
- SECOND_REAL_BENCHMARK_EXECUTED: false
- REAL_BENCHMARK_AUTHORIZED: false (`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`, unchanged)
- REAL_BENCHMARK_EXECUTED_DURABLE_STATE: true (14B.0G's historical record, unchanged, re-exported
  and re-asserted, never re-derived)
- IMPORT_EXECUTED: false
- SUPABASE_WRITE: false
- RUNTIME_CHANGED: false
- AGENT1_CHANGED: false
- AGENT2A_CHANGED: false
- PROVIDER_CALLS: false

## DECISION

- MODEL_A_CLASSIFICATION: `A` (unchanged from 14B.0H)
- SOURCE_READ_CLASSIFICATION: **A2** (adequate synthetic margin — median 8.452 MiB/s, comfortably
  above the 5 MiB/s minimum engineering target and below the 10 MiB/s healthy-margin target)
- END_TO_END_SYNTHETIC_SOURCE_THROUGHPUT_PROVEN: true, at this synthetic scale and profile, under
  UNCHANGED 14B.0H caps, through the unmodified real production pipeline
- END_TO_END_REAL_THROUGHPUT_PROVEN: false (unchanged — this milestone never touches real data)
- SIX_HOUR_NATIONAL_FULL_JOIN_FEASIBILITY: `STILL_UNPROVEN`
- SECOND_REAL_BENCHMARK_RECOMMENDATION: **YES** (A2 → YES per § 18's rule) — advisory only; it does
  not authorize anything and changes no source constant

- GATE2_APPROVED: false
- GATE7_APPROVED: false

## NEXT_ACTION

**MERGE REVIEW — BR-SOURCE-14B.0I**, then **OWNER REVIEW — SECOND REAL BENCHMARK AUTHORIZATION**
(per § 18: A2 classification recommends YES, but the recommendation is advisory only — the owner
decides, and nothing in this milestone flips `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`).

## How to reproduce

```bash
npm run test:br-source:14b0i-synthetic-source-throughput   # structural CI suite (44 tests, deterministic)
npm run br-source:14b0i-local-performance -- --profile typical --matched-companies 480000 --runs 3
```

`--profile narrow|typical|wide`, `--matched-companies N`, `--runs N` are all optional; the defaults
above reproduce the figures in this report. `br-source:14b0i-local-performance` is not a CI gate.
