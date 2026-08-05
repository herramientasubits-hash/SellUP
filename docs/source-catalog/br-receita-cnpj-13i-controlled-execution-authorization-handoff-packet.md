# BR Receita CNPJ — controlled execution authorization handoff packet (BR-SOURCE-13I)

## Purpose

BR-SOURCE-13H answers the question a reader arrives with — "is Brazil ready?" — and answers it `NO_GO`
over a chain that is fully operational. What it does not answer is the question that follows immediately:
"then what, exactly, is missing, and who has to decide it?"

A readiness report enumerates blockers, and a blocker describes a state. A person who has to unblock
Brazil needs something else: **decisions**, addressed to named owners, each one bounded so that granting
it cannot be read as granting the next.

BR-SOURCE-13I is that document. It consumes the BR-SOURCE-13H readiness report and emits a formal
authorization handoff packet for owner, legal / privacy / security, technical and commercial review. It
separates the nine pending decisions, states for each one who should decide it, what deciding it would
achieve, and — the load-bearing field — what deciding it would **not** achieve.

It is pure, deterministic, synthetic-only and fail-closed. It changes nothing.

## Central rule

```
handoff_packet_ready  ≠  execution_authorized
human_decision_packet ≠  owner approval
```

> Authorization handoff packet is not execution authorization.

The first line is what this module exists to hold. A handoff packet is, by construction, the most
approval-shaped artefact in the whole chain: it is addressed to owners, it lists decisions, and it is
explicitly "ready for human decision". Every one of those properties describes a document that has been
**prepared**, and none of them describes a decision that has been **made**. Preparing a decision request
is not answering it, and a packet that is ready to be reviewed is precisely a packet that has not been
reviewed.

The second line guards the other direction. This module writes the nine decisions down together with who
should take each one; it does not take any of them, and it has no input by which an approval could be
supplied. The `--decision` value it accepts is a *synthetic reviewer position* travelling down from
BR-SOURCE-13E, whose own verdict is `approved_for_next_planning_review` — permission to keep planning,
never permission to run.

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
```

| Component | What it contributes to 13I |
| --- | --- |
| **13A** | Validates the owner decision artifact. Reached only through 13B. |
| **13B** | Evaluates the controlled execution preflight and delegates the artifact to 13A. |
| **13C** | Supplies the named **synthetic** fixture. There is no real-data path in. |
| **13D** | Builds the review request packet whose readiness 13E judges. |
| **13E** | Supplies the reviewer position (`approve` / `reject` / `defer`) and its verdict. |
| **13F** | Produces the controlled execution attempt plan, with no executable command in it. |
| **13G** | Walks that plan and refuses every step, producing the attempt record. |
| **13H** | Summarizes all of the above into the readiness report 13I hands over, verbatim. |

13I re-implements none of those rules. Every upstream verdict it prints was produced upstream, and the
13H report travels inside the packet unchanged.

## Usage

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts --fixture synthetic-ready --decision approve --format json
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts --fixture synthetic-ready --decision approve --format json --pretty
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts --fixture synthetic-ready --decision approve --format markdown
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts --fixture synthetic-ready --decision reject --format json
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts --fixture missing-owner-artifact --decision approve --format json
```

Output goes to stdout only. No file is ever created.

### Accepted arguments

| Flag | Values | Required |
| --- | --- | --- |
| `--fixture` | a BR-SOURCE-13C synthetic fixture name | yes |
| `--decision` | `approve` \| `reject` \| `defer` | yes |
| `--format` | `json` \| `markdown` | yes |
| `--pretty` | none (indents JSON; ignored for Markdown) | no |

### Refused arguments

Every one of the following is a fail-closed usage error, in both `--flag value` and `--flag=value` form,
wherever it appears in the argument vector:

`--manifest`, `--input`, `--input-dir`, `--output`, `--output-dir`, `--path`, `--dir`, `--file`, `--csv`,
`--zip`, `--real-data`, `--execute`, `--run`, `--apply`, `--force`, `--import`, `--activate`,
`--approve`, `--authorize`, `--gate2`, `--gate7`, `--supabase`, `--production`, `--runtime`, `--agent1`.

Unknown flags and positional arguments are refused too, including positionals shaped like a location.

`--approve` deserves its own note. It is the flag this CLI would most plausibly be expected to have — the
packet it prints is a list of nine decisions, so a reader may reasonably look for the switch that answers
one. There is none, and there will not be one. An approval is a human act recorded outside this
repository; a command-line flag that claimed to grant one would be the single most dangerous argument in
the whole chain. It is refused for exactly the same reason as `--execute`.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | A packet was produced. Every packet is `NO_GO`; a refusal is the artefact, not an error. |
| `1` | The arguments were unusable. Nothing was produced, and the reason code is on stderr. |

## The two statuses

