# BR-SOURCE-10N — Receita CNPJ full join identity grain decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10N — Receita CNPJ full join identity grain decision record
**Status:** Official decision record of record (docs-only) — `proposed_for_owner_review`; **not** a GATE-4 approval, and **not** a build/import/dry-run/execution/migration authorization
**Predecessor:** BR-SOURCE-10M — `BRSOURCE10MLANDA — FIELD_ALLOWLIST_DECISION_RECORD_MERGED` (PR #157, `main` HEAD `e24914438934c8305fb4a4560c052dc2dc029675`)
**Last reviewed:** 2026-07-29

**Related documents:**
- Full join field allowlist decision record — [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join import-readiness design (contract) — [`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md)
- Identity grain & data contract (CN1) — [`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)
- Import & staging persistence contract — [`br-receita-cnpj-import-staging-contract.md`](./br-receita-cnpj-import-staging-contract.md)
- Privacy-safe import eligibility design — [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)
- Legal/privacy review package — [`br-receita-cnpj-legal-privacy-review.md`](./br-receita-cnpj-legal-privacy-review.md)

> This document is a **decision record proposed for owner review**. It proposes, for GATE-4, an
> identity grain for the future Receita CNPJ full join dry-run and the eventual snapshot shape it
> implies. It **does not approve GATE-4**, does not move GATE-4 out of `not_started`, and does not
> substitute for the data architecture owner or the product owner who jointly approve it. Nothing here
> authorizes — and nothing here should be read as authorizing — a runner, script, package change,
> migration, index change, dataset download, full-dataset processing, full join execution, import,
> Supabase write, production write, runtime change, adapter/validator change, provider call, HubSpot
> sync, Slack notification, live generation, full expansion, or merge to an operational state.
> **This document proposes an identity grain; it approves none of it.**

---

## 1. Purpose

BR-SOURCE-10L recorded GATE-4 at `not_started` / `partial_evidence_collected`: the four options exist
on the record, the import-staging default and its rationale exist, and the physical unique-index
caveat is documented as unresolved — but **no explicit choice among A / B / C / D has ever been
recorded**, no deterministic `record_identity_key` strategy exists, and the deduplication,
enrichment, snapshot-shape, physical-index, and Agent 1 consequences of a grain choice have never
been stated ([gate evidence packet § 8](./br-receita-cnpj-full-join-gate-evidence-packet.md)).
BR-SOURCE-10M then closed the field-universe question in proposal form and named GATE-4 as its own
recommended successor ([10M § 20](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)),
because GATE-4 is the next node on the 10L § 13 critical path (GATE-1 → GATE-3 → GATE-4 → GATE-5) and
is, like GATE-3, a decision a docs-only milestone can genuinely prepare rather than an approval act
only a legal owner can perform.

BR-SOURCE-10N supplies that missing artifact in the only form a docs-only milestone can: a
**proposal, assembled and labelled completely, submitted for the named owners' review**. It evaluates
all four options explicitly, recommends exactly one, names the rejected and deferred options with
their rejection justified, proposes a conceptual `record_identity_key` shape while leaving the
concrete construction blocked, and states the consequences for deduplication, enrichment, the future
`source_company_snapshots` shape, the physical index situation, and future Agent 1 consumption.

Where the underlying question is genuinely open — above all the `normalized_tax_id` survival item
that 10M left in `needs_legal_review` — this record **states how it proceeds under that openness**
rather than resolving it by engineering preference. That is the 10M § 20 caveat applied to itself.

This document does **not**:

- **approve GATE-4**, move GATE-4 to `approved`, or substitute for either named approver;
- grant legal or privacy approval;
- replace the data architecture owner or the product owner;
- implement code, a runner, or a script;
- modify code, scripts, or package manifests;
- create a runner or a command;
- execute a full join;
- process the full or real dataset;
- import data;
- write to Supabase;
- create or modify a migration;
- create, drop, or modify an index;
- change the physical schema;
- connect the runtime;
- connect Agent 1;
- touch HubSpot / Slack / providers / UI;
- approve the field allowlist (GATE-3) or freeze the report schema (GATE-5);
- mark Brazil ready for anything.

If, at any point, this milestone concluded that it required code, scripts, package changes,
migrations, index changes, real execution, or a real GATE-4 approval to proceed, the correct action is
to **stop and escalate**, reporting
`BRSOURCE10N_SCOPE_ESCALATION_CODE_OR_GATE_APPROVAL_NOT_ALLOWED`. This document reaches no such
conclusion: a grain decision is fully expressible as prose plus an option comparison, and every
option can be evaluated without adopting it, without persisting anything, and without touching a
schema.

---

## 2. Current official baseline

The company-discovery / eligibility / readiness / approval / evidence / allowlist line for Receita
CNPJ is official and merged as follows (design and governance of record; none is an operational
authorization):

- **BR-SOURCE-10I — full join import-readiness design is official.** Defines the allowed local
  processing envelope, the § 5 join-key treatment (the root is a *technical key only* — never a
  record identity, never reportable, never an import attribute), the three-category post-join field
  survival contract, the § 7 record-identity decision gate with the four options, and GATE-1 … GATE-8.
  Decides no grain ([full join readiness design](./br-receita-cnpj-full-join-import-readiness-design.md)).
- **BR-SOURCE-10J — full join dry-run technical design is official.** Lowers that contract into an
  executable-in-the-future design, restates the four options in § 14, and carries
  `record_identity_grain_decision: "not_decided"` in the § 12 report contract
  ([full join technical design](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **BR-SOURCE-10K — full join approval gates checklist is official.** Makes GATE-4 approvable:
  required evidence (all four options evaluated explicitly), the joint approver roles (**data
  architecture owner and product owner**), pass criteria (exactly one option named, trade-offs
  documented, no contradiction with CN1 or the persistence layer, a deterministic key derivable
  without printing or persisting a prohibited identifier), fail criteria (an inherited default, two
  grains mixed in one key, a non-deterministic key, a key requiring a prohibited identifier in
  output, an unreconciled index conflict), and an *Allows* clause limited to designing the future
  runner's identity contract
  ([approval gates checklist § 8](./br-receita-cnpj-full-join-approval-gates-checklist.md)).
- **BR-SOURCE-10L — full join gate evidence packet is official.** Records GATE-4 as `not_started` /
  `partial_evidence_collected`, enumerates the seven missing evidence items, and places GATE-4 on the
  § 13 critical path ([gate evidence packet § 8, § 13](./br-receita-cnpj-full-join-gate-evidence-packet.md)).
- **BR-SOURCE-10M — full join field allowlist decision record is official.** Proposes the GATE-3
  field allowlist as a six-category lifecycle model, labels every field family, proposes `raw_data`
  prohibited by default, and states explicitly that it **narrows the field universe available to
  GATE-4 without choosing among the options**
  ([field allowlist decision record § 12](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)).

Also carried in, unchanged: **10E** (privacy-safe bounded dry-run classifier), **10F** (eligibility &
legal-nature calibration — legal nature is a classification signal, never an import authorization),
**10G** (bounded company↔establishment join dry-run, join key ephemeral in memory only), **10H**
(bounded join coverage strategy, `coverage_is_representative` always false), and the
**BR-SOURCE-10C** headerless real-file support.

Flag state carried into this document, unchanged:

```
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL   = true
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL      = true
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL  = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL          = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL           = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                      = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL           = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL         = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL      = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL                 = true
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
raised in § 6, § 7, or § 14 as a review item rather than resolved by this document's authority.

---

## 3. Decision status

```
Decision record status: proposed_for_owner_review
GATE-4 official status: not_started / not approved
Current GO / NO-GO:     NO-GO
```

Rules attaching to that status:

- **This proposal may serve as GATE-4 evidence.** It is precisely the artifact the 10K § 8 *Expected
  artifacts* clause and the 10L § 8 *Artifacts required to reach `ready_for_review`* clause name as
  missing: a recorded identity-grain determination naming the chosen option, the rejected options,
  and the consequences.
- **This proposal does not approve GATE-4.** Only the data architecture owner and the product owner,
  jointly, can — and only outside this document, recorded with the
  [10K § 14 approval template](./br-receita-cnpj-full-join-approval-gates-checklist.md).
- **This proposal does not move GATE-4 to `ready_for_review` either.** Submission and acceptance are
  separate recorded acts (10L § 3). Assembling the artifact is not submitting it.
- **This proposal does not enable runner code.** 10K § 4 forbids writing any full-join code —
  including scaffolding, "harmless" stubs, or a runner behind a disabled flag — until all eight gates
  are approved. An approved GATE-4 alone would not lift that; its *Allows* clause covers **designing**
  the future runner's identity contract and nothing more (10K § 8).
- **This proposal does not enable a migration or an index change.** 10K § 8 *Does NOT allow* creating
  or modifying a migration, writing snapshots, or changing the physical schema. § 8 of this record
  identifies where a migration *would* be needed under one of the two key constructions; identifying
  it is not authorizing it.
- **This proposal does not enable full join execution.** GATE-1 is the blocker for all execution and
  is unapproved.
- **This proposal does not enable import.** Import requires a later, separate import authorization
  that no gate in this series grants (10K § 15).
- **An approved grain would be a *contract target*, never a writer authorization.**
- **Any sensitive leak resets GATE-4's evidence** to `evidence_not_collected` and the gate to
  `not_started` (10K § 4; 10L § 3), invalidating this proposal along with it.

---

## 4. Why a grain decision is needed at all

Receita CNPJ exposes **two grains natively**, and a full join makes the choice unavoidable
(10I § 7; 10J § 14):

- **Empresa / root grain** — one record per legal entity root, carrying the company-level context
  (legal nature, porte, capital social) published in the company file.
- **Estabelecimento grain** — one record per operational unit (headquarters plus branches), which is
  where coarse location, activity codes, registration status, and opening date live, and which
  carries **no** legal nature of its own.

Three facts make this a decision rather than a formality:

- **The two grains disagree in substance, not only in cardinality.** Two establishments of one legal
  entity can differ in UF, municipality, principal activity, registration status, and opening date.
  Collapsing them loses those differences; ignoring the company context loses the legal-nature signal
  that the eligibility classifier depends on (10F; eligibility design § 4).
- **The structural root is the join key, and the join key is not an identity.** 10I § 5 states it
  directly: the root "is **not** a record identity, **not** a reportable field, and **not** an import
  attribute", it may not be printed, persisted, hashed, or logged, and it must be discarded on
  completion and on failure. Any grain option that turns the join key into the record identity
  collides with that rule head-on. This is a structural objection, not a preference.
- **An inherited default is a recorded fail.** The import-staging contract § 4 states the
  establishment / full-CNPJ row grain as the intended grain, and CN1 § 3.2 records the `TAX_GRAIN`
  classification with `record_identity_key` derived from the normalized full identifier. Both are
  *documented intentions*. 10K § 8 names "we already default to A" as an explicit **fail** criterion:
  an inherited decision is not a recorded one. GATE-4 must therefore be decided on its merits, with
  the alternatives evaluated, even if the outcome happens to align with the documented default.

---

## 5. Identity grain options under review

The four options are those recorded in [10I § 7](./br-receita-cnpj-full-join-import-readiness-design.md)
and [10J § 14](./br-receita-cnpj-full-join-dry-run-technical-design.md), restated verbatim in scope:

```
A. Establishment grain
   record_identity_key per estabelecimento / operational unit
   (the import-staging § 4 documented default)

B. Company / root grain
   record_identity_key per empresa / root

C. Dual snapshots
   separate snapshots for empresa/root and for estabelecimento

D. Single operational snapshot
   estabelecimento as the operational unit, empresa/root as context
```

Each option below is evaluated on the same ten axes required by 10K § 8 and 10L § 8. No axis is
skipped, and no option is dismissed without a stated reason.

### 5.1 Option A — Establishment grain

**Description.** One snapshot row per operational unit. `record_identity_key` is derived from the
establishment's own fiscal identifier. This is the grain CN1 § 3.2 records as `TAX_GRAIN` and the
import-staging contract § 4 states as the canonical row grain. Option A, **as stated**, decides the
key grain and says nothing about whether company-level context travels with the row.

**Advantages.**

- Matches the dataset's natural grain: the establishment file is one row per operational unit, so the
  `TAX_GRAIN` invariant ("one fiscal identity → at most one row" per the source-family registry)
  holds exactly, with no multiplicity probe needed (CN1 § 3.2).
- The establishment identifier is the identity Brazilian companies actually transact and are matched
  under, which is what makes cross-system matching against accounts and CRM records correct
  (CN1 § 3.2).
- Reuses the existing tax-grain read contract and the record-identity conflict target without
  inventing a new derivation (CN1 § 3.2, § 6; staging § 11).
- Requires no new physical grain and no discriminator column, therefore no migration on grain
  grounds alone.

**Risks.**

- **Silent on company context.** Establishment rows carry no legal nature (10I § 7). A grain decision
  that stops at the key leaves open whether the eligibility classifier will have the company context
  it needs — and eligibility is fail-closed, so a record without company context cannot advance
  (10I § 8). Adopting A without adding a context contract would leave the most consequential part of
  the shape undecided.
- **Indistinguishable from inheritance.** A is the documented default, so choosing A *as stated* is
  exactly the shape 10K § 8 rejects unless the record adds what the default leaves silent.
- **Inherits the key-construction question whole.** If the key is derived from the normalized full
  identifier, it embeds the fiscal identifier in a persisted column, which is the open
  `normalized_tax_id` item (10M § 10) reasserted at the identity layer (§ 7).

**Deduplication impact.** Dedup by establishment identity, never by root, never by name (staging
§ 4). Correct at the fiscal layer; but N branches of one legal entity are N distinct rows, so any
consumer that treats one row as one commercial account will over-count. A does not state a rule for
that.

**Enrichment impact.** Establishment-level signals (coarse location, activity, status) available;
company-level attributes absent from the row unless a consumer joins them at read time, which A does
not specify.

**Future `source_company_snapshots` impact.** Single-grain table, consistent with the documented
persistence contract (staging § 5). No new grain to reconcile.

**Agent 1 future impact.** Risk of over-generation: multiple branches of one company appear as
multiple candidates unless a rollup discipline exists. A states none.

**`normalized_tax_id` impact.** Under the CN1 construction, the key and `normalized_tax_id` carry the
same value, so both conflict paths agree (CN1 § 6; staging § 4, § 11) — and both inherit the same open
legal question.

**GATE-3 dependency.** Requires the normalized full identifier to be allowlisted for persistence.
10M § 15 labels it `needs_legal_review`. Blocked.

**Import-authorization dependency.** Full: no row may be written without a separate future import
authorization (10K § 15).

### 5.2 Option B — Company / root grain

**Description.** One snapshot row per legal entity root. `record_identity_key` is derived from the
structural root, and establishments are not represented as rows at all.

**Advantages.**

- One row per legal entity matches the naive "one company = one account" intuition and produces the
  smallest row count.
- The company-level attributes published at root grain (legal nature, porte, capital social) sit
  naturally on the row with no join required, which would simplify the classifier input.
- Company-level rollups are trivially first-class.

**Risks.**

- **It requires the join key to become the record identity, which every upstream document
  forbids.** 10I § 5 states the root is "not a record identity", may not be persisted, may not be
  printed, may not be hashed, and must be discarded on completion and failure; 10G / 10H treat it as
  ephemeral in-memory material only; 10M § 15 places the root in category B (temporary technical
  only) for the join-key surface and category A (forbidden always) for output surfaces. B cannot be
  adopted without first reversing that rule, which is a legal/privacy act and not a grain decision.
  **This objection alone is disqualifying for B on the current record.**
- **The root is not a transacting fiscal identity.** CN1 § 3.3 already evaluated and **rejected**
  root-as-identity, on the ground that the root alone is not how companies are matched in practice
  and that using it would degrade dedup against accounts and CRM records. Adopting B would
  contradict CN1, which 10K § 8 names as a fail criterion ("no contradiction with the identity/data
  contract (CN1)").
- **It collapses genuinely different units.** Branches differing in UF, municipality, activity, and
  registration status would share one verdict, so an ineligible unit and an eligible unit merge. For
  a fail-closed classifier this is the worst direction of error: it either suppresses eligible units
  or admits ineligible ones, and the record cannot say which without inspecting the units it just
  collapsed.
- **It changes the source family classification.** B implies either a redefinition of
  `normalized_tax_id` to the root, or a move to a native-record grain family with the multiplicity
  complexity CN1 § 3.3 declined. Either is a contract change well beyond GATE-4's *Allows* clause.

**Deduplication impact.** Over-merges. A branch in another state disappears into its root. Dedup
against existing accounts, which key on the full establishment identifier, degrades (CN1 § 3.3).

**Enrichment impact.** Loses every establishment-level signal — precisely the coarse location and
activity signals the classifier uses.

**Future `source_company_snapshots` impact.** Would require redefining the meaning of
`normalized_tax_id` for this source, and therefore a reconciliation with the physical unique index
(staging § 5, § 11). Not authorized.

**Agent 1 future impact.** Under-generation and loss of operable units: the operable thing is the
unit, not the abstract root.

**`normalized_tax_id` impact.** Direct conflict: B would set it to the root, contradicting CN1 § 3.2
and § 3.4.

**GATE-3 dependency.** Requires the root to leave category B for persistence, which needs a joint
GATE-2 / GATE-3 decision (10M § 10) and, in practice, a GATE-1 determination.

**Import-authorization dependency.** Full, and additionally a reversal of the join-key rule.

### 5.3 Option C — Dual snapshots

**Description.** Two record families: one at root grain, one at establishment grain — either as two
row populations under one source key, or as two separate source keys.

**Advantages.**

- Lossless: each grain keeps its native attributes without denormalization, and company-level
  aggregates are first-class rather than derived.
- Cleanly separates "what the legal entity is" from "where it operates", which is a defensible
  modelling instinct for a registry with two published grains.

**Risks.**

- **Two grains in one physical table under one source key is a recorded fail.** 10K § 8 lists "two
  grains mixed inside a single key" as a fail criterion. Avoiding that requires either a distinct
  source key per grain or a discriminator column — and a discriminator column is a **migration**,
  which nothing in this line authorizes (10K § 8 *Does NOT allow*).
- **It breaks the tax-grain invariant.** Two rows per fiscal identity within one snapshot period
  contradicts "one fiscal identity → at most one row"; the existing read path probes for multiplicity
  and treats it as an invariant violation rather than truncating (CN1 § 6). C would make that
  invariant fire by design.
- **It still needs the root persisted as an identity** for the company family, so it inherits B's
  disqualifying objection for half of the model.
- **It doubles every downstream contract**: two writers, two read paths, two idempotency rules, two
  conflict targets, and a consumer rule for which family to read. None of that import design exists,
  and GATE-4 cannot create it.
- **Ambiguity risk at the consumer layer.** A consumer that reads the wrong family, or both, would
  double-count. The failure mode is silent.

**Deduplication impact.** Ambiguous unless the family is part of every dedup rule; double-counting is
the default failure.

**Enrichment impact.** Best-case coverage, worst-case double enrichment of the same entity through
two rows.

**Future `source_company_snapshots` impact.** Largest of the four: either a new source key or a
schema change, plus an index reconciliation on top of the one already unresolved (staging § 5, § 11).

**Agent 1 future impact.** Requires an explicit family-selection rule before Receita could be
consumed at all.

**`normalized_tax_id` impact.** Two different meanings for one column within one source, which is
exactly the kind of drift the allowlist discipline exists to prevent.

**GATE-3 dependency.** Same as B for the company family, plus A's for the establishment family.

**Import-authorization dependency.** Full, plus an import design that does not exist.

### 5.4 Option D — Single operational snapshot (establishment as operational unit, company as context)

**Description.** Exactly **one** row per operational unit — the same physical grain as A — with the
company-level attributes carried on that row as **context** inside the allowlisted payload, and with
the structural root **never** persisted as an identity and never treated as a record key. Root-level
grouping is a **read-time projection** over derivable material, not a stored key. This is the shape
CN1 § 4 already describes: no separate company row, company attributes joined onto each unit,
root-level rollup deferred to whenever a consumer needs it.

**How D differs from A — the crux.** A decides the key grain and stops. D decides the key grain
**and** three things A leaves silent:

1. **company context is mandatory on the row**, so the fail-closed eligibility classifier always has
   the legal-nature and company-level signals it needs (10I § 8; 10F);
2. **the root is never an identity and never persisted as one**, which keeps 10I § 5 intact rather
   than reopening it;
3. **root-level grouping is a read-time projection**, which states the consumer rule that A's
   over-counting risk requires.

That is why recommending D is not the same act as inheriting A: it records what the default leaves
undecided, and it does so with B and C evaluated and rejected on the record.

**Advantages.**

- Preserves the natural grain and the tax-grain invariant exactly (CN1 § 3.2).
- Keeps a **single-grain** table: no discriminator, no second family, and therefore **no migration on
  grain grounds**.
- Guarantees company context is present, so eligibility can actually be evaluated and the
  person-risk exclusions (natural-person-equivalent legal natures, MEI / individual entrepreneur) can
  be applied at the point of classification rather than inferred later (10F; eligibility design § 4).
- Does **not** require the join key to become an identity — the single objection that disqualifies B
  and half of C.
- Preserves unit-level differences: UF, municipality, activity, registration status, and opening date
  survive per unit rather than being collapsed.
- Consistent with CN1 § 3.2 / § 4 and with the persistence contract § 4 / § 5 / § 11, satisfying the
  10K § 8 pass criterion of "no contradiction with the identity/data contract (CN1) or the
  import-staging contract's persistence layer".

**Risks.**

- **Denormalization restates company context across units.** A company-level attribute appears once
  per unit. This is acceptable under the existing period model — snapshots are period-scoped and a
  period change creates a new row rather than overwriting (staging § 7, § 11) — but it means a
  company-level correction is only reflected on the next snapshot, and the owners should confirm they
  accept that staleness window.
- **Combination-based identifiability.** Unit-level coarse location plus a narrow activity code plus
  company context can, in the limit, narrow to a single natural-person-equivalent entity. 10M § 10
  already records this as a `needs_legal_review` item ("any field that can indirectly identify a sole
  proprietor or a person-risk entity"). **D does not resolve it**, and D's context requirement makes
  it *more* live rather than less, because more attributes co-occur on one row. This is the most
  important risk D carries and it is stated here rather than minimised.
- **Over-generation is mitigated but not eliminated.** A read-time rollup rule is stated as a
  requirement, not implemented; until a consumer honours it, N units of one company remain N rows.
- **The key-construction question stays open** (§ 7), and with it the physical-index consequence
  (§ 8).

**Deduplication impact.** By unit identity, never by root, never by name. Root grouping is a
projection over derivable material rather than a stored key, so grouping never becomes an identity by
the back door. A future dedup rule **must not** treat N unit rows as N commercial accounts by
default; stating that rule is part of what GATE-4 would approve, and implementing it is not.

**Enrichment impact.** Per-unit signals plus company context, both bounded by whatever GATE-3
approves. Nothing beyond the allowlist becomes available merely because the grain changed.

**Future `source_company_snapshots` impact.** One row per unit; company attributes inside the typed
allowlisted payload if — and only if — GATE-3 approves them; the root **not** persisted as an
identity. See § 8 for the mapping and § 9 for the index consequence.

**Agent 1 future impact.** The operable object is the unit, which is what a future enrichment or
validation path would need; the company context prevents a unit from being evaluated in a vacuum.
No integration is authorized (§ 12).

**`normalized_tax_id` impact.** D is **compatible with either resolution** of the open
`normalized_tax_id` item, which is a genuine advantage over A: if the column may carry the normalized
unit identifier, the CN1 construction applies and both conflict paths agree; if it may not, D still
holds as a shape, with a surrogate key and a different index consequence (§ 7, § 9). D therefore does
not force the open legal question to be answered a particular way in order to be adoptable.

**GATE-3 dependency.** The company-context fields (legal nature, porte, capital social) and the
unit-level signals must be allowlisted before they may be persisted; 10M labels several of them
`blocked` and others `needs_legal_review`. Blocked.

**Import-authorization dependency.** Full: no row may be written without a separate future import
authorization.

---

## 6. Recommended proposed decision

```
Recommended proposed decision:
D. Single operational snapshot — establishment as the operational unit,
   with company / root as context.
```

Reasoning, in the order the owners should test it:

- **Receita publishes company context and operational units as two grains; the operable object is the
  unit.** A registry model that keeps only the abstract root cannot express where a company actually
  operates.
- **A future Agent 1 needs operable companies, not abstract roots.** Whatever consumption is
  eventually authorized, the thing that can be validated or enriched is the unit.
- **Units genuinely differ** in UF, municipality, activity, registration status, and opening date, so
  collapsing them destroys the signals the classifier uses.
- **One operational row per unit** preserves the natural grain, the tax-grain invariant, and the
  single-grain table.
- **Company context is retained rather than discarded**, so the fail-closed eligibility evaluation is
  possible at all and the person-risk exclusions can be applied where they belong.
- **It avoids collapsing multiple units into one root identity**, which is the failure mode B and C
  both carry.
- **It never requires the join key to become a record identity**, keeping 10I § 5 intact.
- **It reduces ambiguity for deduplication and enrichment** by stating the grouping rule as a
  read-time projection instead of leaving it implicit.
- **It requires no migration on grain grounds** — the single-grain table already matches.

Two honest qualifications, so the recommendation is not read as stronger than it is:

- **D inherits the two open items rather than solving them.** The `normalized_tax_id` survival
  question (10M § 10) and the indirect-identifiability question remain open, and D's context
  requirement makes the second one more live, not less (§ 5.4).
- **D is A plus a context contract, not a different physical grain.** The owners should reject D if
  they judge that the context requirement is not worth the denormalization and combination risk — in
  which case A-with-no-context or C become live again, and the reasons they were set aside are on the
  record in § 5 and § 13.

```
This is a recommendation for owner review, not an approval.
```

---

## 7. Proposed `record_identity_key` shape

The shape is proposed **conceptually**; the concrete algorithm and its exact inputs remain blocked.

**Conceptual shape.**

```
record_identity_key = "br_receita_establishment:<stable_non_printable_establishment_surrogate>"
```

**Required properties of any construction, under any option.**

- **Deterministic** — the same source unit in the same period yields the same key on every run
  (10K § 8 pass criterion; staging § 11 idempotency).
- **Single-grain** — one operational unit → exactly one key. Never a mixed key, never a composite of
  two grains (10K § 8 fail criterion).
- **Namespaced by source and grain** — so the grain is legible from the key itself and a future
  second grain cannot silently reuse the namespace.
- **Never printed, never logged, never in an error, never in a count key, never in a file name or
  path, and never in the aggregate report** — the key is not reportable material at any granularity
  (10I § 5; 10J § 8.5; 10M § 5).
- **Derivable without printing or persisting a prohibited identifier** (10K § 8 pass criterion).

**Two candidate constructions, both blocked, with their trade-offs stated.**

- **Construction 1 — CN1 inheritance.** The key payload is the normalized full unit identifier, as
  CN1 § 3.4 and the persistence contract § 4 record. *Advantage:* the key and `normalized_tax_id`
  carry the same value, so the record-identity and legacy fiscal conflict paths agree and **no new
  index is required** (§ 9). *Blocker:* the key then embeds the fiscal identifier in a persisted
  column, which is exactly the `normalized_tax_id` survival item that 10M § 10 labels
  `needs_legal_review`, and it sits against 10I § 5's statement that the full identifier is
  categorically non-persistible without separate approval. **Cannot be adopted while that item is
  open.**
- **Construction 2 — namespaced surrogate.** The key payload is a stable surrogate rather than the
  identifier itself. *Advantage:* the identifier does not appear in the key. *Blocker, stated
  plainly:* if the surrogate is a **hash, truncation, or fingerprint of the identifier**, it is a
  *derived value of an identifier*, which 10M § 5 places in category A — prohibited **anywhere**. A
  hash-based surrogate is therefore **not** automatically the safer option, and proposing it as a
  privacy workaround would be wrong. The only surrogate that escapes that objection is one whose
  derivation is itself approved under GATE-1 and GATE-3. *Second cost:* a surrogate that differs from
  `normalized_tax_id` makes the two conflict paths disagree, which forces the index question (§ 9).

**Explicitly not proposed.**

- **Not** printing the full unit identifier, in any surface.
- **Not** printing the structural root, in any surface.
- **Not** hashing an identifier for a report, a log, an error, a count key, or a file name.
- **Not** using any real value in a report, a log, or a document.

**Three surfaces, kept separate.**

```
internal deterministic identity construction
    — future import only, if ever approved; never a report surface

report output
    — the key never appears, nor any component of it, nor any value derived from it

dry-run aggregate report
    — counts only (units seen, units joined, units missing company context, bucket counts)
```

**Recommended safe posture.**

> The conceptual shape of `record_identity_key` is proposed. The **concrete algorithm and its exact
> inputs remain blocked** until GATE-1 (Legal/Privacy), GATE-3 (Field allowlist), GATE-4 (owner
> approval of the grain), GATE-5 (Output sanitization), and a future separate import authorization
> all exist. Until then the future report marker stays `record_identity_grain_decision: "not_decided"`
> (10J § 12).

---

## 8. Relationship with `normalized_tax_id`

```
record_identity_key ≠ normalized_tax_id
```

**`record_identity_key`**

- The identity-grain key for source snapshot conflict resolution and idempotency.
- Must be **deterministic** if a future import is ever approved.
- **Not reportable** in dry-run aggregate output, at any granularity, in any derived form.
- Its meaning is defined by the grain, which is what GATE-4 decides.

**`normalized_tax_id`**

- A **fiscal matching** field, used for cross-system matching — not an identity-grain definition.
- May end as null, excluded, or separately approved; it **does not define the grain by itself**.
- Remains **`needs_legal_review`** per 10M § 10 and § 15 — the single largest open item in the field
  allowlist proposal.

**Why the two are coupled today, and what that means for GATE-4.** For this source under
construction 1 the two carry the same value, which is exactly what makes the record-identity path and
the legacy fiscal path agree (CN1 § 6; staging § 4, § 11; 10L § 8). That agreement is a **consequence
of a construction choice**, not a property of the grain. Two consequences follow, and both belong in
front of the approvers:

- **A grain change would break that agreement**, and 10L § 8 requires the record to say so
  explicitly. Under D the agreement survives if construction 1 is used and dissolves if construction
  2 is used.
- **The two open questions are coupled.** If the `normalized_tax_id` item resolves to *excluded*,
  construction 1 becomes unavailable and construction 2 becomes mandatory — which in turn makes the
  index question (§ 9) mandatory too. GATE-4 can be approved as a **grain** decision while that
  coupling is unresolved, provided the approval records that the **key construction is deferred**.
  What GATE-4 cannot do is pick construction 1 and treat the legal question as answered by
  implication.

---

## 9. Relationship with `source_company_snapshots`

**Future possible row, if — and only if — an import is ever authorized:**

```
source_key           — fixed literal for this source
country_code         — fixed literal BR
source_year          — explicit input, never hardcoded
source_period        — publication period
record_identity_key  — per the grain GATE-4 approves; construction deferred (§ 7)
normalized_tax_id    — only if approved (10M § 10 needs_legal_review)
raw_data             — minimal typed allowlist, only if approved
                       (10M § 11 proposes prohibited by default)
```

**Explicit limits on that mapping.**

- **No writes are authorized.** Not to `source_company_snapshots`, not to any table.
- **No migration is authorized.**
- **No index change is authorized** — no index created, dropped, altered, or validated.
- **The physical index situation remains unresolved**, exactly as already documented: the earlier
  migration provides a physical unique constraint on the fiscal tuple, while the later additive
  migration added `record_identity_key` as nullable, `NOT VALID`, and **not** unique; which target a
  future writer would upsert on must be confirmed against the active schema before any write
  (staging § 5, § 11; 10L § 8).
- **The reconciliation this record can offer is conditional, and it is the useful finding here:**
  under **D with construction 1**, the key and the fiscal column carry the same value, so the
  existing fiscal unique constraint remains a valid conflict target and **no new index is needed**.
  Under **D with construction 2**, the two disagree, and a `record_identity_key` unique index would
  be **required** — which is a **migration**, and therefore outside GATE-4 entirely. The owners
  should note the shape of that trade-off: the more conservative-looking key construction carries the
  larger schema cost, and neither GATE-4 nor this record can authorize it.
- **No free-form columns.** A future writer builds explicitly from the approved allowlist and drops
  every extra key — the discipline the persistence contract § 5 records after the historical
  schema-mismatch incident. Nothing in this record contemplates any other construction pattern.

---

## 10. Deduplication impact

Under the recommended grain:

- **Dedup is by operational unit identity** — never by root, never by name (staging § 4).
- **Multiple units of one legal entity are detectable and distinguishable**, so a branch in another
  state is neither lost nor merged into its headquarters.
- **Units with different locations or activities are not collapsed**, so a fail-closed eligibility
  verdict applies to the unit it was computed for.
- **A future dedup rule must understand company/root context** — and must **not** treat N unit rows
  as N commercial accounts by default. Root-level grouping is available as a **read-time projection**
  over derivable material; it is never a stored key and never an identity.
- **The root is never the commercial identity.** That is CN1 § 3.3's recorded rejection, and this
  record does not reopen it.

```
Dedup rules are not implemented here.
No Agent 1 routing change.
No HubSpot matching change.
No account or contact matching change.
No existing dedup code is modified, and none is authorized.
```

---

## 11. Enrichment impact

- **Enrichment may use unit-level signals** — coarse location, activity, registration status,
  opening-date bucket — strictly within whatever GATE-3 approves.
- **Company/root attributes serve as context**, not as the enrichment target.
- **Contact and person decisions stay entirely out of scope.** No sócios / QSA / natural-person
  identifiers, ever (10I § 6.1; staging § 15). No fine-grained address. No names or person data
  beyond what GATE-3 might approve, and 10M leaves sanitized legal and trade names at
  `needs_legal_review`.
- **No runtime lookup yet.** Nothing in this record connects Receita to any runtime enrichment path.
- **The grain does not widen the field set.** Choosing a grain changes which row a field would sit
  on; it does not make any field available. Every field remains bounded by GATE-3.

---

## 12. Agent 1 future impact

If Agent 1 consumption is ever authorized, Receita should be treated as **enrichment and validation
context**, not as a live discovery provider. That posture is inherited, not new: company discovery
providers are gated separately, and nothing in the Brazil line has ever proposed Receita as a
discovery source.

The proposed grain helps avoid three specific failure modes:

- **pretending a legal-entity root is always one commercial account** — which over-merges and hides
  operable units;
- **losing unit-level signals** — which is what a root-grain model does by construction;
- **mixing units with different locations, statuses, and activities into a single verdict** — which
  makes a fail-closed classifier unsound.

But, stated without hedging:

```
No Agent 1 integration is authorized.
No runtime enrichment is authorized.
No prospect generation is authorized.
No routing, provider, or resolver change is authorized.
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 13. Rejected or deferred options

None of these is final until owner review; each is set aside with its reason on the record, which is
what 10K § 8 requires.

**A — Establishment grain alone: deferred.** Not wrong at the key layer — it is the same physical
grain D proposes — but **as stated it is silent on company context**, so it leaves the eligibility
input, the over-counting rule, and the root-is-not-an-identity restatement undecided. Choosing A
without those additions would also be indistinguishable from inheriting the documented default, which
10K § 8 names as a fail. A is therefore **superseded by D rather than rejected on the merits**: D is A
plus the missing contract.

**B — Company / root grain alone: rejected for the future operational snapshot.** Three independent
reasons, any one of which is sufficient:

- it requires the **join key to become the record identity**, which 10I § 5, 10G, 10H, and 10M § 15
  all forbid;
- it **contradicts CN1 § 3.3**, which already evaluated and rejected root-as-identity because the root
  is not a transacting fiscal identity and using it degrades dedup;
- it **collapses units** that differ in location, activity, and status into a single verdict.

**C — Dual snapshots: deferred.** Not incoherent as a model, but it increases schema and operational
complexity beyond what any approved gate covers: it needs either a second source key or a
discriminator column (**a migration**), it would make two rows share one fiscal identity against the
tax-grain invariant, it inherits B's join-key objection for the company family, and it requires an
import design — two writers, two read paths, two idempotency contracts, and a consumer
family-selection rule — that does not exist and that GATE-4 cannot create.

```
None of the above is definitive until the data architecture owner and the product owner review it.
A rejection recorded here is a proposed rejection, not an approved one.
```

---

## 14. Blocking dependencies

**GATE-1 — Legal/Privacy.** Must approve the legal and privacy handling of fiscal identifiers and
structural keys — including whether the normalized unit identifier may be persisted at all, and
whether a derived surrogate is permissible and on what basis. Until then **no** key construction is
adoptable and **nothing executes**.

**GATE-3 — Field allowlist.** Must approve which fields are available to build an identity from and
to carry as company context. 10K § 7 confines GATE-4's material to allowlisted fields, and 10L § 13
states it as a rule: *a key may only derive from allowlisted material*. 10M's proposal is
`proposed_for_owner_review`, so that material is not yet closed.

**GATE-5 — Output sanitization.** Must ensure identity keys, their components, and any value derived
from them never leak into a report, a log, an error, a stack trace, a count key, or a file name — and
must express each rule as an **enforceable assertion**, which prose is not (10K § 9; 10L § 9).

**GATE-8 — No-write / no-runtime.** Must ensure no identity decision becomes a write path. An
approved grain authorizes designing the identity contract and nothing else (10K § 8 *Allows*); the
safety block stays all-false regardless of what the grain is:

```
import_executed     = false
supabase_write      = false
runtime_integration = false
agent1_integration  = false
persisted_rows      = 0
```

**Additional dependencies specific to this gate.**

- **A separate future import authorization**, which no gate in this series grants (10K § 15).
- **The physical index reconciliation** (§ 9), which under construction 2 would require a migration
  that nothing here authorizes.
- **GATE-2**, indirectly: the root may exist in memory as an ephemeral join key, and whether it may
  exist in temporary storage at all is an open joint GATE-2 / GATE-3 question (10M § 10). A grain
  decision does not touch it.

---

## 15. Proposed GATE-4 review checklist

For the **data architecture owner and the product owner, jointly** (10K § 8). Either may reject
alone; approval requires both. Neither may be an implementing agent or the author of this record.

- [ ] **Confirm the recommended option D, or select A, B, or C instead** — exactly one option, named
      explicitly (10K § 8 pass criterion).
- [ ] **Confirm the grain semantics**: whether `record_identity_key` is establishment-grain,
      root-grain, dual, or operational-with-company-context — and, if D, confirm that the company
      context requirement and the read-time-projection rule are part of the decision, not optional
      commentary.
- [ ] **Confirm the deterministic construction rules** (§ 7): determinism, single grain, source-and-
      grain namespacing, and derivability without printing or persisting a prohibited identifier.
- [ ] **Decide whether the key construction is approved now or explicitly deferred** — and, if
      deferred, confirm that `record_identity_grain_decision` stays `"not_decided"` until it is
      closed.
- [ ] **Confirm that no identity key, key component, or derived value is ever printed** in a report,
      a log, an error, a count key, a file name, or a path.
- [ ] **Confirm the relationship to `normalized_tax_id`** (§ 8), including the coupling: that if the
      `normalized_tax_id` item resolves to *excluded*, construction 1 becomes unavailable and the
      index question becomes mandatory.
- [ ] **Confirm the relationship to `source_company_snapshots`** (§ 9), including that the physical
      index situation remains unresolved and that creating a unique index is a **migration** this
      decision does not authorize.
- [ ] **Confirm the deduplication consequences** (§ 10), including that N unit rows must not be
      treated as N commercial accounts by default.
- [ ] **Confirm the enrichment consequences** (§ 11), including that the grain widens no field set.
- [ ] **Confirm Agent 1 remains blocked** (§ 12) — no integration, no runtime enrichment, no prospect
      generation.
- [ ] **Confirm that no migration, index change, import, or write is authorized** by this decision.
- [ ] **Confirm the combination-identifiability risk is accepted as an open GATE-1 / GATE-3 item**
      (§ 5.4) and not resolved by this grain choice.
- [ ] **Record the decision with the 10K § 14 template** — roles not identities, no sensitive values,
      rejections kept as part of the audit trail. An approval not recorded in that shape does not
      exist.

---

## 16. Current decision

```
Current decision: NO-GO
```

- This record is `proposed_for_owner_review`.
- **GATE-4 remains `not_started` / not approved.**
- **No migration may be created from this document alone** — nor any index created, dropped, or
  altered.
- **No runner code may be written from this document alone** — nor from this document plus any
  combination of the existing designs; 10K § 4 requires all eight gates approved before any full-join
  code is written.
- **No full join may be executed from this document alone.** GATE-1 blocks all execution and is
  unapproved.
- **No import may occur from this document alone**, and none may occur from a GATE-4 approval either.
- **No `record_identity_key` may be constructed, persisted, or emitted** from this document alone.
- All eight gates remain unapproved, so the 10K § 15 matrix reads **NO-GO**. That is the expected and
  correct outcome: a decision record that concluded GO would be evidence that a gate had been
  approved by inference.

---

## 17. Required flags after 10N

This document adds the decision-record flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_IDENTITY_GRAIN_DECISION_RECORD_PR_READY = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_IDENTITY_GRAIN_DECISION_RECORD_OFFICIAL = false  (not an operational authorization)

OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL   = true
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL      = true
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL  = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL          = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL           = true

OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Only when this PR is merged does the decision record become official:

```
OPS_BR_FULL_JOIN_IDENTITY_GRAIN_DECISION_RECORD_OFFICIAL = true
```

And even after that merge, Brazil stays non-operational and GATE-4 stays unapproved:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Carried forward from BR-SOURCE-10E–10M (unchanged):

```
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

## 18. Explicit non-goals

BR-SOURCE-10N does **not**:

- **approve GATE-4**, or move any gate out of `not_started`;
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
- create, drop, alter, or validate an index;
- change the physical schema;
- construct, persist, or emit a `record_identity_key`;
- integrate runtime;
- integrate Agent 1;
- touch HubSpot;
- touch Slack;
- call any provider;
- change UI;
- change parser / reader / dry-run / manifest validator / connector runtime behavior;
- change any dedup, matching, or routing rule;
- approve the field allowlist (GATE-3), the storage envelope (GATE-2), or the report schema (GATE-5);
- assign an approved `record_identity_grain_decision` value;
- advance Brazil toward production readiness.

---

## 19. Recommended next hito

**BR-SOURCE-10O — Receita full join output sanitization decision record.**

Objective of 10O: resolve **GATE-5** as a docs-only decision record, using the 10M field-allowlist
proposal and this record's grain proposal as its two inputs — a closed report schema, an exact closed
list of forbidden key names (replacing the 10J § 15 "and equivalents" tail that no test can consume),
an exact closed list of forbidden value patterns including the digit-run rules for the three
identifier lengths and the email-marker rule, a logging sanitization contract, and an error
sanitization contract. It would approve no import, write no code, create no migration, and authorize
no execution, Supabase write, index change, runtime, or Agent 1 integration.

Reasoning: GATE-5 is the next node on the 10L § 13 critical path (GATE-1 → GATE-3 → GATE-4 →
GATE-5), and 10L § 9 records that the report schema **cannot be frozen while GATE-3 and GATE-4 are
open**. With both now assembled as proposals, GATE-5 becomes the next decision a docs-only milestone
can genuinely prepare.

Three caveats attach:

- **GATE-5 cannot be *approved* by 10O either.** The security / privacy owner and the test owner
  jointly approve it, outside the document (10K § 9).
- **10O inherits both predecessors' open items** — the `normalized_tax_id` survival question, the
  indirect-identifiability question, the `raw_data` default, and this record's deferred key
  construction. It must state how it proceeds under that openness rather than resolving any of it by
  preference.
- **GATE-1 remains the true blocker for everything.** Sequencing GATE-3 → GATE-4 → GATE-5 is a
  convenience, not a route around GATE-1. Nothing executes while GATE-1 is unapproved. And 10K § 9
  makes "every rule expressed as an enforceable assertion" a pass criterion — a docs-only milestone
  can enumerate the assertions but cannot write the tests, which is code.

This is a **recommendation, not an execution**: BR-SOURCE-10N opens no such milestone and authorizes
nothing further.

---

## 20. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- download or import a dataset;
- open, read, or process the real / full dataset, or print any real file, row, full CNPJ, CNPJ básico,
  or CPF;
- modify the operator's real local manifest or include any real manifest / dataset;
- write to Supabase or perform any production write;
- create or modify a migration;
- create, drop, alter, or validate an index;
- change the parser, reader, dry-run, manifest validator, snapshot builder, join dry-run, or any
  connector runtime behavior;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- perform live generation or full expansion;
- approve any gate, record any approval, or assign an approved `record_identity_grain_decision`;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, no razão social or nome
fantasia values, no addresses, no contacts, and no partner (sócio) personal data are reproduced. No
hash, truncation, or fingerprint derived from any identifier, name, or join key appears anywhere in
this document. Every field name, key shape, and value shape referenced here is a schema name or an
explicit placeholder, never a real value. Local WIP (`scratchpad/`) is untouched by any git operation.
