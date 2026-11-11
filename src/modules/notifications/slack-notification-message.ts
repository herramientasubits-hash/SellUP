// ============================================================
// Avisos de SellUp también por Slack (dueña 11-11) — el mensaje (puro).
// Lo que llega a la campanita llega igual por mensaje directo, con el botón a
// la pantalla. Se apaga entero con SELLUP_SLACK_NOTIFICATIONS=off.
// ============================================================

export const SLACK_NOTIFICATIONS_ENV = 'SELLUP_SLACK_NOTIFICATIONS';

export function slackNotificationsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[SLACK_NOTIFICATIONS_ENV]?.trim().toLowerCase() !== 'off';
}

export interface SlackNotificationInput {
  title: string;
  message: string;
  actionLabel?: string | null;
  /** Ruta de SellUp (`/accounts?…`) o URL completa. */
  actionUrl?: string | null;
  /** Línea pequeña al pie (p. ej. «Aviso automático de SellUp»). */
  footer?: string | null;
}

export interface SlackNotificationMessage {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export function absoluteSellUpUrl(appUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${appUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function buildSlackNotificationMessage(
  input: SlackNotificationInput,
  appUrl: string,
  extraButtons: ReadonlyArray<Record<string, unknown>> = [],
): SlackNotificationMessage {
  const blocks: Array<Record<string, unknown>> = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${input.title.trim()}*\n${input.message.trim()}` } },
  ];
  if (input.actionUrl || extraButtons.length > 0) {
    blocks.push({
      type: 'actions',
      elements: [
        ...extraButtons,
        ...(input.actionUrl
          ? [
        {
          type: 'button',
          text: { type: 'plain_text', text: input.actionLabel?.trim() || 'Abrir en SellUp' },
          url: absoluteSellUpUrl(appUrl, input.actionUrl),
          action_id: 'sellup_notification_open',
        },
            ]
          : []),
      ],
    });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: input.footer?.trim() || 'Aviso de SellUp' }] });
  return { text: `${input.title.trim()}: ${input.message.trim()}`, blocks };
}
