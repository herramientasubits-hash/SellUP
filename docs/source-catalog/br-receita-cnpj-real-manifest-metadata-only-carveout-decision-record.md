# BR-SOURCE-11D-META — Real manifest metadata-only carve-out decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11D-META — Real manifest metadata-only carve-out decision record (docs-only)
**Status:** `official_and_option_b_authorized_and_executed` — the record is merged, its § 9 owner phrase has been given, and BR-SOURCE-11E executed it metadata-only against one operator-prepared manifest document (§ 15). Still **not** a gate approval, and **not** a real-data-file / row-read / join-coverage / import / migration authorization
**Predecessor:** BR-SOURCE-11C-LAND — `BRSOURCE11CLANDA — OPTION_B_SYNTHETIC_TEMP_MANIFEST_DRY_RUN_MERGED` (PR #166, `main` HEAD `5b7b77c0571419d9d62d97db12e0ea4559b79102`), validated post-merge by BR-SOURCE-11C-V — `BRSOURCE11CVA — POST_MERGE_OPTION_B_SYNTHETIC_TEMP_MANIFEST_VALIDATION_PASSED`
**Last reviewed:** 2026-07-30

**Related documents:**
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

> **AMENDED 2026-07-30.** This document originally **asked a question** — whether a narrow
> real-manifest **metadata-only** carve-out could be authorized as the next step after
> BR-SOURCE-11C's synthetic temp-manifest carve-out. It was merged as PR #167, and the owners then
> gave the § 9 phrase `AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT`. The question is
> therefore **answered: Option B is authorized**, and § 14 records what was built under it.
>
> The body below is preserved as written, so the decision is auditable in the terms it was decided
> in. Where it reads as an open question or as "not authorized", read § 1 and § 14 for the current
> state. Sections 4, 7, 8 and 10 are **not** superseded: they are the binding boundaries, caps, and
> blocked list that the authorization was granted against.
>
> The authorization covers **parsing one manifest document, as metadata**. It still **approves no
> gate**, moves no gate out of `not_started`, and authorizes none of: opening any file a manifest
> points at, reading a real Receita data file, reading a row, computing join coverage, a dataset
> download, full-dataset processing, full join execution, import, a Supabase write, a production
> write, a migration, an index change, a runtime change, an adapter/validator change, an Agent 1
> integration, a provider call, a HubSpot sync, a Slack notification, live generation, full
> expansion, or merge to an operational state.
>
> **AMENDED AGAIN 2026-07-30 (BR-SOURCE-11E).** Where § 14.3 says no real operator manifest has been
> read and the real prepared basenames stay refused, read § 15: one operator-prepared manifest
> **document** has now been executed metadata-only, under a separate declaration that relaxes only
> which document may be named. Everything else in § 14.3 stands — no referenced file was opened or
> stat-ed, no row was read, no join was computed, and no gate moved.

---

## 1. Status

```text
Decision record status: official (merged as PR #167, main HEAD 1aaab1d)
Owner authorization:    GIVEN — "AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT"
                        GIVEN — real manifest metadata-only EXECUTION (BR-SOURCE-11E, § 15)
Implementation status:  implemented by BR-SOURCE-11D-META-IMPL (see § 14)
                        executed against one operator-prepared manifest by BR-SOURCE-11E (§ 15)
Current GO/NO-GO:       GO for manifest metadata-only parsing, including the operator's own
                        manifest DOCUMENT; NO-GO for everything else
```

Explicitly — and none of this changed when Option B was authorized:

```text
This record does not approve GATE-1.
This record does not approve GATE-2.
This record does not approve any gate.
This record does not authorize opening any file the manifest references.
This record does not authorize real data-file execution.
This record does not authorize row reads.
This record does not authorize join coverage.
This record does not authorize dataset import.
This record does not authorize Supabase writes.
This record does not authorize runtime or Agent 1.
```

The owner phrase authorized **manifest metadata parsing and nothing else**. Reading the manifest is
now permitted; opening what it points at is not, and is not made closer by this authorization.

Three clarifications, because every prior milestone in this series has shown how easily they are
conflated:

- **A merged decision record is not an authorization.** Merging this record makes the *question*
  official. It does not answer it. The answer is a separate, explicitly-worded owner phrase (§ 9),
  given after this record is official — and that phrase would authorize the option it names, and
  nothing else.
- **A mechanism existing in code is not an approval.** BR-SOURCE-11A landed the no-write/no-runtime
  guard, the output sanitizer, and the failure-cleanup model; BR-SOURCE-11C added a
  `filesystem_path_like` leak kind and a counted-artifact cleanup path. Those are the *mechanisms*
  of GATE-8, GATE-5, and GATE-6. All eight gates remain `not_started` / not approved.
- **Reading a manifest is not the same as reading data — but it is not nothing either.** The whole
  purpose of this record is to hold that distinction precisely enough that owners can decide on it,
  rather than having engineering decide it by implication.

---

## 2. Background

```text
BR-SOURCE-11A created the no-write/no-runtime runner scaffold.
BR-SOURCE-11B validated synthetic_fixture_only after merge.
BR-SOURCE-11C-R recorded the local manifest carve-out question.
BR-SOURCE-11C implemented and validated Option B: synthetic temp-manifest only.
The next possible step is not real data-file execution. The next possible step is deciding whether a
real manifest can be read as metadata only.
```

### 2.1 The sequence, and what each step actually established

| Milestone | Verdict | What it established | What it did **not** establish |
|-----------|---------|---------------------|-------------------------------|
| BR-SOURCE-11A-LAND | `BRSOURCE11ALANDA` | The full join dry-run runner scaffold merged, with `local_manifest_dry_run` declared and always refusing. | Nothing about real input. The runner performed no filesystem read at all. |
| BR-SOURCE-11B | `BRSOURCE11BA` | Post-merge validation that the merged scaffold behaves as declared in `synthetic_fixture_only`. | Nothing about manifests, files, or the dataset. |
| BR-SOURCE-11C-R | merged, official | The carve-out decision question, four options, and the recommendation (its Option B — synthetic temp-manifest only). | No gate, no authorization. A merged question is still a question. |
| BR-SOURCE-11C-LAND | `BRSOURCE11CLANDA` | Manifest-reading **plumbing**: parse a manifest shape, enforce caps, sanitize output, clean up — exercised only against manifests the test suite itself wrote. | Anything at all about the real dataset. Counts describe cells the generator wrote moments earlier. |
| BR-SOURCE-11C-V | `BRSOURCE11CVA` | Post-merge validation of the Option B carve-out as merged. | Same limitation, restated: no real-dataset evidence exists. |

### 2.2 Why the next step is a question, not an implementation

BR-SOURCE-11C-R separated two things that BR-SOURCE-11C had bundled: **the plumbing** (parse, cap,
sanitize, report, clean up) and **the input** (which manifest, describing which files, containing
whose data). BR-SOURCE-11C resolved the plumbing half completely, against synthetic input only.

What remains is the input half — and the input half divides again, into two steps that the series has
so far treated as one:

1. **Reading the manifest itself** — a control document that *describes* where regulated files are.
2. **Opening the files the manifest points at** — the regulated data.

Step 2 is the subject of a future BR-SOURCE-11D and requires GATE-1 and GATE-2 in full. Step 1 is
smaller, and it is genuinely different: a manifest is not a Receita data file. Whether step 1 can be
carved out ahead of step 2 is the only question this record asks.

### 2.3 What has structurally *not* happened yet

```text
No real manifest has been opened by any SellUp code path.
No real Receita data file has been opened by any SellUp code path.
No file referenced by any manifest has been opened.
No dataset has been downloaded by SellUp automation.
No row of Receita data has been read, parsed, counted, or hashed.
No join has been computed over real data.
No coverage figure about the real dataset exists.
```

Every number produced anywhere in the 11A → 11C-V sequence describes synthetic bytes that the test
suite or the synthetic generator wrote moments earlier. That is a hard boundary, and this record does
not move it.

---

## 3. Decision question

```text
Can SellUp authorize a narrow real-manifest metadata-only carve-out, limited to reading the local
manifest file structure and safe metadata without opening any referenced Receita data files, without
import, without Supabase writes, without runtime, without Agent 1, and with aggregate-only sanitized
output?
```

The question is deliberately narrow. It is worth naming what it is **not** asking:

- It is not asking whether Brazil may be imported. That is `OPS_BR_READY_FOR_IMPORT`, unchanged and
  `false`.
- It is not asking whether the real dataset may be processed. That is `FULL_JOIN_EXECUTION_READY`,
  unchanged and `false`.
- It is not asking whether real Receita files may be opened. That is
  `OPS_BR_REAL_LOCAL_DATA_FILE_DRY_RUN_AUTHORIZED`, unchanged and `false`, and it is a separate
  milestone (§ 12).
- It is not asking the owners to approve GATE-1 or GATE-2 quickly, informally, or by implication. A
  carve-out is **not** a gate approval; it is a bounded exception whose boundaries the owners set,
  and which leaves both gates `not_started`.
- It is not asking for standing permission. Any carve-out granted under this record is scoped to the
  single next milestone that consumes it, and expires with that milestone.

### 3.1 Why the question is worth asking now rather than folding it into GATE-1/GATE-2

Two reasons, and one honest counter-reason.

1. **The two halves have different owners.** Whether a *control document* may be parsed is largely a
   path-policy and output-sanitization question. Whether *regulated rows* may be read is a lawful
   basis and purpose-limitation question. Bundling them means the smaller question waits on the
   larger one and gets decided without its own scrutiny.
2. **It shrinks the eventual real-data milestone.** If manifest-structure validation against a real
   manifest is already proven, the delta remaining at BR-SOURCE-11D is exactly the regulated read —
   the part that deserves the owners' full attention.
3. **Counter-reason, stated plainly.** A real manifest is not privacy-nil (§ 4.3). Reading one buys
   *declarative* signal only: it can tell the project that the operator's local preparation is
   well-formed; it cannot tell the project anything about data quality, coverage, or join rates. An
   owner may reasonably decide that a declarative-only signal does not justify leaving the
   privacy-nil world, and choose Option A instead. That is a legitimate answer to this question.

---

## 4. Definition of metadata-only

"Metadata-only" is a boundary that must be **enforced**, not merely intended. This section defines
it. Anything not on the allowed list is out of scope by default.

```text
Leer únicamente el archivo manifest real como documento de control.
No abrir ningún archivo de datos apuntado por el manifest.
```

### 4.1 Allowed metadata, if it is authorized in the future

```text
- manifest schema/version if present;
- source period if present and non-sensitive;
- layoutMode;
- declared file families;
- count of declared files by family;
- file-family labels;
- aggregate manifest validation status;
- forbidden family presence as boolean/count only;
- missing required family as boolean/count only;
- cap configuration as numbers;
- no-write/no-runtime guard result as booleans/counters.
```

Every item on that list is a **schema-level** fact: a class label, an enum member, a count, a
boolean, or a threshold. None of them is a value from inside a Receita data file, and none of them is
a location.

### 4.2 Forbidden even under metadata-only

```text
- opening any referenced CSV/ZIP/data file;
- reading file contents pointed by manifest;
- sampling rows;
- printing manifest paths;
- printing full filenames if they contain sensitive local context;
- printing local absolute paths;
- printing raw manifest JSON;
- printing row values;
- printing CNPJ/CNPJ básico/CPF;
- printing names, emails, phones, addresses;
- printing hashes/fingerprints derived from identifiers;
- stat-ing real data files unless separately authorized;
- calculating join coverage;
- claiming full dataset processed;
- claiming GATE evidence for data quality or coverage.
```

### 4.3 Notes on the boundary

- **A manifest is a pointer to regulated data, not regulated data.** That is what makes a carve-out
  conceivable. It is also why the carve-out is not free: the manifest's path, its declared file
  names, and its declared period are themselves information about the operator's environment, and
  every one of them has to be sanitized out of any report.
- **"Read the manifest" and "open what the manifest points at" is a real engineering constraint.**
  It needs its own guard and its own tests. The BR-SOURCE-11C architecture already supports it: the
  runner core owns no filesystem, imports no `node:fs` / `node:os`, and receives reading capability
  through an injected port. A metadata-only reader would be a *second* implementation of that port,
  and the constraint becomes "this implementation resolves exactly one path — the manifest — and has
  no code path that opens a second file".
- **`stat` is not free either.** Asking the filesystem how large a referenced file is, or whether it
  exists, is not reading its contents — but it *is* touching a regulated artifact, and its answer is
  information about the operator's environment. It is therefore excluded from metadata-only and
  isolated as its own option (§ 5, Option C).
- **Raw manifest JSON is forbidden output even though it is the input.** The manifest may be parsed;
  it may not be echoed. A report that includes the raw document has leaked filenames, paths, and
  declared periods in one step.
- **Filenames are treated as unsafe by default.** A declared file *family* (`empresas`,
  `estabelecimentos`, `cnaes`, `municipios`, `naturezas`) is a class label and is safe. A concrete
  filename is operator-environment information and is not reportable.
- **"No production evidence claims" is a reporting boundary, not a code boundary.** Any milestone
  consuming this carve-out must state in its own report that it produced **no** evidence about the
  real dataset and that its results are not citable as GATE-1 or GATE-2 evidence.
- **The forbidden path families are named to be blocked, not to be used.** They appear in this
  document as denylist labels for a static guard. No real, absolute, or complete path is recorded
  here, and none may be recorded in code, tests, fixtures, or reports.
- **The Sócios / QSA / CPF family stays denylisted end to end.** Under metadata-only, a real
  manifest that *declares* a file in that family is a fail-closed condition reported as an aggregate
  boolean or count — never as a filename, and never followed by a read.

---

## 5. Options

### Option A — Keep real manifest fully blocked

```text
Status: safest, slowest.
Effect: no real manifest is read until GATE-1 and GATE-2 are formally approved.
```

The runner keeps refusing every manifest whose declared trust is not
`synthetic_temp_manifest_only`. Manifest plumbing stays exercised against synthetic input only. No
successor milestone touches a real manifest until both gates carry a signed approval.

- **Pro:** the project stays privacy-nil. There is nothing to bound, nothing to sanitize beyond what
  already exists, and no precedent that could later be misread.
- **Pro:** it is not a dead end. BR-SOURCE-11C already proved the plumbing; Option A simply says the
  *input* question waits for its proper owners.
- **Con:** the first post-approval milestone must validate manifest structure against real input
  *and* read real data *and* report on both, in one step.
- **Risk if chosen:** low technical risk; schedule risk concentrated at the moment of gate approval.

### Option B — Real manifest metadata-only carve-out

```text
Status: recommended next option, still no data-file reads.
Effect: read only manifest structure and safe metadata; do not open referenced data files.
Requires explicit owner phrase after this record is merged.
```

The runner may open **one** local real manifest and read its descriptive structure — schema/version,
layout mode, declared families, per-family counts, validation outcome — while being structurally
prevented from opening any file that manifest points at. Boundaries in § 7, caps in § 8.

- **Pro:** the smallest useful step beyond synthetic temp-manifest validation. It answers "is the
  operator's local preparation well-formed?" without reading a single row of regulated data.
- **Pro:** it leaves GATE-1 and GATE-2 with undiminished authority over the regulated read, because
  the regulated read is not in the loop.
- **Pro:** its failure mode is contained. The worst case of a defect is a refusal or a sanitizer
  rejection, not an exposure — provided the second-file constraint in § 4.3 is enforced by a static
  test rather than by intent.
- **Con:** it is no longer privacy-nil. The manifest is an artifact describing regulated files; path,
  filenames, and declared period must all be sanitized out.
- **Con:** it yields **declarative** signal only. Nothing learned is citable as GATE-1 or GATE-2
  evidence, and nothing measured says anything about real coverage, real join rates, or real
  eligibility.
- **Con:** residual mis-citation risk — a future reader could mistake "a real manifest validated" for
  "real manifest reading is authorized" or, worse, for "Brazil is ready". § 11 and the flags in § 11
  exist to make that misreading impossible to sustain.
- **Risk if chosen:** medium-low, and dominated by one control: the static guarantee that no second
  file can be opened.

### Option C — Real manifest metadata + file existence/size stat

```text
Status: higher risk, not recommended yet.
Effect: may stat referenced files without reading contents.
Requires stronger GATE-2 storage/path policy and explicit separate approval.
```

Option B, plus permission to ask the filesystem whether each declared file exists and how large it
is — without opening any of them.

- **Pro:** it would catch a class of operator-preparation defect that metadata alone cannot: a
  manifest that declares a file which is absent, empty, or implausibly sized.
- **Con:** it touches regulated artifacts. Existence and size are facts about the operator's local
  copy of regulated data, and a size figure is a partial statement about volume.
- **Con:** it needs a path policy that does not exist yet — which locations are legitimate, and how a
  path is validated before it is resolved. That is GATE-2's deliverable.
- **Con:** it multiplies the surface the second-file guard must cover: the code now legitimately
  handles referenced paths, so "resolves exactly one path" is no longer the invariant.
- **Risk if chosen now:** medium-high, for a marginal gain over Option B.

### Option D — Bounded real data-file dry-run

```text
Status: not recommended yet.
Effect: may open real Receita files under caps.
This is future BR-SOURCE-11D or later, not authorized by this record.
```

The runner may open real Receita data files under strict row/byte ceilings and produce an
aggregate-only report.

- **Pro:** the only option that produces evidence about the real dataset — which is ultimately what
  the full join dry-run exists to measure.
- **Con:** it reads regulated data. Every GATE-1 concern (lawful basis, purpose limitation, the
  CNPJ / CNPJ básico / CPF and sócio families) and every GATE-2 concern (envelope, ceilings,
  retention, cleanup-on-failure) applies in full and directly.
- **Con:** it depends on GATE-3 (field allowlist), GATE-4 (identity grain), GATE-5 (output
  sanitization) and GATE-6 (failure cleanup) simultaneously, plus GATE-7's operator runbook — whose
  *reproducible by a different operator* criterion cannot be satisfied until GATE-2 ceilings exist.
- **Risk if chosen now:** high, and unnecessary. Nothing about Option B forecloses Option D; Option B
  strictly reduces the amount of untested code that would be running when Option D is attempted.

### 5.1 Option label continuity — read this before quoting any authorization phrase

The option labels in this record are **local to this record**. They are not the same labels as
BR-SOURCE-11C-R's, and an authorization phrase from one record authorizes nothing in the other.

| This record (11D-META) | Equivalent in BR-SOURCE-11C-R § 4 | State |
|---|---|---|
| — | 11C-R Option B — synthetic temp-manifest carve-out | **authorized and implemented** in BR-SOURCE-11C |
| Option A — keep real manifest fully blocked | 11C-R Option A (adapted) | current state |
| **Option B — real manifest metadata-only** | **11C-R Option C** | **not authorized** — the subject of this record |
| Option C — metadata + file stat | (not enumerated in 11C-R) | not authorized |
| Option D — bounded real data-file dry-run | 11C-R Option D | not authorized |

Consequence, and it is load-bearing: the already-spent phrase
`AUTHORIZE OPTION B — SYNTHETIC TEMP-MANIFEST CARVE-OUT ONLY` authorized 11C-R Option B, which is
**not** this record's Option B. This record's Option B requires the distinct phrase in § 9, given
after this record is merged. A phrase that does not name real-manifest metadata-only explicitly
authorizes nothing here.

### 5.2 Option comparison

| | A — fully blocked | B — metadata-only | C — metadata + stat | D — bounded real data-file |
|---|---|---|---|---|
| Opens the real manifest | no | yes | yes | yes |
| Touches referenced data files | no | no | `stat` only | yes, reads |
| Reads regulated rows | no | no | no | yes |
| Privacy surface | none | non-trivial (paths/filenames/period) | non-trivial + volume signal | full |
| Needs GATE-1 / GATE-2 approval first | n/a | carve-out or approval | carve-out **and** a GATE-2 path policy | yes |
| Produces real-dataset evidence | no | **no** (declarative only) | no (declarative + existence) | yes |
| Needs a new guard invariant | no | "resolves exactly one path" | path policy + allowlist | full GATE-1…GATE-7 |
| Recommended now | no | **yes** | no | no |
| Milestone that would consume it | — | BR-SOURCE-11D-META-IMPL | separate record/authorization | BR-SOURCE-11D |

---

## 6. Recommended decision

```text
Recommended decision for now: Option B — Real manifest metadata-only carve-out.
```

Reason:

```text
It is the smallest useful step beyond synthetic temp-manifest validation.
It validates manifest structure without opening real Receita data files.
It preserves GATE-1/GATE-2 authority over real data-file execution.
It produces no row-level evidence and no import readiness.
```

Expanded, the recommendation rests on four points:

1. **It is the smallest step that is still a step.** Between "synthetic manifests only" and "read
   regulated rows" there is exactly one intermediate position that reads something real without
   reading regulated data. This is it.
2. **It spends no gate authority.** Option B needs no GATE-1 finding about lawful basis and no GATE-2
   ceiling for regulated bytes, because no regulated byte is read. Both gates remain `not_started`,
   and the owners' authority over real files is undiminished.
3. **It makes the eventual real-data milestone smaller and safer.** When GATE-1 and GATE-2 are
   approved, manifest-structure validation against real input will already be written, capped,
   sanitized, and regression-tested. The remaining delta is the regulated read itself.
4. **Its failure mode is contained, conditionally.** The condition is the § 4.3 invariant: exactly
   one path is resolved, and that unreachability of a second file is asserted by a static test — not
   observed at review time. Option B without that control is not the option being recommended.

**Why not the others, in one line each.** Option A is safe and remains a legitimate owner answer, but
concentrates all risk into the first post-approval milestone. Option C adds a volume signal and a
whole path policy for a marginal gain over B. Option D is the eventual destination, not the next
step.

The recommendation is explicitly **conditional on the boundaries in § 7, the caps in § 8, and the
evidence in § 9**.

---

## 7. Proposed boundaries for Option B

These boundaries apply to **Option B only**, and only if it is authorized after this record is
merged.

```text
Allowed:
- read one local real manifest file as metadata-only;
- parse manifest structure;
- validate layoutMode;
- validate declared required families;
- detect forbidden families as aggregate booleans/counts;
- produce sanitized aggregate report;
- no-write/no-runtime guard;
- output sanitizer;
- no import;
- no Supabase;
- no runtime;
- no Agent 1;
- no providers;
- no output inside repo.
```

```text
Forbidden:
- opening Empresas CSV;
- opening Estabelecimentos CSV;
- opening Cnaes CSV;
- opening Municipios CSV;
- opening Naturezas CSV;
- opening Socios/QSA/CPF files;
- opening ZIP files;
- opening any file referenced by manifest except the manifest itself;
- reading raw-zips;
- reading extracted;
- reading manifest-input;
- using Downloads path as data execution evidence;
- printing absolute paths;
- printing raw manifest;
- printing filenames if unsafe;
- processing rows;
- computing join coverage;
- import;
- Supabase writes;
- migrations;
- runtime;
- Agent 1;
- providers;
- production evidence claims.
```

### 7.1 Notes on the boundaries

- **"One local real manifest file"** means one, singular, per run. Not a directory scan, not a glob,
  not a list. A run that would resolve a second path is a fail-closed refusal.
- **"Except the manifest itself"** is the load-bearing clause of the whole option. It must be
  enforced structurally — a reader implementation with no code path that opens a second file — and
  asserted by a static test, exactly as BR-SOURCE-11C asserts that the runner core imports no
  filesystem module.
- **"No output inside repo"** means the runner writes no report, log, or artifact into the working
  tree. The aggregate report is a return value, not a file. This also guarantees no real manifest
  content can be accidentally committed.
- **"Sanitized aggregate report"** inherits the existing report contract unchanged: `decision_status`
  asserting all eight gates `not_approved`, `run_scope` all false, `safety` all false, counts, the
  cleanup model, and error entries carrying a fixed error code and stage only — never a raw message,
  a path, or a value. The BR-SOURCE-11C `filesystem_path_like` leak kind applies to this path too.
- **"Printing filenames if unsafe"** resolves to: do not print filenames. A family label is
  reportable; a filename is not. If a future implementation believes it needs a filename in a report,
  that is a change to this boundary and requires its own authorization.
- **The forbidden path families are denylist labels.** They are recorded here so a static guard can
  refuse them, never as usable locations. No real, absolute, or complete path appears in this record,
  and none may appear in code, tests, fixtures, or reports.
- **A manifest that declares a forbidden family is a refusal, not a filtered read.** Reporting it as
  an aggregate boolean or count is permitted; skipping it and proceeding is not.
- **The carve-out is single-milestone and expires with it.** It does not become a standing capability
  of the runner, and it cannot be inherited by a later milestone without its own authorization.

---

## 8. Proposed caps and limits

```text
maxManifestBytes        <= 1_000_000
maxDeclaredFiles        <= 20
allowedLayoutMode       = official_headerless
allowedRequiredFamilies = empresas, estabelecimentos, cnaes, municipios, naturezas
forbiddenFamilies       = socios, qsa, cpf, pessoas, person, partner, shareholders
outputMode              = aggregate_only
```

Clarification:

```text
These caps apply only to real manifest metadata-only parsing.
They are not approval to open real data files.
They are not approval to process rows.
They are not approval to import.
```

### 8.1 Notes on the caps

- **`maxManifestBytes` bounds the only read that happens.** A manifest larger than the ceiling is a
  fail-closed refusal, never a truncated parse. Truncated JSON is not a smaller document; it is a
  different one.
- **`maxDeclaredFiles` bounds the parse, not the dataset.** It exists so a malformed or hostile
  manifest cannot turn a bounded loop into an unbounded one. It says nothing about how many files the
  real dataset contains.
- **Caps must be stated by the caller, not defaulted.** BR-SOURCE-11C established the rule: a cap the
  caller never stated is a cap nobody agreed to. A missing cap is refused; it is never filled in.
- **Caps must be enforced and asserted.** Each cap needs at least one test that drives input past it
  and asserts the refusal. A cap that is only a default is not a cap.
- **`allowedLayoutMode = official_headerless`** is the layout authority already established by the
  BR-SOURCE-10C headerless work and reused by the BR-SOURCE-11C generator. Metadata-only validation
  reuses it; it does not redefine it.
- **`forbiddenFamilies` is a superset of the parser's existing denylist**, deliberately. A metadata
  reader that encounters any of those labels refuses before doing anything else.
- **These numbers carry no implication for real-data ceilings.** Real-data ceilings are a GATE-2
  deliverable and are not proposed, implied, or anticipated by this record.

---

## 9. Evidence required before implementation

```text
- this decision record merged;
- explicit owner phrase authorizing Option B;
- confirmation that only the manifest file may be opened;
- confirmation that referenced data files remain forbidden;
- confirmation that no gate is approved by Option B;
- test plan with synthetic manifests and one metadata-only manifest fixture;
- static guard checks;
- sanitizer checks;
- no-write/no-runtime checks;
- fail-closed checks for data-file paths and forbidden families.
```

The recommended authorization phrase is:

```text
AUTHORIZE OPTION B — REAL MANIFEST METADATA-ONLY CARVE-OUT
```

### 9.1 Notes on the evidence

- **All ten items are required.** Any single one missing means the implementation stays blocked. In
  particular, a merged record without the owner phrase authorizes nothing, and the owner phrase given
  before the record is merged authorizes nothing either — the phrase refers to a record that must
  already be official.
- **The phrase is exact, single-scope, and non-transferable.** It authorizes this record's Option B
  only. It does not authorize Option C or Option D, does not approve GATE-1 or GATE-2, does not cover
  a second milestone, and cannot be extended by inference. See § 5.1: it is also **not**
  interchangeable with the already-spent BR-SOURCE-11C phrase.
- **"Only the manifest file may be opened"** is the confirmation that the owners have understood the
  § 4.3 / § 7.1 invariant and are authorizing an option whose entire safety argument rests on it.
- **"Test plan with synthetic manifests and one metadata-only manifest fixture"** means the
  implementation's tests stay synthetic. A "metadata-only manifest fixture" is a fixture the test
  suite writes, exercised through the *real-manifest* code path to prove the path works and refuses
  correctly. Authorization to read the operator's real manifest is a separate, operator-run step
  whose report must carry no path, no filename, and no raw document.
- **"Static guard checks"** means the forbidden path families in § 7 and the second-file case are
  unreachable by construction, and that unreachability is asserted by a test — not merely observed at
  review time.
- **"Sanitizer checks"** means the output sanitizer is exercised against the new path, and its refusal
  of a full CNPJ, CNPJ básico, CPF, email, phone, LinkedIn URL, raw row payload, identity key,
  normalized tax id, identifier hash, filesystem-path-like string, or oversized numeric leaf is
  asserted on the metadata path specifically.
- **"No-write/no-runtime checks"** means the existing guard is exercised on the new path and still
  fails on the mere presence of a dangerous indicator — a service-role key, a Supabase URL, an import
  mode, a runtime endpoint, an Agent 1 switch, or a provider API key.
- **"Fail-closed checks for data-file paths and forbidden families"** means at least one test per
  refusal class: a manifest declaring a forbidden family; a manifest whose entry would resolve a
  second path; a manifest exceeding each cap; a manifest with a non-allowed layout mode.
- **A test plan is not a test.** The test plan is evidence for the authorization decision; the tests
  themselves are written inside the implementation milestone, after authorization.

---

## 10. What remains blocked

Regardless of any decision recorded here, and regardless of whether Option B is subsequently
authorized, every item below remains blocked:

```text
opening real Receita CSV files
opening ZIP files
opening files referenced by the manifest
reading rows
sampling data
join coverage calculation
company-establishment join over real data
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

### 10.1 Why this list survives an Option B authorization

Option B would change exactly one thing: whether the runner may open **the manifest document
itself**, once, under caps, reporting aggregates only. It changes nothing about the files the
manifest describes, the rows inside them, persistence, runtime, or Agent 1 — because none of those is
present in the Option B loop at all.

Two consequences follow, and both are load-bearing:

1. **No Option B result is citable as evidence for anything real.** A green Option B run is evidence
   that a manifest is well-formed. It is not evidence about the dataset, about coverage, about join
   rates, about eligibility, or about either gate. Any report that cites it otherwise is wrong.
2. **The gate owners' authority is untouched.** GATE-1 and GATE-2 remain the sole route to real
   data-file execution. A carve-out is a bounded exception to a *code-writing* restriction; it is not
   a partial gate approval, and it creates no precedent for one.

---

## 11. Flags

```text
OPS_BR_REAL_MANIFEST_METADATA_ONLY_DECISION_RECORD_PR_READY = true
OPS_BR_REAL_MANIFEST_METADATA_ONLY_DECISION_RECORD_OFFICIAL = true
OPS_BR_REAL_MANIFEST_METADATA_ONLY_OPTION_B_AUTHORIZED      = true
OPS_BR_REAL_MANIFEST_METADATA_ONLY_IMPL_PR_READY            = true   (BR-SOURCE-11D-META-IMPL)
OPS_BR_REAL_MANIFEST_METADATA_ONLY_IMPL_OFFICIAL            = false  (until that PR merges)
OPS_BR_REAL_LOCAL_MANIFEST_AUTHORIZED                       = true   (metadata-only; document only)
OPS_BR_REAL_LOCAL_DATA_FILE_DRY_RUN_AUTHORIZED              = false

FULL_JOIN_RUNNER_READY                                      = true
FULL_JOIN_EXECUTION_READY                                   = false
IMPORT_READY                                                = false
RUNTIME_READY                                               = false
AGENT1_READY                                                = false

OPS_BR_READY_FOR_IMPORT                                     = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT                          = false
OPS_BR_READY_FOR_RUNTIME                                    = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY                       = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED               = false
```

Unchanged from the post-BR-SOURCE-11C state and restated here so no reader has to infer them:

```text
OPS_BR_LOCAL_MANIFEST_CARVEOUT_OPTION_B_AUTHORIZED          = true   (11C-R Option B — synthetic only)
OPS_BR_OPTION_B_SYNTHETIC_TEMP_MANIFEST_DRY_RUN_OFFICIAL    = true
```

Those two `true` values refer to the **synthetic** temp-manifest carve-out (§ 5.1). They are not
partial credit toward this record's Option B.

### 11.1 Gate status — UNCHANGED

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

`FULL_JOIN_RUNNER_READY = true` reflects only that the BR-SOURCE-11A scaffold merged, was validated
post-merge by BR-SOURCE-11B, and gained synthetic temp-manifest plumbing in BR-SOURCE-11C. It says
nothing about execution readiness: `FULL_JOIN_EXECUTION_READY` is and remains `false`.

---

## 12. Next milestone mapping

```text
If Option B is explicitly authorized after this record is merged:
BR-SOURCE-11D-META-IMPL may implement real manifest metadata-only parsing.

If metadata + file stat is desired:
A separate decision record or explicit owner authorization is required.

If bounded real data-file execution is desired:
A separate BR-SOURCE-11D decision and implementation path is required.

No real data-file execution is authorized by this record.
```

| Decision | Milestone | Requires |
|----------|-----------|----------|
| Option A | none | nothing — the real manifest stays blocked until GATE-1 and GATE-2 are approved |
| Option B | BR-SOURCE-11D-META-IMPL (new) | this record merged **and** the § 9 owner phrase **and** the § 7 boundaries **and** the § 8 caps |
| Option C | separate record or explicit authorization | a GATE-2 path policy and storage envelope, plus its own owner phrase |
| Option D | BR-SOURCE-11D (new) | GATE-1 and GATE-2 approved, or an explicit signed carve-out of equivalent scope |

### 12.1 Ordering note

The mapping orders **review**, not approval. Option B landing does not advance Option C, and Option C
landing does not advance Option D. Each requires its own authorization, and none of the three
approves a gate. The independent and always-available path — approving GATE-1 and GATE-2 on their own
merits — remains the shortest route to real execution and is unaffected by any option here.

---

## 13. Safety confirmation

> **Amended by BR-SOURCE-11D-META-IMPL.** The confirmation below describes the original **docs-only**
> milestone that produced this record, and it remains accurate for that milestone. The implementation
> milestone (§ 14) does touch code, tests, the CLI, and docs; it opened **one** manifest document per
> validation run — a **synthetic** manifest it wrote itself — and it still did not open any file a
> manifest references, read any row, compute any join, import, write to Supabase, create a migration,
> touch runtime or Agent 1, change UI, edit `MEMORY.md`, approve any gate, or merge. It executed **no**
> real operator manifest.

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- write, modify, or delete any code, script, test, fixture, or package manifest;
- read, open, parse, `stat`, or reference a real manifest;
- open any file referenced by any manifest;
- download, unzip, or import a dataset;
- open, read, commit, or reference a real dataset or report;
- execute the runner in any mode, or read any file from the runner core;
- write to Supabase or perform any production write;
- create or modify a migration, or create/alter/validate an index;
- write to `source_company_snapshots`;
- read any environment variable or construct any client;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- construct or print a `record_identity_key` or `normalized_tax_id`;
- print a row, a full CNPJ, a CNPJ básico, a CPF, a name, an address, a contact, or a join key;
- emit a hash, truncation, or fingerprint derived from any identifier;
- record any real, absolute, or complete filesystem path;
- use MCP, admin bypass, or self-approval;
- activate Brazil, approve any gate, or mark Brazil ready for import, runtime, or Agent 1;
- edit `MEMORY.md`;
- merge.

Every cap value, enum member, error code, flag value, and path family name shown above is a schema
name, a class label, a threshold, a zero, a `false`, a denylist label, or an explicit placeholder —
never a real value and never a real location. No secrets, no data dumps, no real CNPJs, no CNPJ
básico values, no CPFs, and no partner (sócio) personal data are reproduced. Local WIP
(`scratchpad/`) and the unrelated in-progress work on the main worktree are untouched by any git
operation: this milestone was prepared in an isolated worktree branched from `origin/main`.

## 14. BR-SOURCE-11D-META-IMPL — what the authorization was spent on

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

### 14.1 What landed

| Piece | Where | What it does |
|---|---|---|
| Metadata-only reader | `br-receita-cnpj-real-manifest-metadata-reader.ts` (new) | Opens **one** manifest, parses it, returns aggregate metadata. Resolves exactly one path. |
| Trust level | runner: `real_manifest_metadata_only` | A fourth trust value, distinct from `synthetic_temp_manifest_only`. |
| Authorization flag | runner: `realManifestMetadataOnlyOptionBAuthorized` | A **separate** flag from `optionBCarveoutAuthorized`; neither satisfies the other's gate. |
| Caps | `maxManifestBytes ≤ 1_000_000`, `maxDeclaredFiles ≤ 20` | Both REQUIRED of the caller; an omitted cap is refused, never defaulted. |
| Report block | runner: `manifest_metadata` | Aggregate booleans, counts, and class labels. `null` on every non-metadata run. |
| CLI flag | `--real-manifest-metadata-only` + `--max-manifest-bytes` + `--max-declared-files` | Requires `--manifest`, `--allow-local-manifest`, `--strict`, and both caps. |
| Sanitizer | two new leak kinds | `raw_manifest_payload` and `declared_filename_payload` — the two output shapes this carve-out newly makes possible. |

### 14.2 How the § 4.3 / § 7.1 invariant is enforced

"Exactly one path is resolved" is enforced structurally and asserted three ways:

1. **Structurally** — the reader captures the manifest path in a closure, contains a single
   `fs.openSync` call targeting that path, and never builds a second path (`path.join` and
   `path.resolve` are absent from the module; only the `fileType` **label** of a declared entry is
   ever read, never its declared path).
2. **By static test** — a guard reads the module source and asserts one `openSync`, no
   `statSync` / `existsSync` / `readdirSync` / `readFileSync` / `createReadStream`, and no path
   construction.
3. **By instrumented observation** — the reader's own suite wraps every relevant `node:fs` entry
   point and asserts that a real run opens exactly one descriptor, on the manifest, and stats and
   lists nothing — **with the referenced files materialized on disk beside the manifest**, so "it did
   not open them" is an observation rather than an artefact of their absence.

No `stat` happens anywhere: the byte ceiling is applied to the read itself (one byte beyond the cap
is requested, and its presence means the document is oversized and is refused rather than parsed
truncated).

### 14.3 What the implementation deliberately did NOT do

- **It did not execute the operator's real manifest.** The § 8 caps and the § 7 boundaries are
  implemented and exercised, but only against **synthetic** metadata manifests that the test suite
  and the validation step wrote themselves, per the § 9.1 test-plan requirement.
- **It kept `manifest.headerless.json` and `manifest.real.json` refused by basename**, on the new
  flag as well as the old ones. Executing an operator's real prepared file set is a separate,
  explicitly-authorized operator step, not something this milestone unlocks by adding a flag.
- **It read no row, opened no referenced file, and computed no join.** Every row, eligibility, and
  join count on a metadata-only report is structurally zero: the metadata path returns before the
  fixture scorer is reachable.

### 14.4 Reporting boundary (§ 4.3, restated as a rule for consumers)

A green metadata-only run is evidence that a manifest is **well-formed**. It is **not** evidence
about the dataset, its coverage, its join rates, its eligibility, GATE-1, or GATE-2. Any report that
cites it otherwise is wrong.

---

## 15. BR-SOURCE-11E — the operator's manifest, executed metadata-only

§ 14.3 held back exactly one thing: the code path was proven, but the operator's own prepared
manifest stayed refused by staging-directory segment and by basename, so every number in § 14
described a document the test suite had written moments earlier. BR-SOURCE-11E is the step that
closes that gap, and only that gap.

```text
Authorization spent:  real manifest metadata-only EXECUTION (which DOCUMENT may be named)
Not authorized:       opening a referenced file, a row read, join coverage, a dataset download,
                      full-dataset processing, import, a Supabase write, a migration, an index
                      change, a runtime change, an Agent 1 integration, a provider call, a
                      HubSpot sync, a Slack notification, or any gate approval
Gates moved:          none. All eight remain not_started / not approved.
```

### 15.1 What landed

| Piece | Where | What it does |
|---|---|---|
| Reader declaration | `realManifestMetadataOnlyExecutionAuthorized` | Relaxes the staging-segment and prepared-basename path lists — nothing else. A URL, a non-`.json` path and an empty path stay refused on it. |
| Scan field | reader: `operatorPreparedManifestAuthorized` | States whether the waiver was actually SPENT, so the fact travels with the read rather than with the caller's claim. |
| Runner declaration | `realManifestMetadataOnlyExecutionAuthorized` | Provenance only — the runner resolves no paths. Reported as `real_manifest_metadata_only_execution_authorized`. |
| Cross-check | runner: `real_manifest_metadata_execution_not_authorized` | A scan that spent the waiver on a run that never declared it is refused, with **no** metadata block and every count zero. |
| Report field | `manifest_metadata.operator_prepared_manifest_authorized` | Derived from the reader's report, so the block cannot overclaim. |
| CLI flag | `--real-manifest-metadata-execution` | Valid ONLY with `--real-manifest-metadata-only`. `--output` keeps every refusal it already had. |
| Tests | `br-receita-cnpj-real-manifest-metadata-execution.test.ts` | 37 tests: what the waiver relaxes, what it does not, the instrumented single-descriptor invariant with referenced files materialized on disk, the runner cross-check, and the CLI surface. |

### 15.2 The three authorizations, still non-transferable

```text
optionBCarveoutAuthorized                      → synthetic temp manifest only (§ 11)
realManifestMetadataOnlyOptionBAuthorized      → metadata-only parsing        (§ 14)
realManifestMetadataOnlyExecutionAuthorized    → which DOCUMENT may be named  (§ 15)
```

None satisfies another's gate. The 11E flag alone is refused with
`manifest_metadata_not_authorized` at the reader and `real_manifest_metadata_only_not_authorized`
at the runner gate; declared on a synthetic-temp run it buys nothing at all.

### 15.3 The executed run

One operator-prepared manifest document, `--strict`, both caps stated, no `--output` (so no artifact
was written anywhere). Sanitized aggregate result — every field below is a boolean, a count, or a
class label:

```text
ok                                    true      exit code 0      errors []
manifest_trust                        real_manifest_metadata_only
option_b_carveout_authorized          false
metadata_only_option_b_authorized     true
metadata_only_execution_authorized    true
operator_prepared_manifest_authorized true
layout_mode                           official_headerless
schema_version_present                true
source_period_present                 true      (presence only — the value is never reported)
declared_file_count                   5
required_family_count                 2         missing_required_family_count 0
forbidden_family_count                0         forbidden_families_present    false
declared_family_counts                empresas 1, estabelecimentos 1, simples 0,
                                      cnaes 1, municipios 1, naturezas 1, other 0
manifest_bytes_read_bucket            lte_1mb
referenced_data_files_opened          false     referenced_data_files_statted false
raw_manifest_printed                  false     absolute_paths_printed        false
aggregate / eligibility / join counts all zero
guardrail_counts                      all zero
decision_status                       8 × not_approved
run_scope / safety                    every flag false
cleanup                               not_needed, 0 artifacts
```

The manifest itself was **not** committed, and neither was the report: the manifest lives only in the
operator's own location, and the run wrote nothing.

### 15.4 What § 15 does NOT establish — § 14.4 restated, because it now matters more

The run says the operator's manifest is **well-formed**: five declared files, both required families
present, no Sócios / QSA / CPF family declared, headerless layout stated. That is a statement about a
control document.

It is **not** a statement about the dataset. No file the manifest references was opened or stat-ed.
No row was read, parsed, counted, or hashed. No join was computed, and **no coverage figure about the
real dataset exists**. Sections 4, 7, 8 and 10 remain the binding boundaries, caps and blocked list;
§ 15 widened one item in § 7's path policy and nothing else in any of them. GATE-1 and GATE-2 are
still exactly what reading a real Receita data file would require, and neither is approved.

---

