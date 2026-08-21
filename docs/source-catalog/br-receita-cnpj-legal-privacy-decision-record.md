# BR Receita CNPJ Legal and Privacy Decision Record

> **Milestone:** BR-LEGAL-2
> **Status:** Decision recorded (docs-only). No implementation.
> **Base documents:**
> `docs/source-catalog/br-receita-cnpj-data-contract.md` (BR-SOURCE-1),
> `docs/source-catalog/br-receita-cnpj-legal-privacy-review.md` (BR-LEGAL-0),
> `docs/source-catalog/br-receita-cnpj-legal-privacy-handoff.md` (BR-LEGAL-1).

---

## 1. Purpose

This document records the Legal/Privacy decision received for Brazil Receita CNPJ. It does not
implement parser, import, runtime, Supabase writes, HubSpot sync, or production use.

It exists so that the next technical milestone (BR-SOURCE-2) has a formal, auditable record that
Legal/Privacy authorized *development* to proceed — while making explicit that the first technical
milestone must remain conservative and separately authorized.

---

## 2. Decision source

Decision received through project owner/user relay.

Legal/Privacy gave general green light to proceed with development.

No raw Legal/Privacy email content, personal data, or confidential legal advice is included in this
repository document. This record captures only the operational outcome (the flags below) and the
scope boundaries that follow from it.

---

## 3. Decision summary

| Flag | Value |
|------|-------|
| `LEGAL_GO` | `true` |
| `PRIVACY_GO` | `true` |
| `LICENSE_DECISION` | `allowed` |
| `BR_SOURCE_2_AUTHORIZED` | `true` |

Legal/Privacy approved advancing to development. Product/architecture retains responsibility for a
conservative MVP scope (§ 6, § 8).

---

## 4. Approved flags

```
OPS_BR_LEGAL_GO                 = true
OPS_BR_PRIVACY_GO               = true
OPS_BR_LICENSE_DECISION_ALLOWED = true
OPS_BR_SOURCE_2_AUTHORIZED      = true
```

---

## 5. Development authorization

BR-SOURCE-2 may begin as a separate technical milestone focused on parser design/build planning and
controlled implementation.

Even with Legal/Privacy approval, BR-SOURCE-2 requires a separate prompt, separate branch, separate
PR, and explicit user authorization. This decision record does **not** itself start, plan, or
implement BR-SOURCE-2; it only removes the legal/privacy blocker that previously held it closed.

---

## 6. Scope boundary for BR-SOURCE-2

The first technical milestone must be conservative. BR-SOURCE-2 must observe the following
boundaries in its initial scope:

- local/sample parser first;
- field allowlist;
- no massive import;
- no production writes;
- no Supabase mutation;
- no HubSpot sync;
- no runtime live;
- no Agent 1 live integration;
- no full expansion.

---

## 7. Data treatment interpretation

Recorded as the initial operational decision:

`CNPJ_TREATMENT_MODE = Mode A` — allowed for technical design, subject to masking/logging/access
controls.

Clarification:

Mode A allowed does not mean full CNPJ may appear in logs, reports, screenshots, PRs, or UI by
default. Full CNPJ handling remains gated behind the masking, logging, and access controls listed in
§ 10, and reports/logs must use masked or hashed identifiers (see § 8, § 10).

---

## 8. MVP implementation constraints

Although Legal/Privacy gave a general green light, the MVP parser must still enforce:

- SOCIOS/QSA/CPF excluded from BR-SOURCE-2 parser;
- contact fields excluded from BR-SOURCE-2 parser;
- `raw_data` sanitized allowlist only;
- no full row dump;
- masking required;
- hash12 or masked identifiers in reports;
- MEI/EI allowed only if the parser can handle masking and classification safely;
- Simples/SIMEI can be considered but must be explicit in the parser allowlist;
- address granularity should start at municipality/UF unless a later hito expands it.

---

## 9. Still non-approved operations

The following remain **not approved** by this decision record and require their own separately
authorized milestones:

- production import;
- Supabase write/import;
- runtime enrichment;
- Agent 1 live integration;
- HubSpot sync;
- Slack notifications;
- provider calls;
- full expansion;
- SOCIOS/QSA/CPF processing;
- contact enrichment from Receita fields.

---

## 10. Required controls for implementation

BR-SOURCE-2 implementation must include:

