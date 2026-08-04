# BR-SOURCE-13E — Receita CNPJ controlled execution review decision validator

**Status:** PR open, not merged. Nothing in this module changes any gate.

## Purpose

BR-SOURCE-13D produces the artefact a human reviewer is asked to read: a request packet that may
reach `ready_for_review`. What the chain still could not express is the reviewer's **answer**. A human
who reads a packet says one of three things — approve, reject, defer — and until now that answer had
nowhere to live and no rule to check it against.

13E is that check:

```text
13C synthetic fixture
  → 13B controlled execution preflight evaluator (which delegates the artifact to 13A)
  → 13D request packet
  → 13E review decision validation
  → JSON or Markdown on stdout
```

It validates a decision about a document. It authorizes nothing.

**Review approval is not execution authorization.**

## Relationship with 13A, 13B, 13C and 13D

| Module                                                                | Question it answers                                                      | Role here                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **13A** `br-receita-cnpj-owner-decision-validator.ts`                 | Is this owner artifact complete, consistent and free of unsafe content?   | Invoked by 13B; 13E never re-implements its rules                |
| **13B** `br-receita-cnpj-controlled-execution-preflight-evaluator.ts` | May this _request_ proceed to a controlled execution attempt **review**?  | Invoked by 13D; its verdict travels inside the packet            |
| **13C** synthetic fixtures + harness                                  | Can the chain be executed and inspected without real data?               | Supplies the nine named synthetic requests                       |
| **13D** request packet generator + CLI                                | What document does a reviewer read, and what does it withhold?            | Produces the packet 13E validates a decision **over**            |
| **13E** review decision validator + CLI                               | Is this reviewer's decision complete, safe, and about a reviewable packet? | Records the answer; grants nothing                             |

13E adds no upstream rule and relaxes none. It reads 13D's own exported identity, version, disclaimer
and withheld-authorization constants, so the two can never drift, and a test asserts the packet
embedded in every report is byte-equal to what 13D produces on its own.

## Files

| Path                                                                                                                                   | Role                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-review-decision-validator.ts`                | Pure module: validates a decision, builds the synthetic report, renders Markdown, serializes JSON. Two imports (13D, 13C types), no I/O |
| `scripts/source-catalog/br-receita-cnpj-controlled-execution-review-decision-validator.ts`                                              | CLI. Reads `process.argv`, writes stdout/stderr, nothing else                                                      |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-review-decision-validator.test.ts` | Outcomes, field hygiene, packet checks, determinism, both formats, CLI usage and refusals, static guards, 13D/13C/13B/13A regressions |

## Usage

JSON:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-review-decision-validator.ts --fixture synthetic-ready --decision approve --format json
```

Indented JSON:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-review-decision-validator.ts --fixture synthetic-ready --decision approve --format json --pretty
```

Markdown:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-review-decision-validator.ts --fixture synthetic-ready --decision approve --format markdown
```

A rejection (still exit 0 — a recorded refusal is a correct outcome):

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-review-decision-validator.ts --fixture synthetic-ready --decision reject --format json
```

