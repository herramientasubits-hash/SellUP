// ============================================================
// budgets — admin queries for budget rules CRUD (Hito D)
// ============================================================
// No 'use server' — internal helpers for server-only code.

import { getAdminClient } from './queries';
import type { BudgetRule } from './types';
import type { BudgetScopeType } from '@/modules/usage-tracking/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetRuleRow extends BudgetRule {
  providerDisplayName: string;
  scopeLabel: string;
}

export interface BudgetRuleFormOptions {
  providers: Array<{ providerKey: string; displayName: string }>;
  roles: Array<{ key: string; name: string }>;
  groups: Array<{ id: string; displayPath: string }>;
  users: Array<{ id: string; label: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveScopeLabel(
  scopeType: BudgetScopeType,
  scopeId: string | null,
  maps: {
    roleMap: Map<string, string>;
    groupMap: Map<string, string>;
    userMap: Map<string, string>;
  },
): string {
  switch (scopeType) {
    case 'global':
      return 'Global';
    case 'role':
      return scopeId ? (maps.roleMap.get(scopeId) ?? `Rol: ${scopeId}`) : 'Rol (desconocido)';
    case 'group':
      return scopeId ? (maps.groupMap.get(scopeId) ?? 'Grupo (desconocido)') : 'Grupo (desconocido)';
    case 'user':
      return scopeId ? (maps.userMap.get(scopeId) ?? 'Usuario (desconocido)') : 'Usuario (desconocido)';
    default:
      return String(scopeType);
  }
}

function buildGroupPath(
  id: string,
  byId: Map<string, { name: string; parent_group_id: string | null }>,
  visited = new Set<string>(),
): string {
  if (visited.has(id)) return 'Grupo';
  visited.add(id);
  const g = byId.get(id);
  if (!g) return 'Grupo desconocido';
  if (!g.parent_group_id) return g.name;
  return `${buildGroupPath(g.parent_group_id, byId, visited)} / ${g.name}`;
}

// ─── getBudgetRulesForAdmin ───────────────────────────────────────────────────

export async function getBudgetRulesForAdmin(): Promise<BudgetRuleRow[]> {
  const admin = getAdminClient();

  const [rulesResult, toolsResult, rolesResult, groupsResult, usersResult] = await Promise.all([
    admin
      .from('budget_rules')
      .select('*')
      .order('created_at', { ascending: false }),
    admin.from('tool_catalog').select('provider_key, display_name').eq('is_active', true),
    admin.from('roles').select('key, name'),
    admin.from('organization_groups').select('id, name, parent_group_id'),
    admin
      .from('internal_users')
      .select('id, full_name, email')
      .eq('access_status', 'approved'),
  ]);

  const rules = (rulesResult.data ?? []) as BudgetRule[];

  const toolMap = new Map(
    (toolsResult.data ?? []).map((t) => [t.provider_key as string, t.display_name as string]),
  );
  const roleMap = new Map(
    (rolesResult.data ?? []).map((r) => [r.key as string, r.name as string]),
  );
  const groupMap = new Map(
    (groupsResult.data ?? []).map((g) => [g.id as string, g.name as string]),
  );
  const userMap = new Map(
    (usersResult.data ?? []).map((u) => [
      u.id as string,
      u.full_name
        ? `${u.full_name as string} · ${u.email as string}`
        : (u.email as string),
    ]),
  );

  return rules.map((rule) => ({
    ...rule,
    providerDisplayName: toolMap.get(rule.provider_key) ?? rule.provider_key,
    scopeLabel: resolveScopeLabel(rule.scope_type as BudgetScopeType, rule.scope_id, {
      roleMap,
      groupMap,
      userMap,
    }),
  }));
}

// ─── getBudgetRuleFormOptions ─────────────────────────────────────────────────

export async function getBudgetRuleFormOptions(): Promise<BudgetRuleFormOptions> {
  const admin = getAdminClient();

  const [toolsResult, rolesResult, groupsResult, usersResult] = await Promise.all([
    admin
      .from('tool_catalog')
      .select('provider_key, display_name')
      .eq('is_active', true)
      .order('display_name'),
    admin.from('roles').select('key, name').order('name'),
    admin.from('organization_groups').select('id, name, parent_group_id').order('name'),
    admin
      .from('internal_users')
      .select('id, full_name, email')
      .eq('access_status', 'approved')
      .order('full_name'),
  ]);

  const groupRows = (groupsResult.data ?? []) as Array<{
    id: string;
    name: string;
    parent_group_id: string | null;
  }>;
  const groupById = new Map(groupRows.map((g) => [g.id, g]));

  return {
    providers: (toolsResult.data ?? []).map((t) => ({
      providerKey: t.provider_key as string,
      displayName: t.display_name as string,
    })),
    roles: (rolesResult.data ?? []).map((r) => ({
      key: r.key as string,
      name: r.name as string,
    })),
    groups: groupRows.map((g) => ({
      id: g.id,
      displayPath: buildGroupPath(g.id, groupById),
    })),
    users: (usersResult.data ?? []).map((u) => ({
      id: u.id as string,
      label: u.full_name
        ? `${u.full_name as string} · ${u.email as string}`
        : (u.email as string),
    })),
  };
}
