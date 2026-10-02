import { NextResponse } from 'next/server';
import { readRunProgress } from '@/modules/prospect-batches/chat-wizard-execution/run-progress.server';

/**
 * La etapa en vivo de MI corrida del Agente 1 (AGENT1-RUN-LIVE-PROGRESS-1,
 * migración 143). Solo lectura; la RLS solo deja ver la propia fila.
 *
 * Es una ruta y no una server action a propósito: el cliente despacha las server
 * actions DE UNA EN UNA, así que una consulta de progreso hecha con una server
 * action esperaba en cola detrás de la propia corrida (otra server action larga)
 * y el chat se quedaba en «Preparando la búsqueda» hasta el final. Una ruta se
 * pide en paralelo.
 */
export async function GET(request: Request) {
  const clientRequestId = new URL(request.url).searchParams.get('clientRequestId') ?? '';
  const progress = await readRunProgress(clientRequestId);
  return NextResponse.json({ progress }, { headers: { 'Cache-Control': 'no-store' } });
}
