# EC SCVS Operational Closeout

**Source family:** Ecuador — Superintendencia de Compañías, Valores y Seguros (SCVS)
**Status:** Operationally validated; closed for manual-controlled limited expansion only
**Authority milestone:** EC-SCVS-20 — `ECSCVS20CLOSEOUTA — OPERATIONAL_CLOSEOUT_PR_READY`
**Supersedes/complements:** [EC SCVS Limited Expansion Operating Policy](./ec-scvs-limited-expansion-policy.md)
**Last reviewed:** 2026-07-24

---

## 1. Purpose

This document is the official operational closeout for the Ecuador SCVS source-catalog
enrichment path. It records, in one place, what was built, what was validated, how the
source may be operated going forward, what remains blocked, and what evidence exists.

It closes the EC SCVS build-and-validate thread and provides the handoff needed to
decide the next movement — a next country, a further Ecuador batch, or hardening the
operator experience.

This is a summary of record. It does **not** promote Ecuador SCVS to any broader state,
and it does **not** authorize any production write, runner execution, provider call,
HubSpot sync, Slack notification, or migration. Operating limited expansion remains
governed by the separate [limited expansion policy](./ec-scvs-limited-expansion-policy.md).

---

## 2. Final operational state

> Ecuador SCVS is closed as an operationally validated source-catalog enrichment path
> for manual-controlled limited expansion.
>
> It is not approved for automatic live generation, full expansion, provider calls,
> HubSpot sync, or Slack notifications.

Readiness flags at closeout:

```
OPS_EC_SCVS_STATUS_ALIGN_MERGED                 = true
OPS_EC_SCVS_LIMITED_EXPANSION_STATUS_UI_OFFICIAL = true
OPS_EC_SCVS_LIMITED_EXPANSION_POLICY_OFFICIAL   = true

OPS_EC_SCVS_READY_FOR_LIMITED_EXPANSION         = false
OPS_EC_SCVS_READY_FOR_EXPANSION                 = false
OPS_EC_SCVS_LIVE_PROSPECT_GENERATION_READY      = false
```

The policy is official and the UI/config state is aligned, but operating limited
expansion in production still requires the separate approved decision described in the
policy (§ 16 of the policy document). This closeout does not grant it.

---

## 3. What was built

- Official SCVS source snapshot loaded (Ecuador SCVS `source_company_snapshots`
  populated).
- CN1 `record_identity_key` contract using the **expediente** grain.
- Reader / lookup layer over the SCVS snapshot.
- Validator for missing / invalid / ambiguous RUC cases
  (`validateEcuadorRucForScvsLookup`).
