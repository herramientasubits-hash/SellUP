# BR-SOURCE-10M — Receita CNPJ full join field allowlist decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10M — Receita CNPJ full join field allowlist decision record
**Status:** Official decision record of record (docs-only) — `proposed_for_owner_review`; **not** a GATE-3 approval, and **not** a build/import/dry-run/execution authorization
**Predecessor:** BR-SOURCE-10L — `BRSOURCE10LLANDA — FULL_JOIN_GATE_EVIDENCE_PACKET_MERGED` (PR #155, `main` HEAD `f6b7b7b91b03ccdace038d79cf61a948b7d6a5f0`)
**Last reviewed:** 2026-07-29

**Related documents:**
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join import-readiness design (contract) — [`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md)
- Privacy-safe import eligibility design — [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)
- Import & staging persistence contract — [`br-receita-cnpj-import-staging-contract.md`](./br-receita-cnpj-import-staging-contract.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Identity grain & data contract — [`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)
- Legal/privacy review package — [`br-receita-cnpj-legal-privacy-review.md`](./br-receita-cnpj-legal-privacy-review.md)

> This document is a **decision record proposed for owner review**. It proposes and freezes-for-review
> a field allowlist for GATE-3. It **does not approve GATE-3**, does not move GATE-3 out of
> `not_started`, and does not substitute for the product / data owner or the legal/privacy owner who
> jointly approve it. Nothing here authorizes — and nothing here should be read as authorizing — a
> runner, script, package change, migration, dataset download, full-dataset processing, full join
> execution, import, Supabase write, production write, runtime change, adapter/validator change,
> provider call, HubSpot sync, Slack notification, live generation, full expansion, or merge to an
> operational state.
> **This document proposes a field allowlist; it approves none of it.**

---

## 1. Purpose

BR-SOURCE-10L inventoried the evidence behind each of GATE-1 … GATE-8 and found GATE-3 holding
`partial_evidence_collected`: the prohibitions exist as a closed set, a conceptual candidate list of
future persistible fields exists, and a temporary-technical category exists — but **no versioned
allowlist and denylist pair exists**, and at least eight individual field decisions
(`normalized_tax_id`, sanitized legal name, sanitized trade name, `capital_social_value`, the CNAE
fields, municipality / UF granularity, registration status / `opened_at` / porte, and the `raw_data`
shape) have never been recorded either way. 10L named GATE-3 as the highest-leverage decision on the
critical path that is not itself a legal-approval act, and recommended exactly this milestone.

BR-SOURCE-10M supplies that missing artifact in the only form a docs-only milestone can: a **proposal,
assembled and labelled completely, submitted for the named owners' review**. Per field family, it
records the lifecycle category, whether the field may exist in memory, in temporary storage, in the
aggregate report, and in a future persistence target; the current decision; and the gate that blocks
it. Where the underlying legal/privacy question is genuinely open, the field is labelled
`needs_legal_review` rather than resolved by engineering preference — the 10K § 7 pass criterion is
that **nothing is left unlabelled**, not that everything is decided by this document.

This document does **not**:

- **approve GATE-3**, move GATE-3 to `approved`, or substitute for either named approver;
- grant legal or privacy approval;
- replace the legal/privacy owner or the product / data owner;
- implement code, a runner, or a script;
- modify code, scripts, or package manifests;
- create a runner or a command;
- execute a full join;
- process the full or real dataset;
- import data;
- write to Supabase;
- create or modify a migration;
- connect the runtime;
- connect Agent 1;
- touch HubSpot / Slack / providers / UI;
- decide the identity grain (GATE-4) or freeze the report schema (GATE-5);
- mark Brazil ready for anything.

If, at any point, this milestone concluded that it required code, scripts, package changes,
migrations, real execution, or a real GATE-3 approval to proceed, the correct action is to **stop and
escalate**, reporting `BRSOURCE10M_SCOPE_ESCALATION_CODE_OR_GATE_APPROVAL_NOT_ALLOWED`. This document
reaches no such conclusion: a field allowlist is fully expressible as prose plus a decision matrix,
and every field can be labelled without approving its use.

---

## 2. Current official baseline

The company-discovery / eligibility / readiness / approval / evidence line for Receita CNPJ is
official and merged as follows (design and governance of record; none is an operational
authorization):

- **BR-SOURCE-10I — full join import-readiness design is official.** Defines the allowed local
  processing envelope, the join-key treatment, the three-category **post-join field survival
  contract** (§ 6.1 prohibited always / § 6.2 temporary technical-only / § 6.3 candidate future
  persistible), the record-identity decision gate, and GATE-1 … GATE-8. Decides no grain and no
  allowlist ([full join readiness design](./br-receita-cnpj-full-join-import-readiness-design.md)).
- **BR-SOURCE-10J — full join dry-run technical design is official.** Lowers that contract into an
  executable-in-the-future design, including § 8 field handling with explicit discard timing
  (§ 8.1 immediately rejected, § 8.2 allowed only during parsing, § 8.3 classification signals only,
  § 8.4 allowed in the final report, § 8.5 never allowed in the report) and the § 12 report contract
  carrying `field_allowlist_version: "not_approved"`
  ([full join technical design](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **BR-SOURCE-10K — full join approval gates checklist is official.** Makes GATE-3 approvable:
  required evidence, the joint approver roles (**product / data owner and legal/privacy owner**),
  pass criteria (closed allowlist, closed denylist, every ambiguous field labelled, free text fails
  closed, a `field_allowlist_version` assigned), fail criteria, expected artifacts, and an
  *Allows* clause limited to designing the post-join classification against a frozen field set
  ([approval gates checklist § 7](./br-receita-cnpj-full-join-approval-gates-checklist.md)).
- **BR-SOURCE-10L — full join gate evidence packet is official.** Records GATE-3 as `not_started` /
  `partial_evidence_collected`, enumerates the missing per-field decisions, and recommends this
  milestone ([gate evidence packet § 7, § 18](./br-receita-cnpj-full-join-gate-evidence-packet.md)).

Also carried in, unchanged: **10E** (privacy-safe bounded dry-run classifier), **10F** (eligibility &
legal-nature calibration — legal nature is a classification signal, never an import authorization),
**10G** (bounded company↔establishment join dry-run, join key ephemeral in memory only), **10H**
(bounded join coverage strategy, `coverage_is_representative` always false), and the
**BR-SOURCE-10C** headerless real-file support.

Flag state carried into this document, unchanged:

```
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL     = true
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
OPS_BR_READY_FOR_IMPORT                       = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT            = false
OPS_BR_READY_FOR_RUNTIME                      = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY         = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false
```

Gate state carried into this document, unchanged — all eight remain `not_started` and unapproved:

```
GATE-1  Legal/Privacy approval for full local join dry-run   not_started / not approved
GATE-2  Temporary storage envelope                            not_started / not approved
GATE-3  Field allowlist                                       not_started / not approved
GATE-4  Identity grain                                        not_started / not approved
GATE-5  Output sanitization contract                          not_started / not approved
GATE-6  Failure cleanup contract                              not_started / not approved
GATE-7  Operator runbook                                      not_started / not approved
GATE-8  No-write / no-runtime guarantee                       not_started / not approved
```

**This document narrows nothing that is already narrower elsewhere, and widens nothing.** Where this
record and an earlier document appear to differ, the **narrower rule governs**, and the difference is
raised in § 10 or § 16 as a review item rather than resolved by this document's authority.

---

## 3. Decision status

```
Decision record status: proposed_for_owner_review
GATE-3 official status: not_started / not approved
Current GO / NO-GO:     NO-GO
```

Rules attaching to that status:

- **This proposal may serve as GATE-3 evidence.** It is precisely the artifact the 10K § 7
  *Expected artifacts* clause and the 10L § 7 *Artifacts required to reach `ready_for_review`* clause
  name as missing.
- **This proposal does not approve GATE-3.** Only the product / data owner and the legal/privacy
  owner, jointly, can — and only outside this document, recorded with the
  [10K § 14 approval template](./br-receita-cnpj-full-join-approval-gates-checklist.md).
- **This proposal does not move GATE-3 to `ready_for_review` either.** Submission and acceptance are
  separate recorded acts (10L § 3). Assembling the artifact is not submitting it.
- **This proposal does not enable runner code.** 10K § 4 forbids writing any full-join code —
  including scaffolding, "harmless" stubs, or a runner behind a disabled flag — until all eight gates
  are approved. An approved GATE-3 alone would not lift that.
- **This proposal does not enable full join execution.** GATE-1 is the blocker for all execution and
  is unapproved.
- **This proposal does not enable import.** Import requires a later, separate import authorization
  that no gate in this series grants.
- **An approved allowlist would be a *target*, never a writer authorization** (10K § 7 *Does NOT
  allow*).
- **Any sensitive leak resets GATE-3's evidence** to `evidence_not_collected` and the gate to
  `not_started` (10K § 4; 10L § 3), invalidating this proposal along with it.

---

## 4. Field lifecycle model

A field allowlist that only says "allowed" or "forbidden" is not usable here, because the same field
can be legitimate inside a parser and catastrophic in a report. Every field family is therefore placed
in exactly **one** of six lifecycle categories, and the category — not an intuition about
sensitivity — determines where the field may appear.

```
A. Forbidden always                             never, anywhere, under any mode or gate
B. Temporary technical only                     exists during parsing / join, then discarded
C. Classification signal only                   may inform a verdict; never surfaced as a value
D. Aggregate report only                        may appear in the aggregate report
E. Candidate future persistible, still blocked   a target for a future writer; not approved
F. Needs legal/privacy review                   no use permitted until an owner decides
```

Rules governing the categories:

- **A never appears.** Not in memory as an output candidate, not in temporary storage, not in a
  count key, not in a log, not in an error, not in a report, not in a persisted row. Category A is
  not a default that a later approval can relax; per eligibility design § 4 the exclusion set **may
  be expanded but may not be reduced** without a recorded legal/privacy approval.
- **B exists only during parsing / join and must be discarded.** In memory only unless GATE-2
  explicitly approves temporary storage; never printed, never logged, never persisted, never hashed
  for a report; destroyed at end of run **and** on failure (10J § 9).
- **C may feed counts and reason codes, never output with a raw value.** A classification signal
  earns the record a bucket; the bucket is reportable, the value is not.
- **D may appear in the aggregate report.** Counts, buckets, codes, booleans, and durations — never
  a row, a sample, or an identifier.
- **E requires a future, separate approval.** Category E is the shape a future writer would build if
  — and only if — GATE-1, GATE-3, GATE-4, and a separate import authorization all existed. Nothing in
  category E is persistible today.
- **F blocks any use until review.** A field in F is not usable as a signal, is not reportable, and
  is not persistible. F is the honest state for a genuinely open legal question; it is **not** a
  parking category for fields nobody wanted to think about, and every F entry in § 15 names the
  specific open question behind it.
- **A field may only move to a less restrictive category by a recorded owner decision.** Never by
  inference, convenience, silence, a passing test, or a merged PR.
- **Category membership is per *surface*, not per field name.** The same underlying datum can be
  category B in a parser and category A in a report — the join key is exactly that case, and the
  matrix in § 15 carries a column per surface for this reason.
- **Ambiguity resolves to the more restrictive category.** Allowlist-first, fail-closed.

---

## 5. Forbidden always (category A)

These are **never** printed, logged, reported, surfaced in metadata, counted by a key that embeds
them, or persisted — under any mode, gate, or exception. This restates
[10I § 6.1](./br-receita-cnpj-full-join-import-readiness-design.md),
[10J § 8.1 / § 8.5](./br-receita-cnpj-full-join-dry-run-technical-design.md), and
[eligibility design § 6](./br-receita-cnpj-privacy-safe-import-eligibility-design.md), and widens
none of them:

- **CPF** and any natural-person identifier — categorically blocked, with no mode, gate, or exception.
- **Sócios / QSA / person data** — the whole file family is rejected by name before any read.
- **Personal names of owners / partners / representantes**, and `faixa etária` or any
  partner-attribute field.
- **Email** fields.
- **Telephone** fields.
- **Fax** fields.
- **DDD** fields.
- **Street address** (`logradouro`).
- **Address number** (`numero`).
- **Complement** (`complemento`).
- **Neighborhood** (`bairro`).
- **Postal code** (`cep`).
- **Full CNPJ in output** — the 14-position value, in any output surface.
- **CNPJ básico / root in output** — the 8-position structural join key, in any output surface.
- **Raw CSV row** in any form.
- **Unfiltered raw JSON** blobs echoing any of the above.
- **Unbounded free text** — any free-text field not on an explicit allowlist. Not on the allowlist
  means excluded (10K § 7 pass criterion: free text fails closed).
- **Row hashes derived from CNPJ / CPF / names / person data** — no hash, truncation, fingerprint, or
  other derived value of an identifier or a personal value, anywhere.
- **Join keys in logs, errors, or reports** — including in file names, paths, and count keys.
- **Sample values from the real dataset** — a single real value is a leak, not an illustration.
- **Screenshots or pasted rows from the real dataset**, in any document, PR, or report.

```
Any appearance of a category A field in output, a log, a report, or an error = hard blocker.
```

That is not a severity rating. Per 10I § 5, 10J § 7, and 10K § 4 a leak **cancels the run** — it is a
failure, never a partial success — **and resets the affected gates to `not_started`**, invalidating
the evidence that preceded it, this document included.

Two clarifications the approvers should have in front of them, because both look like edge cases and
neither is:

- **Coarse location is not an address field.** `municipality` / `uf` are handled in § 7 and § 15 as a
  granularity question, not as members of category A. The five fine-grained address fields above are
  category A regardless of what is decided about coarse location.
- **"Derived from" is broad on purpose.** A count keyed by a join-key prefix, a bucket whose label
  embeds a name, or a truncated identifier used as a "safe" record reference are all category A. The
  prohibition is on the *derivation*, not on the *format*.

---

## 6. Temporary technical only (category B)

These may exist **only during** a run and must be discarded on completion **and** on failure. They
are **not persistible and not reportable**. This restates
[10I § 6.2](./br-receita-cnpj-full-join-import-readiness-design.md) and
[10J § 8.2](./br-receita-cnpj-full-join-dry-run-technical-design.md):

- **`cnpj_basico` / structural root as an ephemeral join key** — the technical key that links
  `empresas` to `estabelecimentos`; a technical key only, never a record identity, never a reportable
  field, never an import attribute (10I § 5).
- **Full CNPJ components, only if needed to parse the official row structure** — and never output.
  The full CNPJ remains categorically non-printable and non-persistible (10I § 5); its transient
  presence inside a reader is a parsing fact, not a permission.
- **Row index / file offset / byte position**, only if a resumable full scan needs them.
- **Temporary parser cell array** — the parsed row, in the reader, never surfaced.
- **Temporary join map key** — the in-memory key → company-context-*kind* index, never key → value.
- **Temporary processing counters before aggregation.**
- **Temporary file-family discriminator** — which family a file belongs to, used to enforce the
  forbidden-family block before any read.
- **Temporary internal eligibility reason accumulator** — the per-record reason set, before it
  collapses into aggregate counts.

Rules for every category B field:

- **In memory only, unless GATE-2 approves temporary storage.** GATE-2 is `not_started`; no
  temporary on-disk material of any kind is permitted today, and Option C (a temporary on-disk index)
  remains not approved (10L § 6).
- **Never printed** — not to stdout, not to a terminal, not to a progress line.
- **Never logged.**
- **Never persisted.**
- **Never hashed for a report** — a hash of a category B value is a category A value.
- **Deleted / discarded at end of run and on failure**, together with any temporary index built from
  it (10J § 9).
- **A leak cancels the run and resets the relevant gates**, per § 5.
- **Existence in memory is the only place these are ever permitted to exist** (10I § 6.2), until and
  unless GATE-2 records otherwise.

---

## 7. Classification signal only (category C)

These may inform the eligibility classifier and contribute to **counts, buckets, and reason codes**
only. They are never surfaced as values. This restates
[10J § 8.3](./br-receita-cnpj-full-join-dry-run-technical-design.md) and is bounded by
[10I § 6.3](./br-receita-cnpj-full-join-import-readiness-design.md):

- **Legal nature category** — the natureza jurídica category (10F: a classification signal, **not** an
  import authorization).
- **Legal nature risk bucket** — natural-person-risk versus commercial-scope bucketing.
- **CNAE section / category** — the activity section or category, if allowlisted.
- **Municipality code, mapped only to aggregate municipality / UF counts if approved** — see the
  granularity caveat below.
- **UF** — the coarse state signal.
- **Registration status bucket** — the situação cadastral bucket.
- **`opened_at` bucket** — a bucket, never an exact row-level value in the report.
- **Company size / porte bucket.**
- **`capital_social` bucket** — a bucket, never an exact value, and only if a future policy allows
  (10J § 8.3).
- **Establishment type bucket** — for example the matriz / filial distinction, expressed as a bucket.
- **Matrix / headquarter bucket**, only if derivable without exposing an identifier. If the only way
  to derive it is to surface a structural identifier, it is not derivable for this purpose.
- **Eligibility status** — one of the eligibility design § 7 statuses.
- **Eligibility reason code** — machine codes only, never embedding a personal value.

Rules for every category C field:

- **No raw values in the report** — the signal earns a bucket; the bucket is reportable, the value is
  not.
- **Only buckets, counts, and reason codes** leave the classifier.
- **No row-level examples** — not "the smallest", not "the first", not "one representative".
- **No sample values** — including values presented as illustrations, redacted partials, or
  "anonymized" variants.
- **No identifiers** — a bucket label may never embed or reconstruct an identifier.
- **Bucket definitions must be closed and enumerated** before a report can name them; that closure
  is GATE-5's work, not this document's.

Two caveats the approvers must resolve rather than inherit:

- **Municipality granularity is an open legal/privacy question** (eligibility design § 11 #4), so the
  municipality entry above is conditional. Coarse `municipality` / `uf` is the documented *default
  safe state*; per 10L § 7 it is explicitly **not a recorded approval**. Whether municipality appears
  as a *named* bucket or only as a count distribution is a GATE-3 decision (§ 8, § 16).
- **`capital_social` and `opened_at` are bucket-only in category C by design.** Any exact-value use —
  in a report or in a future persisted row — is a separate decision, tracked in categories E and F.

---

## 8. Aggregate report only (category D)

The report is **aggregate-only**. The fields below are proposed as the permitted content of a future
full-join dry-run report, extending
[10J § 8.4 / § 12](./br-receita-cnpj-full-join-dry-run-technical-design.md) and
[10I § 10](./br-receita-cnpj-full-join-import-readiness-design.md):

**Run identity and mode**

- `mode`
- `ok`
- `source_key`
- `country_code`
- `source_period`
- `official_layout_mode`

**Scope and safety invariants**

- `full_dataset_processed`
- `import_executed`
- `supabase_write`
- `runtime_integration`
- `agent1_integration`
- `persisted_rows`

**Volume and provenance counters**

- `files_seen`
- `file_family_counts`
- `rows_seen_by_family`
- `companies_seen`
- `establishments_seen`
- `joined_establishments_count`
- `missing_company_context_count`

**Eligibility aggregates**

- `eligibility_status_counts`
- `eligibility_reason_counts`

**Classification bucket aggregates**

- `legal_nature_bucket_counts`
- `cnae_section_counts`
- `uf_counts`
- `municipality_count_distribution` — a distribution of counts, **not** municipality names, unless a
  named-municipality report is separately approved
- `registration_status_bucket_counts`
- `opened_at_bucket_counts`
- `porte_bucket_counts`
- `capital_social_bucket_counts`
- `establishment_type_bucket_counts`

**Run outcome**

- `safety` booleans — the all-false safety block
- `cleanup_status`
- `duration_ms`
- `warnings` — controlled enum codes only
- `errors` — controlled enum codes only

Prohibited in the report, without exception:

- **sample rows**;
- **sample names**;
- **sample identifiers**;
- **raw error strings carrying values** — an error carries a code, never a value;
- **stack traces carrying values**;
- **exact CNPJ, CPF, email, phone, or address values**;
- and everything in § 5, restated by reference rather than re-enumerated.

Four constraints on this list, all load-bearing:

- **This is a candidate list, not a frozen schema.** 10L § 9 records that the report schema **cannot
  be frozen while GATE-3 and GATE-4 are open**. Several fields above (`files_seen`,
  `rows_seen_by_family`, `official_layout_mode`, `cleanup_status`, `duration_ms`, the bucket-count
  families, and the controlled `warnings` / `errors` enums) are **proposed extensions** to the
  existing 10J § 12 shape, not fields that shape already carries. They are **candidate input to
  GATE-5** (§ 13), and GATE-5 — not this document — closes the schema.
- **The invariants stay invariant.** `full_dataset_processed` may be `true` in a dry-run, but
  `import_executed = false`, `supabase_write = false`, `runtime_integration = false`,
  `agent1_integration = false`, `persisted_rows = 0`, and every `safety` boolean `false` are contract
  values, not measurements (10J § 12).
- **The three contract markers keep their not-decided values.** `field_allowlist_version` stays
  `"not_approved"`, `record_identity_grain_decision` stays `"not_decided"`, and
  `temporary_storage_mode` stays `"not_approved"` until the corresponding gates are approved. This
  document changes none of the three (§ 18).
- **`coverage_is_representative` is not made true by a full join.** It is `false` across 10G / 10H,
  and a full-dataset dry-run would have to state its own representativeness claim explicitly and
  separately; nothing here grants one.

---

## 9. Candidate future persistible fields, still blocked (category E)

The following are the **candidates** a future, separately-approved writer would build from. This
restates [10I § 6.3](./br-receita-cnpj-full-join-import-readiness-design.md) and
[eligibility design § 5](./br-receita-cnpj-privacy-safe-import-eligibility-design.md) and **widens
neither**:

- `source_key` — fixed literal
- `country_code` — fixed literal `BR`
- `source_year` — explicit input, never hardcoded
- `source_period` — publication period
- `source_file_family` — company / reference family only
- `record_identity_key` — **pending GATE-4** (§ 12)
- `normalized_tax_id` — **pending eligibility design § 11 #1** (§ 10)
- sanitized `legal_name` — razão social; never an identity; excluded on a natural-person signal
- sanitized `trade_name` — nome fantasia; only if it passes the guard
- `legal_nature_code` / `legal_nature_label`
- `cnae_principal_code` / `cnae_principal_label` — and `cnae_secondary_codes`
- `municipality_code` — coarse only
- `uf` — coarse only
- `registration_status_code` / `registration_status_label`
- `opened_at` / `start_date`
- `company_size_code` — porte
- `capital_social_value`
- `privacy_classification`
- `eligibility_status`
- `eligibility_reason_codes` — machine codes only
- **minimal typed `raw_data` allowlist** — never a raw row; see § 11

```
These fields are NOT approved for persistence.
```

Every one of them requires **all** of the following before a single row could be written, and none of
them exists:

- **GATE-1** — a legal/privacy determination for the processing this record presupposes;
- **GATE-3 owner approval** — this proposal accepted, with a `field_allowlist_version` assigned;
- **GATE-4** — an identity-grain decision, which determines what `record_identity_key` even means;
- **a separate future import authorization** — which no gate in this series grants (10K § 15:
  *GO for import requires a later, separate import authorization*).

Two structural notes:

- **A future writer builds from the allowlist and drops every extra key.** That is the EC SCVS
  discipline recorded in [staging contract § 5](./br-receita-cnpj-import-staging-contract.md) after
  the historical schema-mismatch incident, and it is the only construction pattern this record
  contemplates. No free-form columns, no re-derivation of excluded fields, no remapping.
- **`municipality_label` / `municipality_name` is deliberately absent from the list above.** The
  eligibility design § 5 table and the staging contract § 6 `raw_data` example both contemplate a
  municipality *name*; 10I § 6.3 lists `municipality_code` / `municipality_label` as coarse-only
  candidates; and the granularity question (§ 11 #4) is open. Rather than pick a side, the label /
  name variant is tracked as category F in § 10 and § 15, and the **narrower** reading governs until
  the owners decide.

---

## 10. Needs legal/privacy review (category F)

Each field below is genuinely undecided. None may be used as a signal, reported, or persisted until
the named owners record a decision. Each entry names the open question behind it:

- **`normalized_tax_id` survival** — may Brazil persist the normalized full CNPJ at all, or only a
  `record_identity_key` (eligibility design § 11 #1)? This is the single largest open item, because
  it interacts with GATE-4: today `record_identity_key` and `normalized_tax_id` carry the same value
  for this source, which is exactly what makes the record-identity and legacy tax-grain paths agree
  (10L § 8).
- **Full CNPJ treatment** — reconciled against `CNPJ_TREATMENT_MODE = A` (legal/privacy decision
  record § 7) and the categorical non-printability rule (10I § 5 / 10J § 7). Mode A is a
  *persistence-and-design* statement and must **not** be read as permission to print a full CNPJ
  anywhere (10L § 5).
- **`cnpj_basico` technical handling outside memory** — permitted in memory as an ephemeral join key;
  whether it may exist in temporary storage at all is a joint GATE-2 / GATE-3 question, and GATE-2 is
  unapproved.
- **Sanitized `legal_name`** — razão social; whether a sanitized company legal name may survive at
  all, given that a natural-person-equivalent entity can carry a person's name in that field
  (eligibility design § 4, § 5).
- **Sanitized `trade_name`** — nome fantasia; same question, plus whether the guard alone is a
  sufficient basis.
- **`capital_social` exact value** — a public company financial attribute, but exact-value survival
  is unrecorded (legal/privacy review § 12 #6; 10J § 8.3 permits it only "if a future policy
  allows").
- **Municipality granularity** — coarse code, coarse label / name, or count distribution only
  (eligibility design § 11 #4; legal/privacy review § 13). Coarse is the documented default safe
  state, **not** a recorded approval.
- **`opened_at` exact value** — bucket-only in category C; exact-value survival in a persisted row is
  a separate decision.
- **Minimal `raw_data` object** — the exact minimal typed allowlist, or outright prohibition
  (eligibility design § 11 #5). See § 11.
- **Use of licence-sensitive fields** — the CC BY-ND / NonCommercial-NoDerivatives licence-variant
  question is recorded as **unresolved and load-bearing** (legal/privacy review § 3, § 12 #1, § 13);
  `LICENSE_DECISION = allowed` was recorded without recording *which variant* was read from the
  official metadata (10L § 5). Any field whose retention or transformation the licence constrains
  inherits that unresolved state.
- **Any field that can indirectly identify a sole proprietor or a person-risk entity** — including a
  sanitized name, a coarse-location plus narrow-CNAE combination, or a bucket set narrow enough to
  single out one entity. MEI / empresário individual records are excluded by default (10F) and MEI /
  EI treatment is itself open (eligibility design § 11 #3); a field that reintroduces person risk
  through combination is an F item, not a C item.

Two further reconciliation items, raised for the owners and **not resolved here**:

- **Raw `tax_id`.** The eligibility design § 5 table and the staging contract § 5 both list a raw
  `tax_id` string "for traceability, subject to the same masking / logging discipline". 10I § 6.3 —
  the document GATE-3's allowlist must be derived from and never be wider than (10K § 7) — **omits
  it**. Under the narrower-rule principle, raw `tax_id` is treated as category F here and is
  **absent** from category E. The owners must say explicitly whether it is `excluded` or
  `needs_legal_review`; the 10K § 7 pass criterion allows no third option.
- **File-level hashes in reports.** The eligibility design § 9 permits `file_hashes` as a
  SHA-256 12-character prefix, and the existing bounded runners already emit them; 10I § 5 and
  10J § 8.5 prohibit any hash **derived from an identifier, a name, or the join key**. A hash of a
  *file's bytes* is not in that prohibited class, and the distinction is real — but the tension
  between "masked or hash12 safe identifier" language (legal/privacy decision record § 8) and the
  later categorical prohibition was already flagged for the GATE-1 approver (10L § 5). This record
  therefore does **not** add `file_hashes` to category D; it leaves the item in F for the approvers
  to close explicitly.

---

## 11. Raw data policy

```
Default: raw_data is prohibited.
```

That is the fail-closed default this record proposes, and it holds unless and until the owners record
otherwise. It is the stricter of the two options the 10K § 7 evidence requirement offers ("either a
minimal typed allowlist, or `raw_data` prohibited outright") and it is the correct default while
eligibility design § 11 #5 is open.

A future exception is *possible*, and only under all of the following conditions:

- **every key is explicitly approved** — enumerated, closed, and named individually;
- **every value is non-personal and non-sensitive under GATE-1** — assessed per key, not in
  aggregate;
- **no free text** — no key whose value is unbounded prose;
- **no raw row** — never the source row, never a reconstruction of it, never a subset that
  reconstructs it;
- **no identifiers** — no full CNPJ, no CNPJ básico / root, no derived or truncated identifier;
- **no contact, address, or person data** — the category A set is not re-enterable through
  `raw_data`;
- **no CNPJ, no CPF** — in any form, in any key, in any nesting level;
- **no names unless explicitly approved** — sanitized legal name and trade name are category F, and
  a `raw_data` allowlist may not smuggle them in ahead of that decision.

Two notes on why this matters more than it looks:

- **`raw_data` is where a field allowlist usually leaks.** The staging contract § 6 example payload
  already carries structural CNPJ components (root / order / DV) as illustrative placeholders in a
  *snapshot* shape designed before the full-join question. Under this record, structural components
  are category B — parse-time only, never output, never persisted — and any future `raw_data`
  allowlist that reintroduces them is a widening that GATE-3 does not permit (10K § 7 fail criterion:
  CNPJ básico or full CNPJ appearing in output).
- **Prohibited-by-default costs nothing today.** No writer exists, no import is authorized, and no
  row may be persisted. Choosing the strict default now removes the risk that an unreviewed
  `raw_data` shape becomes the de facto contract by inheritance — exactly the drift 10K § 8 named as a
  fail criterion for GATE-4 ("we already default to A" is not a recorded decision).

---

## 12. Relationship to GATE-4 — Identity grain

```
GATE-3 does not choose the identity grain.
GATE-3 narrows the field universe available to GATE-4.
```

The dependency runs GATE-3 → GATE-4: per 10K § 13, GATE-4 "depends on GATE-3 for which fields a key
may be derived from", and per 10L § 13 "a key may only derive from allowlisted material". A frozen
field set therefore constrains GATE-4's options without deciding among them.

GATE-4 must still decide, explicitly, among the four options recorded in
[10I § 7](./br-receita-cnpj-full-join-import-readiness-design.md) and
[10J § 14](./br-receita-cnpj-full-join-dry-run-technical-design.md):

```
A. establishment grain (full 14-position CNPJ) — the import-staging § 4 documented default
B. company / root grain (cnpj_basico, 8 positions)
C. two separate snapshots (a company snapshot + an establishment snapshot)
D. a single snapshot with the establishment as the operational unit and the company as context
```

What this record does **not** do for GATE-4:

- it does **not** choose a grain, and does not express a preference for one;
- it does **not** define `record_identity_key`'s construction;
- it does **not** reconcile the physical `source_company_snapshots` unique-index situation (migration
  065's tax-grain unique constraint versus migration 087's nullable, `NOT VALID`, non-unique
  `record_identity_key`) — and it notes that creating a new unique index would be a **migration**,
  which nothing in this line authorizes;
- it does **not** resolve the `normalized_tax_id` versus `record_identity_key` question, which sits in
  category F (§ 10) precisely because GATE-4's answer depends on it and vice versa.

The one thing it does supply: **the closed set of material a `record_identity_key` may be derived
from**, once approved. A key derived from a category A value, or from a category F value before its
review, would be invalid regardless of which grain GATE-4 picks.

---

## 13. Relationship to GATE-5 — Output sanitization

```
GATE-5 cannot freeze the report schema until this allowlist is reviewed.
```

That is 10L § 9's finding, not a new claim: the 10J § 12 shape "cannot be frozen while GATE-3 (which
counts exist) and GATE-4 (which grain is reported) are open".

Accordingly:

- **The § 8 aggregate report fields are candidate input to GATE-5**, not a frozen schema, and not an
  approved one.
- **GATE-5 must still produce enforceable assertions and tests** — an exact closed list of forbidden
  key names (the 10J § 15 set ends in an "and equivalents" tail that no test can consume), an exact
  closed list of forbidden value patterns including the digit-run rules for the 8-, 11-, and
  14-position lengths and the email-marker rule, a logging sanitization contract, and an error
  sanitization contract (10L § 9).
- **No test exists today**, and none is created here. 10J § 15 enumerates obligations a future
  implementation must satisfy; it is not a suite.
- **Prose is not an assertion.** 10K § 9 makes "every rule expressed as an enforceable assertion" a
  pass criterion for GATE-5. This record is prose plus a matrix; it is the input, not the
  enforcement.
- **The bucket definitions this record leaves open — municipality naming, `capital_social` bucket
  boundaries, `opened_at` bucket boundaries, and the controlled `warnings` / `errors` enums — must be
  closed by GATE-5** before a report can name them.

---

## 14. Relationship to GATE-8 — No-write / no-runtime

```
A field allowlist does not authorize writes.
```

Even a fully approved, versioned allowlist authorizes **no** persistence. Per 10K § 7, an approved
allowlist *Allows* exactly one thing — designing the post-join classification against a frozen field
set — and explicitly *Does NOT allow* persistence of any kind.

Allowlisted fields may not be written to Supabase unless a later, separate import authorization
exists. A future dry-run must keep:

```
import_executed     = false
supabase_write      = false
runtime_integration = false
agent1_integration  = false
persisted_rows      = 0
```

and the whole `safety` block all-false, regardless of what the allowlist contains and regardless of
`full_dataset_processed` (10J § 12; 10I § 10).

Three reinforcements:

- **GATE-8's guard contract is unapproved.** The mandatory-flag / forbidden-flag CLI contract
  (10J § 11) exists as design intent with no tests, and 10L § 12 records that several of its proofs
  are proofs *about code that does not exist*. Nothing here changes that.
- **No code may be written from this document.** 10K § 4 forbids writing any full-join code —
  scaffolding, stubs, or a runner behind a disabled flag — until all eight gates are approved.
- **Processing is not persisting, and neither is authorized.** A full-join dry-run would *measure*
  eligibility; measurement is a different act from persistence, and today neither has a live
  authorization.

---

## 15. Field decision matrix

Legend for the surface columns:

```
no                  never permitted
yes                 permitted within the stated category rules
bucket/count only   permitted only as a bucket, count, or reason code — never as a value
gate-2 only         permitted only if GATE-2 approves temporary storage (today: unapproved, so no)
blocked             a target for a future approval; not permitted today
review              undecided; no use permitted until the named owners decide
```

Every "Allowed in future persistence" cell reads `blocked` or `review` — **no cell in that column
authorizes anything**, and the column exists to record intent, not permission.

| Field / field family | Lifecycle category | Allowed in memory | Allowed in temp storage | Allowed in aggregate report | Allowed in future persistence | Current decision | Blocking gate | Notes |
|---|---|---|---|---|---|---|---|---|
| CPF | A | no | no | no | no | forbidden always | — | Categorically blocked; no mode, gate, or exception (eligibility § 6) |
| Sócios / QSA / person data | A | no | no | no | no | forbidden always | — | File family rejected by name before any read (staging § 15; 10J § 8.1) |
| Personal names of owners / partners / representantes, `faixa etária` | A | no | no | no | no | forbidden always | — | Person data; same categorical block |
| Email / telephone / fax / DDD | A | no | no | no | no | forbidden always | — | 10K § 7 fail criterion if proposed |
| Fine address (`logradouro`, `numero`, `complemento`, `bairro`, `cep`) | A | no | no | no | no | forbidden always | — | Coarse location handled separately; never these five |
| Full CNPJ — output surfaces | A | no | no | no | no | forbidden always in output | — | Categorically non-printable (10I § 5) |
| Full CNPJ — parse-time components | B | yes | gate-2 only | no | review | temporary technical only; persistence undecided | GATE-2, GATE-3, GATE-4 | Parsing fact, not a permission; survival is § 10 F item |
| `cnpj_basico` / root — output surfaces | A | no | no | no | no | forbidden always in output | — | Join key; never printed, logged, hashed, or in a count key |
| `cnpj_basico` / root — ephemeral join key | B | yes | gate-2 only | no | no | temporary technical only | GATE-2 | Discarded on completion and failure (10J § 9) |
| Raw CSV row | A | reader only, never surfaced | no | no | no | forbidden always | — | Category B inside the reader; never an output candidate |
| Unfiltered raw JSON | A | no | no | no | no | forbidden always | — | Cannot re-enter via `raw_data` (§ 11) |
| Unbounded free text | A | no | no | no | no | forbidden always — fails closed | — | Not on the allowlist means excluded (10K § 7) |
| Row hashes derived from identifiers / names / join key | A | no | no | no | no | forbidden always | — | The derivation is prohibited, not just the format |
| Row index / file offset / byte position | B | yes | gate-2 only | no | no | temporary technical only | GATE-2 | Only if a resumable scan needs them |
| Temporary parser cell array | B | yes | no | no | no | temporary technical only | — | Discarded immediately after the record is processed |
| Temporary join map key | B | yes | gate-2 only | no | no | temporary technical only | GATE-2 | Key → context *kind*, never key → value |
| Temporary counters / file-family discriminator / reason accumulator | B | yes | no | bucket/count only (after aggregation) | no | temporary technical only | — | Only the aggregate survives |
| Legal nature category / risk bucket | C | yes | no | bucket/count only | blocked | classification signal only | GATE-1, GATE-3 | Signal, never an import authorization (10F) |
| CNAE section / category / code | C | yes | no | bucket/count only | blocked | classification signal only; codes as E candidates | GATE-1, GATE-3 | Principal and secondary code decisions still unrecorded (10L § 7) |
| UF | C | yes | no | bucket/count only | blocked | classification signal only | GATE-1, GATE-3 | Coarse by default |
| Municipality (code) | C | yes | no | count distribution only | review | signal permitted only as aggregate counts; granularity undecided | GATE-1, GATE-3 | Coarse is default safe state, not an approval (10L § 7) |
| Municipality (label / name) | F | no | no | no | review | needs legal/privacy review | GATE-1, GATE-3 | Documents disagree; narrower rule governs (§ 9, § 10) |
| Registration status | C | yes | no | bucket/count only | blocked | classification signal only | GATE-1, GATE-3 | Bucket in reports; code/label are E candidates |
| `opened_at` / start date | C (bucket) / F (exact) | yes | no | bucket/count only | review | bucket only; exact value needs review | GATE-1, GATE-3 | Exact row-level value never in the report |
| Porte / company size | C | yes | no | bucket/count only | blocked | classification signal only | GATE-1, GATE-3 | Bucket in reports |
| `capital_social` | C (bucket) / F (exact) | yes | no | bucket/count only | review | bucket only if a future policy allows; exact value needs review | GATE-1, GATE-3 | 10J § 8.3; legal/privacy review § 12 #6 |
| Establishment type / matriz-filial | C | yes | no | bucket/count only | blocked | bucket only, and only if derivable without exposing an identifier | GATE-1, GATE-3, GATE-4 | If deriving it requires surfacing an identifier, it is not derivable |
| Eligibility status | C / D | yes | no | yes (counts) | blocked | classification signal + aggregate counts | GATE-1, GATE-3 | Eligibility design § 7 statuses |
| Eligibility reason code | C / D | yes | no | yes (counts) | blocked | machine codes only | GATE-1, GATE-3 | Never embeds a personal value |
| `source_key` / `country_code` / `source_period` | D / E | yes | no | yes | blocked | reportable; persistence blocked | GATE-3, import auth | Fixed literals / explicit inputs |
| `source_year` / `source_file_family` | E | yes | no | yes (as counters / mode) | blocked | persistence blocked | GATE-3, import auth | `source_year` explicit input, never hardcoded |
| `record_identity_key` | E | n/a today | no | no | blocked | undefined until GATE-4 | GATE-4 | Meaning depends on the grain choice (§ 12) |
| `normalized_tax_id` | F | review | no | no | review | needs legal/privacy review | GATE-1, GATE-3, GATE-4 | Eligibility § 11 #1; largest single open item |
| Raw `tax_id` | F | review | no | no | review | needs legal/privacy review; absent from category E | GATE-1, GATE-3 | 10I § 6.3 omits it; narrower rule governs (§ 10) |
| Sanitized `legal_name` (razão social) | F | review | no | no | review | needs legal/privacy review | GATE-1, GATE-3 | Never an identity; person-signal exclusion applies |
| Sanitized `trade_name` (nome fantasia) | F | review | no | no | review | needs legal/privacy review | GATE-1, GATE-3 | Only if it passes the guard — and only if approved |
| Minimal typed `raw_data` | F | review | no | no | review | **prohibited by default**; exception only under § 11 | GATE-1, GATE-3 | Eligibility § 11 #5; never an unfiltered blob |
| `privacy_classification` | E | yes | no | bucket/count only | blocked | persistence blocked | GATE-1, GATE-3 | The record's privacy verdict |
| Aggregate counters (`files_seen`, `rows_seen_by_family`, `companies_seen`, `establishments_seen`, `joined_establishments_count`, `missing_company_context_count`, `persisted_rows`) | D | yes | no | yes | n/a | reportable | GATE-5 freezes the schema | Several are proposed extensions to 10J § 12 (§ 8) |
| Safety booleans (`import_executed`, `supabase_write`, `runtime_integration`, `agent1_integration`, `safety.*`) | D | yes | no | yes | n/a | reportable; all-false by contract | GATE-5, GATE-8 | Contract values, not measurements |
| Controlled `warnings` / `errors` | D | yes | no | yes (enum codes only) | n/a | reportable as closed enums | GATE-5 | No raw strings, no stack traces, no values |
| File-level hashes (`file_hashes`) | F | yes | no | review | review | needs owner reconciliation; not added to category D here | GATE-1, GATE-5 | File-byte hash ≠ identifier-derived hash; tension flagged in 10L § 5 |
| Screenshots / pasted real rows / sample values | A | no | no | no | no | forbidden always | — | A single real value is a leak, not an illustration |

---

## 16. Proposed GATE-3 review checklist

For the **product / data owner and the legal/privacy owner, jointly** (10K § 7). Either may reject
alone; approval requires both. Neither may be an implementing agent or the author of this record.

- [ ] **Confirm the forbidden-always list** (§ 5) as closed, and confirm it may be expanded but never
      reduced without a recorded legal/privacy approval.
- [ ] **Approve or reject the classification-signal list** (§ 7), including the bucket-only treatment
      of `capital_social` and `opened_at`.
- [ ] **Approve or reject the aggregate-report field list** (§ 8), noting which entries are proposed
      extensions to 10J § 12 and therefore land with GATE-5.
- [ ] **Decide each `needs_legal_review` field individually** (§ 10) — `normalized_tax_id`, full CNPJ
      treatment, `cnpj_basico` outside memory, sanitized legal name, sanitized trade name,
      `capital_social` exact value, municipality granularity and naming, `opened_at` exact value,
      minimal `raw_data`, licence-sensitive fields, indirect sole-proprietor identifiability, raw
      `tax_id`, and file-level hashes. **Every field must end as `approved`, `excluded`, or
      `needs_legal_review` — nothing unlabelled** (10K § 7).
- [ ] **Decide whether `raw_data` stays prohibited** (§ 11), or is permitted as a fully enumerated
      minimal typed allowlist under every stated condition.
- [ ] **Define a `field_allowlist_version`** identifier a future report can name. Until one is
      recorded by the owners, the report marker stays `"not_approved"` (§ 18).
- [ ] **Confirm that no field approval grants import** — an approved allowlist is a target, never a
      writer authorization, and import needs its own later authorization.
- [ ] **Confirm GATE-4 and GATE-5 remain separate**, unapproved, and unaffected by a GATE-3 approval.
- [ ] **Record the decision with the 10K § 14 template** — roles not identities, no sensitive values,
      rejections kept as part of the audit trail. An approval not recorded in that shape does not
      exist.

---

## 17. Current decision

```
Current decision: NO-GO
```

- This record is `proposed_for_owner_review`.
- **GATE-3 remains `not_started` / not approved.**
- **No runner code may be written from this document alone** — nor from this document plus any
  combination of the existing designs; 10K § 4 requires all eight gates approved before any full-join
  code is written.
- **No full join may be executed from this document alone.** GATE-1 blocks all execution and is
  unapproved.
- **No import may occur from this document alone**, and none may occur from a GATE-3 approval either.
- All eight gates remain unapproved, so the 10K § 15 matrix reads **NO-GO**. That is the expected and
  correct outcome: a decision record that concluded GO would be evidence that a gate had been
  approved by inference.

---

## 18. Required flags after 10M

This document adds the decision-record flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_PR_READY = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL = false  (not an operational authorization)

OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL     = true
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL         = true

OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Only when this PR is merged does the decision record become official:

```
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL = true
```

And even after that merge, Brazil stays non-operational and GATE-3 stays unapproved:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Carried forward from BR-SOURCE-10E–10L (unchanged):

```
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL       = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                  = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL      = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL    = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL            = true

OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED           = false
```

No gate flag is introduced, and no gate status changes. The three 10J § 12 contract markers keep their
values — `field_allowlist_version: "not_approved"`, `record_identity_grain_decision: "not_decided"`,
`temporary_storage_mode: "not_approved"` — because the corresponding gates are still open. The eight
gates are not flags; they are recorded decisions, and this document records none.

---

## 19. Explicit non-goals

BR-SOURCE-10M does **not**:

- **approve GATE-3**, or move any gate out of `not_started`;
- grant legal or privacy approval;
- implement anything;
- modify code, scripts, or package manifests;
- add a runner or a command;
- execute a full join;
- process the full or real dataset;
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
- decide the identity grain (GATE-4);
- freeze the report schema (GATE-5);
- decide the storage envelope (GATE-2);
- assign an approved `field_allowlist_version`;
- advance Brazil toward production readiness.

---

## 20. Recommended next hito

**BR-SOURCE-10N — Receita full join identity grain decision record.**

Objective of 10N: resolve **GATE-4** as a docs-only decision record — naming exactly one option among
A / B / C / D, with the rejected options named and their rejection justified, and with the
consequences stated for deduplication, enrichment, snapshot shape, the physical
`source_company_snapshots` index situation, and future Agent 1 consumption — using the **field
universe this record proposes** (§ 15) as the closed set a `record_identity_key` may derive from. It
would approve no import, write no code, and authorize no execution, Supabase write, migration,
runtime, or Agent 1 integration.

Reasoning: GATE-4 is the next node on the 10L § 13 critical path (GATE-1 → GATE-3 → GATE-4 →
GATE-5), it depends on GATE-3 for exactly the material this record enumerates, and it is — like
GATE-3 — a decision a docs-only milestone can genuinely prepare rather than an approval act only a
legal owner can perform.

Three caveats attach:

- **GATE-4 cannot be *approved* by 10N either.** A decision record can assemble and propose the
  grain choice; the data architecture owner and product owner jointly approve it, outside the
  document.
- **GATE-4 inherits this record's open items.** The `normalized_tax_id` question (§ 10) sits between
  GATE-3 and GATE-4; 10N must state how it proceeds while that item is in `needs_legal_review`
  rather than resolving it by preference.
- **GATE-1 remains the true blocker for everything.** Sequencing GATE-3 then GATE-4 is a
  convenience, not a route around GATE-1. Nothing executes while GATE-1 is unapproved.

This is a **recommendation, not an execution**: BR-SOURCE-10M opens no such milestone and authorizes
nothing further.

---

## 21. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- download or import a dataset;
- open, read, or process the real / full dataset, or print any real file, row, full CNPJ, CNPJ básico,
  or CPF;
- modify the operator's real local manifest or include any real manifest / dataset;
- write to Supabase or perform any production write;
- create or modify a migration;
- change the parser, reader, dry-run, manifest validator, snapshot builder, join dry-run, or any
  connector runtime behavior;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- perform live generation or full expansion;
- approve any gate, record any approval, or assign an approved `field_allowlist_version`;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, and no partner (sócio)
personal data are reproduced. No hash, truncation, or fingerprint derived from any identifier, name,
or join key appears anywhere in this document. Every field name, code, and value shape referenced here
is a schema name or a placeholder, never a real value. Local WIP (`scratchpad/`) is untouched by any
git operation.
