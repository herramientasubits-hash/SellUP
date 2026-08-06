# BR-SOURCE-14B.0C — Full-join resource envelope closure

**Status:** resource controls delivered; **full-scan benchmark NOT authorized and NOT executed.**
**Headline finding:** the full join **does not exist**. The audit classified the current
implementation as **Model D**.

BR-SOURCE-14B.0A delivered the instrument that *measures* a bounded run. This milestone was to close
the remaining controls so that full-join caps could responsibly be proposed: audit the real runner,
determine whether its memory stays bounded across a whole dataset, add hard operational caps, add a
private channel for exact metrics, and prepare a single read-only full-scan benchmark.

Four of those five are delivered. The second one could not be answered as asked, and the reason is
the most important sentence in this document:

> There is no full-join runner to audit for unbounded growth, because there is no code path that
> processes a whole file.

---

## 1. § 3 audit — what the "full join" actually is

The audit traced every real-data reader reachable from `FULL_JOIN_EXECUTION_READY`.

| Question | Answer |
|---|---|
| `FULL_JOIN_IMPLEMENTATION_EXISTS` | **false** (for a full scan; extensive bounded scaffolding exists) |
| `FULL_JOIN_IS_STREAMING` | **n/a** — no reader streams; each performs one bounded prefix read |
| `FULL_JOIN_MATERIALIZES_EMPRESAS` | **false** — only a capped prefix is decoded |
| `FULL_JOIN_MATERIALIZES_ESTABELECIMENTOS` | **false** — only a capped prefix is decoded |
| `FULL_JOIN_MATERIALIZES_JOIN_INDEX` | **false** — a `Set` capped by construction, cleared before emit |
| `JOIN_INDEX_STRUCTURE` | `Set<string>` of parsed root keys, one per bounded window |
| `JOIN_INDEX_GROWTH_DRIVER` | **a constant, not the dataset** (40 values in 11G, 400 in 11I) |
| `TEMP_STORAGE_REQUIRED` | **none** — zero workspaces are created on any executed path |
| `OUTPUT_ROWS_MATERIALIZED` | **zero** — the join is a membership test, never a materialization |

### The decisive evidence

Every real-data read in the join path has this shape:

```ts
const buffer = Buffer.alloc(byteBudget);
bytesRead = fs.readSync(fd, buffer, 0, byteBudget, 0);   // ← position 0, once
```

All eight `readSync` call sites across the required-family probe, the required-family **join** probe
and the aggregate join-coverage signal pass position `0`. **None advances a file position**; there is
no read loop, no second read, and therefore no path that observes more than a fixed prefix
(64 KiB per file in 11G, 512 KiB in 11I). The only routine that joins companies to establishments
across a whole collection — `scoreSyntheticJoin` — operates on an in-memory **synthetic fixture** and
slices it to `maxCompanyScanRows`.

The two modules that *do* advance a file position (`local-dry-run`, `privacy-safe-classifier`) are
bounded sample readers and are not the join.

This evidence is now held by a test, so an added read loop or a non-zero position argument breaks the
build rather than silently changing the classification.

## 2. § 4 classification

```text
FULL_JOIN_MODEL = D  (full join not implemented)
```

- **Model A** (fully bounded streaming) — not applicable: nothing streams a whole file.
- **Model B** (growing index) — not applicable: the index is capped by a constant.
- **Model C** (materialization) — not applicable: nothing materializes.
- **Model D** — **selected.** Scaffolding is extensive; an executable full-scan route does not exist.

Per the milestone's own rule, only Model A may proceed directly to a benchmark. **Model D requires
implementation, not authorization** — which is why this milestone does not ask for one.

### Why the benchmark was not quietly pointed at a probe

A "full-scan benchmark" that measured a 64 KiB prefix while carrying that name would be the most
misleading artifact this milestone could produce: GATE-2 would be asked to approve production caps
derived from a run that touched roughly a millionth of the input. The mode is therefore built
completely and **refuses**, with `full_join_implementation_missing` behind an authorization gate that
refuses first.

