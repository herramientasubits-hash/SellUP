# BR-SOURCE-11N — Limited broader local execution decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11N — Limited broader local execution decision record (docs-only)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, **not** an authorization for limited
broader local execution, broader local execution, implementation, temp storage, new real-data execution,
re-running the 11H coverage signal, cap expansion, multi-window sampling, exact coverage percentages, a
full-dataset denominator, full join execution, import, Supabase writes, runtime, or Agent 1, and **not**
an approval of any gate
**Predecessor:** BR-SOURCE-11M-LAND — `BRSOURCE11MLANDA — GATE2_FORMAL_DECISION_RECORD_MERGED` (PR #189,
`main` HEAD `6c061a6494240c49cb685dc161e7594d0cbfe627`, merge method `--merge`, parent count 2)
**Authorization received:** `AUTHORIZE BR-SOURCE-11N — LIMITED BROADER LOCAL EXECUTION DECISION RECORD` —
authorizes only the preparation of this decision record, never GATE-2 approval, never limited broader
local execution, never broader local execution, never implementation, and never real-data execution
**Last reviewed:** 2026-08-03

**Related documents:**
- GATE-2 formal decision record (BR-SOURCE-11M) — [`br-receita-cnpj-gate2-formal-decision-record.md`](./br-receita-cnpj-gate2-formal-decision-record.md)
- GATE-2 owner review package (BR-SOURCE-11L) — [`br-receita-cnpj-gate2-owner-review-package.md`](./br-receita-cnpj-gate2-owner-review-package.md)
- GATE-2 controls and evidence template (BR-SOURCE-11K) — [`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md)
- GATE-2 route decision package (BR-SOURCE-11J) — [`br-receita-cnpj-gate2-route-decision-package.md`](./br-receita-cnpj-gate2-route-decision-package.md)
- Coverage signal interpretation and GATE-2 route decision record (BR-SOURCE-11I) — [`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join approval gates checklist (GATE-2 definition, § 6) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join output sanitization decision record — [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)

---

> This document is a **decision-record preparation artifact**. BR-SOURCE-11M produced the GATE-2 formal
> decision record and named 11N as the next docs-only artifact. This document is that artifact: it defines
> the proposed decision boundaries, candidate scope, candidate caps, access controls, mandatory output
> controls, fail-closed cases, stop conditions, formal options and required owner decision fields for a
> **possible future** limited broader local execution over Receita CNPJ files. **§ 1–28 supply that
> artifact; they approve no gate, authorize no implementation, and authorize no execution.** GATE-2 is
> still `not_started / not approved`, so the only valid current decision is **NO-GO** for execution.

---

## 1. Status

```text
Decision record status:                            proposed_for_owner_review
GATE-2 approval status:                            not_started / not approved
Limited broader local execution decision status:   not_authorized
Limited broader local execution implementation:    not_authorized
Execution status:                                  not_authorized
Current GO/NO-GO:                                  NO-GO
```

Explicitly, this decision record does **not** authorize:

```text
This decision record does not approve GATE-2.
This decision record does not authorize limited broader local execution.
This decision record does not authorize broader local execution.
This decision record does not authorize implementation.
This decision record does not authorize temp storage.
This decision record does not authorize any new real-data execution.
This decision record does not authorize re-running 11H.
This decision record does not authorize cap expansion in runtime.
This decision record does not authorize multi-window sampling.
This decision record does not authorize exact coverage percentages.
This decision record does not authorize full dataset denominator claims.
This decision record does not authorize full join execution.
This decision record does not authorize import.
This decision record does not authorize Supabase writes.
This decision record does not authorize runtime.
This decision record does not authorize Agent 1.
This decision record does not approve any gate.
```

---

## 2. Purpose

```text
The purpose of this decision record is to define the proposed decision boundaries, candidate scope,
required prerequisites and explicit non-authorizations for a possible future limited broader local
execution over Receita CNPJ files.
```

```text
This is a decision-record preparation artifact, not an execution approval, not an implementation approval
and not a GATE-2 approval.
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
11K GATE-2 controls and evidence template.
11L GATE-2 owner review package.
11L merge audit documented a process exception: PR #187 was squash-merged instead of merge-committed,
with content/scope/safety valid and no rollback recommended.
11M GATE-2 formal decision record.
```

```text
11M prepared the formal decision record and proposed 11N as the next decision-record artifact only.
11N does not imply GATE-2 approval or execution authorization.
```

---

## 4. Prerequisite boundary

```text
A limited broader local execution cannot be implemented or executed unless GATE-2 is explicitly approved
later.
```

```text
As of this record, GATE-2 remains not_started / not approved.
Therefore the only valid current decision is NO-GO for execution.
```

```text
This record may define candidate scope and controls for future review, but those controls remain proposed
only.
```

---

## 5. Decision boundary

This record may decide or propose only:

```text
whether a future limited broader local execution decision path should remain documented;
which candidate scope could be reviewed later;
which prerequisites must be satisfied before any implementation;
which controls must be mandatory if a later owner approves execution;
which options remain available to the owner.
```

It explicitly excludes:

```text
actual execution;
implementation;
runtime approval;
import approval;
field persistence approval;
identity grain approval;
source_company_snapshots writes;
Supabase writes;
Agent 1 approval;
provider integration;
production/liveness approval.
```

---

## 6. Evidence considered

```text
11D/11E: real manifest metadata-only path passed.
11F: required-family real file probe passed under ultra-bounded caps.
11G: required-family real join probe passed under ultra-bounded caps.
11H: aggregate-only real coverage signal passed under ultra-bounded caps.
11I: zero match result interpreted as valid bounded-window outcome, not a failure.
11J: GATE-2 route decision package official.
11K: GATE-2 controls and evidence template official.
11L: GATE-2 owner review package official.
11L merge audit: squash merge process exception documented; no content/safety issue found.
11M: GATE-2 formal decision record official.
Output sanitizer posture held.
Fail-closed posture held.
No-write/no-runtime posture held.
All gates remain not approved.
```

```text
This evidence supports drafting this decision record.
It does not prove dataset coverage.
It does not prove import readiness.
It does not prove runtime readiness.
It does not prove Agent 1 readiness.
It does not approve GATE-2.
It does not authorize limited broader local execution.
```

No new evidence was produced for this record: no real file was opened, no real manifest was read, no row
was processed, no join was executed, and no coverage figure was computed.

---

## 7. Candidate execution scope — proposed only

```text
candidateScopeStatus:            proposed_only / not_authorized
candidateFamilies:               Empresas and Estabelecimentos only
forbiddenFamilies:               Socios, QSA, CPF, person-related files, ZIP opening, support catalog
                                 families unless separately reviewed
candidateMode:                   local controlled dry-run only
candidateOutputMode:             aggregate-only / bucketed
candidateRuntimeIntegration:     false
candidateSupabaseWrites:         false
candidateAgent1Integration:      false
candidateProviderCalls:          false
candidateProductionUse:          false
```

```text
Candidate scope is not approved scope.
Candidate scope cannot be used as CLI instructions.
Candidate scope cannot be used to run anything.
```

---

## 8. Candidate caps — proposed only

```text
candidateCapsStatus:  proposed_only / not_authorized
maxFilesOpened:       TBD by owner, default not_authorized
maxFilesPerFamily:    TBD by owner, default not_authorized
maxBytesPerFile:      TBD by owner, default not_authorized
maxRowsPerFile:       TBD by owner, default not_authorized
maxTotalBytes:        TBD by owner, default not_authorized
maxTotalRows:         TBD by owner, default not_authorized
maxRuntimeSeconds:    TBD by owner, default not_authorized
maxTempBytes:         not_authorized
maxOutputArtifacts:   TBD by owner, default not_authorized
```

```text
No implicit cap inheritance from 11H.
No automatic cap escalation.
No escalation from zero results.
No runtime caps are authorized by this record.
```

Every cap above is a placeholder awaiting an owner value. An unset cap is not an unlimited cap: absent an
explicit owner-approved value, the cap resolves to `not_authorized` and any future implementation must
fail closed rather than default to a permissive value.

---

## 9. Directory and file access controls — proposed only

```text
allowedInputRoot:              TBD by owner, default not_authorized
allowedManifestControlFile:    TBD by owner, default not_authorized
allowedTempRoot:               not_authorized
outputRoot:                    TBD by owner or no-output-file, default not_authorized
outputInsideRepoAllowed:       false
pathTraversalBlocked:          true
symlinkPolicy:                 block unless separately reviewed
unsafeBasenamePolicy:          block
downloadsAccessPolicy:         blocked unless explicitly approved
rawZipsAccessPolicy:           blocked unless explicitly approved
extractedAccessPolicy:         blocked unless explicitly approved
manifestInputAccessPolicy:     blocked unless explicitly approved
```

```text
No real local paths may be documented in this record.
No filenames from real data may be documented.
No absolute paths may be output.
```

Any future owner-approved directory value must be conveyed through the operator channel, not through this
public document.

---

## 10. Temp storage decision — proposed only

```text
tempStorageStatus: not_authorized
```

```text
If temp storage is ever considered later, it requires separate owner approval.
Temp storage must not contain raw identifiers in filenames.
Temp storage must not contain join-key hashes.
Temp storage must not contain row samples.
Cleanup on success and failure would be mandatory.
Cleanup evidence would need to be bucketed and path-free.
```

---

## 11. Output and evidence controls — mandatory if ever authorized later

```text
aggregateOnlyOutput:             true
rawRowsAllowed:                  false
rawCellsAllowed:                 false
identifiersAllowed:              false
joinKeysAllowed:                 false
joinKeyHashesAllowed:            false
companyNamesAllowed:             false
personNamesAllowed:              false
addressesAllowed:                false
emailsAllowed:                   false
phonesAllowed:                   false
filenamesAllowed:                false unless separately approved
absolutePathsAllowed:            false
joinedRowsAllowed:               false
samplesAllowed:                  false
exactPercentagesAllowed:         false unless separately approved
fullDatasetDenominatorAllowed:   false unless separately approved
coverageProofLanguageAllowed:    false
coverageGuaranteeLanguageAllowed: false
productionInferenceAllowed:      false
```

These controls are mandatory conditions on a hypothetical future execution. Listing them here does not
authorize the execution they would constrain.

---

## 12. Protected data policy

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

## 13. Required fail-closed cases for any future implementation

```text
missing authorization phrase;
GATE-2 not approved;
missing strict mode;
missing cap;
cap above approved max;
forbidden family requested;
unexpected family opened;
more files than allowed;
more rows than allowed;
more bytes than allowed;
temp storage requested without approval;
output inside repo requested;
exact percentage requested without separate approval;
full dataset denominator requested without separate approval;
coverage proof requested;
coverage guarantee requested;
production inference requested;
join key output requested;
sample output requested;
import flag requested;
Supabase flag requested;
runtime flag requested;
Agent 1 flag requested;
provider flag requested;
```

Each case must abort before any file is opened, not after. Fail-closed means the absence of an explicit
approval is a stop, never a default-allow.

---

## 14. Stop conditions / kill-switch

```text
stop on GATE-2 not approved;
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

## 15. Formal decision options

```text
Option A — Reject limited broader local execution path
Effect: Brazil remains at current ultra-bounded evidence level.

Option B — Request additional documentation only
Effect: More docs may be prepared, but no execution or implementation.

Option C — Keep candidate scope documented but blocked
Effect: Candidate scope remains available for future review, but no execution path is authorized.

Option D — Authorize a later implementation design package only
Effect: A later hito may design implementation details, but no execution or real-data reads.

Option E — Escalate to legal/privacy/security before implementation design
Effect: No implementation design until external review is complete.

Option F — Authorize execution now
Status: blocked / not allowed by this record.
Reason: GATE-2 is not approved and this record is not an execution authorization.
```

---

## 16. Recommended draft decision

```text
Recommended draft decision for 11N: Option C — Keep candidate scope documented but blocked.
```

```text
11N itself does not authorize Option D or any implementation design.
11N itself does not approve GATE-2.
11N itself does not authorize execution.
A separate exact owner phrase is required for any next hito.
```

Rationale for Option C: the candidate scope, caps, access controls and output controls are now written
down and reviewable, which is the durable value of this record. Nothing about the current evidence base
requires an execution path to open, and GATE-2 remains closed, so keeping the scope documented-but-blocked
preserves the option without creating a new spend, privacy or write surface.

---

## 17. Required owner decision fields

```text
Owner:
Review date:
Decision option selected:
Decision status:
Rationale:
Required changes:
Legal/privacy/security escalation required:
Candidate scope accepted for future review:
Implementation design package authorized:
Limited broader local execution authorized:
Temp storage authorized:
New real-data execution authorized:
Import authorized:
Supabase writes authorized:
Runtime authorized:
Agent 1 authorized:
Expiration / re-review date:
Owner signature / approval reference:
```

```text
All authorization fields default to false unless explicitly approved later.
```

---

## 18. Conditions before any implementation design package

```text
GATE-2 explicitly approved later, or owner explicitly accepts design-only path without execution;
candidate families reviewed;
forbidden families confirmed;
directory policy reviewed;
temp storage remains blocked or separately decided;
output/evidence controls confirmed;
protected data policy confirmed;
fail-closed matrix accepted;
stop conditions accepted;
no import/runtime/Agent1/provider flags introduced;
implementation design scope explicitly limited to design only;
```

```text
These conditions do not authorize implementation or execution.
```

---

## 19. Conditions before any execution, if ever considered later

```text
GATE-2 explicitly approved;
limited broader local execution decision record explicitly approved;
implementation merged;
post-merge validation passed;
exact authorization phrase for execution received;
allowed families enumerated;
approved caps enumerated;
approved directories enumerated without leaking real paths in public docs;
temp storage approved or explicitly disabled;
output mode approved;
sensitive scan plan approved;
fail-closed validation passed;
operator checklist completed;
rollback/cleanup plan approved;
no import/runtime/Agent1/provider flags introduced;
```

```text
None of these conditions are satisfied by 11N.
```

---

## 20. Risk table

| Risk | Current status | Required control | Blocks candidate execution? | Blocks import/runtime? |
|---|---|---|---|---|
| GATE-2 not approved | Open — GATE-2 is `not_started / not approved` | GATE-2 must be explicitly approved by an owner before any implementation or execution | Yes | Yes |
| Scope creep | Open — candidate scope is proposed only | Candidate families fixed to Empresas/Estabelecimentos; every widening requires a separate owner decision | Yes | Yes |
| Coverage signal misread | Open — a bounded-window zero is not a dataset-level result | Aggregate-only posture; exact percentages and full-dataset denominators stay blocked; no coverage proof or guarantee language | Yes | Yes |
| Join key leakage | Mitigated by design; no approved change | CNPJ básico/root never printed, hashed, logged or persisted | Yes | Yes |
| Temp storage leakage | Blocked — `tempStorageStatus: not_authorized` | Temp storage stays blocked unless separately approved, with mandatory path-free cleanup evidence | Yes | Yes |
| Person/CPF exposure | Blocked — Socios/QSA/CPF/person families categorically out of candidate scope | Forbidden families remain blocked unless separately reviewed; no ZIP opening | Yes | Yes |
| File/path leakage | Mitigated by design; no approved change | No absolute paths, no real filenames, bucketed evidence only; approved directories conveyed via operator channel | Yes | Yes |
| Operator cap overrun | Open — all candidate caps are `TBD / not_authorized` | Explicit owner-approved caps, fail-closed on missing or exceeded cap, kill-switch | Yes | Yes |
| Premature import activation | Blocked — `IMPORT_READY = false`, no Supabase flags introduced | Import remains a separate later gate; no writes, no migrations | Yes | Yes |
| Premature runtime/Agent 1 use | Blocked — `RUNTIME_READY = false`, `AGENT1_READY = false` | All runtime/Agent 1 flags remain false; no runtime wiring in any candidate scope | Yes | Yes |
| Provider call leakage | Blocked — `candidateProviderCalls: false` | Zero provider calls in candidate scope; stop on any provider call | Yes | Yes |
| Process discipline / merge strategy exception from 11L | Documented (PR #187 squash-merged instead of merge-committed; content/scope/safety valid, no rollback recommended) | Future BR-SOURCE PRs merged with `gh pr merge <PR> --merge --delete-branch` after explicit approval | No | No |

---

## 21. Decision non-goals

```text
This decision record is not a GATE-2 approval.
This decision record is not an execution approval.
This decision record is not an implementation approval.
This decision record is not an import-readiness record.
This decision record is not a field allowlist approval.
This decision record is not an identity grain approval.
This decision record is not a runtime integration approval.
This decision record is not an Agent 1 integration approval.
This decision record is not a provider integration approval.
This decision record is not a production readiness record.
```

---

## 22. Proposed future milestone sequence

```text
BR-SOURCE-11O — Limited broader local execution implementation design package, only if explicitly
authorized.
BR-SOURCE-11P — Limited broader local execution implementation, only if design and authorization are
approved later.
BR-SOURCE-11Q — Post-merge validation for implementation, only if 11P is merged.
BR-SOURCE-11R — Execution authorization decision, only after GATE-2 and implementation validation.
```

```text
This sequence is proposed only.
No milestone after 11N is authorized by this record.
```

Earlier records (11J, 11L) sketched a different letter mapping for the post-11M path. The sequence above
supersedes those sketches for naming purposes only; it changes no authorization, and every milestone in it
remains unauthorized.

---

## 23. Required owner phrase for next step

```text
AUTHORIZE BR-SOURCE-11O — LIMITED BROADER LOCAL EXECUTION IMPLEMENTATION DESIGN PACKAGE
```

```text
This phrase would authorize only a design package.
It would not authorize implementation.
It would not authorize execution.
It would not authorize temp storage.
It would not approve import.
It would not approve Supabase writes.
It would not approve runtime.
It would not approve Agent 1.
```

---

## 24. What remains blocked

```text
GATE-2 approval;
limited broader local execution;
broader local execution;
implementation;
new real coverage execution;
re-running 11H coverage signal;
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

## 25. Gate status

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

---

## 26. Flags

```text
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_DECISION_RECORD_AUTHORIZED = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_DECISION_RECORD_PR_READY = false until PR
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_DECISION_RECORD_OFFICIAL = false until merge

OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_DESIGN_AUTHORIZED = false
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

OPS_BR_GATE2_FORMAL_DECISION_RECORD_OFFICIAL = true
OPS_BR_GATE2_OWNER_REVIEW_PACKAGE_OFFICIAL = true
OPS_BR_GATE2_CONTROLS_EVIDENCE_TEMPLATE_OFFICIAL = true
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

`OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_DECISION_RECORD_PR_READY` flips to `true` only once this docs-only
PR is open; `..._OFFICIAL` flips to `true` only once it is merged. Neither flip changes any operational
flag, and every Brazil-readiness flag stays `false` regardless of either.

---

## 27. Next milestone mapping

```text
If the owner accepts this decision record:
BR-SOURCE-11O may prepare the limited broader local execution implementation design package.

If the owner wants implementation:
11O must first define implementation design, and a later implementation hito must be explicitly
authorized.

If the owner wants execution:
GATE-2, implementation and execution authorization must be explicitly approved later.

If the owner wants import:
a later import-readiness process is required after relevant gates.

This decision record does not authorize any of those actions.
```

---

## 28. Safety confirmation

```text
This document is docs-only.
It does not authorize execution.
It does not authorize implementation.
It does not approve GATE-2.
It does not approve any gate.
Brazil remains blocked for import, runtime, Agent 1 and live prospect generation.
```

This milestone touched no code, no scripts, no package manifest, no Supabase schema, no migration, no
runtime path, no Agent 1 path, no provider, and no UI. It opened no real dataset file, read no real
manifest, processed no row, executed no join, and computed no coverage figure.

---

## 29. Update (BR-SOURCE-11O)

BR-SOURCE-11O creates the limited broader local execution implementation design package.
It describes proposed architecture, control flow, conceptual CLI/API contract, data-family policy, cap
model, join handling, output/evidence model, fail-closed design, stop conditions, future test strategy and
sequencing. It does not approve GATE-2. It does not authorize implementation, limited broader local
execution, broader local execution, temp storage, multi-window sampling, exact percentages, import,
Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md`](./br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md).

