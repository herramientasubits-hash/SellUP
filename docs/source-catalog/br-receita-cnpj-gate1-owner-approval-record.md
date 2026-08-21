# BR Receita CNPJ — GATE-1 owner approval record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-GATE1-RECORD — formal record of the human GATE-1 legal/privacy decision (docs + one pure record module)
**Status:** **GATE-1 `approved`** — and **nothing else**. Not a GATE-2 … GATE-8 approval, not a cap/input policy approval, not an execution, benchmark, real-data, manifest/CSV/ZIP/row-read, snapshot, persistence, import, Supabase, migration, runtime, Agent 1 or provider authorization, and not a production enablement.
**Predecessor:** BR-SOURCE-13A / GATE1-ROOT-ORDERING — PR #317, merged as `31d140b57b46390467ff21cffe05dfcd0546657a`
**Baseline:** `origin/main` = `31d140b57b46390467ff21cffe05dfcd0546657a`
**Last reviewed:** 2026-08-21

**Related documents:**

- Full join approval gates checklist (GATE-1 definition § 5, § 14 template, dependency graph § 13) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)
- Legal/privacy handoff (licence question, § 7) — [`br-receita-cnpj-legal-privacy-handoff.md`](./br-receita-cnpj-legal-privacy-handoff.md)
- Legal/privacy review (licence conflict evidence, § 3) — [`br-receita-cnpj-legal-privacy-review.md`](./br-receita-cnpj-legal-privacy-review.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Owner decision validator (BR-SOURCE-13A) — [`br-receita-cnpj-13a-owner-decision-validator.md`](./br-receita-cnpj-13a-owner-decision-validator.md)

> This document records **one** decision: the human legal/privacy owner reviewed the Brazil /
> Receita scope and decided that **development may continue** because legal/privacy coverage is
> considered satisfied. Per 10K § 4, an approval that is not recorded in the § 14 shape does not
> exist — § 2 below is that entry.
>
> Everything the 10K § 5 _Does NOT allow_ clause forbids stays forbidden. Brazil stays
> non-operational: `OPS_BR_READY_FOR_IMPORT`, `OPS_BR_READY_FOR_PRODUCTION_IMPORT`,
> `OPS_BR_READY_FOR_RUNTIME` and `OPS_BR_LIVE_PROSPECT_GENERATION_READY` all remain `false`, and
> GATE-1 flips none of them — 10K § 5 _Relation to flags_ says it flips no operational flag at all.

---

## 1. Gate status after this record

```text
GATE-1  Legal/Privacy approval for full local join dry-run   approved      ← this record
GATE-2  Temporary storage envelope                           not_started
GATE-3  Field allowlist                                      not_started
GATE-4  Identity grain                                       not_started
GATE-5  Output sanitization                                  not_started
GATE-6  Failure cleanup                                      not_started
GATE-7  Operator runbook                                     not_started
GATE-8  No-write / no-runtime guarantee                      not_started

Global GO/NO-GO (10K § 15):                                  NO-GO
```

The global verdict stays **NO-GO** and that is the correct outcome: the 10K § 15 matrix reads NO-GO
while _any_ gate is `not_started`, and seven still are. 10K § 13 is explicit that the dependency
graph **orders review; it does not propagate approval** — so GATE-1 `approved` makes GATE-2, GATE-3
and GATE-8 _reviewable_, and approves none of them.

---

## 2. § 14 approval entry — GATE-1

```text
Gate:                   GATE-1 — Legal/Privacy approval for full local join dry-run
Status:                 approved
Approver:               legal/privacy owner
Approval date:          2026-08-21

Evidence links:
                        - Legal/privacy decision record (BR-LEGAL-2), § 2 decision source,
                          § 3 decision summary, § 14 GATE-1 determination
                        - Legal/privacy review (BR-LEGAL-0), § 3 source and licence summary
                        - Legal/privacy handoff (BR-LEGAL-1), § 7 dataset licence
                        - Full join approval gates checklist (BR-SOURCE-10K), § 5 GATE-1
                        - Full join gate evidence packet
                        - Executable record: br-receita-cnpj-gate1-recorded-owner-decision.ts,
                          evaluated by the BR-SOURCE-13A validator

Decision summary:
                        The human legal/privacy owner reviewed the Brazil / Receita scope and
                        authorized continuing development, on the basis that legal/privacy
                        coverage is considered satisfied. The decision was given over the scope
                        AS A WHOLE; it is recorded here at that granularity and no finer. It
                        continues development under the privacy and legal controls already
                        documented for Brazil, and it widens none of them.

Restrictions:           (enumerated — 10K § 5 pass criteria require enumeration, not a summary)
                        1.  no socios file family — rejected by file-family name before any read
                        2.  no QSA file family — rejected by file-family name before any read
                        3.  no CPF, in any form, including hashed, truncated or fingerprinted
                        4.  no explicitly person-linked Receita file family
                        5.  no automatic production enablement
                        6.  no Supabase write and no import authorization implied by GATE-1
                        7.  no Agent 1 Brazil enablement implied by GATE-1
                        8.  no provider write implied by GATE-1
                        9.  downstream gates remain independently required and are not approved
                            by this decision
                        10. privacy and sanitization controls remain mandatory
                        11. any downstream persistence or output must satisfy its own gates

Artifacts approved:     - GATE-1 as the root of the 10K § 13 dependency graph, unblocking REVIEW
                          of the gates that depend on GATE-1 alone (GATE-2, GATE-3, GATE-8)
                        - continuation of Brazil / Receita development work under the existing
                          documented privacy and legal controls

Artifacts rejected:     none — no artifact was submitted for rejection in this decision

Open follow-ups:        F-1  `expirationOrReviewDate` carries a review CONDITION
                             (`REVIEW_REQUIRED_AT_NEXT_GOVERNANCE_ROUND_GATE2_GATE3_GATE8`), not a
                             calendar date: the human response supplied no expiry and inventing one
                             would manufacture an owner decision. An owner may replace it with a date.
                        F-2  The `R1 … R7` labelling in § 4 is bound to the seven 10K § 5
                             required-evidence bullets by this record; that label is not a
                             pre-existing BR-SOURCE identifier. Owner to confirm the binding.
                        F-3  Licence metadata conflict is PRESERVED, not resolved — § 3.
                        F-4  Whether the owner wishes to record any of the seven § 5 confirmations
                             at finer granularity than "accepted as part of the whole scope".

Blocks:                 Everything the 10K § 5 *Does NOT allow* clause blocks, unchanged:
                        executing a full join; importing; writing to Supabase; connecting runtime
                        or Agent 1; persisting any join key or row. Additionally unchanged:
                        GATE-2 … GATE-8 remain `not_started`; the cap/input policy remains
                        unapproved; no cap maximum, input root, output root or temp-storage
                        destination is authorized; no real-data access, manifest / CSV / ZIP or row
                        read is authorized; no benchmark attempt is authorized and the attempt
                        budget is unchanged (§ 5); no snapshot output, snapshot persistence or
                        atomic publish is authorized; `maxOutputRows` stays 0.

Allows:                 Exactly one step, per 10K § 5 *Allows*: designing and reviewing the next
                        technical step (GATE-2 onward) with a live legal basis. Concretely, the
                        first governance round after GATE-1 — GATE-2, GATE-3 and GATE-8 — becomes
                        REVIEWABLE. Reviewable is not approved.

Does not allow:         Being read as: an approval of any other gate; an execution, benchmark or
                        benchmark-retry authorization; real-data access; snapshot production or
                        persistence; an import; a Supabase write; a migration; a runtime or Agent 1
                        enablement; a provider call; a production enablement; a retroactive approval
                        of any prior execution (§ 5); or a reset of the benchmark attempt budget (§ 5).
```

---

## 3. Licence and LGPD status — history preserved, resolution not claimed

Two facts are kept apart here, because collapsing them would overstate what is known.

```text
LICENCE_METADATA_HISTORY        = CONFLICTING_OFFICIAL_METADATA
LEGAL_PRIVACY_OWNER_DISPOSITION = accepted_for_continuation_of_development
LICENCE_RESOLVED_BY_AGENT       = false
```

**The historical evidence is unchanged and is not reopened.** BR-SOURCE-1 recorded the licence as
**CC BY-ND 3.0**; BR-LEGAL-0 surfaced a possible **CC BY-NC-ND 3.0 Brasil** variant on a different
official surface. BR-LEGAL-1 § 7 named this the single most load-bearing open item, because an
`NC` variant could prohibit the intended internal commercial use outright rather than merely
constrain it. That record stands exactly as written.

**What the human owner supplied is a disposition over that evidence, not a resolution of it.** The
owner decided the overall legal/privacy coverage is sufficient to continue development. No agent
determined which licence governs, and nothing in this record or in the accompanying module should
be read as recording that it did. BR-LEGAL-2 § 3 already carries `LICENSE_DECISION = allowed` from
an earlier owner relay; this record does not restate, strengthen or re-derive that flag.

---

## 4. R1–R7 — the seven GATE-1 required-evidence confirmations

⚠️ **`R1 … R7` is not a pre-existing BR-SOURCE identifier.** No BR-SOURCE document defines an
`R1–R7` set. It is bound here to the seven _Required evidence_ bullets of 10K § 5, because that is
the only seven-item requirement set the GATE-1 contract defines. The binding is recorded as
follow-up **F-2** for owner confirmation rather than presented as established.

The owner's decision was given over the scope **as a whole** and did not restate these seven
confirmations individually. Each is therefore recorded as _accepted as part of the whole-scope
decision_ — the narrowest value consistent with "development may continue under the existing
documented privacy/legal controls". Recording anything stronger would manufacture a permission the
human response does not supply.

| Id  | 10K § 5 required confirmation                                                                                                               | Disposition                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| R1  | A full local join dry-run may process the `empresas` and `estabelecimentos` families locally, without persistence                           | accepted as part of whole-scope decision                                              |
| R2  | `full_dataset_processed = true` is acceptable **for a dry-run only**                                                                        | accepted as part of whole-scope decision                                              |
| R3  | `import_executed` must remain `false` regardless of dry-run outcome                                                                         | accepted as part of whole-scope decision                                              |
| R4  | CNPJ básico and full CNPJ are both categorically non-printable and non-persistible — no hash, truncation or fingerprint of either, anywhere | accepted as part of whole-scope decision                                              |
| R5  | Treatment of MEI / empresário individual / natural-person-risk records (excluded by default per BR-SOURCE-10F)                              | accepted as part of whole-scope decision                                              |
| R6  | Socios / QSA / CPF and every person file family remain categorically out of scope, rejected by file-family name before any read             | accepted as part of whole-scope decision                                              |
| R7  | The LGPD basis for local full-dataset processing, and the licence review outcome                                                            | accepted as part of whole-scope decision, **over conflicting licence metadata** (§ 3) |

R1–R6 restate boundaries the Brazil contract already established, so accepting the scope as a whole
accepts them as written. R7 is the one that carries a caveat, and § 3 states it rather than hiding
it inside a disposition word.

---

## 5. Historical executions and the benchmark attempt budget

Prior Brazil qualification and benchmark work ran under **separate, explicit authorizations**. This
GATE-1 approval is forward-looking only:

```text
HISTORICAL_EXECUTIONS_RETROACTIVELY_APPROVED = false
HISTORICAL_AUDIT_RECORD_MODIFIED             = false
BENCHMARK_ATTEMPT_BUDGET_RESET               = false

REAL_BENCHMARK_ATTEMPTS_CONSUMED             = 2
ATTEMPT_3_ALLOWED                            = false
NO_RESET_PATH                                = true
```

`ATTEMPT_3_ALLOWED` is the literal `false` in
`br-receita-cnpj-real-benchmark-attempt-ledger.ts`, that module exposes no `reset()`, no
`setAttemptsConsumed()` and no writable counter by construction, and this milestone changes none of
it. The accompanying record module neither imports the ledger nor reproduces a writable copy of its
counter, and a test asserts both.

---

## 6. Executable representation

The § 2 entry's GATE-1 section is also expressed as data, in
`src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate1-recorded-owner-decision.ts`,
so the BR-SOURCE-13A validator evaluates the recorded decision instead of a reader eyeballing prose.
It is kept apart from the 13C synthetic fixtures deliberately — those state in their own header that
they "are not owner decisions", and mixing a real decision into them would falsify that rule.

Fed the recorded artifact, 13A reports:

```text
gate1Approved                            = true    ← from the recorded human decision
gate2Approved                            = false
gate7Approved                            = false
capInputPolicyApproved                   = false
controlledExecutionAttemptAuthorized     = false
status                                   = invalid
goNoGo                                   = NO_GO
canProceedToControlledExecutionPreflight = false
```

**A whole-artifact `NO_GO` is the correct result, not a defect.** Every section other than `gate1`
is deliberately absent, 13A reads an absent section as unapproved, and seven gates are
`not_started`. Reading this `NO_GO` as "GATE-1 failed" inverts it: GATE-1 is the one section that
passes.

Ordering, verified by test rather than asserted in prose:

- `GATE2_CANNOT_PRECEDE_GATE1` does **not** fire against the record — GATE-2 is absent, not
  approved-shaped.
- GATE-1 approved + GATE-2 **incomplete** → no GATE-2 GO. The refusal is the incomplete field, not a
  precedence violation.
- GATE-1 approved + GATE-2 **approved-shaped** → the precedence rule no longer fires, and GATE-2 is
  evaluated on its own requirements. Reviewable, not authorized: the verdict stays `NO_GO`.
- `GATE7_CANNOT_PRECEDE_GATE2` remains enforced under an approved GATE-1.

> **Reading note on the section flags.** `gate2Approved` / `gate7Approved` are **section-scoped**:
> each reports that its own section is internally complete and says `approved`, and an ordering
> violation is carried as a separate blocking finding rather than folded back into the flag. So in a
> composed artifact where GATE-7 is approved-shaped and GATE-2 is absent, `gate7Approved` reads
> `true` while `GATE7_CANNOT_PRECEDE_GATE2` fires and the verdict is `NO_GO`. This is the merged 13A
> contract for **both** ordering rules, it predates this record, and a test pins it. **A caller must
> gate on `goNoGo` / `canProceedToControlledExecutionPreflight`, never on a bare section flag.**

---

## 7. Flags after this record

```text
OPS_BR_GATE1_LEGAL_PRIVACY_APPROVED          = true    ← this record

OPS_BR_READY_FOR_IMPORT                      = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT           = false
OPS_BR_READY_FOR_RUNTIME                     = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY        = false

OPS_BR_GATE2_APPROVED                        = false
OPS_BR_GATE3_APPROVED                        = false
OPS_BR_GATE4_APPROVED                        = false
OPS_BR_GATE5_APPROVED                        = false
OPS_BR_GATE6_APPROVED                        = false
OPS_BR_GATE7_APPROVED                        = false
OPS_BR_GATE8_APPROVED                        = false
OPS_BR_CAP_INPUT_POLICY_APPROVED             = false

OPS_BR_REAL_DATA_ACCESS_AUTHORIZED           = false
OPS_BR_BENCHMARK_ATTEMPT_3_AUTHORIZED        = false
OPS_BR_SNAPSHOT_OUTPUT_AUTHORIZED            = false
OPS_BR_SNAPSHOT_PERSISTENCE_AUTHORIZED       = false
OPS_BR_AGENT1_BRAZIL_ENABLED                 = false
```

---

## 8. Explicit non-goals

This milestone does **not**:

- approve GATE-2, GATE-3, GATE-4, GATE-5, GATE-6, GATE-7 or GATE-8;
- approve the cap/input policy, or set any cap maximum, input root, output root or temp-storage destination;
- modify the Brazil engine, the snapshot output path, the runtime reader, the Agent 1 integration, resource caps, the benchmark ledger, or the temporary-storage implementation;
- touch a product feature flag, Supabase, or a migration;
- access real data, read a manifest / CSV / ZIP, or read a row;
- execute or authorize a benchmark, or change the attempt budget;
- produce, persist or publish a snapshot;
- import, write to Supabase, activate runtime, activate Agent 1, or call a provider;
- enable anything in production;
- reopen the licence investigation, or claim an agent resolved which licence governs.
