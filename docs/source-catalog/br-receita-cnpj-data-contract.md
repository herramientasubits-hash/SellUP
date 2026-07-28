# Brazil — Receita Federal CNPJ Dados Abertos: Identity Grain & Data Contract

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-1 — Brazil identity grain and data contract decision
**Status:** Contract of record (decision) — **not** a build authorization
**Predecessor:** BR-SOURCE-0 — `BRSOURCE0A — BRAZIL_PRIMARY_SOURCE_CANDIDATE_IDENTIFIED`
**Pattern analog:** [EC SCVS Operational Closeout](./ec-scvs-operational-closeout.md) · source-family-registry (`src/server/source-catalog/record-identity/source-family-registry.ts`) · snapshot read contract (`src/server/source-catalog/snapshot-read/snapshot-read-contract.ts`)
**Last reviewed:** 2026-07-28 (§ 2 official access updated — BR-SOURCE-10A-SOURCE-VERIFY)

---

## 1. Purpose & scope

This document is the official identity-grain and data contract for the Brazilian primary
source candidate identified in BR-SOURCE-0: **Receita Federal — CNPJ Dados Abertos (bulk)**.

It decides and records, in one place:

1. the preliminary/official `source_key`;
2. the recommended identity grain;
3. how to represent the root company vs the establishment;
4. the minimum permitted fields;
5. the fields excluded for privacy/legal reasons;
6. how those fields map onto `source_company_snapshots`;
7. the legal/technical blockers that must be resolved before any parser/import.

This is a **contract of record**. It does **not** authorize — and nothing here should be read as
authorizing — a parser, connector, runtime change, adapter/validator change, migration, dataset
download, import, Supabase write, production write, runner, dry-run, execute, provider call,
HubSpot sync, Slack notification, live generation, full expansion, or merge to an operational state.
Those remain separate, individually-approved milestones. See § 10 (Safety confirmation).

> **Naming note.** Field names in §§ 4–6 follow the well-documented public CNPJ layout. Before any
> parser is built (a future, separately-authorized milestone), the exact field names, order, and
> encoding **must be reconciled against the current official metadados PDF**
> (`https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf`), which is the binding layout
> authority. This document commits the *contract shape*, not the byte-level parser layout.

---

## 2. Source identity (`source_key`)

| Attribute | Decision |
|---|---|
| **Operational `source_key`** | **`br_receita_cnpj_dados_abertos`** |
| Country code | `BR` |
| Owner | Receita Federal do Brasil (RFB) |
| Dataset (official) | https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj |
| Portal (official) | https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos/cadastros |
| File access (current) | Entry point `https://arquivos.receitafederal.gov.br/`, then navigate `Dados → Cadastros → CNPJ → <YYYY-MM>/` (official public file share on the Receita Federal domain — see § 2.1) |
| File server (deprecated) | ~~`https://arquivos.receitafederal.gov.br/dados/cnpj/`~~ — returns 404 / no longer resolves as of BR-SOURCE-10A-SOURCE-VERIFY (§ 2.1) |
| Layout authority | https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf |
| Access | Public bulk download — no auth, no contract |
| Refresh | Monthly |
| Source type (catalog vocabulary) | `official_registry` |

**Catalog-key reconciliation (blocker → § 7).** The display catalog
(`src/server/agents/prospecting-toolkit/source-catalog.ts`) currently carries the bulk entry under
`br_receita_dados_abertos` and a separate institutional-reference entry under `br_receita_cnpj`.
The operational key committed here is **`br_receita_cnpj_dados_abertos`** — it is unambiguous
against both existing keys and reads as "CNPJ bulk open data". When (and only when) the writer
milestone lands, the display catalog entry and the `source-family-registry` registration must both
adopt `br_receita_cnpj_dados_abertos` so the display catalog, the family registry, and the snapshot
`source_key` agree. This document does **not** change any code today; it records the target key.

