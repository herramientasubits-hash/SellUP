import { NextResponse } from 'next/server';
import {
  continueApolloRound,
  findPendingApolloContinuation,
} from '@/modules/prospect-batches/apollo-continuation-actions';

/**
 * La continuación de la corrida de Apollo, por ruta (AGENT1-PARALLEL-RUNS-TRAY-1).
 *
 * El panel del asistente la llamaba como server action en bucle (cada vuelta hasta
 * 300 s) y, como el cliente despacha las server actions de una en una, todo el
 * chat esperaba detrás: Prod 06-10, «Validando la configuración…» congelado
 * mientras se retomaba el lote 17da92cf de Argentina. Mismas funciones, mismas
 * comprobaciones (sesión, RLS sobre el lote, arrendamiento de la cola).
 */
export const maxDuration = 300;

export async function GET() {
  const pending = await findPendingApolloContinuation();
  return NextResponse.json({ pending }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  let batchId: unknown;
  try {
    batchId = ((await request.json()) as { batchId?: unknown }).batchId;
  } catch {
    batchId = null;
  }
  if (typeof batchId !== 'string' || batchId.length === 0) {
    return NextResponse.json({ error: 'invalid_batch_id' }, { status: 400 });
  }
  const outcome = await continueApolloRound(batchId);
  return NextResponse.json({ outcome }, { headers: { 'Cache-Control': 'no-store' } });
}
