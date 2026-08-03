# BR-SOURCE-11M — GATE-2 formal decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11M — GATE-2 formal decision record (docs-only)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, **not** an authorization for a GATE-2
owner decision, broader local execution, limited broader local execution, temp storage, multi-window
sampling, exact coverage percentages, a full-dataset denominator, full join execution, import, Supabase
writes, runtime, or Agent 1, and **not** an approval of any gate
**Predecessor:** BR-SOURCE-11L-LAND — `BRSOURCE11LLANDA — GATE2_OWNER_REVIEW_PACKAGE_MERGED` (PR #187,
`main` HEAD `5210d507a8e800283a79e7ce3420dc4383f3f64b`)
**Authorization received:** `AUTHORIZE BR-SOURCE-11M — GATE-2 FORMAL DECISION RECORD` — authorizes only
the preparation of this formal decision record, never GATE-2 approval, never a GATE-2 owner decision,
never broader local execution or limited broader local execution, and never real-data execution
**Last reviewed:** 2026-07-31

**Related documents:**
- GATE-2 owner review package (BR-SOURCE-11L) — [`br-receita-cnpj-gate2-owner-review-package.md`](./br-receita-cnpj-gate2-owner-review-package.md)
- GATE-2 controls and evidence template (BR-SOURCE-11K) — [`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md)
- GATE-2 route decision package (BR-SOURCE-11J) — [`br-receita-cnpj-gate2-route-decision-package.md`](./br-receita-cnpj-gate2-route-decision-package.md)
- Coverage signal interpretation and GATE-2 route decision record (BR-SOURCE-11I) — [`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join approval gates checklist (GATE-2 definition, § 6) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)

---

> This document is a **decision-record preparation artifact**, not an approval artifact and not an
> execution artifact. BR-SOURCE-11L assembled the owner review package (evidence, gaps, decision options,
> risk register, reviewer checklist). This document converts that review package into the structured
> decision artifact an owner can use to decide GATE-2's status — with explicit decision options, required
> owner decision fields, minimum conditions, and a risk decision table. **§ 1–20 supply that artifact;
> they approve no gate, authorize no owner decision, and authorize no execution.**

---

## 1. Status

```text
Formal decision record status: proposed_for_owner_review
GATE-2 decision status:        not_authorized
GATE-2 approval status:        not_started / not approved
Implementation status:         not_authorized
Execution status:               not_authorized
Current GO/NO-GO:               NO-GO
```

Explicitly, this formal decision record does **not** authorize:

```text
This formal decision record does not approve GATE-2.
This formal decision record does not authorize a GATE-2 owner decision.
This formal decision record does not authorize broader local execution.
This formal decision record does not authorize limited broader local execution.
This formal decision record does not authorize temp storage.
This formal decision record does not authorize any new real-data execution.
This formal decision record does not authorize multi-window sampling.
This formal decision record does not authorize exact coverage percentages.
This formal decision record does not authorize full dataset denominator claims.
This formal decision record does not authorize full join execution.
This formal decision record does not authorize import.
This formal decision record does not authorize Supabase writes.
This formal decision record does not authorize runtime.
This formal decision record does not authorize Agent 1.
This formal decision record does not approve any gate.
```

---

## 2. Purpose

```text
The purpose of this formal decision record is to provide the structured decision artifact that an owner
can later use to decide whether GATE-2 should remain closed, require additional documentation, escalate
to legal/privacy/security, or move toward a separately authorized limited broader local execution
decision record.
```

```text
This is a decision-record preparation artifact, not an approval artifact and not an execution artifact.
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
```

```text
11L prepared the owner review package.
11M converts that review package into a formal decision record draft only.
```

---

## 4. Decision boundary

A future owner decision, if separately authorized, could decide only:

```text
whether GATE-2 remains closed;
whether GATE-2 requires more documentation;
whether GATE-2 requires legal/privacy/security escalation;
whether a later limited broader local execution decision record may be prepared;
whether broader local execution remains categorically blocked.
```

It explicitly excludes:

```text
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

```text
Even if a future owner later changes GATE-2 status, that would not approve GATE-3, GATE-4, GATE-5,
import, runtime, Agent 1 or production.
```

---

## 5. Evidence considered

```text
11D/11E: real manifest metadata-only path passed.
11F: required-family real file probe passed under ultra-bounded caps.
11G: required-family real join probe passed under ultra-bounded caps.
11H: aggregate-only real coverage signal passed under ultra-bounded caps.
11I: zero match result interpreted as a valid bounded-window outcome, not a failure.
11J: GATE-2 route decision package official.
11K: GATE-2 controls and evidence template official.
11L: GATE-2 owner review package official.
11L merge audit: squash merge process exception documented; no content/safety issue found.
Output sanitizer posture held.
Fail-closed posture held.
No-write/no-runtime posture held.
All gates remain not approved.
```

```text
This evidence supports drafting a formal decision record.
It does not prove dataset coverage.
It does not prove import readiness.
It does not prove runtime readiness.
It does not prove Agent 1 readiness.
It does not approve GATE-2.
```

---

## 6. Evidence gaps

```text
No approved broader local execution scope.
No approved limited broader local execution decision record.
No approved temp storage policy.
No approved directory policy beyond prior carve-outs.
No approved multi-window strategy.
No approved seeking strategy.
No approved exact percentage policy.
No approved full dataset denominator policy.
No approved catalog-family opening policy.
No approved Socios/QSA/CPF/person policy.
No approved ZIP-opening policy.
No approved import mapping.
No approved persistence field allowlist.
No approved identity grain.
No approved rollback/import cleanup plan.
No approved runtime isolation plan.
No approved Agent 1 integration plan.
No legal/privacy/security signoff captured in this record.
```

---

## 7. Formal decision options

```text
Option A — Keep GATE-2 closed
Effect: No broader local execution; Brazil remains at current evidence level.
Decision implication: safest path; no new execution path.