### 2.1 Official source access (BR-SOURCE-10A-SOURCE-VERIFY update)

The official Receita CNPJ source **remains available**, but the access path changed. The old flat
file-server paths no longer resolve; access now goes through the official public file share on the
same Receita Federal domain.

**Deprecated historical file server path (no longer usable for manual download):**

- `https://arquivos.receitafederal.gov.br/dados/cnpj/`
- Related flat paths (also 404): `https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/`,
  `https://arquivos.receitafederal.gov.br/cnpj/dados_abertos_cnpj/`.
- **Status as of BR-SOURCE-10A-SOURCE-VERIFY:** returns 404 / no longer resolves for manual download.

**Current official file access:**

- **Entry point:** `https://arquivos.receitafederal.gov.br/`
- **Access model:** official public share / file portal on the Receita Federal domain (no auth, no contract).
- **Manual navigation path:** `Dados → Cadastros → CNPJ → <YYYY-MM>/`, where `<YYYY-MM>` is the monthly
  period actually published in the portal.

**Aggregated official artifact (`cnpj.tar.gz`).** An aggregated official artifact was observed at
`Dados → Cadastros → CNPJ → cnpj.tar.gz`. This does **not** automatically replace the per-family ZIP
workflow (§ 5) and must be evaluated separately before any import/runtime use. It is **not** approved
for the standard family-ZIP flow under this document.

**Official references (unchanged, authoritative):**

- `dados.gov.br` dataset catalog page (§ 2 table).
- `gov.br` Receita Federal open-data / cadastros institutional page (§ 2 table).
- Official CNPJ layout / metadados PDF (§ 1 naming note, § 2 table) — binding layout authority.

**Third-party mirrors remain unapproved.** Third-party mirrors such as Casa dos Dados, Base dos
Dados, GitHub mirrors, blogs, or community archives are **not** approved sources for SellUp unless
separately reviewed and approved.

**This update does not authorize** dataset download, import, Supabase writes, production import,
runtime, Agent 1, HubSpot sync, or live prospect generation. It is a documentation-only correction of
the official access path.

---

## 3. Identity grain

### 3.1 The CNPJ structure (verified)

A CNPJ is **14 positions** in three blocks:

```
  AA AAA AAA / AAAA - DV
  └────┬────┘  └─┬─┘  └┬┘
    raiz (8)   ordem   dígito
   "empresa"   (4)    verificador
             matriz=0001   (2)
              filial=0002…
```

- **Raiz (8)** — identifies the *legal entity* (the company). All establishments of one company
  share the same raiz.
- **Ordem (4)** — identifies the *establishment*. `0001` = matriz (headquarters); `0002`, `0003`, …
  = filiais (branches).
- **DV (2)** — módulo-11 check digits.

**CNPJ alfanumérico (effective July 2026 — load-bearing).** From July 2026, newly-issued CNPJs are
**alphanumeric**: positions 1–12 (raiz + ordem) may contain letters *and* digits; the last 2 (DV)
remain numeric. The DV is computed with módulo-11 over ASCII values (`char − 48`). Legacy
all-numeric CNPJs remain valid indefinitely and coexist with the new format. **Consequence for this
contract:** the CNPJ must be treated as a **normalized alphanumeric string**, never a number and
never "digits only". See § 3.4.

### 3.2 Decision: establishment grain, `TAX_GRAIN` family

| Decision | Value |
|---|---|
| **Physical row grain** | one row per **establishment** = one **full 14-position CNPJ** |
| **Source family** | **`TAX_GRAIN`** |
| **`record_identity_key`** | **`tax:<normalized_full_cnpj_14>`** |
| **`normalized_tax_id`** | normalized full 14-position CNPJ (see § 3.4) |
| **Cardinality invariant** | within `(source_key, country_code, source_year)`, one full CNPJ → **at most one row** |

Rationale:

