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
} from './queries';
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

function computeAllowance(
  matchedRule: MatchedRule | null,
  consumed: { credits: number; usd: number },
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

  const projectedCredits = consumed.credits + projected.credits;
  const projectedUsd = consumed.usd + projected.usd;

  const remainingCredits = limitCredits !== null ? Math.max(0, limitCredits - consumed.credits) : null;
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

  let consumed: Awaited<ReturnType<typeof getConsumptionForUser>>;
  if (!match) {
    consumed = { credits: 0, usd: 0 };
  } else if (match.scope === 'global') {
    consumed = await getConsumptionGlobal(admin, providerKey, periodStart, periodEnd);
  } else if (match.scope === 'group') {
    // Shared pool: matched group + all its descendants
    const groupIds = collectGroupSubtreeIds([match.rule.scope_id!], allGroups);
    consumed = await getConsumptionForGroups(admin, providerKey, groupIds, periodStart, periodEnd);
  } else if (match.scope === 'role') {
    // Shared pool: all users with this role
    consumed = await getConsumptionForRole(admin, providerKey, ctx.roleKey!, periodStart, periodEnd);
  } else {
    // user — individual consumption
    consumed = await getConsumptionForUser(admin, providerKey, userId, periodStart, periodEnd);
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
    projectedCredits: consumed.credits + projected.credits,
    projectedUsd: consumed.usd + projected.usd,
    remainingCredits,
    remainingUsd,
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

  const [catalogEntries, allRules, consumption] = await Promise.all([
    getActiveCatalogEntries(admin),
    getAllActiveRules(admin),
    getConsumptionByProvider(admin, periodStart, periodEnd),
  ]);

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
    catalogEntries.map(async ({ providerKey, displayName }) => {
      const rules = rulesByProvider.get(providerKey) ?? [];
      const globalRule = rules.find((r) => r.scope_type === 'global') ?? null;
      const periodType = globalRule?.period_type ?? 'monthly';
      const bounds = getPeriodBounds(periodType, now);
      const ps = bounds.start.toISOString();
      const pe = bounds.end.toISOString();

      const consumed =
        ps === periodStart
          ? (consumption.get(providerKey) ?? { credits: 0, usd: 0 })
          : await getConsumptionGlobal(admin, providerKey, ps, pe);

      const limitCredits = globalRule?.limit_credits != null ? Number(globalRule.limit_credits) : null;
      const limitUsd = globalRule?.limit_usd != null ? Number(globalRule.limit_usd) : null;

      return {
        providerKey,
        displayName,
        activeRules: rules.length,
        globalLimitCredits: limitCredits,
        globalLimitUsd: limitUsd,
        consumedCredits: consumed.credits,
        consumedUsd: consumed.usd,
        remainingCredits: limitCredits !== null ? Math.max(0, limitCredits - consumed.credits) : null,
        remainingUsd: limitUsd !== null ? Math.max(0, limitUsd - consumed.usd) : null,
        periodType,
        periodStart: ps,
        periodEnd: pe,
        onExceed: globalRule?.on_exceed ?? null,
        latestBudgetCheckLog: activityMap.get(providerKey)?.latest ?? null,
        recentBudgetCheckLogs: activityMap.get(providerKey)?.recent ?? [],
      };
    }),
  );

  // Sort by provider_key (catalog query already orders, but keep sort as safety)
  providers.sort((a, b) => a.providerKey.localeCompare(b.providerKey));

  return { providers, resolvedAt: now.toISOString() };
}
