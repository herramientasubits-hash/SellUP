# BR-SOURCE-14B.0L — acquiring only the missing 2026-07 national parts

**Status:** the 18 parts BR-SOURCE-14B.0K named as missing were acquired, verified and installed.
**Verdict:** `NATIONAL_INPUT_COMPLETENESS = complete` for the two required join families.
**Scope:** acquisition, verification, extraction and installation only. No benchmark, no scan, no join, no
import, no Supabase write, no provider call, and no data row opened.

BR-SOURCE-14B.0K resolved what the Receita publishes for 2026-07 and found the staged dataset holding
part `0` of ten per join family. This milestone closes that physical gap and nothing else. Completing a
dataset is not consent to traverse it: `ATTEMPT_2_AUTHORIZED` is still `false` at the end of this
document, exactly as it was at the start.

Two findings landed alongside the acquisition that the owner needs before deciding on attempt #2, and
both are reported rather than fixed, because fixing either is outside this milestone (§ 18). They are in
§ 6 and § 7.

---

## 1. Provenance

| Field | Value |
|---|---|
| `PUBLISHER` | Receita Federal |
| `PUBLISHER_HOST` | official publisher host (`arquivos.receitafederal.gov.br`) |
| `PUBLISHER_PERIOD` | `2026-07` |
| `RETRIEVAL_METHOD` | WebDAV `PROPFIND` `Depth: 1` for metadata; authenticated `GET` per ZIP |
| `AUTHORITATIVE_INVENTORY_STATUS` | `verified` (unchanged from 14B.0K) |
| Live canonical inventory SHA-256 | `6c945a29dc1c59940e248acf0c66dca4ab9941210130636c628d872bcf614c69` |

The listing was re-read before the first byte of any ZIP was requested, and the canonical
`name|publishedSizeBytes` normalization over the live 37 entries hashes to **the same digest** the
14B.0K artifact froze. So the publisher did not change under a frozen contract between the two
milestones, and every size assertion below is checked against that same authority.

No mirror, no GitHub release, no Kaggle copy, no third party and no invented filename took part. The
historical `arquivos.receitafederal.gov.br/dados/cnpj/...` paths remain 404 and were not retried; the
host root still answers `302` to the share the previous milestone identified.

**Token handling (§ 4).** The public-share token is operational, ephemeral metadata. It reaches the
operator script only through the `BR_RECEITA_SHARE_TOKEN` environment variable — never argv, which is
world-readable per process — and every line the script emits, including its JSON report, passes through a
redactor. It is not committed, not in any doc, not in git config and not in a repo `.env`. No local
absolute path appears in this document either.

---

## 2. Authorized scope, and what was refused

Exactly 18 files were authorized and exactly 18 were requested:

| Family | Ordinals acquired |
|---|---|
| `Empresas` | `1,2,3,4,5,6,7,8,9` |
| `Estabelecimentos` | `1,2,3,4,5,6,7,8,9` |

The target list is **derived from the frozen inventory**, not from a filename template. A part this
script would happily spell but which the publisher never listed cannot be requested, and the derivation
drops, structurally:

- `Empresas0.zip` and `Estabelecimentos0.zip` — already staged, explicitly out of scope;
- `Socios0.zip` … `Socios9.zip` and anything matching `socio` / `qsa` / `cpf` — person-linked, refused by
  denylist at derivation time and again at archive-member inspection;
- `Cnaes`, `Municipios`, `Naturezas`, `Simples`, `Motivos`, `Paises`, `Qualificacoes` — not part of this
  gap. The three lookups the pipeline uses were already present and were not re-downloaded.

`PROHIBITED_FILES_DOWNLOADED = 0`. `PROHIBITED_FAMILY_INCLUDED_IN_INPUT = false`.

---

## 3. Disk preflight — a gate, not an estimate

Evaluated in full **before the first ZIP `GET`**, from published sizes rather than guesses:

| Metric | Value |
|---|---|
| `TOTAL_MISSING_COMPRESSED_BYTES` | `3950274455` (3.68 GiB) |
| `REQUIRED_DOWNLOAD_SPACE` | 3.68 GiB |
| `EXTRACTION_SAFETY_ENVELOPE` | 22.07 GiB |
| `FREE_DISK_RESERVE_AFTER_ACQUISITION` policy | 15.00 GiB |
| `REQUIRED_STAGING_BYTES` | `43758048545` (40.75 GiB) |
| `AVAILABLE_BYTES_BEFORE` | 98.26 GiB |
| `DISK_PREFLIGHT_PASSED` | **true** (57.5 GiB headroom) |