- The dataset's natural grain (the `ESTABELECIMENTOS` file) is **one row per full CNPJ**. There is
  no legitimate case where the same full CNPJ appears twice in one monthly snapshot, so the
  `TAX_GRAIN` invariant ("one fiscal identity → at most one row", per `source-family-registry.ts`)
  holds exactly.
- The full CNPJ **is** a genuine fiscal identifier and is the identity Brazilian companies actually
  transact and are matched under (invoices, contracts, HubSpot records key on the full CNPJ, usually
  the matriz `…0001`). Using it as `normalized_tax_id` makes dedup and cross-system matching correct.
- This reuses the existing `readTaxGrainSnapshotByTaxId` contract and the tax-grain conflict path
  without introducing a new native-record derivation.

### 3.3 Rejected alternative: root-as-identity → `NATIVE_RECORD_GRAIN`

An alternative was to set `normalized_tax_id = raiz (8)` and treat each establishment as a
provider-native record (`NATIVE_RECORD_GRAIN`, like EC SCVS `expediente`). **Rejected** because:

- It would make `normalized_tax_id` the 8-digit root, which is **not** how companies are matched in
  practice — the root alone is not a transacting fiscal identity — degrading dedup against
  HubSpot/accounts.
- It imports the native-grain complexity (multiplicity probes) with no benefit: the establishment
  full CNPJ is already a clean, unique fiscal key.

The `NATIVE_RECORD_GRAIN` shape is the right tool when a fiscal id legitimately spans multiple rows
(PanamaCompra, Fedesoft, SCVS). Brazil's establishment grain does not have that property, so
`TAX_GRAIN` is the correct classification.

### 3.4 Normalization rule (`normalized_tax_id`)

Because of CNPJ alfanumérico, normalization is **string-based, not numeric**:

1. Uppercase; strip formatting punctuation (`.`, `/`, `-`, spaces).
2. Require exactly **14 positions**: positions 1–12 in `[A-Z0-9]`, positions 13–14 in `[0-9]`.
3. **Validate the DV** with módulo-11 over ASCII (`char − 48`). A CNPJ that fails DV validation is
   **not** a valid record identity — it is skipped/quarantined (fail-closed), mirroring the EC SCVS
   invalid-RUC discipline (do not relax the validator to admit malformed identities).
4. `record_identity_key = tax:<normalized_14>`; `normalized_tax_id = <normalized_14>`.
5. `tax_id` (raw) preserves the source's original string for traceability.

Rows without a DV-valid full CNPJ are **rejected** (no usable record identity), analogous to EC SCVS
rejecting rows without a usable `expediente`.

---

## 4. Root company vs establishment representation

There is **no separate "company" row**. The root company is represented **derivably**, not as its
own snapshot record:

- The **establishment** is the row, keyed by full CNPJ (§ 3.2).
- The **root company (raiz)** is recoverable as the **first 8 positions** of `normalized_tax_id`,
  and is also stored explicitly in `raw_data` as `cnpj_basico` for greppable grouping.
- `raw_data.identificador_matriz_filial` (`1` = matriz, `2` = filial) marks each row's role.
- **Company-level attributes** (razão social, natureza jurídica, porte, capital social) live in the
  `EMPRESAS` file at the root grain; the builder **joins them onto each establishment row**
  (denormalized into `raw_data`), so a matriz and its filiais each carry consistent company context
  without a second table.
- Company-level grouping/rollup (e.g., "all establishments of this company") is a **read-time
  projection** over `cnpj_basico` / the first 8 of `normalized_tax_id`, deferred to whenever a
  consumer needs it. It is **not** modeled as a snapshot row in this contract.

This keeps `source_company_snapshots` single-grain (establishment) while preserving the full
matriz/filial hierarchy losslessly.

---

## 5. Field contract

> Company-registral fields only. All names to be reconciled against the official metadados PDF at
> parser time (§ 1). The `ESTABELECIMENTOS` file also carries contact fields (phone/fax/email) —
> those are **excluded** here (§ 5.3).

