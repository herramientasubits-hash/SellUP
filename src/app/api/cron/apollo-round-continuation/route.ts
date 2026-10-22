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
 * 🔴 AGENT1-AUDIT-WS1 — pero la cascada que corre al terminar SÍ puede llamar a
 * Lusha, y hasta este corte el cron nunca había corrido en Producción (el proxy
 * lo mandaba a /login). Por eso reanudar exige `ENABLE_AGENT1_APOLLO_CRON_CONTINUATION`
 * con el token exacto `true`; apagada (por defecto) responde `skipped: 'flag_off'`
 * sin tocar la base. Además procesa UN trabajo por invocación y el barrido de
 * corridas trabadas corre siempre, aunque la continuación falle.
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
import { runCompetitorWatchDigest } from '@/server/prospect-batches/competitor-search/competitor-watch.server';
import { isAgent1CompetitorWatchEnabled } from '@/lib/feature-flags.server';
import {
  isAgent1ApolloCronContinuationEnabled,
  pickNextClaimableContinuationBatchId,
  type ContinuationPickClient,
} from '@/modules/prospect-batches/apollo-continuation-cron';

export const dynamic = 'force-dynamic';
// AGENT1-AUDIT-WS1 — el conductor se da 240 s de presupuesto; sin esto la función
// moría antes con el límite por defecto y el trabajo quedaba «en proceso».
export const maxDuration = 300;

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

    // AGENT1-COMPETITOR-WATCH-1 — los lunes, el resumen de referencias seguidas de
    // «Competidores» (sin buscar ni gastar), con su propia bandera y antes de la
    // continuación: los 2 crons del plan ya están ocupados (auditoría 21-10). Nunca lanza.
    const competitorWatch = isAgent1CompetitorWatchEnabled()
      ? await runCompetitorWatchDigest().catch(() => null)
      : null;

    // AGENT1-AUDIT-WS1 — bandera fail-closed: abrir el proxy no enciende el gasto.
    // Apagada, se responde sin tocar la base.
    if (!isAgent1ApolloCronContinuationEnabled()) {
      return NextResponse.json({ success: true, skipped: 'flag_off', ...(competitorWatch ? { competitorWatch } : {}) });
    }

    const client = createSupabaseAdminClient();
    let stats: Awaited<ReturnType<typeof runApolloRoundContinuationWorkerFromEnv>> | null = null;
    let workerFailed = false;
    let stuck: Awaited<ReturnType<typeof closeStuckAgentRuns>> | null = null;
    try {
      // UN trabajo por invocación: el reclamo suma un intento a todo lo que toma,
      // así que tomar tres y morir en el segundo le quitaba un intento al tercero.
      const batchId = await pickNextClaimableContinuationBatchId(client as unknown as ContinuationPickClient);
      if (batchId) {
        stats = await runApolloRoundContinuationWorkerFromEnv({ batchId, limit: 1, client });
      }
    } catch (err) {
      workerFailed = true;
      console.error('[CronApolloContinuation] Exception during worker execution:', err);
    } finally {
      // AGENT1-STUCK-RUNS-CLOSE-1 — el barrido corre SIEMPRE, también si la
      // continuación falló: es justo cuando más falta cerrar lo trabado. Nunca lanza.
      stuck = await closeStuckAgentRuns(client);
    }

    if (workerFailed) {
      return NextResponse.json(
        { error: 'Error interno durante la continuación de rondas', stuck },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true, stats, stuck, ...(competitorWatch ? { competitorWatch } : {}) });
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
