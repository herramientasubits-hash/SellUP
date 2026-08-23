# Brazil Receita CNPJ Manual Download and Local Prep Runbook

> **Authority:** Brazil source operations — SellUp source catalog.
> **Status:** operational runbook (documentation only).
> **Scope:** how a human operator prepares the real Receita CNPJ Dados Abertos
> files **locally** so SellUp tooling can validate a manifest and run a local
> dry-run. This runbook does **not** authorize import, Supabase writes, runtime,
> Agent 1, or HubSpot.

---

## 1. Purpose

This runbook exists so an operator can prepare the real Receita CNPJ files on
their own machine, outside the repository, before any manifest preparation
(BR-SOURCE-10A-PREP) or local dry-run QA (BR-SOURCE-10A).

It prepares local files **for QA only**. Completing every step here does **not**
authorize any of the following:

- import or staging into `source_company_snapshots`;
- production import;
- Supabase writes of any kind;
- runtime integration;
- Agent 1 live integration;
- HubSpot or Slack;
- live prospect generation.

Those remain blocked and require separate, explicit approval in later milestones
(see § 15).

---

## 2. Current state

- Brazil source classification is official (see
  `br-source-classification-and-activation-blueprint.md`).
- Receita Bulk (`br_receita_dados_abertos`, canonical technical source key
  `br_receita_cnpj_dados_abertos`) is classified for **future enrichment and
  validation**. It is not connectable now.
- No Brazil source is connectable at this time.
- Import, runtime, and live generation remain blocked.
- The tooling that already exists and is safe to run locally:
  - a **manifest validator** (BR-SOURCE-6);
  - a **local real-file dry-run** runner (BR-SOURCE-7).
  Both are sanitized, fail-closed, and never import, download, or write to
  Supabase.

---

## 3. Pattern used in SellUp

SellUp prepares every official / bulk source with the same operational pattern.
Nothing about Brazil is new; this runbook only applies the established flow:

1. **Manual download outside the repo.** The operator obtains the source files
   manually and stores them in a local, controlled folder outside the
   repository.
2. **Local inspection.** SellUp tooling inspects **metadata only** (file types,
   sizes, hashes, header layout, bounded structural samples) — never full rows,
   never contact data.
3. **Manifest.** The operator writes a small local JSON manifest that describes
   the file set.
4. **Validator.** SellUp validates the manifest (identity, layout, integrity).
5. **Dry-run.** SellUp runs a bounded local dry-run to confirm the files would
   parse cleanly.
6. **Import design (later, gated).** Only after QA passes, and only with explicit
   approval, an import is designed.
7. **Controlled Supabase pilot (later, gated).** Only with explicit approval, a
   controlled write to `source_company_snapshots` is performed.
8. **Lookup / enrichment adapter, then Agent 1 (later, gated).** Only after an
   adapter and a gated runtime design exist is discovery / enrichment connected.

The operator does steps 1 and 3 by hand. SellUp tooling does steps 2, 4, and 5.
Steps 6–8 are separate milestones with their own approvals.

---

## Alignment with prior SellUp source workflows

This follows the same operational pattern used for other official / bulk sources
in SellUp: manual / local source preparation first, dry-run and QA second,
Supabase import only after explicit approval, and Agent 1 integration only after
an adapter and a gated runtime design exist. The Brazil connectors mirror the
same local-first, sanitized, fail-closed boundary tooling already used elsewhere
in `scripts/source-catalog/` and `src/server/source-catalog/`, rather than
introducing a new ingestion path.

---

## 4. Local folder convention

Keep everything **outside the repository**. Recommended layout:

```text
~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/
  raw-zips/          # the archives exactly as downloaded
  extracted/         # manually extracted data files (.csv / .txt)
  manifest.json      # the local manifest you write (see § 8)
  reports/           # sanitized outputs you save from the runners
```

Rules:

- The repository must **never** contain the dataset (no ZIP, no CSV, no TXT).
- `<YYYY-MM>` is the monthly period tag of the Receita release you downloaded. It must match the
  actual month published in the official portal (`Dados → Cadastros → CNPJ → <YYYY-MM>/`, see § 5).
- The manifest lives at the top of that folder; data files live under
  `extracted/`. Manifest paths are written **relative to the manifest's own
  directory** (see § 8). Example relative path: `extracted/empresas.csv`.

---

## 5. What the user downloads manually

The operator must manually obtain the public **Receita Federal CNPJ Dados
Abertos** files from the official source. As of BR-SOURCE-10A-SOURCE-VERIFY, the
official source is still available but the access path moved to the official
public file share on the Receita Federal domain.

Go to the official entry point:

```text
https://arquivos.receitafederal.gov.br/
```

Navigate manually:

```text
Dados → Cadastros → CNPJ → <YYYY-MM>/
```

where `<YYYY-MM>` matches the actual month published in the portal.

**Do not use the deprecated flat paths** (they return 404 / no longer resolve):

- `/dados/cnpj/`
- `/dados/cnpj/dados_abertos_cnpj/`
- `/cnpj/dados_abertos_cnpj/`

The official references (`dados.gov.br` dataset catalog, `gov.br` Receita
cadastros page, official CNPJ layout PDF) remain authoritative. Do **not** rely
on any URL that is not already documented as a project-approved source, and do
**not** use third-party mirrors such as Casa dos Dados, Base dos Dados, GitHub
mirrors, blogs, or community archives unless separately reviewed and approved.
This runbook does not embed a download link and does not download on the
operator's behalf.

**Aggregated `cnpj.tar.gz`.** An aggregated official artifact may appear at
`Dados → Cadastros → CNPJ → cnpj.tar.gz`. Do **not** use `cnpj.tar.gz` in the
standard family-ZIP manifest until a separate evaluation milestone approves that
artifact; the manifest and dry-run below expect the per-family files.

**First-QA minimal families.** The first QA can start with a minimal set of
family files:

```text
empresas
estabelecimentos
naturezas
municipios
cnaes
```

(`empresas` + `estabelecimentos` are still the two required files for the
dry-run.) `socios` / `qsa` / CPF / person / contact files **remain forbidden**
(see the forbidden list below).

**Allowed file families** (company / reference grain only):

