# BR Receita CNPJ Import and Staging Persistence Contract

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-5 — Receita CNPJ import / staging persistence contract
**Status:** Contract of record (docs-only) — **not** a build/import authorization
**Predecessors:**
- BR-SOURCE-1 — identity grain & data contract (`docs/source-catalog/br-receita-cnpj-data-contract.md`)
- BR-SOURCE-2 — local/sample parser (`src/server/source-catalog/connectors/br-receita-cnpj/`)
- BR-SOURCE-3 — controlled parser runner (`scripts/source-catalog/run-br-receita-cnpj-controlled-parser.ts`)
- BR-SOURCE-4 — sanitized local file reader (`.../br-receita-cnpj-file-reader.ts`)
- BR-LEGAL-0/1/2 — legal/privacy decision record (`docs/source-catalog/br-receita-cnpj-legal-privacy-decision-record.md`)

**Pattern analogs:** EC SCVS snapshot writer (`src/server/source-catalog/connectors/ec-scvs/ec-scvs-snapshot-writer.ts`) · shared conflict targets (`src/server/source-catalog/record-identity/record-identity-conflict-targets.ts`) · snapshot tables migration (`supabase/migrations/065_create_source_snapshot_tables.sql`, `087_add_record_identity_key_to_source_company_snapshots.sql`)

---

## 1. Purpose

This document defines the import/staging persistence contract for Brazil Receita CNPJ. It does not implement import, database writes, migrations, runtime enrichment, or production use.

It records, in one place, how the already-merged offline BR Receita CNPJ parser/reader output is intended to reach `source_company_snapshots` in a **future, separately-authorized** milestone: the target persistence model, the snapshot record contract, the upsert/conflict strategy, the validation gates that must pass before any write, the rejection taxonomy, the sanitization/logging policy, the GB-scale processing plan, the controlled import phases, and the operations that remain blocked.

Everything below is a *contract shape*, not a build order. No code, migration, dataset, or write is authorized by this document.

---

## 2. Current official status

The following capabilities are official and merged to `origin/main`:

- **Parser local/sample official** — `buildBrReceitaCnpjSnapshotRows` (BR-SOURCE-2). Pure, offline, snapshot-shaped output.
- **Controlled runner official** — `run-br-receita-cnpj-controlled-parser.ts` (BR-SOURCE-3). In-memory transform over synthetic fixtures; forbidden-runtime-mode fail-closed.
- **Sanitized local file reader official** — `br-receita-cnpj-file-reader.ts` (BR-SOURCE-4). Fixed internal synthetic-CSV directory only; layout validation, forbidden-column blocking, row limits.
- **Legal/Privacy GO recorded** — `LEGAL_GO = true`, `PRIVACY_GO = true`, `LICENSE_DECISION = allowed`, `BR_SOURCE_2_AUTHORIZED = true` (BR-LEGAL-2).
- **Mode A authorized for technical design** — `CNPJ_TREATMENT_MODE = A` (masking/logging/access controls). Mode A does **not** authorize full-CNPJ exposure in logs, reports, screenshots, PRs, or UI.

Still blocked (see § 21): import, production import, runtime, live prospect generation.

---

## 3. Non-goals

This milestone explicitly does **not** cover and does **not** authorize:

- dataset download
- real dataset processing
- Supabase writes
- production import
- migrations
- runtime integration
- Agent 1 live integration
- HubSpot sync
- Slack notifications
- provider calls
- SOCIOS/QSA/CPF processing
- contact enrichment
- full expansion

---

## 4. Source and identity contract

Confirmed against BR-SOURCE-1 (`br-receita-cnpj-data-contract.md`) and the connector types (`br-receita-cnpj-types.ts`):

| Field | Value |
|---|---|
| `source_key` | `br_receita_cnpj_dados_abertos` |
| `country_code` | `BR` |
| identity family | `TAX_GRAIN` |
| `record_identity_key` | `tax:<normalized_14>` |
| `normalized_tax_id` | `<normalized_14>` (full 14-position CNPJ, normalized per data-contract § 3.4) |
| snapshot grain | establishment / full CNPJ (one row per full 14-position CNPJ) |

Clarifications:

- The **CNPJ root (raiz, first 8 positions)** can be derived from `normalized_tax_id` (and is stored in `raw_data.cnpj_root` for grouping), **but it is not the record identity**.
- The **establishment / full 14-position CNPJ is the canonical row grain**. Deduplication is by full CNPJ, never by root, never by name.
- `record_identity_key` and `normalized_tax_id` carry the same value for this source (`tax:<normalized_tax_id>`), so the record-identity and legacy tax-grain conflict paths agree (data-contract § 6).

