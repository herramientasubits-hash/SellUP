# BR-SOURCE-11J — GATE-2 route decision package

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11J — GATE-2 route decision package (docs-only)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, and **not** an authorization for broader local execution, temp storage, multi-window sampling, exact coverage percentages, a full-dataset denominator, full join execution, import, Supabase writes, runtime, or Agent 1
**Predecessor:** BR-SOURCE-11I-LAND — `BRSOURCE11ILANDA — COVERAGE_SIGNAL_INTERPRETATION_GATE2_ROUTE_DECISION_RECORD_MERGED` (PR #183, `main` HEAD `4305b177591b313375cc7ba10e7c1fea496b2d2f`)
**Authorization received:** `AUTHORIZE BR-SOURCE-11J — GATE-2 ROUTE DECISION PACKAGE` — authorizes only the preparation of this decision package, in the same docs-only shape as its predecessor
**Last reviewed:** 2026-07-31

**Related documents:**
- Coverage signal interpretation and GATE-2 route decision record (BR-SOURCE-11I) — [`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md)
- Bounded real join coverage decision record (BR-SOURCE-11H) — [`br-receita-cnpj-bounded-real-join-coverage-decision-record.md`](./br-receita-cnpj-bounded-real-join-coverage-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join approval gates checklist (GATE-2 definition, § 6) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)

---

> This document **defines a route**; it decides nothing and executes nothing. BR-SOURCE-11I
> interpreted the `match_result_bucket = zero` outcome of BR-SOURCE-11H-IMPL-V, recommended Option A
> — stop cap expansion and prepare a GATE-2 route decision package — and named that package as
> BR-SOURCE-11J. This document is that package. **§ 1–17 record controls, evidence requirements,
> owner questions, and a proposed future milestone sequence; they approve no gate and authorize no
> execution.**

---

## 1. Status

```text
Decision package status: proposed_for_owner_review
GATE-2 approval status:  not_started / not approved
Implementation status:   not_authorized
Execution status:        not_authorized
Current GO/NO-GO:        NO-GO
```

Explicitly, this package does **not** authorize:

```text
This package does not approve GATE-2.
This package does not authorize broader local execution.
This package does not authorize any new real-data execution.
This package does not authorize multi-window sampling.
This package does not authorize exact coverage percentages.
This package does not authorize full dataset denominator claims.
This package does not authorize full join execution.
This package does not authorize temp storage.
This package does not authorize import.
This package does not authorize Supabase writes.
This package does not authorize runtime.
This package does not authorize Agent 1.
This package does not approve any gate.
```

A merged decision package makes the *route* official; it does not authorize a next step. Any future
action still requires its own separately-worded, single-milestone owner phrase (§ 13), given after
the relevant package is official, and it would authorize only the option it names.

---

## 2. Purpose

The purpose of this package is to define the decision route, controls, evidence requirements, and
owner questions that must be resolved before SellUp can consider broader local execution over
Receita CNPJ files.

```text
This package is a governance and safety preparation artifact, not an execution approval.
```

---

## 3. Background

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
  11H record specifies. The observed outcome was match_result_bucket = zero.
BR-SOURCE-11I interpreted that zero result, ruled out every prohibited inference in either
  direction, and recommended Option A — stop cap expansion and prepare a GATE-2 route decision
  package — as the safest next step.
```

```text
BR-SOURCE-11I recommended stopping automatic cap expansion and preparing a GATE-2 route decision
  package.
BR-SOURCE-11J implements that recommendation as documentation only.
```

---

## 4. GATE-2 boundary

```text
GATE-2 concerns broader local data-file execution and temp-storage controls.
```

Per the existing GATE-2 definition (approval gates checklist § 6), GATE-2 governs the temporary
storage / processing envelope: whether an in-memory-only model, a streaming two-pass scan, or a
temporary on-disk index is permitted, and under what ceilings. This package extends that definition
into a route document. GATE-2 must define, at minimum:

```text
whether broader local execution is allowed at all;
which local directories may be used;
which file families may be opened;
whether temp storage is allowed;
where temp storage may live;
what cleanup guarantees are required;
what maximum files, bytes, rows and runtime are allowed;
what output surfaces are allowed;
what evidence may be retained;
what must be suppressed;
what operator checklist is required;
what stop conditions and kill-switches are mandatory.
```

```text
GATE-2 does not approve import.
GATE-2 does not approve field persistence.
GATE-2 does not approve identity grain.
GATE-2 does not approve Supabase writes.
GATE-2 does not approve runtime.
GATE-2 does not approve Agent 1.
```

---

## 5. Current evidence entering the GATE-2 route

```text
real manifest metadata-only passed (BR-SOURCE-11E);
required family real file probe passed (BR-SOURCE-11F);
required family real join probe passed (BR-SOURCE-11G);
aggregate-only real coverage signal passed (BR-SOURCE-11H-IMPL, validated by 11H-IMPL-V);
output sanitizer passed at every stage;
fail-closed checks passed at every stage;
no-write/no-runtime posture held across the full 11A-11I chain;
zero result interpreted as a valid bounded-window outcome, not a failure, by BR-SOURCE-11I;
all eight gates remain not approved.
```

```text
This evidence is sufficient to justify preparing a GATE-2 route package.
It is not sufficient to approve GATE-2.
It is not sufficient to authorize broader local execution.
```

---

## 6. Open owner questions before GATE-2 can be approved

```text
Should SellUp allow any broader local execution over Receita CNPJ files?
Which families may be included in the next allowed execution scope?
Should support catalog families be allowed, or remain blocked?
Should Socios/QSA/CPF/person families remain categorically blocked?
Should ZIP opening remain blocked?
Should execution be prefix-only, deterministic-window, or multi-window?
Should seeking be allowed?
Should temp storage be allowed?
Where may temp files be created?
What maximum storage footprint is acceptable?
What runtime ceiling is acceptable?
What output evidence may be retained?
Who reviews the evidence?
Who can stop an execution?
What must happen if a leak is detected?
What rollback/cleanup proof is required?
```

None of these questions are answered by this package. They are the questions a future GATE-2 owner
review (§ 12) would need to resolve before GATE-2 could move from `not_started` to `approved`.

---

## 7. Recommended route

```text
Recommended route: GATE-2 package first, then explicit owner review, then a separate
implementation/execution authorization only if GATE-2 is approved.
```

```text
Do not continue by simply increasing caps.
Do not run multi-window sampling before GATE-2 review.
Do not move to import or staging before GATE-2, GATE-3, GATE-4 and GATE-5 are addressed.
```

---

## 8. Options

### Option A — Keep GATE-2 closed and stop Brazil local-data expansion

```text
Status: safest.
```

Effect: no broader local execution; Brazil remains at the current evidence level established through
BR-SOURCE-11I.

### Option B — Prepare GATE-2 controls and evidence plan only

```text
Status: recommended now.
```

Effect: define controls, checklists, an evidence packet, and approval questions (§ 10) without
authorizing execution.

### Option C — Approve limited broader local execution after GATE-2 owner review

```text
Status: future only, not authorized by this package.
```

Effect: a later milestone could authorize a bounded execution with approved directories, families,
caps, temp storage rules, and output rules — only after GATE-2 is explicitly approved.

### Option D — Approve multi-window coverage signal before GATE-2

```text
Status: not recommended / blocked.
```

Effect: risks turning bounded signals into misleading coverage claims. This mirrors BR-SOURCE-11H
§ 7 Option D and BR-SOURCE-11I § 9 Option C, both of which deferred multi-window sampling pending a
GATE-2 route review.

### Option E — Move directly to import/staging

```text
Status: blocked.
```

Effect: premature because GATE-2, GATE-3, GATE-4 and GATE-5 remain not approved.

---

## 9. Recommended decision

```text
Recommended decision for 11J: Option B — Prepare GATE-2 controls and evidence plan only.
```

The technical carve-outs (BR-SOURCE-11F through 11H-IMPL-V) have shown that safe bounded execution
is possible under strict controls. The next unresolved risk is governance of broader local
execution, not code capability. Therefore the safe next step is to prepare a GATE-2 controls and
evidence plan before any further real-data expansion.

---

## 10. Proposed GATE-2 controls and evidence plan

This section is **documentational and future-facing only**. It proposes the shape a future GATE-2
owner review would need to fill in; it does not fill it in, and it authorizes nothing by being
written.

### 10.1 Execution scope controls

```text
allowedFamilies must be explicitly enumerated;
forbiddenFamilies must be explicitly enumerated;
maxFiles must be explicit;
maxFilesPerFamily must be explicit;
maxBytesPerFile must be explicit;
maxRowsPerFile must be explicit;
maxTotalBytes must be explicit;
maxTotalRows must be explicit;
maxRuntimeSeconds must be explicit;
no implicit cap inheritance;
no automatic cap escalation;
no rerun escalation from zero results.
```

### 10.2 Directory controls

```text
allowedInputRoot must be explicit;
allowedTempRoot must be explicit if temp storage is allowed;
outputInsideRepo must remain forbidden;
Downloads/raw-zips/extracted/manifest-input direct broad access must remain blocked unless
  specifically reviewed;
relative path traversal must be blocked;
symlink handling must be defined;
unsafe basename handling must be defined.
```

### 10.3 Temp storage controls

```text
temp storage default = not_authorized;
if authorized later, temp storage must have max size, max lifetime, cleanup proof and no raw
  persistent samples;
temp storage must never contain raw identifiers in filenames;
temp storage must never store join-key hashes;
cleanup must run on success and failure;
operator must capture cleanup evidence without paths or identifiers.
```

This restates, rather than replaces, the three storage options already named in the approval gates
checklist § 6 (Option A in-memory map, Option B streaming two-pass scan, Option C temporary
encrypted/discardable index as the exception, never the default). A future GATE-2 owner review picks
one explicitly; this package picks none.

### 10.4 Output controls

```text
aggregate-only by default;
no raw rows;
no raw cells;
no identifiers;
no join keys;
no hashes from identifiers;
no filenames or absolute paths;
no joined row samples;
no exact coverage percentage unless separately authorized;
no full dataset denominator unless separately authorized;
no production inference language.
```

### 10.5 Error/log controls

```text
errors must be code-only or bucketed;
no raw stack traces with values;
no local paths;
no filenames;
no offsets tied to raw values;
no line numbers tied to raw values;
no raw SQL/provider payloads;
no join key values.
```

### 10.6 Operator checklist

```text
confirm authorization phrase;
confirm branch/worktree isolation;
confirm no WIP touched;
confirm allowed manifest/control file;
confirm allowed families;
confirm caps;
confirm output outside repo or no output file;
confirm no Supabase/runtime/Agent1 flags;
confirm stop conditions;
confirm cleanup plan;
confirm scan plan;
confirm report template.
```

### 10.7 Stop conditions / kill-switch

```text
stop on any path leak;
stop on any identifier leak;
stop on any join-key leak;
stop on any raw row/cell output;
stop on output inside repo;
stop on unexpected family;
stop on cap overrun;
stop on temp cleanup failure;
stop on unauthorized import/runtime/Supabase/Agent1 flag;
stop on sanitizer finding.
```

### 10.8 Evidence packet requirements

```text
authorization evidence;
scope evidence;
cap evidence;
families attempted/opened;
files opened bucketed;
bytes read bucketed;
rows read bucketed;
runtime bucketed;
temp storage used/not used;
cleanup status;
sanitizer findings;
sensitive scan findings;
fail-closed results;
gate status;
Brazil readiness flags.
```

---

## 11. Protected data policy for the GATE-2 route

```text
CNPJ básico/root remains a protected technical join key.
Full CNPJ remains prohibited from output.
CPF remains prohibited.
Socios/QSA/person data remains blocked unless separately reviewed.
Company/person names must not be printed as evidence.
Addresses, emails, phones, fax and DDD must not be printed.
Join keys must not be printed, persisted, hashed or logged.
No row samples.
No screenshots of real data.
```

---

## 12. Proposed future milestone sequence

This sequence is **proposed only**; it does not authorize any milestone beyond BR-SOURCE-11J.

```text
BR-SOURCE-11K — GATE-2 controls and evidence template
BR-SOURCE-11L — GATE-2 owner review package
BR-SOURCE-11M — Limited broader local execution decision record, only if GATE-2 owner review
  approves
BR-SOURCE-11N — Limited broader local execution implementation, only after explicit authorization
```

```text
This sequence is proposed only.
No milestone after 11J is authorized by this package.
```

---

## 13. Required owner phrase for the next step

```text
AUTHORIZE BR-SOURCE-11K — GATE-2 CONTROLS AND EVIDENCE TEMPLATE
```

This phrase, if and when given, would authorize only a template/design artifact — prose, checklists,
and a proposed evidence-packet shape — never real-data execution and never GATE-2 approval. **It is
not being authorized now.** No implementation, milestone, or branch may cite this section as if the
phrase had already been given.

---

## 14. What remains blocked

```text
GATE-2 approval;
broader local execution;
new real coverage execution;
re-running the 11H coverage signal;
larger caps;
multi-window sampling;
seeking strategy;
opening additional files;
opening catalog files;
opening Socios/QSA/CPF/person files;
opening ZIPs;
temp storage;
exact percentages;
full dataset denominator;
coverage proof;
coverage guarantee;
production inference;
full join;
full dataset processing;
dataset import;
source_company_snapshots writes;
Supabase writes;
migrations;
runtime;
Agent 1;
provider calls;
UI;
Brazil live prospect generation.
```

---

## 15. Gate status

```text
GATE-1  Legal/Privacy approval                 not_started / not approved
GATE-2  Temporary storage envelope              not_started / not approved
GATE-3  Field allowlist                         not_started / not approved
GATE-4  Identity grain                          not_started / not approved
GATE-5  Output sanitization contract            not_started / not approved
GATE-6  Failure cleanup contract                not_started / not approved
GATE-7  Operator runbook                        not_started / not approved
GATE-8  No-write / no-runtime guarantee         not_started / not approved
```

No gate changes status as a result of this package. This package does not submit any gate for
review.

---

## 16. Flags

```text
OPS_BR_GATE2_ROUTE_DECISION_PACKAGE_PR_READY = false until PR
OPS_BR_GATE2_ROUTE_DECISION_PACKAGE_OFFICIAL = false until merge

OPS_BR_GATE2_CONTROLS_EVIDENCE_TEMPLATE_AUTHORIZED = false
OPS_BR_GATE2_OWNER_REVIEW_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

OPS_BR_COVERAGE_SIGNAL_INTERPRETATION_GATE2_ROUTE_DECISION_RECORD_OFFICIAL = true
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

`OPS_BR_GATE2_ROUTE_DECISION_PACKAGE_PR_READY` flips to `true` only once this docs-only PR is open;
`..._OFFICIAL` flips to `true` only once it is merged. Neither flip changes any operational flag, and
every Brazil-readiness flag stays `false` regardless of either.

---

## 17. Next milestone mapping

```text
If the owner accepts this package:
BR-SOURCE-11K may create the GATE-2 controls and evidence template.

If the owner wants GATE-2 approval:
a later explicit GATE-2 owner review package is required.

If the owner wants broader execution:
GATE-2 must first be explicitly approved, and a separate execution decision record is required.

If the owner wants import:
a later import-readiness process is required after relevant gates.

This package does not authorize any of those actions.
```

---

## 18. Safety confirmation

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

---

## 19. Update (BR-SOURCE-11K)

BR-SOURCE-11K creates the GATE-2 controls and evidence template. It provides a review checklist,
evidence packet format, fail-closed validation matrix, and owner decision matrix for a future GATE-2
owner review. It does not approve GATE-2. It does not authorize owner review, broader local
execution, temp storage, multi-window sampling, exact coverage percentages, import, Supabase writes,
runtime, or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md).

---

## 20. Update (BR-SOURCE-11L)

BR-SOURCE-11L creates the GATE-2 owner review package. It assembles current evidence, evidence gaps,
owner questions, decision options, a risk register and required decision fields for a future GATE-2
decision record. It does not approve GATE-2. It does not authorize a GATE-2 decision, broader local
execution, temp storage, multi-window sampling, exact percentages, import, Supabase writes, runtime,
or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-gate2-owner-review-package.md`](./br-receita-cnpj-gate2-owner-review-package.md).
