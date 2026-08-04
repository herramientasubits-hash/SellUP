# BR-SOURCE-13A — Owner decision validator (technical contract)

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-13A — Owner decision validator and preflight contract (code + tests + this contract)
**Status:** `proposed_for_review` — **not** a GATE-2 approval, **not** a GATE-7 approval, **not** an approval of
cap/input policy, **not** an authorization for a controlled execution attempt, execution, real-data access,
manifest reading, import, Supabase writes, runtime or Agent 1, and **not** an approval of any gate
**Predecessor:** BR-SOURCE-12B-LAND — owner completion resubmission packet (docs-only, `official`)
**Authorization received:** `BR-SOURCE-13A — OWNER DECISION VALIDATOR` — authorizes only pure code, tests,
synthetic fixtures and this document; never real data, never gate approval, never execution
**Last reviewed:** 2026-08-04

**Related documents:**
- Owner completion resubmission packet (BR-SOURCE-12B) — [`br-receita-cnpj-12b-owner-completion-resubmission-packet.md`](./br-receita-cnpj-12b-owner-completion-resubmission-packet.md)
- Owner completion intake review (BR-SOURCE-12A) — [`br-receita-cnpj-12a-owner-completion-intake-review.md`](./br-receita-cnpj-12a-owner-completion-intake-review.md)
- Owner decision completion packet (BR-SOURCE-11Z) — [`br-receita-cnpj-11z-owner-decision-completion-packet.md`](./br-receita-cnpj-11z-owner-decision-completion-packet.md)
- Formal owner decision records (BR-SOURCE-11X) — [`br-receita-cnpj-11x-formal-owner-decision-records-gate2-gate7-cap-input.md`](./br-receita-cnpj-11x-formal-owner-decision-records-gate2-gate7-cap-input.md)
- Full join approval gates checklist (GATE-2 § 6, GATE-7 § 11) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)

---

## 1. Purpose

12B defined what owners must resubmit. 12A had already run the intake gate and found the inbox empty. Both
findings share a weakness: the check was performed by reading a document by hand. This milestone replaces that
hand-check with a pure function, so that when an owner artifact eventually arrives, "is it complete,
consistent and safe?" is answered mechanically and identically every time.

It is the first **executable** link in the 11W…12B chain, and it deliberately does not extend that chain with
another NO-GO narrative. What it adds is a contract.

**Implementation**

| Artifact | Path |
|----------|------|
| Validator (pure module) | [`br-receita-cnpj-owner-decision-validator.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-owner-decision-validator.ts) |
| Tests | [`br-receita-cnpj-owner-decision-validator.test.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-owner-decision-validator.test.ts) |

Run the tests with:

```bash
node --import tsx --test src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-owner-decision-validator.test.ts
```

---

## 2. Input

```ts
validateBrazilReceitaOwnerDecisionArtifact(artifact: OwnerDecisionArtifact | null | undefined)
```

`OwnerDecisionArtifact` carries four independent sections, mirroring 12B § 6–§ 9:

| Section | Decision field | Required owner-supplied string fields | Boolean |
|---------|----------------|----------------------------------------|---------|
| `gate2` | `decisionValue` | `ownerRole`, `ownerReference`, `decisionDate`, `expirationOrReviewDate`, `evidencePacketReference`, `legalPrivacySecurityReference`, `operatorReviewerRequirement`, `incidentEscalationReference` | `stopConditionsAccepted` |
| `gate7` | `decisionValue` | `ownerRole`, `ownerReference`, `decisionDate`, `expirationOrReviewDate`, `operatorRole`, `reviewerRole`, `runbookReference`, `evidenceCaptureProcedure`, `sanitizerProcedure`, `cleanupProcedure`, `incidentPath`, `escalationPath`, `dryRunRehearsalReference` | `stopConditionsAccepted` |
| `capInputPolicy` | `decisionValue` | `ownerRole`, `ownerReference`, `decisionDate`, `expirationOrReviewDate`, `capMaximaDecision`, `inputRootDecision`, `outputRootDecision`, `tempStorageDecision`, `evidenceBucketDecision`, `familyAllowDenyDecision`, `manifestControlFilePolicyDecision`, `exactPercentagePolicyDecision`, `fullDatasetDenominatorPolicyDecision`, `coverageLanguageDecision`, `legalPrivacySecurityReference` | `stopConditionsAccepted` |
| `controlledExecutionAttempt` | `authorizationDecision` | `ownerRole`, `ownerReference`, `decisionDate`, `expirationOrReviewDate`, `scopeBoundary` | `stopConditionsAccepted` |

