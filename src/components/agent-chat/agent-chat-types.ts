// ── Shared agent-chat message contract ────────────────────────────────────────
// Neutral, domain-agnostic primitives reused by conversational agent wizards
// (e.g. Agente 2A — Contact Enrichment). No coupling to any specific agent.

export type AgentChatRole = 'assistant' | 'user' | 'system';

export type AgentChatTone = 'default' | 'warning' | 'error';

export interface AgentChatMessage {
  id: string;
  role: AgentChatRole;
  content: string;
  /** Visual tone — only meaningful for `system` messages. Defaults to 'default'. */
  tone?: AgentChatTone;
  /**
   * Sólo en respuestas de la persona: «Editar» la devuelve a la pregunta donde
   * eligió (sin borrar lo que eligió después). Sin esto no hay botón.
   */
  onEditRequest?: () => void;
}
