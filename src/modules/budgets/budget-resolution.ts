'use server';

// ============================================================
// budgets — core budget resolution logic (Hito B)
// ============================================================
// Read-only. Does not write to the DB. Does not block executions.
// Designed to be called by enforcement (Hito C) and UI (Hito B-UI).

import type { BudgetRule } from '@/modules/usage-tracking/types';
import type {
  BudgetCheckResult,
  BudgetScopeApplied,
  MatchedRule,
  AdminBudgetSummary,
  AdminProviderBudgetRow,
  UsdCostTruth,
} from './types';
import { getPeriodBounds } from './periods';
import { collectGroupSubtreeIds } from '@/modules/access/group-tree';
import {
  getAdminClient,
  getActiveRulesForProvider,
  getAllActiveRules,
  getAllOrgGroups,
  buildGroupAncestorChain,
  getUserBudgetContext,
  getConsumptionForUser,
  getConsumptionForGroups,
  getConsumptionForRole,
  getConsumptionGlobal,
  getConsumptionByProvider,
  getActiveCatalogEntries,
  getProviderConnectionStatuses,
  getProvidersWithTrackedConsumption,
  getPhoneRevealReservationSnapshot,
  getRunIdsByReservationGroup,
} from './queries';
import {
  computeEffectiveConsumption,
  computeEffectiveConsumptionByProvider,
  type EffectiveConsumption,
  type ReservationSnapshotRow,
  type UsageConsumptionRow,
} from './effective-consumption-core';
import { deriveMeasurementStatus } from './provider-measurement';
import { getBudgetCheckActivity } from './budget-check-activity';

// ─── Rule matching ────────────────────────────────────────────────────────────

/**
 * Picks the most specific active rule for a user from a pre-sorted list.
 * Priority: user → group (closest ancestor wins) → role → global.
 *
 * scope_id stores:
 *   user   → userId (UUID string)
 *   group  → groupId (UUID string) — matched against the ancestor chain
 *   role   → role key (text)
 *   global → null
 *
 * groupAncestorIds: ordered closest-first [userGroupId, parentId, …].
 * The first ancestor that has a group rule wins, so a child group rule
 * always beats a parent group rule.
 */
function matchRule(
  rules: BudgetRule[],
  userId: string,
  roleKey: string | null,
  groupAncestorIds: string[],
): { rule: BudgetRule; scope: Exclude<BudgetScopeApplied, 'none'> } | null {
  // 1. user
  const userRule = rules.find((r) => r.scope_type === 'user' && r.scope_id === userId);
  if (userRule) return { rule: userRule, scope: 'user' };

  // 2. group — walk up the ancestor chain so the most specific group wins
  for (const ancestorId of groupAncestorIds) {
    const groupRule = rules.find((r) => r.scope_type === 'group' && r.scope_id === ancestorId);
    if (groupRule) return { rule: groupRule, scope: 'group' };
  }

  // 3. role
  if (roleKey) {
    const roleRule = rules.find((r) => r.scope_type === 'role' && r.scope_id === roleKey);
    if (roleRule) return { rule: roleRule, scope: 'role' };
  }

  // 4. global
  const globalRule = rules.find((r) => r.scope_type === 'global');
  if (globalRule) return { rule: globalRule, scope: 'global' };

  return null;
}

function toMatchedRule(
  rule: BudgetRule,
  scope: Exclude<BudgetScopeApplied, 'none'>,
): MatchedRule {
  return {
    id: rule.id,
    providerKey: rule.provider_key,
    scopeType: scope,
    scopeId: rule.scope_id,
    limitCredits: rule.limit_credits !== null ? Number(rule.limit_credits) : null,
    limitUsd: rule.limit_usd !== null ? Number(rule.limit_usd) : null,
    periodType: rule.period_type,
    onExceed: rule.on_exceed,
  };
}

// ─── Allowance logic ─────────────────────────────────────────────────────────

/**
 * `reservedCredits` participates in BOTH the remaining figure and the limit check
 * (AGENT2A-PHONE-REVEAL-4N §8). An authorization that is still in flight has already
 * claimed that availability, so reporting it as remaining — or allowing an operation that
 * assumes it is free — would hand the same credits out twice. The atomic reservation would
 * reject the second one anyway; agreeing with it here is what keeps the two resolvers from
 * telling the operator different stories.
 */
