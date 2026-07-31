# BR-SOURCE-11K — GATE-2 controls and evidence template

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11K — GATE-2 controls and evidence template (docs-only)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, **not** an authorization for owner review, broader local execution, temp storage, multi-window sampling, exact coverage percentages, a full-dataset denominator, import, Supabase writes, runtime, or Agent 1, and **not** an approval of any gate
**Predecessor:** BR-SOURCE-11J-LAND — `BRSOURCE11JLANDA — GATE2_ROUTE_DECISION_PACKAGE_MERGED` (PR #185, `main` HEAD `81fe192539c48188db63570adb4b06c103297767`)
**Authorization received:** `AUTHORIZE BR-SOURCE-11K — GATE-2 CONTROLS AND EVIDENCE TEMPLATE` — authorizes only this template/design artifact, never GATE-2 approval and never real-data execution
**Last reviewed:** 2026-07-31

**Related documents:**
- GATE-2 route decision package (BR-SOURCE-11J) — [`br-receita-cnpj-gate2-route-decision-package.md`](./br-receita-cnpj-gate2-route-decision-package.md)
- Coverage signal interpretation and GATE-2 route decision record (BR-SOURCE-11I) — [`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join approval gates checklist (GATE-2 definition, § 6) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)

---

> This document is a **review-preparation artifact**, not an approval artifact and not an execution
> artifact. BR-SOURCE-11J routed the decision toward preparing GATE-2 controls and evidence before any
> broader local execution (Option B). This document is that preparation: a structured checklist, an
> evidence packet format, a fail-closed validation matrix, and an owner decision matrix a future GATE-2
> owner review can use instead of improvising one. **§ 1–21 supply that structure; they approve no gate
> and authorize no execution.**

---

## 1. Status

```text
Template status:          proposed_for_owner_review
GATE-2 approval status:   not_started / not approved
Owner review status:      not_authorized
Implementation status:    not_authorized
Execution status:         not_authorized
Current GO/NO-GO:         NO-GO
```

Explicitly, this template does **not** authorize:

```text
This template does not approve GATE-2.
This template does not authorize GATE-2 owner review.
This template does not authorize broader local execution.
This template does not authorize temp storage.
This template does not authorize any new real-data execution.
This template does not authorize multi-window sampling.
This template does not authorize exact coverage percentages.
This template does not authorize full dataset denominator claims.
This template does not authorize full join execution.
This template does not authorize import.
This template does not authorize Supabase writes.
This template does not authorize runtime.
This template does not authorize Agent 1.
This template does not approve any gate.
```

---

## 2. Purpose

The purpose of this template is to give a future GATE-2 owner review a structured checklist, evidence
packet format, decision matrix, and stop-condition framework before any broader local execution can be
considered.

```text
This is a review-preparation artifact, not an approval artifact and not an execution artifact.
```

---

## 3. Background

```text
11A runner scaffold.
11B synthetic validation.
11C synthetic temp-manifest.
11D real manifest metadata-only.
11E real manifest metadata-only execution.
11F real data-file required-family probe.
11G real required-family join probe.
11H real aggregate-only coverage signal.
11I interpretation of zero and recommendation to stop cap expansion.
11J GATE-2 route decision package.
```

```text
11J recommended preparing GATE-2 controls and evidence before any broader local execution.
11K implements that recommendation as a template only.
```

---

## 4. How to use this template

```text
The reviewer should complete each section before any future GATE-2 approval discussion.
Unanswered mandatory fields keep GATE-2 blocked.
Any answer that expands execution scope must be reviewed explicitly.
The template must be attached to a future owner review package.
The template must not be used as a runtime command, CLI plan, or execution authorization.
```

Possible field/section states:

```text
not_started
answered
approved_for_owner_review
rejected
requires_follow_up
blocked
```

---

## 5. GATE-2 decision summary template

```text
Gate:
Review package:
Reviewer / owner:
Date:
Decision:
Decision status:
Allowed execution scope:
Allowed input root:
Allowed temp root:
Temp storage:
Allowed families:
Forbidden families:
Max files:
Max files per family:
Max bytes per file:
Max rows per file:
Max total bytes:
Max total rows:
Max runtime seconds:
Output mode:
Output retention:
Cleanup requirement:
Stop conditions:
Evidence retained:
Decision expiry:
Required follow-up:
```

```text
The default value for each execution-related field is not_authorized.
```

---

## 6. Execution scope controls template

```text
allowedFamilies:
forbiddenFamilies:
maxFiles:
maxFilesPerFamily:
maxBytesPerFile:
maxRowsPerFile:
maxTotalBytes:
maxTotalRows:
maxRuntimeSeconds:
selectionStrategy:
seekingAllowed:
multiWindowAllowed:
rerunAllowed:
capEscalationAllowed:
```

Defaults:

```text
selectionStrategy = not_authorized
seekingAllowed = false
multiWindowAllowed = false
rerunAllowed = false
capEscalationAllowed = false
```

```text
No implicit cap inheritance.
No automatic cap escalation.
No rerun escalation from zero results.
```

---

## 7. Directory controls template

```text
allowedInputRoot:
allowedManifestControlFile:
allowedTempRoot:
outputRoot:
outputInsideRepoAllowed:
pathTraversalBlocked:
symlinkPolicy:
unsafeBasenamePolicy:
downloadsAccessPolicy:
rawZipsAccessPolicy:
extractedAccessPolicy:
manifestInputAccessPolicy:
```

Defaults:

```text
outputInsideRepoAllowed = false
pathTraversalBlocked = true
downloadsAccessPolicy = blocked unless explicitly approved
rawZipsAccessPolicy = blocked unless explicitly approved
extractedAccessPolicy = blocked unless explicitly approved
manifestInputAccessPolicy = blocked unless explicitly approved
```

---

## 8. Temp storage controls template

```text
tempStorageDefault = not_authorized
```

```text
tempStorageAllowed:
allowedTempRoot:
maxTempBytes:
maxTempFiles:
maxTempLifetimeSeconds:
rawIdentifiersInTempFilenamesAllowed:
joinKeyHashesInTempAllowed:
rawSamplesInTempAllowed:
cleanupOnSuccessRequired:
cleanupOnFailureRequired:
cleanupEvidenceRequired:
```

Defaults:

```text
rawIdentifiersInTempFilenamesAllowed = false
joinKeyHashesInTempAllowed = false
rawSamplesInTempAllowed = false
cleanupOnSuccessRequired = true
cleanupOnFailureRequired = true
cleanupEvidenceRequired = true
```

---

## 9. Output and evidence controls template

```text
outputMode:
rawRowsAllowed:
rawCellsAllowed:
identifiersAllowed:
joinKeysAllowed:
joinKeyHashesAllowed:
companyNamesAllowed:
personNamesAllowed:
addressesAllowed:
emailsAllowed:
phonesAllowed:
filenamesAllowed:
absolutePathsAllowed:
joinedRowsAllowed:
samplesAllowed:
exactPercentagesAllowed:
fullDatasetDenominatorAllowed:
coverageProofLanguageAllowed:
productionInferenceAllowed:
```

Defaults:

```text
outputMode = aggregate_only
all sensitive/raw/identifier fields = false
exactPercentagesAllowed = false
fullDatasetDenominatorAllowed = false
coverageProofLanguageAllowed = false
productionInferenceAllowed = false
```

---

## 10. Error and log controls template

```text
errorMode:
rawStackTracesAllowed:
localPathsInErrorsAllowed:
filenamesInErrorsAllowed:
lineNumbersTiedToValuesAllowed:
byteOffsetsTiedToValuesAllowed:
rawPayloadsInErrorsAllowed:
joinKeysInErrorsAllowed:
identifierValuesInErrorsAllowed:
```

Defaults:

```text
errorMode = code_only_or_bucketed
all leak-prone fields = false
```

---

## 11. Protected data policy checklist

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
No raw evidence copied into tickets, PRs, docs, comments or chat.
```

---

## 12. Operator checklist template

```text
authorization phrase confirmed;
branch/worktree isolation confirmed;
main ancestor confirmed;
no WIP touched;
scope allowlist confirmed;
manifest/control file confirmed;
allowed families confirmed;
forbidden families confirmed;
caps confirmed;
output mode confirmed;
output outside repo confirmed or no output file;
no Supabase flags confirmed;
no runtime flags confirmed;
no Agent 1 flags confirmed;
no provider flags confirmed;
stop conditions confirmed;
cleanup plan confirmed;
sensitive scan plan confirmed;
report template confirmed;
```

---

## 13. Stop conditions / kill-switch template

```text
stop on path leak;
stop on identifier leak;
stop on join-key leak;
stop on raw row/cell output;
stop on output inside repo;
stop on unexpected family;
stop on cap overrun;
stop on temp cleanup failure;
stop on unauthorized import flag;
stop on unauthorized Supabase flag;
stop on unauthorized runtime flag;
stop on unauthorized Agent 1 flag;
stop on provider call;
stop on sanitizer finding;
stop on unknown output surface;
stop on reviewer uncertainty.
```

---

## 14. Evidence packet template

```text
authorization evidence:
scope evidence:
directory evidence:
family allowlist evidence:
family denylist evidence:
cap evidence:
files attempted bucket:
files opened bucket:
bytes read bucket:
rows read bucket:
runtime bucket:
temp storage used:
temp storage cleanup status:
output mode:
sanitizer findings:
sensitive scan findings:
fail-closed results:
no-write evidence:
no-runtime evidence:
no-Agent1 evidence:
no-provider evidence:
gate status:
Brazil readiness flags:
owner decision:
owner notes:
```

```text
No raw rows in evidence.
No raw cells in evidence.
No identifiers in evidence.
No join keys in evidence.
No hashes derived from identifiers.
No screenshots of real data.
No absolute paths.
No filenames unless separately approved and safe.
```

---

## 15. Fail-closed validation matrix template

| Case | Expected result | Actual result | Evidence artifact | Pass/Fail | Reviewer notes |
|---|---|---|---|---|---|
| missing authorization phrase | reject before any file is opened | | | | |
| missing strict mode | reject before any file is opened | | | | |
| missing cap | reject before any file is opened | | | | |
| cap above max | reject | | | | |
| forbidden family requested | reject | | | | |
| unexpected family opened | stop run | | | | |
| more files than allowed | stop run | | | | |
| more rows than allowed | stop run | | | | |
| more bytes than allowed | stop run | | | | |
| temp storage requested without approval | reject | | | | |
| output inside repo requested | reject | | | | |
| exact percentage requested | reject | | | | |
| full dataset denominator requested | reject | | | | |
| coverage proof requested | reject | | | | |
| production inference requested | reject | | | | |
| join key output requested | reject | | | | |
| sample output requested | reject | | | | |
| import flag requested | reject | | | | |
| Supabase flag requested | reject | | | | |
| runtime flag requested | reject | | | | |
| Agent 1 flag requested | reject | | | | |
| provider flag requested | reject | | | | |

This matrix is a **template of cases to fill in during a future execution rehearsal**; it records no
result today, because no execution is authorized by this milestone.

---

## 16. Owner review decision matrix

```text
Approve template only
Request changes to template
Approve GATE-2 owner review package preparation
Reject broader local execution
Escalate to legal/privacy/security
Request additional documentation only
```

```text
No option in this matrix approves GATE-2 by itself.
```

---

## 17. Gate relationship

```text
GATE-1  not_started / not approved
GATE-2  not_started / not approved
GATE-3  not_started / not approved
GATE-4  not_started / not approved
GATE-5  not_started / not approved
GATE-6  not_started / not approved
GATE-7  not_started / not approved
GATE-8  not_started / not approved
```

```text
This template may support a future GATE-2 discussion.
It cannot be cited as GATE-2 approval.
It cannot be cited as import readiness.
It cannot be cited as runtime readiness.
It cannot be cited as Agent 1 readiness.
```

---

## 18. Required owner phrase for the next step

```text
AUTHORIZE BR-SOURCE-11L — GATE-2 OWNER REVIEW PACKAGE
```

This phrase would authorize only preparation of the owner review package, not GATE-2 approval and not
real-data execution. **It is not being authorized now.**

---

## 19. What remains blocked

```text
GATE-2 approval;
GATE-2 owner review;
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

## 20. Flags

```text
OPS_BR_GATE2_CONTROLS_EVIDENCE_TEMPLATE_PR_READY = false until PR
OPS_BR_GATE2_CONTROLS_EVIDENCE_TEMPLATE_OFFICIAL = false until merge

OPS_BR_GATE2_CONTROLS_EVIDENCE_TEMPLATE_AUTHORIZED = true
OPS_BR_GATE2_OWNER_REVIEW_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

OPS_BR_GATE2_ROUTE_DECISION_PACKAGE_OFFICIAL = true

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

`OPS_BR_GATE2_CONTROLS_EVIDENCE_TEMPLATE_PR_READY` flips to `true` only once this docs-only PR is open;
`..._OFFICIAL` flips to `true` only once it is merged. Neither flip changes any operational flag, and
every Brazil-readiness flag stays `false` regardless of either.

---

## 21. Next milestone mapping

```text
If the owner accepts this template:
BR-SOURCE-11L may prepare the GATE-2 owner review package.

If the owner wants GATE-2 approval:
the owner review package must be completed and explicitly approved later.

If the owner wants broader execution:
GATE-2 must first be explicitly approved, and a separate execution decision record is required.

If the owner wants import:
a later import-readiness process is required after relevant gates.

This template does not authorize any of those actions.
```

---

## 22. Safety confirmation

This document is **docs-only**. It does **not**:

- authorize execution;
- approve GATE-2;
- approve any gate;
- authorize GATE-2 owner review;
- authorize broader local execution;
- authorize temp storage;
- authorize multi-window sampling;
- authorize exact coverage percentages or a full-dataset denominator;
- authorize import, Supabase writes, migrations, runtime, or Agent 1 integration;
- change UI;
- edit `MEMORY.md`;
- merge.

Brazil remains blocked for import, runtime, Agent 1, and live prospect generation.
