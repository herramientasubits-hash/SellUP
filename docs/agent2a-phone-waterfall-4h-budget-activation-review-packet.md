# AGENT2A-PHONE-WATERFALL-4H — Budget activation review packet

**Type:** read-only review packet (docs only)
**Block:** AGENT2A-PHONE-WATERFALL-4H
**Base:** `main` @ `245a1d5`
**Observation date:** 2026-08-05
**Status of this document:** proposal for review. It authorizes nothing.

---

## 1. Executive summary

Phone reveal waterfall is deployed but switched off.
Migration 104 is applied and validated in Production.
Activation is blocked by budget not being configured for either provider.
This packet does not modify budget rules, feature flags, code, migrations or runtime.

The blocker is not a bug and not a missing deployment. The code deliberately refuses to
authorize a reveal when a provider has no active credit rule
(`budget_not_configured`), because an absent rule used to read as *unlimited* and
authorize real spend. With Apollo holding only inactive rules and Lusha holding none,
every reveal modality — full waterfall, Apollo-only and legacy Lusha-only — is
ineligible today, and would remain ineligible even if the feature flag were turned on.

Two independent decisions are therefore required before any reveal can run, and this
packet asks for neither:

1. approving and activating a per-provider budget rule, and
2. authorizing `ENABLE_PHONE_REVEAL_WATERFALL`.

---

## 2. Technical state inherited from 4G

| Item | Observed state |
|------|----------------|
| PR #218 | merged |
| Base SHA used by this packet | `245a1d5` (current `origin/main`) |
| Migration 104 | applied in Production |
| Reservation table `phone_reveal_credit_reservations` | present |
| Reservation functions | `reserve_and_create_phone_reveal_run`, `confirm_phone_reveal_credits`, `release_phone_reveal_credits` — all three present, all `SECURITY DEFINER` |
| Deployment | ready; canonical alias serves runtime SHA `245a1d5…` |
| `ENABLE_PHONE_REVEAL_WATERFALL` | variable configured in Production, resolved value **false** |
| Waterfall runtime | OFF |
| Provider calls during the block | 0 |
| Credits consumed by the block | 0 |
| `phone_reveal_waterfall_runs` rows | 0 |
| `phone_reveal_credit_reservations` rows | 0 |
| Active reservations | 0 |

Flag state was re-verified at runtime on the canonical host, not inferred from the
presence of the environment variable: `flag_configured = true` and
`enabled_resolved = false` on runtime SHA `245a1d5…`. Presence of the variable is not
evidence that it is on; only the resolved value is.

---

## 3. Current budget state

Budget in this platform is **per provider**. `budget_rules` holds one rule per
(`provider_key` × scope); scope resolves user → group (nearest ancestor) → role →
global; availability is derived as `limit_credits − consumed_credits`, aggregated from
`provider_usage_logs` for that provider inside the rule's period. There is no shared
pool, so a full waterfall needs **Apollo ≥ 8 and Lusha ≥ 5 separately**, never "some
balance ≥ 13".

| Provider | Active rule? | Scope resolved | Monthly limit | Consumed | Reserved | Available | Eligibility |
|----------|--------------|----------------|---------------|----------|----------|-----------|-------------|
| Apollo | NO (3 rules exist, all inactive) | none — no active rule to resolve | n/a | 19 | 0 | n/a | `budget_not_configured` |
| Lusha | NO (no rule of any kind exists) | none | n/a | 5 | 0 | n/a | `budget_not_configured` |

Notes on the consumed column:

- Figures are provider-wide totals for the **current monthly period** (August 2026),
  read from `provider_usage_logs`. Apollo: 12 log rows this period, 19 credits summed,
  5 rows with a null credit value that contribute nothing to the sum. Lusha: 1 log row,
  5 credits.
- These are *indicative*. The number the resolver actually subtracts depends on the
  scope of whichever rule wins the match — a user-scoped rule aggregates only that
  user's consumption, a global rule aggregates everything. Once a scope is chosen, the
  effective consumed value must be recomputed for that scope before setting a limit.
- `Reserved` is 0 because the reservations table is empty; it is a real column of the
  model from migration 104 onward, not a placeholder.

Resulting eligibility, per modality:

| Modality | Required legs | Eligible? | Reason |
|----------|---------------|-----------|--------|
| Full waterfall (Apollo → Lusha) | Apollo 8 **and** Lusha 5 | NO | `budget_not_configured` on both legs |
| Apollo-only | Apollo 8 | NO | `budget_not_configured` |
| Legacy Lusha-only | Lusha 5 | NO | `budget_not_configured` |