function computeAllowance(
  matchedRule: MatchedRule | null,
  consumed: { credits: number; usd: number; reservedCredits: number },
  projected: { credits: number; usd: number },
): {
  allowed: boolean;
  reason: string | null;
  remainingCredits: number | null;
  remainingUsd: number | null;
} {
  if (!matchedRule) {
    return { allowed: true, reason: null, remainingCredits: null, remainingUsd: null };
  }

  const { limitCredits, limitUsd, onExceed } = matchedRule;

  const committedCredits = consumed.credits + consumed.reservedCredits;
  const projectedCredits = committedCredits + projected.credits;
  const projectedUsd = consumed.usd + projected.usd;

  const remainingCredits = limitCredits !== null ? Math.max(0, limitCredits - committedCredits) : null;
  const remainingUsd = limitUsd !== null ? Math.max(0, limitUsd - consumed.usd) : null;

  const overCredits = limitCredits !== null && projectedCredits > limitCredits;
  const overUsd = limitUsd !== null && projectedUsd > limitUsd;

  if (!overCredits && !overUsd) {
    return { allowed: true, reason: null, remainingCredits, remainingUsd };
  }

  const parts: string[] = [];
  if (overCredits) parts.push(`${projectedCredits.toFixed(2)} créditos proyectados vs límite de ${limitCredits}`);
  if (overUsd) parts.push(`$${projectedUsd.toFixed(4)} USD proyectados vs límite de $${limitUsd}`);
  const reason = parts.join('; ');

  const allowed = onExceed === 'alert';
  return { allowed, reason, remainingCredits, remainingUsd };
}

/**
 * Derives whether the USD subtotal in a BudgetCheckResult is complete.
 * PeriodConsumption.hasUnknownCost is the sole authoritative input —
 * FAIL_OPEN_INDETERMINATE: unknown cost truth never changes allow/block
 * or the numeric credit/USD subtotals, it only makes the gap explicit.
 */
function deriveUsdCostTruth(consumed: { hasUnknownCost: boolean }): UsdCostTruth {
  return consumed.hasUnknownCost ? 'unknown' : 'complete';
}

// ─── Effective consumption (AGENT2A-PHONE-REVEAL-4N) ─────────────────────────

/** Providers whose spend can be represented by a phone-reveal credit reservation. */
const PHONE_REVEAL_RESERVATION_PROVIDER_KEYS = ['apollo', 'lusha'] as const;

/** An empty pool, used when no rule matched and there is nothing to aggregate. */
const EMPTY_EFFECTIVE_CONSUMPTION: EffectiveConsumption = {
  credits: 0,
  usd: 0,
  hasUnknownCost: false,
  reservedCredits: 0,
  breakdown: {
    usageLogCredits: 0,
    confirmedReservationCredits: 0,
    excludedUsageLogCredits: 0,
    excludedUsageLogCount: 0,
    hasAssumedCapCredits: false,
    malformedConfirmedReservationCount: 0,
  },
};

/**
 * Reads the reservation snapshot of a pool and resolves the group → run map its
 * exclusions need. Returns an empty snapshot for providers that cannot hold a phone
 * reveal reservation, so the read is skipped entirely for anthropic/tavily/etc.
 *
 * This is the ONLY place either read happens. Both `checkBudget` and
 * `getAdminBudgetSummary` go through it, which is what keeps a single definition of the
 * economic truth: there is no second resolver left that still reads only
 * `provider_usage_logs`.
 */
async function readReservationSnapshot(
  admin: ReturnType<typeof getAdminClient>,
  pool: {
    providerKeys: readonly string[];
    /** Omit for the aggregate summary; present pins one exact pool. */
    scope?: { scopeType: string; scopeId: string | null };
    periodStart: string;
    periodEnd: string;
  },
): Promise<{
  reservations: ReservationSnapshotRow[];
  runIdByReservationGroupId: Map<string, string>;
}> {
  const providerKeys = pool.providerKeys.filter((key) =>
    (PHONE_REVEAL_RESERVATION_PROVIDER_KEYS as readonly string[]).includes(key),
  );
  if (providerKeys.length === 0) {
    return { reservations: [], runIdByReservationGroupId: new Map() };
  }

  const reservations = await getPhoneRevealReservationSnapshot(admin, {
    ...pool,
    providerKeys,
  });

  const groupIds = [
    ...new Set(
      reservations
        .map((row) => row.reservationGroupId)
        .filter((id): id is string => id !== null),
    ),
  ];

  return {
    reservations,
    runIdByReservationGroupId: await getRunIdsByReservationGroup(admin, groupIds),
  };
}