- `empresas`
- `estabelecimentos`
- `simples`
- `cnaes`
- `municipios`
- `naturezas`

**Required** (the dry-run needs both):

- `empresas`
- `estabelecimentos`

**Optional** (reference / regime enrichment):

- `simples`
- `cnaes`
- `municipios`
- `naturezas`

**Forbidden — never download, never place in the folder, never list in the
manifest:**

- `socios`
- `qsa`
- any CPF file
- any people / contact / person file

These are excluded by the BR legal / privacy decision (company-grain, masked
identity only). The validator rejects them by name (`forbidden_file_type` /
`forbidden_file_name`).

---

## 6. Extraction rules

- Extract archives **manually, outside the repo**. Do not run any automatic
  download or unzip script.
- Do not commit ZIP / CSV / TXT files to the repository at any point.
- Do not include forbidden files (`socios` / `qsa` / CPF / person) in
  `extracted/` or in the manifest.
- If the download produced only ZIPs, extract them manually first — the tooling
  rejects a ZIP as a data file (`zip_not_allowed`).
- Accepted data-file extensions are `.csv` and `.txt` only.

---

## 7. Safe local inventory commands

List **names and sizes only** — never open row content. Run these inside the
period folder (`~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/`):

```bash
# File names and human-readable sizes under extracted/
ls -lh extracted/

# File types present (basename only), sorted
ls -1 extracted/ | sort

# Confirm no forbidden families slipped in (should print nothing)
ls -1 extracted/ | grep -iE 'socio|qsa|cpf|pessoa|person|contato|contact' || echo "OK: no forbidden files"
```

Do not `cat`, `head`, `less`, or otherwise print row content of the data files.

---

## 8. Manifest template

Write `manifest.json` at the top of the period folder. Paths are **relative to
the manifest's directory** (absolute paths and URLs are rejected). Fill in the
period, sizes, and hashes; add optional files only if you downloaded them.

```json
{
  "sourceKey": "br_receita_cnpj_dados_abertos",
  "countryCode": "BR",
  "sourceYear": 2026,
  "sourcePeriod": "YYYY-MM",
  "mode": "local_manifest_validation",
  "layoutMode": "official_headerless",
  "files": [
    {
      "fileType": "empresas",
      "path": "extracted/empresas.csv",
      "expectedSizeBytes": 0,
      "expectedSha256": "<sha256>",
      "encoding": "latin1",
      "delimiter": ";"
    },
    {
      "fileType": "estabelecimentos",
      "path": "extracted/estabelecimentos.csv",
      "expectedSizeBytes": 0,
      "expectedSha256": "<sha256>",
      "encoding": "latin1",
      "delimiter": ";"
    }
  ]
}
```

Notes:

- `sourceKey`, `countryCode`, and `mode` are fixed literals — do not change them.
- `sourcePeriod` is `YYYY-MM` and should match the `<YYYY-MM>` folder.
- `expectedSizeBytes` and `expectedSha256` are optional; when present, the
  validator confirms the file on disk matches. Set them from § 9.
- `encoding` is `latin1` or `utf8`; `delimiter` is `;` or `,`. Receita bulk files
  are commonly `latin1` with `;` — confirm against your download.
- Add `simples` / `cnaes` / `municipios` / `naturezas` entries only if present.

### 8.1 Header vs headerless layout (`layoutMode`)

The **real** Receita CNPJ open-data files ship **without a header row** — the very
first line is already a data row. Set `layoutMode` so the validator checks them by
their official positional **column count** instead of treating the first line as
headers:

- `"layoutMode": "official_headerless"` — the first line is a **data** row; the
  validator confirms it has the official column count for the file type
  (`empresas` 7, `estabelecimentos` 30, `simples` 7, `cnaes` 2, `municipios` 2,
  `naturezas` 2) and never reads it as headers.
- `"layoutMode": "header"` (the default when omitted) — the first line is a
  **header** row validated by column names. Use this only for a prepared file that
  keeps a header line.

The mode is **always explicit** and is never inferred from the file contents. Set
it once at the top level (`layoutMode`) to apply it to every file, or per file to
override the default. For the real Receita download, use `official_headerless`. An
unknown value is rejected fail-closed (`layout_mode_invalid`); a wrong column count
is `headerless_column_count_mismatch`; an empty file is `headerless_empty_file`.

---

## 9. Hash and size commands

Compute the size and SHA-256 for each file, then paste them into the manifest:

```bash
# Size in bytes (macOS)
stat -f%z extracted/empresas.csv

# Size in bytes (Linux)
stat -c%s extracted/empresas.csv

# SHA-256 (full hash; the runner reports only a 12-char prefix)
shasum -a 256 extracted/empresas.csv

# Line count as an integrity sanity check (no row content is shown)
wc -l extracted/empresas.csv
```

---

## 10. Manifest validation command

Validate the manifest with the official runner. Run from the repository root; the
`--manifest` value points at your **local** manifest outside the repo.

```bash
node --import tsx scripts/source-catalog/run-br-receita-cnpj-manifest-validator.ts \
  --manifest ~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/manifest.json \
  --allow-local-manifest \
  --format json \
  --strict
```

The runner rejects a URL manifest, a directory, or any ingestion flag
(`--csv`, `--zip`, `--download`, `--import`, `--execute`, `--supabase`,
`--production`, `--hubspot`, `--slack`, `--url`, `--remote`) with
`BRSOURCE6_FORBIDDEN_MANIFEST_MODE` before validation runs.

---

## 11. Local dry-run QA command

Once the manifest validates, run the bounded local dry-run. It samples only a
small, bounded number of rows structurally (max 20; keep it small):

```bash
node --import tsx scripts/source-catalog/run-br-receita-cnpj-local-dry-run.ts \
  --manifest ~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/manifest.json \
  --allow-local-manifest \
  --dry-run-only \
  --format json \
  --strict \
  --max-sample-rows 5
```

The dry-run requires **both** `--allow-local-manifest` and `--dry-run-only`. A URL
manifest, `--max-sample-rows` above 20, or any forbidden ingestion / full-scan
flag (`--full`, `--all`, plus the § 10 list) is rejected with
`BRSOURCE7_FORBIDDEN_DRY_RUN_MODE` before the dry-run runs.

