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

// ============================================================
// Aviso por Slack al activar el acceso (dueña 11-11): quien estaba Inactivo
// se entera de que ya puede entrar, con el botón al login.
// ============================================================

export interface SlackAccessActivatedInput {
  /** Nombre de la persona activada. */
  inviteeName: string | null;
  /** Quién activó el acceso. */
  activatorName: string | null;
  /** Página de inicio de sesión de SellUp. */
  loginUrl: string;
}

/** El mensaje directo que recibe la persona cuando le activan el acceso. */
export function buildSlackAccessActivatedMessage(input: SlackAccessActivatedInput): SlackInvitationMessage {
  const greeting = firstName(input.inviteeName) ? `Hola, ${firstName(input.inviteeName)}.` : 'Hola.';
  const who = input.activatorName?.trim() || 'El equipo de UBITS';
  const intro = `${greeting} ${who} activó tu acceso a *SellUp*, la plataforma de prospección comercial de UBITS.`;
  const howTo = 'Ya puedes entrar con Google usando tu correo @ubits.co.';

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
            action_id: 'sellup_access_activated_open',
          },
        ],
      },
    ],
  };
}

export interface ActivationNoticeSummary {
  tone: 'success' | 'warning';
  title: string;
  description: string;
}

/**
 * Cómo se le cuenta a quien activó lo que pasó con los avisos de Slack.
 * `null` si no se activó a nadie.
 */
export function summarizeActivationNotices(outcomes: ReadonlyArray<SlackInviteOutcome>): ActivationNoticeSummary | null {
  const total = outcomes.length;
  if (total === 0) return null;
  const sent = outcomes.filter((o) => o === 'sent').length;
  const title = total === 1 ? 'Acceso activado' : `Activaste ${total} accesos`;

  if (sent === total) {
    return {
      tone: 'success',
      title,
      description: total === 1
        ? 'Le avisamos por Slack que ya puede entrar.'
        : 'Les avisamos por Slack que ya pueden entrar.',
    };
  }
  if (outcomes.every((o) => o === 'slack_not_connected')) {
    return { tone: 'warning', title, description: 'Slack no está conectado: avísales por otro lado que ya pueden entrar.' };
  }
  if (total === 1) {
    const copy: Record<Exclude<SlackInviteOutcome, 'sent'>, string> = {
      not_in_slack: 'No encontramos su correo en el Slack de UBITS: avísale por otro lado que ya puede entrar.',
      slack_not_connected: 'Slack no está conectado: avísale por otro lado que ya puede entrar.',
      failed: 'No pudimos avisarle por Slack: avísale por otro lado que ya puede entrar.',
    };
    return { tone: 'warning', title, description: copy[outcomes[0] as Exclude<SlackInviteOutcome, 'sent'>] };
  }
  return {
    tone: 'warning',
    title,
    description: `Avisamos por Slack a ${sent} de ${total}. A los demás avísales por otro lado que ya pueden entrar.`,
  };
}
