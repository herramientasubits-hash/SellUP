# BR-SOURCE-11X — Formal owner decision records for GATE2 GATE7 CAP INPUT

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11X — Formal owner decision records for GATE-2, GATE-7 and cap/input policy (docs-only)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, **not** a GATE-7 approval, **not** an
approval of cap/input policy, cap maxima, input roots, output roots or temp storage, **not** an authorization
for limited broader local execution, broader local execution, a controlled execution attempt, execution,
real-data file access, manifest reading, CSV reading, ZIP reading, row reads, exact coverage percentages, a
full-dataset denominator, import, Supabase writes, runtime or Agent 1, and **not** an approval of any gate
**Predecessor:** BR-SOURCE-11W-PRECONDITION-OWNER-PACKAGE-LAND — `BRSOURCE11WPRECONDITIONLANDA —
OWNER_PRECONDITION_PACKAGE_MERGED` (PR #203 merged as
`8dbe33127be9a4e6a9e8a23bc65c5fedce727c30`, merge method `--merge`, parent count 2)
**Authorization received:** `AUTHORIZE BR-SOURCE-11X — FORMAL OWNER DECISION RECORDS FOR GATE2 GATE7 CAP
INPUT` — authorizes only the creation of formal owner decision record templates, never GATE-2 approval,
never GATE-7 approval, never cap/input policy approval, never cap, input-root, output-root or temp-storage
authorization, never limited broader local execution, never broader local execution, never a controlled
execution attempt, and never real-data access
**Last reviewed:** 2026-08-03

