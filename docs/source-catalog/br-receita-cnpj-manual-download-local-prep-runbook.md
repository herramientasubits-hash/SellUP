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
- `<YYYY-MM>` is the monthly period tag of the Receita release you downloaded.
- The manifest lives at the top of that folder; data files live under
  `extracted/`. Manifest paths are written **relative to the manifest's own
  directory** (see § 8). Example relative path: `extracted/empresas.csv`.

---

## 5. What the user downloads manually

The operator must manually obtain the public **Receita Federal CNPJ Dados
Abertos** files from the official source already documented for this project.
Per the project blueprint (`br-source-classification-and-activation-blueprint.md`),
the approved access points are the official government mirrors
(`dados.gov.br` / `arquivos.receitafederal.gov.br`); downloads from outside
Brazil can time out, so a mirror may be required.

Do **not** rely on any URL that is not already documented as a project-approved
source. This runbook does not embed a download link and does not download on the
operator's behalf.

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

## 12. Expected safe outputs

Both runners emit only a **sanitized report**:

- file types and safe file labels (basename only, never a full path);
- byte sizes;
- a SHA-256 truncated to a 12-character prefix (`sha256Hash12`);
- layout / header validation status (`passed` / `failed` / `skipped`);
- for the dry-run, bounded **sample row counts** only.

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
| **BR-SOURCE-10C** | Controlled Supabase pilot. | Explicit approval only. |
| _(later)_ | Lookup / enrichment adapter, then Agent 1 gated integration. | Adapter + gated runtime design first. |