## 3. § 5 hard operational caps

`br-receita-cnpj-full-join-resource-envelope.ts`. Eleven caps, all **required**:

`maxRssBytes` · `maxHeapUsedBytes` · `maxExternalMemoryBytes` · `maxRuntimeMs` ·
`maxPhaseRuntimeMs` · `maxTemporaryStorageBytes` · `maxFilesOpened` · `maxBytesRead` ·
`maxRowsRead` · `maxJoinKeysInMemory` · `maxOutputRows`

Rules enforced by code and by test:

- **Absent is never unlimited.** Missing, `null`, `NaN`, `Infinity`, negative and fractional caps are
  each a distinct refusal to start. `Infinity` is refused by name — it is the one input that is
  syntactically a number and semantically "no cap".
- **Zero is a real bound**, distinct from absence.
- Caps are validated **before the first real access**; until validation succeeds, every counter
  refuses and `mayAccessData()` is `false`.
- Memory and time are re-checked at **deterministic checkpoints** (fixed call sites, never a timer —
  a non-deterministic abort point is not auditable).
- The resolved cap set is **frozen**; there is no widening path and no setter.
- A breach **latches**: a caller that ignores the first refusal cannot obtain a clean outcome
  afterwards.
- **No retry** (`BRAZIL_RECEITA_FULL_JOIN_AUTOMATIC_RETRY_COUNT = 0`, structural), no widening, no
  algorithm downgrade, and **no continuation past a failed or unverified cleanup**.

### The deliberate divergence from 14B.0A

14B.0A **contains** instrumentation failure: a broken ruler is not a broken run. 14B.0C makes it
**terminal**:

```text
measurement_failure_is_terminal_because_an_unmeasurable_cap_is_not_a_cap
```

The two modules have opposite duties, and both fail in the direction that cannot cause an unbounded
run. Anyone "making them consistent" should change neither.

All fourteen terminal codes from § 5 are implemented and exercised: the eleven cap breaches plus
`measurement_unavailable`, `cleanup_failed` and `cleanup_unverified`.

## 4. § 6 + § 7 two metric channels, sanitizer untouched

| Channel | Content | Where it may go |
|---|---|---|
| `publicSanitizedMeasurements` | buckets and small counts only | versioned report, stdout, review |
| `privateOperatorMeasurements` | exact figures | operator-only file, off-repo, TTL'd |

**The public sanitizer was not relaxed.** No exemption was added, the digit ceiling was not moved,
and no field-name escape hatch exists. Two reasons, either sufficient:

1. `oversized_numeric_value` is the check that stops a 14-digit CNPJ reaching a report as a number.
   Relaxing it to admit a byte count admits an identifier at the same time.
2. A name-based exemption (`allow anything ending in Bytes`) would make the sanitizer's verdict depend
   on a string a future author picks, so `cnpjBytes` would pass. **Naming is not a security
   boundary.**

Instead the exact figures travel a **separate, typed, explicitly-constructed** path that never enters
the public report object. The public type has no numeric field wider than a small count, so it
*cannot* carry an exact figure.

One real finding came out of this: the public bucket was initially named `join_keys_peak_bucket`, and
the existing sanitizer **correctly rejected it** — it refuses any join-key-shaped *key name*, because
a reviewer cannot distinguish a count called `join_keys_*` from a payload called `join_keys_*`. It is
now `in_memory_key_window_peak_bucket`.

### Private artifact obligations (all enforced and tested)

Disabled by default · exact literal operator acknowledgement (not a boolean) · never stdout or stderr
· never inside the repository · never inside `$HOME` (which is itself a git repository, § 10) · never
inside the dataset · owner-only `0600`, **verified by reading the mode back** · atomic
(`wx` + `fsync` + `rename`, sibling temp file) · positive TTL under a hard 24 h ceiling · deletable
with **verified absence** · process metrics only, re-validated at runtime against a string
**allowlist**.