No authoritative *uncompressed* size is published, so none was invented. Two guards replace the guess:

1. **Pre-download**, a declared conservative envelope of `6×` compressed size — comfortably above the
   `4.11×` and `3.18×` ratios observable on the already-staged part 0, which are measured local file
   metadata, not an assumption.
2. **Per-part**, once a ZIP is on disk its own central directory states the exact uncompressed size, and
   each extraction is gated on that real number plus the full 15 GiB reserve. The envelope only ever has
   to be right enough to enter the loop; the real number decides every actual write.

Staging and the final dataset live on **one** APFS volume, so the two availability figures are the same
number and were deliberately not added together. `AVAILABLE_BYTES_BEFORE` is the minimum of the two.

---

## 4. Per-part verification

Four gates per part, in order, every one of which must pass before the next begins:

| Gate | Check |
|---|---|
| `DOWNLOAD_VERIFIED` | transfer completed and byte count **equals** the published size |
| `ZIP_INTEGRITY_VERIFIED` | central directory readable, CRC test of every entry passes |
| `EXTRACTION_VERIFIED` | one safe member extracted, landed size equals the declared size |
| `FINAL_SOURCE_INSTALLED` | hardlinked into the input root under the part-0 naming convention |

**The published size is the identity, not a checksum.** The publisher exposes no digest; what 14B.0K
froze is `name|size`. So a size mismatch is not a sanity warning here — it is the identity assertion
failing, which means the publisher's bytes disagree with a frozen contract. A *short* read is treated as
a network fault and retried within a bounded, counted budget; a stable or *longer* length is a hard stop
for owner review and is never retried into acceptance.

**Member safety (§ 9).** Each archive is inspected before anything is written. Refused: more than one
member, absolute archive paths, `..` traversal, any directory component, symlink entries, a
person-linked member name, a member whose suffix belongs to the other family, and a member whose
internal part marker disagrees with the file name. Only the one validated member is then extracted, with
path components junked as a second line of defence. Structure and CRC are the only things read — no CSV
field is decoded and no record is parsed.

**What the run actually cost.** 16 of 18 parts succeeded on the first attempt. Two —
`Estabelecimentos5.zip` and `Estabelecimentos9.zip` — hit a transport failure and succeeded on the
second, for `downloadAttempts = 2` each; both then passed all four gates identically to the rest. The
retry budget was bounded at 3 and never exhausted, and because a truncated read is discarded rather than
resumed, neither retry could have produced a spliced file.

| Gate | Result |
|---|---|
| `DOWNLOAD_VERIFIED` / `ZIP_SIZE_MATCH_COUNT` | **18 / 18** |
| `ZIP_INTEGRITY_PASS_COUNT` | **18 / 18** |
| `EXTRACTION_PASS_COUNT` | **18 / 18** |
| `FINAL_SOURCE_INSTALLED` | **18 / 18** |
| `ACQUISITION_FAILED_PARTS` | **0** |

Extracted volume installed: `13125761432` B (12.22 GiB) — within the § 3 envelope and close to the
part-0 ratios it was derived from. `FREE_BYTES_AFTER = 88481689600` (82.40 GiB), so
`FREE_DISK_RESERVE_AFTER_ACQUISITION` clears the 15 GiB floor by a wide margin. Staging was left empty:
every archive was promoted out of it, and no `.partial` survived.

---

## 5. Part 0 untouched, and the layout parts 1–9 joined

Part 0 metadata was captured before the first write and re-checked after the last. Inode, size, mode,
link count and mtime are identical across all six part-0 paths:

`EXISTING_EMPRESAS0_UNCHANGED = true` · `EXISTING_ESTABELECIMENTOS0_UNCHANGED = true`

Nothing was renamed, chmod-ed, re-extracted or overwritten, and the script refuses outright to write to
an input or archive target that already exists rather than trusting itself not to.

Parts 1–9 were installed exactly the way part 0 already was, which the audit of § 9 established rather
than assumed: one member per ZIP (`K3241.K03200Y<n>.D60711.EMPRECSV` / `…ESTABELE`), extracted under
`extracted/<family><n>/`, then **hardlinked** to `manifest-input/<family><n>.csv`. The hardlink is why
completing the dataset costs the extracted bytes once rather than twice.

`ZIP_REMOVED_AFTER_VERIFIED_EXTRACTION = false` — the ZIPs were retained. Part 0's archive is retained
too, so this matches the dataset's existing shape, keeps re-extraction possible without re-downloading
from a public publisher, and the disk envelope has ample room for it (§ 3). Retention happens only after
extraction is proven; the ZIP is promoted out of staging as the last step, never before.

