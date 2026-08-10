# BR-SOURCE-14B.0F — Real full-scan execution path and resource-safety closure

**Status:** implemented, **not authorized**, **not executed**
**Depends on:** BR-SOURCE-14B.0A (calibration), 14B.0C (resource envelope), 14B.0D (streaming full-join engine, PR #239, merge `b2f2cb21c73f22b9d4a67bbeb7327cbb7e3eb4c6`)

---

## 1. What this milestone is for

14B.0D built a Model A streaming full-join engine. 14B.0E audited what would be needed to actually
run it against Receita once an owner authorized it, and found four gaps. Every one of them was the
same kind of gap: a part existed, and nothing connected it.

| # | Gap found by 14B.0E | Closed by |
|---|---------------------|-----------|
| 1 | No entry point from a manifest to the engine | § 5, § 8 — `runBrazilReceitaRealFullScanResourceBenchmark()` and the manifest bridge |
| 2 | The private exact-metric channel existed but nothing fed it | § 9 — wired, and extended with the four counts it lacked |
| 3 | The workspace could hold ~4096 partition descriptors, uncounted | § 3 — bounded LRU pool + global concurrent ledger |
| 4 | No free-disk enforcement before or during a run | § 4 — `statfs`-backed preflight and in-run reserve |

**The point of the milestone:** a future authorization must be sufficient on its own. After this
change, flipping one constant is the only thing standing between the repository and a real run —
no further code change is required, and none should be written under time pressure later.

**What did not change:** authorization. `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED` is
still `false`, `..._EXECUTED` is still `false`, GATE-2 and the CAP-input policy are still unapproved,
and the real dataset was not located, opened, copied, moved or downloaded at any point.

---

## 2. The file-descriptor fix (§ 3)

### The problem, precisely

An external hash-partitioned join writes each row's reference into the partition its key hashes to,
in arrival order. Consecutive rows land in unrelated partitions, so 14B.0D's workspace opened each
partition file on first use and held it open for the whole reference pass:

```
open partition descriptors ≈ 2 × maxPartitionCount
                           = 2 × 2048
                           ≈ 4096
```

None of them were visible to 14B.0C's `maxFilesOpened`, which counts **cumulative source opens**.
Correctness therefore depended on the operator having raised `ulimit -n` to something like 8192.

**That is not a correctness argument.** A run that dies because a descriptor could not be opened has
failed for an avoidable reason, and "configure your shell first" is not a control.

### The fix

Two new mechanisms, both required, neither defaulted:

- **`BrazilReceitaFullJoinPartitionHandlePool`** — a bounded LRU over partition-file handles, capped
  by `maxOpenPartitionFiles` (proposed **32**). LRU rather than open-write-close because
  open-write-close pays two syscalls per 16-byte record over tens of millions of records; both are
  correct, one is also fast.
- **`BrazilReceitaFullJoinOpenHandleLedger`** — a **concurrent** gauge across every category
  (`source_file`, `partition_file`, `private_metric_artifact`, `control_artifact`), capped by
  `maxFilesOpened` (proposed **64**), consulted **before** every `open`.

Source descriptors reach the ledger through `withBrazilReceitaFullJoinLedgerAccounting`, which wraps
the filesystem **port** rather than the call sites — so paths written after this milestone are
covered too.

### Why eviction cannot lose a byte

Partition files are **append-only** and every write is one complete fixed-width 16-byte record. There
is no seek position to lose, no partial record to reconcile, and no buffering in the pool. A reopened
handle continues exactly where the closed one stopped, so a reopened partition file is byte-identical
to one that was never closed. The pool additionally refuses to reopen a key it did not create, which
preserves 14B.0D's guarantee that the engine never appends into a file it did not create.

### Two counters, deliberately not merged

| Counter | Question it answers | Owner |
|---------|---------------------|-------|
| 14B.0C `filesOpened` | How many times did the run open a dataset file? | resource envelope (unchanged) |
| ledger `peakOpen` | How many descriptors were held **at once**? | this milestone |

Merging them would break both: routing 1024 partition opens through the cumulative counter would trip
`files_opened_cap_exceeded` on a perfectly bounded run.

### What the tests actually measure

The decisive test writes across **1024 distinct partitions** through a filesystem port that tracks
the **live** descriptor set, and asserts the live set never exceeded 32. A separate test writes
five references into each of forty partitions through a **four-handle** pool — so nearly every write
is an eviction miss — then reads every partition back and compares field by field.

`ULIMIT_8192_REQUIRED = false`.

---

## 3. Free-disk enforcement (§ 4)

`maxTemporaryStorageBytes` bounds what the run may **write**. It says nothing about whether the volume
can accept it. Two thresholds, both re-stated from the 14B.0E profile:

| Threshold | Value | When |
|-----------|-------|------|
| `minimumFreeDiskBeforeStart` | 12 GiB | once, against the workspace **parent**, before the workspace is created |
| `minimumFreeDiskReserve` | 8 GiB | before each write block, against the **live workspace** |

Measured with `fs.statfsSync` and `bavail × bsize` — **not** `bfree`, because most filesystems reserve
a slice for the superuser and a run that treats it as usable hits `ENOSPC` while its own arithmetic
still says there is room. No `child_process`, no `df`: the policy module has no way to spawn anything,
and the probe is injected.

**An unmeasurable disk is a stopped run.** A probe that throws, returns `NaN`, `Infinity`, a negative
or a non-number is `free_disk_measurement_unavailable`, and that is terminal — the same asymmetry
14B.0C draws for memory, for the same reason: a cap you cannot measure is not a cap.

The three figures are validated **together**, because two of the constraints are relational: a reserve
above the start threshold describes a run refused the moment it starts writing, and a reserve below the
storage cap describes a run authorized to write more than it must leave free.

Reserve checks are paced by **write block** (4096 records ≈ 64 KiB), not per record: a volume cannot
lose 8 GiB between two consecutive 16-byte records.

---

## 4. The execution path (§ 5, § 8)

```
manifest
  → official validator (BR-SOURCE-6)
  → manifest → descriptor bridge          (families, paths, symlinks, archives, encoding, layout)
  → streaming full-join engine            (14B.0D, Model A)
  → NullBenchmarkSink                     (counts buckets, retains nothing, emits nothing)
  → public bucketed report                (14B.0D report + § 10 additions)
  → private exact metric artifact         (14B.0C channel, owner-only, TTL'd)
  → verified cleanup
```

### The bridge validates twice, on purpose

The official validator answers *"is this a well-formed, complete, layout-correct manifest"*. It
deliberately does **not** return resolved paths — its reports carry a `safeFileLabel` basename only.
So the bridge re-reads the document for the per-file `path` and re-applies every path rule itself.
That is not redundancy: the validator's rules protect **its report**; these rules protect a descriptor
about to be handed to something that will `open` it.

Refused: absolute paths, `..` traversal (refused, never normalized), escape from the manifest root,
symlinks at the leaf **and** any realpath that lands outside the root, archives (by name, so the
diagnosis is `archive_not_allowed` rather than `unsupported_extension`), unauthorized families
(`socios`, `qsa`, anything invented), duplicate families, non-official encoding / delimiter / layout.

Reference families (`cnaes`, `municipios`, `naturezas`, `simples`) are carried as **lookups** in a
separate field and are never shaped as engine descriptors — a reference family in `joinSources` would
be traversed to EOF.

### The official validator is injected, not imported

§ 15 forbids opening the real manifest anywhere in this milestone. A bridge that imported
`validateBrReceitaCnpjLocalManifest` directly would `stat`, `sha256` and header-read whatever path it
was handed. Injected, the entry point supplies the real validator and every test supplies a scripted
one — and *"the entry point uses the official validator"* becomes a fact a static test checks at the
call site.

---

## 5. The hard gate (§ 6)

Nine declarations are required, and **not one is inferred from another**:

`temporaryStoragePolicyApproved` · `capInputPolicyApproved` · `benchmarkAuthorization` ·
`attemptCount = 1` · `datasetPeriod` · manifest declarations · `privateMetricChannelAcknowledgement` ·
all resource caps · workspace constraints

Inference is how a partial authorization becomes a full one: an operator approves the thing they were
asked about, and the code quietly reads a second approval out of it. Each declaration is checked on its
own terms — `true` where `true` is required, `1` where `1` is required, the exact acknowledgement
phrase where the phrase is required — because "present and truthy" is how `"no"` becomes an approval.

Preflight order, and why:

1. `operator_working_directory` — the only hazard that can damage something **outside** this run
2. `declarations`
3. `resource_caps` — 14B.0C § 5: validated before the first real access
4. `handle_caps` — § 3's two new caps, validated together
5. `no_write_contract` — the 11A guard over the whole configuration
6. `zero_output` — `maxOutputRows` must be **exactly** zero
7. `private_metric_channel` — resolved **before** the run, so six hours of work cannot end with
   nowhere to put the figures
8. `single_attempt` — consumed only once the run is otherwise well-formed, so a typo does not burn it
9. `authorization` — **last**, and the one that stops every run today

Any refusal reports `ABORT_BEFORE_REAL_FILE_OPEN` — a stronger claim than 14B.0C's
`ABORT_BEFORE_DATA_ACCESS`: not merely that no row was read, but that no real file was opened at all,
including the manifest.

---

## 6. Metrics (§ 9, § 10)

**Public** — buckets and closed enums only. The output sanitizer is **untouched**: no exemption, no
widened digit ceiling. `filesOpenedPeakBucket` is new; the exact peak never appears.

**Private** — exact figures, off-repo, off-`$HOME`, `0600`, atomic (`wx` + `fsync` + `rename`),
TTL 3 600 000 ms, verifiably deletable, disabled unless the acknowledgement phrase is exact. This
milestone added the four counts it lacked: `partitionsCreated`, `largestPartitionReferenceCount`,
`filesOpenedPeak`, `partitionHandlePeakOpen`.

`filesOpenedPeak` is the one that could not be derived from anything that existed before — the
enforcer's `filesOpened` is cumulative and never falls, so it cannot answer *"how many descriptors
were held at once"*, which is precisely the question the 4096-handle finding raised.

A runtime validator re-checks the serialized payload for identifier-shaped digit runs, hash-shaped
values, path-shaped values and any string outside a seven-member allowlist.

---

## 7. Proposed caps (§ 11)

**`PROPOSED_BENCHMARK_CAPS` — `NOT_PRODUCTION_CAPS`.** Nothing defaults to this profile; a caller who
wants it passes it.

```
maxRssBytes                   =    536_870_912      maxBytesRead                = 73_014_444_032
maxHeapUsedBytes              =    134_217_728      maxRowsRead                 =    360_000_000
maxExternalMemoryBytes        =     67_108_864      maxJoinKeysInMemory         =        131_072
                                                    maxOutputRows               =              0
maxRuntimeMs                  =     21_600_000
maxPhaseRuntimeMs             =     21_600_000      partitionCount              =          1_024
                                                    maxPartitionCount           =          2_048
maxTemporaryStorageBytes      =  4_294_967_296      maxPartitionDepth           =              1
minimumFreeDiskBeforeStart    = 12_884_901_888      maxReferencesPerPartition   =        131_072
minimumFreeDiskReserve        =  8_589_934_592      maxReferenceBytesPerPartition =      2_097_152

maxFilesOpened                =             64      maxChunkBytes               =      4_194_304
maxOpenPartitionFiles         =             32      maxCarryBytes               =         65_536
                                                    maxRowBytes                 =         65_536
privateMetricArtifactTtlMs    =      3_600_000      maxColumnsPerRow            =             64

attemptCount = 1                                    automaticRetryCount = 0
```

### The six hours are a budget, not a prediction

```
OWNER_BUDGET_CEILING
NOT_OBSERVED_RUNTIME
NOT_ESTIMATED_RUNTIME
```

Nobody has run this. Nobody has modelled it — 14B.0C's runtime derivation still refuses for lack of a
throughput observation, and multiplying a coarse duration bucket by a dataset size would produce a
number with the shape of evidence and none of the content.

**Exhausting either runtime cap is a valid benchmark result.** `runtime_cap_exceeded` and
`phase_runtime_cap_exceeded` do **not** authorize a retry. The temptation is specific and strong: a
six-hour run that stops at six hours feels like one that nearly worked, and a second attempt would
spend another six hours reaching the same wall — in a process whose heap is already grown.

---

## 8. Cleanup ordering (§ 12)

On success, cap breach, sink failure, private-metric failure, free-disk breach, malformed source,
partition failure and runtime limit alike:

1. stop reading
2. close all source handles
3. close the partition handle pool *(before deletion — unlinking a file the process still holds open
   leaves the space allocated, so deleting first could report `completed` while the volume was still
   full)*
4. close private artifact handles
5. delete the partition workspace
6. verify absence
7. **preserve the primary abort code** — a run that breached a memory cap and then cleaned up badly
   reports the memory breach, because that is what happened first
8. report cleanup status

`failed` and `unverified` stay distinct — "could not finish" and "cannot be proven finished" are
different facts — and **neither** permits a successful overall result.

---

## 9. Standing flags

```
PR_239_MERGED                            = true   (b2f2cb21c73f22b9d4a67bbeb7327cbb7e3eb4c6)
BR_SOURCE_14B_0D_OFFICIAL                = true
FULL_SCAN_ENGINE_READY                   = true
FULL_SCAN_EXECUTION_PATH_READY           = true   ← new
BENCHMARK_PROFILE_IMPLEMENTABLE          = true   ← new

REAL_FULL_SCAN_BENCHMARK_AUTHORIZED      = false
REAL_FULL_SCAN_BENCHMARK_EXECUTED        = false
CAP_INPUT_POLICY_APPROVED                = false
GATE2_APPROVED                           = false
GATE7_APPROVED                           = false
IMPORT_READY                             = false
RUNTIME_READY                            = false
AGENT1_READY                             = false

REAL_MANIFEST_OPENED                     = false
REAL_EMPRESAS_OPENED                     = false
REAL_ESTABELECIMENTOS_OPENED             = false
```

`GATE2_READY_FOR_OWNER_REVIEW = false`, and that is not a function of how finished the code is. GATE-2
is a decision about what a real run **costs**; the answer comes from the benchmark, so it cannot be a
precondition for it.

---

## 10. Operator note — cloud sync

The workspace boundaries are **declared** by the operator, and no module here reads an environment
variable to discover them. Whether the chosen volume is cloud-synced (iCloud, Dropbox, OneDrive) is a
fact about the operator's machine that no code here can establish, so it remains an **operator
attestation** rather than a check that would give false assurance.
