# BR-SOURCE — Final owner signoff packet

**Milestone:** BR-SOURCE-FAST-TRACK-6
**Prepared:** 2026-08-21
**Machine-readable form:** `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-final-owner-signoff-packet.ts`
**Authoritative gate state:** `br-receita-cnpj-gate-status-current-state.ts` — read it, never a `Status today` line

---

## 0. What this packet is, and what it is not

Five gates are waiting on a named human's answer. This packet is the set of questions those humans
need, each with its exact wording, its required role or roles, its required response fields, and the
restrictions the answer carries.

🔴 **One engineering blocker stood outside those five answers, and it is now closed.** An earlier
draft said the five gates wait on a human answer *"and on nothing else"* — untrue at the time, because
the legacy engine report could reach `cli_stdout` directly. The FINAL FAIL-CLOSED EMITTER REMOVAL
deleted that serialization (see **§ 4.1**), so the claim holds again — but it is now **computed**, not
asserted: `brazilReceitaSignoffHumanAnswersAreTheOnlyRemainingWork()` derives from the live emitter set
and the live blocker list. A hand-set boolean is exactly how the earlier draft came to say something
false.

🔴 **This packet is not an approval, and nothing in it may be read as one.** Every response field below
is deliberately **blank**. `BRAZIL_RECEITA_SIGNOFF_PACKET_IS_AN_APPROVAL` is `false`, and
`findBrazilReceitaSignoffPacketDefects()` fails the packet if any field is filled by anything other than
a real, attributable human response. No agent may fill one —
`BRAZIL_RECEITA_SIGNOFF_AGENT_MAY_ANSWER` is `false`.

🔴 **The decisions are separate and may not be bundled.** 10K § 4: *"Gates may not be collapsed,
merged, bundled, or approved as a batch. Eight gates means eight recorded decisions."* One document is a
convenience for the people reading it, and it becomes a violation the moment one signature is taken to
cover two gates. No section's answer follows from another's, and none may be inferred from another's.
Silence, absence of objection, a passing test, a green CI check and a merged PR are each **not** an
approval (10K § 3).

🔴 **The confusion this packet exists to prevent.** BR-SOURCE-FAST-TRACK-6 received *project
technical/product direction*: it superseded an owner direction about `total_rows_scanned`, chose a
residual bucket label, and directed two output-key renames. That direction is real and it is recorded —
and it is **not** a privacy signature, a legal determination, a test-owner approval or an operator
approval. `BRAZIL_RECEITA_SIGNOFF_TECHNICAL_DIRECTION_IS_A_HUMAN_PRIVACY_APPROVAL` is `false`, and no
section here is pre-filled from it.

### Where the gates stand today

| gate | status | waiting on |
|------|--------|-----------|
| GATE-1 | `approved` | — |
| GATE-2 | `needs_owner_confirmation` | **§ 1** — privacy owner |
| GATE-3 | `ready_for_review` | **§ 2** — product/data + legal/privacy owners |
| GATE-4 | `needs_owner_decision` | **§ 3** — legal/privacy, data architecture, product owners (three separate authorities) |
| GATE-5 | `ready_for_review` | **§ 4** — security/privacy + test owners |
| GATE-6 | `ready_for_review` | **§ 5** — technical + operator owners |
| GATE-7 | `blocked` | GATE-2, GATE-5 and GATE-6 — **not** a signature of its own |
| GATE-8 | `APPROVED_AS_CONTRACT` | — (permits nothing on its own) |

**Approved: 2 of 8. Verdict: NO-GO.** `brazilReceitaGateGlobalVerdict()` returns `GO` only when every
gate is approved.

🔴 **GATE-7 is deliberately absent from this packet.** It is not waiting on a signature; it is waiting
on GATE-2, GATE-5 and GATE-6. It becomes reviewable only after those three are approved.

---

## 1. GATE-2 — the bucket ordinal

**Required role:** **privacy owner** (one role; the technical half of GATE-2 is already recorded).

### Question

> Does the privacy owner approve the bucket ordinal as
>
> ```
> structural_non_invertible_partition_metadata
> ```
>
> subject to **all** of:
>
> - process-memory only
> - no persistence
> - no filename or path
> - no log
> - no report
> - no evidence output
> - no Supabase
> - no provider
> - no HubSpot
> - **not** treated as join-key material, nor as a derivative of it

### What an approval is bounded by

