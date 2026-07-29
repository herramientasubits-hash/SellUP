# BR-SOURCE-10O — Receita CNPJ full join output sanitization decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10O — Receita CNPJ full join output sanitization decision record
**Status:** Official decision record of record (docs-only) — `proposed_for_owner_review`; **not** a GATE-5 approval, and **not** a build/import/dry-run/execution/migration authorization
**Predecessor:** BR-SOURCE-10N — `BRSOURCE10NLANDA — IDENTITY_GRAIN_DECISION_RECORD_MERGED` (PR #159, `main` HEAD `9ad2292e58223394981329bfd3b7611b57aef4ff`)
**Last reviewed:** 2026-07-29

**Related documents:**
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

> This document is a **decision record proposed for owner review**. It proposes, for GATE-5, the
> output sanitization contract for the future Receita CNPJ full join dry-run: what may appear in
> reports, JSON output, logs, console output, errors, exceptions, gate evidence, and operator
> summaries — and what may never appear in any of them. It **does not approve GATE-5**, does not move
> GATE-5 out of `not_started`, and does not substitute for the security / privacy owner or the test
> owner who jointly approve it. Nothing here authorizes — and nothing here should be read as
> authorizing — a runner, a sanitizer, a test, a script, a package change, a migration, an index
> change, a dataset download, full-dataset processing, full join execution, import, a Supabase write,
> a production write, a runtime change, an adapter/validator change, a provider call, a HubSpot sync,
> a Slack notification, live generation, full expansion, or merge to an operational state.
> **This document proposes an output contract; it approves none of it.**

---

## 1. Purpose

BR-SOURCE-10L recorded GATE-5 at `not_started` / `partial_evidence_collected` and named exactly what
was missing: a frozen report schema, **an exact closed list of forbidden key names** (the 10J § 15 set
ends in an "and equivalents" tail that no test can consume), an exact closed list of forbidden value
patterns including the digit-run rules for the three identifier lengths and the email-marker rule, **a
logging sanitization contract**, **an error sanitization contract**, the enumerated test cases, and
the joint owner approval ([gate evidence packet § 9](./br-receita-cnpj-full-join-gate-evidence-packet.md)).
10L also recorded *why* nothing could close it yet: the report schema "cannot be frozen while GATE-3
(which counts exist) and GATE-4 (which grain is reported) are open".

Both of those upstream questions are now assembled as proposals — GATE-3 by
[10M](./br-receita-cnpj-full-join-field-allowlist-decision-record.md) and GATE-4 by
[10N](./br-receita-cnpj-full-join-identity-grain-decision-record.md) — and 10N named GATE-5 as its own
recommended successor ([10N § 19](./br-receita-cnpj-full-join-identity-grain-decision-record.md)),
because GATE-5 is the next node on the 10L § 13 critical path (GATE-1 → GATE-3 → GATE-4 → GATE-5).

BR-SOURCE-10O supplies the missing artifact in the only form a docs-only milestone can: a **proposal,
assembled and labelled completely, submitted for the named owners' review**. It enumerates twelve
output surfaces rather than one report; states a universal forbidden-output set that applies to all
twelve; proposes the allowed aggregate classes; replaces the "and equivalents" tail with a **closed
key-name list plus a normalization and matching rule** that a future test could consume; proposes
closed value-pattern rules; proposes a small-cell suppression rule for the aggregate buckets 10M left
open; proposes an error/exception sanitization contract; and states the fail-closed behavior when the
sanitizer itself trips.

Where the underlying question is genuinely open — above all the `normalized_tax_id` survival item that
10M left in `needs_legal_review`, 10M's `raw_data` default, 10N's deferred key construction, and the
indirect-identifiability question — this record **states how it proceeds under that openness** rather
than resolving it by engineering preference. That is the 10M § 20 / 10N § 19 caveat applied to itself.

One boundary must be stated in the purpose rather than buried later, because it limits what this
milestone can claim. 10K § 9 makes *"every rule is expressed as an **assertion** a future test can
enforce, not as prose guidance"* a **pass criterion** for GATE-5. A docs-only milestone can enumerate
the assertions, name them stably, and make each one mechanically checkable in principle — and § 5.4
does exactly that. It **cannot write the tests**, because tests are code. This record therefore
**cannot satisfy GATE-5's pass criteria on its own**, by construction, and says so rather than
pretending an assertion catalogue is a suite (§ 3, § 16).

This document does **not**:

- **approve GATE-5**, move GATE-5 to `approved`, or substitute for either named approver;
- grant legal or privacy approval;
- replace the security / privacy owner or the test owner;
- freeze the report schema by its own authority;
- implement code, a sanitizer, a runner, or a script;
- write, generate, or scaffold a test;
- modify code, scripts, or package manifests;
- execute a full join;
- process the full or real dataset;
- import data;
- write to Supabase;
- create or modify a migration;
- create, drop, or modify an index;
- connect the runtime;
- connect Agent 1;
- touch HubSpot / Slack / providers / UI;
- approve the field allowlist (GATE-3), the identity grain (GATE-4), the storage envelope (GATE-2),
  the cleanup contract (GATE-6), the runbook (GATE-7), or the no-write guarantee (GATE-8);
- mark Brazil ready for anything.

If, at any point, this milestone concluded that it required code, a sanitizer, tests, scripts, package
changes, migrations, index changes, real execution, or a real GATE-5 approval to proceed, the correct
action is to **stop and escalate**, reporting
`BRSOURCE10O_SCOPE_ESCALATION_CODE_OR_GATE_APPROVAL_NOT_ALLOWED`. This document reaches no such
conclusion: an output contract is fully expressible as prose plus a closed enumeration plus a
conceptual schema, and every rule can be stated without emitting a single value, opening a single real
file, or writing a single line of code.

---

## 2. Current official baseline

The company-discovery / eligibility / readiness / approval / evidence / allowlist / grain line for
Receita CNPJ is official and merged as follows (design and governance of record; none is an
operational authorization):

- **BR-SOURCE-10I — full join import-readiness design is official.** Defines the allowed local
  processing envelope, the § 5 join-key treatment (the root is a *technical key only* — never a record
  identity, **never reportable**, never an import attribute), the three-category post-join field
  survival contract, the § 7 record-identity decision gate, the § 10 required future report shape, and
  GATE-1 … GATE-8 ([full join readiness design](./br-receita-cnpj-full-join-import-readiness-design.md)).
- **BR-SOURCE-10J — full join dry-run technical design is official.** Lowers that contract into an
  executable-in-the-future design: § 8.4 *allowed in the final report* and § 8.5 *never allowed in the
  final report*, the § 9 failure cleanup contract, the § 12 report contract with the three not-decided
  markers, and the § 15 security assertions a future implementation must ship
  ([full join technical design](./br-receita-cnpj-full-join-dry-run-technical-design.md)).
- **BR-SOURCE-10K — full join approval gates checklist is official.** Makes GATE-5 approvable:
  required evidence (report schema confirmed field by field, a closed forbidden-key-name list, a
  closed forbidden-value-pattern list, the digit-run rules for the three identifier lengths, the
  email-marker rule, raw-row and raw-cell rejection, stack-trace rejection, the all-false safety
  block), the joint approver roles (**security / privacy owner and test owner**), pass criteria (every
  rule expressed as an enforceable assertion; aggregate-only output; the fixed no-write contract
  values), fail criteria (sample values of any kind, join keys, identifier or contact or address
  values, row hashes derived from identifiers or the join key, any safety boolean that can legitimately
  be `true`), and an *Allows* clause limited to **writing sanitization tests in a future, separately
  approved milestone**
  ([approval gates checklist § 9](./br-receita-cnpj-full-join-approval-gates-checklist.md)).
- **BR-SOURCE-10L — full join gate evidence packet is official.** Records GATE-5 as `not_started` /
  `partial_evidence_collected`, enumerates the seven missing evidence items reproduced in § 1 above,
  and places GATE-5 on the § 13 critical path
  ([gate evidence packet § 9, § 13](./br-receita-cnpj-full-join-gate-evidence-packet.md)).
- **BR-SOURCE-10M — full join field allowlist decision record is official.** Proposes the GATE-3
  allowlist as a six-category lifecycle model with a per-surface matrix, proposes the § 8 category D
  aggregate report content, proposes `raw_data` prohibited by default, and states that the § 8 list is
  **candidate input to GATE-5, not a frozen schema** — and that GATE-5, not 10M, closes the schema
  ([field allowlist decision record § 8, § 13](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)).
- **BR-SOURCE-10N — full join identity grain decision record is official.** Evaluates all four grain
  options, recommends **option D** (estabelecimento as the operational unit with company/root
  context), defers the concrete `record_identity_key` construction, and requires that no identity key,
  key component, or derived value ever appear in a report, a log, an error, a count key, a file name,
  or a path
  ([identity grain decision record § 7, § 15](./br-receita-cnpj-full-join-identity-grain-decision-record.md)).

Also carried in, unchanged: **10E** (privacy-safe bounded dry-run classifier), **10F** (eligibility &
legal-nature calibration), **10G** (bounded company↔establishment join dry-run, join key ephemeral in
memory only), **10H** (bounded join coverage strategy, `coverage_is_representative` always false), and
the **BR-SOURCE-10C** headerless real-file support.

Flag state carried into this document, unchanged:

```
OPS_BR_FULL_JOIN_IDENTITY_GRAIN_DECISION_RECORD_OFFICIAL     = true
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL    = true
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL       = true
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL   = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL           = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL            = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                       = true
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
raised in § 9 or § 14 as a review item rather than resolved by this document's authority. Two such
differences exist and both are raised: the staging contract's `hash12 for report identifiers` and its
`safe sample identifiers only` audit line (§ 9.4).

---

## 3. Decision status

```
Decision record status: proposed_for_owner_review
GATE-5 official status: not_started / not approved
Current GO / NO-GO:     NO-GO
```

Rules attaching to that status:

- **This proposal may serve as GATE-5 evidence.** It is the artifact the 10K § 9 *Required evidence*
  clause and the 10L § 9 *Artifacts required to reach `ready_for_review`* clause name as missing — in
  proposal form, for six of the seven items.
- **This proposal does not approve GATE-5.** Only the security / privacy owner and the test owner,
  jointly, can — and only outside this document, recorded with the
  [10K § 14 approval template](./br-receita-cnpj-full-join-approval-gates-checklist.md).
- **This proposal does not move GATE-5 to `ready_for_review` either.** Submission and acceptance are
  separate recorded acts (10L § 3). Assembling the artifact is not submitting it.
- **This proposal cannot, by construction, satisfy GATE-5's pass criteria alone.** 10K § 9 requires
  every rule to be an enforceable assertion; § 5.4 enumerates and names the assertions, but the suite
  that enforces them is **code**, and 10K § 4 forbids writing any full-join code — including
  scaffolding, "harmless" stubs, or a runner behind a disabled flag — until all eight gates are
  approved. The 10K § 9 *Allows* clause is explicit that sanitization tests belong to a **future,
  separately approved** milestone. The honest reading: this record can make GATE-5 *reviewable*, and
  its review can conclude "approved subject to the test suite landing in that separate milestone", but
  the record does not and cannot deliver the suite.
- **This proposal does not freeze the report schema.** § 10 proposes a schema; freezing it is the
  approvers' act, and it also inherits GATE-3 and GATE-4 remaining open (10L § 9).
- **This proposal does not enable a sanitizer.** Naming a sanitizer boundary (§ 8.3, § 13) is design,
  not authorization; no sanitizer module, helper, or function is created, modified, or authorized.
- **This proposal does not enable full join execution.** GATE-1 is the blocker for all execution and
  is unapproved.
- **This proposal does not enable import.** Import requires a later, separate import authorization
  that no gate in this series grants (10K § 15).
- **An approved output contract would be a *report ceiling*, never a run authorization.**
- **Any sensitive leak resets GATE-5's evidence** to `evidence_not_collected` and the gate to
  `not_started` (10K § 4; 10L § 3), invalidating this proposal along with it. That rule is
  self-applying: this document is itself an output surface (§ 4, surface H).

---

## 4. Output surfaces under review

The single largest defect in the inherited material is **scope**: 10J § 8.4 / § 8.5 and 10J § 12
govern *the report*, while 10J § 15 adds two one-line rules about logs and errors, and nothing
governs stdout, stderr, exception objects, the evidence packet, the operator summary, or a pasted
terminal buffer. A leak does not care which surface it used. This record therefore treats **twelve
surfaces** as one contract with one forbidden set (§ 5) and per-surface allowances.

**The universal rule, stated once and inherited by all twelve:** every class in § 5 is forbidden on
every surface below, with no surface-specific exception, no debug mode, no verbose flag, no
environment variable, and no operator override. Surface-specific text adds restrictions; it never
relaxes § 5.

### A. CLI stdout

- **Allowed:** the mode name; stage-transition lines built from a closed enum; aggregate counts;
  bucket labels from a closed enum; safety booleans; elapsed time; the controlled `ok` verdict; a
  controlled error code on failure.
- **Forbidden:** everything in § 5. Additionally: any per-record line, any progress line that names a
  record, any "processing X" line where X derives from data, and any echo of a parsed cell.
- **Risk:** stdout is the surface most likely to be copied into a ticket, a PR, or a chat message, and
  it is the surface with the weakest habits — a debug `print` is one keystroke away.
- **Sanitization rule:** stdout is **enum-and-number only**. Every string a future runner prints must
  originate from a compile-time-known literal or a closed enum, never from parsed input. Assertion
  `OS-A20` (§ 5.4).
- **Failure behavior:** if a would-be stdout line fails the sanitizer, the line is dropped, the run
  fails closed with a controlled code, and the run is marked failed (§ 13).

### B. CLI stderr

- **Allowed:** a controlled error code; the failed stage enum; safe counts; safety booleans; the
  cleanup status enum.
- **Forbidden:** everything in § 5. Additionally: driver messages, library messages, and OS messages
  reproduced verbatim; any path outside the controlled local root; any partial line buffer.
- **Risk:** stderr is where raw exception text conventionally lands, and raw exception text is the
  single most likely carrier of a real value (§ 8).
- **Sanitization rule:** stderr carries **only** the sanitized error envelope of § 8.2. Nothing may
  reach stderr that has not passed the § 8.3 boundary. Assertion `OS-A21`.
- **Failure behavior:** a sanitizer failure on stderr is itself reported as a controlled code with no
  detail — never as "the sanitizer failed on «value»".

### C. JSON report file

- **Allowed:** the § 10 conceptual schema, and nothing outside it.
- **Forbidden:** everything in § 5. Additionally: any key not in the approved schema; any free-form
  string field; any nested raw object; any `raw`, `sample`, `example`, `debug`, or `extra` container
  under any name.
- **Risk:** JSON is machine-readable, easy to diff, easy to attach, and easy to extend by accident —
  an added key ships without a reader noticing.
- **Sanitization rule:** the report is built **explicitly, key by key, from the approved schema**, and
  every extra key is dropped rather than serialized — the same discipline the persistence contract § 5
  records after the historical schema-mismatch incident. Unknown-key tolerance is a fail, not a
  convenience. Assertions `OS-A22`, `OS-A23`.
- **Failure behavior:** an unexpected key, or a value failing § 5.2 / § 5.3, aborts report generation
  and discards the artifact (§ 13).

### D. Human-readable report file

- **Allowed:** a rendering of the same § 10 content — headings, count tables, bucket tables, the
  safety block, the cleanup status.
- **Forbidden:** everything in § 5. Additionally: any "examples" section, any "top values" table, any
  "worst offenders" list, any appendix.
- **Risk:** prose reports invite illustration, and one illustration is one leak. A "top 10
  municipalities" table is the canonical trap: it is aggregate in form and identifying in effect
  (§ 7).
- **Sanitization rule:** the human report is a **projection of the JSON report**, generated from it
  and never from the dataset. If a datum is not in the JSON report, it cannot be in the human report.
  Assertion `OS-A24`.
- **Failure behavior:** inherits C — no JSON report, no human report.

### E. Logs

- **Allowed:** § 11's list — stage enum, safe enum, aggregate count, elapsed time, a resource-usage
  **bucket**, safety booleans, controlled error code.
- **Forbidden:** everything in § 5. Additionally: join keys and identity keys (10J § 15 already;
  restated as a closed rule in § 9); any parsed cell; any file offset tied to a row; any log
  interpolation of a variable that ever held source data.
- **Risk:** logs persist, are shipped, are retained beyond the run, and are the surface least likely
  to be reviewed line by line.
- **Sanitization rule:** structured logging with a **closed field set**; no format-string
  interpolation of source-derived variables. Assertion `OS-A25`.
- **Failure behavior:** the log line is dropped and the run fails closed; a dropped log line is never
  retried with "less" content.

### F. Error messages

- **Allowed:** the § 8.2 envelope.
- **Forbidden:** everything in § 5, plus everything § 8.2 excludes.
- **Risk:** error text is assembled under time pressure and is the most common accidental carrier.
- **Sanitization rule:** § 8.3 — errors are **constructed from codes**, never from caught text.
  Assertions `OS-A30` … `OS-A34`.
- **Failure behavior:** fail closed with the generic controlled code (§ 13).

### G. Thrown exceptions

- **Allowed:** a typed error carrying a controlled code, a stage enum, and safe counts.
- **Forbidden:** everything in § 5. Additionally: a `message` built by interpolation; a `cause` chain
  carrying an unsanitized driver error; a `stack` emitted to any surface if the frames or the message
  can carry values; any custom property holding a parsed value.
- **Risk:** an exception is an object that travels — it crosses module boundaries, gets re-thrown,
  gets logged by a framework, and gets serialized by handlers that know nothing of this contract.
- **Sanitization rule:** an exception that leaves the parsing layer must already be sanitized —
  sanitization happens at **construction**, not at print time, because the print site cannot be
  enumerated. Assertion `OS-A35`.
- **Failure behavior:** an unsanitized exception reaching a boundary is itself a leak condition
  (§ 13).

### H. Gate evidence packet

- **Allowed:** § 12's list — the aggregate report, gate pass/block status, safety booleans, validation
  command **names**, document checksums, proof of no writes.
- **Forbidden:** everything in § 5. Additionally: sample rows, screenshots of real data, pasted
  terminal buffers, and — as § 12 states — a real manifest if the owners deem real local file paths
  sensitive.
- **Risk:** evidence is deliberately shared with more people than any other surface, and it is the one
  surface whose whole purpose is persuasion, which is exactly the pressure that produces "just one
  example".
- **Sanitization rule:** evidence is assembled **only** from artifacts that already passed C and E.
  Assertion `OS-A26`.
- **Failure behavior:** a leak in evidence resets the affected gates to `not_started` (10K § 4;
  10L § 3) — the harshest consequence of any surface, and correctly so.

### I. Operator summary

- **Allowed:** the mode, the verdict, aggregate counts, the safety block, the cleanup status, the next
  required gate.
- **Forbidden:** everything in § 5. Additionally: any narrative that reconstructs a record ("the
  largest company in …"), and any comparative claim that isolates a small cell (§ 7).
- **Risk:** summaries are written for humans by humans, which is where narrative reconstruction
  appears.
- **Sanitization rule:** the operator summary is a **projection of the JSON report**, like D.
  Assertion `OS-A24`.
- **Failure behavior:** inherits C.

### J. Future audit artifacts

- **Allowed:** run metadata from a closed set — mode, source key, country code, source period, safe
  counts, duration, cleanup status, verdict, gate state.
- **Forbidden:** everything in § 5. Additionally: `safe sample identifiers`, in any masked,
  truncated, or hashed form — see § 9.4, which raises the staging contract's inherited wording as a
  reconciliation item.
- **Risk:** audit surfaces are designed for retention, so a leak there is a leak with the longest
  half-life.
- **Sanitization rule:** audit rows carry **no per-record material of any kind**, masked or otherwise.
  Assertion `OS-A27`.
- **Failure behavior:** no audit artifact is emitted for a failed run beyond the sanitized failure
  summary (§ 13; 10J § 9).

### K. Future CI / test output

- **Allowed:** test names; assertion IDs from § 5.4; pass/fail; counts from synthetic fixtures.
- **Forbidden:** everything in § 5. Additionally: real dataset fixtures; a real value used as a
  negative test case; a real value in a snapshot file; a real value in a failure diff.
- **Risk:** CI output is public-by-default inside the org, is retained by the CI provider, and test
  fixtures are the classic route by which a "small" real sample enters a repository permanently.
- **Sanitization rule:** **synthetic fixtures only**, and every negative fixture is a
  structurally-valid-but-fabricated shape — never a real row, never a real identifier. Assertion
  `OS-A28`. Note the ordering constraint: this rule must be approved **before** the future test
  milestone the 10K § 9 *Allows* clause contemplates, since that milestone is what creates fixtures.
- **Failure behavior:** a real value in a fixture is a leak with repository permanence, and 10M § 5
  already classifies pasted rows in any document, PR, or report as category A.

### L. Screenshots or copied terminal output

- **Allowed:** nothing new — a screenshot may only show what A, B, or D already allow.
- **Forbidden:** everything in § 5. A screenshot is not a lesser surface because it is an image;
  10M § 5 lists screenshots of real rows as category A explicitly.
- **Risk:** images bypass every automated scan in the pipeline. No grep catches them.
- **Sanitization rule:** the only enforceable control is upstream — if A, B, and D can never render a
  forbidden value, a screenshot of them cannot either. This is the strongest argument for making the
  **terminal surfaces enum-only** (`OS-A20`) rather than trusting review.
- **Failure behavior:** not machine-detectable; handled by the § 12 evidence rule and by GATE-7's
  operator runbook, and named here as a **residual risk the approvers must accept explicitly**
  (§ 16).

---

## 5. Universal forbidden output classes

Forbidden on **all twelve surfaces** of § 4, with no exception, no debug mode, no verbose flag, no
environment variable, and no operator override. This restates
[10I § 5 / § 6.1](./br-receita-cnpj-full-join-import-readiness-design.md),
[10J § 8.1 / § 8.5 / § 15](./br-receita-cnpj-full-join-dry-run-technical-design.md),
[10M § 5](./br-receita-cnpj-full-join-field-allowlist-decision-record.md), and
[10N § 7 / § 15](./br-receita-cnpj-full-join-identity-grain-decision-record.md), and widens none of
them.

### 5.1 Forbidden content classes

**Fiscal and person identifiers**

- **Full CNPJ** — the 14-position value, in any surface, any format, any separator style, any partial
  form.
- **CNPJ básico / root** — the 8-position structural join key, in any surface. It is the *join key*,
  and 10I § 5 already forbids printing, persisting, hashing, or logging it.
- **CNPJ ordem** and **CNPJ dígito verificador** — the remaining components; a component is an
  identifier fragment, and fragments reassemble.
- **CPF** and any natural-person identifier — categorically, with no mode, gate, or exception.

**Person and partner data**

- **Sócios / QSA data** of any kind — the file family is rejected by name before any read.
- **Personal names** of owners, partners, or representantes.
- **`faixa etária`** or any partner attribute.
- **Any name that may identify a natural person**, including a company name that is a person's name —
  the common single-proprietor case, and the reason names are not merely a "business data" question.

**Company naming**

- **Raw razão social** — the legal name as published.
- **Raw nome fantasia** — the trade name as published.
- **Any sanitized, normalized, truncated, initialized, or token-reduced form of either** that is
  derived from a real value. 10M § 10 leaves *sanitized* legal and trade names at
  `needs_legal_review`; this record does not resolve that item, and therefore treats names as
  **forbidden in output** until it is resolved (§ 14). A field being potentially persistible in future
  is not a field being reportable now.

**Contact data**

- **Email** fields, and the **email marker character** appearing in any output value (10J § 15).
- **Telephone**, **fax**, and **DDD** fields.

**Address data**

- **`logradouro`** (street), **`numero`**, **`complemento`**, **`bairro`**, **`cep`** (postal code).
- **Any composed address line** built from any of the above.
- Note the boundary 10M § 5 already drew: **coarse location (`uf`, `municipality`) is a granularity
  question handled in § 6 and § 7, not a member of this class** — while the five fine-grained fields
  above are forbidden regardless of what is decided about coarse location.

**Raw material**

- **Raw CSV rows**, in any form, whole or partial.
- **Parsed cell values**, individually or as arrays.
- **Unfiltered raw JSON** echoing any source object.
- **Raw provider or source payloads** of any kind.
- **Row-level samples** — a single real value is a leak, not an illustration.
- **`raw_data` content** — 10M § 11 proposes `raw_data` prohibited by default; even were it approved
  for future persistence, persistence and reporting are different surfaces (§ 14).

**Keys and derivations**

- **Join keys** — including in file names, paths, count keys, and bucket labels.
- **`record_identity_key` values** — 10N § 15 requires this explicitly.
- **`normalized_tax_id` values** — independently of how the 10M § 10 legal item resolves, because that
  item concerns *persistence*, not *reporting* (§ 14).
- **Hashes, truncations, prefixes, suffixes, fingerprints, checksums, or any derived value** of a
  CNPJ, a CNPJ básico, a CPF, a name, a join key, a `record_identity_key`, a `normalized_tax_id`, or
  any personal datum. 10M § 5 states the principle: **the prohibition is on the derivation, not on the
  format**. A "safe" 12-character hash of an identifier is a forbidden value with a reassuring name.
- **Row hashes** of any construction.
- **File offsets or byte positions tied to a specific row**, which are a positional reference to a
  record and therefore a pointer identifier.

**Failure surfaces**

- **Full stack traces**, wherever the frames or the message could carry values (§ 8).
- **Raw SQL, driver, library, or OS error messages** containing values.
- **Partial or temporary report fragments** written before sanitization completed (§ 13; 10J § 9).

**Documents and images**

- **Screenshots or pasted rows from the real dataset**, in any document, PR, report, ticket, or
  message.
- **Real local manifests or dataset files** committed to the repository.

### 5.2 The closed forbidden key-name list

This is the item 10L § 9 named as missing: *"an exact, closed list of forbidden key names — the design
gives an illustrative set with an 'and equivalents' tail; a test needs a closed enumeration."* The
enumeration below **replaces** the 10J § 15 "and equivalents" tail. It is closed: no key may be
excluded by analogy, and no key may be admitted by absence from the list — admission is governed by
§ 6, which is likewise closed. Both directions matter; a denylist alone fails open.

**Normalization applied before matching** (so that layout, case, and separator variation cannot
evade):

```
1. lowercase
2. strip diacritics
3. replace every non-alphanumeric run with a single underscore
4. trim leading and trailing underscores
```

**Group 1 — person / partner (matched as a substring of the normalized name):**

```
socio            socios           qsa              cpf
representante    representantes   faixa_etaria     nome_socio
qualificacao_socio                 pais_origem_socio
representante_legal                 nome_representante
```

**Group 2 — contact (matched as a whole normalized name, or with a positional numeric suffix):**

```
telefone         telefone_1       telefone_2       fax
ddd              ddd_1            ddd_2            ddd_fax
correio_eletronico                 email
```

**Group 3 — fine-grained address (matched as a whole normalized name):**

```
logradouro       tipo_logradouro  numero           complemento
bairro           cep
```

**Group 4 — fiscal identifiers (matched as a substring of the normalized name):**

```
cnpj             cnpj_basico      cnpj_ordem       cnpj_dv
```

**Group 5 — company naming (matched as a whole normalized name):**

```
razao_social     nome_fantasia    nome_empresarial
```

**Group 6 — key and derivation containers (matched as a whole normalized name):**

```
join_key         record_identity_key               normalized_tax_id
row_hash         identifier_hash  hash12           masked_identifier
sample_identifier                  safe_sample_identifier
```

**Group 7 — raw containers (matched as a substring of the normalized name):**

```
raw              sample           example          debug
payload          row              cell             offset
```

Four rules make the list usable rather than merely long:

- **Group 4 substring matching is deliberately broad and will over-match.** Legitimate schema names
  such as a hypothetical `cnpj_root_count` would be caught. That is the correct trade-off for a
  fail-closed rule: the fix is to **name the aggregate without the identifier token**, not to weaken
  the matcher. The approvers should confirm this trade-off explicitly (§ 16).
- **Group 7 substring matching will over-match too** — `rows_seen_by_family` contains `row`. The
  resolution is the same and is structural, not cosmetic: § 6 is an **allowlist**, so
  `rows_seen_by_family` is permitted because it is *named in § 6*, not because it survives the
  denylist. **The allowlist governs; the denylist is a second, independent net.** Where the two
  disagree about a key that is in neither, the key is **forbidden**.
- **Matching applies to key names on every surface** — JSON keys, log field names, count-map keys,
  bucket labels, file names, and path segments (10M § 5 includes count keys and file names
  explicitly).
- **The list is closed but not final.** Only a recorded owner decision may add or remove an entry, and
  removal is the direction that requires the greater justification.

### 5.3 The closed forbidden value-pattern rules

The second item 10L § 9 named as missing. Every rule below is stated so that it applies to **values
and to key names alike**, after the § 5.2 normalization where relevant.

- **`VP-1` Digit-run rule, 8 positions.** No output value may contain a run of exactly 8 digits
  bounded by non-digits (CNPJ básico length).
- **`VP-2` Digit-run rule, 11 positions.** No output value may contain a run of exactly 11 digits
  bounded by non-digits (CPF length).
- **`VP-3` Digit-run rule, 14 positions.** No output value may contain a run of exactly 14 digits
  bounded by non-digits (full-CNPJ length).
- **`VP-4` Long-run rule.** No output value may contain a digit run **longer** than 14 positions
  either. `VP-1` … `VP-3` alone leave a gap that concatenation walks through; a report legitimately
  needs no long digit run at all.
- **`VP-5` Separator-insensitive rule.** `VP-1` … `VP-4` are evaluated **after** removing dots,
  slashes, hyphens, and spaces from the candidate value, so a formatted identifier is caught as
  readily as a bare one. Both the raw and the stripped forms are checked.
- **`VP-6` Email-marker rule.** No output value may contain the email marker character (10J § 15).
- **`VP-7` Free-text rule.** No output value may be a free-form string. Every string value is either
  a member of a closed enum, a fixed literal from the schema, or a numeral rendered as a string.
- **`VP-8` Length rule.** No enum-or-literal string value may exceed a modest fixed ceiling — the
  precise ceiling is left to the approvers, with **64 characters** proposed as a starting point. A
  long string in an aggregate report is a smell with no legitimate cause.
- **`VP-9` Non-numeric-count rule.** Every field named as a count, a total, or a distribution bucket
  carries an integer, never a string and never an object with per-record keys.
- **`VP-10` Object-key rule.** In any count map, the **keys** are bucket labels from a closed enum and
  are subject to § 5.2 and to `VP-1` … `VP-6`. A count map is the most common accidental carrier,
  because the value looks safe and the key is where the datum hides.

### 5.4 The assertion catalogue

10K § 9 requires each rule to be *"an assertion a future test can enforce, not prose guidance"*. The
catalogue below assigns each rule a **stable ID** so a future suite — in the separately approved
milestone the 10K § 9 *Allows* clause contemplates — can be traced to this record one-to-one. **No
test is written here.** The IDs are a review and traceability device, and the pattern rules are
already named `VP-1` … `VP-10`.

**Content assertions (all surfaces).**

```
OS-A01  no value matches VP-1 (8-position digit run)
OS-A02  no value matches VP-2 (11-position digit run)
OS-A03  no value matches VP-3 (14-position digit run)
OS-A04  no value matches VP-4 (digit run longer than 14)
OS-A05  VP-1..VP-4 evaluated separator-insensitively (VP-5)
OS-A06  no value contains the email marker (VP-6)
OS-A07  no key matches the § 5.2 closed denylist, after normalization
OS-A08  every key is present in the § 6 closed allowlist
OS-A09  no free-text string value (VP-7)
OS-A10  no string value exceeds the approved length ceiling (VP-8)
OS-A11  every count field is an integer (VP-9)
OS-A12  every count-map key is a closed-enum bucket label (VP-10)
OS-A13  no join key appears on any surface
OS-A14  no record_identity_key appears on any surface
OS-A15  no normalized_tax_id appears on any surface
OS-A16  no hash, truncation, prefix, or fingerprint of any identifier or name appears
OS-A17  no raw row, parsed cell, or raw payload appears
OS-A18  no row-tied file offset or byte position appears
OS-A19  no aggregate bucket below the approved k threshold is disclosed (§ 7)
```

**Surface assertions.**

```
OS-A20  stdout emits only fixed literals, closed enums, and numerals
OS-A21  stderr emits only the § 8.2 sanitized error envelope
OS-A22  the JSON report is built key-by-key from the approved schema
OS-A23  the JSON report contains no key outside the approved schema
OS-A24  human report and operator summary are projections of the JSON report
OS-A25  logs use a closed structured field set, with no interpolation of
        source-derived variables
OS-A26  gate evidence is assembled only from artifacts that already passed
        OS-A22 and OS-A25
OS-A27  audit artifacts carry no per-record material, masked or otherwise
OS-A28  test fixtures are synthetic; no real dataset value appears in any fixture
```

**Error assertions.**

```
OS-A30  every error carries a controlled code from a closed enum
OS-A31  no error message is built by interpolating a caught message
OS-A32  no error carries a driver, SQL, library, or OS message verbatim
OS-A33  no error carries a path outside the controlled local root
OS-A34  no stack trace is emitted to any surface
OS-A35  sanitization occurs at error construction, not at print time
```

**Invariant assertions (inherited from 10J § 15, restated unchanged).**

```
OS-A40  persisted_rows      = 0
OS-A41  supabase_write      = false
OS-A42  import_executed     = false
OS-A43  runtime_integration = false
OS-A44  agent1_integration  = false
OS-A45  every member of the safety block = false
OS-A46  temporary files removed, verified, on completion AND on failure
```

Three properties of this catalogue matter to the approvers:

- **`OS-A08` is the load-bearing assertion.** A denylist can be evaded; an allowlist cannot be evaded
  by novelty. If exactly one assertion had to survive, it is `OS-A08`.
- **`OS-A19` cannot be checked without a threshold**, which § 7 proposes and the approvers must set.
  Until they do, `OS-A19` is unenforceable and GATE-5 cannot pass on it.
- **`OS-A34` is stricter than 10J § 15**, which forbids errors containing raw rows. This record
  proposes forbidding **stack emission entirely**, because "the frames happen not to carry values" is
  a property of a specific failure, not of the code. Flagged for the approvers as a deliberate
  narrowing (§ 16).

---

## 6. Allowed aggregate output classes

Permitted **only in aggregate**, and only as named below. This is a **closed allowlist**: a field not
named here is forbidden, which is what makes `OS-A08` enforceable. It restates and extends 10J § 8.4 /
§ 12 and 10M § 8, and it widens neither.

**Run identity and mode**

- `mode` — a fixed literal.
- `ok` — the boolean verdict.
- `source_key` — the canonical technical source key literal.
- `country_code` — the fixed literal `BR`.
- `source_period` — publication period, as non-sensitive metadata; a period is not a record.
- `source_year` — explicit input, never hardcoded.
- `official_layout_mode` — the header / headerless layout enum (10C).

**Scope and safety invariants**

- `full_dataset_processed`
- `coverage_is_representative` — `false`; a full join does not make it true (10M § 8).
- `import_executed`, `supabase_write`, `runtime_integration`, `agent1_integration`,
  `hubspot_write`, `slack_write` — all contract-`false`.
- `persisted_rows` — contract-`0`.
- the `safety` block — every member contract-`false`.

**Volume and provenance counters**

- `files_seen` — a **count**, never a list of names.
- `file_family_counts` — counts keyed by the closed file-family enum.
- `file_families_accepted`, `file_families_rejected` — counts, or enum-keyed maps.
- `rows_seen_by_family` — counts keyed by the closed family enum.
- `total_rows_scanned` — **only if the approvers approve it.** A grand total is not obviously
  sensitive, but it is a precise dataset-scale disclosure, so it is proposed as approvable rather than
  as given.
- `companies_seen`, `establishments_seen`.

**Join outcome counters**

- `joined_establishments_count`
- `missing_company_context_count`
- `join_outcome_counts` — counts keyed by a closed outcome enum.

**Eligibility aggregates**

- `eligibility_status_counts` — keyed by the closed status enum.
- `eligibility_reason_counts` — keyed by the closed reason-code enum.
- `exclusion_reason_counts` — keyed by the closed exclusion-reason enum.

**Classification bucket aggregates** — every one subject to § 7

- `legal_nature_bucket_counts` — risk buckets, not raw legal-nature codes.
- `cnae_section_counts` — **top-level section only**, and only if approved. A five-position activity
  code in combination with coarse location is a strong re-identification vector (§ 7).
- `uf_counts` — only if approved.
- `municipality_count_distribution` — a **distribution of counts**, not municipality names, unless a
  named-municipality report is separately approved (10M § 8). This record **recommends against** named
  municipalities: a municipality with a single matching establishment is a record identifier wearing a
  place name.
- `registration_status_bucket_counts`
- `porte_bucket_counts` — company-size buckets.
- `capital_social_bucket_counts` — **buckets, never exact values**; the bucket boundaries must be
  fixed by GATE-5 (10M § 13).
- `opened_at_bucket_counts` — **buckets, never exact dates**; boundaries likewise fixed by GATE-5.
- `establishment_type_bucket_counts`

**Privacy and guardrail aggregates**

- `guardrail_counts` — counts keyed by the closed guardrail enum.
- `excluded_person_or_pii_risk`, `excluded_forbidden_token`,
  `excluded_forbidden_file_family`, `needs_legal_review`.
- `eligible_for_future_import_candidates` — a *measurement*, never an authorization (10J § 12).

**Run outcome**

- `cleanup_status` — the closed cleanup enum (GATE-6 owns its semantics).
- `duration_ms`
- `resource_usage_bucket` — a memory / disk **bucket**, never an exact figure tied to data volume.
- `warnings` — controlled enum codes only.
- `errors` — controlled enum codes only.
- `failed_stage` — the closed stage enum, on failure.

**Contract markers**

- `field_allowlist_version` — `"not_approved"` until GATE-3 closes.
- `record_identity_grain_decision` — `"not_decided"` until GATE-4 closes.
- `temporary_storage_mode` — `"not_approved"` until GATE-2 closes.
- `output_sanitization_version` — **proposed new marker**, `"not_approved"` until GATE-5 closes. Its
  purpose is to make a report self-describing about its own sanitization contract: without it, two
  reports produced under different contracts are indistinguishable. Proposed, not adopted (§ 18).

Five rules bound this list:

- **No row-level examples**, ever, under any field name.
- **No top-N value listings**, even of allowlisted buckets, when the listing can isolate a record
  (§ 7).
- **No rare-bucket disclosure** below the approved threshold (§ 7).
- **No values from raw columns** — a bucket derived from a column is allowed; the column's value is
  not.
- **No cross-tabulations** beyond those named here. A cross-tab is a new disclosure, not a
  re-presentation of two approved ones (§ 7).

And one status caveat, load-bearing: **this list is a proposal, not a frozen schema.** 10L § 9 records
that the schema cannot be frozen while GATE-3 and GATE-4 are open, and both remain open — their
records are `proposed_for_owner_review`. GATE-5's approvers freeze it; this document assembles it.

---

## 7. Minimum k-anonymity / small-cell suppression proposal

The gap this section addresses is not in the inherited documents, and it is the most consequential
finding of this record: **an aggregate-only report is not automatically a non-identifying report.** A
count of `1` in a sufficiently narrow bucket is a record. 10M § 8 already flags municipality naming as
needing separate approval, and 10N § 5.4 leaves combination-identifiability as an open GATE-1 /
GATE-3 item. Neither proposes a mechanism. This does.

**Proposed rule.**

- Any aggregate bucket whose count falls **below a minimum threshold `k`** is not disclosed. It is
  either **suppressed** or **merged** into a residual bucket labelled `other_or_suppressed_small_cell`.
- **Proposed `k` ≥ 10**, unless the security / privacy owner selects a different value. The value is
  the approvers' to set; the mechanism is what is proposed here.
- The residual bucket is reported as a **single count**, with no indication of how many distinct
  suppressed buckets it merges — a count of merged buckets is itself a disclosure.
- **Complementary suppression applies.** If exactly one bucket in a family is suppressed, its count is
  recoverable by subtraction from the family total, so a **second** bucket — the next smallest — must
  be suppressed with it. Suppressing one cell and publishing the total suppresses nothing.

**Scope of the rule.** It applies to every bucket family in § 6 that derives from record attributes:
`legal_nature_bucket_counts`, `cnae_section_counts`, `uf_counts`,
`municipality_count_distribution`, `registration_status_bucket_counts`, `porte_bucket_counts`,
`capital_social_bucket_counts`, `opened_at_bucket_counts`, `establishment_type_bucket_counts`, and
every eligibility, exclusion, and guardrail family. It does **not** apply to the run-level invariants
(`persisted_rows`, the safety block, `duration_ms`), which describe the run rather than the records.

**Cross-tabulation rule.** No cross-tab may be emitted if it produces any cell below `k`. In practice
this record proposes something stronger and simpler to enforce: **emit no cross-tabs at all** in the
first approved contract. Marginal distributions answer every question the readiness dry-run actually
asks — how much joins, how much is eligible, how the risk buckets distribute — and cross-tabs are
where small cells are manufactured. Adding a cross-tab later is a recorded decision; removing one
after it has shipped is a leak already delivered.

**Bucket-boundary rule.** A bucket definition that produces predictably tiny cells is itself a defect,
not merely a suppression trigger. The `capital_social` and `opened_at` boundaries GATE-5 must fix
(10M § 13) should be chosen so that expected cell sizes clear `k` by a comfortable margin — a bucket
that is always suppressed carries no information and only advertises that something rare exists.

**Status.** This whole section is `proposed_for_owner_review`, not approved. Two honest limitations:

- **`k` is not derivable from this document.** Choosing it is a privacy-owner judgement about
  re-identification risk against a public dataset that anyone can also obtain, and it interacts with
  the GATE-1 question of what the published dataset already discloses.
- **`OS-A19` is unenforceable until `k` is set**, so GATE-5 cannot pass on that assertion today
  (§ 5.4).

---

## 8. Error and exception sanitization contract

The third and fourth items 10L § 9 named as missing: a logging sanitization contract (§ 11) and an
error sanitization contract (this section).

### 8.1 Why errors need their own contract

The report is designed; errors are *emitted under failure*, by code paths that were not the author's
focus, carrying text from libraries that know nothing of this contract. Every historical leak class in
this line — a driver message, a raw row in an exception, a path disclosure — is a failure-path leak.
The applicable precedent is not hypothetical: this repository's most recent Apollo-line fix was
**redacting driver errors** in a suppression path. The failure path is where leaks live.

### 8.2 The sanitized error envelope

An error, on any surface, may carry **only**:

```
error_code          a value from a closed enum
failed_stage        a value from the closed stage enum
safe_counts         integers already permitted by § 6
file_family         a value from the closed file-family enum
gate_name           GATE-1 … GATE-8, as a literal
safety_flags        the all-false safety block
cleanup_status      a value from the closed cleanup enum
```

An error may **not** carry:

- a **raw driver, SQL, library, or OS message**, if it contains any value;
- a **raw CSV cell** or a **raw row**;
- a full CNPJ, a CNPJ básico, a CPF, or any identifier component;
- a name, an address, or a contact value;
- a **join key**, a **`record_identity_key`**, or a **`normalized_tax_id`**;
- a **file offset or byte position tied to a row**;
- a **path outside the controlled local root** (10J § 9);
- a **stack trace** (`OS-A34`, narrower than 10J § 15 — flagged in § 16);
- an **interpolated message** of any kind. Interpolation is the mechanism; forbidding the mechanism is
  enforceable, while forbidding "unsafe interpolations" is not.

### 8.3 The sanitizer boundary

**Proposed rule:** every future runner error must pass through a **single sanitization boundary**
before being printed, logged, thrown across a module edge, or written to any artifact.

Four properties the boundary must have:

- **It sanitizes at construction, not at print time** (`OS-A35`). Print sites cannot be enumerated —
  frameworks, handlers, and future callers print things — so an object that travels must already be
  clean.
- **It is fail-closed.** An input the sanitizer cannot classify becomes the generic controlled code,
  never a pass-through. "Unrecognized, therefore probably fine" is the inverse of this contract.
- **It never reports its own input.** A sanitizer that logs *"rejected unsafe value «…»"* is a leak
  with good intentions. It reports a code and a count.
- **It is the only constructor.** If an error can be built without it, it will be.

**And the boundary does not exist.** No such module is created, modified, or authorized by this
document. 10K § 4 forbids writing full-join code — including a "harmless" helper — until all eight
gates are approved. This is a **design proposal for a future, separately approved milestone**.

### 8.4 Caught-error handling

- **Catch, classify, discard.** A caught error is mapped to a controlled code; the original object is
  discarded, not attached, not chained, not stringified into a field.
- **Classification is by type and site**, never by pattern-matching the message text. Message-shape
  matching means reading the message, and library messages change between versions.
- **An unclassifiable error is not a reason to widen the envelope.** It maps to the generic code and
  the run fails closed (§ 13).

---

## 9. Join-key and identity-key output rule

### 9.1 The join key

Per [10I § 5](./br-receita-cnpj-full-join-import-readiness-design.md), the structural root
(`cnpj_basico`) is a **technical key only** — not a record identity, not a reportable field, not an
import attribute — and it may be used as an ephemeral in-memory join key **if prior gates approve**,
must never be printed, persisted, hashed, or logged, and must be discarded on completion **and** on
failure. 10G and 10H already operate that way in the bounded tooling.

The output consequence, stated as a closed rule: **the join key appears on no surface of § 4, in no
form.** Not as a value, not as a count key, not as a bucket label, not as a file-name component, not
as a path segment, not truncated, not prefixed, not hashed (`OS-A13`, `OS-A16`).

### 9.2 The identity key

Per [10N § 7](./br-receita-cnpj-full-join-identity-grain-decision-record.md), a
`record_identity_key` may be **constructed only in a future import path, if a future import is
authorized**, its concrete construction is **deferred**, and it is **not reportable in dry-run output
at any granularity, in any derived form**.

The output consequence: **no `record_identity_key` value, component, or derivation appears on any
surface** (`OS-A14`, `OS-A16`). And because 10N defers the construction, a corollary: **the dry-run
does not construct one at all.** There is nothing a readiness measurement needs it for, and a value
that is never constructed cannot leak. What the report may carry instead is the aggregate
*readiness* signal — how many joined records would have sufficient material to construct a key under
the approved grain — with no key ever built.

### 9.3 `normalized_tax_id`

10M § 10 leaves the survival of `normalized_tax_id` at `needs_legal_review`, and 10N § 8 records that
the question is **coupled** to the key construction. This record does not resolve either. Its output
rule is independent of both: **`normalized_tax_id` appears on no surface** (`OS-A15`). The open legal
question concerns *persistence*; reporting is a separate surface, and it is closed regardless (§ 14).

### 9.4 Two inherited-wording reconciliation items

Raised, not resolved — per § 2 the narrower rule governs, and both of these are the wider one:

- **`hash12 for report identifiers`** — [import-staging contract § 14](./br-receita-cnpj-import-staging-contract.md)
  lists a 12-character hash as the sanitization approach for report identifiers. That predates
  10M § 5's rule that **no hash, truncation, or fingerprint of an identifier may appear anywhere**, and
  it is directly contradicted by `OS-A16` and by 10K § 9's fail criterion *"row hashes derived from
  identifiers or from the join key"*. Under the narrower-rule principle, **no hashed identifier may
  appear in full-join dry-run output**, and the staging wording must be read as a legacy import-path
  convention that this contract supersedes for this surface. The approvers should confirm the
  reconciliation explicitly rather than leaving two documents disagreeing.
- **`safe sample identifiers only`** — [import-staging contract § 20](./br-receita-cnpj-import-staging-contract.md)
  permits safe sample identifiers in the audit surface. The same reconciliation applies: **no sample
  identifier, masked or otherwise, appears in any full-join dry-run output or audit artifact**
  (`OS-A27`), and both terms appear on the § 5.2 denylist for exactly this reason.

Neither item is a defect in the staging contract on its own terms — it governs a future *import*
writer, not a dry-run — but leaving them unreconciled is how a wider rule gets cited later as
precedent.

---

## 10. Dry-run JSON report contract

**Conceptual documentation only.** The structure below shows *shape*, with zeros and placeholders.
**No code is created. No runner is authorized. No report may be emitted.** It extends
[10I § 10](./br-receita-cnpj-full-join-import-readiness-design.md) and
[10J § 12](./br-receita-cnpj-full-join-dry-run-technical-design.md), and it carries the § 6
allowlist and the four not-approved contract markers.

```json
{
  "ok": true,
  "mode": "br_receita_full_join_dry_run",
  "source_key": "br_receita_cnpj_dados_abertos",
  "country_code": "BR",
  "source_period": "YYYY-MM",
  "official_layout_mode": "not_determined",
  "run_scope": {
    "full_dataset_processed": false,
    "coverage_is_representative": false,
    "import_executed": false,
    "supabase_write": false,
    "runtime_integration": false,
    "agent1_integration": false,
    "hubspot_write": false,
    "slack_write": false,
    "persisted_rows": 0
  },
  "safety": {
    "raw_rows_printed": false,
    "personal_values_printed": false,
    "cnpj_basico_printed": false,
    "cnpj_completo_printed": false,
    "cpf_printed": false,
    "emails_printed": false,
    "phones_printed": false,
    "addresses_printed": false,
    "names_printed": false,
    "join_keys_printed": false,
    "identity_keys_printed": false,
    "record_identity_keys_printed": false,
    "normalized_tax_ids_printed": false,
    "person_data_printed": false,
    "hashes_of_identifiers_printed": false,
    "small_cells_disclosed": false
  },
  "aggregate_counts": {
    "files_seen": 0,
    "file_family_counts": {},
    "rows_seen_by_family": {},
    "companies_seen": 0,
    "establishments_seen": 0
  },
  "eligibility_counts": {
    "eligibility_status_counts": {},
    "eligibility_reason_counts": {},
    "exclusion_reason_counts": {},
    "needs_legal_review": 0,
    "eligible_for_future_import_candidates": 0
  },
  "join_counts": {
    "joined_establishments_count": 0,
    "missing_company_context_count": 0,
    "join_outcome_counts": {}
  },
  "bucket_counts": {
    "legal_nature_bucket_counts": {},
    "cnae_section_counts": {},
    "uf_counts": {},
    "municipality_count_distribution": {},
    "registration_status_bucket_counts": {},
    "porte_bucket_counts": {},
    "capital_social_bucket_counts": {},
    "opened_at_bucket_counts": {},
    "establishment_type_bucket_counts": {},
    "other_or_suppressed_small_cell": 0
  },
  "guardrail_counts": {
    "excluded_person_or_pii_risk": 0,
    "excluded_forbidden_token": 0,
    "excluded_forbidden_file_family": 0
  },
  "run_outcome": {
    "cleanup_status": "not_applicable",
    "duration_ms": 0,
    "resource_usage_bucket": "not_measured",
    "failed_stage": null
  },
  "contract_markers": {
    "field_allowlist_version": "not_approved",
    "record_identity_grain_decision": "not_decided",
    "temporary_storage_mode": "not_approved",
    "output_sanitization_version": "not_approved"
  },
  "warnings": [],
  "errors": []
}
```

Seven rules attach to this shape:

- **Every count map is empty in the contract and enum-keyed at runtime.** An empty object is the
  correct documentation value; a populated example would be either fabricated or a leak.
- **`safety` is contract-valued, not measured.** Every member is `false` because the contract fixes it
  (10J § 12), and a boolean that could legitimately be `true` is a 10K § 9 fail criterion.
- **The `safety` block above extends 10J § 12** with `names_printed`, `identity_keys_printed`,
  `record_identity_keys_printed`, `normalized_tax_ids_printed`, `person_data_printed`,
  `hashes_of_identifiers_printed`, and `small_cells_disclosed`. Extensions are **proposed**, and the
  approvers freeze the final set.
- **The four contract markers stay not-approved / not-decided.** This document approves no gate, so it
  changes none of them.
- **`warnings` and `errors` hold controlled enum codes only**, never message text (§ 8).
- **No key outside the § 6 allowlist may be added** (`OS-A08`, `OS-A23`) — including a "temporary"
  debug key, which is the concrete way this contract would most plausibly be broken.
- **The nesting is illustrative, not normative.** Grouping affects readability, not sanitization; the
  approvers may restructure freely. What is normative is the **closed key set** and the **closed value
  rules**.

And, finally: **this schema is not frozen by this document.** GATE-3 and GATE-4 remain open, so
10L § 9's constraint still holds — GATE-5's approvers freeze it (§ 3).

---

## 11. Logs and console output contract

The logging item 10L § 9 named as missing.

**Logs and console output may include:**

- the **stage name**, from a closed enum;
- any **safe enum** value already permitted by § 6;
- an **aggregate count**, as an integer;
- **elapsed time**;
- a **memory / disk usage bucket** — a bucket, not an exact figure tied to data volume;
- **boolean safety flags**;
- a **controlled error code**;
- the **cleanup status** enum;
- the **gate name** being checked, as a literal.

**Logs and console output must not include:**

- **any raw source value** — cell, row, field, or fragment;
- **row snippets**, in any truncation;
- **identifiers** of any kind, or any component of one;
- **join keys** (10J § 15, restated as `OS-A13`);
- **`record_identity_key` values** (`OS-A14`);
- **`normalized_tax_id` values** (`OS-A15`);
- **names, addresses, or contact values**;
- **hashes or truncations** of any of the above (`OS-A16`);
- **raw exception messages** containing values (§ 8);
- **stack traces** (`OS-A34`);
- **file offsets tied to a row** (`OS-A18`);
- **paths outside the controlled local root**;
- **per-record progress lines** of any kind.

**Three structural rules**, because a content list alone is not enforceable:

- **Structured logging with a closed field set** (`OS-A25`). Each log event is an object whose keys
  come from a fixed set; there is no free-form message field to misuse.
- **No format-string interpolation of source-derived variables.** As with errors, forbidding the
  mechanism is checkable; forbidding "unsafe interpolations" is not.
- **Log volume is bounded and per-stage, never per-record.** A per-record log line is a per-record
  disclosure even when its content passes — the *cardinality* of the log reveals the dataset. Progress
  reporting is by stage and by count, on a coarse interval.

---

## 12. Gate evidence output contract

**Evidence prepared for the owners may include:**

- the **aggregate report** (§ 10), as produced;
- the **list of gates** passed, blocked, or not started;
- the **safety booleans**, all false;
- the **names of validation commands** run — names, never their raw output;
- **checksums of documents or code**, provided the checksum is **not derived from a dataset
  identifier, a dataset row, or a dataset file whose hash the owners deem sensitive**;
- **proof of no writes** — the all-false invariants, and the absence of a writer in the path;
- the **assertion IDs** of § 5.4 and their pass/fail state, once a future suite exists.

**Evidence must not include:**

- **sample rows**, of any size, from anywhere;
- **screenshots containing raw values** (§ 4, surface L; 10M § 5);
- **copied terminal rows** or pasted buffers;
- **CNPJ, CNPJ básico, CPF, names, addresses, or contacts**, in any form;
- **hashes or truncations** of any of those (`OS-A16`);
- **the real manifest**, if the owners deem real local file paths sensitive — the runbook keeps the
  dataset outside the repository for exactly this reason, and this record does not decide the
  question; it flags it (§ 16);
- **join-key samples** or **identity-key samples** (§ 9);
- **raw command output**, as opposed to a command name plus a verdict.

**Two rules on assembly:**

- **Evidence is assembled only from artifacts that already passed the report and log contracts**
  (`OS-A26`). It is never assembled from the dataset, from a scratch file, or from a terminal
  scrollback.
- **A leak in evidence is the most expensive leak available.** It resets the affected gates to
  `not_started` and invalidates the preceding evidence (10K § 4; 10L § 3) — including this record.

---

## 13. Failure behavior

Fail-closed, and stated as a sequence rather than a sentiment. This restates
[10J § 9](./br-receita-cnpj-full-join-dry-run-technical-design.md) and does not widen it; GATE-6 owns
the cleanup contract itself, and this section only states the **output** side of failure.

**If the sanitizer detects forbidden output, or fails to classify a candidate:**

```
1. abort report generation immediately — no "best effort" report
2. discard the unsafe artifact — do not write it, do not keep it for inspection,
   do not move it aside
3. emit only a controlled error_code plus the § 8.2 envelope
4. preserve the cleanup contract for GATE-6 — temporary indexes, partial reports,
   and temporary files destroyed and verified, on failure as on success
5. mark the dry-run failed — never partially successful
6. do not continue to import, write, or runtime — under any condition
```

**Five rules that make the sequence load-bearing:**

- **A leak is a failure, never a partial success.** 10I § 5, 10J § 7, and 10K § 4 agree: a leak
  **cancels the run** and **resets the affected gates to `not_started`**, invalidating the evidence
  that preceded it.
- **No retry without an operator** (10J § 9). A failed run does not silently re-run, and it does not
  re-run "with sanitization enabled" as though that were a mode.
- **No downgrade path.** There is no "emit the report without the failing section" fallback. A partial
  report is an unreviewed report.
- **The sanitizer's own failure is silent about its input** (§ 8.3). It reports a code and a count.
- **No Supabase write under any condition** — not on success, not on failure, not on retry
  (`OS-A41`).

**The safety block on failure is identical to the safety block on success:**

```
persisted_rows      = 0
import_executed     = false
supabase_write      = false
runtime_integration = false
agent1_integration  = false
```

---

## 14. Relationship with 10M field allowlist

```
10M defines field lifecycle categories.
10O defines output-reportability.
```

They are **different axes**, and conflating them is the error this section exists to prevent. 10M's
six categories (A forbidden always, B temporary technical only, C classification signal only,
D aggregate report only, E candidate future persistible, F needs legal/privacy review) describe a
field's **lifecycle**. This record describes a field's **appearance on an output surface**. A field
can therefore be:

- **allowed for internal temporary processing but forbidden in output** — 10M category B, the join key
  being the canonical case (§ 9.1);
- **candidate-persistible in a future import but still forbidden in dry-run reports** — 10M category
  E; persistence and reporting are separate surfaces, and an approval for one is not an approval for
  the other;
- **aggregate-reportable only** — 10M categories C and D, where the record earns a bucket and the
  bucket is reportable while the value is not;
- **never outputtable** — 10M category A, and everything in F for as long as F persists.

**The load-bearing inference, stated explicitly because it is the one most likely to be misread:**

```
A field being candidate-persistible under 10M does NOT mean it is
output-reportable under 10O.
```

Three consequences follow, and each is how this record proceeds under an openness it does not resolve:

- **`normalized_tax_id` stays out of output** regardless of how its 10M § 10 `needs_legal_review`
  status resolves (§ 9.3). If it is approved for persistence, it is still not reportable; if it is
  excluded, nothing here changes.
- **Sanitized legal and trade names stay out of output** for as long as 10M leaves them in category F
  (§ 5.1). A field under review is not a field available.
- **`raw_data` stays out of output** whatever its persistence default becomes. 10M § 11 proposes
  prohibited by default; even an approved minimal typed allowlist would be a *persistence* allowlist.

And, in the other direction: **this record depends on 10M and cannot outrun it.** The § 6 allowlist is
built from 10M § 8, which is itself `proposed_for_owner_review`. If GATE-3's approvers change the
field set, § 6 changes with it — which is precisely why 10L § 9 says the schema cannot be frozen while
GATE-3 is open, and why § 3 says this record cannot freeze it either. The bucket definitions 10M § 13
assigns to GATE-5 — municipality naming, `capital_social` boundaries, `opened_at` boundaries, and the
controlled `warnings` / `errors` enums — are addressed in § 6 and § 7 as **proposals**, and § 7 adds
the small-cell mechanism 10M did not have.

---

## 15. Relationship with 10N identity grain

10N proposes **option D: estabelecimento as the operational unit, with empresa/root as context**, and
**defers** the concrete `record_identity_key` construction because one candidate inherits the open
`normalized_tax_id` question and the other would require an unapproved surrogate derivation.

**What this record requires as a consequence:**

- **No establishment identity value in outputs.** Not the full 14-position identifier, not any
  component, not any derivation (`OS-A03`, `OS-A16`).
- **No root or join key in outputs** — 10N's grain choice makes the root *structurally central to the
  join*, which raises rather than lowers the stakes on § 9.1. A key used everywhere internally is a
  key with many opportunities to escape.
- **No `record_identity_key` in outputs** (`OS-A14`) — and, per § 9.2, **none constructed at all**
  during a dry-run.
- **No `normalized_tax_id` in outputs** (`OS-A15`).
- **Only aggregate counts about identity-construction readiness may appear** — how many joined records
  would have sufficient material to construct a key under the approved grain, as a count, with no key
  built and no per-record trace.
- **`record_identity_grain_decision` stays `"not_decided"`** in the § 10 report until GATE-4 is
  approved. A report that names an approved grain while GATE-4 is open would be asserting an approval
  by inference.

**And the grain interacts with § 7 in a way the approvers should see.** Under option D the reporting
unit is the *establishment*, which is finer-grained than the company — so bucket cells are **smaller
at the same nominal threshold** than they would be under a root-grain model, and a single-establishment
municipality is exactly the small cell § 7 suppresses. The grain choice therefore makes small-cell
suppression more necessary, not less. That is a consequence worth recording, not an objection to the
grain.

**What this record does not do to 10N:** it does not approve GATE-4, does not resolve the deferred key
construction, does not select between the two constructions, and does not touch the physical
unique-index question (10N § 9) — which would be a **migration**, outside both gates entirely.

---

## 16. Proposed GATE-5 review checklist

For the **security / privacy owner and the test owner, jointly** (10K § 9). Either may reject alone;
approval requires both. Neither may be an implementing agent or the author of this record.

- [ ] **Confirm the universal forbidden output classes** (§ 5.1) — and confirm they apply to all
      twelve surfaces with no surface-specific exception, no debug mode, and no operator override.
- [ ] **Confirm the closed forbidden key-name list** (§ 5.2), including the normalization procedure,
      the seven groups, and the deliberate over-matching of groups 4 and 7 — with the resolution being
      to rename aggregates rather than weaken the matcher.
- [ ] **Confirm the closed forbidden value-pattern rules** (§ 5.3), including `VP-4` (runs longer than
      14) and `VP-5` (separator-insensitive evaluation), which are additions to the inherited three
      digit-run rules.
- [ ] **Set the string-length ceiling** `VP-8` (64 proposed) or select another value.
- [ ] **Confirm the aggregate-only allowlist** (§ 6) — and confirm that the **allowlist governs**, so
      that a key absent from it is forbidden even if it survives the denylist (`OS-A08`).
- [ ] **Decide the four approvable-but-unapproved aggregates**: `total_rows_scanned`,
      `cnae_section_counts`, `uf_counts`, and named municipalities (recommended **against**).
- [ ] **Set the small-cell threshold `k`** (§ 7; `k ≥ 10` proposed) and confirm the residual-bucket,
      complementary-suppression, and no-cross-tab rules. `OS-A19` is unenforceable until `k` is set.
- [ ] **Fix the bucket boundaries GATE-5 owns** (10M § 13): `capital_social`, `opened_at`, the
      municipality treatment, and the controlled `warnings` / `errors` enums.
- [ ] **Confirm that no identity key is output** (§ 9.2) — and confirm the corollary that a dry-run
      **constructs none at all**.
- [ ] **Confirm that no hash, truncation, or fingerprint of any identifier is output** (`OS-A16`).
- [ ] **Reconcile the two inherited wordings** (§ 9.4): the staging contract's `hash12 for report
      identifiers` and `safe sample identifiers only`. Confirm that the narrower rule governs for this
      surface, so both are unavailable in full-join dry-run output and audit artifacts.
- [ ] **Confirm the error and exception sanitization contract** (§ 8), including the
      sanitize-at-construction rule (`OS-A35`) and the no-interpolation rule (`OS-A31`).
- [ ] **Decide the stack-trace narrowing** (`OS-A34`): this record proposes forbidding stack emission
      **entirely**, which is stricter than 10J § 15's "no raw rows in errors".
- [ ] **Confirm the logs / console contract** (§ 11), including structured-only logging and the
      **no-per-record-log-line** cardinality rule.
- [ ] **Confirm the JSON report contract** (§ 10), including the extended `safety` block and the
      proposed `output_sanitization_version` marker.
- [ ] **Confirm the gate evidence contract** (§ 12), and **decide whether real local file paths in a
      manifest are sensitive** — this record flags the question and does not answer it.
- [ ] **Confirm the failure behavior** (§ 13), including no partial report, no downgrade path, and no
      retry without an operator.
- [ ] **Confirm the relationship with 10M** (§ 14) — specifically that candidate-persistible does not
      imply output-reportable.
- [ ] **Confirm the relationship with 10N** (§ 15) — including that option D's finer grain makes
      small-cell suppression *more* necessary.
- [ ] **Accept the residual screenshot / copy-paste risk explicitly** (§ 4, surface L) — it is not
      machine-detectable and is controlled only by making the terminal surfaces enum-only and by
      GATE-7's runbook.
- [ ] **Confirm the assertion catalogue** (§ 5.4) as the traceability spine for the future suite — and
      **acknowledge that no test exists**, that this record cannot create one, and that GATE-5's
      "every rule is an enforceable assertion" criterion is therefore met **in specification only**.
- [ ] **Confirm that no runner, sanitizer, test, import, migration, index change, or write is
      authorized** by this decision.
- [ ] **Record the decision with the 10K § 14 template** — roles not identities, no sensitive values,
      rejections kept as part of the audit trail. An approval not recorded in that shape does not
      exist.

---

## 17. Current decision

```
Current decision: NO-GO
```

- This record is `proposed_for_owner_review`.
- **GATE-5 remains `not_started` / not approved.**
- **No migration may be created from this document alone** — nor any index created, dropped, altered,
  or validated.
- **No runner code may be written from this document alone** — nor from this document plus any
  combination of the existing designs; 10K § 4 requires all eight gates approved before any full-join
  code is written.
- **No sanitizer may be written from this document alone.** A sanitizer is code, and § 8.3's boundary
  is a design proposal for a future, separately approved milestone.
- **No test may be written from this document alone.** The 10K § 9 *Allows* clause places sanitization
  tests in a future, separately approved milestone, and it is conditioned on GATE-5 being approved
  first.
- **No full join may be executed from this document alone.** GATE-1 blocks all execution and is
  unapproved.
- **No import may occur from this document alone**, and none may occur from a GATE-5 approval either.
- **No report may be emitted from this document alone**, and no report schema is frozen by it.
- **No `record_identity_key`, join key, or `normalized_tax_id` may be constructed, persisted, or
  emitted** from this document alone.
- All eight gates remain unapproved, so the 10K § 15 matrix reads **NO-GO**. That is the expected and
  correct outcome: a decision record that concluded GO would be evidence that a gate had been approved
  by inference.

---

## 18. Required flags after 10O

This document adds the decision-record flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_OUTPUT_SANITIZATION_DECISION_RECORD_PR_READY = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_OUTPUT_SANITIZATION_DECISION_RECORD_OFFICIAL = false  (not an operational authorization)

OPS_BR_FULL_JOIN_IDENTITY_GRAIN_DECISION_RECORD_OFFICIAL      = true
OPS_BR_FULL_JOIN_FIELD_ALLOWLIST_DECISION_RECORD_OFFICIAL     = true
OPS_BR_FULL_JOIN_DRY_RUN_GATE_EVIDENCE_PACKET_OFFICIAL        = true
OPS_BR_FULL_JOIN_DRY_RUN_APPROVAL_GATES_CHECKLIST_OFFICIAL    = true
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL            = true
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL             = true

OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Only when this PR is merged does the decision record become official:

```
OPS_BR_FULL_JOIN_OUTPUT_SANITIZATION_DECISION_RECORD_OFFICIAL = true
```

And even after that merge, Brazil stays non-operational and GATE-5 stays unapproved:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

Carried forward from BR-SOURCE-10E–10N (unchanged):

```
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                  = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL      = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL    = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL            = true

OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED           = false
```

No gate flag is introduced, and no gate status changes. The three 10J § 12 contract markers keep their
values — `field_allowlist_version: "not_approved"`,
`record_identity_grain_decision: "not_decided"`, `temporary_storage_mode: "not_approved"` — and the
**proposed** fourth marker, `output_sanitization_version`, is likewise `"not_approved"` and is a
proposal rather than an adopted field (§ 10). The eight gates are not flags; they are recorded
decisions, and this document records none.

---

## 19. Explicit non-goals

BR-SOURCE-10O does **not**:

- **approve GATE-5**, or move any gate out of `not_started`;
- grant legal or privacy approval;
- freeze the report schema;
- set the small-cell threshold `k`, the string-length ceiling, or the bucket boundaries — it proposes
  them;
- implement anything;
- write a sanitizer, a sanitization helper, or any code;
- write, generate, or scaffold a test, a fixture, or a snapshot;
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
- construct, persist, or emit a `record_identity_key`, a join key, or a `normalized_tax_id`;
- emit any report, log, or artifact from real data;
- integrate runtime;
- integrate Agent 1;
- touch HubSpot;
- touch Slack;
- call any provider;
- change UI;
- change parser / reader / dry-run / manifest validator / connector runtime behavior;
- change any dedup, matching, or routing rule;
- approve the field allowlist (GATE-3), the identity grain (GATE-4), the storage envelope (GATE-2),
  the cleanup contract (GATE-6), the runbook (GATE-7), or the no-write guarantee (GATE-8);
- resolve the `normalized_tax_id` survival question, the `raw_data` default, the deferred key
  construction, or the indirect-identifiability question;
- advance Brazil toward production readiness.

---

## 20. Recommended next hito

**BR-SOURCE-10P — Receita full join failure cleanup decision record.**

Objective of 10P: resolve **GATE-6** as a docs-only decision record — what must happen if the future
dry-run fails, how temporary artifacts are cleaned up, and how it is guaranteed that no temporary
index, unsafe report, partial file, sensitive log, or unsanitized output survives a failure. It would
approve no import, write no code, create no migration, and authorize no execution, Supabase write,
index change, runtime, or Agent 1 integration.

Reasoning: GATE-6 is the natural successor along two independent lines. § 13 of this record states the
**output** side of failure and stops there, deliberately, because the cleanup contract itself is
GATE-6's; and 10L § 13 records that GATE-6 blocks GATE-7's cleanup-verification steps, so GATE-7
cannot be prepared before it. GATE-6 is also, like GATE-3, GATE-4, and GATE-5, a decision a docs-only
milestone can genuinely prepare rather than an approval act only a legal owner can perform.

Four caveats attach:

- **GATE-6 cannot be *approved* by 10P either.** Its named approvers approve it outside the document,
  recorded with the 10K § 14 template.
- **GATE-6 inherits an upstream dependency 10P cannot resolve.** 10L § 13 is explicit: *"what must be
  destroyed is undefined until what may exist is decided"* — GATE-2's temporary storage envelope is
  unapproved, so 10P must state its cleanup contract **conditionally on the envelope**, covering the
  in-memory and the temporary-file cases separately, rather than assuming one.
- **10P inherits every open item of 10M, 10N, and this record** — the `normalized_tax_id` survival
  question, the `raw_data` default, the deferred key construction, the indirect-identifiability
  question, and the unset `k`. It must state how it proceeds under that openness rather than resolving
  any of it by preference.
- **GATE-1 remains the true blocker for everything.** Sequencing GATE-3 → GATE-4 → GATE-5 → GATE-6 is
  a convenience, not a route around GATE-1. Nothing executes while GATE-1 is unapproved. And a
  docs-only milestone can enumerate cleanup assertions but cannot write the verification, which is
  code.

This is a **recommendation, not an execution**: BR-SOURCE-10O opens no such milestone and authorizes
nothing further.

> **Update (BR-SOURCE-10PQR).** That successor landed **accelerated** — as one docs-only packet covering
> the three remaining preparable gates rather than three sequential milestones (10P, 10Q, 10R):
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md).
> It carries the GATE-6 objective above intact (§ 4, § 5: a thirteen-scenario cleanup matrix, a closed
> destroyable-artifact class list, a before-creation temporary-artifact ledger, ledger reconciliation as
> the verification mechanism, and the escalation pair), and adds the GATE-7 runbook **contract** (§ 6,
> § 7) and the GATE-8 no-write / no-runtime **contract** (§ 8, § 9), plus a readiness table for all eight
> gates (§ 10).
>
> All four caveats above hold, and the packet states each of them itself:
>
> - **no gate is approved** — GATE-6, GATE-7, and GATE-8 all remain `not_started` / not approved, each
>   awaiting its own owner set and its own 10K § 14 entry, and *one document is explicitly not one
>   approval*;
> - **the GATE-2 dependency is unresolved and handled conditionally** — the cleanup contract is stated
>   separately for in-memory-only (`E1`) and approved-ephemeral-disk (`E2`), and two of its assertions are
>   unenforceable until the envelope is chosen;
> - **every open item of 10M, 10N, and this record is inherited, not resolved** — the `normalized_tax_id`
>   survival question, the `raw_data` default, the deferred key construction, indirect identifiability, the
>   unset `k`, and the unset length ceiling; the unset `k` is what makes a small-cell suppression failure a
>   **leak-class terminating scenario** there rather than a formatting problem;
> - **GATE-1 remains the true blocker**, and no verification, cleanup routine, guard, test, runner, or
>   runbook section is written.
>
> Two items of this record are continued there rather than restated: § 13's failure behavior gains its
> cleanup counterpart (destruction, ordering, and verification), and **§ 12's open question of whether a
> real local manifest path is sensitive is resolved fail-closed for the cleanup and evidence surfaces
> only** — those surfaces emit a `directory_class` enum and never a path — without amending this record's
> or the staging contract's own scope.

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
- create, drop, alter, or validate an index;
- change the parser, reader, dry-run, manifest validator, snapshot builder, join dry-run, or any
  connector runtime behavior;
- write a sanitizer, a test, a fixture, or any code;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- perform live generation or full expansion;
- approve any gate, record any approval, freeze any schema, or assign an approved
  `output_sanitization_version`;
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, no razão social or nome
fantasia values, no addresses, no contacts, and no partner (sócio) personal data are reproduced. No
hash, truncation, or fingerprint derived from any identifier, name, or join key appears anywhere in
this document. Every field name, key shape, digit-length reference, and value shape referenced here is
a schema name, a length rule, or an explicit placeholder — never a real value. The forbidden key-name
groups in § 5.2 are **column and field names**, not data. Local WIP (`scratchpad/`) is untouched by
any git operation.
