import 'server-only';

// ============================================================
// Cotizador — quién aprueba los descuentos y los avisos (calca las
// solicitudes de créditos, src/modules/budgets/approval-requests.server.ts).
// Una cotización 2027 con alguna línea bajo el mínimo se guarda pendiente y le
// llega a los aprobadores de su tipo de cuenta (y a quienes van en copia) por la
// campanita y por Slack, con botones para decidir ahí mismo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { notifySlackUsers } from '@/modules/notifications/slack-notify.server';
import { quoteDecisionButtons } from '@/modules/notifications/quote-approval-slack';
import { ACCOUNT_TYPE_LABELS, type QuoteAccountType } from './approval-draft';

export const QUOTES_PATH = '/quotes';
export const QUOTE_APPROVALS_URL = `${QUOTES_PATH}?tab=approvals`;
export const MY_QUOTES_URL = `${QUOTES_PATH}?tab=mine`;

export interface PersonRef {
  id: string;
  name: string;
}

export interface QuoteApprovers {
  approvers: PersonRef[];
  cc: PersonRef[];
  /** Nadie configurado (o nadie activo): aprueban los administradores. */
  fallbackToAdmins: boolean;
}

const nameOf = (user: { full_name?: string | null; email?: string | null }) => user.full_name || user.email || 'Alguien';

async function activeAdmins(admin: SupabaseClient): Promise<PersonRef[]> {
  const { data: adminRole } = await admin.from('roles').select('id').eq('key', 'admin').maybeSingle();
  if (!adminRole) return [];
  const { data } = await admin
    .from('internal_users')
    .select('id, full_name, email')
    .eq('role_id', adminRole.id)
    .eq('access_status', 'active');
  return (data ?? []).map((user) => ({ id: user.id as string, name: nameOf(user) }));
}

/** Aprobadores y copias de un tipo de cuenta, sólo personas activas. */
export async function resolveQuoteApprovers(admin: SupabaseClient, accountType: QuoteAccountType): Promise<QuoteApprovers> {
  const { data: rows } = await admin.from('sales_quote_approvers').select('user_id, role').eq('account_type', accountType);
  const ids = [...new Set((rows ?? []).map((row) => row.user_id as string))];
  const { data: users } = ids.length
    ? await admin.from('internal_users').select('id, full_name, email, access_status').in('id', ids)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string; access_status: string }> };
  const active = new Map(
    (users ?? []).filter((user) => user.access_status === 'active').map((user) => [user.id as string, nameOf(user)]),
  );
  const pick = (role: 'approver' | 'cc') =>
    (rows ?? [])
      .filter((row) => row.role === role && active.has(row.user_id as string))
      .map((row) => ({ id: row.user_id as string, name: active.get(row.user_id as string) as string }));
  const approvers = pick('approver');
  const cc = pick('cc');
  if (approvers.length > 0) return { approvers, cc, fallbackToAdmins: false };
  return { approvers: await activeAdmins(admin), cc, fallbackToAdmins: true };
}

/** ¿Puede esta persona decidir cotizaciones de este tipo de cuenta? */
export async function canDecideQuotes(
  admin: SupabaseClient,
  userId: string,
  isAdmin: boolean,
  accountType: QuoteAccountType,
): Promise<boolean> {
  if (isAdmin) return true;
  const { approvers } = await resolveQuoteApprovers(admin, accountType);
  return approvers.some((approver) => approver.id === userId);
}

interface NotificationRow {
  recipient: string;
  type: 'sales_quote_approval_requested' | 'sales_quote_approval_cc' | 'sales_quote_approval_sent' | 'sales_quote_decided';
  title: string;
  message: string;
  quoteId: string;
  url: string;
  withButtons?: boolean;
}

async function notify(admin: SupabaseClient, rows: NotificationRow[]): Promise<void> {
  // Cada aviso por separado (en paralelo): el índice que evita duplicados es
  // parcial (031) y PostgREST no lo acepta como `onConflict`; un 23505 sólo
  // significa «ya se avisó».
  await Promise.all(rows.map((row) => notifyOne(admin, row)));
}

