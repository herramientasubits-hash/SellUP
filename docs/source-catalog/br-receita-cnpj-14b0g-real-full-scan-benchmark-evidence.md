# BR-SOURCE-14B.0G — Receita full-scan benchmark evidence

**Status:** one real read-only full-scan benchmark attempt executed under explicit owner authorization.
**Terminal outcome:** `aborted` / `resource_cap_breached`, in the `empresas_reference_pass` stage.
**Scope:** measurement only. No import, no Supabase write, no runtime change, no provider call, no row emitted.

The owner authorized exactly one real read-only run of the 14B.0F full-scan resource benchmark over the
already-staged Receita dataset. This document is the sanitized record. Exact technical magnitudes were
reported to the owner out of band; the private operator metric channel held them, and it has been
deleted and verified absent.

---

## 1. Owner decision

| Decision | Owner ruling |
|---|---|
| A — temporary offset-reference storage | APPROVE |
| B — CAP input policy | APPROVE_FOR_THIS_BENCHMARK_ONLY |
| C — real full-scan resource benchmark | APPROVE |

Attempts authorized **1**, consumed **1**. Automatic retries **0**, performed **0**. Output rows **0**.
The authorization expired at the terminal outcome and was not renewed. No second attempt was made.

Implementation base: `8a9739aa810f6333453b34eab4173c0347a757a4` (14B.0F, PR #243).

---

## 2. Dataset

```
sourceKey  br_receita_cnpj_dados_abertos
period     2026-07
layout     official_headerless
encoding   latin1
delimiter  ;
```

The staged dataset was reused. Nothing was downloaded, extracted, copied, moved, renamed, chmod-ed or
deleted. No path or file name is recorded here.

Manifest preflight validated read-only before the first data row: source key, period, relative paths
only, no traversal, no symlinks, no archives, expected encoding and delimiter, official headerless
layout, authorized families only, **zero QSA / Sócios / CPF / person-linked families**, and both
required join families present.

**Coverage caveat — the staged dataset is one part, not the national whole.** Each join family is a
single part of a dataset the Receita publishes in roughly ten parts per family. A complete traversal of
this manifest is a complete traversal of approximately **one tenth** of the national universe. Every
ratio below must be read with that multiplier applied.

---

## 3. Caps applied

The 14B.0F § 11 proposed profile, applied unmodified. No cap was changed, widened or invented.

```
maxRuntimeMs       = OWNER_BUDGET_CEILING
maxPhaseRuntimeMs  = OWNER_BUDGET_CEILING
NOT_RUNTIME_ESTIMATE
NOT_OBSERVED_RUNTIME
```

Exhausting either runtime cap is a valid benchmark result and authorizes no retry.

---

## 4. Terminal outcome

```
exit_status                          aborted
abort_code                           resource_cap_breached
abort_stage                          empresas_reference_pass
measurement_complete                 false
every_source_traversed_to_end_of_file false
dataset_materialized                 false
rows_emitted                          0
retries_performed                     0
real_manifest_opened                  true
private_metric_artifact_written       true
```

**CAP_BREACHES = [`maxRuntimeMs`].** The owner budget ceiling was exhausted while the reference pass over
the first join family was still in progress. Whether `maxPhaseRuntimeMs` also breached cannot be
asserted — see § 7.2, the per-phase timing instrument recorded nothing. The exact duration is a
private-channel figure and was reported to the owner out of band.

Every other cap was respected, most of them with wide margin. Memory stayed bounded throughout: the
resident-set, heap and external-memory ceilings were all honoured, and the in-memory key window peaked
at zero because the partitioned join phase was never reached.

---

## 5. Measurement buckets (public)

```
peak_rss_bucket                        lte_256mb
peak_heap_used_bucket                  lte_256mb
peak_external_memory_bucket            lte_64mb
temporary_storage_peak_bucket          lte_16mb   ← NOT MEASURED, see § 7.1
total_duration_bucket                  gt_60s
phase_duration_buckets                 all not_measured, see § 7.2
bytes_read_bucket                      gt_1m
rows_read_bucket                       gt_1m
files_opened_bucket                    lte_10
output_rows_bucket                     zero
in_memory_key_window_peak_bucket       zero
partition_count_bucket                 lte_10k
largest_partition_reference_count_bucket lte_1m
files_opened_peak_bucket               lte_100
partition_handle_peak_open_bucket      lte_100
partition_depth_reached                0
match_count_bucket                     zero
checkpoints_evaluated_count            226
```

### 5.1 What the run establishes

**The 14B.0F § 3 descriptor fix holds on real data.** The global file-handle peak stayed close to the
partition pool's own ceiling and well inside the authorized global cap, with the pool saturated for
essentially the whole run. `ULIMIT_8192_REQUIRED = false` is now an observed property of a real run
rather than a design claim.

**Hash distribution is excellent.** The largest partition's reference count finished within a few per
cent of the mean across all 1024 partitions, and `partition_depth_reached` is 0 — no repartitioning was
needed, and `maxReferencesPerPartition` was never approached.

**Memory is genuinely bounded.** Every memory ceiling was respected while the reference pass processed
millions of rows, which is the Model A claim the milestone existed to test.

### 5.2 What the run establishes against Gate 2

Throughput, not memory, is the binding constraint — and by a wide margin. In the full owner budget the
run completed roughly an eighth of the reference pass over the staged dataset, and the staged dataset is
itself about a tenth of the national one. Extrapolating the reference pass alone to the staged dataset
gives something on the order of tens of hours; adding the partitioned join phase, which re-reads source
rows by byte offset, and then scaling to the national dataset, puts a national full join on this
hardware in the region of **weeks**, not hours.

The extrapolation is deliberately stated as an order of magnitude. Observed throughput was not constant
— it decayed over the run — so a linear projection from any single window understates the cost. What is
unambiguous is the scale: the gap between the authorized budget and a national full join is three to
four orders of magnitude, not a tuning margin.

---

## 6. Cleanup

```
cleanup_required                 true
cleanup_status                   completed
cleanup_verified_absent          true
unsafe_artifacts_detected        false
artifact_release_failures        0
temporary_spill_files_released   1024
temporary_scratch_dirs_released  1
```

Verified independently on disk after the run: the workspace parent contained zero entries. The private
metric artifact was read for the figures Gate 2 needs, then deleted; its directory was verified empty
and both temporary directories were removed.

```
SOURCE_HANDLES_OPEN_AFTER        0
PARTITION_HANDLES_OPEN_AFTER     0
PRIVATE_HANDLES_OPEN_AFTER       0
WORKSPACE_DELETED                true
WORKSPACE_VERIFIED_ABSENT        true
PRIVATE_ARTIFACT_DELETED         true
PRIVATE_ARTIFACT_VERIFIED_ABSENT true
```

---

## 7. Findings

### 7.1 Temporary storage is never measured on an aborted run

`br-receita-cnpj-full-join-engine` calls `guard.noteTemporaryStorageBytes(...)` exactly once, inside the
cleanup block that runs after the partitioned join phase. Every reference-pass abort returns before that
line. So any run that ends during a reference pass reports `temporaryStoragePeakBytes = 0`, and the
public bucket becomes `lte_16mb` — which reads as a measured, tiny footprint rather than as no
measurement at all.

The reference pass is precisely where temporary storage is created, so this is the phase whose footprint
matters most, and it is the one the instrument cannot see. This run wrote a substantial volume of
reference records to disk and reported zero.

**Not a safety hole.** `maxTemporaryStorageBytes` is independently enforced inside the workspace, which
refuses an append before crossing the cap. The envelope's own cap check lives in the uncalled observer,
so the cap has one enforcement path rather than two — but it has one.

**Consequence for Gate 2:** the temporary-storage figure the owner approved decision A partly in order
to learn was not obtained.

### 7.2 Per-phase durations were not recorded

Every entry in `phaseDurationsMs` is null and every `phase_duration_bucket` is `not_measured`. The
14B.0A calibration recorder — built specifically to supply these — is wired into the required-family
probe and the dry-run runner, but **not** into the full-join engine. The elapsed runtime therefore cannot
be attributed across preflight, manifest validation, the reference passes, cleanup and sanitization; only
`abort_stage` locates the ending.

This also blocks confirming whether `maxPhaseRuntimeMs` breached alongside `maxRuntimeMs`.

### 7.3 The public sanitizer does not run on an aborted run

`sanitizerResult` is `not_run`. The private payload builder passes `not_run` whenever the engine's abort
code is non-null, so the sanitizer is skipped on exactly the outcomes a capped benchmark is most likely
to produce. The public report's own value-free invariants still held — no exact figure, absolute path or
file name appears in it, asserted field by field — but they held by construction rather than by a
sanitizer pass.

### 7.4 `temporary_storage_policy_approved` is a hardcoded `false` in the report

`br-receita-cnpj-full-join-engine-report` declares the field with the literal type `false` and always
emits `false`. During this run the policy was approved and the workspace was created, yet the report
states the opposite. A reviewer reading the report alone would conclude no temporary storage was
authorized, which is the reverse of what happened.

### 7.5 Attempt consumption is not persisted

`BrazilReceitaFullJoinBenchmarkAttemptLedger` is an in-process closure counter, constructed fresh on
every CLI invocation, so it does not survive a process exit.
`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED` is a source constant the code only reads and reports;
nothing writes it and no gate depends on it.

`_EXECUTED` is therefore **not** a durable single-attempt lock. It has been transitioned to `true` as
the existing source of truth for the historical fact, with its assertions updated, and no second
constant was introduced. The control that prevents a second attempt remains
`..._AUTHORIZED = false`. Durable enforcement of single-attempt semantics does not exist and would have
to be built.

### 7.6 The three policy approvals collapse into one flag

14B.0F states that none of its nine declarations may be inferred from another. The operator CLI
nevertheless derives `temporaryStoragePolicyApproved`, `capInputPolicyApproved` and
`benchmarkAuthorization` from the single authorization flag. The engine's temporary-storage gate is a
genuinely independent second constant, so materializing this authorization took two source edits — but
the CAP input policy has no constant of its own.

### 7.7 The private artifact's TTL is stamped from the run's start

`writeBrazilReceitaFullJoinPrivateArtifact` stamps `created_at_ms = nowMs` and
`expires_at_ms = nowMs + ttlMs`, where `nowMs` is captured when the request is built and is never
compared against the real clock. This artifact was written hours after its own recorded expiry. The
write does not refuse and the figures stayed readable, so the defect is confined to the envelope's two
TTL fields — but any run longer than the TTL produces an artifact that is born expired.

---

## 8. Standing flags

```
FULL_SCAN_ENGINE_READY                   = true
FULL_SCAN_EXECUTION_PATH_READY           = true

REAL_FULL_SCAN_BENCHMARK_AUTHORIZED      = false   ← closed after the terminal outcome
REAL_FULL_SCAN_BENCHMARK_EXECUTED        = true    ← durable record, not a lock (§ 7.5)
TEMPORARY_STORAGE_POLICY_APPROVED        = false   ← closed
CAP_INPUT_POLICY_APPROVED                = false   ← closed

GATE2_APPROVED                           = false
GATE7_APPROVED                           = false
IMPORT_READY                             = false
RUNTIME_READY                            = false
AGENT1_READY                             = false

REAL_MANIFEST_OPENED                     = true
REAL_EMPRESAS_OPENED                     = true
REAL_ESTABELECIMENTOS_OPENED             = false   ← the run ended before this family
```

---

## 9. Gate 2

Gate 2 is the owner's decision and this document does not make it.

```
GATE2_EVIDENCE_COMPLETE  = false
GATE2_RECOMMENDATION     = DEFER
GATE2_APPROVED           = false
GATE7_APPROVED           = false
```

Evidence is **incomplete** against the § 12 contract on three counts: temporary storage was not measured
(§ 7.1), per-phase durations were not measured (§ 7.2), and the sanitizer did not run (§ 7.3). The run
also did not complete a full scan, so `measurement_complete` is false.

The recommendation is **DEFER** rather than PASS or FAIL, and the two halves point in opposite
directions. The memory result is a genuine pass: Model A held every memory ceiling across millions of
rows, the partition distribution was even, no repartitioning was needed, and the descriptor cap
introduced by 14B.0F was validated on real data. The runtime result is a decisive negative: a national
full join at this throughput is orders of magnitude outside any plausible budget, and no cap adjustment
closes that gap.

Deferring rather than failing reflects that the negative result is about throughput and instrumentation,
both of which are addressable, and not about the architecture's boundedness, which held. What the owner
needs before Gate 2 can be decided is a direction on throughput — a different I/O strategy, a coarser
partition map with a larger handle pool, or an explicitly scoped subset instead of a national full join
— plus the two missing instruments, so that the next measurement is complete.

**No second benchmark attempt is recommended, and none is authorized.**