The required-field lists are exported as `BRAZIL_RECEITA_OWNER_DECISION_REQUIRED_STRING_FIELDS`, so callers
and tests never restate them.

A decision value is one of `approved`, `rejected`, `deferred`. Anything else — including the packets'
`TBD_BY_OWNER` placeholder — is refused.

The input is **data, not instruction**. Nothing inside an artifact can widen what the validator permits.

---

## 3. Output

```ts
{
  status: "valid" | "invalid";
  goNoGo: "GO" | "NO_GO";
  canProceedToControlledExecutionPreflight: boolean;
  gate2Approved: boolean;
  gate7Approved: boolean;
  capInputPolicyApproved: boolean;
  controlledExecutionAttemptAuthorized: boolean;
  findings: Array<{ code: string; severity: "blocking" | "warning" | "info"; message: string; field?: string }>;
}
```

- `status` / `goNoGo` are global: one `blocking` finding anywhere makes the whole artifact `invalid` / `NO_GO`.
- The four `*Approved` flags are **section-scoped**: a section is approved only when its own decision reads
  `approved` **and** its own fields are all complete and safe. An approval carried on an incomplete or unsafe
  section is not an approval.
- `canProceedToControlledExecutionPreflight` is true only when all four flags are true **and** the artifact has
  zero blocking findings.
- Every result — including a `GO` — carries the `info` finding
  `OWNER_VALIDATION_IS_NOT_EXECUTION_AUTHORIZATION`.

### Finding codes

| Code | Severity | Meaning |
|------|----------|---------|
| `OWNER_ARTIFACT_MISSING` | blocking | No artifact was provided at all |
| `OWNER_DECISION_MISSING` | blocking | A section or its decision value is absent |
| `OWNER_DECISION_REJECTED` | blocking | Owner rejected the section |
| `OWNER_DECISION_DEFERRED` | blocking | Owner deferred; a deferral is not an approval |
| `OWNER_DECISION_VALUE_UNRECOGNIZED` | blocking | Decision is not one of the three recognized values |
| `OWNER_REQUIRED_FIELD_MISSING` | blocking | A required field is absent |
| `OWNER_FIELD_PLACEHOLDER` | blocking | Field is empty, whitespace-only, or still reads `TBD_BY_OWNER` |
| `OWNER_FIELD_FORBIDDEN_CONTENT` | blocking | Field carries a real path, host, address or credential |
| `OWNER_FIELD_INVALID_TYPE` | blocking | Field is present but of the wrong type |
| `OWNER_STOP_CONDITIONS_NOT_ACCEPTED` | blocking | `stopConditionsAccepted` is present but not `true` |
| `CAP_MAXIMA_REAL_VALUE_NOT_ALLOWED_IN_VALIDATOR_FIXTURE` | blocking | `capMaximaDecision` carries a digit |
| `GATE7_CANNOT_PRECEDE_GATE2` | blocking | GATE-7 approved while GATE-2 is not |
| `CONTROLLED_EXECUTION_AUTH_WITHOUT_REQUIRED_GATES` | blocking | Controlled execution authorized without all three prerequisites |
| `OWNER_VALIDATION_IS_NOT_EXECUTION_AUTHORIZATION` | info | Always present; a GO permits a document preflight only |

---

## 4. Fail-closed rules

1. **Absent input refuses.** `null` / `undefined` → `invalid` / `NO_GO`, all flags false.
2. **Placeholders refuse.** Empty string, whitespace-only, or exactly `TBD_BY_OWNER` blocks, per field.
3. **Only `approved` approves.** `rejected`, `deferred`, absent, and unrecognized values all block.
4. **Stop conditions must be explicit.** Absent blocks; `false` blocks. Only `true` passes.
5. **GATE-7 cannot precede GATE-2.** GATE-7 approved while GATE-2 is not is a contradiction, not a fast path.
6. **Controlled execution cannot precede its gates.** Authorization without GATE-2, GATE-7 **and** cap/input
   policy all approved is refused.
7. **Cap maxima carry no numbers.** Caps are unapproved at 13A, so any digit in `capMaximaDecision` is refused.
   The field may state a *policy*, never a *value*.
