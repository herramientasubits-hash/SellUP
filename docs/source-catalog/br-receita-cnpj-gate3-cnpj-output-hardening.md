# BR Receita CNPJ — GATE-3 CNPJ output hardening

**Source family:** Brazil — Receita Federal do Brasil (RFB), CNPJ Dados Abertos (bulk)
**Milestone:** BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING
**Status:** privacy hardening of the OFFLINE snapshot builder. **Approves no gate.**
**Base:** `origin/main` = `067f1055ddcb1432b293023bd0d89727cf6968d9` (contains PR #320 GATE-1 approval `bd98c5e7`, PR #317 `31d140b5`)

---

## 0. What this is, and what it is not

This is a privacy correction to a PURE, OFFLINE, SYNTHETIC-ONLY transform. It changes what the
snapshot builder is allowed to EMIT and adds a key-and-value sanitizer that proves it.

```text
GATE-1                                approved   (unchanged by this milestone)
GATE-2 … GATE-8                        not_started (unchanged by this milestone)

maxOutputRows                          0          unchanged
NullBenchmarkSink                      present    unchanged
engine → snapshot bridge               ABSENT     unchanged
atomic snapshot publish                ABSENT     unchanged
snapshot persistence                   none       unchanged
Supabase writes                        0          unchanged
migrations                             0          unchanged
Brazil runtime                         disabled   unchanged
Brazil in Agent 1 enrichment config    absent     unchanged
feature / provider flags               untouched  unchanged
real Receita rows read                 0          unchanged
benchmark executed                     none       unchanged

REAL_BENCHMARK_ATTEMPTS_CONSUMED       2          unchanged
ATTEMPT_3_ALLOWED                      false      unchanged
NO_RESET_PATH                          true       unchanged
```

---

## 1. The defect

`br-receita-cnpj-snapshot-builder.ts` emitted, into every accepted snapshot row:

| Field | What it actually was |
| --- | --- |
| `raw_data.cnpj_root` | the **CNPJ básico** (raiz, 8 positions) |
| `raw_data.cnpj_order` | `cnpj_ordem` (4 positions) |
| `raw_data.cnpj_dv` | the check digits (2 positions) |
| `tax_id` | the **raw full CNPJ** as it appeared in the source |
| `normalized_tax_id` | the **normalized full CNPJ** |
| `record_identity_key` | `tax:<normalized_14>` — the full CNPJ, verbatim, with a prefix |
| `rejected[].safeIdentifier` | a **truncated SHA-256 of the full CNPJ** |

The GATE-1 owner approval record, required-evidence item **R4**, is categorical:

> CNPJ básico and full CNPJ are both categorically non-printable and non-persistible — no hash,
> truncation or fingerprint of either, anywhere.

Every row in the table above breaches it. `cnpj_root` alone is the CNPJ básico; the first three
recombine into the full CNPJ; the next three ARE the full CNPJ; and `safeIdentifier` is precisely the
"hash … truncation" R4 names — "safe because it is hashed" was never an exemption under R4.

**Why the existing guard did not catch it.** The builder's `assertSanitizedRawData` inspected
**KEYS ONLY**, against a blocklist of contact and person tokens (`telefone`, `cpf`, `logradouro`, …).
`cnpj_root` is not on that list, and a key-only check cannot see a prohibited VALUE under a permitted
key at all. The separate full-join sanitizer (`br-receita-cnpj-full-join-output-sanitizer.ts`) does
check keys AND values — but it guards dry-run REPORTS, a different surface, and was never applied to
a snapshot row.

---

## 2. What changed

### 2.1 Fields removed from the materialized output contract

`raw_data`: `cnpj_root`, `cnpj_order`, `cnpj_dv`.
Snapshot row: `tax_id`, `normalized_tax_id`, `record_identity_key`.
Rejection row: `safeIdentifier`.
Controlled-runner report: `valid_cnpj_hashes`, `rejection_reasons[].safe_identifier`.

### 2.2 The internal join mechanism is UNCHANGED

The builder still assembles the full CNPJ from `cnpj_basico` + `cnpj_ordem` + `cnpj_dv`, still
DV-validates it through `normalizeBrazilCnpj`, still derives `tax:<normalized_14>`, and still rejects
duplicates on that identity. The file reader still parses those three source columns. **The
prohibition is on SURVIVAL, OUTPUT and PERSISTENCE, not on processing.** The observable proof that
dedup still works is unchanged: `rejectedDuplicateRecordIdentity = 1` and
`distinctRecordIdentityKeys = 3` on the synthetic fixture.

### 2.3 New module — `br-receita-cnpj-snapshot-output-sanitizer.ts`

A KEY **and** VALUE sanitizer for the snapshot surface. Every built row and every rejection passes
through it, fail-closed, before it is pushed. It reports a finding KIND and a sanitized key PATH and
never echoes the offending value.

**It does not add a second CNPJ validator.** Full-CNPJ detection delegates to
`findBrazilCnpjLikeIdentifiers` (`br-receita-cnpj-identifier-shape.ts`), which is DV-validated by
`normalizeBrazilCnpj` (`br-cnpj.ts`). One grammar, one módulo-11 algorithm, reused.

What it detects:

1. **Full CNPJ as a value** — numeric or alphanumeric (§ 3.1/§ 3.4, July 2026), continuous or in the
   official punctuated mask, DV-validated so arbitrary 14-character tokens are not false leaks.
2. **CNPJ básico as a value** — context-aware, see § 3.
3. **Reconstructable parts** — two or three of the row's own leaves, concatenated in order, forming a
   DV-valid CNPJ. This is the direct test of the pre-hardening defect.
4. **Prohibited derivatives** — by key (`hash`, `fingerprint`, `digest`, `truncat`, `sha*`,
   `safeIdentifier`, `maskedIdentifier`) and by value (a hex-digest-shaped run of ≥12 chars that
   contains a digit — the shape `buildBrazilCnpjHash12` produces).
5. **CPF** — continuous and punctuated.
6. **Person-linked keys** — `socio`, `qsa`, `cpf`, `representante`, `faixa_etaria`, `pessoa_fisica`.
7. **Contact / fine-address keys** — `telefone`, `ddd`, `fax`, `correio`, `email`, `logradouro`,
   `numero`, `complemento`, `bairro`, `cep`.
8. **Anything off the closed allowlist** — an unknown key, or a nested object under a scalar key
   (an arbitrary source blob), is refused whatever its value looks like.

---

## 3. Why the root rule is context-aware rather than "8 digits anywhere"

A CNPJ básico carries **no check digit**, so unlike a full CNPJ it cannot be DV-validated. Shape is
all there is — and an indiscriminate rule on shape rejects ordinary registral data:

- `start_date` is `YYYYMMDD` in the real Receita layout — eight digits, every row.
- `capital_social_value` of `12345678.00` contains an eight-digit run. A capital of R$ 12,345,678 is
  ordinary business data, not an identifier.

So the rule is scoped by the **closed field allowlist**: each permitted field declares the value
SHAPE it may carry (`text`, `short_code`, `date`, `monetary`, `row_index`, `boolean`, `literal`,
`provenance`), and the run rule is waived only where that declared shape independently explains the
run **and the value actually matches it**. A `date` field carrying something that is not a date gets
no waiver — the waiver is earned by the value, not granted by the key.

Two further constraints, both learned rather than assumed:

**The run must contain a digit.** Without it, `official_registry` (the parser's own `source_type`
literal), `Limitada` inside a legal-nature label, and most Portuguese registral vocabulary are all
"leaked raízes". Every part of a real CNPJ carries digits: `cnpj_ordem` and the DV are numeric, a
raiz is numeric or mixed.

**A reconstruction candidate must also contain a digit.** A real false positive was observed before
this constraint existed: with ~12 alphanumeric leaves per row, the chance that some pair or triple
happens to satisfy two independent módulo-11 check digits stops being negligible, and an ordinary
municipality name was flagged.

**Residual, stated rather than hidden.** A raiz composed ENTIRELY of letters would match neither
rule. The July-2026 format permits one. The only output fields that could conceal it are the
free-text name/label fields, which GATE-3 governs as "sanitized legal_name" and code labels, not as
identifier carriers. Closing that residual means narrowing those fields — an owner decision — not
re-opening the rule onto every word in the row.

### 3.1 Short key fragments are matched as WORDS, not substrings

`cep` is a substring of `source_period` (…sour‑**cep**‑eriod…). The first version of the key rules
used squashed-substring matching and rejected the parser's own `source_period` field as an address
field. Short, ambiguous fragments (`cep`, `ddd`, `fax`, `cpf`, `qsa`, `sha`) are now matched against
the key's WORDS — split on separators and camelCase boundaries — as a whole word or a word prefix.
Long distinctive fragments (`telefone`, `logradouro`, `fingerprint`, `cnpj`, …) keep substring
matching, because they cannot collide by accident.

This is the same class of error as grepping a raw file body and mistaking a word in a sentence for a
code reference. Every rule below the CNPJ ones was re-tested in the negative against the parser's own
allowlist before landing.

---

## 4. What was deliberately NOT changed

### 4.1 `capital_social_value` — retained

It is still emitted, with the same values (`100000.00`, `500000.00` on the fixture). Whether it
belongs in a persisted snapshot is a **business-scope question for the GATE-3 owner**, not a privacy
defect, and a privacy correction must not silently narrow enrichment scope.

```text
CAPITAL_SOCIAL_BEHAVIOR_CHANGED = false
```

### 4.2 `trade_name` — not implemented

```text
TRADE_NAME_STATUS = NOT_IMPLEMENTED
```

The file reader RECOGNIZES `nome_fantasia` in the ESTABELECIMENTOS layout and deliberately DROPS it —
it sits in the "recognized-but-ignored (non-sensitive)" group, and `mapEstabelecimentos` never copies
it into the row object. It is therefore absent from the input row TYPE and unmapped by the builder:
there is no output field to remove and no prohibition to enforce. **This is a parser gap, not a
legal/privacy prohibition,** and it must not be reported as one.

### 4.3 Encryption at rest — not coded

Out of scope here; it is a GATE-2 owner decision. See the round-1 owner packet.

---

## 5. ⚠️ Open consequence — the snapshot row now carries NO identity column

This is deliberate, and it is **not** a settled design.

Data-contract § 5.1/§ 6 specifies eight fixed columns including `tax_id`, `normalized_tax_id` and
`record_identity_key`, with the writer conflict key
`(source_key, country_code, source_year, record_identity_key)`. Every one of those three is full-CNPJ
material under R4. The reconciliation:

- **GATE-3** (field allowlist) is `not_started`. **GATE-4** (identity grain) is `not_started`.
  Therefore **no APPROVED contract requires their persistence**, and the fail-closed reading of R4 is
  to carry none of them.
- No consumer is affected today: `maxOutputRows = 0`, the engine→snapshot bridge does not exist, and
  no writer consumes `BrReceitaCnpjSnapshotRow`. The only consumer in the repository is the synthetic
  controlled-parser smoke script.
- No substitute was invented. A hash, truncation or fingerprint of the CNPJ would be the same
  breach under a different name, so the row carries nothing rather than something derived.

**What the owner decides.** Which identity a persisted Brazil snapshot may carry is a GATE-3 /
GATE-4 question. Restoring `normalized_tax_id` — or approving a non-CNPJ-derived surrogate — is a
one-line change once one of those gates says so. Until then the safe state is none.

---

## 6. Evidence

```text
tests   289 pass / 0 fail   npm run test:br-source:gate3-cnpj-output-hardening
        2141 pass / 0 fail  all BR connector suites
        178 pass / 0 fail   BR script + catalog/status suites
tsc --noEmit                clean
eslint (touched files)      clean
```

**Absence of a derivative output path is PROVED, not asserted (§ 5).** A static guard reads every
production module in the connector plus the controlled-runner script and fails if any of them names
`buildBrazilCnpjHash12` or `maskBrazilCnpjForReport`. Both helpers are now referenced only by their
own unit test — zero production callers — so the helpers were left in place rather than deleted, and
the guard is what keeps them unreachable.

The guard strips COMMENTS before grepping, because this very document's subject matter means the
sanitizer's own header explains why `buildBrazilCnpjHash12` is prohibited — and a raw body grep would
report that explanation as a live call, confusing naming a symbol in code with quoting it in prose.
Two negative controls prove the stripper removes comments without shredding code and that a real call
is still detected, and three non-vacuity assertions prove the guard is scanning the connector
directory rather than passing because it looked somewhere empty. An earlier revision of this guard
did exactly that: `path.dirname` on a directory URL landed one level too high, and the guard passed
while judging nothing.

The dedicated sanitizer suite covers the thirteen required proofs: the three removed part fields, the
top-level identity columns, two- and three-field reconstruction, numeric full CNPJ, alphanumeric full
CNPJ (continuous and punctuated), CNPJ básico (numeric, alphanumeric, embedded in text), CPF,
derivative shapes by key and by value, the closed allowlist (unknown key, nested blob, unknown
top-level key, non-object row), person-linked and contact key shapes, `capital_social_value`
continuity, the `source_period`/`cep` negative case, and the benign-value cases (`YYYYMMDD` date,
eight-digit monetary integer, registral codes, eight-letter words, bounded row index).

No real Receita data, manifest, ZIP or CSV is read by any of it. Every CNPJ in the tests is assembled
from a synthetic raiz + ordem with a computed DV, so no 14-position identifier literal appears in
source.

---

## 7. Gate status after this milestone

```text
GATE-1  Legal/Privacy                  approved      (unchanged)
GATE-2  Temporary storage envelope     not_started   reviewable
GATE-3  Field allowlist                not_started   reviewable — this milestone is its evidence
GATE-4  Identity grain                 not_started
GATE-5  Output sanitization            not_started
GATE-6  Failure cleanup                not_started
GATE-7  Operator runbook               not_started
GATE-8  No-write / no-runtime          not_started   reviewable
```

A mechanism existing and passing is not a gate being approved. This milestone approves nothing.
