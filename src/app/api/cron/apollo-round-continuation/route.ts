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
// AGENT1-IMPORT-PARITY-7 — la MISMA autorización fail-closed del cron de
// recuperación de teléfonos: sin `CRON_SECRET` configurado nadie entra. Antes
// caía a un secreto público (`local_cron_secret`) que cualquiera podía enviar.
import {
  authorizeRecoveryCronRequest,
  extractCronSecretFromAuthorizationHeader,
} from '@/modules/contact-enrichment/phone-reveal-recovery-cron-core';

import { runApolloRoundContinuationWorkerFromEnv } from '@/server/agents/prospecting-toolkit/apollo-two-round/continuation-worker.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { closeStuckAgentRuns } from '@/modules/prospect-batches/stuck-runs/stuck-runs.server';

export const dynamic = 'force-dynamic';

async function handleCronRequest(request: NextRequest) {
  try {
    const auth = authorizeRecoveryCronRequest(
      extractCronSecretFromAuthorizationHeader(request.headers.get('Authorization')),
      process.env.CRON_SECRET,
    );

    if (!auth.authorized) {
      console.warn(`[CronApolloContinuation] Unauthorized attempt to trigger cron endpoint (${auth.denialCode}).`);
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const stats = await runApolloRoundContinuationWorkerFromEnv();
    // AGENT1-STUCK-RUNS-CLOSE-1 — después de retomar, cerrar lo que quedó trabado.
    const stuck = await closeStuckAgentRuns(createSupabaseAdminClient());
    return NextResponse.json({ success: true, stats, stuck });
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
