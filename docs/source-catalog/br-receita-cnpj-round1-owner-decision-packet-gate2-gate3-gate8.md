# BR Receita CNPJ — ROUND-1 owner decision packet: GATE-2, GATE-3, GATE-8

**Milestone:** BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING (packet half)
**Status:** **decision-ready. Approves nothing.** Every value below is a RECOMMENDATION awaiting the
owner; no gate flag in code or docs is flipped by this document.
**Base:** `origin/main` = `067f1055ddcb1432b293023bd0d89727cf6968d9`

```text
GATE1_APPROVED     = true    (PR #320, bd98c5e7 — human legal/privacy owner)
GATE2_REVIEWABLE   = true      GATE2_APPROVED = false
GATE3_REVIEWABLE   = true      GATE3_APPROVED = false
GATE8_REVIEWABLE   = true      GATE8_APPROVED = false

REAL_BENCHMARK_ATTEMPTS_CONSUMED = 2      ATTEMPT_3_ALLOWED = false      NO_RESET_PATH = true
```

Reviewable is not approved. GATE-1 unblocked the REVIEW of GATE-2, GATE-3 and GATE-8 and approved
none of them; the 10K § 13 dependency graph orders review, it does not propagate approval.

---

## 1. GATE-2 — Temporary storage envelope

### 1.1 Ready-to-ratify positions

Each of these is either the actually-implemented design or a figure with stated provenance.

