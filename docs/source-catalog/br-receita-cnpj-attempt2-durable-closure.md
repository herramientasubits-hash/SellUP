# BR Receita CNPJ — ATTEMPT #2 DURABLE CLOSURE

**Milestone:** BR-SOURCE-ATTEMPT2-CLOSURE
**Scope:** record the factual outcome of the second real benchmark attempt, durably.
**Engine changes:** none. **Cap changes:** none. **Benchmark executed by this PR:** none.
**Real data rows opened during this PR:** 0.

---

## 1. What happened, and why a PR was needed to write it down

Attempt #2 ran on 2026-08-12 against the full national 2026-07 input, on `origin/main` at `e7a1902a`.
It crossed the real-data boundary, read 205,520,896 bytes, and aborted 9,737 ms in on
`maxExternalMemoryBytes`. Under BR-SOURCE-14B.0J § 11 crossing the boundary spends the attempt, so the
attempt was consumed the moment the first source `read` happened — not when the run failed.

The run could *report* that. `commitCrossing()` latched, and `resultingAttemptsConsumed()` returned `2`,
which is the number the CLI printed. What no running process can do is edit a source constant. So the
durable record — `BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPTS_CONSUMED`, deliberately a reviewed constant
rather than a file or a row, because a counter the run can write is a counter the run can reset —
still read `1` after the run finished.

That gap was not cosmetic. While the count read `1`:

- `evaluateBrazilReceitaRealBenchmarkAttemptRequest(2)` returned `eligible: true`;
- `--readiness` reported `attemptsConsumed: 1`, `nextAttemptNumber: 2`, `attemptHistory` with a single
  entry, and `realFullScanBenchmarkReadyForOwnerAuthorization: true`;
- the entry point would have admitted a **second execution of attempt #2**, spending a 6-hour budget on
  an attempt already spent, with the only obstacle being the operator choosing not to pass the flags again.

Operator discipline is not a control. This PR is the control.

## 2. The durable ledger

`br-receita-cnpj-real-benchmark-attempt-ledger.ts`:

| Fact | Before | After |
|---|---|---|
| `..._ATTEMPTS_CONSUMED` | `1 as const` | **`2 as const`** |
| `..._STRUCTURALLY_SUPPORTED_ATTEMPTS` | `2 as const` | `2 as const` (**unchanged**) |
| `..._ATTEMPT_3_ALLOWED` | `false as const` | `false as const` (**unchanged**) |
| `brazilReceitaNextRealAttemptNumber()` | `2` | `3` |
| `brazilReceitaNextRealAttemptIsStructurallySupported()` | `true` | **`false`** |
| `brazilReceitaRealBenchmarkAttemptBudgetExhausted()` | — (new) | **`true`** |
| `..._ATTEMPT_HISTORY.length` | `1` | `2` |
| `brazilReceitaRealBenchmarkExecuted()` | `true` (derived) | `true` (derived) |

`NEXT_REAL_ATTEMPT_NUMBER` is expressed **through the contract that already existed**, not a new
sentinel. The pair `nextAttemptNumber: 3` + `nextAttemptStructurallySupported: false` is how this model
has always spelled "there is no next attempt". A `null` or a `'none'` would be a second encoding of the
same fact, and every caller that does arithmetic on that number would have to learn about it.
`brazilReceitaRealBenchmarkAttemptBudgetExhausted()` was added because
`nextAttemptStructurallySupported: false` reads like a capability note, and a terminal state should read
like a terminal state.

**The ceiling did not move.** Raising `..._STRUCTURALLY_SUPPORTED_ATTEMPTS` to make room for a third
attempt is precisely the route § 2 forbids, and a test asserts the two constants are now equal.

## 3. Attempt #1 is preserved

Attempt #1's frozen record is **byte-identical**: the literal in the history array is unchanged field for
field, and its `inputScope` is still `staged_subset`.

