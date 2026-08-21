# BR-SOURCE-10K — Receita CNPJ full join dry-run approval gates checklist

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10K — Receita CNPJ full join dry-run approval gates checklist
**Status:** Official checklist of record (docs-only) — **not** a gate approval, and **not** a build/import/dry-run/execution authorization
**Predecessor:** BR-SOURCE-10J — `BRSOURCE10JLANDA — FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_MERGED` (PR #153, `main` HEAD `82060693169f2bfa54c0a7593c0d57c52fdf8df8`)
**Last reviewed:** 2026-07-29

**Related documents:**
- GATE-2 route decision package (BR-SOURCE-11J, docs-only) — [`br-receita-cnpj-gate2-route-decision-package.md`](./br-receita-cnpj-gate2-route-decision-package.md)
- Full join field allowlist decision record (GATE-3 proposal) — [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join import-readiness design (contract) — [`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md)
- Privacy-safe import eligibility design — [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)
- Import & staging persistence contract — [`br-receita-cnpj-import-staging-contract.md`](./br-receita-cnpj-import-staging-contract.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Identity grain & data contract — [`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)

> This document is a **checklist of record**. It turns the GATE-1 … GATE-8 conditions defined in
> BR-SOURCE-10I § 9 and mapped in BR-SOURCE-10J § 13 into a formal, approvable, per-gate
> checklist. It **approves no gate**, and it changes nothing about what is allowed today. Nothing
> here authorizes — and nothing here should be read as authorizing — a runner, script, package
> change, migration, dataset download, full-dataset processing, full join execution, import,
> Supabase write, production write, runtime change, adapter/validator change, provider call,
> HubSpot sync, Slack notification, live generation, full expansion, or merge to an operational
> state. **This document defines how the gates get approved; it approves none of them.**

---

## 1. Purpose

BR-SOURCE-10K exists so that "the gates are satisfied" can never be asserted informally.
BR-SOURCE-10I named GATE-1 … GATE-8; BR-SOURCE-10J mapped each gate to the technical decision it
governs. Neither made the gates *approvable*: neither defined who approves, what evidence is
required, what counts as pass versus fail, what a rejected gate blocks, or what an approved gate
does — and does not — unlock.

This document supplies exactly that, per gate:

- **required evidence** — what must exist and be recorded;
- **approver / responsible role** — who signs, and who may not;
- **pass criteria** — what makes the gate `approved`;
- **fail / block criteria** — what forces `rejected` or `blocked`;
- **expected artifacts** — what the approval produces;
- **relation to flags** — which report field or operational flag the gate governs;
- **allows** — the narrow next step the approval unlocks;
- **does NOT allow** — everything the approval must never be read as unlocking.

This document does **not**:

- implement code, a runner, or a script;
- execute a full join;
- process the full dataset;
- import data;
- write to Supabase;
- create or modify a migration;
- connect the runtime;
- connect Agent 1;
- touch HubSpot / Slack / providers / UI;
- **approve any gate** (it defines the approval procedure, it does not perform it);
- grant legal or privacy approval (only the named approver can, and only outside this document);
- authorize a future full join dry-run.

If, at any point, this milestone concluded that it required code, scripts, package changes,
migrations, or real execution to proceed, the correct action is to **stop and escalate**, not to
build — reporting `BRSOURCE10K_SCOPE_ESCALATION_CODE_NOT_ALLOWED`. This document reaches no such
conclusion: an approval checklist is fully expressible in prose.

---

## 2. Current official baseline

The company-discovery / eligibility / readiness line for Receita CNPJ is official and merged as
follows (design of record; none is an operational authorization):

- **BR-SOURCE-10E — privacy-safe bounded dry-run classifier is official.** Reads a bounded sample
  and turns anti-PII findings into per-record eligibility **counts** (aggregate only); authorizes
  no import ([eligibility design § 10.1](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10F — eligibility & legal-nature calibration is official.** Reference lookups →
  `not_applicable_lookup`; establishments in isolation → `pending_company_join_context`; MEI /
  empresário individual excluded by default; legal nature is a **classification signal, not an
  import authorization** ([§ 10.2](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10G — company/establishment bounded join dry-run is official.** Associates an
  establishment to its company context by the structural join id, held **only in an ephemeral
  in-memory index**; aggregate join metrics only
  ([§ 10.3](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10H — bounded join COVERAGE strategy is official.** Adds a coverage-oriented probe
  (`establishment_keys_then_company_probe`); `coverage_is_representative` is **always false**
  ([§ 10.4](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10I — full join import-readiness design is official.** Defines the allowed local
  processing envelope, join-key treatment, post-join field survival contract, the record-identity
  decision gate, and the required future gates GATE-1 … GATE-8. Decides no grain; authorizes no
  execution ([full join readiness design](./br-receita-cnpj-full-join-import-readiness-design.md)).
- **BR-SOURCE-10J — full join dry-run technical design is official.** Lowers the 10I contract into
  an executable-in-the-future design: execution model, architecture options, temporary storage
  envelope, join-key handling, field discard timing, cleanup contract, resource limits, future CLI
  and aggregate report contracts, and the GATE-1 … GATE-8 → decision mapping. Decides no grain;
  authorizes no execution
  ([full join technical design](./br-receita-cnpj-full-join-dry-run-technical-design.md)).

Brazil stays non-operational. Carried forward, unchanged:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 3. Gate status model

Every gate carries exactly one status at any time:

```
not_started       no evidence gathered; the default for all eight gates today
needs_evidence    evidence gathering started but is incomplete or inconclusive
ready_for_review  evidence complete and submitted; awaiting the named approver
approved          the named approver recorded an explicit approval with restrictions
rejected          the named approver refused; the gate's subject may not proceed as proposed
blocked           an external dependency (legal, another gate, an unresolved leak) prevents review
superseded        replaced by a later, explicitly-recorded decision that names what it replaces
```

> **Update (BR-SOURCE-GATE-ROUND-3) — three statuses the recorded rounds added, now declared.**
> Rounds 1, 2 and 3 used three statuses the enumeration above does not contain, and used them
> correctly — but a vocabulary that exists in practice and not in the model is how a reader concludes
> a gate carries an invalid status, or worse, silently maps it back to `not_started`. They are added
> here rather than left implicit:
>
> ```
> needs_owner_confirmation  evidence complete; the ONLY gap is a named human's confirmation of an
>                           already-decided disposition (GATE-2, § 6.1)
> needs_owner_decision      evidence complete; the ONLY gap is a named human ANSWERING one exact
>                           open question (GATE-4, § 8.1)
> APPROVED_AS_CONTRACT      the named approvers approved the CONTRACT while its proofs remain
>                           deferred to an implementation that § 4 forbids writing (GATE-8, § 12.1)
> ```
>
> Two rules govern them, and both matter more than the names:
>
> - **`needs_owner_confirmation` and `needs_owner_decision` are NO-GO, exactly as `not_started` is**
>   (§ 15). Neither is a partial approval, and neither may be cited as one. They differ from
>   `needs_evidence` in what is missing — a person's answer, not more evidence — and from `blocked` in
>   that nothing external prevents the review; it simply has not happened.
> - **`APPROVED_AS_CONTRACT` counts toward the approved TALLY and permits nothing on its own.** Its
>   *Allows* clause is conditional on every other gate being approved, and six are not (§ 12.1).
>
> The machine-readable form of the whole vocabulary is `BRAZIL_RECEITA_GATE_STATUSES`, and the
> authoritative current state is `BRAZIL_RECEITA_GATE_CURRENT_STATE` — both in
> `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate-status-current-state.ts`.

Rules governing status:

- **All eight gates start at `not_started`.** That is their status as of this document; nothing
  here advances any of them. (GATE-1 was later moved to `approved` by a separate recorded owner
  decision — § 5.1; GATE-8 to `approved` **as a contract** by BR-SOURCE-GATE-ROUND-1 — § 12.1;
  GATE-2 to `needs_owner_confirmation` — technical ceilings decided, the bucket-ordinal privacy
  disposition unconfirmed — by the same round's owner record, corrected in its FINAL CORRECTION
  pass — § 6.1; and GATE-3 to `needs_evidence` by the same round's recorded field policy — § 7.1, which **§ 7.2 then superseded with `ready_for_review`**.
  None of those is this document advancing a gate; each is an owner decision recorded in the § 14
  shape, which § 4 requires and this document only defines.)
- **No gate may be approved by inference.** Silence, absence of objection, a passing test, a green
  CI check, a merged PR, or a prior bounded result is never an approval.
- **No gate may be self-approved by the agent or author who implements its subject.** The
  implementer and the approver must be distinct roles.
- **A `rejected` or `blocked` gate forbids writing any full-join code** — including scaffolding,
  "harmless" stubs, or a runner behind a disabled flag.
- **`approved` never means import-ready.** It means, narrowly, that the single next step named in
  that gate's *Allows* clause becomes permissible.
- **`approved` is scoped and revocable.** An approval is bounded by the restrictions recorded with
  it; changing the subject re-opens the gate.
- **`superseded` requires an explicit successor.** A gate may not drift out of force silently.

> **Update (BR-SOURCE-10L).** The evidence packet —
> [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
> — introduces a **separate, parallel, non-authoritative** vocabulary for how complete a gate's
> evidence is (`evidence_not_collected` … `evidence_complete_for_review`, plus blocked variants). Those
> statuses are **not** gate statuses: the model above remains the only authoritative one, and only the
> named approver may set it. In particular, `evidence_complete_for_review` is **not**
> `ready_for_review`, and a gate holding complete-but-unreviewed evidence stays `not_started` here. As
> of 10L, all eight gates hold `partial_evidence_collected` and remain `not_started`.

---

## 4. Global approval rules

- **GATE-1 … GATE-8 must all be `approved` before any full-join runner code is written.** Not
  before it is *run* — before it is *written*.
- **Gates may not be collapsed, merged, bundled, or approved as a batch.** Eight gates means eight
  recorded decisions.
- **Verbal, partial, or implied evidence is not evidence.** A gate stays `needs_evidence` until
  every required item in its checklist exists in recorded form.
- **Bounded results from BR-SOURCE-10G / 10H are not full-join approval.** They proved a
  *mechanism* on a bounded window with `coverage_is_representative = false`; they say nothing about
  full-dataset processing and may never be cited as satisfying any gate.
- **A docs-only milestone is never an execution authorization.** The existence of a design
  (10I / 10J) or of this checklist (10K) authorizes nothing.
- **Any sensitive leak resets the affected gate(s) to `not_started`.** A leak of a full CNPJ, CNPJ
  básico / join key, CPF, personal value, raw row, or a hash derived from any of them invalidates
  the evidence that preceded it.
- **Any scope escalation voids the run and the affected approvals.** Discovering mid-work that code,
  a migration, a Supabase write, or real execution is needed is a stop-and-escalate event, not a
  reason to widen a gate.
- **Approval order follows the dependency graph (§ 13).** GATE-1 first; nothing downstream is
  reviewable while GATE-1 is `not_started`, `rejected`, or `blocked`.
- **Every approval is recorded with the § 14 template.** An approval that is not recorded in that
  shape does not exist.

---

## 5. GATE-1 — Legal/Privacy approval for full local join dry-run

**Governs (10J § 13):** whether the full local dry-run may run at all. Without it, nothing runs.

**Status today:** `approved` — recorded 2026-08-21. See § 5.1.

### Required owner / approver

- **Legal/privacy owner**, or the responsible party the project designates for Brazil source
  legal/privacy decisions.
- May **not** be an implementing agent, and may **not** be the author of the technical design.
- Recorded in the legal/privacy decision record, not only here.

### Required evidence

- Confirmation that a **full local join dry-run** may process the `empresas` and
  `estabelecimentos` file families **locally**, on the operator's machine, without persistence.
- Confirmation that `full_dataset_processed = true` is acceptable **for a dry-run only** — the
  legal basis for *processing* (not persisting) the whole dataset locally (10J § 17, last item).
- Confirmation that `import_executed` must remain `false` regardless of dry-run outcome.
- Confirmation that **CNPJ básico and full CNPJ are both categorically non-printable** and
  non-persistible, and that no hash, truncation, or fingerprint of either may appear anywhere.
- Confirmation of the treatment of **MEI / empresário individual / natural-person-risk** records
  (currently excluded by default per BR-SOURCE-10F).
- Confirmation that **socios / QSA / CPF and every person file family remain categorically out of
  scope**, rejected by file-family name before any read.
- The **LGPD basis** for local full-dataset processing, and the **CC BY-ND** licence review
  outcome for the source.

### Pass criteria

- An explicit, documented approval exists, attributable to the named approver.
- The privacy restrictions that accompany it are enumerated, not summarized.
- **Dry-run scope is separated from import scope in writing** — approving the former says nothing
  about the latter.

### Fail / block criteria

- Any ambiguity about CNPJ básico, full CNPJ, CPF, or person data handling.
- A request to bundle a Supabase write, a persistence step, or an import into the same milestone.
- No clearly identified approver, or an approver who is also the implementer.
- Licence or LGPD basis unresolved.

### Expected artifacts

- A legal/privacy determination recorded in
  [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md).
- A § 14 approval entry for GATE-1.

### Relation to flags

- Governs nothing in the report schema directly; it governs whether a run may exist at all.
- Flips **no** operational flag. `OPS_BR_READY_FOR_IMPORT` stays `false`.

### Allows

- Designing and reviewing the **next technical step** (GATE-2 onward) with a live legal basis.

### Does NOT allow

- Executing a full join.
- Importing.
- Writing to Supabase.
- Connecting runtime or Agent 1.
- Persisting any join key or row.

> **Update (BR-SOURCE-GATE1-RECORD) — § 5.1 GATE-1 is APPROVED.** The human legal/privacy owner
> reviewed the Brazil / Receita scope and decided that development may continue, on the basis that
> legal/privacy coverage is considered satisfied. The § 14 approval entry — the only place an
> approval exists, per § 4 — is
> [`br-receita-cnpj-gate1-owner-approval-record.md`](./br-receita-cnpj-gate1-owner-approval-record.md)
> § 2, and the matching legal/privacy determination is § 14 of
> [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md).
> The decision was given over the scope AS A WHOLE and is recorded at that granularity: the seven
> *Required evidence* confirmations above were not restated individually, and each is recorded as
> accepted as part of the whole-scope decision rather than as a separate owner finding.
>
> Against the *Fail / block criteria* above, one item deserves naming rather than burying: the
> licence metadata conflict (CC BY-ND 3.0 vs a possible CC BY-NC-ND 3.0 Brasil variant, BR-LEGAL-0
> § 3 / BR-LEGAL-1 § 7) is **preserved unchanged and was not reopened**. What the owner supplied is
> a disposition over that evidence — accepted for continuation of development — not a resolution of
> which licence governs, and no agent resolved it.
>
> Per § 13, this **orders review and propagates no approval**: GATE-2, GATE-3 and GATE-8 become
> REVIEWABLE, and GATE-2 … GATE-8 all remain `not_started`. Per *Relation to flags* above it flips
> **no** operational flag; `OPS_BR_READY_FOR_IMPORT` stays `false`. The § 15 matrix still reads
> **NO-GO**. It authorizes no full join, no execution, no benchmark, no benchmark retry, no
> real-data access, no manifest / CSV / ZIP / row read, no snapshot output or persistence, no
> import, no Supabase write, no migration, no runtime, no Agent 1, no provider call, and no
> production enablement; and it approves no prior execution retroactively.

---

## 6. GATE-2 — Temporary storage envelope

**Governs (10J § 13):** 10J § 6 (temporary storage) and § 10 (memory / disk / temp-index limits);
decides whether Option C (a temporary on-disk index) is permitted at all.

**Status today (as authored, 2026-07-29):** `not_started`. — 🔴 **SUPERSEDED BY § 6.1.** The current status is `needs_owner_confirmation`. The line above is retained as the historical record of what this section said when it was written; it is **not** the current state. The single authoritative current view is § 15, whose machine-readable form is `BRAZIL_RECEITA_GATE_CURRENT_STATE`.

### Required owner / approver

- **Technical owner** (storage / execution model) **and** **privacy owner**, jointly. Either may
  reject alone; approval requires both.

### Required evidence

- An explicit choice among the 10J § 5 options:
  - **Option A** pure in-memory map;
  - **Option B** streaming two-pass scan (the 10J conservative recommendation);
  - **Option C** temporary local encrypted / discardable index — the exception, never the default.
- The **allowed local path**: a controlled, fixed, operator-visible folder **outside the
  repository**.
- Confirmation the folder is **excluded from every cloud / backup / sync service**.
- **Disk and memory ceilings** — concrete numbers replacing every
  `TBD_BY_GATE_2_STORAGE_ENVELOPE` placeholder in 10J § 10, set against a real measurement rather
  than a guess.
- **TTL** — the temporary material is created for the run and destroyed at the end of it.
- **Local permissions** — owner-only read/write.
- **Mandatory cleanup**, on completion **and** on failure.
- **What happens if cleanup fails** — must be terminal, never a success-with-residue.
- If Option C is chosen: **encryption at rest** for any material that materializes the join key.

### Pass criteria

- A single storage option is approved explicitly, with the other two named as not-approved.
- Every ceiling has a number; no `TBD` survives.
- Cleanup is **verifiable**, not merely intended.
- Explicit prohibition of structural keys in file names, log lines, report fields, and paths.
- `zero raw-value logs` is restated as an absolute invariant, not a tunable.

### Fail / block criteria

- A temporary folder inside the repository.
- A cloud-synced, shared, or backed-up location.
- Indefinite retention, or a TTL that outlives the run.
- No cleanup path, or a cleanup path that is unverifiable.
- Join keys or raw rows in temporary material that the envelope has not explicitly approved.
- Option C approved without encryption-at-rest and a verified destroy step.

### Expected artifacts

- A recorded storage-envelope decision (chosen option, path, ceilings, TTL, permissions, cleanup).
- A § 14 approval entry for GATE-2.
- The numeric ceilings that replace 10J § 10's placeholders.

### Relation to flags

- Sets the future report field `temporary_storage_mode` (today `"not_approved"` — 10J § 12).
- Flips **no** operational flag.

### Allows

- Designing — and, once every gate is approved, implementing — temporary-material handling strictly
  inside the approved envelope.

### Does NOT allow

- Persisting approved source data.
- Creating `source_company_snapshots` rows.
- Storing any real data inside the repository.
- Treating a temporary technical artifact as a source snapshot.

> **Update (BR-SOURCE-11K).** A docs-only **controls and evidence template** proposing this gate's
> review structure has landed —
> [`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md).
> It supplies a GATE-2 decision summary template, execution-scope / directory / temp-storage / output /
> error controls templates, an operator checklist, stop conditions, an evidence packet format, and a
> fail-closed validation matrix for a future owner review to fill in — it fills in none of them itself,
> assigns no storage option, and replaces none of § 10's numeric placeholders.
>
> **GATE-2 remains `not_started` / not approved.** The template's status is `proposed_for_owner_review`;
> it creates no runner, script, or test, and it authorizes no owner review, broader local execution,
> temp storage, dry-run, import, Supabase write, migration, runtime, or Agent 1 integration.

### 6.1 GATE-2 numeric ceilings are COMPLETE; approval is BLOCKED pending privacy-owner confirmation (BR-SOURCE-GATE-ROUND-1, FINAL CORRECTION)

> **Update (BR-SOURCE-GATE-ROUND-1, FINAL CORRECTION) — § 6.1 GATE-2 is `needs_owner_confirmation`,
> not `approved`.** The technical owner (storage and execution model) decided Option C and its full
> ten-ceiling numeric envelope. The decision is recorded as data in
> [`br-receita-cnpj-gate2-recorded-owner-decision.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate2-recorded-owner-decision.ts),
> so BR-SOURCE-13A evaluates it instead of a reader eyeballing prose.
>
> An earlier version of this record also attributed the bucket-ordinal PRIVACY disposition to the
> privacy owner. Checked against the only recorded human privacy statement —
> `br-receita-cnpj-legal-privacy-decision-record.md` § 14, the broad GATE-1 "development may
> continue" determination — that attribution does not hold: § 14 says explicitly that "GATE-2 …
> GATE-8 plus the cap/input policy all remain `not_started`", and never reaches the bucket-ordinal
> question. 10K § 6 requires a JOINT decision by the technical owner AND the privacy owner, and 10K
> § 3 forbids an agent supplying the missing half. So GATE-2 is recorded `blocked` in the artifact
> (`OwnerDecisionValue`'s own vocabulary for "an external dependency prevents review") and
> `needs_owner_confirmation` as this gate's status, until an attributable privacy-owner source
> actually decides the bucket-ordinal question.
>
> Per this gate's own *Relation to flags* clause it still **flips no operational flag**, and two
> things are asserted unchanged by test: `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED`
> is still the tracked `false`, and `BRAZIL_RECEITA_FULL_JOIN_PROVISIONAL_RESOURCE_CAP_PROPOSAL`
> still holds `maxTemporaryStorageBytes: 0`. A run still needs its own invocation-scoped operator
> grant.

```
Gate:                   GATE-2 — Temporary storage envelope
Status:                 needs_owner_confirmation (NOT approved — see Restrictions)
Approver:               technical owner (storage and execution model) DECIDED; privacy owner
                        confirmation of the bucket-ordinal disposition is OUTSTANDING
Approval date:          n/a — technical decision recorded 2026-08-21; gate not approved
Evidence links:         10K § 6; 10J § 5 (options), § 6 (temporary storage), § 10 (limits);
                        br-receita-cnpj-gate2-controls-and-evidence-template.md;
                        br-receita-cnpj-legal-privacy-decision-record.md (does NOT decide this
                        question — see above)
Decision summary:       Option C — a temporary local discardable index — is permitted, with Options A
                        and B explicitly not approved. All TEN ceilings are now decided as numbers
                        (GATE2_NUMERIC_CEILINGS_COMPLETE = true): the original seven, plus
                        maxFilesOpened = 64, maxBytesRead = 73,014,444,032 and
                        maxJoinKeysInMemory = 131,072 — owner DECISION values, not observed
                        measurements, chosen equal to the standing benchmark proposal's own figures.
                        The workspace is constrained by rule rather than by location: outside the
                        repository, outside the home directory, outside the dataset root, no symlink,
                        directory mode 0700, file mode 0600. Temporary material lives for the run and
                        no longer. Cleanup requires VERIFIED deletion on both the success and the
                        failure path; a failed cleanup is terminal and a cleanup that never ran is
                        terminal; success-with-residue is not an outcome. Encryption at rest is not
                        required WHILE no raw or normalized join key, and no hash, truncation or
                        fingerprint of either, is materialized to temporary storage — the verified
                        destroy step is unconditional and required regardless. The partition bucket
                        ordinal IS structural, non-invertible partition metadata, not join-key
                        material — that much is a technical, verifiable fact. Whether that is
                        sufficient PRIVACY-wise is a separate question with NO attributable owner
                        answer yet.
Artifacts approved:     none — the technical half of the storage-envelope decision (option, workspace
                        constraints, all ten ceilings, TTL, permissions, cleanup contract, encryption
                        condition) is DECIDED and recorded, but GATE-2 requires a JOINT approval and
                        the privacy half is outstanding
Artifacts rejected:     Option A (pure in-memory map); Option B (streaming two-pass scan) — rejected
                        regardless of the outstanding privacy confirmation
Open follow-ups:        (1) the bucket-ordinal privacy disposition needs an attributable privacy-owner
                        confirmation before GATE-2 can move to `approved`. (2) maxPhaseRuntimeMs is
                        DECIDED at 3 h while the standing benchmark proposal carries 6 h. The GATE-2
                        envelope governs; the proposal is not edited by this record; a guard function
                        (`brazilReceitaGate2PhaseRuntimeCapIsCompliant`) now exists so a future
                        executable cap set cannot silently inherit the looser figure. (3) An owner may
                        replace the review CONDITION with a calendar date.
Blocks:                 persisting approved source data; creating source_company_snapshots rows;
                        storing real data inside the repository; treating a temporary technical
                        artifact as a source snapshot; temporary material outliving the run;
                        structural keys in file names, log lines, report fields or paths; any
                        raw-value log
Allows:                 nothing operational — the numeric envelope being complete is not a joint
                        approval
Does not allow:         any run, benchmark, benchmark retry, real-data read, snapshot output,
                        persistence, import, Supabase write, migration, runtime path, Agent 1
                        enablement or provider call; being read as `approved`; and no operational
                        flag is flipped
Restrictions:           maxFilesOpened, maxBytesRead and maxJoinKeysInMemory carry owner numbers but
                        remain operator-supplied and fail-closed at invocation time — a recorded
                        number is not a runtime default. The encryption disposition REOPENS if the
                        temporary record or file layout ever materializes prohibited key-derived
                        material. The gate stays `needs_owner_confirmation` until the bucket-ordinal
                        privacy question has an attributable owner answer.
```

---

## 7. GATE-3 — Field allowlist approval

**Governs (10J § 13):** freezes 10J § 8.3 / § 8.4 — which signals survive the join and which counts
the report may carry; sets `field_allowlist_version`.

**Status today (as authored, 2026-07-29):** `not_started`. — 🔴 **SUPERSEDED BY § 7.2.** The current status is `ready_for_review`. The line above is retained as the historical record of what this section said when it was written; it is **not** the current state. The single authoritative current view is § 15, whose machine-readable form is `BRAZIL_RECEITA_GATE_CURRENT_STATE`.

### Required owner / approver

- **Product / data owner** **and** **legal/privacy owner**, jointly.

### Required evidence

- An explicit **allowlist** of post-join fields, derived from (and never wider than) the 10I § 6.3
  candidate list.
- An explicit **denylist**, restating the 10I § 6.1 prohibitions as a closed set.
- A decision on **`normalized_tax_id`** (eligibility design § 11, open question #1).
- A decision on **sanitized `legal_name`** (razão social).
- A decision on **sanitized `trade_name`** (nome fantasia).
- A decision on **`capital_social_value`**.
- Decisions on **CNAE code/label, municipality (coarse), UF, registration status, `opened_at`,
  company size (porte)**.
- A decision on **`raw_data`**: either a minimal typed allowlist, or `raw_data` prohibited
  outright. Never an unfiltered blob.

### Pass criteria

- The allowlist is explicit and closed — enumerated fields only.
- The denylist is explicit and closed.
- Every ambiguous field is marked `excluded` or `needs_legal_review`; nothing is left unlabelled.
- **Free-text fields fail closed** — not on the allowlist means excluded.
- A `field_allowlist_version` identifier is assigned so a future report can name it.

### Fail / block criteria

- "Use all the fields", or any open-ended inclusion rule.
- `raw_data` without a typed filter.
- Fine-grained address fields (street, number, complemento, bairro, postal code).
- Telephone / fax / DDD / email fields.
- Socios / QSA / CPF / any natural-person data.
- CNPJ básico or full CNPJ appearing in output.
- Row hashes derived from identifiers or from the join key.

### Expected artifacts

- A frozen, versioned allowlist + denylist pair.
- A § 14 approval entry for GATE-3.

### Relation to flags

- Sets the future report field `field_allowlist_version` (today `"not_approved"` — 10J § 12).
- Flips **no** operational flag.

### Allows

- Designing the post-join classification against a frozen field set.

### Does NOT allow

- Persistence of any kind — an approved allowlist is a *target*, not a writer authorization.
- Widening the eligibility design's § 5 allowlist.

> **Update (BR-SOURCE-10M).** A docs-only **decision record proposing** this gate's allowlist has
> landed: [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md).
> It supplies the *Required evidence* items above as a **proposal for the joint owners** — a
> six-category field lifecycle model, a closed forbidden-always list, the temporary-technical-only and
> classification-signal-only categories, a candidate aggregate-report field list, the
> candidate-future-persistible list (derived from 10I § 6.3 and never wider), a `needs_legal_review`
> label on every genuinely open field, `raw_data` **prohibited by default**, and a field decision
> matrix. It also raises two items the approvers must close explicitly: raw `tax_id` (listed in the
> eligibility design § 5 table but **absent** from 10I § 6.3, so treated as `needs_legal_review` and
> excluded from the candidate list) and file-level `file_hashes` in reports.
>
> **This gate is still `not_started`.** The record's own status is `proposed_for_owner_review`; it
> assigns **no** `field_allowlist_version` (the 10J § 12 marker stays `"not_approved"`), it is not a
> submission, and per § 3 and § 4 above only the product / data owner and legal/privacy owner jointly
> may approve — recorded with the § 14 template, never inside that record. It writes no code, decides
> no identity grain, freezes no report schema, and authorizes **no** dry-run, import, Supabase write,
> migration, runtime, or Agent 1 integration.

### 7.1 The GATE-3 FIELD POLICY is recorded — the gate is NOT approved (BR-SOURCE-GATE-ROUND-1, FINAL CORRECTION)

> **Update (BR-SOURCE-GATE-ROUND-1, FINAL CORRECTION) — § 7.1 the field policy exists; GATE-3 stays
> shut, now on two blockers instead of three.** The owners supplied the field policy. The CNPJ
> snapshot blocker that originally conditioned approval is now FIXED and merged in this same
> workstream — see below — but GATE-3 still does not move to `approved`, because RB-1 and RB-3
> remain unresolved. Those facts must not be collapsed, so the policy is recorded as data in
> [`br-receita-cnpj-gate3-recorded-field-policy.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate3-recorded-field-policy.ts)
> with an explicit `needs_evidence` status (previously `not_approved_pending_cnpj_snapshot_blocker` —
> renamed because that blocker no longer names the reason the gate is shut).
>
> **The blocker that WAS here, and is now closed.** `BrReceitaCnpjSnapshotRawData` labelled itself
> "Sanitized snapshot output (allowlist only — data-contract § 5.2)". That claim was FALSE: the block
> carried `cnpj_root` (the CNPJ básico), `cnpj_order` and `cnpj_dv`, which together reconstruct the
> full 14-position CNPJ exactly. And its own defence, `assertSanitizedRawData`, inspected KEY NAMES
> only — so a forbidden VALUE under a permitted key passed untouched, and renaming the key would have
> defeated the guard.
>
> **What the same workstream fixed.** The three fields are removed from the sanitized output, nothing
> replaces them, and the sanitizer now validates keys **and** values — reusing the canonical
> alphanumeric, DV-validated detector rather than inventing a second definition of "CNPJ-shaped".
> Reconstruction is proved impossible by trying: every ordered pair and triple of output leaves is
> asserted not to rebuild the identifier. Benign business numerics are asserted to SURVIVE, because a
> blunt "eight digits is a básico" rule would have destroyed an eight-digit `YYYYMMDD` opening date
> and a large capital figure — the very values this output exists to carry. A SECOND instance of the
> same R4 prohibition was found and fixed alongside it — see RB-2 below.
>
> **Why the gate is still shut after that fix.** Two residual blockers are recorded, unresolved, each
> with a named owner:
>
> - **RB-1 — the identity grain.** `BrReceitaCnpjSnapshotRow` still carries `tax_id`,
>   `normalized_tax_id` and `record_identity_key` (`tax:<14>`) as TOP-LEVEL columns of the shared
>   `source_company_snapshots` contract — not as part of the § 5.2 allowlist block this gate governs.
>   The prohibited-output set forbids that survival, and removing those columns is a change to the
>   record identity GRAIN, which is **GATE-4's** subject (§ 3: changing the subject re-opens the
>   gate). It would also diverge Brazil from every other TAX_GRAIN source, whose record identity
>   derives from that same column. That is an owner decision in the round that owns GATE-4 — not a
>   deletion an agent performs while fixing a different defect. **NOT fixed in this round, on
>   purpose.**
> - **RB-3 — four unlabelled fields.** `legal_nature_code` / `legal_nature_label`,
>   `matrix_branch_flag`, `simples_opt_in` / `simei_opt_in` and `mei_flag` are carried by the
>   sanitized output but are not named in the owners' include set. This gate's pass criteria require
>   **nothing unlabelled**. They were NOT deleted: `mei_flag` is the § 5 R5 control marker, and
>   removing a privacy control for being absent from an include list of privacy-relevant output would
>   weaken the very thing the list protects.
>
> **RB-2 — CLOSED in this round.** A CNPJ hash used as a rejection diagnostic. Rejected rows carried
> a truncated SHA-256 fingerprint of the CNPJ as `safeIdentifier`, and the fixture-only controlled
> parser reported a list of them. § 5 R4 forbids a hash, truncation or fingerprint of the CNPJ
> **anywhere**, including a diagnostic, so this was itself a violation of the gate it was meant to
> respect. `safeIdentifier` is now an execution-local ordinal derived from `sourceRowIndex`
> (`row-<n>`) — no CNPJ, no hash, no truncation, no fingerprint, and no new persistent company
> identifier. `reasonCode` plus that ordinal remain enough to locate and classify a rejection.
>
> A `field_allowlist_version` identifier — `br_receita_cnpj_field_allowlist_v1`, the first ever
> assigned — is bound to the recorded POLICY. 🔴 The 10J § 12 report marker still reads
> `"not_approved"`: assigning a version to a policy is not releasing the marker, and a report naming
> the version today would assert an approved allowlist that does not exist.

```
Gate:                   GATE-3 — Field allowlist approval
Status:                 needs_evidence  (advanced from not_started; NOT approved)
Approver:               product / data owner AND legal/privacy owner, jointly — no approval recorded
Approval date:          n/a — the field policy was recorded 2026-08-21; the gate was not approved
Evidence links:         10K § 7; 10I § 6.1 / § 6.3; 10J § 8.3 / § 8.4;
                        br-receita-cnpj-full-join-field-allowlist-decision-record.md;
                        br-receita-cnpj-gate3-recorded-field-policy.ts
Decision summary:       The owners recorded the field policy. PROHIBITED OUTPUT (closed, twelve
                        items): CNPJ básico, full CNPJ, cnpj_root, cnpj_order, cnpj_dv,
                        reconstructable CNPJ parts, normalized_tax_id snapshot survival, Socios, QSA,
                        CPF, person-linked data, prohibited CNPJ derivatives. INCLUDE (closed, ten
                        items): sanitized legal_name, CNAE approved fields, registration status,
                        company size, UF, municipality, opened_at, source period, provenance,
                        capital_social_value. trade_name = EXCLUDED_NOT_IMPLEMENTED. raw_data =
                        CLOSED_TYPED_ALLOWLIST. field_allowlist_version =
                        br_receita_cnpj_field_allowlist_v1, bound to the policy only.
Artifacts approved:     none — this is a recorded policy, not an approval
Artifacts rejected:     none
Open follow-ups:        RB-1 identity-grain survival (owned by GATE-4); RB-3 the four unlabelled
                        fields (owned by the GATE-3 joint approvers). RB-2 (the twelve-character CNPJ
                        hash used as a rejection diagnostic) is CLOSED — see above.
Blocks:                 persistence of any kind; widening the eligibility design § 5 allowlist; any
                        report naming the field_allowlist_version
Allows:                 nothing — an unapproved gate unlocks no next step
Does not allow:         being read as an approval, an import authorization, a writer authorization,
                        or a resolution of GATE-4 or GATE-5
Restrictions:           free-text fields fail closed — not on the allowlist means excluded. Every
                        residual blocker must be closed by its named owner before this gate can be
                        approved.
```

### 7.2 RB-3 is CLOSED and GATE-3 is `ready_for_review` — still NOT approved (BR-SOURCE-GATE-ROUND-2)

> **Update (BR-SOURCE-GATE-ROUND-2) — § 7.2 both residual blockers are closed; the gate waits on a
> person, not on work.**
>
> **RB-3 — closed by LABELLING, not by deleting.** The five payload keys that sat between the include
> set and the denylist now carry exactly one disposition each
> ([`br-receita-cnpj-gate3-residual-field-classification.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate3-residual-field-classification.ts)):
>
> | field | disposition | why |
> |---|---|---|
> | `legal_nature_code` | `INTERNAL_PRIVACY_CONTROL_ONLY` | the R5 risk classifier's input, and itself person-risk-bearing — MEI and empresário individual *are* legal natures |
> | `legal_nature_label` | `EXCLUDED_OUTPUT` | a legible rendering of that same code that no control consumes; unallowlisted means excluded (§ 7 pass criteria) |
> | `matrix_branch_flag` | `INCLUDED_OUTPUT` | its own source column, never CNPJ-derived, no person-risk semantics, and the HQ-versus-branch marker the § 8.1 grain needs a consumer to read |
> | `simples_opt_in` | `INTERNAL_PRIVACY_CONTROL_ONLY` | input to the MEI determination; no owner reason to publish a tax-regime flag was ever recorded |
> | `simei_opt_in` | `INTERNAL_PRIVACY_CONTROL_ONLY` | same, and the nearer of the two to a natural-person signal |
> | `mei_flag` | `INTERNAL_PRIVACY_CONTROL_ONLY` | the R5 marker; stays computed and counted, leaves the persisted payload |
>
> 🔴 **The Round-1 premise this corrects.** Round 1 declined to touch these fields because "`mei_flag`
> is how a downstream filter knows which rows those are". The caution was right; the premise was
> **false**, and it was checked rather than assumed. `raw_data.mei_flag` had exactly ONE non-test
> consumer in the repository — a count. The R5 exclusion is enforced by
> `br-receita-cnpj-privacy-safe-classifier`, which reads *natureza jurídica* off the EMPRESAS **source
> row** and never reads the snapshot payload at all. So the control could not be weakened by removing
> the payload key, and the count still works off the internal control array, which is the proof.
>
> Non-persistence is now **structural**: the control signals travel on
> `BrReceitaCnpjParserResult.internalControlSignals`, a **parallel array**, deliberately not reachable
> from a row. A writer is handed rows; a signal that is not on a row cannot be persisted by a writer
> that forgets it should not be.
>
> **"Nothing unlabelled" is now MECHANICAL.** The owners' include set is prose — "CNAE approved
> fields", "provenance" — and that prose-to-key gap is why the criterion could only ever be *argued*.
> Every emitted payload key is now bound to either its include-set entry or its RB-3 classification,
> and `findBrazilReceitaUnlabelledPayloadKeys` checks it. Two failure modes are distinguished: a key
> nobody labelled, and a key that WAS labelled non-output and is being emitted anyway.
>
> **RB-1 — closed for THIS gate, in the round that owns it.** § 8.1 records the disposition, and the
> part that matters to GATE-3 is that persisting `tax_id`, `normalized_tax_id` or a `tax:`-namespaced
> `record_identity_key` is now **refused in code**
> (`assertBrazilReceitaSnapshotRowIsPersistable`). This gate's closed prohibited-output set is
> therefore *enforced* rather than asserted. What stays open is which key may EVENTUALLY persist — a
> GATE-4 question, not a GATE-3 criterion. See § 13.1 on why that is not a cycle.
>
> **Why the gate is still shut.** GATE-3 requires the product / data owner **and** the legal/privacy
> owner, jointly. The product/data half is on record. The legal/privacy half is not, and § 3 forbids
> approval by inference while § 4 requires the § 14 shape. The only recorded human privacy statement
> is the GATE-1 determination, which says in its own text that GATE-2 … GATE-8 remain `not_started` —
> it never reaches the field allowlist. Manufacturing the missing half would repeat exactly the error
> Round 1 had to correct in the GATE-2 record.

```
Gate:                   GATE-3 — Field allowlist approval
Status:                 ready_for_review  (advanced from needs_evidence; NOT approved)
Approver:               product / data owner AND legal/privacy owner, jointly —
                        product/data half recorded; legal/privacy half NOT recorded
Approval date:          n/a — no approval exists
Evidence links:         10K § 7, § 7.1, § 7.2;
                        br-receita-cnpj-gate3-recorded-field-policy.ts;
                        br-receita-cnpj-gate3-residual-field-classification.ts
Decision summary:       RB-3 closed: six payload keys labelled, one INCLUDED_OUTPUT
                        (matrix_branch_flag), one EXCLUDED_OUTPUT (legal_nature_label), four
                        INTERNAL_PRIVACY_CONTROL_ONLY. The five non-output keys left the
                        persisted payload and travel on a parallel control array unreachable
                        from a row. The prose include set is bound to real payload keys, so
                        "nothing unlabelled" is checked by a function. RB-1 enforced for this
                        gate: persisting prohibited identity material is refused in code.
Artifacts approved:     none — no approval exists
Artifacts rejected:     none
Open follow-ups:        the legal/privacy owner half of the joint § 14 entry. Optionally,
                        whether legal_nature should later be promoted to a business attribute —
                        a widening decision, not an RB-3 residue.
Blocks:                 persistence of any kind; any report naming the field_allowlist_version
Allows:                 nothing — ready_for_review unlocks no next step and is NO-GO in § 15
Does not allow:         being read as an approval, or as a legal/privacy determination
Restrictions:           free-text fails closed. A field labelled INTERNAL_PRIVACY_CONTROL_ONLY
                        may not be promoted to output without a recorded owner decision.
```

---

---

## 8. GATE-4 — Identity grain decision

**Governs (10J § 13):** decides 10J § 14 (A / B / C / D) and the future `record_identity_key`; sets
`record_identity_grain_decision`.

**Status today (as authored, 2026-07-29):** `not_started`. Neither 10I nor 10J decided it, and neither does this document. — 🔴 **SUPERSEDED BY § 8.1.** The current status is `needs_owner_decision`. The line above is retained as the historical record of what this section said when it was written; it is **not** the current state. The single authoritative current view is § 15, whose machine-readable form is `BRAZIL_RECEITA_GATE_CURRENT_STATE`.

### Required owner / approver

- **Data architecture owner** **and** **product owner**, jointly.

### Required evidence

All four options must be evaluated explicitly, on the record:

```
A. record_identity_key per estabelecimento (full-CNPJ grain) — the import-staging § 4 default
B. record_identity_key per empresa / root (cnpj_basico grain)
C. two separate snapshots (a company snapshot + an establishment snapshot)
D. a single snapshot with the establishment as the operational unit and the company as context
```

The recorded decision must state:

- the **grain chosen**;
- the **justification**, including why the rejected options were rejected;
- the consequence for **deduplication**;
- the consequence for **enrichment**;
- the consequence for the future **`source_company_snapshots`** shape, reconciled against the
  import-staging contract § 4 (grain) and § 5 / § 11 (physical unique-index situation);
- the consequence for **Agent 1** consumption.

### Pass criteria

- Exactly one option is chosen, named explicitly.
- Trade-offs are documented, not asserted.
- No contradiction with the identity/data contract (CN1) or the import-staging contract's
  persistence layer (DB-D).
- `record_identity_key` is **deterministic** and derivable without printing or persisting a
  prohibited identifier.

### Fail / block criteria

- An implicit or inherited decision ("we already default to A").
- Two grains mixed inside a single key.
- A non-deterministic `record_identity_key`.
- A key whose construction requires CNPJ básico or full CNPJ to appear in output.
- Unreconciled conflict with the physical unique-index situation.

### Expected artifacts

- A recorded identity-grain determination naming the chosen option and its consequences.
- A § 14 approval entry for GATE-4.

### Relation to flags

- Sets the future report field `record_identity_grain_decision` (today `"not_decided"` — 10J § 12).
- Flips **no** operational flag.

### Allows

- Designing the future runner's identity contract.

### Does NOT allow

- Creating or modifying a migration.
- Writing snapshots.
- Changing the physical schema.

> **Update (BR-SOURCE-10N).** A docs-only **decision record proposing** this gate's grain has landed —
> [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md).
> It supplies the *Required evidence* above in proposal form: all four options evaluated explicitly,
> **option D** recommended for owner review, the rejected and deferred options named with their
> rejection justified, and the consequences stated for deduplication, enrichment, the future
> `source_company_snapshots` shape, the physical unique-index situation, and Agent 1 consumption.
>
> Against the *Pass criteria*: exactly one option is named, trade-offs are documented rather than
> asserted, and the record claims **no contradiction** with CN1 or the persistence layer — option D is
> the shape CN1 § 4 already describes. Against the **deterministic-key** criterion the record is
> deliberately incomplete: it proposes a **conceptual** key shape and **defers the concrete
> construction**, because one candidate construction inherits the open `normalized_tax_id` item and the
> other would require a surrogate whose derivation is itself unapproved. Against the *Fail criteria*:
> the record addresses "we already default to A" directly, by treating option A as **silent on company
> context** and recording D as A plus the missing contract, with B and C evaluated on the record.
>
> **GATE-4 remains `not_started` / not approved.** The record's status is `proposed_for_owner_review`,
> it assigns no `record_identity_grain_decision`, and it creates no migration, changes no index, writes
> no snapshot, and changes no physical schema — nor does it authorize any dry-run, import, Supabase
> write, runtime, or Agent 1 integration.

### 8.1 The GRAIN is decided; the PERSISTED IDENTITY is not (BR-SOURCE-GATE-ROUND-2)

> **Update (BR-SOURCE-GATE-ROUND-2) — § 8.1 GATE-4 advances from `not_started` to
> `needs_owner_decision`, with one exact question.** Recorded as data in
> [`br-receita-cnpj-gate4-recorded-identity-grain.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate4-recorded-identity-grain.ts).
>
> **A. What one Brazil snapshot record is.** One Receita **estabelecimento** (operational unit),
> carrying its **empresa** (root) attributes as context on the same row — 10J § 14 **option D**. All
> four options are evaluated with the three rejections justified on the record. D is chosen and is
> explicitly *not* "we already default to A", the failure mode § 8 names: D adds the three things A
> leaves silent — company context is mandatory on the row, the root is never an identity, and
> root-level grouping is a read-time projection rather than a stored key.
>
> **E. Deduplication / update / monthly replacement.** By operational unit **within one publication
> period**; never by root, never by legal name. The **period** is the idempotency unit, not the row.
>
> **🔴 B / C / D. The identity fields, and why the gate cannot close.** Two already-recorded
> constraints collide, and one of them is a *human* legal/privacy decision this round may not
> reinterpret:
>
> 1. **GATE-1 R4** (approved by the legal/privacy owner, 2026-08-21): "CNPJ basico and full CNPJ are
>    both categorically non-printable and non-persistible, with no hash, truncation or fingerprint of
>    either **anywhere**."
> 2. **§ 8 pass criterion**: `record_identity_key` must be **DETERMINISTIC** and derivable without
>    persisting a prohibited identifier.
>
> The only stable natural identifier Receita publishes for an establishment **is** its CNPJ. So any
> deterministic establishment key is a function of the CNPJ, and every function of it — raw,
> normalized, hashed, truncated, fingerprinted, encoded — is barred by (1). A key built from coarse
> attributes instead is not unique **and** increases indirect identifiability (10N § 5.4), so it fails
> both exactness and privacy. A non-CNPJ-derived surrogate (random UUID / opaque id) is the one
> admissible candidate and is **still not sufficient**, for the reason below.
>
> | field | disposition | owner |
> |---|---|---|
> | `tax_id` | `TRANSIENT_ONLY` | GATE-1 R4 (legal/privacy) |
> | `normalized_tax_id` | `TRANSIENT_ONLY` | GATE-1 R4 (legal/privacy) |
> | `record_identity_key` | `TRANSIENT_ONLY` | GATE-1 R4 (legal/privacy) |
>
> `TRANSIENT_ONLY` and **not** `REMOVED`, deliberately: removing them destroys the parser's own
> duplicate detection and pre-empts the owner question. Instead, persisting them is **refused** —
> `assertBrazilReceitaSnapshotRowIsPersistable`, unconditional, no flag, no override. The check a
> future author would most likely defeat is covered explicitly: nulling `tax_id` and
> `normalized_tax_id` while leaving `record_identity_key` as `tax:<14>` is still refused, because a
> namespace prefix is not a transformation.
>
> **🔴 The runtime lookup finding — a PRODUCTIZATION BLOCKER.** Every lookup primitive that exists
> takes one of two entry points, and Brazil can supply neither:
>
> ```
> readSnapshotByRecordIdentityKey     needs a caller-KNOWN key — a non-derived surrogate is
>                                     uncomputable outside the writing run
> readTaxGrainSnapshotByTaxId         needs normalized_tax_id — TRANSIENT_ONLY
> readLatestTaxGrainSnapshotByTaxId   same
> probeNativeSnapshotsByTaxId         same
> probeLatestNativeSnapshotsByTaxId   same
> ```
>
> Note why the `NATIVE_RECORD_GRAIN` family is not a template: `ec_scvs` keeps a provider-native
> `expediente` as its record identity **and persists `normalized_tax_id` as its lookup entry point**.
> Brazil cannot copy that — Receita publishes no second native identifier, and Brazil's blocked field
> *is* the lookup entry point. Fuzzy or name-based lookup is not an option: the shared identity module
> forbids the `name` namespace globally, in code.
>
> So the outcome is **(C) no compliant exact-lookup mechanism exists**. This is recorded as a
> productization blocker rather than worked around.
>
> **🔴 The single unresolved question** (legal/privacy — no agent may answer it):
>
> > Does the legal/privacy owner authorize exactly ONE persisted, never-printed, never-logged,
> > never-reported representation of the establishment CNPJ inside `source_company_snapshots`, to serve
> > as the row exact-lookup key, as a narrow enumerated exception to GATE-1 R4 — or not?
>
> *If yes*: GATE-4 can be approved with a deterministic key, the existing lookup primitives work
> unchanged, and the exception is recorded with its own enumerated bounds. *If no*: Brazil cannot
> support exact runtime lookup at all, and any Brazil snapshot would be write-only data no consumer
> can address.
>
> **F. Monthly identity — the schema does not support it.** Receita publishes MONTHLY; the physical
> table is YEAR-grained. `source_company_snapshots` has `source_year int NOT NULL` and **no
> `source_period` column** — the month lives only inside `raw_data.source_period`, a JSONB blob no
> unique constraint can see. Two hazards, and the second is the one Brazil is actually in:
>
> ```
> YH-1  normalized_tax_id populated  → 2026-08 UPSERTS ONTO 2026-07 for the same establishment;
>                                       monthly history destroyed by a constraint that believes it
>                                       is preventing duplicates
> YH-2  normalized_tax_id NULL       → NULLS DISTINCT makes UNIQUE (source_key, country_code,
>       (the TRANSIENT_ONLY outcome)    source_year, normalized_tax_id) VACUOUS; every month inserts
>                                       a full duplicate set, unbounded, no idempotency, no dedup
> ```
>
> **The exact future migration is recorded as TEXT and NOT authored** — § 8's *Does NOT allow* clause
> forbids creating a migration or changing the physical schema, so writing the `.sql` would be doing
> the forbidden thing while claiming to respect it. It is also premature: the unique index has to name
> whatever key the owner question settles on.
>
> ```sql
> ALTER TABLE public.source_company_snapshots ADD COLUMN source_period text NULL;
> ALTER TABLE public.source_company_snapshots
>   ADD CONSTRAINT source_company_snapshots_source_period_format_chk
>   CHECK (source_period IS NULL OR source_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;
> CREATE UNIQUE INDEX CONCURRENTLY source_company_snapshots_period_identity_uidx
>   ON public.source_company_snapshots (source_key, country_code, source_period, record_identity_key)
>   WHERE source_period IS NOT NULL AND record_identity_key IS NOT NULL;
> ```
>
> **Atomic replacement semantics — identity only, no implementation.** Current snapshot = the complete
> row set of the greatest `source_period`. Previous = the immediately preceding one. A period is
> superseded **as a whole**, never row by row; cross-month overwrite is forbidden; a partial month is
> never visible; rollback identity is the preceding period's row set, addressed by `source_period`. The
> atomic publish MECHANISM stays a GATE-8 deferred proof and the snapshot/runtime round's code.
>
> **What this round did NOT do.** No surrogate generator is implemented — a key nobody approved may not
> be built, and a test asserts the GATE-4 module reaches for no entropy, no hash and no key builder. No
> migration created or applied. No index or physical schema change. This source stays **absent** from
> `SOURCE_FAMILY_BY_SOURCE_KEY`, so `getSourceFamily` keeps throwing for it — a fail-closed throw is
> the correct answer to "which family is Brazil" while its persisted identity is unresolved.

```
Gate:                   GATE-4 — Identity grain decision
Status:                 needs_owner_decision  (advanced from not_started; NOT approved)
Approver:               data architecture owner AND product owner, jointly — none recorded
Approval date:          n/a — no approval exists
Evidence links:         10K § 8, § 8.1; 10N (all four options, consequences);
                        br-receita-cnpj-gate4-recorded-identity-grain.ts;
                        migrations 065 and 087 (the year-grained physical situation)
Decision summary:       Grain = option D, establishment as the operational unit with company as
                        context; root never an identity, root grouping a read-time projection.
                        Dedup by unit within one publication period; the period is the
                        idempotency unit. tax_id / normalized_tax_id / record_identity_key are
                        TRANSIENT_ONLY and persisting them is refused in code. Exact runtime
                        lookup is a recorded PRODUCTIZATION BLOCKER. Monthly grain needs a
                        schema change that is recorded as text and not authorized.
Artifacts approved:     none
Artifacts rejected:     options A, B and C, each with its rejection justified
Open follow-ups:        the single legal/privacy question above; and, only if it resolves yes,
                        the source_period migration and the unique index it needs
Blocks:                 any persisted identity; any migration; any index change; any Agent 1
                        Brazil lookup path
Allows:                 nothing — needs_owner_decision unlocks no next step and is NO-GO in § 15
Does not allow:         being read as an approval, as a licence to build a surrogate, or as a
                        resolution of the runtime lookup blocker
Restrictions:           no CNPJ derivative may be persisted under any name. A non-derived
                        surrogate is preferred for row identity and is insufficient for lookup.
                        Fail closed if exact lookup cannot be safely achieved.
```

---

---

## 9. GATE-5 — Output sanitization contract

**Governs (10J § 13):** confirms the 10J § 12 report schema and the 10J § 15 assertions —
aggregate-only output with an all-false safety block.

**Status today (as authored, 2026-07-29):** `not_started`. — 🔴 **SUPERSEDED BY § 9.1.** The current status is `ready_for_review`. The line above is retained as the historical record of what this section said when it was written; it is **not** the current state. The single authoritative current view is § 15, whose machine-readable form is `BRAZIL_RECEITA_GATE_CURRENT_STATE`.

### Required owner / approver

- **Security / privacy owner** **and** **test owner**, jointly.

### Required evidence

- The **aggregate report schema**, confirmed field by field against 10J § 12.
- A closed list of **forbidden key names** (socio, qsa, cpf, telefone, fax, ddd, email,
  logradouro, numero, complemento, bairro, cep, and equivalents).
- A closed list of **forbidden value patterns**.
- Rules rejecting **8-, 11-, and 14-digit identifier runs** (CNPJ básico, CPF, and full-CNPJ
  lengths).
- A rule rejecting the **email marker character** in any output field.
- Rules rejecting **raw rows and raw cell values** anywhere in output.
- Rules rejecting **stack traces that carry data**.
- The **required safety booleans**, all of which must be `false`.

### Pass criteria

- Every rule is expressed as an **assertion** a future test can enforce, not as prose guidance.
- The report is **aggregate-only**: counts, reason codes, status codes, safety booleans, elapsed
  time, row counters, file-family counts, aggregate exclusion counts.
- The contract fixes:

```
persisted_rows       = 0
import_executed      = false
supabase_write       = false
runtime_integration  = false
agent1_integration   = false
hubspot_write        = false
slack_write          = false
```

- Every member of the `safety` block is `false` by contract.

### Fail / block criteria

- A report carrying sample values of any kind.
- A report carrying join keys.
- A report carrying CNPJ básico, full CNPJ, CPF, email, phone, or address.
- Row hashes derived from identifiers or from the join key.
- Any safety boolean that can legitimately be `true`.

### Expected artifacts

- A confirmed report schema and an assertion list ready for a future test suite.
- A § 14 approval entry for GATE-5.

### Relation to flags

- Governs the whole 10J § 12 report contract and its `safety` block.
- Flips **no** operational flag.

### Allows

- Writing sanitization tests in a **future, separately-approved** milestone.

### Does NOT allow

- Executing the full join.
- Emitting any report from real data.

> **Update (BR-SOURCE-10O).** A docs-only **decision record proposing** this gate's output
> sanitization contract has landed —
> [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md).
> It supplies the *Required evidence* above in proposal form: a candidate aggregate report schema
> (§ 10), an **exact closed forbidden-key-name list with a normalization and matching rule** (§ 5.2)
> replacing the "and equivalents" tail above, closed forbidden value-pattern rules `VP-1` … `VP-10`
> (§ 5.3) including the 8-, 11-, and 14-position digit-run rules, a separator-insensitive rule, a
> longer-than-14 rule, and the email-marker rule, raw-row / raw-cell rejection, an error and exception
> sanitization contract (§ 8), a logging and console contract (§ 11), a gate-evidence contract (§ 12),
> a small-cell suppression proposal (§ 7), and the all-false safety block extended with seven proposed
> members (§ 10). It widens the *Governs* scope from the report to **twelve output surfaces** (§ 4),
> and proposes two deliberate narrowings for the approvers: **no stack emission at all** (stricter
> than 10J § 15) and **no cross-tabulations** in the first approved contract.
>
> Against the *Pass criteria*, the record is deliberately explicit about its own limit: § 5.4
> enumerates and stably names the assertions (`OS-A01` … `OS-A46`, plus `VP-1` … `VP-10`) so a future
> suite can be traced to them one-to-one, but **it writes no test**, because a test is code and § 4 of
> this checklist forbids full-join code until all eight gates are approved. It therefore **cannot
> satisfy the "every rule is an enforceable assertion" criterion on its own**, and says so rather than
> presenting a catalogue as a suite. Two rules are additionally unenforceable until the approvers
> supply values: the small-cell threshold `k` (`OS-A19`) and the string-length ceiling (`VP-8`).
>
> **GATE-5 remains `not_started` / not approved.** The record's status is
> `proposed_for_owner_review`, it freezes no report schema (10L § 9's constraint still holds while
> GATE-3 and GATE-4 are open), it assigns no `output_sanitization_version`, and it creates no
> sanitizer, test, fixture, runner, or command — nor does it authorize any dry-run, import, Supabase
> write, migration, index change, runtime, or Agent 1 integration.


### 9.1 The output sanitization contract is EXECUTABLE; GATE-5 is `ready_for_review` (BR-SOURCE-GATE-ROUND-3)

> **Update (BR-SOURCE-GATE-ROUND-3) — § 9.1 GATE-5 advances from `not_started` to
> `ready_for_review`, and is NOT approved.**
>
> BR-SOURCE-10O assembled this gate's contract and was explicit about the two things it could not
> deliver. Both are now closed, and the closing of each is a different kind of act:
>
> 1. **Two rules were unenforceable for want of a number.** `OS-A19` needed the small-cell threshold
>    `k`; `VP-8` / `OS-A10` needed the string-length ceiling. Those are *owner* values, and 10O § 7
>    said so: *"`k` is not derivable from this document."* The owner supplied them —
>    **`k = 10`** and **64 characters** — which are the values 10O proposed as its floor and its
>    starting point rather than different ones.
> 2. **No test existed.** 10O § 5.4 wrote *"No test is written here"*, and § 17 recorded that none
>    could be written from that document alone. GATE-5's pass criterion is that every rule be *"an
>    assertion a future test can enforce, not prose guidance"* — which a catalogue of stable IDs
>    cannot discharge, and which 10O correctly refused to claim it had. This round makes each rule a
>    predicate and asserts it.
>
> **The owner technical direction, as frozen.** Recorded as data in
> `br-receita-cnpj-gate5-output-contract.ts`, not as prose here:
>
> ```
> SMALL_CELL_K                     = 10
> MAX_OUTPUT_STRING_LENGTH         = 64
> CROSS_TABULATIONS                = PROHIBITED
> NAMED_MUNICIPALITY_COUNTS        = PROHIBITED
> STACK_OUTPUT                     = PROHIBITED
> RAW_ROW / RAW_CELL / IDENTITY_KEY OUTPUT = PROHIBITED
> TOTAL_ROWS_SCANNED               = ALLOWED
> CNAE_SECTION_COUNTS              = ALLOWED_WITH_SMALL_CELL_SUPPRESSION
> UF_COUNTS                        = ALLOWED_WITH_SMALL_CELL_SUPPRESSION
> CAPITAL_SOCIAL_REPORT_BREAKDOWN  = EXCLUDED
> OPENED_AT_REPORT_BREAKDOWN       = EXCLUDED
> MUNICIPALITY_REPORT_BREAKDOWN    = EXCLUDED
> ```
>
> **🔴 What the direction CHANGED about 10O § 6, and why it matters.** 10O listed
> `capital_social_bucket_counts`, `opened_at_bucket_counts` and `municipality_count_distribution` as
> allowable *subject to GATE-5 fixing their bucket boundaries* (10M § 13). The owner **excluded all
> three breakdowns instead.** That is a narrowing, and it discharges the 10M § 13 item **by exclusion
> rather than by a boundary table** — with the breakdown gone there are no boundaries left to fix. The
> three keys are therefore **absent from the frozen allowlist**, and `OS-A08` makes an absent key
> forbidden. Their absence is the exclusion being enforced, not an omission, and a test asserts
> exactly that.
>
> **🔴 Two collisions the owner values create — RECORDED, and not resolved by this round.**
> `TOTAL_ROWS_SCANNED = ALLOWED` is refused today by two invariants that already exist:
>
> | id | collides with | owning module | the choice |
> |----|---------------|---------------|-----------|
> | `OD-C1` | `BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF` (9,999,999) | `br-receita-cnpj-full-join-output-sanitizer` (BR-SOURCE-11A) | bucket the field, or record a named-key carve-out from the numeric ceiling |
> | `OD-C2` | `VP-1` and `VP-4`, on the RENDERED surface | this contract / 10O § 5.3 | bucket the field, or record a named-key carve-out from the digit-run rules |
>
> `OD-C1` and `OD-C2` are the same fact twice: an exact dataset-scale figure and a rule against long digit runs
> cannot both hold on one surface. **BR-SOURCE-11A was not weakened to accommodate the direction** —
> editing a live privacy invariant to make a convenience fit is how this line loses the invariant it
> was built to keep. Both are owner decisions, both sit inside the GATE-5 review, and a test asserts
> both are recorded and neither is claimed resolved.
>
> 🔴 **And a third collision, this one INSIDE 10O itself.** `OD-C3`: the residual bucket label 10O § 7
> **requires** small-cell suppression to emit — `other_or_suppressed_small_cell` — contains `cell`,
> which 10O § 5.2 group 7 substring-matches. **The one label the mechanism cannot work without is
> forbidden by the same record's key rule.** This round admits it under the precedence 10O § 5.2 itself
> states — *"the allowlist governs"* — and edits neither list. The approvers either rename the label to
> a `cell`-free form or record it as a contract-named exemption.
>
> That precedence is load-bearing well beyond the residual label, and it is the finding a future author
> is most likely to undo. Three keys the frozen § 6 allowlist **requires** — `persisted_rows`,
> `rows_seen_by_family` and `total_rows_scanned` — trip group 7's deliberately-broad `row` substring.
> Without *"the allowlist governs"*, **the frozen § 6 report is un-emittable by its own contract**: its
> two halves refuse each other. The set is enumerated in
> `BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST` and a test fails if a fourth appears
> unrecorded. Note which key is in it: `total_rows_scanned`, already named by `OD-C1` and `OD-C2`.
> **One owner-allowed field refused by three independent rules of the record that allows it** is a
> signal about the field, and the approvers should read it as one rather than as three carve-outs to
> grant.
>
> **🔴 A residual gap in the frozen rules, named rather than papered over.** `VP-1` … `VP-3` name runs
> of exactly 8, 11 and 14 positions and `VP-4` names runs *longer* than 14. Runs of **9, 10, 12 and 13**
> positions are therefore uncovered by the frozen rules as written. This round implements the rules
> **as frozen** — 10O § 5.3's own warning is against indiscriminate widening — and records the residual.
> What closes the gap today is 11A's `LONG_DIGIT_RUN`, which matches eight-or-more. That is evidence
> that 11A is load-bearing rather than redundant, and the approvers should confirm that reading.
>
> **What became executable.** In `br-receita-cnpj-gate5-output-guard.ts`, every rule is a predicate:
> the four-step § 5.2 normalization and the seven closed key groups with their declared match modes;
> `VP-1` … `VP-10`; the § 6 allowlist as the governing net; small-cell suppression with the
> single-count residual, complementary suppression, and an outright **failure** state for a family
> that cannot be made compliant; the § 8.2 error envelope built by a single constructor that sanitizes
> at construction; and the § 11 closed log field set. `OS-A01` … `OS-A46` are mapped one-to-one:
> **41 IDs** (10O skips `OS-A29` and `OS-A36` … `OS-A39`), of which **38 are executable and asserted**,
> **2 are deferred to an implementation that does not exist** (`OS-A24` needs a human-report emitter,
> `OS-A26` needs an evidence assembler), and **1 is owned by GATE-6** (`OS-A46`, cleanup, made
> executable in Round 2). **None is deleted and none is weakened**, and the superseded list is empty
> **as a finding**: an output rule about a value is not obsoleted by that value ceasing to be persisted.
>
> **🔴 GATE-5 is still shut, for one exact reason.** `ready_for_review` is § 3's *"evidence complete
> and submitted; awaiting the named approver"*, and § 15's matrix reads NO-GO for it exactly as for
> `not_started`. GATE-5 needs the **security / privacy owner AND the test owner, jointly**, and § 3
> forbids the implementer of a gate's subject from approving it. **This round implemented the subject.**
> No agent may supply either half.
>
> **What this round did NOT do.** It wrote no runner, no report emitter, and no wiring from the guard
> into any execution path — the guard is pure and reachable only from tests, and a test asserts that no
> production module imports it. It froze no **report schema**: 10L § 9's constraint holds while GATE-3
> and GATE-4 are open, and the three contract markers still read `"not_approved"` /
> `"not_decided"`. It resolved neither GATE-3 nor GATE-4, flipped no flag, applied no migration,
> touched no real Receita data, ran no benchmark, and authorized no dry-run, import, Supabase write,
> index change, runtime, or Agent 1 integration.

```
Gate:                   GATE-5 — Output sanitization contract
Status:                 ready_for_review  (NOT approved)
Recorded by:            BR-SOURCE-GATE-ROUND-3, 2026-08-21
Required approvers:     security/privacy owner AND test owner, jointly
Approval supplied:      none — and no agent may supply either half
Frozen values:          k = 10; string ceiling 64; no cross-tabs; no named municipalities;
                        no stack output; three breakdowns EXCLUDED
Assertions:             41 accounted for — 38 executable and asserted,
                        2 deferred to absent implementation, 1 owned by GATE-6;
                        0 deleted, 0 weakened, 0 superseded
Open decisions inside
the review:             OD-C1 and OD-C2 (total_rows_scanned vs the 11A numeric ceiling and
                        vs VP-1/VP-4); OD-C3 (the § 7 residual label is refused by § 5.2
                        group 7 — rename it, or record a contract-named exemption);
                        confirmation that the allowlist-governs precedence is intended,
                        without which the frozen § 6 report is un-emittable;
                        confirmation that the three exclusions discharge
                        10M § 13; confirmation that 11A's LONG_DIGIT_RUN is load-bearing for
                        the 9/10/12/13-position residual; whether real local manifest paths
                        are sensitive (10O § 12 flags, does not answer)
Single remaining
criterion:              the § 14 joint approval entry, recorded against this executable contract
Flags flipped:          none
Machine-readable form:  br-receita-cnpj-gate5-recorded-output-sanitization.ts
                        br-receita-cnpj-gate5-output-contract.ts
                        br-receita-cnpj-gate5-output-guard.ts
```

---

### 9.2 The GATE-5 contract's three collisions are CLOSED by SUPERSESSION; the gate is still `ready_for_review` (BR-SOURCE-FAST-TRACK-6)

**Status:** unchanged — `ready_for_review`, **not** approved. What changed is the SUBJECT of the pending
review, not its outcome.

**The three collisions § 9.1 left open are closed, and every one was closed on the owner-direction
side.** That sentence is the whole subsection, and the direction of the fix is what makes it
reportable: each collision was a fight between an owner value and a live privacy invariant, and in all
three the *owner value* moved.

| id | Round-3 owner direction | superseded by | invariant that did NOT move |
|----|------------------------|---------------|------------------------------|
| `OD-C1` | `TOTAL_ROWS_SCANNED = ALLOWED` | `TOTAL_ROWS_SCANNED = INTERNAL_EXECUTION_COUNTER_ONLY` | `BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF` (BR-SOURCE-11A) |
| `OD-C2` | the same direction, on the rendered surface | the same supersession | `VP-1`, `VP-4`, and the rendered-output check |
| `OD-C3` | residual label `other_or_suppressed_small_cell` | residual label `suppressed_other` | § 5.2 **group 7**, unedited |

**`total_rows_scanned` is now INTERNAL, which is not the same as "quieter".** The counter may exist
inside an execution; it is emitted on **no** surface — not the sanitized report, not the JSON report,
not the human report, not logs, not console, not errors, not exceptions, not gate evidence, not the
operator summary. `BRAZIL_RECEITA_GATE5_INTERNAL_ONLY_COUNTER_PERMITTED_SURFACES` is empty, and it is
empty as an assertion. The reasons, recorded rather than implied: the exact figure can exceed the
11A numeric ceiling; its *rendered* form collides with the digit-run rules; no Agent 1 or product
function needs it; and there was no reason to weaken 11A to keep it.

🔴 **A key absent because it was EXCLUDED and a key absent because it is INTERNAL-ONLY are different
things.** An excluded breakdown (`capital_social`, `opened_at`, municipality) could be re-proposed with
bucket boundaries. An internal-only counter has no surface to be re-proposed onto. The § 6 allowlist
carries both kinds of absence and the contract names which is which.

**Two output keys were RENAMED rather than left on a carve-out.**

```
persisted_rows        →  records_persisted
rows_seen_by_family   →  records_seen_by_family
```

Both tripped group 7's deliberately broad `row` substring and were admitted only by the
*allowlist-governs* precedence. 10O § 5.2's own recorded resolution for exactly this case is to
**rename the aggregate, never to weaken the matcher**, and a safe semantic name existed in both cases,
so the rename is what happened. No denylist group was edited, narrowed, or given an exemption.

🔴 **The rename does not orphan a historical invariant.** § 12's *Governs* clause and 10J § 12 both
name `persisted_rows = 0` in prose. Those documents are **not** edited — an approval record that
rewrites itself is not a record — so `BRAZIL_RECEITA_GATE5_OUTPUT_KEY_RENAMES` carries the mapping
forward instead, with the historical references listed per key. Neither key had a production emitter,
so no runtime surface changed shape.

**`BRAZIL_RECEITA_GATE5_ALLOWLISTED_KEYS_TRIPPING_DENYLIST` is now EMPTY**, and empty as a *finding*.
Round 3 carried three entries. Two were renamed and one was superseded, so nothing in the frozen
contract currently depends on the precedence carve-out.

🔴 **The precedence itself is KEPT, not deleted.** `ALLOWLIST_GOVERNS` stays `true` because it decides
what happens the *next* time a § 6 key and a denylist group disagree — and the safe answer to that
question must exist before the disagreement, not after it. The empty list is the evidence that no key is
currently relying on it, which is a different claim from the rule being unnecessary. No authoritative
immutable key forced a carve-out to survive: `BRAZIL_RECEITA_GATE5_IMMUTABLE_KEY_FORCING_A_CARVE_OUT` is
`null`.

**One Round-3 comment was factually wrong and is corrected.** § 9.1's guard docstring listed
`join_outcome_counts` among the keys admitted by the precedence. It contains neither `row` nor `cell`
and was never admitted by it. Left uncorrected, that error makes a carve-out look load-bearing where it
is not.

**The VP rules are unchanged and the two digit-run contracts stay separate.** `VP-1` … `VP-4` keep their
frozen wording at exactly 8, 11, 14 and over-14 positions; BR-SOURCE-11A's `LONG_DIGIT_RUN` keeps
matching 8-or-more independently. `BRAZIL_RECEITA_GATE5_DIGIT_RUN_CONTRACTS_MERGED` is `false` and
`..._VP_RULES_WIDENED_BY_THIS_ROUND` is `false`. What this round added is a test that runs of **8, 9,
10, 11, 12, 13, 14 and over 14** each fail closed through at least one authoritative layer, proved by
*executing* both layers rather than by trusting a table. Two independent nets with two authorities catch
what one widened regex would not.

**What is still missing, and it is the only thing.** The § 14 joint entry from the **security/privacy
owner** and the **test owner**, recorded against the CORRECTED contract. § 3 forbids the implementer of
a subject from approving it, this round revised the subject, and
`BRAZIL_RECEITA_GATE5_REVISIONS_EARN_AN_APPROVAL` is `false` — a round that closes everything the
previous review flagged does not thereby earn the approval. If anything, a revised subject makes any
earlier partial review moot.

---

## 10. GATE-6 — Failure cleanup contract

**Governs (10J § 13):** confirms 10J § 9 — cleanup on completion **and** failure, with
`cleanup failed` as a terminal state.

**Status today (as authored, 2026-07-29):** `not_started`. — 🔴 **SUPERSEDED BY § 10.1.** The current status is `ready_for_review`. The line above is retained as the historical record of what this section said when it was written; it is **not** the current state. The single authoritative current view is § 15, whose machine-readable form is `BRAZIL_RECEITA_GATE_CURRENT_STATE`.

### Required owner / approver

- **Technical owner** **and** **operator owner**, jointly.

### Required evidence

Cleanup behaviour defined for each terminating path:

- **normal completion**;
- **error** (manifest invalid, layout mismatch, forbidden file family, unexpected parser error);
- **operator cancellation**;
- **memory limit / disk limit reached**;
- **privacy assertion failure** (a sensitive value reached an output surface).

Plus, explicitly:

- which artifacts **may survive** a run;
- which artifacts **must be destroyed**;
- what **sanitized summary** may remain after a failure.

### Pass criteria

- **Fail closed** — the run stops the moment a failure or leak assertion trips; no best-effort
  continuation.
- **No automatic retry** without an operator.
- **No Supabase writes under any condition** — not on success, not on failure, not on retry.
- Temporary material is **removed, or safely quarantined**, with the outcome verified.
- **Cleanup failure is terminal**: the run reports failure and surfaces the safe fact that manual
  cleanup is required. It never reports success with residue on disk.

### Fail / block criteria

- A partial temporary index left with no defined handling.
- A partial report that could contain values.
- Logs containing raw values.
- An operator able to continue after a leak.
- Any retry path that re-reads data without an explicit operator action.

### Expected artifacts

- A per-failure-type cleanup matrix.
- A § 14 approval entry for GATE-6.

### Relation to flags

- Governs 10J § 9 and the cleanup-verification step of the operator runbook (GATE-7).
- Flips **no** operational flag.

### Allows

- Designing the future runner's error handling.

### Does NOT allow

- Running the runner.
- Any write path.

> **Update (BR-SOURCE-10PQR).** A docs-only **decision packet proposing** this gate's cleanup contract
> has landed —
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md),
> § 4 and § 5. It supplies the *Required evidence* above in proposal form: a **thirteen-scenario cleanup
> matrix** (§ 4.4) covering all five terminating paths named above plus process crash, permission error,
> gate-preflight failure, small-cell suppression failure, report-write failure, sanitizer failure, and
> disk exhaustion separated from out-of-memory; a closed **destroyable artifact class list** `AC-01` …
> `AC-12` with a fail-closed catch-all, which answers *which artifacts must be destroyed*; the *may
> survive* column, which answers *which artifacts may survive*; and the § 5 cleanup artifact contract,
> which answers *what sanitized summary may remain* — a counts-and-enums report carrying a
> `directory_class` enum instead of any path, plus a closed controlled `error_code` list.
>
> Against the *Pass criteria*, it adds three things the inherited material lacked: a
> **temporary-artifact ledger** written *before* each artifact is created, so that destruction can be
> verified even after a crash (§ 4.6); an explicit **cleanup ordering** that destroys key-bearing memory
> before any on-disk class and forbids skipping a later step because an earlier one failed (§ 4.5); and
> a **best-effort-in-execution / fail-closed-in-reporting** split, so that `cleanup_unverified` is an
> admissible honest outcome under out-of-memory and process crash rather than a silent success. On the
> "removed, or safely quarantined" permission above, it **recommends delete** and would admit quarantine
> only under an approved GATE-2 envelope and never for a source-derived artifact — leaving the decision
> to the approvers (§ 4.2). It also names the escalation pair this gate's *Required evidence* left
> implicit: the operator and technical owners jointly, plus the privacy owner for a leak-class outcome.
>
> **GATE-6 remains `not_started` / not approved.** The packet's status is `proposed_for_owner_review`;
> its contract is stated **conditionally on GATE-2** because what must be destroyed is bounded by what
> may exist; two of its assertions (`FC-A02`, `FC-A23`) are unenforceable until the envelope is chosen;
> and it creates no cleanup code, no verification command, no test, and no runner — nor does it authorize
> any dry-run, import, Supabase write, migration, index change, runtime, or Agent 1 integration.

### 10.1 The cleanup contract is EXECUTABLE; GATE-6 is `ready_for_review` (BR-SOURCE-GATE-ROUND-2)

> **Update (BR-SOURCE-GATE-ROUND-2) — § 10.1 GATE-6 advances from `not_started` to
> `ready_for_review`.** Recorded in
> [`br-receita-cnpj-gate6-recorded-cleanup-contract.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate6-recorded-cleanup-contract.ts).
>
> **What unblocked it.** The 10PQR proposal was blocked on something real: it stated its contract
> "conditionally on GATE-2, because what must be destroyed is bounded by what may exist", and two of
> its assertions were unenforceable until the envelope was chosen. Round 1 chose the envelope (§ 6.1).
> What remained is that this gate's pass criteria are claims about **behaviour** — "cleanup failure is
> terminal", "it never reports success with residue" — which no document can discharge.
>
> **The split that existed before, and why neither half was enough.**
>
> - the partition workspace could delete and verify, but only its own workspace;
> - `br-receita-cnpj-full-join-cleanup` is a pure PLANNER that by construction cannot delete a path,
>   so a required cleanup ALWAYS reported `not_executed` / `cleanup_engine_not_authorized`, and
>   `unsafe_artifacts_detected` was the hard-wired literal `false` — honest for a runner that produced
>   nothing, and unable to ever report a verified deletion or detect residue.
>
> **What this round added.** A coordinator that owns units, drives each unit's own confined verified
> deletion, and reduces the outcomes:
>
> - **SUCCESS-WITH-RESIDUE IS UNREPRESENTABLE.** `completed` requires, as one conjunction, zero
>   failure codes **and** every unit `verifiedAbsent` **and** zero residual entries. There is no code
>   path from residue to success, and the report bridge returns `null` rather than rendering a
>   residue-bearing run as a clean block.
> - **`failed` and `not_executed` are TERMINAL and LATCHED.** A retry cannot upgrade them, and a test
>   proves a unit that *would* succeed on a second call never gets one. Re-attempting is an operator
>   action — a new coordinator, not a second call.
> - **Idempotent**, callable after **partial initialization** (register before create, so a unit that
>   was never created verifies absent) and after **engine failure**.
> - **Every unit is attempted even after one fails.** GATE-6 forbids skipping a later step because an
>   earlier one failed; abandoning the rest would leave residue nobody tried to remove.
> - **No path parameter exists anywhere in the API.** "Never recursively delete an arbitrary parent
>   directory" is structural, not a rule: the coordinator holds closures supplied by the owning
>   modules, which already validated their own boundaries, symlink safety and own-prefix confinement.
> - **`unverified` is preserved as a distinct fact**, not flattened into `failed`, and never into
>   success. Likewise `deleted` vs `verifiedAbsent` on the private artifact: an unlink that returned
>   and a file that is provably gone are different claims, and only the second licenses the report.
>
> **A defect fixed on the way.** The workspace's `dispose()` was **not** idempotent: a second call on a
> verifiably-removed workspace fell through to `listNames`, which throws on a missing directory, and
> reported `unverified` — "nobody can say whether residue exists" about a workspace that had just been
> verified absent. A repeat call downgrading a verified success is the opposite of idempotent. It now
> reports `not_needed`, verified absent, and a dangling symlink at the path still counts as PRESENT.
>
> **§ 16 — private artifacts are audited SEPARATELY from partition data.** The private operator metric
> artifact has a contractual TTL (default 1 h, ceiling 24 h, disabled by default) and may legitimately
> outlive the **process**. It may never outlive a declared-**completed cleanup**, and that is enforced:
> a run cleanup deletes it unconditionally, TTL or no TTL. A separate TTL-purge unit exists for a
> sweep, and using purge semantics inside a run cleanup is precisely how a stale artifact would
> survive. `snapshot_output` is a declared unit class that is **REFUSED** at registration: a cleanup
> engine that could delete snapshot output is a cleanup engine that could delete a snapshot.
>
> **Why the gate is still shut, exactly.** GATE-6 needs the technical owner **and** the operator owner,
> jointly, and § 3 forbids the implementer of a gate's subject from approving it. **This round
> implemented the subject.** One substantive decision sits inside that review and is named rather than
> assumed: 10PQR § 4.2 recommended DELETE and would admit quarantine only under an approved GATE-2
> envelope — this implementation does DELETE and offers no quarantine path. That is the proposal's
> recommendation built, not a new decision, but it is the proposal's and not the owners' until they say
> so.

```
Gate:                   GATE-6 — Failure cleanup contract
Status:                 ready_for_review  (advanced from not_started; NOT approved)
Approver:               technical owner AND operator owner, jointly (privacy owner joins for a
                        leak-class outcome) — none recorded
Approval date:          n/a — no approval exists
Evidence links:         10K § 10, § 10.1; 10PQR § 4–§ 5; § 6.1 (the envelope that unblocked it);
                        br-receita-cnpj-gate6-recorded-cleanup-contract.ts;
                        br-receita-cnpj-full-join-cleanup-coordinator.ts;
                        br-receita-cnpj-full-join-cleanup-units.ts
Decision summary:       The cleanup contract is executable. Success requires verified deletion of
                        every owned unit with zero residue; success-with-residue is
                        unrepresentable; failed and not_executed are terminal and latched;
                        cleanup is idempotent and callable after partial initialization or engine
                        failure; only owned paths are deleted and no path is accepted from a
                        caller; private artifacts are a separate unit class that may outlive the
                        process but never a completed cleanup; snapshot output is refused as a
                        cleanup subject. All ten terminating paths route through one contract.
Artifacts approved:     none
Artifacts rejected:     quarantine — not implemented and not authorized
Open follow-ups:        the joint § 14 entry; the owners' confirmation of delete-over-quarantine
Blocks:                 writing the runner; any run; any Supabase write on any cleanup path
Allows:                 nothing — ready_for_review unlocks no next step and is NO-GO in § 15
Does not allow:         being read as an approval, or as permission to run anything
Restrictions:           a failed or not_executed cleanup may not be upgraded by a retry. The
                        implementer of this subject may not approve this gate.
```

---

---

## 11. GATE-7 — Operator runbook approval

**Governs (10J § 13):** confirms 10J § 16 — the manual steps an operator follows to run a future
dry-run safely and reproducibly.

**Status today (as authored, 2026-07-29):** `not_started`. — 🔴 **SUPERSEDED BY § 11.1.** The current status is `blocked`. The line above is retained as the historical record of what this section said when it was written; it is **not** the current state. The single authoritative current view is § 15, whose machine-readable form is `BRAZIL_RECEITA_GATE_CURRENT_STATE`.

### Required owner / approver

- **Operator owner**, **technical owner**, and **privacy owner**, jointly.

### Required evidence

- A **preflight checklist** confirming every gate is `approved` and recorded.
- A **disk / memory check** against the GATE-2 ceilings.
- A **local path check** — the controlled folder outside the repo (runbook § 4).
- A **manifest check** — validated per runbook § 10, local file manifest only, never a URL.
- A **forbidden-family check** — no socios / QSA / CPF / person files present.
- An **explicit dry-run confirmation** step (the `--confirm-full-join-readiness-dry-run` flag).
- **Live monitoring** instructions for the run.
- **Cleanup verification** steps.
- A **report location outside the repository**.
- A **sensitive scan of the report** (no digit runs, no email markers, no keys, no values).
- **Post-run deletion rules** for temporary material.
- A **final signoff template** recording the aggregate result only.

### Pass criteria

- The runbook is **reproducible** by a different operator without tacit knowledge.
- **No ambiguous manual step** — each step has a definite action and a definite pass condition.
- The operator **cannot accidentally import**.
- The operator **cannot accidentally write to Supabase**.
- The report path is outside the repository and is never committed.

### Fail / block criteria

- Ambiguous or interpretation-dependent manual steps.
- No cleanup verification step.
- A report written inside the repository.
- No sensitive scan of the report before it is read or shared.
- A preflight that does not verify gate status.

### Expected artifacts

- An approved operator runbook section (an extension of the existing manual-download / local-prep
  runbook, not a competing document).
- A § 14 approval entry for GATE-7.

### Relation to flags

- Governs the manual procedure only.
- Flips **no** operational flag.

### Allows

- Preparing a **future** manual execution.

### Does NOT allow

- Executing without the separate, explicit authorization of a future milestone. An approved runbook
  is a *procedure*, never a *permission*.

> **Update (BR-SOURCE-10PQR).** A docs-only **decision packet proposing this gate's runbook contract** —
> the shape a runbook must take, not the runbook — has landed —
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md),
> § 6 and § 7. It maps the *Required evidence* above onto a twenty-two-item preflight `P-01` … `P-22`
> (gate status first, at `P-05`), sixteen non-overridable stop conditions `T-01` … `T-16`, a closed
> permitted-evidence list with an explicit forbidden-evidence list, post-run deletion tied to the § 4
> cleanup contract, and a signoff carrying the aggregate result only. It adds two things this checklist
> left implicit: **who may operate** — a named authorized human operator only, never an agent, an
> automation, or a CI runner, and never "on behalf of" an operator (§ 6.1) — and the twelve **operator
> behavior rules** (§ 7) that are the mitigation of record for the screenshot / copy-paste risk 10O § 4
> surface L identified as undetectable by any assertion, including *no manual editing of a report to make
> it pass* and *a warning is never a pass*.
>
> Against the *Pass criteria*, the packet is explicit about what it cannot deliver: **the runbook section
> itself does not exist**, and four preflight items cannot be performed today — `P-05` fails by
> construction while any gate is unapproved, `P-12` and `P-13` have no GATE-2 ceilings to check against,
> and `P-19` has no frozen GATE-5 sanitizer contract. *Reproducible by a different operator* is therefore
> **not** demonstrated: a contract can define the steps, but only a rehearsal against real ceilings can
> prove reproducibility, and no execution is authorized.
>
> **GATE-7 remains `not_started` / not approved.** Status `proposed_for_owner_review`; GATE-2, GATE-5,
> and GATE-6 all still block it; no runbook section is written, no manual execution is prepared or
> authorized, and an approved contract would still be a *procedure*, never a *permission*. It authorizes
> no dry-run, import, Supabase write, migration, index change, runtime, or Agent 1 integration.

---

### 11.1 The runbook SECTION now EXISTS; GATE-7 is `blocked` (BR-SOURCE-FAST-TRACK-6)

**Status:** `blocked`. **Not** `ready_for_review`, and not `not_started` either.

**What changed.** The one artifact this section's *Expected artifacts* asks for and that 10PQR § 6 was
explicit it could not deliver now exists: **the operator runbook section**, as
[§ 16 of the manual-download / local-prep runbook](./br-receita-cnpj-manual-download-local-prep-runbook.md)
— an *extension* of the existing runbook, never a competing document — with its machine-readable half
in `br-receita-cnpj-gate7-operator-runbook`. Every one of the twelve *Required evidence* items above
now has a concrete manual step with one action and one definite pass condition, and the preflight
`P-01` … `P-22` is implemented rather than described.

Three of those steps are **executable** rather than prose:

| step | what executes | verdict today |
|------|---------------|---------------|
| `P-05` gate status | `evaluateBrazilReceitaGate7Preconditions()` reads `BRAZIL_RECEITA_GATE_CURRENT_STATE` | **FAIL** — six gates unapproved |
| privacy preflight | `evaluateBrazilReceitaGate7PrivacyPreflight()` over the five contract-owning gates | **FAIL** — four unapproved |
| operator identity | `brazilReceitaGate7ActorMayExecute()` | refuses every non-human class, including *on behalf of* a human |

The evaluator takes **no arguments**. There is no `force`, no options object, no environment read and
no override, so there is no surface on which a future caller could weaken it —
`BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS` is `false` and a test asserts it.

**Why `blocked`, and not the two statuses that look adjacent to it.** § 3 defines `blocked` as *"an
external dependency (legal, **another gate**, an unresolved leak) prevents review"*, and the update
above says the dependency in those words: *GATE-2, GATE-5, and GATE-6 all still block it.*

- `not_started` is now **false**. Evidence exists — the section, the executable preflight, the resource
  and privacy evaluators, and `OR-A01` … `OR-A20` mapped onto them. Reporting `not_started` would
  understate the state as badly as `ready_for_review` overstates it.
- `needs_evidence` would be wrong about **what** is missing. Nothing about this gate's own evidence is
  incomplete; three *other* gates' approvals are.
- `ready_for_review` is forbidden by the dependency contract. § 4 orders approval by the dependency
  graph, and § 3 forbids approval by inference — which is what *"the document is done, so review it"*
  would amount to.

🔴 **`blocked` is NO-GO, exactly as `not_started` is** (§ 15). This subsection advances the gate's
reviewability and nothing else. Per § 4, a `blocked` gate forbids writing any full-join code, and none
was written.

**The exact remaining blockers.** Four, and no agent can discharge any of them:

```
1. GATE-2 approved   → today needs_owner_confirmation (bucket-ordinal privacy confirmation)
2. GATE-5 approved   → today ready_for_review (joint security/privacy + test owner)
3. GATE-6 approved   → today ready_for_review (joint technical + operator owner)
4. REPRODUCIBILITY_BY_DIFFERENT_OPERATOR = UNDEMONSTRATED
```

🔴 **The fourth is different in kind from the first three, and the distinction is the one most easily
lost.** Approving GATE-2, GATE-5 and GATE-6 unblocks the *review*; it does not demonstrate
reproducibility. Only a rehearsal, by an operator who did not author the section, against real
ceilings, can show the steps carry no tacit knowledge — and no rehearsal is authorized, none was
performed, and none is authorized by this section existing. GATE-7's own three approvers decide whether
the section plus three approved upstream gates is enough to review, or whether they require the
rehearsal first. That is their call and this document does not make it for them.

**What this subsection does not do.** It approves no gate; it authorizes no run, dry-run, rehearsal or
benchmark; it changes no resource cap, no flag and no attempt budget —
`BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED` is *imported* and stays `false`; it reads no real
Receita data and learns no manifest, path or file name; it authors and applies no migration; and it
performs no Supabase write of any kind. An approved runbook would still be a *procedure*, never a
*permission*.

---

## 12. GATE-8 — No-write / no-runtime guarantee

**Governs (10J § 13):** forces the 10J § 11 no-write flags and the 10J § 12
`import_executed = false` / `persisted_rows = 0` / all-false safety invariants.

**Status today (as authored, 2026-07-29):** `not_started`. — 🔴 **SUPERSEDED BY § 12.1.** The current status is `APPROVED_AS_CONTRACT`. The line above is retained as the historical record of what this section said when it was written; it is **not** the current state. The single authoritative current view is § 15, whose machine-readable form is `BRAZIL_RECEITA_GATE_CURRENT_STATE`.

### Required owner / approver

- **Repo safety owner** **and** **technical owner**, jointly.

### Required evidence

Mandatory flags — the run refuses to start without them:

```
--no-supabase
--no-import
--no-runtime
--no-agent1
--strict
--format json
--confirm-full-join-readiness-dry-run
```

Forbidden flags — their mere presence is rejected fail-closed, before any file is opened, with a
stable `BRSOURCE10J_FORBIDDEN_*` code (in the spirit of `BRSOURCE7_FORBIDDEN_DRY_RUN_MODE`):

```
--apply
--write
--supabase
--agent1
--runtime
--hubspot
--slack
```

Plus confirmation that:

- **no write path exists** anywhere in the future code path;
- **no migration** is created or modified;
- **Agent 1 is not touched**;
- **no provider is called**;
- a URL manifest or an out-of-range limit is rejected **before** any file is opened.

### Pass criteria

- No-write is **enforced by the CLI contract**, not by convention or reviewer vigilance.
- No runtime imports.
- No Supabase client write calls.
- No provider calls.
- No HubSpot / Slack integration.

### Fail / block criteria

- Any write path, however guarded.
- Any migration.
- Any Agent 1 integration.
- Any provider call.
- Any production side effect.
- A forbidden flag accepted and ignored rather than rejected.

### Expected artifacts

- A confirmed CLI contract (mandatory + forbidden flags, rejection codes, rejection timing).
- A § 14 approval entry for GATE-8.

### Relation to flags

- Governs the 10J § 12 invariants `import_executed = false`, `supabase_write = false`,
  `runtime_integration = false`, `agent1_integration = false`, `persisted_rows = 0`.
- Flips **no** operational flag.

### Allows

- Writing a future runner **as a strict local dry-run**, and only if every other gate is
  `approved`.

### Does NOT allow

- Importing.
- Activating runtime.
- Activating Agent 1.
- Any Supabase write.

> **Update (BR-SOURCE-10PQR).** A docs-only **decision packet proposing** this gate's guard contract has
> landed —
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md),
> § 8 and § 9. It restates the mandatory and forbidden flag sets above unchanged, and adds: a closed
> **blocked-surface list** `NB-01` … `NB-20` naming each write, integration, and side-effect surface
> individually (including index changes, schema changes, flag writes, persistent cache and shared
> storage, and cloud uploads — with **zero network calls** as a recommendation); **structural**
> enforcement requirements rather than convention (no write-capable client constructed, no service role
> key present in the environment at all, no Supabase / Agent 1 / HubSpot / Slack / provider module
> imported transitively, dry-run mode hardcoded and fail-closed rather than defaulted); **rejection
> ordering as part of the contract**, so that a refusal happens before any file is opened and before any
> artifact exists and therefore leaves no residue; and the enumerated no-write test list `NW-A01` …
> `NW-A28` this gate's *Expected artifacts* clause requires.
>
> On the *Pass criteria* — "no-write is enforced by the CLI contract, not by convention or reviewer
> vigilance" — the packet takes an explicit position on the split 10L § 12 flagged (§ 8.3): the
> **contract is approvable now**, and the **proofs land with the implementation**, because they are
> proofs about code that does not exist and § 4 of this checklist forbids producing them by writing it.
> It records both failure modes — treating the proofs as prerequisites deadlocks the gate, treating the
> contract as sufficient for execution voids it — and states plainly that **GATE-8 approved as a contract
> does not authorize writing the runner**, because the *Allows* clause above is conditional on every other
> gate being approved, and seven are not.
>
> **GATE-8 remains `not_started` / not approved.** Status `proposed_for_owner_review`; no guard, no CLI,
> no runner, and no test is created; and it authorizes no import, runtime activation, Agent 1 activation,
> Supabase write, migration, or index change.

### 12.1 GATE-8 is APPROVED_AS_CONTRACT (BR-SOURCE-GATE-ROUND-1)

> **Update (BR-SOURCE-GATE-ROUND-1) — § 12.1 GATE-8 is approved AS A CONTRACT.** The repo safety
> owner and the technical owner jointly approved along exactly the line the 10PQR packet proposed in
> § 8.3: the **contract is approvable now**, and the **proofs land with the implementation**, because
> they are proofs about code that § 4 forbids writing until every gate is approved.
>
> 🔴 The recorded value is `APPROVED_AS_CONTRACT`, not a bare `approved`, and that is deliberate: a
> reader scanning for approved gates must not be able to mistake a contract approval for an operating
> one. It authorizes **no operation of any kind**, and it does not authorize writing the runner —
> this gate's own *Allows* clause is conditional on every other gate being approved, and six are
> not (GATE-2 is `needs_owner_confirmation`, not `approved` — § 6.1). The record states
> `authorizesOperations: false` as data, and
> [`br-receita-cnpj-gate8-recorded-contract-approval.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate8-recorded-contract-approval.ts)
> has **no imports at all** — a record that imports nothing can flip nothing.
>
> Every preserved invariant is asserted by test against the module that really owns it, never against
> the record's own copy, which would be circular: `maxOutputRows` is `0` in the benchmark profile, the
> resolver subset and the provisional envelope; the null benchmark sink still tallies
> `rowsEmitted: 0` and `recordsRetained: 0`; and the offline parser still summarizes `db_writes: 0`,
> `snapshot_writes: 0`, `dataset_downloads: 0`.

```
Gate:                   GATE-8 — No-write / no-runtime guarantee
Status:                 approved — as a CONTRACT only (decision value APPROVED_AS_CONTRACT)
Approver:               repo safety owner AND technical owner, jointly
Approval date:          2026-08-21
Evidence links:         10K § 12; 10J § 11 (no-write flags), § 12 (safety invariants);
                        br-receita-cnpj-full-join-remaining-gates-decision-packet.md § 8 / § 9
Decision summary:       The mandatory and forbidden flag sets, the blocked-surface list NB-01…NB-20,
                        the structural enforcement requirements and the rejection-ordering contract
                        are approved as the SHAPE a future runner must have. Nothing may run. The
                        safety invariants are preserved unchanged: maxOutputRows = 0,
                        NullBenchmarkSink active, snapshot persistence false, runtime false, Agent 1
                        Brazil false, production false.
Artifacts approved:     the CLI guard contract (mandatory flags, forbidden flags, rejection codes,
                        rejection timing) as a contract
Artifacts rejected:     none
Open follow-ups:        nine proofs are DEFERRED to the implementation and remain owed —
                        allowlist-only emit; no prohibited key material; bounded output; staging;
                        atomic publish; rollback; integrity validation; fail-closed runtime; no
                        import or runtime crossing without subsequent authorization. Atomic publish
                        and the engine-to-snapshot bridge remain post-gate engineering and are not
                        designed by this record. The enumerated no-write test list NW-A01…NW-A28
                        lands with the runner.
Blocks:                 any write path however guarded; any migration; any Agent 1 integration; any
                        provider call; any production side effect; a forbidden flag accepted and
                        ignored rather than rejected
Allows:                 nothing operational. Writing the runner remains forbidden while any other
                        gate is unapproved.
Does not allow:         being read as permission to run, to write the runner, to import, to activate
                        runtime, to activate Agent 1, or to perform any Supabase write
Restrictions:           approved as a contract only. A runner that lands without discharging one of
                        the nine deferred proofs has NOT satisfied this gate, however green its tests
                        are. No benchmark run and no attempt-budget reset.
```

---

## 13. Gate dependency graph

```
GATE-1  Legal/Privacy
        blocks all execution
        └─ nothing downstream is reviewable while GATE-1 is not_started / rejected / blocked

GATE-2  Storage envelope
        blocks temp index design
        └─ also sets the § 10 numeric ceilings GATE-7's preflight checks against

GATE-3  Field allowlist
        blocks post-join classification design

GATE-4  Identity grain
        blocks the record_identity_key contract
        └─ depends on GATE-3 for which fields a key may be derived from

GATE-5  Output sanitization
        blocks report/test implementation
        └─ depends on GATE-3 (which counts exist) and GATE-4 (which grain is reported)

GATE-6  Failure cleanup
        blocks runner implementation
        └─ depends on GATE-2 (what must be destroyed)

GATE-7  Operator runbook
        blocks manual execution
        └─ depends on GATE-2, GATE-5, GATE-6 (ceilings, scan rules, cleanup verification)

GATE-8  No-write guarantee
        blocks any code path with side effects
```

Rule:

```
No future full join runner can be created unless all gates are approved
or the hito explicitly remains design-only.
```

An approved upstream gate never *implies* a downstream one. The graph orders review; it does not
propagate approval.

> **Update (BR-SOURCE-GATE-ROUND-2).** The GATE-3 ↔ GATE-4 edge reads like a cycle once RB-1 is
> assigned to GATE-4. It is not, and § 13.1 below resolves the ownership boundary explicitly rather
> than leaving each reader to re-derive it.

> **Update (BR-SOURCE-GATE1-RECORD).** GATE-1 is `approved` (§ 5.1), so the root of this graph is in
> place and the gates that depend on GATE-1 alone — GATE-2, GATE-3, GATE-8 — are now reviewable.
> Reviewable is not approved: all seven remain `not_started`, and the rule immediately above is the
> reason. The executable form of this ordering is the BR-SOURCE-13A `GATE2_CANNOT_PRECEDE_GATE1`
> rule, which no longer fires against an approved GATE-1 and which still refuses a GATE-2 approval
> carried on an incomplete or unsafe section.

### 13.1 The GATE-3 ↔ GATE-4 ownership boundary is ACYCLIC (BR-SOURCE-GATE-ROUND-2)

> **Update (BR-SOURCE-GATE-ROUND-2) — § 13.1 the apparent cycle, and why it is not one.**
>
> A reader arriving at Round 2 sees what looks like a deadlock:
>
> - § 7.1 records **RB-1** — the top-level identity columns — as `ownedBy: GATE_4_IDENTITY_GRAIN`, so
>   GATE-3 cannot close it;
> - § 13 says **GATE-4** "depends on GATE-3 for which fields a key may be derived from".
>
> If both were dependencies on *approval*, that would be a literal cycle and neither gate could ever
> move. It is not, for two independent reasons, and both are already in this document:
>
> **1. § 13's edges order REVIEW, not approval.** The section says so in its own text: *"An approved
> upstream gate never implies a downstream one. The graph orders review; it does not propagate
> approval."* Only GATE-1 is stated as a hard reviewability precondition (§ 4: "nothing downstream is
> reviewable while GATE-1 is `not_started`, `rejected`, or `blocked`"), and GATE-1 is `approved`. What
> GATE-4 needs from GATE-3 is the **information** "which fields exist and which may a key be derived
> from" — and that information is the **recorded field policy**, which exists and is versioned
> (`br_receita_cnpj_field_allowlist_v1`). GATE-4 consumed the policy, not an approval.
>
> **2. RB-1 was never inside GATE-3's SUBJECT.** GATE-3 governs the § 5.2 *sanitized snapshot output
> (allowlist only)* block. `tax_id`, `normalized_tax_id` and `record_identity_key` are **top-level
> columns of the shared `source_company_snapshots` contract**, not members of that block. Their grain
> is GATE-4's subject, and § 3 makes that decisive: "changing the subject re-opens the gate". Round 1
> reassigning RB-1 to GATE-4 was therefore a correction of a mis-filing, not a hand-off of a GATE-3
> criterion.
>
> **The boundary, stated once so it stops being re-derived:**
>
> ```
> GATE-3 owns   the § 5.2 sanitized payload allowlist and denylist
>               → which SIGNALS survive the join
>
> GATE-4 owns   the top-level identity columns and the record identity grain
>               → what one ROW IS, and how it is addressed
> ```
>
> **The resulting order is acyclic and was executed in it:** GATE-3's *policy* → GATE-4's *grain and
> identity dispositions* → GATE-3's *RB-3 closure and enforcement of its own denylist*. GATE-3's
> `ready_for_review` does not depend on GATE-4 being approved; it depends on GATE-4 having **recorded**
> a disposition and on the prohibited material being **refused in code**, both of which happened in
> this round.
>
> 🔴 **What is genuinely blocked is not the graph.** GATE-3 waits on the legal/privacy owner's half of
> its joint approval (§ 7.2). GATE-4 waits on one legal/privacy question (§ 8.1). Those are waits on a
> **person**, which is what the gate model is for — not a contradiction in the contract.

---

---

## 14. Approval evidence template

One entry per gate. An approval not recorded in this shape does not exist.

```
Gate:
Status:                 not_started | needs_evidence | ready_for_review | approved | rejected | blocked | superseded
Approver:               role only (never a personal signature, never a mail address)
Approval date:          YYYY-MM-DD
Evidence links:         documents / sections / recorded determinations
Decision summary:       what was decided, in one paragraph
Restrictions:           the bounds the approval carries
Artifacts approved:
Artifacts rejected:
Open follow-ups:
Blocks:                 what stays forbidden after this approval
Allows:                 the single next step this approval unlocks
Does not allow:         what this approval must never be read as unlocking
```

Recording rules:

- **Roles, not identities.** No personal signatures, no mail addresses, no personal data.
- **No sensitive values.** Evidence links point to documents; they never quote a row, a CNPJ, a
  CNPJ básico, a CPF, a name, an address, or a contact value.
- A `rejected` entry is **kept**, not deleted — the rejection is part of the audit trail.
- Superseding an entry requires a new entry that names the one it replaces.

---

## 15. Global GO / NO-GO matrix

```
All gates approved            → may propose a future runner implementation PR — still no execution
Any gate not_started         → NO-GO
Any gate needs_evidence      → NO-GO
Any gate needs_owner_confirmation → NO-GO
Any gate needs_owner_decision → NO-GO
Any gate ready_for_review    → NO-GO
Any gate rejected            → NO-GO
Any gate blocked             → NO-GO
Any gate superseded          → NO-GO until its successor is approved
Any sensitive leak           → NO-GO, and the relevant gate resets to not_started
Any scope escalation         → NO-GO
```

The three-step separation is load-bearing:

```
GO for runner implementation  ≠  GO for execution
GO for execution              ≠  GO for import
GO for import                 requires a later, separate import authorization
```

**Today's position (as of 2026-08-21, after BR-SOURCE-GATE-ROUND-3):**

```
GATE-1  approved                                          (§ 5.1)
GATE-2  needs_owner_confirmation — ceilings complete,      (§ 6.1)
        bucket-ordinal privacy confirmation outstanding,
        NOT approved. The ordinal is now OFF the disk
        (§ 10.1 / GATE-ROUND-2), which removes the
        disk-surface instance of the question and does
        NOT supply the owner's confirmation.
GATE-3  ready_for_review — NOT approved. RB-1 and RB-3     (§ 7.1, § 7.2)
        both closed; waiting on the legal/privacy half
        of the joint approval.
GATE-4  needs_owner_decision — NOT approved. Grain         (§ 8.1)
        decided (option D); persisted identity blocked on
        ONE legal/privacy question. Exact runtime lookup
        is a recorded PRODUCTIZATION BLOCKER.
GATE-5  ready_for_review — NOT approved. Output          (§ 9.1, § 9.2)
        sanitization contract FROZEN with the owner's
        values (k = 10, string ceiling 64, no cross-tabs,
        no named municipalities) and every rule now a
        PREDICATE. Waiting on the joint security/privacy
        + test approval, which the implementer of the
        subject may not give. OD-C1, OD-C2 and OD-C3 are
        now CLOSED by SUPERSEDING the owner direction
        (total_rows_scanned is INTERNAL ONLY; the residual
        label is `suppressed_other`) — never by weakening
        BR-SOURCE-11A or the denylist. The revised contract
        is the SUBJECT of the pending review (§ 9.2).
GATE-6  ready_for_review — NOT approved. Executable        (§ 10.1)
        cleanup contract landed; waiting on the joint
        technical + operator approval, which the
        implementer of the subject may not give.
GATE-7  blocked — NOT approved. The operator runbook       (§ 11.1)
        SECTION now EXISTS (runbook § 16) and its
        preflight, resource, workspace, dataset, privacy,
        monitoring, output-review, cleanup and signoff
        steps are implemented; P-05 and the privacy
        preflight are EXECUTABLE and both return FAIL.
        Blocked by GATE-2, GATE-5 and GATE-6, per § 3's
        "another gate prevents review". Reproducibility by
        a different operator is UNDEMONSTRATED and needs a
        rehearsal nobody has authorized.
GATE-8  approved — AS A CONTRACT                           (§ 12.1)
```

Six gates are not approved, so the matrix still reads **NO-GO** — the expected and correct outcome.
🔴 `ready_for_review` and `needs_owner_decision` are NO-GO exactly as `not_started` is; four gates
advancing their status is progress in *reviewability*, not in permission.

**Approved: 2 of 8** — GATE-1 (`approved`) and GATE-8 (`APPROVED_AS_CONTRACT`). Not 0, and not 8.
Both readings have been reported at some point in this series, and both are wrong: the derivation of
record is `brazilReceitaApprovedGateCount()`, and the verdict of record is
`brazilReceitaGateGlobalVerdict()`, which returns `NO-GO` unless **every** gate is approved.
Readings a future reader is most likely to get backwards:

- **GATE-2 is NOT approved.** Its numeric envelope is complete
  (`GATE2_NUMERIC_CEILINGS_COMPLETE = true`), but GATE-2 requires a JOINT technical + privacy
  decision, and the bucket-ordinal privacy disposition has no attributable privacy-owner source — the
  only recorded human privacy statement (the GATE-1 determination) explicitly leaves GATE-2 …
  GATE-8 `not_started`. `needs_owner_confirmation` still flips no flag: the tracked temporary-storage
  policy constant and the provisional cap proposal are asserted unchanged by test.
- **GATE-8 `APPROVED_AS_CONTRACT` is not permission to write the runner.** Its *Allows* clause is
  conditional on every other gate being approved, and six are not.
- **GATE-3 recorded a policy, not an approval.** The field policy exists and a
  `field_allowlist_version` is bound to it; the gate is **`ready_for_review`** and the 10J § 12 report
  marker still reads `"not_approved"`. RB-1, RB-2 and RB-3 are all closed; the legal/privacy half of
  the joint approval is what remains.
  🔴 **Corrected by BR-SOURCE-GATE-ROUND-3.** This bullet read `needs_evidence` and *"RB-1 and RB-3
  are not [closed]"* — both true when Round 1 wrote it, and both superseded by § 7.2 in Round 2 while
  the matrix above was updated and this paragraph was not. One document giving two answers about the
  same gate is the defect the Round-2 post-merge report then reproduced; the consistency guard in
  `br-receita-cnpj-gate-round3-output-sanitization.test.ts` now fails on a recurrence.

Round 1 closed the GATE-2 numeric envelope (not the gate), the GATE-3 field policy plus its RB-2
blocker, and GATE-8. **Round 2 closed GATE-3's RB-1 and RB-3, recorded GATE-4, made GATE-6's cleanup
contract executable, and took the key-derived bucket ordinal off the disk.**

Readings a future reader is most likely to get backwards after Round 2:

- **GATE-4's grain being decided is not GATE-4 being approved.** One question is open, it is
  legal/privacy, and no agent may answer it (§ 8.1).
- **Exact runtime lookup is NOT solved.** It is a recorded productization blocker: every existing
  lookup primitive needs `normalized_tax_id` or a caller-known key, and Brazil can supply neither.
- **GATE-6's code working is not GATE-6 being approved.** § 3 forbids the implementer of a subject
  from approving it, and this round implemented the subject.
- **Opaque temp file names are not a privacy approval.** They remove the ordinal from disk; the
  privacy owner's GATE-2 confirmation is still outstanding.

**Standing open items independent of any round:** the GATE-2 bucket-ordinal privacy confirmation, and
the GATE-4 legal/privacy question — which, if answered `no`, stops Brazil productization at GATE-4.

Readings a future reader is most likely to get backwards after Round 3:

- **GATE-5's rules executing is not GATE-5 being approved.** § 3 forbids the implementer of a subject
  from approving it, and this round implemented the subject.
- **The frozen contract did not resolve its own collisions.** `total_rows_scanned` is ALLOWED by owner
  direction and is refused by BR-SOURCE-11A's numeric-leaf ceiling and by `VP-1` / `VP-4` on the
  rendered surface. Both are recorded as `OD-C1` / `OD-C2` and both are owner decisions. A third,
  `OD-C3`, is internal to 10O: the residual bucket label § 7 requires suppression to emit is refused by
  § 5.2 group 7. All three are owner decisions, and 11A was **not** weakened to accommodate any of them.
  🔴 **SUPERSEDED BY § 9.2 (BR-SOURCE-FAST-TRACK-6).** All three are now CLOSED — and closed by
  superseding the *owner direction*, never by relaxing the invariant it collided with. 11A is still
  un-weakened, and group 7 is still unedited. The bullet is retained as the record of what Round 3 left
  open.
- **The three excluded breakdowns are a decision, not an omission.** `capital_social`, `opened_at` and
  the municipality distribution are EXCLUDED from the v1 report, which discharges the 10M § 13
  bucket-boundary item by exclusion rather than by a boundary table.
- **`VP-1` … `VP-4` do not cover every digit run.** Runs of 9, 10, 12 and 13 positions are uncovered
  by the frozen rules as written; what closes them today is BR-SOURCE-11A's `LONG_DIGIT_RUN`. That is a
  reason to keep 11A, not to widen this contract. **Still true after FAST-TRACK-6**, which confirmed it
  by *executing* both layers over runs of 8 through 15 rather than by merging them into one regex.
- **The guard is wired into nothing.** It is pure and reachable only from tests; § 4 still forbids
  full-join runner code, and a test asserts no production module imports it.

**Next front: ROUND 4 = GATE-5's remaining approval plus GATE-7**, whose packet § 10 is updated by this
round to reflect the now-real GATE-2 ceilings, GATE-5 output contract and GATE-6 cleanup contract.
GATE-7's `P-05` still fails by construction while any gate is unapproved.

Readings a future reader is most likely to get backwards after BR-SOURCE-FAST-TRACK-6:

- **The GATE-7 runbook existing is not GATE-7 being reviewable.** The section is the FIRST of four
  remaining items; the other three are GATE-2, GATE-5 and GATE-6 approvals, and § 4 orders approval by
  the dependency graph (§ 11.1).
- **`blocked` is not a step toward approval.** It is NO-GO exactly as `not_started` is, and § 4 makes a
  `blocked` gate forbid writing any full-join code.
- **The GATE-5 collisions closing is not GATE-5 being approved.** The contract was REVISED, which makes
  the revised contract the subject of a review that has not happened (§ 9.2). A round that fixes
  everything the previous review flagged does not thereby earn the approval.
- **An empty carve-out list is not a reason to delete the precedence.** `ALLOWLIST_GOVERNS` stays: it
  decides what happens the next time a § 6 key and a denylist group disagree, and that answer has to
  exist before the disagreement.
- **The final owner packet is not an approval.** It PREPARES five separate, non-bundled human decisions
  (GATE-2, GATE-3, GATE-4, GATE-5, GATE-6) with their response fields deliberately blank. No agent may
  fill one, and project technical direction is not a privacy signature (§ 14).

---

## 16. Required flags after 10K

This document adds the checklist flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_PR_READY = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL = false  (not an operational authorization)

OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Only when this PR is merged does the checklist become official:

```
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL = true
```

And even after that merge, Brazil stays non-operational:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

> **Update (BR-SOURCE-11I).** BR-SOURCE-11I interprets the 11H aggregate-only coverage signal
> result. It records that `match_result_bucket = zero` is a valid bounded-window outcome, not a
> failure. It does not authorize reruns, larger caps, multi-window sampling, exact coverage
> percentages, import, Supabase, runtime or Agent 1. It recommends preparing a future GATE-2 route
> decision package. It does not approve any gate. See
> [`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md).

Carried forward from BR-SOURCE-10E–10J (unchanged):

```
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL      = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL       = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                  = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL      = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL    = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL            = true

OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED           = false
```

---

## 17. Explicit non-goals

BR-SOURCE-10K does **not**:

- implement anything;
- add a runner;
- execute a full join;
- **approve any gate** — it defines how gates get approved, and approves none;
- grant legal or privacy approval;
- import;
- write to `source_company_snapshots`;
- write to Supabase (any table);
- create or modify a migration;
- integrate runtime;
- integrate Agent 1;
- touch HubSpot;
- touch Slack;
- call any provider;
- change UI;
- change parser / reader / dry-run / manifest validator / connector runtime behavior;
- process the full or real dataset;
- advance Brazil toward production readiness.

---

## 18. Recommended next hito

**BR-SOURCE-10L — Receita full join dry-run gate evidence packet.**

Objective of 10L: **collect** the evidence each of GATE-1 … GATE-8 requires — assembling it into a
reviewable packet per gate — **without approving any gate automatically and without writing any
code**. Gathering evidence moves a gate from `not_started` to `needs_evidence` or
`ready_for_review`; only the named approver can move it to `approved`.

10L stays docs-only and authorizes no execution, Supabase write, migration, runtime, or Agent 1
integration.

This is a **recommendation, not an execution**: BR-SOURCE-10K opens no such milestone and
authorizes nothing further.

> **Update:** BR-SOURCE-10L has since landed as that docs-only evidence packet —
> [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md).
> Per gate it records the evidence that already exists (with document and section pointers), the
> evidence that is still missing, the owner role the missing evidence must come from, the pending
> decision that blocks the gate, and the artifacts required to reach `ready_for_review` — plus a
> cross-gate gap map, a per-gate readiness matrix, and a global GO / NO-GO. It **approves no gate**:
> all eight remain `not_started` with `partial_evidence_collected`, so the § 15 matrix still reads
> **NO-GO**, and no full-join runner code may be written. It adds no runner and no command, decides no
> identity grain, field allowlist, or storage envelope, and authorizes **no** dry-run, import,
> Supabase write, migration, runtime, or Agent 1 integration. Its recommended successor is
> **BR-SOURCE-10M — full join field allowlist decision record** (GATE-3, docs-only).
>
> **Update:** BR-SOURCE-10M has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
> — proposing the § 7 GATE-3 allowlist for the joint owners' review (see the update note in § 7). It
> **approves no gate**: its status is `proposed_for_owner_review`, all eight gates remain
> `not_started`, no `field_allowlist_version` is assigned, and the § 15 matrix still reads **NO-GO**, so
> no full-join runner code may be written. It adds no runner and no command, decides no identity grain
> and no storage envelope, freezes no report schema, and authorizes **no** dry-run, import, Supabase
> write, migration, runtime, or Agent 1 integration. Its recommended successor is **BR-SOURCE-10N —
> full join identity grain decision record** (GATE-4, docs-only).
>
> **Update:** BR-SOURCE-10N has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md)
> — proposing the § 8 GATE-4 grain for the joint owners' review (see the update note in § 8). It
> **approves no gate**: its status is `proposed_for_owner_review`, all eight gates remain
> `not_started`, no `record_identity_grain_decision` is assigned, and the § 15 matrix still reads
> **NO-GO**, so no full-join runner code may be written. It recommends **option D**, records the
> rejected and deferred options, and **defers the concrete `record_identity_key` construction** rather
> than asserting one. It adds no runner and no command, decides no field allowlist and no storage
> envelope, freezes no report schema, creates no migration, changes no index or physical schema, and
> authorizes **no** dry-run, import, Supabase write, runtime, or Agent 1 integration. Its recommended
> successor is **BR-SOURCE-10O — full join output sanitization decision record** (GATE-5, docs-only).
>
> **Update:** BR-SOURCE-10O has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)
> — proposing the § 9 GATE-5 output sanitization contract for the joint owners' review (see the update
> note in § 9). It **approves no gate**: its status is `proposed_for_owner_review`, all eight gates
> remain `not_started`, no `output_sanitization_version` is assigned, and the § 15 matrix still reads
> **NO-GO**, so no full-join runner code may be written. It governs **twelve output surfaces** rather
> than the report alone, closes the forbidden-key-name enumeration, adds closed value-pattern rules, an
> error/exception sanitization contract, a logging contract, a gate-evidence contract, and a small-cell
> suppression proposal — and it enumerates named assertions **without writing any test**, since tests
> are code and § 4 forbids them until all eight gates are approved. It adds no runner, no command, no
> sanitizer, and no fixture; decides no field allowlist, grain, or storage envelope; freezes no report
> schema; creates no migration; changes no index or physical schema; and authorizes **no** dry-run,
> import, Supabase write, runtime, or Agent 1 integration. Its recommended successor is
> **BR-SOURCE-10P — full join failure cleanup decision record** (GATE-6, docs-only).
>
> **Update:** that successor landed **accelerated**, as a single docs-only packet covering the three
> remaining preparable gates instead of three sequential milestones —
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
> (BR-SOURCE-10PQR): the § 10 GATE-6 cleanup contract, the § 11 GATE-7 runbook contract, and the § 12
> GATE-8 no-write / no-runtime contract, plus a final readiness packet for all eight gates (see the
> update notes in § 10, § 11, and § 12 above). It **approves no gate**: its status is
> `proposed_for_owner_review`, all eight gates remain `not_started`, and the § 15 matrix still reads
> **NO-GO**, so no full-join runner code may be written.
>
> Three properties of the acceleration matter for this checklist. **One document is not one approval:**
> the three gates have different, partly disjoint approver sets under § 10, § 11, and § 12, and each
> requires its own § 14 approval entry — the § 13 graph orders review and never propagates approval.
> **Two of the three cannot be satisfied by any document:** GATE-7's *reproducible by a different
> operator* criterion needs a rehearsal against GATE-2 ceilings that do not exist, and GATE-8's evidence
> includes proofs about code that § 4 forbids writing — so the packet proposes contracts and records the
> limits rather than claiming the criteria are met. **The § 4 no-code rule is untouched:** the packet
> creates no cleanup code, no verification command, no guard, no runner, no test, and no runbook section.
> It decides no field allowlist, grain, or storage envelope, freezes no report schema, creates no
> migration, changes no index or physical schema, and authorizes **no** dry-run, import, Supabase write,
> runtime, or Agent 1 integration. Its recommended successor is **BR-SOURCE-10S — full join gate owner
> review packet** (owner review producing an operational GO / NO-GO); the alternative it names — a runner
> implementation behind hard no-write guards — is flagged there as requiring the owners to explicitly
> override § 4 of this checklist.

---

## 19. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR.
It does **not**:

- download or import a dataset;
- process the real / full dataset or open/print any real file, row, full CNPJ, CNPJ básico, or CPF;
- modify the operator's real local manifest or include any real manifest / dataset;
- write to Supabase or perform any production write;
- create or modify a migration;
- change the parser, reader, dry-run, manifest validator, snapshot builder, join dry-run, or any
  connector runtime behavior;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- perform live generation or full expansion;
- approve any gate;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, and no partner (sócio)
personal data are reproduced. Local WIP (`scratchpad/`) is untouched by any git operation.

---

## 20. BR-SOURCE-11C blocked — carve-out decision question recorded, no gate approved

BR-SOURCE-11A landed the full join dry-run runner scaffold behind hard no-write / no-runtime guards
(the § 4 override the owners were warned would be required), and BR-SOURCE-11B validated it
post-merge in synthetic-only mode. BR-SOURCE-11C then attempted to enable the runner's
`local_manifest_dry_run` mode and was blocked as `BRSOURCE11CD — LOCAL_MANIFEST_GUARD_FAILED`.

```text
11C was blocked because local_manifest_dry_run requires an explicit carve-out or GATE-1/GATE-2
approval.
11C-R records the carve-out decision question.
No gate is approved.
No real manifest execution is authorized.
```

The decision question, its four options, the recommended option (Option B — synthetic temp-manifest
carve-out only), the proposed boundaries and caps, and the evidence required before implementing
BR-SOURCE-11C are recorded in the docs-only decision record
[`br-receita-cnpj-local-manifest-dry-run-carveout-decision-record.md`](./br-receita-cnpj-local-manifest-dry-run-carveout-decision-record.md).

Three points matter for this checklist. **A carve-out is not a gate approval:** its status is
`proposed_for_owner_review`, all eight gates remain `not_started` per § 15, the § 15 matrix still
reads **NO-GO**, and GATE-1 and GATE-2 retain sole authority over any real manifest or real data-file
execution. **Blockage is the checklist working, not failing:** the guard refused precisely because
reading a real manifest is the first data-read step beyond synthetic-only execution, which is the
subject matter of the two least-advanced gates. **The record authorizes nothing on its own:** it
adds no runner, no command, no test and no fixture; decides no field allowlist, grain or storage
envelope; freezes no report schema; creates no migration and changes no index or physical schema;
and authorizes **no** real manifest execution, real data-file execution, dataset import, Supabase
write, runtime change or Agent 1 integration. Any Option B implementation additionally requires the
record to be merged **and** an explicit owner authorization phrase, recorded separately.

---

## 21. BR-SOURCE-11D-META — next decision question recorded, no gate approved

BR-SOURCE-11D-META defines the next decision question: whether real manifest metadata-only parsing
can be authorized. It does not authorize real manifest reading by itself. It does not authorize
data-file execution. It does not approve any gate.

```text
11C landed and validated the synthetic temp-manifest carve-out (Option B of 11C-R).
11D-META records the real-manifest metadata-only question and recommends it as the next option.
No gate is approved. GATE-1 and GATE-2 retain sole authority over real data-file execution.
```

All eight gates remain `not_started` per § 15, the § 15 matrix still reads **NO-GO**, and the
successor record's own status is `proposed_for_owner_review`. A merged question is still a question:
any implementation additionally requires the record to be merged **and** the explicit owner phrase
`AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT`, recorded separately. The phrase already
spent for the synthetic carve-out does not carry over.

Record: [`br-receita-cnpj-real-manifest-metadata-only-carveout-decision-record.md`](./br-receita-cnpj-real-manifest-metadata-only-carveout-decision-record.md).

---

## 22. BR-SOURCE-11F — next decision question recorded, no gate approved

BR-SOURCE-11F defines the next decision question: whether an ultra-bounded required-family real
data-file probe can be authorized. It does not authorize real data-file execution by itself. It does
not authorize joins. It does not authorize import. It does not approve any gate.

```text
11D-META's question was answered and implemented, and 11E executed one operator-prepared manifest
  DOCUMENT metadata-only.
11F records the bounded real data-file question: may two allowlisted files (empresas,
  estabelecimentos) be opened under hard caps, read for a tiny bounded prefix, and reported as
  aggregates only?
No gate is approved. GATE-1 and GATE-2 retain sole authority over dataset processing.
```

All eight gates remain `not_started` per § 15, the § 15 matrix still reads **NO-GO**, and the
successor record's own status is `proposed_for_owner_review`. A merged question is still a question:
any implementation additionally requires that record to be merged **and** the explicit owner phrase
`AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL DATA-FILE PROBE`, recorded separately. No
phrase already spent for the synthetic carve-out, for metadata-only parsing, or for the 11E execution
carries over. § 4's global approval rules are unaffected: a successful bounded probe would be evidence
about a read path and a file's shape, and is not citable toward the approval of any gate.

Record: [`br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md).

---

## 23. BR-SOURCE-11G — next decision question recorded, no gate approved

BR-SOURCE-11G defines the next decision question: whether an ultra-bounded required-family real join
probe can be authorized. It does not authorize real join execution by itself. It does not authorize
join coverage. It does not authorize import. It does not approve any gate.

```text
11F's question was answered and implemented, and 11F-IMPL opened two required-family files under caps
  and reported structure only.
11G records the bounded real join question: may the protected technical join key be parsed
  ephemerally from those same two capped windows, compared in memory, and reported as a coarse
  bucket, with no join key output, no joined rows, no join pairs, and no coverage?
No gate is approved. GATE-1 and GATE-2 retain sole authority over dataset processing.
```

All eight gates remain `not_started` per § 15, the § 15 matrix still reads **NO-GO**, and the
successor record's own status is `proposed_for_owner_review`. A merged question is still a question:
any implementation additionally requires that record to be merged **and** the explicit owner phrase
`AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE`, recorded separately. No phrase
already spent for the synthetic carve-out, for metadata-only parsing, for the 11E execution, or for
the 11F data-file probe carries over. § 4's global approval rules are unaffected: a successful bounded
join probe would be evidence about a join mechanism under caps, and is not citable toward the approval
of any gate — GATE-3, GATE-4 and GATE-5 in particular remain untouched, since the probe persists no
field, constructs no identity grain, and promotes no evidence.

Record: [`br-receita-cnpj-bounded-real-join-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-join-dry-run-decision-record.md).

---

## 24. BR-SOURCE-11H — next decision question recorded, no gate approved

```text
BR-SOURCE-11H defines the next decision question: whether an ultra-bounded aggregate-only real join
coverage signal can be authorized.
It does not authorize coverage execution by itself.
It does not authorize exact coverage percentages.
It does not authorize full-dataset denominator claims.
It does not authorize import.
It does not approve any gate.
```

All eight gates remain `not_started` per § 15, the § 15 matrix still reads **NO-GO**, and the
successor record's own status is `proposed_for_owner_review`. A merged question is still a question:
any implementation additionally requires that record to be merged **and** the explicit owner phrase
`AUTHORIZE OPTION C — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL`, recorded separately.
No phrase already spent for the synthetic carve-out, for metadata-only parsing, for the 11E execution,
for the 11F data-file probe, or for the 11G join probe carries over.

§ 4's global approval rules are unaffected: a successful bounded coverage signal would be evidence
that a join mechanism produces an outcome class over two bounded windows, and is not citable toward
the approval of any gate. GATE-3, GATE-4 and GATE-5 in particular remain untouched, since the signal
persists no field, constructs no identity grain, and promotes no evidence. GATE-2 is the gate the
successor record engages most directly, because its recommended option raises byte, row and in-memory
key-window ceilings — an escalation that record states plainly and does not presume approved.

Record: [`br-receita-cnpj-bounded-real-join-coverage-decision-record.md`](./br-receita-cnpj-bounded-real-join-coverage-decision-record.md).

---

## 25. Update (BR-SOURCE-11L)

BR-SOURCE-11L creates the GATE-2 owner review package. It assembles current evidence, evidence gaps,
owner questions, decision options, a risk register and required decision fields for a future GATE-2
decision record. It does not approve GATE-2. It does not authorize a GATE-2 decision, broader local
execution, temp storage, multi-window sampling, exact percentages, import, Supabase writes, runtime,
or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-gate2-owner-review-package.md`](./br-receita-cnpj-gate2-owner-review-package.md).

BR-SOURCE-11M creates the GATE-2 formal decision record.
It consolidates evidence, gaps, formal options, decision fields, minimum conditions and risk decisions
for later owner acceptance. It does not approve GATE-2. It does not authorize a GATE-2 decision, limited
broader local execution, broader local execution, temp storage, multi-window sampling, exact
percentages, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-gate2-formal-decision-record.md`](./br-receita-cnpj-gate2-formal-decision-record.md).

BR-SOURCE-11N creates the limited broader local execution decision record.
It documents candidate scope, prerequisites, proposed controls, fail-closed cases, stop conditions and
formal options for future review. It does not approve GATE-2. It does not authorize limited broader local
execution, broader local execution, implementation, temp storage, multi-window sampling, exact
percentages, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-limited-broader-local-execution-decision-record.md`](./br-receita-cnpj-limited-broader-local-execution-decision-record.md).

BR-SOURCE-11O creates the limited broader local execution implementation design package.
It describes proposed architecture, control flow, conceptual CLI/API contract, data-family policy, cap
model, join handling, output/evidence model, fail-closed design, stop conditions, future test strategy and
sequencing. It does not approve GATE-2. It does not authorize implementation, limited broader local
execution, broader local execution, temp storage, multi-window sampling, exact percentages, import,
Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md`](./br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md).

BR-SOURCE-11R creates the execution authorization decision record.
It documents current blockers, owner decision options, required owner fields, minimum conditions before
execution and before a runbook, evidence requirements, stop conditions, a risk table and future milestone
mapping. It does not approve GATE-2. It does not authorize execution, real-data access, caps, input roots,
output roots, temp storage, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-execution-authorization-decision-record.md`](./br-receita-cnpj-execution-authorization-decision-record.md).

BR-SOURCE-11S creates the execution runbook.
It documents roles, checklists, a non-executable command skeleton, stop conditions, an evidence template, an
incident path, a future validation template and milestone mapping. It does not approve GATE-2. It does not
authorize execution, real-data access, caps, input roots, temp storage, import, Supabase, runtime or Agent 1.
It does not approve any gate. See
[`br-receita-cnpj-execution-runbook.md`](./br-receita-cnpj-execution-runbook.md).

**11S does not approve GATE-7 and is not the GATE-7 runbook section.** GATE-7's artifact must extend the
existing manual-download / local-prep runbook rather than compete with it (§ 11, *Expected artifacts*), and
four of its preflight items still cannot be performed: `P-05` fails by construction while any gate is
unapproved, `P-12` and `P-13` have no GATE-2 ceilings to check against, and `P-19` has no frozen GATE-5
sanitizer contract. 11S is a separate control artifact that records the procedural structure and the
GATE-7 boundary; the remaining-gates decision packet § 6 and § 7 remain the authority on the `P-`, `T-` and
`OR-A` series. **GATE-7 remains `not_started` / not approved**, and an approved runbook would still be a
procedure, never a permission.

BR-SOURCE-11T creates the cap/input policy authorization package. It documents cap categories, input
classes, output policy categories, family allow/deny policy, manifest/control-file policy, temp storage
policy, evidence bucket policy, exact percentage/denominator policy, owner fields, stop conditions and
future milestone mapping. **11T does not approve GATE-2 and does not approve GATE-7.** It does not
authorize execution, real-data access, caps, input roots, output roots, temp storage, import, Supabase,
runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-cap-input-policy-authorization-package.md`](./br-receita-cnpj-cap-input-policy-authorization-package.md).
The § 6 GATE-2 ceilings and the § 11 GATE-7 preflight items this checklist defines are unchanged by 11T: the
package proposes the category shape those ceilings and evidence checks would eventually reference, never the
ceiling values or the frozen sanitizer contract itself.

BR-SOURCE-11V creates the controlled execution authorization review. It evaluates whether the minimum
conditions exist to authorize a future controlled execution attempt. Current recommendation remains NO-GO
because GATE-2, GATE-7, cap/input policy, caps, input roots, output roots, temp storage, limited broader
local execution and controlled execution attempt authorization remain missing. **11V does not approve GATE-2
and does not approve GATE-7.** It does not approve cap/input policy. It does not authorize execution,
real-data access, caps, input roots, output roots, temp storage, import, Supabase, runtime or Agent 1. It
does not approve any gate. See
[`br-receita-cnpj-controlled-execution-authorization-review.md`](./br-receita-cnpj-controlled-execution-authorization-review.md).
11V records GATE-2 and GATE-7 as the first two rows of its § 6 prerequisite table, each `not satisfied / not
approved`, each `Blocks controlled execution? = yes` — a status audit citing this checklist as its evidence
source, never a status change. The § 6 ceilings still do not exist, the § 11 GATE-7 preflight items are
unchanged, and `P-05`, `P-12`, `P-13` and `P-19` still cannot be performed for the reasons recorded above.
All eight gates remain `not_started` / not approved, and none moves toward `ready_for_review`.