Every failure path removes the temporary file: a failed write leaves **no** exact figures on disk. An
artifact whose permissions cannot be verified is deleted rather than left at unknown permissions.

```text
PRIVATE_EXACT_METRIC_CHANNEL_READY = true   (mechanism ready; still disabled by default)
```

## 5. § 8 provisional caps and the runtime model

Proposed, and justified by the only measurement that exists (14B.0A observed
`peak_rss_bucket = lte_256mb`, heap and external `lte_16mb`):

```text
maxRssBytes              = 536870912   (512 MiB — one bucket of headroom)
maxHeapUsedBytes         = 67108864    (64 MiB  — two buckets)
maxExternalMemoryBytes   = 67108864    (64 MiB)
maxTemporaryStorageBytes = 0           (GATE-2 not approved)
maxOutputRows            = 0           (an emitted row would be an import)
automaticRetryCount      = 0
```

```text
BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_CAP_APPROVAL_STATUS
  = proposed_for_synthetic_preparation_only_not_approved_for_production
```

**`maxRuntimeMs` is deliberately NOT proposed.** The milestone forbids picking it arbitrarily, and
there is no throughput evidence: the only observation comes from a 128 KiB bounded prefix read whose
duration is reported as a coarse bucket, which supports no bytes-per-millisecond figure at all.
Multiplying a bucket by a dataset size would produce a number with the shape of evidence and none of
the content.

So `deriveBrazilReceitaFullJoinRuntimeCapProposal()` exists and **refuses**:

```text
RUNTIME_CAP_DERIVATION = insufficient_evidence
```

Six caps are left for the operator to supply explicitly — `maxRuntimeMs`, `maxPhaseRuntimeMs`,
`maxFilesOpened`, `maxBytesRead`, `maxRowsRead`, `maxJoinKeysInMemory`. The four counting caps are
properties of a full-scan algorithm that does not exist; inventing them would describe a runner
nobody has written. The gap is visible and fails closed rather than defaulting.

Three figures are kept as distinct names, because collapsing them is how an estimate becomes an
authorization: `estimated_runtime` · `authorized_runtime_cap` · `observed_runtime`.

## 6. § 9 + § 10 benchmark mode, prepared and refusing

Mode `full_join_resource_benchmark`. Ordered fail-closed preflight, every stage before data access:

1. `operator_working_directory` → `unsafe_operator_working_directory`
2. `resource_caps` → `resource_caps_incomplete`
3. `single_attempt` → `single_attempt_already_consumed`
4. `authorization` → `benchmark_not_authorized`
5. `full_join_implementation` → `full_join_implementation_missing`

The order is a safety property. An unsafe cwd is the one hazard that can damage something *outside*
the run, so it is caught first; the single attempt is consumed only once the request is otherwise
well-formed, so **a caps typo does not burn the operator's one attempt**.

### § 10 home-repository protection

The dataset sits inside an operator `$HOME` that is itself a git repository, so a stray `git add`
from the wrong directory would stage gigabytes of Receita data. All four invariants hold:

```text
currentWorkingDirectoryMustNotBeHome     = true
repositoryRootMustBeSellUpWorktree       = true
datasetRootMustNotEqualRepositoryRoot    = true
noGitCommandMayRunWithCwdDatasetRoot     = true
```

The last one is **guaranteed rather than promised**: these modules contain no `child_process`
reference at all, asserted by a static guard. A module that cannot run git anywhere cannot run git
from the dataset root. No `.gitignore` was created, `.git/info/exclude` was not touched, and the
dataset was neither read, moved, copied nor modified.

```text
REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false
REAL_FULL_SCAN_BENCHMARK_EXECUTED   = false
```

Both are `false` **literals**, not configuration: no run, environment variable or caller can flip
them. Changing either takes a source edit, a PR and an owner decision.

## 7. Tests

