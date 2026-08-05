# BR Receita CNPJ — controlled execution authorization intake validator (BR-SOURCE-13J)

## Purpose

BR-SOURCE-13I hands a reader nine open decisions and asks who should take each one. It accepts no
decision as input, so it cannot say what happens once someone claims to have answered.

BR-SOURCE-13J is the validator for that answer: a completed **intake**. An intake is the next artefact in
this story — a document naming, for each of the nine pending decisions, who decided it, on what date,
under what scope, and having acknowledged what deciding it does and does not grant. It is filled in by a
human in the real chain; here it is always a SYNTHETIC stand-in for one.

It is pure, deterministic, synthetic-only and fail-closed. It changes nothing, and — this is the module's
whole point — **no amount of intake completeness changes that**.

## Central rule

```
intake_complete          ≠  execution_authorized
synthetic_intake_valid    ≠  gate approval
```

> Authorization intake validation is not execution authorization.

A completed intake is, if anything, more dangerous to misread than 13I's empty decision list, because a
completed intake *looks like* an answer. `complete_synthetic_accept` — the one fixture built to look as
finished as an intake can look — names nine reviewers, nine roles, nine dates, and nine acceptances, with
every acknowledgement stated. Every property of that document describes an intake that was **filled in**,
and none of them describes an authorization that was **granted**. It validates to the identical `NO_GO`,
`blocked`, all-execution-and-gate-fields-false result as the worst-case fixture in the catalogue. There is
no code path in this module that reads completeness as permission.

## Position in the chain

```
13A owner decision validator
  → 13B controlled execution preflight evaluator
    → 13C synthetic owner artifact harness / fixtures
      → 13D controlled execution request packet generator
        → 13E controlled execution review decision validator
          → 13F controlled execution attempt plan generator
            → 13G controlled execution attempt runner scaffold
              → 13H controlled execution readiness orchestrator
                → 13I controlled execution authorization handoff packet
                  → 13J controlled execution authorization intake validator
```

| Component | What it contributes to 13J |
| --- | --- |
| **13C** | Supplies the 13C fixture name (`synthetic-ready`, etc.) that seeds the chain. |
| **13E** | Supplies the review decision type (`approve` / `reject` / `defer`) 13J passes through. |
| **13I** | Supplies the handoff packet 13J always builds and embeds, verbatim, as `handoffPacket`. |

13J re-implements none of 13A–13I's rules. It adds exactly one thing the chain did not have yet: a check
over a **completed intake document**, with its own seventeen synthetic fixtures and its own findings.

