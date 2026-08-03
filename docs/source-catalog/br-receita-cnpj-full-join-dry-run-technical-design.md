# BR-SOURCE-10J — Receita CNPJ full join dry-run technical design

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-10J — Receita CNPJ full join dry-run technical design
**Status:** Official design of record (docs-only) — **not** a build/import/dry-run/execution authorization
**Predecessor:** BR-SOURCE-10I — `BRSOURCE10ILANDA — FULL_JOIN_IMPORT_READINESS_DESIGN_MERGED` (PR #151, `main` HEAD `ad46d4eb88b303210f5160161b7ccaaae082045b`)
**Last reviewed:** 2026-07-29

**Related documents:**
- GATE-2 route decision package (BR-SOURCE-11J, docs-only) — [`br-receita-cnpj-gate2-route-decision-package.md`](./br-receita-cnpj-gate2-route-decision-package.md)
- Full join field allowlist decision record (GATE-3 proposal) — [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join import-readiness design (contract) — [`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md)
- Privacy-safe import eligibility design — [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)
- Import & staging persistence contract — [`br-receita-cnpj-import-staging-contract.md`](./br-receita-cnpj-import-staging-contract.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Identity grain & data contract — [`br-receita-cnpj-data-contract.md`](./br-receita-cnpj-data-contract.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)

> This document is a **technical design of record**. It **descends** the BR-SOURCE-10I readiness
> contract into an executable-in-the-future design, and it changes nothing about what is allowed
> today. Nothing here authorizes — and nothing here should be read as authorizing — a runner,
> script, package change, migration, dataset download, full-dataset processing, full join
> execution, import, Supabase write, production write, runtime change, adapter/validator change,
> provider call, HubSpot sync, Slack notification, live generation, full expansion, or merge to
> an operational state. Every one of those remains a separate, individually-approved milestone
> gated behind GATE-1 … GATE-8 (§ 13). **This document designs; it executes nothing.**

---

## 1. Purpose

BR-SOURCE-10J takes the BR-SOURCE-10I readiness **contract** and lowers it into a **technical
design** that a future, separately-approved milestone could execute: how a future full join
dry-run between the Receita `empresas` (company / root grain) and `estabelecimentos`
(establishment / full-CNPJ grain) files **would** be structured, privacy-safely and offline,
purely to **measure** import readiness across the whole dataset.

This is a **design/documentation** milestone. It is the natural next step after BR-SOURCE-10I,
which established the conditions (envelope, join-key treatment, field survival, identity-grain
gate, GATE-1 … GATE-8) but deliberately stopped short of a technical design. This document does
that design; **it executes nothing.**

This document does **not**:

- implement the runner;
- execute the full join;
- import data;
- process the full dataset;
- write to Supabase;
- create or modify a migration;
- connect the runtime;
- connect Agent 1;
- touch HubSpot / Slack / providers / UI;
- authorize a future full join dry-run (it only designs one).

A **full join dry-run** — associating every establishment to its company context to *measure*
eligibility — is **not the same as a full import**. Designing how such a dry-run would work
leaves import, production import, runtime, Agent 1, and live generation each behind its own
separate, explicit approval.

If, at any point, this design concluded that it required code, scripts, package changes,
migrations, or real execution to proceed, the correct action is to **stop and escalate**, not to
build — reporting `BRSOURCE10J_SCOPE_ESCALATION_CODE_NOT_ALLOWED`. This document reaches no such
conclusion: a technical design can be fully expressed in prose and conceptual contracts.

---

## 2. Current official baseline

The company-discovery / eligibility / readiness line for Receita CNPJ is official and merged as
follows (design of record; none is an operational authorization):

- **BR-SOURCE-10E — privacy-safe bounded dry-run classifier is official.** Reads a bounded sample
  and turns anti-PII findings into per-record eligibility **counts** (aggregate only); authorizes
  no import ([eligibility design § 10.1](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10F — eligibility & legal-nature calibration is official.** Reference lookups →
  `not_applicable_lookup`; establishments in isolation → `pending_company_join_context`; MEI /
  empresário individual excluded by default; legal nature is a **classification signal, not an
  import authorization** ([§ 10.2](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)).
- **BR-SOURCE-10G — company↔establishment bounded join dry-run is official.** Associates an
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

Brazil stays non-operational. Carried forward, unchanged:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 3. Technical problem

- **Establishments need company context.** An `estabelecimentos` row carries no natureza
  jurídica; in isolation its eligibility cannot be affirmed. The `empresas` file carries the legal
  nature, porte, and capital social that the eligibility rules depend on. Company context is
  therefore a precondition for eligibility, not an optional enrichment.
- **The technical join uses the structural root (`cnpj_basico` / raiz).** Receita links the two
  files by the first-8-position CNPJ root. BR-SOURCE-10G/10H proved the join **mechanism** works.
- **Bounded tests are not representative.** First-N-of-each prefixes rarely overlap, and even a
  bounded keyed probe returned `joined_with_sampled_company_context = 0` with
  `coverage_is_representative = false`. A bounded sample proves the mechanism; it cannot answer
  *how much of the dataset would actually be eligible*.
- **A future full join dry-run could process the whole dataset locally — only to measure
  readiness, not to import.** Measuring the true eligible population is a different act from
  persisting any row.
- **The principal risk is leakage.** The dominant technical risk is a leak of identifiers
  (full CNPJ, CNPJ básico / join key), PII, raw rows, or any persistible value into stdout, logs,
  errors, temporary files, or the report. The design's whole shape is organized around making
  that leak structurally impossible and failing closed if it is ever detected.

---

## 4. Proposed future execution model

The following describes the **conceptual** flow a future, separately-approved dry-run **would**
follow. It is a design, **not** an implementation, and it is not authorized here.

```
Step 1  — Validate the local manifest (identity, layout, integrity; runbook § 8, § 10).
Step 2  — Validate allowed file families only (empresas + estabelecimentos required;
          simples / cnaes / municipios / naturezas optional; socios / qsa / cpf / person
          categorically forbidden and rejected by name).
Step 3  — Build or stream the company context (empresas → key→context-kind lookup), under the
          approved storage envelope (§ 6): in-memory-first, temporary index only if GATE-2
          approves.
Step 4  — Read establishments (streamed / chunked; never all-in-memory at full scale).
Step 5  — Join each establishment to its company context by the structural join key
          (held only transiently, per § 7).
Step 6  — Apply the privacy / eligibility rules (eligibility design § 4–§ 8; fail-closed,
          allowlist-first; a single person/PII signal on either side makes the joined record
          ineligible).
Step 7  — Drop prohibited fields immediately (§ 8): the join key and every non-signal field are
          discarded the moment they are no longer needed for the current record.
Step 8  — Emit an aggregate-only report (§ 12): counts, reason codes, safety booleans only —
          never a row, value, CNPJ, CNPJ básico, CPF, name, address, or contact.
Step 9  — Cleanup temporary material (§ 9): destroy any temporary index and partial artifacts on
          completion AND on failure.
Step 10 — Produce the operator summary (§ 15): a sanitized, human-readable wrap-up plus the
          location of the aggregate report outside the repo.
```

> This flow is **design, not implementation.** No step here is authorized to run. Each step is
> written so that a future implementer builds *from* it under GATE-1 … GATE-8, not so that anyone
> runs it now.

---

## 5. Architecture options reviewed

A future full join must reconcile two facts: the `empresas` key→context map is large, and the
dry-run must never persist or leak the join key. Three architectures are compared. **BR-SOURCE-10J
does not pick a final mandatory implementation**; it recommends a conservative default for future
review.

### Option A — Pure in-memory map

Build the entire `empresas` key→context-kind map in memory, then stream `estabelecimentos` past it.

```
Pros:
- Lowest persistence risk — nothing structural ever touches disk.
- Simplest cleanup — process exit frees everything; no files to destroy.
- No temporary artifacts to secure, encrypt, or track.

Cons:
- May not fit in memory at full dataset scale (millions of company roots).
- Risk of failure by out-of-memory (OOM) partway through a long run.
- Least resilient to interruption — a crash means a full restart.
```

### Option B — Streaming two-pass scan

Stream both files without a persistent index: e.g. collect establishment keys transiently in a
first pass, then stream `empresas` looking for those keys in a second pass (the 10H probe,
generalized past its bounded window).

```
Pros:
- Bounded, predictable memory versus Option A.
- No persistent index on disk — nothing structural to secure or destroy.
- Safer than a temporary on-disk index; strictly stronger privacy posture.

Cons:
- Slower — multiple passes over GB-scale files.
- May require several passes or a key-set that itself grows large.
- More complex read/scan control and progress accounting.
```

### Option C — Temporary local encrypted / discardable index

Build a temporary on-disk index of the `empresas` key→context map (per the 10I § 4 candidate
capability), used only during the run and destroyed after.

```
Pros:
- Most viable for a very large dataset that does not fit in memory.
- Enables a complete join with a lower memory ceiling.
- Better control over retries / resume than a pure in-memory approach.

Cons:
- Highest legal/privacy risk — a structural key touches disk.
- Requires the GATE-2 storage envelope (ephemeral, local-only, encrypted-at-rest,
  bounded disk, guaranteed cleanup).
- Requires a robust, verified cleanup path (§ 9) that runs on success AND failure.
- May NOT be used without explicit GATE-2 approval — not permitted today.
```

### Recommended conservative path (for future review, not a mandate)

BR-SOURCE-10J recommends a **streaming-first** posture: prefer Option B (bounded-memory streaming
scan), fall back to Option A where the key-set genuinely fits in memory, and treat Option C
(temporary on-disk index) as a **last resort** permitted **only if GATE-2 explicitly approves** a
storage envelope for it. The default privacy posture is "no structural key touches disk"; Option C
is the exception a future gate must consciously open, never the default.

> This recommendation is for a future review to confirm or revise. BR-SOURCE-10J does not lock in
> an implementation and does not authorize any of the three options to run.

---

## 6. Temporary storage envelope

If (and only if) GATE-2 approves any temporary on-disk material (Option C, § 5), it must satisfy
this envelope. This restates and never widens BR-SOURCE-10I § 4.

- **Local folder outside the repository** — never inside the repo, never a synced/cloud location.
- **Controlled, fixed name** — a known, operator-visible path; never a random path that hides
  what exists.
- **No cloud sync** — the folder must be excluded from any backup / sync / drive service.
- **No commit** — the repository must never contain the index, partial or complete.
- **Restrictive local permissions** — owner-only read/write.
- **Short TTL** — created for the run, destroyed at the end of it.
- **Guaranteed cleanup** — destroyed on completion AND on failure (§ 9).
- **No sensitive paths in logs** — a log line may never contain a path that itself encodes a
  sensitive value.
- **No join keys in file names** — a temporary file name may never contain a structural key or any
  identifier.
- **No raw rows in reports** — the report is aggregate-only (§ 12).
- **No dataset inside the repo** — the source files stay in the operator's local folder
  (runbook § 4).
- **Encrypted-at-rest if it holds a structural key** — any index that materializes the join key
  must be encrypted at rest and auto-deleted.

This envelope draws a bright line:

```
temporary technical artifact  ≠  approved persisted source data
```

A temporary index is a transient technical convenience for the run; it is **never** a source
snapshot, is **never** persistible, and is **never** an import.

---

## 7. Join key handling

The structural join identifier is the CNPJ **root / básico** (`cnpj_basico`, the first 8
positions / raiz). Its handling is non-negotiable and inherits directly from BR-SOURCE-10G / 10H /
10I § 5:

- The join key may exist **only as a technical key during execution** (in memory, or in an
  approved ephemeral index per § 6).
- It **may not be printed** — not to stdout, not to a report, not to a log line.
- It **may not be returned** by any function boundary as a value.
- It **may not be persisted** without GATE-2 (storage) and GATE-4 (identity grain).
- It **may not be hashed** for reports — no hash, truncation, or fingerprint of the join key may
  appear anywhere.
- It **may not appear in error messages**.
- It **may not appear in logs**.
- It **may not appear in the JSON output**.
- It **must be discarded** when the run finishes and on failure, along with any temporary index
  built from it.
- **Any leak of the join key (or a value derived from it) cancels the dry-run** — the run is a
  failure, not a partial success.

The full CNPJ (14 positions) and the CNPJ básico (8 positions) are **both** categorically
non-printable and non-persistible under this document; CPF and any natural-person identifier
remain categorically blocked (eligibility design § 6).

---

## 8. Field handling and discard timing

Every field a future run encounters falls into a category with an explicit discard time. This
restates and never widens the eligibility design (§ 4–§ 6), the import-staging contract
(§ 5–§ 6, § 15–§ 16), and BR-SOURCE-10I § 6.

### 8.1 Immediately rejected — before the join

Never read into the join at all:

- forbidden file families (`socios` / `qsa` / any CPF / person / contact file);
- Socios / QSA / person files (categorical hard block);
- CPF-like fields and any natural-person identifier;
- unsupported / mismatched layout;
- raw rows outside the bounded / audited parser path;
- contact / address fields not required for the technical join (telefone, fax, DDD, email,
  logradouro, número, complemento, bairro, cep).

### 8.2 Allowed only during parsing

May exist transiently while a record is processed; discarded immediately after:

- the raw CSV row (in the reader, never surfaced);
- the parsed cell array;
- the temporary join key (§ 7);
- temporary row counters;
- temporary file offsets / byte positions (only if a resumable scan needs them).

### 8.3 Allowed after the join — only as classification signals

May inform the eligibility classifier; contribute to **counts** only, never surfaced as values:

- legal-nature category;
- CNAE category / code, if allowlisted;
- municipality / UF coarse signal;
- registration status;
- opening date;
- company size (porte);
- capital social — only if a future policy allows.

### 8.4 Allowed in the final report

The report is aggregate-only:

- counts;
- reason codes;
- status codes;
- safety booleans;
- elapsed time;
- row counters;
- file-family counts;
- aggregate exclusion counts.

### 8.5 Never allowed in the final report

- CNPJ básico;
- full CNPJ;
- CPF;
- email;
- phone / fax / DDD;
- street / address / postal code;
- legal names (razão social);
- trade names (nome fantasia);
- raw rows;
- row hashes derived from identifiers;
- join keys;
- any sample value.

> **Update (BR-SOURCE-10M).** The § 8.1 … § 8.5 categories above have been carried into a docs-only
> **decision record proposing** the GATE-3 field allowlist —
> [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
> — which re-expresses them as a six-category lifecycle model with a per-surface decision matrix
> (memory / temporary storage / aggregate report / future persistence), labels every open field
> `needs_legal_review`, and proposes `raw_data` **prohibited by default**. It restates and never widens
> § 8. Two consequences for this design:
>
> - the § 8.3 classification signals are proposed as **bucket-only** — including `capital_social` and
>   `opened_at`, whose exact values are tracked as needing legal/privacy review;
> - the § 8.4 report contents are extended with **proposed** additional aggregate fields
>   (`files_seen`, `rows_seen_by_family`, `official_layout_mode`, `cleanup_status`, `duration_ms`,
>   per-bucket count families, and controlled `warnings` / `errors` enums). Those are **candidate input
>   to GATE-5**, not additions to the § 12 schema: per the evidence packet the schema cannot be frozen
>   while GATE-3 and GATE-4 are open.
>
> GATE-3 remains `not_started`, `field_allowlist_version` stays `"not_approved"` in § 12, and that
> record authorizes **no** dry-run, import, Supabase write, migration, runtime, or Agent 1 integration.

> **Update (BR-SOURCE-10O).** The § 8.4 / § 8.5 report categories above have been carried into a
> docs-only **decision record proposing** the GATE-5 output sanitization contract —
> [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md).
> It restates and never widens § 8, and changes the framing in three ways the approvers should see:
>
> - **Scope.** § 8.4 / § 8.5 govern *the report*; the record governs **twelve output surfaces** — CLI
>   stdout, CLI stderr, the JSON report, the human-readable report, logs, error messages, thrown
>   exceptions, the gate evidence packet, the operator summary, future audit artifacts, future CI/test
>   output, and screenshots or copied terminal output — with the § 8.5 forbidden set applying
>   identically to all twelve and no surface-specific exception, debug mode, or operator override.
> - **Closure.** The § 15 "and equivalents" tail is replaced by a **closed forbidden-key-name list**
>   with an explicit normalization procedure and per-group matching rule, and by closed value-pattern
>   rules `VP-1` … `VP-10` — which add a **separator-insensitive** evaluation and a
>   **longer-than-14-positions** rule to the three inherited digit-run rules, both of which close gaps
>   that concatenated or formatted identifiers would otherwise walk through. Crucially the record makes
>   the **allowlist** authoritative: a key absent from the approved aggregate list is forbidden even if
>   it survives the denylist.
> - **Coverage.** It adds the three contracts § 8 does not have — an **error and exception**
>   sanitization contract (sanitize at construction, no interpolation, catch-classify-discard), a
>   **logging and console** contract (structured-only, closed field set, no per-record log lines), and a
>   **gate-evidence** contract — plus a **small-cell suppression** proposal for the gap that an
>   aggregate report is not automatically a non-identifying one.
>
> Two deliberate narrowings are flagged there for the approvers rather than adopted here: **no stack
> emission at all** (§ 15 forbids only errors containing raw rows) and **no cross-tabulations** in a
> first approved contract.
>
> **GATE-5 remains `not_started`.** The § 12 schema is **not frozen** — the evidence packet's finding
> that it cannot be frozen while GATE-3 and GATE-4 are open still holds — the three contract markers
> keep their not-decided values, and that record writes no sanitizer and no test and authorizes **no**
> dry-run, import, Supabase write, migration, index change, runtime, or Agent 1 integration.

---

## 9. Failure cleanup contract

A future run must **fail closed** and clean up completely. On any failure:

- **fail closed** — stop the moment a failure or leak assertion trips;
- **stop processing** — no "best effort continue";
- **delete temporary indexes** — any on-disk index (Option C) is destroyed;
- **delete partial temp reports** that might contain sensitive information;
- **keep only a sanitized failure summary** — reason code and safe counts, nothing else;
- **no stack traces with row values** — an error may never carry a raw row or value;
- **no path leakage beyond the safe local root** — errors reference only the controlled folder;
- **no automatic retry without an operator** — a failed run does not silently re-run;
- **no Supabase writes under any condition** — not on success, not on failure, not on retry.

Failure types the contract must cover:

```
manifest invalid
forbidden file family detected
layout mismatch
privacy leak assertion (a sensitive value reached an output surface)
memory limit reached
disk limit reached
cleanup failed
operator cancellation
unexpected parser error
```

`cleanup failed` is itself a fail-closed terminal state: if the run cannot verify that temporary
material was destroyed, it reports failure and surfaces the (safe) fact that manual cleanup is
required — it never reports success with residue on disk.

> **Update (BR-SOURCE-10PQR).** The contract above has been carried into a docs-only **decision packet
> proposing** the GATE-6 contract —
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
> — where § 4 lowers it from a posture into a **thirteen-scenario matrix** and § 5 gives the sanitized
> failure summary a shape. The nine failure types above are preserved and extended by four (process
> crash, permission error, gate-preflight failure, small-cell suppression failure), with disk exhaustion
> and out-of-memory separated because their cleanup capabilities differ. Additions, all narrowing or
> clarifying:
>
> - a closed **destroyable artifact class list** `AC-01` … `AC-12`, with a catch-all class so that an
>   unanticipated artifact fails closed as unresolved residue rather than falling through;
> - a **temporary-artifact ledger** whose entries are written *before* each artifact is created — the
>   only construction that can verify destruction after a crash, which by definition runs no in-process
>   cleanup handler;
> - a **cleanup ordering** that destroys key-bearing memory before any on-disk class, and forbids
>   skipping a later step because an earlier one failed;
> - a **best-effort-in-execution / fail-closed-in-reporting** split, making `cleanup_unverified` an
>   admissible honest outcome under out-of-memory and crash instead of a silent success;
> - the § 6 envelope treated as **conditional**: the contract is stated separately for in-memory-only
>   (`E1`) and approved-ephemeral-disk (`E2`), because GATE-2 has chosen neither;
> - **paths replaced by a `directory_class` enum** in the cleanup report, which is stricter than "errors
>   reference only the controlled folder" above and resolves 10O § 12's open manifest-path question
>   fail-closed for this surface only;
> - **stack emission forbidden entirely**, adopting 10O's `OS-A34` narrowing of the "no stack traces with
>   row values" rule above;
> - an assertion catalogue `FC-A01` … `FC-A24`, with `FC-A02` and `FC-A23` explicitly unenforceable until
>   GATE-2 chooses the envelope.
>
> **No cleanup implementation and no verification command are created there.** Both are code, forbidden
> by the approval-gates checklist § 4 until all eight gates are approved. **GATE-6 remains `not_started` /
> not approved.**

---

## 10. Resource limits

A future run must declare bounded ceilings and fail closed when any is exceeded — never silently
spill unbounded. Exact numeric values are **not** invented here; they are set by GATE-2 once the
storage envelope and a real measurement exist.

```
max input files by family              = TBD_BY_GATE_2_STORAGE_ENVELOPE
max bytes read for the validation phase = TBD_BY_GATE_2_STORAGE_ENVELOPE
max memory target                       = TBD_BY_GATE_2_STORAGE_ENVELOPE
max temp disk target                     = TBD_BY_GATE_2_STORAGE_ENVELOPE
max runtime duration                     = TBD_BY_GATE_2_STORAGE_ENVELOPE
max report size                          = TBD_BY_GATE_2_STORAGE_ENVELOPE
max log size                             = TBD_BY_GATE_2_STORAGE_ENVELOPE
raw value logs                           = zero (hard invariant, not a tunable)
```

The final row is not a placeholder: **zero raw-value logs** is an absolute invariant, independent
of any gate. Everything else marked `TBD_BY_GATE_2_STORAGE_ENVELOPE` is a conscious deferral, not
an omission — a future gate sets the number against a real measurement rather than a guess.

---

## 11. Future CLI contract

A future runner — **if** GATE-1 … GATE-8 are satisfied — would expose a command of this shape.
This is a **design of the interface**, not an authorization to build or run it. No such script
exists, and none is created by this document.

```bash
node --import tsx scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run.ts \
  --manifest "$BR_RECEITA_PRIVACY_MANIFEST" \
  --allow-local-manifest \
  --format json \
  --strict \
  --mode full_join_import_readiness_dry_run \
  --no-supabase \
  --no-import \
  --no-runtime \
  --no-agent1 \
  --confirm-full-join-readiness-dry-run
```

**Mandatory conceptual flags** (the run refuses to start without them):

```
--confirm-full-join-readiness-dry-run
--no-supabase
--no-import
--no-runtime
--no-agent1
--strict
--format json
```

**Forbidden flags** (their mere presence is rejected fail-closed, in the spirit of
`BRSOURCE7_FORBIDDEN_DRY_RUN_MODE`):

```
--apply
--write
--supabase
--agent1
--runtime
--hubspot
--slack
```

Like the existing runners (runbook § 10, § 11), a URL manifest, an out-of-range limit, or any
forbidden flag must be rejected **before** any file is opened, with a stable
`BRSOURCE10J_FORBIDDEN_*` code — never after partial processing.

> **Update (BR-SOURCE-10PQR).** The flag sets above have been carried into a docs-only **decision packet
> proposing** the GATE-8 contract —
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
> — § 8 and § 9, unchanged and unwidened. What it adds around them:
>
> - a closed **blocked-surface list** `NB-01` … `NB-20`, naming each write, integration, and side-effect
>   surface individually rather than as a general no-write posture — including index changes, schema
>   changes, feature-flag writes, persistent cache and shared storage, and cloud uploads, with **zero
>   network calls** as a recommendation;
> - **structural** enforcement requirements rather than convention: no write-capable client constructed,
>   no service role key present in the environment at all, no Supabase / Agent 1 / HubSpot / Slack /
>   provider module imported transitively, and dry-run mode hardcoded and fail-closed rather than
>   defaulted;
> - **rejection ordering as part of the contract** — a forbidden flag, a URL manifest, an out-of-range
>   limit, or a missing mandatory flag is refused before any file is opened *and* before any artifact
>   exists, so a refusal leaves no residue (matched to the cleanup matrix's gate-preflight scenario);
> - the enumerated no-write test list `NW-A01` … `NW-A28`;
> - an evidence contract (§ 9) fixing what may be shown as proof — the all-false booleans, the zero
>   counters including `raw_value_logs`, command names, the controlled `error_code` — and what may never
>   be: environment values, secrets, connection strings, key material, the real manifest, real paths, raw
>   driver messages, and stack traces.
>
> The packet also records the split 10L § 12 flagged: the **contract is approvable now**, the **proofs
> land with the implementation**, because they are proofs about code that does not exist and the
> approval-gates checklist § 4 forbids producing them by writing it. **No runner, CLI, guard, or test is
> created there, and GATE-8 remains `not_started` / not approved** — its *Allows* clause stays
> conditional on every other gate being approved, and seven are not.

---

## 12. Future report contract

A future full-join readiness dry-run may emit **only** an aggregated, sanitized report of this
shape. Values are shown as zeros / placeholders — **no real data**. This extends BR-SOURCE-10I
§ 10 with the explicit not-decided markers for the still-open gates.

```json
{
  "ok": true,
  "mode": "full_join_import_readiness_dry_run",
  "full_dataset_processed": true,
  "coverage_is_representative": false,
  "import_executed": false,
  "supabase_write": false,
  "runtime_integration": false,
  "agent1_integration": false,
  "hubspot_write": false,
  "slack_write": false,
  "companies_seen": 0,
  "establishments_seen": 0,
  "joined_establishments": 0,
  "missing_company_context": 0,
  "excluded_person_or_pii_risk": 0,
  "excluded_forbidden_token": 0,
  "excluded_forbidden_file_family": 0,
  "needs_legal_review": 0,
  "eligible_for_future_import_candidates": 0,
  "persisted_rows": 0,
  "record_identity_grain_decision": "not_decided",
  "field_allowlist_version": "not_approved",
  "temporary_storage_mode": "not_approved",
  "safety": {
    "raw_rows_printed": false,
    "personal_values_printed": false,
    "join_keys_printed": false,
    "cnpj_basico_printed": false,
    "cnpj_completo_printed": false,
    "cpf_printed": false,
    "emails_printed": false,
    "phones_printed": false,
    "addresses_printed": false
  }
}
```

> `eligible_for_future_import_candidates` does **not** mean importable. It is a *measurement* of
> how many joined records could, in principle, advance toward eligibility if — and only if — a
> future legal-nature policy, field allowlist, identity grain, and import gate were all resolved
> and satisfied. Even with `full_dataset_processed = true`, `import_executed` **must stay false**,
> `persisted_rows` **must be 0**, and every `safety` boolean **must be false**. The three
> not-decided string fields (`record_identity_grain_decision`, `field_allowlist_version`,
> `temporary_storage_mode`) are contract markers that the corresponding gates are still open.

---

## 13. Legal/privacy gates mapped to implementation

BR-SOURCE-10I § 9 defines GATE-1 … GATE-8 as approval conditions. BR-SOURCE-10J maps each gate to
the concrete technical decision it governs in this design:

```
GATE-1  Legal/Privacy approval        → enables or blocks running the full local dry-run at all
                                         (LGPD basis; CC BY-ND review). Without it, nothing runs.
GATE-2  Storage envelope              → sets § 6 (temporary storage) and § 10 (memory / disk /
                                         temp-index limits); decides whether Option C is even
                                         permitted.
GATE-3  Field allowlist               → freezes § 8.3 / § 8.4 (which signals survive the join and
                                         which counts the report may carry); sets
                                         field_allowlist_version.
GATE-4  Identity grain                → decides § 14 (A / B / C / D) and the future
                                         record_identity_key; sets record_identity_grain_decision.
GATE-5  Output sanitization           → confirms § 12 report schema and § 15 assertions
                                         (aggregate-only, all-false safety block).
GATE-6  Failure cleanup               → confirms § 9 (rollback / cleanup on completion AND
                                         failure; cleanup-failed is terminal).
GATE-7  Operator runbook              → confirms § 16 (the manual steps an operator follows to run
                                         it safely and reproducibly).
GATE-8  No Supabase/import/runtime/    → forces the § 11 no-write flags and the § 12
        Agent 1 guarantee                import_executed=false / persisted_rows=0 / all-false
                                         safety invariants.
```

No gate may be skipped or collapsed. A future full join dry-run that cannot satisfy every gate
does not run.

> **Update (BR-SOURCE-10K).** This mapping has since been turned into a formal, approvable
> checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
> — which defines, per gate, the required evidence, the approver role, the pass / fail criteria, the
> expected artifacts, and what each approval does and does not unlock, plus a gate status model, a
> dependency graph, an approval-evidence template, and a GO / NO-GO matrix. That checklist is
> docs-only: it **approves no gate** (all eight remain `not_started`), implements no runner, and
> authorizes **no** full join execution, import, Supabase write, migration, runtime, or Agent 1
> integration.

---

## 14. Record identity decision (still open)

Receita CNPJ exposes **two grains**, and a full join makes the choice explicit. BR-SOURCE-10I § 7
left this as GATE-4; BR-SOURCE-10J does **not** decide it either.

```
A. record_identity_key per estabelecimento (full 14-position CNPJ) — the import-staging § 4 default
B. record_identity_key per empresa / root (cnpj_basico, 8 positions)
C. two separate snapshots (a company snapshot + an establishment snapshot)
D. a single snapshot with the establishment as the operational unit and the company as context
```

The choice must be reconciled against the physical `source_company_snapshots` unique-index
situation (import-staging § 5, § 11) and the full-CNPJ persistence question (eligibility design
§ 11 #1). Until GATE-4 records a choice, the future report carries
`record_identity_grain_decision: "not_decided"` (§ 12).

> **Update (BR-SOURCE-10N).** The four options above have been carried into a docs-only **decision
> record proposing** the GATE-4 grain —
> [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md)
> — which evaluates each option on ten axes and recommends **option D** (a single operational
> snapshot: establishment as the operational unit, company / root as context) for owner review. Option
> A is deferred as silent on company context and therefore superseded by D; option B is rejected
> because it would require the join key to become the record identity, against § 7 of this document
> and 10I § 5; option C is deferred because it would need a second source key or a discriminator column
> (**a migration**) and would break the tax-grain invariant.
>
> On the two reconciliations named above: the record states the index consequence **conditionally** —
> under the CN1-inheritance key construction the record-identity and legacy fiscal conflict paths agree
> and no new index is needed, while under a surrogate construction they disagree and a unique index
> (**a migration**) would be required — and it leaves the full-CNPJ persistence question where 10M left
> it, at `needs_legal_review`, recording that the two are coupled.
>
> **GATE-4 remains `not_started` / not approved**, the report marker stays
> `record_identity_grain_decision: "not_decided"` (§ 12), and the concrete `record_identity_key`
> construction stays **deferred**. That record authorizes **no** dry-run, import, Supabase write,
> migration, index change, runtime, or Agent 1 integration.

---

## 15. Security assertions required before future implementation

A future implementation must ship with automated assertions that fail the run if any is violated:

- output does **not** contain 8/11/14-digit identifier runs (CNPJ básico / CPF / full CNPJ
  lengths);
- output does **not** contain an email marker;
- output does **not** contain forbidden key names (socio / qsa / cpf / telefone / logradouro / …);
- logs do **not** contain join keys;
- errors do **not** contain raw rows;
- temporary files are removed (verified) on completion AND failure;
- `persisted_rows` = 0;
- `supabase_write` = false;
- `import_executed` = false;
- `runtime_integration` = false;
- `agent1_integration` = false.

These assertions are the runtime enforcement of GATE-5 (§ 13). A design that cannot express them
is not ready to implement.

> **Update (BR-SOURCE-10O).** The assertion list above has been carried into the docs-only
> **decision record proposing** the GATE-5 contract —
> [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)
> — where § 5.4 gives each rule a **stable ID** (`OS-A01` … `OS-A46`, with the value-pattern rules
> named `VP-1` … `VP-10`) so a future suite can be traced to the record one-to-one. Three changes to
> this list, all narrowing:
>
> - the **"forbidden key names (socio / qsa / cpf / telefone / logradouro / …)"** item is closed — the
>   "…" is replaced by a seven-group enumeration plus a normalization procedure, and an **allowlist**
>   assertion (`OS-A08`) is added so that a key absent from the approved aggregate list fails even if it
>   survives the denylist;
> - the **digit-run** items gain a separator-insensitive evaluation rule and a longer-than-14-positions
>   rule;
> - the **"errors do not contain raw rows"** item is proposed as the stricter **no stack emission at
>   all** (`OS-A34`), because "these frames happen not to carry values" is a property of one failure,
>   not of the code — flagged there as a deliberate narrowing for the approvers.
>
> The record also adds surface assertions for stdout, stderr, the JSON report, the human report and
> operator summary, logs, gate evidence, audit artifacts, and test fixtures, and error assertions for
> the sanitize-at-construction boundary.
>
> **No test exists, and none is created there.** An assertion catalogue is not a suite: writing it is
> code, forbidden by the approval-gates checklist § 4 until all eight gates are approved, and placed by
> its § 9 *Allows* clause in a future, separately approved milestone. Two of the assertions are
> additionally unenforceable until the approvers supply values — the small-cell threshold (`OS-A19`) and
> the string-length ceiling (`VP-8`). GATE-5 therefore remains `not_started` / not approved.

---

## 16. Operator runbook requirements

Before a future full join dry-run could be run by a human operator, a runbook (GATE-7) must
provide:

- a **preflight checklist** (gates satisfied and recorded);
- a **disk / memory check** against the § 10 ceilings;
- a **local path check** (the controlled folder outside the repo, runbook § 4);
- a **manifest check** (validated per runbook § 10);
- a **forbidden-family check** (no socios / qsa / cpf / person files present);
- a **dry-run explicit confirmation** (the `--confirm-full-join-readiness-dry-run` flag, § 11);
- **live terminal monitoring** of the run;
- **cleanup verification** (temporary material destroyed, § 9);
- a **report location outside the repo** (never committed);
- a **sensitive scan of the report** (no digit runs, no emails, no keys);
- **post-run deletion rules** for any temporary material;
- a **final signoff** recorded with the aggregate result only.

> **Update (BR-SOURCE-10PQR).** The requirements above have been carried into a docs-only **decision
> packet proposing** the GATE-7 **runbook contract** —
> [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md),
> § 6 and § 7. Each obligation above becomes a checklist item with a definite pass condition (`P-01` …
> `P-22`, gate status first), each failure becomes a non-overridable stop condition (`T-01` … `T-16`,
> four of them leak-class), and the permitted evidence is closed (aggregate report after the sanitizer,
> sanitized cleanup report, safety booleans, command names, controlled codes, checklist state,
> aggregate-only signoff). Two additions the list above did not state: **only a named authorized human
> operator may execute** — never an agent, an automation, or a CI runner, and never "on behalf of" an
> operator — and twelve **operator behavior rules** covering the risks no assertion can catch (no
> terminal screenshots, no unsanitized copy-paste, no real manifests or paths in any channel, no manual
> editing of a report to make it pass, no warning recorded as a pass, no write-capable credential present
> at all).
>
> **The runbook section itself is still not written**, and four items cannot be performed today: the
> gate-status item fails by construction while any gate is unapproved, the disk and memory items have no
> § 10 ceilings to check against (GATE-2), and the sanitizer item has no frozen GATE-5 contract. **GATE-7
> remains `not_started` / not approved**, and nothing there authorizes a manual execution: an approved
> contract would define the procedure, never grant the permission.

---

## 17. Decision gates still open

These remain undecided and must be resolved (with a recorded determination) before any code:

- **identity grain** (A / B / C / D — § 14, GATE-4);
- **field allowlist** (which signals survive; § 8.3, GATE-3);
- **temporary storage mode** (in-memory-only vs approved ephemeral index; § 6, GATE-2);
- **legal approval for full local processing** (§ 13, GATE-1);
- whether **`normalized_tax_id`** can survive (eligibility design § 11 #1);
- whether **sanitized legal / trade names** can survive (eligibility design § 5);
- whether **capital_social** can survive (eligibility design § 11);
- whether **`full_dataset_processed = true`** is acceptable for a dry-run at all (the legal basis
  for processing — not persisting — the whole dataset locally, GATE-1).

---

## 18. Explicit non-goals

BR-SOURCE-10J does **not**:

- implement anything;
- add a runner;
- execute a full join;
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
- process the full or real dataset;
- advance Brazil toward production readiness.

---

## 19. Recommended next hito

**BR-SOURCE-10K — Receita full join dry-run approval gates checklist.**

Objective of 10K: convert GATE-1 … GATE-8 (§ 13) into a **formal, approvable checklist** — one
that must be signed off, item by item, **before any code for a full join is written**. 10K stays
docs-only and authorizes no execution, Supabase write, runtime, or Agent 1 integration; it only
makes the gates concretely approvable.

This is a **recommendation, not an execution**: BR-SOURCE-10J opens no such milestone and
authorizes nothing further.

> **Update:** BR-SOURCE-10K has since landed as that docs-only checklist —
> [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md).
> It converts GATE-1 … GATE-8 into per-gate approval criteria (evidence, approver role, pass/fail,
> blockers, artifacts, allows / does-not-allow), adds a gate status model, dependency graph,
> approval-evidence template, and GO / NO-GO matrix — and it **approves no gate**: all eight remain
> `not_started`, so the matrix reads NO-GO. It adds **no runner and no command**, **decides no
> identity grain**, and authorizes **no** dry-run, import, Supabase write, migration, runtime, or
> Agent 1 integration. Its recommended successor is **BR-SOURCE-10L — full join dry-run gate
> evidence packet**.
>
> **Update:** BR-SOURCE-10L has since landed as that docs-only evidence packet —
> [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md).
> It maps, per gate, the evidence that already exists against this design's sections and the evidence
> still missing — notably that every `TBD_BY_GATE_2_STORAGE_ENVELOPE` ceiling in § 10 is still a
> placeholder with no measurement behind it, that the § 12 report schema cannot be frozen while
> GATE-3 and GATE-4 are open, and that the § 15 assertions are obligations rather than an existing
> test suite. It **approves no gate**: all eight remain `not_started`, and the three § 12 contract
> markers stay `not_decided` / `not_approved`. It adds no runner and no command and authorizes **no**
> dry-run, import, Supabase write, migration, runtime, or Agent 1 integration. Its recommended
> successor is **BR-SOURCE-10M — full join field allowlist decision record** (GATE-3, docs-only).
>
> **Update:** BR-SOURCE-10M has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md).
> It proposes the GATE-3 allowlist against § 8 (see the update note in § 8), leaves the § 12 markers
> `field_allowlist_version: "not_approved"`, `record_identity_grain_decision: "not_decided"`, and
> `temporary_storage_mode: "not_approved"` untouched, and closes none of the § 17 open decision gates:
> the `normalized_tax_id`, sanitized legal / trade name, and `capital_social` questions are labelled
> `needs_legal_review`, not resolved. It **approves no gate** (all eight remain `not_started`), adds no
> runner and no command, decides no identity grain and no storage envelope, and authorizes **no**
> dry-run, import, Supabase write, migration, runtime, or Agent 1 integration. Its recommended
> successor is **BR-SOURCE-10N — full join identity grain decision record** (GATE-4, docs-only).
>
> **Update:** BR-SOURCE-10N has since landed as that docs-only decision record —
> [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md).
> It proposes the GATE-4 grain against § 14 (see the update note there), recommending **option D** and
> recording the rejected and deferred options. It leaves the § 12 markers untouched —
> `field_allowlist_version: "not_approved"`, `record_identity_grain_decision: "not_decided"`,
> `temporary_storage_mode: "not_approved"` — and closes none of the § 17 open decision gates: the
> identity grain is *proposed*, not decided; the `normalized_tax_id` question stays
> `needs_legal_review`; and the concrete `record_identity_key` construction is explicitly **deferred**.
> It **approves no gate** (all eight remain `not_started`), adds no runner and no command, decides no
> field allowlist and no storage envelope, creates no migration and changes no index, and authorizes
> **no** dry-run, import, Supabase write, runtime, or Agent 1 integration. Its recommended successor is
> **BR-SOURCE-10O — full join output sanitization decision record** (GATE-5, docs-only), which would
> replace the § 15 obligations with an enumerated assertion list — still without writing the tests,
> which are code.

---

## 20. Activation blockers

Unchanged and carried forward — Brazil stays non-operational:

```
OPS_BR_READY_FOR_IMPORT               = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT    = false
OPS_BR_READY_FOR_RUNTIME              = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
```

This document adds the technical-design flag only, and does **not** flip any operational flag:

```
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_PR_READY  = true   (after this docs-only PR is opened)
OPS_BR_FULL_JOIN_DRY_RUN_TECHNICAL_DESIGN_OFFICIAL  = false  (not an operational authorization)
```

Carried forward from BR-SOURCE-10E–10I (unchanged):

```
OPS_BR_FULL_JOIN_IMPORT_READINESS_DESIGN_OFFICIAL       = true
OPS_BR_JOIN_COVERAGE_STRATEGY_OFFICIAL                  = true
OPS_BR_COMPANY_ESTABLISHMENT_JOIN_DRY_RUN_OFFICIAL      = true
OPS_BR_LEGAL_NATURE_ELIGIBILITY_CALIBRATION_OFFICIAL    = true
OPS_BR_PRIVACY_SAFE_BOUNDED_DRY_RUN_CLASSIFIER_OFFICIAL = true
OPS_BR_HEADERLESS_REAL_FILE_SUPPORT_OFFICIAL            = true
```

---

## 21. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR.
It does **not**:

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
- edit `MEMORY.md`;
- merge.

No secrets, no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, and no partner (sócio)
personal data are reproduced. Local WIP (`scratchpad/`) is untouched by any git operation.

---

## 22. BR-SOURCE-11A — runner scaffold landed (no-write / no-runtime)

BR-SOURCE-11A implements a local no-write/no-runtime runner scaffold with
synthetic-fixture tests only.

It does not approve any gate.
It does not authorize real dataset execution.
It does not authorize import.
It does not authorize Supabase writes.
It does not authorize runtime or Agent 1.

### 22.1 What landed

| Module | Responsibility |
|--------|----------------|
| `br-receita-cnpj-full-join-dry-run-runner.ts` | Composes the guard, sanitizer and cleanup model into `runBrazilReceitaFullJoinDryRun`, returning an aggregate-only report. Pure: no filesystem, no network, no client. |
| `br-receita-cnpj-full-join-no-write-guard.ts` | Validates the declared no-write contract AND scans the surrounding config for dangerous indicators (service-role key, Supabase URL, import mode, runtime endpoint, Agent 1 switch, provider API key). Presence alone fails. |
| `br-receita-cnpj-full-join-output-sanitizer.ts` | Rejects a report carrying a full CNPJ, CNPJ básico, CPF, email, phone, LinkedIn URL, raw row/data payload, identity key, normalized tax id, identifier hash, or an oversized numeric leaf. |
| `br-receita-cnpj-full-join-cleanup.ts` | Models failure cleanup as an aggregate, path-free plan. No deletion engine is authorized, so a required cleanup reports `not_executed` + `cleanup_engine_not_authorized`. |
| `scripts/source-catalog/run-br-receita-cnpj-full-join-dry-run.ts` | Safe CLI. Defaults to nothing: `--synthetic-fixture` must be requested explicitly. |

### 22.2 Run modes

- `synthetic_fixture_only` — the DEFAULT and the only mode that produces metrics. Scores an
  injected or built-in synthetic fixture with zero file I/O.
- `local_manifest_dry_run` — DECLARED and fully gated, and always refuses **as landed in
  BR-SOURCE-11A**. It first requires `allowLocalManifest: true`, and then still returns
  `local_manifest_execution_not_authorized`, because opening a real local manifest is precisely
  what GATE-1 (legal/privacy) and GATE-2 (temporary storage envelope) would have to authorize.
  **The runner therefore performs no filesystem read at all in BR-SOURCE-11A.**
  BR-SOURCE-11C later opened this mode for **synthetic temp manifests only**, under the Option B
  carve-out — see § 24. A REAL manifest is still refused with the same error code.

### 22.3 Bounded caps

Caps are reused from the BR-SOURCE-10G/10H join dry-run so there is a single source of truth:
sample rows default 5 / hard max 20; the company coverage-scan window defaults to 1000 with a
hard cap of 5000. A synthetic fixture beyond 10,000 rows is refused as
`full_dataset_processing_not_allowed`.

### 22.4 Report contract

Aggregate only: `decision_status` (all eight gates `not_approved`), `run_scope` (all false),
`safety` (all false, including `identity_keys_constructed`), `aggregate_counts`,
`eligibility_counts`, `join_counts`, `guardrail_counts`, `cleanup`, and `errors`. An error carries
a fixed `error_code` and `stage` only — never a raw message, a path, or a value. `source_period` is
`null`: no manifest is opened, so no period is known.

### 22.5 Validation

`test:br-source:11-full-join-runner` (106 tests) plus the full BR-SOURCE-8/10 regression set
(116 tests) pass; `typecheck` and `eslint` are clean. The safe CLI was exercised in
synthetic-fixture mode and its fail-closed paths (bare invocation, `--manifest` without
`--allow-local-manifest`, a download-directory path, a forbidden flag) were each confirmed to
refuse without touching a file.

### 22.6 Safety confirmation for this hito

BR-SOURCE-11A adds code, tests, a CLI, a package test script and these doc notes. It does **not**:

- download, unzip, or import a dataset;
- execute the real dataset, open a real manifest, or read any file from the runner core;
- commit a real manifest, dataset, or report;
- write to Supabase or perform any production write;
- create or modify a migration, or create/alter/validate an index;
- write to `source_company_snapshots`;
- read any environment variable or construct any client;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- construct or print a `record_identity_key` or `normalized_tax_id`;
- print a row, a full CNPJ, a CNPJ básico, a CPF, a name, an address, a contact, or a join key;
- emit a hash, truncation, or fingerprint derived from any identifier;
- activate Brazil, approve any gate, or mark Brazil ready for import, runtime, or Agent 1;
- edit `MEMORY.md`;
- merge.

Every digit-length reference, enum member, error code, and JSON value shown above is a schema
name, a class label, a length rule, a zero, a `false`, or an explicit placeholder — never a real
value. Synthetic fixture refs are opaque labels that are counted but never emitted. Local WIP
(`scratchpad/`) is untouched by any git operation.

---

## 23. BR-SOURCE-11C blocked — `local_manifest_dry_run` needs a carve-out or GATE-1/GATE-2

BR-SOURCE-11B validated the merged § 22 scaffold post-merge in synthetic-only mode.
BR-SOURCE-11C then attempted to enable the § 22.2 `local_manifest_dry_run` mode and was blocked as
`BRSOURCE11CD — LOCAL_MANIFEST_GUARD_FAILED`.

```text
11C was blocked because local_manifest_dry_run requires an explicit carve-out or GATE-1/GATE-2
approval.
11C-R records the carve-out decision question.
No gate is approved.
No real manifest execution is authorized.
```

The carve-out decision question, its four options, the recommended option (Option B — synthetic
temp-manifest only), its boundaries and caps, and the evidence required before implementing
BR-SOURCE-11C are recorded in the docs-only decision record
[`br-receita-cnpj-local-manifest-dry-run-carveout-decision-record.md`](./br-receita-cnpj-local-manifest-dry-run-carveout-decision-record.md).
That record approves no gate, all eight gates remain `not_started`, and it authorizes no real
manifest execution, no real data-file execution, no dataset import, no Supabase write, no migration,
no runtime change, and no Agent 1 integration. It was subsequently **answered** by the owner in
favour of Option B; see § 24 for what BR-SOURCE-11C implemented under that answer.

---

## 24. BR-SOURCE-11C — Option B synthetic temp-manifest carve-out implemented

BR-SOURCE-11C implements Option B after explicit owner authorization:

```text
AUTHORIZE OPTION B — SYNTHETIC TEMP-MANIFEST CARVE-OUT ONLY
```

This authorizes only synthetic temp-manifest plumbing and tests.
It does not authorize real manifest execution.
It does not authorize real Receita data-file execution.
It does not approve any gate.
It does not authorize import.
It does not authorize Supabase writes.
It does not authorize runtime or Agent 1.

### 24.1 What changed relative to § 22

```text
run mode:        local_manifest_dry_run now EXECUTES — for synthetic temp manifests only.
manifest trust:  new report field manifest_trust
                 ('not_applicable' | 'synthetic_temp_manifest_only' | 'real_manifest_not_authorized').
carve-out flag:  new report field option_b_carveout_authorized.
new module:      br-receita-cnpj-synthetic-temp-manifest.ts (the ONLY filesystem owner).
new CLI mode:    --synthetic-temp-manifest (requires --strict + all four caps).
sanitizer:       new leak kind filesystem_path_like.
```

### 24.2 The Option B gate — a conjunction, each condition fail-closed

```text
allowLocalManifest        === true                             else allow_local_manifest_required
manifestTrust             === 'synthetic_temp_manifest_only'   else local_manifest_execution_not_authorized
optionBCarveoutAuthorized === true                             else option_b_carveout_not_authorized
strict                    === true                             else strict_mode_required
productionWrites          === false                            else production_writes_requested
outputSanitizationVersion === 'not_approved' (explicit)        else output_sanitization_version_not_approved
all four caps stated                                           else local_manifest_caps_required
all four caps within their maxima                              else local_manifest_cap_exceeded
localManifestReader injected                                   else local_manifest_reader_required
```

Trust is evaluated **before** the carve-out authorization, so declaring Option B over a real
manifest does not widen the carve-out — it is still refused as
`local_manifest_execution_not_authorized`.

### 24.3 Option B caps — stricter than § 22.3

```text
maxCompanyRows       stated and <= 20
maxEstablishmentRows stated and <= 20
maxCompanyScanRows   stated and <= 1000
maxBytesPerFile      stated and <= 1_000_000
```

These are tighter than the § 22.3 synthetic-fixture ceilings on purpose: § 22.3 governs in-memory
fixtures with no file I/O, whereas these govern a path that performs real reads. Every cap is
**required** — an omitted cap is refused, never defaulted.

### 24.4 Why the runner core stays pure

The runner does not read files. It declares a **reader port**
(`BrazilReceitaFullJoinLocalManifestReader`) and receives an implementation by injection; it never
imports `node:fs` or `node:os`, and a static test asserts that. The only implementation of that port
is the synthetic generator, which:

- creates its own workspace with `fs.mkdtempSync` under the OS temp root — the location is chosen
  inside the module and **never returned**, so no caller can supply or learn a path;
- writes a synthetic manifest plus synthetic **headerless** CSVs whose first line is validated by
  the official positional column count (`empresas` 7, `estabelecimentos` 30, reference families 2),
  reusing the file reader's layout authority rather than duplicating it;
- generates only opaque cells (`SYN_COMP_A`, `SYN_CNAE_A`) — no CNPJ, no CNPJ básico, no CPF, no
  name, no email, no phone, no address, no LinkedIn URL, and no identifier-length digit run;
- refuses a SOCIOS / QSA / CPF family request **before** writing anything, via the parser's existing
  forbidden-token denylist;
- reads under the per-file byte ceiling, and reports an oversized file as a fail-closed condition
  rather than truncating it;
- returns aggregate structure only — no path, no filename, no line, no cell;
- removes only the directory it created, refusing any other path with no force flag.

The runner then **re-validates** the reader's own claims (trust level, layout mode, every family
name) against its own allowlists, so a non-compliant reader cannot talk its way past the carve-out.

### 24.5 What § 24 does NOT establish

```text
No evidence about the real dataset was produced.
Counts describe cells the generator itself wrote moments earlier.
Nothing here is citable as GATE-1 or GATE-2 evidence.
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED stays false.
All eight gates remain not_started / not approved.
```

---

## 25. BR-SOURCE-11D-META — the next decision question, still no real input

BR-SOURCE-11D-META defines the next decision question: whether real manifest metadata-only parsing
can be authorized. It does not authorize real manifest reading by itself. It does not authorize
data-file execution. It does not approve any gate.

```text
Option B (11C, § 24) covers synthetic temp-manifest execution only.
11D-META asks whether ONE real manifest may be opened as a control document — metadata only,
no referenced file opened, aggregate-only sanitized output.
Answer pending. No real manifest has been read.
```

If that question is answered affirmatively, the § 22.2 `local_manifest_dry_run` gate gains a second
accepted trust level and a second reader-port implementation whose defining invariant is that it
resolves **exactly one** path — the manifest — with no code path that opens a second file. Until
then, § 24.2's trust check remains the only accepted value and every other manifest is refused as
`local_manifest_execution_not_authorized`.

Record: [`br-receita-cnpj-real-manifest-metadata-only-carveout-decision-record.md`](./br-receita-cnpj-real-manifest-metadata-only-carveout-decision-record.md).

> **Answered.** The record merged as PR #167 and the owners gave the phrase
> `AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT`. § 26 records the implementation.

---

## 26. BR-SOURCE-11D-META-IMPL — real manifest metadata-only parsing implemented

BR-SOURCE-11D-META-IMPL implements metadata-only parsing support after explicit owner
authorization:

```text
AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT
```

It authorizes only manifest metadata parsing.
It does not authorize opening referenced Receita data files.
It does not authorize row reads.
It does not authorize join coverage.
It does not approve any gate.
It does not authorize import.
It does not authorize Supabase writes.
It does not authorize runtime or Agent 1.

### 26.1 The second trust level and the second reader port

The § 22.2 gate now dispatches on the declared manifest **trust**, and the two carve-outs are
independent:

```text
manifest_trust:
  not_applicable                — no local manifest involved
  synthetic_temp_manifest_only  — BR-SOURCE-11C (§ 24). Reads synthetic CSVs it generated.
  real_manifest_metadata_only   — BR-SOURCE-11D-META-IMPL. Reads ONE manifest DOCUMENT.
  real_manifest_not_authorized  — refused, as always
```

Each carve-out is gated by its **own** owner flag, because the two owner phrases are separate,
single-scope, and non-transferable:

```text
optionBCarveoutAuthorized                      → synthetic temp-manifest branch only
realManifestMetadataOnlyOptionBAuthorized      → metadata-only branch only
```

Neither flag satisfies the other's gate. Holding only the synthetic flag on a metadata-only run
fails closed with `real_manifest_metadata_only_not_authorized`; holding only the metadata flag on a
synthetic run fails closed with `option_b_carveout_not_authorized`.

The metadata-only branch **returns before the fixture scorer is reachable**, so every row,
eligibility, and join count on a metadata-only report is structurally zero.

### 26.2 The metadata-only reader contract

`br-receita-cnpj-real-manifest-metadata-reader.ts` implements the port. Its defining invariant —
"resolves exactly one path" — is enforced structurally and asserted three ways (static source guard,
instrumented `node:fs` observation with the referenced files materialized on disk, and the runner's
own re-validation of the scan's `referenced_data_files_opened` / `_statted` assertions).

```text
Reads:      the manifest document, once, under maxManifestBytes.
Never:      stat / lstat / existsSync / readdir / glob / readFile / createReadStream / path.join.
Bounded:    requests ONE byte beyond the ceiling — an oversized document is REFUSED, never
            parsed truncated, because a truncated JSON document is a different document.
Returns:    booleans, counts, and class labels. No path, filename, period value, or raw document.
```

Caps, both REQUIRED of the caller (a cap nobody stated is a cap nobody agreed to):

```text
maxManifestBytes  <= 1_000_000
maxDeclaredFiles  <= 20
allowedLayoutMode  = official_headerless
```

Contract breaches **throw** a fixed code; manifest-CONTENT problems are **reported** on the scan so
the runner can fail closed *and* still emit the aggregate that explains why — a forbidden family is
reported as a count, never filtered out and never named.

### 26.3 The report block

```text
manifest_metadata:            null on every non-metadata run
  schema_version_present:     boolean
  source_period_present:      boolean          (presence only — never the value)
  layout_mode:                official_headerless | invalid_or_unsupported | unknown
  declared_file_count:        number
  required_family_count:      number
  missing_required_family_count: number
  forbidden_family_count:     number           (count only — never a label)
  declared_family_counts:     allowlisted family keys + "other"
  required_families_present:  boolean
  forbidden_families_present: boolean
  manifest_bytes_read_bucket: lte_1mb | over_limit_blocked   (bucket, never a byte figure)
  referenced_data_files_opened:  false
  referenced_data_files_statted: false
  raw_manifest_printed:          false
  absolute_paths_printed:        false
```

### 26.4 Sanitizer additions

The carve-out makes two new output shapes possible, so § 22's sanitizer gained two leak kinds:

```text
raw_manifest_payload        — a raw_manifest / manifest_json / manifest_document key with a payload.
                              The manifest may be PARSED; it may never be ECHOED.
declared_filename_payload   — a file_name / manifest_path / basename key with a value. A RELATIVE
                              filename holds no absolute-path shape, so the KEY rule is what
                              catches it.
```

### 26.5 CLI

```text
--real-manifest-metadata-only   requires --manifest, --allow-local-manifest, --strict,
                                --max-manifest-bytes and --max-declared-files.
```

The real prepared manifest basenames (`manifest.headerless.json`, `manifest.real.json`) stay refused
on this flag as well as the old ones: the code path is proven with **synthetic** metadata manifests,
and executing an operator's real prepared file set is a separate operator step. **Superseded by
§ 27**, which is that step; without the § 27 declaration this paragraph still holds exactly.

### 26.6 What this section does NOT establish

No file referenced by any manifest has been opened or stat-ed. No row has been read, parsed, counted,
or hashed. No join has been computed over real data. **No coverage figure about the real dataset
exists**, and a green metadata-only run is not citable as GATE-1 or GATE-2 evidence, or as evidence
about the dataset's coverage, join rates, or eligibility. All eight gates remain `not_started` / not
approved. (As of § 27 the first sentence of this paragraph — "no real operator manifest has been
read" — no longer holds for the manifest DOCUMENT; everything else in it does.)

---

## 27. BR-SOURCE-11E — operator-prepared manifest, executed metadata-only

BR-SOURCE-11E spends one narrow declaration on top of § 26: this run may name the **operator's own
prepared manifest document** instead of a synthetic one.

It authorizes only which manifest DOCUMENT may be named.
It does not authorize opening referenced Receita data files.
It does not authorize row reads.
It does not authorize join coverage.
It does not relax a cap, `--strict`, or the sanitization declaration.
It does not approve any gate.
It does not authorize import, Supabase writes, runtime, or Agent 1.

### 27.1 The third flag, and why it is separate

```text
reader:  realManifestMetadataOnlyExecutionAuthorized   (which document may be named)
runner:  realManifestMetadataOnlyExecutionAuthorized   (provenance + cross-check)
CLI:     --real-manifest-metadata-execution            (valid ONLY with
                                                        --real-manifest-metadata-only)
```

Three authorizations now exist, and none substitutes for another: `optionBCarveoutAuthorized`
(§ 24), `realManifestMetadataOnlyOptionBAuthorized` (§ 26), and this one. The 11E flag alone is
refused with `manifest_metadata_not_authorized` at the reader and with
`real_manifest_metadata_only_not_authorized` at the runner gate.

### 27.2 Exactly two checks are relaxed

```text
relaxed  — the staging-directory segment list, for --manifest only
relaxed  — the prepared-basename list, for --manifest only
UNCHANGED — URL refusal, .json requirement, empty-path refusal
UNCHANGED — both metadata caps (required, and refused above their ceilings)
UNCHANGED — --strict, the output-sanitization declaration, the forbidden-flag list
UNCHANGED — --output: both refusals apply on every flag, plus repository containment
UNCHANGED — one descriptor, on the manifest; no stat, no listing, no second path
UNCHANGED — forbidden-family, missing-family and layout-mode refusals
```

### 27.3 The cross-check: two declarations that must agree

The runner resolves no paths, so it cannot enforce the waiver — the reader does. What the runner
enforces is agreement. The reader reports `operatorPreparedManifestAuthorized`, and:

```text
scan claims true + run did not declare it  ⇒ real_manifest_metadata_execution_not_authorized
                                             (ok: false, manifest_metadata: null, counts zero)
scan claims true + run declared it         ⇒ accepted
scan claims false + run declared it        ⇒ accepted; the report states declared=true, spent=false
```

`manifest_metadata.operator_prepared_manifest_authorized` is derived from the **reader's** report,
never from the caller's declaration, so the block cannot overclaim a waiver that was not spent.

### 27.4 The executed run

One real operator-prepared manifest was executed metadata-only, `--strict`, both caps stated, no
`--output`. The sanitized aggregate result:

```text
ok                                    true      exit code 0
manifest_trust                        real_manifest_metadata_only
option_b_carveout_authorized          false
metadata_only_option_b_authorized     true
metadata_only_execution_authorized    true
layout_mode                           official_headerless
schema_version_present                true
source_period_present                 true      (presence only; the value is not reported)
declared_file_count                   5
required_family_count                 2         missing_required_family_count 0
forbidden_family_count                0         forbidden_families_present    false
declared_family_counts                empresas 1, estabelecimentos 1, simples 0,
                                      cnaes 1, municipios 1, naturezas 1, other 0
manifest_bytes_read_bucket            lte_1mb
operator_prepared_manifest_authorized true
referenced_data_files_opened          false     referenced_data_files_statted false
raw_manifest_printed                  false     absolute_paths_printed        false
aggregate / eligibility / join counts all zero
guardrail_counts                      all zero (0 no-write violations, 0 sanitizer findings)
decision_status                       8 × not_approved
run_scope / safety                    every flag false
cleanup                               not_needed, 0 artifacts
errors                                []
```

### 27.5 What § 27 does NOT establish

The run says the operator's manifest is **well-formed**: it declares five files, covers both required
families, declares no Sócios/QSA/CPF family, and states the headerless layout. That is a statement
about a control document and nothing else.

No file the manifest references was opened or stat-ed. No row was read, parsed, counted, or hashed.
No join was computed. **No coverage figure about the real dataset exists.** No dataset was
downloaded, imported, or processed; no Supabase write, migration, index change, runtime hop, Agent 1
integration, or provider call occurred; no report artifact was written. All eight gates remain
`not_started` / not approved, and a green metadata-only run is not citable as GATE-1 or GATE-2
evidence, or as evidence about the dataset's coverage, join rates, or eligibility.

---

## 28. BR-SOURCE-11F — the next decision question, still no real data-file execution

BR-SOURCE-11F defines the next decision question: whether an ultra-bounded required-family real
data-file probe can be authorized. It does not authorize real data-file execution by itself. It does
not authorize joins. It does not authorize import. It does not approve any gate.

```text
11E executed one operator-prepared manifest DOCUMENT, metadata-only (§ 27).
11F records the question of whether two allowlisted files (empresas, estabelecimentos) may be opened
  under hard caps, read for a tiny bounded prefix, and reported as aggregates only.
Its own status is proposed_for_owner_review, and its recommended option requires a separate,
  exactly-worded owner phrase after it merges.
```

The § 22.2 `local_manifest_dry_run` mode therefore stays exactly where § 26 and § 27 left it: opened
for a manifest **document** only. No trust level permitting a referenced-file read exists, `stat`
remains absent from the reader, and GATE-1 and GATE-2 retain sole authority over dataset processing.

Record: [`br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md).

---

## 29. BR-SOURCE-11F-IMPL — Option C implemented: the ultra-bounded required-family probe

BR-SOURCE-11F-IMPL implements and executes Option C after explicit owner authorization:

```text
AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL DATA-FILE PROBE
```

It authorizes only an ultra-bounded required-family probe over Empresas and Estabelecimentos.
It does not authorize catalog files.
It does not authorize Socios/QSA/CPF/person files.
It does not authorize joins.
It does not authorize row samples.
It does not authorize identifiers in output.
It does not approve any gate.
It does not authorize import.
It does not authorize Supabase writes.
It does not authorize runtime or Agent 1.

### 29.1 A FOURTH manifest trust, dispatched separately

`local_manifest_dry_run` now recognizes four trust levels. Each is gated by its own declared flag, and
none substitutes for another:

```text
synthetic_temp_manifest_only        — BR-SOURCE-11C Option B. Synthetic workspace, synthetic cells.
real_manifest_metadata_only         — BR-SOURCE-11D-META-IMPL. Reads ONE manifest DOCUMENT.
real_manifest_required_family_probe — BR-SOURCE-11F-IMPL. The ONLY trust under which a file the
                                      manifest REFERENCES is opened at all.
real_manifest_not_authorized        — everything else. Always refused.
```

The probe trust is the narrowest, not the widest: it REQUIRES the metadata-only and BR-SOURCE-11E
declarations in addition to its own `requiredFamilyProbeAuthorized`, because the manifest is still read
as a control document first. Holding the three earlier authorizations without the Option C phrase buys
no data-file read; holding the Option C phrase alone unlocks neither of the earlier carve-outs.

### 29.2 What the probe opens, and what it refuses

```text
Opened:   at most ONE declared file for empresas + at most ONE for estabelecimentos (2 data files max),
          plus the manifest control document (not a data file, not counted against the file cap).
Refused:  catalog families (simples, cnaes, municipios, naturezas) — counted, never opened;
          Socios/QSA/CPF/person families — fail-closed refusal reported as a count;
          archives (.zip, .gz, .7z, .tar, …) — a byte cap on compressed input is not a cap on content;
          a ZIP-staging (raw-zips) declared path segment;
          an absolute or URL declared path;
          a declared path resolving outside the manifest's own directory.
```

The declared-DATA-path denylist is deliberately scoped to the ZIP staging area alone. Option C
authorizes opening the operator's already-EXTRACTED, manifest-declared required-family files, and a
directory NAME says nothing about whether a file is bounded-readable; an archive stays refused by
extension wherever it sits. The metadata reader's much longer MANIFEST-document denylist is untouched.

### 29.3 Caps, enforced and asserted

```text
maxFilesOpened   <= 2        maxRowsPerFile  <= 20      maxTotalRows  <= 40
maxBytesPerFile  <= 64_000   maxTotalBytes   <= 128_000
maxManifestBytes <= 1_000_000            maxDeclaredFiles <= 20
liveness deadline = 30 s     — a FIXED internal ceiling, not a caller-stated cap, so no flag widens it
```

Every cap is required of the caller (a cap nobody stated is a cap nobody agreed to), is re-enforced at
read time against the value the probe was built with, and has at least one test that drives real input
past it. Two ceilings per axis: per-file caps bound one file, total caps bound the run. Reaching
`maxBytesPerFile` mid-row DROPS that row rather than counting a partial row as valid — the window is a
bounded prefix, and a cut row is a different row, not a smaller one.

### 29.4 What the probe returns

Aggregate-only, per § 9 of the decision record: `families_attempted`, `files_opened_count`,
`files_opened_by_family`, `bytes_read_bucket` and `rows_read_bucket` (buckets, never figures),
`row_shape` (expected official column count + an observed column-count HISTOGRAM + valid/invalid
counts), `encoding_status`, `delimiter_status`, `headerless_status`, a `selection_class` label, the
declared forbidden/never-opened family counts, and the held-absence assertions
(`raw_rows_printed`, `raw_cells_printed`, `identifiers_printed`, `filenames_printed`,
`absolute_paths_printed`, `hashes_printed`, `joins_executed`, `join_coverage_computed`,
`full_dataset_processed`, all `false`).

A row is split to COUNT its fields and is then discarded. No field value is retained, compared,
normalized, returned, logged, stored beyond the loop iteration, or passed to anything other than a
counter. The output sanitizer gained two leak kinds for exactly this reason — `raw_cell_payload` and
`row_sample_payload` — because the probe is the first code path that ever holds a real row and a real
cell.

### 29.5 Gate status after BR-SOURCE-11F-IMPL — UNCHANGED

All eight gates remain `not_approved`. A green probe says the two required-family files an
operator-prepared manifest declares can be opened and parsed structurally under caps. It is not
citable as GATE-1 or GATE-2 evidence, or as evidence about the dataset's coverage, join rates, or
eligibility, and no coverage figure or ratio is emitted even though bounded arithmetic could produce
one. The authorization is single-milestone and expires with it.

Record: [`br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md).

---

## 30. BR-SOURCE-11G — the next decision question, still no real join execution

BR-SOURCE-11G defines the next decision question: whether an ultra-bounded required-family real join
probe can be authorized. It does not authorize real join execution by itself. It does not authorize
join coverage. It does not authorize import. It does not approve any gate.

```text
11F-IMPL opened two required-family files and parsed them structurally (§ 29).
11G records the question of whether the protected technical join key may be parsed ephemerally from
  those same two capped windows, compared in memory, and reported as a coarse bucket only.
Its own status is proposed_for_owner_review, and its recommended option requires a separate,
  exactly-worded owner phrase after it merges.
```

Nothing in § 29 changes. The probe's held-absence assertions `joins_executed = false` and
`join_coverage_computed = false` remain the merged behaviour, no fifth manifest trust exists, the
BR-SOURCE-10G/10H join and coverage designs remain designs rather than authorizations, and GATE-1 and
GATE-2 retain sole authority over dataset processing.

Record: [`br-receita-cnpj-bounded-real-join-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-join-dry-run-decision-record.md).

---

## 31. BR-SOURCE-11G-IMPL — Option C implemented: the ultra-bounded required-family real join probe

The owner authorized the § 30 question's recommended option with the exact phrase
`AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE`, after that record merged.

**BR-SOURCE-11G-IMPL implements only the explicitly authorized Option C ultra-bounded in-memory
required-family real join probe. It does not authorize join coverage, import, Supabase, runtime,
Agent 1, provider calls or production use.**

### 31.1 What landed

```text
br-receita-cnpj-required-family-join-probe.ts — the ONLY module that executes the bounded real join
A fifth manifest trust: real_manifest_required_family_join_probe
Two new flags: requiredFamilyJoinProbeAuthorized, realLocalJoinDryRunAuthorized
Four new caps: maxJoinInputRows, maxJoinKeyValuesInMemory,
               maxJoinPairsEmitted = 0, maxJoinedRowsPrinted = 0
Seven new sanitizer leak kinds: join_key_payload, joined_row_payload, joined_sample_payload,
               join_pair_payload, coverage_payload, cnpj_basico_payload, cnpj_completo_payload
CLI flags: --required-family-join-probe, --required-family-join-probe-authorized,
           --real-local-join-dry-run-authorized, --max-join-input-rows,
           --max-join-key-values-in-memory, --max-join-pairs-emitted, --max-joined-rows-printed
```

The § 7 join-key handling rules of this design are now implemented rather than proposed, at probe
scale: one field position per row, parsed ephemerally, held in a capped in-memory Set, compared by
membership, and released before the aggregate is assembled. § 8.5 is enforced by the sanitizer and by
static source guards: no join key, joined row, joined sample, join pair, hash, coverage percentage or
coverage claim can reach a report, a log, or an error message.

The § 5 architecture question is untouched. This is not Option A, B or C of § 5 — those describe
FULL-dataset join architectures. A 20-row-per-file membership test selects no architecture and creates
no precedent for one; § 5's recommended conservative path remains a proposal for a future milestone.

### 31.2 What it opens, and the one thing that changed

The file surface is identical to § 29 (11F-IMPL): one Empresas file, one Estabelecimentos file, two
data files per run, ≤ 64 KB and ≤ 20 rows per file, ≤ 128 KB and ≤ 40 rows per run, ≤ 30 s. No catalog
file, no Sócios/QSA/CPF file, no ZIP, no raw-zip staging area, no additional family, no glob, no
directory scan.

The single behavioural delta is the assertion pair `joins_executed` / `join_executed`, which is `true`
on a join-probe run and `false` everywhere else. `join_coverage_computed` and `coverage_claimed`
remain `false` unconditionally: § 10's resource limits and the coverage prohibition are a refusal, not
a labelling rule, so a percentage is declined at the input boundary AND blocked at the output one.

### 31.3 The executed run

The probe ran once against the operator's own prepared local file set: two files opened, 20 rows read
per file, every row matching the official positional column count, `match_result_bucket = zero`.

That `zero` means the two bounded prefixes did not overlap — the single most likely outcome for two
independently-sharded 20-row windows. It confirms the join mechanism works on real input under caps
and confirms nothing else. It is not a coverage figure, not a join rate, not evidence about the
dataset, not GATE-1 or GATE-2 evidence, and not grounds for a wider re-run.

### 31.4 What remains blocked

```text
FULL_JOIN_EXECUTION_READY = false   IMPORT_READY = false   RUNTIME_READY = false
AGENT1_READY = false                GATE-1 … GATE-8 = not approved
join coverage, dataset download, full-dataset processing, source_company_snapshots writes,
Supabase writes, migrations, index changes, runtime, Agent 1, providers, HubSpot, Slack, UI,
record_identity_key construction, normalized_tax_id promotion — all unchanged and blocked.
```

The authorization is single-milestone and expires with it. § 30 remains the record of the question;
the answer is recorded in that record's § 17.

Record: [`br-receita-cnpj-bounded-real-join-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-join-dry-run-decision-record.md).

---

## 32. BR-SOURCE-11H — the next decision question, still no coverage signal

```text
BR-SOURCE-11H defines the next decision question: whether an ultra-bounded aggregate-only real join
coverage signal can be authorized.
It does not authorize coverage execution by itself.
It does not authorize exact coverage percentages.
It does not authorize full-dataset denominator claims.
It does not authorize import.
It does not approve any gate.
```

Nothing in § 31 changes. The join probe's `join_coverage_computed = false` and `coverage_claimed =
false` assertions remain the merged behaviour, the § 31.2 file surface and ceilings are unchanged, no
sixth manifest trust exists, the § 10 coverage prohibition remains a refusal rather than a labelling
rule, the BR-SOURCE-10H bounded coverage design remains a design rather than an authorization, and
GATE-1 and GATE-2 retain sole authority over dataset processing.

One point matters for this design specifically: the successor record proposes raising the byte, row
and in-memory key-window ceilings (8×, 10×, 10× the § 31.2 values) while leaving the file count,
family allowlist and aggregate-only discipline untouched. That escalation is a proposal under owner
review, not a change to anything implemented here, and § 10's resource limits are unaffected until a
separate, exactly-worded owner phrase naming the coverage signal is given after that record merges.

Record: [`br-receita-cnpj-bounded-real-join-coverage-decision-record.md`](./br-receita-cnpj-bounded-real-join-coverage-decision-record.md).

---

## 33. BR-SOURCE-11H-IMPL — the aggregate-only coverage SIGNAL, implemented and executed once

That record merged and the owner gave the phrase, so § 32's question is answered:

```text
AUTHORIZE OPTION C — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL
```

BR-SOURCE-11H-IMPL implements only the explicitly authorized Option C ultra-bounded aggregate-only
real join coverage signal. It does not authorize exact percentages, full-dataset denominator claims,
coverage proof, import, Supabase, runtime, Agent 1, provider calls or production use.

### 33.1 The sixth reading port

A single new module, `br-receita-cnpj-aggregate-join-coverage-signal.ts`, is the only code that
executes the signal. It is a sibling of the 11F structural probe and the 11G join probe rather than a
mode flag on either: each carries static guards about its own source, and a shared reader with a mode
switch would put the flag between a 20-row structural probe and a 200-row value read.

It declares a SIXTH manifest trust, `real_manifest_aggregate_join_coverage_signal`, dispatched by the
runner exactly like the earlier carve-outs, and gated by TWO new declarations —
`aggregateOnlyJoinCoverageSignalAuthorized` and `realLocalJoinCoverageSignalAuthorized` — that are
required IN ADDITION to all five earlier ones and are never inferred from them. The 11G phrase
authorized a 20-row window and expired with its milestone.

### 33.2 The one widened axis

| Axis | 11F / 11G | 11H-IMPL |
| --- | --- | --- |
| Data files opened | 2 (1 per required family) | **unchanged** |
| Bytes per file | ≤ 64,000 | ≤ 512,000 |
| Rows per file | ≤ 20 | ≤ 200 |
| Bytes per run | ≤ 128,000 | ≤ 1,024,000 |
| Rows per run | ≤ 40 | ≤ 400 |
| Coverage input rows / key window | ≤ 40 | ≤ 400 |
| Pairs emitted / rows printed | = 0 | **unchanged (equalities)** |
| Fields parsed per row | 1 | **unchanged** |
| Manifest ceiling, families, denylists, layout | — | **unchanged** |

Everything not in that table is byte-for-byte the 11F/11G surface. The shared CLI cap flags now parse
against the widest ceiling in the tool and each probe mode re-checks its own tighter ceiling, so a
`--required-family-probe` or `--required-family-join-probe` run that declares the 11H window is
refused rather than silently widened.

### 33.3 Why the output is a SIGNAL and not a finding

The risk this milestone introduces is not a value escaping — 11G already solved that — it is a bounded
bucket being restated as a claim. So the block states four structural falses
(`exact_coverage_percentage_printed`, `full_dataset_denominator_printed`, `coverage_claimed`,
`production_inference_allowed`) and names the only denominator that exists:
`denominator_scope = bounded_window_only`. Requests for any of the four are refused at the INPUT
boundary with their own error codes, and the sanitizer blocks them at the OUTPUT boundary with five
new kinds (`coverage_signal_exact_percentage_payload`, `coverage_signal_denominator_payload`,
`coverage_signal_proof_payload`, `coverage_signal_guarantee_payload`,
`production_inference_payload`). `join_coverage_computed` stays `false` on every path.

### 33.4 The executed run

The signal ran once against the operator's own prepared local file set: two files opened, one per
required family, both inside the byte and row buckets, `match_result_bucket = zero`.

That `zero` means the two bounded prefixes did not overlap. It is a GREEN result. It confirms the
mechanism works on real input under the wider caps and confirms nothing else: it is not a coverage
figure, not a coverage proof, not a coverage guarantee, not a dataset quality score, not evidence
about the dataset, not GATE-1 or GATE-2 evidence, and not grounds for a wider re-run. A wider window
is a new decision requiring a new record and a new phrase.

### 33.5 What remains blocked

```text
FULL_JOIN_EXECUTION_READY = false   IMPORT_READY = false   RUNTIME_READY = false
AGENT1_READY = false                GATE-1 … GATE-8 = not approved
exact coverage percentages, full-dataset denominators, coverage proof, coverage guarantees,
production inference, join coverage computation, dataset download, full-dataset processing,
source_company_snapshots writes, Supabase writes, migrations, index changes, runtime, Agent 1,
providers, HubSpot, Slack, UI, record_identity_key construction, normalized_tax_id promotion —
all unchanged and blocked.
```

The authorization is single-milestone and expires with it.

Record: [`br-receita-cnpj-bounded-real-join-coverage-decision-record.md`](./br-receita-cnpj-bounded-real-join-coverage-decision-record.md).

---

## 34. Update (BR-SOURCE-11I)

BR-SOURCE-11I interprets the 11H aggregate-only coverage signal result. It records that
`match_result_bucket = zero` is a valid bounded-window outcome, not a failure. It does not authorize
reruns, larger caps, multi-window sampling, exact coverage percentages, import, Supabase, runtime or
Agent 1. It recommends preparing a future GATE-2 route decision package. It does not approve any
gate. See
[`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md).

---

## 35. Update (BR-SOURCE-11K)

BR-SOURCE-11K creates the GATE-2 controls and evidence template. It provides a review checklist,
evidence packet format, fail-closed validation matrix, and owner decision matrix for a future GATE-2
owner review. It does not approve GATE-2. It does not authorize owner review, broader local
execution, temp storage, multi-window sampling, exact coverage percentages, import, Supabase writes,
runtime, or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md).

---

## 36. Update (BR-SOURCE-11L)

BR-SOURCE-11L creates the GATE-2 owner review package. It assembles current evidence, evidence gaps,
owner questions, decision options, a risk register and required decision fields for a future GATE-2
decision record. It does not approve GATE-2. It does not authorize a GATE-2 decision, broader local
execution, temp storage, multi-window sampling, exact percentages, import, Supabase writes, runtime,
or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-gate2-owner-review-package.md`](./br-receita-cnpj-gate2-owner-review-package.md).

BR-SOURCE-11M creates the GATE-2 formal decision record.
It consolidates evidence, gaps, formal options, decision fields, minimum conditions and risk decisions
for later owner acceptance. It does not approve GATE-2. It does not authorize a GATE-2 decision, limited
broader local execution, broader local execution, temp storage, multi-window sampling, exact
percentages, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-gate2-formal-decision-record.md`](./br-receita-cnpj-gate2-formal-decision-record.md).

BR-SOURCE-11N creates the limited broader local execution decision record.
It documents candidate scope, prerequisites, proposed controls, fail-closed cases, stop conditions and
formal options for future review. It does not approve GATE-2. It does not authorize limited broader local
execution, broader local execution, implementation, temp storage, multi-window sampling, exact
percentages, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-limited-broader-local-execution-decision-record.md`](./br-receita-cnpj-limited-broader-local-execution-decision-record.md).

BR-SOURCE-11O creates the limited broader local execution implementation design package.
It describes proposed architecture, control flow, conceptual CLI/API contract, data-family policy, cap
model, join handling, output/evidence model, fail-closed design, stop conditions, future test strategy and
sequencing. It does not approve GATE-2. It does not authorize implementation, limited broader local
execution, broader local execution, temp storage, multi-window sampling, exact percentages, import,
Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md`](./br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md).