An approval over a packet that never became reviewable (exit 0, verdict `blocked`):

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-review-decision-validator.ts --fixture missing-owner-artifact --decision approve --format json
```

## Flags

| Flag                                | Required | Meaning                                          |
| ----------------------------------- | -------- | ------------------------------------------------ |
| `--fixture <name>`                  | yes      | One of the nine BR-SOURCE-13C synthetic fixtures  |
| `--decision <approve\|reject\|defer>` | yes      | The synthetic reviewer position to validate       |
| `--format <json\|markdown>`         | yes      | Output format written to stdout                   |
| `--pretty`                          | no       | Indents JSON. Ignored for Markdown                |

All three value flags also accept the `--flag=value` form. Nothing else is accepted.

### Rejected flags

These are refused before anything is produced, in bare and in `--flag=value` form:

`--manifest`, `--input`, `--input-dir`, `--output`, `--output-dir`, `--path`, `--dir`, `--file`,
`--csv`, `--zip`, `--real-data`, `--execute`, `--import`, `--supabase`, `--production`, `--runtime`,
`--agent1`.

They are not unimplemented — there is no code path for a location, a payload or a real-data run, and
there never will be one in this module.

### Exit codes and error codes

| Exit | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| `0`  | A verdict was produced, whether its outcome is approved, rejected, deferred or blocked            |
| `1`  | The ARGUMENTS were unusable; nothing was produced and stdout stays empty                          |

| Error code                       | Cause                                              |
| -------------------------------- | -------------------------------------------------- |
| `BRSOURCE13E_FIXTURE_REQUIRED`   | `--fixture` absent or without a value               |
| `BRSOURCE13E_FIXTURE_UNKNOWN`    | Fixture name outside the 13C catalogue              |
| `BRSOURCE13E_DECISION_REQUIRED`  | `--decision` absent or without a value              |
| `BRSOURCE13E_DECISION_UNKNOWN`   | Decision other than `approve`, `reject` or `defer`   |
| `BRSOURCE13E_FORMAT_REQUIRED`    | `--format` absent or without a value                |
| `BRSOURCE13E_FORMAT_UNKNOWN`     | Format other than `json` or `markdown`              |
| `BRSOURCE13E_FORBIDDEN_ARGUMENT` | A rejected flag from the list above                 |
| `BRSOURCE13E_UNKNOWN_ARGUMENT`   | Any other argument, including a positional          |

Note the decision vocabulary is `approve` / `reject` / `defer` — the reviewer's position on a
document. 13A's owner vocabulary is the past-tense `approved` / `rejected` / `deferred`, and the two
are deliberately not interchangeable: passing an owner spelling to `--decision` is refused.

## Decisions

| Decision  | Outcome                             | Status    | Go / No-Go | May advance |
| --------- | ----------------------------------- | --------- | ---------- | ----------- |
| `approve` | `approved_for_next_planning_review` | `valid`   | `GO`       | yes — to a planning / review step only |
| `reject`  | `rejected`                          | `valid`   | `NO_GO`    | no          |
| `defer`   | `deferred`                          | `valid`   | `NO_GO`    | no          |
| anything incomplete, unsafe or unrecognized | `blocked`         | `invalid` | `NO_GO`    | no          |

A rejection and a deferral are **valid decisions**, not errors: the reviewer answered, and the answer
was no. Neither lets the request advance. Only `approve` sets
`canProceedToControlledExecutionAttemptPlanningReview`.

### What `approve` requires

An `approve` is accepted only when the packet is a genuine 13D `ready_for_review` / `GO` packet **and**
the decision carries all seven identity fields — `reviewerRole`, `reviewerReference`, `decisionDate`,
`expirationOrReviewDate`, `reviewedPacketType`, `reviewedFixture`, `approvalScope` — plus
`reviewedPacketVersion`, an `approvalScope` of exactly `synthetic_review_only`, and all thirteen
acknowledgements stated explicitly as `true`:

`requiredHumanDecisionAcknowledged`, `readyForReviewIsNotReadyForExecutionAccepted`,
`syntheticGoIsNotExecutionAuthorizationAccepted`, `noRealDataExecutionAccepted`,
`noManifestReadAccepted`, `noCsvZipReadAccepted`, `noRowReadsAccepted`, `noImportAccepted`,
`noSupabaseWritesAccepted`, `noRuntimeAccepted`, `noAgent1Accepted`, `noProviderCallsAccepted`,
`stopConditionsAccepted`.

Absent and `false` block identically: a reviewer who did not state an acknowledgement has not accepted
it. A `reject` or a `defer` needs none of them — only a recognized decision value.

The decision must also be about **this** packet: a `reviewedPacketType`, `reviewedPacketVersion` or
`reviewedFixture` that disagrees with the packet describes a different document and blocks.

### What `approve` does NOT do

`approve` names a DOCUMENT transition — a human read a synthetic packet and agreed the request may
advance to a future **planning / review** step for a controlled execution attempt. It is not an owner
decision, not a gate approval, not a cap approval, and not permission to read a byte of the dataset.

An approved review:

- does **not** execute anything, on real data or otherwise;
- does **not** approve GATE-2, GATE-7 or the cap / input policy;
- does **not** authorize a controlled execution attempt;
- does **not** activate import, runtime or Agent 1, and calls no provider;
- does **not** read a manifest, a CSV, a ZIP or a dataset row, and runs no join or coverage.

The ten permission fields (`canExecuteRealData`, `canReadManifest`, `canReadCsv`, `canReadZip`,
`canReadRows`, `canImport`, `canWriteSupabase`, `canActivateRuntime`, `canActivateAgent1`,
`canCallProviders`) and the four approval fields (`gate2Approved`, `gate7Approved`,
`capInputPolicyApproved`, `controlledExecutionAttemptAuthorized`) are typed as the literal `false`. A
future edit that tried to grant one would have to change the module's exported type.

Every result also carries the info finding `REVIEW_DECISION_IS_NOT_EXECUTION_AUTHORIZATION`, on an
approval included.

**Review approval is not execution authorization.**

## The packet under review

A review decision is only meaningful over a genuine reviewable packet, so the validator checks the
packet before it reads the decision. It blocks when the packet:

| Check                                                        | Finding                                        |
| ------------------------------------------------------------ | ---------------------------------------------- |
| absent                                                       | `REVIEW_PACKET_MISSING`                        |
| wrong `packetType`, `version` other than 1, not synthetic-only | `REVIEW_PACKET_INVALID`                        |
| `status` other than `ready_for_review`, or Go/No-Go other than `GO` | `REVIEW_PACKET_NOT_READY`                |
| any of 13D's seven authorization fields not `false`          | `REVIEW_PACKET_AUTHORIZATION_FIELD_NOT_FALSE`  |
| missing or altered disclaimer                                | `REVIEW_PACKET_DISCLAIMER_MISSING`             |

Only `synthetic-ready` yields a reviewable packet. The other eight fixtures each isolate one upstream
failure mode, so an approval over any of them is `blocked` — a reviewer cannot approve a request the
chain already refused.

## Decision findings

| Finding                                     | Severity | Cause                                                                 |
| ------------------------------------------- | -------- | --------------------------------------------------------------------- |
| `REVIEW_DECISION_INPUT_MISSING`             | blocking | No validation input at all                                             |
| `REVIEW_DECISION_MISSING`                   | blocking | No decision object                                                     |
| `REVIEW_DECISION_VALUE_MISSING`             | blocking | Decision value absent, empty, whitespace-only or still a placeholder    |
| `REVIEW_DECISION_VALUE_UNRECOGNIZED`        | blocking | Decision value outside `approve` / `reject` / `defer`                   |
| `REVIEW_DECISION_FIELD_PLACEHOLDER`         | blocking | A field is empty, whitespace-only or still holds the packet placeholder |
| `REVIEW_DECISION_FORBIDDEN_CONTENT`         | blocking | A field carries unsafe content (see below)                             |
| `REVIEW_DECISION_REQUIRED_FIELD_MISSING`    | blocking | An `approve` is missing a required identity field                       |
| `REVIEW_DECISION_REQUIRED_ACK_MISSING`      | blocking | An `approve` is missing an acknowledgement, or states it as `false`     |
| `REVIEW_DECISION_APPROVAL_SCOPE_INVALID`    | blocking | An `approve` claims a scope wider than `synthetic_review_only`          |
| `REVIEW_DECISION_PACKET_MISMATCH`           | blocking | The decision describes a different packet than the one under review     |
| `REVIEW_DECISION_REJECTED`                  | info     | The reviewer rejected the request                                       |
| `REVIEW_DECISION_DEFERRED`                  | info     | The reviewer deferred the request                                       |
| `REVIEW_DECISION_IS_NOT_EXECUTION_AUTHORIZATION` | info | Present on every result, approval included                             |

### Unsafe content

Seventeen substring patterns are refused in any decision field: the absolute local path prefix, the
local download directory name, the real manifest file name, the real dataset root and its two
subtree names, the manifest input subtree name, the personal profile host, address-shaped values, the
database connection prefix, the privileged database role and env-var names, both private key block
markers, and the JWT-, API-key- and chat-token-shaped prefixes. Matching is never anchored on digits,
so a synthetic date survives untouched.

The tokens are assembled from harmless parts at module load, so neither the module nor its test
contains a location-, host- or credential-shaped literal.

## Determinism and purity

`validateBrazilReceitaControlledExecutionReviewDecision` is a pure function: same packet and same
decision, same result. It never mutates its input, reads no clock and uses no randomness. The report
carries 13D's static timestamp, so two runs of the same fixture, decision and format are
byte-identical — a test asserts that for all three decision values.

## What this does not do

- No real data access. No path input: there is no location parameter anywhere in the module or CLI.
- No manifest, control-file, CSV or ZIP reading. No dataset row reads.
- No join. No coverage computation. No exact percentages.
- No import. No Supabase client, no writes, no migrations.
- No runtime integration. No Agent 1 integration. No provider calls.
- No filesystem writes of any kind — output goes to stdout and nowhere else.
- No UI changes. No feature flags touched. No gate approved. No cap authorized.
- Brazil remains blocked.

## Flags of record

```text
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_AUTHORIZED = true
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_PR_READY = false until PR
OPS_BR_13E_CONTROLLED_EXECUTION_REVIEW_DECISION_VALIDATOR_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = true
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_OFFICIAL = true

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

Review approval is not execution authorization.
