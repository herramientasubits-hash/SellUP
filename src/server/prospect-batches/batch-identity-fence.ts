/**
 * AGENT1-CUT3B4 — vallado optimista de la admisión por identidad de LOTE.
 *
 * El defecto que cierra, dicho tal cual:
 *
 *     Proceso A: siembra el registro del lote en el estado S → candidato A ÚNICO
 *     Proceso B: siembra el registro del MISMO lote en S     → candidato B ÚNICO
 *     A inserta. B inserta.
 *
 * Las dos decisiones eran válidas contra S. La de B ya estaba CADUCA cuando se
 * comprometió, y nada en base de datos lo impedía. CUT-3B2/B3 lo dejó escrito en
 * el propio registro; este módulo es la barrera.
 *
 * ── Qué hace y qué NO hace ───────────────────────────────────────────────────
 *
 * Este módulo es TRANSPORTE. No decide identidad. No sabe qué es TIER 0, ni qué
 * es un identificador fiscal, ni qué es un dominio. La única pregunta que hace a
 * la base es:
 *
 *     ¿esta decisión de admisión se tomó contra el estado ACTUAL del lote?
 *
 * La política de identidad sigue siendo, entera y sin copia:
 *   · `fiscal-identity.ts`            — la autoridad fiscal (CUT-3B1)
 *   · `company-identity-evidence.ts`  — el constructor plural de evidencia (B2)
 *   · `batch-identity-registry.ts`    — la decisión TIER 0-5 (B3)
 *
 * ── `stale` NO es un error ───────────────────────────────────────────────────
 *
 * Es control de concurrencia optimista funcionando. Se re-siembra, se RE-EVALÚA
 * con la MISMA autoridad de TypeScript —el candidato puede haberse convertido en
 * duplicado, o seguir siendo legítimo— y se reintenta contra la época nueva.
 * Contarlo como avería habría convertido el éxito del mecanismo en ruido rojo.
 *
 * ── Compatibilidad con la migración SIN aplicar ──────────────────────────────
 *
 * 🔴 `capability_absent` existe por una razón concreta y acotada: la migración 126
 * se entrega SIN aplicar. Si el código exigiera la RPC, mergear y desplegar antes
 * de aplicarla dejaría a Agente 1 sin poder escribir un solo candidato.
 *
 * Cuando la RPC no existe, la base misma lo dice (SQLSTATE 42883 / PostgREST
 * PGRST202) y el llamador conserva EXACTAMENTE la ruta anterior a B4 — ni mejor ni
 * peor que hoy, con la misma carrera abierta que hoy. NO es un flag, NO es una
 * preferencia y NO puede activarse a mano: lo decide el esquema. En cuanto la 126
 * esté aplicada, la rama es inalcanzable y no queda ningún desvío directo.
 *
 * `stale` agotado NUNCA cae por aquí: eso es fallo CERRADO, sin escritura.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** La función de escritura vallada de la migración 126. */
export const FENCED_INSERT_RPC = 'insert_fenced_prospect_candidates';
/** La foto coherente (filas + época) de la migración 126. */
export const BATCH_IDENTITY_SNAPSHOT_RPC = 'read_batch_identity_snapshot';

/**
 * Tope de reintentos por candidato (o por lote, en la ruta en bloque).
 *
 * Tres, y no «los que hagan falta»: un reintento sólo ocurre cuando OTRO escritor
 * ganó la carrera sobre el MISMO lote, y los lotes de este producto se llenan con
 * un objetivo global de 10 candidatos y una amplitud de búsqueda de 25. Con dos o
 * tres escritores concurrentes como mucho, tres pasadas cubren el caso real con
 * margen; más allá, lo que hay no es contención sino un fallo, y se dice.
 */
export const MAX_IDENTITY_EPOCH_RETRIES = 3;

