# BR-SOURCE-ATTEMPT2-OPS — Attempt #2 operator enablement

**Status:** merged code, **no authorization**. `ATTEMPT_2_AUTHORIZED = false`.
**Scope:** operator plumbing only. No engine change, no cap change, no dataset access, no benchmark run.

---

## 1. What was broken

The owner authorized the second real full-national benchmark, and the run could not be started. Two
independent hard stops, both preboundary, both structural rather than accidental.

### Hard stop A — the authorization was not representable

`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false as const` was the only way for the entry
point's `authorization` stage to open, and the benchmark CLI read **all three** policy approvals out of
that one constant:

```ts
temporaryStoragePolicyApproved: BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
capInputPolicyApproved:         BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
benchmarkAuthorization:         BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZATION_FLAG,
```

So an owner decision about one invocation could only be expressed as a tracked source edit — an
authorization with no expiry, applying to every future run of every future shape — and three separate
approvals collapsed back into one value, which is the inference 14B.0F § 6 exists to forbid.

### Hard stop B — the completeness gate had no inputs

14B.0K landed the **expected** side (the Receita's own 2026-07 part-identity listing) and 14B.0K's
resolution CLI compares it against a staging directory. The **benchmark** CLI — the one an operator
actually runs — handed the gate:

```ts
nationalInputCompleteness: evaluateBrazilReceitaNationalInputCompleteness({
  period: options.datasetPeriod,
  observed: null,
  expected: null,
}),
```

`indeterminate`, always. Flipping the authorization would not have helped: the run would have died at
`national_input_not_complete` with no way for a correct dataset to say otherwise.

---

## 2. What changed

Three new pure modules in the connector, plus wiring in the CLI and one stage in the entry point.

| File | Role |
|---|---|
| `br-receita-cnpj-attempt2-operator-authorization.ts` | Three separate, invocation-scoped approvals, resolved from `argv` |
| `br-receita-cnpj-attempt2-observed-input-inventory.ts` | The **observed** side, from the selected manifest's metadata |
| `br-receita-cnpj-attempt2-national-input-preflight.ts` | Joins expected + observed and calls 14B.0J's gate once |

### 2.1 Process-scoped authorization

```
--second-real-attempt-owner-authorized   → ownerAuthorization
--temporary-storage-policy-approved      → temporaryStoragePolicyApproved
--cap-input-policy-approved              → capInputPolicyApproved
```

Each `false` by default. Each set only by its own flag. **All three required** — the composition is an
AND, and none is inferred from another or from the tracked constant. The grant is a value returned from
parsing `argv`, carried on the request, and written nowhere: no env var, no file, no module-level
mutable state, no `globalThis`. When the process exits it is gone.

`--force`, `--unsafe`, `--bypass` and `--yes` are refused **by name** with
`generic_override_flag_not_supported`. They name no policy, so there is no invocation in which honouring
one would be correct — and ignoring one would let an operator believe they had granted something.

The entry point's `authorization` stage now reads:

```ts
if (!BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED && !processScopedAuthorization) {
  return stop('benchmark_not_authorized', 'authorization');
}
```

An **OR** between the constant and the grant, because they are alternatives rather than halves: the
constant says "this repository authorizes real benchmarks", the grant says "this operator authorized
*this* run". Requiring both would leave the source edit mandatory, which is the hard stop being removed;
requiring neither is fail-open. Inside the grant the composition is still an AND, and stage 2 still
requires the same three approvals as literal `true` declarations — two independent walls, on purpose.

**The tracked constant did not move.** It is still `false`, still declared in
`br-receita-cnpj-full-join-resource-benchmark.ts`, and no module in this milestone assigns it.

### 2.2 The national-input gate, both sides wired

**Expected** — imported from 14B.0K's canonical artifact and resolved for the **declared** period.
A period with no transcribed listing gets no expectation at all (`2026-08` → `null` → `indeterminate`);
July is never borrowed for another month. The expectation keeps exact part **identities**
(`['0'…'9']` per required family), never a count literal.

**Observed** — built from the manifest **this invocation selected**, not from a directory listing. A
directory can hold ten correct parts the manifest never names, and it is the manifest the engine reads
from. Per declared entry, from `lstat`-level facts only:

- `fileType` → family, `partOrdinal` → opaque part key (declared, never parsed out of a filename)
- presence, regular-file-ness, non-symlink-ness
- the declared encoding / delimiter / layout mode, resolved exactly as the official validator resolves
  them (an omitted encoding is `utf8`, which the join path cannot read — never defaulted to the official
  pair)

A part that is absent, symlinked, not a regular file, or unusably addressed is **excluded** from the
observed part keys and recorded as a defect, so the gate sees a shortfall as a shortfall rather than
being told a file exists because a manifest said so. Duplicate ordinals are deliberately **not**
deduplicated, so `duplicate_part_declared` still fires.

Both sides go into `evaluateBrazilReceitaNationalInputCompleteness` — 14B.0J's gate, unchanged. **There
is no second completeness algorithm.** The preflight assembles inputs, calls the gate once, and reports
what the gate said.

Detected by the existing gate, with no new logic: missing ordinal, duplicate ordinal, wrong family,
wrong period, unexpected substitution, and Sócios/QSA/person-linked input.

### 2.3 Preboundary ordering

Unchanged from 14B.0F/14B.0J, with the new work inserted at the operator surface:

```
CLI: parse → generic-flag refusal → attempt-limit wall → owner-declaration wall
   → authorization wall (three approvals) → observed inventory (metadata) → preflight report
entry point: cwd → declarations → attempt eligibility → dataset period
   → national completeness → resource caps → handle caps → no-write → zero output
   → private channel → single attempt → AUTHORIZATION
   → manifest bridge → ── REAL-DATA BOUNDARY ── → engine
```

Every one of these fires before the first source row. Building the observed inventory reads the manifest
as a **control document** (§ 9 classes manifest metadata as permitted) and `lstat`s the files it names;
it opens no data file and constructs no source reader.

---

## 3. Verification

`npm run test:br-source:attempt2-operator-enablement` — 130 tests, 0 failures.

The new suite (27 tests) covers:

- **§ 14, tests 1–10** — default unauthorized; each approval alone refused; owner + temp without cap
  refused; all three admitted; attempt #1 not reusable; attempt #3 always rejected; the grant cannot
  persist (asserted by source scan for `process.env`, `node:fs`, `writeFile`, `globalThis`, `let`); no
  tracked source edit required or made.
- **§ 15, tests 11–20** — `observed`/`expected` no longer `null`; 10 + 10 → `complete`; a missing
  Empresas part, a missing Estabelecimentos part, an absent/symlinked/non-regular file, a duplicated
  ordinal, a wrong period, an unlisted period, a person-linked family and an out-of-contract family each
  refuse; no row reader invoked; an incomplete input aborts before the boundary without spending the
  attempt.
- **§ 16, test 21** — the whole preboundary path with a **sentinel reader** whose every operation throws
  and is recorded. The run passes every stage including `authorization`, stops at the manifest bridge,
  and `readerCalls` is empty. A companion test withdraws the grant and shows the same path refusing at
  `authorization` — which is what proves the grant, not the declarations, is what opened it.
- **§ 17–§ 19, tests 22–26** — every cap figure restated; the milestone's modules import no engine,
  reader, partitioner or sanitizer; the safety freeze; scope and sensitivity scans.

Regression battery, all green:

| Suite | Tests |
|---|---|
| `14b0m-national-multipart-input` | 66 |
| `14b0k-national-inventory-resolution` | 61 |
| `14b0j-second-benchmark-control` | 214 |
| `14b0i-synthetic-source-throughput` | 44 |
| `14b0h-throughput-instrumentation` | 493 |
| `14b0f-real-full-scan-execution-path` | 472 |
| `14b0d-streaming-full-join-engine` | 584 |
| `14b0c-full-join-resource-envelope` | 367 |
| `14b0a-calibration-instrumentation` | 236 |
| `8`, `10-*`, `11-*` | 845 |
| `agent2a:automatic-routing` | 50 |

`npm run typecheck` clean. ESLint clean on every touched file.

---

## 4. Standing after this PR

```
TRACKED_SOURCE_AUTHORIZATION_FLIP_REQUIRED = false
PROCESS_SCOPED_AUTHORIZATION_READY         = true

OWNER_AUTHORIZATION_DEFAULT                = false
TEMP_STORAGE_APPROVAL_DEFAULT              = false
CAP_INPUT_APPROVAL_DEFAULT                 = false
ALL_THREE_REQUIRED                         = true

ATTEMPT_1_REUSABLE                         = false
ATTEMPT_2_STRUCTURALLY_SUPPORTED           = true
ATTEMPT_2_AUTHORIZED                       = false
ATTEMPT_2_EXECUTED                         = false
ATTEMPT_3_ALLOWED                          = false

REAL_BENCHMARK_ATTEMPTS_CONSUMED           = 1
REAL_DATA_ROWS_OPENED                      = 0
REAL_SOURCE_READER_CALLS                   = 0
SECOND_REAL_BENCHMARK_EXECUTED             = false

CAPS_CHANGED                               = false
ENGINE_CHANGED                             = false

GATE2_APPROVED                             = false
GATE7_APPROVED                             = false
```

The mechanism being ready is not permission. **The owner must re-issue the attempt #2 authorization
after this merge**, and it is then spent on one invocation carrying all three flags.
