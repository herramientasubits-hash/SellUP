# BR Receita CNPJ Legal and Privacy Handoff

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-LEGAL-1 — Legal/privacy handoff and decision capture for Brazil Receita CNPJ
**Status:** Handoff and decision-capture package — **not** a legal decision and **not** a build authorization
**Predecessor:** BR-LEGAL-0 — `BRLEGAL0LANDA — LEGAL_PRIVACY_REVIEW_PACKAGE_MERGED` ([review package](./br-receita-cnpj-legal-privacy-review.md))
**Upstream contract:** BR-SOURCE-1 — `BRSOURCE1LANDA — RECEITA_CNPJ_DATA_CONTRACT_MERGED` ([data contract](./br-receita-cnpj-data-contract.md))
**Pattern analog:** [EC SCVS Limited Expansion Policy](./ec-scvs-limited-expansion-policy.md) · [EC SCVS Operational Closeout](./ec-scvs-operational-closeout.md)
**Prepared:** 2026-07-27

---

## 1. Purpose

This document is a handoff and decision-capture package. It converts the BR-LEGAL-0 review
package into a practical, unambiguous decision request for Legal/Privacy, and defines exactly how
their answer is recorded and what it does (and does not) unblock.

> This document is a handoff and decision-capture package.
> It does not grant legal approval, privacy approval, parser authorization, import authorization,
> runtime authorization, or production use.