Option B — Request additional documentation only
Effect: Prepare more docs without execution or approval.
Decision implication: GATE-2 remains blocked until gaps are resolved.

Option C — Escalate to legal/privacy/security before any GATE-2 status change
Effect: GATE-2 remains blocked until escalation is complete.
Decision implication: recommended when protected data, temp storage or broader file opening remain
uncertain.

Option D — Authorize preparation of a limited broader local execution decision record
Effect: A later hito may create a decision record for a tightly bounded broader local execution.
Important: This does not authorize execution and does not approve import/runtime/Agent 1.

Option E — Reject broader local execution for Brazil
Effect: Brazil Receita remains usable only at current ultra-bounded evidence level.

Option F — Approve GATE-2 immediately
Status: blocked / not recommended by this draft.
Reason: unresolved gaps remain; this draft is not itself owner approval.
```

---

## 8. Recommended draft decision

```text
Recommended draft decision for 11M: Option D — Authorize preparation of a limited broader local execution
decision record, only after explicit owner acceptance of this formal decision record.
```

```text
11M itself does not authorize Option D.
11M itself does not approve GATE-2.
11M itself does not authorize the limited broader local execution decision record.
A separate exact owner phrase is required for any next hito.
```

---

## 9. Required owner decision fields

```text
Owner:
Review date:
Decision option selected:
Decision status:
Rationale:
Required changes:
Legal/privacy/security escalation required:
GATE-2 status change approved:
Limited broader local execution decision record authorized:
Broader local execution authorized:
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

## 10. Minimum conditions before any GATE-2 status change

```text
formal owner review completed;
decision option selected;
rationale recorded;
evidence gaps accepted or assigned follow-up;
protected data policy confirmed;
directory controls confirmed;
temp storage decision confirmed;
output/evidence controls confirmed;
stop conditions confirmed;
legal/privacy/security escalation decision recorded;
all non-GATE-2 boundaries explicitly preserved;
no import/runtime/Agent1 inference introduced;
```

---

## 11. Minimum conditions before any later execution decision record

```text
GATE-2 status change explicitly approved in a later owner decision;
allowed families explicitly enumerated;
forbidden families explicitly enumerated;
input root policy explicitly approved;
temp storage policy explicitly approved or explicitly blocked;
max files, rows, bytes and runtime explicitly approved;
output mode explicitly approved;
evidence retention explicitly approved;
stop conditions explicitly approved;
sensitive scan plan approved;
fail-closed validation plan approved;
no Supabase/runtime/Agent1/provider flags introduced;
```

```text
These conditions do not authorize execution. They only define prerequisites for a later decision record.
```

---

## 12. Risk decision table