The three fields this milestone adds to `BrazilReceitaRealBenchmarkAttemptRecord` — `abortStage`,
`failureClassification`, `resourceObservation` — are **optional**, specifically so that stays true. A test
asserts attempt #1 carries exactly its original nine keys and none of the new ones. Backfilling
`abortStage` for attempt #1 from the 14B.0G document would mean reconstructing an attempt record from a
second source, which is the failure mode the ledger exists to prevent.

| | Attempt #1 | Attempt #2 |
|---|---|---|
| Milestone | BR-SOURCE-14B.0G | BR-SOURCE-ATTEMPT2-RUN |
| Period | 2026-07 | 2026-07 |
| Input scope | `staged_subset` | **`full_national`** |
| Boundary crossed | `true` | `true` |
| Terminal | `resource_cap_breached` | `resource_cap_breached` |
| Cause | `maxRuntimeMs` | **`maxExternalMemoryBytes`** |
| Rows emitted | 0 | 0 |
| Preserved | `true` | `true` |

## 4. Attempt #2 evidence (sanitized)

Recorded on the attempt-2 record as `resourceObservation`. Counters, byte figures and millisecond
figures only — no CNPJ, no company name, no path, no join key, no raw row. Tests assert no 14-digit
digit run, no path separator, and no person-linked family token appears in the serialized record.

```
datasetPeriod                    2026-07
fullNationalInputConfirmed       true
empresasDescriptors              10
estabelecimentosDescriptors      10

terminalCode                     resource_cap_breached
abortStage                       empresas_reference_pass

peakExternalMemoryBytes          67,725,759
externalMemoryCapBytes           67,108,864
externalMemoryOverageBytes             616,895   (100.92 % of cap)

peakHeapUsedBytes               115,595,544      (86.1 % of cap)
peakRssBytes                    337,002,496      (62.8 % of cap)
durationMs                            9,737      ( 0.05 % of the 21,600,000 ms budget)
bytesRead                       205,520,896      ( 0.92 % of the national volume)
rowsRead                          2,555,904
temporaryStoragePeakBytes        40,894,464      ( 0.95 % of cap)
filesOpenedPeakConcurrent                33      (cap 64)
partitionHandlesPeak                     32      (cap 32 — exactly on it)
partitionsCreated                     1,024
materializedOutputRows                    0

sanitizerPassed                  true
cleanupPassed                    true
throughputEvidenceProduced       false
```

## 5. Classification — and the misreading it prevents

```
ATTEMPT_2_FAILURE_CLASSIFICATION = resource_envelope_external_memory
```

**NOT** `national_throughput_failure`, and the reasons are in the numbers above:

- runtime used was **9,737 ms of 21,600,000** — 0.05 % of the budget;
- the join was never reached; Estabelecimentos was never reached;
- the abort happened in the Empresas reference pass, on external memory, by **616,895 bytes**;
- `partitionHandlesPeak` sat **exactly** on `maxOpenPartitionFiles` (32), with 1,024 partitions created —
  the external memory is dominated by those buffers plus the 4 MiB read chunk, so no amount of runtime
  would have changed the outcome and neither would a different dataset. This is a **cap dimensioning**
  finding, not a verdict on the join architecture.

`national_throughput_failure` is a member of the classification union that **no record uses**, and a test
asserts that. Keeping the wrong answer spellable and mechanically excluded is stronger than leaving it
unsaid, because "two attempts, both breached, therefore the national join is too slow" is the conclusion a
reader arrives with.

```
END_TO_END_REAL_THROUGHPUT_PROVEN = false     (unchanged, and now recorded per attempt as
                                               throughputEvidenceProduced: false)
```

## 6. No third attempt, and no second run of the second

| Request | Result |
|---|---|
| `1` | `real_attempt_number_already_consumed` |
| `2` | **`real_attempt_number_already_consumed`** (was `eligible: true`) |
| `3`, `4`, `99`, … | `real_benchmark_attempt_limit_reached` |
| `0`, `-1`, `1.5`, `'2'`, `NaN`, `null`, `undefined`, `true`, `{}` | `real_attempt_number_invalid` |
| omitted | `declaration_missing` (a missing field, not a wrong number) |