- the ordinal exists in process memory for the run and reaches no surface;
- approving closes GATE-2 only — its numeric ceilings were already complete and are not re-opened;
- it flips no operational flag and authorizes no run.

### Required response

```
GATE2_BUCKET_ORDINAL_PRIVACY  =  APPROVED | NOT_APPROVED
APPROVER_ROLE                 =  privacy_owner
APPROVAL_DATE                 =  <actual human date>
```

---

## 2. GATE-3 — the field allowlist

**Required roles:** **product / data owner** *and* **legal/privacy owner**, jointly. Either may reject
alone; approval requires both.

### Question

> Do the product/data owner and the legal/privacy owner jointly approve
>
> ```
> br_receita_cnpj_field_allowlist_v1
> ```
>
> confirming the final field classifications recorded after Round 2 — including the trade-name
> exclusion and the closed typed `raw_data` allowlist?

### What an approval is bounded by

- it binds `field_allowlist_version` and nothing else;
- the 10J § 12 report marker stays `"not_approved"` until this decision is recorded;
- it does **not** freeze the report SCHEMA — 10L § 9 forbids that while GATE-4 is open;
- it authorizes no run, no import and no persistence.

### Required response

```
GATE3_FIELD_POLICY            =  APPROVED | NOT_APPROVED
PRODUCT_DATA_APPROVER_ROLE    =  <actual role>
LEGAL_PRIVACY_APPROVER_ROLE   =  <actual role>
APPROVAL_DATE                 =  <actual human date>
```

---

## 3. GATE-4 — identity grain: **three separate authorities**

🔴 **Three decisions, not one with three signature lines.** A legal amendment, a data-architecture
choice and a product-grain choice are decisions about different risks; a single combined verdict would
let the easiest of the three carry the other two.

### 3.A Legal / privacy

**Required role:** **legal/privacy owner**.

> Does the legal/privacy owner approve a **narrow** amendment to R4 of the GATE-1 record, allowing
> exactly **ONE** persisted representation of the establishment CNPJ, solely for internal exact lookup?
>
> Restrictions on that one representation:
>
> ```
> never user-visible          never reported
> never printed               never in raw_data
> never logged                never sent to a provider
> never sent to HubSpot       internal snapshot lookup only
> ```

Bounded by: exactly one representation — a second is a new decision; internal exact lookup is the only
purpose covered; the amendment authorizes **no** Brazil snapshot write (see § 3.D); and it authorizes no
run, import, migration or provider call.

```
GATE4_INTERNAL_CNPJ_LOOKUP_EXCEPTION  =  APPROVED | NOT_APPROVED
GATE4_R4_AMENDMENT_AUTHORIZED         =  true | false
LEGAL_PRIVACY_APPROVER_ROLE           =  <actual role>
DATE                                  =  <actual human date>
```

### 3.B Data architecture

**Required role:** **data architecture owner**.

> Does the data architecture owner approve **OPTION_D**?
>
> ```
> establishment operational grain
> company / root context
> monthly source_period of the form YYYY-MM
> exact idempotency per period
> ```

Bounded by: approving the grain does not create the physical period identity the grain needs; the future
migration is separately designed and separately reviewed; it authorizes no snapshot write and no
migration.

```
GATE4_DATA_ARCHITECTURE       =  APPROVED | NOT_APPROVED
DATA_ARCHITECTURE_APPROVER_ROLE  =  <actual role>
DATE                          =  <actual human date>
```

### 3.C Product

**Required role:** **product owner**.

> Does the product owner approve the **OPTION_D** product grain, accepting that **exact lookup is
> required** and that fuzzy-name lookup is **not** accepted as a replacement for it?

Bounded by: the exact-runtime-lookup productization blocker is acknowledged, not solved, by this
approval; it authorizes no run, import or persistence.

```
GATE4_PRODUCT                 =  APPROVED | NOT_APPROVED
PRODUCT_APPROVER_ROLE         =  <actual role>
DATE                          =  <actual human date>
```

### 3.D 🔴 The restriction that survives every GATE-4 approval

**Even with all three authorities recorded, BRAZIL SNAPSHOT WRITES REMAIN BLOCKED.**

`source_company_snapshots` still has **no physical `source_period` (YYYY-MM) identity**, so the exact
per-period idempotency Option D depends on cannot be enforced by the table. The migration that would add
it must be **separately designed and separately reviewed**. BR-SOURCE-FAST-TRACK-6 neither authored nor
applied it, and no approval in this packet authorizes it —
`BRAZIL_RECEITA_SIGNOFF_GATE4_WRITES_REMAIN_BLOCKED.unblockedByGate4Approval` is `false`.