| Risk | Current status | Required owner stance | Mitigation | Blocks GATE-2 approval? | Blocks execution? |
|---|---|---|---|---|---|
| Coverage signal misread as global coverage | Open — exact percentages and full denominators remain blocked | Owner must confirm aggregate-only posture stays mandatory | Keep exact percentages and full dataset denominators blocked | Yes, until confirmed | Yes |
| Join key leakage | Mitigated by design; no approved change | Owner must confirm no output/hash/log/persist of CNPJ básico/root | No output, hashing, logging or persistence of join keys | Yes, until confirmed | Yes |
| Temp storage leakage | Blocked (no temp storage policy approved) | Owner must decide whether temp storage stays blocked or is separately approved | Temp storage remains blocked unless separately approved | Yes, until decided | Yes |
| Person/CPF exposure | Blocked — Socios/QSA/CPF/person families categorically out of scope | Owner must confirm these families remain blocked or route to separate review | Socios/QSA/CPF/person families remain blocked unless separately reviewed | Yes, until confirmed | Yes |
| File/path leakage | Mitigated by design; no approved change | Owner must confirm no absolute paths, filenames, or real dataset excerpts in evidence | No absolute paths, no filenames, bucketed evidence only | Yes, until confirmed | Yes |
| Operator cap overrun | Mitigated by ultra-bounded caps in 11F–11H | Owner must confirm caps stay explicit and fail-closed | Explicit caps, kill-switch, fail-closed checks | Yes, until confirmed | Yes |
| Premature import path activation | Blocked — no Supabase/runtime/Agent1 flags introduced | Owner must confirm import remains a separate later gate | No Supabase, runtime, or Agent 1 flags; no writes | Yes, until confirmed | Yes |
| Premature runtime/Agent1 use | Blocked — all runtime/Agent1/provider flags remain false | Owner must confirm runtime/Agent1 stay out of GATE-2 scope | All runtime/Agent1/provider flags remain false | Yes, until confirmed | Yes |
| Process discipline / merge strategy exception from 11L | Documented (PR #187 squash-merged instead of merge-committed; content/scope/safety valid, no rollback recommended) | Owner should note the exception and confirm future merges use `gh pr merge <PR> --merge --delete-branch` | Explicit merge-strategy instruction for future PRs | No | No |

---

## 13. Decision non-goals

```text
This decision record is not an import-readiness record.
This decision record is not a field allowlist approval.
This decision record is not an identity grain approval.
This decision record is not a runtime integration approval.
This decision record is not an Agent 1 integration approval.
This decision record is not a provider integration approval.
This decision record is not a production readiness record.
```

---

## 14. Proposed future milestone sequence

```text
BR-SOURCE-11N — Limited broader local execution decision record, only if explicitly authorized after 11M.
BR-SOURCE-11O — Limited broader local execution implementation, only if 11N authorizes implementation.
BR-SOURCE-11P — Limited broader local execution validation, only if 11O is implemented and merged.
BR-SOURCE-11Q — Reassessment of GATE-2 evidence after 11P, docs-only unless separately authorized.
```

```text
This sequence is proposed only.
No milestone after 11M is authorized by this record.
```

---

## 15. Required owner phrase for next step

```text
AUTHORIZE BR-SOURCE-11N — LIMITED BROADER LOCAL EXECUTION DECISION RECORD
```

```text
This phrase would authorize only preparation of a decision record.
It would not authorize execution.
It would not authorize temp storage.
It would not approve import.
It would not approve Supabase writes.
It would not approve runtime.
It would not approve Agent 1.
```

---

## 16. What remains blocked

```text
GATE-2 approval;
GATE-2 owner decision;
limited broader local execution decision record;
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

## 17. Gate status

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

## 18. Flags

```text
OPS_BR_GATE2_FORMAL_DECISION_RECORD_AUTHORIZED = true
OPS_BR_GATE2_FORMAL_DECISION_RECORD_PR_READY = false until PR
OPS_BR_GATE2_FORMAL_DECISION_RECORD_OFFICIAL = false until merge

OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_DECISION_RECORD_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

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

`OPS_BR_GATE2_FORMAL_DECISION_RECORD_PR_READY` flips to `true` only once this docs-only PR is open;
`..._OFFICIAL` flips to `true` only once it is merged. Neither flip changes any operational flag, and
every Brazil-readiness flag stays `false` regardless of either.

---

## 19. Next milestone mapping

```text
If the owner accepts this formal decision record:
BR-SOURCE-11N may prepare the limited broader local execution decision record.

If the owner wants execution:
11N must first define and approve the decision record, and a later implementation hito is required.

If the owner wants import:
a later import-readiness process is required after relevant gates.

This formal decision record does not authorize any of those actions.
```

---

## 20. Safety confirmation

This document is **docs-only**. It does **not**:

- authorize execution;
- approve GATE-2;
- approve any gate;
- authorize a GATE-2 owner decision;
- authorize broader local execution;
- authorize limited broader local execution;
- authorize temp storage;
- authorize multi-window sampling;
- authorize exact coverage percentages or a full-dataset denominator;
- authorize import, Supabase writes, migrations, runtime, or Agent 1 integration;
- change UI;
- edit `MEMORY.md`;
- merge.

Brazil remains blocked for import, runtime, Agent 1, and live prospect generation.

BR-SOURCE-11N creates the limited broader local execution decision record.
It documents candidate scope, prerequisites, proposed controls, fail-closed cases, stop conditions and
formal options for future review. It does not approve GATE-2. It does not authorize limited broader local
execution, broader local execution, implementation, temp storage, multi-window sampling, exact
percentages, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-limited-broader-local-execution-decision-record.md`](./br-receita-cnpj-limited-broader-local-execution-decision-record.md).

BR-SOURCE-11O creates the limited broader local execution implementation design package.
It describes proposed architecture, control flow, conceptual CLI/API contract, data-family policy, cap
model, join handling, output/evidence model, fail-closed design, stop conditions, future test strategy and
sequencing. It does not approve GATE-2. It does not authorize implementation, limited broader local
execution, broader local execution, temp storage, multi-window sampling, exact percentages, import,
Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md`](./br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md).

BR-SOURCE-11R creates the execution authorization decision record.
It documents current blockers, owner decision options, required owner fields, minimum conditions before
execution and before a runbook, evidence requirements, stop conditions, a risk table and future milestone
mapping. It does not approve GATE-2. It does not authorize execution, real-data access, caps, input roots,
output roots, temp storage, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-execution-authorization-decision-record.md`](./br-receita-cnpj-execution-authorization-decision-record.md).

GATE-2 remains `not_started / not approved` in this record. 11R records the execution authorization decision
boundary only, and lists the absence of a GATE-2 approval as its first non-negotiable blocker.
