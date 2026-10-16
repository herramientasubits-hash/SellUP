/**
 * AGENT1-AUDIT-WS2 § 11 — candado por lote para las acciones PAGADAS de Claude
 * («Clasificar con Claude», «Rescatar con Claude»).
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * Dos clics (o dos pestañas) lanzaban dos corridas pagadas sobre el MISMO lote, que
 * además revisaban las mismas filas. No había ningún marcador «en curso».
 *
 * ── Cómo ─────────────────────────────────────────────────────────────────────
 *
 * Una marca en `prospect_batches.metadata.claude_action_locks.<acción>` con su
 * caducidad (ISO). Se toma con un UPDATE CONDICIONAL: sólo si no hay marca o ya
 * caducó. Postgres reevalúa la condición tras bloquear la fila, así que de dos
 * intentos simultáneos sólo uno toca la fila; el otro ve 0 filas ⇒ «ya en curso».
 * Caduca sola (`CLAUDE_ACTION_LOCK_TTL_MS`, por encima de los 300 s de la ruta):
 * un proceso muerto no deja el lote bloqueado. Sin migración: es metadata.
 *
 * Fail-closed: si no se puede tomar la marca (error de lectura/escritura), la
 * acción NO corre.
 */

export const CLAUDE_ACTION_LOCKS_METADATA_KEY = 'claude_action_locks';
/** Por encima de los 300 s de una invocación, con margen. */
export const CLAUDE_ACTION_LOCK_TTL_MS = 6 * 60 * 1000;

export type ClaudeActionKind = 'classify' | 'rescue';

/** Lo mínimo del cliente Supabase que usa el candado (inyectable en pruebas). */
export type ClaudeActionLockClient = {
  from(table: 'prospect_batches'): {
    select(columns: 'metadata'): {
      eq(column: 'id', value: string): {
        maybeSingle(): PromiseLike<{ data: { metadata: unknown } | null; error: unknown }>;
      };
    };
    update(values: { metadata: Record<string, unknown> }): {
      eq(column: 'id', value: string): {
        or(filters: string): {
          select(columns: 'id'): PromiseLike<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
};

function readLocks(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {};
  const locks = (metadata as Record<string, unknown>)[CLAUDE_ACTION_LOCKS_METADATA_KEY];
  return locks && typeof locks === 'object' ? { ...(locks as Record<string, unknown>) } : {};
}

/** ¿Hay una marca VIGENTE para esta acción? Puro. */
export function isClaudeActionLockHeld(metadata: unknown, kind: ClaudeActionKind, nowMs: number): boolean {
  const until = readLocks(metadata)[kind];
  if (typeof until !== 'string') return false;
  const untilMs = Date.parse(until);
  return Number.isFinite(untilMs) && untilMs > nowMs;
}

export type ClaudeActionLockResult = 'acquired' | 'busy' | 'unavailable';

/** Toma la marca. `busy` = otra corrida la tiene; `unavailable` = no se pudo leer/escribir. */
export async function acquireClaudeActionLock(
  client: ClaudeActionLockClient,
  batchId: string,
  kind: ClaudeActionKind,
  nowMs: number = Date.now(),
): Promise<ClaudeActionLockResult> {
  try {
    const { data, error } = await client.from('prospect_batches').select('metadata').eq('id', batchId).maybeSingle();
    if (error || !data) return 'unavailable';
    if (isClaudeActionLockHeld(data.metadata, kind, nowMs)) return 'busy';
    const metadata = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>;
    const nowIso = new Date(nowMs).toISOString();
    const untilIso = new Date(nowMs + CLAUDE_ACTION_LOCK_TTL_MS).toISOString();
    const path = `metadata->${CLAUDE_ACTION_LOCKS_METADATA_KEY}->>${kind}`;
    const { data: touched, error: updateError } = await client
      .from('prospect_batches')
      .update({
        metadata: {
          ...metadata,
          [CLAUDE_ACTION_LOCKS_METADATA_KEY]: { ...readLocks(metadata), [kind]: untilIso },
        },
      })
      .eq('id', batchId)
      // Sólo si sigue libre: sin marca, o la marca ya caducó (ISO UTC ordena como texto).
      .or(`${path}.is.null,${path}.lt.${nowIso}`)
      .select('id');
    if (updateError) return 'unavailable';
    return Array.isArray(touched) && touched.length > 0 ? 'acquired' : 'busy';
  } catch {
    return 'unavailable';
  }
}

/** Suelta la marca (best-effort: si falla, caduca sola). Nunca lanza. */
export async function releaseClaudeActionLock(
  client: ClaudeActionLockClient,
  batchId: string,
  kind: ClaudeActionKind,
): Promise<void> {
  try {
    const { data, error } = await client.from('prospect_batches').select('metadata').eq('id', batchId).maybeSingle();
    if (error || !data) return;
    const metadata = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>;
    const locks = readLocks(metadata);
    if (!(kind in locks)) return;
    delete locks[kind];
    const path = `metadata->${CLAUDE_ACTION_LOCKS_METADATA_KEY}->>${kind}`;
    await client
      .from('prospect_batches')
      .update({ metadata: { ...metadata, [CLAUDE_ACTION_LOCKS_METADATA_KEY]: locks } })
      .eq('id', batchId)
      .or(`${path}.not.is.null`)
      .select('id');
  } catch {
    // Caduca sola.
  }
}