| Field | Recommended | Basis |
| --- | --- | --- |
| `STORAGE_OPTION` | **Option C** — temporary local discardable index | It is the design that exists: `br-receita-cnpj-full-join-partition-workspace.ts`. Option A (in-memory map) cannot hold a national join under a 128 MiB heap; Option B (streaming two-pass) is not built. Naming C also names A and B as **not approved**, as § 6 pass criteria require. |
| `MAX_HEAP_USED_BYTES` | `134_217_728` (128 MiB) | 14B.0A observed `lte_16mb` heap on a bounded run; the cap is an order of magnitude of headroom above a real measurement. |
| `MAX_EXTERNAL_MEMORY_BYTES` | `67_108_864` (64 MiB) | Same profile. Note the closed external-memory investigation: the observed pressure was GC debris, not working set. |
| `MAX_RSS_BYTES` | `536_870_912` (512 MiB) | 14B.0A observed `lte_256mb` RSS. |
| `MAX_RUNTIME_MS` | `21_600_000` (6 h) | **Owner budget ceiling, explicitly NOT a throughput forecast.** No throughput observation supports a forecast: `deriveBrazilReceitaFullJoinRuntimeCapProposal` still refuses, and the 0.92 %-read attempt produced no throughput figure. |
| `MAX_TEMPORARY_STORAGE_BYTES` | `4_294_967_296` (4 GiB) | 14B.0F proposed profile, paired with `minimumFreeDiskBeforeStart = 12 GiB` and `minimumFreeDiskReserve = 8 GiB`. |
| `FAIL_CLOSED_TEMP_DEFAULT` | `0` until a process-scoped Option-C authorization exists | Matches the live code: `BRAZIL_RECEITA_FULL_JOIN_TEMPORARY_STORAGE_POLICY_APPROVED = false`, and a real run refuses. |
| `ALLOWED_WORKSPACE_POLICY` | **ratify existing** | Verified in code, not asserted: outside the repository, outside `$HOME` (itself a git repo in this operator's environment), outside the dataset root, no symlink on the path (path checks **plus** one `realpath`, so a link planted between validation and creation is caught), directory `0o700`, files `0o600`. |
| `TTL` | one run only | `privateMetricArtifactTtlMs = 3_600_000`; the workspace is created for the run. |
| `CLEANUP_SUCCESS` / `CLEANUP_FAILURE` | **verified deletion required on both** | The workspace module is a confined deletion ENGINE: it removes only a directory it created (own parent, own prefix), only files matching its own technical name pattern, has no force flag, and re-checks absence afterwards. |
| `CLEANUP_FAILED_STATUS` | **terminal** | Matches § 6 fail criteria ("never a success-with-residue"). |
| `CLEANUP_NOT_EXECUTED_STATUS` | **terminal** | The code already distinguishes `unverified` from `completed`: an unverifiable deletion is never reported as done. |

### 1.2 A — Phase runtime vs total runtime

**Question.** May the owner set a phase cap SHORTER than the total cap?

**Current state.** `BRAZIL_RECEITA_PROPOSED_FULL_SCAN_BENCHMARK_CAPS` sets
`maxPhaseRuntimeMs = maxRuntimeMs = 21_600_000` — phase == total.

**Contract check — the split IS permitted.** `maxRuntimeMs` and `maxPhaseRuntimeMs` are two
independent members of `BRAZIL_RECEITA_FULL_JOIN_RESOURCE_CAP_KEYS`, each with its own breach code
(`runtime_cap_exceeded`, `phase_runtime_cap_exceeded`), each enforced against its own value in the
envelope enforcer. No validator anywhere relates the two, and neither is derived from the other.
Equality in the proposed profile is a **choice of value, not a structural constraint**.

**Recommendation.**

```text
MAX_PHASE_RUNTIME_MS = 10_800_000   (3 hours)
MAX_RUNTIME_MS       = 21_600_000   (6 hours)
```

**Owner choice required:** ratify the 3 h / 6 h split, or keep phase == total.

### 1.3 B — `maxRowsRead` has no provenance

**Do NOT ratify `360_000_000` merely because the code contains it.**

What the code actually says: `maxRowsRead` is a member of
`BRAZIL_RECEITA_FULL_JOIN_OPERATOR_SUPPLIED_CAP_KEYS` — the 14B.0C provisional proposal deliberately
leaves it **unset**, on the record, because "inventing them would describe a runner nobody has
written". The figure `360_000_000` appears only inside the 14B.0F *proposed benchmark* profile, whose
own header says every figure is "a PROPOSAL for a future owner decision" and where the memory caps
carry a provenance comment (`14B.0A observed …`) and `maxRowsRead` carries none.

**Can existing evidence now establish a defensible bound without reading Receita again?** No. The
2026-07 national inventory (14B.0K) resolved **part identities and published sizes only**:
`empresas` = 10 parts, `estabelecimentos` = 10 parts, with `REAL_DATA_ROWS_OPENED = 0`, no ZIP
opened, no CSV parsed, no reader invoked. Published byte sizes without a measured
bytes-per-row cannot yield a row count, and measuring one means reading Receita.

**Recommendation.**

```text
MAX_ROWS_READ = OPERATOR_SUPPLIED / FAIL_CLOSED
```

Leave it operator-supplied and fail-closed until a documented derivation exists. **No new national
scan.** ATTEMPT_3_ALLOWED remains `false`.

### 1.4 C — Option-C encryption at rest

**Technical finding (verified in code, not asserted).**

- The temporary record is a **fixed-width 16-byte BINARY record of four technical integers**: source
  file ordinal, byte offset, byte length, family code. The writer accepts a
  `BrazilReceitaFullJoinRowReference` and **has no code path that can serialize a string** — there is
  no field for a CNPJ, a razão social, a raw row, a join key, or a hash of one, because there is no
  string field at all. Binary rather than text deliberately, so "just add the key for debugging"
  requires changing the record width, the codec and its tests.
- The file name is derived by the module, never caller-supplied:
  `<family>-part-<5-digit ordinal>.refs`, enforced by a pattern. It carries a family label and a
  **partition ordinal**, which is a function of the hash-bucket assignment of the join key.

```text
OPTION_C_JOIN_KEY_MATERIALIZATION = NO_KEY_BYTES_OR_KEY_HASH_IN_TEMP_RECORD
BUCKET_ORDINAL_PRIVACY_DISPOSITION = OWNER_RATIFICATION_REQUIRED
```

**Recommendation.** Option C **without** encryption-at-rest, while the record layout contains no key
bytes and no key hash.

**⚠️ Contract tension the owner must resolve — this recommendation is NOT contract-clean.** The
GATE-2 contract (approval-gates checklist § 6) states the encryption requirement twice, at two
different scopes:

- *Required evidence:* "If Option C is chosen: **encryption at rest for any material that
  materializes the join key**." → **scoped**, and this layout does not materialize the join key, so
  the requirement is not triggered.
- *Fail / block criteria:* "**Option C approved without encryption-at-rest and a verified destroy
  step**." → **unscoped**, which reads as encryption being unconditional for Option C.

Both sentences are in the authoritative contract. An agent cannot pick between them.
`OWNER_DECISION_REQUIRED`.

**Reopening condition — attach to whichever way the owner decides.** The encryption decision must be
reopened if the temp layout ever stores a raw key, a normalized key, a key hash, a key truncation, a
key fingerprint, or any other owner-defined materialization of the join key.

**Not coded here.** No encryption was implemented in this milestone.

### 1.5 Also unresolved for GATE-2

`§ 6` requires "confirmation the folder is **excluded from every cloud / backup / sync service**".
The workspace is rooted in the OS temp directory and validated to be outside the repository, `$HOME`
and the dataset root — but "not cloud-synced / not backed up" is a property of the operator's
machine, and **no code can attest to it**. This needs an owner/operator attestation, not a test.

### 1.6 GATE-2 verdict

```text
GATE2_READY_FOR_OWNER_DECISION = true
GATE2_REMAINING_OWNER_CHOICES  = [
  phase_runtime_split_3h_vs_phase_equals_total,
  max_rows_read_operator_supplied_vs_documented_bound,
  option_c_encryption_at_rest_scoped_vs_unconditional,
  bucket_ordinal_in_temp_file_name_ratification,
  workspace_excluded_from_cloud_backup_sync_attestation,
]
```

---

## 2. GATE-3 — Field allowlist

The CNPJ-output-hardening PR in this milestone is GATE-3's implementation evidence. See
[`br-receita-cnpj-gate3-cnpj-output-hardening.md`](./br-receita-cnpj-gate3-cnpj-output-hardening.md).

### 2.1 Prohibited output — recommend ratifying as implemented

| Prohibited | Enforced how |
| --- | --- |
| CNPJ básico | removed from the contract; blocked by key AND by context-aware value rule |
| full CNPJ (numeric and alphanumeric) | removed from the contract; blocked by DV-validated value rule |
| reconstructable CNPJ parts | blocked by a pairwise/triple recombination + DV check over the row's own leaves |
| Socios / QSA / CPF / person-linked | fail-closed on INPUT by file-family and key; refused on OUTPUT by key; CPF also by value |
| prohibited CNPJ derivatives (hash / truncation / fingerprint) | `safeIdentifier` and `valid_cnpj_hashes` removed; blocked by key tokens and by hex-digest value shape |

### 2.2 Include — already emitted and contract-compatible

| Field | Emitted as |
| --- | --- |
| sanitized `legal_name` | `legal_name` |
| CNAE primary | `cnae_main_code`, `cnae_main_label` |
| approved CNAE metadata | `cnae_secondary_codes` |
| registration status | `registration_status_code` (`registration_status_label` is always `null` — no status lookup is supplied) |
| company size | `company_size_code` |
| UF | `uf` |
| municipality | `municipality_code`, `municipality_name` |
| `opened_at` | `start_date` (`data_inicio_atividade`) |
| source period | `source_period` |
| provenance | `source_type`, `parser_version`, `source_row_index`, `human_review_required`, and when supplied `source_file_name`, `source_downloaded_at`, `import_batch_id` |

### 2.3 ⚠️ Six emitted fields the round-1 direction did not name

These are on the closed allowlist and are emitted today. They are NOT covered by the include list
above, so each needs an explicit owner call rather than a silent pass:

| Field | Why it needs a decision |
| --- | --- |
| `legal_nature_code` / `legal_nature_label` | natureza jurídica. Registral, not person-linked, but not in the named include set. |
| `matrix_branch_flag` | matriz/filial marker. Innocuous alone; it was the surviving half of the removed identity/hierarchy block, so its retention should be stated deliberately. |
| `simples_opt_in` / `simei_opt_in` | tax-regime flags. |
| `mei_flag` | **interacts with GATE-1 R5.** MEI / empresário individual carries natural-person risk and 10F excludes such records **by default**. Emitting a MEI MARKER is not the same as admitting MEI records, but the relationship should be decided, not inferred. |

### 2.4 `normalized_tax_id`

```text
NORMALIZED_TAX_ID = EXCLUDE FROM SNAPSHOT OUTPUT
```

Recommended, and **already implemented** in this PR. The carve-out in the round-1 direction ("unless
an existing approved contract specifically requires persistence") does not apply: data-contract
§ 5.1/§ 6 does specify it as a fixed column and as part of the writer conflict key, but GATE-3 and
GATE-4 are both `not_started`, so that contract is **not approved**, and R4 is categorical.

**⚠️ Consequence the owner must see.** With `tax_id`, `normalized_tax_id` and `record_identity_key`
all removed, the snapshot row carries **no identity column at all**. That is the fail-closed state,
not a settled design. Which identity a persisted Brazil snapshot may carry — the full CNPJ, a
non-CNPJ-derived surrogate, or none with identity resolved at write time — is a GATE-3 / GATE-4
question. No substitute was invented here, because a hash or truncation of the CNPJ would be the same
R4 breach under a different name.

### 2.5 `capital_social_value` and `trade_name`

```text
CAPITAL_SOCIAL_VALUE = prepare owner decision as INCLUDE; behavior UNCHANGED in this PR
CAPITAL_SOCIAL_BEHAVIOR_CHANGED = false

TRADE_NAME_STATUS = NOT_IMPLEMENTED
```

`trade_name` is **EXCLUDED because it is not implemented.** Precisely: the file reader recognizes
`nome_fantasia` in the ESTABELECIMENTOS layout and deliberately DROPS it — it is in the
"recognized-but-ignored (non-sensitive)" group and `mapEstabelecimentos` never copies it — so it is
absent from the input row type and unmapped by the builder. It is a **parser gap**. It must not be
recorded as "prohibited by policy". If the owner wants it, that is new modelling work, and its
"non-sensitive" classification in the reader is the starting point, not the conclusion.

### 2.6 `raw_data` and the allowlist version

`raw_data` is a **CLOSED TYPED ALLOWLIST**: 25 keys, each with a declared value shape, enforced at
build time. An unknown key is refused; a nested object under a scalar key (an arbitrary source blob)
is refused; unknown-field passthrough is impossible.

```text
FIELD_ALLOWLIST_VERSION = br-receita-cnpj-field-allowlist@2   (PROPOSED — not approved)
```

Proposed, not applied: version 2 is the post-hardening shape (v1 being the pre-hardening shape that
carried CNPJ material). Stamping it is part of the GATE-3 approval, not of the code PR.

### 2.7 GATE-3 verdict

```text
GATE3_READY_FOR_OWNER_DECISION_AFTER_THIS_PR = true
GATE3_REMAINING_OWNER_CHOICES = [
  identity_carrier_none_vs_normalized_tax_id_vs_non_cnpj_surrogate,
  capital_social_value_include_confirm,
  legal_nature_code_and_label_include_confirm,
  matrix_branch_flag_include_confirm,
  simples_and_simei_opt_in_include_confirm,
  mei_flag_include_vs_r5_natural_person_exclusion,
  field_allowlist_version_stamp,
  free_text_field_residual_all_letter_raiz_accept_or_narrow,
]
```

---

## 3. GATE-8 — No-write / no-runtime guarantee

GATE-8 is approved **as a CONTRACT**. Approving it must activate nothing.

### 3.1 State preserved, verified on this base

```text
maxOutputRows                        0          NullBenchmarkSink          present
snapshot persistence                 none       Supabase writes            0
Brazil runtime                       disabled   migrations                 0
Brazil in Agent 1 enrichment config  absent     feature/provider flags     untouched
```

### 3.2 What the contract must REQUIRE of future implementation

Each is a requirement on work not yet done, provable at that time:

1. **no-write-by-default** — a run that reaches a write path with no explicit authorization aborts.
2. **allowlist-only output** — every emitted field on the closed typed allowlist; unknown-field
   passthrough impossible. (The mechanism exists as of this milestone.)
3. **no prohibited key material** — no CNPJ básico, full CNPJ, reconstructable parts, or
   hash/truncation/fingerprint of any of them, in output, logs, file names, paths or report fields.
4. **bounded emission** — an emission cap enforced as an equality at zero until raised by an
   explicit, recorded authorization.
5. **atomic snapshot publication** — a period's snapshot becomes visible all-or-nothing.
6. **rollback** — a failed or superseded publication returns the reader to the prior period.
7. **integrity validation** — row counts and checksums verified before a publication is visible.
8. **fail-closed runtime** — absent or invalid configuration disables Brazil rather than defaulting.
9. **no runtime import unless separately authorized** — no Brazil module reachable from the runtime
   graph without its own authorization.

### 3.3 Explicitly missing — post-gate engineering

```text
ATOMIC_PUBLISH_IMPLEMENTATION = MISSING — POST-GATE ENGINEERING
ENGINE_TO_SNAPSHOT_BRIDGE     = MISSING — POST-GATE ENGINEERING
```

Both verified absent on this base: no publish path exists anywhere in `src/server` or `scripts`, and
neither the full-join engine nor the real-full-scan benchmark references
`buildBrReceitaCnpjSnapshotRows`. **Neither was implemented in this PR.** GATE-8 as a contract states
requirements they must later satisfy; it does not assert they exist.

### 3.4 GATE-8 verdict

```text
GATE8_READY_FOR_OWNER_DECISION = true
GATE8_REMAINING_OWNER_CHOICES = [
  approve_as_contract_only_confirm_no_activation,
  emission_cap_stays_equality_at_zero_confirm,
  integrity_validation_scope_rowcount_vs_checksum_vs_both,
  rollback_granularity_period_vs_snapshot,
  runtime_import_authorization_owner_vs_engineering,
]
```

---

## 4. What comes after — from existing evidence only

Once this PR is merged **and** GATES 2/3/8 are owner-approved:

```text
ROUND 2   GATE-4 (identity grain) + GATE-6 (failure cleanup)
ROUND 3   GATE-5 (output sanitization)
ROUND 4   GATE-7 (operator runbook)
```

No further generic audit is proposed. Then engineering, in order:

- **PR B** — engine → safe snapshot bridge; atomic publish; period/month identity; rollback;
  integrity; runtime reader.
- **PR C** — Brazil Agent 1 adapter/config; country routing; dedup integration; review metadata;
  fail-closed rollout; QA.

GATE-4 is coupled to § 2.4 above: the identity-carrier question this PR opened is exactly GATE-4's
subject, so ROUND 2 should read § 2.4 first.

---

## 5. Standing prohibitions — unchanged by this packet

```text
REAL_BENCHMARK_ATTEMPTS_CONSUMED = 2     ATTEMPT_3_ALLOWED = false     NO_RESET_PATH = true
BENCHMARK_ATTEMPT_BUDGET_RESET   = false
HISTORICAL_EXECUTIONS_RETROACTIVELY_APPROVED = false
```

No socios file family. No QSA file family. No CPF in any form, including hashed, truncated or
fingerprinted. No explicitly person-linked Receita file family. No automatic production enablement.
No Supabase write and no import authorization implied by GATE-1. No Agent 1 Brazil enablement implied
by GATE-1. No provider write implied by GATE-1. Downstream gates remain independently required.
Privacy and sanitization controls remain mandatory. Any downstream persistence or output must satisfy
its own gates.
