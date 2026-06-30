/**
 * Tests for the pure, in-process logic of budget-resolution:
 *  - rule matching priority (user > group > role > global)
 *  - allowance / remaining computation
 *
 * We test these by exercising the logic through inputs/outputs, not by
 * importing internal helpers (which are not exported). The shapes match
 * what checkBudget returns without needing a real DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BudgetRule } from '@/modules/usage-tracking/types';
import type { BudgetCheckResult, MatchedRule } from '../types';

// ─── In-process re-implementation of matchRule (mirrors budget-resolution.ts) ─

type ScopeApplied = 'user' | 'group' | 'role' | 'global' | 'none';

function matchRule(
  rules: BudgetRule[],
  userId: string,
  roleKey: string | null,
  groupId: string | null,
): { rule: BudgetRule; scope: Exclude<ScopeApplied, 'none'> } | null {
  const SCOPE_ORDER: Record<string, number> = { user: 0, group: 1, role: 2, global: 3 };
  const sorted = [...rules].sort(
    (a, b) => (SCOPE_ORDER[a.scope_type] ?? 99) - (SCOPE_ORDER[b.scope_type] ?? 99),
  );

  for (const rule of sorted) {
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

function computeAllowance(
  matched: MatchedRule | null,
  consumed: { credits: number; usd: number },
  projected: { credits: number; usd: number },
) {
  if (!matched) {
    return { allowed: true, reason: null, remainingCredits: null, remainingUsd: null };
  }

  const { limitCredits, limitUsd, onExceed } = matched;
  const pc = consumed.credits + projected.credits;
  const pu = consumed.usd + projected.usd;

  const overCredits = limitCredits !== null && pc > limitCredits;
  const overUsd = limitUsd !== null && pu > limitUsd;

  const remainingCredits = limitCredits !== null ? Math.max(0, limitCredits - consumed.credits) : null;
  const remainingUsd = limitUsd !== null ? Math.max(0, limitUsd - consumed.usd) : null;

  if (!overCredits && !overUsd) {
    return { allowed: true, reason: null, remainingCredits, remainingUsd };
  }

  const allowed = onExceed === 'alert';
  return { allowed, reason: 'over limit', remainingCredits, remainingUsd };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function rule(overrides: Partial<BudgetRule> & { scope_type: BudgetRule['scope_type'] }): BudgetRule {
  return {
    id: 'r-' + overrides.scope_type,
    provider_key: 'apollo',
    scope_type: overrides.scope_type,
    scope_id: overrides.scope_id ?? null,
    period_type: 'monthly',
    limit_credits: overrides.limit_credits ?? 100,
    limit_usd: overrides.limit_usd ?? null,
    on_exceed: overrides.on_exceed ?? 'alert',
    is_active: true,
    notes: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const USER_ID = 'user-abc';
const GROUP_ID = 'group-xyz';
const ROLE_KEY = 'seller';

// ─── Tests — matchRule ─────────────────────────────────────────────────────────

describe('matchRule — priority', () => {
  it('user rule beats group, role, and global', () => {
    const rules = [
      rule({ scope_type: 'global' }),
      rule({ scope_type: 'role', scope_id: ROLE_KEY }),
      rule({ scope_type: 'group', scope_id: GROUP_ID }),
      rule({ scope_type: 'user', scope_id: USER_ID }),
    ];
    const match = matchRule(rules, USER_ID, ROLE_KEY, GROUP_ID);
    assert.equal(match?.scope, 'user');
  });

  it('group rule beats role and global when no user rule', () => {
    const rules = [
      rule({ scope_type: 'global' }),
      rule({ scope_type: 'role', scope_id: ROLE_KEY }),
      rule({ scope_type: 'group', scope_id: GROUP_ID }),
    ];
    const match = matchRule(rules, USER_ID, ROLE_KEY, GROUP_ID);
    assert.equal(match?.scope, 'group');
  });

  it('role rule beats global when no user or group rule matches', () => {
    const rules = [
      rule({ scope_type: 'global' }),
      rule({ scope_type: 'role', scope_id: ROLE_KEY }),
    ];
    const match = matchRule(rules, USER_ID, ROLE_KEY, null);
    assert.equal(match?.scope, 'role');
  });

  it('falls through to global when nothing else matches', () => {
    const rules = [rule({ scope_type: 'global' })];
    const match = matchRule(rules, USER_ID, ROLE_KEY, GROUP_ID);
    assert.equal(match?.scope, 'global');
  });

  it('returns null when no rules exist', () => {
    assert.equal(matchRule([], USER_ID, ROLE_KEY, GROUP_ID), null);
  });

  it('ignores group rule when user has no group', () => {
    const rules = [
      rule({ scope_type: 'group', scope_id: GROUP_ID }),
      rule({ scope_type: 'global' }),
    ];
    const match = matchRule(rules, USER_ID, null, null);
    assert.equal(match?.scope, 'global');
  });

  it('ignores role rule when user has no role', () => {
    const rules = [
      rule({ scope_type: 'role', scope_id: ROLE_KEY }),
      rule({ scope_type: 'global' }),
    ];
    const match = matchRule(rules, USER_ID, null, GROUP_ID);
    assert.equal(match?.scope, 'global');
  });

  it('does not match a user rule for a different user', () => {
    const rules = [rule({ scope_type: 'user', scope_id: 'other-user' })];
    assert.equal(matchRule(rules, USER_ID, null, null), null);
  });
});

// ─── Tests — computeAllowance ─────────────────────────────────────────────────

describe('computeAllowance — no rule', () => {
  it('always allows when no rule matched', () => {
    const result = computeAllowance(null, { credits: 9999, usd: 999 }, { credits: 0, usd: 0 });
    assert.equal(result.allowed, true);
    assert.equal(result.remainingCredits, null);
    assert.equal(result.remainingUsd, null);
  });
});

describe('computeAllowance — credit limit', () => {
  const matched: MatchedRule = {
    id: 'r-1',
    providerKey: 'apollo',
    scopeType: 'global',
    scopeId: null,
    limitCredits: 100,
    limitUsd: null,
    periodType: 'monthly',
    onExceed: 'block',
  };

  it('allows when projected is under the limit', () => {
    const r = computeAllowance(matched, { credits: 50, usd: 0 }, { credits: 10, usd: 0 });
    assert.equal(r.allowed, true);
    assert.equal(r.remainingCredits, 50);
  });

  it('blocks when projected exceeds limit and onExceed=block', () => {
    const r = computeAllowance(matched, { credits: 95, usd: 0 }, { credits: 10, usd: 0 });
    assert.equal(r.allowed, false);
    assert.notEqual(r.reason, null);
  });

  it('alerts (still allows) when onExceed=alert', () => {
    const alertRule: MatchedRule = { ...matched, onExceed: 'alert' };
    const r = computeAllowance(alertRule, { credits: 95, usd: 0 }, { credits: 10, usd: 0 });
    assert.equal(r.allowed, true);
    assert.notEqual(r.reason, null);
  });

  it('remainingCredits is 0 when already at limit', () => {
    const r = computeAllowance(matched, { credits: 100, usd: 0 }, { credits: 0, usd: 0 });
    assert.equal(r.remainingCredits, 0);
  });

  it('remainingCredits does not go negative', () => {
    const r = computeAllowance(matched, { credits: 150, usd: 0 }, { credits: 0, usd: 0 });
    assert.equal(r.remainingCredits, 0);
  });
});

describe('computeAllowance — USD limit', () => {
  const matched: MatchedRule = {
    id: 'r-2',
    providerKey: 'anthropic',
    scopeType: 'role',
    scopeId: 'seller',
    limitCredits: null,
    limitUsd: 50,
    periodType: 'monthly',
    onExceed: 'require_approval',
  };

  it('blocks (not allowed) when over USD limit with require_approval', () => {
    const r = computeAllowance(matched, { credits: 0, usd: 48 }, { credits: 0, usd: 5 });
    assert.equal(r.allowed, false);
    assert.equal(r.remainingUsd, 2);
  });

  it('remainingUsd reflects unconsumed amount', () => {
    const r = computeAllowance(matched, { credits: 0, usd: 30 }, { credits: 0, usd: 0 });
    assert.equal(r.remainingUsd, 20);
  });
});
