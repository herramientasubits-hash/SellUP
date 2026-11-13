// ============================================================
// Asistente de Slack — a dónde va cada respuesta (puro). Decisión de la dueña
// (13-11): cuando nombran al bot en un canal (o en un grupo directo), lo que
// SellUp responde puede ser de alcance privado; nada de eso va al canal. La
// respuesta y cualquier propuesta con botones van por mensaje directo a quien
// preguntó; en el hilo del canal queda sólo una nota neutra.
// ============================================================

import type { SlackQuestionSource } from './events';

export interface SlackDestination {
  channel: string;
  threadTs: string | null;
}

export interface SlackDeliveryPlan {
  /** Dónde va la respuesta (y la propuesta con botones). `null` = no se pudo abrir el directo. */
  answer: SlackDestination | null;
  /** Nota neutra en el hilo del canal (sólo menciones). */
  threadNote: (SlackDestination & { text: string }) | null;
}

export function planSlackDelivery(
  question: { source: SlackQuestionSource; channel: string; threadTs: string | null },
  directChannel: string | null,
  copy: { answered: string; failed: string },
): SlackDeliveryPlan {
  if (question.source === 'direct_message') {
    return { answer: { channel: question.channel, threadTs: question.threadTs }, threadNote: null };
  }
  const thread = { channel: question.channel, threadTs: question.threadTs };
  if (!directChannel) return { answer: null, threadNote: { ...thread, text: copy.failed } };
  return { answer: { channel: directChannel, threadTs: null }, threadNote: { ...thread, text: copy.answered } };
}