---

## 5.1 The authoritative re-check

Completeness is not this milestone's opinion. The 14B.0K resolver was re-run unchanged against the
dataset, and it is the artifact of record:

```
authoritative_inventory_status        verified
national_input_completeness           complete
gate_verdict                          complete
gate_findings                         none

required empresas          expected 0–9 · local 0–9 · missing none · extra none
required estabelecimentos  expected 0–9 · local 0–9 · missing none · extra none

duplicate_parts                       0
local_part_defects                    none
unexpected_families                   none
prohibited_family_present_on_disk     false
prohibited_family_included_in_input   false

rows_read                             0
source_read_calls                     0
scan_executed                         false
join_executed                         false
```

**One divergence, deliberately.** That tool ends with
`next_action = OWNER AUTHORIZATION — SECOND REAL FULL-NATIONAL BENCHMARK`, because its mapping treats a
complete input as the last thing standing between the owner and attempt #2. It was written before § 6
below was known, and it inspects the dataset, not the reader that would consume it. This milestone's
`NEXT_ACTION` is therefore **not** the tool's, and § 8 states the reason.

---

## 6. Blocker — the input contract cannot reference more than one part per family

**This is the finding that matters most for attempt #2, and physical completeness does not resolve it.**

The real full-scan benchmark builds its source list through
`resolveBrazilReceitaFullJoinManifestSources` and hands `bridge.joinSources` to the engine. The engine
itself is genuinely multi-source — it addresses sources by `sourceFileOrdinal` and carries that ordinal
into every row reference. The **bridge** is what narrows it: one manifest entry per `fileType`, one
`declaredPath` string per entry, and a second entry for a family is refused outright as
`family_duplicated`, on the stated grounds that two descriptors for one role would either silently win or
silently double the traversal. The older `local_manifest_validation` path refuses the same shape as
`duplicate_file_type`.

So a manifest naming `Empresas0..9` and `Estabelecimentos0..9` — what § 14 asks for — **cannot currently
be expressed**: both readers reject it by design, not by oversight. Reaching a full-national traversal
needs the bridge to accept an ordered list of parts per family, which is an engine-contract change and
is explicitly out of scope here (§ 18 — no engine redesign).

Consequences, stated plainly:

- The 20 parts are on disk and verified. **The pipeline can still only read 1 of 10 per family.**
- The manifest was therefore **not** rewritten to list 20 parts. Writing a manifest that every reader
  refuses would convert a clear blocker into a confusing runtime failure.
- `NATIONAL_INPUT_COMPLETENESS = complete` describes the **dataset**. It does not mean the benchmark can
  consume it.

```
NATIONAL_MULTI_PART_INPUT_CONTRACT_REVIEW_REQUIRED = true
```

### 6.1 A correction to the coverage caveat, by bytes

14B.0K recorded that benchmark #1 covered "~1/10" of the national universe. That is exact **by part
count** and materially misleading **by volume**, because the publisher's part 0 is far larger than its
siblings in both families:

| Family | Part 0 | Parts 1–9 combined | Part 0 share |
|---|---|---|---|
| `Empresas` | 544,290,225 B | 815,927,464 B | **40.0 %** |
| `Estabelecimentos` | 2,164,567,397 B | 3,134,346,991 B | **40.9 %** |

Benchmark #1 therefore traversed roughly **40 % of the compressed national volume**, not 10 %. This
raises the observed floor on a full-national run rather than lowering it, and the owner should size
attempt #2 against ~2.5× benchmark #1's input, not ~10×. Recorded as an observation; no ledger, cap or
recommendation in 14B.0G/14B.0J was edited.

---

## 7. CNPJ alphanumeric compatibility — read-only static audit

July 2026 coincides with the alphanumeric CNPJ entering production, so the identifier contract was
audited statically. No real row was opened to look for one.

```
CNPJ_IDENTIFIER_CONTRACT = alphanumeric_compatible
```

The join path does **not** require `[0-9]`:

- `normalizeBrazilReceitaFullJoinKey` — the function whose output the engine compares — is
  character-class agnostic. It trims, strips one layer of wrapping quotes, and rejects only empty and
  over-long values. An alphanumeric key joins correctly today.
- `br-cnpj.ts` implements the official alphanumeric algorithm deliberately: identity positions 1–12 are
  `[A-Z0-9]`, the two check digits are `[0-9]`, and the DV uses the documented `char − 48` valuation. Its
  own header states a CNPJ is always a normalized alphanumeric string, never digits-only.