### 5.1 Columns of `source_company_snapshots` (fixed by the table)

The table columns are fixed (see EC SCVS writer): `source_key`, `country_code`, `source_year`,
`tax_id`, `normalized_tax_id`, `legal_name`, `raw_data`, `record_identity_key`.

| Column | Brazil value |
|---|---|
| `source_key` | `br_receita_cnpj_dados_abertos` |
| `country_code` | `BR` |
| `source_year` | snapshot year of the monthly dataset (explicit input; not hardcoded) |
| `tax_id` | raw CNPJ string as it appears in the source |
| `normalized_tax_id` | normalized full 14-position CNPJ (§ 3.4) |
| `legal_name` | razão social (**never** an identity — see § 5.3 MEI/EI caveat) |
| `raw_data` | JSON registral payload (§ 5.2) |
| `record_identity_key` | `tax:<normalized_14>` |

### 5.2 Minimum permitted `raw_data` fields (company-registral, low-PII)

Derived from `EMPRESAS` (root) + `ESTABELECIMENTOS` (establishment) + reference catalogs:

- **Identity/hierarchy:** `cnpj_basico` (raiz 8), `cnpj_ordem` (4), `cnpj_dv` (2),
  `identificador_matriz_filial` (1=matriz / 2=filial).
- **Company (from EMPRESAS):** `razao_social`, `natureza_juridica` (code), `porte_empresa` (code),
  `capital_social` (public company financial attribute).
- **Establishment status:** `situacao_cadastral` (code), `data_situacao_cadastral`,
  `motivo_situacao_cadastral` (code) — filter target `situação = 02 (Ativa)`.
- **Activity:** `cnae_fiscal_principal`, `cnae_fiscal_secundaria` (codes; tech filter ≈ CNAE `62xx`),
  `data_inicio_atividade`.
- **Coarse location:** `municipio` (code), `uf`. *(Fine-grained street address —
  `tipo_logradouro`/`logradouro`/`numero`/`complemento`/`bairro`/`cep` — is **out** of the minimum
  set; see § 5.3.)*
- **Regime flags (from SIMPLES, optional):** `opcao_simples`, `opcao_mei` — **as booleans/codes
  only**, and note the MEI privacy caveat in § 5.3.
- **Provenance/traceability (as EC SCVS):** `source_type: 'official_registry'`,
  `human_review_required: true`, `source_row_index`, and optional `source_file_name`,
  `source_downloaded_at`, `import_batch_id`.

### 5.3 Excluded fields (privacy / legal)

**Hard-excluded — never parsed into the snapshot, never persisted, never logged, never surfaced in
candidate metadata, reports, or `provider_usage_logs`:**

- **Entire `SOCIOS` / QSA file** — partner **name** + **CPF/CNPJ do sócio**, representante legal
  name/CPF, faixa etária. This is personal data (CPF) and is the highest-risk file in the dataset.
- **Contact fields inside `ESTABELECIMENTOS`** — `ddd_1`/`telefone_1`, `ddd_2`/`telefone_2`,
  `ddd_fax`/`fax`, `correio_eletronico` (email). These are contact/PII-adjacent data. **Contact
  enrichment stays a separate, independently-gated path** (consistent with BR-SOURCE-0 and the EC
  SCVS PII rule); the registral snapshot must not become a contact source.
- **Fine-grained street address** (`logradouro`, `numero`, `complemento`, `bairro`, `cep`) — held
  out of the minimum set; only `municipio`/`uf` are needed for the discovery/registral base. Revisit
  only with an explicit, legally-reviewed need.
- **Raw personal identifiers of any kind**, and any free `raw_data` blob echoing the above.