The candidate scope, candidate caps, access controls and output controls in § 7–14 of this record remain
`proposed_only / not_authorized`; 11O designs how they would be enforced, and changes none of them.

---

## 30. Update (BR-SOURCE-11R)

BR-SOURCE-11R creates the execution authorization decision record.
It documents current blockers, owner decision options, required owner fields, minimum conditions before
execution and before a runbook, evidence requirements, stop conditions, a risk table and future milestone
mapping. It does not approve GATE-2. It does not authorize execution, real-data access, caps, input roots,
output roots, temp storage, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-execution-authorization-decision-record.md`](./br-receita-cnpj-execution-authorization-decision-record.md).

The candidate caps in § 7–14 of this record are still `proposed_only / not_authorized` after 11P, 11Q and
11R. The 11P scaffold records an all-`null` cap ceiling precisely so that no candidate cap here is mistaken
for an authorized one, and 11R lists that absence as a non-negotiable blocker rather than resolving it.

---

## 31. Update (BR-SOURCE-11S)

BR-SOURCE-11S creates the execution runbook.
It documents roles, checklists, a non-executable command skeleton, stop conditions, an evidence template, an
incident path, a future validation template and milestone mapping. It does not approve GATE-2. It does not
authorize execution, real-data access, caps, input roots, temp storage, import, Supabase, runtime or Agent 1.
It does not approve any gate. See
[`br-receita-cnpj-execution-runbook.md`](./br-receita-cnpj-execution-runbook.md).

The candidate caps in § 8, the access controls in § 9, the temp-storage position in § 10 and the output
controls in § 11 are unchanged by 11S. The runbook's command skeleton carries cap placeholders that name the
future authorization artifact rather than any value from § 8, and it carries no path-bearing argument at all,
so nothing in § 9 becomes fillable through it.

BR-SOURCE-11T creates the cap/input policy authorization package. It documents cap categories, input
classes, output policy categories, family allow/deny policy, manifest/control-file policy, temp storage
policy, evidence bucket policy, exact percentage/denominator policy, owner fields, stop conditions and
future milestone mapping. It does not approve GATE-2. It does not authorize execution, real-data access,
caps, input roots, output roots, temp storage, import, Supabase, runtime or Agent 1. It does not approve any
gate. See
[`br-receita-cnpj-cap-input-policy-authorization-package.md`](./br-receita-cnpj-cap-input-policy-authorization-package.md).
The candidate caps in § 8 and the access controls in § 9 remain unchanged by 11T: the package proposes the
category shape a future decision on those candidates would need, never the candidate values themselves.
