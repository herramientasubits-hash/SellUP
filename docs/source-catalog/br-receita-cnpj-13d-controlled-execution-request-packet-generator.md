# BR-SOURCE-13D — Receita CNPJ controlled execution request packet generator

**Status:** PR open, not merged. Nothing in this module changes any gate.

## Purpose

BR-SOURCE-13A, 13B and 13C made the Brazil owner decision chain executable and inspectable. What
none of them produce is the ARTEFACT a human reviewer is actually asked to read: a single document
that states what is being requested, what the chain decided, and — above all — everything the
document does **not** grant.

13D is that artefact generator:

```text
13C synthetic fixture
  → 13B controlled execution preflight evaluator (which delegates the artifact to 13A)
  → 13D request packet
  → JSON or Markdown on stdout
```

It produces a request for review. It authorizes nothing.

**Ready for review is not ready for execution.**

## Relationship with 13A, 13B and 13C

| Module                                                                | Question it answers                                                      | Role here                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| **13A** `br-receita-cnpj-owner-decision-validator.ts`                 | Is this owner artifact complete, consistent and free of unsafe content?   | Invoked by 13B; 13D never re-implements its rules        |
| **13B** `br-receita-cnpj-controlled-execution-preflight-evaluator.ts` | May this _request_ proceed to a controlled execution attempt **review**? | The single evaluator 13D calls; its result is embedded verbatim |
| **13C** synthetic fixtures + harness                                  | Can the chain be executed and inspected without real data?               | Supplies the nine named synthetic requests                |
| **13D** generator + CLI                                               | What document does a reviewer read, and what does it withhold?            | Wraps the 13B verdict in a reviewable packet               |

13D adds no rule and relaxes none. Every verdict it prints was produced by 13A and 13B; the packet's
`preflight` field is byte-equal to what 13B returns when called directly, and a test asserts that for
all nine fixtures.

## Files

| Path                                                                                                                                  | Role                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-controlled-execution-request-packet-generator.ts`                | Pure module: builds the packet, renders Markdown, serializes JSON. Two imports (13C, 13B), no I/O    |
| `scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts`                                              | CLI. Reads `process.argv`, writes stdout/stderr, nothing else                                        |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-controlled-execution-request-packet-generator.test.ts` | Packet verdicts, blockers, determinism, both formats, CLI usage and refusals, static guards, 13C regression |

## Usage

JSON:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts --fixture synthetic-ready --format json
```

Indented JSON:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts --fixture synthetic-ready --format json --pretty
```

Markdown:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts --fixture synthetic-ready --format markdown
```

A blocked fixture (still exit 0 — the refusal is the artefact worth reading):

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-controlled-execution-request-packet-generator.ts --fixture missing-owner-artifact --format json
```

## Flags

| Flag                        | Required | Meaning                                            |
| --------------------------- | -------- | -------------------------------------------------- |
| `--fixture <name>`          | yes      | One of the nine BR-SOURCE-13C synthetic fixtures    |
| `--format <json\|markdown>` | yes      | Output format written to stdout                      |
| `--pretty`                  | no       | Indents JSON. Ignored for Markdown                   |

Both `--fixture` and `--format` also accept the `--flag=value` form. Nothing else is accepted.

### Rejected flags

These are refused before anything is generated, in bare and in `--flag=value` form:

`--manifest`, `--input`, `--input-dir`, `--output`, `--output-dir`, `--path`, `--dir`, `--file`,
`--csv`, `--zip`, `--real-data`, `--execute`, `--import`, `--supabase`, `--production`, `--runtime`,
`--agent1`.

They are not unimplemented — there is no code path for a location, a payload or a real-data run, and
there never will be one in this module.

### Exit codes and error codes

| Exit | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| `0`  | A packet was generated, whether its status is `ready_for_review` or `blocked` |
| `1`  | The ARGUMENTS were unusable; nothing was generated and stdout stays empty  |

| Error code                        | Cause                                     |
| --------------------------------- | ----------------------------------------- |
| `BRSOURCE13D_FIXTURE_REQUIRED`    | `--fixture` absent or without a value      |
| `BRSOURCE13D_FIXTURE_UNKNOWN`     | Fixture name outside the 13C catalogue     |
| `BRSOURCE13D_FORMAT_REQUIRED`     | `--format` absent or without a value       |
| `BRSOURCE13D_FORMAT_UNKNOWN`      | Format other than `json` or `markdown`     |
| `BRSOURCE13D_FORBIDDEN_ARGUMENT`  | A rejected flag from the list above        |
| `BRSOURCE13D_UNKNOWN_ARGUMENT`    | Any other argument, including a positional |

