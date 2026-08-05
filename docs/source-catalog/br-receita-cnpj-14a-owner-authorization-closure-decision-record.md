# BR-SOURCE-14A — Owner authorization closure and controlled execution GO/NO-GO

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-14A — Owner authorization closure and controlled execution GO/NO-GO decision (docs + one runtime-guard fix to BR-SOURCE-13J, no new validator)
**Status:** `NO_GO` — **not** a GATE-2 approval, **not** a GATE-7 approval, **not** a cap/input policy approval, **not** an authorization of any kind for a controlled execution attempt, real-data access, manifest reading, CSV/ZIP reading, row reads, import, Supabase writes, runtime or Agent 1.
**Predecessor:** BR-SOURCE-13J-LAND — `CONTROLLED_EXECUTION_AUTHORIZATION_INTAKE_VALIDATOR_MERGED`, PR #228, merge commit `ef9facaacb9e63cfa1bd4dda8f6e9b4fca2eee17`.
**Base commit audited:** `origin/main` at `02d286b4baca880f093d2b3d73d48957f991efd7` (13J confirmed an ancestor).

**Related documents:**
- 11W — [`br-receita-cnpj-11w-precondition-owner-package-gate2-gate7-cap-input-readiness.md`](./br-receita-cnpj-11w-precondition-owner-package-gate2-gate7-cap-input-readiness.md)
- 11X — [`br-receita-cnpj-11x-formal-owner-decision-records-gate2-gate7-cap-input.md`](./br-receita-cnpj-11x-formal-owner-decision-records-gate2-gate7-cap-input.md)
- 12A — [`br-receita-cnpj-12a-owner-completion-intake-review.md`](./br-receita-cnpj-12a-owner-completion-intake-review.md)
- 12B — [`br-receita-cnpj-12b-owner-completion-resubmission-packet.md`](./br-receita-cnpj-12b-owner-completion-resubmission-packet.md)
- 13J — [`br-receita-cnpj-13j-controlled-execution-authorization-intake-validator.md`](./br-receita-cnpj-13j-controlled-execution-authorization-intake-validator.md)

---

> This document answers exactly one question: does a real, valid, attributable, sufficiently-bounded
> authorization already exist in this repository to execute the full Receita join in BR-SOURCE-14B? It
> reuses BR-SOURCE-13J's validator unchanged in its logic (one runtime gap in that logic is fixed here —
> see § 2) and invents no approval. The answer is **NO — MISSING EXACTLY THE OWNER DECISIONS LISTED IN
> § 5**, because no owner-authored decision record for GATE-2, GATE-7, cap/input policy or a controlled
> execution attempt has ever been received into this repository, at any milestone from 11W through 14A.

---

## 1. Reuse audit: does 13J need a new validator?

**`CAN_13J_VALIDATE_THE_REAL_OWNER_RESUBMISSION = YES`.**

`validateBrazilReceitaControlledExecutionAuthorizationIntake` (13J) takes an `intake` object supplied
directly by its caller — it does not require going through one of its own named fixture builders. Its
validation logic (missing/rejected/deferred decisions, the four cross-decision consistency rules,
placeholder detection, forbidden-content detection, required-acknowledgement checks) is generic: it
applies identically to a genuine owner submission's structure and to a synthetic test fixture's
structure. No new validator, no new packet type and no duplicate of 13J's result shape was created for
this milestone.

One genuine, narrow defect was found and fixed, not invented as a pretext for new infrastructure:
**`reviewerRole` was declared as a five-member closed union type but never checked at runtime.** An intake
decision built from anything other than this module's own hardcoded literals — a hand-assembled object,
or eventually a real submission — could carry any string in that field (empty, misspelled, or naming no
real role at all), and 13J would accept it without a finding. This is exactly the "actor aprobador
inválido" failure mode this milestone's test matrix requires (§ 11). The fix adds:

- `BRAZIL_RECEITA_INTAKE_REVIEWER_ROLES` (exported role list) and `isBrazilReceitaIntakeReviewerRole`
  (runtime guard), mirroring the existing `scope` check immediately below it in `checkDecisionContent`.
- A new finding code, `INTAKE_REVIEWER_ROLE_INVALID`, added to `INVALID_CODES` (same severity bucket as
  `INTAKE_FIELD_PLACEHOLDER` / `INTAKE_SCOPE_INVALID` / `INTAKE_FORBIDDEN_CONTENT`).
