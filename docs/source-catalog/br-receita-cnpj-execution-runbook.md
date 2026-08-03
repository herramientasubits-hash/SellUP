# BR-SOURCE-11S — Execution runbook

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11S — Execution runbook (docs-only, non-executable)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, **not** a GATE-7 approval, **not** an
authorization for limited broader local execution, broader local execution, an execution run, real manifest
reading, CSV or ZIP reading, row reads, temp storage, cap authorization, input-root authorization,
output-root authorization, larger caps, multi-window sampling, exact coverage percentages, a full-dataset
denominator, full join execution, import, Supabase writes, migrations, runtime, or Agent 1, and **not** an
approval of any gate
**Predecessor:** BR-SOURCE-11R — execution authorization decision record (PR #196, `main` HEAD
`7f66001850fe4628fb3ab832033d86bdfed01d20`, merge method `--merge`, parent count 2, merged 2026-08-03)
**Authorization received:** `AUTHORIZE BR-SOURCE-11S — EXECUTION RUNBOOK` — authorizes only the preparation
of this documentary runbook, never GATE-2 approval, never GATE-7 approval, never execution authorization,
never limited broader local execution, never broader local execution, never cap or input-root
authorization, and never real-data access
**Last reviewed:** 2026-08-03

**Related documents:**
- Execution authorization decision record (BR-SOURCE-11R) — [`br-receita-cnpj-execution-authorization-decision-record.md`](./br-receita-cnpj-execution-authorization-decision-record.md)
- Limited broader local execution implementation design package (BR-SOURCE-11O, with the 11P implementation status as § 29) — [`br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md`](./br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md)
- Limited broader local execution decision record (BR-SOURCE-11N) — [`br-receita-cnpj-limited-broader-local-execution-decision-record.md`](./br-receita-cnpj-limited-broader-local-execution-decision-record.md)
- GATE-2 formal decision record (BR-SOURCE-11M) — [`br-receita-cnpj-gate2-formal-decision-record.md`](./br-receita-cnpj-gate2-formal-decision-record.md)
- GATE-2 controls and evidence template (BR-SOURCE-11K) — [`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md)
- Full join approval gates checklist (GATE-7 definition, § 11) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join remaining gates decision packet (GATE-7 runbook contract, § 6 and § 7) — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join output sanitization decision record — [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)

---

> This document is a **blocked runbook**: a control artifact that records the operational *structure* a
> future authorized execution would need, while remaining unusable as an instruction set. It carries no real
> input root, no real output root, no real manifest reference, no real filename, no authorized cap value, and
> no command that could open a real file. Every execution-enabling precondition recorded in 11R § 6 and § 10
> is still unmet, so the only valid current decision is **NO-GO**.
>
> One distinction is load-bearing and is stated here rather than buried: **this is not the GATE-7 operator
> runbook section.** GATE-7's artifact, per the gates checklist § 11 and the remaining-gates packet § 6.5,
> must be a section *extending the existing manual-download / local-prep runbook*, written against real
> GATE-2 ceilings and a frozen GATE-5 sanitizer contract — none of which exist. § 4 of this document records
> that boundary in full.

---

## 1. Status

```text
Execution runbook status:                                  proposed_for_owner_review
Execution authorization decision status:                   official
GATE-2 approval status:                                    not_started / not approved
GATE-7 approval status:                                    not_started / not approved
Limited broader local execution authorization status:       not_authorized
Execution run status:                                      not_authorized
Runbook operational status:                                non_executable
Real data opened by this milestone:                        none
Current GO/NO-GO:                                          NO-GO
```

Explicitly, this runbook does **not** authorize:

```text
This runbook does not approve GATE-2.
This runbook does not authorize limited broader local execution.
This runbook does not authorize broader local execution.
This runbook does not authorize execution.
This runbook does not authorize real-data file access.
This runbook does not authorize manifest reading.
This runbook does not authorize CSV reading.
This runbook does not authorize ZIP reading.
This runbook does not authorize row reads.
This runbook does not authorize temp storage.
This runbook does not authorize caps.
This runbook does not authorize input roots.
This runbook does not authorize output roots.
This runbook does not authorize exact coverage percentages.
This runbook does not authorize full dataset denominator claims.
This runbook does not authorize import.
This runbook does not authorize Supabase writes.
This runbook does not authorize runtime.
This runbook does not authorize Agent 1.
This runbook does not approve any gate.
```

---

## 2. Purpose

```text
The purpose of this runbook is to define the non-executable operational structure that would be required if
a future owner separately authorizes a controlled execution path.
```

```text
This is a blocked runbook.
It is not an executable runbook.
It is not an execution approval.
It is not a GATE-2 approval.
It contains no real paths, no real caps and no runnable command with real data.
```

The value of writing this now is narrow but real: it separates *procedural readiness* from *authorization*
one level further down than 11R did. 11R separated "the code path exists" from "the code path may be used".
This document separates "we know what the procedure would look like" from "the procedure may be followed".
Both separations exist because the artifact chain is written in imperative, checklist-shaped prose, and every
new document in that shape increases the chance a reader mistakes structure for permission.

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
11L merge audit documented the PR #187 squash-merge process exception with no content/safety issue.
11M GATE-2 formal decision record.
11N limited broader local execution decision record.
11O implementation design package.
11P fail-closed implementation scaffold.
11Q post-merge validation passed.
11R execution authorization decision record.
```

```text
11S does not change the fail-closed behavior implemented in 11P and validated in 11Q.
11S does not satisfy any execution prerequisite from 11R.
```

Three inherited findings are carried unchanged and are **not** reopened here. First, 11I's reading of the
11H aggregate-only signal: a zero observed inside a bounded window is not evidence about the dataset and is
not a reason to widen scope. Second, 11N § 8's position that every candidate cap remains
`proposed_only / not_authorized`, and that an unset cap is not an unlimited cap. Third, 11R § 6's eight
non-negotiable blockers, of which three are enforced in code and five rest on documentation alone.

---

## 4. Runbook boundary

This runbook may document only:

```text
roles and responsibilities;
preflight checklist structure;
approval checklist structure;
placeholder execution checklist;
stop conditions;
rollback/cleanup expectations;
evidence collection structure;
post-run validation structure;
escalation paths;
future milestone mapping.
```

It excludes:

```text
actual execution;
real data reads;
copy-pasteable real-data command;
real path values;
real cap values;
implementation changes;
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

### 4.1 Relationship to GATE-7 — what this document is not

The gates checklist § 11 defines GATE-7 as *operator runbook approval*, and the remaining-gates packet
§ 6 already proposed its **contract**: a twenty-two-item preflight (`P-01` … `P-22`), sixteen
non-overridable stop conditions (`T-01` … `T-16`), a closed permitted-evidence list, and twenty assertions
(`OR-A01` … `OR-A20`). This document neither replaces nor satisfies that contract:

```text
GATE-7's artifact must extend the existing manual-download / local-prep runbook, never compete with it.
This document is a separate control artifact, not that extension.
Four contract items cannot be performed today: P-05 fails by construction while any gate is unapproved,
  P-12 and P-13 have no GATE-2 ceilings to check against, and P-19 has no frozen GATE-5 sanitizer contract.
Reproducibility by a different operator is therefore not demonstrated and is not claimed here.
```

Where this document's § 7 preflight and § 10 stop conditions overlap the `P-` and `T-` series, the
remaining-gates packet remains the authority on wording and numbering. The overlap is deliberate
redundancy for a reader arriving at 11S first — not a second, competing contract.

### 4.2 Who may operate — inherited unchanged

The remaining-gates packet § 6.1 governs this and is restated because it is the single rule most likely to
be violated by the tooling that reads these documents:

```text
Only a named, authorized human operator may ever perform such a procedure.
Not an agent. Not an automation. Not a scheduled job. Not a CI runner.
No agent may perform it "on behalf of" an operator.
The author of this document may not perform it.
No step may be delegated to an agent, including a step that looks harmless such as an inventory listing.
The operator may not also be the sole approver of GATE-7.
```

---

## 5. Current blocking state

```text
The current implementation is intentionally fail-closed.
GATE-2 is recorded as not_approved.
Execution authorization phrase is absent.
Authorized cap maxima are null.
Allowed input root is not authorized.
File access is false.
Temp storage is false.
Import is false.
Supabase write is false.
Runtime integration is false.
Agent 1 integration is false.
Provider calls are false.
Brazil readiness flags are false.
```

The refusal reasons a request would receive today:

```text
authorization_phrase_missing
limited_broader_local_execution_not_authorized
gate2_not_approved
cap_ceiling_not_authorized
allowed_input_root_not_authorized
```

Two of these are worth reading carefully rather than skimming. `cap_ceiling_not_authorized` is the reason a
**fully-capped** request is still refused: supplying every cap flag does not help, because the recorded
ceiling table against which caps are validated is entirely null, and null is not unlimited.
`allowed_input_root_not_authorized` cannot be cleared by argument at all, because the two path-bearing flags
sketched in the 11O § 8 contract were deliberately never implemented — there is no argument surface through
which a path could arrive.

---

## 6. Roles and responsibilities

| Role | Responsibility | Can authorize execution? | Can override guardrails? | Required evidence |
|------|----------------|--------------------------|--------------------------|-------------------|
| Business owner | Decides whether the source family is pursued at all; selects among the § 16 options; issues the exact authorization phrase for any next milestone | No — not alone. An owner phrase authorizes a *milestone*; execution additionally requires GATE-2 approved and every 11R § 10 condition met simultaneously | No | A recorded decision naming the option selected, the rationale, the date and a re-review date |
| Privacy/legal reviewer | Closes 11R BLOCKER-8 — a determination covering a broader local read of this source family; owns the person-family denylist and the protected-data policy | No | No | A written determination, scoped to the read being considered, referenced by ID rather than pasted |
| Security reviewer | Confirms the operating environment carries no write-capable credential, no service role key and no import/runtime/Agent 1 variables; confirms the no-write posture | No | No | An environment attestation expressed as booleans, never as variable values |
| Data/source owner | Confirms allowed families, confirms the forbidden families are unchanged, owns the identity-grain and field-allowlist positions | No | No | A families confirmation recorded as class labels |
| Technical operator | Would perform a future authorized procedure, and only then. Must be a named human; see § 4.2 | No | No | Preflight completion state item by item, pass or fail; the aggregate report after the sanitizer boundary |
| Reviewer / second pair of eyes | Independently confirms preflight state and evidence sanitization before anything is read, shared or attached | No | No | A countersignature on the aggregate result only |
| Incident owner | Receives any § 13 incident, decides halt and disposal, owns the no-retry-with-larger-caps rule | No | No | An incident record carrying classes and counts, never the leaked value |

```text
No role can override fail-closed guardrails through this runbook.
Any authorization requires a later explicit owner phrase and an official decision artifact.
```

Two structural rules follow from the table and are not negotiable by role seniority. Approvers and
implementers stay apart, so the operator is never the sole GATE-7 approver. And the three
code-enforced blockers (GATE-2 state, absent authorization phrase, null cap ceiling) are not role-clearable
at all: no role in this table can pass an argument that lifts them.

---

## 7. Preflight checklist — blocked template

Every item below carries its **current** value, and every current value is `no`. A failed item is a stop,
never a warning; an ambiguous item has failed.

```text
GATE-2 approved:                                    no
Limited broader local execution authorized:         no
Execution phrase present:                           no
Cap/input policy official:                          no
Approved caps present:                              no
Approved input root class present:                  no
Approved output policy present:                     no
Temp storage decision official:                     no
Legal/privacy/security approval captured:           no
Operator assigned:                                  no
Reviewer assigned:                                  no
Stop conditions reviewed:                           no
Evidence packet template approved:                  no
Rollback/cleanup expectations reviewed:             no
```

```text
As of this runbook, every preflight item remains incomplete.
The execution decision remains NO-GO.
```

The ordering is deliberate: the gate item is first, mirroring `OR-A03`. A checklist whose first item fails
is not a defective checklist — it is the gate working. The last four items are the only ones that could be
advanced by documentation alone, and advancing them would change nothing while the first nine stand.

---

## 8. Approval checklist — blocked template

```text
Owner:
Review date:
Authorization artifact:
Authorization phrase:
GATE-2 approval reference:
Limited broader local execution authorization reference:
Cap/input policy reference:
Allowed families:
Forbidden families:
Approved cap set:
Approved input root class:
Approved output policy:
Temp storage decision:
Exact percentage decision:
Full dataset denominator decision:
Legal/privacy/security reference:
Operator:
Reviewer:
Expiration:
```

```text
All fields are blank / not_authorized.
No real path may be recorded in this public repo document.
No real filename may be recorded in this public repo document.
No cap value may be treated as approved unless it appears in a later official authorization artifact.
```

Two field-level rules prevent this template from becoming a leak surface if it is ever filled. *Approved
input root class* takes a class label, never a path — any owner-approved directory value travels through the
operator channel, not through a public repository document. And every reference field takes an identifier
pointing at an artifact, never the artifact's contents: a legal determination is cited, not pasted.

An empty field is a `false`, never a permission. A blank cap remains null, and null is not unlimited.

---

## 9. Conceptual command skeleton — non-executable

```text
NOT EXECUTABLE — STRUCTURE ONLY

node --import tsx scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run.ts
  --limited-broader-local-execution
  --limited-broader-local-execution-authorized
  --strict
  --gate2-approved=<APPROVED_ONLY_BY_OFFICIAL_OWNER_DECISION>
  --max-files=<APPROVED_BY_FUTURE_CAP_INPUT_POLICY>
  --max-files-per-family=<APPROVED_BY_FUTURE_CAP_INPUT_POLICY>
  --max-bytes-per-file=<APPROVED_BY_FUTURE_CAP_INPUT_POLICY>
  --max-rows-per-file=<APPROVED_BY_FUTURE_CAP_INPUT_POLICY>
  --max-total-bytes=<APPROVED_BY_FUTURE_CAP_INPUT_POLICY>
  --max-total-rows=<APPROVED_BY_FUTURE_CAP_INPUT_POLICY>
  --max-runtime-seconds=<APPROVED_BY_FUTURE_CAP_INPUT_POLICY>
  --temp-storage-disabled
  --aggregate-only
  --no-import
  --no-supabase-write
  --no-runtime
  --no-agent1
  --no-provider-calls

MISSING BY DESIGN:
- no real manifest argument;
- no real input root argument;
- no output path;
- no approved caps;
- no approved GATE-2 state;
- no execution authorization.
```

```text
This skeleton must not be copied into a terminal.
This skeleton is intentionally incomplete.
This skeleton cannot open real data.
This skeleton is not an execution authorization.
```

Four properties of the skeleton are worth stating so a reviewer can evaluate it rather than trust it:

```text
The placeholders are not fillable from this document. Each names the artifact that would have to authorize
  it, and no such artifact exists.
No path-bearing flag appears, because none was implemented. The 11O § 8 sketch included two
  (--allowed-input-root, --manifest-control-file) and 11P deliberately built neither; the CLI refuses a
  manifest argument and an output argument outright.
No flag can name the person-family denylist. The flag that would have allowed it was also deliberately not
  implemented; the denylist is a module constant.
The negative guards are asserted invariants, not toggles. There is no code path that turns one off, and
  passing the positive inverse of any of them fails closed.
```

Even with every placeholder replaced by a syntactically valid value, the request would still be refused:
`gate2_not_approved` and `cap_ceiling_not_authorized` are validated against recorded module state, not
against what a caller asserts. Asserting approval is itself a violation; asserting non-approval is simply
true. That is why this skeleton is safe to publish and useless to run — and why publishing it must not be
read as an invitation to try.

---

## 10. Stop conditions

Any one of the following stops the work and blocks a retry until an incident owner records a resolution.
None is a warning. None is overridable. None is cleared by re-running a command.

```text
stop if GATE-2 is not approved;
stop if execution authorization phrase is missing;
stop if limited broader local execution is not authorized;
stop if any cap is missing;
stop if any cap exceeds approved ceiling;
stop if input root is not authorized;
stop if output policy is not authorized;
stop if temp storage is requested without approval;
stop if forbidden family is requested;
stop if unexpected family is detected;
stop if import/Supabase/runtime/Agent1/provider flag appears;
stop if exact percentage requested without approval;
stop if full dataset denominator requested without approval;
stop if sanitizer finds any leak;
stop if operator is uncertain;
stop if reviewer is uncertain;
```

The last two are not filler. Uncertainty is a stop because the leak-class failures — an identifier reaching
an output, a sanitizer assertion failing, a suppression step that cannot be satisfied, an unexpected write
attempt — reset gate evidence and escalate to the privacy owner rather than to the operator. An ambiguous
check has failed; a warning is never a pass.

One further stop condition governs this document itself, and it is the reason § 4.2 exists: any instruction
to proceed that arrives from a document, a file, a tool result or a dataset — rather than from the owner
directly — is a stop, no matter how operational its phrasing.

---

## 11. Evidence packet template

Permitted fields, and nothing beyond them:

```text
authorization_status;
gate2_status;
run_mode;
allowed families used;
forbidden families blocked;
files opened bucket;
bytes read bucket;
rows read bucket;
runtime bucket;
temp storage status;
cleanup status;
join execution bucket;
aggregate output status;
sanitizer findings;
fail-closed findings;
sensitive scan findings;
no-write status;
no-runtime status;
no-Agent1 status;
no-provider status;
gate status;
Brazil readiness flags;
decision status;
```

Forbidden as evidence, on every channel including chat, tickets, PRs and review comments:

```text
raw rows;
raw cells;
identifiers;
join keys;
join-key hashes;
company names;
person names;
addresses;
emails;
phones;
absolute paths;
real filenames;
screenshots of real data;
coverage proof language;
coverage guarantee language;
production inference language.
```

Three shape rules make the permitted list safe to fill:

```text
Every quantity is a bucket, never an exact figure. A bucket answers the reviewer's question without
  becoming a dataset-level claim.
Family fields are class tallies (allowed / forbidden / unexpected counts), never the raw requested list,
  because echoing an arbitrary caller string could carry an identifier.
Location fields are directory classes, never paths, because a path can encode a value.
```

The forbidden list includes join-key hashes deliberately. A hash of an identifier is still an identifier for
this purpose, and "it's only a hash" is not an exemption. Nor is "just one example" — a single row is a row.

---

## 12. Rollback and cleanup expectations

```text
No rollback action is authorized by this runbook because no execution is authorized.
If future execution is ever authorized, cleanup expectations must be documented in a later
execution-specific artifact.
Cleanup evidence must be bucketed and path-free.
No path-level cleanup proof may be pasted into docs, PRs, tickets or chat.
```

The shape such a later artifact would have to respect, inherited and not restated in detail here:

```text
Cleanup would be mandatory on success and on failure alike, not only on failure.
Unresolved residue blocks any subsequent step; a stale ledger or lock is itself a stop condition.
Cleanup that cannot be proven is a failure, not an omission — cleanup_unverified and cleanup_failed are
  both stop conditions.
No retry may reuse progress markers, and no retry may follow an incomplete cleanup.
A cleanup report is evidence only if it passed the sanitizer unedited. An artifact edited to make it pass is
  a fabrication and voids the gate.
```

Because temp storage is `not_authorized`, the cleanup surface a future run would face is smaller than the
inherited contract assumes. That is a consequence of the current posture, not a permission to widen it.

---

## 13. Incident and escalation path

Incident classes:

```text
unexpected file access;
path leak;
identifier leak;
join-key leak;
raw row/cell output;
temp storage leak;
output inside repo;
unexpected family;
cap overrun;
import flag activation;
Supabase flag activation;
runtime flag activation;
Agent 1 flag activation;
provider call;
operator uncertainty;
reviewer uncertainty.
```

For each of the above, the decision is the same and is not graduated by severity:

```text
Immediate stop.
Preserve no raw evidence.
Escalate to owner/privacy/security.
Do not retry with larger caps.
Do not paste real data into chat, tickets or PRs.
```

*Preserve no raw evidence* is the instruction most likely to feel wrong to an engineer, so its reasoning is
recorded: the normal debugging instinct — capture the failing value so it can be investigated — is exactly
the action that converts a contained incident into a distributed one. What is preserved is the class, the
count and the bucket. What is destroyed is the value.

*Do not retry with larger caps* closes the second common instinct. A leak, a refusal or a zero result is
never an argument for widening scope; 11I settled that for the zero case and the same logic applies to the
others.

---

## 14. Post-run validation template — future only

```text
This section is future-only.
No post-run validation can occur under 11S because no execution is authorized.
```

Template, for a hypothetical future authorized run only:

```text
Typecheck:
Synthetic tests:
Fail-closed baseline:
Execution evidence packet:
Sensitive scan:
No-write verification:
No-runtime verification:
No-Agent1 verification:
No-provider verification:
Gate/readiness status:
Operator signoff:
Reviewer signoff:
```

```text
Every field is blank and unfillable today.
A completed template would evidence a run's behaviour, never its authorization.
Fail-closed baseline means the refusal outcomes are unchanged, not that they were bypassed.
```

---

## 15. Decision points before any future run

```text
Has GATE-2 been explicitly approved?
Has limited broader local execution been explicitly authorized?
Has cap/input policy been officialized?
Has legal/privacy/security reviewed the plan?
Has the operator been assigned?
Has the reviewer been assigned?
Are all stop conditions understood?
Is the evidence packet template approved?
Is temp storage disabled or separately approved?
Are import/Supabase/runtime/Agent1/provider flags impossible?
```

```text
Current answer for every execution-enabling decision point is no.
```

The final question is phrased as *impossible* rather than *false* on purpose. A flag that is currently false
but reachable is not a control; absence is the control. The negative guards satisfy this because no code path
turns them off — but the environment-side equivalents (a write-capable credential, a service role key, a
loaded runtime variable) satisfy it only by being absent from the operating environment, which no code can
assert on the operator's behalf.

---

## 16. Runbook options

```text
Option A — Keep runbook blocked
Effect: Recommended current state. No execution follows.

Option B — Prepare cap/input policy authorization package
Effect: A later docs-only hito may define proposed caps and input/output policy.

Option C — Escalate legal/privacy/security before cap/input policy
Effect: No further execution path until external review.

Option D — Prepare synthetic rehearsal only
Effect: Future validation remains synthetic-only and cannot open real data.

Option E — Authorize execution now
Status: blocked / not allowed by this runbook.
Reason: GATE-2 is not approved and execution remains not_authorized.
```

```text
Options B, C and D are each docs-or-synthetic only and each require their own separate owner phrase.
None of them clears the GATE-2 blocker.
Option E cannot be selected through this runbook under any circumstances.
```

---

## 17. Recommended draft decision

```text
Recommended draft decision for 11S: Option A — Keep runbook blocked.
```

```text
11S itself does not authorize Option B, C, D or E.
11S itself does not authorize cap/input policy.
11S itself does not authorize execution.
A separate exact owner phrase is required for any next hito.
```

Rationale, and it is the same rationale 11R § 8 reached: the binding constraints are the unapproved gate and
the absent external review. Neither moves by writing a runbook, preparing a cap package or rehearsing
against synthetic data. Producing this document was worth doing once — it makes the procedural shape
reviewable and it records the GATE-7 boundary in § 4.1 — but it does not advance the blockers, and each
further artifact of this kind adds maintenance cost and one more surface that can be misread as readiness.

Option C remains the honest exception. The legal/privacy blocker is the only one no internal milestone can
clear, and doing that review before more scaffolding avoids designing around constraints it may impose.

---

## 18. Proposed future milestone sequence

```text
BR-SOURCE-11T — Cap/input policy authorization package, docs-only, only if explicitly authorized.
BR-SOURCE-11U — Synthetic rehearsal validation, no real data, only if explicitly authorized.
BR-SOURCE-11V — Controlled execution authorization review, only after prior conditions are official.
BR-SOURCE-11W — Controlled execution attempt, only if separately and explicitly authorized.
```

```text
This sequence is proposed only.
No milestone after 11S is authorized by this runbook.
```

This sequence supersedes earlier letter mappings for naming purposes only; it changes no authorization.
Consistent with § 17, the recommended draft decision selects none of these milestones. 11W is listed for
completeness of the map and is the most heavily conditioned entry in it: it presupposes GATE-2 approved, the
legal/privacy determination closed, caps and roots officially authorized, and a named human operator — none
of which exist.

---

## 19. Required owner phrase for next step

```text
AUTHORIZE BR-SOURCE-11T — CAP INPUT POLICY AUTHORIZATION PACKAGE
```

```text
This phrase would authorize only a docs-only cap/input policy package.
It would not authorize real-data execution.
It would not authorize manifest reading.
It would not authorize CSV/ZIP reading.
It would not authorize temp storage.
It would not approve GATE-2.
It would not approve import.
It would not approve Supabase writes.
It would not approve runtime.
It would not approve Agent 1.
```

```text
The recommended draft decision in § 17 is Option A, which uses no phrase at all.
This phrase is recorded so that, if the owner chooses Option B instead, the exact wording is unambiguous.
Preparing a cap package is not approving caps: a package proposes values, an owner decision authorizes them.
```

---

## 20. What remains blocked

```text
GATE-2 approval;
limited broader local execution;
broader local execution;
execution run;
real manifest reading;
real CSV reading;
real ZIP reading;
row reads;
temp storage;
cap authorization;
input root authorization;
output root authorization;
larger caps;
multi-window sampling;
seeking strategy;
opening additional files;
opening catalog files;
opening Socios/QSA/CPF/person files;
opening ZIPs;
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

## 21. Gate status

```text
GATE-1 = not_started / not approved
GATE-2 = not_started / not approved
GATE-3 = not_started / not approved
GATE-4 = not_started / not approved
GATE-5 = not_started / not approved
GATE-6 = not_started / not approved
GATE-7 = not_started / not approved
GATE-8 = not_started / not approved
```

GATE-7 is called out because this milestone is about a runbook and the coincidence invites a wrong
inference. Writing a blocked runbook does not move GATE-7: its approvers are the operator, technical and
privacy owners jointly, its artifact must extend the existing manual-download / local-prep runbook, and four
of its preflight items cannot be performed at all until GATE-2 and GATE-5 produce the values they reference.

---

## 22. Flags

```text
OPS_BR_EXECUTION_RUNBOOK_AUTHORIZED = true
OPS_BR_EXECUTION_RUNBOOK_PR_READY = false until PR
OPS_BR_EXECUTION_RUNBOOK_OFFICIAL = false until merge

OPS_BR_EXECUTION_AUTHORIZATION_DECISION_OFFICIAL = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_POST_MERGE_VALIDATED = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_OFFICIAL = true

OPS_BR_CAP_INPUT_POLICY_AUTHORIZATION_AUTHORIZED = false
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

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

`OPS_BR_EXECUTION_RUNBOOK_AUTHORIZED = true` records that the owner authorized *writing this document* —
nothing else. `..._PR_READY` flips to `true` only once this docs-only PR is open, and `..._OFFICIAL` only
once it is merged. Neither flip changes any operational flag. `FULL_JOIN_RUNNER_READY = true` describes a
runner that exists and refuses; `FULL_JOIN_EXECUTION_READY` stays `false`, and every Brazil-readiness flag
stays `false` regardless of any flip above.

---

## 23. Safety confirmation

```text
This document is docs-only.
It does not authorize execution.
It does not authorize real-data access.
It does not authorize caps.
It does not authorize input roots.
It does not authorize temp storage.
It does not approve GATE-2.
It does not approve any gate.
Brazil remains blocked for import, runtime, Agent 1 and live prospect generation.
```

This milestone touched no code, no scripts, no package manifest, no test, no Supabase schema, no migration,
no runtime path, no Agent 1 path, no provider, and no UI. It opened no real dataset file, read no real
manifest, opened no CSV and no ZIP, processed no row, executed no join, and computed no coverage figure. It
recorded no cap ceiling, no input root and no output root. Every gate in § 21 remains
`not_started / not approved`, including GATE-7, and each milestone in § 18 still requires its own explicit
owner authorization.

---

## 24. Update (BR-SOURCE-11T)

BR-SOURCE-11T creates the cap/input policy authorization package. It documents cap categories, input
classes, output policy categories, family allow/deny policy, manifest/control-file policy, temp storage
policy, evidence bucket policy, exact percentage/denominator policy, owner fields, stop conditions and
future milestone mapping. It does not approve GATE-2. It does not approve GATE-7. It does not authorize
execution, real-data access, caps, input roots, output roots, temp storage, import, Supabase, runtime or
Agent 1. It does not approve any gate. See
[`br-receita-cnpj-cap-input-policy-authorization-package.md`](./br-receita-cnpj-cap-input-policy-authorization-package.md).

11T was written under this runbook's § 19 required owner phrase and its § 18 next-milestone mapping. It
changes none of the preflight items in § 7 — `Cap/input policy official` remains `no` — and it satisfies
none of the § 15 decision points before any future run. The § 17 recommended draft decision — Option A, keep
runbook blocked — is unchanged, and 11T carries the analogous recommendation forward for itself in its own
§ 19.

---

## 25. Update (BR-SOURCE-11V)

BR-SOURCE-11V creates the controlled execution authorization review. It evaluates whether the minimum
conditions exist to authorize a future controlled execution attempt. Current recommendation remains NO-GO
because GATE-2, GATE-7, cap/input policy, caps, input roots, output roots, temp storage, limited broader
local execution and controlled execution attempt authorization remain missing. It does not approve GATE-2.
It does not approve GATE-7. It does not approve cap/input policy. It does not authorize execution, real-data
access, caps, input roots, output roots, temp storage, import, Supabase, runtime or Agent 1. It does not
approve any gate. See
[`br-receita-cnpj-controlled-execution-authorization-review.md`](./br-receita-cnpj-controlled-execution-authorization-review.md).

**This runbook remains non-executable.** 11V changes no item in the § 7 preflight checklist: the nine gate
and authorization items still read `no`, and `Cap/input policy official` stays `no` for the reason § 24
already records. Of the four items § 7 notes as advanceable by documentation alone, `Stop conditions
reviewed`, `Evidence packet template approved` and `Rollback/cleanup expectations reviewed` are unchanged,
and `Operator assigned` and `Reviewer assigned` in § 6 remain unfilled — 11V § 6 records both as unsatisfied
blockers. The § 9 conceptual command skeleton is still structure-only, and the § 17 recommended draft
decision — Option A, keep runbook blocked — is unchanged.

---

## 26. Update (BR-SOURCE-11W-PRECONDITION-OWNER-PACKAGE)

BR-SOURCE-11W-PRECONDITION-OWNER-PACKAGE creates a docs-only readiness package for missing owner decisions
across GATE-2, GATE-7 and cap/input policy. It does not approve GATE-2. It does not approve GATE-7. It does
not approve cap/input policy. It does not authorize caps, input roots, output roots, temp storage, controlled
execution, real-data access, import, Supabase, runtime or Agent 1. Current recommendation remains NO-GO. See
[`br-receita-cnpj-11w-precondition-owner-package-gate2-gate7-cap-input-readiness.md`](./br-receita-cnpj-11w-precondition-owner-package-gate2-gate7-cap-input-readiness.md).

**This runbook remains non-executable.** The package changes no item in the § 7 preflight checklist — all
fourteen still read `no` — and satisfies none of the § 15 decision points before any future run. It fills no
role in § 6: `Operator assigned` and `Reviewer assigned` remain unfilled, and the package's own § 7 records
every GATE-7 readiness row as `not_ready` for exactly that reason, since each item in that gate terminates in
an assignment or a signoff rather than in a written boundary. It leaves § 8's approval checklist blank and
§ 9's command skeleton structure-only, and the § 17 recommended draft decision — Option A, keep runbook
blocked — is unchanged.

Three of this runbook's own rules are carried into the package rather than restated differently, which is the
same anti-drift choice § 24 records for the evidence policy. The § 6 role table supplies the role labels the
package's § 5 owner decision matrix uses in place of names, including the rule that approvers and implementers
stay apart and that the code-enforced blockers are not role-clearable. The § 8 field-level rules govern the
package's § 10 draft form: an input root takes a class label and never a path, and every reference field takes
an identifier rather than an artifact's contents. And § 11's permitted/forbidden evidence split governs the
package's § 13 evidence readiness, which reports the bucketed policy as documented but unapproved.

---

## 27. Update (BR-SOURCE-11X)

BR-SOURCE-11X creates formal owner decision record templates for GATE-2, GATE-7 and cap/input policy. It does
not approve GATE-2. It does not approve GATE-7. It does not approve cap/input policy. It does not authorize
caps, input roots, output roots, temp storage, controlled execution, real-data access, import, Supabase,
runtime or Agent 1. Current recommendation remains NO-GO. See
[`br-receita-cnpj-11x-formal-owner-decision-records-gate2-gate7-cap-input.md`](./br-receita-cnpj-11x-formal-owner-decision-records-gate2-gate7-cap-input.md).

**This runbook remains non-executable.** 11X changes no item in the § 7 preflight checklist — all fourteen
still read `no` — and satisfies none of the § 15 decision points before any future run. It fills no role in
§ 6: `Operator assigned` and `Reviewer assigned` remain unfilled, because a decision record's role field takes
a role label and references an assignment made through the operator channel rather than constituting one. It
leaves § 8's approval checklist blank and § 9's command skeleton structure-only, and the § 17 recommended
draft decision — Option A, keep runbook blocked — is unchanged.

Three of this runbook's rules govern 11X's GATE-7 record rather than being restated differently in it. The § 6
separation rule requires the record's operator and reviewer role fields to name two distinct roles, and the
named-human rule — never an agent, an automation or a CI runner — governs any assignment they reference. The
§ 8 field-level rules govern every field in all three records: an input root takes a class label and never a
path, and every reference field takes an identifier rather than an artifact's contents. And the § 11
permitted/forbidden evidence split governs the records' evidence fields, which take a bucket class or an
artifact identifier. 11X also notes that this runbook's preflight cannot pass while GATE-2 is unapproved,
since its first item verifies gate status — so a valid GATE-7 record cannot precede a valid GATE-2 record.