It builds directly on the identity-grain and data contract merged in BR-SOURCE-1
([`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)) and the review package
merged in BR-LEGAL-0
([`br-receita-cnpj-legal-privacy-review.md`](./br-receita-cnpj-legal-privacy-review.md)). It does
not change, reinterpret, or override any decision recorded in either document. Nothing here is a
legal opinion; every question below is for Legal/Privacy to answer.

This milestone does **not** decide anything legally, does **not** authorize a parser, and does
**not** authorize any download, import, runtime, or Supabase operation.

---

## 2. Current status

The default safe state holds until Legal/Privacy records an explicit decision (§ 17). All of the
following remain in their pre-decision state:

```
LEGAL_GO               = false
PRIVACY_GO             = false
CNPJ_TREATMENT_MODE    = undecided
PARSER_AUTHORIZED      = false
IMPORT_AUTHORIZED      = false
RUNTIME_AUTHORIZED     = false
HUBSPOT_SYNC_AUTHORIZED = false
```

- **Decided (upstream):** identity grain (establishment / full CNPJ, `TAX_GRAIN`),
  `record_identity_key = tax:<normalized_14>`, default field allowlist, default exclusions.
- **Open (routed to Legal/Privacy by this handoff):** licence usage, LGPD basis, CNPJ treatment
  mode, MEI/EI inclusion, Simples/SIMEI inclusion, address granularity, `capital_social` use,
  raw-data/logging policy, retention, access controls, contact-field basis, SOCIOS/CPF block, and
  future HubSpot sync.

---

## 3. What Legal/Privacy is being asked to decide

Legal/Privacy is asked to answer exactly these questions:

```
1.  Which license is binding for the official dataset metadata?
2.  Does the binding license allow SellUp's intended internal commercial enrichment use?
3.  Which CNPJ treatment mode is approved, if any?
4.  Can MEI/EI records be processed in MVP?
5.  Can Simples/SIMEI flags be processed in MVP?
6.  What address/location granularity is allowed?
7.  Can capital_social be stored and used for commercial scoring?
8.  Are contact fields prohibited or allowed under a separate basis?
9.  Is SOCIOS/QSA/CPF entirely blocked for MVP?
10. Can derived hashes/root grouping keys be persisted?
11. What retention policy applies to monthly snapshots?
12. What access controls and masking are required?
13. Can future HubSpot sync use this enriched data, or does it require a separate approval?
```

Each question maps to a decision area in §§ 7–15 and to a field in the decision-capture template
(§ 17).

---

## 4. Executive summary for reviewers

> SellUp wants to use the Receita Federal CNPJ open dataset as a Brazilian company registry source
> for internal prospect/account enrichment, deduplication, and grouping. The dataset appears
> valuable but raises licensing and LGPD/privacy questions. Until Legal/Privacy decides, no parser,
> import, runtime, HubSpot sync, or production use is allowed.

The single most load-bearing open item is the **licence ambiguity**: BR-SOURCE-1 recorded the
licence as CC BY-ND 3.0, but BR-LEGAL-0 surfaced a possible **CC BY-NC-ND 3.0 Brasil** variant. If
the NonCommercial (NC) variant is binding, SellUp's intended commercial internal use may be
prohibited outright, not merely constrained. Legal/Privacy must read the exact licence from the
official dataset metadata before any build decision.

---

## 5. Source and intended SellUp use

**Source (as documented officially — see § 22 and the upstream docs):** Receita Federal do Brasil —
CNPJ Dados Abertos (bulk), monthly refresh, public bulk download, no auth/contract.

**Proposed use (subject to approval; not yet authorized):**

```
Proposed use:
- internal source-catalog enrichment;
- prospect/account deduplication;
- commercial research support;
- grouping establishments by CNPJ root;
- no external publication;
- no resale of raw data;
- no automated outreach;
- no HubSpot sync unless separately approved.
```

The registral snapshot is an internal firmographic base only. It is never republished externally,
never resold, and is not a contact/outreach channel.

---

## 6. Key risks requiring decision

```
- license ambiguity: CC BY-ND vs possible CC BY-NC-ND Brasil;
- commercial use restriction risk;
- derivatives/transformation restriction risk;
- LGPD basis for identifiers and person-linked business records;
- MEI/EI name/person blur;
- contact fields inside ESTABELECIMENTOS;
- SOCIOS/QSA/CPF exposure;
- CNPJ full identifier storage;
- retention and access control;
- report/log leakage risk.
```

Each risk is converted into an explicit decision in the sections that follow. No risk here is
resolved by this document.

---

## 7. Decision area 1 — Dataset license

The binding licence determines whether any build is possible at all. It must be read from the
official dataset metadata (CKAN `license_id` / dataset page), not inferred from a rendered portal
page or third-party mirror.

```
LICENSE_DECISION = allowed | blocked | needs_external_permission | inconclusive
```

Criteria:

```
allowed:
  Legal confirms binding license allows intended internal commercial use and transformations.

blocked:
  Legal confirms license prohibits SellUp's intended use.

needs_external_permission:
  Use may be possible only with explicit permission/contract/authorization.

inconclusive:
  Legal cannot decide from available metadata.
```

Context for the decision:

- **CC BY-ND 3.0** — allows commercial redistribution of the *original* work; prohibits
  distributing *derivative/adapted* works. The open question is whether an internal derived dataset
  counts as a prohibited "derivative".
- **CC BY-NC-ND 3.0 Brasil** — prohibits **both** commercial use **and** derivative works. If this
  is the binding licence, SellUp's intended commercial internal use may be prohibited outright.

`LICENSE_DECISION = allowed` (or `needs_external_permission` with permission obtained) is a
precondition for BR-SOURCE-2 (§ 16).

---

## 8. Decision area 2 — CNPJ treatment mode

The CNPJ is the fiscal identifier and the identity key in the BR-SOURCE-1 contract. Legal/Privacy
must select **one** persistence mode:

```
Mode A — Full CNPJ allowed
  normalized_tax_id stores the normalized full CNPJ; record_identity_key = tax:<normalized_14>;
  strict masking in reports/logs; requires explicit Legal/Privacy GO and access controls.

Mode B — Hash-only
  normalized_tax_id remains null/restricted; record_identity_key uses a hash/opaque key derived
  from the CNPJ; fiscal matching by raw CNPJ is blocked; lower privacy exposure, lower dedup value.

Mode C — Hybrid restricted
  Full CNPJ available only inside restricted internal processing; persisted/reportable fields use a
  hash/mask; requires access controls and logging rules (§ 19).

Mode D — Not approved
  No CNPJ persistence of any kind is authorized.
```

```
No mode is approved yet.
```

Mode A, B, or C being selected is part of the minimum decision set (§ 16); `Mode D` (or no
selection) keeps `BR_SOURCE_2_AUTHORIZED = false`.

---

## 9. Decision area 3 — MEI / EI treatment

MEI (Microempreendedor Individual) and empresário individual (EI) records can behave as
natural-person data: `razao_social` is frequently the person's own name.

```
MEI_EI_DECISION = include | exclude | mask
```

Questions for Legal/Privacy:

- Can MEI/EI records be processed as company records?
- Should MEI/EI be excluded from the MVP entirely?
- Should MEI/EI legal names be masked or blocked because they may identify a natural person?

**Prudent recommendation (subject to Legal/Privacy):**

```
Exclude MEI/EI from MVP parser/import unless Legal/Privacy explicitly approves.
```

This interacts with the CNPJ mode (§ 8): for MEI/EI the CNPJ may be tied to a natural person.

---

## 10. Decision area 4 — Simples / SIMEI treatment

The SIMPLES file carries fiscal-regime flags (`opcao_simples`, `opcao_mei`) as booleans/codes.

```
SIMPLES_SIMEI_DECISION = allowed | excluded
```

Question for Legal/Privacy: may the Simples/SIMEI flags be stored and used as boolean/code
firmographic signals? Default safe state: excluded until confirmed.

---

## 11. Decision area 5 — Address and location granularity

BR-SOURCE-1 holds fine-grained street address out of the minimum set; only `municipio`/`uf` are
proposed.

```
ADDRESS_GRANULARITY_DECISION = coarse_only | fine_grained_allowed
```

- **coarse_only** — `municipio` (code) + `uf` only. Default safe state.
- **fine_grained_allowed** — `logradouro`, `numero`, `complemento`, `bairro`, `cep` permitted;
  requires an explicit, legally-reviewed need.

---

## 12. Decision area 6 — Capital social and scoring use

`capital_social` is a public company financial attribute in the EMPRESAS file.

```
CAPITAL_SOCIAL_DECISION = allowed | excluded
```

Question for Legal/Privacy: may `capital_social` be stored and used for internal commercial scoring?

---

## 13. Decision area 7 — Contact fields

`ESTABELECIMENTOS` may include phone/fax/email fields (`ddd_1`/`telefone_1`, `ddd_2`/`telefone_2`,
`ddd_fax`/`fax`, `correio_eletronico`).

```
CONTACT_FIELDS_DECISION = prohibited | separate_basis
```

- **prohibited** — excluded from the MVP source-catalog contract (default safe state). The registral
  snapshot must not become a contact source.
- **separate_basis** — any future use is a separate, independently-gated path with its own legal
  basis; still out of scope for BR-SOURCE-1 and this review.

---

## 14. Decision area 8 — SOCIOS / QSA / CPF

The `SOCIOS` / QSA file is the highest-risk file in the dataset (partner name + CPF, representante
legal name/CPF, faixa etária).

```
SOCIOS_QSA_CPF_DECISION = blocked | separate_milestone_required
```

Default safe state and prudent recommendation:

```
SOCIOS / QSA / CPF is blocked from MVP.
No parser/import/read path should process SOCIOS in BR-SOURCE-2.
A separate legal/privacy review is required before any future use.
```

This may not be folded into a parser/import approval for the registral (company) data.

---

## 15. Decision area 9 — HubSpot future sync

Enriched results are not synced to HubSpot under BR-SOURCE-1 or this review.

```
HUBSPOT_SYNC_DECISION = not_allowed | separate_approval_required
```

Question for Legal/Privacy: can enriched results be synced to HubSpot in the future, or does that
require a separate approval? Default safe state: not allowed here; any future sync is a separate,
independently-approved decision.

---

## 16. Minimum decision set required before BR-SOURCE-2

BR-SOURCE-2 may only begin if **all** of the following are satisfied by an explicit, recorded
Legal/Privacy decision:

```
LICENSE_DECISION = allowed OR needs_external_permission with permission obtained
LEGAL_GO = true
PRIVACY_GO = true
CNPJ_TREATMENT_MODE in [A, B, C]
MEI_EI_DECISION explicitly set
SIMPLES_SIMEI_DECISION explicitly set
ADDRESS_GRANULARITY_DECISION explicitly set
RAW_DATA_POLICY explicitly set
LOGGING_MASKING_POLICY explicitly set
```

If **any** item is missing:

```
BR_SOURCE_2_AUTHORIZED = false
```

A partial decision does not authorize a partial build. Even if all items above are satisfied, the
parser is still a separate, independently-authorized milestone (§ 18).

---

## 17. Decision capture template

Legal/Privacy records the decision by filling this template. An answer is only binding once every
field is set; blank fields keep the default safe state.

```
Reviewer:
Team:
Date:
Decision status:
LEGAL_GO:
PRIVACY_GO:
LICENSE_DECISION:
CNPJ_TREATMENT_MODE:
MEI_EI_DECISION:
SIMPLES_SIMEI_DECISION:
ADDRESS_GRANULARITY_DECISION:
CAPITAL_SOCIAL_DECISION:
CONTACT_FIELDS_DECISION:
SOCIOS_QSA_CPF_DECISION:
HUBSPOT_SYNC_DECISION:
RETENTION_POLICY:
ACCESS_CONTROL_REQUIREMENTS:
MASKING_REQUIREMENTS:
CONDITIONS:
EXPLICITLY_PROHIBITED_OPERATIONS:
BR_SOURCE_2_AUTHORIZED:
```

Capture rules (to avoid ambiguity):

- Every field must be set explicitly; "blank" is read as the default safe state, not as approval.
- `BR_SOURCE_2_AUTHORIZED = true` is only valid if the § 16 minimum decision set is fully satisfied.
- A reviewer name, team, and date are required for the decision to be treated as recorded.
- Conditions and prohibited operations are binding and carry forward into BR-SOURCE-2 scope.

---

## 18. Allowed outcomes and resulting flags

Legal/Privacy's answer resolves to exactly one outcome:

```
Outcome A — Approved for BR-SOURCE-2 design/build planning
Outcome B — Approved only in hash-only mode
Outcome C — Requires external permission before any build
Outcome D — Rejected / blocked
Outcome E — Inconclusive / more review needed
```

Resulting flags per outcome:

```
Outcome A (approved for planning):
  OPS_BR_LEGAL_GO = true
  OPS_BR_PRIVACY_GO = true
  OPS_BR_CNPJ_TREATMENT_MODE_DECIDED = true   (Mode A or C)
  OPS_BR_READY_FOR_PARSER = true only after the technical BR-SOURCE-2 prompt is authorized

Outcome B (hash-only):
  OPS_BR_LEGAL_GO = true
  OPS_BR_PRIVACY_GO = true
  OPS_BR_CNPJ_TREATMENT_MODE_DECIDED = true   (Mode B)
  OPS_BR_READY_FOR_PARSER = true only after the technical BR-SOURCE-2 prompt is authorized

Outcome C (needs external permission):
  OPS_BR_LEGAL_GO = false   (until permission obtained)
  OPS_BR_PRIVACY_GO = pending
  OPS_BR_CNPJ_TREATMENT_MODE_DECIDED = false
  OPS_BR_READY_FOR_PARSER = false

Outcome D (rejected / blocked):
  OPS_BR_LEGAL_GO = false
  OPS_BR_PRIVACY_GO = false
  OPS_BR_READY_FOR_PARSER = false

Outcome E (inconclusive):
  OPS_BR_LEGAL_GO = false
  OPS_BR_PRIVACY_GO = false
  OPS_BR_READY_FOR_PARSER = false
```

Important:

```
Even if Legal/Privacy approves, parser work still requires a separate implementation hito and
explicit user authorization.
```

---

## 19. If approved: mandatory technical controls

If (and only if) Legal/Privacy approves and a separate BR-SOURCE-2 build is later authorized, the
build must implement these controls. They are **not** implemented here — listed so Legal/Privacy can
see the controls that enforce their decisions:

```
- field allowlist parser;
- SOCIOS hard denylist;
- contact fields hard denylist unless separately approved;
- CNPJ/CNPJ-root masking helpers;
- sanitized logs;
- no full raw_data persistence;
- report hash12 only;
- sample-only dry-run before bulk;
- GB-scale streaming/chunking plan;
- restricted access if full CNPJ approved;
- retention enforcement;
- no HubSpot sync without separate approval.
```

---

## 20. If rejected: fallback path

```
If Receita CNPJ is blocked, SellUp should not build a parser/import path for this dataset.
Fallback options:
- keep Brazil as provider-only with warning;
- use non-sensitive provider metadata;
- evaluate PNCP only as complementary B2G signal;
- evaluate other sources through separate BR-SOURCE-0 style discovery.
```

None of the fallback options is authorized by this document; each would be its own scoped
milestone.

---

## 21. Non-approved operations

The following remain **not authorized** by this document (and were not authorized by BR-SOURCE-1 or
BR-LEGAL-0):

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
- full expansion;
- dataset download;
- production writes;
- runner / dry-run / execute;
- merge to any operational state.

---

## 22. References to official SellUp docs

- [`docs/source-catalog/br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md) —
  BR-SOURCE-1 identity-grain and data contract of record (grain, field allowlist, exclusions,
  blockers).
- [`docs/source-catalog/br-receita-cnpj-legal-privacy-review.md`](./br-receita-cnpj-legal-privacy-review.md)
  — BR-LEGAL-0 legal/privacy review package (data categories, CNPJ modes, questions, go/no-go
  matrix, evidence and official references).

Official / primary external references (licence, LGPD, dataset) are catalogued in § 18 of the
BR-LEGAL-0 review package and are not re-derived here.

---

## 23. Handoff message template

Ready-to-send message for Legal/Privacy (Spanish):

```
Hola equipo,

Estamos evaluando si SellUp puede usar el dataset público de Receita Federal CNPJ Dados Abertos
como fuente de enriquecimiento interno para Brasil.

Antes de construir parser, descargar datos o importar información, necesitamos su revisión sobre
licencia, LGPD y tratamiento de identificadores/datos potencialmente personales.

El paquete de revisión está documentado aquí:
- docs/source-catalog/br-receita-cnpj-legal-privacy-review.md
- docs/source-catalog/br-receita-cnpj-legal-privacy-handoff.md

Necesitamos que nos indiquen:
1. si el uso está permitido;
2. bajo qué condiciones;
3. qué modo de tratamiento de CNPJ aprobarían;
4. si MEI/EI, Simples/SIMEI, dirección, capital social o contactos pueden tratarse;
5. qué controles de masking, acceso, logging y retención son obligatorios.

Mientras no exista aprobación explícita, parser/import/runtime/HubSpot sync permanecen bloqueados.

Gracias.
```

---

## 24. Appendix: reviewer checklist

To unblock BR-SOURCE-2, Legal/Privacy should record an explicit decision on each item:

- [ ] Confirm the **exact licence** shown on the official dataset metadata (BY-ND vs BY-NC-ND vs
      other) — Q1, § 7.
- [ ] Decide whether the licence permits SellUp's internal derived/enrichment use — Q2, § 7.
- [ ] If an NC variant applies, decide whether commercial internal use is permitted — Q2, § 7.
- [ ] Select **CNPJ treatment mode** A / B / C (or D) — Q3, § 8.
- [ ] Decide **MEI / EI**: include / exclude / mask — Q4, § 9.
- [ ] Decide **Simples / SIMEI** flags — Q5, § 10.
- [ ] Decide **address granularity** — Q6, § 11.
- [ ] Decide `capital_social` storage/use — Q7, § 12.
- [ ] Confirm **contact fields** stay prohibited (or define a separate basis) — Q8, § 13.
- [ ] Confirm **SOCIOS / QSA / CPF** remain blocked and require a separate milestone — Q9, § 14.
- [ ] Confirm **derived hashes / root grouping keys** may be persisted — Q10.
- [ ] Define **retention policy** for monthly snapshots — Q11.
- [ ] Define **access controls** and **report/log masking** requirements — Q12, § 19.
- [ ] Decide **future HubSpot sync** (separate approval) — Q13, § 15.
- [ ] Fill and sign the **decision-capture template** (§ 17); set `BR_SOURCE_2_AUTHORIZED` only if
      § 16 is fully satisfied.

Once every item is decided, update § 2 flags and hand back to engineering to scope BR-SOURCE-2. No
build begins before then.

---

## Safety confirmation

This milestone is **docs-only**. It creates a branch and a single documentation file and opens a
docs-only PR. It does **not**: declare a legal GO; declare a privacy GO; select a CNPJ treatment
mode; create a parser, connector, runtime change, adapter/validator change, or migration; download
or import any dataset; write to Supabase; perform production writes; run a runner, dry-run, or
execute; call providers, HubSpot, or Slack; perform live generation or full expansion; or merge. No
secrets, no massive data dumps, no real CNPJs, no real CPFs, and no partner (sócio) personal data
are reproduced. Legal GO and Privacy GO remain `false`; no CNPJ mode is selected. Local WIP
(`scratchpad/`) is untouched by any git operation.
