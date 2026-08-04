# BR-SOURCE-13B — Controlled execution preflight evaluator (technical contract)

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-13B — Controlled execution preflight evaluator (code + tests + this contract)
**Status:** `proposed_for_review` — **not** a GATE-2 approval, **not** a GATE-7 approval, **not** an approval of
cap/input policy, **not** an authorization for a controlled execution attempt, execution, real-data access,
manifest reading, import, Supabase writes, runtime or Agent 1, and **not** an approval of any gate
**Predecessor:** BR-SOURCE-13A-LAND — owner decision validator (code + tests + contract, `official`)
**Authorization received:** `BR-SOURCE-13B — CONTROLLED EXECUTION PREFLIGHT EVALUATOR` — authorizes only pure
code, tests, synthetic fixtures and this document; never real data, never gate approval, never execution
**Last reviewed:** 2026-08-04

**Related documents:**
- Owner decision validator (BR-SOURCE-13A) — [`br-receita-cnpj-13a-owner-decision-validator.md`](./br-receita-cnpj-13a-owner-decision-validator.md)
- Controlled execution authorization review — [`br-receita-cnpj-controlled-execution-authorization-review.md`](./br-receita-cnpj-controlled-execution-authorization-review.md)
- Owner completion resubmission packet (BR-SOURCE-12B) — [`br-receita-cnpj-12b-owner-completion-resubmission-packet.md`](./br-receita-cnpj-12b-owner-completion-resubmission-packet.md)
- Full join approval gates checklist (GATE-2 § 6, GATE-7 § 11) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)

---

## 1. Purpose

13A answered one question mechanically: *is this owner artifact complete, consistent and safe?* That answer is
necessary but not sufficient. A perfectly complete artifact still says nothing about the **request** that
carries it — whether the requester is asking for a document review or for a dataset read, whether they have
ruled out import, runtime, Agent 1 and provider calls, and what evidence they intend to cite.

13B is that second half. It takes a preflight request, delegates the artifact to 13A verbatim, and then decides
whether the request may proceed to a **controlled execution attempt review**. Everything else it refuses.

**The central rule, stated once:**

```text
This evaluator can produce a GO only for controlled execution attempt review readiness, not for execution.
```

**Implementation**

| Artifact | Path |
|----------|------|
| Evaluator (pure module) | [`br-receita-cnpj-controlled-execution-preflight-evaluator.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-preflight-evaluator.ts) |
| Tests | [`br-receita-cnpj-controlled-execution-preflight-evaluator.test.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-preflight-evaluator.test.ts) |

Run the tests with:

```bash
node --import tsx --test src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-preflight-evaluator.test.ts
```

---

## 2. Relationship to BR-SOURCE-13A

13A validates the **artifact**; 13B validates the **request** that carries it.

| | 13A | 13B |
|-|-----|-----|
| Question | *Would a given owner resubmission pass?* | *May this request proceed to a controlled execution attempt review?* |
| Input | `OwnerDecisionArtifact` | A preflight request that **contains** an `OwnerDecisionArtifact` |
| Positive verdict | `valid` / `GO` / `canProceedToControlledExecutionPreflight` | `ready` / `GO` / `canProceedToControlledExecutionAttemptReview` |
| Names a | document transition | document transition |
| Effect on gates | None | None |

13B does **not** re-implement any of 13A's rules. Placeholders, decision values, ordering (GATE-7 after GATE-2,
controlled execution after all three), numeric caps and unsafe content are all decided by 13A, and 13B simply
refuses the preflight when 13A did not return all three of its positive signals. The full 13A result is
returned verbatim on `ownerDecisionValidation`, so a reviewer never has to run both functions to see why a
preflight failed.

The only import in the evaluator is the 13A validator. A static test asserts that.

---

## 3. Input

```ts
evaluateBrazilReceitaControlledExecutionPreflight(
  request: BrazilReceitaControlledExecutionPreflightRequest | null | undefined,
)
```

