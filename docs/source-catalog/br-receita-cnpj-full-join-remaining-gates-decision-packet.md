# BR-SOURCE-10PQR — Receita CNPJ remaining full join gates decision packet

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10PQR — Receita CNPJ remaining full join gates decision packet (accelerated: 10P + 10Q + 10R in one docs-only PR)
**Status:** Official decision record of record (docs-only) — `proposed_for_owner_review`; **not** a GATE-6, GATE-7, or GATE-8 approval, and **not** a build/import/dry-run/execution/migration authorization
**Predecessor:** BR-SOURCE-10O — `BRSOURCE10OLANDA — OUTPUT_SANITIZATION_DECISION_RECORD_MERGED` (PR #161, `main` HEAD `67da0ad01f85d3a278a0850ac802c44b7db58833`)
**Last reviewed:** 2026-07-29

**Related documents:**
- Full join output sanitization decision record — [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)
- Full join identity grain decision record — [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md)
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

> This document is a **decision packet proposed for owner review**. It assembles, in one docs-only
> milestone, the three remaining preparable gate contracts for the future Receita CNPJ full join
> dry-run — **GATE-6** (failure cleanup), **GATE-7** (operator runbook), and **GATE-8** (no-write /
> no-runtime enforcement) — plus a final readiness packet for the owners who must review them. It
> **approves none of them**, moves none of them out of `not_started`, and substitutes for none of the
> named approvers. Nothing here authorizes — and nothing here should be read as authorizing — a runner,
> a cleanup implementation, a guard, a sanitizer, a test, a script, a package change, a migration, an
> index change, a dataset download, full-dataset processing, full join execution, import, a Supabase
> write, a production write, a runtime change, an adapter/validator change, a provider call, a HubSpot
> sync, a Slack notification, live generation, full expansion, or merge to an operational state.
> **This document proposes three contracts and a readiness packet; it approves none of it.**

---

## 1. Purpose

BR-SOURCE-10L recorded GATE-6, GATE-7, and GATE-8 at `not_started` / `partial_evidence_collected` and
named exactly what each was missing
([gate evidence packet § 10, § 11, § 12](./br-receita-cnpj-full-join-gate-evidence-packet.md)):

- **GATE-6** — a per-failure-type cleanup matrix, a temporary-artifact manifest design, a
  quarantine-versus-delete decision, concrete cancellation / out-of-memory / disk-exhaustion /
  privacy-assertion behaviours, a cleanup verification mechanism, and a cleanup-failure escalation
  owner.
- **GATE-7** — the full-join operator runbook itself, which does not exist: a preflight that verifies
  gate status, the dry-run confirmation language, a disk and memory command set checked against
  ceilings that do not yet exist, live monitoring instructions, cleanup verification steps, report
  sensitive-scan steps, post-run deletion rules, and a final signoff template.
- **GATE-8** — a final CLI guard design with exact rejection codes, rejection ordering, and
  missing-mandatory-flag behaviour; the proofs about a code path that does not exist; and the owner
  approval of the guard.

10O closed the GATE-5 side of the same problem and named **GATE-6 as its recommended successor**
([10O § 20](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)), for two reasons it
recorded explicitly: 10O § 13 states the *output* side of failure and stops there deliberately, because
the cleanup contract itself belongs to GATE-6; and 10L § 13 records that **GATE-6 blocks GATE-7's
cleanup-verification steps**, so GATE-7 cannot be prepared before it.

BR-SOURCE-10PQR supplies all three missing artifacts in the only form a docs-only milestone can:
**proposals, assembled and labelled completely, submitted for the named owners' review**. It is
deliberately **accelerated** — the three gates that 10O's roadmap would have taken as 10P, 10Q, and 10R
are prepared in one PR, because they are the last three gates a document can genuinely prepare, and
because GATE-7's content is largely a function of GATE-6's cleanup verification and GATE-8's refusal
contract. Preparing them apart would have produced three documents each waiting on the next.

Acceleration changes the packaging, not the authority. Three consequences are stated here rather than
buried later:

- **One document, three separate approvals.** GATE-6, GATE-7, and GATE-8 have **different, partly
  disjoint approver sets** (§ 4, § 6, § 8). A single review meeting does not produce a single approval,
  and no gate may be approved "along with" another because it shares a document
  ([10L § 13](./br-receita-cnpj-full-join-gate-evidence-packet.md): the dependency graph *orders
  review; it does not propagate approval*). Each gate needs its own
  [10K § 14 approval entry](./br-receita-cnpj-full-join-approval-gates-checklist.md).
- **Bundling is the specific risk this packet must not create.** A reader who sees GATE-6, GATE-7, and
  GATE-8 assembled together and concludes "the remaining gates are done" has misread it. Six gates
  would still be unapproved; eight would be, in fact, because assembling evidence is not approving it.
- **Two of the three gates cannot be *satisfied* by any document.** GATE-7's pass criterion is
  *reproducibility by a different operator*, which is a property of a procedure that has been rehearsed
  against real ceilings that do not exist yet (GATE-2); GATE-8's evidence includes **proofs about code
  that does not exist**, which 10L § 12 already recorded as unobtainable today and which 10K § 4 forbids
  producing by writing the code. This packet states those limits (§ 3, § 6, § 8.3) rather than
  presenting a contract as a proof.

Where the underlying question is genuinely open — GATE-2's undecided storage envelope and its unset
numeric ceilings, 10M's `normalized_tax_id` survival item and `raw_data` default, 10N's deferred
`record_identity_key` construction, 10O's unset small-cell threshold `k` and string-length ceiling, and
10O § 12's unanswered question of whether real local file paths in a manifest are themselves sensitive —
this packet **states how it proceeds under that openness** rather than resolving it by engineering
preference. Two structural consequences follow and are load-bearing throughout: the cleanup contract is
stated **conditionally on the envelope** (§ 4.2), and paths are treated as **potentially sensitive by
default**, so cleanup and evidence report a safe directory *class* rather than a path (§ 5).

This document does **not**:

- **approve GATE-6, GATE-7, or GATE-8**, move any of them to `approved` or `ready_for_review`, or
  substitute for any named approver;
- grant legal or privacy approval;
- approve GATE-1, GATE-2, GATE-3, GATE-4, or GATE-5;
- implement cleanup code, a guard, a runner, a sanitizer, or a script;
- write, generate, or scaffold a test, a fixture, or a snapshot;
- write an executable operator runbook or authorize a manual execution;
- modify code, scripts, or package manifests;
- execute a full join;
- process the full or real dataset;
- import data;
- write to Supabase;
- create or modify a migration;
- create, drop, alter, or validate an index;
- connect the runtime;
- connect Agent 1;
- touch HubSpot / Slack / providers / UI;
- mark Brazil ready for anything.

If, at any point, this milestone concluded that it required code, scripts, a package change, a
migration, index changes, MCP access, a Supabase connection, real execution, or a real gate approval to
proceed, the correct action is to **stop and escalate**, reporting
`BRSOURCE10PQR_SCOPE_ESCALATION_CODE_OR_GATE_APPROVAL_NOT_ALLOWED`. This document reaches no such
conclusion: a cleanup matrix, an operator procedure contract, and a refusal contract are all fully
expressible as prose plus closed enumerations plus conceptual shapes, and every rule can be stated
without emitting a single value, opening a single real file, or writing a single line of code.

---

## 2. Current official baseline

The company-discovery / eligibility / readiness / approval / evidence / allowlist / grain / sanitization
line for Receita CNPJ is official and merged as follows (design and governance of record; none is an
operational authorization):

- **BR-SOURCE-10I — full join import-readiness design is official.** Defines the allowed local
  processing envelope, the § 5 join-key treatment (the root is a *technical key only* — never a record
  identity, **never reportable**, never an import attribute), the three-category post-join field
  survival contract, the § 7 record-identity decision gate, the § 10 required future report shape, and
  GATE-1 … GATE-8 ([full join readiness design](./br-receita-cnpj-full-join-import-readiness-design.md)).
- **BR-SOURCE-10J — full join dry-run technical design is official.** Lowers that contract into an
  executable-in-the-future design: the § 6 temporary storage envelope (conditional on GATE-2), the § 7
  join-key handling rules, § 8.4 / § 8.5 report categories, **the § 9 failure cleanup contract**, the
  § 10 resource limits (every numeric ceiling `TBD_BY_GATE_2_STORAGE_ENVELOPE`, with *zero raw-value
  logs* an absolute invariant), **the § 11 future CLI contract** with its mandatory and forbidden flags,
  the § 12 report contract with the three not-decided markers, the § 15 security assertions, and **the
  § 16 operator runbook requirements**
  ([full join technical design](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **BR-SOURCE-10K — full join approval gates checklist is official.** Makes GATE-6, GATE-7, and GATE-8
  approvable: their required evidence, their approver roles (**technical + operator owner** for GATE-6;
  **operator + technical + privacy owner** for GATE-7; **repo safety + technical owner** for GATE-8),
  their pass and fail criteria, their expected artifacts, and their narrow *Allows* clauses — designing
  the future runner's error handling (GATE-6), preparing a *future* manual execution (GATE-7), and
  writing a future runner as a strict local dry-run only if every other gate is approved (GATE-8). Its
  § 4 forbids writing **any** full-join code — including scaffolding, stubs, and a runner behind a
  disabled flag — until all eight gates are approved
  ([approval gates checklist § 10, § 11, § 12](./br-receita-cnpj-full-join-approval-gates-checklist.md)).
- **BR-SOURCE-10L — full join gate evidence packet is official.** Records all three gates as
  `not_started` / `partial_evidence_collected`, enumerates the missing evidence reproduced in § 1 above,
  records the cross-gate propagation (GATE-2 blocks GATE-6's cleanup specifics *and* GATE-7's
  disk/memory preflight; GATE-5 blocks GATE-7's report scan steps; GATE-6 blocks GATE-7's cleanup
  verification; GATE-8 blocks **any** future implementation), and states the GATE-8
  **contract-now / proofs-at-implementation** structural note
  ([gate evidence packet § 10–§ 14](./br-receita-cnpj-full-join-gate-evidence-packet.md)).
- **BR-SOURCE-10M — full join field allowlist decision record is official.** Proposes the GATE-3
  allowlist as a six-category lifecycle model, proposes `raw_data` prohibited by default, leaves
  `normalized_tax_id` in `needs_legal_review`, and states in its § 14 that GATE-8 is the gate that keeps
  the whole allowlist honest — a field that cannot be written cannot leak through persistence
  ([field allowlist decision record § 14](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)).
- **BR-SOURCE-10N — full join identity grain decision record is official.** Recommends **option D**
  (estabelecimento as the operational unit with company/root context), defers the concrete
  `record_identity_key` construction, and requires that no identity key, key component, or derived value
  ever appear in a report, a log, an error, a count key, **a file name, or a path**
  ([identity grain decision record § 7, § 15](./br-receita-cnpj-full-join-identity-grain-decision-record.md)).
- **BR-SOURCE-10O — full join output sanitization decision record is official.** Proposes the GATE-5
  contract across **twelve output surfaces** with one universal forbidden set: the closed forbidden
  key-name list with its normalization rule, the closed value-pattern rules `VP-1` … `VP-10`, the
  aggregate-only allowlist that **governs** over the denylist, the small-cell suppression proposal
  (threshold `k` unset), the error and exception sanitization contract with its
  sanitize-at-construction boundary, the logs contract, the gate-evidence contract, the § 13 failure
  behavior (no partial report, no downgrade, no retry without an operator), and the assertion catalogue
  `OS-A01` … `OS-A46`
  ([output sanitization decision record](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)).

Also carried in, unchanged: **10E** (privacy-safe bounded dry-run classifier), **10F** (eligibility &
legal-nature calibration), **10G** (bounded company↔establishment join dry-run, join key ephemeral in
memory only), **10H** (bounded join coverage strategy, `coverage_is_representative` always false), and
the **BR-SOURCE-10C** headerless real-file support.

Flag state carried into this document, unchanged:

```
OPS_BR_FULL_JOIN_OUTPUT_SANITIZATION_DECISION_RECORD_OFFICIAL = true
OPS_BR_FULL_JOIN_IDENTITY_GRAIN_DECISION_RECORD_OFFICIAL       = true
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL      = true
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL         = true
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL     = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL             = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL              = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                         = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL             = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL           = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL        = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL                   = true
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
packet and an earlier document appear to differ, the **narrower rule governs**, and the difference is
raised as a review item (§ 4.2, § 5.3, § 12.4) rather than resolved by this document's authority.

---

## 3. Decision status

```
Decision packet status:  proposed_for_owner_review
GATE-6 official status:  not_started / not approved
GATE-7 official status:  not_started / not approved
GATE-8 official status:  not_started / not approved
All gates official status: not_started / not approved
Current GO / NO-GO:      NO-GO
```

Rules attaching to that status:

- **This packet may serve as evidence for GATE-6, GATE-7, and GATE-8.** It is, in proposal form, the
  set of artifacts the 10K § 10–§ 12 *Required evidence* clauses and the 10L § 10–§ 12 *Artifacts
  required to reach `ready_for_review`* clauses name as missing.
- **This packet approves no gate.** GATE-6 is approved by the technical and operator owners jointly;
  GATE-7 by the operator, technical, and privacy owners jointly; GATE-8 by the repo safety and
  technical owners jointly — each **outside this document**, each recorded with the
  [10K § 14 approval template](./br-receita-cnpj-full-join-approval-gates-checklist.md), and none of
  them by an implementing agent or by the author of this packet.
- **This packet does not move any gate to `ready_for_review` either.** Submission and acceptance are
  separate recorded acts (10L § 3). Assembling three artifacts is not submitting them.
- **Three gates in one document is a packaging decision, never a bundled approval.** Any one of the
  three may be approved, rejected, or deferred independently of the others, and a rejection of one does
  not invalidate the evidence assembled for the others (though § 10 records which dependencies would
  then re-open).
- **GATE-6 cannot be closed while GATE-2 is open.** 10L § 13 is explicit: *what must be destroyed is
  undefined until what may exist is decided.* § 4.2 therefore states the cleanup contract under **both**
  envelopes; the approvers may approve the conditional contract, but the envelope-specific ceilings and
  the quarantine decision remain GATE-2's.
- **GATE-7 cannot, by construction, satisfy its own pass criteria here.** 10K § 11 requires a runbook
  *reproducible by a different operator without tacit knowledge*, with a disk / memory check against
  GATE-2 ceilings that do not exist and a report sensitive-scan against a GATE-5 contract that is not
  frozen. § 6 therefore proposes the **runbook contract** — the required steps, their pass conditions,
  and their refusal behaviour — and states plainly that the executable runbook section remains
  unwritten. An approved contract here would mean "this is the shape the runbook must take", never
  "the runbook exists".
- **GATE-8 cannot be closed by proofs today, and must not be closed by inference.** 10L § 12 records
  that several GATE-8 evidence items are proofs *about code that does not exist*; 10K § 4 forbids
  producing them by writing the code. § 8.3 proposes the **contract-now / proofs-at-implementation**
  split explicitly, because treating the proofs as prerequisites deadlocks the gate while treating the
  contract as sufficient for *execution* voids it.
- **No proposal here enables execution.** GATE-1 blocks all execution and is unapproved.
- **No proposal here enables import.** Import requires a later, separate import authorization that no
  gate in this series grants (10K § 15).
- **An approved cleanup contract is a destruction obligation, never a run authorization. An approved
  runbook is a procedure, never a permission. An approved no-write contract is a refusal contract,
  never a licence to run the thing that refuses.**
- **Any sensitive leak resets the affected gate's evidence** to `evidence_not_collected` and the gate to
  `not_started` (10K § 4; 10L § 3), invalidating this packet along with it. That rule is self-applying:
  this document is itself an output surface under
  [10O § 4](./br-receita-cnpj-full-join-output-sanitization-decision-record.md), surface H.

---

## 4. GATE-6 — Failure cleanup decision record

**Governs:** confirms and closes
[10J § 9](./br-receita-cnpj-full-join-dry-run-technical-design.md) — cleanup on completion **and**
failure, with `cleanup failed` as a terminal state.

**Approvers (10K § 10):** **technical owner** and **operator owner**, jointly. Either may reject alone;
approval requires both. Neither may be an implementing agent or the author of this packet.

**Status:** `not_started` / not approved. This section is a proposal.

### 4.1 What the inherited material already fixes

These are not re-decided here; they are the floor this proposal builds on, and none of them is widened:

- **fail closed** — stop the moment a failure or leak assertion trips; no best-effort continuation
  (10J § 9; 10K § 10).
- **no automatic retry** without an explicit operator action (10J § 9; 10K § 10).
- **no Supabase writes under any condition** — not on success, not on failure, not on retry (10J § 9;
  10K § 10).
- **`cleanup failed` is terminal** — never success-with-residue (10J § 9; 10K § 10).
- **only a sanitized failure summary may remain** — reason code and safe counts, nothing else (10J § 9).
- **no stack traces carrying row values** (10J § 9), narrowed by 10O to **no stack emission at all**
  (`OS-A34`), which this proposal adopts as the governing rule because it is the narrower one.
- **no path leakage beyond the safe local root** (10J § 9), narrowed further by § 5.3 below.
- **the join key and any temporary index built from it must be discarded** on finish and on failure
  (10J § 7).
- **no identity key, key component, or derived value in a file name or a path** (10N § 15).
- **no partial report, no downgrade path, no retry without an operator** on the output side (10O § 13).

### 4.2 The conditional-on-envelope rule

GATE-2 has not chosen an architecture, so *what may exist* is undecided and *what must be destroyed*
cannot be enumerated absolutely. This proposal therefore states the cleanup contract under **both**
admissible envelopes, and requires that a run **declare which envelope it is operating under before it
reads anything**:

```
E1  in-memory only          — no temporary on-disk index; maps and buffers only
E2  approved ephemeral disk  — a temporary local index permitted by an approved GATE-2 envelope
```

Rules that hold in both:

- **A run may not discover its envelope at runtime.** The envelope is a declared input; a run that
  finds itself writing an index it did not declare is a leak-class failure, not a resource event.
- **E1 is the default and the assumption of this document.** Absent an approved GATE-2 envelope, only
  E1 is admissible, because E2 requires the approval that does not exist.
- **E2 inherits the whole 10J § 6 envelope** — outside the repository, fixed operator-visible name, no
  cloud sync, never committed, owner-only permissions, short TTL, guaranteed cleanup on completion and
  failure, no sensitive paths in logs, no join keys in file names, encrypted at rest if it materializes
  a structural key.
- **The quarantine-versus-delete question stays open, and is fail-closed in the interim.** 10K § 10
  permits "removed, or safely quarantined". This proposal recommends **delete**, and recommends that
  quarantine be admissible **only** under an approved E2 envelope, only inside the same controlled
  folder, and only for the sanitized cleanup report itself — never for an artifact that could contain
  source-derived material. Until GATE-2 and GATE-6 decide, an artifact that cannot be deleted is
  **unresolved residue**, and unresolved residue is terminal (§ 4.7).

### 4.3 Destroyable artifact classes

A closed list of what a future run must be able to destroy or invalidate. It is closed so that a future
verification can enumerate it; a class not on the list is not thereby permitted to survive — an
unclassifiable artifact is unresolved residue (§ 4.7).

```
AC-01  temporary local indexes (E2 only)
AC-02  in-memory maps, buffers, and any structure holding a join key
AC-03  partial report files (JSON or human-readable)
AC-04  unsafe report files (complete but failing a sanitization assertion)
AC-05  partial JSON outputs and half-written serializations
AC-06  copied terminal artifacts (redirected stdout/stderr captures, tee files)
AC-07  unsanitized logs and any log written before the sanitizer boundary
AC-08  intermediate temporary directories created for the run
AC-09  lock files
AC-10  progress markers, checkpoints, and resume state
AC-11  any file derived from raw rows (splits, sorts, spills, swap-like scratch)
AC-12  any artifact that could contain a join key, a record identity key, a source value,
       or row-level data — the catch-all class, and the one that governs when AC-01 … AC-11
       do not obviously apply
```

Two notes the approvers should have in front of them:

- **AC-02 is not free.** "Memory is discarded when the process exits" is true of a clean exit and false
  of a crash that leaves a core dump or a swap-resident page. This proposal does not attempt to solve
  process-level memory forensics; it requires instead that a crash be treated as **unverified cleanup**
  (§ 4.4, scenario `S06`) rather than as self-cleaning, and that the operator's controlled folder be the
  only place a run is permitted to write anything at all, so that a crash's residue is bounded to a
  known location.
- **AC-06 is the operator's artifact, not the run's.** A run cannot delete a terminal buffer or a file
  the operator created by redirecting output. It is listed because GATE-7 must forbid creating it
  (§ 7), and because the cleanup report must not claim a cleanliness it cannot verify.

### 4.4 Per-failure-type cleanup matrix

The thirteen terminating scenarios. `E1` / `E2` columns state what the run must destroy under each
envelope; *may survive* states the only artifacts permitted to remain; *verification* states how the
outcome is established; *blocks next run* states whether a future execution is refused until an operator
acts.

| # | Scenario | Destroy (E1) | Destroy (E2) | May survive | Verification | Blocks next run |
|---|----------|--------------|--------------|-------------|--------------|-----------------|
| `S01` | **Normal completion** | AC-02, AC-08, AC-09, AC-10 | + AC-01, AC-11 | the sanitized final report; the sanitized cleanup report | ledger reconciled to empty (§ 4.6) | no |
| `S02` | **Sanitizer failure** (an assertion tripped at the boundary) | AC-02 … AC-11, and the report itself | + AC-01 | the sanitized cleanup report only — **no report of any kind** | ledger empty **and** no report artifact present | **yes** — leak-class; gate evidence resets (§ 3) |
| `S03` | **Disk exhaustion** | AC-02, AC-08 … AC-11 | + AC-01 | the sanitized cleanup report, if it can be written; otherwise nothing | ledger empty; if the report cannot be written, the run is `cleanup_unverified` | **yes** until the operator confirms the folder is empty |
| `S04` | **Out of memory** | AC-02 (best effort — see below), AC-03, AC-05, AC-08 … AC-11 | + AC-01 | the sanitized cleanup report, if the process survives long enough | ledger empty, else `cleanup_unverified` | **yes** |
| `S05` | **Operator interrupt** (deliberate cancellation) | AC-02 … AC-11 | + AC-01 | the sanitized cleanup report | ledger empty | no, once cleanup is verified |
| `S06` | **Process crash** (no in-process handler ran) | nothing can be destroyed in-process | nothing can be destroyed in-process | whatever the crash left, inside the controlled folder only | **none in-process** — status is `cleanup_unverified` by definition | **yes** — operator-run cleanup and confirmation required |
| `S07` | **Permission error** | AC-02, AC-03, AC-05, AC-08 … AC-11 | + AC-01 where permissions allow; the rest is unresolved residue | the sanitized cleanup report | ledger reconciled; unresolved entries listed by **class**, never by path | **yes** if any entry is unresolved |
| `S08` | **Manifest validation failure** | AC-02, AC-09, AC-10 | nothing further — the failure precedes index creation | the sanitized cleanup report | trivially empty: rejection precedes file opening (10J § 11) | no |
| `S09` | **File-family rejection** (a forbidden family present) | AC-02, AC-09, AC-10 | nothing further — rejection precedes index creation | the sanitized cleanup report, stating the rejection by class | trivially empty | **yes** until the operator removes the file and re-inventories (runbook § 7, § 13) |
| `S10` | **Gate-preflight failure** (a gate is not `approved`) | nothing — the run never started | nothing — the run never started | the refusal record | nothing to verify | **yes** — a preflight failure is not retryable by re-running |
| `S11` | **Small-cell suppression failure** (a bucket below the threshold could not be suppressed) | AC-02 … AC-11, and the report | + AC-01 | the sanitized cleanup report only | ledger empty; no report artifact | **yes** — leak-class, same as `S02` |
| `S12` | **Report-write failure** | AC-02 … AC-11, including the partial write | + AC-01 | the sanitized cleanup report | ledger empty; partial artifact absent | no, once verified |
| `S13` | **Cleanup failure itself** | as much as can be destroyed | as much as can be destroyed | the sanitized cleanup report stating `cleanup_status = failed` | explicitly **not verified** | **yes** — terminal; manual cleanup required and recorded |

Rules the matrix must be read with:

- **Cleanup is best-effort in execution and fail-closed in reporting.** A run tries every destruction it
  can and then reports the truth about what it achieved. Best-effort never means "report success and
  hope" — the two halves are independent, and the reporting half has no tolerance.
- **`S02` and `S11` are leak-class, not error-class.** They reset the affected gate's evidence (§ 3) and
  are the only scenarios where the **report is destroyed along with the temporaries**: a report that
  failed sanitization is exactly the artifact that must not survive.
- **`S04` requires an honest limit.** A process that is out of memory may be unable to run a cleanup
  routine that itself allocates. This proposal does not pretend otherwise: the matrix permits
  `cleanup_unverified`, and `cleanup_unverified` blocks the next run. The alternative — claiming
  verified cleanup under OOM — would be a false safety claim.
- **`S06` is the reason the ledger exists.** A crash has no in-process cleanup path at all, so the only
  possible verification is external: an operator reconciling a ledger written *before* each artifact was
  created (§ 4.6).
- **`S10` is not a failure of the run; it is the refusal working.** It is in the matrix because a refusal
  still has cleanup semantics (nothing was created, and that must be stated) and because a refusal must
  never be retryable by simply running the command again.

### 4.5 Cleanup ordering

Order matters, because a partially-completed cleanup must never leave the most sensitive class behind:

```
1. stop all reading and processing immediately (fail closed)
2. destroy AC-02  (join keys and identity-bearing memory first)
3. destroy AC-01 / AC-11  (index and raw-derived files — the highest-risk on-disk classes)
4. destroy AC-03 / AC-04 / AC-05 / AC-07  (reports and logs that could carry values)
5. destroy AC-08 / AC-09 / AC-10  (structural leftovers)
6. reconcile the ledger and classify the outcome
7. emit the sanitized cleanup report (§ 5)
8. exit with the controlled code — never 0 on an unresolved or unverified outcome
```

- **No step may be skipped because a later step failed.** A failure at step 4 does not excuse step 5.
- **The report is written last, from the reconciled ledger**, so it can never describe a cleanliness that
  was not achieved.
- **AC-06 is absent from the ordering deliberately**: it is the operator's artifact and is governed by
  § 7, not by the run.

### 4.6 The temporary-artifact ledger and verification

10L § 10 names *"a temporary-artifact manifest design — what a run must know it created in order to
prove it destroyed it"* as missing evidence. This proposal supplies it as a **ledger**, with one
non-obvious property: entries are written **before** the artifact is created, never after, because an
artifact created and then crashed-on is exactly the case a post-hoc ledger misses.

```
ledger entry (conceptual):
  artifact_type      one of AC-01 … AC-12
  directory_class    a safe enum (§ 5.3) — never a path
  created_marker     an opaque run-scoped counter — never a row offset, never a key
  state              declared | created | destroyed | unresolved
```

- **The ledger itself is an artifact** (class AC-10) and is destroyed last, after reconciliation.
- **The ledger may never contain a path, a file name, a join key, an identity key, a row offset tied to
  a record, or any source-derived string.** It is a list of *classes and states*, which is sufficient to
  prove destruction and insufficient to leak.
- **Reconciliation is the verification mechanism.** A run is `cleanup_verified` only if every entry is
  `destroyed`. Any entry left `created` or `unresolved` yields `cleanup_unverified` or
  `cleanup_failed`.
- **Verification is a property the operator can also check independently**: the controlled folder is
  expected empty of every class except the artifacts § 4.4 permits to survive. GATE-7 (§ 6.2, § 6.4) is
  where that check becomes a recorded operator step.
- **No cleanup verification command is created by this document.** A command is code.

### 4.7 Unresolved residue blocks future steps

- **An unresolved or unverified cleanup is a hard block on the next execution**, not a warning. A future
  runner must refuse to start while a stale ledger, a lock file, or an unresolved entry exists in the
  controlled folder.
- **The block is cleared only by an explicit operator action**, recorded — never by a timeout, never by
  a retry, never by the run itself deciding the residue looks harmless.
- **An unclassifiable artifact is unresolved residue** (AC-12). The catch-all is the point: a class that
  nobody anticipated must fail closed rather than fall through.
- **A cleanup that cannot be verified may not be reported as clean**, and a run that cannot verify its
  own cleanup may not exit successfully.

### 4.8 Escalation and retry

10L § 10 names *"a cleanup-failure escalation owner"* as missing. Proposed:

- **`cleanup_failed` and `cleanup_unverified` escalate to the operator owner and the technical owner
  jointly** — the same pair that approves GATE-6, so the gate's approvers own its failure mode.
- **A leak-class outcome (`S02`, `S11`) escalates additionally to the privacy owner**, because it is the
  event that resets gate evidence (§ 3) and is therefore a governance event, not only an operations one.
- **Escalation content is the sanitized cleanup report and nothing else** (§ 5). No screenshots, no
  terminal buffers, no raw error text, no paths.
- **No automatic retry, under any outcome.** Re-running is a new, deliberate operator act, preceded by
  the full preflight (§ 6.2) — never a resumption.
- **No resume.** Progress markers exist to be destroyed (AC-10), not to be honoured; a partially
  completed scan is not a checkpoint.

### 4.9 Proposed GATE-6 assertion catalogue

Named so a future verification could be traced to this record one-to-one, in the manner of 10O § 5.4.
**No test is created here**, and none may be: 10K § 4 forbids full-join code until all eight gates are
approved.

```
FC-A01  a run declares its envelope (E1 | E2) before opening any file
FC-A02  a run under E1 creates no on-disk artifact other than the permitted reports
FC-A03  every artifact is ledger-declared before creation
FC-A04  no ledger entry contains a path, file name, key, offset, or source-derived string
FC-A05  on every terminating path, cleanup runs in the § 4.5 order
FC-A06  AC-02 is destroyed before any on-disk class
FC-A07  a failed step does not abort the remaining steps
FC-A08  cleanup_verified requires every ledger entry to be `destroyed`
FC-A09  cleanup_failed and cleanup_unverified are non-zero-exit terminal states
FC-A10  no terminating path performs a Supabase write
FC-A11  no terminating path performs an automatic retry
FC-A12  a sanitizer-assertion failure destroys the report as well as the temporaries
FC-A13  a small-cell suppression failure destroys the report as well as the temporaries
FC-A14  no partial report survives any terminating path
FC-A15  the cleanup report contains only § 5.2 allowed members
FC-A16  the cleanup report contains no raw exception message
FC-A17  the cleanup report emits no path — only a directory_class enum
FC-A18  a stale ledger, lock file, or unresolved entry blocks the next run
FC-A19  the block clears only by a recorded operator action
FC-A20  an unclassifiable artifact is reported as unresolved residue, never ignored
FC-A21  no stack trace is emitted on any terminating path (inherits OS-A34)
FC-A22  progress markers are destroyed, never honoured as resume state
FC-A23  quarantine is used only under an approved E2 envelope, and never for a
        source-derived artifact
FC-A24  cleanup escalation carries the sanitized cleanup report and nothing else
```

Two of these are **unenforceable until GATE-2 decides**: `FC-A02` and `FC-A23` both depend on the
envelope, and `FC-A23` additionally on the quarantine decision. That is stated rather than hidden.

---

## 5. GATE-6 cleanup artifact contract

The cleanup report is an output surface, and therefore inherits the whole
[10O](./br-receita-cnpj-full-join-output-sanitization-decision-record.md) contract: the universal
forbidden classes (§ 5.1 there), the closed forbidden key-name list (§ 5.2 there), the value-pattern
rules `VP-1` … `VP-10` (§ 5.3 there), the sanitize-at-construction boundary (§ 8.3 there), and the
allowlist-governs rule (§ 6 there). This section adds only what is specific to cleanup.

### 5.1 Allowed content

```
stage                    enum — which phase the run terminated in
cleanup_status           enum — verified | unverified | failed | not_required
artifact_type            enum — AC-01 … AC-12
artifacts_cleaned        integer count
artifacts_unresolved     integer count
cleanup_failures         integer count
directory_class          enum (§ 5.3) — never a path
error_code               controlled enum (§ 5.4) — never a message
safety booleans          the all-false block (§ 9)
no_write / no_runtime    flags, always false-valued facts about what did not happen
envelope_declared        E1 | E2
```

Conceptual shape, with zeros and placeholders only — **no real values**:

```json
{
  "ok": false,
  "stage": "join_phase",
  "terminating_scenario": "S03",
  "envelope_declared": "E1",
  "cleanup_status": "verified",
  "artifacts_cleaned": 0,
  "artifacts_unresolved": 0,
  "cleanup_failures": 0,
  "artifact_types_cleaned": [],
  "artifact_types_unresolved": [],
  "directory_class": "operator_controlled_local_folder",
  "error_code": "BRSOURCE_FULL_JOIN_DISK_LIMIT_REACHED",
  "manual_cleanup_required": false,
  "escalation_required": false,
  "safety": {
    "import_executed": false,
    "supabase_write": false,
    "production_write": false,
    "runtime_integration": false,
    "agent1_integration": false,
    "provider_calls": false,
    "hubspot_integration": false,
    "slack_notification": false,
    "persisted_rows": 0,
    "join_keys_emitted": 0,
    "identity_keys_constructed": 0,
    "raw_value_logs": 0
  }
}
```

Every value above is a zero, a `false`, an enum member, or an empty array. **The shape is a proposal, not
an adopted schema**: freezing it is the approvers' act, and it inherits GATE-5's unfrozen report schema.

### 5.2 Forbidden content

Absolutely, on every terminating path, with no debug mode, no verbose flag, and no operator override:

```
- file names derived from identifiers, names, or any source value
- raw local file paths, wherever a path may itself encode a source value
- row offsets tied to a record, row indices, or "the row that failed"
- join keys, or any hash, truncation, or fingerprint of one
- record_identity_key, any component of one, or any derived value
- normalized_tax_id
- CNPJ, CNPJ básico, CPF, razão social, nome fantasia, address, or contact values
- raw error messages, driver messages, or library messages
- stack traces or frame lists (inherits OS-A34)
- screenshots, pasted terminal buffers, or any copied output containing values
- counts keyed by anything identifying, and any bucket below the GATE-5 threshold
```

### 5.3 Why paths are a `directory_class` enum

10O § 12 raised, and deliberately did not answer, whether a real local file path in a manifest is
sensitive. 10J § 9 permits errors that "reference only the controlled folder"; 10N § 15 forbids any
identity key or derived value in a path; and the operator's folder naming is under the operator's
control, which means a path *can* encode a value even when the convention says it should not.

This proposal resolves the ambiguity **fail-closed for this surface only, without amending any other
document's scope**: the cleanup report emits a **class**, never a path.

```
directory_class:
  operator_controlled_local_folder
  operator_controlled_temp_subdirectory
  report_output_directory
  outside_controlled_root            (a failure class in itself)
  unknown                            (treated as unresolved residue)
```

`outside_controlled_root` is a member because a run that finds itself touching anything outside the
controlled root must be able to say so — that is a safety fact, and it can be stated without a path.
The approvers may prefer paths; § 10 records this as an item they decide, and the recommendation is the
narrower option.

### 5.4 Controlled `error_code` values

Codes, never messages; stable, so a future verification and an operator runbook can both refer to them;
and carrying no value, no path, and no row reference. Proposed members, in the spirit of the existing
`BRSOURCE{3,6,7}_FORBIDDEN_*` gate codes:

```
BRSOURCE_FULL_JOIN_GATE_PREFLIGHT_NOT_APPROVED
BRSOURCE_FULL_JOIN_MANIFEST_INVALID
BRSOURCE_FULL_JOIN_FORBIDDEN_FILE_FAMILY
BRSOURCE_FULL_JOIN_FORBIDDEN_FLAG
BRSOURCE_FULL_JOIN_ENVELOPE_NOT_DECLARED
BRSOURCE_FULL_JOIN_ENVELOPE_VIOLATION
BRSOURCE_FULL_JOIN_MEMORY_LIMIT_REACHED
BRSOURCE_FULL_JOIN_DISK_LIMIT_REACHED
BRSOURCE_FULL_JOIN_PERMISSION_ERROR
BRSOURCE_FULL_JOIN_SANITIZER_ASSERTION_FAILED
BRSOURCE_FULL_JOIN_SMALL_CELL_SUPPRESSION_FAILED
BRSOURCE_FULL_JOIN_REPORT_WRITE_FAILED
BRSOURCE_FULL_JOIN_OPERATOR_CANCELLED
BRSOURCE_FULL_JOIN_CLEANUP_FAILED
BRSOURCE_FULL_JOIN_CLEANUP_UNVERIFIED
BRSOURCE_FULL_JOIN_STALE_LEDGER_PRESENT
```

The list is **closed**: an unmapped failure reports the nearest class plus `cleanup_unverified`, never a
free-text message. A code is not an authorization to build the runner that emits it.

---

## 6. GATE-7 — Operator runbook decision record

**Governs:** confirms
[10J § 16](./br-receita-cnpj-full-join-dry-run-technical-design.md) — the manual steps an operator
follows to run a future dry-run safely and reproducibly.

**Approvers (10K § 11):** **operator owner**, **technical owner**, and **privacy owner**, jointly. Any
one may reject alone; approval requires all three.

**Status:** `not_started` / not approved. This section proposes the **runbook contract** — the shape a
future runbook section must take. **The runbook section itself does not exist and is not written here**
(10L § 11), and cannot be, because two of its steps reference values that do not exist yet: the GATE-2
disk and memory ceilings and the frozen GATE-5 scan contract.

### 6.1 Who may operate

- **Only a named, authorized operator.** Not an agent, not an automation, not a scheduled job, not a
  CI runner.
- **No agent may execute this procedure**, and no agent may execute it "on behalf of" an operator.
  This packet's author explicitly may not.
- **The operator may not also be the sole approver of GATE-7**, for the same reason 10K keeps approvers
  and implementers apart.
- **Execution happens outside the repository**, in the operator's controlled local folder
  ([runbook § 4](./br-receita-cnpj-manual-download-local-prep-runbook.md)) — never inside a clone, never
  in a worktree, never in a synced or cloud-backed location.
- **The operator must confirm, before starting**, each of: no cloud sync on the folder; no
  write-capable Supabase credential in the environment; no service role key present; no
  import/runtime/Agent 1 environment variables loaded; the mode is dry-run / no-write.
- **An approved runbook is a procedure, never a permission** (10K § 11). Execution requires a separate,
  explicit future authorization, which no gate in this series grants.

### 6.2 Proposed preflight checklist

Each item has a definite action and a definite pass condition, per the 10K § 11 pass criteria. A failed
item is a **stop**, not a warning (§ 6.3).

```
P-01  repository clean, or work isolated in a dedicated worktree
P-02  branch is the intended one; no unintended local modification
P-03  origin/main is the expected commit
P-04  every official design/decision document present at its expected version
P-05  gate status verified: all eight gates recorded as approved
      → today this item FAILS by construction; it is the item that makes the
        procedure unusable, and it is first for that reason
P-06  dataset path is outside the repository, in the controlled folder
P-07  no forbidden family present (socios / QSA / CPF / person files) — the
      inventory check prints nothing (runbook § 7)
P-08  manifest validated: local file manifest only, never a URL (runbook § 10)
P-09  output directory empty or containing only artifacts § 4.4 permits
P-10  no stale ledger, lock file, or unresolved residue present (§ 4.7)
P-11  planned report file names contain no real value of any kind
P-12  free disk above the GATE-2 ceiling            → unset; item unusable today
P-13  available memory above the GATE-2 ceiling     → unset; item unusable today
P-14  no network dependency and no provider call in the planned run
P-15  no Supabase credential of any kind in the environment
P-16  no runtime environment variables loaded
P-17  no Agent 1 environment variables loaded
P-18  no Vercel / hosting / feature-flag change staged or intended
P-19  output sanitizer configured per the approved GATE-5 contract
      → unfrozen; item unusable today
P-20  cleanup policy (§ 4) acknowledged and the escalation pair known
P-21  envelope (E1 | E2) declared, and E2 only if GATE-2 approved it
P-22  the explicit dry-run confirmation flag will be passed, and the operator
      knows what refusal looks like
```

Three of these items — `P-12`, `P-13`, `P-19` — **cannot be performed today**, and `P-05` fails today by
construction. That is the honest state of GATE-7 and the reason § 3 records that this section cannot
satisfy the gate's pass criteria on its own. A checklist whose first item fails is not a defect of the
checklist; it is the gate doing its job.

### 6.3 Proposed stop conditions

Any one of these **stops the run and blocks a retry** until an operator resolves it and records the
resolution. None is a warning, none is overridable, and none is cleared by re-running the command.

```
T-01  a forbidden file family is detected
T-02  an identifier, name, address, or contact value appears in any output
T-03  a sanitizer assertion fails
T-04  a small-cell suppression step cannot be satisfied
T-05  any unexpected write attempt is observed
T-06  a Supabase credential or client is detected in the environment
T-07  a runtime endpoint or route is touched
T-08  a provider, HubSpot, or Slack call is attempted
T-09  a network call is attempted where none was planned
T-10  any import flag or import-like behaviour is true
T-11  an unapproved gate is being treated as approved
T-12  a raw driver, library, or exception message containing values is surfaced
T-13  the operator cannot prove cleanup (cleanup_unverified or cleanup_failed)
T-14  a stale ledger, lock, or unresolved residue is found
T-15  the report is written inside the repository
T-16  a resource ceiling is exceeded, or none exists to check against
```

`T-02`, `T-03`, `T-04`, and `T-05` are **leak-class**: they reset gate evidence (§ 3) and escalate to the
privacy owner (§ 4.8), not merely to the operator.

### 6.4 Evidence the operator may produce

Permitted, and nothing beyond it:

```
- the aggregate JSON report, after the sanitizer boundary
- the sanitized cleanup report (§ 5)
- the all-false safety booleans (§ 9)
- command names and non-sensitive argument names — never a manifest path,
  never a real argument value
- the controlled exit code and the controlled error_code enum
- the artifact cleanup summary (counts and classes)
- the no-write proof set as § 9 defines it
- a local-only confirmation, expressed as a directory_class (§ 5.3)
- the preflight checklist completion state, item by item, pass or fail
- a final signoff recording the aggregate result only
```

Forbidden as evidence, on every channel including chat, tickets, and review comments:

```
- screenshots or photographs of a terminal
- pasted terminal buffers
- the real manifest, or any excerpt of it
- real local paths
- unsanitized reports, or any report that has not passed the sanitizer
- environment variable values, secrets, connection strings, or keys
- any row, cell, value, sample, or "just one example"
```

### 6.5 What an approved runbook would and would not be

- **Would be:** a section extending the existing manual-download / local-prep runbook — never a
  competing document (10K § 11) — reproducible by a different operator without tacit knowledge, with a
  definite pass condition per step and a definite refusal behaviour per stop condition.
- **Would not be:** an authorization to execute. 10K § 11's *Does NOT allow* clause is explicit that
  executing requires the separate, explicit authorization of a future milestone.
- **Would not be:** a substitute for GATE-1. A perfect procedure executed without legal approval is
  still unauthorized processing.
- **Would not be:** a document an agent may follow. § 6.1 restricts execution to a named human
  operator.

### 6.6 Proposed GATE-7 assertion catalogue

```
OR-A01  the procedure is executable only by a named authorized human operator
OR-A02  every preflight item has one action and one pass condition
OR-A03  P-05 (gate status) precedes every other item
OR-A04  a failed preflight item stops the procedure
OR-A05  the dataset and the report both live outside the repository
OR-A06  the manifest is a local file manifest; a URL manifest is refused
OR-A07  the forbidden-family inventory check prints nothing
OR-A08  the run refuses to start without the explicit dry-run confirmation
OR-A09  the operator cannot reach an import path from this procedure
OR-A10  the operator cannot reach a Supabase write path from this procedure
OR-A11  every stop condition is non-overridable
OR-A12  a stop condition is cleared only by a recorded operator action
OR-A13  cleanup verification is a recorded step, not an assumption
OR-A14  the report is scanned before it is read, shared, or attached
OR-A15  post-run deletion rules are applied and recorded
OR-A16  signoff records the aggregate result only
OR-A17  no evidence channel carries a screenshot or a terminal paste
OR-A18  no evidence channel carries a real path, manifest, or value
OR-A19  a warning is never recorded as a pass
OR-A20  a retry is a new deliberate act preceded by the full preflight
```

`OR-A02` is only partly checkable today: three items (`P-12`, `P-13`, `P-19`) have no pass condition
because the values that define them are unset.

---

## 7. GATE-7 operator behavior rules

These are the discipline rules that make the residual, non-machine-detectable risks controllable. 10O § 4
surface L already recorded that screenshots and copy-paste **cannot be detected by any assertion** and
are governed only by making terminal surfaces enum-only and by this runbook. That makes these rules the
mitigation of record, not etiquette.

- **No screenshots of a terminal containing values** — and, because "containing values" is not
  verifiable before the fact, no screenshots of the run's terminal at all.
- **No copy-pasting output that has not passed the sanitizer.** The sanitizer boundary is the only place
  where output becomes shareable.
- **No sharing of an unreviewed report.** A report is read after it is scanned, not before.
- **No sending real manifests, dataset listings, or file inventories through chat, tickets, or review
  threads.**
- **No local paths in any evidence** where a path could encode a value — use the `directory_class` enum
  (§ 5.3).
- **No retry after a failure without completing cleanup first**, and no retry that reuses progress
  markers.
- **No manual editing of a report or a cleanup report to make it pass.** An edited artifact is not
  evidence; it is a fabrication, and it voids the gate.
- **No mixing the real dataset with the repository** — not a copy, not a symlink, not a temporary
  "just for a minute" placement, not a `.gitignore`d directory inside the clone.
- **No service role key, and no write-capable credential, in the operating environment at all.** Absence
  is the control; a present-but-unused credential is not.
- **No converting a warning into a pass.** If a check is ambiguous, it failed.
- **No treating an unapproved gate as approved**, including by reading this packet's proposals as
  approvals.
- **No delegating any step to an agent or an automation**, including the "harmless" ones like running an
  inventory command.

Each rule exists because its violation is either undetectable by tooling or detectable only after the
leak. They are the reason GATE-7 has a privacy owner among its approvers and not only an operator owner.

---

## 8. GATE-8 — No-write / no-runtime enforcement decision record

**Governs:** forces the
[10J § 11](./br-receita-cnpj-full-join-dry-run-technical-design.md) no-write flags and the 10J § 12
`import_executed = false` / `persisted_rows = 0` / all-false safety invariants.

**Approvers (10K § 12):** **repo safety owner** and **technical owner**, jointly.

**Status:** `not_started` / not approved. This section is a proposal.

### 8.1 What must be blocked

A future full join dry-run is **local, no-write, no-runtime**. The closed list of what it must be unable
to do — not "must not do", but **must be unable to do**:

```
NB-01  Supabase writes, on any table, through any client
NB-02  migrations — created, modified, applied, or reverted
NB-03  source_company_snapshots writes
NB-04  accounts writes
NB-05  prospect_candidates writes
NB-06  agent_runs writes
NB-07  provider_usage_logs writes
NB-08  contact / contact-enrichment writes of any kind
NB-09  HubSpot writes or syncs
NB-10  Slack sends
NB-11  provider calls of any kind (paid or free, real or sandbox)
NB-12  runtime routes, endpoints, and handlers
NB-13  Agent 1 execution, or import of any Agent 1 module
NB-14  Vercel / hosting / environment-variable changes
NB-15  feature-flag reads that could change behavior, and any flag write
NB-16  persistent cache, shared storage, or cross-run state writes
NB-17  cloud uploads, backups, or sync of any artifact
NB-18  index creation, deletion, alteration, or validation
NB-19  schema changes of any kind
NB-20  network calls, other than none — the default and the recommendation
```

`NB-20` deserves its own sentence: this proposal recommends **zero network calls**, and recommends that
any future exception be an explicitly approved non-data dependency, named in the contract, counted in the
report, and never a data fetch. A local dry-run over a locally-prepared dataset has no reason to reach
the network at all.

### 8.2 Proposed conceptual enforcement

Enforcement must be **structural**, not "the code happens not to do it" and not reviewer vigilance
(10K § 12 pass criteria):

- **No write-capable client is initialized** on the code path — not lazily, not behind a flag, not in a
  helper the path imports.
- **No service role key is present in the process environment.** Absence, not non-use.
- **No Supabase client module is imported** by anything the path reaches, transitively.
- **No Agent 1, HubSpot, Slack, or provider module is imported** by anything the path reaches,
  transitively.
- **Dry-run mode is hardcoded and fail-closed**, not defaulted. A missing mode is a refusal, not an
  assumption.
- **The mandatory flags are required to start** and the **forbidden flags are rejected by presence**,
  before any file is opened, with a stable rejection code (10J § 11; 10K § 12):

```
mandatory:  --confirm-full-join-readiness-dry-run  --no-supabase  --no-import
            --no-runtime  --no-agent1  --strict  --format json
forbidden:  --apply  --write  --supabase  --agent1  --runtime  --hubspot  --slack
```

- **Rejection ordering is part of the contract**, because "rejected eventually" is not rejected: a
  forbidden flag, a URL manifest, an out-of-range limit, or a missing mandatory flag is refused
  **before any file is opened** and before any artifact is created — with the refusal itself producing
  no residue (§ 4.4, `S10`).
- **The output directory is local only**, inside the operator's controlled folder, expressed as a
  `directory_class` (§ 5.3).
- **The runtime-integration booleans remain false as facts**, not as defaults that a later change could
  flip silently.
- **The report and the cleanup report both carry the no-write block** (§ 9), so the absence of writes is
  asserted on every terminating path rather than only on success.
- **Write-attempt and network-call counters are zero**, where measurable — and where not measurable, the
  contract says so instead of claiming a proof it does not have.

### 8.3 The contract-now / proofs-at-implementation split

This is the item 10L § 12 flagged for the approvers, and this proposal takes a position on it rather
than leaving it implicit.

```
Approvable NOW (contract):
  the blocked-surface list (§ 8.1)
  the mandatory / forbidden flag sets
  the rejection codes and the rejection ordering
  the missing-mandatory-flag behaviour
  the structural enforcement requirements (§ 8.2)
  the evidence contract (§ 9)
  the enumerated no-write test list a future implementation must satisfy (§ 8.4)

NOT obtainable now (proofs):
  proof that forbidden flags fail closed
  proof that no Supabase client is imported or invoked
  proof that no Agent 1 module is imported or invoked
  proof that no provider / HubSpot / Slack path exists
  proof that write-attempt and network-call counters are zero in practice
```

The reasoning is 10L § 12's, restated because it is decisive: the proofs are **about code that does not
exist**, and 10K § 4 forbids producing them by writing the code — including scaffolding and stubs behind
a disabled flag. Treating the proofs as prerequisites **deadlocks GATE-8**; treating the contract as
sufficient for *execution* **voids it**. The split is the only non-degenerate reading, and it is exactly
what the approvers must record: what they accept now, and what they defer to the implementation
milestone that GATE-8's narrow *Allows* clause opens.

One consequence must be stated plainly: **GATE-8 approved as a contract does not authorize writing the
runner.** 10K § 12's *Allows* clause is conditional — a future runner as a strict local dry-run, **and
only if every other gate is `approved`**. Seven other gates are not.

### 8.4 Proposed GATE-8 assertion catalogue

The enumerated no-write test list a future implementation must satisfy. **No test is created here.**

```
NW-A01  a forbidden flag is rejected before any file is opened
NW-A02  a missing mandatory flag is rejected before any file is opened
NW-A03  a URL manifest is rejected before any file is opened
NW-A04  an out-of-range limit is rejected before any file is opened
NW-A05  a rejection creates no artifact and leaves no residue
NW-A06  a rejection emits a stable controlled code, never a free-text message
NW-A07  no Supabase module is imported transitively on the path
NW-A08  no write-capable client is constructed on the path
NW-A09  no service role key is read from the environment
NW-A10  no Agent 1 module is imported transitively on the path
NW-A11  no HubSpot module is imported transitively on the path
NW-A12  no Slack module is imported transitively on the path
NW-A13  no provider client is imported or constructed on the path
NW-A14  no migration file is created, modified, or executed
NW-A15  no index is created, dropped, altered, or validated
NW-A16  persisted_rows is 0 on every terminating path
NW-A17  supabase_write is false on every terminating path
NW-A18  import_executed is false on every terminating path
NW-A19  runtime_integration is false on every terminating path
NW-A20  agent1_integration is false on every terminating path
NW-A21  provider_calls is false on every terminating path
NW-A22  production_write is false on every terminating path
NW-A23  the write-attempt counter is 0
NW-A24  the network-call counter is 0, or the contract records it as unmeasurable
NW-A25  no artifact is written outside the controlled local folder
NW-A26  no artifact is uploaded, synced, or backed up anywhere
NW-A27  dry-run mode is required, not defaulted
NW-A28  no cross-run persistent cache or shared state is written
```

---

## 9. GATE-8 evidence contract

### 9.1 Allowed

```
booleans (the all-false block, asserted on every terminating path):
  import_executed       = false
  supabase_write        = false
  production_write      = false
  runtime_integration   = false
  agent1_integration    = false
  provider_calls        = false
  hubspot_integration   = false
  slack_notification    = false

counters:
  persisted_rows        = 0
  write_attempts        = 0
  network_calls         = 0        (or explicitly recorded as unmeasurable)
  join_keys_emitted     = 0
  identity_keys_constructed = 0
  raw_value_logs        = 0        (an absolute invariant, per 10J § 10)

plus:
  command names, and non-sensitive argument names
  the environment preflight status, item by item (§ 6.2)
  the controlled error_code enum (§ 5.4)
  the controlled exit code
  envelope_declared (E1 | E2)
  directory_class (§ 5.3)
```

A boolean that could legitimately be `true` is **not** admissible evidence — 10K § 9 already makes that
a fail criterion, and it applies here: the value of these booleans is that they are structurally
false, not that they happened to be false on one run.

### 9.2 Forbidden

```
- environment variable values
- secrets of any kind
- raw connection strings
- the service role key, or any key material
- provider API keys or tokens
- the real manifest, and any local sensitive path
- source values of any kind — identifiers, names, addresses, contacts
- raw error, driver, or library messages
- stack traces
- screenshots or terminal pastes
```

### 9.3 What this evidence does and does not prove

- **It proves what did not happen on a path that ran.** It cannot prove what a path *cannot* do; that is
  what § 8.2's structural requirements and § 8.4's test list are for, and both land with the
  implementation.
- **It is not a substitute for the contract.** A run reporting all-false booleans while a write path
  exists is a run that did not happen to write.
- **It cannot be produced today at all**, because no run exists. Everything in § 9 is a specification of
  admissible future evidence.

---

## 10. Final gate readiness packet

For owner review. **Evidence documentation assembled ≠ owner approval.** Every gate below remains
`not_started` / not approved, and the packet's own status is `proposed_for_owner_review`.

| Gate | Covered by document | Evidence status | Owner approval status | Current status | Still blocked by |
|------|---------------------|-----------------|-----------------------|----------------|------------------|
| **GATE-1** Legal/Privacy | Legal/privacy decision record + review package; 10L § 5 | `partial_evidence_collected` — the determination itself is missing | not approved; legal/privacy owner has recorded nothing | `not_started` | A legal/privacy determination for full local processing, the LGPD basis, and the licence variant confirmed from official metadata. **No document can supply this.** |
| **GATE-2** Temporary storage envelope | 10J § 6, § 10; 10L § 6 | `partial_evidence_collected` — every numeric ceiling is `TBD_BY_GATE_2_STORAGE_ENVELOPE` | not approved; technical + privacy owners jointly | `not_started` | An architecture choice, real measurements behind each ceiling, the TTL / permissions / encryption decisions, and the quarantine-vs-delete call this packet defers to it (§ 4.2) |
| **GATE-3** Field allowlist | 10M (proposed); 10L § 7 | `partial_evidence_collected` — proposal assembled, not frozen | not approved; product/data + legal/privacy owners jointly | `not_started` | `normalized_tax_id` in `needs_legal_review`, the `raw_data` default, and a version identifier |
| **GATE-4** Identity grain | 10N (proposed, option D); 10L § 8 | `partial_evidence_collected` — option recommended, key construction deferred | not approved; data architecture + product owners jointly | `not_started` | The `record_identity_key` construction, and GATE-3 (a key may only derive from allowlisted material) |
| **GATE-5** Output sanitization | 10O (proposed); 10L § 9 | `partial_evidence_collected` — twelve-surface contract assembled; schema unfrozen | not approved; security/privacy + test owners jointly | `not_started` | GATE-3 and GATE-4 open; small-cell `k` unset; string-length ceiling unset; **no test suite exists** |
| **GATE-6** Failure cleanup | **This packet § 4, § 5**; 10J § 9; 10K § 10; 10L § 10 | `partial_evidence_collected` — per-scenario matrix, ledger design, quarantine recommendation, verification mechanism, and escalation owner now assembled in proposal form | not approved; technical + operator owners jointly | `not_started` | GATE-2 (what may exist bounds what must be destroyed); `FC-A02` and `FC-A23` unenforceable until the envelope is chosen; **no cleanup implementation or verification command exists** |
| **GATE-7** Operator runbook | **This packet § 6, § 7**; 10J § 16; 10K § 11; 10L § 11 | `partial_evidence_collected` — runbook *contract* assembled; **the runbook section itself still does not exist** | not approved; operator + technical + privacy owners jointly | `not_started` | GATE-2 (no ceilings for `P-12`/`P-13`), GATE-5 (no frozen scan contract for `P-19`), GATE-6 (cleanup verification), and `P-05` failing by construction while any gate is unapproved |
| **GATE-8** No-write / no-runtime | **This packet § 8, § 9**; 10J § 11, § 12; 10K § 12; 10L § 12 | `partial_evidence_collected` — guard contract, rejection codes, rejection ordering, evidence contract, and the no-write test list assembled; **proofs unobtainable** | not approved; repo safety + technical owners jointly | `not_started` | The approvers' recorded contract-now / proofs-at-implementation split (§ 8.3); the proofs themselves land with an implementation that 10K § 4 forbids writing |

Rules that hold across the whole table:

```
evidence assembled   ≠  ready_for_review
ready_for_review     ≠  approved
approved             ≠  execution authorized
approved             ≠  import ready
three gates in one document  ≠  one approval
```

- **Five of the eight gates now have an assembled proposal** (GATE-3, GATE-4, GATE-5, GATE-6, GATE-7 as
  a contract, GATE-8 as a contract). **Zero are approved.**
- **GATE-1 and GATE-2 remain the two gates no document in this series can advance.** GATE-1 needs a
  legal determination; GATE-2 needs measurements and a choice. Everything else is, in the end, waiting
  on them.
- **A rejection propagates backwards, not forwards.** If GATE-2 chooses an envelope other than the one
  § 4.2 assumes as default, § 4 must be revised — but a GATE-2 approval does not approve § 4.

---

## 11. Accelerated GO / NO-GO matrix

**Documentation readiness:**

```
10I  full join import-readiness design        official
10J  full join dry-run technical design       official
10K  full join approval gates checklist       official
10L  full join gate evidence packet           official
10M  field allowlist decision record          official (proposal inside)
10N  identity grain decision record           official (proposal inside)
10O  output sanitization decision record      official (proposal inside)
10PQR remaining gates decision packet         proposed  (this document; official only after merge)
```

**Operational readiness:**

```
import                = false
production import     = false
runtime               = false
Agent 1               = false
full join runner      = absent (and forbidden to write — 10K § 4)
cleanup implementation = absent
CLI guard             = absent
operator runbook (full join) = absent
Supabase writes       = false
gates approved        = 0 of 8
```

**States:**

```
DOC_REVIEW_READY_AFTER_MERGE = true
FULL_JOIN_RUNNER_READY       = false
FULL_JOIN_EXECUTION_READY    = false
IMPORT_READY                 = false
RUNTIME_READY                = false
AGENT1_READY                 = false
```

And, restating the separation 10K § 15 makes load-bearing:

```
GO for document review        ≠  GO for runner implementation
GO for runner implementation  ≠  GO for execution
GO for execution              ≠  GO for import
GO for import                 requires a later, separate import authorization
```

`DOC_REVIEW_READY_AFTER_MERGE = true` is the **only** state this milestone can move, and it moves it
only after merge. It means: the documentation needed to *review* the remaining gates exists. It does not
mean the review happened, that it concluded, or that it concluded favourably.

---

## 12. Relationship with previous documents

### 12.1 The division of labour

```
10M  field allowlist       — which fields may exist, and where
10N  identity grain        — which record a row is, and what a key may be built from
10O  output sanitization   — what may leave the process, across twelve surfaces
10PQR (this packet)        — what must be destroyed when it ends (GATE-6),
                             how a human may run it at all (GATE-7),
                             what it must be unable to do (GATE-8),
                             and where all eight gates actually stand (§ 10)
```

Each layer is narrower than the last in a specific sense: 10M bounds existence, 10N bounds identity,
10O bounds emission, and this packet bounds **destruction, procedure, and capability**. A field that
10M permits, 10N may not key on; a value 10N permits, 10O may not emit; an artifact 10O permits, § 4
may still require destroyed; and § 8 removes the capability regardless of what the other three permit.

### 12.2 Inherited rules this packet adopts unchanged

- 10M's rule that **candidate-persistible does not imply output-reportable** — extended here: it does
  not imply *survivable* either. An artifact's permitted content says nothing about its permitted
  lifetime.
- 10N's rule that **no identity key, component, or derived value may appear in a file name or a path** —
  which is why the ledger (§ 4.6) and the cleanup report (§ 5) carry classes and never names.
- 10O's **universal forbidden set**, its **allowlist-governs** rule, its **sanitize-at-construction**
  boundary, its **no-stack-emission** narrowing, and its **§ 13 failure behavior** (no partial report, no
  downgrade, no retry without an operator) — which § 4 continues on the cleanup side rather than
  restating.
- 10O's **small-cell suppression** proposal — whose failure mode this packet makes a **leak-class
  terminating scenario** (`S11`), because an unsuppressible bucket is a disclosure, not a formatting
  problem.

### 12.3 Where this packet is deliberately narrower

- **Paths become a class enum** (§ 5.3), resolving 10O § 12's open question fail-closed for the cleanup
  and evidence surfaces only, without amending any other document's scope.
- **Quarantine is discouraged** (§ 4.2), where 10K § 10 permits "removed, or safely quarantined".
- **Delete-the-report is mandatory on a sanitization or suppression failure** (`S02`, `S11`), which is
  stricter than "keep only a sanitized failure summary".
- **Zero network calls is the recommendation** (`NB-20`), where the inherited material is silent.
- **No agent may operate the procedure** (§ 6.1), which the inherited runbook implies but never states.

Each narrowing is flagged as a **review item**, not applied by this document's authority.

### 12.4 Open items this packet inherits and does not resolve

```
GATE-2 architecture choice and every numeric ceiling      open
quarantine vs delete                                       recommended, not decided
normalized_tax_id survival (10M, needs_legal_review)       open
raw_data default (10M)                                     open
record_identity_key construction (10N)                     deferred
small-cell threshold k (10O)                               unset
string-length ceiling VP-8 (10O)                           unset
are real local manifest paths sensitive? (10O § 12)        open — handled fail-closed (§ 5.3)
indirect identifiability                                   open
```

Each is stated where it bites rather than collected only here: `FC-A02` / `FC-A23` for the envelope,
`P-12` / `P-13` / `P-19` for the ceilings and the scan contract, `S11` for the unset `k`.

---

## 13. Remaining explicit blockers after 10PQR

After this packet is merged, the following are still outstanding — and the list is deliberately
unshortened by the merge:

```
- owner review of this packet
- GATE-1 approval  (legal/privacy owner)
- GATE-2 approval  (technical + privacy owners)
- GATE-3 approval  (product/data + legal/privacy owners)
- GATE-4 approval  (data architecture + product owners)
- GATE-5 approval  (security/privacy + test owners)
- GATE-6 approval  (technical + operator owners)
- GATE-7 approval  (operator + technical + privacy owners)
- GATE-8 approval  (repo safety + technical owners)
- explicit authorization for runner implementation
- and, separately and later, an explicit import authorization
```

Beyond approvals, these artifacts still do not exist and are not created by this packet:

```
- the GATE-2 numeric ceilings, measured
- the frozen GATE-5 report schema, with k and the length ceiling set
- the record_identity_key construction
- the executable full-join operator runbook section
- the cleanup implementation and its verification mechanism
- the CLI guard implementation and its rejection codes in code
- every test in the FC-*, OR-*, NW-*, OS-*, and VP-* catalogues
- the full join runner itself
```

---

## 14. What may happen after 10PQR

**Recommended next hito: BR-SOURCE-10S — Receita full join gate owner review packet.**

Objective of 10S: consolidate this series' proposals into a single owner-review packet and produce an
**operational GO / NO-GO** — that is, get the named owners to actually review GATE-1 … GATE-8 and record
their determinations with the 10K § 14 template. It would write no code, create no migration, execute no
join, and authorize no import, Supabase write, index change, runtime, or Agent 1 integration.

Reasoning: the documentation path is now, in substance, complete for the five gates a document can
prepare. What is missing is no longer *artifacts* but *decisions* — and above all GATE-1's legal
determination and GATE-2's measurements, which no further docs milestone can produce. Writing a 10T, a
10U, and a 10V while zero gates are approved would be documentation as displacement activity.

**Alternative, if the owners are not formally available.** The next permitted technical step is **not
import**, and it is not execution. It would be:

**BR-SOURCE-11A — full join dry-run runner implementation behind hard no-write / no-runtime guards.**

Four conditions attach, and they are not negotiable by convenience:

- **It requires explicit authorization**, in the user's own words, because 10K § 4 forbids writing any
  full-join code — including scaffolding, stubs, and a runner behind a disabled flag — until all eight
  gates are approved. Choosing 11A over 10S therefore means **explicitly overriding an official gate
  rule**, which is the owners' call and no one else's.
- **It still would not authorize import**, execution against the real dataset, a Supabase write, a
  migration, an index change, runtime, or Agent 1.
- **It would still be blocked by GATE-1** for any actual run. A built runner that may not be run is a
  legitimate deliverable, but it must be recognized as one before it is chosen.
- **It would inherit every unset value** — the GATE-2 ceilings, `k`, the length ceiling — so parts of it
  could be written but not verified.

This is a **recommendation, not an execution**: BR-SOURCE-10PQR opens no such milestone, writes no
runner, and authorizes nothing further.

---

## 15. Current decision

```
Current decision: NO-GO
```

- This packet is `proposed_for_owner_review`.
- **GATE-6 remains `not_started` / not approved.**
- **GATE-7 remains `not_started` / not approved.**
- **GATE-8 remains `not_started` / not approved.**
- **All eight gates remain `not_started` / not approved.**
- **No migration may be created from this document alone** — nor any index created, dropped, altered, or
  validated.
- **No runner code may be written from this document alone** — nor from this document plus any
  combination of the existing designs; 10K § 4 requires all eight gates approved first.
- **No cleanup implementation, verification command, or CLI guard may be written from this document
  alone.** Each is code.
- **No test may be written from this document alone.** `FC-*`, `OR-*`, and `NW-*` are a traceability
  spine, not a suite.
- **No operator runbook section may be treated as existing**, and no manual execution is authorized.
- **No full join may be executed from this document alone.** GATE-1 blocks all execution and is
  unapproved.
- **No import may occur from this document alone**, and none may occur from a GATE-6, GATE-7, or GATE-8
  approval either.
- **No `record_identity_key`, join key, or `normalized_tax_id` may be constructed, persisted, or
  emitted** from this document alone.
- All eight gates remain unapproved, so the 10K § 15 matrix reads **NO-GO**. That is the expected and
  correct outcome: a decision packet that concluded GO would be evidence that gates had been approved by
  inference.

---

## 16. Required flags after 10PQR

This document adds the decision-packet flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_REMAINING_GATES_DECISION_PACKET_PR_READY = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_REMAINING_GATES_DECISION_PACKET_OFFICIAL = false  (not an operational authorization)

OPS_BR_FULL_JOIN_OUTPUT_SANITIZATION_DECISION_RECORD_OFFICIAL = true
OPS_BR_FULL_JOIN_IDENTITY_GRAIN_DECISION_RECORD_OFFICIAL       = true
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL      = true
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL         = true
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL     = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL             = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL              = true

OPS_BR_READY_FOR_IMPORT                       = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT            = false
OPS_BR_READY_FOR_RUNTIME                      = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY         = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false
```

Only when this PR is merged does the decision packet become official:

```
OPS_BR_FULL_JOIN_REMAINING_GATES_DECISION_PACKET_OFFICIAL = true
```

And even after that merge, Brazil stays non-operational and all three gates stay unapproved:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Carried forward from BR-SOURCE-10E–10O (unchanged):

```
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                  = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL      = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL    = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL            = true

OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED           = false
```

No gate flag is introduced, and no gate status changes. The 10J § 12 contract markers keep their values
— `field_allowlist_version: "not_approved"`, `record_identity_grain_decision: "not_decided"`,
`temporary_storage_mode: "not_approved"` — and 10O's proposed fourth marker,
`output_sanitization_version`, likewise stays `"not_approved"`. The eight gates are not flags; they are
recorded decisions, and this document records none.

---

## 17. Explicit non-goals

BR-SOURCE-10PQR does **not**:

- **approve GATE-6, GATE-7, or GATE-8**, or move any gate out of `not_started`;
- approve any gate, or move any gate to `ready_for_review`;
- grant legal or privacy approval;
- choose the GATE-2 storage envelope, set any numeric ceiling, or decide quarantine-vs-delete;
- freeze the GATE-5 report schema, set `k`, or set the string-length ceiling;
- implement anything;
- write cleanup code, a verification command, a CLI guard, a sanitizer, or any code;
- write, generate, or scaffold a test, a fixture, or a snapshot;
- write an executable operator runbook section, or authorize a manual execution;
- add a runner, a command, or a script;
- modify code, scripts, or package manifests;
- execute a full join;
- process the full or real dataset;
- download a dataset;
- import;
- write to `source_company_snapshots`;
- write to Supabase (any table);
- create or modify a migration;
- create, drop, alter, or validate an index;
- change the physical schema;
- construct, persist, or emit a `record_identity_key`, a join key, or a `normalized_tax_id`;
- emit any report, log, cleanup report, or artifact from real data;
- integrate runtime;
- integrate Agent 1;
- touch HubSpot;
- touch Slack;
- call any provider;
- change UI;
- change parser / reader / dry-run / manifest validator / connector runtime behavior;
- change any dedup, matching, or routing rule;
- resolve the `normalized_tax_id` survival question, the `raw_data` default, the deferred key
  construction, the indirect-identifiability question, or the manifest-path sensitivity question;
- advance Brazil toward production readiness.

---

## 18. Safety confirmation

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
- write cleanup code, a guard, a sanitizer, a test, a fixture, or any code;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- perform live generation or full expansion;
- approve any gate, record any approval, freeze any schema, or assign any approved contract version;
- use MCP, admin bypass, or self-approval;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, no razão social or nome
fantasia values, no addresses, no contacts, and no partner (sócio) personal data are reproduced. No
hash, truncation, or fingerprint derived from any identifier, name, or join key appears anywhere in this
document. Every field name, key shape, digit-length reference, enum member, error code, and JSON value
shown here is a schema name, a class label, a length rule, a zero, a `false`, or an explicit
placeholder — never a real value. The forbidden key-name references inherited from 10O § 5.2 are
**column and field names**, not data. Local WIP (`scratchpad/`) is untouched by any git operation.
