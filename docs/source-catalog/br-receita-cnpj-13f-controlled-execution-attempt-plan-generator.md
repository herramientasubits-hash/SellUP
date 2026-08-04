# BR-SOURCE-13F — Receita CNPJ controlled execution attempt plan generator

**Status:** PR open, not merged. Nothing in this module changes any gate.

## Purpose

BR-SOURCE-13E records the reviewer's answer to a 13D packet, and an `approve` there means exactly one
thing: the request may advance to a future **planning / review** step. What the chain still could not
produce is that plan — the document a human reads to see what a controlled execution attempt would
involve, in what order, under what preconditions, and at which points it must stop.

13F is that document:

```text
13C synthetic fixture
  → 13B controlled execution preflight evaluator (which delegates the artifact to 13A)
  → 13D request packet
  → 13E review decision validation
  → 13F controlled execution attempt plan
  → JSON or Markdown on stdout
```

It writes a plan. It runs nothing.

Two distinctions carry the whole module:

```text
approved_for_next_planning_review  ≠  execution authorization
plan_generated                     ≠  execution_started
```

**Plan ready for review is not execution authorization.**

## Relationship with 13A, 13B, 13C, 13D and 13E

| Module                                                                | Question it answers                                                        | Role here                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **13A** `br-receita-cnpj-owner-decision-validator.ts`                 | Is this owner artifact complete, consistent and free of unsafe content?     | Invoked by 13B; 13F never re-implements its rules             |
| **13B** `br-receita-cnpj-controlled-execution-preflight-evaluator.ts` | May this _request_ proceed to a controlled execution attempt **review**?    | Invoked by 13D; its verdict travels inside the packet         |
| **13C** synthetic fixtures + harness                                  | Can the chain be executed and inspected without real data?                 | Supplies the nine named synthetic requests                    |
| **13D** request packet generator + CLI                                | What document does a reviewer read, and what does it withhold?              | Produces the packet the plan is built over                    |
| **13E** review decision validator + CLI                               | Is this reviewer's decision complete, safe, and about a reviewable packet?  | Produces the verdict that decides whether a plan is possible  |
| **13F** attempt plan generator + CLI                                  | What would a controlled execution attempt involve, and what stops it?       | Writes the plan; grants nothing and starts nothing            |

13F adds no upstream rule and relaxes none. It calls 13D for the packet and 13E for the verdict, and a
test asserts both are embedded byte-equal to what those modules produce on their own.

## Files

| Path                                                                                                                                  | Role                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-attempt-plan-generator.ts`                  | Pure module: builds the plan, renders Markdown, serializes JSON. Three imports (13D, 13E, 13C types), no I/O                              |
| `scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-plan-generator.ts`                                                | CLI. Reads the argument vector, writes stdout/stderr, nothing else                                                                        |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-attempt-plan-generator.test.ts`   | Plan outcomes, steps, preconditions, stop conditions, determinism, both formats, CLI usage and refusals, static guards, 13E/13D/13C/13B/13A regressions |

## Usage

JSON:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-plan-generator.ts --fixture synthetic-ready --decision approve --format json
```

Indented JSON:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-plan-generator.ts --fixture synthetic-ready --decision approve --format json --pretty
```

Markdown:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-plan-generator.ts --fixture synthetic-ready --decision approve --format markdown
```

A rejection (still exit 0 — a refusal to plan is a correct outcome):

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-plan-generator.ts --fixture synthetic-ready --decision reject --format json
```