| Status | Precondition | `humanDecisionPacketReady` |
| --- | --- | --- |
| `handoff_ready_for_human_decision` | 13H reported `synthetic_chain_operational_execution_blocked` | `true` |
| `handoff_blocked_by_readiness` | 13H reported `synthetic_chain_blocked` | `false` |

`handoff_ready_for_human_decision` is named for the **review** being ready, not for anything being
permitted. It means the synthetic chain ran end to end, so a coherent packet exists to hand over. It does
not mean a decision was taken, an approval was granted, or a run became possible.

`handoff_blocked_by_readiness` is the earlier refusal: the chain stopped before a reviewable plan
existed, so there is no coherent decision packet yet.

**Neither status is a pass.** In every case:

```
goNoGo              = NO_GO
authorizationStatus = not_authorized
brazilReadiness     = blocked
handoffConclusion   = OWNER_LEGAL_SECURITY_DECISION_REQUIRED
readinessConclusion = BRAZIL_REMAINS_BLOCKED
```

`authorizationStatus` and `brazilReadiness` are single-member unions in the TypeScript source, so an
`authorized` and a `ready` cannot be spelled at all. Marking Brazil ready is not a value this module can
produce — it is a change to the module's public contract.

## The nine pending decisions

Always exactly nine, over every fixture and every decision value. Each entry carries `decisionOwner`,
`currentStatus`, `requiredDecision`, `approvalEffect`, `approvalDoesNotGrant` and
`separateAuthorizationRequired: true`.

| # | `decisionId` | Owner | Current status |
| --- | --- | --- | --- |
| 1 | `OWNER_COMPLETION_RESUBMISSION` | `owner` | `missing` |
| 2 | `GATE_2_ROUTE_DECISION` | `owner` | `not_approved` |
| 3 | `GATE_7_PRIVACY_SECURITY_DECISION` | `legal_security_privacy` | `not_approved` |
| 4 | `CAP_INPUT_POLICY_APPROVAL` | `technical_owner` | `not_approved` |
| 5 | `CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION` | `owner` | `not_authorized` |
| 6 | `FULL_JOIN_EXECUTION_AUTHORIZATION` | `technical_owner` | `not_authorized` |
| 7 | `IMPORT_AUTHORIZATION` | `technical_owner` | `not_authorized` |
| 8 | `RUNTIME_AUTHORIZATION` | `technical_owner` | `not_authorized` |
| 9 | `AGENT1_AUTHORIZATION` | `commercial_operations` | `not_authorized` |

`currentStatus` has no `approved` and no `authorized` member, so no packet can report a decision as
taken.

### Why nine and not one

The nine are separated because they are genuinely independent, and because folding them together is the
specific failure this chain was built to prevent:

- Approving **GATE-2** does not authorize import.
- Approving **GATE-7** does not authorize import.
- An approved **cap and input policy** does not authorize runtime.
- Authorizing a **full join** does not authorize import.
- Authorizing **import** does not authorize runtime.
- Authorizing **runtime** does not authorize Agent 1.
- Authorizing **Agent 1** cannot skip GATE-2, GATE-7 or the cap and input policy.

The last one matters most: Agent 1 is where a credit is actually spent, so it is where an implied
approval becomes an invoice.

Every decision therefore carries its own non-empty `approvalDoesNotGrant` list. A reader who approves one
line has, in the same artefact, the list of things they did not approve.

## Unresolved authorizations

`unresolvedAuthorizations` lists all nine decision ids, for every fixture and every decision value. The
requested set and the unresolved set are always the same set: nothing in this module can resolve one.

## Blockers

Eleven blockers are unconditional, in this order:

```
OWNER_COMPLETION_RESUBMISSION_NOT_RECEIVED
OWNER_DECISIONS_NOT_CAPTURED
GATE_2_REMAINS_NOT_APPROVED
GATE_7_REMAINS_NOT_APPROVED
CAP_INPUT_POLICY_REMAINS_NOT_APPROVED
CONTROLLED_EXECUTION_ATTEMPT_NOT_AUTHORIZED
FULL_JOIN_EXECUTION_NOT_AUTHORIZED
IMPORT_NOT_AUTHORIZED
RUNTIME_NOT_AUTHORIZED
AGENT1_NOT_AUTHORIZED
BRAZIL_REMAINS_BLOCKED
```

The list is unconditional on purpose. A packet whose blocker list shrank when the synthetic chain ran
cleanly would be telling a reader that progress had been made on permission, when the only progress was
in software.

