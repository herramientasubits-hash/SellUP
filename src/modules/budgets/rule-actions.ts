'use server';

// ============================================================
// budgets — server actions for budget rules CRUD (Hito D)
// ============================================================

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin, getCurrentUser } from '@/modules/access/actions';
import { getAdminClient } from './queries';
import type { BudgetOnExceed, BudgetPeriodType, BudgetScopeType } from '@/modules/usage-tracking/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateBudgetRuleInput {
  providerKey: string;
  scopeType: BudgetScopeType;
  scopeId: string | null;
  periodType: BudgetPeriodType;
  limitCredits: number | null;
  limitUsd: number | null;
  onExceed: BudgetOnExceed;
  notes?: string | null;
}

export interface UpdateBudgetRuleInput {
  id: string;
  limitCredits: number | null;
  limitUsd: number | null;
  onExceed: BudgetOnExceed;
  notes?: string | null;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_SCOPE_TYPES: BudgetScopeType[] = ['global', 'role', 'group', 'user'];
const VALID_PERIOD_TYPES: BudgetPeriodType[] = ['monthly', 'quarterly', 'annual', 'custom'];
const VALID_ON_EXCEED: BudgetOnExceed[] = ['alert', 'block', 'require_approval'];

// ─── createBudgetRule ─────────────────────────────────────────────────────────

export async function createBudgetRule(input: CreateBudgetRuleInput): Promise<ActionResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return { success: false, error: 'No autorizado.' };

  if (!VALID_SCOPE_TYPES.includes(input.scopeType)) {
    return { success: false, error: 'Alcance inválido.' };
  }
  if (!VALID_PERIOD_TYPES.includes(input.periodType)) {
    return { success: false, error: 'Período inválido.' };
  }
  if (!VALID_ON_EXCEED.includes(input.onExceed)) {
    return { success: false, error: 'Acción al superar inválida.' };
  }
  if (input.scopeType === 'global' && input.scopeId !== null) {
    return { success: false, error: 'Alcance global no admite selector.' };
  }
  if (input.scopeType !== 'global' && !input.scopeId) {
    return { success: false, error: 'Se requiere selector para este alcance.' };
  }

  const hasCredits = input.limitCredits != null && input.limitCredits > 0;
  const hasUsd = input.limitUsd != null && input.limitUsd > 0;
  if (!hasCredits && !hasUsd) {
    return { success: false, error: 'Se requiere al menos un límite (créditos o USD) mayor a 0.' };
  }

  const admin = getAdminClient();

  const { data: tool } = await admin
    .from('tool_catalog')
    .select('provider_key')
    .eq('provider_key', input.providerKey)
    .eq('is_active', true)
    .maybeSingle();
  if (!tool) return { success: false, error: 'Proveedor no válido o inactivo.' };

  if (input.scopeType === 'role') {
    const { data: role } = await admin
      .from('roles')
      .select('key')
      .eq('key', input.scopeId!)
      .maybeSingle();
    if (!role) return { success: false, error: 'Rol no encontrado.' };
  } else if (input.scopeType === 'group') {
    const { data: group } = await admin
      .from('organization_groups')
      .select('id')
      .eq('id', input.scopeId!)
      .maybeSingle();
    if (!group) return { success: false, error: 'Grupo no encontrado.' };
  } else if (input.scopeType === 'user') {
    const { data: user } = await admin
      .from('internal_users')
      .select('id')
      .eq('id', input.scopeId!)
      .maybeSingle();
    if (!user) return { success: false, error: 'Usuario no encontrado.' };
  }

  const currentUser = await getCurrentUser();

  const { error } = await admin.from('budget_rules').insert({
    provider_key: input.providerKey,
    scope_type: input.scopeType,
    scope_id: input.scopeType === 'global' ? null : input.scopeId,
    period_type: input.periodType,
    limit_credits: input.limitCredits ?? null,
    limit_usd: input.limitUsd ?? null,
    on_exceed: input.onExceed,
    is_active: true,
    notes: input.notes ?? null,
    created_by: currentUser?.id ?? null,
  });

  if (error) {
    if (error.code === '23505') {
      return { success: false, error: 'Ya existe una regla para este proveedor y alcance.' };
    }
    console.error('[createBudgetRule]', error);
    return { success: false, error: 'Error al crear la regla.' };
  }

  revalidatePath('/settings/providers', 'layout');

  return { success: true };
}

// ─── updateBudgetRule ─────────────────────────────────────────────────────────

export async function updateBudgetRule(input: UpdateBudgetRuleInput): Promise<ActionResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return { success: false, error: 'No autorizado.' };

  if (!input.id) return { success: false, error: 'ID de regla requerido.' };
  if (!VALID_ON_EXCEED.includes(input.onExceed)) {
    return { success: false, error: 'Acción al superar inválida.' };
  }

  const hasCredits = input.limitCredits != null && input.limitCredits > 0;
  const hasUsd = input.limitUsd != null && input.limitUsd > 0;
  if (!hasCredits && !hasUsd) {
    return { success: false, error: 'Se requiere al menos un límite mayor a 0.' };
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from('budget_rules')
    .update({
      limit_credits: input.limitCredits ?? null,
      limit_usd: input.limitUsd ?? null,
      on_exceed: input.onExceed,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);

  if (error) {
    console.error('[updateBudgetRule]', error);
    return { success: false, error: 'Error al actualizar la regla.' };
  }

  revalidatePath('/settings/providers', 'layout');

  return { success: true };
}

// ─── toggleBudgetRuleStatus ───────────────────────────────────────────────────

export async function toggleBudgetRuleStatus(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return { success: false, error: 'No autorizado.' };

  if (!id) return { success: false, error: 'ID requerido.' };

  const admin = getAdminClient();
  const { error } = await admin
    .from('budget_rules')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('[toggleBudgetRuleStatus]', error);
    return { success: false, error: 'Error al actualizar estado.' };
  }

  revalidatePath('/settings/providers', 'layout');

  return { success: true };
}

// ─── archiveBudgetRule ────────────────────────────────────────────────────────
// Soft-delete: sets is_active = false. Preserves all logs and historical data.

export async function archiveBudgetRule(id: string): Promise<ActionResult> {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) return { success: false, error: 'No autorizado.' };

  if (!id) return { success: false, error: 'ID requerido.' };

  const admin = getAdminClient();
  const { error } = await admin
    .from('budget_rules')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('[archiveBudgetRule]', error);
    return { success: false, error: 'Error al archivar la regla.' };
  }

  revalidatePath('/settings/providers', 'layout');

  return { success: true };
}