---

## 5. Target persistence model

The future import must write snapshots into the existing `source_company_snapshots` table **without modifying its schema in this milestone**. The physical table is created by migration 065 and extended (additive) by migration 087.

Conceptual contract of the columns the BR writer would populate — this mirrors the strict subset the EC SCVS writer already persists (`EC_SCVS_PERSISTABLE_COLUMNS`), which is the current, proven discipline:

```
source_key            — 'br_receita_cnpj_dados_abertos'
country_code          — 'BR'
source_year           — snapshot year (NOT NULL; explicit input, never hardcoded)
tax_id                — raw CNPJ string as it appears in the source (traceability)
normalized_tax_id     — normalized full 14-position CNPJ
legal_name            — razão social (NEVER an identity)
raw_data              — sanitized allowlist JSON payload only (§ 6)
record_identity_key   — 'tax:<normalized_14>'
```

Physical-schema note:

- The physical `source_company_snapshots` columns (migration 065 + 087) also include `normalized_legal_name`, `sector`, `city`, `department`, `region`, `priority_score`, `signals`, `financials`, and `imported_at`. The BR MVP writer is **not** required to populate these; coarse location (municipality/UF), CNAE, status, natureza jurídica, porte, and capital social live inside the typed `raw_data` payload (§ 6), matching the BR-SOURCE-2 snapshot output shape (`BrReceitaCnpjSnapshotRow`).
- **Physical column names, types, and the `record_identity_key` unique index must be confirmed against the active Supabase schema before BR-SOURCE-6.** Migration 065 defines a physical `UNIQUE (source_key, country_code, source_year, normalized_tax_id)`; migration 087 adds `record_identity_key` as nullable, `NOT VALID`, and **not** unique. The exact conflict-index situation must be reconciled before any write (see § 11).

There must be no free-form column invention: the writer builds its payload explicitly from an allowlist and drops any extra key, exactly as the EC SCVS writer does after the historical PGRST204 incident.

---

## 6. Snapshot record contract

Conceptual example only — **no real data**. All identifiers below are synthetic placeholders; a real writer must never emit a full CNPJ, CPF, telephone, email, or fine-grained address here.

```json
{
  "source_key": "br_receita_cnpj_dados_abertos",
  "country_code": "BR",
  "source_year": 2026,
  "record_identity_key": "tax:<normalized_14>",
  "normalized_tax_id": "<normalized_14>",
  "tax_id": "<raw source CNPJ string>",
  "legal_name": "<synthetic legal name>",
  "raw_data": {
    "source_type": "official_registry",
    "human_review_required": true,
    "parser_version": "<version>",
    "source_period": "<YYYY-MM>",
    "source_row_index": 0,
    "cnpj_root": "<root 8>",
    "cnpj_order": "<order 4>",
    "cnpj_dv": "<dv 2>",
    "matrix_branch_flag": "<1=matriz|2=filial>",
    "legal_nature_code": "<code>",
    "legal_nature_label": "<label>",
    "company_size_code": "<code>",
    "capital_social_value": "<value>",
    "registration_status_code": "<code>",
    "registration_status_label": "<label>",
    "cnae_main_code": "<main CNAE>",
    "cnae_main_label": "<label>",
    "cnae_secondary_codes": ["<code>"],
    "municipality_code": "<code>",
    "municipality_name": "<name>",
    "uf": "<UF>",
    "start_date": "<YYYY-MM-DD>",
    "simples_opt_in": true,
    "simei_opt_in": false,
    "mei_flag": false
  }
}
```

This shape is exactly the `BrReceitaCnpjSnapshotRow` already produced by the merged parser (BR-SOURCE-2). The future writer must treat that parser output as its **only** input and must not remap, re-derive, or re-introduce excluded fields.

Excluded from any snapshot (see §§ 15–16): SOCIOS/QSA/CPF, telefone/fax/correio_eletronico/DDD, and fine-grained address (logradouro/numero/complemento/bairro/cep).

---

## 7. Source year and source period strategy

- **`source_year`** = calendar year of the Receita snapshot publication/import package. It is `NOT NULL` in the physical table and participates in the conflict key. It is an **explicit input, never hardcoded** (EC SCVS builder discipline; BR data-contract § 7 blocker).
- **`source_period`** = `YYYY-MM` publication period of the monthly Receita dataset, when available. It belongs in the sanitized `raw_data` / import metadata, **not necessarily** in the conflict key.