An approval over a packet that never became reviewable (exit 0, status `blocked`):

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-plan-generator.ts --fixture missing-owner-artifact --decision approve --format json
```

## Flags

| Flag                                  | Required | Meaning                                          |
| ------------------------------------- | -------- | ------------------------------------------------ |
| `--fixture <name>`                    | yes      | One of the nine BR-SOURCE-13C synthetic fixtures |
| `--decision <approve\|reject\|defer>` | yes      | The synthetic reviewer position to plan over     |
| `--format <json\|markdown>`           | yes      | Output format written to stdout                  |
| `--pretty`                            | no       | Indents JSON. Ignored for Markdown               |

All three value flags also accept the `--flag=value` form. Nothing else is accepted.

### Rejected flags

These are refused before anything is produced, in bare and in `--flag=value` form:

`--manifest`, `--input`, `--input-dir`, `--output`, `--output-dir`, `--path`, `--dir`, `--file`,
`--csv`, `--zip`, `--real-data`, `--execute`, `--run`, `--apply`, `--import`, `--supabase`,
`--production`, `--runtime`, `--agent1`.

They are not unimplemented. There is no code path for a location, a payload or a real-data run, and
there is nothing to execute, run or apply: this tool prints a plan and exits.

### Exit codes and error codes

| Exit | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | A plan was produced, whether its status is `plan_ready_for_human_review` or `blocked` |
| `1`  | The ARGUMENTS were unusable; nothing was produced and stdout stays empty       |

| Error code                       | Cause                                              |
| -------------------------------- | -------------------------------------------------- |
| `BRSOURCE13F_FIXTURE_REQUIRED`   | `--fixture` absent or without a value              |
| `BRSOURCE13F_FIXTURE_UNKNOWN`    | Fixture name outside the 13C catalogue             |
| `BRSOURCE13F_DECISION_REQUIRED`  | `--decision` absent or without a value             |
| `BRSOURCE13F_DECISION_UNKNOWN`   | Decision other than `approve`, `reject` or `defer` |
| `BRSOURCE13F_FORMAT_REQUIRED`    | `--format` absent or without a value               |
| `BRSOURCE13F_FORMAT_UNKNOWN`     | Format other than `json` or `markdown`             |
| `BRSOURCE13F_FORBIDDEN_ARGUMENT` | A rejected flag from the list above                |
| `BRSOURCE13F_UNKNOWN_ARGUMENT`   | Any other argument, including a positional         |

## `plan_ready_for_human_review` vs `blocked`

| Status                         | Go / No-Go | When                                                                             |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------- |
| `plan_ready_for_human_review`  | `GO`       | 13E returned `valid` / `GO` / `approved_for_next_planning_review` **and** said the request may proceed to a planning / review step |
| `blocked`                      | `NO_GO`    | any other 13E result: a reject, a defer, an unrecognized decision, or an approval over a packet the chain already refused |

All four 13E signals must agree. Only `synthetic-ready` yields a reviewable packet, so an approval over
any of the other eight fixtures is `blocked` — a plan cannot be written for a request the chain refused.

A `blocked` plan always states why. Its first blocker is the plan-level reason
`PLAN/REVIEW_DECISION_DID_NOT_APPROVE (<outcome>)`, which matters because a reject and a defer are
**valid** 13E decisions that leave no blocking finding behind; without that line a blocked plan could
present an empty blocker list and read like an oversight. Every 13E blocking finding follows, prefixed
`REVIEW/`, in 13E's own order. A blocked plan also prepends
`RESOLVE_REVIEW_DECISION_BLOCKERS_BEFORE_REPLANNING` to its required human actions.

## What `plan_ready_for_human_review` does NOT mean

`plan_ready_for_human_review` names a DOCUMENT state: a plan exists and a human may now be asked to
read it. It is not an owner decision, not a gate approval, not a cap approval, and not permission to
read a byte of the dataset.

A review-ready plan:

- does **not** start anything — `executionStarted` is `false` on every plan, in every code path;
- does **not** authorize execution, on real data or otherwise;
- does **not** approve GATE-2, GATE-7 or the cap / input policy;
- does **not** authorize a controlled execution attempt;
- does **not** activate import, runtime or Agent 1, and calls no provider;
- does **not** read a manifest, a CSV, a ZIP or a dataset row, and runs no join or coverage.

Seventeen fields carry that: `executionStarted`, `executionAuthorized`,
`realDataExecutionAuthorized`, `manifestReadAuthorized`, `csvZipReadAuthorized`,
`rowReadsAuthorized`, `joinAuthorized`, `coverageAuthorized`, `importAuthorized`,
`supabaseWritesAuthorized`, `runtimeAuthorized`, `agent1Authorized`, `providerCallsAuthorized`,
`gate2Approved`, `gate7Approved`, `capInputPolicyApproved` and
`controlledExecutionAttemptAuthorized`. Every one is typed as the literal `false`, so a future edit
that tried to set one would have to change the module's exported type. A test sweeps all nine fixtures
against all three decisions and asserts none of the seventeen is ever `true`.

**Plan ready for review is not execution authorization.**

## Plan steps

Seven steps, in narrative order:

| Step id                                         | What a human does                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `PLAN_STEP_RECONFIRM_SCOPE`                     | Re-reads the 13D packet and the 13E decision and restates the scope           |
| `PLAN_STEP_RECONFIRM_NO_REAL_DATA`              | Confirms no manifest, CSV, ZIP, row, join or coverage is in scope             |
| `PLAN_STEP_RECONFIRM_NO_PATH_INPUT`             | Confirms the chain still exposes no location parameter                        |
| `PLAN_STEP_RECONFIRM_NO_IMPORT`                 | Confirms no import, no database write and no migration is in scope            |
| `PLAN_STEP_RECONFIRM_NO_RUNTIME`                | Confirms no runtime surface, flag or serving path is switched on              |
| `PLAN_STEP_RECONFIRM_NO_AGENT1`                 | Confirms Agent 1 and every provider stay untouched, so no credit can be spent |
| `PLAN_STEP_PREPARE_FUTURE_AUTHORIZATION_PACKET` | Assembles what a real authorization **request** would need to contain         |

Every step carries `executionAllowed: false`, `realDataAccessAllowed: false` and
`requiresHumanApproval: true`, all typed as literals. No step description contains a runnable command,
a location or a dataset name — a plan that carried a runnable command would be an execution script
wearing a plan's name, and a test asserts none does. The last step prepares a request for
authorization; it never obtains one.

## Preconditions

```text
13A_VALIDATOR_OFFICIAL
13B_PREFLIGHT_EVALUATOR_OFFICIAL
13C_SYNTHETIC_HARNESS_OFFICIAL
13D_REQUEST_PACKET_GENERATOR_OFFICIAL
13E_REVIEW_DECISION_VALIDATOR_OFFICIAL
REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED
GATE_2_REMAINS_NOT_APPROVED
GATE_7_REMAINS_NOT_APPROVED
CAP_INPUT_POLICY_REMAINS_NOT_APPROVED
```

The first five name the chain that produced the plan. The last four restate what has **not** moved,
because a precondition list that only counted what was done would read like progress toward execution.

## Stop conditions

```text
STOP_IF_ANY_REAL_DATA_PATH_IS_PROVIDED
STOP_IF_MANIFEST_OR_CSV_OR_ZIP_IS_REQUESTED
STOP_IF_IMPORT_OR_RUNTIME_OR_AGENT1_IS_REQUESTED
STOP_IF_GATE_APPROVAL_IS_INFERRED
STOP_IF_OWNER_DECISION_IS_MISSING
STOP_IF_REVIEW_APPROVAL_IS_TREATED_AS_EXECUTION_AUTHORIZATION
```

Each one names a way the plan could be misread as permission. The last is the misreading this module
exists to prevent.

## Required next human actions

```text
HUMAN_REVIEW_ATTEMPT_PLAN
OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION
LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED
GATE_2_REMAINS_NOT_APPROVED
GATE_7_REMAINS_NOT_APPROVED
CAP_INPUT_POLICY_REMAINS_NOT_APPROVED
```

Unconditional. A plan that reached review-ready removes none of them, because no gate moved and no
owner decision was made.

## Determinism and purity

`buildBrazilReceitaControlledExecutionAttemptPlan` is a pure function: same fixture and same decision,
same plan. It never mutates its input, reads no clock and uses no randomness. The plan carries 13D's
static timestamp, so two runs of the same fixture, decision and format are byte-identical — a test
asserts that for JSON across all three decision values and for Markdown across all nine fixtures.

`reviewDecisionValue` widens 13E's three-value vocabulary with `unrecognized`, for a decision whose
value was absent, incomplete or outside that vocabulary. Such a plan is always `blocked`; the field has
to be able to say so rather than misreport one of the three real positions.

## What this does not do

- No real data access. No path input: there is no location parameter anywhere in the module or CLI.
- No manifest, control-file, CSV or ZIP reading. No dataset row reads.
- No join. No coverage computation. No exact percentages.
- No execution, no run, no apply — there is no such code path, and no flag that could reach one.
- No import. No Supabase client, no writes, no migrations.
- No runtime integration. No Agent 1 integration. No provider calls.
- No filesystem writes of any kind — output goes to stdout and nowhere else.
- No UI changes. No feature flags touched. No gate approved. No cap authorized.
- Brazil remains blocked.

## Flags of record

```text
OPS_BR_13F_CONTROLLED_EXECUTION_ATTEMPT_PLAN_GENERATOR_AUTHORIZED = true
OPS_BR_13F_CONTROLLED_EXECUTION_ATTEMPT_PLAN_GENERATOR_PR_READY = false until PR
OPS_BR_13F_CONTROLLED_EXECUTION_ATTEMPT_PLAN_GENERATOR_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = true
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_OFFICIAL = true
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_OFFICIAL = true

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

Plan ready for review is not execution authorization.