Save the JSON output under `reports/` for the record.

---

## 11.1. Privacy-safe bounded dry-run classifier (BR-SOURCE-10E)

The § 11 dry-run **hard-blocks** the whole run the moment a sampled cell trips the
anti-PII digit-run guard (`sample_row_forbidden_value_detected`). That is correct
and must not be bypassed. The **privacy-safe classifier** is a **separate, explicit
mode** that reads the same bounded sample but, instead of aborting, turns each
finding into a **per-record eligibility count** against the BR-SOURCE-10D contract.
It never prints a row, a value, a full CNPJ, a CPF, an email, a phone, or an
address — only aggregated counts. It **does not** replace the § 11 dry-run, and it
**authorizes nothing** (no import, no runtime, no Agent 1).

```bash
node --import tsx scripts/source-catalog/run-br-receita-cnpj-privacy-safe-dry-run.ts \
  --manifest ~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/manifest.headerless.json \
  --allow-local-manifest \
  --format json \
  --strict \
  --max-sample-rows 5
```

It requires `--manifest` + `--allow-local-manifest`, a **local `.json`** manifest,
and every accepted file to be `official_headerless` (this is the real-file
classifier). `--max-sample-rows` above 20, a URL manifest, or any forbidden
ingestion / full-scan flag is rejected with
`BRSOURCE10E_FORBIDDEN_PRIVACY_MODE` before it runs. By default the run stays
`ok: true` even when records are excluded (exclusion is expected); pass
`--fail-on-any-excluded` to flip that. A structural anomaly, a leak, a manifest
failure, or a non-headerless file makes it `ok: false`.

Each row resolves to exactly one status (BR-SOURCE-10D § 7, calibrated by
BR-SOURCE-10F below): `eligible_for_future_import`, `excluded_person_or_pii_risk`,
`excluded_forbidden_file_family`, `excluded_forbidden_token`,
`excluded_unsupported_legal_nature`, `excluded_guard_triggered`,
`needs_legal_review`, `not_applicable_lookup`, or `pending_company_join_context`.
**Nothing can be marked eligible today** unless a legal-nature policy is injected
(the runner injects none), because BR-SOURCE-10D § 11 leaves the eligible-natureza
allowlist, MEI policy, and full-CNPJ persistence undecided — so a clean company row
falls, fail-closed, to `needs_legal_review`. Save the JSON output under `reports/`
for the record.

### 11.2. Eligibility & legal-nature calibration (BR-SOURCE-10F)

BR-SOURCE-10F calibrates the classifier so that structurally non-company rows stop
inflating `needs_legal_review`, without changing any authorization (see design
[§ 10.2](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)). Run it the
same way, with `--max-sample-rows 20` for a fuller bounded sample:

```bash
node --import tsx scripts/source-catalog/run-br-receita-cnpj-privacy-safe-dry-run.ts \
  --manifest ~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/manifest.headerless.json \
  --allow-local-manifest \
  --format json \
  --strict \
  --max-sample-rows 20
```

What changes in the sanitized output:

- **Reference lookups** (`cnaes` / `municipios` / `naturezas`) are
  `not_applicable_lookup` — catalog rows are structurally not company candidates,
  and remain non-importable.
- **Establishments** sampled in isolation are `pending_company_join_context` — a
  data-join hold (reason `establishment_requires_company_join_context`), still
  non-importable on their own.
- **MEI / empresário individual** legal natures **exclude** by default
  (`excluded_person_or_pii_risk`) instead of holding.
- Two aggregate maps are added: `legal_nature_classification_counts` (risk classes)
  and `positive_company_signal_counts` — **counts only**, no labels or values.

Legal nature is a **classification signal, not an import authorization**: the
classifier can reduce `needs_legal_review`, but it never marks a record importable.
Establishments still require a future empresas join, lookups are never importable
companies, and import / production import / runtime / Agent 1 / live prospect
generation all stay **blocked**.

---

### 11.3. Company↔establishment bounded join dry-run (BR-SOURCE-10G)

BR-SOURCE-10G adds a **bounded, privacy-safe dry-run that associates an establishment
to its company context** by the structural join id (`cnpj_basico` / raiz), producing
**aggregate join metrics only** (see design
[§ 10.3](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)). It reuses the
same manifest validation and per-row classifier; the join key is held **only in an
ephemeral in-memory index** and is **never printed, returned, hashed, or persisted**.
Run it with independent company / establishment bounds:

```bash
node --import tsx scripts/source-catalog/run-br-receita-cnpj-company-establishment-join-dry-run.ts \
  --manifest ~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/manifest.headerless.json \
  --allow-local-manifest \
  --format json \
  --strict \
  --max-company-rows 20 \
  --max-establishment-rows 20
```

What the sanitized output reports:

- `companies_sampled`, `companies_indexed_for_join`, `companies_excluded_from_join`;
- `establishments_sampled`;
- `join_counts` — each establishment resolves to exactly one of
  `joined_with_sampled_company_context`, `missing_sampled_company_context`,
  `excluded_due_to_company_context`, `excluded_due_to_establishment_privacy_signal`,
  or `pending_full_join_context`;
- `join_reason_counts`, `company_classification_counts`,
  `establishment_classification_counts` — **counts only**;
- an all-false safety block including `join_keys_printed: false`.

A "join" here only means a company context was found **within the bounded sample**; the
two files' small samples rarely overlap, so most establishments honestly resolve to
`missing_sampled_company_context` / `pending_full_join_context`. Establishments remain
**non-importable on their own**, and import / production import / Supabase writes /
migrations / runtime / Agent 1 / HubSpot / Slack / provider calls / live prospect
generation all stay **blocked**. This dry-run authorizes none of them.

---

### 11.4. Bounded join COVERAGE strategy (BR-SOURCE-10H)

BR-SOURCE-10G sampled the **first N rows of each file independently**, which on the real
files gave `joined_with_sampled_company_context = 0` — the honest confirmation that two
linear prefixes rarely overlap. BR-SOURCE-10H adds a `--sampling-strategy` flag so the same
dry-run can run a **coverage-oriented probe** (design
[§ 10.4](./br-receita-cnpj-privacy-safe-import-eligibility-design.md)):

