// ── Shared conversational agent-chat primitives ───────────────────────────────
// Lo que comparten los asistentes conversacionales (Agente 2A y los que vengan):
// el contrato neutro de mensajes, el revelado progresivo y el hilo, que pinta
// con las piezas de chat de Thema (`@/components/chat`).
//
// La marca, la caja de escribir y las tarjetas de opción ya no viven aquí: son
// `ChatMark`, `ChatComposer` y `ChatQuestionCard` del sistema.

export { AgentChatTimeline } from './agent-chat-timeline';
export { useProgressiveReveal } from './use-progressive-reveal';
export type { ProgressiveReveal } from './use-progressive-reveal';
export type { AgentChatMessage, AgentChatRole, AgentChatTone } from './agent-chat-types';