> **Update (BR-SOURCE-14A):** a runtime gap was closed without changing any of the above. `reviewerRole`
> was declared as a closed five-member union but never checked at runtime — an intake decision built from
> anything other than this module's own literals could carry any string there. 14A added the
> `INTAKE_REVIEWER_ROLE_INVALID` finding, the `invalid_reviewer_role` fixture (#17 below), and the
> `isBrazilReceitaIntakeReviewerRole` runtime guard. See
> [`br-receita-cnpj-14a-owner-authorization-closure-decision-record.md`](./br-receita-cnpj-14a-owner-authorization-closure-decision-record.md).

## Usage

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake complete_synthetic_accept --format json
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake complete_synthetic_accept --format json --pretty
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake complete_synthetic_accept --format markdown
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake missing_gate_2 --format json
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts --fixture synthetic-ready --decision approve --intake inconsistent_import_without_full_join --format json
```

Output goes to stdout only. No file is ever created.

### Accepted arguments

| Flag | Values | Required |
| --- | --- | --- |
| `--fixture` | a BR-SOURCE-13C synthetic fixture name | yes |
| `--decision` | `approve` \| `reject` \| `defer` | yes |
| `--intake` | one of the seventeen BR-SOURCE-13J intake fixture names (below) | yes |
| `--format` | `json` \| `markdown` | yes |
| `--pretty` | none (indents JSON; ignored for Markdown) | no |

### Refused arguments

Every one of the following is a fail-closed usage error, in both `--flag value` and `--flag=value` form,
wherever it appears in the argument vector:

`--manifest`, `--input`, `--input-dir`, `--output`, `--output-dir`, `--path`, `--dir`, `--file`, `--csv`,
`--zip`, `--real-data`, `--execute`, `--run`, `--apply`, `--force`, `--import`, `--activate`, `--approve`,
`--authorize`, `--sign`, `--gate2`, `--gate7`, `--supabase`, `--production`, `--runtime`, `--agent1`.

Unknown flags and positional arguments are refused too, including positionals shaped like a location.

`--approve` and `--sign` deserve their own note. A completed intake is the artefact most likely to be
mistaken for a signed authorization — it names reviewers, roles, dates and acceptances. There is no switch
here that turns a validated document into a granted authorization, for the same reason `--execute` is
refused: this tool has nothing to run and nothing to sign.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | A result was produced. Every result is `NO_GO`; a refusal is the artefact, not an error. |
| `1` | The arguments were unusable. Nothing was produced, and the reason code is on stderr. |

## The seventeen intake fixtures

| # | `intakeFixture` | What it isolates |
| --- | --- | --- |
| 1 | `complete_synthetic_accept` | All nine decisions accepted, every acknowledgement stated. The only fixture reaching `intake_complete_synthetic_only` — and still `NO_GO`. |
| 2 | `missing_owner_completion` | `OWNER_COMPLETION_RESUBMISSION` never arrived. |
| 3 | `missing_gate_2` | `GATE_2_ROUTE_DECISION` never arrived. |
| 4 | `missing_gate_7` | `GATE_7_PRIVACY_SECURITY_DECISION` never arrived. |
| 5 | `missing_cap_input` | `CAP_INPUT_POLICY_APPROVAL` never arrived. |
| 6 | `missing_controlled_execution` | `CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION` never arrived. |
| 7 | `missing_full_join` | `FULL_JOIN_EXECUTION_AUTHORIZATION` never arrived. |
| 8 | `missing_import` | `IMPORT_AUTHORIZATION` never arrived. |
| 9 | `missing_runtime` | `RUNTIME_AUTHORIZATION` never arrived. |
| 10 | `missing_agent1` | `AGENT1_AUTHORIZATION` never arrived. |
| 11 | `rejected_gate_2` | `GATE_2_ROUTE_DECISION` was explicitly rejected. |
| 12 | `deferred_gate_7` | `GATE_7_PRIVACY_SECURITY_DECISION` was explicitly deferred. |
| 13 | `inconsistent_import_without_full_join` | `IMPORT_AUTHORIZATION` accepted while `FULL_JOIN_EXECUTION_AUTHORIZATION` never arrived. |
| 14 | `inconsistent_agent1_without_runtime` | `AGENT1_AUTHORIZATION` accepted while `RUNTIME_AUTHORIZATION` never arrived. |
| 15 | `placeholder_values` | A field still holds the `TBD_BY_OWNER` placeholder. |
| 16 | `forbidden_content` | A field carries an absolute local path — unsafe content, refused rather than stored. |
| 17 | `invalid_reviewer_role` | A `reviewerRole` outside the five recognized roles — added by BR-SOURCE-14A after this check was found missing at runtime. |

Fixtures 2–10 use a **dependents-aware cascade**: when a decision is omitted, every decision structurally
downstream of it (per the four consistency rules below) is omitted too, so a `missing_*` fixture reports
**only** a missing decision and never an incidental inconsistency finding from a downstream decision left
nonsensically "accepted". `rejected_gate_2` and `deferred_gate_7` apply the same cascade to
`CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION`, for the identical reason. The two `inconsistent_*` fixtures
are deliberately built *without* the cascade — that is the one thing they exist to test.

## The nine required decisions and the four consistency rules

The same nine decision ids BR-SOURCE-13I lists, re-exported verbatim so the two catalogues cannot drift:
`OWNER_COMPLETION_RESUBMISSION`, `GATE_2_ROUTE_DECISION`, `GATE_7_PRIVACY_SECURITY_DECISION`,
`CAP_INPUT_POLICY_APPROVAL`, `CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION`,
`FULL_JOIN_EXECUTION_AUTHORIZATION`, `IMPORT_AUTHORIZATION`, `RUNTIME_AUTHORIZATION`,
`AGENT1_AUTHORIZATION`.

An intake decision carries one of four values: `accepted`, `rejected`, `deferred`, `missing`. A decision
absent from the intake's `decisions` array is treated identically to one present with the value
`missing` — a reviewer who never filled a field has stated nothing different from one who wrote "missing"
in it.

Four cross-decision consistency rules catch the one failure this whole 13A–13J chain exists to prevent —
one approval read as implying the next:

```
IMPORT_AUTHORIZATION accepted, FULL_JOIN_EXECUTION_AUTHORIZATION not accepted
  → INTAKE_INCONSISTENT_IMPORT_WITHOUT_FULL_JOIN

RUNTIME_AUTHORIZATION accepted, IMPORT_AUTHORIZATION not accepted
  → INTAKE_INCONSISTENT_RUNTIME_WITHOUT_IMPORT

AGENT1_AUTHORIZATION accepted, RUNTIME_AUTHORIZATION not accepted
  → INTAKE_INCONSISTENT_AGENT1_WITHOUT_RUNTIME

CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION accepted,
GATE_2 / GATE_7 / CAP_INPUT not ALL accepted
  → INTAKE_INCONSISTENT_EXECUTION_WITHOUT_GATES
```

## Findings and status precedence

Every finding carries `severity: 'blocking'`. The finding codes:

```
INTAKE_DECISION_MISSING
INTAKE_DECISION_REJECTED
INTAKE_DECISION_DEFERRED
INTAKE_INCONSISTENT_IMPORT_WITHOUT_FULL_JOIN
INTAKE_INCONSISTENT_RUNTIME_WITHOUT_IMPORT
INTAKE_INCONSISTENT_AGENT1_WITHOUT_RUNTIME
INTAKE_INCONSISTENT_EXECUTION_WITHOUT_GATES
INTAKE_FIELD_PLACEHOLDER
INTAKE_SCOPE_INVALID
INTAKE_REQUIRED_ACK_MISSING
INTAKE_FORBIDDEN_CONTENT
INTAKE_REVIEWER_ROLE_INVALID
```

`status` is the most severe category present, in this fixed precedence:

```
intake_invalid  >  intake_inconsistent  >  intake_rejected
  >  intake_deferred  >  intake_incomplete  >  intake_complete_synthetic_only
```

Unsafe or malformed content outranks a structural inconsistency; a structural inconsistency outranks a
plain rejection; a rejection outranks a deferral; a deferral outranks a merely incomplete intake; and only
an intake with none of the above reaches `intake_complete_synthetic_only`. Whatever the status,
`goNoGo` is always `NO_GO` and `brazilReadiness` is always `blocked`.

## What "complete" and "valid" mean here — and what they never mean

| Field | True only when | Never means |
| --- | --- | --- |
| `syntheticIntakeComplete` | status is `intake_complete_synthetic_only` | A gate is approved, a cap is set, or anything may execute. |
| `ownerDecisionsCapturedSynthetic` | all nine decisions are present (accepted, rejected or deferred — not missing) | The decisions captured are valid, consistent or safe. |
| `ownerDecisionsValidSynthetic` | status is `intake_complete_synthetic_only` | Any state, gate, cap, execution or activation field becomes `true`. |

Every one of `gate2Approved`, `gate7Approved`, `capInputPolicyApproved`,
`controlledExecutionAttemptAuthorized`, `fullJoinAuthorized`, `importAuthorized`, `runtimeAuthorized` and
`agent1Authorized` is the literal `false` in the result's type — not computed from the intake at all, so
no intake content, however consistent or complete, can flip one.

## Safety assertions

```
NO_REAL_DATA_ACCESSED
NO_PATH_INPUT_ACCEPTED
NO_MANIFEST_READ
NO_CSV_OR_ZIP_READ
NO_ROW_READS
NO_JOIN_EXECUTED
NO_COVERAGE_EXECUTED
NO_IMPORT_EXECUTED
NO_SUPABASE_WRITES
NO_RUNTIME_ACTIVATED
NO_AGENT1_ACTIVATED
NO_PROVIDER_CALLS
NO_GATE_APPROVAL_GRANTED
NO_PRODUCTION_READINESS_GRANTED
NO_EXECUTION_AUTHORIZATION_GRANTED
INTAKE_VALIDATION_SYNTHETIC_ONLY
```

The last one is specific to this layer: intake **validation** is a distinct act from intake
**execution**, and this list says so explicitly, so no reader mistakes a validated intake for an executed
one.

## Required next human actions

```
HUMAN_REVIEW_AUTHORIZATION_INTAKE_VALIDATION
REAL_OWNER_INTAKE_REQUIRED
LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED
SEPARATE_GATE_2_APPROVAL_REQUIRED
SEPARATE_GATE_7_APPROVAL_REQUIRED
SEPARATE_CAP_INPUT_APPROVAL_REQUIRED
SEPARATE_CONTROLLED_EXECUTION_AUTHORIZATION_REQUIRED
SEPARATE_FULL_JOIN_AUTHORIZATION_REQUIRED
SEPARATE_IMPORT_AUTHORIZATION_REQUIRED
SEPARATE_RUNTIME_AUTHORIZATION_REQUIRED
SEPARATE_AGENT1_AUTHORIZATION_REQUIRED
```

Unconditional: even `complete_synthetic_accept` removes none of them.

## What the intake validator does NOT do

- **It does not execute anything.** `executionStarted`, `executionAttempted` and `executionAuthorized`
  are literal `false` in the type, regardless of intake content.
- **It does not read data.** No manifest, no CSV, no ZIP, no control file, no dataset row. There is no
  filesystem module and no path module in the module or the CLI, and no location argument of any kind.
- **It does not approve a gate.** `gate2Approved`, `gate7Approved` and `capInputPolicyApproved` are
  literal `false`, whatever the intake's own `accepted` decisions claim.
- **It does not authorize a cap, a full join, an import, a runtime or Agent 1.**
  `controlledExecutionAttemptAuthorized`, `fullJoinAuthorized`, `importAuthorized`, `runtimeAuthorized`
  and `agent1Authorized` are literal `false`.
- **It does not activate import, runtime or Agent 1.** `importExecuted`, `supabaseWrites`,
  `runtimeActivated`, `agent1Activated` and `providerCalls` are literal `false`. No database is opened, no
  migration is applied, no provider is called and no credit can be spent.
- **It does not run a join or a coverage computation.** `joinExecuted` and `coverageExecuted` are literal
  `false`.
- **It does not mark Brazil ready.** `brazilReadiness` is the single-member union `blocked`.
- **It does not re-implement an upstream rule.** The BR-SOURCE-13I handoff packet it always builds and
  embeds was produced by 13A–13I, verbatim.

It is a pure function with no clock and no randomness. The result carries the chain's static synthetic
timestamp, so two runs are byte-identical, and both JSON and Markdown renderings are deterministic.

## Files

| Path | Role |
| --- | --- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts` | Pure module: intake types, the seventeen fixtures, validation, JSON and Markdown rendering |
| `scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-intake-validator.ts` | CLI: argument parsing, refusals, stdout output |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-authorization-intake-validator.test.ts` | Tests, including static import guards and 13A–13I regressions |
| `docs/source-catalog/br-receita-cnpj-13i-controlled-execution-authorization-handoff-packet.md` | The upstream handoff packet this validation embeds |

## Flags

```
OPS_BR_13J_CONTROLLED_EXECUTION_AUTHORIZATION_INTAKE_VALIDATOR_AUTHORIZED = true
OPS_BR_13J_CONTROLLED_EXECUTION_AUTHORIZATION_INTAKE_VALIDATOR_PR_READY = false until PR
OPS_BR_13J_CONTROLLED_EXECUTION_AUTHORIZATION_INTAKE_VALIDATOR_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = true
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_OFFICIAL = true
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13F_CONTROLLED_EXECUTION_ATTEMPT_PLAN_GENERATOR_OFFICIAL = true
OPS_BR_13G_CONTROLLED_EXECUTION_ATTEMPT_RUNNER_SCAFFOLD_OFFICIAL = true
OPS_BR_13H_CONTROLLED_EXECUTION_READINESS_ORCHESTRATOR_OFFICIAL = true
OPS_BR_13I_CONTROLLED_EXECUTION_AUTHORIZATION_HANDOFF_PACKET_OFFICIAL = true

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

Note the shape of that block: nine official upstream components, one newly built and PR-pending, and zero
approvals. That is a coherent state, and it is the state Brazil is actually in. Ten working, official
modules — including one that can validate an intake as "complete" — are a statement about software;
readiness is a statement about permission, and no amount of working software, and no amount of completed
paperwork, produces permission.

## Conclusion

- `status` = **`intake_complete_synthetic_only`** only for `complete_synthetic_accept`, and even there:
- `goNoGo` = **`NO_GO`**
- `brazilReadiness` = **`blocked`**
- `readinessConclusion` = **`BRAZIL_REMAINS_BLOCKED`**

> Authorization intake validation is not execution authorization.

> Brazil remains blocked.