- A 17th named fixture, `invalid_reviewer_role`, isolating this one failure mode, following the exact
  pattern of the existing 16 (`placeholder_values`, `forbidden_content`, etc.).
- Regression tests: the new fixture resolves to `intake_invalid` via `INTAKE_REVIEWER_ROLE_INVALID`; the
  runtime guard accepts exactly the five recognized roles and rejects everything else (unrecognized
  string, wrong case, empty/whitespace, non-string, `null`, `undefined`); no other fixture regresses to
  carrying this finding.

Nothing else about 13J changed. `syntheticOnly: true` and `scope: 'synthetic_validation_only'` remain
literal types, unchanged. This is deliberate, not a second defect: it is the same repo-wide invariant
11X § 8 and 12B § 22 state explicitly — *"a field completed inside the repository would produce an
unapproved draft that reads like an approval"* — applied to the intake type itself. Widening those
literals so a "real" object could satisfy the type would not close a gap; it would create the exact
false signal this whole chain (10K → 11X → 12B → 13J) was built to prevent. A real owner decision is
captured through the operator channel and referenced by identifier, never encoded as data in this
repository — see § 5 for the decisions that remain to be captured that way.

## 2. Field-by-field audit

| Field | Source (this HEAD) | Actor authorized to change it | Current value | Requirement to change |
| --- | --- | --- | --- | --- |
| `ownerCompletionResubmissionReceived` | Not a code field anywhere; tracked in prose (11X § 22, 12B) | Owner, via the operator channel | Not received | An actual resubmission arriving outside this repository |
| `ownerCompletionResubmissionValid` | Same | Owner + technical reviewer | Not applicable (nothing received) | A received resubmission passing 13J's reused validation logic |
| `ownerDecisionsCaptured` / `ownerDecisionsValidSynthetic` | 13J, computed from `intake.decisions` | Nobody — pure function of whatever object is passed in | `false` for every non-fixture (real) case, since no real intake object exists | A caller supplying a real intake object, which does not exist |
| `capInputPolicyApproved` | 11X § 7 record C; literal `false` from 13B onward in code | Business owner (cap maxima); technical/privacy/data-source owner (sub-fields) | `TBD_BY_OWNER` / `not_authorized` | A filled, captured GATE-2-independent cap/input record (11X § 7) |
| `gate2Approved` | 11X § 5 record A; literal `false` from 13B onward in code | Technical owner **and** privacy owner, jointly | `TBD_BY_OWNER` / `not_started` | A filled, jointly-signed GATE-2 record (11X § 5), captured via the operator channel |
| `gate7Approved` | 11X § 6 record B; literal `false` from 13B onward in code | Operator owner, technical owner **and** privacy owner, jointly | `TBD_BY_OWNER` / `not_started` | A filled, jointly-signed GATE-7 record (11X § 6), which cannot precede a valid GATE-2 record |
| `controlledExecutionAttemptAuthorized` | 11W § 5 row; literal `false` everywhere in code | Business owner | `not_authorized` | Valid only once GATE-2, GATE-7 and cap/input policy are all approved (11X § 9) |
| `executionAuthorized` / `realDataExecutionAuthorized` | Literal `false` type members, 13B through 13J | Nobody through this chain — a separate authorization | `false` | Out of scope for any milestone in this chain; a distinct decision |
| `goNoGo` | `'GO' \| 'NO_GO'` at 13A/13B/13E/13F; narrows to the literal `'NO_GO'` from 13D onward | Nobody — type-forbidden past 13D | `NO_GO` | Cannot become `GO` without a breaking type change to 13D–13J |
| `fullJoinExecutionReady` / `importReady` / `runtimeReady` / `agent1Ready` | Doc-only flags, 11X § 17; absent from code entirely | Owner, plus separate import/runtime/Agent1 readiness processes | `false` | Each requires its own readiness process; none has begun |

Every field a real approval could theoretically flip is either type-forbidden downstream of 13B/13D, or —
at 13A only — a pure function of an in-memory parameter that, in this repository, is populated
exclusively by hardcoded synthetic fixtures. There is no ingestion point anywhere in this codebase that
turns a real, owner-authored document into one of these booleans, and this milestone does not add one —
adding one would itself be the anti-pattern § 1 describes.

## 3. GATE-2, GATE-7 and cap/input policy — reused definitions, current status

