# BR-SOURCE-13G — Receita CNPJ controlled execution attempt runner scaffold

> **Runner scaffold result is not execution authorization.**

## Purpose

BR-SOURCE-13F produces the **plan** a human reads before a controlled execution attempt: its steps, its
preconditions, its stop conditions, and the human actions still owed. What the chain still could not
produce is the shape of the **attempt** itself — the per-step record a reader can point at to see, step
by step, that nothing ran and why.

13G is that record. It takes a synthetic 13C fixture, a synthetic 13E review decision and the 13F plan
over both, walks every step the plan contains, and emits an attempt result in which every step is
`blocked` or `skipped`.

The point of a runner that cannot run is the asymmetry it makes visible. 13F can be misread as the last
document before execution — a plan marked `plan_ready_for_human_review` with a `GO`, sitting there
looking like a green light. 13G takes that exact plan and answers `NO_GO`. A reader who reaches a
review-ready plan and asks "so does it run now?" gets the answer in the artifact instead of in a
person's memory.

Two distinctions carry the module:

```text
runner_scaffold_created   ≠  execution_started
attempt_result_generated  ≠  real_data_execution
```

## Relationship with 13A, 13B, 13C, 13D, 13E and 13F

```text
13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
                       →  13D request packet
                       →  13E review decision validation
                       →  13F controlled execution attempt plan
                       →  13G controlled execution attempt runner scaffold
```

13G adds no upstream rule and relaxes none. Every verdict it prints was produced by a layer below it,
and the 13F plan travels inside the result **verbatim** so a reviewer can check the delegation instead
of trusting it. The synthetic reviewer decision is built by 13F's own synthetic builder rather than
reconstructed here, so 13G cannot drift from how 13E and 13F spell a decision of a given value.

## Files

| File | Role |
| --- | --- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts` | Pure module: result derivation, Markdown rendering, serialization |
| `scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts` | CLI: three inputs, stdout only |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.test.ts` | 56 tests, including static guards and 13A–13F regressions |