**Related documents:**
- Precondition owner package (BR-SOURCE-11W) — [`br-receita-cnpj-11w-precondition-owner-package-gate2-gate7-cap-input-readiness.md`](./br-receita-cnpj-11w-precondition-owner-package-gate2-gate7-cap-input-readiness.md)
- Controlled execution authorization review (BR-SOURCE-11V) — [`br-receita-cnpj-controlled-execution-authorization-review.md`](./br-receita-cnpj-controlled-execution-authorization-review.md)
- Cap/input policy authorization package (BR-SOURCE-11T) — [`br-receita-cnpj-cap-input-policy-authorization-package.md`](./br-receita-cnpj-cap-input-policy-authorization-package.md)
- Execution runbook (BR-SOURCE-11S) — [`br-receita-cnpj-execution-runbook.md`](./br-receita-cnpj-execution-runbook.md)
- Execution authorization decision record (BR-SOURCE-11R) — [`br-receita-cnpj-execution-authorization-decision-record.md`](./br-receita-cnpj-execution-authorization-decision-record.md)
- Limited broader local execution decision record (BR-SOURCE-11N) — [`br-receita-cnpj-limited-broader-local-execution-decision-record.md`](./br-receita-cnpj-limited-broader-local-execution-decision-record.md)
- GATE-2 formal decision record (BR-SOURCE-11M) — [`br-receita-cnpj-gate2-formal-decision-record.md`](./br-receita-cnpj-gate2-formal-decision-record.md)
- GATE-2 owner review package (BR-SOURCE-11L) — [`br-receita-cnpj-gate2-owner-review-package.md`](./br-receita-cnpj-gate2-owner-review-package.md)
- GATE-2 controls and evidence template (BR-SOURCE-11K) — [`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md)
- Full join approval gates checklist (GATE-2 and GATE-7 definitions, § 6 and § 11) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)

---

> This document is a **record-structure package**. 11W inventoried which owner decisions are missing, who
> would have to make each one and what each would need attached. This milestone answers the narrower
> follow-on question: *in what form would each of those decisions be captured, and how would a reader tell a
> valid captured decision from an invalid one?* It supplies three blank formal records — one for GATE-2, one
> for GATE-7, one for cap/input policy — plus the validity rules that govern them. Every field in all three
> records reads `TBD_BY_OWNER`, every decision state in § 11 reads `not approved` or `not_authorized`, every
> line in the § 12 completion checklist reads `no`, and the recommendation in § 13 is to keep NO-GO.

---

## 1. Status

```text
Formal owner decision records status:                 proposed_for_owner_review
11W precondition owner package status:                official
Controlled execution authorization review status:     official
Synthetic rehearsal validation status:                passed
Cap/input policy authorization package status:        official
Cap/input policy approval status:                     not_authorized / not approved
GATE-2 approval status:                               not_started / not approved
GATE-7 approval status:                               not_started / not approved
Limited broader local execution authorization status:  not_authorized
Controlled execution attempt authorization status:    not_authorized
Execution run status:                                 not_authorized
Current GO/NO-GO:                                     NO-GO
```

Explicitly, this document does **not** authorize:

```text
This document does not approve GATE-2.
This document does not approve GATE-7.
This document does not approve cap/input policy.
This document does not authorize caps.
This document does not authorize input roots.
This document does not authorize output roots.
This document does not authorize temp storage.
This document does not authorize limited broader local execution.
This document does not authorize controlled execution.
This document does not authorize execution.
This document does not authorize real-data file access.
This document does not authorize manifest reading.
This document does not authorize CSV reading.
This document does not authorize ZIP reading.
This document does not authorize row reads.
This document does not authorize exact coverage percentages.
This document does not authorize full dataset denominator claims.
This document does not authorize import.
This document does not authorize Supabase writes.
This document does not authorize runtime.
This document does not authorize Agent 1.
This document does not approve any gate.
```

Exactly one status line has changed since 11W § 1, and as with the change 11W itself recorded, it is not an
advance. `11W precondition owner package status` moved from `proposed_for_owner_review` to `official`, which
records that a readiness package merged — the same transition 11T's and 11V's package statuses made before
it, and the same one 11V § 20 and 11W § 1 both warned reads as progress while moving no gate. Every line
that is an execution prerequisite is byte-for-byte what 11W recorded, and the verdict line is unchanged.

---

## 2. Purpose

```text
The purpose of this document is to define formal owner decision record templates for GATE-2, GATE-7 and
cap/input policy.
```

```text
This document creates decision record structure only.
It is not an approval.
It is not an execution authorization.
It is not valid with placeholders.
It contains no real paths, no real cap values and no runnable real-data command.
```

11W § 10 supplied a single seventeen-field draft form covering all three decision areas at once, and noted
that the form is not itself the official owner decision record — a filled copy inside a docs-only package
would be an unapproved draft. This milestone takes that note as its scope. It splits the one form into three
separate records, because the three decisions have different owners, different evidence requirements and
different failure modes, and a single combined form invites the reading that one signature clears all three.
It then attaches validity rules, so that a filled record can be checked rather than merely read.

The distinction between *structure* and *decision* is the whole of this milestone, and it is worth stating in
the sharpest available form: **a form is not a signature, and a well-designed form is not a better
signature.** Three records with twenty fields each is sixty fields of nothing, and the risk 11V § 12 and
11W § 2 both flagged — that each successive artifact looks more like readiness than the state warrants —
applies here with more force than to any prior milestone in the chain, because a decision *record* is the
artifact a reader is most likely to mistake for a decision. That is why § 4 defines invalidity before § 5
defines the first record, why each of § 5, § 6 and § 7 closes with its own explicit non-approval block, and
why § 11 restates the whole ledger rather than deferring to the sections above it.

---

## 3. Source of truth

The following records are the official basis for every status in this document:

```text
11W precondition owner package.
11V controlled execution authorization review.
11T cap/input policy authorization package.
11S non-executable execution runbook.
11R execution authorization decision record.
11U synthetic rehearsal validation.
11P fail-closed implementation scaffold.
11Q post-merge validation.
11M GATE-2 formal decision record.
11L GATE-2 owner review package.
11K GATE-2 controls and evidence template.
11I zero interpretation and stop cap expansion recommendation.
```

```text
11X does not supersede those records.
11X only creates formal owner decision record templates.
```

Four of the twelve entries constrain the *shape* of the records below rather than merely supplying status,
and a later editor should not normalize any of them away. 11I's interpretation forbids treating any bounded
observation as a dataset-level claim, so no field in any record below may be justified by citing a probe
result. 11T § 6's rule that a null cap is not an unlimited cap makes every blank in § 7 a `false` rather than
an open permission. 11S § 8's field-level rules govern what a filled field may contain — a class label rather
than a path for input roots, an identifier rather than pasted contents for every reference field. And 11W § 5
supplies the role labels the *Owner role* fields expect, together with the rule that approvers and
implementers stay apart.

Where this document appears to restate a prior record, the prior record governs. Where a reader finds a
discrepancy, 11V § 6, 11T § 1 and 11W § 5 are authoritative over anything written here.

---

## 4. Validity rules for any owner decision record

```text
A decision record is invalid if any required field remains TBD_BY_OWNER.
A decision record is invalid if it includes real paths in a docs-only package.
A decision record is invalid if it includes real cap values without explicit owner approval.
A decision record is invalid if it grants execution by implication.
A decision record is invalid if it approves import/runtime/Agent 1.
A decision record is invalid if it omits expiration or re-review date.
A decision record is invalid if legal/privacy/security reference is missing.
A decision record is invalid if operator/reviewer are missing where required.
A decision record is invalid if evidence packet reference is missing.
A decision record is invalid if incident/escalation path is missing.
```

```text
Invalid record = NO-GO.
```

These ten rules are the substance of the milestone, and four of them deserve elaboration because each one
closes a specific way a record could look complete while being void.

**Invalid if it grants execution by implication.** A record whose *Decision value* reads `approved` clears
exactly the decision area named in its *Decision area* field and nothing adjacent to it. An approved GATE-2
record does not thereby authorize a run that GATE-2 governs storage for; an approved cap/input record does not
authorize reading a file up to the approved ceiling. Every execution authorization in this chain is a separate
decision with a separate phrase, per § 9. A record that reads as clearing execution is not a strong record —
it is an invalid one, and the invalidity is not curable by adding fields.

**Invalid if it approves import, runtime or Agent 1.** These three sit outside this chain's decision surface
entirely, as 11W § 5's last three rows record: each requires its own readiness process, none of which has
begun. An owner who wrote `approved` against any of them in a record below would be exceeding the record's
scope, not extending it, and the record would be void rather than partially effective.

**Invalid if it omits expiration or re-review date.** An approval without an expiry is an approval that
outlives the state it was granted against. 11W § 4 lists the missing expiry as its own blocker for exactly
this reason: every measured ceiling, every environment attestation and every role assignment in this chain
describes a moment, and a decision that cites them has to be re-checked against a later one.

**Invalid if it includes real cap values without explicit owner approval.** This is the one rule whose
violation could be *accidental* rather than structural. The records below carry no numbers, and none may be
added to them by a documentation edit: a ceiling appears only inside an owner-approved cap decision, and a
docs-only milestone can add neither the ceiling nor the approval. A number written into § 7 by an editor
rather than an owner is a fabricated approval, which is the specific failure this chain exists to prevent.

Two further properties of the rule set are structural rather than per-rule. The rules are *conjunctive*: a
record must satisfy all ten, and satisfying nine yields an invalid record rather than a partially valid one.
And invalidity is *not* a warning state — the closing line reads `Invalid record = NO-GO`, in the same shape
as 11S § 7's rule that a failed preflight item is a stop and an ambiguous item has failed.

---

## 5. Formal decision record A — GATE-2

```text
Record ID:                              BR-GATE2-OWNER-DECISION-TBD
Decision area:                          GATE-2
Decision status:                        TBD_BY_OWNER
Owner role:                             TBD_BY_OWNER
Owner reference:                        TBD_BY_OWNER
Decision date:                          TBD_BY_OWNER
Expiration/re-review date:              TBD_BY_OWNER
Decision value:                         TBD_BY_OWNER
Allowed decision values:                approved / rejected / deferred
Scope boundary:                         TBD_BY_OWNER
Non-production boundary:                TBD_BY_OWNER
No-import boundary:                     TBD_BY_OWNER
No-runtime boundary:                    TBD_BY_OWNER
No-Agent1 boundary:                     TBD_BY_OWNER
No-provider boundary:                   TBD_BY_OWNER
Evidence packet reference:              TBD_BY_OWNER
Legal/privacy/security reference:       TBD_BY_OWNER
Operator/reviewer requirement:          TBD_BY_OWNER
Incident/escalation reference:          TBD_BY_OWNER
Stop conditions accepted:               TBD_BY_OWNER
```

```text
Current GATE-2 status after 11X: not_started / not approved.
Approval granted by 11X: no.
If Decision value remains TBD_BY_OWNER: NO-GO.
If Decision value is deferred: NO-GO.
If Decision value is rejected: NO-GO.
If Decision value is approved but any required supporting field is missing: NO-GO.
```

Setting aside the identity and dating fields, the record's remaining lines split into three kinds, and the
split explains why the four NO-GO conditions above are not redundant with each other. *Decision value* is the
decision. The five boundary fields and
*Stop conditions accepted* are acknowledgements — an owner recording that the approval does not extend past a
stated edge. The four reference fields point at artifacts by identifier, never by contents: a legal
determination is cited rather than pasted, and an evidence packet is named rather than reproduced.

Two field-level constraints carry over from 11S § 8 and 11W § 10 and are not negotiable by a filled record.
*Evidence packet reference* takes a bucket class or an artifact identifier, never a path. *Owner reference*
takes an approval reference — the identifier under which the decision was captured where decisions are
captured — and the *Owner role* field takes a role label from 11W § 5, which for GATE-2 is the joint
technical-owner and privacy-owner pairing. A single-role approval of GATE-2 is not a valid GATE-2 approval;
the gate requires both, and a record naming one is missing a required field rather than merely thin.

The `deferred` and `rejected` NO-GO lines exist because both are *complete* decisions that leave the gate
unapproved. A reader who finds a fully filled record with no blank fields has not thereby found a cleared
gate — a deferral is a valid record and a NO-GO simultaneously, and the fourth condition covers the remaining
case where an `approved` value sits above a missing reference. GATE-2's own fail criteria in the gates
checklist treat an unverifiable cleanup path as a block, and 11W § 6 records that no measured ceiling, no
verifiable cleanup path and no TTL yet exists, so the fourth condition is the one a premature record would
most likely trip.

---

## 6. Formal decision record B — GATE-7

```text
Record ID:                              BR-GATE7-OWNER-DECISION-TBD
Decision area:                          GATE-7
Decision status:                        TBD_BY_OWNER
Owner role:                             TBD_BY_OWNER
Owner reference:                        TBD_BY_OWNER
Decision date:                          TBD_BY_OWNER
Expiration/re-review date:              TBD_BY_OWNER
Decision value:                         TBD_BY_OWNER
Allowed decision values:                approved / rejected / deferred
Operator role:                          TBD_BY_OWNER
Reviewer role:                          TBD_BY_OWNER
Runbook reference:                      TBD_BY_OWNER
Evidence capture procedure:             TBD_BY_OWNER
Sanitizer procedure:                    TBD_BY_OWNER
Cleanup procedure:                      TBD_BY_OWNER
Incident path:                          TBD_BY_OWNER
Escalation path:                        TBD_BY_OWNER
Stop conditions accepted:               TBD_BY_OWNER
Dry-run rehearsal reference:            TBD_BY_OWNER
```

```text
Current GATE-7 status after 11X: not_started / not approved.
Approval granted by 11X: no.
If Decision value remains TBD_BY_OWNER: NO-GO.
If Decision value is deferred: NO-GO.
If Decision value is rejected: NO-GO.
If Decision value is approved but any required supporting field is missing: NO-GO.
```

This record differs from § 5 in kind, not merely in field list, and the difference follows what GATE-7
governs. GATE-2 approves an envelope; GATE-7 approves *a procedure performed by named humans*. So where § 5
carries five boundary acknowledgements, this record carries four procedure fields — evidence capture,
sanitizer, cleanup, incident — and two role fields that terminate in assignments rather than in statements.
11W § 7 records every GATE-7 readiness row as `not_ready` for precisely this reason: documentation can
describe a procedure, and 11S does at length, but it cannot approve one, assign an operator to it, or
countersign its output.

*Operator role* and *Reviewer role* take role labels and must name two distinct roles. 11S § 6 requires
separation between the operator and the independent reviewer, and a record naming the same role for both is
missing a required field rather than efficiently filled. Neither field takes a person's name in a repository
document: the assignment itself is recorded per 11S § 4.2, through the operator channel, and referenced here.
The runbook's own rule that the operator is a named human — never an agent, an automation or a CI runner —
governs any such assignment and is not relaxed by anything in this record.

*Dry-run rehearsal reference* is the field most likely to be filled with something that does not satisfy it,
and the distinction is the one 11V § 13 and 11W § 7 both drew. 11U exercised a *scaffold* declining to
proceed against synthetic inputs; a GATE-7 rehearsal exercises a *named human following a runbook end to
end*. The gate's pass criteria require reproducibility by a different operator without tacit knowledge, so
the reference this field wants is to a performed operator rehearsal, and no operator has performed the
procedure once. A record citing 11U here would be citing evidence for a different claim. Separately, the
runbook's preflight cannot pass by construction while GATE-2 is unapproved, since its first item verifies
gate status — which means a valid GATE-7 record cannot precede a valid GATE-2 record, a dependency § 8 states
in general form.

---

## 7. Formal decision record C — cap/input policy

```text
Record ID:                              BR-CAP-INPUT-OWNER-DECISION-TBD
Decision area:                          cap/input policy
Decision status:                        TBD_BY_OWNER
Owner role:                             TBD_BY_OWNER
Owner reference:                        TBD_BY_OWNER
Decision date:                          TBD_BY_OWNER
Expiration/re-review date:              TBD_BY_OWNER
Decision value:                         TBD_BY_OWNER
Allowed decision values:                approved / rejected / deferred
Cap maxima decision:                    TBD_BY_OWNER
Input root decision:                    TBD_BY_OWNER
Output root decision:                   TBD_BY_OWNER
Temp storage decision:                  TBD_BY_OWNER
Evidence bucket decision:               TBD_BY_OWNER
Family allow/deny decision:             TBD_BY_OWNER
Manifest/control-file policy decision:  TBD_BY_OWNER
Exact percentage policy decision:       TBD_BY_OWNER
Full dataset denominator policy decision: TBD_BY_OWNER
Coverage language decision:             TBD_BY_OWNER
Stop conditions accepted:               TBD_BY_OWNER
Legal/privacy/security reference:       TBD_BY_OWNER
```

```text
Current cap/input policy status after 11X: not_authorized / not approved.
Approval granted by 11X: no.
No cap maximum is approved by 11X.
No input root is approved by 11X.
No output root is approved by 11X.
No temp storage is approved by 11X.
If Decision value remains TBD_BY_OWNER: NO-GO.
If Decision value is deferred: NO-GO.
If Decision value is rejected: NO-GO.
If Decision value is approved but any required supporting field is missing: NO-GO.
```

**No field above carries a numeric value, and none may be added by a documentation edit.** *Cap maxima
decision* references an owner-approved cap set by artifact identifier; it does not restate the set, and it
certainly does not originate one. This is the same category-versus-value rule 11T § 4 sets and 11W § 5
applied to its matrix: a field naming a cap is not a cap ceiling, and a blank field is null, which is not
unlimited.

Four fields carry standing constraints that a filled record cannot lift by fiat, and an owner filling this
record should know which they are before writing in them.

- *Input root decision* takes a **class label** and never a path — an approved directory value travels
  through the operator channel, not through a repository document. Four classes are unavailable rather than
  merely unapproved: 11T § 7 blocks the raw archive directory class, the browser download directory class and
  the ad-hoc directory class outright, and the repository directory class is prohibited for both input and
  output. A record naming any of those four as approved contradicts a standing decision and is void.
- *Family allow/deny decision* inherits 11T § 9's placement of the `simples` family on the forbidden side.
  Moving it requires its own determination and is not lifted implicitly by a cap approval that does not name
  it. The person-linked families — corporate-partner, shareholder-register and natural-person-identifier
  classes — stay forbidden under every value this field can take.
- *Manifest/control-file policy decision* starts from 11T § 10, which authorizes no manifest reading at all.
  A value here that permits reading a control file is a new authorization, not a clarification of an existing
  one, and needs the evidence a new authorization needs.
- *Exact percentage policy decision* and *Full dataset denominator policy decision* both start at
  `not_authorized` per 11T § 13, and 11I forbids inferring either from a bounded observation. No denominator
  has ever been observed, so a record approving a denominator claim would be approving a claim with no basis.

*Temp storage decision* is a selection between two named options in 11T § 11 rather than a free-text field,
and 11T recommends Option A, the disabled one. 11W § 8 records that no selection has been made and that
inference from implementation behavior is blocked: a scaffold that happens not to write a temp artifact is not
an owner decision that it may not.

---

## 8. Combined decision dependency rule

```text
A future controlled execution attempt remains blocked unless all three decision records are valid and
official:
- GATE-2 decision record.
- GATE-7 decision record.
- cap/input policy decision record.
```

```text
Approving only one or two of the three is insufficient.
All three are necessary and still not sufficient if controlled execution attempt authorization is missing.
```

The rule is stated as a conjunction over *valid and official* records, and both adjectives do work. *Valid*
means the § 4 rules are satisfied, which as § 5 and § 6 note is not implied by the absence of blanks — a
fully filled deferral is valid as a record and still a NO-GO as a decision. *Official* means captured where
approvals are captured and referenced by identifier, not filled into a copy of a template inside a docs-only
package. 11V § 12 lists *operator self-declares approval* as a present risk, and a filled template is the
most natural vehicle for that risk, which is why the two adjectives appear together rather than either alone.

There is also a partial ordering among the three, which the rule's conjunctive form deliberately does not
soften into a sequence a reader could treat as progress. GATE-7 cannot be validly approved ahead of GATE-2,
because the runbook preflight GATE-7 approves begins by verifying gate status and that item fails while
GATE-2 is unapproved. Cap/input policy approval interacts with GATE-2 in the other direction: GATE-2's
required evidence includes disk and memory ceilings, and those ceilings have to be reconciled against the cap
maxima the cap/input record references. Neither observation shortens the list. Three of three are required,
in an order that makes two of them dependent on the first, and the state today is zero of three.

---

## 9. Execution authorization dependency

```text
Even if the three owner decision records are later approved, 11X does not authorize execution.
A separate controlled execution attempt authorization would still be required.
```

This is the § 4 rule against granting execution by implication, stated at the level of the whole document
rather than of a single record. Three valid and official records would clear three of the fifteen blockers
11W § 4 enumerates — GATE-2, GATE-7 and cap/input policy — and would supply values for several of the
remaining ones by reference. They would clear none of: the legal/privacy/security determination and
environment attestation, the operator and reviewer assignments themselves, the named incident owner, the
limited broader local execution authorization, and the controlled execution attempt authorization.

11W § 9's preflight makes the arithmetic explicit and it is worth carrying forward: thirteen of eighteen
items fail today, and the three records above address at most the first three lines of that table. A reader
who treats three approvals as *most of the way there* has miscounted, and the miscount is the exact hazard
11V § 9 gave for recording an unconditional NO-GO rather than a conditional one. The controlled execution
attempt authorization has its own phrase, recorded in 11V § 17, and that phrase remains unused. An agent
presented with it while any § 15 item stands must still refuse; nothing in this document changes that
refusal.

---

## 10. Required negative assertions

```text
No real path may appear in this document.
No real cap value may appear in this document.
No real manifest filename may appear in this document.
No real CSV filename may appear in this document.
No real ZIP filename may appear in this document.
No real row sample may appear in this document.
No CNPJ, CPF, phone, email, LinkedIn or person data may appear in this document.
No join key may appear in this document.
No hash derived from source data may appear in this document.
```

These nine assertions hold for the document as written and are stated as constraints rather than as
observations so that they bind any future edit to it, including any future edit that fills a field in § 5,
§ 6 or § 7. Two of them restate standing BR-SOURCE invariants that predate this chain: join keys are never
printed and never persisted, and a hash derived from source data is forbidden on the same footing as the
identifier it derives from — "it's only a hash" is not an exemption anywhere in this evidence policy,
consistent with 11S § 11 and 11T § 12.

The assertions interact with the record templates in one way worth making explicit. A record field that would
otherwise want a path or a value — *Input root decision*, *Evidence packet reference*, *Cap maxima decision* —
takes a class label or an artifact identifier instead, which is what makes it possible for a *filled* record to
be quoted in a repository document at all. The commit identifiers in this document's header are repository
references, not source-derived hashes, and fall outside the ninth assertion.

---

## 11. Decision state after this document

```text
GATE-2 approval = not approved
GATE-7 approval = not approved
cap/input policy approval = not approved
cap maxima = not_authorized
input roots = not_authorized
output roots = not_authorized
temp storage = not_authorized
limited broader local execution = not_authorized
controlled execution attempt = not_authorized
real manifest reading = not_authorized
real CSV reading = not_authorized
real ZIP reading = not_authorized
row reads = not_authorized
exact percentages = not_authorized
full dataset denominator = not_authorized
import = not_authorized
Supabase writes = not_authorized
runtime = not_authorized
Agent 1 = not_authorized
Brazil live prospect generation = not_authorized
```

Twenty rows, twenty unauthorized, unchanged from 11W § 14 and from every ledger before it. The ledger exists
so that the question "did anything become permitted here?" has a single place to be answered rather than
requiring a reader to reconstruct the answer from three record templates. Nothing above changed state as a
result of this document, and nothing above can be changed by merging it.

---

## 12. Owner completion checklist

```text
GATE-2 decision record completed:                       no
GATE-2 decision record valid:                           no
GATE-7 decision record completed:                       no
GATE-7 decision record valid:                           no
cap/input decision record completed:                    no
cap/input decision record valid:                        no
legal/privacy/security reference captured:              no
operator/reviewer references captured:                  no
evidence packet reference captured:                     no
incident/escalation path captured:                      no
expiration/re-review date captured:                     no
controlled execution attempt authorization captured:    no
```

```text
Owner completion result: NOT COMPLETE / NO-GO.
```

Twelve lines, twelve `no`. The *completed* and *valid* rows are deliberately separate for each record, and
the pairing is the checklist's only real content: completion is the absence of blanks, validity is
satisfaction of the § 4 rules, and a record can be the first without being the second. The clearest case is a
fully filled deferral, which completes without approving anything; the next clearest is an `approved` value
above a missing expiry, which § 4 voids outright.

The last row sits below a boundary rather than at the end of a sequence, as 11W § 5's final three rows do.
`controlled execution attempt authorization captured` is not the twelfth step of this checklist — it is a
separate decision that § 9 records as unreachable through this document, listed here so that a reader
completing the eleven rows above it does not conclude that the twelfth follows.

---

## 13. Recommended decision

```text
Recommended decision for 11X: Keep NO-GO.
```

```text
The next useful action is owner completion of the formal decision records.
The next useful action is not execution.
```

The rationale is what § 11 and § 12 make unavoidable: zero of three records exist, twenty of twenty ledger
rows are unauthorized, and twelve of twelve completion lines read `no`. Every item requires a decision this
document cannot make, and the two that 11R § 8 identified as binding — an undecided GATE-2 and an unperformed
external legal/privacy/security review — are exactly where 11R left them, where 11V found them and where 11W
inventoried them.

On sequencing, this milestone's recommendation differs in one respect from 11W § 15 and the difference should
be recorded rather than smoothed over. 11W named legal/privacy/security escalation as the area where a unit
of effort moves the most, and that remains true — it is the one prerequisite whose satisfaction is genuinely
external. This document adds that the three records above are now *ready to be filled*, which was not
previously the case, so owner completion has become a second area where effort is not wasted. Neither
observation is an authorization: a legal/privacy/security escalation requires its own separate owner phrase,
and owner completion requires the owners themselves. Recording a "GO once X" formulation would still be wrong
for the reason 11V § 9 gave, since X here is twelve items across three records plus an external review.

---

## 14. Required phrase for next step

```text
AUTHORIZE BR-SOURCE-11Y — OWNER DECISION CAPTURE REVIEW
```

```text
11Y would review whether owner-filled decision records are complete and valid.
11Y must still be docs-only unless a separate execution authorization is explicitly granted later.
11Y must not execute data.
11Y must not approve execution by implication.
11Y must not bypass missing approvals.
```

```text
The recommended decision in § 13 is to keep NO-GO, which uses no phrase at all.
This phrase is recorded so that, if the owner chooses to proceed to 11Y instead, the exact wording is
unambiguous.
```

The phrase above would authorize *reviewing* filled records against § 4, not filling them and not approving
them. A milestone under it would have nothing to review while § 12 reads twelve `no`, which is worth stating
plainly: 11Y run today would report that zero records exist and reach the same NO-GO, and a 11Y that
manufactured records to review would be manufacturing the appearance of approval — the failure mode this
entire chain exists to prevent.

This phrase differs in kind from the one 11V § 17 recorded, and the two must not be conflated. 11V's phrase
would authorize a real-data controlled execution attempt and is valid only if eight separate approvals
already exist; it remains unused, and this milestone is not it. Two other branches remain available at the
owner's discretion, each needing its own separate phrase: a legal/privacy/security escalation, and a GATE-2 or
GATE-7 owner review conducted by the role pairs 11W § 5 names. The § 13 recommendation uses none of the four.

---

## 15. What remains blocked

```text
GATE-2 approval;
GATE-7 approval;
cap/input policy approval;
cap approval;
input root authorization;
output root authorization;
temp storage authorization;
limited broader local execution;
controlled execution attempt;
broader local execution;
real manifest reading;
real CSV reading;
real ZIP reading;
row reads;
larger caps;
multi-window sampling;
seeking strategy;
opening additional files;
opening catalog files;
opening corporate-partner, shareholder-register or natural-person-identifier files;
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

## 16. Gate status

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

Eight gates, none approved, unchanged from 11W § 18 and from every milestone before it. No gate has moved to
`ready_for_review`, and this document moves none. In particular, **a decision record for a gate is not a
decision on that gate**: § 5 and § 6 supply the forms GATE-2 and GATE-7 decisions would be captured in, and
neither section changes either gate's status by a single character. That distinction is the same one 11W § 13
drew about 11M — an official record of an undecided decision is not evidence that the decision was made — and
this document adds two more records of exactly that kind.

---

## 17. Flags

```text
OPS_BR_11X_FORMAL_OWNER_DECISION_RECORDS_AUTHORIZED = true
OPS_BR_11X_FORMAL_OWNER_DECISION_RECORDS_PR_READY = false until PR
OPS_BR_11X_FORMAL_OWNER_DECISION_RECORDS_OFFICIAL = false until merge

OPS_BR_11W_PRECONDITION_OWNER_PACKAGE_OFFICIAL = true
OPS_BR_CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZED = false
OPS_BR_CAP_INPUT_POLICY_APPROVED = false
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_GATE7_APPROVED = false
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

`OPS_BR_11X_FORMAL_OWNER_DECISION_RECORDS_AUTHORIZED = true` records that the owner authorized *writing these
record templates* — nothing else. `..._PR_READY` flips to `true` only once this docs-only PR is open, and
`..._OFFICIAL` only once it is merged. Neither flip changes `OPS_BR_GATE2_APPROVED`,
`OPS_BR_GATE7_APPROVED`, `OPS_BR_CAP_INPUT_POLICY_APPROVED` or
`OPS_BR_CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZED`, all of which stay `false` regardless: approving a record
template's existence and approving the decision it would capture are different decisions, and the second is
not reachable through this document at all.

Two flags read `true` for reasons that are easy to misgroup, and both pairings are placed deliberately.
`OPS_BR_11W_PRECONDITION_OWNER_PACKAGE_OFFICIAL` records that the 11W *readiness package* merged, sitting
directly above four `false` approval flags — a merged package whose content is a NO-GO inventory.
`FULL_JOIN_RUNNER_READY` records that a fail-closed scaffold exists, sitting directly above
`FULL_JOIN_EXECUTION_READY = false`. Every Brazil-readiness flag stays `false` regardless of any flip above.

---

## 18. Safety confirmation

```text
This document is docs-only.
It does not authorize execution.
It does not authorize real-data access.
It does not approve GATE-2.
It does not approve GATE-7.
It does not approve cap/input policy.
It does not approve caps.
It does not authorize input roots.
It does not authorize output roots.
It does not authorize temp storage.
It does not approve controlled execution.
It does not approve any gate.
Brazil remains blocked for import, runtime, Agent 1 and live prospect generation.
```

This milestone touched no code, no scripts, no package manifest, no test, no Supabase schema, no migration,
no runtime path, no Agent 1 path, no provider, and no UI. It opened no real dataset file, read no real
manifest, opened no CSV and no ZIP, processed no row, executed no join, and computed no coverage figure. It
recorded no cap ceiling, no input root and no output root. Every gate in § 16 remains `not_started / not
approved`, including GATE-2 and GATE-7, and any milestone after this one still requires its own explicit
owner authorization.

The document's answer to its own question in § 2 is: **formal records are created with required fields,
placeholders and validity criteria; the current recommendation remains NO-GO; and no decision is granted by
this package.** Every owner-supplied field in all three records reads `TBD_BY_OWNER` — seventeen in § 5,
sixteen in § 6 and eighteen in § 7, the remaining lines in each being the record identifier, the decision
area and the allowed-value enumeration — all twenty rows in § 11 remain unauthorized, and all twelve lines in
§ 12 read `no`.

---

## 19. Update (BR-SOURCE-11Y)

BR-SOURCE-11Y creates an owner decision capture review. It evaluates whether the formal owner decision
records from this document are complete and valid. Current result remains NO-GO because owner decisions are
not captured, required fields remain missing and no approval is granted. It does not approve GATE-2. It does
not approve GATE-7. It does not approve cap/input policy. It does not authorize caps, input roots, output
roots, temp storage, controlled execution, real-data access, import, Supabase, runtime or Agent 1. See
[`br-receita-cnpj-11y-owner-decision-capture-review.md`](./br-receita-cnpj-11y-owner-decision-capture-review.md).

It flips no status in this document and completes no field in it. All fifty-one owner-supplied fields across
§ 5, § 6 and § 7 still read `TBD_BY_OWNER` — 11Y is explicitly not authorized to complete any of them — all
ten validity rules in § 4 remain unsatisfied for all three records, all twenty rows in § 11 remain
unauthorized, all twelve lines in § 12 still read `no`, and the § 13 recommended decision to keep NO-GO is
unchanged.

11Y confirms the prediction § 14 recorded in advance: a capture review conducted while § 12 reads twelve `no`
reports that zero records exist and reaches the same NO-GO. It applies § 4's ten rules as its entire test set,
adding no criterion and relaxing none, and records the finding one step earlier than § 4 anticipates — an
absent record is not an invalid record, because there is nothing to check, so no proportion of the criteria can
be reported as met. Its own § 11 closes the same implication rule on the reviewer: a merged capture review is
not an approval, and a decision record for a gate remains not a decision on that gate.

---

## 20. Update (BR-SOURCE-11Z)

BR-SOURCE-11Z creates an owner decision completion packet. It packages the missing owner fields detected by
11Y — the fields of the three records in § 5, § 6 and § 7 — so owners can complete them later. Current result
remains NO-GO because this package does not fill owner fields, does not capture owner decisions and grants no
approval. It does not approve GATE-2. It does not approve GATE-7. It does not approve cap/input policy. It
does not authorize caps, input roots, output roots, temp storage, controlled execution, real-data access,
import, Supabase, runtime or Agent 1. See
[`br-receita-cnpj-11z-owner-decision-completion-packet.md`](./br-receita-cnpj-11z-owner-decision-completion-packet.md).

It flips no status in this document and completes no field in it. All fifty-one owner-supplied fields across
§ 5, § 6 and § 7 still read `TBD_BY_OWNER` — 11Z is explicitly not authorized to complete any of them — all
ten validity rules in § 4 remain unsatisfied for all three records, all twenty rows in § 11 remain
unauthorized, all twelve lines in § 12 still read `no`, and the § 13 recommended decision to keep NO-GO is
unchanged.

11Z adds no field to any of the three records, removes none and widens no allowed value; its completion forms
restate this document's fields as completion targets and attach, per field, the input an owner must obtain
first. Three of this document's rules govern it directly. § 4's ten validity rules remain the whole test set,
and 11Z's own completion rules layer on top of them rather than substituting for them. § 8's requirement that
a valid record be captured **where approvals are captured** is why 11Z refuses to host a filled record and
states the refusal as a rule rather than a scope note. And § 9's dependency stands: three valid and official
records would still not authorize execution, which remains a separate decision under the 11V § 17 phrase.

---

## 21. Update (BR-SOURCE-12A)

BR-SOURCE-12A creates an owner completion intake review. It evaluates whether externally completed owner
fields were provided after 11Z. Current result remains NO-GO because no owner completion intake was received,
no owner decision was captured and no approval is granted. It does not approve GATE-2. It does not approve
GATE-7. It does not approve cap/input policy. It does not authorize caps, input roots, output roots, temp
storage, controlled execution, real-data access, import, Supabase, runtime or Agent 1. See
[`br-receita-cnpj-12a-owner-completion-intake-review.md`](./br-receita-cnpj-12a-owner-completion-intake-review.md).

It flips no status in this document and completes no field in it. All fifty-one owner-supplied fields across
§ 5, § 6 and § 7 still read `TBD_BY_OWNER`, no instance of any of the three records has been created anywhere,
all ten validity rules in § 4 remain unsatisfied for all three, all twenty rows in § 11 remain unauthorized,
all twelve lines in § 12 still read `no`, and the § 13 recommended decision to keep NO-GO is unchanged.

12A adds an intake gate that runs *before* § 4's rules rather than alongside them, and the ordering is the
point: § 4 describes how to void a record that exists, and 12A decides whether a record exists to be voided.
Its Step 2 is § 8 applied as an admission test — an arriving artifact must be captured where approvals are
captured and cited by identifier before its fields matter — which is why a filled copy of § 5, § 6 or § 7
sitting in a repository directory, a pull request or a message is not an intake. Zero of the three records were
received, so no rule in § 4 was exercised, and § 9's dependency stands unchanged: three valid and official
records would still not authorize execution, which remains a separate decision under the 11V § 17 phrase.

---

## 22. Update (BR-SOURCE-12B)

BR-SOURCE-12B creates an owner completion resubmission packet. It defines what owners must resubmit after 12A
found that no owner-completed intake was received. Current result remains NO-GO because no owner resubmission
has been received, no owner decision was captured and no approval is granted. It does not approve GATE-2. It
does not approve GATE-7. It does not approve cap/input policy. It does not authorize caps, input roots, output
roots, temp storage, controlled execution, real-data access, import, Supabase, runtime or Agent 1. See
[`br-receita-cnpj-12b-owner-completion-resubmission-packet.md`](./br-receita-cnpj-12b-owner-completion-resubmission-packet.md).

It fills no field in the three records and flips no status in this document. All fifty-one owner-supplied
fields across § 5, § 6 and § 7 still read `TBD_BY_OWNER`, all fourteen lines in § 12 read `no`, all
twenty-two lines in § 11 remain unauthorized, all eight gates in § 16 remain unapproved, and § 13's
recommendation is unchanged.

§ 4's ten validity rules are the authority 12B's rejection criteria are downstream of: each criterion names a
concrete way a resubmission could fail one of the ten, none adds a rule, and where a criterion appears to
differ from § 4, § 4 governs. § 8's requirement that a valid record is captured where approvals are captured
and cited here by identifier is the reason 12B fills nothing in — a field completed inside the repository
would produce an unapproved draft that reads like an approval. § 9's dependency stands unchanged: three valid
and official records would still not authorize execution, which remains a separate decision under the
11V § 17 phrase.
