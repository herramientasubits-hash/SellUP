# BR-SOURCE-ATTEMPT2-FINAL — the engine gate and the real boundary

**Status:** merged code, **nothing authorized**.
**Scope:** two defects in the attempt-#2 execution path. No benchmark, no dataset read, no cap change.

`GATE2_APPROVED = false` · `GATE7_APPROVED = false` · `REAL_BENCHMARK_ATTEMPTS_CONSUMED = 1` ·
`ATTEMPT_2_AUTHORIZED = false` · `ATTEMPT_3_ALLOWED = false`

**This PR does not authorize the run.** The owner must re-emit the authorization after it merges.

---

## 1. What happened

Attempt #2's third authorization was refuted at `before_first_read` with
`temporary_storage_policy_not_approved`, after 0 bytes and 0 rows — and the in-process boundary marker
had already fired.

Two independent defects, both in the same three lines of the path.

### A. The engine's temporary-storage wall was deaf

BR-SOURCE-ATTEMPT2-OPS (PR #267) made an owner decision expressible per invocation: three separate
approvals, each `false` unless its own flag was passed, none persisted. The benchmark's `authorization`
stage learned to read that grant. The **workspace's own wall did not**:

```ts
// br-receita-cnpj-full-join-partition-workspace.ts, before
if (request.realDataRun && !BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED) { … }
```

`BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED` is a tracked `false as const` that nobody
may flip. The CLI's `--temporary-storage-policy-approved` fed only `declarations`, so a complete grant
satisfied stage 11 and then hit a second wall that could not hear it. The wall was not wrong — it was
the wrong shape.

### B. The boundary was committed before the work

`commitCrossing()` fired immediately **before** the engine call, on the reasoning that the engine is the
first thing that opens a source row. It is — *if it gets that far*. The engine runs its own pre-read
validations (caps, descriptors, duplicate policy, resource arming, and the temporary-storage wall), and
every one of them returns `before_first_read`:

```
commitCrossing()  →  engine pre-read abort  →  bytesRead = 0, rowsRead = 0
```

Zero bytes, a spent attempt. Exactly the accounting BR-SOURCE-14B.0J § 11 forbids, inverted.

---

## 2. What changed

### A — an invocation-scoped temporary-storage approval

New module `br-receita-cnpj-full-join-temporary-storage-approval.ts`. It mints one **opaque, branded**
value meaning *"this invocation's operator grant approved temporary storage"*, and the workspace accepts
it as an alternative to the tracked constant:

```
effective approval = tracked constant  OR  invocation-scoped minted approval
```

- A **value**, not a boolean. `temporaryStoragePolicyApproved: true` threaded through the engine request
  would be a parameter any caller could set — the shape of a bypass. The brand symbol is not exported,
  so a hand-built literal does not type-check and a `JSON.parse` round-trip does not carry it.
- Minting requires `temporaryStoragePolicyApproved === true` **and** a complete grant. The three
  approvals stay three; nothing is derived from anything.
- Nothing persists. Pure function, returned value, no module-level binding, no `process.env`, no cache.

### Both walls stay up

| Wall | Where | Still enforced? |
|---|---|---|
| `authorization` stage | benchmark, stage 11 | yes — complete grant **or** tracked constant |
| temporary-storage policy | workspace, before creation | yes — minted approval **or** tracked constant |

`BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED` is still `false`, and a test asserts that
**no file in the connector assigns it**. The engine forwards the approval verbatim and interprets
nothing: a test pins the forward to exactly three source occurrences.

### B — the boundary hangs on the first real read

New module `br-receita-cnpj-full-join-first-source-read-boundary.ts` decorates the **reader port** — the
one injected object every source byte travels through — and fires once, immediately before the first
`read`.

`read`, and not `open` or `size`: the port has four operations and only one transfers content. `size` is
a stat, which the contract names explicitly as *not* a crossing. `open` acquires a descriptor and moves
no bytes.

Manifest metadata, SHA validation, workspace creation, partition-workspace policy validation and the
engine invocation itself do not use this port at all — a stronger statement than "they do not cross": the
wrapper cannot see them.

The notification **latches before** the callback and before the delegation, so a notifier that throws
still leaves the boundary crossed. Twenty parts produce one crossing.

`BrazilReceitaRealFullScanCompletion.realDataBoundaryCrossed` was widened from the literal `true` to
`boolean`, and the cast at the construction site is gone. "The engine ran" and "a real source row was
read" are no longer the same fact, and the CLI now prints the accounting on the success path too.

---

## 3. Accounting, restated

| Event | Attempt spent? |
|---|---|
| preflight refusal (stages 1–11) | no |
| manifest bridge failure | no |
| engine pre-read abort — caps, descriptors, **temporary storage** | **no** (was: yes) |
| first `read` of a source file | **yes** |
| cap breach, crash, sanitizer failure *after* the first read | yes |

---

## 4. Evidence

`npm run test:br-source:attempt2-final-engine-gate` — 224 passing, of which 21 are the new dedicated
suite; the rest are the sibling suites this change could plausibly have broken, run alongside it.

- **§ A** the policy: default refusal, the tracked constant unassigned anywhere in the connector, forged
  approvals rejected, a minted approval accepted, nothing persisted between invocations.
- **§ B** the engine wall: a real run with no approval aborts `before_first_read` with
  `temporary_storage_policy_not_approved`, `bytesRead = 0`, `rowsRead = 0`, boundary uncrossed — the
  production failure, reproduced. With a minted approval the same run passes the wall and reaches a read.
- **§ C** the boundary: `size`/`open`/`close` do not cross; the first `read` does; exactly once across
  twenty parts; a failure before it spends nothing and a failure after it spends the attempt.
- **§ D** attempt state: #1 consumed, #2 eligible-but-unauthorized, #3 prohibited, no reset path.
- **§ E** nothing else moved: every proposed cap pinned as a literal snapshot; the engine gains no gate,
  no state and no I/O; a synthetic join produces identical counts with and without the new field.
- **§ F** end to end: the benchmark entry point over a synthetic 10 + 10 input with a complete grant —
  once reaching the first read (`realDataBoundaryCrossed: true`, attempt spent) and once aborting inside
  the engine before any read (`realDataBoundaryCrossed: false`, durable count unmoved). The second
  outcome was **unrepresentable** before this milestone.

Regression: all 19 `test:br-source:*` suites plus `test:agent2a:automatic-routing` — 3 786 passing,
0 failing (suites overlap, so that total counts shared files more than once). `tsc --noEmit` clean. `eslint` identical to the `origin/main` baseline (573 problems /
68 errors before and after; zero introduced).

Safety during this PR: `REAL_DATA_ROWS_OPENED = 0`, `REAL_SCAN_EXECUTED = false`,
`REAL_JOIN_EXECUTED = false`, `SECOND_REAL_BENCHMARK_EXECUTED = false`. Every source file any test reads
is a synthetic fixture written to the OS temp root seconds earlier.

---

## 5. Deliberately out of scope

**`NON_BLOCKING_FUTURE_OPTIMIZATION = optional manifest hashing behavior.`** Manifest validation computes
SHA-256 over declared parts even when `expectedSha256` is absent, so a full-national manifest hashes
~22 GB before the boundary it cannot cross. It is a cost, not a defect, and widening this PR to chase it
would put an unreviewed change in the path of the benchmark it exists to unblock. Recorded here; not
fixed here.

Untouched: resource caps, `maxPartitionDepth`, the partition algorithm, buffering, FD pools, the source
handle cache, join semantics, the sanitizer, the privacy classifier, the national inventory, the
multipart bridge, the 20-part manifest schema, `partOrdinal`, and `full_national` semantics.

---

## 6. Next action

`MERGE REVIEW — ATTEMPT #2 FINAL ENGINE GATE`, then
`OWNER RE-AUTHORIZATION — SECOND REAL FULL-NATIONAL BENCHMARK ATTEMPT #2`.
