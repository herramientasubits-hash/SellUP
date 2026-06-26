// ── Shared conversational agent-chat primitives ───────────────────────────────
// Neutral building blocks for conversational agent wizards. Agente 1 keeps its
// own (prospect-coupled) chat components untouched; these are reused by Agente 2A
// and any future agent wizard.

export { AgentChatOrb } from './agent-chat-orb';
export { AgentChatTimeline } from './agent-chat-timeline';
export { AgentChatComposer } from './agent-chat-composer';
export type { AgentChatComposerMode } from './agent-chat-composer';
export { AgentChatOptionCard } from './agent-chat-option-card';
export { useProgressiveReveal } from './use-progressive-reveal';
export type { ProgressiveReveal } from './use-progressive-reveal';
export type { AgentChatMessage, AgentChatRole, AgentChatTone } from './agent-chat-types';