- `first_rows` (default): the BR-SOURCE-10G first-N-of-each behaviour, unchanged.
- `establishment_keys_then_company_probe`: sample estabelecimentos first, collect their
  structural join keys **only in memory**, then scan a **bounded** `--max-company-scan-rows`
  window of empresas (default **1000**, hard cap **5000**) for those keys. The join keys are
  never printed, returned, hashed, or persisted.

```bash
node --import tsx scripts/source-catalog/run-br-receita-cnpj-company-establishment-join-dry-run.ts \
  --manifest ~/Downloads/sellup-source-data/br/receita-cnpj/<YYYY-MM>/manifest.headerless.json \
  --allow-local-manifest \
  --format json \
  --strict \
  --sampling-strategy establishment_keys_then_company_probe \
  --max-company-rows 20 \
  --max-establishment-rows 20 \
  --max-company-scan-rows 1000
```

The probe adds `companies_scanned_for_coverage`, `establishment_keys_collected_in_memory`
(a count only), a `coverage_scan_limit_reached` join reason, and a `coverage_summary` block.
`coverage_is_representative` is **always false** in this milestone: no full dataset is
processed, no approved statistical sample is drawn, and no index is persisted, so the result
is a **bounded technical coverage probe** — never import / production import / runtime /
Agent 1 / live-prospect-generation readiness, and never market or Brazil-source coverage.
All of those remain **blocked**; this dry-run authorizes none of them.

---

### 11.5. Full join import-readiness design (BR-SOURCE-10I)

Because BR-SOURCE-10H showed a bounded scan does **not** recover representative company
context, the next step is a **contract**, not more execution. BR-SOURCE-10I is a **docs-only
readiness design** that defines the conditions for a future full local join — the allowed
local processing envelope, join-key treatment, post-join field survival contract, the
record-identity decision gate, and the required future gates (GATE-1 … GATE-8). There is **no
new runner and no new command** for it. It **decides no identity grain** and authorizes **no**
dry-run, import, Supabase write, migration, runtime, or Agent 1 integration. See design
[`br-receita-cnpj-full-join-import-readiness-design.md`](./br-receita-cnpj-full-join-import-readiness-design.md).

---

### 11.6. Full join dry-run technical design (BR-SOURCE-10J)

BR-SOURCE-10J lowers the BR-SOURCE-10I readiness **contract** into a **docs-only technical
design** for a future full local join dry-run: the conceptual execution model, the architecture
options reviewed (in-memory / streaming two-pass / temporary discardable index, with a
conservative streaming-first recommendation), the temporary storage envelope, join-key handling,
field discard timing, the failure cleanup contract, resource limits, and the future CLI and
aggregate report contracts — plus a mapping of GATE-1 … GATE-8 to concrete technical decisions.
There is **no new runner and no new command** for it; the future CLI shape it documents does not
exist and is not created. It **decides no identity grain** and authorizes **no** dry-run, import,
Supabase write, migration, runtime, or Agent 1 integration. See design
[`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md).

---

### 11.7. Full join approval gates checklist (BR-SOURCE-10K)

BR-SOURCE-10K converts GATE-1 … GATE-8 into a **docs-only, formal approval checklist**: per gate,
the required evidence, the approver role, the pass / fail criteria, the block conditions, the
expected artifacts, the flag it governs, and what each approval does and does not unlock — plus a
gate status model, a dependency graph, an approval-evidence template, and a global GO / NO-GO
matrix. There is **no new runner and no new command** for it.

It **approves no gate**: all eight remain `not_started`, so the matrix reads **NO-GO**, and no
full-join runner code may be written. Operator-relevant consequence: **GATE-7 governs this
runbook** — the operator preflight, cleanup verification, out-of-repo report location, sensitive
report scan, post-run deletion rules, and final signoff described in the 10J technical design § 16
are not yet approved, so no full-join operator procedure is authorized. 10K decides no identity
grain and authorizes **no** dry-run, import, Supabase write, migration, runtime, or Agent 1
integration. See checklist
[`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md).

---

### 11.8. Full join gate evidence packet (BR-SOURCE-10L)

BR-SOURCE-10L is a **docs-only evidence packet** for GATE-1 … GATE-8: per gate it records the
evidence that already exists (with document and section pointers), the evidence still missing, the
owner role that missing evidence must come from, the pending decision that blocks the gate, and the
artifacts required to reach `ready_for_review` — plus a cross-gate gap map and a global GO / NO-GO.
There is **no new runner and no new command** for it.

It **approves no gate**: all eight remain `not_started` (each holding `partial_evidence_collected`),
so the matrix still reads **NO-GO**, and no full-join runner code may be written. Operator-relevant
consequence: **GATE-7 is still unapproved and this runbook still contains no full-join procedure** —
10L records exactly what is missing before one could exist (a preflight that verifies gate status,
the dry-run confirmation language, a disk / memory command set against ceilings that do not yet
exist, live monitoring instructions, cleanup verification steps, the report sensitive-scan steps,
post-run deletion rules, and a final signoff template). Nothing in § 11.1–§ 11.4 changes: the
bounded runners and their commands are unaffected. 10L decides no identity grain, no field allowlist,
and no storage envelope, and authorizes **no** dry-run, import, Supabase write, migration, runtime,
or Agent 1 integration. See packet
[`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md).

---

### 11.9. Remaining full join gates decision packet (BR-SOURCE-10PQR)

BR-SOURCE-10PQR is a **docs-only decision packet** proposing the three remaining preparable gate
contracts — **GATE-6** (failure cleanup), **GATE-7** (operator runbook), and **GATE-8** (no-write /
no-runtime) — plus a readiness table covering all eight gates. It follows the three earlier docs-only
decision records that proposed GATE-3 (**10M** field allowlist), GATE-4 (**10N** identity grain), and
GATE-5 (**10O** output sanitization). There is **no new runner and no new command** for any of them.

It **approves no gate**: all eight remain `not_started`, so the matrix still reads **NO-GO**, and no
full-join runner code may be written. Operator-relevant consequences, stated plainly:

- **GATE-7 is still unapproved, and this runbook still contains no full-join procedure.** 10PQR proposes
  the *contract* a future runbook section must satisfy — who may operate, the preflight items and their
  pass conditions, the non-overridable stop conditions, the evidence that may leave the machine, and the
  operator behavior rules — not the procedure itself. **Nothing in it authorizes a full join run.**
- **Only a named authorized human operator could ever run it** — never an agent, an automation, or a CI
  job, and never "on behalf of" an operator.
- **Four of its own preflight items cannot be performed today**: the gate-status check fails by
  construction while any gate is unapproved, the disk and memory checks have no GATE-2 ceilings to check
  against, and the sanitizer check has no frozen GATE-5 contract.
- **Evidence discipline applies to the operator, not only to the tooling**: no terminal screenshots, no
  unsanitized copy-paste, no real manifest or local path in any channel, no manual editing of a report to
  make it pass, and no warning recorded as a pass.
- **Nothing in § 11.1–§ 11.4 changes**: the bounded runners, their commands, and their safe outputs are
  unaffected, and § 13's stop conditions and § 14's what-this-does-not-authorize list stand unchanged.

10PQR decides no identity grain, no field allowlist, and no storage envelope; writes no cleanup code,
guard, runner, test, or runbook section; creates no migration; changes no index; and authorizes **no**
dry-run, import, Supabase write, runtime, or Agent 1 integration. See packet
[`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md).