Reused verbatim from 11X §§ 5–7 (11X reused them from 10K §§ 6/11 and 11W § 5); not restated or
reinterpreted here.

**GATE-2 — temporary storage envelope.** Approver: technical owner **and** privacy owner, jointly; either
may reject alone. Required evidence: storage option selected (with the other options named
not-approved); numeric disk/memory ceilings; TTL; owner-only permissions; verified cleanup on completion
and failure. **Status: `not_started` / `not approved`.** No field in the formal GATE-2 record (11X § 5)
has ever been filled; all remain `TBD_BY_OWNER`.

**GATE-7 — operator runbook approval.** Approver: operator owner, technical owner **and** privacy owner,
jointly — two *distinct* roles for operator and reviewer. Required evidence: runbook section reproducible
by a different operator; preflight verifying every other gate; a genuine performed human rehearsal (11U's
scaffold rehearsal explicitly does not satisfy this). GATE-7 cannot be validly approved ahead of GATE-2.
**Status: `not_started` / `not approved`.** All fields in the formal GATE-7 record (11X § 6) remain
`TBD_BY_OWNER`.

**Cap/input policy.** Approver: business owner (binding decision); business owner + technical owner (per-
cap ceilings); data/source owner + privacy owner (family allow/deny). No numeric cap value exists
anywhere in this repository — every ceiling row in 11W § 5's owner decision matrix reads
`TBD_BY_OWNER (null)`, and 11X § 7 states explicitly that no field in the formal record may be filled by
a documentation edit. **Status: `not_authorized` / `not approved`.**

No named individual approver exists anywhere in this chain, by design (10K § 14, 11W § 5 note): roles
only, never identities, never signatures. The role catalogue (11W § 5) covers: technical owner, privacy
owner, business owner, data/source owner, operator owner, incident owner, privacy/legal reviewer,
security reviewer. 13J's `reviewerRole` union (`owner`, `legal_security_privacy`, `technical_owner`,
`commercial_operations`, plus the fixture-only `synthetic_reviewer`) is the code-level summary of this
same catalogue, and — after § 1's fix — is now the only place in this chain that checks a decision's
claimed role at runtime rather than only at the type level.

## 4. Approval record shape (reused, not reinvented)

13J's own `BrazilReceitaControlledExecutionAuthorizationIntakeDecision` shape already carries every
field § 7 of this milestone's brief requires, under different names, and is reused as-is rather than
duplicated: `decisionId` (decision type), `decisionValue` (decision), `reviewerRole` (approver role),
`decisionDate` (approved-at), `scope`, plus three explicit acknowledgements standing in for "limitations."
It has no `expiresAt`/`revocationCondition`/`evidenceRefs` fields — 13J's contract has never modeled
expiry or revocation, so those two of the ten required test scenarios in this milestone's brief do not
apply (the brief itself makes them conditional: "si el contrato lo contempla"). Adding them would be new
scope with no owner-decision it currently serves; it is not added here.

## 5. Owner completion resubmission — current state

**Not received.** Every docs-only artifact built specifically to eventually hold a real owner
resubmission — 11X §§ 5–7, 11Y, 11Z, 12A, 12B — still reads the literal placeholder `TBD_BY_OWNER` in
every owner-supplied field, at this exact HEAD (`02d286b`). 12A (owner completion intake review) and 12B
(owner completion resubmission packet) both concluded `NO_GO` because nothing arrived; nothing has arrived
since. No fixture, script, test file or fixture builder anywhere in the repository — including the one
added by § 1 — represents an actual human owner's real sign-off; every one is explicitly, self-declared
synthetic test data.

## 6. Final decision

**`NO — MISSING EXACTLY THESE OWNER DECISIONS.`**