**MEI / individual-entrepreneur blur (special handling, requires legal basis):** for MEI and
empresário individual (natural-person-equivalent natureza jurídica), the "company" is effectively a
natural person and `razao_social` is often the person's own name. Such `legal_name` values must be
treated as **potentially personal data**, not pure company data. Policy: flag these records by
natureza jurídica and **defer their inclusion to the legal GO** (§ 7); do not silently treat them as
ordinary company records.

---

## 6. Mapping to `source_company_snapshots`

- **Builder shape** mirrors the EC SCVS offline builder: a **pure** transform from parsed source rows
  → snapshot rows, producing exactly the eight table columns (§ 5.1) plus a typed `raw_data`.
- **Grain:** one accepted row per DV-valid full CNPJ (§ 3).
- **Conflict key (writer):** `(source_key, country_code, source_year, record_identity_key)` — the
  same primary identity path EC SCVS uses; the legacy fiscal path
  `(source_key, country_code, source_year, normalized_tax_id)` is consistent here because, for this
  `TAX_GRAIN` source, `record_identity_key` is `tax:<normalized_tax_id>` (they carry the same value),
  so both conflict paths agree.
- **Family registration:** when the writer lands, register
  `br_receita_cnpj_dados_abertos: 'TAX_GRAIN'` in `SOURCE_FAMILY_BY_SOURCE_KEY` (fail-closed: an
  unregistered key throws by design). This document records the intended classification; it does
  **not** edit the registry today.
- **Rejections (fail-closed):** rows with no DV-valid full CNPJ → rejected (`missing/invalid record
  identity`); duplicate full CNPJ within one input → rejected (`duplicate_record_identity_key`). Do
  **not** relax the DV validator to admit malformed CNPJs (EC SCVS discipline).
- **Read path:** consumers use `readTaxGrainSnapshotByTaxId` (probes `.limit(2)`, flags multiplicity
  as an invariant violation rather than silently truncating).

Illustrative (non-normative) accepted-row shape:

```jsonc
{
  "source_key": "br_receita_cnpj_dados_abertos",
  "country_code": "BR",
  "source_year": 2026,
  "tax_id": "12.345.678/0001-95",
  "normalized_tax_id": "12345678000195",
  "legal_name": "EXEMPLO TECNOLOGIA LTDA",
  "record_identity_key": "tax:12345678000195",
  "raw_data": {
    "source_type": "official_registry",
    "human_review_required": true,
    "cnpj_basico": "12345678",
    "cnpj_ordem": "0001",
    "cnpj_dv": "95",
    "identificador_matriz_filial": "1",
    "natureza_juridica": "2062",
    "porte_empresa": "03",
    "situacao_cadastral": "02",
    "cnae_fiscal_principal": "6201501",
    "municipio": "7107",
    "uf": "SP"
    // NO telefone / email / fax / sócios / CPF / street address
  }
}
```

> Values above are synthetic placeholders — no real CNPJ, company, or personal data is reproduced.

---

## 7. Blockers before any parser / import

**Legal / privacy (non-technical — the gating class, same as EC live/full expansion):**

1. **CC BY-ND 3.0 (NoDerivatives) licence review.** The dataset's licence prohibits derivatives; a
   derived commercial dataset may conflict with "no derivatives". Requires an explicit legal opinion
   before building. **GO required.**
2. **LGPD (Lei 13.709/2018) basis.** Documented legal basis for: excluding `SOCIOS`/CPF (confirmed
   exclusion), handling the **MEI/EI name blur**, and confirming the contact-field exclusion. **GO
   required.**

**Technical / operational:**

3. **Catalog & family-registry key reconciliation** to `br_receita_cnpj_dados_abertos` (§ 2) — must
   happen in the writer milestone, not before.
4. **CNPJ alfanumérico support** — normalization/validation must be string-based (§ 3.4) from day
   one, or legacy-only parsing will silently drop post-July-2026 companies.