Every blocker BR-SOURCE-13H reported is then appended with the `READINESS/` prefix, so provenance stays
visible. A blocker this packet owns is closed by a human decision; a `READINESS/` blocker is closed — if
ever — by the chain reporting differently, and erasing the prefix would send a reader to the wrong
artefact. Identical inherited ids collapse to one entry, in first-seen order, because a 13I blocker is a
bare string with no `layer` field to tell two copies apart.

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
```

The last three are the ones that matter here. A packet that requests nine approvals is the artefact most
likely to be mistaken for having received one, so it denies granting a gate approval, granting production
readiness, and granting execution authorization — explicitly, and separately.

## Required next human actions

```
HUMAN_REVIEW_AUTHORIZATION_HANDOFF_PACKET
OWNER_MUST_COMPLETE_RESUBMISSION
OWNER_MUST_CAPTURE_FORMAL_DECISIONS
LEGAL_PRIVACY_SECURITY_REVIEW_REQUIRED
GATE_2_DECISION_REQUIRED
GATE_7_DECISION_REQUIRED
CAP_INPUT_POLICY_DECISION_REQUIRED
CONTROLLED_EXECUTION_ATTEMPT_AUTHORIZATION_REQUIRED
FULL_JOIN_EXECUTION_AUTHORIZATION_REQUIRED
IMPORT_AUTHORIZATION_REQUIRED
RUNTIME_AUTHORIZATION_REQUIRED
AGENT1_AUTHORIZATION_REQUIRED
```

Unconditional: a packet over a fully operational chain removes none of them. The nine decision-shaped
lines mirror the nine decision requests one for one, deliberately — a single "obtain the necessary
authorizations" line would let one approval be read as covering all nine.

## What the handoff packet does NOT do

- **It does not execute anything.** The runner inside the report it consumes already refused every step;
  this module only reads that refusal. `executionStarted`, `executionAttempted` and `executionAuthorized`
  are literal `false` in the type.
- **It does not read data.** No manifest, no CSV, no ZIP, no control file, no dataset row. There is no
  filesystem module and no path module in the module or the CLI, and no location argument of any kind, so
  there is nothing to point at real data.
- **It does not approve a gate.** `gate2Approved`, `gate7Approved` and `capInputPolicyApproved` are
  literal `false`, and no argument can change them.
- **It does not authorize a cap or an attempt.** `controlledExecutionAttemptAuthorized` is literal
  `false`.
- **It does not activate import, runtime or Agent 1.** `importExecuted`, `supabaseWrites`,
  `runtimeActivated`, `agent1Activated` and `providerCalls` are literal `false`. No database is opened, no
  migration is applied, no provider is called and no credit can be spent.
- **It does not run a join or a coverage computation.** `joinExecuted` and `coverageExecuted` are literal
  `false`.
- **It does not mark Brazil ready.** `brazilReadiness` is the single-member union `blocked`.
- **It does not hand anything to anyone.** It prints a document; a printed document is not a delivered
  decision.
- **It does not re-implement an upstream rule.** Every verdict comes from 13A–13H.

It is a pure function with no clock and no randomness. The packet carries the chain's static synthetic
timestamp, so two runs are byte-identical, and both JSON and Markdown renderings are deterministic.

## Files

| Path | Role |
| --- | --- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts` | Pure module: packet types, the nine decisions, JSON and Markdown rendering |
| `scripts/source-catalog/br-receita-cnpj-controlled-execution-authorization-handoff-packet.ts` | CLI: argument parsing, refusals, stdout output |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-authorization-handoff-packet.test.ts` | Tests, including static import guards and 13A–13H regressions |
| `docs/source-catalog/br-receita-cnpj-13h-controlled-execution-readiness-orchestrator.md` | The upstream readiness report this packet hands over |

## Flags

```
OPS_BR_13I_CONTROLLED_EXECUTION_AUTHORIZATION_HANDOFF_PACKET_AUTHORIZED = true
OPS_BR_13I_CONTROLLED_EXECUTION_AUTHORIZATION_HANDOFF_PACKET_PR_READY = false until PR
OPS_BR_13I_CONTROLLED_EXECUTION_AUTHORIZATION_HANDOFF_PACKET_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = true
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_OFFICIAL = true
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13F_CONTROLLED_EXECUTION_ATTEMPT_PLAN_GENERATOR_OFFICIAL = true
OPS_BR_13G_CONTROLLED_EXECUTION_ATTEMPT_RUNNER_SCAFFOLD_OFFICIAL = true
OPS_BR_13H_CONTROLLED_EXECUTION_READINESS_ORCHESTRATOR_OFFICIAL = true

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

Note the shape of that block: eight official components and zero approvals. That is a coherent state, and
it is the state Brazil is actually in. Nine merged, working, official modules are a statement about
software; readiness is a statement about permission, and no amount of working software produces
permission.

## Conclusion

- `handoffConclusion` = **`OWNER_LEGAL_SECURITY_DECISION_REQUIRED`**
- `readinessConclusion` = **`BRAZIL_REMAINS_BLOCKED`**

> Authorization handoff packet is not execution authorization.

> Brazil remains blocked.