8. **Unsafe content refuses.** Absolute paths (`/Users/`), local download directories, real manifest and
   dataset-subtree names (`manifest.headerless.json`, `sellup-source-data`, `raw-zips`, `extracted`,
   `manifest-input`), personal-profile hosts, address-shaped values (`@`), connection strings
   (`postgres://`), privileged role and env names (`service_role`, `SUPABASE_SERVICE`), private-key blocks,
   and credential prefixes (`eyJ`, `sk-`, `xoxb-`) all block.
   Matching is substring-based and never anchored on digits, so a `decisionDate` such as `2026-08-04`
   survives. Case folding is per pattern: `sk-` and `xoxb-` match case-sensitively, since folding them would
   reject ordinary prose (`RISK-BASED` contains `SK-`).
9. **Purity.** No `fs`, no `path`, no network, no env, no `process`, no imports at all. The input is never
   mutated; the same input always produces the same result. A static test asserts the module has zero imports.

---

## 5. What this validator validates

- Presence, completeness and type of every owner-supplied field in the four sections.
- Whether each field was actually completed rather than left as a placeholder.
- Whether each decision is a recognized value, and which of the three it is.
- Ordering consistency between GATE-2, GATE-7 and the controlled execution attempt.
- Whether the artifact smuggles a real cap value, path, host, address or credential.
- Whether the artifact, taken as a whole, could be handed to the next **document** preflight.

## 6. What this validator does NOT validate

- **Truth.** It cannot tell whether an owner reference names a real person, whether a runbook exists, or
  whether a legal review actually happened. It checks form, never substance.
- **Authority.** It does not verify that whoever filled the artifact was entitled to decide.
- **Cap adequacy.** Since numeric caps are refused outright, it says nothing about whether a cap is safe.
- **Fields it does not declare.** Unknown extra keys are ignored, not scanned. The content denylist runs over
  the declared fields only, so an artifact must not be treated as sanitized merely because it validated.
- **Freshness.** `decisionDate` and `expirationOrReviewDate` are checked for presence and safety, not parsed,
  compared, or evaluated against today. An expired decision can still validate.
- **Anything about real data.** It never reads a manifest, CSV, ZIP, row, or dataset of any kind.

---

## 7. Relationship to BR-SOURCE-12B

12B is the requirement; 13A is the checker.

| | 12B | 13A |
|-|-----|-----|
| Form | Document | Pure module + tests + this contract |
| Answers | *What must owners resubmit?* | *Would a given resubmission pass?* |
| Owner fields | 51, all `TBD_BY_OWNER` | Zero — no real field is completed here |
| Effect on gates | None | None |

13A does **not** consume 12B's document, and 12B's `TBD_BY_OWNER` state is unchanged by this milestone. The
one artifact in the test suite that reaches `GO` is entirely synthetic: opaque labels such as
`OWNER_REF_SYNTHETIC_GATE2` and `CAP_POLICY_SYNTHETIC_APPROVED_WITHOUT_NUMERIC_VALUES`, with digits appearing
only in date fields. No real owner, cap, path, root, or bucket is named anywhere in this milestone.

A synthetic `GO` in the test suite is a statement about the **validator**, not about Brazil.

---

## 8. Explicitly not authorized

```text
This milestone does not complete owner decisions.
This milestone does not accept owner intake.
This milestone does not approve GATE-2.
This milestone does not approve GATE-7.
This milestone does not approve cap/input policy.
This milestone does not authorize caps, input roots, output roots or temp storage.
This milestone does not authorize a controlled execution attempt.
This milestone does not authorize limited broader local execution.
This milestone does not authorize execution.
This milestone does not authorize real-data file access.
This milestone does not authorize manifest, CSV or ZIP reading.
This milestone does not authorize row reads.
This milestone does not authorize exact coverage percentages or a full-dataset denominator.
This milestone does not authorize import.
This milestone does not authorize Supabase writes or migrations.
This milestone does not authorize runtime or Agent 1.
This milestone does not authorize provider calls.
This milestone does not approve any gate.
Brazil remains blocked.
```

---

## 9. Flags

```text
OPS_BR_13A_OWNER_DECISION_VALIDATOR_AUTHORIZED = true
OPS_BR_13A_OWNER_DECISION_VALIDATOR_PR_READY = false until PR
OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = false until merge

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
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 10. Next step

None of the gates move here. The next milestone that could change a gate status still requires an
owner-completed artifact to exist. When one does, this validator is what should read it first — and its verdict
remains a document verdict, never an execution authorization.