Compatibility: the exact use of `source_year` must preserve compatibility with the existing table, including its participation in the current physical unique constraint `(source_key, country_code, source_year, normalized_tax_id)`. A `source_year` change produces a new annual snapshot row rather than overwriting the prior year (see § 11).

---

## 8. Import batch metadata

A future import should carry batch-level metadata for auditability:

```
import_batch_id
import_started_at
import_finished_at
source_period
parser_version
file_set_manifest_hash
rows_seen
rows_accepted
rows_rejected
duplicate_rows
forbidden_rows
schema_validation_status
sanitization_status
dry_run_required
executed_by
execution_mode
```

This metadata may live in a dedicated import-log surface (an analog exists: `source_snapshot_runs`, migration 065, which already carries `source_key`, `country_code`, `status`, `started_at`, `completed_at`, `source_year`, `records_found`, `records_upserted`, `error_message`, `metadata`) or inside `raw_data`/`metadata`, depending on the existing schema. **BR-SOURCE-6 must decide the implementation**; this contract only fixes the required fields.

---

## 9. File ingestion boundary

BR-SOURCE-5 does not authorize reading real Receita files. Future real-file ingestion must be separated into a new milestone.

Future real-file ingestion boundary (design intent, not authorized here):

- local file set only
- explicit allowlist of file names
- no SOCIOS/QSA file
- no network download in parser
- no automatic unzip from remote URL
- manifest required before processing
- max rows / chunk size required

The current merged reader (BR-SOURCE-4) already models the safe direction: a fixed internal synthetic-CSV directory, no caller-supplied path, forbidden-token blocking on headers/filenames (`socio`, `socios`, `qsa`, `cpf`, `representante`, `faixa_etaria`), sensitive contact/address stripping, and a hard row ceiling (≤ 10). Real-file ingestion must inherit this fail-closed posture and add a validated manifest.

---

## 10. Parser-to-snapshot mapping

The future writer consumes only the parser output. The parser joins the Receita files as follows (BR-SOURCE-1 § 4, BR-SOURCE-2):

- **EMPRESAS + ESTABELECIMENTOS** joined by `cnpj_root` (raiz / `cnpj_basico`). ESTABELECIMENTOS is the row grain (one row per full CNPJ); EMPRESAS company attributes are denormalized into each row's `raw_data`.
- **SIMPLES / SIMEI** optional regime flags by `cnpj_root`.
- **CNAE** lookup by main CNAE code → label.
- **MUNICIPIOS** lookup by municipality code → name.
- **NATUREZAS** lookup by legal nature code → label.

Invariants:

- The parser output is already snapshot-shaped and must remain the **only** input to the future writer.
- The writer must not remap, re-derive, or reintroduce forbidden fields (SOCIOS/QSA/CPF, contact, fine-grained address).
- Root vs establishment: establishment = row; root = first 8 of `normalized_tax_id` + `raw_data.cnpj_root`; any root-level rollup is a read-time projection, deferred.

---

## 11. Upsert and conflict strategy

- **Conflict key:** `(source_key, country_code, source_year, record_identity_key)` — the `RECORD_IDENTITY_ON_CONFLICT` target defined in `record-identity-conflict-targets.ts` and used by the EC SCVS writer. For this `TAX_GRAIN` source, `record_identity_key = tax:<normalized_tax_id>`, so this path agrees with the legacy tax-grain path `(source_key, country_code, source_year, normalized_tax_id)` (data-contract § 6).
- **Idempotent upsert:** the same input must produce the same snapshot identity; a full re-run of the same file set must be idempotent.
- **In-batch duplicates:** a duplicate `record_identity_key` within one input must fail closed / be rejected (`duplicate_record_identity_key`), never silently merged.
- **Annual isolation:** a `source_year` change creates a new annual snapshot row; it does not overwrite the prior year unless a future policy explicitly decides otherwise.

Physical-index caveat (must be resolved before BR-SOURCE-6): migration 065 provides a physical unique constraint only on `(source_key, country_code, source_year, normalized_tax_id)`. Migration 087 added `record_identity_key` as nullable, `NOT VALID`, and **not** unique. Before any write, the team must confirm whether the writer upserts on the existing tax-grain unique index (valid for this source, since the two keys agree) or whether a `record_identity_key` unique index must be created first. This is a schema-reconciliation decision, not an implementation authorized here.

---

## 12. Validation gates before any write

All of the following must hold before any Supabase write is attempted:

