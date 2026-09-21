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
import {
  listOpenContinuationBatchIds,
  readApolloContinuationSnapshot,
} from './apollo-continuation-read.server';

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

// ── AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING § 1 ─────────────────────────────

export type PendingApolloContinuationResult = {
  readonly batchId: string;
  readonly status: ApolloContinuationUiStatus;
  readonly pendingOrganizationCount: number;
} | null;

/**
 * §§ 2, 3 — ¿hay una corrida a medias que sea suya?
 *
 * ── Por qué el descubrimiento vive en el servidor ────────────────────────────
 *
 * Al reabrir el wizard, el cliente no tiene ya el identificador del lote: el
 * estado de la conversación anterior murió con el cierre. La alternativa
 * —guardarlo en el navegador— ataría la recuperación a un dispositivo y a un
 * almacenamiento que el usuario puede vaciar, cuando el hecho «queda trabajo»
 * es DURABLE y vive en la cola.
 *
 * 🔴 Y es también la razón por la que la pantalla NO envía un `batchId` ni
 * siquiera cuando lo conoce: si el cliente pudiera nombrar el lote a continuar,
 * la autorización tendría que defenderse de esa elección. Aquí no hay elección
 * que defender — el servidor mira su cola y responde con lo que la persona
 * puede ver.
 *
 * 🔴 No crea corridas. Devuelve un lote que YA tiene trabajo encolado, o nada.
 * No hay ninguna rama aquí capaz de lanzar una búsqueda nueva.
 *
 * El orden es: candidatos por la cola (servicio) → filtro por lo que la persona
 * puede ver (RLS) → estado del primero visible. Nunca al revés: publicar la
 * lista de la cola antes de filtrar revelaría lotes ajenos.
 */
export async function findPendingApolloContinuation(): Promise<PendingApolloContinuationResult> {
  await requireActiveUser();

  const candidateBatchIds = await listOpenContinuationBatchIds();
  if (candidateBatchIds.length === 0) return null;

  const supabase = await createClient();
  const { data: visible } = await supabase
    .from('prospect_batches')
    .select('id')
    .in('id', candidateBatchIds);

  const visibleIds = new Set(
    (Array.isArray(visible) ? visible : [])
      .map((row) => (row as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string'),
  );

  // Se conserva el orden de la COLA (más reciente primero), no el que devuelva
  // el filtro: la corrida que la persona acaba de dejar a medias es la que
  // espera encontrar al reabrir.
  for (const batchId of candidateBatchIds) {
    if (!visibleIds.has(batchId)) continue;
    const snapshot = await readApolloContinuationSnapshot(batchId);
    if (snapshot.status === 'finished') continue;
    return {
      batchId,
      status: snapshot.status,
      pendingOrganizationCount: snapshot.pendingOrganizationCount,
    };
  }

  return null;
}
