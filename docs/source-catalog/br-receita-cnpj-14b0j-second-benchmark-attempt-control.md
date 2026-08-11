# BR Receita CNPJ — BR-SOURCE-14B.0J: second real benchmark attempt control + national input gate

**Status:** controls built and verified. **No second benchmark attempt was executed. No real data row was
opened. `REAL_BENCHMARK_AUTHORIZED` is still `false`.**

Implementation base: `c5c087f8fe0a0dc1c96b9c7fdd149050a320bfc6` (14B.0I, PR #254).

---

## 1. What the owner approved, and what this milestone is

The owner's decision was `APPROVE_CONDITIONALLY`: a second real run is approved only *after* durable
attempt-#2 support is merged and verified, authorization stays `false` by default, the input is proven to be
the complete national 2026-07 collection, and every cap and safety gate is untouched.

This milestone builds those controls. It does not run anything, and it does not open a Receita row.

---

## 2. The gap this closes

BR-SOURCE-14B.0G's own evidence, § 7.5, wrote the finding down plainly:

> `BrazilReceitaFullJoinBenchmarkAttemptLedger` is an in-process closure counter, constructed fresh on every
> CLI invocation, so it does not survive a process exit. […] Durable enforcement of single-attempt semantics
> does not exist and would have to be built.

That was accurate and load-bearing. The only thing preventing a second attempt was
`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED = false` — a flag whose entire purpose is to be flipped
when an attempt *is* authorized. The moment it flipped, nothing downstream would have known that attempt #1
already happened, because the only memory of it was a closure in a process that exited months ago. **An
authorization for "the second benchmark" would have permitted an unbounded number of them.**

---

## 3. The durable attempt model

`src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-real-benchmark-attempt-ledger.ts`

```
REAL_BENCHMARK_ATTEMPTS_CONSUMED             = 1
STRUCTURALLY_SUPPORTED_REAL_ATTEMPTS         = 2
NEXT_REAL_ATTEMPT_NUMBER                     = 2      ← derived
ATTEMPT_3_ALLOWED                            = false
AUTOMATIC_RETRY_COUNT                        = 0
ATTEMPT_2_REQUIRED_PERIOD                    = 2026-07
ATTEMPT_2_REQUIRED_INPUT_SCOPE               = full_national
```

**Durability is a reviewed source constant, not a file or a table.** Each alternative was considered and
rejected for the same reason: this connector touches no Supabase, and a counter living in a file the run
itself can write is a counter the run can reset. "Durable" here means *survives the process and cannot be
rewritten by the process*, and a constant under PR review is exactly that.

**`_EXECUTED` now derives from the count (§ 4).** Before this milestone the boolean
`BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_EXECUTED` and the attempt history were two hand-maintained facts
that could disagree. It is now computed as `ATTEMPTS_CONSUMED > 0`, so there is nothing to keep in sync. The
two static text-scan guards in 14B.0C and 14B.0D were updated to pin the *derivation* rather than the old
`= true` literal — a strictly stronger assertion, since it also fails if anyone re-hardcodes the flag away
from the count it must follow.

**`STRUCTURALLY_SUPPORTED = 2` is not `AUTHORIZED = 2`.** Support says attempt #2 has a shape; authorization
says run it. They are different constants with different names, and nothing in the attempt model reports an
authorization at all — the summary object deliberately has no `authorized` field.

### Attempt #1, preserved verbatim (§ 3)

```
attemptNumber            1
milestone                BR-SOURCE-14B.0G
datasetPeriod            2026-07
terminalStatus           resource_cap_breached      ← maxRuntimeMs, Empresas reference pass
crossedRealDataBoundary  true
inputScope               staged_subset              ← see § 5
rowsEmitted              0
retriesPerformed         0
evidenceDocument         br-receita-cnpj-14b0g-real-full-scan-benchmark-evidence
```

The history array and each record are `Object.freeze`d, and a test asserts that writing to them throws.
There is no `reset()`, `setAttemptsConsumed()`, `clearAttempts()` or writable counter on the module's
surface, and a static scan over the module's **code** (comments stripped) asserts those spellings are absent.

### Anti-impersonation (§ 6)

`requestedAttemptNumber` must equal `nextRealAttemptNumber()` **exactly** — not `<=`, not `>=`:

| Requested | Result |
|---|---|
| not a positive integer (`1.5`, `'2'`, `NaN`, `null`, `-1`) | `real_attempt_number_invalid` |
| `1` | `real_attempt_number_already_consumed` |
| `3`, `4`, `99` | `real_benchmark_attempt_limit_reached` |
| anything else ≠ next | `real_attempt_number_not_next` |
| `2` | eligible, and `authorized: false` |

Rejecting `1` is the load-bearing case: a second run declaring itself attempt #1 would leave the durable
count at 1 and let a **third** run present itself as the second.

---

## 4. Where the attempt is spent (§ 11)

The commit sits immediately before the streaming engine — the first thing in the entry point that opens a
**source row**.

```
cwd → declarations → real_attempt_eligibility → national_input_completeness → resource_caps
    → handle_caps → no_write_contract → zero_output → private_metric_channel → single_attempt
    → authorization ─┐
                     │  manifest bridge (metadata; § 9 permits this)
                     └─ ▓▓ REAL-DATA ATTEMPT BOUNDARY ▓▓ → engine
```

**Not earlier, at the manifest bridge.** § 9 classes manifest metadata as permitted and § 5's marker is
`ABORT_BEFORE_REAL_SOURCE_ROW_OPEN`, so a manifest that fails validation costs a read of the operator's own
control document and nothing else. Committing before the bridge would bill a six-hour attempt for a typo in
a JSON path, and would make `manifest_resolution_failed` report a boundary crossing that never happened.

**Not later, after the engine returns.** That is the failure mode § 11 exists to forbid: a run that breaches
`maxRuntimeMs` at one per cent of the join has spent attempt #2 exactly as completely as a clean traversal
would. The cost was the hours and the data access, not the verdict.

**The in-process ledger was deliberately left alone.** It is consumed at stage 10, before today's standing
authorization refusal at stage 11 — but it is a single-flight token scoped to one process, it dies with the
process, and it was never the historical record. The durable count moves only at `commitCrossing()`, past
stage 11. So today's refusal spends nothing, exactly as § 5 and § 11 require, and every refusal reports
`realDataBoundaryCrossed: false` and `attemptsConsumedAfterRefusal: 1` rather than leaving an operator to
infer it from the absence of a complaint.

---

## 5. The national input gate (§ 7, § 8) — and why it currently BLOCKS

`src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-national-input-completeness.ts`

### ATTEMPT_1_INPUT_SCOPE = `staged_subset`

On 14B.0G's own authority, § 2:

> **Coverage caveat — the staged dataset is one part, not the national whole.** Each join family is a single
> part of a dataset the Receita publishes in roughly ten parts per family. A complete traversal of this
> manifest is a complete traversal of approximately **one tenth** of the national universe.

A second six-hour attempt over the same subset would consume the last structurally supported attempt to
re-answer a question that is already answered. `ATTEMPT_2_REQUIRED_INPUT_SCOPE = full_national` is what makes
that a gate rather than an intention.

### NATIONAL_INPUT_COMPLETENESS = `indeterminate` — HARD STOP

```
BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_KNOWN = false
EXPECTED_INVENTORY_GAP = no_declared_expected_part_inventory_for_any_period
```

An audit of the connector, its scripts and its decision records found **no authoritative statement of the
expected 2026-07 part inventory** — no publisher manifest, no local inventory contract, no part count
anywhere. `roughly ten parts per family`, from a prose caveat, is not a contract; it is an observation with a
hedge in it, and a gate that turned it into `expectedPartCount: 10` would be inventing the very evidence § 7
forbids inventing.

So the gate returns `indeterminate` and blocks. **That is the deliverable**: it converts "we think the staged
data is about a tenth" into a mechanical refusal that names exactly what an owner must produce.

### What the gate checks

Metadata only, over records the caller already holds. Every check returns *all* findings, so an owner
assembling an inventory learns the whole gap in one pass.

| Class | Findings | Verdict |
|---|---|---|
| Missing evidence | `observed_inventory_absent`, `expected_inventory_absent`, `expected_inventory_provenance_not_evidential`, `expected_inventory_part_count_undeclared`, `…_source_key_unusable`, `…_period_unusable`, `…_families_unusable`, `observed_inventory_families_unusable` | `indeterminate` |
| Detected defect | `source_key_mismatch`, `period_mismatch`, `required_family_missing`, `family_part_count_short`, `family_part_count_excess`, `duplicate_part_declared`, `unexpected_family_substitution`, `forbidden_person_linked_family`, `encoding_incompatible`, `delimiter_incompatible`, `layout_incompatible`, `part_key_not_opaque` | `incomplete` |

`complete` requires **zero** findings *and* an evidential expected inventory. There is no path to it through
absence.

**Provenance is part of the evidence.** Only `official_publisher_manifest` or
`declared_local_inventory_contract` can support `complete`. An operator asserting "this is complete" is the
claim under test, not proof of it, so `operator_assertion` and `unknown` resolve to `indeterminate` however
complete the numbers look.

**"Not inspected" ≠ "inspected and wrong."** `observed: null` yields `observed_inventory_absent` and stops
there. An earlier draft ran the field comparisons against `null` and emitted `source_key_mismatch`,
`period_mismatch`, `encoding_incompatible` and four more — reporting a caller who had *never looked* as one
who had looked and found everything broken. Tests assert those seven codes are absent for an uninspected
input.

**Duplicates do not pad the count.** Ten declared parts of which one is a repeat is nine parts: the gate
deduplicates and then reports both `duplicate_part_declared` *and* `family_part_count_short`. A gate that
counted array length would have called that input national.

**A staged subset is only labelled as such when it is diagnosable.** With a known expectation, one part per
family is `incomplete` / `staged_subset`. Without one, the *same* input is `indeterminate` — the refusal must
rest on missing evidence rather than on a diagnosis nobody could make.

### Privacy

Findings carry an allowlisted **family class label** at most, never a part key, file name or path. Part keys
must be short opaque ordinals; anything path-like or file-like (`K3241_EMPRECSV.csv`, `/srv/receita/estab0`)
is refused with `part_key_not_opaque`, and a test asserts the offending string appears nowhere in the
serialized findings. Person-linked families (`qsa`, `socio(s)`, `cpf`, `pessoa`, `person`, `partner`,
`shareholder`, `representante`) are refused, and are reported `incomplete` even when evidence is otherwise
missing — a person-linked family means the same thing whether or not an inventory exists.

**No row is read, and it is structural.** The module has no `node:fs` import and no port through which one
could arrive. A static scan over its code asserts the absence of `node:fs`, `readFileSync`,
`createReadStream`, `statSync`, `openSync`, `child_process` and `process.env`.

---

## 6. Authorization boundary for a future attempt #2 (§ 5)

All of these must hold simultaneously. None is inferred from another.

```
requestedAttemptNumber            = 2
attemptsConsumed                  = 1
ownerAuthorization                = explicit   ← BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED
temporaryStoragePolicyApproved    = explicit
capInputPolicyApproved            = explicit
datasetPeriod                     = 2026-07
nationalInputCompleteness         = complete / full_national
privateMetricChannelAcknowledged  = exact phrase
resource + handle + reader + partitioning caps, workspace constraints, no-write contract
```

Two new abort codes enforce the period and the input separately:
`dataset_period_not_authorized_for_attempt` and `national_input_not_complete`. The period is checked against
the attempt-specific requirement rather than in the declarations, because being a well-formed `YYYY-MM` is a
shape question and being *the period this attempt was approved for* is a policy question.

### The CLI

`--real-attempt-number <n>` is **required and never defaulted**, of the synthetic-smoke mode too — a smoke
run that could skip it would be proving the wiring of a different code path from the one a real run takes.

`--second-real-attempt-owner-authorized` is a **separate** flag from the number. The number says which
attempt this is; the flag says an owner approved running it. A real attempt beyond the first without the flag
is refused with `real_attempt_owner_declaration_missing`, before any port is built, whether or not the
authorization constant is ever flipped. `--real-attempt-number 2` alone can never start a run.

The declarations the CLI builds still refuse on three counts: the three policy approvals mirror the
authorization constant (`false`), and the completeness verdict it can compute is `indeterminate` because it
inspects nothing. When a real inventory contract lands, that call site is the one that changes.

---

## 7. Caps — unchanged (§ 10)

Every figure in the § 10 table is asserted by exact `deepEqual` against the whole caps object, including
`maxOutputRows: 0`, `attemptCount: 1`, `automaticRetryCount: 0` and the six-hour `OWNER_BUDGET_CEILING`. No
cap was widened to make attempt #2 fit; that would be the milestone failing at its own premise.

---

## 8. Standing flags

```
MODEL_A_CLASSIFICATION                        = A
SOURCE_READ_CLASSIFICATION                    = A2
MEDIAN_SYNTHETIC_SOURCE_READ_MIB_S            = 8.452

END_TO_END_SYNTHETIC_SOURCE_THROUGHPUT_PROVEN = true
END_TO_END_REAL_THROUGHPUT_PROVEN             = false

REAL_BENCHMARK_ATTEMPTS_CONSUMED              = 1
STRUCTURALLY_SUPPORTED_REAL_ATTEMPTS          = 2
NEXT_REAL_ATTEMPT_NUMBER                      = 2
ATTEMPT_2_EXECUTED                            = false
ATTEMPT_3_ALLOWED                             = false
NO_RESET_PATH                                 = true

ATTEMPT_1_INPUT_SCOPE                         = staged_subset
ATTEMPT_2_REQUIRED_INPUT_SCOPE                = full_national
NATIONAL_INPUT_COMPLETENESS                   = indeterminate  ← HARD STOP
NATIONAL_INPUT_COMPLETENESS_GATE_READY        = true
EXPECTED_INVENTORY_KNOWN                      = false

REAL_BENCHMARK_AUTHORIZED                     = false
TEMPORARY_STORAGE_POLICY_APPROVED             = false
CAP_INPUT_POLICY_APPROVED                     = false
AUTOMATIC_RETRIES                             = 0
CAPS_CHANGED                                  = false

REAL_DATA_ROWS_OPENED                         = 0
REAL_SCAN_EXECUTED                            = false
IMPORT_EXECUTED                               = false
SUPABASE_WRITE                                = false

GATE2_APPROVED                                = false
GATE7_APPROVED                                = false
```

---

## 9. What an owner must produce before attempt #2 is runnable

1. **A declared expected national part inventory for 2026-07** — per-family expected part counts, from a
   publisher manifest or a reviewed local inventory contract. Without it the gate returns `indeterminate`
   and the run is refused. This is the blocking item.
2. **A source edit flipping `BRAZIL_RECEITA_REAL_FULL_SCAN_BENCHMARK_AUTHORIZED`**, plus the separate
   temporary-storage and CAP-input policy approvals.
3. **`--second-real-attempt-owner-authorized`** on the command line, alongside `--real-attempt-number 2`.
4. **A decision about what a second six-hour attempt buys**, given 14B.0G's finding that the gap between the
   authorized budget and a national full join is three to four orders of magnitude, and its own
   recommendation: `GATE2_RECOMMENDATION = DEFER`, no second attempt recommended.

Item 4 is not a control this milestone can build. It is the question the owner's conditional approval leaves
open, and nothing here answers it.

---

## 10. Scope

Touched: the connector directory and its `__tests__`, `scripts/source-catalog/`, `docs/source-catalog/`, and
one `package.json` test script. No Supabase, no migration, no runtime, no Agent 1, no Agent 2A, no provider,
no UI, no HubSpot. Static scans over both new modules' code assert those absences token by token.