No number is eligible. The rejection vocabulary is **unchanged** — no softer "budget exhausted, ask
nicely" code was introduced, because a closure with a new code in it is a closure with a door in it.

**Authorization flags cannot resurrect attempt #2.** The attempt wall is preflight **stage 3**; the
authorization wall is **stage 11**. An invocation carrying all three operator approvals *and* the
process-scoped grant is refused at stage 3, with `missingOperatorApprovals: []` — nothing was missing, and
nothing would have helped. Granting and withdrawing the grant now produce the **same** outcome, which is
this claim's strongest form.

**Process restart still sees the exhausted budget.** A test spawns a fresh interpreter, imports the
ledger, and asserts `{consumed: 2, next: 3, exhausted: true, two: already_consumed, three: limit_reached}`.
This is the only honest form of the durability claim.

**No reset path.** No `reset()`, no `setAttempts*`, no decrement, no `ATTEMPTS_CONSUMED = 0/1` — asserted
by static scan over comment-stripped source, across the ledger, the entry point and the 14B.0K resolution.
The history array and every record in it are frozen. The tracked authorization remains `false`.

## 7. Reports that stopped claiming an available attempt

Three fields were hardcoded literals that were correct only until attempt #2 ran. They are now derived:

| Location | Field | Before | After |
|---|---|---|---|
| `..._real-full-scan-benchmark.ts` | `realFullScanBenchmarkReadyForOwnerAuthorization` | `true` | derived → `false` |
| `..._14b0k-national-inventory-resolution.ts` | `attempt2Executed` | `false` | derived → `true` |
| `..._14b0k-national-inventory-resolution.ts` | `secondRealBenchmarkExecuted` | `false` | derived → `true` |

And the 14B.0K next-action table: a `complete` verdict used to route to
`OWNER AUTHORIZATION — SECOND REAL FULL-NATIONAL BENCHMARK`. That destination has been reached and spent.
With the budget exhausted it now routes to `OWNER REVIEW — EXTERNAL MEMORY RESOURCE CLOSURE` — a review of
the envelope the breach actually raised, phrased as a review and naming no attempt number. The original
table entry is left intact rather than overwritten, so what a complete verdict used to mean is still
readable. `incomplete` and `indeterminate` are unchanged: an inventory problem is an inventory problem
whatever the attempt budget says.

`secondRealBenchmarkControlReady` stays `true`. The controls really are finished; that is a different
claim from there being a run left to make.

## 8. Test coverage that became structurally unreachable

**This is the one thing a reviewer should look at closely.** With the budget spent, the attempt wall at
stage 3 refuses every invocation, so **preflight stages 4–11 and the engine are no longer reachable through
the public entry point.** Tests that drove those stages through
`runBrazilReceitaRealFullScanResourceBenchmark` could not keep asserting what they asserted.

No test seam or bypass was added — that would be the route to attempt #3 in another shape. Instead each
affected test now asserts two things: that the entry point refuses at the attempt wall, and that the
control which owned the original refusal **still refuses the same input when called directly**.

| Stage | Control | Where its behaviour is still asserted |
|---|---|---|
| 4 `national_input_completeness` | `evaluateBrazilReceitaNationalInputCompleteness` | pure function, `…-14b0j-second-benchmark-control.test.ts` |
| 5 `resource_caps` | `resolveBrazilReceitaFullJoinResourceCaps` | called directly + `…-full-join-resource-envelope.test.ts` |
| 6 `handle_caps` | `resolveBrazilReceitaFullJoinHandleCaps` | called directly + `…-full-join-handle-and-disk.test.ts` |
| 7 `no_write_contract` | `assertBrazilReceitaFullJoinNoWrite` | called directly + `…-full-join-no-write-guard.test.ts` |
| 8 `zero_output` | cap resolver equality | called directly |
| 9 `private_metric_channel` | `resolveBrazilReceitaFullJoinPrivateChannel` | called directly + `…-full-join-resource-envelope.test.ts` |
| 10 `single_attempt` | in-process attempt ledger | called directly (`consume()` single-flight) |
| 11 `authorization` | operator approvals + grant | grant mechanism asserted; outcome now converges at stage 3 |
| engine | `withBrazilReceitaFullJoinFirstSourceReadBoundary` | direct wrapper tests in `…-attempt2-final-engine-gate.test.ts` |

