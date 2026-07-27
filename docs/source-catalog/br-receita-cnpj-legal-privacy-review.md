# BR Receita CNPJ Legal and Privacy Review Package

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-LEGAL-0 — Legal/privacy review package for Brazil Receita CNPJ
**Status:** Review package (handoff to Legal/Privacy) — **not** a legal decision and **not** a build authorization
**Predecessor:** BR-SOURCE-1 — `BRSOURCE1LANDA — RECEITA_CNPJ_DATA_CONTRACT_MERGED` ([data contract](./br-receita-cnpj-data-contract.md))
**Pattern analog:** [EC SCVS Limited Expansion Policy](./ec-scvs-limited-expansion-policy.md) · [EC SCVS Operational Closeout](./ec-scvs-operational-closeout.md)
**Prepared:** 2026-07-27

---

## 1. Purpose

This document prepares the legal and privacy questions that must be answered before SellUp
may build a parser, run an import, or use the Receita Federal CNPJ Dados Abertos dataset in
any runtime path. It is a **handoff package for Legal/Privacy review**.

> This package does not approve parser, import, runtime, enrichment, or production use.
> It prepares the legal/privacy questions required before any build/import decision.

It builds directly on the identity-grain and data contract already merged in BR-SOURCE-1
([`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)) and does not change,
reinterpret, or override any decision recorded there. Where the contract already excludes a data
category (e.g. `SOCIOS`/CPF, contact fields), this package carries that exclusion forward as a
default and asks Legal/Privacy to confirm it.

Nothing in this document is a legal opinion. Every "known issue", "risk", and "option" below is a
question for Legal/Privacy, not a conclusion reached by the SellUp engineering side. No legal
interpretation here is final until Legal/Privacy approves.

---

## 2. Review status

```
LEGAL_GO            = false
PRIVACY_GO          = false
PARSER_AUTHORIZED   = false
IMPORT_AUTHORIZED   = false
RUNTIME_AUTHORIZED  = false
```

- **Decided (upstream, BR-SOURCE-1):** identity grain (establishment / full CNPJ, `TAX_GRAIN`),
  `record_identity_key = tax:<normalized_14>`, default field allowlist, default exclusions.
- **Open (this milestone routes to Legal/Privacy):** licence usage, LGPD basis, CNPJ treatment
  mode, MEI/EI inclusion, Simples/SIMEI inclusion, address granularity, raw-data/logging policy,
  retention, access controls, and future HubSpot sync.

No parser/import/runtime work may start until § 14 (Minimum approval needed before parser) is
satisfied by an explicit Legal/Privacy decision.

---

## 3. Source and license summary

| Attribute | Value (as documented officially) |
|---|---|
| Dataset | Receita Federal do Brasil — CNPJ Dados Abertos (bulk) |
| Owner | Receita Federal do Brasil (RFB) |
| Dataset portal | `https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj` |
| File server | `https://arquivos.receitafederal.gov.br/dados/cnpj/` |
| Layout authority | `https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf` |
| Access | Public bulk download — no auth, no contract |
| Refresh | Monthly |

**Licence — unresolved and load-bearing.** BR-SOURCE-1 recorded the licence as **CC BY-ND 3.0**
(Attribution-NoDerivatives). During this review, public Creative Commons sources surfaced a
**CC BY-NC-ND 3.0 Brasil** variant (Attribution-**NonCommercial**-NoDerivatives) associated with
Brazilian open-data licensing. These are materially different:

- **CC BY-ND 3.0** — allows commercial redistribution of the *original* work; prohibits
  distributing *derivative/adapted* works. (Source: Creative Commons deed.)
- **CC BY-NC-ND 3.0 Brasil** — prohibits **both** commercial use **and** derivative works.
  (Source: Creative Commons Brasil deed/legalcode.)

If the binding licence is the **NC** variant, SellUp's intended commercial internal use may be
prohibited outright, not merely constrained by "no derivatives".

- known issue: **CC BY-ND / NoDerivatives (and possibly NonCommercial) must be reviewed for
  SellUp's intended use.**
- The exact licence shown on the dataset's own metadata (CKAN `license_id` / dataset page) must be
  read and confirmed by Legal/Privacy from the official source before any build decision. The
  engineering side must not assume which Creative Commons variant applies.
- no legal interpretation is final until Legal/Privacy approves.

---

## 4. Data categories under review

| # | Category | Default state (from BR-SOURCE-1) | Legal/Privacy decision needed |
|---|---|---|---|
| A | Company / establishment registration data (razão social, natureza jurídica, porte, situação, CNAE, data início) | Permitted (registral, low-PII) | Confirm allowed under licence + LGPD |
| B | Fiscal identifiers / CNPJ (raw + normalized full 14) | Permitted as identity key | Choose CNPJ treatment mode (§ 7) |
| C | Contact fields inside `ESTABELECIMENTOS` (telefone, fax, correio_eletronico) | **Excluded** | Confirm strict exclusion (§ 9) |
| D | `SOCIOS` / QSA / CPF (partner name, CPF, representante legal) | **Blocked** | Confirm block; separate review if ever needed (§ 10) |
| E | MEI / EI and person-linked business records (razão social ≈ person name) | Flagged; deferred | Include, exclude, or mask (§ 8) |
| F | Simples / SIMEI fiscal status flags | Permitted as boolean/code | Confirm allowed |
| G | Address / location granularity (`municipio`/`uf` vs full street) | Coarse only (`municipio`/`uf`) | Confirm permitted granularity |
| H | Derived / computed fields and hashes (root grouping key, `record_identity_key`) | Permitted (derived) | Confirm persistence allowed (§ 7 interacts) |

---

## 5. Proposed SellUp use case

The use SellUp proposes for Legal/Privacy to evaluate (subject to approval; not yet authorized):

- **internal source-catalog enrichment** — populate `source_company_snapshots` for BR at the
  establishment grain, as an internal registral base;
- **prospect/account deduplication** — match prospects and accounts on the normalized full CNPJ;
- **commercial research support** — internal firmographic context (sector via CNAE, porte,
  situação, município/UF) for the sales/prospecting workflow;
- **account grouping by root CNPJ** — read-time rollup of establishments sharing a raiz (first 8);
- **no external publication** — the dataset (raw or derived) is never republished externally;
- **no resale of raw dataset** — SellUp does not redistribute or sell the bulk data;
- **no automated outreach from this source** — this registral source is not a contact/outreach
  channel;
- **no HubSpot sync until separate approval** — enriched results are not synced to HubSpot under
  this or the BR-SOURCE-1 scope; any future sync is a separate, independently-approved decision
  (see § 12 Q12).

---

## 6. Explicitly excluded data

Excluded by default in this review (carried forward from BR-SOURCE-1). These are **not** parsed,
persisted, logged, surfaced in candidate metadata, or reproduced in reports unless Legal/Privacy
explicitly and separately approves a change:

- the entire `SOCIOS` / QSA file;
- CPF (in any file or field);
- partner / shareholder / representante-legal names;
- `telefone` (telefone_1, telefone_2) and DDD fields;
- `fax`;
- `correio_eletronico` (email);
- full `raw_data` rows / any blob echoing excluded fields;
- fine-grained street address (`logradouro`, `numero`, `complemento`, `bairro`, `cep`) unless
  separately approved;
- any person-level data;
- personal examples (real people, real partners) in reports or PRs.

---

## 7. CNPJ treatment options

The CNPJ is the fiscal identifier and the identity key in the BR-SOURCE-1 contract. Legal/Privacy
must choose **one** of the following persistence modes. (For Brazilian legal entities the CNPJ
identifies a company; for MEI/EI it may be tied to a natural person — see § 8, which interacts with
this choice.)

**Mode A — Full CNPJ allowed**
- `normalized_tax_id` may store the normalized full CNPJ.
- `record_identity_key = tax:<normalized_14>`.
- Strict masking in reports/logs (only masked/hash identifiers surfaced; § 11).
- Requires explicit Legal/Privacy GO.

**Mode B — Hash-only**
- `normalized_tax_id` remains null or restricted.
- `record_identity_key` uses a hash / opaque key derived from the CNPJ.
- Fiscal matching by raw CNPJ is blocked; dedup value against HubSpot/accounts is lower.
- Lower privacy exposure, lower matching value.

**Mode C — Hybrid restricted**
- Full CNPJ available only inside restricted internal processing.
- Persisted public/reportable fields use a hash/mask.
- Requires access controls and logging rules (§ 17) to be in place.

**Decision required:** Legal/Privacy must select Mode A, B, or C. No mode is selected yet (§ 15).

---

## 8. MEI / EI treatment options

MEI (Microempreendedor Individual) and empresário individual (EI) records can behave as
natural-person data: `razao_social` is frequently the person's own name.

Questions for Legal/Privacy:

- Can MEI/EI records be processed as company records?
- Should MEI/EI be excluded from the MVP entirely?
- Should MEI/EI legal names be masked or blocked because they may identify a natural person?

**Prudent recommendation (subject to Legal/Privacy):**

```
Exclude MEI/EI from MVP parser/import unless Legal/Privacy explicitly approves.
```

This mirrors the BR-SOURCE-1 caveat: flag MEI/EI by natureza jurídica and defer inclusion to the
legal GO rather than silently treating them as ordinary company records.

---

## 9. Contact fields treatment

```
ESTABELECIMENTOS may include phone/fax/email fields.
These fields are excluded from the MVP source-catalog contract.
Contact enrichment must remain a separate gated path.
```

The registral snapshot must not become a contact source. Any future use of contact fields is a
separate, independently-gated path with its own legal basis, and is out of scope for both
BR-SOURCE-1 and this review.

---

## 10. SOCIOS / CPF treatment

```
SOCIOS / QSA / CPF is blocked from MVP.
No parser/import/read path should process SOCIOS in BR-SOURCE-2.
A separate legal/privacy review is required before any future use.
```

The `SOCIOS` file is the highest-risk file in the dataset (partner names + CPF, representante legal
name/CPF). It is hard-excluded: no parser, no import, no read path, no logging. Any future
consideration of this file requires its own, independent legal/privacy milestone — it may not be
folded into a parser/import approval for the registral (company) data.

---

## 11. Raw data and logging policy

Required controls for any future build (proposed here, enforced later):

- no full `raw_data` persistence (only the typed, allowlisted registral fields);
- no CNPJ / CPF / person data in application or provider logs;
- no full CNPJ in PR reports;
- only masked / hash-12 identifiers in milestone reports;
- sensitive values never printed in terminal output;
- screenshots must not expose CNPJ / CPF / person data.

These controls are also applied to this review package itself: it contains no real CNPJ, no real
CPF, no real company, and no partner/personal data (§ 18, § Appendix, and the sanitization checks
run before commit).

---

## 12. Legal/privacy questions for approval

1. Does CC BY-ND (or, if applicable, CC BY-NC-ND) allow SellUp's internal transformation/enrichment
   use? Specifically, does building a derived internal dataset conflict with "NoDerivatives", and
   does any "NonCommercial" term (if the licence is the NC variant) prohibit SellUp's commercial
   internal use?
2. Can UBITS store the full CNPJ as `normalized_tax_id` for Brazilian legal entities?
3. Are MEI / EI records allowed, or must they be excluded (or their names masked)?
4. Are Simples / SIMEI flags allowed to be stored and used?
5. What location granularity is permitted (`municipio`/`uf` only, or finer)?
6. Can `capital_social` be stored and used for scoring?
7. Are contact fields strictly prohibited, or allowed under a separate legal basis (and if so,
   which)?
8. Can derived hashes / root grouping keys be persisted?
9. What retention policy applies to the monthly snapshots (how long, and how superseded snapshots
   are handled)?
10. What access controls are required (who may read full CNPJ / restricted fields)?
11. What report / log masking is required (format of masked identifiers; what may appear in PRs and
    dashboards)?
12. Can enriched results be synced to HubSpot in the future, or does that require a separate
    approval?

---

## 13. Go / no-go decision matrix

Each row is a decision Legal/Privacy owns. The default safe state holds until an explicit decision
is recorded.

| Decision area | Question | Default safe state | Legal/Privacy decision needed | Impact if approved | Impact if rejected |
|---|---|---|---|---|---|
| Licence — derivatives | Does ND permit a derived internal dataset? | Treat as **not permitted**; no build | Yes | Parser/import may proceed on licence grounds | BR-SOURCE-2 build blocked on licence |
| Licence — commercial | If NC variant applies, is commercial internal use allowed? | Treat as **not permitted** | Yes (confirm exact licence first) | Commercial internal use allowed | Dataset unusable for SellUp's commercial purpose |
| CNPJ persistence | Store full CNPJ, hash-only, or hybrid? | No persistence (no mode selected) | Yes (choose Mode A/B/C) | Chosen matching capability enabled | No fiscal identity persistence; dedup degraded |
| MEI / EI | Include, exclude, or mask? | **Exclude** from MVP | Yes | MEI/EI included per decision | MEI/EI excluded; coverage reduced |
| Simples / SIMEI | Store fiscal-regime flags? | Exclude until confirmed | Yes | Regime flags available for scoring | Flags dropped |
| Address granularity | `municipio`/`uf` only, or finer? | **Coarse only** | Yes | Finer address if approved | Coarse-only base |
| Contact fields | Prohibited or separately based? | **Prohibited** | Yes | Only via separate gated path | Remain excluded |
| SOCIOS / CPF | Any future use? | **Blocked** | Yes (separate milestone) | Separate review only | Permanently excluded from MVP |
| Raw data / logging | Masking + no-raw policy accepted? | Enforce strict policy | Yes (confirm controls) | Controls codified pre-build | No build without controls |
| Retention | Snapshot retention policy? | Undefined → no import | Yes | Retention rule codified | Import blocked pending policy |
| HubSpot sync | Future sync allowed? | **Not allowed** here | Yes (separate approval) | Sync in a later approved milestone | No sync |

---

## 14. Minimum approval needed before parser

```
BR-SOURCE-2 parser can only begin after Legal/Privacy explicitly decides:

- license usage allowed or not;
- selected CNPJ treatment mode;
- MEI/EI inclusion/exclusion;
- Simples/SIMEI inclusion/exclusion;
- allowed address granularity;
- allowed raw_data policy;
- report/log masking requirements.
```

Until all seven are decided and recorded, `PARSER_AUTHORIZED` stays `false`. A partial decision does
not authorize a partial build.

---

## 15. Approved operating modes

```
No mode is approved yet.
Mode A/B/C are options only.
```

The three CNPJ treatment modes in § 7 are presented for Legal/Privacy to choose from. None is
selected or approved at this milestone.

---

## 16. Non-approved operations

The following remain **not authorized** by this document (and were not authorized by BR-SOURCE-1):

- parser;
- connector;
- import;
- Supabase writes;
- runtime enrichment;
- Agent 1 integration;
- HubSpot sync;
- Slack notification;
- provider calls;
- live prospect generation;
- full expansion.

---

## 17. Required technical controls after approval

Proposed for a future, separately-authorized build. **Not implemented here** — listed so
Legal/Privacy can see the controls that would enforce their decisions:

- masking helper for CNPJ / CPF (single shared utility);
- sanitized logger (strips fiscal/personal identifiers);
- parser-level field allowlist (only the § 4 A/F/G/H fields, per decisions);
- explicit file denylist for `SOCIOS`;
- fail-closed behavior if forbidden columns appear in a source file;
- no full `raw_data` dump;
- access-controlled storage if full CNPJ is approved (Mode A/C);
- source coverage summary that reports counts only, without sensitive values;
- sample-only dry-run before any bulk import.

---

## 18. Evidence and references

Official / primary sources reviewed for this package. Each entry: URL, what it states, why it
matters, and the open question it leaves for Legal/Privacy.

**Dataset (Receita Federal / dados.gov.br)**
- `https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj`
  — the official dataset entry for CNPJ Dados Abertos on the Brazilian open-data portal. *Why it
  matters:* it is the authoritative place where the dataset's own licence/`license_id` and terms
  are recorded. *Open question:* the portal page is a dynamic app and its exact recorded licence
  field must be read directly from the official metadata by Legal/Privacy (the engineering side
  could not confirm the precise Creative Commons variant from the rendered page alone).
- `https://arquivos.receitafederal.gov.br/dados/cnpj/`
  — the official bulk file server. *Why it matters:* it is the primary distribution point for the
  monthly bulk files. *Open question:* external access/mirror reliability and the terms accompanying
  the files must be confirmed at build time (not in scope here).
- `https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf`
  — the official layout/metadados document. *Why it matters:* binding authority for field names and
  file contents (including which files carry contact fields and `SOCIOS`). *Open question:* the
  exact field inventory must be reconciled at parser time (BR-SOURCE-2), not here.

**Licence (Creative Commons)**
- `https://creativecommons.org/licenses/by-nd/3.0/` — CC BY-ND 3.0 deed. States: free to
  "Share — copy and redistribute the material in any medium or format for any purpose, even
  commercially"; restriction: "If you remix, transform, or build upon the material, you may not
  distribute the modified material." *Why it matters:* if this is the binding licence, commercial
  use is allowed but distributing a derivative is not — so whether an internal derived dataset
  counts as a prohibited "derivative" is the core question. *Open question:* Q1 (§ 12).
- `https://creativecommons.org/licenses/by-nc-nd/3.0/br/` — CC BY-NC-ND 3.0 Brasil deed. States:
  may copy/redistribute with attribution, but "Você não pode usar o material para fins comerciais"
  (no commercial use) and no distribution of derivatives. *Why it matters:* if the binding licence
  is this NC variant, SellUp's commercial internal use may be prohibited outright. *Open question:*
  which Creative Commons variant actually governs the dataset (Q1, § 3).

**LGPD / ANPD**
- `https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm` — Lei Geral de Proteção
  de Dados Pessoais (Lei 13.709/2018), official text. *Why it matters:* governs personal data
  (dado pessoal), including the MEI/EI name blur and CPF; relevant bases include legítimo interesse
  and the treatment of data made manifestly public by the data subject. *Open question:* the legal
  basis for handling MEI/EI names and for confirming the CPF/contact exclusions (§ 4 D/E, Q3, Q7).
- `https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_legitimo_interesse.pdf`
  — ANPD guidance on legítimo interesse as a legal basis. *Why it matters:* the Autoridade Nacional
  de Proteção de Dados is the interpretive authority; its guidance frames how legitimate interest
  may (or may not) support this use. *Open question:* whether SellUp's use qualifies under
  legítimo interesse or requires another basis (Legal/Privacy to decide).

**Non-official sources:** none used as a source of truth. Aggregator/mirror and third-party sites
that appeared in general search were deliberately **not** relied upon for licence or legal facts.

---

## 19. Appendix: handoff checklist for Legal/Privacy

To unblock BR-SOURCE-2, Legal/Privacy should record an explicit decision on each item:

- [ ] Confirm the **exact licence** shown on the official dataset metadata (BY-ND vs BY-NC-ND vs
      other) — Q1, § 3.
- [ ] Decide whether the licence permits SellUp's internal derived/enrichment use — Q1.
- [ ] If an NC variant applies, decide whether commercial internal use is permitted — Q1.
- [ ] Select **CNPJ treatment mode** A / B / C — Q2, § 7.
- [ ] Decide **MEI / EI**: include / exclude / mask — Q3, § 8.
- [ ] Decide **Simples / SIMEI** flags — Q4.
- [ ] Decide **address granularity** — Q5, § 4 G.
- [ ] Decide `capital_social` storage/use — Q6.
- [ ] Confirm **contact fields** stay prohibited (or define a separate basis) — Q7, § 9.
- [ ] Confirm **derived hashes / root grouping keys** may be persisted — Q8.
- [ ] Define **retention policy** for monthly snapshots — Q9.
- [ ] Define **access controls** — Q10, § 17.
- [ ] Define **report/log masking** requirements — Q11, § 11.
- [ ] Decide **future HubSpot sync** (separate approval) — Q12.
- [ ] Confirm **SOCIOS / CPF** remain blocked and require a separate milestone — § 10.

Once every item is decided, update § 2 flags and hand back to engineering to scope BR-SOURCE-2. No
build begins before then.

---

## Safety confirmation

This milestone is **docs-only**. It creates a branch and a single documentation file and opens a
docs-only PR. It does **not**: declare a legal GO; create a parser, connector, runtime change,
adapter/validator change, or migration; download or import any dataset; write to Supabase; perform
production writes; run a runner, dry-run, or execute; call providers, HubSpot, or Slack; perform
live generation or full expansion; or merge. No secrets, no massive data dumps, no real CNPJs, no
real CPFs, and no partner (sócio) personal data are reproduced. Legal/privacy GO remains `false`.
Local WIP (`scratchpad/`) is untouched by any git operation.
