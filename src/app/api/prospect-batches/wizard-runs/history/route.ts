import { NextResponse } from 'next/server';
import { readAgentRunsHistory } from '@/modules/prospect-batches/agent-runs/agent-runs-history.server';

/**
 * Historial de 7 días de MIS búsquedas del Agente IA, para la pestaña
 * «Búsquedas» dentro del chat (AGENT1-RUNS-INSIDE-CHAT-1). Sólo lectura con la
 * sesión de la persona (RLS). Ruta, no server action, para no hacer cola detrás
 * de una corrida en vuelo.
 */
export async function GET() {
  const history = await readAgentRunsHistory();
  return NextResponse.json(history, { headers: { 'Cache-Control': 'no-store' } });
}