Decision precedence in the preflight, worst-first:
`balance_unavailable` > `budget_not_configured` > `insufficient_credits` > `authorized`.

---

## 4. Existing inactive rules

Apollo has three rules on record, none active. Lusha has none. Scope identifiers are
truncated deliberately.

| Provider | Scope type | Scope label | Period | Limit (credits) | Limit (USD) | On exceed | Active |
|----------|-----------|-------------|--------|-----------------|-------------|-----------|--------|
| Apollo | global | — | monthly | 500 | not set | alert | NO |
| Apollo | group | `group:0feef785…` | monthly | 500 | not set | alert | NO |
| Apollo | role | `role:admin` | monthly | 100 | not set | alert | NO |
| Lusha | — | — | — | — | — | — | no rule exists |

Two properties of these rules matter for the activation decision:

- **`on_exceed = alert`, not `block`.** These rules were authored to warn, not to stop.
  Reactivating one as-is does not, by itself, give the ceiling behaviour an activation
  should rely on. The reveal preflight is a separate gate and does block, but the rule's
  own overflow policy should be chosen deliberately rather than inherited.
- **The limits are large relative to a first controlled run.** 500 monthly Apollo
  credits is roughly 62 full Apollo legs. Reactivating a 500-credit rule to permit a
  single 13-credit test authorizes far more exposure than the test needs.

For that reason, reactivating an existing rule is not equivalent to configuring a
budget for a controlled first run, and the two should not be conflated in the decision.

---

## 5. Activation options

None of these is executed by this packet.

### Option A — Keep OFF

- No consumption. Nothing changes.
- Waterfall stays blocked at two independent gates: flag off, and no active rule.
- Legacy direct reveal stays exactly as it is under the current budget gate — also
  ineligible today, for the same `budget_not_configured` reason.
- Cost: the feature remains unproven in Production. Everything validated so far is
  offline or structural.

### Option B — Apollo-only controlled activation

- Activate one Apollo rule; leave Lusha with no active rule.
- Requires an active Apollo rule with **at least 8 credits available**.
- Lusha stays disabled, so a candidate whose Apollo leg finds no phone simply ends
  there — no fallback, no second charge.
- Lower risk: maximum exposure per authorization is 8 credits against one provider.
- Does not exercise the Apollo → Lusha handoff, which is the part of the waterfall that
  has never run in Production. A pass here is not evidence the full path works.

### Option C — Full waterfall controlled activation

- Activate both Apollo and Lusha rules.
- Requires Apollo **≥ 8 available** and Lusha **≥ 5 available**, independently.
- Exercises the complete path including the fallback leg and the two-leg reservation
  group.
- Higher exposure: up to 13 credits per authorization, across two vendors.
- Requires explicit budget review, because it puts a second paid provider in reach of a
  single operator click.

---

## 6. Minimum recommended configuration

Proposed, not applied. Every value below is a recommendation for the owner to accept,
change or reject.

**Recommended path: Option C at the smallest scope that can express it** — a single
QA operator, sized for exactly one authorization per provider, so the first Production
evidence covers the full path without opening a standing budget.

| Field | Apollo | Lusha |
|-------|--------|-------|
| Provider | `apollo` | `lusha` |
| Recommended scope | `user:<QA operator>` — **OWNER_DECISION_REQUIRED** | `user:<QA operator>` — **OWNER_DECISION_REQUIRED** |
| Period | monthly | monthly |
| `limit_credits` | consumed-in-scope + 8 | consumed-in-scope + 5 |
| `limit_usd` | not set | not set |
| `on_exceed` | `block` — **OWNER_DECISION_REQUIRED** | `block` — **OWNER_DECISION_REQUIRED** |
| `is_active` | true, only on approval | true, only on approval |

Justification:

- **User scope, not global/group/role.** User scope is the narrowest the resolver
  supports and it wins the match outright, so it cannot be widened by accident. A
  global rule would authorize every operator at once.
- **Limit expressed as consumed + cap, not as a round number.** The model derives
  availability by subtraction, so a limit set without reference to the scope's existing
  consumption yields an availability nobody predicted. The exact consumed figure must be
  recomputed for the chosen scope at the moment the rule is created — the 19 and 5 in
  §3 are provider-wide totals and are the right inputs only if the chosen scope happens
  to account for all of that consumption.