/** Effective consumption of ONE pool: usage rows + its reservation snapshot. */
async function resolveEffectiveConsumption(
  admin: ReturnType<typeof getAdminClient>,
  args: {
    usageLogs: UsageConsumptionRow[];
    providerKeys: readonly string[];
    scope?: { scopeType: string; scopeId: string | null };
    periodStart: string;
    periodEnd: string;
  },
): Promise<EffectiveConsumption> {
  const { reservations, runIdByReservationGroupId } = await readReservationSnapshot(admin, {
    providerKeys: args.providerKeys,
    scope: args.scope,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
  });

  return computeEffectiveConsumption({
    usageLogs: args.usageLogs,
    reservations,
    runIdByReservationGroupId,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolves the applicable budget rule for a user+provider pair and returns
 * the full budget check result including consumption and remaining capacity.
 *
 * @param providerKey - e.g. 'apollo', 'tavily', 'anthropic'
 * @param userId      - internal_users.id of the user triggering the operation
 * @param operation   - optional: credits/usd cost of the operation being checked
 */
export async function checkBudget(
  providerKey: string,
  userId: string,
  operation: { credits?: number; usd?: number } = {},
): Promise<BudgetCheckResult> {
  const admin = getAdminClient();

  const [rules, ctx, allGroups] = await Promise.all([
    getActiveRulesForProvider(admin, providerKey),
    getUserBudgetContext(admin, userId),
    getAllOrgGroups(admin),
  ]);

  const groupAncestorIds = ctx.groupId ? buildGroupAncestorChain(ctx.groupId, allGroups) : [];
  const match = matchRule(rules, userId, ctx.roleKey, groupAncestorIds);
  const matchedRule = match ? toMatchedRule(match.rule, match.scope) : null;

  const periodType = matchedRule?.periodType ?? 'monthly';
  const bounds = getPeriodBounds(periodType);
  const periodStart = bounds.start.toISOString();
  const periodEnd = bounds.end.toISOString();

  let consumed: EffectiveConsumption;
  if (!match) {
    // No rule ⇒ nothing to aggregate against. A reservation cannot exist for a pool
    // that has no rule either: `limit_credits` is NOT NULL in the reservations table.
    consumed = EMPTY_EFFECTIVE_CONSUMPTION;
  } else {
    let usageLogs: UsageConsumptionRow[];
    if (match.scope === 'global') {
      usageLogs = await getConsumptionGlobal(admin, providerKey, periodStart, periodEnd);
    } else if (match.scope === 'group') {
      // Shared pool: matched group + all its descendants
      const groupIds = collectGroupSubtreeIds([match.rule.scope_id!], allGroups);
      usageLogs = await getConsumptionForGroups(admin, providerKey, groupIds, periodStart, periodEnd);
    } else if (match.scope === 'role') {
      // Shared pool: all users with this role
      usageLogs = await getConsumptionForRole(admin, providerKey, ctx.roleKey!, periodStart, periodEnd);
    } else {
      // user — individual consumption
      usageLogs = await getConsumptionForUser(admin, providerKey, userId, periodStart, periodEnd);
    }

    // The reservation snapshot is matched on the pool identity THIS resolution produced,
    // which is also the identity each reservation stored when it was authorized. A
    // reservation taken under a different scope or period simply does not appear here —
    // it stays charged to the pool it was granted against, never re-homed retroactively.
    consumed = await resolveEffectiveConsumption(admin, {
      usageLogs,
      providerKeys: [providerKey],
      scope: { scopeType: match.scope, scopeId: match.rule.scope_id ?? null },
      periodStart,
      periodEnd,
    });
  }

  const projected = { credits: operation.credits ?? 0, usd: operation.usd ?? 0 };

  const { allowed, reason, remainingCredits, remainingUsd } = computeAllowance(
    matchedRule,
    consumed,
    projected,
  );

  return {
    allowed,
    reason,
    providerKey,
    userId,
    periodStart,
    periodEnd,
    scopeApplied: match?.scope ?? 'none',
    matchedRule,
    consumedCredits: consumed.credits,
    consumedUsd: consumed.usd,
    reservedCredits: consumed.reservedCredits,
    consumptionBreakdown: consumed.breakdown,
    projectedCredits: consumed.credits + projected.credits,
    projectedUsd: consumed.usd + projected.usd,
    remainingCredits,
    remainingUsd,
    usdCostTruth: deriveUsdCostTruth(consumed),
  };
}

// ─── Provider-level quota gate (no budget_rule, no Wizard pool) ────────────────

/**
 * AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — whether a provider still has
 * quota under its OWN contracted allowance, using ONLY
 * `tool_catalog.monthly_credits_allowance` (or the live external balance when
 * `quota_source = 'api_synced'`) and `provider_usage_logs`. No `budget_rule`
 * is read or required: a `budget_rule` is an admin-configured SPEND LIMIT
 * (what `checkBudget` above resolves), which is a different concept from the
 * provider's own contracted quota resolved here. When no allowance is
 * configured for the provider, nothing is enforced — exactly like
 * `checkBudget`'s "no rule ⇒ allowed" contract, no limit is ever invented.
 *
 * This mirrors, for a single provider, the SAME `providerCreditsAvailable`
 * figure `getAdminBudgetSummary` already computes and shows on the admin
 * panel — same allowance source, same consumption resolver
 * (`resolveEffectiveConsumption`, which already accounts for in-flight phone
 * reveal reservations for apollo/lusha). It does not change what that summary
 * computes or displays.
 */
export interface ProviderQuotaAvailability {
  /** True when the provider still has quota (or none is configured). */
  allowed: boolean;
  /** null = no allowance configured for this provider — treated as unlimited. */
  providerCreditsAvailable: number | null;
  consumedCredits: number;
  reservedCredits: number;
  periodStart: string;
  periodEnd: string;
}

export async function checkProviderQuotaAvailable(
  providerKey: string,
): Promise<ProviderQuotaAvailability> {
  const admin = getAdminClient();

  const [catalogEntries, bounds] = await Promise.all([
    getActiveCatalogEntries(admin),
    Promise.resolve(getPeriodBounds('monthly')),
  ]);
  const entry = catalogEntries.find((e) => e.providerKey === providerKey) ?? null;

  const periodStart = bounds.start.toISOString();
  const periodEnd = bounds.end.toISOString();

  const isApiSyncedLive =
    entry?.quotaSource === 'api_synced' &&
    !entry.quotaOverrideManual &&
    entry.creditsRemainingExternal !== null;

  // No catalog entry, or no configured quota and no live external balance ⇒
  // nothing to enforce against. The absence of a configured quota never
  // invents a limit — same discipline as `checkBudget` with no matched rule.
  if (!entry || (!isApiSyncedLive && entry.monthlyCreditsAllowance === null)) {
    return {
      allowed: true,
      providerCreditsAvailable: null,
      consumedCredits: 0,
      reservedCredits: 0,
      periodStart,
      periodEnd,
    };
  }

  const usageLogs = await getConsumptionGlobal(admin, providerKey, periodStart, periodEnd);
  const consumed = await resolveEffectiveConsumption(admin, {
    usageLogs,
    providerKeys: [providerKey],
    periodStart,
    periodEnd,
  });

  const providerCreditsAvailable = isApiSyncedLive
    ? entry.creditsRemainingExternal!
    : entry.monthlyCreditsAllowance! - consumed.credits - consumed.reservedCredits;

  return {
    allowed: providerCreditsAvailable > 0,
    providerCreditsAvailable,
    consumedCredits: consumed.credits,
    reservedCredits: consumed.reservedCredits,
    periodStart,
    periodEnd,
  };
}

/**
 * Returns a budget summary for all active providers.
 * Uses the global rule (if any) for each provider to determine the period.
 * Falls back to monthly when no global rule exists.
 * Intended for the admin panel (Hito B-UI).
 */
export async function getAdminBudgetSummary(): Promise<AdminBudgetSummary> {
  const admin = getAdminClient();

  const now = new Date();
  const defaultBounds = getPeriodBounds('monthly', now);
  const periodStart = defaultBounds.start.toISOString();
  const periodEnd = defaultBounds.end.toISOString();

  const [catalogEntries, allRules, defaultPeriodUsage, connectionStatuses, trackedProviders] = await Promise.all([
    getActiveCatalogEntries(admin),
    getAllActiveRules(admin),
    getConsumptionByProvider(admin, periodStart, periodEnd),
    getProviderConnectionStatuses(admin),
    getProvidersWithTrackedConsumption(admin),
  ]);

  // Same canonical calculation as `checkBudget`, applied across every provider at once.
  // The reservation snapshot is read WITHOUT a scope filter here: this summary aggregates
  // usage logs org-wide, so it has to see the per-user pools' reservations too or the
  // spend they represent would vanish from the total (see §5 — Apollo 37 + 8 = 45).
  const defaultPeriodSnapshot = await readReservationSnapshot(admin, {
    providerKeys: PHONE_REVEAL_RESERVATION_PROVIDER_KEYS,
    periodStart,
    periodEnd,
  });
  const consumption = computeEffectiveConsumptionByProvider({
    usageLogs: defaultPeriodUsage,
    reservations: defaultPeriodSnapshot.reservations,
    runIdByReservationGroupId: defaultPeriodSnapshot.runIdByReservationGroupId,
  });

  const providerKeys = catalogEntries.map((e) => e.providerKey);
  const activityMap = await getBudgetCheckActivity(providerKeys);

  // Group rules by provider_key
  const rulesByProvider = new Map<string, BudgetRule[]>();
  for (const rule of allRules) {
    const arr = rulesByProvider.get(rule.provider_key) ?? [];
    arr.push(rule);
    rulesByProvider.set(rule.provider_key, arr);
  }

  // Base: all active catalog entries. Merge rules + consumption onto each.
  const providers: AdminProviderBudgetRow[] = await Promise.all(
    catalogEntries.map(async ({ providerKey, displayName, monthlyCreditsAllowance, monthlyUsdAllowance, quotaSource, quotaSyncedAt, quotaSyncError, quotaOverrideManual, creditsRemainingExternal, usdCostMtd }) => {
      const rules = rulesByProvider.get(providerKey) ?? [];
      const globalRule = rules.find((r) => r.scope_type === 'global') ?? null;
      const periodType = globalRule?.period_type ?? 'monthly';
      const bounds = getPeriodBounds(periodType, now);
      const ps = bounds.start.toISOString();
      const pe = bounds.end.toISOString();

      const consumed: EffectiveConsumption =
        ps === periodStart
          ? (consumption.get(providerKey) ?? EMPTY_EFFECTIVE_CONSUMPTION)
          : await resolveEffectiveConsumption(admin, {
              usageLogs: await getConsumptionGlobal(admin, providerKey, ps, pe),
              providerKeys: [providerKey],
              periodStart: ps,
              periodEnd: pe,
            });

      const limitCredits = globalRule?.limit_credits != null ? Number(globalRule.limit_credits) : null;
      const limitUsd = globalRule?.limit_usd != null ? Number(globalRule.limit_usd) : null;

      const isConnected = connectionStatuses.has(providerKey);
      const hasTrackedConsumption = trackedProviders.has(providerKey);

      // Provider allowance availability (may go negative — shows overrun, no clamping)
      // For api_synced without manual override: use the live external balance from the provider.
      // For manual quota (or api_synced with override): derive from allowance minus SellUp consumption.
      const isApiSyncedLive =
        quotaSource === 'api_synced' && !quotaOverrideManual && creditsRemainingExternal !== null;
      const providerCreditsAvailable = isApiSyncedLive
        ? creditsRemainingExternal
        : monthlyCreditsAllowance !== null
          ? monthlyCreditsAllowance - consumed.credits - consumed.reservedCredits
          : null;
      const providerUsdAvailable = monthlyUsdAllowance !== null
        ? monthlyUsdAllowance - consumed.usd
        : null;

      return {
        providerKey,
        displayName,
        activeRules: rules.length,
        globalLimitCredits: limitCredits,
        globalLimitUsd: limitUsd,
        consumedCredits: consumed.credits,
        consumedUsd: consumed.usd,
        hasUnknownCost: consumed.hasUnknownCost,
        reservedCredits: consumed.reservedCredits,
        consumptionBreakdown: consumed.breakdown,
        // In-flight exposure is subtracted too: an authorization that can still spend has
        // already taken that availability, so reporting it as remaining would invite a
        // second authorization the atomic reservation would then reject.
        remainingCredits:
          limitCredits !== null
            ? Math.max(0, limitCredits - consumed.credits - consumed.reservedCredits)
            : null,
        remainingUsd: limitUsd !== null ? Math.max(0, limitUsd - consumed.usd) : null,
        periodType,
        periodStart: ps,
        periodEnd: pe,
        onExceed: globalRule?.on_exceed ?? null,
        latestBudgetCheckLog: activityMap.get(providerKey)?.latest ?? null,
        recentBudgetCheckLogs: activityMap.get(providerKey)?.recent ?? [],
        isConnected,
        measurementStatus: deriveMeasurementStatus(providerKey, hasTrackedConsumption, isConnected),
        providerMonthlyCreditsAllowance: monthlyCreditsAllowance,
        providerMonthlyUsdAllowance: monthlyUsdAllowance,
        providerCreditsAvailable,
        providerUsdAvailable,
        quotaSource: quotaSource as import('./types').QuotaSource | null,
        quotaSyncedAt,
        quotaSyncError,
        quotaOverrideManual,
        creditsRemainingExternal,
        usdCostMtd,
      };
    }),
  );

  // Sort by provider_key (catalog query already orders, but keep sort as safety)
  providers.sort((a, b) => a.providerKey.localeCompare(b.providerKey));

  return { providers, resolvedAt: now.toISOString() };
}
