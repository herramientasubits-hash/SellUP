# BR-SOURCE-14B.0K — Receita 2026-07 authoritative national inventory

**Status:** the expected 2026-07 national inventory is RESOLVED from the official publisher.
**Verdict:** `NATIONAL_INPUT_COMPLETENESS = incomplete`.
**Scope:** inventory, provenance and completeness only. No benchmark, no scan, no join, no row opened, no
file downloaded, extracted, copied, moved, renamed, chmod-ed or deleted.

BR-SOURCE-14B.0J built the national completeness gate and had to block on its own honesty: no
authoritative statement of what the Receita publishes for a period existed anywhere in this repository,
so the gate returned `indeterminate` and named the gap
(`no_declared_expected_part_inventory_for_any_period`). This milestone closes that gap for 2026-07 with
the publisher's own listing, and the answer is that the staged dataset is **one part of ten** per join
family — the coverage caveat 14B.0G could only state as prose is now a mechanical, per-identity fact.

---

## 1. Publisher evidence

| Field | Value |
|---|---|
| `PUBLISHER_SOURCE` | Receita Federal official publisher |
| `PUBLISHER_HOST` | `arquivos.receitafederal.gov.br` |
| `PUBLISHER_PERIOD` | `2026-07` |
| `sourceKey` | `br_receita_cnpj_dados_abertos` |
| `RETRIEVAL_TIMESTAMP` | `2026-08-11T14:43:57Z` |
| `RETRIEVAL_METHOD` | read-only directory metadata listing (WebDAV `PROPFIND`, `Depth: 1`) |
| `INVENTORY_SOURCE` | `official` |
| `INVENTORY_TRANSFORM` | `deterministic` (verbatim transcription; no inference, no fallback period) |
| `AUTHORITATIVE_INVENTORY_STATUS` | **`verified`** |
| Entries listed | 37 |
| Canonical inventory SHA-256 | `6c945a29dc1c59940e248acf0c66dca4ab9941210130636c628d872bcf614c69` |

The canonical hash is taken over `name|publishedSizeBytes` per entry, sorted, LF-terminated — the
normalization implemented by `canonicalBrazilReceitaPublisherInventoryText`. The dedicated test recomputes
it from the landed artifact, so an in-place edit to the transcription fails the suite.

Nothing was derived from 2026-01, from 2025, from community documentation, from the prose
"~10 parts", or from our own local download. Earlier months are context; they are not this period's
contract, and the parser has no code path that reaches another period.

### 1.1 Expected inventory — required join families

| Family | Parts | Exact published part identities |
|---|---|---|
| `empresas` | **10** | `Empresas0.zip` … `Empresas9.zip` (ordinals `0`–`9`) |
| `estabelecimentos` | **10** | `Estabelecimentos0.zip` … `Estabelecimentos9.zip` (ordinals `0`–`9`) |

Ordinals are `0`–`9` because that is what the Receita published for **this** period, recorded from the
listing itself — not because January looked the same.

Published sizes and last-modified stamps are preserved as metadata in the artifact
(`br-receita-cnpj-14b0k-publisher-inventory.ts`). Per § 15 they are provenance, **not** a completeness
criterion: a local part whose size differs from the published one still counts as present, and only an
explicit contract could change that.

### 1.2 Expected inventory — lookup / regime families

Single unnumbered file each, part key `single`:

| Family | Published entry | In pipeline contract |
|---|---|---|
| `cnaes` | `Cnaes.zip` | yes (optional) |
| `municipios` | `Municipios.zip` | yes (optional) |
| `naturezas` | `Naturezas.zip` | yes (optional) |
| `simples` | `Simples.zip` | yes (optional) |
| `motivos` | `Motivos.zip` | no — published, out of contract |
| `paises` | `Paises.zip` | no — published, out of contract |
| `qualificacoes` | `Qualificacoes.zip` | no — published, out of contract |

Optional means optional: no lookup family's absence can produce an `incomplete` verdict, because the
manifest contract requires exactly `empresas` and `estabelecimentos`. An out-of-contract family entering
an input WOULD be an unexpected substitution, and is checked as one.

### 1.3 Excluded families

| Family | Published entries | Disposition |
|---|---|---|
| `socios` | `Socios0.zip` … `Socios9.zip` | **excluded** — person-linked (Sócios / QSA / CPF) |

Transcribed and then refused, deliberately. Dropping them at transcription time would leave a reader
unable to tell an excluded family from one that was never published; instead they are classified by the
same denylist tokens the metadata reader uses, and the derived expected inventory cannot contain them.

---

## 2. Local inventory (read-only metadata)

The already-staged 2026-07 dataset was reused. It was inspected with `readdir` + `lstat` only — presence,
regular-file, non-zero size, symlink, family classification. No ZIP was opened, no CSV was parsed, no
reader was invoked, no row was read, and no `git` command was run anywhere near it (the code path contains
no `child_process` reference at all). No path, directory or local file name is recorded in this document.

| Family | Local part identities (input scope) |
|---|---|
| `empresas` | `0` |
| `estabelecimentos` | `0` |
| `cnaes` | `single` |
| `municipios` | `single` |
| `naturezas` | `single` |

All five input entries are regular files, non-zero, not symlinks. Unrelated entries in the directory
(dotfiles, the manifest document itself, report artifacts) are counted as ignored — they are not Receita
data files and cannot make a national dataset incomplete.

