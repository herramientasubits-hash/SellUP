# BR-SOURCE-11I — Coverage signal interpretation and GATE-2 route decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11I — Coverage signal interpretation and GATE-2 route decision record (docs-only)
**Status:** `proposed_for_owner_review` — **not** a gate approval, and **not** an authorization for a re-run, larger caps, multi-window sampling, exact percentages, import, Supabase, runtime, or Agent 1
**Predecessor:** BR-SOURCE-11H-IMPL-V — `BRSOURCE11HIMPLVA — POST_MERGE_AGGREGATE_ONLY_REAL_JOIN_COVERAGE_SIGNAL_VALIDATION_PASSED`, `main` HEAD `72353d5438e7c8bcff91756bf390fb53d12d5c96`
**Predecessor record:** BR-SOURCE-11H-LAND — `BRSOURCE11HLANDA — BOUNDED_REAL_JOIN_COVERAGE_DECISION_RECORD_MERGED` (PR #180, `main` HEAD `bc98b0738baeadfd81a8f3a5ebef400751ea1109`)
**Predecessor implementation:** BR-SOURCE-11H-IMPL-LAND — `BRSOURCE11HIMPLLANDA — ULTRA_BOUNDED_AGGREGATE_ONLY_REAL_JOIN_COVERAGE_SIGNAL_MERGED` (PR #182, `main` HEAD `72353d5438e7c8bcff91756bf390fb53d12d5c96`)
**Last reviewed:** 2026-07-31

**Related documents:**
- Bounded real join coverage decision record (BR-SOURCE-11H, Option C authorized and implemented) — [`br-receita-cnpj-bounded-real-join-coverage-decision-record.md`](./br-receita-cnpj-bounded-real-join-coverage-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Bounded real join dry-run decision record (BR-SOURCE-11G) — [`br-receita-cnpj-bounded-real-join-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-join-dry-run-decision-record.md)
- Bounded real data-file dry-run decision record (BR-SOURCE-11F) — [`br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md)

---

> This document **interprets a result and proposes a route**; it decides nothing and executes
> nothing. BR-SOURCE-11H-IMPL-V validated that the ultra-bounded aggregate-only real join coverage
> signal (BR-SOURCE-11H, Option C) executed exactly as its own record specified, and that the
> observed outcome was `match_result_bucket = zero`. Nothing here authorizes — and nothing here
> should be read as authorizing — a re-run of that signal, larger byte/row/key-window caps,
> multi-window sampling, an exact coverage percentage, a full-dataset denominator, coverage proof or
> guarantee, a full join execution, opening any additional file or family, a dataset download, an
> import, a Supabase write, a production write, a migration, a runtime change, an Agent 1
> integration, a provider call, or the approval of GATE-1, GATE-2, or any gate. **§ 1–16 record an
> interpretation and a recommended next-decision route; they approve nothing and execute nothing.**

---

## 1. Status

```text
Decision record status: proposed_for_owner_review
Implementation status:  not_authorized
Execution status:       not_authorized
Current GO/NO-GO:       NO-GO
```

Explicitly, this record does **not** authorize:

```text
This record does not authorize any new real-data execution.
This record does not authorize re-running the coverage signal.
This record does not authorize larger caps.
This record does not authorize multi-window sampling.
This record does not authorize exact coverage percentages.
This record does not authorize full-dataset denominator claims.
This record does not authorize full join execution.
This record does not authorize import.
This record does not authorize Supabase writes.
This record does not authorize runtime.
This record does not authorize Agent 1.
This record does not approve GATE-1.
This record does not approve GATE-2.
This record does not approve any gate.
```

A merged decision record makes the *interpretation* official; it does not authorize a next step.
Any future action still requires its own separately-worded, single-milestone owner phrase (§ 12),
given after the relevant record is official, and it would authorize only the option it names.

---

## 2. Background

```text
BR-SOURCE-11A created the no-write/no-runtime runner scaffold.
BR-SOURCE-11B validated synthetic_fixture_only.
BR-SOURCE-11C implemented synthetic temp-manifest.
BR-SOURCE-11D-META defined and implemented real manifest metadata-only.
BR-SOURCE-11E executed real manifest metadata-only.
BR-SOURCE-11F defined, implemented and validated the ultra-bounded required-family real data-file
  probe.
BR-SOURCE-11G defined, implemented and validated the ultra-bounded required-family real join probe.
BR-SOURCE-11H defined the ultra-bounded aggregate-only real join coverage signal (Option C) and
  recorded it as proposed_for_owner_review, NO-GO, approving no gate.
BR-SOURCE-11H-IMPL implemented Option C behind hard caps and executed it once against the
  operator-prepared real manifest.
BR-SOURCE-11H-IMPL-V validated, post-merge, that the implementation behaves exactly as the merged
  11H record specifies.
```

BR-SOURCE-11H-IMPL-V validated that the Option C aggregate-only coverage signal executes safely
under caps: two files opened (one Empresas, one Estabelecimentos), bytes and rows within the § 10
ceilings of the 11H record, the join key parsed ephemerally and never printed, retained, or hashed,
zero joined rows or pairs emitted, no exact percentage or full-dataset denominator computed, and all
eight gates recorded `not_approved`. The observed outcome was `match_result_bucket = zero`. That
result is valid **only for the bounded window read**, and it is not a production coverage
measurement of the Receita CNPJ dataset.

### 2.1 The evidence, quoted exactly, and read at its real strength

```text
real coverage signal   = PASS
run_mode                = local_manifest_dry_run
manifest_trust           = real_manifest_aggregate_join_coverage_signal

families_attempted      = ["empresas","estabelecimentos"]
files_opened_count      = 2
files_opened_by_family  = { empresas: 1, estabelecimentos: 1 }

bytes_read_bucket       = lte_512kb
rows_read_bucket        = lte_200

coverage_signal_executed = true
coverage_signal_mode     = ultra_bounded_required_family_aggregate_only
match_result_bucket      = zero
matched_rows_bucket      = zero
unmatched_rows_bucket    = lte_200
denominator_scope        = bounded_window_only
production_inference_allowed = false

exact_coverage_percentage_printed = false
full_dataset_denominator_printed  = false
coverage_claimed                   = false

join_key_values_printed  = false
join_key_values_retained = false
join_key_hashes_printed  = false
join_key_error_leak      = false

joined_rows_printed    = false
joined_samples_printed = false
joined_pairs_emitted   = 0

raw_rows_printed        = false
raw_cells_printed       = false
identifiers_printed     = false
filenames_printed       = false
absolute_paths_printed  = false
hashes_printed          = false

join_coverage_computed  = false
full_dataset_processed  = false
import_executed         = false
supabase_write           = false
runtime_integration      = false
agent1_integration        = false
provider_calls            = false
production_writes         = false

errors                     = []
forbidden_output_findings  = 0
gates                      = 8/8 not_approved
```

Every value above is a count, a boolean, or a coarse bucket. The load-bearing lines are
`match_result_bucket = zero`, `denominator_scope = bounded_window_only`,
`production_inference_allowed = false`, `coverage_claimed = false`, and `gates = 8/8 not_approved`.
This record's whole subject is how to read the first of those five without contradicting the other
four.

### 2.2 What has structurally *not* happened, restated after 11H-IMPL-V

```text
No coverage figure, ratio, percentage, or match rate about the real dataset exists.
No denominator tied to full dataset size has ever been computed or claimed.
No join has been executed over real data outside the single 11H-IMPL run and its 11G predecessor.
No more than two data files have ever been opened in one run.
No more than 200 rows per file have ever been read.
No catalog file has been opened.
No Socios / QSA / CPF / person file has been opened.
No ZIP has been opened.
No dataset has been downloaded by SellUp automation.
No row of Receita data has survived the loop iteration that read it.
No join key value has survived the bounded window that held it.
```

---

## 3. Decision question

```text
How should SellUp interpret the zero result from the ultra-bounded aggregate-only real join
coverage signal, and what is the safest next decision route toward GATE-2 without automatically
expanding caps or claiming readiness?
```

This record does not answer that question by widening execution. It answers it by fixing the
interpretation (§ 4), naming what is and is not proven (§ 6, § 7), and recommending a route (§ 9,
§ 10) that a separate, future, explicitly-authorized milestone would have to execute.

---

## 4. Interpretation of `match_result_bucket = zero`

```text
zero IS a valid bounded-window outcome.
zero IS NOT evidence that Empresas and Estabelecimentos cannot join.
zero IS NOT evidence of zero joinability of the dataset.
zero IS NOT evidence of low source quality.
zero IS NOT evidence that Brazil ingestion is blocked forever.
zero IS NOT a probe failure.
zero DOES NOT justify auto-increasing caps.
zero DOES NOT justify a re-run at the same or wider caps "to get a different answer".
```

The zero bucket means only this: no match was observed between the join keys read from the two
bounded windows opened in this one run. Because Empresas and Estabelecimentos files are
independently ordered and sharded by the source publisher, a prefix window taken from the start of
one file need not share any company root with a prefix window taken from the start of the other. A
`zero` result from two independent prefix windows is the **expected**, unsurprising outcome of this
sampling strategy — it was equally likely before the run as after it, and 11H § 8.1 said so in
advance.

The symmetric point matters equally and must not be dropped: a `one_or_more` result would **also**
not prove production coverage. Two bounded prefixes overlapping tells SellUp only that the join
mechanism can, on at least one occasion, observe a match — it says nothing about *how often* the two
families relate across the roughly fifty million establishment rows and roughly twenty million
company roots the full dataset contains. Both outcome classes — `zero` and `one_or_more` — remain
only bounded-window signals, and neither may be summarized, quoted, or reported as a statement about
Brazil.

---

## 5. Prohibited inferences

None of the following may be drawn from the 11H-IMPL-V result, in either direction:

```text
No production coverage inference.
No full-dataset quality inference.
No import readiness inference.
No runtime readiness inference.
No Agent 1 readiness inference.
No legal/privacy approval inference.
No storage/GATE-2 envelope approval inference.
No field-persistence (GATE-3) approval inference.
No identity-grain (GATE-4) approval inference.
No claim that Receita CNPJ is operationally usable.
No claim that Brazil is ready for live prospect generation.
```

A green run under caps proves the mechanism ran safely. It proves nothing about the dataset, the
gates, or Brazil's readiness for anything beyond the next documentational step this record proposes.

---

## 6. What the 11H signal did prove

```text
The runner can execute the aggregate-only coverage signal mode under authorized caps.
The manifest control path can dispatch that mode safely against a real, operator-prepared manifest.
Only Empresas and Estabelecimentos were opened — no Catalog, Socios, QSA, CPF, or person file.
Output stayed sanitized: no join key, no joined row, no join pair, no identifier, no percentage,
  and no denominator reached any surface.
The join key stayed ephemeral: parsed in memory, used for a membership tally, and discarded before
  any aggregate was assembled.
Fail-closed guards blocked unauthorized expansion — every cap in the 11H § 10 table held.
The no-write / no-runtime posture stayed intact end to end.
```

---

## 7. What the 11H signal did not prove

```text
It did not prove join coverage.
It did not prove full-dataset coverage.
It did not prove join quality.
It did not prove import readiness.
It did not prove source usability.
It did not prove field-persistence safety.
It did not prove identity-grain safety.
It did not approve any gate.
```

---

## 8. GATE-2 relationship

GATE-2 (temporary storage / processing envelope) governs how much regulated data SellUp may hold and
process locally at once, and it governs whether a temporary on-disk index (Option C of the 10J
architecture options) may ever be permitted. BR-SOURCE-11H § 8.2 raised real-data caps for the first
time in this series — bytes per file 8× the 11G ceiling, rows per file 10×, the in-memory join-key
window 10× — and § 12.2 of that record said explicitly that this is the gate the coverage signal
"brushes against hardest."

BR-SOURCE-11H-IMPL-V confirms that the raised caps executed exactly as declared and produced no
leak. That confirmation does not change the relationship: 11H's escalation was an **explicitly
authorized carve-out** for one bounded signal, scoped to a single milestone, and it is **not** a
GATE-2 approval. Any future work that would broaden local execution further — a second window, a
seeking or offset strategy, a wider byte/row ceiling, temporary on-disk storage of any kind, or
repeated real-data scanning of the same or additional files — must be treated as **GATE-2-route
work**, reviewed and approved on its own terms, and never as a routine continuation of what 11H
already ran once.

```text
GATE-2 status remains: not_started / not approved.
```

---

## 9. Options

### Option A — Stop cap expansion and prepare a GATE-2 decision package

```text
Status: recommended.
```

The zero result is valid and sufficient evidence for the current carve-out; no further real
execution is needed to close out BR-SOURCE-11H. The correct next step is to prepare a GATE-2 route
decision package — the storage/processing envelope question 11H § 12.2 named — **before** any
broader local execution, rather than treating a second signal run as the default next milestone.

### Option B — Repeat the same Option C window

```text
Status: not recommended.
```

Re-running the identical bounded prefix window over the same two files would waste an execution slot
and produce no new information: a prefix-window `zero` is already the expected outcome of two
independently-sharded files, and repeating the same window cannot distinguish "the families never
relate" from "these two particular prefixes did not overlap." Re-running to "get a different answer"
is precisely the inference § 4 and § 5 forbid.

### Option C — Authorize a multi-window bounded signal

```text
Status: not recommended before a GATE-2 route review.
```

Sampling several disjoint windows would be more informative than one prefix, but it introduces a new
mechanism — window selection, seeking, offsets — that this series has not yet designed or reviewed,
and every one of those concepts is a new leak surface. It also makes a statistical claim tempting: the
moment a run reports "we sampled N windows," a reader will ask for the rate. This risk is exactly why
BR-SOURCE-11H § 7 Option D deferred multi-window sampling, and 11H-IMPL-V changes nothing about that
deferral.

### Option D — Authorize exact coverage percentage / denominator work

```text
Status: blocked.
```

Computing an exact percentage or a full-dataset denominator requires reading far beyond any bounded
window, requires its own legal/privacy/storage review, and is a GATE-1/GATE-2 question end to end.
Nothing in this record, or in the 11H-IMPL-V result, changes that.

### Option E — Move directly to import/staging design

```text
Status: blocked.
```

Moving toward import or staging design is premature: GATE-2 through GATE-5 remain `not_started`, the
field allowlist, identity grain, and output sanitization contracts are all still
`proposed_for_owner_review`, and a coverage signal — of any bucket value — is not evidence toward any
of those gates.

---

## 10. Recommended decision

```text
Recommended decision: Option A — Stop cap expansion and prepare a GATE-2 decision package.
```

The technical objective of BR-SOURCE-11H — safe dispatch of a real-manifest run, bounded reads under
raised caps, an aggregate-only signal, sanitizer refusal of every forbidden surface, and an intact
no-write / no-runtime posture — was fully achieved and confirmed post-merge by 11H-IMPL-V. The `zero`
result creates no technical need to expand caps, sample more windows, or re-run anything: § 4 already
establishes that a `one_or_more` result would have led to the same recommendation, because neither
outcome bears on production coverage.

The next real risk in this series is not whether a tiny bounded signal can execute — that is now
demonstrated twice, at two cap levels, with zero leaks — but the **governance** of any broader local
execution: how much regulated data SellUp may hold locally, for how long, under what storage
controls, and with what cleanup guarantees. That is GATE-2's subject exactly. The safest next step is
therefore a GATE-2 route decision package, prepared before any further real-data cap is raised, rather
than a further coverage-signal execution presented as the natural next milestone.

---

## 11. Proposed scope for next GATE-2 route package

This section is **documentational and future-facing only**. It is not authorized now, and it
authorizes nothing by being written.

A future BR-SOURCE-11J GATE-2 route decision package would need to address:

```text
Whether broader local execution is permitted at all, and under what conditions.
Temp storage boundaries — in-memory-only vs. an approved ephemeral on-disk index.
Allowed directories — a controlled, fixed, operator-visible folder outside the repository.
Allowed files and families — whether the two-file / two-family surface may ever widen.
Max files / bytes / rows / runtime ceilings, replacing every remaining placeholder.
Cleanup requirements — destruction on completion and on failure, cleanup-failed as terminal.
Output storage restrictions — no committed artifact, no cloud sync, no shared location.
Safe error handling — no raw value, path, or row reference on any error surface.
No-raw-output rules, no-identifier-output rules.
No-join-key-retention rules, no-hashes-from-identifiers rules.
An operator checklist for any future manual execution.
Kill-switch / stop conditions, non-overridable, for every leak-class failure.
Evidence-packet requirements so a future submission can be reviewed against a fixed shape.
```

```text
No GATE-2 package should automatically authorize import.
No GATE-2 package should automatically authorize Supabase writes.
No GATE-2 package should automatically authorize runtime.
No GATE-2 package should automatically authorize Agent 1.
No GATE-2 package should automatically authorize field persistence.
```

---

## 12. Required owner phrase for any future GATE-2 route work

```text
AUTHORIZE BR-SOURCE-11J — GATE-2 ROUTE DECISION PACKAGE
```

This phrase, if and when given, would authorize only the preparation of a **decision package** —
prose, options, and proposed contracts, in the same docs-only shape as this record — never real
execution, never a runner, never a storage envelope actually created, and never any gate approval by
itself. **It is not being authorized now.** No implementation, milestone, or branch may cite this
section as if the phrase had already been given.

---

## 13. What remains blocked

Regardless of this record, and regardless of the `zero` result it interprets, every item below
remains blocked:

```text
New real coverage execution of any kind.
Re-running the 11H coverage signal, at the same or any other caps.
Larger caps of any kind.
Multi-window sampling.
Any seeking or offset-based window-selection strategy.
Opening any additional file, including Catalog, Socios, QSA, CPF, or person files, and any ZIP.
Exact coverage percentages.
Full-dataset denominator claims.
Coverage proof or guarantee of any kind.
Any production inference drawn from a bounded-window result.
Full join execution.
Full dataset processing.
Dataset import.
source_company_snapshots writes.
Supabase writes of any kind.
Migrations.
Runtime integration.
Agent 1 integration.
Provider calls.
UI changes.
Brazil live prospect generation.
```

---

## 14. Gate status

```text
GATE-1  Legal/Privacy approval                not_started / not approved
GATE-2  Temporary storage envelope             not_started / not approved
GATE-3  Field allowlist                        not_started / not approved
GATE-4  Identity grain                         not_started / not approved
GATE-5  Output sanitization contract           not_started / not approved
GATE-6  Failure cleanup contract               not_started / not approved
GATE-7  Operator runbook                       not_started / not approved
GATE-8  No-write / no-runtime guarantee        not_started / not approved
```

No gate changes status as a result of this record. `match_result_bucket = zero` is not cited toward
any gate's evidence, and this record does not submit any gate for review.

---

## 15. Flags

```text
OPS_BR_COVERAGE_SIGNAL_INTERPRETATION_GATE2_ROUTE_DECISION_RECORD_PR_READY = false until PR
OPS_BR_COVERAGE_SIGNAL_INTERPRETATION_GATE2_ROUTE_DECISION_RECORD_OFFICIAL = false until merge

OPS_BR_GATE2_ROUTE_DECISION_PACKAGE_AUTHORIZED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

OPS_BR_ULTRA_BOUNDED_AGGREGATE_ONLY_JOIN_COVERAGE_SIGNAL_AUTHORIZED = true
OPS_BR_REAL_LOCAL_JOIN_COVERAGE_SIGNAL_AUTHORIZED = true
OPS_BR_ULTRA_BOUNDED_AGGREGATE_ONLY_REAL_JOIN_COVERAGE_SIGNAL_OFFICIAL = true
POST_MERGE_AGGREGATE_ONLY_REAL_JOIN_COVERAGE_SIGNAL_VALIDATION_PASSED = true

FULL_JOIN_RUNNER_READY = true
FULL_JOIN_EXECUTION_READY = false
IMPORT_READY = false
RUNTIME_READY = false
AGENT1_READY = false

OPS_BR_READY_FOR_IMPORT = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT = false
OPS_BR_READY_FOR_RUNTIME = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false
```

`OPS_BR_COVERAGE_SIGNAL_INTERPRETATION_GATE2_ROUTE_DECISION_RECORD_PR_READY` flips to `true` only
once this docs-only PR is open; `..._OFFICIAL` flips to `true` only once it is merged. Neither flip
changes any operational flag, and every Brazil-readiness flag stays `false` regardless of either.

---

## 16. Next milestone mapping

```text
If the owner accepts Option A → BR-SOURCE-11J may create a GATE-2 route decision package, using the
  phrase in § 12, scoped to that package only.
If the owner wants multi-window sampling → a separate decision record is required, referencing the
  GATE-2 risk this record and BR-SOURCE-11H § 7 Option D both name, and its own owner phrase.
If the owner wants exact coverage percentages → a later legal/privacy/storage review is required,
  reached only through GATE-1 and GATE-2, before any such record could be drafted.
If the owner wants import → a later import-readiness process is required, after the relevant gates
  (GATE-1 through GATE-8) are each independently approved per the 10K checklist and § 14 template.
```

This record does not authorize any of those four paths. It records only that they exist, that each
requires its own separately-worded owner phrase, and that none of them may be reached by inference
from `match_result_bucket = zero`.

---

## 17. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- download or import a dataset;
- process the real / full dataset, or open, read, or print any real file, row, full CNPJ, CNPJ
  básico, or CPF;
- read any real manifest;
- read any CSV or ZIP;
- read any row;
- expand any cap;
- perform multi-window sampling;
- compute an exact coverage percentage;
- claim a full-dataset denominator;
- claim coverage proof or guarantee of any kind;
- write to Supabase or perform any production write;
- create or modify a migration;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- approve any gate;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, and no partner (sócio)
personal data are reproduced. Local WIP (`scratchpad/`) is untouched by any git operation.
