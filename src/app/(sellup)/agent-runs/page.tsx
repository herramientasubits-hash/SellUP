import { readAgentRunsHistory } from '@/modules/prospect-batches/agent-runs/agent-runs-history.server';
import { AgentRunsView } from './agent-runs-view';

/**
 * «Búsquedas» del Agente IA (AGENT1-PARALLEL-RUNS-PHASE2-1): las que corren ahora
 * en este navegador y el historial de los últimos 7 días, con acceso a cada lote.
 */
export const dynamic = 'force-dynamic';

export default async function AgentRunsPage() {
  const history = await readAgentRunsHistory();
  return <AgentRunsView history={history} />;
}
