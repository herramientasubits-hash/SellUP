/**
 * Abrir una búsqueda del Agente IA en su drawer desde el Centro de procesos.
 *
 * El drawer del asistente sólo existe en las pantallas del módulo Empresas. Si
 * está montado, se registra aquí y el Centro de procesos lo abre en la corrida.
 * Si no lo está, se navega a Prospectos con `?agentRun=<id>` y el drawer, al
 * montarse, abre esa corrida (y quita el parámetro de la URL).
 */

import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';

export type AgentRunOpener = (clientRequestId: string) => void;

/** Parámetro de la URL con el que el drawer abre una corrida al montarse. */
export const AGENT_RUN_URL_PARAM = 'agentRun';

const openers: AgentRunOpener[] = [];

/** El drawer montado se ofrece para abrir corridas. Devuelve cómo retirarse. */
export function registerAgentRunOpener(opener: AgentRunOpener): () => void {
  openers.push(opener);
  return () => {
    const index = openers.lastIndexOf(opener);
    if (index >= 0) openers.splice(index, 1);
  };
}

/** La ruta que abre la corrida cuando no hay drawer montado. */
export function agentRunHref(clientRequestId: string): string {
  return `${PROSPECTOS_TAB_ROUTE}&${AGENT_RUN_URL_PARAM}=${encodeURIComponent(clientRequestId)}`;
}

/**
 * Abre la corrida en el drawer montado más reciente o, si no hay, navega a la
 * pantalla que lo monta.
 */
export function openAgentRun(clientRequestId: string, navigate: (href: string) => void): void {
  const opener = openers[openers.length - 1];
  if (opener) opener(clientRequestId);
  else navigate(agentRunHref(clientRequestId));
}

/** Lee (y quita de la URL) la corrida que se pidió abrir al llegar a la pantalla. */
export function takeAgentRunFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const id = url.searchParams.get(AGENT_RUN_URL_PARAM);
  if (!id) return null;
  url.searchParams.delete(AGENT_RUN_URL_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return id;
}
