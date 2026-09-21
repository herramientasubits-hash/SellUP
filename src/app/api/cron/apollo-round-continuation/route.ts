/**
 * GET|POST /api/cron/apollo-round-continuation
 *
 * AGENT1-APOLLO-ROUND-EXECUTION-TIME-BUDGET § 7 — el disparador durable de las
 * continuaciones de ronda.
 *
 * Espeja `/api/cron/enrich` en lo que importa: mismo esquema de autorización por
 * `CRON_SECRET`, mismo `force-dynamic`, misma forma de respuesta. No se inventa
 * un segundo patrón de cron en este repo.
 *
 * 🔴 No compra páginas, no crea presupuesto y no autoriza gasto: sólo termina de
 * evaluar —gratis— organizaciones que una búsqueda ya pagada dejó pendientes.
 *
 * ── 🔴 Frecuencia: la impone el PLAN, no el diseño ───────────────────────────
 *
 * El proyecto vive en un plan de Vercel que sólo admite crons DIARIOS (y dos por
 * proyecto). Una cadencia de minutos hace que el despliegue se rechace en la
 * validación de `vercel.json`, antes incluso de construir — que es exactamente
 * lo que pasó al declarar una cadencia de diez minutos.
 *
 * Consecuencia declarada: una corrida que se pausa puede tardar hasta un día en
 * retomarse. La cola es durable, así que no se pierde nada y no hace falta que
 * intervenga nadie; lo que falta es inmediatez, y eso se compra subiendo de plan
 * (cron cada pocos minutos) o añadiendo un disparo autenticado desde el wizard
 * en cuanto la corrida devuelve «en pausa». Las dos opciones dejan esta ruta y
 * la cola intactas: cambian CUÁNDO se llama, no QUÉ hace.
 */
import { NextRequest, NextResponse } from 'next/server';

import { runApolloRoundContinuationWorkerFromEnv } from '@/server/agents/prospecting-toolkit/apollo-two-round/continuation-worker.server';

export const dynamic = 'force-dynamic';

async function handleCronRequest(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET || 'local_cron_secret';

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[CronApolloContinuation] Unauthorized attempt to trigger cron endpoint.');
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const stats = await runApolloRoundContinuationWorkerFromEnv();
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    console.error('[CronApolloContinuation] Exception during worker execution:', err);
    return NextResponse.json(
      { error: 'Error interno durante la continuación de rondas' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}