- CNPJ alphanumeric normalization;
- CNPJ DV validation;
- field allowlist;
- source file denylist for SOCIOS;
- contact field denylist;
- sanitized logger;
- no secrets or identifiers in logs;
- masking helper;
- report hash12;
- sample-only tests before import;
- GB-scale streaming plan before production import.

---

## 11. Resulting operational flags

```
OPS_BR_LEGAL_PRIVACY_DECISION_RECORDED = true
OPS_BR_LEGAL_GO                        = true
OPS_BR_PRIVACY_GO                      = true
OPS_BR_LICENSE_DECISION_ALLOWED        = true
OPS_BR_CNPJ_TREATMENT_MODE_DECIDED     = true
OPS_BR_CNPJ_TREATMENT_MODE             = A
OPS_BR_SOURCE_2_AUTHORIZED             = true
OPS_BR_READY_FOR_PARSER_DESIGN         = true
OPS_BR_READY_FOR_LOCAL_SAMPLE_PARSER   = true
OPS_BR_READY_FOR_IMPORT                = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT     = false
OPS_BR_READY_FOR_RUNTIME               = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY  = false
```

---

## 12. Next authorized milestone

Next milestone: BR-SOURCE-2 — Receita CNPJ local/sample parser design and controlled
implementation.

BR-SOURCE-2 must not perform production import or runtime integration.

---

## 13. Safety confirmation

This milestone is documentation only. It does **not**:

- implement a parser;
- create a connector or runtime change;
- create or run a migration;
- download or import any dataset;
- perform production writes;
- mutate Supabase;
- run a runner, dry-run, or execute;
- call providers, HubSpot, or Slack;
- perform live generation or full expansion;
- dump CNPJ/CPF/person data;
- include secrets.

No merge is performed by this milestone.

---

## 14. GATE-1 legal/privacy determination (2026-08-21)

> **Update (BR-SOURCE-GATE1-RECORD).** This section records the legal/privacy determination that
> 10K § 5 names as a GATE-1 *Expected artifact*. The matching § 14 approval entry lives in
> [`br-receita-cnpj-gate1-owner-approval-record.md`](./br-receita-cnpj-gate1-owner-approval-record.md),
> per 10K § 14's rule that an approval is recorded in that shape and never inside a design or
> review record.

**Determination.** The human legal/privacy owner reviewed the Brazil / Receita scope and decided
that **development may continue**, on the basis that legal/privacy coverage is considered satisfied.

```text
GATE1_STATUS                    = approved
Approver                        = legal/privacy owner   (role only — 10K § 14)
Approval date                   = 2026-08-21
Granularity of the decision     = whole scope, not per-confirmation
LICENCE_METADATA_HISTORY        = CONFLICTING_OFFICIAL_METADATA
LEGAL_PRIVACY_OWNER_DISPOSITION = accepted_for_continuation_of_development
LICENCE_RESOLVED_BY_AGENT       = false
```

**Relationship to BR-LEGAL-2 above.** § 3 of this record already carried a legal/privacy green light
for *development* at the BR-SOURCE-2 level, with `LICENSE_DECISION = allowed`. That determination is
unchanged and is not restated, strengthened or re-derived here. GATE-1 is the narrower, later
decision defined by 10K § 5 — legal/privacy approval for the **full local join dry-run** — and this
section records that it is now `approved`. The § 11 operational flags above are unchanged: GATE-1
flips no operational flag (10K § 5, *Relation to flags*).

**Licence.** The historical conflict recorded in BR-LEGAL-0 § 3 and BR-LEGAL-1 § 7 — CC BY-ND 3.0
on one official surface, a possible CC BY-NC-ND 3.0 Brasil variant on another — is **preserved
unchanged and not reopened**. What the owner supplied is a disposition over that evidence, not a
resolution of it. No agent determined which licence governs.

**Restrictions.** Enumerated in full in the § 14 approval record, § 2. In summary form only for
navigation — the enumerated list is authoritative: no socios, no QSA, no CPF, no explicitly
person-linked Receita family, no automatic production enablement, no Supabase/import authorization
implied, no Agent 1 Brazil enablement implied, no provider write implied, downstream gates
independently required, privacy/sanitization controls mandatory, downstream persistence/output must
satisfy its own gates.

**What stays non-approved.** Everything in § 9 above stays non-approved, and GATE-2 … GATE-8 plus
the cap/input policy all remain `not_started`. This determination retroactively approves no prior
execution, modifies no historical audit record, and resets no benchmark attempt budget
(`ATTEMPT_3_ALLOWED` stays `false`, with no reset path).
