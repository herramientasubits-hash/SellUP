// ============================================================
// Asistente de Slack — memoria de la conversación (puro).
// Convierte los mensajes anteriores de Slack en turnos para Claude, para que
// «¿cuáles son?» se entienda con lo que se venía hablando.
// ============================================================

import { cleanSlackText } from './events';

export interface HistoryMessage {
  ts: string;
  text: string;
  fromBot: boolean;
  hasActions: boolean;
  /** Quién lo escribió (id de Slack). */
  userId?: string | null;
  /** App que lo publicó (mensajes de bots). */
  appId?: string | null;
}

export interface ConversationTurnsOptions {
  /**
   * Quien pregunta. En un hilo de canal hablan varias personas: sólo sus
   * mensajes (y las respuestas del asistente) son contexto; lo que escribió
   * otra persona nunca se vuelve un turno «user».
   */
  askerSlackId?: string | null;
  /** La app del asistente: lo que publicó otro bot tampoco es contexto. */
  ownAppId?: string | null;
}

/** ¿Este mensaje anterior cuenta como parte de la conversación de quien pregunta? */
export function isOwnConversationMessage(message: HistoryMessage, options: ConversationTurnsOptions = {}): boolean {
  if (message.fromBot) {
    return !(options.ownAppId && message.appId && message.appId !== options.ownAppId);
  }
  if (!options.askerSlackId) return true;
  return message.userId === options.askerSlackId;
}

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

/** Cuántos mensajes anteriores se tienen en cuenta. */
export const HISTORY_MAX_MESSAGES = 12;
/** Más viejo que esto ya es otra conversación. */
export const HISTORY_MAX_AGE_SECONDS = 6 * 3600;
const TURN_MAX_CHARS = 1500;

/**
 * Turnos para Claude: los anteriores (recientes, sin avisos con botones) y al
 * final la pregunta actual. Siempre empieza y termina en `user` y alterna
 * (los mensajes seguidos del mismo lado se juntan).
 */
export function buildConversationTurns(
  history: readonly HistoryMessage[],
  question: string,
  currentTs: string,
  options: ConversationTurnsOptions = {},
): ConversationTurn[] {
  const now = Number(currentTs);
  const recent = history
    .filter((m) => !m.hasActions)
    .filter((m) => isOwnConversationMessage(m, options))
    .filter((m) => Number.isFinite(Number(m.ts)) && now - Number(m.ts) <= HISTORY_MAX_AGE_SECONDS && Number(m.ts) < now)
    .slice(-HISTORY_MAX_MESSAGES);

  const turns: ConversationTurn[] = [];
  for (const message of [...recent.map((m) => ({ role: m.fromBot ? 'assistant' : 'user', text: m.text }) as const), { role: 'user' as const, text: question }]) {
    const content = (message.role === 'user' ? cleanSlackText(message.text) : message.text.trim()).slice(0, TURN_MAX_CHARS);
    if (!content) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === message.role) {
      turns[turns.length - 1] = { role: last.role, content: `${last.content}\n\n${content}` };
    } else {
      turns.push({ role: message.role, content });
    }
  }
  while (turns.length > 0 && turns[0].role === 'assistant') turns.shift();
  return turns.length > 0 ? turns : [{ role: 'user', content: question }];
}