| Blocker | Owner required | Exact decision | Conservative recommendation | Unblocks |
| --- | --- | --- | --- | --- |
| Owner completion resubmission | Owner (via the operator channel) | Submit a completed GATE-2, GATE-7 and cap/input policy record set, per the templates in 11X §§ 5–7 | Do not proceed until a resubmission is actually received | 13J intake decision `OWNER_COMPLETION_RESUBMISSION` |
| GATE-2 (temporary storage envelope) | Technical owner **and** privacy owner, jointly | Approve, reject or defer the storage option, ceilings, TTL and cleanup evidence in 11X § 5 | Recommend deferral until measured ceilings exist; do not approve on an estimate | 13J intake decision `GATE_2_ROUTE_DECISION` |
| GATE-7 (operator runbook) | Operator owner, technical owner **and** privacy owner, jointly | Approve, reject or defer the runbook, naming two distinct operator/reviewer roles and citing a real performed rehearsal | Cannot be approved before GATE-2; recommend deferral until then | 13J intake decision `GATE_7_PRIVACY_SECURITY_DECISION` |
| Cap/input policy | Business owner (binding decision); technical/data-source/privacy owner (sub-fields) | Set or explicitly decline numeric caps, input/output root classes, family allow/deny and temp-storage option per 11X § 7 | Recommend leaving caps `null` (blocked) rather than setting an unmeasured ceiling | 13J intake decision `CAP_INPUT_POLICY_APPROVAL` |
| Controlled execution attempt authorization | Business owner | Authorize or refuse a bounded attempt — valid only once the three decisions above are all `accepted` | Recommend `not_authorized` until the dependency is satisfied | 13J intake decision `CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION`, and by extension `FULL_JOIN_EXECUTION_READY` |

No other decision (full join execution, import, runtime, Agent 1 authorization) is reachable before these
five; 13J's own consistency rules (`INTAKE_INCONSISTENT_*`) block any attempt to accept a downstream
decision while an upstream one is missing, rejected or deferred. This milestone does not invent, infer or
default any of the five to `approved`.

## 7. Flags after 14A

```text
OPS_BR_13J_CONTROLLED_EXECUTION_AUTHORIZATION_INTAKE_VALIDATOR_AUTHORIZED = true (unchanged)
OPS_BR_13J_CONTROLLED_EXECUTION_AUTHORIZATION_INTAKE_VALIDATOR_OFFICIAL = true (unchanged)
OPS_BR_13A..13I_OFFICIAL = true (unchanged)

OPS_BR_OWNER_COMPLETION_RESUBMISSION_RECEIVED = false
OPS_BR_OWNER_COMPLETION_RESUBMISSION_VALID = false
OPS_BR_OWNER_DECISIONS_CAPTURED = false
OPS_BR_OWNER_DECISIONS_VALID = false
OPS_BR_CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZED = false
OPS_BR_CAP_INPUT_POLICY_APPROVED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_GATE7_APPROVED = false

FULL_JOIN_EXECUTION_READY = false
IMPORT_READY = false
RUNTIME_READY = false
AGENT1_READY = false
OPS_BR_READY_FOR_IMPORT = false
OPS_BR_READY_FOR_RUNTIME = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

None of these flags moved. 14A's only code change is the § 1 runtime-guard fix inside 13J, which affects
none of the flags above — it only makes 13J correctly reject an intake that names an invalid approver,
which it should already have been rejecting.

## 8. Safety confirmation

```text
NO_REAL_DATA_ACCESSED
NO_FULL_JOIN_EXECUTED
NO_IMPORT_EXECUTED
NO_SUPABASE_WRITE
NO_RUNTIME_CHANGE
NO_AGENT1_CHANGE
NO_PROVIDER_CALL
NO_PII_PRINTED
NO_SECRET_PRINTED
```

This milestone touched no Supabase project, no migration, no runtime path, no Agent 1 path, no provider,
and no UI. It read no real manifest, opened no real CSV or ZIP, processed no real row. Its only code
change is the reviewer-role runtime-guard fix to 13J described in § 1, confined to
`br-receita-cnpj-controlled-execution-authorization-intake-validator.ts` and its test file.

## 9. Next step

```text
OWNER ACTION REQUIRED: the five decisions in § 6 — owner completion resubmission, GATE-2, GATE-7,
cap/input policy, and controlled execution attempt authorization — must be captured through the operator
channel (never as a repository edit) before BR-SOURCE-14B can run.
```

Once those decisions are captured and validated through 13J (reused, unchanged in its validation logic),
the immediate successor is:

```text
BR-SOURCE-14B — FULL JOIN CONTROLLED EXECUTION AND CANARY IMPORT
```

No other successor is recommended. No packet-generation, intake-normalization, authorization-translation,
handoff-verification, synthetic-only-rehearsal or docs-only-reconciliation milestone is needed: 13J
already validates a real resubmission's structure correctly (after § 1's fix), and every remaining gap is
a human decision, not a missing tool.
