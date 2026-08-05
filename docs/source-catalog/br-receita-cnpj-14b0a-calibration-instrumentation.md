# BR-SOURCE-14B.0A — Bounded calibration instrumentation

**Status:** instrumentation delivered; **real calibration NOT executed.**
**Scope:** `syntheticOnly = true`, `scope = 'synthetic_validation_only'`.

BR-SOURCE-14A closed with the owner authorizing exactly one thing beyond the deferred gates: a
single **read-only calibration** of the real BR-SOURCE-11G join probe, at the caps that are already
the 11G constants (`40 / 40 / 0 / 0`). That calibration could not be delivered, for two independent
reasons:

1. **No instrument.** Five of the eleven required metrics — peak RSS, peak heap, total duration,
   per-phase duration, and peak temporary storage — had no measurement code behind them.
2. **No staged input.** The owner authorized *opening* prepared files, not *acquiring* the bulk RFB
   dataset. Nothing is staged.

This milestone removes reason (1) and **only** reason (1). Reason (2) stands:

```text
REAL_CALIBRATION_BLOCKED_BY_STAGING = true
```

No gate moved, no flag moved, no owner decision is encoded anywhere in this repository.

---

## 1. What was added

| Artifact | Role |
|---|---|
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-calibration-instrumentation.ts` | The instrument: injectable monotonic clock, injectable memory sampler, phase/sample recorder, centralized buckets, sanitized measurement projection. |
| `br-receita-cnpj-required-family-join-probe.ts` | Optional `calibrationRecorder` observer + four probe-owned phase/sample call sites. |
| `br-receita-cnpj-full-join-dry-run-runner.ts` | Optional `calibrationRecorder` input (excluded from the no-write guard config, as an injected port) + four runner-owned call sites. |
| `scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run.ts` | Opt-in `--calibration-instrumentation` flag, 11G-only, fail-closed elsewhere. |

The recorder is **optional everywhere**. With it absent, every call site collapses to an
optional-call no-op and the run is byte-identical to the pre-14B.0A behaviour — asserted by
`deepEqual` on the whole report, not by inspection.

---

## 2. Metric contract

Every magnitude is a **bucket**. Three independent reasons, any one sufficient:

1. The full-join output sanitizer rejects any numeric leaf at or beyond eight digits
   (`oversized_numeric_value`). A peak RSS in bytes is eight to ten digits, so an exact figure
   could not ship even if it were desirable.
2. A duration and a resident-set size are weak side channels on the bytes and rows read.
3. GATE-2 needs orders of magnitude, not microseconds.

If a later gate needs exact figures, they belong in a **private operator artifact outside this
repository**. The versioned report stays bucketed.

### Emitted fields

```text
measurement_version                    1
measurement_complete                   boolean
instrumentation_failure_policy         instrumentation_failure_marks_measurement_incomplete_and_preserves_original_failure
instrumentation_failure_count          number
peak_rss_bucket                        lte_16mb | lte_64mb | lte_256mb | lte_1gb | lte_4gb | gt_4gb | not_measured
peak_heap_used_bucket                  (same domain)
peak_external_memory_bucket            (same domain)
memory_observations_taken              number
total_duration_bucket                  lte_1ms | lte_10ms | lte_100ms | lte_1s | lte_10s | lte_60s | gt_60s | not_measured | not_separable
phase_duration_buckets                 { <phase>: <duration bucket> }
non_separable_phases                   { join: estabelecimentos_read }
temporary_storage_mode                 disabled | observed
temporary_storage_peak_bytes           number (0 when disabled)
temporary_storage_observation          not_applicable_no_workspace_created | workspace_created_peak_observed
temporary_workspaces_created           number
sample_points_observed                 ordered list, as OBSERVED
exact_values_printed                   false
raw_memory_observations_printed        false
raw_timestamps_printed                 false
absolute_paths_printed                 false
file_names_printed                     false
```

Never emitted: absolute paths, real file names, raw timestamps, raw memory snapshots, raw rows,
CNPJ, join keys, company names, samples, identifiers, identifier-derived hashes, environment
variables, hostnames, usernames.

### Phases

Closed set, non-overlapping, single-owner, taken from the **real** structure of the 11G run:

| Phase | Owner | Boundary |
|---|---|---|
| `preflight` | runner | Entry through the end of the join gate. Spans **every** pre-probe validation, including the runner-level manifest metadata gate. Closes before any descriptor exists. |
| `manifest_validation` | probe | Probe entry through completed file selection: read-time cap re-check, bounded manifest control-document read, JSON parse, family classification, one-file-per-required-family selection. |
| `empresas_read` | probe | Bounded prefix read of the first required family, **including** building the capped join-key window. |
| `estabelecimentos_read` | probe | Bounded prefix read of the second required family, **including the join's membership tests**. |
| `join` | — | **`not_separable`.** See below. |
| `cleanup` | runner | The cleanup plan call. |
| `sanitization` | runner | The output sanitizer call. |
| `total` | runner | Entry through the end of sanitization. |

**Why `join` is not timed.** The 11G join is not a stage that runs after the reads — it is a
membership test performed *inside* them: the first family's read adds each parsed key to the bounded
window, the second family's read tests each parsed key against it. There is no instant at which
"the join begins". The only separable remnant is turning two tallies into buckets and releasing the
window; timing that and calling it "the join" would report the join as effectively free while its
real cost sits in `estabelecimentos_read`. So `join` is reported as `not_separable` with a pointer
to where its cost actually lives. A reader learns the truth; a reader of a fabricated
`join: lte_1ms` would not.

### Sample points

```text
before_preflight → after_manifest_validation → after_empresas_read
  → after_estabelecimentos_read → after_join → after_cleanup → after_sanitization
