# BR-SOURCE-13C — Receita CNPJ synthetic owner artifact harness

**Status:** PR open, not merged. Nothing in this module changes any gate.

## Purpose

BR-SOURCE-13A and 13B are pure functions with no runner. Until 13C, the only way to watch the
Brazil owner decision chain execute was to read a test file, and the only way to feed it an owner
artifact was to hand-type fifty-one fields — none of which exist, because every owner field in the
11W…12B packets still reads `TBD_BY_OWNER`.

13C closes that gap with SYNTHETIC input and a CLI:

```text
synthetic owner artifact
  → 13A owner decision validator
  → 13B controlled execution preflight evaluator
  → JSON report on stdout
```

It demonstrates the flow. It authorizes nothing.

## Relationship with 13A and 13B

| Module                                                                | Question it answers                                                      | Role here                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| **13A** `br-receita-cnpj-owner-decision-validator.ts`                 | Is this owner artifact complete, consistent and free of unsafe content?  | Invoked by 13B; 13C never re-implements its rules  |
| **13B** `br-receita-cnpj-controlled-execution-preflight-evaluator.ts` | May this _request_ proceed to a controlled execution attempt **review**? | The single entry point 13C calls                   |
| **13C** fixtures + harness                                            | Can the chain be executed and inspected without real data?               | Supplies synthetic requests and prints the verdict |

13C adds no rule and relaxes none. Every verdict in its output is produced by 13A and 13B.

## Files

| Path                                                                                                                      | Role                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-synthetic-owner-artifact-fixtures.ts`               | Nine named synthetic preflight requests. TYPE imports only — contributes no runtime dependency                 |
| `scripts/source-catalog/br-receita-cnpj-synthetic-owner-artifact-harness.ts`                                              | CLI. Reads `process.argv`, writes stdout/stderr, nothing else                                                  |
| `src/server/source-catalog/connectors/br-receita-cnpj/__tests__/br-receita-cnpj-synthetic-owner-artifact-harness.test.ts` | 36 tests: per-fixture verdicts, CLI usage and refusals, determinism, static guards, real-data permission sweep |

## Usage

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-synthetic-owner-artifact-harness.ts --fixture synthetic-ready
```

Indented output:

```bash
node --import tsx scripts/source-catalog/br-receita-cnpj-synthetic-owner-artifact-harness.ts --fixture synthetic-ready --pretty
```

Accepted flags: `--fixture <name>` (required) and `--pretty` (optional). Nothing else.

## Fixtures

| Fixture                            | Verdict             | Blocking reason                                                              |
| ---------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| `synthetic-ready`                  | `ready` / `GO`      | — (review readiness only)                                                    |
| `missing-owner-artifact`           | `blocked` / `NO_GO` | 13A `OWNER_ARTIFACT_MISSING`                                                 |
| `placeholder-owner-artifact`       | `blocked` / `NO_GO` | 13A `OWNER_FIELD_PLACEHOLDER` — a field still holds `TBD_BY_OWNER`           |
| `forbidden-content-owner-artifact` | `blocked` / `NO_GO` | 13A `OWNER_FIELD_FORBIDDEN_CONTENT` — a field carries an absolute local path |
| `missing-stage`                    | `blocked` / `NO_GO` | 13B `PREFLIGHT_STAGE_INVALID`                                                |
| `missing-safety-flag`              | `blocked` / `NO_GO` | 13B `PREFLIGHT_REQUIRED_SAFETY_FLAG_MISSING` — `noRowReads` left unstated    |
| `invalid-evidence-mode`            | `blocked` / `NO_GO` | 13B `PREFLIGHT_EVIDENCE_MODE_INVALID` — dataset evidence is not a mode       |
| `rejected-owner-decision`          | `blocked` / `NO_GO` | 13A `OWNER_DECISION_REJECTED`                                                |
| `deferred-owner-decision`          | `blocked` / `NO_GO` | 13A `OWNER_DECISION_DEFERRED` — a deferral is not an approval                |

Each fixture isolates one failure mode, so a reviewer can see exactly which rule fired.

## Output

