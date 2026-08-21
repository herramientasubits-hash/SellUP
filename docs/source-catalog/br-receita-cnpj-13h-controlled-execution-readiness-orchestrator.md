# BR Receita CNPJ — controlled execution readiness orchestrator (BR-SOURCE-13H)

## Purpose

By BR-SOURCE-13G the Brazil Receita CNPJ chain has seven official components, all of them merged and
all of them working. A reader who watches seven green modules produce a clean result can very
reasonably conclude that the hard part is done.

It is not. Every one of those components is synthetic, and not one of them moved a gate.

13H exists to state both facts in the same artefact — the synthetic chain is operational, and Brazil is
blocked — because separating them is exactly how "the pipeline works" becomes "the pipeline is
approved". It runs the official synthetic chain 13A→13G and emits a readiness report that answers, in
one place:

- Does the synthetic technical chain exist and run?
- What status does it return?
- What blocks real execution?
- Is Brazil ready for import, runtime or Agent 1?
- Is there a real controlled execution authorization?

The answer is always the same shape: the synthetic chain may be fully operational, and Brazil is still
`NO_GO` and blocked for real execution.

## Central rule

```
A readiness report may say "the synthetic chain runs".
A readiness report may NEVER say "ready", and it may never say "authorized".
```

Two distinctions carry the module:

```
synthetic_chain_operational  ≠  production_ready
readiness_report_generated   ≠  execution_authorization
```

## Position in the chain

```
13C synthetic fixture  →  13B preflight evaluator (which delegates the artifact to 13A)
                       →  13D request packet
                       →  13E review decision validation
                       →  13F controlled execution attempt plan
                       →  13G controlled execution attempt runner scaffold
                       →  13H controlled execution readiness report
```

| Component | Role 13H depends on |
| --- | --- |
| BR-SOURCE-13A owner decision validator | Validates the synthetic owner decision artifact. Reached through 13B. |
| BR-SOURCE-13B controlled execution preflight evaluator | Decides whether a request is reviewable at all. Reached through 13D. |
| BR-SOURCE-13C synthetic owner artifact harness | Owns the fixture catalogue. 13H re-exports its names verbatim. |
| BR-SOURCE-13D request packet generator | Produces the packet a reviewer reads. Reached through 13F. |
| BR-SOURCE-13E review decision validator | Owns the `approve` / `reject` / `defer` verdict. Reached through 13F. |
| BR-SOURCE-13F attempt plan generator | Produces the plan. Reached through 13G. |
| BR-SOURCE-13G attempt runner scaffold | Produces the per-step attempt record. **13H's direct dependency**; its result travels inside the report verbatim. |

13H re-implements no upstream rule. Every verdict it prints was produced by 13A–13G.

## Usage

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision approve --format json
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision approve --format json --pretty
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision approve --format markdown
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture synthetic-ready --decision reject --format json
```

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts --fixture missing-owner-artifact --decision approve --format json
```

### Accepted arguments

| Flag | Values | Required |
| --- | --- | --- |
| `--fixture` | any name in the 13C catalogue (`synthetic-ready`, `missing-owner-artifact`, `placeholder-owner-artifact`, `forbidden-content-owner-artifact`, `missing-stage`, `missing-safety-flag`, `invalid-evidence-mode`, `rejected-owner-decision`, `deferred-owner-decision`) | yes |
| `--decision` | `approve` \| `reject` \| `defer` | yes |
| `--format` | `json` \| `markdown` | yes |
| `--pretty` | — (indents JSON; ignored for Markdown) | no |

### Refused arguments

`--manifest`, `--input`, `--input-dir`, `--output`, `--output-dir`, `--path`, `--dir`, `--file`,
`--csv`, `--zip`, `--real-data`, `--execute`, `--run`, `--apply`, `--force`, `--import`, `--activate`,
`--supabase`, `--production`, `--runtime`, `--agent1` — plus every unknown flag, every positional
argument, and every `--flag=value` form of the above.

There is no code path that accepts a location, so there is nothing to point at real data.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | A readiness report was produced. Every report is `NO_GO`; a `NO_GO` report is the correct outcome, not an error. |
| `1` | The arguments were unusable. Nothing was produced. The error code is written to stderr. |

## The two statuses

| Status | Meaning |
| --- | --- |
| `synthetic_chain_operational_execution_blocked` | 13A→13G ran end to end and produced a result over a review-ready plan. `syntheticChainOperational` is `true`. Real execution is **still** refused: everything that happened, happened over a synthetic fixture with no owner authorization, no legal / privacy / security review, no approved cap and input policy, and no GATE-2 or GATE-7 approval. |
| `synthetic_chain_blocked` | The chain refused earlier — a fixture that never reached a reviewable packet, or a reviewer who did not approve — so the plan's steps were never reached. `syntheticChainOperational` is `false`. |

Neither status is a pass. `productionReadiness` is a single-member type whose only value is
`not_ready_blocked`; `goNoGo` is always `NO_GO`; `readinessConclusion` is always
`BRAZIL_REMAINS_BLOCKED`. A `ready`, an `approved` or a `GO` cannot be spelled in the module's types.

The first status is the interesting one, and it is deliberately a compound sentence. Its first half is
a genuine, earned yes about SOFTWARE. Its second half is an unconditional no about PERMISSION, and the
second half wins. A working chain is a statement about code. Readiness is a statement about permission,
and no amount of working code produces permission.

## What the readiness report does NOT do