## Usage

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts --fixture synthetic-ready --decision approve --format json
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts --fixture synthetic-ready --decision approve --format json --pretty
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts --fixture synthetic-ready --decision approve --format markdown
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts --fixture synthetic-ready --decision reject --format json
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.ts --fixture missing-owner-artifact --decision approve --format json
```

## Flags

| Flag | Required | Values |
| --- | --- | --- |
| `--fixture` | yes | any 13C fixture name (`synthetic-ready`, `missing-owner-artifact`, `placeholder-owner-artifact`, `forbidden-content-owner-artifact`, `missing-stage`, `missing-safety-flag`, `invalid-evidence-mode`, `rejected-owner-decision`, `deferred-owner-decision`) |
| `--decision` | yes | `approve`, `reject`, `defer` |
| `--format` | yes | `json`, `markdown` |
| `--pretty` | no | indents JSON; ignored for Markdown |

Both `--flag value` and `--flag=value` are accepted for the three valued flags.

### Rejected flags

Every flag below is refused on sight, in either spelling, before anything is produced:

```text
--manifest  --input  --input-dir  --output  --output-dir  --path  --dir  --file
--csv  --zip  --real-data  --execute  --run  --apply  --force
--import  --supabase  --production  --runtime  --agent1
```

`--execute`, `--run`, `--apply` and `--force` are refused for the same reason as the rest: there is
nothing to execute, and there is no refusal here that a flag could override, because the refusal **is**
the output. Unknown flags and positional arguments are refused too, so nothing can be smuggled in as a
bare location.

### Exit codes and error codes

| Exit | Meaning |
| --- | --- |
| `0` | A result was produced. **Every** result is blocked — a refusal is the correct outcome, so it is never reported as an error. |
| `1` | The **arguments** were unusable and nothing was produced. |

| Error code | Cause |
| --- | --- |
| `BRSOURCE13G_FORBIDDEN_ARGUMENT` | a rejected flag was present |
| `BRSOURCE13G_UNKNOWN_ARGUMENT` | an unrecognized flag or a positional argument |
| `BRSOURCE13G_FIXTURE_REQUIRED` / `BRSOURCE13G_FIXTURE_UNKNOWN` | `--fixture` missing or not a 13C fixture |
| `BRSOURCE13G_DECISION_REQUIRED` / `BRSOURCE13G_DECISION_UNKNOWN` | `--decision` missing or outside 13E's vocabulary |
| `BRSOURCE13G_FORMAT_REQUIRED` / `BRSOURCE13G_FORMAT_UNKNOWN` | `--format` missing or unsupported |

## `blocked_no_execution_authorization` vs `blocked_plan_not_ready`

There are exactly two statuses, and **both are blocked**. The status type has no third member, so a
`ran`, a `started`, a `partial` or a `completed` cannot be spelled.

| Status | When | Step results |
| --- | --- | --- |
| `blocked_no_execution_authorization` | The 13F plan reached `plan_ready_for_human_review` / `GO`. Nothing is wrong with the plan — there is simply **no authorization to execute it**. | every step `blocked`, reason `CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED` |
| `blocked_plan_not_ready` | The 13F plan is `blocked` — a `reject`, a `defer`, or a fixture that never reached a reviewable packet. The plan's steps are **not reached at all**. | every step `skipped`, reason `PLAN_NOT_READY_FOR_ATTEMPT` |

`goNoGo` is `NO_GO` in every case, for every fixture and every decision.

The distinction between `blocked` and `skipped` is worth keeping: `blocked` says "this is the wall",
`skipped` says "we never got to the wall". Collapsing them would lose which of the two refusals
actually happened.

### Blockers

Every result leads with this module's own unconditional list:

```text
CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED
GATE_2_REMAINS_NOT_APPROVED
GATE_7_REMAINS_NOT_APPROVED
CAP_INPUT_POLICY_REMAINS_NOT_APPROVED
REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED
```

It leads on purpose. A review-ready plan leaves 13F with no blockers at all, so a result that only
forwarded the plan's list would present an empty one and read like an oversight — when in fact the
readiest possible plan is refused for four separate outstanding approvals.

When the plan itself was blocked, its blockers follow, each tagged with the layer it came from:

```text
PLAN/PLAN/REVIEW_DECISION_DID_NOT_APPROVE (rejected)
PLAN/REVIEW/REVIEW_PACKET_NOT_READY (packet.status)
```

13F's blockers already carry their own origin (`PLAN/` for its plan-level reason, `REVIEW/` for a
delegated 13E finding), and that inner prefix is deliberately **preserved rather than rewritten**. The
doubled `PLAN/PLAN/` is the honest reading — "the plan layer passed up its own plan-level objection" —
and collapsing it would discard provenance this module has no authority to discard.

## What a runner scaffold result does NOT mean

A result — including one over a plan that reached `GO` — is **not**:

- an execution authorization, or an execution of any kind;
- an attempt: `executionAttempted` is `false`, at the result level and on every step;
- a real-data read: no manifest, no CSV, no ZIP, no dataset row;
- a join or a coverage computation;
- an import, a Supabase write or a migration;
- a runtime activation, an Agent 1 activation or a provider call;
- a GATE-2 approval, a GATE-7 approval or a cap / input policy approval;
- a signal that Brazil is ready for import, runtime or live prospect generation.

Twenty-one result fields and ten per-step fields are typed as the literal `false`, so no caller — and
no future edit — can flip one without changing the module's public type.

## What this does not do

- **No execution.** Not of a plan step, not of anything else, whatever the plan's status.
- **No real data.** No manifest, CSV, ZIP, control file or dataset row is read.
- **No path input.** There is no location parameter, so there is nothing to point at real data.
- **No I/O.** The module has no `fs`, no `path`, no network, no env and no argv; the CLI touches
  `process` only through `argv`, `stdout`, `stderr` and `exitCode`, and never creates a file.
- **No child-process spawn.** Neither the module nor the CLI spawns anything. (The test file does, to
  exercise the CLIs as CLIs.)
- **No Supabase, no migration, no runtime, no Agent 1, no provider.**
- **No gate approval, no cap authorization, no Brazil-ready flag.**
- **No UI change, and no `MEMORY.md` change.**

## Determinism and purity

Same fixture and same decision, same result: no side effects, no mutation of the input, no clock and no
randomness. The result carries 13D's static timestamp (`STATIC_SYNTHETIC_TIMESTAMP`) through 13F's
plan, so two runs are byte-identical in both JSON and Markdown. A reviewer diffing two outputs is
comparing the chain's behaviour, not the time.

## Flags of record

```text
OPS_BR_13G_CONTROLLED_EXECUTION_ATTEMPT_RUNNER_SCAFFOLD_AUTHORIZED = true
OPS_BR_13G_CONTROLLED_EXECUTION_ATTEMPT_RUNNER_SCAFFOLD_PR_READY = false until PR
OPS_BR_13G_CONTROLLED_EXECUTION_ATTEMPT_RUNNER_SCAFFOLD_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = true
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_OFFICIAL = true
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13F_CONTROLLED_EXECUTION_ATTEMPT_PLAN_GENERATOR_OFFICIAL = true

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

## Tests

```bash
node --import tsx --test src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-attempt-runner-scaffold.test.ts
```

56 tests: the refused review-ready path, the blocked-plan paths, plan delegation, per-step records,
safety assertions, owed human actions, determinism in both formats, the CLI (happy paths, usage errors,
every rejected flag, positionals), static import guards over both source files, an exhaustive sweep
proving no flag can be `true` for any of the 27 fixture × decision combinations, and 13A–13F
regressions.

---

**Runner scaffold result is not execution authorization.**

A created runner scaffold is not a started run. Brazil remains blocked.