---

## 4. GATE-5 — the **corrected** output sanitization contract

**Required roles:** **security/privacy owner** *and* **test owner**, jointly.

🔴 **The subject is the contract as CORRECTED by BR-SOURCE-FAST-TRACK-6, not the Round-3 version.** The
terms are enumerated below rather than referenced by round, so nobody blesses a superseded document.

### Question

> Do the security/privacy owner and the test owner jointly approve the corrected
> `br_receita_cnpj_output_sanitization_v1` contract, on exactly these terms?
>
> ```
> k                            =  10
> max output string length     =  64
> total_rows_scanned           =  INTERNAL ONLY — emitted on no surface at all
> records_persisted            =  the output key (renamed from persisted_rows)
> records_seen_by_family       =  the output key (renamed from rows_seen_by_family)
> suppressed_other             =  the single residual bucket label
> cross-tabulations            =  PROHIBITED
> named municipality counts    =  PROHIBITED
> raw rows / raw cells / identity keys / stack / path  =  PROHIBITED on every surface
> the allowlist governs; the denylist remains an independent second net
> the legacy 11A/14B engine public-report object is NOT a GATE-5 emission schema;
>   a future emitter must project only the closed GATE-5 allowlist
> ```

### What changed since Round 3, stated for the review

The three collisions Round 3 recorded and left open are **closed — and every one was closed on the
owner-direction side, never by relaxing the invariant it collided with**:

| id | Round-3 direction | superseded by | invariant that did **not** move |
|----|-------------------|---------------|----------------------------------|
| `OD-C1` | `TOTAL_ROWS_SCANNED = ALLOWED` | `INTERNAL_EXECUTION_COUNTER_ONLY` | `BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF` (11A) |
| `OD-C2` | the same, on the rendered surface | the same supersession | `VP-1`, `VP-4`, the rendered-output check |
| `OD-C3` | label `other_or_suppressed_small_cell` | label `suppressed_other` | § 5.2 **group 7**, unedited |

Two output keys were **renamed** rather than left resting on the allowlist-governs carve-out, which is
10O § 5.2's own recorded resolution for exactly this case. As a result
`BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST` is now **empty**, and no authoritative
immutable key forced a carve-out to survive.

**Specific points the approvers are asked to confirm inside the review:**

1. the internal-only counter needs **no** output representation at all — a bucket was the alternative
   and was not taken;
2. the `suppressed_other` label carries the same meaning, and group 7 was left intact;
3. the renames are acceptable given that 10J § 12 and 10K § 12 still name `persisted_rows = 0` in prose,
   which this round deliberately did **not** edit (the mapping is carried in
   `BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES` instead);
4. the *allowlist-governs* precedence should be **kept** as the standing tie-break even though nothing
   currently depends on it;
5. the three EXCLUDED breakdowns discharge the 10M § 13 bucket-boundary item by exclusion rather than by
   a boundary table;
6. `VP-1` … `VP-4` still leave runs of 9, 10, 12 and 13 digits uncovered, closed today only by 11A's
   `LONG_DIGIT_RUN` — so 11A is load-bearing, and the two contracts stay **separate** rather than being
   merged into one widened rule;
7. the screenshot / copy-paste surface (10O § 4 surface L) remains machine-undetectable and is mitigated
   only by the GATE-7 operator behaviour rules;
8. whether real local file paths in a manifest are sensitive — 10O § 12 raises the question and does not
   answer it.

### 4.1 🔴 REQUIRED DISCLOSURE — the legacy engine report is not a GATE-5 emission schema

The approvers are being asked to approve an **architecture**, not only a key list, so the part a reader
of the key list alone would never see is stated here.

> The historical BR-SOURCE-11A/14B engine public-report object is not itself a GATE-5-approved emission
> schema. Its legacy safety fields must not be directly emitted; a future emitter must project only the
> closed GATE-5 allowlist.

**What the object is.** `BrazilReceitaFullJoinEnginePublicReport` predates GATE-5 and carries three keys
GATE-5 refuses — `rows_emitted`, `raw_rows_printed`, `zero_output_rows_enforced`. All three trip § 5.2
**group 7** (`raw` / `row`) and none is named in the § 6 allowlist. It is classified
`LEGACY_ENGINE_SANITIZED_REPORT_SHAPE`, and 🔴 the word *Public* in its name means "the non-private half
of the engine's output" — **never** "approved for emission".