- `LEGAL_GO = true`
- `PRIVACY_GO = true`
- `LICENSE_DECISION = allowed`
- `CNPJ_TREATMENT_MODE = A`
- parser tests pass
- file reader tests pass
- controlled runner tests pass
- sanitization scan pass
- no forbidden columns
- no SOCIOS/QSA/CPF files
- no contact fields
- no granular address
- manifest validated
- row limit / chunking configured
- dry-run summary reviewed
- explicit user approval for the write milestone

Any gate failing is fail-closed: no partial write may proceed.

---

## 13. Rejection taxonomy

Future rejection codes (the first four already exist as `BrReceitaCnpjRejectionReason`; the rest are import/reader-layer codes to be formalized in a future milestone):

```
invalid_cnpj
duplicate_record_identity_key
missing_root_company
incompatible_root_company
forbidden_source_file
forbidden_column
layout_header_missing
layout_unknown_dangerous_column
row_limit_exceeded
sanitization_failed
raw_data_forbidden_key
source_year_invalid
manifest_invalid
```

Every rejection must reference the offending row only through a **safe identifier**:

- `safe_identifier` = hash12 or masked value
- no full CNPJ in logs

---

## 14. Sanitization, masking and logging policy

Required at every layer (parser, reader, runner, future writer, reports):

- no full CNPJ in logs / reports / screenshots
- hash12 for report identifiers
- masking helper for human-readable debugging
- no raw row dump
- no original row persistence
- `raw_data` allowlist only
- no secrets
- no personal-data dumps

Mode A allowed (§ 2) does not relax any of the above: full-CNPJ handling stays gated behind masking, logging, and access controls.

---

## 15. SOCIOS/QSA/CPF hard block

SOCIOS/QSA/CPF are excluded from the BR MVP import.

Any file, column, parser input, output, or writer payload containing SOCIOS/QSA/CPF must **fail closed**. The merged reader already enforces this via forbidden tokens (`socio`, `socios`, `qsa`, `cpf`, `representante`, `faixa_etaria`) on headers and filenames.

Revisiting this would require a **separate legal/privacy and product milestone**. It is out of scope here and remains categorically excluded.

---

## 16. Contact and granular address exclusion

- `telefone`, `fax`, `correio_eletronico`, and `ddd*` fields are excluded.
- `logradouro`, `numero`, `complemento`, `bairro`, `cep` are excluded.
- MVP location is **municipality / UF only** (carried in `raw_data`).

The parser already declares these source fields solely so tests can assert they never leak; the reader strips them at read time.

---

## 17. Scalability and GB-scale processing plan

The real Receita CNPJ dataset is GB-scale. A future import must (design intent, not implemented here):

- stream / chunk instead of loading all rows in memory
- separate file parsing from DB writing
- write in batches
- checkpoint progress
- track counts (seen/accepted/rejected/duplicate/forbidden)
- resume safely after interruption
- fail closed on schema drift
- rate-limit DB writes
- precompute lookups (CNAE, município, natureza) before the join
- avoid storing raw Receita files in the repo

The EC SCVS writer's batched upsert (default batch size 500, fail-fast on batch failure, idempotent re-run) is the established pattern to reuse.

---

## 18. Controlled import phases

```
Phase 0: docs-only contract — this milestone (BR-SOURCE-5).
Phase 1: local real-file dry-run reader, no DB writes.
Phase 2: staging writer dry-run plan, no DB writes.
Phase 3: tiny allowlisted Supabase write pilot, explicit approval required.
Phase 4: controlled larger import, explicit approval required.
Phase 5: runtime enrichment integration, separate approval required.
```

Each phase after Phase 0 is a separate, individually-approved milestone.

---

## 19. Rollback and idempotency strategy

- `import_batch_id` required on every import.
- dry-run before execute.
- idempotent upsert (conflict key § 11).
- an import can be re-run for the same file set with matching counts.
- failed batches must not partially enable runtime.
- a delete/rollback policy must be defined **before** any production import.
- runtime must remain disabled until a separate milestone authorizes it.

---

## 20. Observability and audit requirements

Every import must record:

```
rows_seen
rows_accepted
rows_rejected
rejection reasons
duration
parser_version
source_period
manifest hash
sanitization status
writer mode (dry_run | apply)
executed_by
created_at
safe sample identifiers only
```

No raw rows, no full CNPJ, no personal data in any audit surface.

---

## 21. Still-blocked operations

