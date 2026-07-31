# BR-SOURCE-11H — Bounded real join coverage decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11H — Bounded real join coverage decision record (docs-only)
**Status:** `proposed_for_owner_review` — **not** a gate approval, and **not** an authorization for a coverage signal, coverage percentages, import, Supabase, runtime, or Agent 1
**Predecessor:** BR-SOURCE-11G-IMPL-LAND — `BRSOURCE11GIMPLLANDA — ULTRA_BOUNDED_REQUIRED_FAMILY_REAL_JOIN_PROBE_MERGED` (PR #178, `main` HEAD `5308363fb46c7612812af973c26117cb97d1f6c3`), validated post-merge by BR-SOURCE-11G-IMPL-V — `BRSOURCE11GIMPLVA`
**Predecessor record:** BR-SOURCE-11G-LAND — `BRSOURCE11GLANDA — BOUNDED_REAL_JOIN_DRY_RUN_DECISION_RECORD_MERGED` (PR #176, `main` HEAD `f65c402d2f53eca52e555047902cd91c2bada64f`)
**Last reviewed:** 2026-07-30

**Related documents:**
- GATE-2 route decision package (BR-SOURCE-11J, docs-only) — [`br-receita-cnpj-gate2-route-decision-package.md`](./br-receita-cnpj-gate2-route-decision-package.md)
- Bounded real join dry-run decision record (BR-SOURCE-11G, Option C authorized and implemented) — [`br-receita-cnpj-bounded-real-join-dry-run-decision-record.md`](./br-receita-cnpj-bounded-real-join-dry-run-decision-record.md)
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

> This document **asks one question and answers nothing**. BR-SOURCE-11G proved, under caps, that a
> join mechanism can execute over two tiny real windows without leaking the protected technical join
> key. It proved nothing about how often the two required families actually relate — the `zero` it
> reported is a statement about two 20-row prefixes and nothing more. The only step smaller than
> "measure the dataset" is a coarse, bucketed, aggregate-only *signal* over a slightly larger but
> still tiny window. Whether such a signal may be authorized at all is the entire subject of this
> record.
>
> Nothing here authorizes — and nothing here should be read as authorizing — collecting a coverage
> signal, computing a coverage percentage, computing a ratio or match rate, claiming a full-dataset
> denominator, executing a new join over real data, opening any additional file, opening a catalog
> file, opening a ZIP, a dataset download, full-dataset processing, import, a Supabase write, a
> production write, a migration, an index change, a runtime change, an adapter/validator change, an
> Agent 1 integration, a provider call, a HubSpot sync, a Slack notification, live generation, full
> expansion, or merge to an operational state. **§ 1–17 record a decision question; they decide
> nothing and execute nothing.**

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
This record does not authorize bounded real join coverage execution.
This record does not authorize full join execution.
This record does not authorize exact coverage percentages.
This record does not authorize row-level coverage evidence.
This record does not authorize import.
This record does not authorize Supabase writes.
This record does not authorize runtime.
This record does not authorize Agent 1.
```

Five clarifications, restated because every milestone in this series has shown how easily they are
conflated:

- **A merged decision record is not an authorization.** Merging this record makes the *question*
  official. The answer is a separate, exactly-worded owner phrase (§ 13), given after this record is
  official, and it would authorize only the option it names.
- **A mechanism existing in code is not an approval.** BR-SOURCE-11G-IMPL landed the join-probe
  module, the fifth manifest trust, the join caps, and seven sanitizer leak kinds — including
  `coverage_payload`, which exists *precisely to refuse* what this record asks about. Those are
  mechanisms of GATE-5, GATE-6 and GATE-8. All eight gates remain `not_started` / not approved.
- **A working join mechanism is not a joinable dataset.** 11G proved that two capped windows can be
  compared without leaking the key. It did not prove that the two families relate, at any rate, over
  any portion of the dataset.
- **The 11G authorization did not survive its milestone.** The Option C phrase of BR-SOURCE-11G was
  single-milestone by its own § 8.1 and expired with it. It authorized a probe of the join mechanism.
  It never authorized measuring anything, and a phrase naming the *probe* authorizes nothing here.
- **This record's caps are larger than 11G's, and that is the decision.** § 10 proposes 8× the bytes
  and 10× the rows of the 11G ceilings. That is a real escalation of exposure, stated plainly rather
  than buried, and an owner may reasonably decline it (§ 7, Option A).

---

## 2. Background

```text
BR-SOURCE-11A created the no-write/no-runtime runner scaffold.
BR-SOURCE-11B validated synthetic_fixture_only.
BR-SOURCE-11C implemented synthetic temp-manifest.
BR-SOURCE-11D-META defined and implemented real manifest metadata-only.
BR-SOURCE-11E executed real manifest metadata-only.
BR-SOURCE-11F defined, implemented and validated the ultra-bounded required-family real data-file
  probe.
BR-SOURCE-11G defined, implemented and validated the ultra-bounded required-family real join probe.
11G proved only that an in-memory join mechanism can execute over a tiny real capped window without
  leaking the protected join key.
11G did not compute join coverage.
11G did not compute dataset quality.
11G did not authorize wider scans.
The next possible step is a decision on whether to collect a bounded, aggregate-only join coverage
  signal.
```

### 2.1 The sequence, and what each step actually established

| Milestone | Verdict | What it established | What it did **not** establish |
|-----------|---------|---------------------|-------------------------------|
| BR-SOURCE-11A-LAND | `BRSOURCE11ALANDA` | The full join dry-run runner scaffold merged, always refusing. | Nothing about real input. |
| BR-SOURCE-11B | `BRSOURCE11BA` | Post-merge validation in `synthetic_fixture_only`. | Nothing about manifests, files, or the dataset. |
| BR-SOURCE-11C-R / 11C-LAND / 11C-V | merged, validated | Manifest plumbing against synthetic temp manifests only. | Anything about the real dataset. |
| BR-SOURCE-11D-META (+ IMPL) | merged | Real-manifest metadata-only question and a one-path reader. | Any real execution. |
| BR-SOURCE-11E-LAND | `BRSOURCE11ELANDA` | One operator-prepared manifest executed metadata-only. | Anything about file content, rows, coverage, or either gate. |
| BR-SOURCE-11F-IMPL-LAND | `BRSOURCE11FIMPLLANDA` (PR #173) | Two required-family files opened under caps; structure only. | Any join, any join key, any coverage figure. |
| BR-SOURCE-11F-IMPL-V | `BRSOURCE11FIMPLVA` | Post-merge validation of the structural probe. | Same limitation, restated. |
| BR-SOURCE-11G-LAND | `BRSOURCE11GLANDA` (PR #176) | The bounded real join question, official. | No gate. A merged question is still a question. |
| BR-SOURCE-11G-IMPL-LAND | `BRSOURCE11GIMPLLANDA` (PR #178) | Option C implemented and executed once: the join mechanism runs on real input under caps, aggregate-only. | Any coverage figure, any rate, any dataset statement, any gate. |
| BR-SOURCE-11G-IMPL-V | `BRSOURCE11GIMPLVA` | Post-merge validation that the join probe behaves exactly as the merged docs declare. | Same limitation, restated. |

### 2.2 The 11G evidence, quoted exactly, and read at its real strength

```text
real join probe        = PASS
run_mode               = local_manifest_dry_run
manifest_trust         = real_manifest_required_family_join_probe

families_attempted     = ["empresas","estabelecimentos"]
files_opened_count     = 2
files_opened_by_family = { empresas: 1, estabelecimentos: 1 }

bytes_read_bucket      = lte_64kb
rows_read_bucket       = lte_20

row_shape:
- empresas:          20/20 válidas, 7 columnas
- estabelecimentos:  20/20 válidas, 30 columnas

join_executed          = true
join_mode              = ultra_bounded_required_family_in_memory
match_result_bucket    = zero
matched_rows_bucket    = zero
unmatched_rows_bucket  = lte_20

join_key_values_printed  = false
join_key_values_retained = false
join_key_hashes_printed  = false
join_key_error_leak      = false

joined_rows_printed        = false
joined_samples_printed     = false
joined_pairs_emitted       = 0

coverage_percentage_printed = false
coverage_claimed            = false
join_coverage_computed      = false

raw_rows_printed        = false
raw_cells_printed       = false
identifiers_printed     = false
filenames_printed       = false
absolute_paths_printed  = false
hashes_printed          = false

full_dataset_processed  = false
import_executed         = false
supabase_write          = false
runtime_integration     = false
agent1_integration      = false
provider_calls          = false
production_writes       = false

errors                     = []
forbidden_output_findings  = 0
gates                      = 8/8 not_approved
```

Every value above is a count, a boolean, a coarse bucket, or an expected-column-count schema constant.
The column counts (`7`, `30`) are **layout facts about the official Receita file format**, not
observations about any company. The load-bearing lines for this record are the three at the bottom of
the join block: `coverage_percentage_printed = false`, `coverage_claimed = false` and
`join_coverage_computed = false`. Those are precisely the assertions BR-SOURCE-11H asks whether to
touch — and asks only, without touching them.

The correct reading of the 11G outcome, restated verbatim from its own record:

```text
11G-IMPL probó que el mecanismo de join funciona sobre input real bajo caps.
11G-IMPL NO probó cobertura.
11G-IMPL NO probó calidad global del dataset.
11G-IMPL NO autorizó ampliar caps.
11G-IMPL NO autorizó full join.
11G-IMPL NO autorizó import.
11G-IMPL NO aprobó gates.
match_result_bucket = zero NO es fallo y NO justifica ampliar caps.
```

That last line deserves its own emphasis, because this record could easily be misread as its
contradiction. **This record is not proposed because 11G returned `zero`.** Two independently-sharded
20-row prefixes are the pair of windows in the whole dataset least likely to overlap; `zero` was the
expected outcome and is not a problem to be solved by widening. The question below would be exactly
the same question if 11G had returned `one_or_more`.

### 2.3 What has structurally *not* happened yet

```text
No coverage figure, ratio, percentage, or match rate about the real dataset exists.
No denominator tied to full dataset size has ever been computed or claimed.
No join has been executed over real data outside the single 11G probe window.
No more than two data files have ever been opened in one run.
No more than 20 rows per file have ever been read.
No catalog file has been opened.
No Socios / QSA / CPF / person file has been opened.
No ZIP has been opened.
No dataset has been downloaded by SellUp automation.
No row of Receita data has survived the loop iteration that read it.
No join key value has survived the bounded window that held it.
```

That list is the boundary this record does **not** move. It asks whether a future, separately
authorized milestone may move the first two lines of it into *bucketed, aggregate-only* form — and
only those, under caps.

### 2.4 The prior art this record must not contradict

BR-SOURCE-10H designed a bounded join **coverage** strategy in which `coverage_is_representative` is
always `false`; BR-SOURCE-10G designed the bounded company↔establishment join whose key is ephemeral
and in-memory only. Both are official designs and neither is an authorization. BR-SOURCE-11G's § 6
Option E named "bounded real join coverage dry-run" as `high` risk and deferred it explicitly to this
record, and its § 15 mapping requires this record to "resolve the temp-storage envelope question with
GATE-2".

This record does not resolve that question, and it must not be read as having done so. It proposes a
**strictly smaller** thing than 10H designs and than 11G's Option E named: not a coverage estimate at
all, but a coarse bucketed signal over a bounded window, with the exact percentage, the ratio and the
full-dataset denominator all forbidden as refusals rather than caveats. Whether even that is
acceptable before GATE-2 defines a storage and processing envelope is the owners' call, not this
record's.

---

## 3. Decision question

```text
Can SellUp authorize a bounded real join coverage signal dry-run between Empresas and
Estabelecimentos, executed only in memory, under hard caps, using protected join keys ephemerally,
emitting only coarse aggregate buckets, without exact percentages, without row-level samples, without
identifiers, without join keys, without joined rows, without import, without Supabase, without
runtime, and without approving any gate?
```

### 3.1 What the question is deliberately **not** asking

- It is not asking whether Brazil may be imported. That is `OPS_BR_READY_FOR_IMPORT`, unchanged and
  `false`.
- It is not asking whether the real dataset may be processed. That is `FULL_JOIN_EXECUTION_READY`,
  unchanged and `false`.
- It is not asking whether an **exact coverage percentage** may be produced. That is § 7, Option E,
  explicitly not recommended and explicitly not authorizable by this record.
- It is not asking whether a **full-dataset denominator** may be claimed. § 5 forbids it in every
  option, including the recommended one.
- It is not asking whether **catalog** families may be opened. That remains a separate decision.
- It is not asking whether a join key may be **persisted**, promoted to `record_identity_key`, or
  promoted to `normalized_tax_id`. Those are forbidden outright by § 6, and by GATE-3, GATE-4 and
  GATE-5 independently of anything decided here.
- It is not asking the owners to approve GATE-1 or GATE-2 quickly, informally, or by implication.
- It is not asking for standing permission. Any authorization granted under this record is scoped to
  the single next milestone that consumes it, and expires with that milestone.

### 3.2 Why the question arises now

1. **11G exhausted the mechanism surface.** Re-running the join probe at the 11G caps produces the
   same three-value bucket over the same two prefixes. There is no further signal available from the
   mechanism itself.
2. **The remaining unknown is frequency, not feasibility.** The Brazil source model assumes an
   establishment row can be associated with its company row. 11G established that the comparison can
   be *performed*. It says nothing about whether the comparison ever *succeeds* — and a source whose
   two required families never relate is a source SellUp should stop investing in, cheaply and early.
3. **Counter-reason, stated plainly and given equal weight.** A coverage signal is not a lighter
   operation than a probe — it is a strictly heavier one, in the two dimensions that matter most.
   First, **volume**: § 10 proposes 8× the bytes and 10× the rows of the 11G ceilings, which is
   exactly the axis GATE-2 exists to govern. Second, **inferability**: a bucket count over a larger
   window is closer to a ratio than a bucket count over 20 rows, and every additional bit of
   resolution is a bit a reader can attempt to divide. An owner may reasonably decide that no volume
   of bucketing makes a *frequency* statement acceptable before GATE-1 and GATE-2 are approved on
   their own merits, and choose Option A. **That is a legitimate answer to this question**, and this
   record does not treat it as a delay.

---

## 4. Non-goals

```text
This is not import readiness.
This is not production readiness.
This is not live prospect generation.
This is not Agent 1 integration.
This is not Supabase staging.
This is not HubSpot enrichment.
This is not a legal/privacy approval.
This is not a storage approval.
This is not full dataset coverage.
This is not a quality score.
This is not a claim that Receita CNPJ data is operationally usable.
This is not GATE approval.
```

Three further non-goals, because the series has seen all three misread before:

- **It is not the full join dry-run.** The full join dry-run designed in BR-SOURCE-10J measures the
  whole dataset with a real denominator. A bounded signal establishes only that the join mechanism
  produces a non-degenerate outcome class over a bounded window.
- **It is not a data-quality verdict.** A `zero` bucket over a bounded window is not evidence the
  dataset does not join, and a `lte_200` bucket is not evidence that it does. § 11 therefore keeps
  `not_reported` a first-class result and § 5 forbids any inference from either.
- **It is not a commitment to Brazil.** Authorizing a signal is not a decision to continue investing
  in Brazil ingestion; it is a decision to buy information cheaply before making that decision.

---

## 5. Coverage terminology and risk statement

The distinctions this record depends on, stated before anything else uses the word:

```text
coverage signal        ≠ production coverage
coverage bucket        ≠ exact percentage
bounded dry-run        ≠ full dataset evidence
aggregate-only signal  ≠ row-level evidence
zero/low bucket        ≠ failure
high bucket            ≠ production readiness
```

```text
The word "coverage" is risky because it can be misunderstood as a production-quality measurement.

For BR-SOURCE-11H, any approved run must use "coverage signal" language rather than "coverage proof"
or "coverage guarantee".

No exact coverage percentage may be printed.
No denominator tied to full dataset size may be claimed.
No row-level evidence may be printed.
No business or production claim may be made from the result.
```

### 5.1 Why this section exists, and why it is placed first

Every prior milestone in this series could be misread only in one direction: someone might think a
green run meant more than it did. This milestone can be misread in that direction *and* be quoted out
of context, because it would produce the first artefact in the whole Brazil programme that **sounds
like a number about the dataset**. "Coverage" is a word that survives summarization; the caveats
around it do not.

Four consequences follow, all load-bearing:

- **The denominator is the whole risk.** `matched_rows_bucket = lte_200` is a statement about a
  bounded window. The identical value written as "X% coverage" is a statement about Brazil. The two
  are separated by nothing but a division, which is why § 10 makes `exactPercentageAllowed = false`
  and `fullDatasetDenominatorAllowed = false` **required caps** and § 11 makes
  `denominator_scope = bounded_window_only` a mandatory emitted field rather than a footnote.
- **A refusal is not a caveat.** BR-SOURCE-10H's approach was to compute coverage and label it
  `coverage_is_representative = false`. This record deliberately takes the stricter path: do not
  compute it, and refuse if it is requested. A label can be stripped by a reader; a value that was
  never produced cannot.
- **Bucket granularity is a privacy control, not a UX choice.** Coarse buckets exist so no downstream
  reader can reconstruct a rate. A cap that permitted finer buckets — deciles, counts, a
  matched/unmatched pair — would defeat the control while appearing to honour it.
- **The language obligation binds the report, not just the code.** An authorized run's human summary,
  its commit message, its PR body, and any status note quoting it must say "coverage signal" and must
  state the bounded-window scope. A correct JSON payload described in prose as "Brazil coverage" has
  leaked the claim the payload refused to make.

---

## 6. Join key risk statement

```text
The join between Empresas and Estabelecimentos relies on a protected technical root key, commonly
represented in Receita CNPJ files as the shared company root / cnpj_basico.

For SellUp governance, this remains a protected technical join key.

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

### 6.1 What changes relative to BR-SOURCE-11G, and why it is not nothing

BR-SOURCE-11G § 5 established these rules and BR-SOURCE-11G-IMPL enforced them structurally: one
field position per row, a capped in-memory `Set`, a membership test, and a release before any
aggregate is assembled, asserted by static source guard and by error-path tests. This record does not
weaken a single one of them, and any implementation must inherit them unchanged.

What changes is **scale**, and scale is the whole of the delta:

- **The in-memory window grows 10×.** `maxJoinKeyValuesInMemory` moves from `40` to `400` (§ 10). The
  guarantee is still "bounded, unreportable, released before emit" — but the bound is larger, and
  larger bounds are what GATE-2's temp-storage envelope exists to govern. This is stated as an
  escalation, not smuggled in as a parameter change.
- **The held set is more inferable at the margin.** Forty keys cannot support a rate; four hundred
  begin to look like a sample to a reader who wants one. The mitigation is not smaller memory — it is
  the § 11 output contract refusing every field a rate could be built from.
- **Hashing remains closed.** The output sanitization record forbids any hash, truncation, or
  fingerprint derived from an identifier or from the join key (`OS-A13`). A larger window does not
  create an anonymization argument; `hashingAllowed = false` in § 10 is the same rule expressed as a
  cap.
- **Errors remain an output surface.** A parse failure at row 350 is exactly the moment naive code
  interpolates a value into a message. `join_key_error_leak` stays a distinct proof obligation, tested
  directly, at the wider caps.
- **Promotion stays forbidden at the type level.** `record_identity_key` may be constructed only in a
  future approved import path; `normalized_tax_id` appears on no surface (`OS-A15`). A coverage signal
  that produced either would not be a scoped exception — it would contradict two official records.

---

## 7. Options

### Option A — Keep join coverage fully blocked

```text
Status: safest.
Effect: no real coverage signal is collected until broader gates are approved.
```

- **Pro:** the caps stay at the 11G ceilings, so the largest quantity of regulated data SellUp code
  has ever held stays where it is. GATE-2's envelope question is not pre-empted by a milestone that
  quietly answers part of it.
- **Pro:** it is not a dead end. 11G already de-risked parse-hold-compare-discard-sanitize; Option A
  says the frequency question waits for its proper owners.
- **Con:** the first post-approval milestone must validate wider-window mechanics **and** measure the
  dataset in one step, with no prior evidence that a larger window behaves.
- **Con:** SellUp continues investing in Brazil ingestion design without ever having seen the two
  required families relate even once.
- **Risk if chosen:** low technical risk; schedule and sunk-cost risk concentrated at gate approval.

### Option B — Synthetic-only coverage logic validation

```text
Status: safe but no new real data evidence.
Effect: coverage-like aggregation logic is validated only over synthetic files.
```

- **Pro:** it exercises the whole aggregation path — bucketing, percentage refusal, denominator
  refusal, sanitizer coverage of `coverage_payload` — with zero regulated exposure, and it is the
  right way to build the tests either way.
- **Con, and it is decisive:** synthetic fixtures are written by the test suite, so their overlap rate
  is whatever the fixture author chose. They cannot answer whether the operator's real files relate.
- **Con:** it produces no new evidence about the dataset and must not be reported as if it did.
- **Risk if chosen:** none, and that is also its limit. Option B is a **prerequisite** of Option C
  (§ 13), not an alternative to it — an owner choosing Option B alone is choosing Option A with extra
  tests.

### Option C — Ultra-bounded aggregate-only coverage signal

```text
Status: recommended next option if owner accepts controlled exposure.
Effect: open only one Empresas file and one Estabelecimentos file, under caps slightly above 11G but
        still tiny, compute only coarse bucketed match/unmatch signal, and emit aggregate-only output.
No identifiers, no join keys, no joined rows, no samples, no exact percentage.
```

- **Pro:** it answers the exact remaining unknown — do the two required families relate at all, ever,
  on real input? — with the minimum exposure that can answer it.
- **Pro:** the file surface is unchanged from 11F and 11G: one file per required family, two data
  files per run, no new family, no glob, no directory scan. The only delta is window size.
- **Pro:** its output is structurally incapable of describing a company, a relationship between two
  companies, or a rate: buckets, booleans and a bounded-window scope marker, with the sanitizer
  refusing join keys, joined rows, pairs and coverage payloads.
- **Con:** it is the first milestone to widen a real-data cap. 8× bytes and 10× rows is a genuine
  escalation, and it engages GATE-2's envelope question directly even at these sizes.
- **Con:** it may legitimately return `not_reported`, because two bounded windows of independently
  sharded files need not overlap. Owners must accept that a green run can be uninformative and must
  not be re-run at wider caps to "get an answer".
- **Con:** it produces the first artefact in the programme that *sounds* like a number about Brazil.
  § 5 exists because of this option.
- **Risk if chosen:** medium, and dominated by four controls — the caps being *required* rather than
  defaulted, the sanitizer refusing coverage payloads by static test, the percentage/denominator
  prohibitions being refusals rather than labelling rules, and `not_reported` being an accepted
  outcome.

### Option D — Multi-window bounded coverage signal

```text
Status: not recommended yet.
Effect: sample several small windows from the same two required families.
Higher risk because it increases file seeking/window selection complexity and can tempt coverage
claims.
```

- **Pro:** several disjoint windows would be markedly more informative than one prefix, at the same
  per-window exposure.
- **Con:** window selection is a new mechanism — seeking, offsets, sampling strategy — and every one
  of those concepts is a new leak surface (a byte offset tied to a raw value is forbidden output).
- **Con, and it is decisive:** multiple windows are what makes a *statistical* claim tempting. The
  moment a run says "we sampled N windows", a reader will ask for the rate, and the record's central
  refusal becomes a thing to be argued about rather than a thing that is structurally impossible.
- **Risk if chosen now:** medium-high relative to its marginal value.

### Option E — Full required-family join coverage dry-run

```text
Status: not recommended and not authorized.
Effect: broad scan to estimate actual join coverage.
Requires separate legal/privacy/storage review and should not be authorized by this record.
```

- **Pro:** the only option producing evidence of the kind the full join dry-run exists to gather, with
  a real denominator.
- **Con:** it requires reading far beyond any bounded window — the caps that make Option C defensible
  are precisely what a real estimate must relax.
- **Con:** it is a GATE-1 and GATE-2 question end to end: lawful basis for processing at volume, and a
  temp-storage envelope for holding enough keys to compute a rate.
- **Risk if chosen now:** high, and unnecessary. Option C forecloses nothing here; it strictly reduces
  the untested surface a later coverage dry-run would run on.

### 7.1 Option label continuity — read this before quoting any authorization phrase

The option labels in this record are **local to this record**. They are not the labels used in
BR-SOURCE-11C-R, BR-SOURCE-11D-META, BR-SOURCE-11F or BR-SOURCE-11G, and a phrase from one record
authorizes nothing in another.

| This record (11H) | Nearest equivalent elsewhere | State |
|---|---|---|
| Option A — keep join coverage fully blocked | 11G Option A (adapted) | current state |
| Option B — synthetic-only coverage logic validation | 11G Option B (adapted) | not sufficient alone; a prerequisite of C |
| **Option C — ultra-bounded aggregate-only coverage signal** | narrower than **11G Option E**, far narrower than BR-SOURCE-10H | **not authorized** — the subject of this record |
| Option D — multi-window bounded coverage signal | (not enumerated elsewhere) | not authorized |
| Option E — full required-family join coverage dry-run | closest to BR-SOURCE-10H / 10J | not authorized; needs its own legal/privacy/storage review |

Load-bearing consequences:

- **The recommended phrases of 11G and 11H are different authorizations.** 11G's spent phrase ends
  `REAL JOIN PROBE`; this record's is `AUTHORIZE OPTION C — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN
  COVERAGE SIGNAL` (§ 13). A phrase that does not name the **coverage signal** explicitly authorizes
  nothing under this record.
- **11G's Option E was this record's subject, not this record's Option E.** 11G § 15 mapped its
  Option E to "BR-SOURCE-11H (new)". This record is that record, and it splits 11G's Option E into a
  bounded signal (Option C, recommended) and a real coverage dry-run (Option E, deferred again).
- **`stat` is still not authorized**, and no reader has ever contained a `stat` call.
- **ZIPs are still not authorized.** A byte cap on compressed input is not a cap on decompressed
  content.

### 7.2 Option comparison

| | A — blocked | B — synthetic | C — bounded signal | D — multi-window | E — full coverage |
|---|---|---|---|---|---|
| Opens a real data file | no | no | yes (the same 2 as 11G) | yes | yes |
| Rows read per file | 0 | 0 | **≤ 200** | ≤ 200 × N windows | unbounded by design |
| Holds join keys | no | synthetic only | **≤ 400, ephemeral** | more | at volume |
| Window selection mechanism | none | none | **none — prefix only** | new (seek/offset) | new |
| Answers "do the required families ever relate?" | no | no | **partially — or `not_reported`** | better | yes |
| Emits an exact percentage | no | no | **no** | no | yes, by definition |
| Emits a full-dataset denominator | no | no | **no** | no | yes |
| Emits joined rows, pairs or samples | no | no | **no** | no | no |
| New guard invariants needed | none | sanitizer tests | percentage + denominator + coverage-claim refusals, wider caps | + window-selection guards | + GATE-2 envelope |
| Recommended now | no | as a prerequisite | **yes, conditionally** | no | no |
| Milestone that would consume it | — | inside 11H-IMPL | BR-SOURCE-11H-IMPL | separate record | separate record + GATE review |

---

## 8. Recommended decision

```text
Recommended decision for now: Option C — Ultra-bounded aggregate-only coverage signal.
```

**With this warning, which is part of the recommendation and not a footnote to it:**

```text
Option C should only be implemented after explicit owner authorization.
It should not produce row samples.
It should not produce identifiers.
It should not produce join keys.
It should not produce joined row output.
It should not produce exact coverage percentages.
It should not produce denominator claims about the full dataset.
It should not claim GATE evidence.
```

Reason:

```text
11G proved the join mechanism can execute over real input under strict caps without leaking the
protected join key.
The next technical risk is whether a slightly larger but still ultra-bounded window can produce a
coarse signal about join behavior.
This signal can help decide whether to continue investing in Brazil ingestion design, without
authorizing import, runtime, or production use.
```

Expanded, the recommendation rests on four points:

1. **It is the minimum that answers a real question.** Option A answers nothing new; Option B cannot
   answer this question at all, because synthetic overlap is chosen by the fixture author; D and E
   answer more than is needed next, at more exposure and more new mechanism than is needed next.
2. **It buys a stop/continue decision cheaply.** The cost of *not* asking is continuing to design
   import staging, identity grain, field allowlists and gate packets for a source whose two required
   families may never have been observed to relate. That is the most expensive failure mode available,
   and Option C is the cheapest instrument that can detect it.
3. **It adds no new mechanism, only volume.** No window selection, no seeking, no new family, no new
   file, no new trust semantics beyond the aggregation itself. Volume is a cap conversation; mechanism
   is a design conversation, and this option deliberately opens only the first.
4. **Its failure mode is contained, conditionally.** The conditions are the § 10 caps being *required*
   of the caller, the § 5 terminology rules binding the report as well as the payload, the
   percentage/denominator/claim prohibitions being refusals enforced at both the input and output
   boundary, and `not_reported` being an accepted outcome. Option C without those controls is not the
   option being recommended.

**Why not the others, in one line each.** Option A remains a legitimate owner answer and concentrates
risk at gate approval. Option B is necessary but not sufficient — it belongs inside the implementation
as its test strategy. Option D adds a new leak-prone mechanism (window selection) and makes a
statistical claim tempting. Option E is a GATE-1/GATE-2 question about volume and needs its own legal,
privacy and storage review.

### 8.1 `not_reported` and `zero` are successes, and must be reported as such

A likely outcome of two bounded windows over independently sharded files is **zero overlap**, and a
possible outcome is that a cap is reached before a comparison can be made. Neither is a failure,
neither is evidence that the dataset does not join, and neither is a reason to widen the caps or
re-run.

The implementation must therefore treat `match_result_bucket = zero` and
`match_result_bucket = not_reported` as first-class, green results, and must state in its own report
that a bounded-window comparison is not evidence about the dataset in either direction. A run that
reports a bucket without that framing invites exactly the inference § 5 forbids.

### 8.2 The escalation, stated once, plainly

Option C is the first milestone in the series to raise a real-data cap. Bytes per file move from
`64_000` to `512_000`; rows per file move from `20` to `200`; the in-memory key window moves from `40`
to `400`. Everything else — file count, family allowlist, aggregate-only output, denylists, no-write,
no-runtime — is unchanged.

Owners should decide this record on that sentence. If the escalation is unacceptable before GATE-2
defines an envelope, the correct answer is Option A, and this record supports that answer without
prejudice.

---

## 9. Proposed scope for Option C

These boundaries apply to **Option C only**, and only if it is authorized after this record is
merged.

```text
Allowed:
- open one Empresas file under cap;
- open one Estabelecimentos file under cap;
- parse only the protected technical join key ephemerally;
- execute in-memory aggregate matching;
- discard raw rows immediately;
- discard raw cells immediately;
- discard join key values immediately after aggregate calculation;
- emit only coarse aggregate buckets;
- no row samples;
- no joined row samples;
- no identifiers;
- no company names;
- no establishment names;
- no filenames;
- no absolute paths;
- no hashes;
- no exact coverage percentage;
- no full-dataset denominator;
- no production coverage claim;
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
- opening Simples;
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
- producing exact coverage percentage;
- claiming full-dataset coverage;
- writing source_company_snapshots;
- import;
- Supabase writes;
- runtime;
- Agent 1.
```

### 9.1 Notes on the scope

- **The file surface is unchanged from 11F and 11G, deliberately.** One Empresas file and one
  Estabelecimentos file, singular, both belonging to an allowlisted family, two paths resolved per
  run. This record adds no file, no glob, no directory scan and no new family.
- **The window is a prefix, not a sample.** Option C reads from the start of each file up to the caps.
  There is no seek, no offset, no stride, no random selection — those belong to Option D, and their
  absence is what keeps the mechanism identical to 11G's.
- **"Parse only the protected technical join key" means exactly one field position per row.** Not the
  whole row into a structure, not "the first few fields for context", not a second field "to
  disambiguate". Any field beyond the join-key position that survives its loop iteration has left
  Option C.
- **"Ephemerally" has an upper bound, and it is a cap.** The bounded window of join key values is
  capped (§ 10, `maxJoinKeyValuesInMemory`), is never written anywhere, and is discarded before the
  aggregate is emitted. See § 6.1.
- **The aggregation is a membership tally, not a materialization.** The signal counts how many keys
  from one window appear in the other, in buckets. It never builds a joined record, a pair list, a
  mapping, or an index that outlives the comparison — `maxJoinPairsEmitted = 0` and
  `maxJoinedRowsPrinted = 0` are structural, not thresholds.
- **The Sócios / QSA / CPF family stays denylisted end to end.** A manifest declaring such a file is a
  fail-closed refusal reported as an aggregate boolean or count — never a filename, never followed by
  a read.
- **ZIPs stay closed**, and catalog families stay counted-never-opened, exactly as 11G left them.
- **"No filenames"** resolves to: family labels are reportable, filenames are not.
- **The forbidden path families and directory labels are denylist labels, not locations.** They appear
  here so a static guard can refuse them. No real, absolute, or complete path is recorded in this
  document, and none may be recorded in code, tests, fixtures, or reports.
- **"No output inside repo"** carries over: the aggregate report is a return value, not a committed
  artifact, so no real content can be accidentally committed.
- **The authorization is single-milestone and expires with it.** It does not become a standing runner
  capability and cannot be inherited by a later milestone without its own phrase.

---

## 10. Proposed hard caps for Option C

The file-count and family caps are the BR-SOURCE-11G caps, unchanged. The byte, row and key-window
caps are raised. The output-refusal caps are new.

```text
maxFilesOpened                 <= 2
allowedFamilies                = empresas, estabelecimentos
maxBytesPerFile                <= 512_000
maxRowsPerFile                 <= 200
maxTotalRows                   <= 400
maxTotalBytes                  <= 1_024_000
maxRuntimeSeconds              <= 30
maxJoinInputRows               <= 400
maxJoinKeyValuesInMemory       <= 400
maxJoinPairsEmitted            = 0
maxJoinedRowsPrinted           = 0
outputMode                     = aggregate_only
samplesAllowed                 = false
hashingAllowed                 = false
exactPercentageAllowed         = false
fullDatasetDenominatorAllowed  = false
coverageClaimAllowed           = false
importAllowed                  = false
```

Justification:

```text
These caps are intentionally larger than 11G but still tiny relative to the source size.
They are designed to test aggregate behavior, not to estimate production coverage.
They must not be increased automatically if the result is zero or not_reported.
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
fail if samples would be emitted
fail if exact coverage percentage is requested
fail if full dataset denominator is requested
fail if coverage claim text is requested
fail if output sanitizer detects raw cells, identifiers or join keys
fail if output path is inside repo
fail if any import/runtime/Agent1/provider flag is requested
```

### 10.1 Notes on the caps

- **Caps must be stated by the caller, not defaulted.** 11C established the rule and every
  implementation milestone since has enforced it: a cap nobody stated is a cap nobody agreed to. A
  missing cap is refused, never filled in. Inheriting a 11G default silently would be the single most
  likely way this escalation happens without an owner deciding it.
- **Caps must be enforced *and* asserted.** Each cap needs at least one test driving input past it and
  asserting the refusal. A cap that exists only as a default is not a cap.
- **The three raised caps are the decision.** `maxBytesPerFile`, `maxRowsPerFile` and
  `maxJoinKeyValuesInMemory` are 8×, 10× and 10× their 11G values. § 8.2 states the escalation
  plainly; these three lines are what an owner is being asked to accept.
- **`maxJoinPairsEmitted = 0` and `maxJoinedRowsPrinted = 0` are equalities, not ceilings.** They are
  written as caps so a single guard shape covers them, but a value above zero is not a wider signal —
  it is a different, unauthorized capability.
- **`exactPercentageAllowed`, `fullDatasetDenominatorAllowed` and `coverageClaimAllowed` are refusals,
  not labelling rules.** The rule is not "compute it and caveat it"; the rule is "do not compute it,
  and refuse the run if it is requested". They are listed as caps so the same fail-closed machinery
  that refuses an oversized row count refuses a percentage request. See § 5.1 and § 11.
- **`hashingAllowed = false` is not a formality.** No hash, truncation, or fingerprint derived from an
  identifier or from the join key may be produced. A signal may not "anonymize" a join key; it may
  only decline to emit it.
- **A cap breach is a refusal, not a truncation.** Reaching `maxBytesPerFile` mid-row means the row is
  dropped and the ceiling is reported; a cut row is a different row, not a smaller one. At 200 rows
  this matters more than it did at 20: the boundary is hit routinely, not exceptionally.
- **`maxRuntimeSeconds` stays at 30 despite the 10× row increase.** It is a liveness cap, not a
  performance target: a pathological input must not turn a bounded signal into a long-running process
  holding regulated bytes and hundreds of join keys in memory.
- **These numbers carry no implication for real-data ceilings generally.** GATE-2 owns the storage and
  processing envelope for real execution. These are signal ceilings, deliberately far below anything
  GATE-2 would need to define — and proposing them is not an argument that GATE-2 should adopt them.

---

## 11. Output contract

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
row_shape_valid_count_bucket
row_shape_invalid_count_bucket

coverage_signal:
  coverage_signal_executed        = true
  coverage_signal_mode            = ultra_bounded_required_family_aggregate_only
  join_key_values_printed         = false
  join_key_values_retained        = false
  join_key_hashes_printed         = false
  join_key_error_leak             = false
  joined_rows_printed             = false
  joined_samples_printed          = false
  joined_pairs_emitted            = 0
  exact_coverage_percentage_printed = false
  full_dataset_denominator_printed  = false
  coverage_claimed                = false
  match_result_bucket             = zero | one_or_more | not_reported
  matched_rows_bucket             = zero | lte_200 | gt_200_not_allowed | not_reported
  unmatched_rows_bucket           = zero | lte_200 | gt_200_not_allowed | not_reported
  denominator_scope               = bounded_window_only
  production_inference_allowed    = false

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
exact coverage percentage
full dataset denominator
coverage proof
coverage guarantee
production readiness claim
```

### 11.1 Notes on the output contract

- **`row_shape_valid_count` becomes a bucket.** 11G emitted exact valid/invalid row counts, which was
  safe at 20 rows because the count could not carry information beyond "the layout held". At 200 rows
  an exact pair of counts is a ratio in disguise, so § 11 replaces them with
  `row_shape_valid_count_bucket` and `row_shape_invalid_count_bucket`. This is a *narrowing* relative
  to 11G, chosen deliberately alongside the cap increase.
- **`gt_200_not_allowed` is a refusal marker, not a measurement.** It exists so that a run which
  somehow computed a tally above the row cap reports the violation as a class rather than emitting the
  number. In a correct run it is unreachable.
- **`denominator_scope = bounded_window_only` is mandatory and constant.** It is emitted on every run
  so that no consumer of the payload — human or downstream document — can quote a bucket without
  quoting its scope. Together with `production_inference_allowed = false` it makes the § 5
  terminology obligation machine-readable.
- **A coverage figure is forbidden even if it is arithmetically computable.** Two buckets and a row
  cap are enough for a reader to attempt a ratio; the contract's answer is that the signal emits no
  ratio, makes no coverage claim, and carries `coverage_claimed = false` and
  `exact_coverage_percentage_printed = false` explicitly so no downstream document can imply one.
- **`not_reported` is not an error state.** It is the correct value when the signal cannot make a
  meaningful statement — for example when the two windows are disjoint by shard, or when a cap was
  reached before comparison. § 8.1 requires it to be reported as green.
- **`join_key_values_retained = false` is an output assertion about surfaces, not about RAM.** See
  § 6.1. It asserts that no join key value reached a field, report, log, file, or return value.
- **The existing sanitizer leak kinds mostly suffice, and the gap is narrow.** BR-SOURCE-11G-IMPL
  landed `join_key_payload`, `joined_row_payload`, `joined_sample_payload`, `join_pair_payload`,
  `coverage_payload`, `cnpj_basico_payload` and `cnpj_completo_payload`. Option C would need the
  percentage/denominator refusals wired to `coverage_payload` (or a sibling kind, name indicative),
  each asserted by a test that feeds the sanitizer a would-be leak and asserts refusal — **including
  from an error message**.
- **`decision_status` and `run_scope` are inherited unchanged.** Eight gates `not_approved`, every
  scope flag `false`, errors carrying a fixed error code and stage only — never a raw message, a path,
  or a value.

---

## 12. Gate relationship

```text
Option C does not approve GATE-1.
Option C does not approve GATE-2.
Option C does not approve any gate.
Option C may produce only preliminary technical evidence for a future GATE discussion.
A successful Option C run cannot be cited as legal/privacy approval.
A successful Option C run cannot be cited as storage approval.
A successful Option C run cannot be cited as import readiness.
A successful Option C run cannot be cited as runtime readiness.
A successful Option C run cannot be cited as production coverage.
```

```text
GATE-1 remains required before broader personal/company data processing.
GATE-2 remains required before broader local data-file execution and temp storage.
GATE-3 remains required before field persistence.
GATE-4 remains required before identity grain persistence.
GATE-5 remains required before output evidence can be promoted.
GATE-6/7/8 remain required before operational runs.
```

### 12.1 Why an approved signal still approves nothing

A green Option C run would establish that join keys parsed from one bounded window can be compared
against those from another bounded window, inside ceilings, with nothing leaking into the report, and
that the outcome class over those two windows was `zero`, `one_or_more`, or `not_reported`. That is a
statement about the **join mechanism at a slightly larger scale** and about **two windows**.

It is not a statement about lawful basis (GATE-1), about the storage envelope for real processing
(GATE-2), about which fields may survive (GATE-3), about identity grain (GATE-4), about promoted
evidence (GATE-5), or about operational readiness (GATE-6/7/8). A bounded signal is a narrow exception
to a code-writing restriction, not a partial gate approval, and it creates no precedent for one.

### 12.2 The gate this record brushes against hardest is GATE-2

Stated explicitly, because it differs from 11G's answer:

- **GATE-2 (temporary storage / processing envelope)** decides how much regulated data SellUp may hold
  and process locally at once. Option C raises exactly that quantity — 8× bytes, 10× rows, 10× keys.
  It does not define an envelope, does not propose one, and must not be cited as evidence for one; but
  it is the first milestone where an owner should ask whether the escalation belongs inside GATE-2's
  review rather than ahead of it. **An owner answering "inside GATE-2" is answering Option A**, and
  that is a coherent and supported outcome of this record.
- **GATE-1 (legal/privacy)** decides lawful basis and purpose limitation. Option C's purpose is a
  stop/continue engineering decision, not prospecting, not enrichment, and not retention. It persists
  nothing and produces no personal data output.
- **GATE-3 (field allowlist)** decides which fields may *survive*. Option C survives nothing: it reads
  one field position and discards the value. It does not add the join key to any allowlist.
- **GATE-4 (identity grain)** decides what a record's identity is. Option C constructs no identity: no
  `record_identity_key`, no `normalized_tax_id`, no derived key of any kind.
- **GATE-5 (output sanitization)** decides what may be promoted as evidence. Option C promotes
  nothing: its output is buckets and booleans, and § 11 forbids the ratio a reader would want to
  promote.

---

## 13. Evidence required before implementation

```text
- this decision record merged;
- explicit owner phrase authorizing Option C;
- implementation plan with no-write/no-runtime guard;
- test plan with synthetic coverage signal files;
- static guard for max files/rows/bytes;
- static guard for no join key output;
- static guard for no exact coverage percentage;
- static guard for no full dataset denominator;
- static guard for no coverage claim;
- output sanitizer coverage for raw row/cell values, identifiers, join keys and coverage payloads;
- fail-closed tests for missing caps and forbidden families;
- fail-closed tests for percentage/denominator/coverage-claim attempts;
- proof no Supabase/runtime/Agent1/provider imports;
- proof no source_company_snapshots writes;
- proof no output committed;
- proof real run output is aggregate-only.
```

The recommended authorization phrase is:

```text
AUTHORIZE OPTION C — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL
```

### 13.1 Notes on the evidence

- **All sixteen items are required.** Any one missing means the implementation stays blocked. A merged
  record without the phrase authorizes nothing; the phrase given before the record is official
  authorizes nothing either, because it refers to a record that must already be official.
- **The phrase is exact, single-scope, and non-transferable.** It authorizes this record's Option C
  only: not Option D, not Option E, not an exact percentage, not a catalog file, not a second
  milestone, not a re-run at wider caps. See § 7.1 — the already-spent 11G phrase names the *probe*
  and authorizes nothing here.
- **"Test plan with synthetic coverage signal files" means the implementation's tests stay
  synthetic.** Headerless fixture pairs the test suite writes itself, with known-overlapping,
  known-disjoint and known-partially-overlapping key windows, exercised through the *real-file* code
  path to prove it buckets and refuses correctly. Executing the operator's real files is a separate
  operator step whose report must carry no path, no filename, and no value. **This is Option B,
  absorbed as the test strategy of Option C.**
- **The three new static guards are the substance of this milestone's safety work.** "No exact
  coverage percentage", "no full dataset denominator" and "no coverage claim" mean a test that reads
  the module source and asserts that no division, no ratio construction, no percentage formatting, and
  no dataset-sized denominator constant exists anywhere in it — the same pattern earlier milestones
  used to assert one `openSync` and no `statSync` / `readdirSync` / `readFileSync` /
  `createReadStream`.
- **"Fail-closed tests for percentage/denominator/coverage-claim attempts"** is a distinct class from
  the cap tests: a request for a percentage, a ratio, a rate, or a dataset denominator must be refused
  at the input boundary rather than served-and-labelled.
- **The raised caps need their own refusal tests at the new ceilings.** A test proving 21 rows is
  refused proves nothing once the cap is 200. Every raised cap needs a fresh boundary test at its new
  value, and a test proving the *old* value is no longer silently applied.
- **A test plan is not a test.** The plan is evidence for the authorization decision; the tests are
  written inside the implementation milestone, after authorization.
- **The implementation milestone and the execution step are separate.** Landing 11H-IMPL against
  synthetic fixtures does not authorize pointing it at the operator's real files; that is its own
  step, with its own report, under this record's § 9 and § 10.

---

## 14. What remains blocked

Regardless of any decision recorded here, and regardless of whether Option C is subsequently
authorized, every item below remains blocked:

```text
full dataset execution
opening all files
opening catalog files
opening Socios/QSA/CPF/person files
opening ZIPs directly
unbounded scan
multi-window scanning
row samples
raw cells
identifiers
join key output
join key hashes
joined row output
join pair output
exact coverage percentage
full dataset denominator
coverage proof
coverage guarantee
production inference
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

### 14.1 Why this list survives an Option C authorization

Option C would change exactly two things: how large the bounded window may be, and whether a coarse
match/unmatch bucket may be emitted from it. It changes nothing about the rest of the dataset, about
exact coverage, about persistence, about runtime, or about Agent 1 — because none of those appears in
the Option C loop at all.

Three consequences follow, and all are load-bearing:

1. **No Option C result is citable as evidence about the dataset.** A green run is evidence that a
   join mechanism produces an outcome class over two bounded windows. It is not evidence about
   coverage, join rates, quality, eligibility, or either gate — and `not_reported` is not evidence of
   anything at all.
2. **No Option C result justifies a wider re-run.** Neither `zero` nor `not_reported` is a reason to
   raise the caps and try again. A wider window is a new decision, requiring a new record and a new
   phrase — this is written here so that the most tempting follow-up action is pre-emptively refused.
3. **The gate owners' authority is untouched.** GATE-1 and GATE-2 remain the sole route to dataset
   processing and import.

---

## 15. Flags

```text
OPS_BR_BOUNDED_REAL_JOIN_COVERAGE_DECISION_RECORD_PR_READY        = false until PR
OPS_BR_BOUNDED_REAL_JOIN_COVERAGE_DECISION_RECORD_OFFICIAL        = true
OPS_BR_ULTRA_BOUNDED_AGGREGATE_ONLY_JOIN_COVERAGE_SIGNAL_AUTHORIZED = true
OPS_BR_REAL_LOCAL_JOIN_COVERAGE_SIGNAL_AUTHORIZED                 = true

OPS_BR_ULTRA_BOUNDED_AGGREGATE_ONLY_REAL_JOIN_COVERAGE_SIGNAL_PR_READY   = true until merge
OPS_BR_ULTRA_BOUNDED_AGGREGATE_ONLY_REAL_JOIN_COVERAGE_SIGNAL_OFFICIAL   = false until merge

OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_JOIN_PROBE_AUTHORIZED        = true
OPS_BR_REAL_LOCAL_JOIN_DRY_RUN_AUTHORIZED                         = true
OPS_BR_ULTRA_BOUNDED_REQUIRED_FAMILY_REAL_JOIN_PROBE_OFFICIAL     = true

FULL_JOIN_RUNNER_READY                                            = true
FULL_JOIN_EXECUTION_READY                                         = false
IMPORT_READY                                                      = false
RUNTIME_READY                                                     = false
AGENT1_READY                                                      = false

OPS_BR_READY_FOR_IMPORT                                           = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT                                = false
OPS_BR_READY_FOR_RUNTIME                                          = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY                             = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED                     = false
```

### 15.0 BR-SOURCE-11H-IMPL — what the Option C authorization actually turned on

The owner gave the phrase, and BR-SOURCE-11H-IMPL implemented it and executed it once:

```text
AUTHORIZE OPTION C — ULTRA-BOUNDED AGGREGATE-ONLY REAL JOIN COVERAGE SIGNAL
```

BR-SOURCE-11H-IMPL implements only the explicitly authorized Option C ultra-bounded aggregate-only
real join coverage signal. It does not authorize exact percentages, full-dataset denominator claims,
coverage proof, import, Supabase, runtime, Agent 1, provider calls or production use.

What exists now, and nothing more:

- a single new module, `br-receita-cnpj-aggregate-join-coverage-signal.ts`, whose trust level is
  `real_manifest_aggregate_join_coverage_signal` and whose mode is
  `ultra_bounded_required_family_aggregate_only`;
- a sixth runner carve-out, gated by TWO new flags
  (`aggregateOnlyJoinCoverageSignalAuthorized`, `realLocalJoinCoverageSignalAuthorized`) that are
  **not** inferable from the 11F or 11G declarations, and required IN ADDITION to all five of them;
- one widened axis and one only: ≤ 512 KB and ≤ 200 rows per file, ≤ 1,024,000 bytes and ≤ 400 rows
  per run. The file surface, the family allowlist, the one-field-per-row rule, the never-opened
  catalog families, the archive/ZIP refusals and the manifest ceilings are unchanged;
- four coverage caps: `maxCoverageInputRows ≤ 400`, `maxCoverageKeyValuesInMemory ≤ 400`, and
  `maxCoveragePairsEmitted` / `maxCoverageRowsPrinted` as **equalities at zero**;
- an output contract in which `exact_coverage_percentage_printed`,
  `full_dataset_denominator_printed`, `coverage_claimed` and `production_inference_allowed` are
  structural falses, and `denominator_scope` states the only denominator that exists here:
  `bounded_window_only`;
- sanitizer kinds that block the five overclaims at the OUTPUT boundary too:
  `coverage_signal_exact_percentage_payload`, `coverage_signal_denominator_payload`,
  `coverage_signal_proof_payload`, `coverage_signal_guarantee_payload`,
  `production_inference_payload`.

The authorized real signal was executed once, against the operator's own prepared manifest, under
every cap above. It opened two data files, read a bounded prefix of each, compared join keys in
memory, released the window, and emitted buckets. `match_result_bucket` came back `zero` — which
§ 7.1 already defines as a GREEN result and as evidence of nothing: two independently-sharded
prefixes need not overlap, and a wider window is a new decision requiring a new record and a new
phrase (§ 14.1).

The three 11G `true` values are inherited and remain **scoped to the 11G Option C probe**: two
required-family files, ≤ 64 KB and ≤ 20 rows each, a membership test, a three-value bucket. None of
them is partial credit toward this record's Option C, and none authorized a coverage signal, a larger
window, or a bucket tally at any scale beyond the one already executed.

`FULL_JOIN_RUNNER_READY = true` reflects only that the 11A scaffold merged and gained synthetic (11C),
metadata-only (11D-META-IMPL, 11E), required-family-probe (11F-IMPL) and required-family-join-probe
(11G-IMPL) plumbing; it says nothing about execution readiness.

`FULL_JOIN_EXECUTION_READY` stays `false` deliberately and is the flag most likely to be misread: a
bounded signal over two windows is not full-join execution, and it would not become one by returning
`one_or_more`. `OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED` also stays `false` — no headerless
real-file dry-run has passed, because none has been run, because none is authorized; a bounded
coverage signal is not the dry-run that flag names.

### 15.1 Gate status — UNCHANGED

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

## 16. Next milestone mapping

```text
If Option C is explicitly authorized after this record is merged:
BR-SOURCE-11H-IMPL may implement the ultra-bounded aggregate-only real join coverage signal.

If multi-window scanning is desired:
a later explicit decision is required.

If support catalogs are desired:
a later explicit decision is required.

If exact coverage percentages are desired:
a later explicit legal/privacy/storage review is required.

If import is desired:
a later explicit import-readiness process is required.

No real coverage signal execution is authorized by this record.
```

| Decision | Milestone | Requires |
|----------|-----------|----------|
| Option A | none | nothing — join coverage stays blocked until GATE-1 and GATE-2 are approved |
| Option B | none standalone | absorbed as the test strategy of Option C (§ 13); not sufficient alone |
| Option C | BR-SOURCE-11H-IMPL (new) | this record merged **and** the § 13 owner phrase **and** the § 9 scope **and** the § 10 caps |
| Option D | separate record or explicit authorization | its own owner phrase, plus window-selection guards and their own leak analysis |
| Option E | separate record | its own legal/privacy/storage review, resolving the temp-storage envelope question with GATE-2 |
| Support catalogs | separate record or explicit authorization | its own owner phrase and a widened family allowlist |
| Import | separate import-readiness process | GATE-1 … GATE-8 approved |

### 16.1 Ordering note

The mapping orders **review**, not approval. Option C landing does not advance Option D, and Option D
landing does not advance Option E. Each requires its own authorization, and none approves a gate. The
independent and always-available path — approving GATE-1 and GATE-2 on their own merits — remains the
shortest route to real execution and is unaffected by any option here.

---

## 17. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- write, modify, or delete any code, script, test, fixture, or package manifest;
- collect a coverage signal, compute a coverage percentage, compute a ratio or match rate, compute a
  bucket tally, or claim any denominator;
- execute a join, construct a join key, hold a join key, compare join keys, or emit a joined row or
  join pair;
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
- change the parser, reader, dry-run, manifest validator, snapshot builder, join dry-run, join probe,
  or any connector runtime behavior;
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

---

## 18. Update (BR-SOURCE-11I)

BR-SOURCE-11I interprets the 11H aggregate-only coverage signal result. It records that
`match_result_bucket = zero` is a valid bounded-window outcome, not a failure. It does not authorize
reruns, larger caps, multi-window sampling, exact coverage percentages, import, Supabase, runtime or
Agent 1. It recommends preparing a future GATE-2 route decision package. It does not approve any
gate. See
[`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md).