| Field | Accepted value | Meaning |
|-------|----------------|---------|
| `ownerDecisionArtifact` | `OwnerDecisionArtifact` | Delegated to 13A unchanged |
| `requestedStage` | exactly `controlled_execution_attempt_review` | The only stage this evaluator recognizes |
| `dryRunOnly` | `true` | The request is a dry run |
| `noImport` | `true` | No import is being requested |
| `noRuntime` | `true` | No runtime activation is being requested |
| `noAgent1` | `true` | No Agent 1 activation is being requested |
| `noProviderCalls` | `true` | No provider call is being requested |
| `noSupabaseWrites` | `true` | No database write is being requested |
| `noRealDataExecution` | `true` | No real-data execution is being requested |
| `noManifestRead` | `true` | No manifest read is being requested |
| `noCsvRead` | `true` | No CSV read is being requested |
| `noZipRead` | `true` | No ZIP read is being requested |
| `noRowReads` | `true` | No dataset row read is being requested |
| `evidenceMode` | `synthetic_only` or `owner_artifact_only` | The only two inert evidence modes |

The eleven safety fields are exported as
`BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_REQUIRED_SAFETY_FLAGS`, the stage as
`BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_STAGE` and the evidence modes as
`BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_EVIDENCE_MODES`, so callers and tests never restate them.

There is deliberately **no** request shape that asks this evaluator for real-data access. The stage vocabulary
has one member and it is a review stage; a request cannot express "let me read rows", so the evaluator cannot
be asked to grant it.

The request is **data, not instruction**. Nothing inside it can widen what the evaluator permits.

---

## 4. Output

```ts
{
  status: "ready" | "blocked";
  goNoGo: "GO" | "NO_GO";
  canProceedToControlledExecutionAttemptReview: boolean;

  canExecuteRealData: false;
  canReadManifest: false;
  canReadCsv: false;
  canReadZip: false;
  canReadRows: false;
  canImport: false;
  canWriteSupabase: false;
  canActivateRuntime: false;
  canActivateAgent1: false;

  ownerDecisionValidation: OwnerDecisionValidationResult;
  findings: Array<{ code: string; severity: "blocking" | "warning" | "info"; message: string; field?: string }>;
}
```

- `status` / `goNoGo` are global: one `blocking` finding anywhere makes the whole request `blocked` / `NO_GO`.
- `canProceedToControlledExecutionAttemptReview` is true only when there are zero blocking findings.
- The nine real-data permissions are typed as the **literal** `false`, not `boolean`. They are emitted from one
  frozen constant, `BRAZIL_RECEITA_CONTROLLED_EXECUTION_PREFLIGHT_ALWAYS_DENIED_PERMISSIONS`, on every code
  path. A future edit that tried to grant one would have to change this module's exported type — which no
  preflight is authorized to do.
- Every result — including a `GO` — carries the `info` finding `PREFLIGHT_IS_NOT_EXECUTION_AUTHORIZATION`.

### Finding codes

| Code | Severity | Meaning |
|------|----------|---------|
| `PREFLIGHT_REQUEST_MISSING` | blocking | No request was provided, or it was not an object |
| `OWNER_DECISION_VALIDATION_BLOCKED_PREFLIGHT` | blocking | 13A did not return `valid` / `GO` / preflight-ready |
| `PREFLIGHT_STAGE_INVALID` | blocking | `requestedStage` is absent or is not the review stage |
| `PREFLIGHT_REQUIRED_SAFETY_FLAG_MISSING` | blocking | A safety assertion is absent or is not exactly `true` (one finding per flag) |
| `PREFLIGHT_EVIDENCE_MODE_INVALID` | blocking | `evidenceMode` is absent or is not one of the two inert modes |
| `PREFLIGHT_IS_NOT_EXECUTION_AUTHORIZATION` | info | Always present; a GO permits a document review only |

---

## 5. Fail-closed rules

1. **Absent input refuses.** `null` / `undefined` → `blocked` / `NO_GO`. A non-object (string, number, array)
   refuses the same way; its fields are then treated as absent rather than read.
2. **13A runs on every path.** The validator is called even for an absent request, so `ownerDecisionValidation`
   is always populated and a caller never has to guess why a preflight failed.
