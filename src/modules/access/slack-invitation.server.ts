// ============================================================
// Invitación por Slack al agregar un usuario (dueña 11-11)
// Al preautorizar un correo, SellUp le escribe a esa persona por mensaje
// directo en el Slack de UBITS. Nunca lanza: la preautorización ya quedó
// hecha y el resultado sólo se le cuenta a quien invita.
// ============================================================

import { sendSlackDirectMessageByEmail } from '@/server/services/slack-connection';
import { buildSlackInvitationMessage, type SlackInviteOutcome } from './slack-invitation-message';

export interface SlackInvitationTarget {
  email: string;
  fullName: string | null;
  roleKey: string | null;
  roleName: string | null;
  inviterName: string | null;
}

/** La página de entrada de SellUp en el entorno que envía. */
export function sellupLoginUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/login`;
}

export async function sendSlackInvitation(
  target: SlackInvitationTarget,
): Promise<SlackInviteOutcome> {
  try {
    const message = buildSlackInvitationMessage({
      inviteeName: target.fullName,
      inviterName: target.inviterName,
      roleName: target.roleName,
      loginUrl: sellupLoginUrl(),
    });
    return await sendSlackDirectMessageByEmail(target.email, message);
  } catch (error) {
    console.error('[sendSlackInvitation]', error instanceof Error ? error.message : 'error');
    return 'failed';
  }
}
