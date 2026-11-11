// ============================================================
// Asistente de Slack — qué pide cada evento (puro).
// Sólo se atienden dos cosas: un mensaje directo al bot y una mención al bot en
// un canal. Todo lo demás (mensajes del propio bot, ediciones, borrados,
// uniones a canales…) se ignora.
// ============================================================

export type SlackEventAction =
  | { kind: 'url_verification'; challenge: string }
  | {
      kind: 'question';
      eventId: string | null;
      slackUserId: string;
      channel: string;
      /**
       * Hilo donde se responde. Mención en un canal: siempre en hilo (el del
       * mensaje, o uno nuevo bajo él). Mensaje directo: en el hilo sólo si la
       * persona escribió dentro de uno; si no, en la conversación (`null`).
       */
      threadTs: string | null;
      text: string;
      source: 'direct_message' | 'mention';
    }
  | { kind: 'ignore'; reason: string };

/** Largo máximo de una pregunta (lo demás se corta). */
export const MAX_QUESTION_CHARS = 2000;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Quita las menciones `<@U123>` y deja el texto limpio. */
export function cleanSlackText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(?:\|[^>]*)?>/g, ' ')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUESTION_CHARS);
}

export function parseSlackEvent(payload: unknown): SlackEventAction {
  if (!payload || typeof payload !== 'object') return { kind: 'ignore', reason: 'not_an_object' };
  const body = payload as Record<string, unknown>;

  if (body.type === 'url_verification') {
    const challenge = str(body.challenge);
    return challenge ? { kind: 'url_verification', challenge } : { kind: 'ignore', reason: 'no_challenge' };
  }
  if (body.type !== 'event_callback') return { kind: 'ignore', reason: 'not_an_event' };

  const event = (body.event ?? {}) as Record<string, unknown>;
  if (event.bot_id || event.subtype) return { kind: 'ignore', reason: 'bot_or_subtype' };

  const slackUserId = str(event.user);
  const channel = str(event.channel);
  const ts = str(event.ts);
  if (!slackUserId || !channel || !ts) return { kind: 'ignore', reason: 'incomplete_event' };

  let source: 'direct_message' | 'mention';
  if (event.type === 'app_mention') source = 'mention';
  else if (event.type === 'message' && event.channel_type === 'im') source = 'direct_message';
  else return { kind: 'ignore', reason: 'unsupported_event' };

  const text = cleanSlackText(str(event.text) ?? '');
  if (!text) return { kind: 'ignore', reason: 'empty_text' };

  return {
    kind: 'question',
    eventId: str(body.event_id),
    slackUserId,
    channel,
    threadTs: str(event.thread_ts) ?? (source === 'mention' ? ts : null),
    text,
    source,
  };
}