- Enrichment adapter mapping SCVS records to candidate enrichment metadata.
- Runtime routing for the Ecuador SCVS enrichment path.
- Controlled runner (`scripts/source-catalog/run-ec-scvs-controlled-pilot.ts`).
- `limited_expansion` confirmation contract (`--execution-intent`, fail-closed
  phrase selection, landed in PR #94 / `660cd81`).
- Metadata contract reconciliation (runner writes only
  `metadata.source_enrichment.ec_scvs` and its summary; no lifecycle flip, no
  top-level mutation, no `raw_data`).
- Official [limited expansion policy](./ec-scvs-limited-expansion-policy.md).
- Source Catalog UI / config status alignment (`limited_manual_expansion`).

---

## 4. What was validated

- Control batch with edge cases passed.
- Seed batch 1 real execution passed — 5/5 matched.
- Seed batch 2 real execution passed — 5/5 matched.
- 14/14 EC candidates enriched.
- 15/15 readiness criteria passed.
- No provider / API / HubSpot / Slack calls.
- No RUC / `raw_data` / secrets leaks.
- No writes outside allowlists.

Edge-case behavior verified on the control batch: `skipped` for `all_zero_ruc`,
`skipped` for `missing_ruc`, one `matched` unique case, and a `no_match` under RUC
multiplicity — the validator and match logic behave fail-safe on invalid or ambiguous
input.

---

## 5. Production evidence

Sanitized evidence only. Batch and candidate identifiers are internal UUIDs and carry
no PII. Full RUC, `tax_identifier`, `normalized_tax_id`, `legal_name`, and `raw_data`
are intentionally omitted.

| Batch | Candidates | Outcome |
|-------|-----------:|---------|
| Control batch | 4 | Edge cases passed |
| Seed batch 1  | 5 | 5 matched |
| Seed batch 2  | 5 | 5 matched |
| **Total**     | **14** | **14 enriched** |

```
Total EC candidates validated: 14.
Total EC enriched:             14.
Readiness criteria:            15/15 PASS.
```

Record identity is keyed at the **expediente** grain; identity keys appear in the form
`expediente:<sanitized>` (a truncated hash fragment), never as a full 13-digit RUC or
legal name. Match verification compares persisted identity signals against
`source_record_identity_key`; a match is accepted only when they are equal.

---

## 6. Current operating model

Manual-controlled limited expansion only:

```
Manual-controlled limited expansion only.
Maximum 5 candidates per batch.
Saved batch required.
Explicit candidate allowlist required.
Dry-run required before execute.
Execute requires exact phrase:
EC-SCVS LIMITED EXPANSION EXECUTE APROBADO
Write scope is metadata-only on allowlisted prospect_candidates.
```

The full preconditions, metadata contract, execution flow, and postchecks are defined
in the [limited expansion policy](./ec-scvs-limited-expansion-policy.md) (§ 6–§ 12).
This closeout summarizes; the policy governs.

---

## 7. Allowed operations

Under the official limited expansion policy, and only after the separate approved
decision to operate it in production:

- Manually prepared batches (draft, Ecuador SCVS, human-authored).
- Explicit per-run candidate allowlists.
- A maximum of 5 candidates per batch.
- A mandatory runner dry-run first (no writes; `updated = 0`).
- Execute only after the exact confirmation phrase
  `EC-SCVS LIMITED EXPANSION EXECUTE APROBADO`.
- Metadata-only enrichment writes to `public.prospect_candidates.metadata` for
  allowlisted candidate IDs.
- Mandatory postchecks and sanitized evidence capture.

---

## 8. Explicitly blocked operations

- Live automatic prospect generation.
- Full expansion.
- Open Agent 1 EC execution without a saved batch **and** an explicit allowlist.
- Provider calls (Apollo, Lusha, or any external enrichment provider).
- HubSpot writes / sync.
- Slack notifications.
- `INSERT` / `DELETE` / DDL during enrichment.
- Exposing full RUC, `tax_identifier`, `normalized_tax_id`, `legal_name`, `raw_data`,
  or secrets in reports, logs, or documents.

These blocks apply even when an operator believes a shortcut is harmless. A run that
would require any of the above is out of scope and must be stopped.

---

## 9. Required safeguards

- **Production access** only via the numbered Supabase MCP connection; the default
  token targets the wrong organization. Production project is `lrdruowtadwbdulndlph`.
- **Inline override only:** `ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD=true` is set inline
  for a single invocation and never persisted to `.env.local`, the shell profile, or
  beyond the run.
- **Dry-run before execute:** a dry-run reporting `updated = 0` with the expected
  per-candidate outcomes is mandatory before any execute.
- **Fail-closed confirmation:** the runner selects the required phrase from
  `--execution-intent` and refuses writes on a mismatch. The limited-expansion phrase
  is not interchangeable with the controlled-pilot phrase.
- **RUC validation not relaxed:** RUCs with a `province_prefix` outside `01–24`, `30`,
  or all-zeros are `skipped` with `invalid_ruc_format` by design; the gate must not be
  weakened to raise match rates.
- **Metadata-only writes:** enrichment persists identity signals and match metadata
  only; no `raw_data`, no full RUC / `tax_identifier`, no lifecycle flip, no batch
  metadata mutation.
- **No standing configuration:** no mail rules, webhooks, cron jobs, or persistent env
  changes as part of a run.

---

## 10. Known batch evidence

Sanitized. Batch identifiers carry no PII; sensitive fields are omitted.

| Role | Batch ID | Candidates | Outcome |
|------|----------|-----------:|---------|
| Control batch | `79a47d8e…` | 4 | Edge cases passed (draft / EC / manual) |
| Seed batch 1  | `efa2c372…` | 5 | 5 matched |
| Seed batch 2  | `6740e00b-0e33-4686-948f-926e470760bb` | 5 | 5 matched |

Seed batch 2 candidate `province_prefix` distribution (allowed, non-sensitive):
`{01, 07, 13, 18, 10}`.

---

## 11. UI/config state

```
EC-SCVS visible state = Expansión limitada manual (limited_manual_expansion)
Policy reference present = true
Live/full expansion blocked = true
```

The Source Catalog surface shows Ecuador SCVS in the `limited_manual_expansion` state
with a reference to the official limited expansion policy, and its `nextAction`
describes operating a limited batch under that policy. Source Catalog tests confirm
that live and full expansion remain blocked at the presentation/config layer.

---

## 12. Security and privacy posture

- **PII footprint:** enrichment persists identity signals and match metadata only.
  Full RUC, `tax_identifier`, `normalized_tax_id`, `legal_name`, and `raw_data` are
  never persisted to candidate metadata and never printed to reports or logs.
- **No provider-side PII vector:** limited expansion makes no external provider calls,
  so there is no credit spend and no provider-side PII exposure.
- **Write footprint:** metadata-only `UPDATE` on allowlisted candidates; no `INSERT`,
  `DELETE`, DDL, or migration during enrichment.
- **Access control:** production reachable only via the numbered Supabase MCP
  connection targeting `lrdruowtadwbdulndlph`.
- **Legal / privacy basis:** broader (live / full) activation involving fiscal
  identifiers and company/contact data remains gated on non-technical approval. This
  closeout and the policy authorize only the bounded, metadata-only, manual-controlled
  path.

---

## 13. Remaining blockers

- Legal / privacy approval for operational use involving fiscal identifiers and
  company/contact data.
- Decision on whether EC limited batches should be operated by the technical owner
  only or exposed through an internal admin UI.
- Full expansion threshold not yet defined.
- Live generation threshold not yet defined.
- HubSpot / Slack sync remains blocked until a separate policy and technical guards
  exist.

---

## 14. Next-country recommendation

| Option | Description |
|--------|-------------|
| **Option A — Brazil next** | Onboard the next jurisdiction (Brazil) into the source-catalog pattern. |
| Option B — Another EC limited batch | Run an additional manual EC batch under the existing policy. |
| Option C — Pause country rollout | Harden the operator UI before onboarding more sources. |

**Recommendation:**

> Recommend Brazil next, while keeping Ecuador available only under the official
> manual-controlled limited expansion policy.

**Justification:**

- Ecuador already reached policy + UI official state.
- A third EC batch adds less architectural learning than onboarding the next country.
- Brazil will test repeatability of the source-catalog pattern on a new jurisdiction
  and prevent overfitting EC-specific assumptions.

This recommendation does not commit dates and does not assert that a viable Brazil
source has been identified; Brazil source viability must be validated in its own
milestone (see § 15).

---

## 15. Recommended next milestones

Primary path (next country):

```
BR-SOURCE-0 — Brazil source discovery and viability assessment
BR-SOURCE-1 — identity grain decision
BR-SOURCE-2 — offline parser/dry-run
BR-SOURCE-3 — import/writer plan
```

Alternative (stay on Ecuador):

```
EC-SCVS-LIMITED-BATCH-N — additional manual batch under existing policy
```

BR-SOURCE-0 is explicitly a discovery/viability gate: it does not assume a source
exists and must confirm data availability, licensing, and identity grain before any
parser or import work is planned.

---

## 16. Appendix: sanitized milestone timeline

Sanitized; verdict codes and outcomes only, no sensitive values.

| Milestone | Verdict | Outcome |
|-----------|---------|---------|
| EC-SCVS foundational (0→7) | — | Readers, adapter, apply CLI, import, routing (PR #64) |
| EC-SCVS-11B | — | First controlled pilot |
| EC-SCVS-12 → 12FIX (PR #80) → 12VERIFY / -R → 12CONTROL | — | Validator hardening; control batch established |
| EC-SCVS-13 / 13B | `SECOND_CONTROLLED_LIVE_PILOT_PASSED` | Write-gap closed; invalid → skipped |
| EC-SCVS-14 (DATA-CREATE / VERIFY / EXECUTE) | `ECSCVS14EXECUTEA` | First real enrichment; 5 allowlisted candidates, metadata-only |
| EC-SCVS-15 → 15FIX (PR #94) | `ECSCVS15FIXA` | Execution-intent contract; metadata contract reconciled |
| EC-SCVS-16 (CREATE / VERIFY / EXECUTE) | `SECOND_LIMITED_BATCH_EXECUTED` | Seed batch 2 enriched; total EC 9 → 14 |
| EC-SCVS-17 (READ-ONLY eval) | `ECSCVS17A — LIMITED_EXPANSION_POLICY_READY` | 15/15 readiness criteria PASS |
| EC-SCVS-18 POLICY → POLICY-LAND (PR #100) | `ECSCVS18POLICYLANDA — LIMITED_EXPANSION_POLICY_MERGED` | Official limited expansion policy merged |
| EC-SCVS-19 STATUS-ALIGN-LAND (PR #102) | `ECSCVS19STATUSALIGNLANDRETRYA — EC_SCVS_LIMITED_EXPANSION_STATUS_MERGED` | UI/config aligned to `limited_manual_expansion` |
| EC-SCVS-20 CLOSEOUT (this document) | `ECSCVS20CLOSEOUTA — OPERATIONAL_CLOSEOUT_PR_READY` | Operational closeout; Brazil recommended next |

---

*Reference implementation:* `scripts/source-catalog/run-ec-scvs-controlled-pilot.ts`,
`src/server/source-catalog/enrichment/ec-scvs-controlled-pilot.ts`.
*Governing policy:* [`docs/source-catalog/ec-scvs-limited-expansion-policy.md`](./ec-scvs-limited-expansion-policy.md).