---

## 12. Expected safe outputs

Both runners emit only a **sanitized report**:

- file types and safe file labels (basename only, never a full path);
- byte sizes;
- a SHA-256 truncated to a 12-character prefix (`sha256Hash12`);
- layout / header validation status (`passed` / `passed_headerless` / `failed` /
  `skipped`) and the resolved `layout_mode` per file;
- for the dry-run, bounded **sample row counts** only.

> **Headerless dry-run note.** The dry-run still applies a row-level safety guard:
> if a sampled row contains an 11-digit run (CPF length) or a 14-digit run (full
> CNPJ), it is rejected (`sample_row_forbidden_value_detected`) and the dry-run
> reports `ok: false`. This is expected and **must not be bypassed** — real
> `empresas` records for individual entrepreneurs can carry a CPF-length value in
> the company-name field, which the BR legal / privacy decision excludes. A
> headerless **manifest validation** can pass while the **dry-run** is blocked for
> this reason; that is a legitimate stop condition (§ 13), not a tooling bug.
>
> **BR-SOURCE-10D.** This exact stop condition was observed on real data in
> BR-SOURCE-10C and is now formalized: the record-level privacy-safe eligibility
> rules that any future import must satisfy (excluded records, persistible/prohibited
> fields, guardrails, aggregated reporting, and open legal/privacy questions) are
> defined in
> [`br-receita-cnpj-privacy-safe-import-eligibility-design.md`](./br-receita-cnpj-privacy-safe-import-eligibility-design.md).
> Import, runtime, and live generation stay blocked.

The output never contains:

- full data rows;
- a full CNPJ;
- any CPF;
- any contact or address field;
- a full local filesystem path.

Every result carries an all-false safety block (`datasetDownload`,
`supabaseWrite`, `productionImport`, `runtimeIntegration`, `agent1Integration`,
`hubspot`, `slack`, `liveProspectGeneration` are all `false`).

---

## 13. Stop conditions

Stop and do not proceed if any of the following is true:

- there is no local folder prepared yet;
- only ZIPs exist (extract them manually first);
- `empresas` or `estabelecimentos` is missing;
- a forbidden family is detected (`socios` / `qsa` / CPF / person);
- a duplicate or multipart file layout is present and unsupported;
- manifest validation failed;
- the dry-run reported a failed layout or a sanitization concern in the output.

If a forbidden file is found, remove it from the folder before doing anything
else, then re-inventory (§ 7).

---

## 14. What this does not authorize

Completing this runbook does **not** authorize:

- Supabase writes;
- import;
- production import;
- runtime integration;
- Agent 1 integration;
- HubSpot or Slack;
- live prospect generation;
- a full dataset scan.

---

## 15. Next milestones

