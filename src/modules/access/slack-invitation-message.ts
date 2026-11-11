// ============================================================
// Invitación por Slack al agregar un usuario (dueña 11-11)
// Texto puro: qué le llega a la persona y cómo se le cuenta a quien invita.
// El envío vive en `slack-invitation.server.ts`.
// ============================================================

/** Qué pasó con el mensaje de Slack de una invitación. */
export type SlackInviteOutcome = 'sent' | 'not_in_slack' | 'slack_not_connected' | 'failed';

export interface SlackInvitationMessageInput {
  /** Nombre de quien recibe la invitación (si se escribió al agregarla). */
  inviteeName: string | null;
  /** Quién la invita. */
  inviterName: string | null;
  /** Rol con el que entra («Vendedor», «Líder comercial»…). */
  roleName: string | null;
  /** Página de inicio de sesión de SellUp. */
  loginUrl: string;
}

export interface SlackInvitationMessage {
  /** Texto plano: lo que se ve en la notificación y si los bloques no cargan. */
  text: string;
  /** Bloques de Slack (Block Kit). */
  blocks: ReadonlyArray<Record<string, unknown>>;
}

function firstName(name: string | null): string | null {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed.split(/\s+/)[0] : null;
}

/** El mensaje directo que recibe la persona invitada. */
export function buildSlackInvitationMessage(input: SlackInvitationMessageInput): SlackInvitationMessage {
  const greeting = firstName(input.inviteeName) ? `Hola, ${firstName(input.inviteeName)}.` : 'Hola.';
  const who = input.inviterName?.trim() || 'El equipo de UBITS';
  const role = input.roleName?.trim() ? ` como *${input.roleName.trim()}*` : '';
  const intro = `${greeting} ${who} te invitó a *SellUp*${role}, la plataforma de prospección comercial de UBITS.`;
  const howTo = 'Entra con Google usando tu correo @ubits.co: tu acceso ya está listo.';

  return {
    text: `${intro} ${howTo} ${input.loginUrl}`.replace(/\*/g, ''),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: intro } },
      { type: 'section', text: { type: 'mrkdwn', text: howTo } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            style: 'primary',
            text: { type: 'plain_text', text: 'Entrar a SellUp' },
            url: input.loginUrl,
            action_id: 'sellup_invite_open',
          },
        ],
      },
    ],
  };
}

/** Cómo se le cuenta a quien invita lo que pasó con el mensaje. */
export const SLACK_INVITE_OUTCOME_COPY: Record<SlackInviteOutcome, string> = {
  sent: 'Le llegó la invitación por Slack.',
  not_in_slack: 'No encontramos ese correo en el Slack de UBITS: avísale por otro lado.',
  slack_not_connected: 'Slack no está conectado: avísale por otro lado.',
  failed: 'No pudimos enviarle la invitación por Slack: avísale por otro lado o reenvíala.',
};