```json
{
  "harness": "br-receita-cnpj-synthetic-owner-artifact-harness",
  "version": 1,
  "fixture": "synthetic-ready",
  "generatedAt": "STATIC_SYNTHETIC_TIMESTAMP",
  "result": {
    "status": "ready",
    "goNoGo": "GO",
    "canProceedToControlledExecutionAttemptReview": true,
    "canExecuteRealData": false,
    "canReadManifest": false,
    "canReadCsv": false,
    "canReadZip": false,
    "canReadRows": false,
    "canImport": false,
    "canWriteSupabase": false,
    "canActivateRuntime": false,
    "canActivateAgent1": false,
    "ownerDecisionValidation": { "status": "valid", "goNoGo": "GO" },
    "findings": []
  },
  "safety": {
    "syntheticOnly": true,
    "realDataAccessed": false,
    "manifestRead": false,
    "csvRead": false,
    "zipRead": false,
    "rowReads": false,
    "joinExecuted": false,
    "coverageExecuted": false,
    "importExecuted": false,
    "supabaseWrites": false,
    "runtimeActivated": false,
    "agent1Activated": false
  },
  "disclaimer": "Synthetic GO is not real-data execution authorization."
}
```

`ownerDecisionValidation` and `findings` are abbreviated above; the real report carries them in full.

`generatedAt` is a fixed literal, not a clock reading, so two runs of the same fixture are
byte-identical — a test asserts it.

### Exit codes

| Code | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| `0`  | A known fixture ran. Includes `blocked` verdicts: a refusal is a correct outcome |
| `1`  | The arguments were unusable and nothing ran. Reason on stderr as `BRSOURCE13C_*` |

Usage error codes: `BRSOURCE13C_FIXTURE_REQUIRED`, `BRSOURCE13C_FIXTURE_UNKNOWN`,
`BRSOURCE13C_FORBIDDEN_ARGUMENT`, `BRSOURCE13C_UNKNOWN_ARGUMENT`.

## Safety rules

The harness takes a fixture NAME and nothing else. It has no code path that accepts a location, so
there is no argument — and no combination of arguments — that could point it at the dataset.

- No path argument. `--manifest`, `--input`, `--output`, `--path`, `--csv`, `--zip`, `--real-data`,
  `--execute`, `--import`, `--supabase`, `--runtime` and `--agent1` are refused by name, including in
  `--flag=value` form. Their mere presence exits 1 before anything runs.
- No `fs`, no `path`, no `child_process`, no network, no `process.env`. The harness touches `process`
  only through `argv`, `stdout`, `stderr` and `exitCode`.
- No clock and no randomness, so the report is deterministic.
- The fixture module takes TYPE imports only, so it contributes no executable dependency.
- Fixture content is opaque and synthetic: no real path, no host, no address-shaped value, no
  credential, no CNPJ, no CPF, and no cap number — the cap field states a policy only.
- Static guards in the test suite enforce all of the above against the real source files, so a future
  edit that reached for `fs` or a clock would fail the suite.

## What this does NOT do

It does not read real data. It does not read the manifest, a CSV, a ZIP, a control file, or a single
dataset row. It does not execute a join or a coverage computation. It does not import, does not write
to Supabase, and does not run a migration. It does not touch runtime, Agent 1, or any provider. It
calls no external API and spends no credits. It changes no UI. It approves no gate, authorizes no
cap, and marks nothing ready.

## What a GO means

A `synthetic-ready` GO means one thing: the synthetic flow is wired and executable, and a
13A-complete artifact carried by a fully asserted request would be eligible for a controlled
execution attempt **review** — a documentary step.

It is not a gate approval, not a cap approval, not an owner decision, not evidence, and not
permission to read a byte of the dataset. The nine real-data permissions are typed as the literal
`false` by 13B, so no fixture and no future edit can flip one without changing 13B's public type.

**Synthetic GO is not real-data execution authorization.**

Brazil remains blocked.

## Flags

```text
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_AUTHORIZED = true
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_PR_READY = false until PR
OPS_BR_13C_SYNTHETIC_OWNER_ARTIFACT_HARNESS_OFFICIAL = false until merge

OPS_BR_13A_OWNER_DECISION_VALIDATOR_OFFICIAL = true
OPS_BR_13B_CONTROLLED_EXECUTION_PREFLIGHT_EVALUATOR_OFFICIAL = true

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

The synthetic fixtures are not an owner submission: `OPS_BR_OWNER_DECISIONS_CAPTURED` stays `false`
precisely because no real owner decision exists.