## JSON output

Shape, with the long `preflight` subtree elided:

```json
{
  "packetType": "br_receita_cnpj_controlled_execution_attempt_review_request",
  "version": 1,
  "generatedAt": "STATIC_SYNTHETIC_TIMESTAMP",
  "fixture": "synthetic-ready",
  "status": "ready_for_review",
  "goNoGo": "GO",
  "syntheticOnly": true,
  "realDataExecutionAuthorized": false,
  "importAuthorized": false,
  "runtimeAuthorized": false,
  "agent1Authorized": false,
  "gate2Approved": false,
  "gate7Approved": false,
  "capInputPolicyApproved": false,
  "preflight": { "status": "ready", "goNoGo": "GO", "...": "the full BR-SOURCE-13B result" },
  "ownerReviewRequest": {
    "requestedReview": "controlled_execution_attempt_review",
    "reviewMode": "synthetic_packet_only",
    "requiredHumanDecision": true,
    "approvalGrantedByThisPacket": false,
    "syntheticGoIsExecutionAuthorization": false
  },
  "safety": {
    "realDataAccessed": false,
    "pathInputAccepted": false,
    "manifestRead": false,
    "csvRead": false,
    "zipRead": false,
    "rowReads": false,
    "joinExecuted": false,
    "coverageExecuted": false,
    "importExecuted": false,
    "supabaseWrites": false,
    "runtimeActivated": false,
    "agent1Activated": false,
    "providerCalls": false
  },
  "requiredNextHumanActions": ["HUMAN_REVIEW_CONTROLLED_EXECUTION_ATTEMPT_REQUEST", "..."],
  "blockers": [],
  "disclaimer": "Synthetic GO is not real-data execution authorization."
}
```

The seven authorization fields and the thirteen safety fields are typed as the literal `false`. A
future edit that tried to grant one would have to change the module's exported type.

`generatedAt` is a fixed literal, not a clock reading, so two runs of the same fixture and format are
byte-identical. A test asserts that for all nine fixtures in both formats.

## Markdown output

The same packet, rendered for a human reader, in this fixed section order:

1. Header — packet type, version, timestamp, fixture, status, Go/No-Go, synthetic-only
2. **Authorizations withheld by this packet** — a seven-row table, every row `NO`
3. **Owner review request** — what is being asked of a human, and what the packet does not grant
4. **Preflight verdict (BR-SOURCE-13B)** — plus the delegated 13A owner-validation subsection
5. **Blockers** — every blocking finding, or `- none`
6. **Safety** — the thirteen safety facts, every row `NO`
7. **Required next human actions** — numbered
8. **Disclaimer** — the exact sentence, plus `Ready for review is not ready for execution.`

An approval inside a *synthetic* artifact is reported in section 4 for completeness, and section 2
remains the authoritative table: every row of it reads `NO`.

Rendering is a pure function of the packet, so the Markdown is deterministic too.

## `ready_for_review` vs `blocked`

| Status             | When                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `ready_for_review` | 13B returned `ready` / `GO`, said the request may proceed, and left no blocking finding — all three     |
| `blocked`          | Any of those failed, or any blocking finding survived                                                   |

Only `synthetic-ready` can reach `ready_for_review`. The other eight fixtures each isolate one
failure mode, so a reviewer can see exactly which rule fired.

`blockers` is derived from the 13B verdict, never invented here: 13B's own blocking findings are
prefixed `PREFLIGHT/`, and the delegated 13A blocking findings are prefixed `OWNER/`.

### `ready_for_review` does not authorize execution

`ready_for_review` names a DOCUMENT transition — a human may now be asked to READ the request. It is
not an owner decision, not a gate approval, not a cap approval, and not permission to read a byte of
the dataset. When a packet is `ready_for_review`, `requiredNextHumanActions` still contains all six
unconditional actions, including the three that restate that GATE-2, GATE-7 and the cap/input policy
remain unapproved.

**Ready for review is not ready for execution.**

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
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_AUTHORIZED = true
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_PR_READY = false until PR
OPS_BR_13D_CONTROLLED_EXECUTION_REQUEST_PACKET_GENERATOR_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = true

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

Ready for review is not ready for execution.
