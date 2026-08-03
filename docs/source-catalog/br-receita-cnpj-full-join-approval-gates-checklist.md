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