**Why the three keys were NOT renamed.** Every consumer was inspected first. The engine builds it, the
benchmark embeds it, the throughput harness sanitizes it, and three suites assert its fields **by name**
— and `raw_rows_printed` is a privacy **safety fact** asserted `false` across the dry-run runner's own
safety block, the 11A sanitizer suite, three operator scripts and seven decision records. Renaming it
would rewrite a claim other code checks, so the historical shape is **unchanged**. The three keys are
classified `LEGACY_ENGINE_INTERNAL_SAFETY_FACT`: they may remain in the legacy object and may **never**
survive to a GATE-5 surface.

🔴 **`rows_emitted` is deliberately NOT mapped to `records_persisted`.** Emitted and persisted are
different semantics — one counts rows handed to a sink, the other counts records durably written. Both
read zero today under `maxOutputRows = 0` and a null sink, and *a coincidence of value at one operating
point is not an equivalence of meaning*. No existing contract proves it, so no mapping is asserted and
no new output key was invented to preserve a legacy name.

**🔴 The direct bypass that existed — and has been REMOVED fail-closed.** It worked like this:

```
full-join-engine                 builds the legacy engine report
  → real-full-scan-benchmark     passes it through the 11A sanitizer            → PASSES
  → releasedEngineReport         the WHOLE object is released when 11A says ok
  → BrazilReceitaRealFullScanPublicReport.engine_report   embedded whole
  → run-…-real-full-scan-resource-benchmark.ts            process.stdout.write(JSON.stringify(…))
  → cli_stdout                                            ← a GATE-5 surface
```

Why it survives: **11A is a denylist over dataset-looking content.** `rows_emitted: 0` and
`raw_rows_printed: false` look like nothing at all, so 11A returns `ok` and has no opinion about whether
anybody reviewed the keys. Only the § 6 allowlist refuses a key by **absence**, and it is not on that
path. Running the GATE-5 guard over the same three keys returns **six** findings — three
`KEY-ALLOWLIST`, three `KEY-DENYLIST` group 7 — and the suite proves both halves by execution.

