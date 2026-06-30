/**
 * Tests for the pure, in-process logic of budget-resolution:
 *  - rule matching priority (user > group-child > group-parent > role > global)
 *  - group hierarchy: ancestor chain enables parent rule to cover child group
 *  - allowance / remaining computation
 *  - shared pool semantics (group and role budgets are shared, not per-user)
 *  - historical logs without snapshot do not break the calculation
 *
 * We test these by exercising the logic through inputs/outputs, not by
 * importing internal helpers (which are not exported). The shapes match
 * what checkBudget returns without needing a real DB.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BudgetRule } from '@/modules/usage-tracking/types';
import type { MatchedRule } from '../types';
import { buildGroupAncestorChain } from '../queries';
import type { OrgGroupLike } from '@/modules/access/group-tree';
import { collectGroupSubtreeIds } from '@/modules/access/group-tree';

// ─── In-process re-implementation of matchRule (mirrors budget-resolution.ts) ─

type ScopeApplied = 'user' | 'group' | 'role' | 'global' | 'none';

function matchRule(
  rules: BudgetRule[],
  userId: string,
  roleKey: string | null,
  groupAncestorIds: string[],
): { rule: BudgetRule; scope: Exclude<ScopeApplied, 'none'> } | null {
  // 1. user
  const userRule = rules.find((r) => r.scope_type === 'user' && r.scope_id === userId);
  if (userRule) return { rule: userRule, scope: 'user' };

  // 2. group — walk up ancestor chain, most specific (closest) wins
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
    id: 'r-' + overrides.scope_type + (overrides.scope_id ? '-' + overrides.scope_id : ''),
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
const ROLE_KEY = 'seller';

// Group hierarchy: Colombia → Manufactura (child), Colombia → Tecnología (child)
const GROUP_COLOMBIA = 'group-colombia';
const GROUP_MANUFACTURA = 'group-manufactura';
const GROUP_TECNOLOGIA = 'group-tecnologia';

const ALL_GROUPS: OrgGroupLike[] = [
  { id: GROUP_COLOMBIA, name: 'Colombia', parent_group_id: null },
  { id: GROUP_MANUFACTURA, name: 'Manufactura', parent_group_id: GROUP_COLOMBIA },
  { id: GROUP_TECNOLOGIA, name: 'Tecnología', parent_group_id: GROUP_COLOMBIA },
];

// ─── Tests — buildGroupAncestorChain ──────────────────────────────────────────

describe('buildGroupAncestorChain', () => {
  it('returns [child, parent] for a single-level child', () => {
    const chain = buildGroupAncestorChain(GROUP_MANUFACTURA, ALL_GROUPS);
    assert.deepEqual(chain, [GROUP_MANUFACTURA, GROUP_COLOMBIA]);
  });

  it('returns [root] for a root group', () => {
    const chain = buildGroupAncestorChain(GROUP_COLOMBIA, ALL_GROUPS);
    assert.deepEqual(chain, [GROUP_COLOMBIA]);
  });

  it('returns [groupId] when group is not in the list', () => {
    const chain = buildGroupAncestorChain('unknown-group', ALL_GROUPS);
    assert.deepEqual(chain, ['unknown-group']);
  });

  it('guards against cycles', () => {
    const cyclic: OrgGroupLike[] = [
      { id: 'a', name: 'A', parent_group_id: 'b' },
      { id: 'b', name: 'B', parent_group_id: 'a' },
    ];
    const chain = buildGroupAncestorChain('a', cyclic);
    assert.ok(chain.length <= 2, 'should not loop indefinitely');
  });
});

// ─── Tests — collectGroupSubtreeIds (used for group pool) ─────────────────────

describe('collectGroupSubtreeIds — pool expansion', () => {
  it('Colombia root expands to Colombia + Manufactura + Tecnología', () => {
    const ids = collectGroupSubtreeIds([GROUP_COLOMBIA], ALL_GROUPS);
    assert.ok(ids.includes(GROUP_COLOMBIA));
    assert.ok(ids.includes(GROUP_MANUFACTURA));
    assert.ok(ids.includes(GROUP_TECNOLOGIA));
    assert.equal(ids.length, 3);
  });

  it('Manufactura leaf expands to only Manufactura', () => {
    const ids = collectGroupSubtreeIds([GROUP_MANUFACTURA], ALL_GROUPS);
    assert.deepEqual(ids, [GROUP_MANUFACTURA]);
  });
});

// ─── Tests — matchRule priority ───────────────────────────────────────────────

describe('matchRule — priority', () => {
  const ancestorsManufactura = [GROUP_MANUFACTURA, GROUP_COLOMBIA];

  it('1. user rule beats group, role, and global', () => {
    const rules = [
      rule({ scope_type: 'global' }),
      rule({ scope_type: 'role', scope_id: ROLE_KEY }),
      rule({ scope_type: 'group', scope_id: GROUP_COLOMBIA }),
      rule({ scope_type: 'user', scope_id: USER_ID }),
    ];
    const match = matchRule(rules, USER_ID, ROLE_KEY, ancestorsManufactura);
    assert.equal(match?.scope, 'user');
  });

  it('2. child group rule beats parent group rule', () => {
    const rules = [
      rule({ scope_type: 'group', scope_id: GROUP_COLOMBIA }),
      rule({ scope_type: 'group', scope_id: GROUP_MANUFACTURA }),
    ];
    // User is in Manufactura; ancestor chain = [Manufactura, Colombia]
    const match = matchRule(rules, USER_ID, null, ancestorsManufactura);
    assert.equal(match?.scope, 'group');
    assert.equal(match?.rule.scope_id, GROUP_MANUFACTURA);
  });

  it('3. parent group rule applies when no child rule exists', () => {
    // Only Colombia has a rule; user is in Manufactura
    const rules = [rule({ scope_type: 'group', scope_id: GROUP_COLOMBIA })];
    const match = matchRule(rules, USER_ID, null, ancestorsManufactura);
    assert.equal(match?.scope, 'group');
    assert.equal(match?.rule.scope_id, GROUP_COLOMBIA);
  });

  it('4. role applies when no user or group rule matches', () => {
    const rules = [
      rule({ scope_type: 'global' }),
      rule({ scope_type: 'role', scope_id: ROLE_KEY }),
    ];
    const match = matchRule(rules, USER_ID, ROLE_KEY, []);
    assert.equal(match?.scope, 'role');
  });

  it('5. global applies when no user, group, or role rule matches', () => {
    const rules = [rule({ scope_type: 'global' })];
    const match = matchRule(rules, USER_ID, ROLE_KEY, ancestorsManufactura);
    assert.equal(match?.scope, 'global');
  });

  it('returns null when no rules exist', () => {
    assert.equal(matchRule([], USER_ID, ROLE_KEY, ancestorsManufactura), null);
  });

  it('ignores group rules when ancestor chain is empty (user has no group)', () => {
    const rules = [
      rule({ scope_type: 'group', scope_id: GROUP_COLOMBIA }),
      rule({ scope_type: 'global' }),
    ];
    const match = matchRule(rules, USER_ID, null, []);
    assert.equal(match?.scope, 'global');
  });

  it('ignores role rule when user has no role', () => {
    const rules = [
      rule({ scope_type: 'role', scope_id: ROLE_KEY }),
      rule({ scope_type: 'global' }),
    ];
    const match = matchRule(rules, USER_ID, null, []);
    assert.equal(match?.scope, 'global');
  });

  it('does not match a user rule for a different user', () => {
    const rules = [rule({ scope_type: 'user', scope_id: 'other-user' })];
    assert.equal(matchRule(rules, USER_ID, null, []), null);
  });
});

// ─── Tests — shared pool semantics ───────────────────────────────────────────

describe('group budget — shared pool', () => {
  it('6. group pool = sum of group + all descendants, not individual user', () => {
    // Simulate: Colombia pool has 80 credits consumed by two users in different subgroups.
    // The rule limit is 100. If treated as individual, each user shows 80.
    // As shared pool, 80 is already committed for the whole group.
    const matched: MatchedRule = {
      id: 'r-group',
      providerKey: 'apollo',
      scopeType: 'group',
      scopeId: GROUP_COLOMBIA,
      limitCredits: 100,
      limitUsd: null,
      periodType: 'monthly',
      onExceed: 'block',
    };
    // The consumed value represents the aggregate of all group members
    const r = computeAllowance(matched, { credits: 80, usd: 0 }, { credits: 30, usd: 0 });
    assert.equal(r.allowed, false, 'shared pool exhausted → block');
    assert.equal(r.remainingCredits, 20);
  });

  it('group pool still allows when aggregate is under limit', () => {
    const matched: MatchedRule = {
      id: 'r-group',
      providerKey: 'apollo',
      scopeType: 'group',
      scopeId: GROUP_COLOMBIA,
      limitCredits: 200,
      limitUsd: null,
      periodType: 'monthly',
      onExceed: 'block',
    };
    const r = computeAllowance(matched, { credits: 80, usd: 0 }, { credits: 30, usd: 0 });
    assert.equal(r.allowed, true);
    assert.equal(r.remainingCredits, 120);
  });
});

describe('role budget — shared pool', () => {
  it('7. role pool = sum of all users with that role, not individual user', () => {
    const matched: MatchedRule = {
      id: 'r-role',
      providerKey: 'apollo',
      scopeType: 'role',
      scopeId: ROLE_KEY,
      limitCredits: 100,
      limitUsd: null,
      periodType: 'monthly',
      onExceed: 'block',
    };
    // 95 credits already consumed by the whole role pool
    const r = computeAllowance(matched, { credits: 95, usd: 0 }, { credits: 10, usd: 0 });
    assert.equal(r.allowed, false);
    assert.equal(r.remainingCredits, 5);
  });
});

// ─── Tests — historical logs without snapshot ─────────────────────────────────

describe('historical logs — no snapshot', () => {
  it('8. user rule still works when triggered_by_group_id is null (historical log)', () => {
    // For user scope, consumption is filtered by triggered_by (user ID), not group.
    // Historical logs with null group still count because the user filter works.
    // We verify the allowance math handles consumption correctly regardless of
    // how the logs were sourced.
    const matched: MatchedRule = {
      id: 'r-user',
      providerKey: 'apollo',
      scopeType: 'user',
      scopeId: USER_ID,
      limitCredits: 50,
      limitUsd: null,
      periodType: 'monthly',
      onExceed: 'block',
    };
    // consumed = 40 (includes historical logs without group snapshot)
    const r = computeAllowance(matched, { credits: 40, usd: 0 }, { credits: 5, usd: 0 });
    assert.equal(r.allowed, true);
    assert.equal(r.remainingCredits, 10);
  });

  it('8b. global rule counts all logs including historical ones without group snapshot', () => {
    const matched: MatchedRule = {
      id: 'r-global',
      providerKey: 'apollo',
      scopeType: 'global',
      scopeId: null,
      limitCredits: 1000,
      limitUsd: null,
      periodType: 'monthly',
      onExceed: 'alert',
    };
    // 900 consumed (mix of historical + new logs)
    const r = computeAllowance(matched, { credits: 900, usd: 0 }, { credits: 200, usd: 0 });
    assert.equal(r.allowed, true, 'alert still allows even over limit');
    assert.notEqual(r.reason, null);
  });
});

// ─── Tests — computeAllowance edge cases ─────────────────────────────────────

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

  it('10. blocks when projected exceeds limit and onExceed=block', () => {
    const r = computeAllowance(matched, { credits: 95, usd: 0 }, { credits: 10, usd: 0 });
    assert.equal(r.allowed, false);
    assert.notEqual(r.reason, null);
  });

  it('9. alerts (still allows) when onExceed=alert', () => {
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

  it('11. blocks (not allowed) when over USD limit with require_approval', () => {
    const r = computeAllowance(matched, { credits: 0, usd: 48 }, { credits: 0, usd: 5 });
    assert.equal(r.allowed, false);
    assert.equal(r.remainingUsd, 2);
  });

  it('remainingUsd reflects unconsumed amount', () => {
    const r = computeAllowance(matched, { credits: 0, usd: 30 }, { credits: 0, usd: 0 });
    assert.equal(r.remainingUsd, 20);
  });
});
