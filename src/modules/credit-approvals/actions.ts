'use server';

// ============================================================
// credit-approvals — bandeja de solicitudes de créditos (dueña 10-11)
// ============================================================
// Las usan los APROBADORES de una regla, que no tienen por qué ser
// administradores: cada acción comprueba la sesión y, para decidir, que la
// persona esté entre los aprobadores de la regla (o sea administradora).

import { revalidatePath } from 'next/cache';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { getAdminClient } from '@/modules/budgets/queries';
import {
  CREDIT_APPROVALS_PATH,
  notifyApprovalDecision,
  providerLabel,
} from '@/modules/budgets/approval-requests.server';
import type { BudgetRule } from '@/modules/budgets/types';

export interface ActionResult {
  success: boolean;
  error?: string;
}

const MAX_CREDITS_PER_ACTION = 1_000_000;

function parseCredits(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= MAX_CREDITS_PER_ACTION ? rounded : null;
}

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

function nameOf(user: { full_name?: string | null; email?: string | null } | null | undefined): string {
  return user?.full_name ?? user?.email ?? 'Alguien';
}

// ─── Bandeja de aprobaciones ─────────────────────────────────────────────────

export interface CreditApprovalRow {
  id: string;
  providerLabel: string;
  requesterName: string;
  requestedCredits: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approvedCredits: number | null;
  decidedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
  periodStart: string;
}

export interface CreditApprovalsInbox {
  /** Pendientes que esta persona puede decidir. */
  toDecide: CreditApprovalRow[];
  /** Lo que ella misma pidió (las últimas). */
  mine: CreditApprovalRow[];
  /** Lo que ya decidió (las últimas). */
  decidedByMe: CreditApprovalRow[];
}

const REQUEST_COLUMNS =
  'id, rule_id, requester_user_id, period_start, requested_credits, status, approved_credits, decided_by, decision_note, created_at';

type RequestRow = {
  id: string;
  rule_id: string;
  requester_user_id: string;
  period_start: string;
  requested_credits: number | string;
  status: CreditApprovalRow['status'];
  approved_credits: number | string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
};

