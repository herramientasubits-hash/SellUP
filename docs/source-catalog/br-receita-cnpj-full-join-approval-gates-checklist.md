# BR-SOURCE-10K — Receita CNPJ full join dry-run approval gates checklist

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10K — Receita CNPJ full join dry-run approval gates checklist
**Status:** Official checklist of record (docs-only) — **not** a gate approval, and **not** a build/import/dry-run/execution authorization
**Predecessor:** BR-SOURCE-10J — `BRSOURCE10JLANDA — FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_MERGED` (PR #153, `main` HEAD `82060693169f2bfa54c0a7593c0d57c52fdf8df8`)
**Last reviewed:** 2026-07-29

**Related documents:**
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

Rules governing status:

- **All eight gates start at `not_started`.** That is their status as of this document; nothing
  here advances any of them.
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

**Status today:** `not_started`.

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

---

## 6. GATE-2 — Temporary storage envelope

**Governs (10J § 13):** 10J § 6 (temporary storage) and § 10 (memory / disk / temp-index limits);
decides whether Option C (a temporary on-disk index) is permitted at all.

**Status today:** `not_started`.

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

---

## 7. GATE-3 — Field allowlist approval

**Governs (10J § 13):** freezes 10J § 8.3 / § 8.4 — which signals survive the join and which counts
the report may carry; sets `field_allowlist_version`.

**Status today:** `not_started`.

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

---

## 8. GATE-4 — Identity grain decision

**Governs (10J § 13):** decides 10J § 14 (A / B / C / D) and the future `record_identity_key`; sets
`record_identity_grain_decision`.

**Status today:** `not_started`. Neither 10I nor 10J decided it, and neither does this document.

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

---

## 9. GATE-5 — Output sanitization contract

**Governs (10J § 13):** confirms the 10J § 12 report schema and the 10J § 15 assertions —
aggregate-only output with an all-false safety block.

**Status today:** `not_started`.

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

---

## 10. GATE-6 — Failure cleanup contract

**Governs (10J § 13):** confirms 10J § 9 — cleanup on completion **and** failure, with
`cleanup failed` as a terminal state.

**Status today:** `not_started`.

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

---

## 11. GATE-7 — Operator runbook approval

**Governs (10J § 13):** confirms 10J § 16 — the manual steps an operator follows to run a future
dry-run safely and reproducibly.

**Status today:** `not_started`.

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

---

## 12. GATE-8 — No-write / no-runtime guarantee

**Governs (10J § 13):** forces the 10J § 11 no-write flags and the 10J § 12
`import_executed = false` / `persisted_rows = 0` / all-false safety invariants.

**Status today:** `not_started`.

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

**Today's position:** all eight gates are `not_started`, so the matrix reads **NO-GO**. That is the
expected and correct outcome of this document.

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