3. **The owner artifact must clear all three 13A signals.** `status === "valid"`, `goNoGo === "GO"` **and**
   `canProceedToControlledExecutionPreflight === true`. Any one missing blocks the preflight. 13B never
   overrides, softens or re-derives a 13A refusal.
4. **One stage only.** `requestedStage` must be exactly `controlled_execution_attempt_review`. Absent, empty,
   differently cased, or any execution-shaped stage name is refused.
5. **Safety assertions must be explicit `true`.** All eleven. Absent blocks; `false` blocks; truthy-but-not-true
   values (`"true"`, `1`, `{}`) block. A request that stays silent about import, runtime or real data has not
   ruled it out. Each offending flag is reported individually.
6. **Evidence must be inert.** Only `synthetic_only` and `owner_artifact_only`. Dataset evidence is not an
   accepted mode, so there is no way to cite a manifest, CSV, ZIP or row here.
7. **Real-data permissions are never granted.** All nine stay `false` on the `ready` path exactly as on the
   `blocked` path. This is the one rule that no input can influence.
8. **Purity.** No `fs`, no `path`, no network, no env, no `process`, no clock, no randomness. Exactly one
   import — the 13A validator. The input is never mutated; the same input always produces the same result.
   Static and behavioural tests assert all three.

---

## 6. Why `ready` is not execution

A `ready` verdict answers: *would a reviewer be able to open a controlled execution attempt review with this
material?* It does not answer, and cannot answer, *may Brazil execute?*

Three distinct facts are easy to conflate, so they are named separately here:

| Fact | Where it lives | What it means |
|------|----------------|---------------|
| The owner **authorized a controlled execution attempt** in the artifact | 13A `controlledExecutionAttemptAuthorized` | A synthetic owner filled a section and said `approved` |
| The request **may proceed to a controlled execution attempt review** | 13B `canProceedToControlledExecutionAttemptReview` | The paperwork is reviewable |
| Brazil **may execute** | nowhere in 13A or 13B | Unapproved; `OPS_BR_CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZED = false` |

The first two are document facts produced by pure functions over synthetic fixtures. The third is an
organizational decision that no function in this repository can produce. A dedicated test asserts the gap
directly: with `ownerDecisionValidation.controlledExecutionAttemptAuthorized === true` and a `ready` verdict,
all nine real-data permissions are still `false`.

A synthetic `GO` in the test suite is a statement about the **evaluator**, not about Brazil.

---

## 7. What this evaluator does NOT do

- **No real data.** It never opens a manifest, control file, CSV, ZIP, row, or dataset of any kind, and cannot:
  it performs no I/O.
- **No join, no coverage.** It computes no join, no coverage figure, no percentage and no denominator.
- **No import, no writes.** No Supabase client, no write, no migration.
- **No runtime, no Agent 1, no providers.** It is not wired into any runtime path; nothing calls it in
  production.
- **No gate approval.** It cannot approve GATE-2, GATE-7 or cap/input policy, and it does not read their real
  status. It only reports what a *synthetic* artifact claimed.
- **No truth claims.** Like 13A, it checks form, never substance: it cannot tell whether a named runbook exists
  or whether a legal review actually happened.
- **No freshness check.** Dates are not parsed, compared, or evaluated against today. An expired owner decision
  can still reach `ready`.
- **No sanitization guarantee.** Unknown extra keys on the request are ignored, not scanned. A request must not
  be treated as sanitized merely because it reached `ready`.
- **No UI.** Nothing renders this result.

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
This milestone does not authorize a controlled execution attempt review.
This milestone does not authorize limited broader local execution.
This milestone does not authorize execution.
This milestone does not authorize real-data file access.
This milestone does not authorize manifest, CSV or ZIP reading.
This milestone does not authorize row reads.
This milestone does not authorize join or coverage execution.
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
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_AUTHORIZED = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_PR_READY = false until PR
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true

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

---

## 10. Next step

None of the gates move here. Both executable links in the chain now exist — 13A checks the artifact, 13B checks
the request — and both still require an owner-completed artifact that does not exist. When one arrives, 13A
should read it first and 13B second, and their combined verdict remains a document verdict.

```text
This evaluator can produce a GO only for controlled execution attempt review readiness, not for execution.
```