`npm run test:br-source:14b0c-full-join-resource-envelope` — **367 tests, 367 pass, 0 fail**
(111 new, plus the 14B.0A, 11G, sanitizer, cleanup and no-write-guard suites it re-runs).

Full connector directory: **1590 tests, 1590 pass, 0 fail.** Regression suites 13A–14B.0A all green;
`test:agent2a:automatic-routing` (the required CI check) 50/50. Typecheck 0 errors, ESLint clean on
every touched file, CLI synthetic smoke unchanged (`full_dataset_processed: false`, all eight gates
`not_approved`). Three consecutive runs agree exactly.

All thirty required areas are covered, including: algorithm classification; each of the eleven hard
caps; missing-cap-before-file-access; cap breach without retry; cleanup after breach; public report
stays bucketed; exact values rejected from the public report; the private artifact's authorization,
paths, identifiers, permissions, atomicity, TTL and verified deletion; the benchmark touching no
Supabase, runtime or Agent 1; zero rows; refusal without authorization; `$HOME` and dataset-root cwd
aborts; two attempts rejected; and no automatic retry.

## 8. What this milestone did NOT do

No dataset was opened, no real manifest was read, no Empresas or Estabelecimentos file was touched,
no benchmark ran. No Supabase, migration, `source_company_snapshots`, runtime, Agent 1, Agent 2A,
provider, HubSpot or UI code was modified. No gate moved, no flag moved, and no owner decision is
encoded anywhere in this repository.

```text
REAL_MANIFEST_OPENED                = false
REAL_EMPRESAS_OPENED                = false
REAL_ESTABELECIMENTOS_OPENED        = false
REAL_FULL_SCAN_BENCHMARK_EXECUTED   = false
FULL_JOIN_EXECUTED                  = false
IMPORT_EXECUTED                     = false
SUPABASE_WRITE                      = false
RUNTIME_CHANGED                     = false
AGENT1_CHANGED                      = false
GATES_CHANGED                       = false
OWNER_DECISIONS_CODED_IN_REPO       = false
HOME_GIT_REPOSITORY_TOUCHED         = false
DATASET_MOVED                       = false
DATASET_COPIED                      = false
DATASET_MODIFIED                    = false
```

Unchanged and still `false`: `OPS_BR_CAP_INPUT_POLICY_APPROVED`, `OPS_BR_GATE2_APPROVED`,
`OPS_BR_GATE7_APPROVED`, `OPS_BR_CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZED`,
`FULL_JOIN_EXECUTION_READY`, `IMPORT_READY`, `RUNTIME_READY`, `AGENT1_READY`,
`OPS_BR_READY_FOR_IMPORT`, `OPS_BR_READY_FOR_RUNTIME`, `OPS_BR_LIVE_PROSPECT_GENERATION_READY`.
`REAL_CALIBRATION_BLOCKED_BY_STAGING` remains `true`.

## 9. Evidence readiness

```text
CAP_INPUT_POLICY_READY_FOR_OWNER_REVIEW      = partial
GATE2_READY_FOR_OWNER_REVIEW                 = false
FULL_SCAN_BENCHMARK_READY_FOR_AUTHORIZATION  = false
```

`CAP_INPUT_POLICY` is *partial*: the memory, temporary-storage and output caps are proposed with
justification, and the six evidence-free caps are explicitly named as gaps rather than filled.

GATE-2 is not ready, and the reason is not a missing control — every control is built and tested. It
is that a temporary-storage envelope cannot be sized against an algorithm that does not exist. A
GATE-2 approval today would be an approval of an unwritten runner.

## 10. Next action

```text
FULL JOIN IMPLEMENTATION REQUIRED
```

The controls in this milestone are complete and hold Model A to account the moment it exists. What is
missing is the streaming full-join implementation itself: a reader that advances through Empresas and
Estabelecimentos under the caps defined here, keeping peak memory independent of row count. When that
lands as **Model A**, this milestone's `preflight` already gates it, and the benchmark becomes a
question of authorization rather than of construction.
