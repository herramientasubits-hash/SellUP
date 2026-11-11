// ============================================================
// budgets — solicitudes de aprobación de créditos (dueña 10-11)
// ============================================================
// Cuando una regla «Requiere aprobación» frena a alguien, se abre una
// solicitud y se avisa a sus aprobadores. Ellos entran a /credit-approvals,
// eligen cuántos créditos le dan y eso suma sólo a esa persona, sólo este mes.

import { notifySlackUsers } from '@/modules/notifications/slack-notify.server';
import { creditDecisionButtons } from '@/modules/notifications/credit-approval-slack';
import type { BudgetRule } from './types';
import { getAdminClient } from './queries';

type AdminClient = ReturnType<typeof getAdminClient>;

export const CREDIT_APPROVALS_PATH = '/credit-approvals';

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  tavily: 'Tavily',
};

export function providerLabel(providerKey: string): string {
  return PROVIDER_LABELS[providerKey] ?? providerKey;
}

export interface ApprovalRequestOutcome {
  status: 'requested' | 'already_pending' | 'failed';
  approverNames: string[];
}

/**
 * Quienes aprueban una regla: los elegidos en la regla o, si no eligieron a
 * nadie, los administradores activos (una solicitud nunca se queda sin dueño).
 */
export async function resolveRuleApprovers(
  admin: AdminClient,
  rule: Pick<BudgetRule, 'approver_user_ids'>,
): Promise<Array<{ id: string; name: string }>> {
  const chosen = (rule.approver_user_ids ?? []).filter(Boolean);
  if (chosen.length > 0) {
    const { data } = await admin
      .from('internal_users')
      .select('id, full_name, email, access_status')
      .in('id', chosen);
    const active = (data ?? []).filter((user) => user.access_status === 'active');
    if (active.length > 0) {
      return active.map((user) => ({ id: user.id as string, name: (user.full_name as string | null) ?? (user.email as string) }));
    }
  }

  const { data: adminRole } = await admin.from('roles').select('id').eq('key', 'admin').maybeSingle();
  if (!adminRole) return [];
  const { data: admins } = await admin
    .from('internal_users')
    .select('id, full_name, email')
    .eq('role_id', adminRole.id)
    .eq('access_status', 'active');
  return (admins ?? []).map((user) => ({ id: user.id as string, name: (user.full_name as string | null) ?? (user.email as string) }));
}

async function notify(
  admin: AdminClient,
  rows: Array<{ recipient: string; type: string; title: string; message: string; entityId: string; credits?: number }>,
): Promise<void> {
  // Una por una: el índice que evita duplicados es parcial (031) y PostgREST no
  // lo acepta como `onConflict`; un 23505 sólo significa «ya se avisó».
  for (const row of rows) {
    const { error } = await admin.from('user_notifications').insert({
      recipient_internal_user_id: row.recipient,
      notification_type: row.type,
      title: row.title,
      message: row.message,
      action_label: 'Ver solicitud',
      action_url: CREDIT_APPROVALS_PATH,
      entity_type: 'budget_approval_request',
      entity_id: row.entityId,
    });
    if (error && error.code !== '23505') {
      console.error('[budget-approvals] notification failed:', error.message.slice(0, 200));
    }
    // También por Slack (dueña 11-11), salvo si ya se había avisado (23505). A quien
    // aprueba le llegan los botones para decidir ahí mismo.
    if (!error) {
      await notifySlackUsers(
        [row.recipient],
        { title: row.title, message: row.message, actionLabel: 'Ver solicitud', actionUrl: CREDIT_APPROVALS_PATH },
        {
          key: row.type === 'budget_approval_requested' ? 'credit_requests' : 'credit_decisions',
          extraButtons:
            row.type === 'budget_approval_requested' && row.credits ? creditDecisionButtons(row.entityId, row.credits) : undefined,
        },
      );
    }
  }
}