It was **gated**, not live: the attempt-limit wall (attempt #3 refused unconditionally), the
second-attempt owner wall, and three process-scoped operator approvals each from its own CLI flag — and
it was never a Next.js runtime path. That bounded the exposure; it did not make the path acceptable.

**What was done.** The serialization is **deleted**. At the point the CLI used to print the report it now
sets a dedicated withheld-output exit code and prints nothing:

```
no legacy report on stdout      no file or log fallback
no legacy report on stderr      no identifier, path or sample
no substitute report schema     no new diagnostic surface invented
no stack, no uncaught error     status travels as a process exit code
```

🔴 **This was a REMOVAL, not a new capability.** No GATE-5 projection was implemented, no replacement
schema was created, no output field was added, and neither GATE-5 nor 11A was weakened — no output
exception was granted. `addsRunnerCapability: false`, `removesAnExternalEmissionPath: true`. That
distinction matters because 10K § 4 forbids writing runner code while any gate is unapproved: something
that could be printed no longer can, and nothing new can.

**Attempt accounting is preserved** — three controlled scalars with no nested `engine_report` — because
dropping it would make a withheld run indistinguishable from a run that never happened.

**The historical finding is not erased.** It lives in
`..._HISTORICAL_DIRECT_EMITTERS` with `resolution: removed_by_fail_closed_boundary` and the exact removed
expression, so the next reader learns the bypass existed and why 11A missed it — otherwise the same
shape gets rebuilt by somebody who only ever saw the clean end state.

**Required future pipeline** (`GATE5_ENGINE_REPORT_PROJECTION_REQUIRED = true`):

```
engine observations → legacy engine report / internal safety facts → GATE-5 projection
  → GATE-5 allowlist → GATE-5 denylist + value guards → external output
```

Never `engine report → external output`.

🔴 **Two things are true at once, and they are not in tension.** The current bypass is **gone**
(`boundaryResolved() === true`), *and* a future external report **still requires** the GATE-5
projection (`PROJECTION_REQUIRED === true`, `PROJECTION_IMPLEMENTED === false`). Closing the hole did
not grant the projection. The practical consequence: **there is currently no approved external report of
a full-join run at all**, and that is the intended fail-closed state while GATE-5 is unapproved.

### What an approval is bounded by

- it authorizes writing sanitization **tests** in a future, separately approved milestone, and nothing
  else;
- 🔴 it does **not** discharge the engineering blocker above, and must not be read as approving the
  legacy object as an emission schema;
- it does not authorize executing the full join, nor emitting any report from real data;
- it does not freeze the report SCHEMA while GATE-3 and GATE-4 are open;
- 🔴 the implementer of this subject may supply **neither** half of the approval (10K § 3), and
  `BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL` is `false` — a round that closes everything the
  previous review flagged does not thereby earn the approval.

### Required response

```
GATE5_OUTPUT_SANITIZATION       =  APPROVED | NOT_APPROVED
SECURITY_PRIVACY_APPROVER_ROLE  =  <actual role>
TEST_OWNER_APPROVER_ROLE        =  <actual role>
DATE                            =  <actual human date>
```

---

## 5. GATE-6 — the executable cleanup contract

**Required roles:** **technical owner** *and* **operator owner**, jointly.

### Question

> Do the technical owner and the operator owner jointly approve the executable cleanup contract landed
> in BR-SOURCE-GATE-ROUND-2 — **verified** deletion on both the success and the failure path, **no
> success-with-residue**, and a `failed` or `not_executed` cleanup being **terminal** rather than
> retryable?

### What an approval is bounded by

- a `failed` or `not_executed` cleanup stays terminal and may not be upgraded by a retry;
- quarantine is not implemented and is not approved;
- cleanup deletes only paths its owning module created — no path is ever accepted from a caller;
- it authorizes no run and flips no flag;
- 🔴 the implementer of this subject may supply neither half of the approval (10K § 3).

### Required response

```
GATE6_CLEANUP_CONTRACT        =  APPROVED | NOT_APPROVED
TECHNICAL_APPROVER_ROLE       =  <actual role>
OPERATOR_APPROVER_ROLE        =  <actual role>
DATE                          =  <actual human date>
```

---

## 6. 🔴 What remains forbidden even if every section comes back APPROVED

Five gates approving does not make a run legal. GATE-7 would still be `blocked` on its own joint
approval, 10K § 4 would still forbid full-join runner code until **every** gate is approved, and
execution would still require the separate, explicit authorization of a future milestone.

```
reading real Receita data              any Supabase write
executing the full join                any Brazil snapshot write
running a benchmark                    implementing source_period identity
resetting the attempt budget           connecting Agent 1 to Brazil
authoring or applying a migration      any provider call
                                       enabling production
writing full-join runner code while any gate is unapproved
```

`BRAZIL_RECEITA_SIGNOFF_STILL_FORBIDDEN_AFTER_EVERY_APPROVAL` carries this list as data, and the
round's suite asserts it against the packet.

### 6.1 The engineering blocker that stood here — now DISCHARGED

```
ENGINEERING: the legacy engine public report was serialized to cli_stdout on the
             benchmark path without passing the GATE-5 closed allowlist.
owner:                          engineering
discharged by a human approval: NO — an emission path is code; no signature deletes a line
discharged:                     YES — the serialization was removed fail-closed
                                (no projection implemented, no substitute report introduced)
```

Owned by `br-receita-cnpj-gate5-engine-report-boundary`, which keeps the historical emitter with its
resolution and holds the **live** set empty. The suite **ratchets** on the live set — a new emitter fails
it, and so does silently deleting the historical record — and it proves the ratchet *works* rather than
merely passes: the exact removed expression is spliced back into an in-memory copy of the CLI and the
detector must fire on it. Synthetic stdout, stderr, file and log emitters are each proved caught;
template-literal interpolation is proved caught; and mentions in comments, prose and provenance data are
proved **not** to be false positives.

**Consequently** `brazilReceitaSignoffHumanAnswersAreTheOnlyRemainingWork()` now returns `true` — derived
from `CURRENT_DIRECT_ENGINE_REPORT_EXTERNAL_EMITTERS.length === 0`, never from a hand-set boolean.

---

## 7. How a recorded answer must arrive

- **In the 10K § 14 approval-evidence template.** An approval not recorded in that shape does not exist
  (10K § 4).
- **From the named role, attributable.** A role, a verdict and a real date. The packet's validator
  refuses a section whose fields were filled by anything else.
- **One decision per section.** Seven sections, seven recorded answers. No batch, no "approve all", and
  no answer inferred from another.
- **Never from an agent.** No agent may supply any half of any decision here.
