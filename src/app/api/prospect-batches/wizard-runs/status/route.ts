import { NextResponse } from 'next/server';
import { readAgentRunsStatus } from '@/modules/prospect-batches/agent-runs/agent-runs-status.server';

/**
 * Estado de MIS corridas del Agente IA por `clientRequestId`
 * (AGENT1-PARALLEL-RUNS-TRAY-1). Sólo lectura con la sesión de la persona: la RLS
 * sólo deja ver sus propios lotes y su propio progreso. Ruta, no server action,
 * para no hacer cola detrás de una corrida en vuelo.
 */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get('ids') ?? '').split(',');
  const runs = await readAgentRunsStatus(ids);
  return NextResponse.json({ runs }, { headers: { 'Cache-Control': 'no-store' } });
}