### 2.1 Comparison

| Metric | Value |
|---|---|
| `EXPECTED_EMPRESAS_COUNT` | 10 |
| `LOCAL_EMPRESAS_PARTS` | `0` |
| `MISSING_EMPRESAS_PARTS` | **`1,2,3,4,5,6,7,8,9`** |
| `EXTRA_EMPRESAS_PARTS` | none |
| `EXPECTED_ESTABELECIMENTOS_COUNT` | 10 |
| `LOCAL_ESTABELECIMENTOS_PARTS` | `0` |
| `MISSING_ESTABELECIMENTOS_PARTS` | **`1,2,3,4,5,6,7,8,9`** |
| `EXTRA_ESTABELECIMENTOS_PARTS` | none |
| `DUPLICATE_PARTS` | none |
| `UNEXPECTED_FAMILIES` | none |
| `PROHIBITED_FAMILIES_PRESENT_ON_DISK` | **false** |
| `PROHIBITED_FAMILIES_INCLUDED_IN_INPUT` | **false** |
| 14B.0J gate verdict | `incomplete` (`family_part_count_short` ×2) |
| 14B.0J gate `inputScope` | `staged_subset` |

The comparison is over part IDENTITIES, not counts. "Acquire Empresas 1–9" is actionable; "one of ten" is
not, and a count-only gate would report the same shortfall for a set holding part `0` ten times.

### 2.2 The two prohibited-family questions are different questions

Per § 10, and worth stating explicitly because conflating them either deletes an owner's files or waves
through a person-linked join:

- `PROHIBITED_FAMILY_PRESENT_ON_DISK` — a `Socios*` archive merely staged in a directory. Reported. Does
  **not** fail the dataset. Nothing is deleted; this milestone deletes nothing.
- `PROHIBITED_FAMILY_INCLUDED_IN_INPUT` — a person-linked family reaching the pipeline input. A hard
  reject, decisive over everything else, including an otherwise complete part set.

Both are `false` for the current dataset: no `Socios*` entry exists on disk, and none is declared in the
input.

---

## 3. Verdict

```
AUTHORITATIVE_INVENTORY_STATUS       verified
NATIONAL_INPUT_COMPLETENESS          incomplete

ATTEMPT_1_INPUT_SCOPE                staged_subset
ATTEMPT_2_REQUIRED_INPUT_SCOPE       full_national

REAL_DATA_ROWS_OPENED                0
REAL_SOURCE_READ_CALLS               0
REAL_SCAN_EXECUTED                   false
REAL_JOIN_EXECUTED                   false
SECOND_REAL_BENCHMARK_EXECUTED       false

ATTEMPT_1_CONSUMED                   true
REAL_BENCHMARK_ATTEMPTS_CONSUMED     1
STRUCTURALLY_SUPPORTED_REAL_ATTEMPTS 2
NEXT_REAL_ATTEMPT_NUMBER             2
ATTEMPT_2_AUTHORIZED                 false
ATTEMPT_2_EXECUTED                   false
ATTEMPT_3_ALLOWED                    false
NO_RESET_PATH                        true

REAL_BENCHMARK_AUTHORIZED            false
GATE2_APPROVED                       false
GATE7_APPROVED                       false
```

The attempt model is untouched: no ledger was written, no cap, engine, reader, parser, partitioner, FD
pool, buffering strategy, sanitizer or benchmark instrumentation was changed. This milestone supplies
evidence to a gate; it is not the gate, and it is not consent.

**NEXT_ACTION — OWNER REVIEW — ACQUIRE ONLY MISSING 2026-07 PARTS.**

Nine Empresas parts and nine Estabelecimentos parts, from the official publisher, for period `2026-07`
only. Nothing here downloads them: acquisition is an owner decision, and the person-linked `Socios*`
family must remain excluded from any acquisition and from the input manifest.

A second real full-national benchmark remains **unauthorized** and cannot become authorized by completing
the inventory. When the input does become `full_national`, the gate stops blocking on input scope and the
owner authorization for attempt #2 is the next and separate decision.

---

## 4. Reproducing this

The expected inventory is a versioned artifact in the connector, not a flag an operator can assert:

```
src/server/source-catalog/connectors/br-receita-cnpj/
  br-receita-cnpj-14b0k-publisher-inventory.ts          transcribed listing + fail-closed parser
  br-receita-cnpj-14b0k-national-inventory-resolution.ts pure identity comparison + gate integration
  br-receita-cnpj-14b0k-local-inventory-fs.ts            the only fs surface: readdir + lstat
```

The local side, against an operator-held dataset (paths are arguments and are never echoed):

```bash
npm run br-source:14b0k-resolve-national-inventory -- --period 2026-07 --input-dir <abs> --archive-dir <abs> --declared-source-key br_receita_cnpj_dados_abertos --declared-encoding latin1 --declared-delimiter ';' --declared-layout-mode official_headerless
```

A period without a transcribed publisher listing is refused with
`period_not_resolved_by_this_milestone` rather than resolved against a neighbouring month.

Tests: `npm run test:br-source:14b0k-national-inventory-resolution` (§ 19 contracts 1–30, plus the
end-to-end assertion that the real staged input resolves to `incomplete` with exactly parts 1–9 missing
per join family).