**What is genuinely lost** is entry-point *wiring* coverage for stages 4–11: proof that the entry point
passes the right input to each control and reports the right abort code. The controls themselves, and the
stage ordering (via `BRAZIL_RECEITA_REAL_FULL_SCAN_PREFLIGHT_STAGES`, asserted explicitly), remain covered.
This is a real and permanent consequence of the closure, and the right place to record it is here rather
than in a comment nobody reads.

One test constant changed meaning deliberately: `BASE_CLI_ARGS` in the operator-enablement suite is pinned
to `--real-attempt-number 2` instead of deriving it from the ledger. The scenario worth testing is the
invocation an operator would actually retype — the one that ran on 2026-08-12 — and the derived value is
now `3`, which exercises a different refusal. Both refusals are asserted in that file.

## 9. Safety

```
REAL_DATA_ROWS_OPENED_DURING_THIS_PR    0
BENCHMARK_EXECUTED_BY_THIS_PR           false
ENGINE_CHANGED                          false
CAPS_CHANGED                            false
SUPABASE_TOUCHED                        false
MIGRATION_APPLIED                       false
IMPORT_RUN                              false
RUNTIME_TOUCHED                         false
AGENT_1_TOUCHED                         false
PROVIDER_CALLED                         false
RECEITA_OPENED                          false
```

`BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS` is asserted field for field against transcribed
literals in two suites, unchanged — including `maxExternalMemoryBytes: 67_108_864`, the cap attempt #2
breached. **It was not widened to make the failure go away.**

## 10. Verification

```
20/20 test:br-source:* suites            green
test:br-source:attempt2-durable-closure  166 pass / 0 fail
test:agent2a:automatic-routing            50 pass / 0 fail   (required CI check)
npm run typecheck                          0 errors
npm run lint                              68 errors / 505 warnings — identical to the
                                          pre-change baseline (git stash -u); 0 in touched files
```

## 11. Status

```
ATTEMPT_1_CONSUMED                       true
ATTEMPT_2_CONSUMED                       true
REAL_BENCHMARK_ATTEMPTS_CONSUMED         2
ATTEMPT_2_EXECUTED                       true
ATTEMPT_2_REEXECUTABLE                   false
ATTEMPT_3_ALLOWED                        false
NEXT_REAL_ATTEMPT_NUMBER                 3, structurally unsupported (budget exhausted)
NO_RESET_PATH                            true
REAL_BENCHMARK_AUTHORIZED                false
BENCHMARK_SUCCESS                        false
TERMINAL_STATUS                          aborted
TERMINAL_CODE                            resource_cap_breached
ABORT_STAGE                              empresas_reference_pass
ATTEMPT_2_FAILURE_CLASSIFICATION         resource_envelope_external_memory
END_TO_END_REAL_THROUGHPUT_PROVEN        false
GATE2_APPROVED                           false
GATE2_DECISION                           DEFER
GATE7_APPROVED                           false
```

**NEXT_ACTION = OWNER REVIEW — EXTERNAL MEMORY RESOURCE CLOSURE**

The open question this closure hands back is a resource-envelope question, not an architectural one:
`maxOpenPartitionFiles = 32` with `partitionCount = 1024` puts external memory over a 64 MiB cap within
seconds of the first read, on any dataset. Nothing in this PR proposes a change to it.
