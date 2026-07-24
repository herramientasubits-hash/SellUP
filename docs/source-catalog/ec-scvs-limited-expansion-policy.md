# EC SCVS Limited Expansion Operating Policy

**Source family:** Ecuador — Superintendencia de Compañías, Valores y Seguros (SCVS)
**Status:** Approved for manual-controlled limited expansion only
**Authority milestone:** EC-SCVS-17 — `ECSCVS17A — LIMITED_EXPANSION_POLICY_READY`
**Applies to:** `scripts/source-catalog/run-ec-scvs-controlled-pilot.ts` operated with `--execution-intent limited_expansion`
**Last reviewed:** 2026-07-24

---

## 1. Purpose

This document is the official operating policy for enriching Ecuador SCVS prospect
candidates under **manual-controlled limited expansion**. It defines exactly how a
human operator is permitted to run the EC-SCVS enrichment runner against production
after the readiness results captured in EC-SCVS-17, and — equally important — what
remains prohibited.

The policy exists so that every future limited-expansion run is:

- reproducible and pre-approved in scope,
- bounded to a small, explicit allowlist of candidates,
- metadata-only in its write footprint,
- free of external provider calls, HubSpot sync, and Slack notifications,
- verifiable through mandatory dry-run and postchecks.

This is not a design proposal or a draft. It is the standing rule for limited
expansion until a separate, explicitly approved milestone promotes EC SCVS to a
broader state.

---

## 2. Scope

**In scope:**

- Manual-controlled limited expansion of Ecuador SCVS prospect candidates.
- Metadata-only enrichment writes to `public.prospect_candidates` for an explicit
  allowlist of candidate IDs belonging to an approved seed batch.
- Operation of the controlled-pilot runner with `--execution-intent limited_expansion`.

**Out of scope (covered by other policies or explicitly blocked — see § 5):**

- Automatic / live prospect generation.
- Full expansion of the Ecuador SCVS source.
- Any other source family.
- Provider calls, HubSpot sync, Slack notifications.
- Schema/migration changes.

---

## 3. Current approved state

> Ecuador SCVS is approved only for manual-controlled limited expansion.
> It is not approved for automatic live generation or full expansion.

Readiness flags as of EC-SCVS-17:

```
OPS_EC_SCVS_17_EVALUATION_PASSED            = true
OPS_EC_SCVS_LIMITED_EXPANSION_POLICY_READY  = true
OPS_EC_SCVS_READY_FOR_LIMITED_EXPANSION_POLICY_DRAFT = true

OPS_EC_SCVS_READY_FOR_LIMITED_EXPANSION     = false
OPS_EC_SCVS_READY_FOR_EXPANSION             = false
OPS_EC_SCVS_LIVE_PROSPECT_GENERATION_READY  = false
```

The existence of this policy document does **not** by itself flip
`OPS_EC_SCVS_READY_FOR_LIMITED_EXPANSION` to `true`. That promotion requires a
separate approved decision (see § 16).

---

## 4. What this policy allows

- Manually prepared batches (draft, Ecuador SCVS, human-authored).
- Explicit candidate allowlists supplied per run.
- A maximum of **5 candidates per batch**.
- A mandatory runner **dry-run first** (no writes).
- **Execute only after** the exact confirmation phrase is supplied.
- **Metadata-only enrichment** — writes limited to
  `public.prospect_candidates.metadata` for allowlisted candidate IDs.
- No external providers.
- No HubSpot sync.
- No Slack notifications.
- No lifecycle status changes required (the runner does not flip candidate
  lifecycle status as part of enrichment).

---

## 5. What remains explicitly blocked

- Live prospect generation.
- Full expansion.
- Open Agent 1 EC execution without a saved batch **and** an explicit allowlist.
- Provider calls (Apollo, Lusha, or any external enrichment provider).
- HubSpot writes / sync.
- Slack notifications.
- `INSERT` or `DELETE` during enrichment.
- DDL / migrations.
- Raw `RUC` / `legal_name` / `raw_data` exposure in reports, logs, or documents.

These blocks apply even when an operator believes a shortcut is harmless. If a run
would require any of the above, it is out of scope for limited expansion and must be
stopped.

---

## 6. Required preconditions

Before any limited-expansion execute run, all of the following must hold:

- Source snapshot loaded (`source_company_snapshots` populated for Ecuador SCVS).
- Candidate batch exists in `public.prospect_batches`.
- Batch `metadata.limited_expansion_seed = true`.
- Batch `metadata.execution_intent = limited_expansion`.
- Batch `metadata.provider_calls_allowed = false`.
- Batch `metadata.do_not_sync_hubspot = true`.
- Batch `metadata.do_not_notify_slack = true`.
- Batch `metadata.max_candidates` is an integer in `[1, 5]`.
- Candidate IDs are supplied as an **explicit allowlist** (never "all candidates").
- `metadata.source_enrichment.ec_scvs` is **absent** on the target candidates
  before execute (idempotency re-runs are a separate, separately approved hito).
