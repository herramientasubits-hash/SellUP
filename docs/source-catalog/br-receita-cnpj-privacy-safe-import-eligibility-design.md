# Brazil — Receita CNPJ: Privacy-Safe Import Eligibility Design

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10D — Receita privacy-safe import eligibility design
**Status:** Official design of record (docs-only) — **not** a build/import authorization
**Predecessor:** BR-SOURCE-10C — `BRSOURCE10CLANDA — HEADERLESS_RECEITA_REAL_FILE_SUPPORT_MERGED` (PR #142, `main` HEAD `7fced324f06bbc95f72896e53a16fd9368f21ae1`)
**Last reviewed:** 2026-07-28

**Related documents:**
- Identity grain & data contract — [`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)
- Import & staging persistence contract — [`br-receita-cnpj-import-staging-contract.md`](./br-receita-cnpj-import-staging-contract.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)
- Source classification & activation blueprint — [`br-source-classification-and-activation-blueprint.md`](./br-source-classification-and-activation-blueprint.md)

---

## 1. Status and decision

Receita CNPJ Dados Abertos **remains classified as a future official source** for
enrichment and validation. This document does **not** change that classification and
does **not** advance it. Concretely, as of BR-SOURCE-10D:

- Receita CNPJ Dados Abertos **is** an official future enrichment/validation source.
- It is **not ready for import**.
- It is **not ready for production import**.
- It is **not ready for runtime**.
- It is **not ready for Agent 1**.
- It is **not ready for live prospect generation**.

BR-SOURCE-10C established that the **official headerless real-file layout is supported**
and that a **real manifest can validate**. BR-SOURCE-10D adds the missing piece: the
official privacy-safe eligibility contract that any *future* import must satisfy before a
single row may be persisted. It is a **design/documentation** milestone. It authorizes no
code, no download, no dry-run against real data, no Supabase write, no migration, and no
runtime wiring.

> This document is a **contract of record**. Nothing in it authorizes — and nothing here
> should be read as authorizing — a parser change, connector change, runtime change,
> adapter/validator change, migration, dataset download, import, Supabase write, production
> write, runner, dry-run over real data, execute, provider call, HubSpot sync, Slack
> notification, live generation, full expansion, or merge to an operational state. Those
> remain separate, individually-approved milestones (see § 12, § 13).

---

## 2. BR-SOURCE-10C finding (privacy stop condition)

BR-SOURCE-10C exercised the merged headerless tooling against a **real, operator-prepared
local file set** (outside the repository). The observed outcome — recorded here **without
any real value, row, CNPJ, or CPF**:

- The **real headerless manifest validated** (`layoutMode: official_headerless`; official
  positional column counts matched).
- The **bounded local dry-run** (`maxSampleRows = 5`) was **blocked**, correctly, by the
  anti-PII sample guard.
- The blocking reason code was **`empresas:sample_row_forbidden_value_detected`**.
- **No real rows were printed. No full CNPJ or CPF was printed or returned. No Supabase
  write occurred. No import occurred. No full dataset was processed.** The dry-run emitted
  only its sanitized report and its all-false safety block.

**Mechanism (why the guard fired).** The dry-run's structural sample validator
(`validateSampleStructure` in
[`br-receita-cnpj-local-dry-run.ts`](../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-local-dry-run.ts))
rejects any sampled cell that contains an **11-or-more contiguous-digit run**
(`FORBIDDEN_DIGIT_RUN = /\d{11,}/`): 11 digits is a CPF length, 14 is a full CNPJ. The
guard is deliberately **coarse and conservative** — it never inspects or retains the value,
it only counts and fails closed. On real `empresas` data a run of this length is a genuine
personal-data / sensitive-identifier red flag: for MEI and empresário individual records the
`razao_social` field can be an individual's own name carrying a CPF-length token, which the
BR legal/privacy decision excludes.

**Correct interpretation.** This is **not** a bug in the headerless support, and it **must
not be forced or bypassed**. It confirms that a **privacy-safe eligibility filter is required
before any import**. A headerless *manifest validation* can legitimately pass while the *real
dry-run* is blocked; that is a designed stop condition, not a defect. The runbook already
records this expectation (see runbook § 12 headerless dry-run note).

---

## 3. Eligibility principle

> **Only records that represent eligible commercial organizations, and that carry no natural-person
> or personal-data signal in any candidate-persistible field, may ever be imported.**

Corollaries:

- Eligibility is **allowlist-first and fail-closed**: a record is eligible only when it
  affirmatively passes every eligibility check. Absence of a positive signal is treated as
  ineligible, not as a pass.
- A single personal-data / natural-person signal in a candidate-persistible field makes the
  **whole record** ineligible — the record is excluded, never partially imported with the
  offending value stripped and the rest kept.
- The guardrails in this document are **floors, not ceilings**: the exclusion list (§ 4) and
  the prohibited-field list (§ 6) may be **widened** by engineering, but may **not be
  narrowed or relaxed** without an explicit legal/privacy GO recorded in the legal decision
  record.
- Company-registral discipline from the data contract is preserved end-to-end: the full CNPJ
  is a company fiscal identity governed by the prior decision; CPF and any natural-person
  identifier are categorically excluded.

---

## 4. Excluded records (excluded by default)

The following records are **excluded from any future import by default**:

- Records associated with **pessoa física** (natural person).
- **Empresário individual** records **when a natural-person signal is present**.
- **MEI / microempreendedor individual** records — excluded **unless** a future, explicit
  legal/privacy decision authorizes them (§ 11 open question).
- Records with a **CPF-like token** (an 11-or-more contiguous-digit run, or an otherwise
  CPF-shaped value) in **any candidate-persistible field**.
- Records where a **natural-person name** appears in a principal commercial field (e.g.
  `razao_social` for a natural-person-equivalent entity) and **cannot be safely separated**
  from company data.
- Any record **originating from the SOCIOS / QSA / CPF file families** — these families are
  never processed at all (they are a hard, categorical block, not a per-record filter).
- Records carrying **emails, telephones, fax, DDD, personal/fine-grained addresses**, or any
  other personal-contact signal.
- Records where the **anti-PII guard fires** (e.g. `sample_row_forbidden_value_detected`) —
  the record does not become eligible by re-running or by relaxing the guard.
- Records whose **natureza jurídica** (legal nature) indicates natural-person risk or a
  non-commercial structure that is out of scope for SellUp prospecting.

**Immutability of this list.** This exclusion set may be **expanded** but may **not be
reduced** without an explicit legal/privacy approval recorded in the legal decision record.
"Exclude when uncertain" is the default posture.

---

## 5. Persistible fields (future contract)

Conceptual allowlist for a **future** `source_company_snapshots` import. This restates and
does not widen the data-contract § 5 / import-staging § 5–6 allowlist; it is a *future*
target, **not** an authorization to write.

| Field (conceptual) | Notes |
|---|---|
| `source_key` | `br_receita_cnpj_dados_abertos` (fixed literal) |
| `country_code` | `BR` (fixed literal) |
| `source_year` | snapshot year; explicit input, never hardcoded |
| `source_period` | `YYYY-MM` publication period (in `raw_data` / metadata) |
| `record_identity_key` | `tax:<normalized_14>` |
| `normalized_tax_id` | normalized full 14-position CNPJ **only if allowed by the vigent decision** (§ 11 open question) |
| `tax_id` (raw) | raw CNPJ string for traceability, subject to the same masking/logging discipline |
| `legal_name` (sanitized) | razão social, **never** an identity; excluded when it carries a natural-person signal (§ 4) |
| `trade_name` (sanitized) | nome fantasia, if present **and** it passes the guard |
| `legal_nature_code` / `legal_nature_label` | natureza jurídica |
| `cnae_principal_code` / `cnae_principal_label` | principal activity |
| `cnae_secondary_codes` | secondary activity codes |
| `municipality_code` / `municipality_label` | **coarse** location only |
| `uf` / state | coarse location only |
| `registration_status_code` / `registration_status_label` | situação cadastral |
| `opened_at` / `start_date` | data início de atividade, if applicable |
| `company_size_code` | porte |
| `capital_social_value` | public company financial attribute |
| `source_file_family` | provenance of the accepted row (company/reference family only) |
| `raw_data` (minimal allowlist) | typed, sanitized allowlist payload only — never a raw row |
| `privacy_classification` | the record's privacy verdict (§ 7 status) |
| `eligibility_status` | the record's eligibility verdict (§ 7 status) |
| `eligibility_reasons` | machine reason codes for the verdict (no personal values) |

No free-form columns and no re-derivation of excluded fields. A future writer must build its
payload explicitly from this allowlist and drop any extra key (EC SCVS discipline).

---

## 6. Prohibited fields

The following are **never** persisted, logged, surfaced in candidate metadata, reports, or
`provider_usage_logs`:

- **CPF** and any natural-person identifier.
- Any **SOCIOS / QSA / partner / representante / faixa etária / person** data.
- **Emails.**
- **Telephones / fax / DDD.**
- **Fine-grained / detailed addresses** (`logradouro`, `numero`, `complemento`, `bairro`,
  `cep`) that could identify a person or premises — coarse `municipality` / `uf` only.
- The **raw, full source row** in any form.
- **Raw unfiltered JSON** blobs echoing any of the above.
- **Unsanitized free-text fields.**
- Any value that trips a **long CPF/CNPJ-shaped token** guard **outside the permitted
  fields**.
- **Natural-person names** that cannot be separated from company data.

**CNPJ vs CPF distinction (load-bearing).** A **CNPJ** is a company fiscal identifier; its
handling is governed by the vigent legal decision (masking, logging, and access controls
under `CNPJ_TREATMENT_MODE = A`) and the still-open question in § 11 of whether the full
value or only `record_identity_key`/hash is persisted for Brazil. A **CPF** is a natural-person
identifier and is **categorically blocked** — there is no mode, gate, or exception under
which a CPF is persisted or logged.

---

## 7. Classification rules (conceptual statuses)

Every candidate record resolves to exactly one **eligibility status** and one privacy
verdict. These are conceptual states for a future implementation — no code assigns them today.

```
eligible_for_future_import        — passes every eligibility + privacy check (allowlist-first)
excluded_person_or_pii_risk       — a natural-person / personal-data signal was present
excluded_forbidden_file_family    — originated from SOCIOS / QSA / CPF (never processed)
excluded_forbidden_token          — a CPF/CNPJ-shaped token appeared outside a permitted field
excluded_unsupported_legal_nature — natureza jurídica out of the eligible commercial scope
excluded_guard_triggered          — an anti-PII / sanitization guard fired
needs_legal_review                — ambiguous (e.g. MEI/EI) — deferred to an explicit legal GO
```

Rules:

- Only `eligible_for_future_import` may ever reach a (future, separately-approved) writer.
- `needs_legal_review` is **not** importable; it is a hold state pending an explicit legal
  decision (§ 11).
- A record that matches more than one exclusion is reported under the **most sensitive**
  reason (person/PII risk outranks token/legal-nature/guard).
- Statuses and reason codes must never embed a personal value; `eligibility_reasons` carries
  machine codes only.

---

## 8. Guard rules

A future privacy-safe import must layer these guardrails; each is fail-closed and additive to
the already-merged reader/validator/dry-run guards:

- **File-family denylist** — `socios`, `qsa`, `cpf` (and `representante`, `faixa_etaria`)
  families are rejected by name/header before any read (already enforced by the merged
  reader and manifest validator).
- **Value scanner before persistence** — every candidate-persistible value is scanned for
  CPF/CNPJ-shaped tokens and personal-data signals; a hit excludes the whole record.
- **Candidate-persistible-field scanner** — the scan runs on the *fields that would be
  persisted*, not only on the raw input, so re-derivation cannot smuggle a value back in.
- **Legal-nature risk scanner** — natureza jurídica is checked against an eligible-commercial
  allowlist; natural-person-risk natures are excluded or routed to `needs_legal_review`.
- **MEI / empresário individual scanner** — flags natural-person-equivalent records; these
  are excluded pending the § 11 legal GO.
- **Full raw row never persisted** — only the typed allowlist `raw_data` may be written.
- **Rejection report aggregated only** — rejections are counted, never stored as raw values.
- **No rejected raw value stored** — a rejected record contributes to counts only.
- **No sample row printed** — no runner or report may print a real row, full CNPJ, or CPF.

These guards **compose** with, and never replace, the existing coarse guards (e.g. the
`/\d{11,}/` structural sample guard). Widening is allowed; relaxing requires a legal GO.

---

## 9. Aggregated reports (sanitized only)

Any future import/dry-run may emit **only aggregated, sanitized metrics**:

```
total_rows_seen
rows_sampled
rows_eligible
rows_excluded
exclusion_counts_by_reason        — keyed by the § 7 statuses / reason codes
file_family_counts                — company/reference families only
file_hashes                       — SHA-256 truncated to a 12-char prefix (hash12)
```

Never permitted in any report or log:

- raw rows;
- personal values of any kind;
- a **full CNPJ** or **full CPF** (rejection reports reference records only via a masked or
  hash12 safe identifier — never the full value).

This preserves the existing sanitized-report posture of the merged runners (data-contract
§ 5.3; import-staging § 14, § 20; runbook § 12).

---

## 10. Future import design (not implemented)

Proposed future pipeline — **design intent only, nothing authorized here**:

```
manifest validation
  → headerless layout check (official positional column counts)
  → bounded privacy-safe dry-run (sanitized, no full dataset)
  → full local transform → candidate generation (offline, no writes)
  → privacy eligibility filter (§ 3–§ 8 → § 7 statuses)
  → aggregated rejection summary (§ 9, sanitized only)
  → source_company_snapshots import for eligible rows ONLY
  → NO runtime activation until a separate approval
```

Each stage after manifest validation is gated; the **import** stage and the **runtime
activation** stage are each their own separately-approved milestone. No stage may be
collapsed or skipped, and no stage may persist an ineligible record.

---

## 10.1. Privacy-safe bounded dry-run classifier (BR-SOURCE-10E)

BR-SOURCE-10E implements the **first bounded, offline classifier** of the
`→ bounded privacy-safe dry-run` stage above. It is a **separate, explicit mode**
that does **not** replace the BR-SOURCE-7 hard-block dry-run and **authorizes
nothing** (no import, no Supabase write, no runtime, no Agent 1).

- **Module:** `br-receita-cnpj-privacy-safe-classifier.ts`
  (`runBrReceitaCnpjPrivacySafeClassifier`).
- **Runner:** `scripts/source-catalog/run-br-receita-cnpj-privacy-safe-dry-run.ts`
  (see runbook § 11.1 for the command).

**Hard-block dry-run vs privacy-safe classifier.** The BR-SOURCE-7 dry-run
(`run-br-receita-cnpj-local-dry-run.ts`) **aborts** the whole run the instant a
sampled cell trips the coarse anti-PII digit-run guard
(`sample_row_forbidden_value_detected`, `ok: false`). That guard is preserved and
must not be bypassed. The classifier instead reads the same bounded sample and
turns that same finding into a **per-record eligibility count** — it keeps running
and reports how much of the sample is excluded, eligible, or held. A caller chooses
one mode or the other; neither weakens the other.

**What it produces.** Only **aggregated, sanitized metrics** (§ 9): per-file and
total `classification_counts` keyed by the § 7 statuses, `exclusion_counts_by_reason`
keyed by machine reason codes, `sample_rows_seen`, `files_*`, `sha256` 12-char
prefixes, and an all-false safety block. It never emits a row, a cell value, a full
CNPJ, a CPF, an email, a phone, or an address. The candidate-persistible-field
scanner (§ 8) runs only on the fields a future import would persist, so a
phone-length run inside a stripped contact column does **not** exclude a record,
while a CPF-length token in a persistible field does (`excluded_person_or_pii_risk`).

**What it does not do.** It does **not** resolve the empresas ↔ estabelecimentos
join, produce an importable snapshot, decide full-CNPJ persistence, or mark any
record eligible on its own authority. **Nothing is `eligible_for_future_import`**
unless a legal-nature policy is injected (the runner injects none), because § 11
below leaves the eligible-natureza allowlist, MEI policy, and full-CNPJ persistence
undecided. Fail-closed, a clean company row therefore lands in `needs_legal_review`.
The classifier is **observational**: it quantifies the § 2 stop condition, it does
not lift it.

---

## 10.2. Eligibility & legal-nature calibration (BR-SOURCE-10F)

BR-SOURCE-10F **calibrates** the BR-SOURCE-10E classifier so that structurally
non-company rows stop inflating `needs_legal_review`, while keeping every import,
runtime, and Agent 1 path blocked. It adds a pure, dependency-injected rule module
(`br-receita-cnpj-eligibility-rules.ts`) and extends the classifier's sanitized
output; it changes **no** operational authorization.

**Legal nature is a classification SIGNAL, not an import authorization.** The eligible
allowlist remains legally UNDECIDED (§ 11 open question #2), so the classifier ships
with **no default eligible-natureza set**: with no injected policy — which is exactly
what the runner uses — every company legal nature still resolves to
`needs_legal_review` and **nothing is `eligible_for_future_import`**. A caller (a
synthetic test, or a future legal GO) may inject the eligible / risky / MEI code
sets; membership is **conservative and expandable only with an explicit legal/privacy
approval**. The calibration can *reduce* `needs_legal_review`; it can never *activate*
an import.

**Conservative risk classes (docs § 4 / § 8).** `classifyLegalNatureRiskClass` maps an
already-extracted legal-nature CODE (never a value) to one of five conceptual buckets:
`allowed_commercial_organization`, `blocked_person_or_individual`,
`blocked_risky_or_unsupported`, `needs_legal_review`, `not_applicable_lookup`.
Exclusions are **floors, not ceilings** (§ 3): a policy may only *widen* the block
sets. MEI / empresário individual natures now **exclude** by default
(`excluded_person_or_pii_risk`) rather than holding — consistent with § 4 ("MEI …
excluded unless a future, explicit legal/privacy decision authorizes them").

**Where the safe reduction comes from (structural, not legal).** Two calibrated,
non-importable holds replace the previous catch-all `needs_legal_review`:

- **Reference lookups are not companies.** `cnaes` / `municipios` / `naturezas` rows
  are `not_applicable_lookup` — a catalog row is structurally not a company candidate,
  not an open legal question. They remain **non-importable**.
- **Establishments still require the empresas join.** An establishment sampled in
  isolation carries no natureza jurídica, so its eligibility cannot be affirmed; it is
  `pending_company_join_context` (reason
  `establishment_requires_company_join_context`) — a data-completeness hold, **not** a
  legal question, and **still non-importable on its own**.

`needs_legal_review` is thereby reserved for a genuine, undecided company legal nature.

**Extended sanitized output (§ 9 preserved).** The classifier now also emits
`legal_nature_classification_counts` (keyed by the five risk classes) and
`positive_company_signal_counts` (`commercial_legal_nature`, `company_name_present`,
`establishment_requires_join_context`) — **aggregate counts only**. No raw legal-nature
label, razão social, trade name, address, contact, full CNPJ, or CPF is ever emitted.

**What stays blocked (unchanged).** Import, production import, Supabase writes,
migrations, runtime, Agent 1, HubSpot/Slack, provider calls, and live prospect
generation all remain **blocked**. This is an observational calibration of the § 2
stop condition; it does not lift it.

---

## 10.3. Company↔establishment bounded join dry-run (BR-SOURCE-10G)

BR-SOURCE-10F established that `estabelecimentos` rows must **not** be classified in
isolation — they carry no natureza jurídica, so their eligibility can only be affirmed
with the empresas (company) context (they land in `pending_company_join_context`).
BR-SOURCE-10G adds the **first bounded, offline dry-run that associates an establishment
to its company context** by the structural join identifier Receita uses
(`cnpj_basico` / raiz), with **aggregate metrics only** and **no import authorization**.

**The join uses a structural identifier held ONLY in memory.** The dry-run
(`br-receita-cnpj-company-establishment-join-dry-run.ts`) samples a bounded set of
empresas rows into an **ephemeral in-memory index** keyed by the structural join id,
then samples a bounded set of estabelecimentos rows and looks each one up. The join key
(`cnpj_basico`) is **never printed, never returned, never hashed, never persisted, never
logged, and never placed in an error** — it is consumed by a `Map` lookup and discarded
when the run returns. No row hash is ever derived from it.

**Per-row eligibility reuses the classifier (no second classifier).** Both families are
scored with the exact BR-SOURCE-10E/10F `classifyRow` contract; the join dry-run adds
**only** the association logic on top. A company's context resolves to a machine kind —
join-usable (`eligible_for_future_import` / `needs_legal_review`), blocked by a privacy
signal (person/PII/forbidden token), or blocked by an unsupported legal nature — and
that kind (never a value) is what the index stores.

**Join statuses (per establishment, exactly one).**
`joined_with_sampled_company_context`, `missing_sampled_company_context`,
`excluded_due_to_company_context`, `excluded_due_to_establishment_privacy_signal`,
`pending_full_join_context`. **None is importable:** a "join" only means a company
context was found **within the bounded sample**; a full-dataset join and a separate
legal GO are still required.

**Establishments remain non-importable on their own.** A structural association inside a
20×20 sample proves the mechanism, not eligibility. The bounded samples of the two files
rarely overlap, so most establishments honestly resolve to `missing_sampled_company_context`
or `pending_full_join_context` — which is exactly why a **full** join (out of scope here)
is required before any import.

**Sanitized output (§ 9 preserved).** The dry-run emits `join_counts`,
`join_reason_counts`, `company_classification_counts`, and
`establishment_classification_counts` — **aggregate counts only** — plus an
all-false safety block including `join_keys_printed: false`. No raw row, cell value, full
CNPJ, CNPJ básico, CPF, razão social, nome fantasia, address, contact, or join key is ever
emitted; the runner additionally trips a sensitive-output assertion on any 8-/11-/14-digit
literal, email marker, or forbidden key (including `join_key` / `cnpj_basico`).

**What stays blocked (unchanged).** This milestone does **not** authorize import,
production import, Supabase writes, migrations, runtime, Agent 1, HubSpot/Slack, provider
calls, or live prospect generation — all remain **blocked**. It is an observational,
privacy-safe validation of the § 2 join precondition; it does not lift it.

---

## 10.4. Bounded join COVERAGE strategy (BR-SOURCE-10H)

BR-SOURCE-10G ran the join over the **first N rows of each file independently**. On the
real files that produced `joined_with_sampled_company_context = 0` — not an error, but the
honest confirmation that two linear prefixes almost never overlap, so a first-N-of-each
sample cannot measure real coverage. BR-SOURCE-10H adds a **coverage-oriented sampling
strategy** so the dry-run can ask a better question — *how much company context can a
slightly deeper, still bounded scan recover?* — without ever processing the full dataset
and without ever printing or persisting an identifier.

**Two explicit strategies, one contract.** The join dry-run now takes a
`--sampling-strategy`:

- **`first_rows`** — the BR-SOURCE-10G behaviour, and the **default** (backward-compatible,
  byte-for-byte). Index the first N empresas rows, then join the first M estabelecimentos
  rows within that index.
- **`establishment_keys_then_company_probe`** — sample estabelecimentos **first**, collect
  their structural join keys into an **ephemeral in-memory set**, then scan a **bounded**
  window of empresas rows (`--max-company-scan-rows`, default **1000**, hard cap **5000**),
  indexing **only** companies whose key was requested. The scan closes on the first of:
  every requested key found, the row cap, or a hard byte ceiling.

**The join keys stay in memory.** As in 10G, the structural identifier (`cnpj_basico` /
raiz) is used **only** as a `Set`/`Map` key held in memory and discarded when the run
returns. It is **never printed, returned, hashed, persisted, or logged**, and the sanitized
output additionally reports `establishment_keys_printed: false` and `join_keys_printed:
false`. Only aggregate counts are ever emitted.

**Coverage metrics (aggregate only).** The probe adds `companies_scanned_for_coverage`,
`establishment_keys_collected_in_memory`, a `coverage_scan_limit_reached` join reason, and a
`coverage_summary` block (`establishments_with_company_context_in_bounded_scan`,
`establishments_without_company_context_in_bounded_scan`, `coverage_scan_limit_reached`,
`coverage_is_representative`). When a keyed establishment's company is not found before the
scan hits its cap, the miss is attributed to `coverage_scan_limit_reached` — the honest
caveat that the company may sit deeper in the file, not that it is absent.

**`coverage_is_representative` is ALWAYS false in this hito.** No full dataset is processed,
no approved statistical sample is drawn, and no index is persisted, so the result can only
be read as a **bounded technical coverage probe** — **never** as import readiness, runtime
readiness, Agent 1 readiness, market coverage, or Brazil-source coverage. The real local
run (20 establishment keys, scanning 1000 empresas rows) reproduced the 10G finding:
`coverage_scan_limit_reached = 20`, `companies_indexed_for_join = 0` — a deeper bounded scan
still does not recover overlap, which is exactly why a **full** join (out of scope here)
remains the precondition for any import.

**What stays blocked (unchanged).** Import, production import, Supabase writes, migrations,
runtime, Agent 1, HubSpot/Slack, provider calls, and live prospect generation all remain
**blocked**. This milestone measures coverage; it authorizes nothing.

---

## 10.5. Full join import-readiness design (BR-SOURCE-10I)

BR-SOURCE-10H confirmed that a bounded scan does **not** recover representative company
context (`coverage_is_representative = false`; `joined_with_sampled_company_context = 0`), so
the honest next step is **not** wider execution but a **contract** for what a future full join
would require. BR-SOURCE-10I is that **docs-only readiness design**: it defines the allowed
future local processing envelope, the join-key treatment, the post-join field survival
contract (prohibited / temporary-technical / candidate-persistible), the record-identity
decision gate, the eligibility rules after a join, the required future gates
(GATE-1 … GATE-8), and the required aggregated report shape.

Load-bearing distinctions it fixes: a **full join ≠ a full import** (a completed join only
*measures* eligibility), and even a future dry-run reporting `full_dataset_processed = true`
must keep `import_executed = false`. It **decides nothing** about the identity grain (that is a
mandatory future gate) and authorizes **no** execution, dry-run, Supabase write, migration,
runtime, or Agent 1 integration. See
[`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md).

**What stays blocked (unchanged).** Import, production import, Supabase writes, migrations,
runtime, Agent 1, HubSpot/Slack, provider calls, and live prospect generation all remain
**blocked**.

---

## 11. Open legal / privacy questions

These decisions are **unresolved** and block a privacy-safe import implementation. Each
requires an explicit legal/privacy determination recorded in the legal decision record:

1. **Full CNPJ persistence.** May Brazil persist the **full CNPJ** (`normalized_tax_id` /
   `tax_id`), or only a `record_identity_key` / hash — for the establishment grain in Brazil
   specifically?
2. **Legal natures.** Which **naturezas jurídicas** are on the eligible-commercial allowlist,
   and which are blocked or routed to `needs_legal_review`?
3. **MEI / empresário individual.** Are MEI/EI records **always excluded**, or eligible under
   specific signals — and under what legal basis?
4. **Address granularity.** Is **`municipality` / `uf`** sufficient, or is any finer address
   ever permitted (and under what basis)?
5. **Minimal `raw_data`.** What is the **exact minimal `raw_data` allowlist** authorized for
   persistence?
6. **Production legal review.** What legal/privacy review (LGPD basis, ND-licence review) is
   required **before production import**, beyond the BR-LEGAL-2 GO already recorded?

Until each of these is resolved, ambiguous records stay in `needs_legal_review` and no import
implementation may proceed.

---

## 12. Flags

```
OPS_BR_PRIVACY_SAFE_IMPORT_ELIGIBILITY_DESIGN_OFFICIAL = true   (after the 10D document merged)

OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_PR_READY = true  (BR-SOURCE-10E — classifier merged as a PR)
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL = false (not an operational authorization)

OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_PR_READY = true   (BR-SOURCE-10F — calibration opened as a PR)
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL = false  (not an operational authorization)

OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_PR_READY = true   (BR-SOURCE-10G — bounded join dry-run opened as a PR)
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL = false  (not an operational authorization)

OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_PR_READY = true    (BR-SOURCE-10I — full join readiness design opened as a docs-only PR)
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL = false   (not an operational authorization)

OPS_BR_READY_FOR_IMPORT             = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT  = false
OPS_BR_READY_FOR_RUNTIME            = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Carried forward from BR-SOURCE-10C (unchanged by this document):

```
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL         = true
OPS_BR_REAL_MANIFEST_VALIDATION_HEADERLESS_PASSED    = true
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED        = false
OPS_BR_REAL_LOCAL_DRY_RUN_BLOCKED_BY_PII_GUARD       = true
```

---

## 13. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only
PR. It does **not**:

- download or import a dataset;
- process the real dataset or open/print any real file, row, full CNPJ, or CPF;
- modify the operator's real local manifest;
- write to Supabase or perform any production write;
- create or modify a migration;
- change the parser, reader, dry-run, manifest validator, snapshot builder, or any connector
  runtime behavior;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- perform live generation or full expansion;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CPFs, and no partner (sócio) personal data are
reproduced. Local WIP (`scratchpad/`) is untouched by any git operation.
