import { NextResponse } from 'next/server';
import { executeProspectWizardGenerationAction } from '@/modules/prospect-batches/chat-wizard-execution';

/**
 * Lanza UNA corrida del Agente IA (AGENT1-PARALLEL-RUNS-TRAY-1).
 *
 * Es una ruta y no la server action directa a propósito: el cliente despacha las
 * server actions DE UNA EN UNA, así que mientras una corrida (hasta 300 s) estaba
 * en vuelo, todo lo demás del navegador —validar otra búsqueda, la continuación de
 * Apollo— esperaba en cola detrás (Prod 06-10: «Validando la configuración…»
 * congelado mientras se retomaba un lote de Argentina). Una ruta se pide en
 * paralelo.
 *
 * No cambia NADA de la corrida: delega en la misma función, que valida el cuerpo
 * con su schema estricto, exige sesión y aplica presupuesto, idempotencia por
 * `clientRequestId` y la reserva única por usuario igual que siempre.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const result = await executeProspectWizardGenerationAction(body);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
