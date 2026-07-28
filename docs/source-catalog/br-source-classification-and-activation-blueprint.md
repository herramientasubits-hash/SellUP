# Brazil Source Classification and Activation Blueprint

**Milestone:** BR-SOURCE-9
**Scope:** Classification / design only. No import activation, no Supabase writes, no
production writes, no migrations, no runtime enrichment, no Agent 1 live integration,
no HubSpot / Slack, no provider calls, no dataset download or import, no dangerous CTAs.
**Status of Brazil in SellUp:** Not connected to Agent 1. Visible in the Source Catalog,
but not operational for the IA discovery / enrichment flow.

> This document is the authoritative classification for every Brazil source registered in the
> Source Catalog (`src/server/agents/prospecting-toolkit/source-catalog.ts`). It records
> intended SellUp use, end-to-end activation paths, and the concrete blockers that keep each
> source from becoming operational with Agent 1. It changes no code path, flag, or catalog
> status. The registry already classifies all three Brazil sources with standard functional
> fields (BR-SOURCE-8B-UI-STANDARDIZE); this document is the human-readable activation
> blueprint layer on top of that classification.

---

## Current decision

Brazil has **no source currently connected to Agent 1**. Brazil sources are visible in the
Source Catalog but are **not operational for IA**. On `main`, all three are standardized to the
same presentational pattern (like `ec_sercop` / `ec_ekos`): `connectionMode: not_connected`,
the listing action is **"Ver detalle"** (never "Conectar"), the detail view omits generic
connection panels, and none appear in the "Operativas IA" tab.

- The bulk official source (`br_receita_dados_abertos`) has completed **local technical
  preparation** (parser, manifest validator, local dry-run over a real file) plus a legal /
  privacy GO, but **import, runtime enrichment, Agent 1 live integration and HubSpot sync
  remain blocked** until a separate milestone with explicit approval.
- The institutional reference source (`br_receita_cnpj`) is a **manual / internal reference**,
  not a connectable pipeline.
- The third-party API candidate (`br_cnpj_ws`, cnpj.ws) is an **API candidate that requires
  validation** (terms, cost, reliability) before any integration design.

No Brazil source is ready for import, runtime, or live prospect generation.

---

## Source inventory

Three Brazil sources are registered (`countryCodes: ['BR']`). No other Brazil sources exist
in the catalog. Registry values below are as of PR base `origin/main`.

| source_key | label | kind | sellupUse | aiFlowStatus | connectionMode | operationalStatus | UI action | end-to-end readiness |
|---|---|---|---|---|---|---|---|---|
| `br_receita_dados_abertos` | Receita Federal CNPJ Dados Abertos (Bulk) | `official_registry` (bulk open dataset) | `discovery` | `pending_integration_design` | `not_connected` | `validation_only` | Ver detalle | **Not ready** — import, runtime, Agent 1 live, HubSpot blocked |
| `br_receita_cnpj` | Receita Federal CNPJ (Referencia institucional) | `official_registry` (institutional portal) | `manual_reference` | `pending_integration_design` | `not_connected` | `validation_only` | Ver detalle | **Not connectable** — no bulk download; complementary to the bulk source |
| `br_cnpj_ws` | cnpj.ws (API tercero) | `commercial_provider` (third-party REST API) | `pending_classification` | `requires_validation` | `not_connected` | `pending_validation` | Ver detalle | **Not ready** — third-party; requires terms / cost / reliability validation |

**UI labels (Spanish):** `discovery` → "Discovery"; `manual_reference` → "Referencia manual";
`pending_classification` (sellupUse) → "Pendiente clasificación IA";
`pending_integration_design` → "Pendiente diseño de integración";
`requires_validation` → "Requiere validación"; `not_connected` → "No conectada";
`validation_only` → "Solo validación"; `pending_validation` → "Pendiente validación".

