/**
 * Agente 3 · Primer contacto — el estado de la empresa avanza con el agente (puro).
 *
 * Nadie cambia el estado a mano: al empezar a investigar queda «Investigación en
 * curso» y, con al menos una preparación lista, «Lista para contacto». Sólo avanza:
 * una empresa que ya está más adelante (o archivada) no retrocede.
 */

import type { PipelineStatus } from '@/modules/accounts/types';

export type Agent3StatusTarget = 'research_in_progress' | 'ready_for_outreach';

const RANK: Readonly<Record<Exclude<PipelineStatus, 'archived'>, number>> = {
  new: 0,
  ready_for_research: 1,
  research_in_progress: 2,
  ready_for_outreach: 3,
};

/** El estado al que pasa la empresa, o `null` si se queda como está. */
export function nextAgent3Status(current: PipelineStatus | null, target: Agent3StatusTarget): Agent3StatusTarget | null {
  if (current === 'archived') return null;
  const from = current ? RANK[current] : 0;
  return RANK[target] > from ? target : null;
}
