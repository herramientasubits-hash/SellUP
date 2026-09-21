/**
 * apollo-continuation-read.server.ts — LECTURA del estado de una continuación.
 *
 * AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING § 1.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * `resolveApolloContinuationUiStatus` pide dos hechos —organizaciones pendientes
 * y estado del trabajo— y hasta este corte NADIE los producía: la única forma de
 * saber cómo iba una corrida era reclamar trabajo con `continueApolloRound`, que
 * es una acción, no una lectura. Una pantalla que quiere PINTAR el estado al
 * abrirse no puede tener que tomar el lease para averiguarlo.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 *
 * 🔴 No reclama, no reanuda, no encola y no autoriza gasto. Ni siquiera toca la
 * cola: la lee. Un `SELECT` no puede pausar ni continuar nada, y ése es
 * justamente el punto — el conductor sigue siendo la única puerta por la que se
 * ejecuta trabajo.
 *
 * 🔴 No decide autorización. Quien llame tiene que haber comprobado ANTES, con
 * el cliente de la persona, que el lote es suyo; aquí se usa el cliente de
 * servicio porque la cola no es una tabla del usuario.
 *
 * Server-only.
 */
import {
  readTwoRoundCheckpoint,
  tryGetAdminClientForTwoRound,
  type CheckpointStoreClient,
} from '@/server/agents/prospecting-toolkit/apollo-two-round/checkpoint.server';

import {
  resolveApolloContinuationUiStatus,
  type ApolloContinuationJobStatus,
  type ApolloContinuationUiStatus,
} from './apollo-continuation-status';

const CONTINUATION_JOBS_TABLE = 'apollo_round_continuation_jobs';

/**
 * Estados NO terminales de la cola: hay trabajo que alguien puede retomar.
 *
 * `completed` y `skipped` cierran, y `failed` cierra AGOTADO — el conductor sólo
 * marca así un trabajo cuando ya no le quedan intentos. Ninguno de los tres se
 * ofrece para continuar.
 */
const OPEN_JOB_STATUSES = ['pending', 'processing'] as const;

/** Cuántos trabajos abiertos se miran al recuperar. Acotado a propósito. */
export const APOLLO_CONTINUATION_RECOVERY_SCAN_LIMIT = 10;

// ─── Superficie mínima del cliente ────────────────────────────────────────────
//
// Estrecha como la de `checkpoint.server`: el cliente admin real la satisface y
// una prueba la satisface sin base de datos y sin mockear el módulo.

type RowsResult = { data: unknown[] | null; error: { message: string } | null };
type OrderedRows = {
  order(column: string, options: { ascending: boolean }): { limit(count: number): PromiseLike<RowsResult> };
};

export type ApolloContinuationReadClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): OrderedRows;
      in(column: string, values: readonly string[]): OrderedRows;
    };
  };
};

/** Lo que la cola sabe del último trabajo de un lote. */
export type ApolloContinuationJobView = {
  readonly status: ApolloContinuationJobStatus;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
};

/** Estado durable de la continuación de un lote, sin efectos. */
export type ApolloContinuationSnapshot = {
  readonly status: ApolloContinuationUiStatus;
  readonly pendingOrganizationCount: number;
};

function resolveClient(
  override?: ApolloContinuationReadClient | null,
): ApolloContinuationReadClient | null {
  if (override) return override;
  const admin = tryGetAdminClientForTwoRound();
  return admin === null ? null : (admin as unknown as ApolloContinuationReadClient);
}

function normalizeJobStatus(value: unknown): ApolloContinuationJobStatus | null {
  return value === 'pending' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'skipped'
    ? value
    : null;
}

/**
 * El trabajo MÁS RECIENTE del lote, o `null` si nunca hubo ninguno.
 *
 * Se lee el más reciente y no «el abierto» a propósito: un lote cuyo único
 * trabajo terminó tiene que poder decir «terminado», y para eso hace falta ver
 * la fila cerrada.
 */
export async function readLatestContinuationJob(
  batchId: string,
  clientOverride?: ApolloContinuationReadClient | null,
): Promise<ApolloContinuationJobView | null> {
  const client = resolveClient(clientOverride);
  if (!client) return null;
  try {
    const { data, error } = await client
      .from(CONTINUATION_JOBS_TABLE)
      .select('status, idempotency_key, request_fingerprint, created_at')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== 'object') return null;
    const { status, idempotency_key: idempotencyKey, request_fingerprint: requestFingerprint } =
      row as { status?: unknown; idempotency_key?: unknown; request_fingerprint?: unknown };
    const normalized = normalizeJobStatus(status);
    if (
      normalized === null ||
      typeof idempotencyKey !== 'string' ||
      typeof requestFingerprint !== 'string'
    ) {
      return null;
    }
    return { status: normalized, idempotencyKey, requestFingerprint };
  } catch {
    return null;
  }
}

/**
 * Estado visible de la continuación de UN lote.
 *
 * Sin trabajo en la cola no hay nada que continuar, y eso es `finished`: el
 * mismo veredicto que da el resolutor con cero pendientes. No se inventa un
 * «pendiente» para un lote que nunca pausó.
 */
export async function readApolloContinuationSnapshot(
  batchId: string,
  clientOverride?: ApolloContinuationReadClient | null,
): Promise<ApolloContinuationSnapshot> {
  const job = await readLatestContinuationJob(batchId, clientOverride);
  if (job === null) {
    return { status: 'finished', pendingOrganizationCount: 0 };
  }

  // La identidad sale del TRABAJO, no del llamador: el checkpoint de otra
  // corrida del mismo lote no se lee, se descarta — `readCheckpoint` compara la
  // identidad y devuelve null cuando no coincide.
  const checkpoint = await readTwoRoundCheckpoint(
    batchId,
    { idempotencyKey: job.idempotencyKey, requestFingerprint: job.requestFingerprint },
    clientOverride === undefined || clientOverride === null
      ? null
      : (clientOverride as unknown as CheckpointStoreClient),
  );
  const pendingOrganizationCount = checkpoint?.pending_organizations.length ?? 0;

  return {
    status: resolveApolloContinuationUiStatus({ pendingOrganizationCount, jobStatus: job.status }),
    pendingOrganizationCount,
  };
}

/**
 * Lotes con trabajo ABIERTO en la cola, del más reciente al más antiguo.
 *
 * Es la mitad de servicio de la recuperación al reabrir: devuelve candidatos,
 * NO permisos. Quien llame filtra después por lo que la persona puede ver, con
 * el cliente de la persona.
 */
export async function listOpenContinuationBatchIds(
  limit: number = APOLLO_CONTINUATION_RECOVERY_SCAN_LIMIT,
  clientOverride?: ApolloContinuationReadClient | null,
): Promise<string[]> {
  const client = resolveClient(clientOverride);
  if (!client) return [];
  try {
    const { data, error } = await client
      .from(CONTINUATION_JOBS_TABLE)
      .select('batch_id, status, created_at')
      .in('status', [...OPEN_JOB_STATUSES])
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.trunc(limit)));
    if (error || !Array.isArray(data)) return [];
    const ids: string[] = [];
    for (const row of data) {
      const batchId = (row as { batch_id?: unknown }).batch_id;
      if (typeof batchId === 'string' && batchId !== '' && !ids.includes(batchId)) {
        ids.push(batchId);
      }
    }
    return ids;
  } catch {
    return [];
  }
}