**Recommended use per source (this milestone's classification):**

| source_key | recommended SellUp role | discovery | enrichment | validation | manual / reference |
|---|---|---|---|---|---|
| `br_receita_dados_abertos` | future enrichment + validation | not ready (no active discovery) | future (after controlled import + lookup/enrichment adapter) | supports future CNPJ validation | — |
| `br_receita_cnpj` | manual / internal reference | no | no | point CNPJ verification | manual point lookup / institutional reference |
| `br_cnpj_ws` | API candidate — requires validation | no (pending validation) | future (pending TOS/SLA/cost validation) | pending validation | — |

**Inventory ambiguity:** none. Exactly three Brazil sources; keys are unambiguous.

---

## Source-by-source decision

### `br_receita_dados_abertos` — Receita Federal CNPJ Dados Abertos (Bulk)

- **UI registry key:** `br_receita_dados_abertos`
- **Canonical technical source key:** `br_receita_cnpj_dados_abertos`
  (parser / staging / dry-run contracts; reconciled via `sourceKeyReconciliation` — the UI
  key is preserved to avoid duplicating the Brazil source).
- **Source type:** official bulk open dataset (`official_registry`, `automationLevel: high`,
  `priority: P0`).
- **Registry classification:** `sellupUse: discovery`, `aiFlowStatus: pending_integration_design`,
  `connectionMode: not_connected`, `operationalStatus: validation_only`.
- **Recommended role:** **future enrichment** and **CNPJ validation**. It is the most complete
  LATAM company dataset (~60M CNPJs, ~22M active): razão social, CNAE, município, situação
  cadastral, capital social, porte, quadro societário.
- **Discovery:** **not ready.** Bulk offline processing (~4.7 GB compressed / ~17 GB
  uncompressed) is not a live discovery source; it is not classified for active discovery.
- **Enrichment:** **future**, only after (1) a controlled Supabase import and (2) a lookup /
  enrichment adapter exist. Blocked today.
- **Manual:** not the intended path for this source (the institutional portal below covers
  point reference).
- **Validation:** suitable to support **future CNPJ validation** once imported into a
  queryable snapshot.
- **Agent 1 readiness:** **not ready.** No import, no lookup adapter, no enrichment adapter,
  no gated Agent 1 integration.
- **Missing pieces (to become end-to-end):**
  1. Real local dry-run QA over the actual dataset (verify parser + manifest at scale).
  2. Import dry-run plan → controlled Supabase pilot import into `source_company_snapshots`
     (contract already documented; unique key reconciliation on `normalized_tax_id` is a caveat).
  3. Lookup adapter (CNPJ → snapshot row).
  4. Enrichment adapter (snapshot → candidate enrichment).
  5. Agent 1 gated integration.
  6. UI enablement.
- **Risks:**
  - **License:** CC BY-ND 3.0 (no derivatives) — commercial / derivative use must be confirmed
    with legal before production, even though BR-LEGAL-2 gave a scoped GO with CNPJ masking
    (`CNPJ_TREATMENT_MODE=A`).
  - **Coverage:** most records carry no contact data (phone / email).
  - **Scope:** SOCIOS / QSA / CPF and personal contact / address fields are excluded by legal
    decision; only company-grain, masked identity is in scope.
  - **Access:** downloads from outside Brazil can time out; a mirror (dados.gov.br /
    arquivos.receitafederal.gov.br) may be required.
- **Current CTA:** "Ver detalle" (detail view only; no connection / import CTAs).
- **Future CTA:** unchanged until a separate import milestone with explicit approval.

### `br_receita_cnpj` — Receita Federal CNPJ (Referencia institucional)

- **UI registry key:** `br_receita_cnpj`
- **Canonical technical source key:** — (none; not a technical import contract).
- **Source type:** institutional official portal (`official_registry`, `automationLevel: low`,
  `priority: P1`).
- **Registry classification:** `sellupUse: manual_reference`,
  `aiFlowStatus: pending_integration_design`, `connectionMode: not_connected`,
  `operationalStatus: validation_only`.
- **Recommended role:** **manual / internal reference.** Institutional reference and point
  CNPJ verification for specific records. Complementary to the bulk source, not a substitute.
- **Discovery:** no.
- **Enrichment:** no (not a bulk / API ingestion source).
- **Manual:** yes — point lookup / institutional reference by a human operator.
- **Validation:** point CNPJ verification of specific records.
- **Agent 1 readiness:** **not connectable.** No mass download from the web portal; minimal
  contact data at the official source.
- **Missing pieces:** not applicable — this source is intentionally classified as manual /
  reference, not as a future pipeline. If bulk ingestion is ever needed, it flows through
  `br_receita_dados_abertos`, not this entry.
- **Risks:** using it as a mass discovery pipeline is explicitly discouraged (`riskNotes`).
- **Current CTA:** "Ver detalle".
- **Future CTA:** "Ver detalle" (remains reference-only).

### `br_cnpj_ws` — cnpj.ws (API tercero)

- **UI registry key:** `br_cnpj_ws`
- **Canonical technical source key:** — (none).
- **Source type:** third-party commercial REST API (`commercial_provider`,
  `automationLevel: high`, `priority: P1`).
- **Registry classification:** `sellupUse: pending_classification`,
  `aiFlowStatus: requires_validation`, `connectionMode: not_connected`,
  `operationalStatus: pending_validation`.
- **Recommended role:** **API candidate — requires validation.** A REST API over CNPJ data,
  more convenient than the Receita Federal portal for integrations, but **not official** and
  **not validated** for SellUp use.
- **Discovery:** no (pending validation).
- **Enrichment:** future / candidate — only after terms, cost and reliability validation.
- **Manual:** not applicable.
- **Validation:** the source itself must be validated (TOS, SLA, cost, rate limits) before any
  integration design.
- **Agent 1 readiness:** **not ready.** No validated terms, no sandbox adapter, no fallback
  policy, no cost / usage tracking.
- **Missing pieces (to become end-to-end):**
  1. Terms / legal / cost validation (third-party over Receita Federal data).
  2. API reliability / rate-limit check.
  3. Sandbox adapter.
  4. Enrichment-only prototype.
  5. Fallback policy.
  6. Cost / usage tracking (`provider_usage_logs`).
  7. Agent 1 gated integration.
- **Risks:** third-party, non-official provider over public Receita Federal data; TOS and SLA
  must be validated before any production use.
- **Current CTA:** "Ver detalle".
- **Future CTA:** "Ver detalle" until validation completes.

---

## End-to-end activation paths

### Path A — Receita Bulk as official enrichment source (`br_receita_dados_abertos`)

Recommended primary path. Bulk official dataset used for **enrichment / validation**, never
as a live discovery source.

1. Real local dry-run QA over the actual dataset.
2. Import dry-run plan.
3. Controlled Supabase pilot import (→ `source_company_snapshots`, masked CNPJ, company grain).
4. Lookup adapter (CNPJ → snapshot).
5. Enrichment adapter (snapshot → candidate enrichment).
6. Agent 1 gated integration (behind explicit approval + flag).
7. UI enablement.

**Blocked at step 1** until a separate milestone with explicit approval.

### Path A' — Receita reference as manual lookup (`br_receita_cnpj`)

Not an activation path. Stays a **manual / internal reference** for point CNPJ verification.
No import, no adapter, no Agent 1 wiring. If bulk data is needed, use Path A.

### Path B — cnpj.ws as API candidate (`br_cnpj_ws`)

Secondary / contingent path. Only pursued if Path A is insufficient or a live API lookup is
required.

1. Terms / legal / cost validation.
2. API reliability / rate-limit check.
3. Sandbox adapter.
4. Enrichment-only prototype.
5. Fallback policy.
6. Cost / usage tracking.
7. Agent 1 gated integration.

**Blocked at step 1** (validation not started).

### Recommended next path

**Path A**, starting at a **real local dry-run QA** over the actual dataset — the lowest-risk
next step that does not touch import, runtime, or Agent 1. Path B is a contingency; Path A' is
reference-only and needs no activation work.

**Not recommended now:** activating import, runtime enrichment, Agent 1 live integration, or
HubSpot sync for any Brazil source.

---

## Current blockers

- **Import blocked** — no controlled Supabase import authorized.
- **Runtime blocked** — no runtime enrichment for any Brazil source.
- **Agent 1 blocked** — no source connected to Agent 1; no lookup / enrichment adapter.
- **HubSpot blocked** — no sync authorized (BR-LEGAL-2 did not authorize HubSpot).
- **Live generation blocked** — no live prospect generation for Brazil.

---

## Classification summary (flags)

| Flag | Value |
|---|---|
| `OPS_BR_ALL_SOURCES_CLASSIFIED` | true |
| `OPS_BR_RECEITA_BULK_CLASSIFIED_FOR_FUTURE_ENRICHMENT` | true |
| `OPS_BR_RECEITA_BULK_CLASSIFIED_FOR_VALIDATION` | true |
| `OPS_BR_RECEITA_BULK_NOT_READY_FOR_DISCOVERY` | true |
| `OPS_BR_RECEITA_REFERENCE_CLASSIFIED_MANUAL_OR_INTERNAL` | true |
| `OPS_BR_CNPJ_WS_CLASSIFIED_API_CANDIDATE` | true |
| `OPS_BR_NO_SOURCE_READY_FOR_AGENT1` | true |
| `OPS_BR_NO_SOURCE_READY_FOR_RUNTIME` | true |
| `OPS_BR_NO_BRAZIL_SOURCE_CONNECTABLE_NOW` | true |
| `OPS_BR_READY_FOR_IMPORT` | false |
| `OPS_BR_READY_FOR_PRODUCTION_IMPORT` | false |
| `OPS_BR_READY_FOR_RUNTIME` | false |
| `OPS_BR_LIVE_PROSPECT_GENERATION_READY` | false |

---

## Recommended next milestone

**BR-SOURCE-10:** choose an activation path or run a real local dry-run QA (Path A, step 1).
No import, runtime, Agent 1, or HubSpot activation without a separate milestone and explicit
approval.

---

## Registry note (why no code change)

The catalog model (`CatalogSource` in
`src/server/agents/prospecting-toolkit/types.ts`) already carries classification fields
(`sellupUse`, `aiFlowStatus`, `connectionMode`, `operationalStatus`, `recommendedUse`,
`canonicalTechnicalSourceKey`), and **all three Brazil sources are already fully classified on
`main`** with standard functional values (BR-SOURCE-8B-UI-STANDARDIZE), as tabulated above.

Because the registry classification is already complete and consistent, this milestone adds no
code: it contributes the **narrative activation blueprint** — recommended roles, end-to-end
activation paths, missing pieces, and blockers — that does not belong in the registry data
model. Re-touching the registry here would risk altering catalog / status-card rendering
(connection-panel guards, status variants) with no classification benefit — a visual
regression this milestone explicitly avoids. The classification is therefore recorded in this
document, and the registry is left unchanged.