But one layer is numeric-only, and it is the layer that exists to prevent leaks:

```
CNPJ_ALPHANUMERIC_COMPATIBILITY_REVIEW_REQUIRED = true
```

scoped to **detection and redaction**, not to the join:

- `br-receita-cnpj-full-join-output-sanitizer.ts` matches identifiers with `\d`-only patterns —
  `\d{14}` for a full CNPJ, `\d{8}` for a CNPJ básico, `\d{8,}` for a long run. An alphanumeric CNPJ
  matches none of them, so a value the sanitizer is supposed to redact from a report could pass through
  unredacted.
- `br-receita-cnpj-privacy-safe-classifier.ts` detects identifiers by digit-run length
  (`CNPJ_LIKE_MIN_DIGIT_RUN = 14`), so an alphanumeric CNPJ would not be counted as CNPJ-like.

Neither was changed here (§ 15 forbids it, and the redaction layer is not something to adjust in passing
during an acquisition). Exposure from this run is nil — no row was read and no report contains source
values — but this must be resolved before the BR source is called production-ready.

---

## 8. Verdict

```
AUTHORITATIVE_INVENTORY_STATUS        verified
PUBLISHER_PERIOD                      2026-07

ACQUISITION_AUTHORIZED_PARTS          18
ACQUISITION_ATTEMPTED_PARTS           18
ACQUISITION_SUCCEEDED_PARTS           18
ACQUISITION_FAILED_PARTS              0

LOCAL_EMPRESAS_PARTS                  0,1,2,3,4,5,6,7,8,9
LOCAL_ESTABELECIMENTOS_PARTS          0,1,2,3,4,5,6,7,8,9
MISSING_EMPRESAS_PARTS                (none)
MISSING_ESTABELECIMENTOS_PARTS        (none)
EXTRA_PARTS                           (none)
DUPLICATE_PARTS                       (none)

EXISTING_PART0_UNCHANGED              true
PROHIBITED_FILES_DOWNLOADED           0
PROHIBITED_FAMILY_INCLUDED_IN_INPUT   false

NATIONAL_INPUT_COMPLETENESS           complete
ATTEMPT_2_REQUIRED_INPUT_SCOPE        full_national

REAL_DATA_ROWS_OPENED                 0
REAL_SOURCE_READER_CALLS              0
REAL_SCAN_EXECUTED                    false
REAL_JOIN_EXECUTED                    false
SECOND_REAL_BENCHMARK_EXECUTED        false

REAL_BENCHMARK_ATTEMPTS_CONSUMED      1
STRUCTURALLY_SUPPORTED_REAL_ATTEMPTS  2
NEXT_REAL_ATTEMPT_NUMBER              2
ATTEMPT_2_AUTHORIZED                  false
ATTEMPT_2_EXECUTED                    false
ATTEMPT_3_ALLOWED                     false
NO_RESET_PATH                         true

REAL_BENCHMARK_AUTHORIZED             false
GATE2_APPROVED                        false
GATE7_APPROVED                        false
```

The attempt ledger was not read, written or reset by this milestone — a download is not an attempt, and
restarting one is not a retry of anything the ledger governs. No cap, engine, reader, parser,
partitioner, FD pool, buffering strategy, sanitizer or instrumentation was touched.

**NEXT_ACTION — OWNER REVIEW — NATIONAL MULTI-PART INPUT CONTRACT.**

Not "authorize benchmark #2". The dataset is complete, but § 6 means a full-national traversal is not
yet expressible: the bridge would read one part per family and a 40 %-of-volume run would be
misreported as a national one. The multi-part input contract is the next decision, and authorizing
attempt #2 before it is resolved would spend the last structurally supported attempt on the same
partial input that benchmark #1 already consumed.

---

## 9. Reproducing this

Paths are arguments and are never echoed. The token is read from the environment only:

```bash
BR_RECEITA_SHARE_TOKEN=<token> npm run br-source:14b0l-acquire-missing-national-parts -- \
  --period 2026-07 \
  --staging-dir <abs> --archive-dir <abs> --extract-dir <abs> --input-dir <abs> \
  --report-path <abs>
```

`--dry-run` evaluates the § 3 preflight and stops before the first `GET`. `--discard-zips` deletes each
archive after its extraction is proven, for a tighter disk envelope. Parts already installed are skipped
whole, so an interrupted run resumes without re-downloading verified work (§ 19), and a period with no
frozen inventory is refused with `period_not_resolved_by_this_milestone`.

Operator: `scripts/source-catalog/run-br-receita-cnpj-14b0l-acquire-missing-national-parts.ts`.