async function notifyOne(admin: SupabaseClient, row: NotificationRow): Promise<void> {
  const { error } = await admin.from('user_notifications').insert({
    recipient_internal_user_id: row.recipient,
    notification_type: row.type,
    title: row.title,
    message: row.message,
    action_label: 'Ver cotización',
    action_url: row.url,
    entity_type: 'sales_quote',
    entity_id: row.quoteId,
  });
  if (error && error.code !== '23505') {
    console.error('[quotes] notification failed:', error.message.slice(0, 200));
  }
  if (!error) {
    await notifySlackUsers(
      [row.recipient],
      { title: row.title, message: row.message, actionLabel: 'Ver cotización', actionUrl: row.url },
      {
        key: row.type === 'sales_quote_approval_requested' || row.type === 'sales_quote_approval_cc' ? 'quote_requests' : 'quote_decisions',
        extraButtons: row.withButtons ? quoteDecisionButtons(row.quoteId) : undefined,
      },
    );
  }
}

const usd = (value: number) => `USD ${Math.round(value).toLocaleString('es-CO')}`;

/** Avisa a aprobadores, copias y a quien la pidió. Nunca lanza. */
export async function notifyQuoteApprovalRequested(
  admin: SupabaseClient,
  input: {
    quoteId: string;
    requesterId: string;
    requesterName: string;
    accountType: QuoteAccountType;
    clientName: string | null;
    countryName: string;
    contractTotal: number;
    belowMinimumCount: number;
  },
): Promise<string[]> {
  try {
    const { approvers, cc } = await resolveQuoteApprovers(admin, input.accountType);
    const client = input.clientName || 'un cliente sin nombre';
    const lines = input.belowMinimumCount === 1 ? 'una línea queda' : `${input.belowMinimumCount} líneas quedan`;
    const summary = `${client} · ${input.countryName} · contrato de ${usd(input.contractTotal)}. En esta cotización ${lines} bajo el mínimo.`;
    // Nadie aprueba lo suyo: quien pidió no cuenta como aprobador.
    const deciders = approvers.filter((person) => person.id !== input.requesterId);
    const approverIds = new Set(deciders.map((person) => person.id));
    await notify(admin, [
      ...deciders.map((person) => ({
          recipient: person.id,
          type: 'sales_quote_approval_requested' as const,
          title: `${input.requesterName} pide aprobar un descuento`,
          message: `${summary} Tú decides (${ACCOUNT_TYPE_LABELS[input.accountType]}).`,
          quoteId: input.quoteId,
          url: QUOTE_APPROVALS_URL,
          withButtons: true,
        })),
      ...cc
        .filter((person) => person.id !== input.requesterId && !approverIds.has(person.id))
        .map((person) => ({
          recipient: person.id,
          type: 'sales_quote_approval_cc' as const,
          title: `${input.requesterName} pidió aprobar un descuento`,
          message: `${summary} Vas en copia.`,
          quoteId: input.quoteId,
          url: QUOTE_APPROVALS_URL,
        })),
      {
        recipient: input.requesterId,
        type: 'sales_quote_approval_sent',
        title: 'Pediste aprobar un descuento',
        message:
          deciders.length > 0
            ? `Le avisamos a ${deciders.map((person) => person.name).join(', ')}. Te contamos cuando decidan.`
            : 'No hay otra persona que pueda aprobarla: pídele a un administrador que elija aprobadores en Configuración → Cotizador.',
        quoteId: input.quoteId,
        url: MY_QUOTES_URL,
      },
    ]);
    return deciders.map((person) => person.name);
  } catch (error) {
    console.error('[quotes] request notification failed:', error instanceof Error ? error.message.slice(0, 200) : String(error));
    return [];
  }
}

/** Le cuenta a quien pidió lo que decidieron. */
export async function notifyQuoteDecision(
  admin: SupabaseClient,
  input: { quoteId: string; requesterId: string; approved: boolean; deciderName: string; clientName: string | null; note: string | null },
): Promise<void> {
  const client = input.clientName || 'tu cliente';
  await notify(admin, [
    {
      recipient: input.requesterId,
      type: 'sales_quote_decided',
      title: input.approved ? `Aprobaron tu descuento para ${client}` : `No aprobaron tu descuento para ${client}`,
      message: input.approved
        ? `${input.deciderName} la aprobó. Ya puedes enviarla.${input.note ? ` Nota: ${input.note}` : ''}`
        : `${input.deciderName} la rechazó.${input.note ? ` Nota: ${input.note}` : ' Ajusta el descuento y vuelve a pedirla.'}`,
      quoteId: input.quoteId,
      url: MY_QUOTES_URL,
    },
  ]);
}