- A prior dry-run returned `updated = 0` and the expected per-candidate outcomes.
- The target Supabase project is verified as production
  (`lrdruowtadwbdulndlph`) reachable via the numbered MCP connection.

The runner enforces the batch-metadata guards above as fail-closed refusals
(`batch_not_limited_expansion_seed`, `batch_provider_calls_allowed`,
`batch_hubspot_sync_not_blocked`, `batch_slack_notify_not_blocked`, and the
`max_candidates` range check). Operators must not attempt to bypass them.

---

## 7. Batch limits

| Limit | Value |
|-------|-------|
| Max candidates per batch | **5** (`EC_SCVS_LIMITED_EXPANSION_MAX_CANDIDATES`) |
| Candidate selection | Explicit allowlist only |
| Batch lifecycle | Draft; not promoted by the enrichment run |
| Batches per run | One batch per invocation |

There is no flag or environment override that raises the 5-candidate ceiling for
limited expansion. A larger batch is, by definition, not limited expansion.

---

## 8. Required metadata contract

**Batch (`prospect_batches.metadata`) — must be present before execute:**

```
limited_expansion_seed = true
execution_intent       = limited_expansion
provider_calls_allowed = false
do_not_sync_hubspot    = true
do_not_notify_slack    = true
max_candidates         = <integer in [1, 5]>
```

**Candidate (`prospect_candidates.metadata`) — written by the runner on execute:**

- The runner writes **only** `metadata.source_enrichment.ec_scvs` (and its
  associated summary object).
- The runner does **not** write `raw_data`, does **not** persist the full RUC or
  `tax_identifier`, and does **not** flip candidate lifecycle status or top-level
  fields.
- Batch metadata is **not** mutated by the enrichment run; the guard flags above
  remain intact after execute.

---

## 9. Required execution flow

1. Confirm all § 6 preconditions.
2. Run the runner in **dry-run** mode (no `--execute`, no `--confirm`).
3. Verify the dry-run reports `updated = 0` and the expected matched / ambiguous /
   skipped / no_match outcomes for the allowlist.
4. Only if the dry-run is exactly as expected, run **execute** with the exact
   confirmation phrase.
5. Run the § 12 postchecks.
6. Record sanitized evidence.

If any step deviates from expectation, stop (see § 13). Do not "retry with
`--execute`" to see what happens.

---

## 10. Confirmation phrase

The limited-expansion confirmation phrase is exactly:

```
EC-SCVS LIMITED EXPANSION EXECUTE APROBADO
```

This phrase is **not interchangeable** with the controlled-pilot phrase:

```
EC-SCVS CONTROLLED LIVE PILOT APROBADO
```

The runner selects the required phrase from the `--execution-intent` value and
refuses writes if the supplied `--confirm` string does not match the phrase for that
intent. Supplying the wrong phrase for the intent is a fail-closed refusal, not a
warning.

### Command contract (documented — do not execute as part of this policy)

Dry-run (no writes):

```
ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD=true \
node --env-file=/Users/ub-col-pro-lf4/Documents/SellUp/.env.local --import tsx \
  scripts/source-catalog/run-ec-scvs-controlled-pilot.ts \
  --execution-intent limited_expansion \
  --batch-id "<batch_id>" \
  --candidate-ids "<comma_separated_candidate_ids>"
```

Execute (writes metadata only, after the exact phrase):

```
ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD=true \
node --env-file=/Users/ub-col-pro-lf4/Documents/SellUp/.env.local --import tsx \
  scripts/source-catalog/run-ec-scvs-controlled-pilot.ts \
  --execution-intent limited_expansion \
  --batch-id "<batch_id>" \
  --candidate-ids "<comma_separated_candidate_ids>" \
  --execute \
  --confirm "EC-SCVS LIMITED EXPANSION EXECUTE APROBADO"
```

> The `ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD=true` override is set **inline** for the
> single invocation. It must never be persisted in `.env.local`, exported into the
> shell profile, or left set beyond the run.

---

## 11. Write scope

```
Only UPDATE public.prospect_candidates.metadata for allowlisted candidate_ids.
No INSERT, DELETE, DDL, migrations, external API calls, HubSpot, or Slack.
```

Any write outside this scope is a policy violation and a stop condition.

---

## 12. Required postchecks

After an execute run, verify all of the following:

- `selected` count equals the allowlist count.
- `updated` count equals the allowlist count during execute.
- `matched` / `ambiguous` / `skipped` / `no_match` counts match the expected plan.
- `metadata.source_enrichment.ec_scvs` is present on each allowlisted candidate
  after execute.
- Identity signals match `source_record_identity_key` where the expected outcome is
  `matched`.
- Batch guard flags (§ 8) remain intact.
- No writes occurred outside the allowlist (checksums of non-allowlisted candidates
  unchanged).
- Batch metadata is unchanged.
- Total EC candidate counts are as expected.
- No `raw_data` persisted.
- No sensitive values (full RUC, `tax_identifier`, `legal_name`, `raw_data`) exposed
  in the report.

