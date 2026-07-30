# BR-SOURCE-11G — Bounded real join dry-run decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11G — Bounded real join dry-run decision record (docs-only)
**Status:** `proposed_for_owner_review` — **not** a gate approval, and **not** an authorization to execute a real join
**Predecessor:** BR-SOURCE-11F-IMPL-DOCFIX-LAND — `BRSOURCE11FIMPLDOCFIXLANDA — REQUIRED_FAMILY_PROBE_OFFICIAL_DOCFIX_MERGED` (PR #174, `main` HEAD `d6069c3b6f7e72ae0ea38f0c1c5f8defc32c112c`), validated post-merge by BR-SOURCE-11F-IMPL-V — `BRSOURCE11FIMPLVA`
**Last reviewed:** 2026-07-30

**Related documents:**
- Bounded real data-file dry-run decision record (BR-SOURCE-11F, Option C authorized and implemented) — [`br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-data-file-dry-run-decision-record.md)
- Real manifest metadata-only carve-out decision record (BR-SOURCE-11D-META, executed by 11E) — [`br-receita-cnpj-real-manifest-metadata-only-carveout-decision-record.md`](./br-receita-cnpj-real-manifest-metadata-only-carveout-decision-record.md)
- Local manifest dry-run carve-out decision record (BR-SOURCE-11C-R) — [`br-receita-cnpj-local-manifest-dry-run-carveout-decision-record.md`](./br-receita-cnpj-local-manifest-dry-run-carveout-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join output sanitization decision record — [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)
- Full join identity grain decision record — [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md)
- Full join field allowlist decision record — [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)

---

> This document **asks one question and answers nothing**. BR-SOURCE-11F proved, under caps, that the
> two required-family files an operator-prepared manifest declares can be opened and parsed
> structurally. It proved nothing about whether those two families **relate to each other** — which is
> the single technical premise the entire Brazil source model rests on. The only remaining step that
> is smaller than "measure the dataset" is a join probe over tiny capped windows. Whether such a probe
> may be authorized at all is the entire subject of this record.
>
> Nothing here authorizes — and nothing here should be read as authorizing — executing a join over
> real data, constructing or retaining a join key, emitting a joined row, emitting a join pair,
> computing coverage, opening any additional file, opening a catalog file, opening a ZIP, a dataset
> download, full-dataset processing, import, a Supabase write, a production write, a migration, an
> index change, a runtime change, an adapter/validator change, an Agent 1 integration, a provider
> call, a HubSpot sync, a Slack notification, live generation, full expansion, or merge to an
> operational state. **This document records a decision question; it decides nothing and executes
> nothing.**

---

## 1. Status

```text
Decision record status: proposed_for_owner_review
Implementation status:  not_authorized
Execution status:       not_authorized
Current GO/NO-GO:       NO-GO
```

Explicitly:

```text
This record does not approve GATE-1.
This record does not approve GATE-2.
This record does not approve any gate.
This record does not authorize bounded real join execution.
This record does not authorize join coverage.
This record does not authorize full dataset execution.
This record does not authorize import.
This record does not authorize Supabase writes.
This record does not authorize runtime.
This record does not authorize Agent 1.
```

Four clarifications, restated because every milestone in this series has shown how easily they are
conflated:

- **A merged decision record is not an authorization.** Merging this record makes the *question*
  official. The answer is a separate, exactly-worded owner phrase (§ 12), given after this record is
  official, and it would authorize only the option it names.
- **A mechanism existing in code is not an approval.** BR-SOURCE-11A landed the no-write/no-runtime
  guard, the output sanitizer and the failure-cleanup model; 11C added a `filesystem_path_like` leak
  kind; 11D-META-IMPL added `raw_manifest_payload` and `declared_filename_payload`; 11F-IMPL added
  `raw_cell_payload` and `row_sample_payload`. Those are the *mechanisms* of GATE-8, GATE-5 and
  GATE-6. All eight gates remain `not_started` / not approved.
- **A parseable file is not a joinable dataset.** 11F proved file structure. Structure is a statement
  about how bytes are arranged inside one file. It is not a statement about whether two files refer to
  the same companies.
- **The 11F authorization did not survive its milestone.** The Option C phrase of BR-SOURCE-11F was
  single-milestone by its own § 7.1 and expired with it. It authorized opening two files to count
  columns. It does not authorize reading a value out of those columns, and it never authorized a join.

---

## 2. Background

```text
BR-SOURCE-11A created the no-write/no-runtime runner scaffold.
BR-SOURCE-11B validated synthetic_fixture_only.
BR-SOURCE-11C implemented synthetic temp-manifest.
BR-SOURCE-11D-META defined and implemented real manifest metadata-only.
BR-SOURCE-11E executed real manifest metadata-only against the operator prepared manifest.
BR-SOURCE-11F defined, implemented and validated the ultra-bounded required-family real data-file
  probe.
11F proved only that Empresas and Estabelecimentos can be opened and parsed structurally under caps.
11F did not execute a join.
The next possible step is a decision on whether to execute a real join probe under hard caps.
```

### 2.1 The sequence, and what each step actually established

| Milestone | Verdict | What it established | What it did **not** establish |
|-----------|---------|---------------------|-------------------------------|
| BR-SOURCE-11A-LAND | `BRSOURCE11ALANDA` | The full join dry-run runner scaffold merged, with `local_manifest_dry_run` declared and always refusing. | Nothing about real input; the runner performed no filesystem read at all. |
| BR-SOURCE-11B | `BRSOURCE11BA` | Post-merge validation that the scaffold behaves as declared in `synthetic_fixture_only`. | Nothing about manifests, files, or the dataset. |
| BR-SOURCE-11C-R / 11C-LAND / 11C-V | merged, validated | Manifest-reading plumbing — parse, cap, sanitize, clean up — against synthetic temp manifests only. | Anything about the real dataset. |
| BR-SOURCE-11D-META (+ IMPL) | merged | The real-manifest metadata-only question and a reader that resolves **exactly one** path, asserted by static test. | Any real execution: it ran against synthetic metadata manifests only. |
| BR-SOURCE-11E-LAND | `BRSOURCE11ELANDA` | One **operator-prepared manifest document** executed metadata-only: well-formed, headerless layout stated, both required families declared, no Sócios / QSA / CPF family declared. | Anything about file content, rows, coverage, quality, join rates, eligibility, or either gate. |
| BR-SOURCE-11F (record) | merged, official | The bounded real data-file question, its options, boundaries, caps and blocked list. | No gate. A merged question is still a question. |
| BR-SOURCE-11F-IMPL-LAND | `BRSOURCE11FIMPLLANDA` (PR #173) | Option C implemented and executed: two required-family files opened under caps, aggregate-only output. | Any join, any join key, any coverage figure, any gate. |
| BR-SOURCE-11F-IMPL-DOCFIX-LAND | `BRSOURCE11FIMPLDOCFIXLANDA` (PR #174) | The official docs corrected to state the probe's real strength. | Nothing new about the dataset; a docs correction moves no gate. |
| BR-SOURCE-11F-IMPL-V | `BRSOURCE11FIMPLVA` | Post-merge validation that the probe behaves exactly as the merged docs declare. | Same limitation, restated. |

### 2.2 The 11F evidence, quoted exactly, and read at its real strength

```text
Empresas:
- 20 filas leídas
- 7 columnas esperadas
- 20 válidas / 0 inválidas

Estabelecimentos:
- 20 filas leídas
- 30 columnas esperadas
- 20 válidas / 0 inválidas

files_opened_count       = 2
raw_rows_printed         = false
raw_cells_printed        = false
identifiers_printed      = false
filenames_printed        = false
absolute_paths_printed   = false
hashes_printed           = false
joins_executed           = false
join_coverage_computed   = false
full_dataset_processed   = false
```

Every value above is a count, a boolean, or an expected-column-count schema constant. The column
counts (`7`, `30`) are **layout facts about the official Receita file format**, not observations about
any company. The four held-absence assertions at the bottom are the load-bearing ones for this record:
`joins_executed = false` and `join_coverage_computed = false` are precisely the two things
BR-SOURCE-11G asks whether to change — and asks only, without changing them.

```text
11F probó estructura mínima real.
11F NO probó join.
11F NO probó cobertura.
11F NO probó calidad del dataset.
11F NO autorizó import.
11F NO aprobó gates.
```

### 2.3 What has structurally *not* happened yet

```text
No join has been executed over real data by any SellUp code path.
No join key has been parsed, constructed, compared, retained, or hashed from real data.
No joined row and no join pair has been produced.
No coverage figure about the real dataset exists.
No catalog file has been opened.
No Socios / QSA / CPF / person file has been opened.
No ZIP has been opened.
No dataset has been downloaded by SellUp automation.
No row of Receita data has survived the loop iteration that read it.
```

That list is the boundary this record does **not** move. It asks whether a future, separately
authorized milestone may move the first three lines of it — and only those — under caps.

### 2.4 The prior art this record must not contradict

BR-SOURCE-10G designed a bounded company↔establishment join dry-run in which the join key is
**ephemeral, in memory only**; BR-SOURCE-10H designed a bounded join **coverage** strategy in which
`coverage_is_representative` is always `false`. Both are official designs and neither is an
authorization. This record does not restate, widen, or reopen them. It asks a narrower question than
10G designs and a strictly smaller one than 10H designs: 10G's mechanism sized down to two capped
windows, with coverage removed entirely rather than labelled.

---

## 3. Decision question

```text
Can SellUp authorize an ultra-bounded real join dry-run between Empresas and Estabelecimentos,
executed only in memory, over tiny capped windows, without printing identifiers, without printing
join keys, without printing joined rows, without samples, without coverage claims, without import,
without Supabase, without runtime, and without approving any gate?
```

### 3.1 What the question is deliberately **not** asking

- It is not asking whether Brazil may be imported. That is `OPS_BR_READY_FOR_IMPORT`, unchanged and
  `false`.
- It is not asking whether the real dataset may be processed. That is `FULL_JOIN_EXECUTION_READY`,
  unchanged and `false`.
- It is not asking whether **join coverage** may be measured. That is § 6, Option E, and it belongs to
  a later record (BR-SOURCE-11H).
- It is not asking whether **catalog** families may be opened. That is Option D, and it is broader
  than the recommendation.
- It is not asking whether a join key may be **persisted**, promoted to `record_identity_key`, or
  promoted to `normalized_tax_id`. Those are forbidden outright by § 5, and by GATE-3, GATE-4 and
  GATE-5 independently of anything decided here.
- It is not asking the owners to approve GATE-1 or GATE-2 quickly, informally, or by implication. A
  bounded probe is **not** a gate approval; it is a bounded exception whose boundaries the owners set,
  and it leaves every gate `not_started`.
- It is not asking for standing permission. Any authorization granted under this record is scoped to
  the single next milestone that consumes it, and expires with that milestone.

### 3.2 Why the question arises now

1. **11F exhausted the structural surface.** Re-running the probe produces the same column-count
   histogram. There is no further signal available from either file **in isolation**.
2. **The remaining unknown is relational, not structural.** The entire Brazil source model assumes
   that an establishment row can be associated with its company row. 11F says both files parse. It
   says nothing about whether the values in the position the layout reserves for the shared company
   root are present, populated, consistently formatted between the two families, or aligned at all.
   That is unknowable from a column count, and it is a prerequisite for every later measurement.
3. **Counter-reason, stated plainly and given equal weight.** A join is not a lighter operation than a
   read — it is a strictly heavier one. To join, code must *parse a value out of a row*, *hold it*,
   and *compare it against another value*. Every prior milestone in this series, including 11F, was
   able to promise that no field value survived the loop iteration that produced it. A join probe
   cannot make that promise: by construction it retains at least one identifier-derived value per row,
   however briefly, and that value is the CNPJ root. An owner may reasonably decide that no volume of
   caps and sanitization makes that acceptable before GATE-1 and GATE-2 are approved on their own
   merits, and choose Option A. **That is a legitimate answer to this question**, and this record does
   not treat it as a delay.

---

## 4. Non-goals

```text
This is not import readiness.
This is not production readiness.
This is not live prospect generation.
This is not Agent 1 integration.
This is not Supabase staging.
This is not HubSpot enrichment.
This is not full dataset coverage.
This is not legal approval.
This is not storage approval.
This is not GATE approval.
```

Three further non-goals, because the series has seen all three misread before:

- **It is not a coverage measurement.** A bounded join probe compares a bounded prefix of one file
  against a bounded prefix of another. A match rate over two 20-row windows is a statement about two
  windows. It does not generalize, it must not be emitted, and it may not be presented as coverage, as
  a join rate, or as eligibility. See § 10.
- **It is not the full join dry-run.** The full join dry-run designed in BR-SOURCE-10J measures the
  whole dataset. This probe would establish only that the join *mechanism* runs against real input
  under caps without leaking the join key.
- **It is not a data-quality verdict.** Zero matches in two tiny windows is not evidence that the
  dataset does not join; the windows are prefixes, and prefixes of two independently sharded files
  have no reason to overlap. § 10 therefore permits `not_reported` as a first-class result, and § 7
  requires the implementation to say so in its own report rather than let a reader infer a failure.

---

## 5. Join key risk statement

```text
The join between Empresas and Estabelecimentos relies on a technical root key, commonly represented
in Receita CNPJ files as the shared company root / cnpj_basico.

For SellUp governance, this value remains a protected technical join key.

It may be parsed ephemerally in memory only if a later implementation is explicitly authorized.
It must not be printed.
It must not be persisted.
It must not be hashed.
It must not appear in errors.
It must not appear in logs.
It must not appear in JSON reports.
It must not appear in human summaries.
It must not be used as record_identity_key.
It must not be promoted to normalized_tax_id.
```

Any implementation must prove:

```text
join_key_values_printed  = false
join_key_values_retained = false
join_key_hashes_printed  = false
join_key_error_leak      = false
```

### 5.1 Why this section exists, and why it is the hardest part of the record

This is the first milestone in the series in which SellUp code would **hold an identifier-derived
value on purpose**. Every earlier guarantee was structural: 11C held synthetic cells, 11D-META held
manifest metadata, 11F split a row to count fields and discarded every field. A join has no such
form. It must read a value, keep it long enough to compare, and compare it. The controls therefore
shift from *"no value is ever held"* to *"the value that is held is unreportable by construction"* —
a materially weaker class of guarantee, and one that must be asserted rather than asserted-about.

Four consequences follow, all load-bearing:

- **`join_key_values_retained = false` refers to retention beyond the probe's own bounded in-memory
  window.** The claim is not that no value exists in memory — that would be false and the record will
  not pretend otherwise. The claim is that no join key value is written to a field, a report, a log, a
  file, a variable outliving the run, or a return value, and that the window is discarded before the
  aggregate is emitted.
- **Hashing is not an escape hatch.** The output sanitization record forbids any hash, truncation, or
  fingerprint derived from an identifier or from the join key (`OS-A13`). A probe may not "anonymize"
  a join key by hashing it; it may only decline to emit it. `hashingAllowed = false` in § 9 is the
  same rule expressed as a cap.
- **Errors are an output surface.** A mismatch, a parse failure, or an out-of-range index is exactly
  the moment when naive code interpolates the offending value into a message. `join_key_error_leak`
  is listed as a distinct proof obligation for that reason: error paths need the same sanitizer
  coverage as success paths, tested directly.
- **Promotion is forbidden at the type level, not the review level.** `record_identity_key` may be
  constructed only in a future approved import path (10N § 15); `normalized_tax_id` appears on no
  surface (`OS-A15`) independently of how its legal-survival question resolves. A join probe that
  produced either would not be a scoped exception — it would contradict two official records.

---

## 6. Options

### Option A — Keep real joins fully blocked

```text
Status: safest.
Effect: no real join is executed until GATE-1 and GATE-2 are approved.
```

The runner keeps refusing every trust level other than the four already recognized, and no successor
milestone parses a join key from a regulated file until both gates carry a signed approval.

- **Pro:** no identifier-derived value is ever held, so the § 5 guarantees stay structural rather than
  procedural — the strongest position available.
- **Pro:** it is not a dead end. 11F already de-risked open/decode/shape; Option A simply says the
  relational read waits for its proper owners.
- **Con:** the first post-approval milestone must validate join-key parsing, join mechanics **and**
  measure the dataset in one step, with no prior evidence the join path works on real input.
- **Risk if chosen:** low technical risk; schedule risk concentrated at the moment of gate approval.

### Option B — Synthetic-only join validation

```text
Status: safe but no new real data evidence.
Effect: join logic is validated only over synthetic files.
```

- **Pro:** it exercises the whole join path — parse, hold, compare, discard, sanitize — with zero
  regulated exposure, and it is the right way to build the tests either way.
- **Con, and it is decisive:** synthetic fixtures are written by the test suite, so they match the
  assumed layout by construction. They cannot answer whether the operator's real files agree with each
  other, which is the only open question.
- **Con:** it produces no new evidence about the dataset, and must not be reported as if it did.
- **Risk if chosen:** none, and that is also its limit. Option B is a **prerequisite** of Option C
  (§ 12), not an alternative to it — an owner choosing Option B alone is choosing Option A with extra
  tests.

### Option C — Ultra-bounded in-memory required-family join probe

```text
Status: recommended next option if owner accepts controlled exposure.
Effect: open only one Empresas file and one Estabelecimentos file under the existing 11F caps, parse
        only the protected technical join key ephemerally, execute an in-memory join probe, and emit
        aggregate-only output.
No identifiers, no join keys, no joined rows, no samples, no coverage percentage.
```

- **Pro:** it answers the exact remaining unknown — do the two required families relate at all on real
  input? — with the minimum possible exposure that can answer it.
- **Pro:** it reuses the 11F caps unchanged, so it opens no additional file, reads no additional byte,
  and adds no new file-selection surface. The only new capability is *what happens to a value between
  being parsed and being discarded*.
- **Pro:** its output is structurally incapable of describing a company or a relationship between two
  companies: buckets, booleans and a coarse match class, with the sanitizer refusing join keys,
  joined rows and pairs.
- **Con:** it retains an identifier-derived value, briefly and in memory, for the first time. Every
  GATE-1 concern (lawful basis, purpose limitation) and every GATE-2 concern (envelope, ceilings,
  retention, cleanup-on-failure) is engaged directly, even for two 20-row windows.
- **Con:** it may legitimately return "no information" (`not_reported`), because two bounded prefixes
  of independently sharded files need not overlap. Owners must accept that a green run can be
  uninformative and must not be re-run at wider caps to "get an answer".
- **Risk if chosen:** medium, and dominated by three controls — the caps being *required* rather than
  defaulted, the sanitizer refusing join keys and joined rows by static test, and the coverage
  prohibition being a refusal rather than a labelling rule.

### Option D — Ultra-bounded join probe with support catalogs

```text
Status: not recommended yet.
Effect: joins Empresas + Estabelecimentos and also opens support catalogs.
Requires separate catalog authorization.
```

- **Pro:** the catalog families are reference data — activity codes, municipality codes, legal
  natures — and carry the lowest privacy weight of anything in the dataset.
- **Con:** it opens five files instead of two, for information not on the critical path. Catalogs
  cannot make the required-family join succeed or fail; they only decorate its result.
- **Con:** it weakens the strongest available invariant (a small, fixed, family-bounded file count) at
  exactly the milestone that first holds a join key. Two risks should not be taken in one step.
- **Risk if chosen now:** medium-high relative to its marginal value.

### Option E — Bounded real join coverage dry-run

```text
Status: not recommended yet.
Effect: broader scan to estimate join coverage.
This is a later decision and must not be authorized by this record.
```

- **Pro:** the only option producing evidence of the kind the full join dry-run exists to gather.
- **Con:** coverage requires reading far beyond a bounded prefix — the caps that make Option C
  defensible are precisely what a coverage estimate must relax. It is a different question with a
  different risk profile and a different owner conversation.
- **Con:** it depends on GATE-2's storage/processing envelope in a way Option C does not: holding
  enough join keys to estimate a rate is a temp-storage question, not a probe question.
- **Risk if chosen now:** high, and unnecessary. Option C forecloses nothing here; it strictly reduces
  the untested surface a later coverage dry-run would run on. See § 15 — this belongs to
  BR-SOURCE-11H.

### 6.1 Option label continuity — read this before quoting any authorization phrase

The option labels in this record are **local to this record**. They are not the labels used in
BR-SOURCE-11C-R, BR-SOURCE-11D-META or BR-SOURCE-11F, and a phrase from one record authorizes nothing
in another.

| This record (11G) | Nearest equivalent elsewhere | State |
|---|---|---|
| Option A — keep real joins fully blocked | 11F Option A (adapted) | current state |
| Option B — synthetic-only join validation | (not enumerated elsewhere) | not sufficient alone; a prerequisite of C |
| **Option C — ultra-bounded in-memory required-family join probe** | narrower than **11F Option E** ("bounded real join dry-run"), narrower than BR-SOURCE-10G | **not authorized** — the subject of this record |
| Option D — join probe + support catalogs | close to 11F Option D, plus a join | not authorized |
| Option E — bounded real join coverage dry-run | closest to BR-SOURCE-10H | not authorized; deferred to BR-SOURCE-11H |

Load-bearing consequences:

- **The recommended phrases of 11F and 11G differ by two words.** 11F's spent phrase ends
  `REAL DATA-FILE PROBE`; this record's ends `REAL JOIN PROBE` (§ 12). They are different
  authorizations for different capabilities, and the 11F phrase — already spent, and single-milestone
  by its own § 7.1 — authorizes nothing here. A phrase that does not name the **join** probe
  explicitly authorizes nothing under this record.
- **11F's Option E was this record's subject, not this record's Option E.** 11F § 14 mapped its
  Option E to "BR-SOURCE-11G (separate record)". This record is that separate record, and it splits
  11F's Option E into a probe (Option C, recommended) and a coverage dry-run (Option E, deferred
  again, to 11H).
- **`stat` is still not authorized.** 11D-META § 4.3 excluded it, the merged reader contains no `stat`
  call, and this record does not reintroduce it.
- **ZIPs are still not authorized.** A byte cap on compressed input is not a cap on decompressed
  content. Only already-prepared operator files are in scope, under the § 9 ceilings.

### 6.2 Option comparison

| | A — blocked | B — synthetic | C — in-memory join probe | D — + catalogs | E — coverage |
|---|---|---|---|---|---|
| Opens a real data file | no | no | yes (the same 2 as 11F) | yes (≤ 5) | yes |
| Holds a join key value | no | synthetic only | **yes, ephemeral, in memory** | yes | yes, at volume |
| Files opened | 0 | 0 | ≤ 2 | ≤ 5 | ≥ 2 |
| Answers "do the required families relate on real input?" | no | no | **partially — or `not_reported`** | partially | yes |
| Emits a match rate / coverage | no | no | **no** | no | yes, by definition |
| Emits joined rows or pairs | no | no | **no** | no | no |
| New guard invariants needed | none | sanitizer tests | join-key leak class + join caps + coverage refusal | same, wider | + GATE-2 envelope |
| Recommended now | no | as a prerequisite | **yes, conditionally** | no | no |
| Milestone that would consume it | — | inside 11G-IMPL | BR-SOURCE-11G-IMPL | separate record | BR-SOURCE-11H |

---

## 7. Recommended decision

```text
Recommended decision for now: Option C — Ultra-bounded in-memory required-family join probe.
```

**With this warning, which is part of the recommendation and not a footnote to it:**

```text
Option C should only be implemented after explicit owner authorization.
It should not produce row samples.
It should not produce identifiers.
It should not produce join keys.
It should not produce joined row output.
It should not produce coverage percentage.
It should not claim GATE evidence.
```

Reason:

```text
11F proved the two required families are structurally parseable under caps.
The next technical risk is whether the minimum operational relationship between Empresas and
Estabelecimentos can be validated without leaking the protected join key.
Catalog files, broader coverage, import and runtime can wait.
```

Expanded, the recommendation rests on four points:

1. **It is the minimum that answers a real question.** Option A answers nothing new; Option B cannot
   answer this question at all, because synthetic fixtures agree with the layout by construction;
   D and E answer more than is needed next, at more exposure than is needed next.
2. **It spends the least gate authority any relational read can spend.** The same two files 11F
   already opened, the same ceilings, the same aggregate-only discipline — plus exactly one new
   capability, scoped by § 5 and asserted by § 12.
3. **It de-risks the eventual measurement milestone.** When GATE-1 and GATE-2 are approved, the
   parse-hold-compare-discard-sanitize path will already be written, capped and regression-tested. The
   remaining delta is volume, which is a GATE-2 conversation rather than a code one.
4. **Its failure mode is contained, conditionally.** The conditions are the § 9 caps being *required*
   of the caller, the § 5 join-key rules being enforced structurally, the coverage prohibition in § 10
   being a refusal rather than a labelling convention, and `not_reported` being an accepted outcome.
   Option C without those controls is not the option being recommended.

**Why not the others, in one line each.** Option A remains a legitimate owner answer and concentrates
risk at gate approval. Option B is necessary but not sufficient — it belongs inside the implementation
as its test strategy, not instead of it. Option D adds a second new risk (wider file surface) at the
milestone that first holds a join key. Option E is a different question about volume and belongs to
BR-SOURCE-11H, after this one is settled.

### 7.1 `not_reported` is a success, and must be reported as one

The single most likely outcome of two independently-sharded 20-row prefixes is **zero overlap**. That
is not a failure, not evidence that the dataset does not join, and not a reason to widen the caps.

The implementation must therefore treat `match_result_bucket = not_reported` as a first-class, green
result, and must state in its own report that a bounded prefix comparison is not evidence about the
dataset either way. A probe that reports "0 matches" without that framing invites exactly the
inference § 4 forbids.

---

## 8. Proposed scope for Option C

These boundaries apply to **Option C only**, and only if it is authorized after this record is
merged.

```text
Allowed:
- open one Empresas file under cap;
- open one Estabelecimentos file under cap;
- read at most the existing 11F caps;
- parse only the protected technical join key ephemerally;
- execute an in-memory join probe;
- discard raw rows immediately;
- discard raw cells immediately;
- discard join key values immediately after aggregate calculation;
- emit aggregate-only output;
- no row samples;
- no joined row samples;
- no identifiers;
- no company names;
- no establishment names;
- no filenames;
- no absolute paths;
- no hashes;
- no coverage percentage;
- no import;
- no Supabase;
- no runtime;
- no Agent 1.
```

```text
Forbidden:
- opening Cnaes;
- opening Municipios;
- opening Naturezas;
- opening Socios/QSA/CPF/person files;
- opening ZIPs;
- opening raw-zips;
- opening more than one file per family;
- opening more than two data files total;
- scanning full files;
- reading unbounded rows;
- printing raw rows;
- printing raw cells;
- printing CNPJ básico/root;
- printing full CNPJ;
- printing CPF;
- printing company name;
- printing fantasy name;
- printing address;
- printing email/phone/fax;
- printing join key values;
- printing joined row pairs;
- printing local paths;
- printing filenames if unsafe;
- computing hashes from identifiers or join keys;
- producing sample rows;
- producing joined samples;
- producing join coverage evidence;
- writing source_company_snapshots;
- import;
- Supabase writes;
- runtime;
- Agent 1.
```

### 8.1 Notes on the scope

- **The file surface is unchanged from 11F, deliberately.** One Empresas file and one Estabelecimentos
  file, singular, both belonging to an allowlisted family, two paths resolved per run. This record
  adds no file, no glob, no directory scan and no new family. The only delta is what happens to a
  parsed value inside the loop.
- **"Parse only the protected technical join key" means exactly one field position per row.** Not the
  whole row into a structure, not "the first few fields for context", not a second field "to
  disambiguate". Any field beyond the join-key position that survives its loop iteration has left
  Option C.
- **"Ephemerally" has an upper bound, and it is a cap.** The bounded window of join key values is
  itself capped (§ 9, `maxJoinKeyValuesInMemory`), is never written anywhere, and is discarded before
  the aggregate is returned. See § 5.1.
- **The join is a membership test, not a materialization.** The probe determines *whether* keys from
  one window appear in the other and counts how many, in buckets. It never builds a joined record, a
  pair list, a mapping, or an index that outlives the comparison — `maxJoinPairsEmitted = 0` and
  `maxJoinedRowsPrinted = 0` are structural, not thresholds.
- **The Sócios / QSA / CPF family stays denylisted end to end.** A manifest declaring such a file is a
  fail-closed refusal reported as an aggregate boolean or count — never a filename, never followed by
  a read. Unchanged from every prior record in the series.
- **ZIPs stay closed**, and catalog families stay counted-never-opened, exactly as 11F left them.
- **"No filenames"** resolves to: family labels are reportable, filenames are not.
- **The forbidden path families and directory labels are denylist labels, not locations.** They appear
  here so a static guard can refuse them. No real, absolute, or complete path is recorded in this
  document, and none may be recorded in code, tests, fixtures, or reports.
- **"No output inside repo"** carries over: the aggregate report is a return value, not a committed
  artifact, so no real content can be accidentally committed.
- **The authorization is single-milestone and expires with it.** It does not become a standing runner
  capability and cannot be inherited by a later milestone without its own phrase.

---

## 9. Proposed hard caps for Option C

The file/byte/row caps are the BR-SOURCE-11F caps, unchanged. The join caps are new.

```text
maxFilesOpened            <= 2
allowedFamilies           = empresas, estabelecimentos
maxBytesPerFile           <= 64_000
maxRowsPerFile            <= 20
maxTotalRows              <= 40
maxTotalBytes             <= 128_000
maxRuntimeSeconds         <= 30
maxJoinInputRows          <= 40
maxJoinKeyValuesInMemory  <= 40
maxJoinPairsEmitted       = 0
maxJoinedRowsPrinted      = 0
outputMode                = aggregate_only
samplesAllowed            = false
hashingAllowed            = false
coverageAllowed           = false
importAllowed             = false
```

Fail-closed conditions:

```text
fail if any cap is missing
fail if any cap exceeds maximum
fail if any forbidden family appears in execution scope
fail if more than one file per family is selected
fail if more than two data files are selected
fail if join key would be printed
fail if join key would be persisted
fail if join key would be hashed
fail if joined rows would be emitted
fail if output sanitizer detects raw cells, identifiers or join keys
fail if coverage percentage is requested
fail if output path is inside repo
fail if any import/runtime/Agent1/provider flag is requested
```

### 9.1 Notes on the caps

- **Caps must be stated by the caller, not defaulted.** 11C established the rule and 11D-META-IMPL and
  11F-IMPL enforced it: a cap nobody stated is a cap nobody agreed to. A missing cap is refused, never
  filled in.
- **Caps must be enforced *and* asserted.** Each cap needs at least one test driving input past it and
  asserting the refusal. A cap that exists only as a default is not a cap.
- **`maxJoinPairsEmitted = 0` and `maxJoinedRowsPrinted = 0` are equalities, not ceilings.** They are
  written as caps so a single guard shape covers them, but a value above zero is not a wider probe —
  it is a different, unauthorized capability.
- **`maxJoinKeyValuesInMemory` bounds the weakest guarantee in the record.** It is the cap that makes
  § 5's "ephemeral" statement checkable: the window cannot exceed the rows the run is allowed to read
  in the first place, and it must be released before the aggregate is emitted.
- **`coverageAllowed = false` is a refusal, not a labelling rule.** With bounded rows, any ratio is a
  statement about two prefixes. The rule is not "compute it and caveat it"; the rule is "do not
  compute it, and refuse if it is requested". See § 10.
- **`hashingAllowed = false` is not a formality.** No hash, truncation, or fingerprint derived from an
  identifier or from the join key may be produced. A probe may not "anonymize" a join key; it may only
  decline to emit it.
- **A cap breach is a refusal, not a truncation.** Reaching `maxBytesPerFile` mid-row means the row is
  dropped and the ceiling is reported; a cut row is a different row, not a smaller one.
- **`maxRuntimeSeconds` is a liveness cap, not a performance target.** It exists so a pathological
  input cannot turn a bounded probe into a long-running process holding regulated bytes and join keys
  in memory.
- **These numbers carry no implication for real-data ceilings generally.** GATE-2 owns the storage and
  processing envelope for real execution. These are probe ceilings, deliberately far below anything
  GATE-2 would need to define.

---

## 10. Output contract

The permitted output is aggregate-only:

```text
run_mode
manifest_trust
execution_authorization_flags
families_attempted
files_opened_count
files_opened_by_family
bytes_read_bucket
rows_read_bucket
row_shape_valid_count
row_shape_invalid_count
join_probe:
  join_executed             = true
  join_mode                 = ultra_bounded_required_family_in_memory
  join_key_values_printed   = false
  join_key_values_retained  = false
  join_key_hashes_printed   = false
  joined_rows_printed       = false
  joined_samples_printed    = false
  joined_pairs_emitted      = 0
  coverage_percentage_printed = false
  coverage_claimed          = false
  match_result_bucket       = zero | one_or_more | not_reported
  matched_rows_bucket       = zero | lte_20 | not_reported
  unmatched_rows_bucket     = zero | lte_20 | not_reported
raw_rows_printed        = false
raw_cells_printed       = false
identifiers_printed     = false
absolute_paths_printed  = false
filenames_printed       = false
hashes_printed          = false
decision_status         8/8 not_approved
run_scope               import/runtime/agent1/provider all false
errors                  aggregate only
```

Forbidden in output:

```text
raw row
raw cell
CNPJ básico/root
full CNPJ
CPF
company name
fantasy name
address
email
phone
file path
unsafe filename
line number tied to raw value
byte offset tied to raw value
hash/fingerprint
join key
joined row
join pair
sample
coverage percentage
coverage claim
```

### 10.1 Notes on the output contract

- **`join_executed = true` is the only assertion in the series that flips from `false`.** 11F reported
  `joins_executed = false`; an authorized Option C run reports the opposite, and that single boolean
  is the entire behavioural delta this record proposes. `join_coverage_computed` stays `false`
  regardless.
- **The match buckets are coarse on purpose.** `zero | one_or_more | not_reported` answers "did the
  mechanism find anything at all?" without emitting a count that could be divided into a rate.
  `matched_rows_bucket` and `unmatched_rows_bucket` are bounded by the row cap by construction, so
  `lte_20` is the widest truthful bucket either can carry.
- **`not_reported` is not an error state.** It is the correct value when the probe cannot make a
  meaningful statement — for example when the two windows are disjoint by shard, or when a cap was
  reached before comparison. § 7.1 requires it to be reported as green.
- **A coverage figure is forbidden even if it is arithmetically computable.** Two buckets and a row
  cap are enough for a reader to attempt a ratio; the contract's answer is that the probe emits no
  ratio, makes no coverage claim, and carries `coverage_claimed = false` explicitly so no downstream
  document can imply one.
- **`join_key_values_retained = false` is an output assertion about surfaces, not about RAM.** See
  § 5.1. It asserts that no join key value reached a field, report, log, file, or return value.
- **New sanitizer leak kinds are implied.** `raw_cell_payload` and `row_sample_payload` (11F-IMPL) do
  not cover a join key, a joined row, or a join pair. Option C would need `join_key_payload`,
  `joined_row_payload` and `join_pair_payload` (names indicative), each asserted by a test that feeds
  the sanitizer a would-be leak and asserts refusal — including from an error message.
- **`decision_status` and `run_scope` are inherited unchanged.** Eight gates `not_approved`, every
  scope flag `false`, errors carrying a fixed error code and stage only — never a raw message, a path,
  or a value.

---

## 11. Gate relationship

```text
Option C does not approve GATE-1.
Option C does not approve GATE-2.
Option C does not approve any gate.
Option C may produce only preliminary technical evidence for a future GATE discussion.
A successful Option C run cannot be cited as legal/privacy approval.
A successful Option C run cannot be cited as storage approval.
A successful Option C run cannot be cited as import readiness.
A successful Option C run cannot be cited as runtime readiness.
```

```text
GATE-1 remains required before broader personal/company data processing.
GATE-2 remains required before broader local data-file execution and temp storage.
GATE-3 remains required before field persistence.
GATE-4 remains required before identity grain persistence.
GATE-5 remains required before output evidence can be promoted.
GATE-6/7/8 remain required before operational runs.
```

### 11.1 Why an approved probe still approves nothing

A green Option C run would establish that a bounded set of join keys parsed from one capped window can
be compared against a bounded set from another capped window, inside ceilings, with nothing leaking
into the report. That is a statement about the **join mechanism** and the **read path**.

It is not a statement about lawful basis (GATE-1), about the storage envelope for real processing
(GATE-2), about which fields may survive (GATE-3), about identity grain (GATE-4), about promoted
evidence (GATE-5), or about operational readiness (GATE-6/7/8). The gate owners' authority is
untouched: a bounded probe is a narrow exception to a code-writing restriction, not a partial gate
approval, and it creates no precedent for one.

### 11.2 The three gates a join probe brushes against hardest

Stated explicitly so no reader has to infer them, and so that no implementer treats the probe as
having settled them:

- **GATE-3 (field allowlist)** decides which fields may *survive*. Option C survives nothing: it reads
  one field position and discards the value. It does not add the join key to any allowlist, and it
  does not argue for its persistence.
- **GATE-4 (identity grain)** decides what a record's identity is. Option C constructs no identity: no
  `record_identity_key`, no `normalized_tax_id`, no derived key of any kind. A membership test is not
  a grain decision.
- **GATE-5 (output sanitization)** decides what may be promoted as evidence. Option C promotes
  nothing: its output is buckets and booleans, and § 10 forbids the ratio a reader would want to
  promote.

---

## 12. Evidence required before implementation

```text
- this decision record merged;
- explicit owner phrase authorizing Option C;
- implementation plan with no-write/no-runtime guard;
- test plan with synthetic join files;
- static guard for max files/rows/bytes;
- static guard for no join key output;
- static guard for no hashes;
- output sanitizer coverage for raw row/cell values, identifiers and join keys;
- fail-closed tests for missing caps and forbidden families;
- fail-closed tests for coverage output attempts;
- proof no Supabase/runtime/Agent1/provider imports;
- proof no source_company_snapshots writes;
- proof no output committed;
- proof real run output is aggregate-only.
```

The recommended authorization phrase is:

```text
AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL JOIN PROBE
```

### 12.1 Notes on the evidence

- **All fourteen items are required.** Any one missing means the implementation stays blocked. A
  merged record without the phrase authorizes nothing; the phrase given before the record is official
  authorizes nothing either, because it refers to a record that must already be official.
- **The phrase is exact, single-scope, and non-transferable.** It authorizes this record's Option C
  only: not Option D, not Option E, not coverage, not a `stat`, not a catalog file, not a second
  milestone. See § 6.1 — it differs from the already-spent 11F phrase by two words, and that
  difference is the whole authorization.
- **"Test plan with synthetic join files" means the implementation's tests stay synthetic.** Headerless
  fixture pairs the test suite writes itself, with known-overlapping and known-disjoint key windows,
  exercised through the *real-file* code path to prove it joins and refuses correctly. Executing the
  operator's real files is a separate operator step whose report must carry no path, no filename, and
  no value. **This is Option B, absorbed as the test strategy of Option C.**
- **"Static guard for no join key output"** means a test that reads the module source and asserts the
  join key value never reaches a return value, a report field, a log call, a thrown message, or a
  template — the pattern 11D-META-IMPL and 11F-IMPL used to assert one `openSync` and no `statSync` /
  `readdirSync` / `readFileSync` / `createReadStream`.
- **"Fail-closed tests for coverage output attempts"** is a distinct class from the cap tests: a
  request for a percentage, a ratio, or a rate must be refused rather than served-and-labelled.
- **"Output sanitizer coverage … and join keys"** means the new leak kinds are exercised directly,
  alongside the existing refusals of a full CNPJ, a CNPJ básico, a CPF, an email, a phone, a LinkedIn
  URL, an identity key, a normalized tax id, an identifier hash, a filesystem-path-like string, a raw
  cell, a row sample, and an oversized numeric leaf — **including via the error path**, per § 5.1.
- **A test plan is not a test.** The plan is evidence for the authorization decision; the tests are
  written inside the implementation milestone, after authorization.
- **The implementation milestone and the execution step are separate.** Landing 11G-IMPL against
  synthetic fixtures does not authorize pointing it at the operator's real files; that is its own
  step, with its own report, under this record's § 8 and § 9.

---

## 13. What remains blocked

Regardless of any decision recorded here, and regardless of whether Option C is subsequently
authorized, every item below remains blocked:

```text
full dataset execution
opening all files
opening catalog files
opening Socios/QSA/CPF/person files
opening ZIPs directly
unbounded scan
row samples
raw cells
identifiers
join key output
join key hashes
joined row output
join pair output
coverage percentage
coverage evidence
source_company_snapshots writes
dataset import
Supabase writes
migrations
runtime
Agent 1
HubSpot/Slack/provider calls
production evidence claims
Brazil live prospect generation
```

### 13.1 Why this list survives an Option C authorization

Option C would change exactly one thing: whether a join key may be parsed, held inside a capped
in-memory window, compared, and discarded, with a coarse bucket reported. It changes nothing about
the rest of the dataset, about coverage, about persistence, about runtime, or about Agent 1 — because
none of those appears in the Option C loop at all.

Two consequences follow, and both are load-bearing:

1. **No Option C result is citable as evidence about the dataset.** A green run is evidence that a
   join mechanism works on real input under caps. It is not evidence about coverage, join rates,
   quality, eligibility, or either gate — and `not_reported` is not evidence of anything at all.
2. **The gate owners' authority is untouched.** GATE-1 and GATE-2 remain the sole route to dataset
   processing and import.

---

## 14. Flags

```text
OPS_BR_BOUNDED_REAL_JOIN_DRY_RUN_DECISION_RECORD_PR_READY  = false until PR
OPS_BR_BOUNDED_REAL_JOIN_DRY_RUN_DECISION_RECORD_OFFICIAL  = false until merge
OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_JOIN_PROBE_AUTHORIZED = false
OPS_BR_REAL_LOCAL_JOIN_DRY_RUN_AUTHORIZED                  = false

OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_PROBE_AUTHORIZED      = true
OPS_BR_REAL_LOCAL_DATA_FILE_DRY_RUN_AUTHORIZED             = true

FULL_JOIN_RUNNER_READY                                     = true
FULL_JOIN_EXECUTION_READY                                  = false
IMPORT_READY                                               = false
RUNTIME_READY                                              = false
AGENT1_READY                                               = false

OPS_BR_READY_FOR_IMPORT                                    = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT                         = false
OPS_BR_READY_FOR_RUNTIME                                   = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY                      = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED              = false
```

The two `true` values are inherited from BR-SOURCE-11F-IMPL and are **scoped to the 11F Option C
probe**: opening two required-family files to count columns. Neither is partial credit toward this
record's Option C, and neither authorizes a join. `FULL_JOIN_RUNNER_READY = true` reflects only that
the 11A scaffold merged and gained synthetic (11C), metadata-only (11D-META-IMPL, 11E) and
required-family-probe (11F-IMPL) plumbing; it says nothing about execution readiness.

`OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false` is worth reading literally: no headerless
real-file dry-run has passed, because none has been run, because none is authorized. A structural
probe of a bounded prefix is not the dry-run that flag names, and neither would a join probe be.

### 14.1 Gate status — UNCHANGED

```text
GATE-1 Legal/Privacy                = not_started / not approved
GATE-2 Temporary storage envelope   = not_started / not approved
GATE-3 Field allowlist              = not_started / not approved
GATE-4 Identity grain               = not_started / not approved
GATE-5 Output sanitization          = not_started / not approved
GATE-6 Failure cleanup              = not_started / not approved
GATE-7 Operator runbook             = not_started / not approved
GATE-8 No-write/no-runtime          = not_started / not approved
```

---

## 15. Next milestone mapping

```text
If Option C is explicitly authorized after this record is merged:
BR-SOURCE-11G-IMPL may implement the ultra-bounded required-family real join probe.

If support catalogs are desired:
a later explicit decision is required.

If join coverage is desired:
a later explicit BR-SOURCE-11H decision is required.

If import is desired:
a later explicit import-readiness process is required.

No real join execution is authorized by this record.
```

| Decision | Milestone | Requires |
|----------|-----------|----------|
| Option A | none | nothing — real joins stay blocked until GATE-1 and GATE-2 are approved |
| Option B | none standalone | absorbed as the test strategy of Option C (§ 12); not sufficient alone |
| Option C | BR-SOURCE-11G-IMPL (new) | this record merged **and** the § 12 owner phrase **and** the § 8 scope **and** the § 9 caps |
| Option D | separate record or explicit authorization | its own owner phrase, plus a widened family allowlist and file ceiling |
| Option E | BR-SOURCE-11H (new) | its own record, resolving the temp-storage envelope question with GATE-2 |
| Import | separate import-readiness process | GATE-1 … GATE-8 approved |

### 15.1 Ordering note

The mapping orders **review**, not approval. Option C landing does not advance Option D, and Option D
landing does not advance Option E. Each requires its own authorization, and none approves a gate. The
independent and always-available path — approving GATE-1 and GATE-2 on their own merits — remains the
shortest route to real execution and is unaffected by any option here.

---

## 16. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- write, modify, or delete any code, script, test, fixture, or package manifest;
- execute a join, construct a join key, hold a join key, compare join keys, or emit a joined row or
  join pair;
- compute, estimate, or report any coverage figure, ratio, or match rate;
- read, open, parse, `stat`, sample, or reference a real Receita data file;
- open a CSV, a ZIP, an extracted file set, or any file referenced by any manifest;
- read, open, parse, or reference a real manifest;
- read a row, count a column, observe an encoding, or classify a row shape from real input;
- download, unzip, or import a dataset;
- execute the runner in any mode;
- write to Supabase or perform any production write;
- create or modify a migration, or create/alter/validate an index;
- write to `source_company_snapshots`;
- read any environment variable or construct any client;
- change the parser, reader, dry-run, manifest validator, snapshot builder, join dry-run, or any
  connector runtime behavior;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- construct or print a `record_identity_key` or a `normalized_tax_id`;
- print a row, a cell, a full CNPJ, a CNPJ básico, a CPF, a name, an address, a contact, or a join
  key;
- emit a hash, truncation, or fingerprint derived from any identifier or join key;
- record any real, absolute, or complete filesystem path;
- use MCP, admin bypass, or self-approval;
- activate Brazil, approve any gate, or mark Brazil ready for import, runtime, or Agent 1;
- edit `MEMORY.md`;
- merge.

Every cap value, enum member, field name, flag value, family label, and directory label shown above is
a schema name, a class label, a threshold, a zero, a `false`, a denylist label, or an explicit
placeholder — never a real value and never a real location. The column counts quoted in § 2.2 are
official layout constants for the Receita file format, not observations about any company. No secrets,
no data dumps, no real CNPJs, no CNPJ básico values, no CPFs, and no partner (sócio) personal data are
reproduced. Local WIP (`scratchpad/`) and the unrelated in-progress work on the main worktree are
untouched by any git operation: this milestone was prepared in an isolated worktree branched from
`origin/main`.