```

`after_cleanup` precedes `after_sanitization` because that is the **real order** of the runner: the
cleanup plan is assembled into the candidate report, and the assembled report is then sanitized.
The instrumentation reports the order it observed and does not reorder the run to match a tidier
list. Sampling happens at fixed synchronous call sites only — **no timer, no interval, no async
task**, so nothing here can keep the process alive or leak a handle.

### Two clocks, never mixed

The probe's existing `nowMs` is a **wall** clock and stays exactly what it was: the instrument for
the liveness deadline. Durations come only from an injected **monotonic** clock
(`process.hrtime.bigint()`). The two are never combined into one figure, and a negative interval is
reported as `not_measured` rather than as the smallest bucket — a monotonic clock cannot go
backwards, so a negative difference means the ruler broke.

### Temporary storage

For the 11G path as it exists:

```text
temporary_storage_mode        = disabled
temporary_storage_peak_bytes  = 0
temporary_storage_observation = not_applicable_no_workspace_created
```

This is **derived**, not asserted: the recorder counts workspace creations, nothing in the
instrumented 11G path calls `noteTemporaryWorkspaceCreated`, so the count is zero and the mode
follows from it. The alternative — inspecting the filesystem for temporary files — would be both a
lie (it cannot attribute a file to this run) and a violation (it would name operator paths). The
recorder *does* have a truthful place to report a real workspace, which is what makes today's zero a
measurement rather than a hardcoded claim.

### Instrumentation-failure policy

Selected: **`instrumentation_failure_marks_measurement_incomplete_and_preserves_original_failure`**
(over `instrumentation_failure_is_terminal`).

A terminal policy would let a throwing memory sampler abort an otherwise-valid run, turning an
observation into a control-flow participant and changing the exit status of the very thing it was
added to watch. That breaks the compatibility obligation and fails closed in the wrong direction: a
broken **ruler** is not a broken **run**. So an instrumentation failure is contained — the offending
sample is dropped, `instrumentation_failure_count` increments, `measurement_complete` becomes
`false`, and control flow is untouched.

This is not a swallowed error: the degradation is a first-class reported field, and a consumer that
needs a trustworthy calibration must check `measurement_complete`. The asymmetry that matters is
that instrumentation can never make a failed run look successful, because it has no channel into the
report at all.

---

## 3. Synthetic execution instructions

The instrumentation is validated **exclusively** by tests and synthetic execution.

```bash
npm run test:br-source:14b0a-calibration-instrumentation
```

Full 11G / full-join family regression (now includes the new suite):

```bash
npm run test:br-source:11-full-join-runner
```

The CLI surface is exercised end-to-end against a synthetic manifest by the suite's
`CLI synthetic smoke` block, which drives the real `main()` entry point and captures stdout,
stderr and the exit code. There is no manual step, and **no invocation against real data is part of
this milestone.**

Output shape under the flag (JSON): the report keeps its exact published contract and moves under a
`report` key, with the measurement beside it —

```text
{ "report": { … unchanged … }, "calibration_measurement": { … } }
```

Without the flag there is no envelope: the report *is* the document, byte-identical to every earlier
hito. In text format the measurement is an appended `calibration_measurement:` section.

---

## 4. Staging readiness audit (read-only)

What the **operator** must provide before the single authorized real calibration can run. This is a
declaration of the required *shape*, derived from the code. **No path, no location, and no dataset
value appears here or anywhere in the repository.**

### `required_manifest_shape`

- One JSON **control document**, extension `.json`, not a URL.
- At most `1_000_000` bytes. A document larger than the stated ceiling is refused outright — a
  truncated JSON document is a different document, not a smaller one.
- Top-level `files`: an array, at most `20` entries.
- Top-level `layoutMode`: `official_headerless`.
- Each entry: `{ fileType, path, encoding?, layoutMode? }`.
- Declared `path` must be **relative**, must resolve **inside the manifest's own directory**, must
  not be absolute, must not be a URL, must not traverse out with `..`.
- Metadata-gate fields the manifest is additionally classified on: `sourceKey`, `countryCode`,
  `sourceYear`, `sourcePeriod`, `mode`.

### `required_file_families`

- **Required, opened, one file each:** `empresas`, `estabelecimentos`. The first builds the key
  window; the second is tested against it.
- **May be declared and counted, never opened:** `simples`, `cnaes`, `municipios`, `naturezas`.
- **Forbidden — refuses the whole run:** any family whose label carries a personal-data token
  (Sócios / QSA / CPF).

### `required_layout declarations`

- `layoutMode = official_headerless`, at manifest level or per entry.
- `encoding`: `latin1` or `utf8` (anything else is classified `unknown_or_invalid`).
- Delimiter: `;` — the official headerless layout.
- Data-file extension allowlist: `.csv`, `.txt`.
- Archive extensions refused outright: `.zip`, `.gz`, `.gzip`, `.tar`, `.tgz`, `.7z`, `.rar`,
  `.bz2`, `.xz`, `.zst`. **Files must already be extracted.** A cap in bytes of compressed input is
  not a cap on decompressed content.
- Declared data paths may not sit under a ZIP-staging segment: `raw-zips`, `raw_zips`.

### `required CLI declarations`

```text
--required-family-join-probe
--required-family-join-probe-authorized
--real-local-join-dry-run-authorized
--required-family-probe-authorized
--real-manifest-metadata-only
--real-manifest-metadata-execution-authorized
--allow-local-manifest
--strict
--manifest <operator-supplied>
--calibration-instrumentation
```

### `required cap arguments`

```text
--max-manifest-bytes              1000000
--max-declared-files              20
--max-files-opened                2
--max-bytes-per-file              64000
--max-rows-per-file               20
--max-total-rows                  40
--max-total-bytes                 128000
--max-join-input-rows             40
--max-join-key-values-in-memory   40
--max-join-pairs-emitted          0
--max-joined-rows-printed         0
```

The last two are **equalities at zero**, not ceilings: a value above zero is refused with its own
join-output code, because asking for one join pair is an unauthorized capability rather than a wider
probe. A fixed internal liveness deadline of `30_000` ms also applies and no flag can widen it.

### `required authorization declarations`

All five, none of which substitutes for another:

1. `realManifestMetadataOnlyOptionBAuthorized` — a manifest may be read at all.
2. `realManifestMetadataOnlyExecutionAuthorized` — the operator's own prepared manifest may be named.
3. `requiredFamilyProbeAuthorized` (11F) — the two required-family files may be opened.
4. `requiredFamilyJoinProbeAuthorized` (11G Option C) — the protected technical join key may be
   parsed and compared.
5. `realLocalJoinDryRunAuthorized` — the bounded join may run against the operator's local files.

### Conclusion

```text
REAL_CALIBRATION_BLOCKED_BY_STAGING = true
```

Two blockers stand, independently:

- **No staged input.** The owner authorized *opening* prepared files, not *acquiring* the bulk RFB
  dataset. Staging requires a separate authorization.
- **This PR is not merged.**

---

## 5. Explicitly NOT done

```text
REAL_MANIFEST_OPENED            = false
REAL_EMPRESAS_OPENED            = false
REAL_ESTABELECIMENTOS_OPENED    = false
REAL_CALIBRATION_EXECUTED       = false
DATASET_DOWNLOADED              = false
DATASET_COPIED                  = false
DATASET_EXTRACTED               = false
FULL_JOIN_EXECUTED              = false
IMPORT_EXECUTED                 = false
SUPABASE_WRITE                  = false
RUNTIME_CHANGED                 = false
AGENT1_CHANGED                  = false
GATES_CHANGED                   = false
OWNER_DECISIONS_CODED_IN_REPO   = false
```

Unchanged and still `false`: `OPS_BR_CAP_INPUT_POLICY_APPROVED`, `OPS_BR_GATE2_APPROVED`,
`OPS_BR_GATE7_APPROVED`, `OPS_BR_CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZED`,
`FULL_JOIN_EXECUTION_READY`, `IMPORT_READY`, `RUNTIME_READY`, `AGENT1_READY`,
`OPS_BR_READY_FOR_IMPORT`, `OPS_BR_READY_FOR_RUNTIME`, `OPS_BR_LIVE_PROSPECT_GENERATION_READY`.

A green measurement says a bounded join **mechanism** was observed under caps. It is not evidence
about coverage, join rates, quality, eligibility, GATE-1, GATE-2, or GATE-7, and it approves
nothing.