- **`limit_usd` left unset on purpose.** The reveal path reserves and confirms in
  credits; a USD ceiling would be a second, unenforced unit of account.
- **`on_exceed = block`** is recommended over the `alert` of the existing inactive
  rules, so the rule's own policy agrees with the preflight instead of contradicting it.

**Expected first-run cap:** 13 credits maximum for one authorization under Option C
(8 Apollo + 5 Lusha), 8 under Option B. Both legs are reserved atomically before any
provider is called, so a single authorization cannot exceed its cap even under retry.

**Stop condition:** halt after the **first** authorization, whatever the outcome, and
review before a second. Success, no-phone-found and failure are all informative and all
terminal for the window. Deactivate the rules and return the flag to false at the end of
the window rather than leaving budget standing.

---

## 7. Risks and guardrails

Guardrails already in place:

- **Atomic reservations exist.** Migration 104 is applied: reservation and run are
  created in one transaction, keyed by a pre-generated idempotency key, so a retry
  returns the same run instead of authorizing a second one, and two concurrent
  candidates cannot consume the same availability.
- **The flag is off.** `enabled_resolved = false` at runtime.
- **Without an active rule the system blocks.** `budget_not_configured` is fail-closed
  and precedes any provider call: 0 runs, 0 reservations, 0 usage logs, 0 credits.
- **Per-leg reservation.** A full waterfall reserves 8 against Apollo and 5 against
  Lusha as two rows, all-or-nothing. There is no pool that can silently absorb 13.

Risks to weigh:

- **With an active rule, real provider spend becomes reachable.** The gate that has held
  since deployment is the absence of budget, not the flag alone. Activating a rule
  removes one of the two independent blocks.
- **Turning the waterfall on is a separate, explicit decision** and must not be treated
  as a consequence of configuring budget.
- **A rule's scope is wider than it looks if chosen carelessly.** A global or role rule
  authorizes every operator that resolves to it, not just the QA operator.
- **Reactivating an existing 500-credit rule over-authorizes** a first controlled run by
  roughly two orders of magnitude relative to a single 13-credit test.
- **No monitoring window, no activation.** Do not activate on a Friday or at night, or
  at any time when nobody is watching the run to completion and able to roll back.
- **Start with reduced scope.** First activation should be the narrowest scope and the
  smallest limit that can express one authorization.

---

## 8. Pre-activation checklist

```
[ ] Apollo active budget rule approved
[ ] Apollo available credits >= 8
[ ] Lusha active budget rule approved, only for full waterfall
[ ] Lusha available credits >= 5, only for full waterfall
[ ] Owner approves scope
[ ] Monitoring owner assigned
[ ] Rollback plan accepted
[ ] ENABLE_PHONE_REVEAL_WATERFALL activation explicitly authorized
```

---

## 9. Pending decision

Activation is NOT authorized by this packet.
Budget changes require separate explicit authorization.
Flag activation requires separate explicit authorization.

The owner decisions still open are: which scope each rule targets, what `on_exceed`
policy each rule carries, whether the first window is Option B or Option C, who owns
monitoring, and whether the flag is turned on at all.

---

## 10. Flags

```
AGENT2A_PHONE_WATERFALL_4H_BUDGET_ACTIVATION_REVIEW_PACKET_AUTHORIZED = true
AGENT2A_PHONE_WATERFALL_4H_BUDGET_ACTIVATION_REVIEW_PACKET_PR_READY = false until PR
AGENT2A_PHONE_WATERFALL_4H_BUDGET_ACTIVATION_REVIEW_PACKET_OFFICIAL = false until merge

ENABLE_PHONE_REVEAL_WATERFALL = false
PHONE_WATERFALL_RUNTIME_READY = false
PHONE_WATERFALL_PRODUCTION_ACTIVATION_AUTHORIZED = false
PHONE_WATERFALL_BUDGET_RULE_CHANGE_AUTHORIZED = false

APOLLO_BUDGET_RULE_ACTIVE = false          # observed read-only, 3 rules on record, none active
LUSHA_BUDGET_RULE_ACTIVE = false           # observed read-only, no rule of any kind exists
APOLLO_AVAILABLE_FOR_WATERFALL = n/a       # no active rule, budget_not_configured
LUSHA_AVAILABLE_FOR_WATERFALL = n/a        # no active rule, budget_not_configured
```