```
OPS_BR_READY_FOR_IMPORT             = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT  = false
OPS_BR_READY_FOR_RUNTIME            = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 22. Required approvals before implementation

- **BR-SOURCE-6 requires explicit user authorization.**
- Any Supabase write requires a **separate approval phrase**.
- Any production import requires a **separate approval phrase**.
- Any runtime / Agent 1 integration requires a **separate approval phrase**.

---

## 23. Next authorized milestone

**BR-SOURCE-6 — Receita CNPJ real-file dry-run design / local manifest validator.**

BR-SOURCE-6 should still perform **no Supabase writes** unless explicitly authorized. It is a design/dry-run/manifest milestone, not a write milestone.

> **Privacy-safe eligibility gate (BR-SOURCE-10D).** Since this contract was written, the
> headerless real-file layout became official (BR-SOURCE-10C): a real manifest can validate, but
> the real local dry-run remains **blocked by the anti-PII guard** and import stays blocked. The
> validation gates in § 12 are now joined by a mandatory **record-level privacy-safe eligibility
> filter** — only records classified `eligible_for_future_import` may ever reach a writer, and any
> natural-person / PII signal excludes the whole record. That eligibility contract (excluded-record
> classes, persistible/prohibited fields, classification statuses, guardrails, aggregated reporting,
> and open legal/privacy questions) is defined in
> [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md).
> Import, production import, runtime, and live prospect generation remain **blocked**.
>
> **Full join readiness (BR-SOURCE-10I).** The parser-to-snapshot mapping in § 10 joins
> `empresas` + `estabelecimentos` by `cnpj_root` (`cnpj_basico`). The bounded join dry-runs
> (BR-SOURCE-10G/10H) confirmed that overlap is **not** representative in a bounded sample, so a
> future import would first require a **full join** (or an approved equivalent). The conditions
> for that — allowed local processing envelope, join-key treatment, post-join field survival
> contract, the still-open **record-identity grain decision** (which interacts with the § 4 grain
> and the § 11 physical-index reconciliation here), the eligibility rules after a join, and the
> required future gates — are defined, docs-only, in
> [`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md).
> That design **decides no grain** and authorizes **no** dry-run, import, Supabase write,
> migration, runtime, or Agent 1 integration.
>
> **Full join dry-run technical design (BR-SOURCE-10J).** The 10I contract has since been lowered
> into a docs-only **technical design** —
> [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
> — covering a future execution model, architecture options, temporary storage envelope, join-key
> handling, field discard timing, cleanup contract, resource limits, and future CLI/report
> contracts. The still-open **record-identity grain decision** it maps to GATE-4 must be
> reconciled against the § 4 grain and the § 11 physical-index reconciliation here. 10J adds **no
> runner and no command**, **decides no grain**, and authorizes **no** dry-run, import, Supabase
> write, migration, runtime, or Agent 1 integration.
>
> **Full join approval gates checklist (BR-SOURCE-10K).** The GATE-1 … GATE-8 conditions have since
> been turned into a docs-only, formal approval checklist —
> [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
> — with required evidence, approver roles, pass/fail criteria, block conditions, artifacts, a gate
> status model, a dependency graph, an approval-evidence template, and a GO / NO-GO matrix. Directly
> relevant here: **GATE-4 (identity grain)** must choose explicitly among options A / B / C / D and
> reconcile the choice against the § 4 grain and the § 11 physical-index situation of this contract,
> and **GATE-3 (field allowlist)** must freeze which post-join fields may ever survive. 10K
> **approves no gate** — all eight remain `not_started` — adds **no runner and no command**,
> **decides no grain**, and authorizes **no** dry-run, import, Supabase write, migration, runtime,
> or Agent 1 integration.

---

## 24. Resulting operational flags

```
OPS_BR_RECEITA_CNPJ_IMPORT_STAGING_CONTRACT_PR_READY  = true
OPS_BR_RECEITA_CNPJ_IMPORT_STAGING_CONTRACT_OFFICIAL  = false

OPS_BR_IMPORT_STAGING_CONTRACT_DOCUMENTED             = true
OPS_BR_SOURCE_COMPANY_SNAPSHOTS_MAPPING_DOCUMENTED    = true
OPS_BR_IMPORT_VALIDATION_GATES_DOCUMENTED             = true
OPS_BR_GB_SCALE_IMPORT_PLAN_DOCUMENTED                = true

OPS_BR_READY_FOR_IMPORT             = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT  = false
OPS_BR_READY_FOR_RUNTIME            = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 25. Safety confirmation

- No code implementation.
- No parser modification.
- No runner modification.
- No dataset download / import.
- No Supabase writes.
- No migrations.
- No runtime integration.
- No Agent 1 integration.
- No provider calls.
- No HubSpot / Slack.
- No live generation.
- No full expansion.
- No CNPJ / CPF / person data dumps.
- No secrets.