export async function getCreditApprovalsInbox(): Promise<CreditApprovalsInbox | null> {
  const me = await getCurrentUser();
  if (!me) return null;
  const isAdmin = await isCurrentUserAdmin();
  const admin = getAdminClient();

  const [pendingResult, mineResult, decidedResult] = await Promise.all([
    admin.from('budget_approval_requests').select(REQUEST_COLUMNS).eq('status', 'pending').order('created_at'),
    admin
      .from('budget_approval_requests')
      .select(REQUEST_COLUMNS)
      .eq('requester_user_id', me.id)
      .order('created_at', { ascending: false })
      .limit(20),
    admin
      .from('budget_approval_requests')
      .select(REQUEST_COLUMNS)
      .eq('decided_by', me.id)
      .order('decided_at', { ascending: false })
      .limit(20),
  ]);

  const pending = (pendingResult.data ?? []) as RequestRow[];
  const mine = (mineResult.data ?? []) as RequestRow[];
  const decided = (decidedResult.data ?? []) as RequestRow[];

  const ruleIds = [...new Set([...pending, ...mine, ...decided].map((row) => row.rule_id))];
  const userIds = [
    ...new Set(
      [...pending, ...mine, ...decided].flatMap((row) => [row.requester_user_id, row.decided_by]).filter(Boolean),
    ),
  ] as string[];

  const [rulesResult, usersResult] = await Promise.all([
    ruleIds.length
      ? admin.from('budget_rules').select('id, provider_key, approver_user_ids').in('id', ruleIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? admin.from('internal_users').select('id, full_name, email').in('id', userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const rules = new Map(
    ((rulesResult.data ?? []) as Array<Pick<BudgetRule, 'id' | 'provider_key' | 'approver_user_ids'>>).map((rule) => [rule.id, rule]),
  );
  const users = new Map(
    ((usersResult.data ?? []) as Array<{ id: string; full_name: string | null; email: string }>).map((user) => [user.id, user]),
  );

  const toRow = (row: RequestRow): CreditApprovalRow => ({
    id: row.id,
    providerLabel: providerLabel(rules.get(row.rule_id)?.provider_key ?? ''),
    requesterName: nameOf(users.get(row.requester_user_id)),
    requestedCredits: Number(row.requested_credits),
    status: row.status,
    approvedCredits: row.approved_credits !== null ? Number(row.approved_credits) : null,
    decidedByName: row.decided_by ? nameOf(users.get(row.decided_by)) : null,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    periodStart: row.period_start,
  });

  const canDecide = (row: RequestRow) =>
    row.requester_user_id !== me.id &&
    (isAdmin || (rules.get(row.rule_id)?.approver_user_ids ?? []).includes(me.id));

  return {
    toDecide: pending.filter(canDecide).map(toRow),
    mine: mine.map(toRow),
    decidedByMe: decided.map(toRow),
  };
}

// ─── Decidir una solicitud ───────────────────────────────────────────────────

export async function decideCreditApproval(input: {
  requestId: string;
  decision: 'approve' | 'reject';
  credits?: number;
  note?: string | null;
}): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { success: false, error: 'Tu sesión expiró. Vuelve a entrar.' };
  const isAdmin = await isCurrentUserAdmin();
  const admin = getAdminClient();

  const { data: request } = await admin
    .from('budget_approval_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', input.requestId)
    .maybeSingle();
  if (!request) return { success: false, error: 'No encontramos la solicitud.' };
  const row = request as RequestRow;

  const { data: rule } = await admin
    .from('budget_rules')
    .select('id, provider_key, approver_user_ids')
    .eq('id', row.rule_id)
    .maybeSingle();
  if (!rule) return { success: false, error: 'La regla de esta solicitud ya no existe.' };

  const approverIds = ((rule.approver_user_ids as string[] | null) ?? []);
  if (row.requester_user_id === me.id) return { success: false, error: 'No puedes aprobar tu propia solicitud.' };
  if (!isAdmin && !approverIds.includes(me.id)) {
    return { success: false, error: 'No eres aprobador de esta regla.' };
  }

  const approvedCredits = input.decision === 'approve' ? parseCredits(input.credits ?? Number.NaN) : null;
  if (input.decision === 'approve' && approvedCredits === null) {
    return { success: false, error: 'Escribe cuántos créditos le das (un número entero mayor a 0).' };
  }
  const note = cleanNote(input.note);

  // Primero se cierra la solicitud: si otra persona la decidió un instante antes,
  // no hay cambio y no se dan créditos dos veces.
  const { data: closed, error: closeError } = await admin
    .from('budget_approval_requests')
    .update({
      status: input.decision === 'approve' ? 'approved' : 'rejected',
      approved_credits: approvedCredits,
      decided_by: me.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id');
  if (closeError) return { success: false, error: 'No pudimos guardar la decisión. Vuelve a probar.' };
  if (!closed || closed.length === 0) return { success: false, error: 'Otra persona ya decidió esta solicitud.' };

  if (approvedCredits !== null) {
    const { error: grantError } = await admin.from('budget_rule_adjustments').insert({
      rule_id: row.rule_id,
      period_start: row.period_start,
      kind: 'grant',
      credits: approvedCredits,
      beneficiary_user_id: row.requester_user_id,
      approval_request_id: row.id,
      note,
      created_by: me.id,
    });
    if (grantError && grantError.code !== '23505') {
      // Sin créditos no hay aprobación: la solicitud vuelve a quedar pendiente.
      await admin
        .from('budget_approval_requests')
        .update({ status: 'pending', approved_credits: null, decided_by: null, decided_at: null, decision_note: null })
        .eq('id', row.id);
      return { success: false, error: 'No pudimos dar los créditos. La solicitud sigue pendiente.' };
    }
  }

  await notifyApprovalDecision(admin, {
    requestId: row.id,
    requesterUserId: row.requester_user_id,
    providerKey: rule.provider_key as string,
    approvedCredits,
    deciderName: nameOf(me as { full_name?: string | null; email?: string | null }),
  });

  revalidatePath(CREDIT_APPROVALS_PATH);
  revalidatePath('/settings/providers', 'layout');
  return { success: true };
}