/**
 * Abre (o reutiliza) la solicitud de `requesterUserId` para esta regla y este
 * período, y avisa a los aprobadores y a quien la pidió. Nunca lanza: un fallo
 * aquí no puede convertir un bloqueo en un error de la búsqueda.
 */
export async function requestBudgetApproval(input: {
  rule: Pick<BudgetRule, 'id' | 'provider_key' | 'approver_user_ids'>;
  requesterUserId: string;
  requestedCredits: number;
  periodStart: string;
}): Promise<ApprovalRequestOutcome> {
  try {
    const admin = getAdminClient();
    const approvers = await resolveRuleApprovers(admin, input.rule);
    const approverNames = approvers.map((approver) => approver.name);
    const requested = Math.max(1, Math.ceil(input.requestedCredits));

    const { data: pending } = await admin
      .from('budget_approval_requests')
      .select('id')
      .eq('rule_id', input.rule.id)
      .eq('requester_user_id', input.requesterUserId)
      .eq('period_start', input.periodStart)
      .eq('status', 'pending')
      .maybeSingle();
    if (pending) return { status: 'already_pending', approverNames };

    const { data: created, error } = await admin
      .from('budget_approval_requests')
      .insert({
        rule_id: input.rule.id,
        requester_user_id: input.requesterUserId,
        period_start: input.periodStart,
        requested_credits: requested,
      })
      .select('id')
      .single();
    if (error || !created) {
      // 23505: otra pestaña la abrió al mismo tiempo — ya está pendiente.
      if (error?.code === '23505') return { status: 'already_pending', approverNames };
      console.error('[budget-approvals] request insert failed:', error?.message.slice(0, 200));
      return { status: 'failed', approverNames };
    }

    const { data: requester } = await admin
      .from('internal_users')
      .select('full_name, email')
      .eq('id', input.requesterUserId)
      .maybeSingle();
    const requesterName = (requester?.full_name as string | null) ?? (requester?.email as string | null) ?? 'Alguien';
    const provider = providerLabel(input.rule.provider_key);

    await notify(admin, [
      ...approvers
        .filter((approver) => approver.id !== input.requesterUserId)
        .map((approver) => ({
          recipient: approver.id,
          type: 'budget_approval_requested',
          title: `${requesterName} pide créditos de ${provider}`,
          message: `Llegó al límite de su regla y pide unos ${requested.toLocaleString('es-CO')} créditos más este mes. Tú decides cuántos le das.`,
          entityId: created.id as string,
          credits: requested,
        })),
      {
        recipient: input.requesterUserId,
        type: 'budget_approval_sent',
        title: `Pediste más créditos de ${provider}`,
        message: approverNames.length > 0
          ? `Le avisamos a ${approverNames.join(', ')}. Te contamos cuando decidan.`
          : 'No hay aprobadores activos: avísale a un administrador.',
        entityId: created.id as string,
      },
    ]);

    return { status: 'requested', approverNames };
  } catch (err) {
    console.error('[budget-approvals] request failed:', err instanceof Error ? err.message.slice(0, 200) : String(err));
    return { status: 'failed', approverNames: [] };
  }
}

/** Le cuenta a quien pidió lo que decidieron. */
export async function notifyApprovalDecision(
  admin: AdminClient,
  input: { requestId: string; requesterUserId: string; providerKey: string; approvedCredits: number | null; deciderName: string },
): Promise<void> {
  const provider = providerLabel(input.providerKey);
  await notify(admin, [
    {
      recipient: input.requesterUserId,
      type: 'budget_approval_decided',
      title: input.approvedCredits !== null
        ? `Te aprobaron ${input.approvedCredits.toLocaleString('es-CO')} créditos de ${provider}`
        : `No aprobaron tu solicitud de créditos de ${provider}`,
      message: input.approvedCredits !== null
        ? `${input.deciderName} te los dio para este mes. Ya puedes seguir buscando.`
        : `${input.deciderName} la rechazó. Si la necesitas, habla con tu líder.`,
      entityId: input.requestId,
    },
  ]);
}
