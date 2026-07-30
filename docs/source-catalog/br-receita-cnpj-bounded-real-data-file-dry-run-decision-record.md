# BR-SOURCE-11F — Bounded real data-file dry-run decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11F — Bounded real data-file dry-run decision record (docs-only)
**Status:** `option_c_authorized_and_implemented` (BR-SOURCE-11F-IMPL) — **not** a gate approval. Option C, and only Option C, was authorized by the owner after this record was merged; every other option in § 5 remains unauthorized
**Predecessor:** BR-SOURCE-11E-LAND — `BRSOURCE11ELANDA — REAL_MANIFEST_METADATA_ONLY_EXECUTION_MERGED` (PR #170, `main` HEAD `0c58a84deff9a23fd221f69f0df9a07298c0d427`)
**Last reviewed:** 2026-07-30

**Related documents:**
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

> **BR-SOURCE-11F-IMPL update (2026-07-30).** This record was merged as PR #172 and the owner then
> authorized exactly one option from § 5:
>
> ```text
> AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL DATA-FILE PROBE
> ```
>
> BR-SOURCE-11F-IMPL implements and executes that authorization, and nothing else:
>
> - It authorizes only an ultra-bounded required-family probe over **Empresas** and
>   **Estabelecimentos** — one file each, at most two data files per run, under the § 8 caps.
> - It does **not** authorize catalog files (`simples`, `cnaes`, `municipios`, `naturezas`): declared
>   catalog families are counted and never opened.
> - It does **not** authorize Sócios / QSA / CPF / person files: a declaration is a fail-closed
>   refusal reported as a count, never a filename, and never followed by a read.
> - It does **not** authorize joins, join keys, or coverage figures.
> - It does **not** authorize row samples.
> - It does **not** authorize identifiers, names, addresses, contacts, filenames, paths, byte offsets,
>   line numbers tied to values, or hashes in output.
> - It does **not** approve any gate. All eight remain `not_approved`.
> - It does **not** authorize import, dataset download, unzipping, or full-dataset processing.
> - It does **not** authorize Supabase writes, migrations, index changes, or
>   `source_company_snapshots` writes.
> - It does **not** authorize runtime, Agent 1, providers, HubSpot, Slack, or UI changes.
> - The authorization is single-milestone and expires with it: it does not become a standing runner
>   capability and cannot be inherited by a later milestone without its own phrase (§ 7.1).
>
> What the probe actually established, stated at its real strength: the two required-family files an
> operator-prepared manifest declares can be **opened and parsed structurally** under caps. That is a
> statement about file structure. It is **not** evidence about coverage, join rates, eligibility,
> GATE-1, or GATE-2, and it must not be cited as such.
>
> Everything below is the original decision record as merged, preserved unchanged apart from this
> update note, the § 1 status line, and the § 13 flag block.

---

> This document **asks one question and answers nothing**. BR-SOURCE-11E executed a real
> operator-prepared manifest **as metadata**, and in doing so exhausted everything that can be learned
> without opening a regulated file. The only remaining step that is smaller than "process the dataset"
> is a bounded probe that opens real data files under hard caps. Whether such a probe may be
> authorized at all is the entire subject of this record.
>
> Nothing here authorizes — and nothing here should be read as authorizing — opening a real Receita
> data file, `stat`-ing one, reading a row, sampling a cell, computing a join, computing coverage, a
> dataset download, full-dataset processing, import, a Supabase write, a production write, a
> migration, an index change, a runtime change, an adapter/validator change, an Agent 1 integration,
> a provider call, a HubSpot sync, a Slack notification, live generation, full expansion, or merge to
> an operational state. **This document records a decision question; it decides nothing and executes
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
This record does not authorize bounded real data-file execution.
This record does not authorize full dataset execution.
This record does not authorize import.
This record does not authorize Supabase writes.
This record does not authorize runtime.
This record does not authorize Agent 1.
```

Three clarifications, restated because every milestone in this series has shown how easily they are
conflated:

- **A merged decision record is not an authorization.** Merging this record makes the *question*
  official. The answer is a separate, exactly-worded owner phrase (§ 11), given after this record is
  official, and it would authorize only the option it names.
- **A mechanism existing in code is not an approval.** BR-SOURCE-11A landed the no-write/no-runtime
  guard, the output sanitizer and the failure-cleanup model; 11C added a `filesystem_path_like` leak
  kind; 11D-META-IMPL added `raw_manifest_payload` and `declared_filename_payload`. Those are the
  *mechanisms* of GATE-8, GATE-5 and GATE-6. All eight gates remain `not_started` / not approved.
- **A well-formed manifest is not a readable dataset.** 11E proved a control document is well-formed.
  It proved nothing about the files that document points at.

---

## 2. Background

```text
BR-SOURCE-11A created the no-write/no-runtime runner scaffold.
BR-SOURCE-11B validated synthetic_fixture_only.
BR-SOURCE-11C implemented synthetic temp-manifest.
BR-SOURCE-11D-META defined and implemented real manifest metadata-only.
BR-SOURCE-11E executed real manifest metadata-only against one operator-prepared manifest document.
11E proved only manifest structure, not data-file content.
The next possible step is a decision on whether to open real data files under hard caps.
```

### 2.1 The sequence, and what each step actually established

| Milestone | Verdict | What it established | What it did **not** establish |
|-----------|---------|---------------------|-------------------------------|
| BR-SOURCE-11A-LAND | `BRSOURCE11ALANDA` | The full join dry-run runner scaffold merged, with `local_manifest_dry_run` declared and always refusing. | Nothing about real input; the runner performed no filesystem read at all. |
| BR-SOURCE-11B | `BRSOURCE11BA` | Post-merge validation that the scaffold behaves as declared in `synthetic_fixture_only`. | Nothing about manifests, files, or the dataset. |
| BR-SOURCE-11C-R | merged, official | The local-manifest carve-out question and its options. | No gate, no authorization. A merged question is still a question. |
| BR-SOURCE-11C-LAND | `BRSOURCE11CLANDA` | Manifest-reading plumbing — parse, cap, sanitize, clean up — against synthetic temp manifests only. | Anything about the real dataset. Every count described cells the generator wrote moments earlier. |
| BR-SOURCE-11C-V | `BRSOURCE11CVA` | Post-merge validation of that carve-out. | Same limitation, restated. |
| BR-SOURCE-11D-META | merged, official, then authorized | The real-manifest metadata-only question, its boundaries (§ 4, § 7), caps (§ 8) and blocked list (§ 10). | No gate. Explicitly not permission to open any referenced file. |
| BR-SOURCE-11D-META-IMPL | merged | A metadata-only reader that resolves **exactly one** path, asserted structurally, by static test, and by instrumented observation. | Any real execution: it ran against synthetic metadata manifests only. |
| BR-SOURCE-11E-LAND | `BRSOURCE11ELANDA` | One **operator-prepared manifest document** executed metadata-only: well-formed, headerless layout stated, both required families declared, no Sócios / QSA / CPF family declared. | Anything about file content, rows, coverage, quality, join rates, eligibility, or either gate. |

### 2.2 What 11E did and did not prove, stated precisely

```text
11E prueba que el manifest preparado está bien formado.
11E NO prueba contenido de archivos.
11E NO prueba cobertura.
11E NO prueba calidad de datos.
11E NO prueba join real.
11E NO aprueba GATE-1 ni GATE-2.
```

The 11E evidence, as recorded:

```text
the operator's own prepared manifest DOCUMENT was read only as metadata
layout_mode                     official_headerless
declared_file_count             5
required_families_present        true
forbidden_families_present       false
referenced_data_files_opened     false
referenced_data_files_statted    false
0 rows, 0 joins, 0 import, 0 Supabase, 0 runtime, 0 Agent 1
8/8 gates not_approved
```

Every one of those values is a boolean, a count, or a class label about a **control document**. None
of them is a statement about a Receita data file.

### 2.3 What has structurally *not* happened yet

```text
No real Receita data file has been opened by any SellUp code path.
No file referenced by any manifest has been opened or stat-ed.
No dataset has been downloaded by SellUp automation.
No row of Receita data has been read, parsed, counted, or hashed.
No column has been counted from a real file.
No encoding or delimiter has been observed on a real file.
No join has been computed over real data.
No coverage figure about the real dataset exists.
```

That list is the boundary this record does **not** move. It asks whether a future, separately
authorized milestone may move the first, fifth and sixth lines of it — and only those — under caps.

---

## 3. Decision question

```text
Can SellUp authorize a bounded real data-file dry-run that opens only the minimum required Receita
CNPJ files under hard caps, reads only a tiny bounded number of rows or bytes, produces
aggregate-only sanitized output, performs no import, writes nothing, connects no runtime, and
approves no gate?
```

### 3.1 What the question is deliberately **not** asking

- It is not asking whether Brazil may be imported. That is `OPS_BR_READY_FOR_IMPORT`, unchanged and
  `false`.
- It is not asking whether the real dataset may be processed. That is `FULL_JOIN_EXECUTION_READY`,
  unchanged and `false`.
- It is not asking whether a **join** may be executed over real rows. That is a separate question
  (§ 5, Option E) and belongs to a later record.
- It is not asking whether **catalog** families may be opened. That is Option D, and it is broader
  than the recommendation.
- It is not asking the owners to approve GATE-1 or GATE-2 quickly, informally, or by implication. A
  bounded probe is **not** a gate approval; it is a bounded exception whose boundaries the owners set,
  and it leaves every gate `not_started`.
- It is not asking for standing permission. Any authorization granted under this record is scoped to
  the single next milestone that consumes it, and expires with that milestone.

### 3.2 Why the question arises now

1. **11E exhausted the metadata-only surface.** Reading the manifest again produces the same five
   booleans. There is no further declarative signal available without touching a data file.
2. **The remaining unknowns are all content-shaped.** Whether the operator's files are readable at
   all, whether they are truly headerless, what delimiter they use, whether their encoding is what the
   BR-SOURCE-10C headerless work assumed, and how many columns each row carries — none of that is
   knowable from a manifest, and all of it is a prerequisite for any later measurement.
3. **Counter-reason, stated plainly.** Receita `empresas` and `estabelecimentos` files are
   **headerless**. There is no "header line" that can be read as structure-without-data: the first
   line of the file is a data row about a real company. A probe that opens these files reads regulated
   content from its very first byte, regardless of how the output is aggregated. An owner may
   reasonably decide that no volume of caps and sanitization makes that acceptable before GATE-1 and
   GATE-2 are approved on their own merits, and choose Option A. **That is a legitimate answer to this
   question**, and this record does not treat it as a delay.

---

## 4. Non-goals

```text
This is not import readiness.
This is not production readiness.
This is not live prospect generation.
This is not Agent 1 integration.
This is not Supabase staging.
This is not HubSpot enrichment.
This is not a quality/country/business-fit validation.
This is not legal approval.
This is not GATE approval.
```

Two further non-goals, because the series has seen both misread before:

- **It is not a coverage measurement.** A bounded probe reads a bounded prefix of a bounded number of
  files. Nothing it observes generalizes to the dataset, and no figure it produces may be presented as
  coverage, as a join rate, or as eligibility.
- **It is not the full join dry-run.** The full join dry-run designed in BR-SOURCE-10J measures the
  whole dataset. This probe would establish only that the minimum files can be opened and shape-parsed
  safely under caps.

---

## 5. Options

### Option A — Keep all real data-file execution blocked

```text
Status: safest.
Effect: no CSV/ZIP real is opened until GATE-1 and GATE-2 are formally approved.
```

The runner keeps refusing every declared trust level other than the three already authorized
(`synthetic_fixture_only`, `synthetic_temp_manifest_only`, `real_manifest_metadata_only`). No
successor milestone touches a regulated file until both gates carry a signed approval.

- **Pro:** no regulated byte is read, so nothing has to be bounded, sanitized, or defended.
- **Pro:** it is not a dead end. 11C proved the plumbing and 11E proved the operator's preparation;
  Option A simply says the regulated read waits for its proper owners.
- **Con:** the first post-approval milestone must validate file readability, shape, encoding **and**
  measure the dataset in one step, with no prior evidence that the read path works on real input.
- **Risk if chosen:** low technical risk; schedule risk concentrated at the moment of gate approval.

### Option B — Header-only / first-line structural probe

```text
Status: safer but limited.
Effect: open selected files only to verify encoding/line shape/headerless behavior, without row
        parsing.
Risk: even first lines may contain real data because files are headerless.
```

- **Pro:** the smallest possible read: a bounded prefix, no field splitting, no per-row loop.
- **Con, and it is decisive:** these files are **headerless** by design (`official_headerless`). The
  "header line" this option would inspect **is a data row about a real company**. Option B is
  therefore not a privacy-lighter version of Option C; it is Option C with less useful output and the
  same exposure class.
- **Con:** without column counting it cannot answer the one question that matters for the later
  design — whether row shape matches the assumed layout.
- **Risk if chosen:** the same exposure as Option C for strictly less information.

### Option C — Ultra-bounded required-family row probe

```text
Status: recommended only if owner accepts controlled exposure.
Effect: open only Empresas and Estabelecimentos under hard caps, read a tiny number of rows/bytes,
        emit aggregate-only output.
No join output, no identifiers, no samples.
```

- **Pro:** it answers the exact remaining unknowns — openable, decodable, delimited as assumed,
  headerless as declared, and shaped with the expected column count — with the minimum possible
  exposure that can answer them.
- **Pro:** its output is structurally incapable of describing a company: counts, buckets, booleans and
  a column-count distribution, with the sanitizer refusing raw rows and cells.
- **Con:** it reads regulated rows. Every GATE-1 concern (lawful basis, purpose limitation) and every
  GATE-2 concern (envelope, ceilings, retention, cleanup-on-failure) is engaged directly, even if only
  for a few dozen rows.
- **Con:** it produces **no** coverage, quality or join evidence, and must say so in its own report.
- **Risk if chosen:** medium, and dominated by two controls — the caps being *required* rather than
  defaulted, and the sanitizer refusing every raw value on the new path.

### Option D — Ultra-bounded required-family + catalog probe

```text
Status: higher scope.
Effect: open Empresas, Estabelecimentos plus Cnaes/Municipios/Naturezas under hard caps.
Still aggregate-only, but broader exposure.
```

- **Pro:** the catalog families are reference data — activity codes, municipality codes, legal
  natures — and carry the lowest privacy weight of anything in the dataset.
- **Con:** it opens five files instead of two, for information that is not on the critical path. The
  catalogs are not needed to answer "can the required families be read and shape-parsed?".
- **Con:** it triples the number of paths a probe legitimately resolves, weakening the strongest
  available invariant (a small, fixed, family-bounded file count).
- **Risk if chosen now:** medium-high relative to its marginal value.

### Option E — Bounded real join dry-run

```text
Status: not recommended yet.
Effect: execute a tiny company-establishment join over real rows under caps.
This should require a later explicit decision record, not this one.
```

- **Pro:** the only option that produces evidence of the kind the full join dry-run exists to gather.
- **Con:** a join requires constructing and comparing **join keys** derived from company identifiers.
  BR-SOURCE-10N and the output sanitization record forbid constructing a `record_identity_key` or a
  `normalized_tax_id` at all outside a future approved import path, and forbid emitting any hash or
  derivation of an identifier. A join probe collides with that directly and needs its own analysis.
- **Con:** it depends simultaneously on GATE-3 (field allowlist), GATE-4 (identity grain), GATE-5
  (output sanitization) and GATE-6 (failure cleanup), plus GATE-7's operator runbook.
- **Risk if chosen now:** high, and unnecessary. Option C forecloses nothing here; it strictly reduces
  the untested surface that a later join probe would run on.

### 5.1 Option label continuity — read this before quoting any authorization phrase

The option labels in this record are **local to this record**. They are not the labels used in
BR-SOURCE-11C-R or BR-SOURCE-11D-META, and a phrase from one record authorizes nothing in another.

| This record (11F) | Nearest equivalent elsewhere | State |
|---|---|---|
| Option A — keep all real data-file execution blocked | 11D-META Option A (adapted) | current state |
| Option B — header-only / first-line probe | (not enumerated elsewhere) | not authorized; not recommended |
| **Option C — ultra-bounded required-family row probe** | narrower than **11D-META Option D** ("bounded real data-file dry-run") and narrower than 11C-R Option D | **not authorized** — the subject of this record |
| Option D — required-family + catalog probe | (not enumerated elsewhere) | not authorized |
| Option E — bounded real join dry-run | closest to 11D-META Option D taken to completion | not authorized; deferred to a later record |

Load-bearing consequences:

- **11D-META's Option C** was "real manifest metadata + file `stat`". **This record's Option C** is an
  ultra-bounded row probe. They are unrelated, and the labels collide only because each record
  enumerates its own options from `A`.
- The already-spent phrases `AUTHORIZE OPTION B — SYNTHETIC TEMP-MANIFEST CARVE-OUT ONLY` and
  `AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT` authorize nothing in this record. Nor
  does the 11E execution authorization, which relaxed only **which manifest document may be named**.
- A phrase that does not name the ultra-bounded required-family real data-file probe explicitly
  authorizes nothing here. The exact recommended wording is in § 11.
- **`stat` is still not authorized.** 11D-META § 4.3 excluded it, the merged reader contains no
  `stat` call, and this record does not reintroduce it. A probe that opens a file it is authorized to
  open does not thereby gain permission to `stat` the files it is not.

### 5.2 Option comparison

| | A — blocked | B — first-line | C — required-family rows | D — + catalogs | E — bounded join |
|---|---|---|---|---|---|
| Opens a real data file | no | yes | yes | yes | yes |
| Reads regulated rows | no | yes (headerless ⇒ unavoidable) | yes, capped | yes, capped | yes, capped |
| Files opened | 0 | ≤ 2 | ≤ 2 | ≤ 5 | ≥ 2 |
| Answers "is row shape as assumed?" | no | no | **yes** | yes | yes |
| Constructs join keys | no | no | **no** | no | **yes** |
| Produces coverage evidence | no | no | **no** | no | partial, and not citable |
| New guard invariants needed | none | caps + sanitizer | caps + sanitizer + family allowlist | same, wider | + GATE-3/4/5 items |
| Recommended now | no | no | **yes, conditionally** | no | no |
| Milestone that would consume it | — | — | BR-SOURCE-11F-IMPL | separate record | BR-SOURCE-11G (separate) |

---

## 6. Recommended decision

```text
Recommended decision for now: Option C — Ultra-bounded required-family row probe.
```

**With this warning, which is part of the recommendation and not a footnote to it:**

```text
Option C should only be implemented after explicit owner authorization.
It should not produce row samples.
It should not produce identifiers.
It should not produce names.
It should not produce join results.
It should not claim GATE evidence.
```

Reason:

```text
Empresas and Estabelecimentos are the minimum required families for the operational join model.
The first real risk to validate is whether these files can be opened and parsed safely under hard
caps.
Catalog files can wait.
Join execution can wait.
Import can wait.
```

Expanded, the recommendation rests on four points:

1. **It is the minimum that answers a real question.** Option A answers nothing; Option B answers
   less than C at the same exposure; D and E answer more than is needed next.
2. **It spends the least gate authority that any real read can spend.** Two files, a few dozen rows,
   aggregate-only output, no join key constructed. Every gate stays `not_started`, and the owners'
   authority over dataset processing is undiminished.
3. **It makes the eventual measurement milestone smaller.** When GATE-1 and GATE-2 are approved, the
   open-read-decode-shape path will already be written, capped, sanitized and regression-tested. The
   remaining delta is the measurement itself.
4. **Its failure mode is contained, conditionally.** The conditions are the § 8 caps being *required*
   of the caller, the § 7 family allowlist being enforced structurally, and the § 9 sanitizer refusing
   raw rows and cells by static test. Option C without those controls is not the option being
   recommended.

**Why not the others, in one line each.** Option A remains a legitimate owner answer and concentrates
risk at gate approval. Option B pays Option C's privacy cost for less information, because headerless
files have no non-data first line. Option D widens exposure for information that is not on the
critical path. Option E needs its own record because a join key is a construction the sanitization and
identity-grain records currently forbid outright.

### 6.1 `required_family_count = 2` — what it means and does not mean

```text
required_family_count = 2 refers only to the minimum operational required families for the join
probe: empresas and estabelecimentos.
The manifest may declare 5 files/families, but cnaes, municipios and naturezas are support catalogs,
not required for the first required-family probe.
```

This matters because 11E reported `declared_file_count 5` and `required_family_count 2` in the same
block, and the two numbers answer different questions. Five is what the operator's manifest
*declares*. Two is what the join model *requires*. Option C is scoped to the two, and a probe that
opened five would be Option D under a different name.

---

## 7. Proposed scope for Option C

These boundaries apply to **Option C only**, and only if it is authorized after this record is
merged.

```text
Allowed:
- open Empresas file under cap;
- open Estabelecimentos file under cap;
- read at most a tiny bounded number of bytes/rows;
- parse only enough structure to count columns and classify row shape;
- emit aggregate counts only;
- no row samples;
- no raw cells;
- no identifiers;
- no names;
- no filenames;
- no absolute paths;
- no hashes;
- no joins;
- no import;
- no Supabase;
- no runtime;
- no Agent 1.
```

```text
Forbidden:
- opening Socios/QSA/CPF/person files;
- opening all Estabelecimentos shards;
- opening all Empresas shards;
- opening ZIPs;
- opening raw-zips directly;
- scanning full files;
- reading unbounded rows;
- printing raw rows;
- printing raw cells;
- printing CNPJ básico/root;
- printing full CNPJ;
- printing CPF;
- printing razão social;
- printing nome fantasia;
- printing address;
- printing email/phone/fax;
- printing local paths;
- printing filenames if unsafe;
- computing hashes from identifiers;
- producing sample rows;
- executing join coverage;
- writing source_company_snapshots;
- import;
- Supabase writes;
- runtime;
- Agent 1.
```

### 7.1 Notes on the scope

- **"Open Empresas file" and "open Estabelecimentos file" mean one file each, singular.** Not a shard
  set, not a glob, not a directory scan. Two paths resolved per run, both belonging to an allowlisted
  family, is the invariant — the successor to 11D-META's "exactly one path", and it must be asserted
  by a static test rather than observed at review time.
- **"Parse only enough structure to count columns"** means the row is split to *count* fields and then
  discarded. No field value is retained, compared, normalized, stored in a variable that outlives the
  loop iteration, or passed to any function other than a counter. A probe that keeps a value "just to
  validate it" has left Option C.
- **The Sócios / QSA / CPF family stays denylisted end to end.** A manifest that declares such a file
  is a fail-closed refusal reported as an aggregate boolean or count — never a filename, and never
  followed by a read. This is unchanged from every prior record in the series.
- **ZIPs stay closed.** A ZIP is an unbounded read behind a bounded-looking call: caps expressed in
  bytes of compressed input are not caps on the decompressed content. Only already-extracted,
  operator-prepared files could be in scope, and only under the § 8 byte ceilings.
- **"No filenames"** resolves to: family labels are reportable, filenames are not. A family label
  (`empresas`, `estabelecimentos`) is a class label. A filename is operator-environment information.
- **The forbidden path families and directory labels are denylist labels, not locations.** They appear
  here so a static guard can refuse them. No real, absolute, or complete path is recorded in this
  document, and none may be recorded in code, tests, fixtures, or reports.
- **"No output inside repo"** carries over from 11D-META § 7.1: the aggregate report is a return
  value, not a committed artifact, so no real content can be accidentally committed.
- **The authorization is single-milestone and expires with it.** It does not become a standing runner
  capability and cannot be inherited by a later milestone without its own phrase.

---

## 8. Proposed hard caps for Option C

```text
maxFilesOpened     <= 2
allowedFamilies    = empresas, estabelecimentos
maxBytesPerFile    <= 64_000
maxRowsPerFile     <= 20
maxTotalRows       <= 40
maxTotalBytes      <= 128_000
maxRuntimeSeconds  <= 30
outputMode         = aggregate_only
samplesAllowed     = false
hashingAllowed     = false
joinAllowed        = false
importAllowed      = false
```

Fail-closed conditions:

```text
fail if any cap is missing
fail if any cap exceeds maximum
fail if any forbidden family appears in execution scope
fail if output sanitizer detects raw cells or identifiers
fail if more than one file per family is selected
fail if output path is inside repo
fail if row parsing tries to preserve values
fail if any join attempt is requested
```

### 8.1 Notes on the caps

- **Caps must be stated by the caller, not defaulted.** 11C established the rule and 11D-META-IMPL
  enforced it: a cap nobody stated is a cap nobody agreed to. A missing cap is refused, never filled
  in.
- **Caps must be enforced *and* asserted.** Each cap needs at least one test that drives input past it
  and asserts the refusal. A cap that exists only as a default is not a cap.
- **A cap breach is a refusal, not a truncation.** Reaching `maxBytesPerFile` mid-row means the run
  stops and reports the ceiling was hit; it does not parse a partial row and count it as valid.
- **Two ceilings per axis, deliberately.** Per-file caps bound one file; total caps bound the run. A
  probe that respects per-file caps twice must still respect the totals.
- **`maxRuntimeSeconds` is a liveness cap, not a performance target.** It exists so a pathological
  input cannot turn a bounded probe into a long-running process holding regulated bytes in memory.
- **`hashingAllowed = false` is not a formality.** The output sanitization record forbids any hash,
  truncation, or fingerprint derived from an identifier. A probe may not "anonymize" a value by
  hashing it; it may only decline to look at it.
- **These numbers carry no implication for real-data ceilings generally.** GATE-2 owns the storage and
  processing envelope for real execution. These caps are a probe ceiling, deliberately far below
  anything GATE-2 would need to define.

---

## 9. Output contract

The permitted output is aggregate-only:

```text
run_mode
manifest_trust
execution_authorization_flags
families_attempted
files_opened_count
bytes_read_bucket
rows_read_bucket
column_count_distribution
row_shape_valid_count
row_shape_invalid_count
encoding_status
delimiter_status
headerless_status
forbidden_family_attempted        boolean/count
referenced_data_files_opened      boolean/count
referenced_data_files_statted     boolean/count if applicable
raw_rows_printed        = false
raw_cells_printed       = false
identifiers_printed     = false
absolute_paths_printed  = false
hashes_printed          = false
decision_status         8/8 not_approved
run_scope               all false
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
sample
join pair
coverage percentage presented as evidence
```

### 9.1 Notes on the output contract

- **`column_count_distribution` is a histogram, not a list of rows.** "N rows had K columns" is a
  shape statement. "Row 7 had 30 columns" is a pointer into regulated content and is forbidden by the
  "line number tied to raw value" rule.
- **`bytes_read_bucket` and `rows_read_bucket` are buckets on purpose.** A bucket answers "did the
  probe stay inside its ceiling?" without emitting a volume figure that could be read as a dataset
  measurement.
- **`encoding_status`, `delimiter_status` and `headerless_status` are class labels or enums** — for
  example "matches declared" / "differs from declared" / "undetermined". They are never the offending
  bytes, and never a snippet.
- **Two new sanitizer leak kinds are implied.** `raw_manifest_payload` and
  `declared_filename_payload` (11D-META-IMPL) do not cover a row or a cell. Option C would need
  `raw_row_payload` and `raw_cell_payload` (names indicative), each asserted by a test that feeds the
  sanitizer a would-be leak and asserts refusal.
- **`decision_status` and `run_scope` are inherited unchanged.** Eight gates `not_approved`, every
  scope flag `false`, `safety` flags `false`, errors carrying a fixed error code and stage only —
  never a raw message, a path, or a value.
- **A coverage figure is forbidden even if it is arithmetically computable.** With bounded rows, any
  ratio is a statement about a prefix, not the dataset. The rule is not "label it carefully"; the rule
  is "do not emit it".

---

## 10. Gate relationship

```text
Option C does not approve GATE-1.
Option C does not approve GATE-2.
Option C may produce only preliminary technical evidence for a future GATE discussion.
A successful Option C run cannot be cited as legal/privacy approval.
A successful Option C run cannot be cited as storage approval.
A successful Option C run cannot be cited as import readiness.
```

```text
GATE-1 remains required before broader personal/company data processing.
GATE-2 remains required before broader local data-file execution and temp storage.
GATE-3 remains required before field persistence.
GATE-4 remains required before identity grain persistence.
GATE-5 remains required before output evidence can be promoted.
GATE-6/7/8 remain required before operational runs.
```

### 10.1 Why an approved probe still approves nothing

A green Option C run would establish that two operator-prepared files can be opened, decoded, and
shape-parsed inside ceilings, with nothing leaking into the report. That is a statement about the
**read path** and the **file shape**.

It is not a statement about lawful basis (GATE-1), about the storage envelope for real processing
(GATE-2), about which fields may survive (GATE-3), about identity grain (GATE-4), about promoted
evidence (GATE-5), or about operational readiness (GATE-6/7/8). The gate owners' authority is
untouched: a bounded probe is a narrow exception to a code-writing restriction, not a partial gate
approval, and it creates no precedent for one.

---

## 11. Evidence required before implementation

```text
- this decision record merged;
- explicit owner phrase authorizing Option C;
- implementation plan with no-write/no-runtime guard;
- test plan with synthetic files;
- static guard for max files/rows/bytes;
- output sanitizer coverage for raw row/cell values;
- fail-closed tests for missing caps and forbidden families;
- proof no Supabase/runtime/Agent1/provider imports;
- proof no source_company_snapshots writes;
- proof no output committed;
- proof real run output is aggregate-only.
```

The recommended authorization phrase is:

```text
AUTHORIZE OPTION C — ULTRA-BOUNDED REQUIRED-FAMILY REAL DATA-FILE PROBE
```

### 11.1 Notes on the evidence

- **All eleven items are required.** Any one missing means the implementation stays blocked. A merged
  record without the phrase authorizes nothing; the phrase given before the record is official
  authorizes nothing either, because it refers to a record that must already be official.
- **The phrase is exact, single-scope, and non-transferable.** It authorizes this record's Option C
  only: not Option D, not Option E, not a `stat`, not a join, not a second milestone. See § 5.1 — it
  is also not interchangeable with any phrase already spent in 11C, 11D-META, or 11E.
- **"Test plan with synthetic files" means the implementation's tests stay synthetic.** Headerless
  fixtures the test suite writes itself, exercised through the *real-file* code path to prove it works
  and refuses correctly. Executing the operator's real files is a separate operator step whose report
  must carry no path, no filename, and no value.
- **"Static guard for max files/rows/bytes"** means the family allowlist, the two-file ceiling, and
  the absence of any unbounded read primitive are asserted by a test that reads the module source —
  the pattern 11D-META-IMPL used to assert one `openSync` and no `statSync` / `readdirSync` /
  `readFileSync` / `createReadStream`.
- **"Output sanitizer coverage for raw row/cell values"** means the new leak kinds are exercised
  directly, alongside the existing refusals of a full CNPJ, a CNPJ básico, a CPF, an email, a phone, a
  LinkedIn URL, an identity key, a normalized tax id, an identifier hash, a filesystem-path-like
  string, and an oversized numeric leaf.
- **"Fail-closed tests for missing caps and forbidden families"** means at least one test per refusal
  class in § 8, plus one per forbidden family label in § 7.
- **A test plan is not a test.** The plan is evidence for the authorization decision; the tests are
  written inside the implementation milestone, after authorization.
- **The implementation milestone and the execution step are separate.** Landing 11F-IMPL against
  synthetic fixtures does not authorize pointing it at the operator's real files; that is its own
  step, with its own report, under this record's § 7 and § 8.

---

## 12. What remains blocked

Regardless of any decision recorded here, and regardless of whether Option C is subsequently
authorized, every item below remains blocked:

```text
full dataset execution
opening all files
opening Socios/QSA/CPF/person files
opening ZIPs directly
unbounded scan
row samples
raw cells
identifiers
hashes from identifiers
join execution
join coverage evidence
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

### 12.1 Why this list survives an Option C authorization

Option C would change exactly one thing: whether two allowlisted files may be opened, once, under
ceilings, reporting aggregates only. It changes nothing about the rest of the dataset, about joins,
about persistence, about runtime, or about Agent 1 — because none of those appears in the Option C
loop at all.

Two consequences follow, and both are load-bearing:

1. **No Option C result is citable as evidence about the dataset.** A green run is evidence that a
   read path works and that a file's shape matches what was declared. It is not evidence about
   coverage, join rates, quality, eligibility, or either gate.
2. **The gate owners' authority is untouched.** GATE-1 and GATE-2 remain the sole route to dataset
   processing and import.

---

## 13. Flags

```text
OPS_BR_BOUNDED_REAL_DATA_FILE_DRY_RUN_DECISION_RECORD_PR_READY = true   (PR #172)
OPS_BR_BOUNDED_REAL_DATA_FILE_DRY_RUN_DECISION_RECORD_OFFICIAL = true   (merged)
OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_PROBE_AUTHORIZED          = true   (Option C, BR-SOURCE-11F-IMPL)
OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_PROBE_MERGED              = true   (PR #173)
OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_PROBE_PR_READY            = true   (BR-SOURCE-11F-IMPL)
OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_PROBE_OFFICIAL            = true   (merged)
OPS_BR_REAL_LOCAL_DATA_FILE_DRY_RUN_AUTHORIZED                 = true   (Option C scope only)

FULL_JOIN_RUNNER_READY                                         = true
FULL_JOIN_EXECUTION_READY                                      = false
IMPORT_READY                                                   = false
RUNTIME_READY                                                  = false
AGENT1_READY                                                   = false

OPS_BR_READY_FOR_IMPORT                                        = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT                             = false
OPS_BR_READY_FOR_RUNTIME                                       = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY                          = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED                  = false
```

Post-merge correction: BR-SOURCE-11F-IMPL-LAND merged PR #173, making the ultra-bounded
required-family probe official. This does not approve any gate and does not authorize joins, import,
Supabase, runtime, or Agent 1.

Carried forward unchanged from the post-11E state, restated so no reader has to infer them:

```text
OPS_BR_REAL_MANIFEST_METADATA_ONLY_EXECUTION_AUTHORIZED        = true
OPS_BR_REAL_MANIFEST_METADATA_ONLY_EXECUTION_MERGED            = true
OPS_BR_REAL_MANIFEST_METADATA_ONLY_EXECUTION_OFFICIAL          = true
OPS_BR_REAL_MANIFEST_METADATA_ONLY_OPTION_B_AUTHORIZED         = true
OPS_BR_REAL_LOCAL_MANIFEST_AUTHORIZED                          = true   (metadata; document only)
```

Those `true` values refer to **manifest document** parsing and to which document may be named. None
of them is partial credit toward this record's Option C.

`OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false` is worth reading literally: no headerless
real-file dry-run has passed, because none has been run, because none is authorized.

### 13.1 Gate status — UNCHANGED

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

`FULL_JOIN_RUNNER_READY = true` reflects only that the 11A scaffold merged, was validated post-merge
by 11B, and gained synthetic temp-manifest (11C) and metadata-only (11D-META-IMPL, 11E) plumbing. It
says nothing about execution readiness: `FULL_JOIN_EXECUTION_READY` is and remains `false`.

---

## 14. Next milestone mapping

```text
If Option C is explicitly authorized after this record is merged:
BR-SOURCE-11F-IMPL may implement the ultra-bounded required-family real data-file probe.

If catalog files are desired:
a later explicit decision is required.

If join execution is desired:
a later explicit BR-SOURCE-11G decision is required.

If import is desired:
a later explicit import-readiness process is required.

No real data-file execution is authorized by this record.
```

| Decision | Milestone | Requires |
|----------|-----------|----------|
| Option A | none | nothing — real data files stay closed until GATE-1 and GATE-2 are approved |
| Option B | none recommended | its own record; not recommended, since headerless files have no non-data first line |
| Option C | BR-SOURCE-11F-IMPL (new) | this record merged **and** the § 11 owner phrase **and** the § 7 scope **and** the § 8 caps |
| Option D | separate record or explicit authorization | its own owner phrase, plus a widened family allowlist and file ceiling |
| Option E | BR-SOURCE-11G (new) | its own record, resolving the join-key construction conflict with GATE-3/GATE-4/GATE-5 |
| Import | separate import-readiness process | GATE-1 … GATE-8 approved |

### 14.1 Ordering note

The mapping orders **review**, not approval. Option C landing does not advance Option D, and Option D
landing does not advance Option E. Each requires its own authorization, and none approves a gate. The
independent and always-available path — approving GATE-1 and GATE-2 on their own merits — remains the
shortest route to real execution and is unaffected by any option here.

---

## 15. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- write, modify, or delete any code, script, test, fixture, or package manifest;
- read, open, parse, `stat`, sample, or reference a real Receita data file;
- open a CSV, a ZIP, an extracted file set, or any file referenced by any manifest;
- read, open, parse, or reference a real manifest;
- read a row, count a column, observe an encoding, or classify a row shape from real input;
- compute a join, a join key, or any coverage figure;
- download, unzip, or import a dataset;
- execute the runner in any mode;
- write to Supabase or perform any production write;
- create or modify a migration, or create/alter/validate an index;
- write to `source_company_snapshots`;
- read any environment variable or construct any client;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- construct or print a `record_identity_key` or a `normalized_tax_id`;
- print a row, a cell, a full CNPJ, a CNPJ básico, a CPF, a name, an address, a contact, or a join
  key;
- emit a hash, truncation, or fingerprint derived from any identifier;
- record any real, absolute, or complete filesystem path;
- use MCP, admin bypass, or self-approval;
- activate Brazil, approve any gate, or mark Brazil ready for import, runtime, or Agent 1;
- edit `MEMORY.md`;
- merge.

Every cap value, enum member, field name, flag value, family label, and directory label shown above is
a schema name, a class label, a threshold, a zero, a `false`, a denylist label, or an explicit
placeholder — never a real value and never a real location. No secrets, no data dumps, no real CNPJs,
no CNPJ básico values, no CPFs, and no partner (sócio) personal data are reproduced. Local WIP
(`scratchpad/`) and the unrelated in-progress work on the main worktree are untouched by any git
operation: this milestone was prepared in an isolated worktree branched from `origin/main`.
