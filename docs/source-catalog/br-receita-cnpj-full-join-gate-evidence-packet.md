# BR-SOURCE-10L — Receita CNPJ full join dry-run gate evidence packet

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10L — Receita CNPJ full join dry-run gate evidence packet
**Status:** Official evidence packet of record (docs-only) — **not** a gate approval, and **not** a build/import/dry-run/execution authorization
**Predecessor:** BR-SOURCE-10K — `BRSOURCE10KLANDA — FULL_JOIN_APPROVAL_GATES_CHECKLIST_MERGED` (PR #154, `main` HEAD `7d90dce74167d036faaf9c8adbb831e6bd526443`)
**Last reviewed:** 2026-07-29

**Related documents:**
- Full join field allowlist decision record (GATE-3 proposal) — [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join import-readiness design (contract) — [`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md)
- Privacy-safe import eligibility design — [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)
- Import & staging persistence contract — [`br-receita-cnpj-import-staging-contract.md`](./br-receita-cnpj-import-staging-contract.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Identity grain & data contract — [`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)
- Legal/privacy review package — [`br-receita-cnpj-legal-privacy-review.md`](./br-receita-cnpj-legal-privacy-review.md)

> This document is an **evidence packet of record**. It collects, orders, and maps the evidence that
> GATE-1 … GATE-8 (defined in BR-SOURCE-10I § 9, mapped in BR-SOURCE-10J § 13, made approvable in
> BR-SOURCE-10K) already have, and the evidence they are still missing. It **approves no gate**, it
> moves no gate to `approved`, and it changes nothing about what is allowed today. Nothing here
> authorizes — and nothing here should be read as authorizing — a runner, script, package change,
> migration, dataset download, full-dataset processing, full join execution, import, Supabase write,
> production write, runtime change, adapter/validator change, provider call, HubSpot sync, Slack
> notification, live generation, full expansion, or merge to an operational state.
> **This document maps evidence; it approves none of it.**

---

## 1. Purpose

BR-SOURCE-10K made the gates *approvable*: it defined, per gate, the required evidence, the approver
role, the pass / fail criteria, the expected artifacts, and the narrow next step each approval
unlocks. What it deliberately did not do is **look at what evidence already exists**. As a result the
practical question — "how far is each gate from being reviewable at all?" — has no recorded answer,
and the risk is that the answer gets improvised: an approver could be handed a design document and a
verbal assurance, and a gate could drift toward `approved` on material nobody inventoried.

BR-SOURCE-10L supplies that inventory. Per gate, it records:

- **evidence already available** — what exists today, in which official document, at which section;
- **evidence missing** — what does not exist in recorded form and therefore cannot be reviewed;
- **the owner / approver role** the missing evidence has to come from or go to;
- **the gate's NO-GO status today**;
- **the pending decision** that blocks the gate;
- **the artifacts** that would be needed to reach `ready_for_review`;
- **what this packet does not approve**.

This document does **not**:

- implement code, a runner, or a script;
- modify code, scripts, or package manifests;
- execute a full join;
- process the full or real dataset;
- import data;
- write to Supabase;
- create or modify a migration;
- connect the runtime;
- connect Agent 1;
- touch HubSpot / Slack / providers / UI;
- **approve any gate**, move any gate to `approved`, or substitute for any named approver;
- grant legal or privacy approval;
- authorize a future full join dry-run;
- mark Brazil ready for anything.

If, at any point, this milestone concluded that it required code, scripts, package changes,
migrations, real execution, or a real gate approval to proceed, the correct action is to **stop and
escalate**, reporting `BRSOURCE10L_SCOPE_ESCALATION_CODE_OR_APPROVAL_NOT_ALLOWED`. This document
reaches no such conclusion: an evidence inventory is fully expressible in prose, and every gate can
be described as unapproved without approving it.

---

## 2. Current official baseline

The company-discovery / eligibility / readiness / approval line for Receita CNPJ is official and
merged as follows (design and governance of record; none is an operational authorization):

- **BR-SOURCE-10E — privacy-safe bounded dry-run classifier is official.** Reads a bounded sample
  and turns anti-PII findings into per-record eligibility **counts** (aggregate only); authorizes no
  import ([eligibility design § 10.1](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10F — eligibility & legal-nature calibration is official.** Reference lookups →
  `not_applicable_lookup`; establishments in isolation → `pending_company_join_context`; MEI /
  empresário individual excluded by default; legal nature is a **classification signal, not an import
  authorization** ([§ 10.2](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
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
- **BR-SOURCE-10J — full join dry-run technical design is official.** Lowers the 10I contract into an
  executable-in-the-future design: execution model, architecture options A/B/C, temporary storage
  envelope, join-key handling, field discard timing, cleanup contract, resource limits, future CLI
  and aggregate report contracts, and the GATE-1 … GATE-8 → decision mapping. Decides no grain;
  authorizes no execution
  ([full join technical design](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **BR-SOURCE-10K — full join approval gates checklist is official.** Turns the eight gates into a
  formal, approvable checklist (required evidence, approver role, pass / fail criteria, expected
  artifacts, governed flag, allows / does-not-allow), plus a gate status model, a dependency graph,
  an approval-evidence template (§ 14), and a GO / NO-GO matrix. **Approves no gate**: all eight
  remain `not_started`
  ([approval gates checklist](./br-receita-cnpj-full-join-approval-gates-checklist.md)).

Flag state carried into this document, unchanged:

```
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL         = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL          = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                     = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL         = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL       = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL    = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL               = true
```

Brazil stays non-operational. Carried forward, unchanged:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false
```

---

## 3. Evidence packet status model

This packet needs its own vocabulary, because "how complete is the evidence" and "what is the gate's
status" are different questions. Conflating them is precisely how a gate drifts toward approval on
unreviewed material. The gate status model stays the one defined in the 10K checklist § 3
(`not_started` / `needs_evidence` / `ready_for_review` / `approved` / `rejected` / `blocked` /
`superseded`). The **evidence packet status** below is additional, parallel, and non-authoritative:

```
evidence_not_collected      nothing relevant has been gathered or located
partial_evidence_collected  some required evidence exists in recorded form; at least one item is missing
evidence_complete_for_review  every item the 10K checklist requires for this gate exists in recorded form
evidence_rejected_by_owner  the named owner reviewed the packet and refused the evidence as insufficient
blocked_by_missing_owner    no approver role is identified, or the only candidate is also the implementer
blocked_by_scope_conflict   the evidence cannot be completed without code, execution, or a widened scope
```

Rules governing these statuses:

- **These statuses are not gate approvals.** A gate's status comes only from the 10K § 3 model, and
  only the named approver may set it.
- **`evidence_complete_for_review` is not `ready_for_review`.** It means the packet *could* be
  submitted; the submission and the approver's acceptance are separate, recorded acts.
- **No gate becomes `approved` by this document**, under any status combination here.
- **A gate may hold partial — even complete — evidence and remain NO-GO.** Evidence completeness and
  approval are orthogonal.
- **A gate whose evidence is complete but unreviewed is still `not_started`** in the 10K model until
  the approver records otherwise.
- **Any sensitive leak resets the affected gate's evidence to `evidence_not_collected`**, mirroring
  the 10K § 4 rule that a leak invalidates the evidence that preceded it.
- **Formal approval is recorded with the 10K § 14 template**, never here. An approval recorded in
  this document does not exist.
- **A design document is evidence of a design, never evidence of an approval.** The existence of
  10I / 10J / 10K satisfies no gate.

---

## 4. Global evidence inventory

Scannable state of all eight gates as of this document. Every gate is unapproved, and every gate is
NO-GO.

| Gate | Subject | Gate official status today | Evidence packet status | Owner / approver needed | Current blocker |
|------|---------|----------------------------|------------------------|-------------------------|-----------------|
| GATE-1 | Legal/privacy approval for full local join dry-run | `not_started` — not approved | `partial_evidence_collected` | Legal/privacy owner (not an implementer, not the design author) | No legal/privacy determination exists for full local processing; licence variant unresolved |
| GATE-2 | Temporary storage envelope | `not_started` — not approved | `partial_evidence_collected` | Technical owner **and** privacy owner, jointly | No architecture option chosen; every numeric ceiling is still a placeholder |
| GATE-3 | Field allowlist | `not_started` — not approved | `partial_evidence_collected` | Product / data owner **and** legal/privacy owner, jointly | Six open legal/privacy questions unresolved; no versioned allowlist exists |
| GATE-4 | Identity grain | `not_started` — not approved | `partial_evidence_collected` | Data architecture owner **and** product owner, jointly | No choice among A / B / C / D; physical unique-index situation unreconciled |
| GATE-5 | Output sanitization contract | `not_started` — not approved | `partial_evidence_collected` | Security / privacy owner **and** test owner, jointly | Report schema cannot be frozen while GATE-3 and GATE-4 are open |
| GATE-6 | Failure cleanup contract | `not_started` — not approved | `partial_evidence_collected` | Technical owner **and** operator owner, jointly | Per-failure-type cleanup matrix does not exist; depends on GATE-2 |
| GATE-7 | Operator runbook | `not_started` — not approved | `partial_evidence_collected` | Operator owner, technical owner, and privacy owner, jointly | No full-join operator procedure exists; depends on GATE-2 / 5 / 6 |
| GATE-8 | No-write / no-runtime guarantee | `not_started` — not approved | `partial_evidence_collected` | Repo safety owner **and** technical owner, jointly | Guard design and no-write proof exist only as prose intent, not as an enforceable contract with tests |

### What the evidence base consists of today

Across all eight gates, the available evidence is of exactly three kinds:

- **Official design documents** — 10I (envelope, join-key treatment, field survival, identity gate,
  gate list), 10J (execution model, architecture options, storage envelope, discard timing, cleanup,
  limits, CLI, report schema, assertions, runbook requirements), 10K (per-gate approval criteria).
- **Official bounded-run results** — 10E / 10F / 10G / 10H aggregate outcomes, with
  `coverage_is_representative = false` throughout.
- **Prior legal/privacy artifacts** — the BR-LEGAL-0 review package, the BR-LEGAL-1 handoff, and the
  BR-LEGAL-2 decision record (`LEGAL_GO`, `PRIVACY_GO`, `LICENSE_DECISION = allowed`,
  `CNPJ_TREATMENT_MODE = A`, `BR_SOURCE_2_AUTHORIZED = true`).

### What the evidence base does not contain

- **No approval of any kind for a full join dry-run.** The BR-LEGAL-2 GO is scoped to *development*
  of a conservative local/sample parser (decision record § 5, § 6). It predates the full-join
  question entirely and may not be cited as GATE-1 evidence of approval.
- **No numeric measurement.** Every resource ceiling in 10J § 10 is
  `TBD_BY_GATE_2_STORAGE_ENVELOPE`; no measurement has been taken.
- **No frozen contract.** `field_allowlist_version`, `record_identity_grain_decision`, and
  `temporary_storage_mode` are all still `not_approved` / `not_decided` markers (10J § 12).
- **No tests.** No sanitization, cleanup, or no-write assertion suite exists; 10J § 15 lists the
  assertions a future implementation *must* ship, not assertions that exist.
- **No operator procedure.** The runbook covers manual download, local prep, manifest validation,
  and the bounded dry-runs; it contains no full-join procedure (GATE-7 governs that gap).

### What this inventory allows today

- Reading, reviewing, and criticizing the mapped evidence.
- Preparing per-gate submissions for the named approvers, as a **future** docs-only act.
- Identifying which decision to resolve next (§ 18).

### What this inventory does NOT allow today — uniformly, for every gate

- Approving any gate, or treating any status here as an approval.
- Writing, scaffolding, or stubbing any full-join runner code — including behind a disabled flag.
- Executing a full join, or any run over the full or real dataset.
- Downloading or importing a dataset.
- Writing to Supabase, creating or modifying a migration, or persisting any row.
- Connecting the runtime or Agent 1; calling any provider; touching HubSpot, Slack, or UI.
- Printing, persisting, hashing, truncating, or fingerprinting a full CNPJ, a CNPJ básico / join key,
  a CPF, a legal or trade name, an address, or a contact value.
- Treating Brazil as ready for import, production import, runtime, or live generation.

---

## 5. GATE-1 evidence packet — Legal/privacy approval for a full local join dry-run

**Governs:** whether a full local dry-run may exist at all (10J § 13). Without it, nothing runs.

### Evidence already available

- **Source classification and licence documentation** — dataset owner, portal, layout authority,
  public bulk access, monthly refresh, and the licence question stated explicitly
  ([legal/privacy review § 3](./br-receita-cnpj-legal-privacy-review.md)).
- **Data-category inventory with default states** — registration data permitted, contact fields
  excluded, SOCIOS / QSA / CPF blocked, MEI / EI flagged, coarse address only
  ([legal/privacy review § 4](./br-receita-cnpj-legal-privacy-review.md)).
- **A recorded legal/privacy decision for development** — `LEGAL_GO = true`, `PRIVACY_GO = true`,
  `LICENSE_DECISION = allowed`, `CNPJ_TREATMENT_MODE = A`, `BR_SOURCE_2_AUTHORIZED = true`, with an
  explicit list of still-non-approved operations
  ([decision record § 3, § 4, § 9, § 11](./br-receita-cnpj-legal-privacy-decision-record.md)).
- **Privacy-safe eligibility design** — excluded records, persistible-field contract, prohibited
  fields, classification statuses, guard rules, aggregate-only reporting
  ([eligibility design § 4–§ 9](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **Classifier privacy behaviour, proven on bounded runs** — the anti-PII guard fires on real data
  and blocks the dry-run rather than degrading it
  ([eligibility design § 10.1](./br-receita-cnpj-privacy-safe-import-eligibility-design.md);
  [runbook § 12](./br-receita-cnpj-manual-download-local-prep-runbook.md)).
- **MEI / empresário individual / natural-person-risk exclusion by default**
  ([eligibility design § 10.2](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **SOCIOS / QSA / CPF categorical out-of-scope decision**, enforced by file-family name before any
  read ([staging contract § 15](./br-receita-cnpj-import-staging-contract.md);
  [10J § 8.1](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **No-import / no-Supabase / no-runtime guarantees stated in design** — repeated across
  [10I § 4, § 11](./br-receita-cnpj-full-join-import-readiness-design.md) and
  [10J § 11, § 12, § 18](./br-receita-cnpj-full-join-dry-run-technical-design.md).

### Evidence missing

- **An explicit legal/privacy owner approval for a full local join dry-run.** None exists. The
  BR-LEGAL-2 GO is scoped to development of a conservative local/sample parser and predates the
  full-join question; it is evidence of a *prior, narrower* decision, not of this one.
- **A documented LGPD basis for full local processing** — processing (not persisting) the whole
  `empresas` + `estabelecimentos` families locally.
- **An explicit acceptance or rejection of `full_dataset_processed = true` for a dry-run only**
  (10J § 12, § 17 last item).
- **An explicit confirmation that CNPJ básico / root may exist in temporary technical processing**,
  and under which conditions — the design asserts it, no approver has confirmed it.
- **An explicit confirmation of full-CNPJ handling** in a full-join context, reconciled with
  `CNPJ_TREATMENT_MODE = A` (decision record § 7) and with the categorical non-printability rule
  (10I § 5 / 10J § 7).
- **An explicit confirmation of `normalized_tax_id` survival** (eligibility design § 11 #1 — still
  open).
- **An explicit confirmation of sanitized legal-name / trade-name survival** (eligibility design
  § 5, § 11).
- **A CC BY-ND / Receita licence interpretation for this specific use.** The review package records
  the licence as **unresolved and load-bearing**: BR-SOURCE-1 recorded a NoDerivatives variant, while
  a NonCommercial-NoDerivatives Brazilian variant also surfaced, and the two differ materially for
  SellUp's commercial internal use ([legal/privacy review § 3, § 12 #1, § 13](./br-receita-cnpj-legal-privacy-review.md)).
  BR-LEGAL-2 recorded `LICENSE_DECISION = allowed` without recording *which variant* was read from
  the official metadata. That reconciliation is missing evidence for GATE-1, not a settled matter.
- **A production-scope legal review beyond the BR-LEGAL-2 GO** (eligibility design § 11 #6).

### Evidence reconciliation flagged for the approver

Two prior artifacts need explicit reconciliation *by the approver*, and neither is reconciled here:

- **Masked / hashed identifiers in reports.** The decision record § 8 contemplates "hash12 or masked
  identifiers in reports"; 10I § 5 and 10J § 7 / § 8.5 prohibit **any** hash, truncation, or
  fingerprint derived from the join key or an identifier anywhere in output. The later documents are
  strictly narrower, and the full-join report is aggregate-only — but the approver must say so
  explicitly rather than leaving two documents in apparent tension.
- **`CNPJ_TREATMENT_MODE = A`.** Mode A is recorded as "allowed for technical design, subject to
  masking / logging / access controls" (decision record § 7), which is a *persistence-and-design*
  statement. It is not, and must not be read as, permission to print a full CNPJ or a CNPJ básico in
  a report, a log, or an error.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

Whether a full local dry-run over the whole dataset is legally and privacy-permissible at all, on a
recorded basis, with the licence variant confirmed from the official source metadata.

### Artifacts required to reach `ready_for_review`

- A legal/privacy determination for the full local join dry-run, recorded in the
  [legal/privacy decision record](./br-receita-cnpj-legal-privacy-decision-record.md), enumerating
  its restrictions rather than summarizing them, and separating dry-run scope from import scope in
  writing.
- A recorded licence-variant confirmation read from the dataset's own official metadata.
- A 10K § 14 approval entry for GATE-1, prepared for — never by — the approver.

### Not approved by this packet

Nothing. This packet grants no legal or privacy approval, and cannot: only the named legal/privacy
owner can, and only outside this document.

---

## 6. GATE-2 evidence packet — Temporary storage envelope

**Governs:** 10J § 6 (temporary storage) and § 10 (memory / disk / temp-index limits); decides
whether Option C (a temporary on-disk index) is permitted at all.

### Evidence already available

- **Three architecture options, compared with pros and cons** — Option A pure in-memory map,
  Option B streaming two-pass scan, Option C temporary local encrypted / discardable index
  ([10J § 5](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **A recommended conservative path** — streaming-first (Option B), Option A where the key-set
  genuinely fits in memory, Option C as a last resort permitted only under an explicit GATE-2
  approval ([10J § 5](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **A temporary storage envelope design** — local folder outside the repository, controlled fixed
  name, no cloud sync, never committed, owner-only permissions, short TTL, guaranteed cleanup, no
  sensitive paths in logs, no join keys in file names, encrypted-at-rest if it holds a structural key
  ([10J § 6](./br-receita-cnpj-full-join-dry-run-technical-design.md); restating
  [10I § 4](./br-receita-cnpj-full-join-import-readiness-design.md)).
- **Cleanup requirements** — destruction on completion **and** on failure, with `cleanup failed` as a
  terminal state ([10J § 9](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **No-repo / no-cloud-sync requirements**, and the bright line
  `temporary technical artifact ≠ approved persisted source data`
  ([10J § 6](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **An existing local-folder convention** for operator-prepared files outside the repository
  ([runbook § 4](./br-receita-cnpj-manual-download-local-prep-runbook.md)).
- **One absolute invariant already fixed, independent of any gate** — `zero raw-value logs`
  ([10J § 10](./br-receita-cnpj-full-join-dry-run-technical-design.md)).

### Evidence missing

- **The final choice** among streaming-only, in-memory, and a temporary encrypted index — with the
  two rejected options named as not-approved.
- **A numeric memory ceiling** (today `TBD_BY_GATE_2_STORAGE_ENVELOPE`).
- **A numeric disk ceiling** for temporary material (today a placeholder).
- **A numeric runtime-duration ceiling**, plus the max-input-files, max-validation-bytes,
  max-report-size, and max-log-size ceilings — all placeholders today.
- **A measurement** the ceilings are set against. Every placeholder is an explicit deferral to a real
  measurement rather than a guess, and no measurement exists. Obtaining one may itself require a
  separately-approved bounded exercise; this packet requests none.
- **An approved local root path** for temporary material.
- **An approved TTL** for temporary material.
- **An approved permission model** (owner-only read/write, confirmed).
- **An encryption-at-rest decision** for the case where technical keys materialize on disk.
- **A cleanup verification mechanism** — how destruction is *verified*, not merely intended.
- **A cleanup-failure owner decision** — who is notified, and what the operator does next.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

Which storage architecture is permitted, and with which concrete numeric ceilings. Until one option
is chosen and every placeholder carries a number, `temporary_storage_mode` stays `"not_approved"`
(10J § 12).

### Artifacts required to reach `ready_for_review`

- A recorded storage-envelope decision: chosen option, rejected options, local path, numeric
  ceilings, TTL, permissions, cleanup procedure, cleanup-failure handling.
- The numeric values that replace every `TBD_BY_GATE_2_STORAGE_ENVELOPE` placeholder in 10J § 10.
- A 10K § 14 approval entry for GATE-2, prepared for the joint approvers.

### Not approved by this packet

No storage option, no path, no ceiling, no TTL, and no temporary material of any kind. Option C
remains not permitted.

---

## 7. GATE-3 evidence packet — Field allowlist

**Governs:** freezes 10J § 8.3 / § 8.4 — which signals survive the join and which counts the report
may carry; sets `field_allowlist_version`.

### Evidence already available

- **A prohibited-fields contract, stated as a closed set** — CPF and any natural-person identifier,
  sócios / QSA / person data, emails, telephone / fax / DDD, fine-grained address, raw rows,
  unfiltered blobs, full CNPJ, CNPJ básico, non-allowlisted free text, and any hash derived from an
  identifier or the join key
  ([10I § 6.1](./br-receita-cnpj-full-join-import-readiness-design.md);
  [10J § 8.1, § 8.5](./br-receita-cnpj-full-join-dry-run-technical-design.md);
  [eligibility design § 6](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **A conceptual candidate list of future persistible fields**, explicitly marked as a target and not
  an authorization ([10I § 6.3](./br-receita-cnpj-full-join-import-readiness-design.md); restating
  [eligibility design § 5](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **A temporary technical-only field category** with an explicit discard time
  ([10I § 6.2](./br-receita-cnpj-full-join-import-readiness-design.md);
  [10J § 8.2](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **A post-join classification-signal category** — legal nature, CNAE, coarse municipality / UF,
  registration status, opening date, porte, and capital social "only if a future policy allows"
  ([10J § 8.3](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **The six open legal/privacy questions**, already enumerated and unresolved
  ([eligibility design § 11](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **A `raw_data` discipline precedent** — sanitized typed allowlist only, never a raw row, with the
  EC SCVS build-from-allowlist-and-drop-extras rule as the proven pattern
  ([staging contract § 5, § 6](./br-receita-cnpj-import-staging-contract.md)).
- **A free-text fail-closed rule** — not on the allowlist means excluded
  ([10I § 6.1](./br-receita-cnpj-full-join-import-readiness-design.md);
  [10K § 7](./br-receita-cnpj-full-join-approval-gates-checklist.md)).

### Evidence missing

- **An approved, versioned field allowlist.** No `field_allowlist_version` identifier has been
  assigned; the report marker is still `"not_approved"` (10J § 12).
- **A final decision on `normalized_tax_id`** (eligibility design § 11 #1).
- **A final decision on sanitized `legal_name`** (razão social).
- **A final decision on sanitized `trade_name`** (nome fantasia).
- **A final decision on `capital_social_value`** (legal/privacy review § 12 #6).
- **Final decisions on the CNAE fields** — principal code / label, and secondary codes.
- **A final decision on municipality / UF granularity** — coarse is the default safe state; it is
  not a recorded approval (legal/privacy review § 13; eligibility design § 11 #4).
- **Final decisions on registration status, `opened_at` / start date, and company size (porte)**.
- **A decision between a minimal typed `raw_data` object and `raw_data` prohibited outright**
  (eligibility design § 11 #5). Never an unfiltered blob, in either case.
- **An approved denylist**, restating the prohibitions as a closed, frozen set with a version.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

Which fields survive a join, as a closed and versioned pair of lists. Six unresolved legal/privacy
questions sit upstream of that decision, and at least four of them (full-CNPJ persistence, address
granularity, minimal `raw_data`, capital social) map directly onto allowlist entries.

### Artifacts required to reach `ready_for_review`

- A frozen, versioned allowlist and denylist pair, with every ambiguous field explicitly labelled
  `excluded` or `needs_legal_review` — nothing left unlabelled.
- A `field_allowlist_version` identifier a future report can name.
- A 10K § 14 approval entry for GATE-3, prepared for the joint approvers.

### Not approved by this packet

No field, no allowlist, no denylist, no `raw_data` shape, and no persistence of any kind. An approved
allowlist would be a *target*, never a writer authorization.

> **Update (BR-SOURCE-10M).** The missing artifact named above has since been **proposed** — not
> approved — as a docs-only decision record:
> [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md).
> It defines a six-category field lifecycle model (forbidden always / temporary technical only /
> classification signal only / aggregate report only / candidate future persistible still blocked /
> needs legal-privacy review), labels **every** field family listed under *Evidence missing* above,
> proposes `raw_data` **prohibited by default**, and raises two reconciliation items the approvers must
> close explicitly (raw `tax_id`, which 10I § 6.3 omits while the eligibility design § 5 table lists
> it; and file-level `file_hashes` in reports). Its status is `proposed_for_owner_review`: it assigns
> **no** approved `field_allowlist_version`, so the 10J § 12 marker stays `"not_approved"`, GATE-3
> stays `not_started` with `partial_evidence_collected`, and the evidence-missing list above is
> *addressed as a proposal*, not satisfied. It approves no gate, writes no code, decides no identity
> grain, freezes no report schema, and authorizes **no** dry-run, import, Supabase write, migration,
> runtime, or Agent 1 integration.

---

## 8. GATE-4 evidence packet — Identity grain

**Governs:** decides 10J § 14 (A / B / C / D) and the future `record_identity_key`; sets
`record_identity_grain_decision`.

### Evidence already available

- **The four options, stated explicitly** — per establishment (full-CNPJ grain), per empresa / root,
  two separate snapshots, or a single snapshot with the establishment as the operational unit and the
  company as context ([10I § 7](./br-receita-cnpj-full-join-import-readiness-design.md);
  [10J § 14](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **The current import-staging default and its rationale** — `TAX_GRAIN` identity family,
  `record_identity_key = tax:<normalized_14>`, establishment / full-CNPJ row grain, deduplication by
  full CNPJ and never by root or name, with the root derivable but explicitly *not* the record
  identity ([staging contract § 4](./br-receita-cnpj-import-staging-contract.md)).
- **The recorded conflict-target and idempotency strategy**, including the in-batch duplicate
  fail-closed rule ([staging contract § 11](./br-receita-cnpj-import-staging-contract.md)).
- **The physical unique-index caveat, already documented as unresolved** — migration 065 provides a
  physical unique constraint on the tax-grain tuple, while migration 087 added
  `record_identity_key` as nullable, `NOT VALID`, and **not** unique; which index a future writer
  would upsert on must be confirmed before any write
  ([staging contract § 5, § 11](./br-receita-cnpj-import-staging-contract.md)).
- **The reconciliation requirement against the identity / data contract (CN1)** and the
  full-CNPJ persistence question
  ([10I § 7](./br-receita-cnpj-full-join-import-readiness-design.md);
  [data contract](./br-receita-cnpj-data-contract.md)).
- **An explicit statement that neither 10I nor 10J decides the grain**, and neither does 10K.

### Evidence missing

- **The explicit choice** among A / B / C / D, with the rejected options named and their rejection
  justified. The report marker is still `"not_decided"` (10J § 12).
- **A deterministic `record_identity_key` strategy** derivable without printing or persisting a
  prohibited identifier.
- **The deduplication consequences** of the chosen grain, stated rather than assumed.
- **The enrichment consequences** of the chosen grain.
- **The impact on future Agent 1 routing and consumption.**
- **The reconciliation with the physical `source_company_snapshots` index situation** — whether a
  future writer upserts on the existing tax-grain unique index or a `record_identity_key` unique
  index must be created first. This is a schema-reconciliation decision; note that creating such an
  index would be a **migration**, which nothing in this line authorizes.
- **The treatment of empresa / root grain versus estabelecimento / full-CNPJ grain** where they
  disagree — including whether both are represented at all (options C and D).
- **The treatment of `normalized_tax_id` relative to `record_identity_key`** — today they carry the
  same value for this source, which is what makes the record-identity and legacy tax-grain paths
  agree; a grain change would break that agreement and must say so explicitly.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

Which grain a Brazil snapshot record has. The staging contract's stated default (establishment /
full-CNPJ) is a *documented intention*, and 10K § 8 explicitly names "we already default to A" as a
**fail** criterion: an inherited decision is not a recorded one.

### Artifacts required to reach `ready_for_review`

- A recorded identity-grain determination naming the chosen option, the rejected options, and the
  consequences for deduplication, enrichment, snapshot shape, physical index, and Agent 1.
- A 10K § 14 approval entry for GATE-4, prepared for the joint approvers.

### Not approved by this packet

No grain, no `record_identity_key` construction, no migration, no snapshot write, and no schema
change.

---

## 9. GATE-5 evidence packet — Output sanitization contract

**Governs:** confirms the 10J § 12 report schema and the 10J § 15 assertions — aggregate-only output
with an all-false safety block.

### Evidence already available

- **A candidate aggregate report schema**, field by field, with all values shown as zeros and
  placeholders and the three not-decided contract markers
  ([10J § 12](./br-receita-cnpj-full-join-dry-run-technical-design.md); extending
  [10I § 10](./br-receita-cnpj-full-join-import-readiness-design.md)).
- **The security assertions a future implementation must ship** — no 8/11/14-position identifier
  runs, no email marker, no forbidden key names, no join keys in logs, no raw rows in errors,
  verified temporary-file removal, and the no-write invariants
  ([10J § 15](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **Forbidden digit-run and email-marker checks already proven in the existing bounded tooling** —
  the dry-run rejects a sampled row carrying a CPF-length or full-CNPJ-length digit run, reports
  `ok: false`, and this stop condition is documented as legitimate and non-bypassable
  ([runbook § 12, § 13](./br-receita-cnpj-manual-download-local-prep-runbook.md)).
- **The all-false safety block pattern, already in production use** in the existing runners' reports
  ([runbook § 12](./br-receita-cnpj-manual-download-local-prep-runbook.md)).
- **Aggregate-only report contracts** established across 10E / 10F / 10G / 10H and restated in
  [eligibility design § 9](./br-receita-cnpj-privacy-safe-import-eligibility-design.md).
- **The never-allowed-in-report list** as a closed set
  ([10J § 8.5](./br-receita-cnpj-full-join-dry-run-technical-design.md)).

### Evidence missing

- **A final, frozen report schema for the full join dry-run.** The 10J § 12 shape is a design
  proposal, and it cannot be frozen while GATE-3 (which counts exist) and GATE-4 (which grain is
  reported) are open.
- **An exact, closed list of forbidden key names** — the design gives an illustrative set with an
  "and equivalents" tail; a test needs a closed enumeration.
- **An exact, closed list of forbidden value patterns**, including the precise digit-run rules for
  the 8-, 11-, and 14-position lengths and the email-marker rule.
- **A logging sanitization contract** — what a log line may contain, expressed as an assertion.
- **An error sanitization contract** — what an error may carry, expressed as an assertion.
- **The test cases required before implementation**, enumerated and reviewed. None exist; 10J § 15 is
  a list of obligations, not a suite.
- **The owner approval of the assertion suite** by the security / privacy and test owners jointly.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

The report schema cannot be frozen upstream of GATE-3 and GATE-4. Every rule must also be restated as
an enforceable assertion rather than prose guidance — 10K § 9 makes that a pass criterion.

### Artifacts required to reach `ready_for_review`

- A confirmed, versioned report schema plus a closed assertion list ready for a future test suite.
- A 10K § 14 approval entry for GATE-5, prepared for the joint approvers.

### Not approved by this packet

No report schema, no assertion suite, no test implementation, and no emission of any report from real
data.

---

## 10. GATE-6 evidence packet — Failure cleanup contract

**Governs:** confirms 10J § 9 — cleanup on completion **and** failure, with `cleanup failed` as a
terminal state.

### Evidence already available

- **A failure cleanup contract in design form** — fail closed, stop processing, delete temporary
  indexes, delete partial temp reports, keep only a sanitized failure summary, no stack traces with
  row values, no path leakage beyond the safe local root, no automatic retry without an operator, and
  no Supabase writes under any condition
  ([10J § 9](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **An enumerated list of failure types the contract must cover** — manifest invalid, forbidden file
  family, layout mismatch, privacy leak assertion, memory limit, disk limit, cleanup failed, operator
  cancellation, unexpected parser error
  ([10J § 9](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **The fail-closed rule as a general principle**, inherited from the eligibility design's guard
  rules ([eligibility design § 8](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **`cleanup failed` established as terminal** — never success-with-residue
  ([10J § 9](./br-receita-cnpj-full-join-dry-run-technical-design.md);
  [10K § 10](./br-receita-cnpj-full-join-approval-gates-checklist.md)).
- **No automatic retry** stated as a rule.
- **No Supabase writes under any condition** stated as an invariant across success, failure, and
  retry.
- **Existing stop conditions for the bounded tooling**, as a precedent for operator-visible terminal
  states ([runbook § 13](./br-receita-cnpj-manual-download-local-prep-runbook.md)).

### Evidence missing

- **An exact cleanup procedure per failure type** — the design names the failure types and the
  general posture; there is no per-type matrix saying what is deleted, what survives, and how the
  outcome is verified.
- **A temporary-artifact manifest design** — what a run must know it created in order to prove it
  destroyed it.
- **A quarantine-versus-delete decision.** 10K § 10 permits "removed, or safely quarantined"; which
  one applies, and when, is undecided.
- **Operator cancellation behaviour**, defined concretely.
- **Out-of-memory and disk-exhaustion behaviour**, defined concretely — including whether a partial
  temporary index can be destroyed while the process is already failing on resources.
- **Privacy-assertion-failure behaviour** — what is destroyed, what sanitized summary may remain, and
  what the operator is told.
- **A cleanup verification command or mechanism** the operator can run and trust.
- **A cleanup-failure escalation owner** — who is notified and what happens next.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

What must be destroyed cannot be specified until GATE-2 decides what may exist. A per-failure-type
cleanup matrix is downstream of the storage envelope.

### Artifacts required to reach `ready_for_review`

- A per-failure-type cleanup matrix, with the verification mechanism and the escalation owner named.
- A 10K § 14 approval entry for GATE-6, prepared for the joint approvers.

### Not approved by this packet

No cleanup implementation, no error-handling code, no runner, and no write path.

---

## 11. GATE-7 evidence packet — Operator runbook

**Governs:** confirms 10J § 16 — the manual steps an operator follows to run a future dry-run safely
and reproducibly.

### Evidence already available

- **An existing, official manual download and local prep runbook** — local folder convention outside
  the repository, manual download expectations, extraction rules, safe inventory commands, manifest
  template with header / headerless layout handling, hash and size commands, manifest validation,
  bounded dry-run commands, expected safe outputs, stop conditions, and an explicit
  what-this-does-not-authorize section
  ([runbook § 4–§ 14](./br-receita-cnpj-manual-download-local-prep-runbook.md)).
- **The operator runbook requirements for a full join**, enumerated as obligations — preflight,
  disk / memory check, local path check, manifest check, forbidden-family check, explicit dry-run
  confirmation, live monitoring, cleanup verification, out-of-repo report location, sensitive report
  scan, post-run deletion rules, final signoff
  ([10J § 16](./br-receita-cnpj-full-join-dry-run-technical-design.md);
  [10K § 11](./br-receita-cnpj-full-join-approval-gates-checklist.md)).
- **The out-of-repo principle for both the dataset and the report**
  ([runbook § 4](./br-receita-cnpj-manual-download-local-prep-runbook.md);
  [10J § 6, § 16](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **Sensitive-scan expectations**, in the form of the existing safe-output contract and the
  forbidden-family inventory check that must print nothing
  ([runbook § 7, § 12](./br-receita-cnpj-manual-download-local-prep-runbook.md)).
- **An operator-visible statement that GATE-7 is unapproved**, recorded in the runbook itself
  ([runbook § 11.7](./br-receita-cnpj-manual-download-local-prep-runbook.md)).

### Evidence missing

- **The full join dry-run operator runbook.** It does not exist. The current runbook covers manual
  prep, manifest validation, and the bounded dry-runs, and says so.
- **A preflight checklist that verifies gate approval status** before anything else.
- **The dry-run explicit confirmation language** an operator types, and what refusal looks like.
- **A disk and memory command set** checked against the GATE-2 ceilings — which do not exist yet.
- **Live monitoring instructions** for a long-running local scan.
- **Cleanup verification steps** the operator performs and records.
- **Report sensitive-scan steps** — the exact scan an operator runs against the report before reading
  or sharing it.
- **Post-run deletion rules** for temporary material.
- **A final signoff template** recording the aggregate result only.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

A runbook cannot be written against ceilings that do not exist (GATE-2), a scan contract that is not
frozen (GATE-5), or a cleanup verification that is undefined (GATE-6).

### Artifacts required to reach `ready_for_review`

- An approved full-join operator runbook section — an extension of the existing runbook, never a
  competing document — reproducible by a different operator without tacit knowledge.
- A 10K § 14 approval entry for GATE-7, prepared for the joint approvers.

### Not approved by this packet

No operator procedure, and no execution. Even an approved runbook is a *procedure*, never a
*permission*.

---

## 12. GATE-8 evidence packet — No-write / no-runtime guarantee

**Governs:** forces the 10J § 11 no-write flags and the 10J § 12 `import_executed = false` /
`persisted_rows = 0` / all-false safety invariants.

### Evidence already available

- **A future CLI contract with mandatory flags** — the run refuses to start without
  `--confirm-full-join-readiness-dry-run`, `--no-supabase`, `--no-import`, `--no-runtime`,
  `--no-agent1`, `--strict`, and `--format json`
  ([10J § 11](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **A forbidden-flags list** whose mere presence must be rejected fail-closed before any file is
  opened, with a stable rejection code
  ([10J § 11](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **An existing fail-closed precedent in the repository's own gate codes** — the
  `BRSOURCE{3,6,7}_FORBIDDEN_*` mode gates, cited in 10J § 11 as the pattern to follow.
- **Repeated no-Supabase / no-import / no-runtime / no-Agent-1 contracts** across
  [10I § 4, § 11](./br-receita-cnpj-full-join-import-readiness-design.md),
  [10J § 9, § 12, § 18](./br-receita-cnpj-full-join-dry-run-technical-design.md), and
  [10K § 12](./br-receita-cnpj-full-join-approval-gates-checklist.md).
- **The report-level invariants** `import_executed = false`, `supabase_write = false`,
  `runtime_integration = false`, `agent1_integration = false`, `persisted_rows = 0`, and an all-false
  safety block ([10J § 12](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **Repo safety rules already in force** — the still-blocked-operations lists and the requirement
  that any Supabase write, production import, or runtime / Agent 1 integration each needs its own
  separate approval ([staging contract § 21, § 22](./br-receita-cnpj-import-staging-contract.md)).

### Evidence missing

- **A final CLI guard design** that rejects before any file is opened — including the exact rejection
  codes, the rejection ordering, and the behaviour when a mandatory flag is absent.
- **Proof that forbidden flags fail closed.** Today this is design intent; there is no test.
- **Proof that no Supabase client is imported or invoked** on the future code path.
- **Proof that no Agent 1 module is imported or invoked.**
- **Proof that no provider / HubSpot / Slack code path exists** on the future code path.
- **Tests proving the no-write behaviour.** None exist, and writing them is itself downstream of the
  full gate set — 10K § 9 confines sanitization tests to a future, separately-approved milestone.
- **The owner approval of the no-write guard** by the repo safety and technical owners jointly.

> A structural note the approvers should have in front of them: several of these items are proofs
> *about code that does not exist*. They cannot be produced by inspection today, and they cannot be
> produced by writing the runner either — 10K § 4 forbids writing any full-join code, including
> scaffolding and stubs behind a disabled flag, until all eight gates are approved. What GATE-8 can
> receive today is an approved **contract** (guard design, rejection codes, rejection timing, and the
> test list that a future implementation must satisfy); the proofs themselves land with the
> implementation, in a later, separately-approved milestone that GATE-8's *Allows* clause narrowly
> opens. Treating the proofs as prerequisites for GATE-8 approval would deadlock the gate; treating
> the contract as sufficient for *execution* would void it.

### Current status

```
Gate official status:   not_started — not approved
Evidence packet status: partial_evidence_collected
Current GO / NO-GO:     NO-GO
```

### Pending decision that blocks this gate

Whether the no-write guarantee is enforced by the CLI contract itself — rather than by convention or
reviewer vigilance — and what exactly the approvers accept as the guard contract versus what they
defer to the implementation.

### Artifacts required to reach `ready_for_review`

- A confirmed CLI guard contract: mandatory flags, forbidden flags, rejection codes, rejection
  timing, and the enumerated no-write test list a future implementation must satisfy.
- A 10K § 14 approval entry for GATE-8, prepared for the joint approvers.

### Not approved by this packet

No runner, no CLI, no guard implementation, no test, no import, no runtime activation, no Agent 1
activation, and no Supabase write.

---

## 13. Cross-gate evidence gaps

The gates are not independent, and the evidence gaps propagate along the 10K § 13 dependency graph:

```
GATE-1 legal/privacy       blocks ALL execution
                           └─ nothing downstream is reviewable while GATE-1 is unapproved

GATE-2 storage envelope    blocks GATE-6 cleanup specifics
                           └─ what must be destroyed is undefined until what may exist is decided
                           └─ also blocks GATE-7's disk/memory preflight (no ceilings exist)

GATE-3 field allowlist     blocks GATE-5 report schema
                           └─ which counts the report may carry follows from which fields survive
                           └─ also blocks GATE-4: a key may only derive from allowlisted material

GATE-4 identity grain      blocks the future record_identity_key design
                           └─ also blocks GATE-5: which grain the report reports

GATE-5 sanitization        blocks GATE-7's report sensitive-scan steps

GATE-6 failure cleanup     blocks GATE-7's cleanup-verification steps

GATE-8 no-write guarantee  blocks ANY future implementation, including scaffolding and stubs
```

Two consequences worth stating plainly:

- **The critical path runs GATE-1 → GATE-3 → GATE-4 → GATE-5.** GATE-3 is the highest-leverage
  unblocking decision that is not itself legal-approval-shaped, which is why § 18 recommends it next.
- **An approved upstream gate never implies a downstream one.** The graph orders review; it does not
  propagate approval. Six of the eight gates have a documented upstream dependency, and none of them
  may be approved "along with" its predecessor.

---

## 14. Evidence required to move gates to `ready_for_review`

`ready_for_review` is a submission state, not an approval. The matrix below is what each gate needs to
reach it.

| Gate | Minimum missing evidence | Required approver role | Artifact required | Can move to `ready_for_review` when… | Still does NOT allow… |
|------|--------------------------|------------------------|-------------------|--------------------------------------|------------------------|
| GATE-1 | Legal/privacy determination for full local processing; LGPD basis; licence variant confirmed from official metadata; dry-run vs import scope separated in writing | Legal/privacy owner (never an implementer or the design author) | A determination recorded in the legal/privacy decision record + a § 14 entry prepared | The determination and the licence confirmation exist in recorded form | Execution, import, Supabase write, runtime, Agent 1, persistence of any join key or row |
| GATE-2 | Chosen architecture option; numeric memory / disk / runtime / report / log ceilings; local path; TTL; permissions; encryption decision; cleanup verification mechanism; cleanup-failure owner | Technical owner **and** privacy owner, jointly | A recorded storage-envelope decision replacing every 10J § 10 placeholder | One option is chosen, every placeholder carries a number, and cleanup is verifiable | Persisting source data, snapshot rows, storing real data in the repo, treating temp material as a snapshot |
| GATE-3 | Versioned allowlist + denylist; decisions on `normalized_tax_id`, legal name, trade name, capital social, CNAE, municipality / UF, status, `opened_at`, porte; `raw_data` shape or prohibition | Product / data owner **and** legal/privacy owner, jointly | A frozen, versioned allowlist/denylist pair + a `field_allowlist_version` identifier | Both lists are closed, every ambiguous field is labelled, and a version identifier exists | Persistence of any kind; widening the eligibility design § 5 allowlist |
| GATE-4 | Explicit A / B / C / D choice; deterministic key strategy; dedup, enrichment, snapshot-shape, physical-index, and Agent 1 consequences | Data architecture owner **and** product owner, jointly | A recorded identity-grain determination | Exactly one option is named, trade-offs are documented, and the index situation is reconciled | Migrations, snapshot writes, schema changes |
| GATE-5 | Frozen report schema; closed forbidden-key-name list; closed forbidden-value-pattern list; logging and error sanitization contracts; enumerated test cases | Security / privacy owner **and** test owner, jointly | A confirmed report schema + a closed assertion list | GATE-3 and GATE-4 are resolved and every rule is expressed as an assertion | Executing the full join; emitting any report from real data |
| GATE-6 | Per-failure-type cleanup matrix; temp-artifact manifest; quarantine-vs-delete decision; cancellation, OOM, disk, and leak behaviours; verification mechanism; escalation owner | Technical owner **and** operator owner, jointly | A per-failure-type cleanup matrix | GATE-2 is resolved and every failure type has a defined, verifiable outcome | Running the runner; any write path |
| GATE-7 | Full-join operator runbook: preflight against gate status, ceilings check, confirmation language, monitoring, cleanup verification, report scan, deletion rules, signoff template | Operator owner, technical owner, and privacy owner, jointly | An approved runbook section extending the existing runbook | GATE-2, GATE-5, and GATE-6 are resolved and every step has a definite pass condition | Executing without a separate, explicit future authorization |
| GATE-8 | CLI guard contract with rejection codes and timing; enumerated no-write test list; the approvers' split between contract-now and proofs-at-implementation | Repo safety owner **and** technical owner, jointly | A confirmed CLI contract + test list | The guard contract is closed and the contract/proof split is recorded | Importing, activating runtime, activating Agent 1, any Supabase write |

Rules that hold across the whole matrix:

```
ready_for_review  ≠  approved
approved          ≠  import ready
approved          ≠  execution authorized
```

And, restating 10K § 15's load-bearing separation:

```
GO for runner implementation  ≠  GO for execution
GO for execution              ≠  GO for import
GO for import                 requires a later, separate import authorization
```

---

## 15. Current GO / NO-GO decision

```
Current decision: NO-GO
```

Reasons:

- **no gate is approved** — all eight remain `not_started` in the 10K § 3 model;
- **legal/privacy approval is missing** for a full local join dry-run, and the licence variant is
  unresolved in recorded form;
- **the field allowlist is missing** — no versioned allowlist or denylist exists;
- **the identity grain is missing** — no choice among A / B / C / D has been recorded;
- **the storage envelope is missing** — no architecture option chosen, every numeric ceiling a
  placeholder;
- **the final output sanitization schema is missing** — and cannot be frozen upstream of GATE-3 and
  GATE-4;
- **the failure cleanup implementation detail is missing** — no per-failure-type matrix, no
  verification mechanism;
- **the operator runbook is missing** — no full-join procedure exists;
- **the no-write implementation proof is missing** — the guarantee exists as design intent, with no
  enforceable contract and no tests.

Per the 10K § 15 matrix, any gate at `not_started` reads NO-GO. Eight of eight are. That is the
expected and correct outcome of this document: an evidence packet that concluded GO would be
evidence that something had been approved by inference.

---

## 16. Evidence packet limitations

This packet:

- **maps evidence** — it locates, orders, and labels what exists and what is missing;
- **does not approve gates** — no gate moves to `approved`, or to any other 10K § 3 status;
- **does not replace owners** — every named approver role remains the only source of its approval;
- **does not authorize runner code** — including scaffolding, stubs, or a runner behind a disabled
  flag;
- **does not authorize execution** — of a full join, a full-dataset scan, or any run over real data;
- **does not authorize import** or production import;
- **does not authorize Supabase writes**, migrations, or persistence of any row;
- **does not authorize runtime or Agent 1** integration;
- **does not authorize provider, HubSpot, or Slack** activity, or any UI change;
- **does not download, open, or read any dataset file**;
- **is not itself evidence.** A map of the evidence is not a substitute for the evidence it maps, and
  citing this document to an approver in place of the underlying determinations satisfies nothing.

One further limitation, stated because it is easy to misread: **`partial_evidence_collected` is not
progress toward approval.** Eight gates holding partial evidence is the same NO-GO as eight gates
holding none. The value of this packet is that the *missing* items are now enumerated, not that the
present ones accumulate toward a threshold.

---

## 17. Required flags after 10L

This document adds the evidence-packet flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_PR_READY = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL = false  (not an operational authorization)

OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL         = true

OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Only when this PR is merged does the evidence packet become official:

```
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL = true
```

And even after that merge, Brazil stays non-operational and every gate stays unapproved:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Carried forward from BR-SOURCE-10E–10K (unchanged):

```
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL       = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                  = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL      = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL    = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL            = true

OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED           = false
```

No gate flag is introduced, and no gate status changes. The eight gates are not flags; they are
recorded decisions, and this document records none.

---

## 18. Recommended next hito

**BR-SOURCE-10M — Receita full join field allowlist decision record.**

Objective of 10M: resolve **GATE-3** as a docs-only decision record — a frozen, versioned allowlist
and denylist pair, with every ambiguous field explicitly labelled, and a `field_allowlist_version`
identifier assigned. It would still approve no import, write no code, and authorize no execution,
Supabase write, migration, runtime, or Agent 1 integration.

Reasoning: **GATE-3 unblocks the most downstream work per unit of decision.** Freezing the field set
determines which counts the report may carry (GATE-5), constrains which material a
`record_identity_key` may derive from (GATE-4), and fixes the post-join classification design. It is
also the highest-leverage decision on the § 13 critical path that is not itself an approval act:
GATE-1 requires a legal/privacy owner's determination, which no engineering milestone can produce,
whereas GATE-3 is a product-and-legal decision that a decision-record milestone can genuinely
prepare and land.

Two caveats attach to that recommendation:

- **GATE-3 cannot be *approved* by 10M either.** A decision record can assemble and propose the
  allowlist; the product / data owner and legal/privacy owner jointly approve it, outside the
  document.
- **GATE-1 remains the true blocker for everything.** Resolving GATE-3 first is a sequencing
  convenience, not a way around GATE-1. Nothing executes while GATE-1 is unapproved.

This is a **recommendation, not an execution**: BR-SOURCE-10L opens no such milestone and authorizes
nothing further.

> **Update:** BR-SOURCE-10M has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md).
> Consistent with both caveats above, it **proposes** the allowlist rather than approving it: its
> status is `proposed_for_owner_review`, GATE-3 remains `not_started` / not approved, no
> `field_allowlist_version` is assigned, and GATE-1 remains the blocker for all execution. It records
> the forbidden-always, temporary-technical-only, classification-signal-only, aggregate-report-only,
> candidate-future-persistible, and needs-legal-review categories per field family; states the
> relationship to GATE-4 (it narrows the field universe, it does not choose a grain), GATE-5 (its
> report fields are candidate input, and several are proposed extensions to the 10J § 12 shape), and
> GATE-8 (a field allowlist authorizes no write); and proposes a GATE-3 review checklist for the joint
> owners. It adds no runner and no command and authorizes **no** dry-run, import, Supabase write,
> migration, runtime, or Agent 1 integration. Its recommended successor is **BR-SOURCE-10N — full join
> identity grain decision record** (GATE-4, docs-only).

---

## 19. Explicit non-goals

BR-SOURCE-10L does **not**:

- implement anything;
- modify code, scripts, or package manifests;
- add a runner or a command;
- execute a full join;
- process the full or real dataset;
- **approve any gate**, or move any gate out of `not_started`;
- grant legal or privacy approval;
- decide the identity grain;
- decide the field allowlist;
- decide the storage envelope;
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
- advance Brazil toward production readiness.

---

## 20. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

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
- approve any gate or record any approval;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, and no partner (sócio)
personal data are reproduced. No hash, truncation, or fingerprint derived from any identifier, name,
or join key appears anywhere in this document. Local WIP (`scratchpad/`) is untouched by any git
operation.