/** Desenlace del primitivo atómico. `stale` es normal; nunca se lanza por él. */
export type FencedCandidateInsertResult =
  | {
      status: 'inserted';
      candidateIds: ReadonlyArray<string>;
      insertedCount: number;
      previousEpoch: number;
      nextEpoch: number;
    }
  | { status: 'stale'; currentEpoch: number }
  | { status: 'batch_not_found' }
  | { status: 'invalid_input' }
  /** La 126 no está aplicada. Ver la nota de compatibilidad de arriba. */
  | { status: 'capability_absent' }
  /** Fallo REAL de escritura. La transacción revirtió: ni fila ni avance de época. */
  | { status: 'insert_failed'; code: string; raw: unknown };

/**
 * ¿Este error significa «la función no existe todavía»?
 *
 * Dos formas, porque hay dos capas: PostgREST responde `PGRST202` cuando no
 * encuentra la función en su caché de esquema, y PostgreSQL responde `42883`
 * (`undefined_function`) cuando la llamada llega al motor. Cualquier otro error es
 * un fallo REAL y no puede degradarse a «todavía no está aplicada».
 */
export function isMissingFenceCapabilityError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === '42883' || code === 'PGRST202') return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return (
    (lower.includes(FENCED_INSERT_RPC) || lower.includes(BATCH_IDENTITY_SNAPSHOT_RPC)) &&
    (lower.includes('does not exist') ||
      lower.includes('could not find') ||
      lower.includes('schema cache'))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readFiniteInteger(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  // PostgREST serializa `bigint` como cadena. Leerlo sólo como número dejaba la
  // época en `null` y convertía cada inserción con éxito en una respuesta ilegible.
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** Traduce el `jsonb` de la RPC al resultado tipado. Nunca lanza. */
export function parseFencedInsertPayload(payload: unknown): FencedCandidateInsertResult {
  const record = asRecord(payload);
  if (!record) return { status: 'insert_failed', code: 'fence_unreadable_payload', raw: payload };

  switch (record['status']) {
    case 'inserted': {
      const previousEpoch = readFiniteInteger(record, 'previous_epoch');
      const nextEpoch = readFiniteInteger(record, 'next_epoch');
      if (previousEpoch === null || nextEpoch === null) {
        return { status: 'insert_failed', code: 'fence_unreadable_epoch', raw: payload };
      }
      const candidateIds = readStringArray(record, 'candidate_ids');
      return {
        status: 'inserted',
        candidateIds,
        insertedCount: readFiniteInteger(record, 'inserted_count') ?? candidateIds.length,
        previousEpoch,
        nextEpoch,
      };
    }
    case 'stale': {
      const currentEpoch = readFiniteInteger(record, 'current_epoch');
      if (currentEpoch === null) {
        return { status: 'insert_failed', code: 'fence_unreadable_epoch', raw: payload };
      }
      return { status: 'stale', currentEpoch };
    }
    case 'batch_not_found':
      return { status: 'batch_not_found' };
    case 'invalid_input':
      return { status: 'invalid_input' };
    default:
      return { status: 'insert_failed', code: 'fence_unknown_status', raw: payload };
  }
}

/**
 * Inserta candidatos DECLARANDO contra qué época se decidió.
 *
 * Todo el trabajo real —comprobar la época, escribir, avanzar la época— ocurre
 * dentro de UNA transacción en la base. Aquí sólo se transporta y se tipa.
 */
export async function insertFencedProspectCandidates(
  client: SupabaseClient,
  args: {
    batchId: string;
    expectedEpoch: number;
    candidates: ReadonlyArray<Record<string, unknown>>;
  },
): Promise<FencedCandidateInsertResult> {
  if (args.candidates.length === 0) return { status: 'invalid_input' };

  try {
    const { data, error } = await client.rpc(FENCED_INSERT_RPC, {
      p_batch_id: args.batchId,
      p_expected_epoch: args.expectedEpoch,
      p_candidates: args.candidates,
    });

    if (error) {
      if (isMissingFenceCapabilityError(error)) return { status: 'capability_absent' };
      return {
        status: 'insert_failed',
        code: typeof error.code === 'string' && error.code.length > 0 ? error.code : 'fence_rpc_error',
        raw: error,
      };
    }

    return parseFencedInsertPayload(data);
  } catch (err) {
    if (isMissingFenceCapabilityError(err)) return { status: 'capability_absent' };
    return { status: 'insert_failed', code: 'fence_rpc_threw', raw: err };
  }
}
