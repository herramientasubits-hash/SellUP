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
): ConversationTurn[] {
  const now = Number(currentTs);
  const recent = history
    .filter((m) => !m.hasActions)
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
