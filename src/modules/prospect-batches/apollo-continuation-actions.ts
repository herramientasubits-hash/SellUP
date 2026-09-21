'use server';

/**
 * apollo-continuation-actions.ts — continuación EN SESIÓN.
 *
 * AGENT1-APOLLO-CONTINUATION-COMPLETES § 5.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * El cron es la RECUPERACIÓN, no la experiencia. Corre una vez al día (el plan
 * sólo admite esa cadencia), así que apoyarse sólo en él deja a la persona
 * mirando un lote a medias sin saber cuándo se cierra. Esta acción reutiliza LA
 * MISMA cola durable y EL MISMO conductor, pero disparados por quien está
 * delante de la pantalla.
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 *
 * 🔴 No acepta criterios, presupuesto ni política del cliente. Recibe UN
 * identificador de lote y nada más; todo el contexto sale del trabajo durable,
 * que lo escribió el servidor al pausar. Un cliente no puede pedir «continúa
 * este lote con otros criterios» porque no hay dónde ponerlos.
 *
 * 🔴 No crea trabajo. Si no hay una continuación encolada para ese lote, no
 * pasa nada: no se inventa una.
 */

import { requireActiveUser } from './actions';
import { createClient } from '@/lib/supabase/server';
import { runApolloRoundContinuationWorkerFromEnv } from '@/server/agents/prospecting-toolkit/apollo-two-round/continuation-worker.server';
import {
  resolveApolloContinuationUiStatus,
  type ApolloContinuationUiStatus,
} from './apollo-continuation-status';

export type ContinueApolloRoundResult = {
  readonly status: ApolloContinuationUiStatus | 'forbidden';
  /** Organizaciones que siguen pendientes tras este intento. */
  readonly pendingOrganizationCount: number;
  /**
   * § 5 — cuánto esperar antes de volver a llamar. El cliente NO debe
   * reintentar de inmediato ante un error: un bucle apretado contra una
   * continuación que falla convierte un fallo en una tormenta.
   */
  readonly retryAfterMs: number | null;
};

/** Espera mínima antes de otro intento cuando el anterior no cerró la corrida. */
const RETRY_AFTER_PROGRESS_MS = 2_000;
/** Espera tras un fallo. Deliberadamente más larga que la de progreso. */
const RETRY_AFTER_FAILURE_MS = 30_000;

/**
 * Continúa UNA vuelta de la corrida pausada de un lote.
 *
 * Devuelve el estado para que el wizard lo pinte y decida si volver a llamar.
 */
export async function continueApolloRound(batchId: string): Promise<ContinueApolloRoundResult> {
  await requireActiveUser();

  // ── Autorización sobre el LOTE, en servidor ────────────────────────────────
  //
  // Se consulta con el cliente de la PERSONA, no con el de servicio: si RLS no
  // le deja ver el lote, aquí no hay fila y la acción termina. Es la misma
  // puerta que usa el resto de Prospectos; no se abre una segunda.
  const supabase = await createClient();
  const { data: batch } = await supabase
    .from('prospect_batches')
    .select('id')
    .eq('id', batchId)
    .maybeSingle();

  if (!batch) {
    return { status: 'forbidden', pendingOrganizationCount: 0, retryAfterMs: null };
  }

  // A partir de aquí el contexto es DURABLE: el conductor lo lee del trabajo.
  const stats = await runApolloRoundContinuationWorkerFromEnv({ batchId, limit: 1 });
  const resolution = stats.resolutions[0]?.resolution ?? null;

  if (resolution === null) {
    // Nadie reclamó: o no hay trabajo, o lo tiene otro (cron u otra pestaña).
    return { status: 'pending_continuation', pendingOrganizationCount: 0, retryAfterMs: RETRY_AFTER_PROGRESS_MS };
  }
  if (resolution === 'completed' || resolution === 'nothing_pending') {
    return { status: 'finished', pendingOrganizationCount: 0, retryAfterMs: null };
  }
  if (resolution === 'exhausted') {
    return { status: 'failed', pendingOrganizationCount: 0, retryAfterMs: null };
  }
  if (resolution === 'identity_mismatch') {
    return { status: 'finished', pendingOrganizationCount: 0, retryAfterMs: null };
  }

  // `requeued` o `failed`: queda trabajo y habrá otra vuelta.
  return {
    status: resolveApolloContinuationUiStatus({
      pendingOrganizationCount: 1,
      jobStatus: 'pending',
    }),
    pendingOrganizationCount: 1,
    retryAfterMs: resolution === 'failed' ? RETRY_AFTER_FAILURE_MS : RETRY_AFTER_PROGRESS_MS,
  };
}
