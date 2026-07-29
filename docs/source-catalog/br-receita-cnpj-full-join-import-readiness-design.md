# BR-SOURCE-10I — Receita CNPJ full join import-readiness design

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10I — Receita CNPJ full join import-readiness design
**Status:** Official design of record (docs-only) — **not** a build/import/dry-run authorization
**Predecessor:** BR-SOURCE-10H — `BRSOURCE10HLANDA — JOIN_COVERAGE_STRATEGY_MERGED` (PR #150, `main` HEAD `c452e8716b047bdbaf0ee26656084af69fd45be8`)
**Last reviewed:** 2026-07-29

**Related documents:**
- Full join field allowlist decision record (GATE-3 proposal) — [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Privacy-safe import eligibility design — [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)
- Import & staging persistence contract — [`br-receita-cnpj-import-staging-contract.md`](./br-receita-cnpj-import-staging-contract.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Identity grain & data contract — [`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)
- Source classification & activation blueprint — [`br-source-classification-and-activation-blueprint.md`](./br-source-classification-and-activation-blueprint.md)

> This document is a **contract of record**. Nothing in it authorizes — and nothing here
> should be read as authorizing — a parser change, connector change, runtime change,
> adapter/validator change, migration, dataset download, import, Supabase write, production
> write, runner, dry-run over the full dataset, execute, provider call, HubSpot sync, Slack
> notification, live generation, full expansion, or merge to an operational state. Those
> remain separate, individually-approved milestones (see § 9, § 11, § 12).

---

## 1. Purpose

The objective of BR-SOURCE-10I is to define the technical, legal, and privacy conditions
under which a **future** full local join between the Receita `empresas` (company/root grain)
and `estabelecimentos` (establishment/full-CNPJ grain) files could be executed
**privacy-safely and offline**.

This is a **design/documentation** milestone. It is the natural next step after
BR-SOURCE-10H, which established that a first-N-of-each bounded sample cannot measure real
join coverage and that the bounded strategies do not recover enough company context to
justify an import. Before any wider execution, the conditions for a full join must be
written down and agreed. **This document does that; it executes nothing.**

This document does **not** authorize:

- importation;
- production import;
- Supabase writes;
- migrations;
- runtime integration;
- Agent 1 integration;
- live prospect generation.

A **full join** — associating every establishment to its company context — is **not the same
as a full import**. Establishing that a full join is technically and legally feasible would
still leave import, production import, runtime, Agent 1, and live generation each behind its
own separate, explicit approval.

---

## 2. Current official state

The company-discovery / eligibility contract line for Receita CNPJ is official and merged as
follows (design of record; none is an operational authorization):

- **BR-SOURCE-10E — privacy-safe bounded dry-run classifier is official.** Reads a bounded
  sample and turns anti-PII findings into per-record eligibility **counts** (aggregate only);
  authorizes no import
  ([eligibility design § 10.1](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10F — eligibility & legal-nature calibration is official.** Reference lookups →
  `not_applicable_lookup`; establishments in isolation → `pending_company_join_context`;
  MEI / empresário individual excluded by default; legal nature is a **classification signal,
  not an import authorization**
  ([§ 10.2](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10G — company↔establishment bounded join dry-run is official.** Associates an
  establishment to its company context by the structural join id (`cnpj_basico` / raiz), held
  **only in an ephemeral in-memory index**; aggregate join metrics only
  ([§ 10.3](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10H — bounded join COVERAGE strategy is official.** Adds a coverage-oriented
  probe (`establishment_keys_then_company_probe`); `coverage_is_representative` is **always
  false**
  ([§ 10.4](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).

**Key BR-SOURCE-10H result (verbatim, aggregate only — no real value, row, CNPJ, or CPF):**

```
establishments_sampled                    = 20
companies_scanned_for_coverage            = 1000
joined_with_sampled_company_context       = 0
coverage_scan_limit_reached               = true
coverage_is_representative                = false
```

Interpretation of record: the join **mechanism** works, but a bounded scan does **not**
recover representative company context. It does **not** correspond to importing, it does
**not** justify wider processing without a contract, and the correct next step is to design
the full-join readiness contract (this document) before any wider execution.

---

## 3. Why a full join design is needed

- **Establishments do not carry enough context on their own.** An `estabelecimentos` row has
  no natureza jurídica; in isolation its eligibility cannot be affirmed, so BR-SOURCE-10F
  correctly parks it in `pending_company_join_context`.
- **Companies supply the legal / natureza-jurídica context.** The `empresas` file carries the
  legal nature, porte, and capital social that the eligibility rules (§ 8, and the eligibility
  design § 4 / § 7) depend on. Company context is therefore a precondition for eligibility, not
  an optional enrichment.
- **Bounded samples cannot measure representative coverage.** BR-SOURCE-10G and 10H showed that
  first-N prefixes rarely overlap and that even a 1000-row keyed probe returns
  `joined_with_sampled_company_context = 0` with `coverage_is_representative = false`. A bounded
  sample can prove the mechanism; it cannot answer *how much of the dataset would actually be
  eligible*.
- **A future import would require a full join (or an approved equivalent).** To know the true
  eligible population, a future readiness dry-run would have to associate establishments to
  company context across the **whole** dataset, or draw an explicitly approved statistical
  sample — neither of which is authorized here.
- **A full join is not a full import.** Even a completed, representative full join would only
  *measure* eligibility. Import, production import, runtime, Agent 1, and live generation each
  stay behind their own separate approvals.

---

## 4. Allowed future local processing envelope

The following describes what a **future** hito **could** be permitted to do — **only** with an
explicit, separately-recorded approval. Nothing here is authorized by BR-SOURCE-10I.

- **Controlled local read outside the repository.** Reading the operator-prepared real files
  from a local, controlled folder outside the repo (runbook § 4), never the repository, never a
  network download inside the tooling.
- **Temporary local processing.** Streaming / chunked processing of the two files locally, with
  the join key and per-key company context held **only in memory**.
- **Ephemeral or discardable temporary artifacts, only if approved.** A future full join may
  need a temporary on-disk index (the empresas key→context map is too large to hold entirely in
  memory at full scale). Any such artifact would have to be **ephemeral, local-only, outside the
  repo, and reliably discarded on completion or failure** — and encrypted-at-rest / auto-deleted
  if it ever holds a structural key. It **may never** be committed, uploaded, persisted to
  Supabase, or retained after the run. This is a **candidate** capability that GATE-2 (§ 9) must
  approve; it is not permitted today.
- **Explicit memory / disk limits.** A future run must declare bounded memory and disk ceilings
  and fail closed when exceeded — never silently spill unbounded.
- **Aggregated reports only.** The only output permitted is aggregated, sanitized metrics
  (§ 10) — never a row, a value, a full CNPJ, a CNPJ básico, a CPF, a name, an address, or a
  contact.
- **No Supabase.** No write of any kind, at any scale.
- **No runtime.** No connection to the discovery / enrichment runtime.
- **No Agent 1.** No live integration.

> **Allowed for a future dry-run ≠ allowed for import.** This envelope, even fully approved,
> describes a **measurement** capability (a full-join readiness dry-run). It never, by itself,
> authorizes persisting a single row, writing to Supabase, or activating any runtime path.

---

## 5. Join key treatment

The structural join identifier is the CNPJ **root / básico** (`cnpj_basico`, the first 8
positions / raiz) that Receita uses to link `empresas` to `estabelecimentos`. Its handling is
non-negotiable and inherits directly from BR-SOURCE-10G / 10H:

- The join key is a **technical key only** — it links the two files; it is **not** a record
  identity, **not** a reportable field, and **not** an import attribute.
- It **may** exist in memory (or in an approved, ephemeral, discardable index per § 4) **during**
  a run.
- It **may not be printed** — not to stdout, not to a report, not to a log line.
- It **may not be persisted** without an explicit, separate approval.
- It **may not be hashed** for reports or outputs — no derived value (hash, truncation,
  fingerprint) of the join key, razão social, or any personal identifier may appear anywhere.
- It **may not appear in logs, error messages, or any output**.
- It **must be discarded** when the run finishes (and on failure), along with any temporary
  index built from it.
- **Any leak of the join key (or a value derived from it) blocks the hito** — the run is a
  failure, not a partial success.

The full CNPJ (14 positions) and the CNPJ básico (8 positions) are **both** categorically
non-printable and non-persistible under this document; CPF and any natural-person identifier
remain categorically blocked (eligibility design § 6).

---

## 6. Field survival contract after join

After a future join associates an establishment to its company context, every field falls into
exactly one of three categories. This restates and never widens the eligibility design (§ 4–§ 6)
and the import-staging contract (§ 5–§ 6, § 15–§ 16).

### 6.1 Prohibited always

These are **never** printed, logged, reported, surfaced in metadata, or persisted — under any
mode, gate, or exception:

- **CPF** and any natural-person identifier.
- **Sócios / QSA / representante / faixa etária / any person data** (the SOCIOS/QSA/CPF file
  families are never processed at all — a hard, categorical block).
- **Emails.**
- **Telephone / fax / DDD.**
- **Fine-grained address** — `logradouro`, street, `numero`, `complemento`, `bairro`, `cep`
  (postal code). Coarse `municipality` / `uf` only.
- **Raw source rows** in any form.
- **Unfiltered / raw JSON** blobs echoing any of the above.
- **Full CNPJ** in any output.
- **CNPJ básico** (the join key / raiz) in any output.
- **Free-text fields** that are not on an explicit allowlist.
- **Row hashes** or any value **derived from personal identifiers** (CPF, name) **or from the
  join key**.

### 6.2 Temporary technical-only fields

These may exist **only during** a run and must be discarded on completion / failure. They are
**not persistible and not reportable**:

- **`cnpj_basico` / join root** — the structural join key (§ 5).
- **Source file offsets / byte positions**, if a resumable full scan needs them.
- **Row counters** used to drive chunking / progress internally.
- **In-memory maps / sets** (key → company-context *kind*, never a value).
- **Temporary local index keys**, if an approved ephemeral index is used (§ 4, GATE-2).

> These technical-only fields are **not** persistible and **not** reportable. Their presence in
> memory during a run is the only place they are ever permitted to exist.

### 6.3 Candidate future persistible fields

Conceptual only — **still not authorized**. This restates and does not widen the eligibility
design § 5 allowlist. It is a *future target*, not a green light to write anything.

- `source_key` (`br_receita_cnpj_dados_abertos`, fixed literal)
- `country_code` (`BR`, fixed literal)
- `source_year` (explicit input, never hardcoded)
- `source_period` (`YYYY-MM`)
- `source_file_family` (company / reference family only)
- `record_identity_key` — **pending the identity-grain decision (§ 7)**
- `normalized_tax_id` — **pending legal/fiscal treatment (eligibility design § 11 open
  question #1)**
- sanitized `legal_name` (razão social; never an identity; excluded on a natural-person signal)
- sanitized `trade_name` (nome fantasia; only if it passes the guard)
- `legal_nature_code` / `legal_nature_label`
- `cnae_principal_code` / `cnae_principal_label` (and `cnae_secondary_codes`)
- `municipality_code` / `municipality_label` (coarse only)
- `uf` / state (coarse only)
- `registration_status_code` / `registration_status_label`
- `opened_at` / `start_date`
- `company_size_code` (porte)
- `capital_social_value` — only if permitted by the vigent legal decision
- `privacy_classification` (the record's privacy verdict)
- `eligibility_status` / `eligibility_reasons` (machine codes only, no personal values)
- `raw_data` — **minimal typed allowlist only**, never a raw row

> **This list does not authorize persistence yet.** It is the conceptual target a future,
> separately-approved writer would build explicitly (EC SCVS allowlist discipline: build from
> the allowlist, drop any extra key). No writer is authorized here.

> **Update (BR-SOURCE-10M).** The § 6.1 / § 6.2 / § 6.3 categories above have been carried into a
> docs-only **decision record proposing** the GATE-3 field allowlist —
> [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
> — which expands them into a six-category lifecycle model (adding an explicit classification-signal
> category, an aggregate-report category, and a `needs_legal_review` category), labels every field
> family, and proposes `raw_data` **prohibited by default** rather than as a minimal typed allowlist.
> It restates and never widens § 6: its candidate future-persistible list is derived from § 6.3 and is
> **narrower** in one respect — raw `tax_id`, which the eligibility design § 5 table lists but § 6.3
> omits, is treated as `needs_legal_review` and excluded from the candidate list, with the discrepancy
> raised for the approvers rather than resolved. `normalized_tax_id`, sanitized `legal_name` /
> `trade_name`, `capital_social_value`, municipality granularity, and `opened_at` exact-value survival
> all remain undecided.
>
> **GATE-3 (§ 9) is still `not_started`.** That record's status is `proposed_for_owner_review`, it
> assigns no `field_allowlist_version`, and it decides no identity grain (§ 7 / GATE-4 stays open). It
> authorizes **no** dry-run, import, Supabase write, migration, runtime, or Agent 1 integration.

---

## 7. Record identity decision needed

Receita CNPJ exposes **two grains**, and a full join makes the choice between them explicit:

- **Empresa / root grain** — one record per company root (`cnpj_basico`, 8 positions), carrying
  the legal-nature / porte / capital-social context.
- **Estabelecimento / full-CNPJ grain** — one record per full 14-position CNPJ (matriz +
  filiais), which is the operational unit but carries no natureza jurídica on its own.

Before any import, the record identity must be decided among:

```
A. record_identity_key per estabelecimento (full 14-position CNPJ) — the import-staging § 4 default
B. record_identity_key per empresa / root (cnpj_basico, 8 positions)
C. two separate snapshots (a company snapshot + an establishment snapshot)
D. a single snapshot with the establishment as the operational unit and the company as context
```

> **Conservative posture: BR-SOURCE-10I does NOT decide this.** The import-staging contract
> (§ 4) currently states the establishment / full-CNPJ grain as the intended row grain, but a
> full join surfaces the company grain as a first-class alternative, and the two must be
> reconciled against the physical `source_company_snapshots` unique-index situation
> (import-staging § 5, § 11) and the full-CNPJ persistence question (eligibility design § 11 #1).
> This is left as a **mandatory decision gate (GATE-4, § 9)** for a future hito — it is not
> decided automatically here.

> **Update (BR-SOURCE-10N).** The four options above have been carried into a docs-only **decision
> record proposing** the GATE-4 grain —
> [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md)
> — which recommends **option D** (a single operational snapshot: establishment as the operational
> unit, company / root as context) for owner review. It defers option A as *silent on company
> context* — and therefore superseded by D rather than rejected — rejects option B because it would
> require the join key to become the record identity, contrary to § 5 of this document and to
> CN1 § 3.3, and defers option C because it would need a second source key or a discriminator column
> (**a migration**) and would break the tax-grain invariant.
>
> On the two reconciliations this section requires: the index situation is addressed **conditionally**
> (no new index under the CN1-inheritance key construction; a required unique index — **a
> migration** — under a surrogate construction), and the full-CNPJ persistence question is left where
> 10M left it, at `needs_legal_review`, with the record noting that it is **coupled** to the key
> construction. The record therefore proposes a **conceptual** `record_identity_key` shape and leaves
> the concrete construction **deferred**.
>
> **GATE-4 (§ 9) is still `not_started` / not approved.** That record's status is
> `proposed_for_owner_review`, it assigns no `record_identity_grain_decision`, it does not widen § 6,
> and it authorizes **no** dry-run, import, Supabase write, migration, index change, runtime, or
> Agent 1 integration.

---

## 8. Eligibility after full join

After a future join, a joined record could only advance toward `eligible_for_future_import`
(eligibility design § 7) if **all** of the following hold — fail-closed, allowlist-first:

- the **company context is present** and is **not excluded** (no person/PII/forbidden-token
  signal on the company side);
- the **establishment carries no persistible PII / contact / address signal**;
- the **legal nature** passes an **explicit** eligible-commercial policy (still legally
  UNDECIDED — eligibility design § 11 #2);
- there is **no CPF-like token / natural-person signal** in any candidate-persistible field;
- `raw_data` is reduced to the **minimal typed allowlist**;
- the output is **aggregated** (§ 10);
- a **legal/privacy gate approves** (§ 9).

A single natural-person / personal-data signal on **either** side of the join makes the **whole
joined record** ineligible — never partially imported with the offending value stripped. As
today, with **no** legal-nature policy injected, a clean joined company row still falls
fail-closed to `needs_legal_review`; nothing is `eligible_for_future_import` on this document's
authority.

---

## 9. Required future gates before any full join dry-run

Before **any** full join dry-run (let alone an import) may run, each of these gates must be
satisfied and recorded:

```
GATE-1  Legal/Privacy approval for a full local join dry-run (LGPD basis; CC BY-ND review).
GATE-2  Technical storage envelope for temporary files (ephemeral, local-only, encrypted/
        discardable, bounded disk, guaranteed cleanup) — or an in-memory-only guarantee.
GATE-3  Field allowlist approval (the § 6.3 candidate list confirmed and frozen).
GATE-4  Identity grain decision (§ 7 — choose A / B / C / D explicitly).
GATE-5  Output sanitization contract (aggregate-only report shape, § 10, confirmed).
GATE-6  Failure cleanup contract (join keys / temp index destroyed on completion AND failure).
GATE-7  Operator runbook approval (how the operator runs it locally, safely, reproducibly).
GATE-8  No Supabase / import / runtime / Agent 1 guarantee (the dry-run writes nothing and
        activates nothing).
```

No gate may be skipped or collapsed. A full join dry-run that cannot satisfy every gate does
not run.

> **Update (BR-SOURCE-10K).** These eight gates have since been turned into a formal, approvable
> checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
> — defining per gate the required evidence, the approver role, the pass / fail criteria, the block
> conditions, the expected artifacts, the flag each gate governs, and what each approval does and
> does not unlock; plus a gate status model, a dependency graph, an approval-evidence template, and
> a GO / NO-GO matrix. That checklist is docs-only and **approves no gate**: all eight remain
> `not_started`, so the matrix reads NO-GO. It implements no runner, decides no identity grain, and
> authorizes **no** full join execution, import, Supabase write, migration, runtime, or Agent 1
> integration.

---

## 10. Required future report

A future full-join readiness dry-run may emit **only** an aggregated, sanitized report of this
shape (conceptual; values shown as zeros / placeholders — **no real data**):

```json
{
  "ok": true,
  "mode": "full_join_import_readiness_dry_run",
  "coverage_is_representative": false,
  "full_dataset_processed": true,
  "import_executed": false,
  "supabase_write": false,
  "runtime_integration": false,
  "agent1_integration": false,
  "companies_seen": 0,
  "establishments_seen": 0,
  "joined_establishments": 0,
  "missing_company_context": 0,
  "excluded_person_or_pii_risk": 0,
  "excluded_forbidden_token": 0,
  "needs_legal_review": 0,
  "eligible_for_future_import_candidates": 0,
  "persisted_rows": 0,
  "safety": {
    "raw_rows_printed": false,
    "personal_values_printed": false,
    "join_keys_printed": false,
    "cnpj_basico_printed": false,
    "cnpj_completo_printed": false
  }
}
```

> Even if a future dry-run reports `full_dataset_processed = true`, `import_executed` **must
> stay `false`** until a separate import gate is satisfied. Processing the full dataset to
> *measure* eligibility is a different act from *persisting* any row. `persisted_rows` is `0` by
> contract in a readiness dry-run, and the whole `safety` block must be all-false.

> **Update (BR-SOURCE-10O).** The report shape above has been carried into a docs-only **decision
> record proposing** the GATE-5 output sanitization contract —
> [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md).
> It restates and never widens this section. Four things it adds:
>
> - a **closed aggregate allowlist** — the schema is authoritative in both directions, so a key absent
>   from the approved list is forbidden rather than merely undocumented;
> - a **`safety` block extended** with `names_printed`, `identity_keys_printed`,
>   `record_identity_keys_printed`, `normalized_tax_ids_printed`, `person_data_printed`,
>   `hashes_of_identifiers_printed`, and `small_cells_disclosed` — all `false` by contract, as
>   proposals for the approvers to freeze;
> - the § 5 **join-key rule restated as an output rule** — the root appears on no surface, in no form,
>   not truncated, not prefixed, not hashed, not as a count key, a bucket label, a file-name component,
>   or a path segment;
> - a **small-cell suppression** proposal, for the gap that an aggregate report is not automatically a
>   non-identifying one: a bucket count of one is a record.
>
> The record governs **twelve output surfaces**, not the report alone, and it adds error, logging, and
> gate-evidence contracts this design does not have. **It freezes nothing:** GATE-5 remains
> `not_started` / not approved, the schema stays unfrozen while GATE-3 and GATE-4 are open, and it
> writes no sanitizer and no test and authorizes **no** dry-run, import, Supabase write, migration,
> index change, runtime, or Agent 1 integration.

---

## 11. Explicit non-goals

BR-SOURCE-10I does **not**:

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
- process the full dataset;
- authorize a full join dry-run (it only designs the conditions for one);
- advance Brazil toward production readiness.

---

## 12. Activation blockers

Unchanged and carried forward — Brazil stays non-operational:

```
OPS_BR_READY_FOR_IMPORT              = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT   = false
OPS_BR_READY_FOR_RUNTIME             = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

This document adds the readiness-design flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_PR_READY  = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL  = false  (not an operational authorization)
```

Carried forward from BR-SOURCE-10E–10H (unchanged):

```
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                   = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL       = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL     = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL  = true
OPS_BR_PRIVACY_SAFE_IMPORT_ELIGIBILITY_DESIGN_OFFICIAL   = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL             = true
```

---

## 13. Recommended next hito after 10I

**BR-SOURCE-10J — Full join dry-run technical design** (or equivalent): a design/review
milestone that works through GATE-1 … GATE-8 (§ 9) and the identity-grain decision (§ 7),
**still authorizing no execution, no Supabase write, no runtime, and no Agent 1**. Only after
those gates are satisfied and recorded could a future, separately-approved hito run an actual
full-join readiness dry-run under the envelope in § 4.

> **Update:** BR-SOURCE-10J has since landed as an official, docs-only technical design —
> [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md).
> It lowers this contract into an executable-in-the-future design (execution model, architecture
> options, temporary storage envelope, join-key handling, field discard timing, cleanup contract,
> resource limits, future CLI/report contracts, and the GATE-1 … GATE-8 mapping), and it still
> **decides no identity grain** and authorizes **no** dry-run, import, Supabase write, migration,
> runtime, or Agent 1 integration. Its recommended successor is **BR-SOURCE-10K — full join
> dry-run approval gates checklist**.
>
> **Update:** BR-SOURCE-10K has since landed as that docs-only checklist —
> [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
> — which makes the § 9 gates concretely approvable without approving any of them. Its recommended
> successor is **BR-SOURCE-10L — full join dry-run gate evidence packet**.
>
> **Update:** BR-SOURCE-10L has since landed as that docs-only evidence packet —
> [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
> — which inventories, per § 9 gate, the evidence that already exists and the evidence still missing,
> including that the § 6.3 candidate field list remains unfrozen and unversioned and that the § 7
> identity-grain choice (A / B / C / D) is still unrecorded. It **approves no gate**: all eight remain
> `not_started`, decides no grain and no allowlist, and authorizes **no** dry-run, import, Supabase
> write, migration, runtime, or Agent 1 integration. Its recommended successor is **BR-SOURCE-10M —
> full join field allowlist decision record** (GATE-3, docs-only).
>
> **Update:** BR-SOURCE-10M has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
> — which **proposes** (never approves) the GATE-3 allowlist against the § 6 field-survival contract
> (see the update note in § 6.3), states how it constrains but does not decide § 7 / GATE-4, and treats
> its aggregate-report field list as candidate input to GATE-5. It **approves no gate**: all eight
> § 9 gates remain `not_started`, no `field_allowlist_version` is assigned, and Brazil stays
> non-operational. It adds no runner and no command and authorizes **no** dry-run, import, Supabase
> write, migration, runtime, or Agent 1 integration. Its recommended successor is **BR-SOURCE-10N —
> full join identity grain decision record** (GATE-4, docs-only).
>
> **Update:** BR-SOURCE-10N has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md)
> — which **proposes** (never approves) the GATE-4 grain against § 7 (see the update note there),
> recommending **option D**, recording the rejected and deferred options with their reasons, and
> **deferring** the concrete `record_identity_key` construction. It restates and does not widen § 5 —
> the structural root is never a record identity, never persisted, never printed — and it keeps the
> § 6 categories unchanged. It **approves no gate**: all eight § 9 gates remain `not_started`, no
> `record_identity_grain_decision` is assigned, and Brazil stays non-operational. It adds no runner and
> no command, creates no migration, changes no index or physical schema, and authorizes **no** dry-run,
> import, Supabase write, runtime, or Agent 1 integration. Its recommended successor is
> **BR-SOURCE-10O — full join output sanitization decision record** (GATE-5, docs-only).

This is a **recommendation, not an execution**: BR-SOURCE-10I opens no such milestone and
authorizes nothing further.

---

## 14. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only
PR. It does **not**:

- download or import a dataset;
- process the real / full dataset or open/print any real file, row, full CNPJ, CNPJ básico, or
  CPF;
- modify the operator's real local manifest or include any real manifest / dataset;
- write to Supabase or perform any production write;
- create or modify a migration;
- change the parser, reader, dry-run, manifest validator, snapshot builder, join dry-run, or any
  connector runtime behavior;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- perform live generation or full expansion;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, and no partner (sócio)
personal data are reproduced. Local WIP (`scratchpad/`) is untouched by any git operation.