- **It does not execute.** The runner it consumes already refused every step; 13H only reads that
  refusal. `executionStarted`, `executionAttempted` and `executionAuthorized` are literal `false`.
- **It does not read data.** No manifest, no CSV, no ZIP, no control file, no dataset row. No path
  input is accepted, in the module or in the CLI.
- **It does not join or compute coverage.**
- **It does not approve gates.** GATE-2, GATE-7 and the cap / input policy are untouched, and the
  report says so explicitly in its blocker list and its safety assertions.
- **It does not activate import, runtime or Agent 1.** No import path, no Supabase write, no migration,
  no feature flag, no serving path, no provider call, no credit spent, no prospect generated.
- **It does not mark Brazil ready.** For anything.
- **It performs no I/O at all** in the pure module: no filesystem, no path module, no network, no
  environment read, no argument vector, no child-process spawn. The CLI adds only `argv`, `stdout`,
  `stderr` and `exitCode`.

The module is a pure function: same fixture and same decision, same report, no side effects, no
mutation of the input, no clock and no randomness. Reports carry the chain's STATIC timestamp, so two
runs are byte-identical.

## Report contents

| Field group | Contents |
| --- | --- |
| Identity | `reportType`, `version`, `generatedAt` (static), `fixture`, `reviewDecisionValue` |
| Verdict | `status`, `goNoGo` (`NO_GO`), `productionReadiness` (`not_ready_blocked`), `syntheticChainOperational` |
| Withheld state | 21 literal-`false` fields: execution, real data, path input, manifest / CSV / ZIP / row reads, join, coverage, import, Supabase writes, runtime, Agent 1, provider calls, GATE-2, GATE-7, cap / input policy, controlled execution attempt authorization |
| Provenance | `runnerResult` — 13G's result verbatim, including 13F's plan and every step record |
| Official stack | The seven 13A–13G components, each `true` |
| Findings | `blockers`, `safetyAssertions`, `requiredNextHumanActions` |
| Conclusion | `readinessConclusion` (`BRAZIL_REMAINS_BLOCKED`), `disclaimer` |

### Production blockers (always present, always `blocking`)

```
CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED
GATE_2_REMAINS_NOT_APPROVED
GATE_7_REMAINS_NOT_APPROVED
CAP_INPUT_POLICY_REMAINS_NOT_APPROVED
REAL_DATA_EXECUTION_REMAINS_NOT_AUTHORIZED
FULL_JOIN_EXECUTION_NOT_READY
IMPORT_NOT_READY
RUNTIME_NOT_READY
AGENT1_NOT_READY
```

This list is longer than 13G's on purpose. 13G names what stops an ATTEMPT; a readiness report is also
asked whether Brazil is ready for the full join, for import, for runtime and for Agent 1, and each of
those is a separate unapproved thing that no other approval implies. Answering "is Brazil ready?" with
only the attempt-level blockers would leave four questions silently unanswered, and silence in a
readiness report reads as yes.

Every blocker 13G reported is also carried, verbatim, at the `runner_scaffold` layer with a traceable
description. An id can therefore appear twice, once per layer: that repetition distinguishes "the
production-readiness layer holds this open" from "the runner scaffold also raised it", and collapsing
the two would erase which layer a reader has to go and satisfy.

There is no advisory severity tier. Every blocker is `blocking`, because a readiness report whose
findings could be graded down to "warning" would invite exactly the triage that produces a premature
execution.

### Safety assertions

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
```

### Required next human actions

```
HUMAN_REVIEW_READINESS_REPORT
OWNER_MUST_PROVIDE_REAL_SIGNED_EXECUTION_AUTHORIZATION
LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED
GATE_2_REMAINS_NOT_APPROVED
GATE_7_REMAINS_NOT_APPROVED
CAP_INPUT_POLICY_REMAINS_NOT_APPROVED
FULL_JOIN_EXECUTION_REQUIRES_SEPARATE_AUTHORIZATION
IMPORT_REQUIRES_SEPARATE_AUTHORIZATION
RUNTIME_REQUIRES_SEPARATE_AUTHORIZATION
AGENT1_REQUIRES_SEPARATE_AUTHORIZATION
```

The last four are spelled separately rather than folded into one "get authorization" line, because they
are four independent authorizations. A single line would let one approval be read as covering all four,
which is the specific mistake that turns a reviewed plan into an unreviewed import.

## Files

| File | Role |
| --- | --- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts` | The pure module |
| `scripts/source-catalog/br-receita-cnpj-controlled-execution-readiness-orchestrator.ts` | The CLI |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-readiness-orchestrator.test.ts` | 67 tests, including static import guards, a full fixture × decision permission sweep, and 13A–13G regressions |

Run the tests with:

```bash
node --import tsx --test src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-readiness-orchestrator.test.ts
```

## Flags

```
OPS_BR_13H_CONTROLLED_EXECUTION_READINESS_ORCHESTRATOR_AUTHORIZED = true
OPS_BR_13H_CONTROLLED_EXECUTION_READINESS_ORCHESTRATOR_PR_READY = false until PR
OPS_BR_13H_CONTROLLED_EXECUTION_READINESS_ORCHESTRATOR_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = true
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_OFFICIAL = true
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13F_CONTROLLED_EXECUTION_ATTEMPT_PLAN_GENERATOR_OFFICIAL = true
OPS_BR_13G_CONTROLLED_EXECUTION_ATTEMPT_RUNNER_SCAFFOLD_OFFICIAL = true

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

## Conclusion

Readiness report is not execution authorization.

Brazil remains blocked.
