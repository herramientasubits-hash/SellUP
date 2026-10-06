/**
 * Señales del navegador entre la bandeja flotante y el chat del Agente IA
 * (AGENT1-RUNS-INSIDE-CHAT-1).
 *
 * La pestaña «Búsquedas» vive DENTRO del cajón del chat. La bandeja (shell) no
 * conoce al cajón, así que pide abrirlo con un evento; el cajón que esté montado
 * lo marca como atendido. Si ninguno lo atiende (la pantalla actual no tiene el
 * asistente), la bandeja lleva a Empresas con `?agentView=runs` y el cajón se
 * abre ahí en esa pestaña.
 */

export const AGENT_CHAT_OPEN_RUNS_EVENT = 'sellup:agent-chat:open-runs';
export const AGENT_CHAT_VIEW_PARAM = 'agentView';
export const AGENT_CHAT_RUNS_VIEW = 'runs';
/** Pantalla que monta el asistente «Generar con IA». */
export const AGENT_CHAT_HOME_PATH = '/accounts';

export type AgentChatOpenRunsDetail = { handled: boolean };

/** Pide abrir el chat en «Búsquedas». Devuelve si algún cajón montado lo atendió. */
export function requestOpenAgentRunsInChat(): boolean {
  if (typeof window === 'undefined') return false;
  const detail: AgentChatOpenRunsDetail = { handled: false };
  window.dispatchEvent(new CustomEvent<AgentChatOpenRunsDetail>(AGENT_CHAT_OPEN_RUNS_EVENT, { detail }));
  return detail.handled;
}

/** Ruta de respaldo cuando la pantalla actual no tiene el asistente. */
export function agentRunsFallbackHref(): string {
  return `${AGENT_CHAT_HOME_PATH}?${AGENT_CHAT_VIEW_PARAM}=${AGENT_CHAT_RUNS_VIEW}`;
}
