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
import {
  getAdminClient,
  getActiveRulesForProvider,
  getAllActiveRules,
  getUserBudgetContext,
  getConsumptionForUser,
  getConsumptionGlobal,
  getConsumptionByProvider,
  getToolCatalog,
} from './queries';

// ─── Rule matching ────────────────────────────────────────────────────────────

/**
 * Picks the most specific active rule for a user from a pre-sorted list.
 * Priority: user → group → role → global.
 *
 * scope_id stores:
 *   user  → userId (UUID string)
 *   group → groupId (UUID string)
 *   role  → role key (text)
 *   global → null
 */
function matchRule(
  rules: BudgetRule[],
  userId: string,
  roleKey: string | null,
  groupId: string | null,
): { rule: BudgetRule; scope: Exclude<BudgetScopeApplied, 'none'> } | null {
  for (const rule of rules) {
    switch (rule.scope_type) {
      case 'user':
        if (rule.scope_id === userId) return { rule, scope: 'user' };
        break;
      case 'group':
        if (groupId && rule.scope_id === groupId) return { rule, scope: 'group' };
        break;
      case 'role':
        if (roleKey && rule.scope_id === roleKey) return { rule, scope: 'role' };
        break;
      case 'global':
        return { rule, scope: 'global' };
    }
  }
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

  const [rules, ctx] = await Promise.all([
    getActiveRulesForProvider(admin, providerKey),
    getUserBudgetContext(admin, userId),
  ]);

  const match = matchRule(rules, userId, ctx.roleKey, ctx.groupId);
  const matchedRule = match ? toMatchedRule(match.rule, match.scope) : null;

  const periodType = matchedRule?.periodType ?? 'monthly';
  const bounds = getPeriodBounds(periodType);
  const periodStart = bounds.start.toISOString();
  const periodEnd = bounds.end.toISOString();

  const isGlobal = match?.scope === 'global';
  const consumed = isGlobal
    ? await getConsumptionGlobal(admin, providerKey, periodStart, periodEnd)
    : await getConsumptionForUser(admin, providerKey, userId, periodStart, periodEnd);

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

  const [allRules, catalog] = await Promise.all([
    getAllActiveRules(admin),
    getToolCatalog(admin),
  ]);

  // Group rules by provider
  const rulesByProvider = new Map<string, BudgetRule[]>();
  for (const rule of allRules) {
    const arr = rulesByProvider.get(rule.provider_key) ?? [];
    arr.push(rule);
    rulesByProvider.set(rule.provider_key, arr);
  }

  // Use monthly as the default period for the summary aggregation.
  // For providers that have a global rule, use that rule's period.
  const now = new Date();
  const defaultBounds = getPeriodBounds('monthly', now);

  // Collect distinct period windows needed so we can batch consumption queries.
  // For simplicity, query monthly for all (admin sees current month snapshot).
  const periodStart = defaultBounds.start.toISOString();
  const periodEnd = defaultBounds.end.toISOString();

  const consumption = await getConsumptionByProvider(admin, periodStart, periodEnd);

  const providers: AdminProviderBudgetRow[] = [];

  // All providers with at least one rule
  for (const [providerKey, rules] of rulesByProvider.entries()) {
    const globalRule = rules.find((r) => r.scope_type === 'global') ?? null;
    const periodType = globalRule?.period_type ?? 'monthly';
    const bounds = getPeriodBounds(periodType, now);
    const ps = bounds.start.toISOString();
    const pe = bounds.end.toISOString();

    // Re-query with correct period if it differs from monthly default
    const consumed =
      ps === periodStart
        ? (consumption.get(providerKey) ?? { credits: 0, usd: 0 })
        : await getConsumptionGlobal(admin, providerKey, ps, pe);

    const limitCredits = globalRule?.limit_credits != null ? Number(globalRule.limit_credits) : null;
    const limitUsd = globalRule?.limit_usd != null ? Number(globalRule.limit_usd) : null;

    providers.push({
      providerKey,
      displayName: catalog.get(providerKey) ?? null,
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
    });
  }

  // Also include providers that have consumption but no rules (informational)
  for (const [providerKey, consumed] of consumption.entries()) {
    if (rulesByProvider.has(providerKey)) continue;
    providers.push({
      providerKey,
      displayName: catalog.get(providerKey) ?? null,
      activeRules: 0,
      globalLimitCredits: null,
      globalLimitUsd: null,
      consumedCredits: consumed.credits,
      consumedUsd: consumed.usd,
      remainingCredits: null,
      remainingUsd: null,
      periodType: 'monthly',
      periodStart,
      periodEnd,
      onExceed: null,
    });
  }

  providers.sort((a, b) => a.providerKey.localeCompare(b.providerKey));

  return { providers, resolvedAt: now.toISOString() };
}