| Milestone | Scope | Gate |
|-----------|-------|------|
| **BR-SOURCE-10A-PREP** | Create a manifest from the operator's prepared local folder. | Requires a prepared local folder (this runbook). |
| **BR-SOURCE-10A** | Run the real local dry-run QA against that manifest. | Requires a validated manifest. |
| **BR-SOURCE-10B** | Import **design only**, if QA passes. | Explicit approval; no writes. |
| **BR-SOURCE-10C** | Headerless real-file support (manifest validates; real dry-run blocked by PII guard). | Merged (PR #142). |
| **BR-SOURCE-10D** | Privacy-safe import eligibility **design** (docs-only). | Merged design; authorizes no import. |
| **BR-SOURCE-10E** | Privacy-safe bounded dry-run **classifier** (§ 11.1): aggregate eligibility counts, no rows, no values. | Additive to the § 11 hard-block; authorizes no import. |
| **BR-SOURCE-10F** | Eligibility & legal-nature **calibration** (§ 11.2): lookups → `not_applicable_lookup`, establishments → `pending_company_join_context`, MEI/EI excluded; adds risk-class & positive-signal counts. | Legal nature is a signal, not an authorization; authorizes no import. |
| **BR-SOURCE-10G** | Company↔establishment bounded **join dry-run** (§ 11.3): associates establishments to company context by a structural, in-memory-only join id; aggregate join metrics, no rows, no values, no join keys. | Bounded sample only; establishments stay non-importable; authorizes no import. |
| **BR-SOURCE-10H** | Bounded join **coverage strategy** (§ 11.4): adds `establishment_keys_then_company_probe`; `coverage_is_representative` always false. | Bounded coverage probe only; authorizes no import. |
| **BR-SOURCE-10I** | Full join **import-readiness design** (docs-only): defines the conditions, envelope, join-key treatment, field survival contract, identity-grain decision gate, and required future gates for a future full local join. | Docs-only; decides no identity grain; authorizes no dry-run, import, Supabase write, runtime, or Agent 1. |
| **BR-SOURCE-10J** | Full join **dry-run technical design** (§ 11.6, docs-only): lowers the 10I contract into a future execution model, architecture options, temporary storage envelope, join-key handling, field discard timing, cleanup contract, resource limits, and future CLI/report contracts. | Docs-only; no runner, no command; decides no identity grain; authorizes no dry-run, import, Supabase write, runtime, or Agent 1. |
| **BR-SOURCE-10K** | Full join **approval gates checklist** (§ 11.7, docs-only): turns GATE-1 … GATE-8 into per-gate approval criteria (evidence, approver role, pass/fail, blockers, artifacts, allows / does-not-allow), plus a gate status model, dependency graph, approval-evidence template, and GO / NO-GO matrix. | Docs-only; no runner, no command; **approves no gate** (all eight `not_started` → NO-GO); authorizes no dry-run, import, Supabase write, runtime, or Agent 1. |
| **BR-SOURCE-10L** | Full join **gate evidence packet** (§ 11.8, docs-only): per gate, the evidence that exists, the evidence missing, the owner role required, the pending blocking decision, and the artifacts needed to reach `ready_for_review`; plus a cross-gate gap map. | Docs-only; no runner, no command; **approves no gate** (all eight `not_started`, `partial_evidence_collected` → NO-GO); decides no grain, allowlist, or storage envelope; authorizes no dry-run, import, Supabase write, runtime, or Agent 1. |
| **BR-SOURCE-10M / 10N / 10O** | Docs-only **decision records** proposing GATE-3 (field allowlist), GATE-4 (identity grain), and GATE-5 (output sanitization) for owner review. | Docs-only; no runner, no command; **approve no gate** (all eight `not_started` → NO-GO); authorize no dry-run, import, Supabase write, runtime, or Agent 1. |
| **BR-SOURCE-10PQR** | Remaining full join **gates decision packet** (§ 11.9, docs-only): proposes the GATE-6 failure cleanup contract, the GATE-7 operator runbook **contract** (not the runbook), and the GATE-8 no-write / no-runtime contract, plus a readiness table for all eight gates. | Docs-only; no runner, no command, no cleanup code, no guard, no test, **no runbook section**; **approves no gate** (all eight `not_started` → NO-GO); authorizes no dry-run, import, Supabase write, migration, index change, runtime, or Agent 1. |
| _(later)_ | Privacy-safe import implementation, then Supabase pilot, then Agent 1 gated integration. | Eligibility design (10D) + classifier (10E) + calibration (10F) + join dry-run (10G) + coverage strategy (10H) + full-join readiness design (10I) + full-join dry-run technical design (10J) + approval gates checklist (10K) + gate evidence packet (10L) + **every gate approved** + explicit approval first. |

---

## 16. GATE-7 operator runbook — the manual full-join dry-run procedure

> **This is the GATE-7 runbook section.** BR-SOURCE-10PQR § 6 landed the *contract* for it — who may
> operate, the twenty-two-item preflight `P-01` … `P-22`, the sixteen stop conditions `T-01` … `T-16`,
> the permitted-evidence list, and the assertions `OR-A01` … `OR-A20` — and was explicit that the
> section itself did not exist. It exists here, as an **extension of this runbook** rather than a
> competing document (10K § 11). Its machine-readable half is
> `src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-gate7-operator-runbook.ts`.
>
> 🔴 **A runbook is a PROCEDURE, never a PERMISSION.** Executing this procedure requires the separate,
> explicit authorization of a future milestone. Nothing in this section, in GATE-7, or in any gate of
> this series grants it. `BRAZIL_RECEITA_GATE7_SECTION_IS_A_PERMISSION` is `false`.
>
> 🔴 **GATE-7 is `blocked`, and this procedure cannot be run today.** `P-05` fails: GATE-2, GATE-5 and
> GATE-6 are unapproved. That is the checklist working, and there is deliberately no bypass.

### 16.0 How to read this section

Every step below has **one action** and **one definite pass condition**, per 10K § 11's pass criteria.
Three rules govern all of them and are not repeated per step:

1. **A failed step is a STOP, never a warning.** There is no "note it and continue".
2. **A warning is never a pass.** `BRAZIL_RECEITA_GATE7_WARNING_IS_EVER_A_PASS` is `false`.
3. **A ceiling is a DECISION, not a measurement.** The GATE-2 numbers are owner-chosen bounds
   (`OWNER_DECISION_VALUE`, `NOT_OBSERVED_MEASUREMENT`), not a proven envelope. Checking against them
   is checking against a decision.

### 16.1 Step 0 — who may operate

**Action.** Confirm the actor about to perform this procedure is a **named, authorized human
operator**.

**Pass condition.** `brazilReceitaGate7ActorMayExecute(actorClass)` returns `true`, which it does for
exactly one class: `named_authorized_human_operator`.

Refused classes, each explicitly:

```
agent                              automation
ci_runner                          cron_or_scheduled_job
background_task                    agent_acting_on_behalf_of_a_human
```

🔴 The last entry is not redundant. A human delegating this procedure to an agent is **an agent
executing it**, and 10PQR § 6.1 closes that door rather than trusting good intentions. The operator may
also not be the sole approver of GATE-7 (10K § 3's implementer rule).

Before continuing, the operator confirms aloud, in the run record: no cloud sync on the workspace; no
write-capable Supabase credential in the environment; no service role key; no import, runtime or
Agent 1 variables loaded; the mode is dry-run / no-write.

### 16.2 Step 1 — preconditions, read from the machine-readable state

**Action.** Read the authoritative gate state and evaluate the preconditions:

```
evaluateBrazilReceitaGate7Preconditions()
```

**Pass condition.** `result === 'PASS'`, i.e. every one of the eight gates is in an approved status.

**Today's result is `FAIL`**, and the outcome names which gates: `unapprovedGates` lists all of them
and `unapprovedBlockingGates` narrows it to GATE-2, GATE-5 and GATE-6 — the three GATE-7's own contract
names as blocking it.

🔴 There is **no bypass**. The function takes no arguments: no options object, no `force`, no
`assumeApproved`, no environment read. `bypassAvailable` is returned as `false` so a caller can assert
it, and `BRAZIL_RECEITA_GATE7_PRECONDITION_BYPASS_EXISTS` says the same thing at module level. A
procedure whose first step fails is not a broken procedure; it is the gate doing its job.

### 16.3 Step 2 — the twenty-two-item preflight

Perform `P-01` … `P-22` **in order**, recording pass or fail per item. The numbering is 10PQR § 6.2's
and is preserved exactly; `P-05` is first in substance and fifth in numbering, and renumbering it would
break the traceability the IDs exist for.

| item | action | pass condition |
|------|--------|----------------|
| `P-01` | confirm the working copy is clean, or the work is isolated in a dedicated worktree | no uncommitted modification outside a dedicated worktree |
| `P-02` | confirm the branch is the intended one, with no unintended local change | branch matches the authorization record; diff against it is empty |
| `P-03` | confirm `origin/main` is the commit the authorization names | the local SHA equals the authorized SHA, character for character |
| `P-04` | confirm every official design/decision document is present at its expected version | 10I, 10J, 10K, 10L, 10O and this runbook each resolve at their recorded version |
| `P-05` | **read the gate state** (§ 16.2) | `evaluateBrazilReceitaGate7Preconditions()` returns `PASS` — **FAILS today** |
| `P-06` | confirm the dataset root is outside the repository, in the controlled folder | the resolved root satisfies every § 16.5 workspace constraint |
| `P-07` | run the forbidden-family inventory check (§ 7) | the check **prints nothing** |
| `P-08` | validate the manifest (§ 10) | a **local file** manifest validates; a URL manifest is refused outright |
| `P-09` | inspect the output directory | empty, or holding only artifacts the cleanup contract permits |
| `P-10` | check for a stale ledger, lock file, or unresolved residue | none present |
| `P-11` | read the planned report file names | no real value of any kind appears in any planned name |
| `P-12` | measure free disk on the workspace volume | at or above the minimum-before-start figure, with the reserve figure still holding |
| `P-13` | compare available memory against the RSS, heap and external ceilings | the host holds all three simultaneously, with headroom |
| `P-14` | confirm no network dependency and no provider call in the planned run | none declared and no provider client reachable |
| `P-15` | inspect the environment for Supabase credentials | no anon key, no service role key, no connection string, of any kind |
| `P-16` | inspect the environment for runtime variables | none loaded |
| `P-17` | inspect the environment for Agent 1 variables | none loaded |
| `P-18` | confirm no hosting or feature-flag change is staged or intended | none staged, and none intended during the run |
| `P-19` | compare the configured sanitizer against the GATE-5 contract | matches the **frozen** contract **and** the contract is **approved** — the second half **FAILS today** |
| `P-20` | acknowledge the cleanup contract; state the escalation pair from memory | terminal statuses and escalation roles stated correctly |
| `P-21` | declare the storage envelope | the declared envelope is the GATE-2 approved option **and** GATE-2 is approved — **FAILS today** |
| `P-22` | confirm the dry-run confirmation flag will be passed | the flag is named correctly and the refusal behaviour is stated **before** starting |

🔴 **`P-19` and `P-21` are *checkable* and *failing*, which is not the same as *unusable*.** Before
Round 3 they had nothing to check against at all. Now they have a frozen contract and a chosen
envelope, and they fail on the second half of their own wording: *approved*. That is progress in the
checklist and none whatsoever in the gate.

### 16.4 Step 3 — resource preflight

**Action.** Verify each ceiling below **before** execution. Every figure is read from the record that
owns it; this section restates none of them, because a runbook that copies a cap is a runbook that can
disagree with the approval it claims to follow.

| signal | authority | kind |
|--------|-----------|------|
| RSS | `BRAZIL_RECEITA_GATE2_APPROVED_CAPS.maxRssBytes` | owner decision |
| heap used | `…maxHeapUsedBytes` | owner decision |
| external memory | `…maxExternalMemoryBytes` | owner decision |
| runtime | `…maxRuntimeMs` | owner decision |
| phase runtime | `…maxPhaseRuntimeMs` | owner decision |
| temporary storage | `…maxTemporaryStorageBytes` | owner decision |
| rows read | `…maxRowsRead` | owner decision |
| files opened | `…maxFilesOpened` | owner decision, **operator-supplied at invocation** |
| bytes read | `…maxBytesRead` | owner decision, **operator-supplied at invocation** |
| join keys in memory | `…maxJoinKeysInMemory` | owner decision, **operator-supplied at invocation** |
| minimum free disk before start | `BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_BEFORE_START` | standing proposal |
| minimum free disk reserve | `BRAZIL_RECEITA_FULL_JOIN_PROPOSED_MINIMUM_FREE_DISK_RESERVE` | standing proposal |

**Pass condition.** Every measured value is within its ceiling, and the three operator-supplied caps
are passed **explicitly on this invocation**. A written-down owner number is a value available for an
operator to supply — never a default the engine may read on its own.

🔴 `maxRowsRead` is an `OWNER_BUDGET_CEILING`, `NOT_OBSERVED`, and
`NOT_NATIONAL_ROW_COUNT_EVIDENCE`. Nobody counted Brazil's rows. Reading a nine-digit budget ceiling as
a dataset measurement is the mistake this series has already had to retract once.

### 16.5 Step 4 — workspace preflight

**Action.** Resolve the workspace directory and confirm every constraint. The constraints are imported
from `BRAZIL_RECEITA_GATE2_WORKSPACE_CONSTRAINTS`; the resolved directory is never recorded anywhere.

```
outside the repository, and outside every worktree of it
outside $HOME
outside the dataset root
no component of the path is a symlink
directory mode 0700
every file the run creates is mode 0600
no cloud sync, backup agent, or file-sharing client watches the directory
```

**Pass condition.** All seven confirmed.

🔴 **The resolved local path never appears in a sanitized report**, on any surface.
`BRAZIL_RECEITA_GATE7_LOCAL_PATH_MAY_APPEAR_IN_REPORTS` is `false`, and 10K § 14 forbids a real path in
an approval record.

### 16.6 Step 5 — dataset and manifest preflight

**Action.** Verify each item. **Any unexpected family is a HARD STOP.**

```
the publication period matches the one the authorization names
every declared family is an approved family
the Empresas multipart set is COMPLETE for the period
the Estabelecimentos multipart set is COMPLETE for the period
the required lookup families are present
no Socios family is present
no QSA family is present
no CPF or person-linked family is present
the manifest is a LOCAL FILE manifest; a URL manifest is refused
no archive extension appears among the declared data files
```

**Pass condition.** Every line above holds, and the § 7 forbidden-family check prints nothing.

🔴 A person-linked family in the folder is a **GATE-1** problem, not a data problem: the legal approval
on record covers company and establishment registry material, so its presence means the run would
process something nobody approved. `BRAZIL_RECEITA_GATE7_UNEXPECTED_FAMILY_DISPOSITION` is `HARD_STOP`.

**No real file is read at this step in this milestone.** The step exists; performing it requires the
authorization this section does not grant.

### 16.7 Step 6 — privacy preflight

**Action.** Evaluate the five approved contracts a future execution depends on:

```
evaluateBrazilReceitaGate7PrivacyPreflight()
```

| contract | owning gate | required status |
|----------|-------------|-----------------|
| temporary metadata envelope | GATE-2 | `approved` |
| field survival allowlist | GATE-3 | `approved` |
| exact identity grain | GATE-4 | `approved` |
| output sanitization | GATE-5 | `approved` |
| executable cleanup | GATE-6 | `approved` |

**Pass condition.** `result === 'PASS'`. Any contract whose owning gate is not `approved` is a **HARD
STOP**.

🔴 **There is no operator discretion here**, and `operatorDiscretionAvailable` is returned as `false`
so that is checkable rather than merely stated. An operator who can decide a `ready_for_review`
contract is "good enough" has replaced the gate model with a judgement call.

**Today's result is `FAIL`:** four of the five owning gates are unapproved.

### 16.8 Step 7 — live monitoring during the run

**Action.** Watch all ten signals continuously, each against the ceiling § 16.4 names:

```
RSS                     files and handles open
heap used               bytes read
external memory         rows read
disk / temp storage     join keys in memory
runtime                 phase runtime
```

**Pass condition.** Every signal stays within its ceiling for the whole run.

**On any breach, in this order and with no variation:**

```
1. stop the run
2. run cleanup and VERIFY it
3. record the outcome as a terminal failure
```

🔴 **No automatic retry.** `BRAZIL_RECEITA_GATE7_AUTOMATIC_RETRY_PERMITTED` is `false`, and `OR-A20`
makes a retry a new deliberate act preceded by the **full** preflight — never a re-run of the command.

🔴 **`ATTEMPT_3_ALLOWED` remains `false`.** The runbook module *imports*
`BRAZIL_RECEITA_REAL_BENCHMARK_ATTEMPT_3_ALLOWED` rather than restating it, so there is no second copy
to flip, and this section records no decision that changes it. Only a later explicit owner decision can.

### 16.9 Step 8 — output review

**Action.** Review **only** sanitized aggregate output, and only after the GATE-5 guard has passed it.

Permitted:

```
the sanitized aggregate JSON report, after the sanitizer boundary
the sanitized cleanup summary
the all-false safety booleans
the controlled exit code and the controlled error_code enum
the preflight completion state, item by item, pass or fail
```

Forbidden, on every channel including chat, tickets and review comments:

```
copying or pasting a raw row
screenshotting raw data — or the run terminal at all
manually editing a report to make it pass
enabling a hidden debug or verbose output mode
reading or sharing a path value
reading or sharing a stack
reading or sharing an identifier of any length
keeping a sample "just one example"
```

🔴 **"No manual editing of a report to make it pass" is here because it has to be.** A report edited
into compliance is the one failure mode no sanitizer can catch, and afterwards it is indistinguishable
from a report that passed honestly. Screenshots and terminal pastes are the same class of risk: 10O § 4
surface L records them as undetectable by any assertion, which makes these rules the **mitigation of
record**, not etiquette.

### 16.10 Step 9 — cleanup

**Action.** Run cleanup on **every** terminal path, then verify it. The paths are GATE-6's, imported
rather than restated:

```
success                 resource cap reached
failure                 sanitizer assertion failure
operator cancellation   report failure
memory limit            disk limit
manifest / layout / forbidden-family error
process crash  → reportNotExecuted, so an abandoned run still leaves a record
```

**Pass condition.** All three verifications hold:

```
every owned temporary artifact is ABSENT — verified, not assumed deleted
every handle the run opened is closed
zero residual entries across every registered unit
```

🔴 **A cleanup failure is TERMINAL.** `BRAZIL_RECEITA_GATE6_SUCCESS_WITH_RESIDUE_PERMITTED` is `false`:
there is no success-with-residue, and a `failed` or `not_executed` cleanup may not be upgraded by a
retry. `unit_deletion_unverified` means nobody may claim the material is gone — which is a different and
worse state than knowing it is still there.

Cleanup deletes only paths its owning module created. **No path is ever accepted from a caller.**

### 16.11 Step 10 — signoff

**Action.** Record the run signoff. It may carry **only** these kinds of value:

```
controlled_enum        safe_timestamp
boolean                approved_status_code
gate5_permitted_aggregate_count
```

**Pass condition.** `brazilReceitaGate7SignoffValueKindIsAdmissible(kind)` returns `true` for every
field in the signoff. The function is fail-closed: a kind it does not recognize is refused, so a novel
field name cannot pass by simply not being on the forbidden list.

Never, in a signoff or anywhere near it: a path, an identifier, a source value, a stack, a row sample,
a file name, an artifact name, a directory name, an environment variable, or any dataset value.

### 16.12 What this section does NOT establish

- **Reproducibility.** `BRAZIL_RECEITA_GATE7_REPRODUCIBILITY_BY_DIFFERENT_OPERATOR` is
  `UNDEMONSTRATED`. 10K § 11 requires the runbook to be reproducible by a different operator without
  tacit knowledge, and no document can demonstrate that — it needs a rehearsal, by an operator who did
  not author this section, against real ceilings. No rehearsal was performed and none is authorized.
- **GATE-7 approval.** The gate is `blocked` (10K § 11.1) on GATE-2, GATE-5 and GATE-6. Its three
  approvers — operator, technical and privacy owners, jointly — decide whether this section plus three
  approved upstream gates is enough to review, or whether they require the rehearsal first.
- **Any authorization at all.** No dry-run, no benchmark, no attempt-budget change, no real Receita
  read, no import, no Supabase write, no migration, no snapshot write, no runtime path, no Agent 1
  Brazil connection, no provider call, no production.