5. **Volume / ETL** — GB-scale offline processing (~4.7 GB compressed / ~17 GB uncompressed,
   ~60M CNPJs / ~22M active), chunking/partitioning, and **no massive download under this or any
   milestone until authorized**.
6. **External-access / path verification** — the official source moved from the deprecated flat paths
   to the official file share (§ 2.1); enter at `https://arquivos.receitafederal.gov.br/` and navigate
   `Dados → Cadastros → CNPJ → <YYYY-MM>/`. Access from outside Brazil may still time out; confirm the
   current portal path at build time. Third-party mirrors remain unapproved (§ 2.1).
7. **`source_year` semantics** — monthly dataset; decide how the monthly snapshot maps to
   `source_year` (explicit input, never hardcoded — EC SCVS builder discipline).
8. **No contact data in source scope** — contact enrichment remains a separate, gated path (§ 5.3).

None of the above is resolved by this document. This is the **decision + contract**; the build is a
later, separately-approved sequence.

---

## 8. Decision summary

| # | Question | Decision |
|---|---|---|
| 1 | `source_key` | **`br_receita_cnpj_dados_abertos`** (reconcile catalog/registry at writer time) |
| 2 | Identity grain | **Establishment / full 14-position CNPJ**, family **`TAX_GRAIN`**, `record_identity_key = tax:<normalized_14>` |
| 3 | Root vs establishment | Establishment = row; root = first 8 of `normalized_tax_id` + `raw_data.cnpj_basico`; company attrs denormalized from `EMPRESAS`; rollup is read-time |
| 4 | Minimum fields | CNPJ (raw+normalized), razão social, + `raw_data`: cnpj hierarchy, natureza jurídica, porte, capital social, situação, CNAE, data início, município/UF, Simples/MEI flags |
| 5 | Excluded fields | Entire `SOCIOS`/CPF; contact fields (telefone/fax/email); fine-grained street address; any personal identifier; MEI/EI name → personal-data handling, defer to legal GO |
| 6 | Snapshot mapping | 8 fixed columns + typed `raw_data`; conflict key `(source_key,country_code,source_year,record_identity_key)`; register `TAX_GRAIN`; fail-closed DV/dup rejections |
| 7 | Blockers | ND-licence GO + LGPD GO (legal); catalog/registry key, alphanumeric CNPJ, GB-scale ETL, mirror access, `source_year` semantics, contact-path separation (technical) |

Readiness flags at this milestone:

```
BR_SOURCE_1_IDENTITY_GRAIN_DECIDED            = true
BR_SOURCE_1_DATA_CONTRACT_OF_RECORD           = true

BR_RECEITA_CNPJ_LEGAL_GO                       = false   (ND licence + LGPD unresolved)
BR_RECEITA_CNPJ_PARSER_AUTHORIZED              = false
BR_RECEITA_CNPJ_IMPORT_AUTHORIZED              = false
BR_RECEITA_CNPJ_READY_FOR_LIMITED_EXPANSION    = false
BR_RECEITA_CNPJ_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 9. Next milestone (not authorized here)

**BR-SOURCE-2** — legal review outcome (ND licence + LGPD) and, only if GO, an offline
parser/builder design for the CNPJ bulk dataset following this contract (pure builder → snapshot
rows, DV validation, alphanumeric-safe normalization, PII exclusions). No download, parser, or
import is authorized until BR-SOURCE-2 is explicitly approved with its own scope.

---

## 10. Safety confirmation

This milestone is **docs-only**. It creates a branch and a documentation file and opens a
docs-only PR. It does **not** create a parser, connector, runtime change, adapter/validator change,
migration, or dataset download; it does not import data, write to Supabase, perform production
writes, run a runner, dry-run, or execute; it does not call providers, HubSpot, or Slack; it does
not perform live generation or full expansion; and it does **not** merge. No secrets, no massive
data dumps, no real CNPJs, and no partner (sócio) personal data are reproduced. Local WIP
(`scratchpad/`) is untouched by any git operation.