---

## 13. Stop conditions

Stop immediately if any of the following occur:

- Wrong repository.
- Wrong Supabase project / organization.
- The PR #94 execution-intent contract is not present in the code being operated.
- Batch metadata missing any required guard (§ 6 / § 8).
- More than 5 candidates.
- `candidate_ids` not explicit (e.g. an attempt to run against a whole batch).
- Dry-run reports `updated > 0`.
- Any unexpected per-candidate outcome.
- `source_enrichment.ec_scvs` already present before execute, unless the run is a
  separately approved idempotency-evaluation hito.
- Any attempted provider / HubSpot / Slack call.
- Any `INSERT` / `DELETE` / DDL during enrichment.
- Any sensitive leak (full RUC, `tax_identifier`, `legal_name`, `raw_data`,
  secrets) in output.

A stop means: do not proceed, do not "work around" the condition, and escalate for a
separate decision.

---

## 14. Security and privacy guardrails

- **Production access** is only via the numbered Supabase MCP connection; the default
  token targets the wrong organization. Production project is `lrdruowtadwbdulndlph`.
- **PII footprint:** enrichment persists identity signals and match metadata only.
  Full RUC, `tax_identifier`, `legal_name`, and `raw_data` are never persisted to
  candidate metadata and never printed to reports or logs.
- **RUC validation is not relaxed:** RUCs with a `province_prefix` outside `01–24`,
  `30`, or all-zeros are `skipped` with `invalid_ruc_format` by design. This gate
  (`validateEcuadorRucForScvsLookup`) must not be weakened to increase match rates.
- **Provider usage:** limited expansion makes no external provider calls; there is no
  credit spend and no provider-side PII vector.
- **No standing configuration:** do not create mail rules, webhooks, cron jobs, or
  persistent env changes as part of a run.
- **Legal basis:** broader (live / full) EC SCVS activation remains gated on
  non-technical approval. This policy authorizes only the bounded, metadata-only,
  manual-controlled path described here.

---

## 15. Operational evidence from completed milestones

Sanitized evidence supporting readiness (no sensitive values included):

| Batch | Candidates | Outcome |
|-------|-----------:|---------|
| Control batch | 4 | Edge cases passed |
| Seed batch 1  | 5 | 5 matched |
| Seed batch 2  | 5 | 5 matched |

```
Total EC candidates validated: 14.
Total EC enriched:             14.
Readiness criteria:            15/15 PASS.
```

Edge-case behavior verified on the control batch includes: `skipped` for
`all_zero_ruc`, `skipped` for `missing_ruc`, one `matched` unique case, and a
`no_match` under RUC multiplicity — i.e. the validator and match logic behave
fail-safe on invalid or ambiguous input.

---

## 16. Promotion criteria for future states

This policy governs limited expansion only. Promotion to broader states requires a
separate, explicitly approved milestone and must not be inferred from this document.

| Target state | Flag to flip | Minimum gate |
|--------------|--------------|--------------|
| Limited expansion active | `OPS_EC_SCVS_READY_FOR_LIMITED_EXPANSION` | Approved decision to operate this policy in production; not granted by this doc |
| Expansion | `OPS_EC_SCVS_READY_FOR_EXPANSION` | Separate milestone; broader-scope safety review |
| Live prospect generation | `OPS_EC_SCVS_LIVE_PROSPECT_GENERATION_READY` | Separate milestone; includes non-technical (legal / product) GO |

Until such a decision:

```
OPS_EC_SCVS_READY_FOR_LIMITED_EXPANSION    = false
OPS_EC_SCVS_READY_FOR_EXPANSION            = false
OPS_EC_SCVS_LIVE_PROSPECT_GENERATION_READY = false
```

---

## 17. Appendix: known batch IDs and sanitized outcomes

Batch identifiers are internal UUIDs and carry no PII. Full RUC, `tax_identifier`,
`legal_name`, and `raw_data` are intentionally omitted.

| Role | Batch ID | Candidates | Outcome |
|------|----------|-----------:|---------|
| Control batch | `79a47d8e…` | 4 | Edge cases passed (draft / EC / manual) |
| Seed batch 1  | `efa2c372…` | 5 | 5 matched |
| Seed batch 2  | `6740e00b-0e33-4686-948f-926e470760bb` | 5 | 5 matched |

Seed batch 2 candidate `province_prefix` distribution (allowed, non-sensitive):
`{01, 07, 13, 18, 10}`.

Record identity is keyed at the **expediente** grain. Identity keys appear in the
form `expediente:<sanitized>` (a truncated hash fragment), never as a full 13-digit
RUC or legal name. Match verification compares the persisted identity signals against
`source_record_identity_key`; a match is only accepted when they are equal.

---

*Reference implementation:* `scripts/source-catalog/run-ec-scvs-controlled-pilot.ts`,
`src/server/source-catalog/enrichment/ec-scvs-controlled-pilot.ts`
(execution-intent contract landed in PR #94 / `660cd81`).
