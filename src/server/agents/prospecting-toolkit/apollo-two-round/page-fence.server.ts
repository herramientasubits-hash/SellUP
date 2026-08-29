/**
 * page-fence.server.ts — Lectura y escritura de la valla durable de página.
 *
 * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING · PARTE B.
 *
 * Mismo patrón exacto que `checkpoint.server.ts` (relee siempre antes de
 * escribir, compara-y-cambia sobre un contador de versión, reintenta un
 * número acotado de veces fusionando sobre el documento más nuevo), aplicado
 * a una clave DISTINTA de `prospect_batches.metadata`
 * (`APOLLO_PAGE_FENCE_METADATA_KEY`) y a un documento más chico y transitorio:
 * sólo las páginas de la ronda EN VUELO, nunca el acumulado de la corrida.
 *
 * Reutiliza el mismo cliente admin y la misma superficie mínima de cliente que
 * `checkpoint.server.ts` — es la MISMA tabla, sólo una clave JSON distinta
 * dentro del mismo `metadata` JSONB, así que no hace falta una segunda
 * resolución de credenciales.
 *
 * Nada aquí lanza hacia la corrida: un fallo se reporta como resultado. El
 * llamador (`apollo-organizations-paginated-search.ts` vía las funciones
 * inyectadas en `production-runner.server.ts`) decide cómo degradar —ver el
 * comentario de `durableFence` en ese módulo—, nunca este escritor.
 *
 * Server-only. No importar desde componentes de cliente.
 */

import {
  tryGetAdminClientForTwoRound,
  type CheckpointStoreClient,
} from './checkpoint.server';
import {
  APOLLO_PAGE_FENCE_METADATA_KEY,
  APOLLO_PAGE_FENCE_MAX_SERIALIZED_BYTES,
  APOLLO_PAGE_FENCE_CONTRACT_VERSION,
  compactApolloPageFenceForSize,
  readApolloPageFenceDocument,
  mergeApolloPageFenceEntries,
  clearApolloPageFenceRound,
  type ApolloPageFenceDocumentV1,
  type ApolloPageFenceEntry,
} from './page-fence';

/** Intentos de fusión ante conflicto. Acotado: no es un candado distribuido. */
const MAX_WRITE_ATTEMPTS = 3;

const FENCE_VERSION_FILTER_PATH =
  `metadata->${APOLLO_PAGE_FENCE_METADATA_KEY}->>fence_version` as const;
const FENCE_PRESENCE_FILTER_PATH = `metadata->${APOLLO_PAGE_FENCE_METADATA_KEY}` as const;

export type ApolloPageFenceIdentity = { idempotencyKey: string; requestFingerprint: string };

// ─── Lectura ──────────────────────────────────────────────────────────────────

/**
 * AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX — BLOQUEADOR 2.
 *
 * Antes de este corte, esta función devolvía `[]` tanto si el documento
 * genuinamente no existía como si la lectura contra Supabase fallaba
 * (excepción o `error` de PostgREST). Un llamador que necesita la valla para
 * decidir si repetir una página no puede distinguir "sin páginas previas
 * conocidas" de "no se pudo saber si hay páginas previas" — y confundir las
 * dos trata un fallo de almacenamiento exactamente como si la corrida fuera
 * nueva, reabriendo la ventana de doble cobro que la valla existe para
 * cerrar.
 *
 * `kind: 'read'` — lectura genuina, `entries` es la verdad conocida (puede
 * ser `[]` si el documento no existe todavía o pertenece a otra corrida).
 * `kind: 'failed'` — la lectura no se pudo completar; el llamador NO puede
 * tratar esto como "sin entradas" (ver `buildApolloPageFenceReadFailureBlock`
 * en `page-fence.ts`).
 */
export type ApolloPageFenceReadOutcome =
  | { kind: 'read'; entries: ApolloPageFenceEntry[] }
  | { kind: 'failed'; reason: string };

/**
 * Sin cliente configurado (entorno sin Supabase, p. ej. pruebas que no
 * inyectan `clientOverride`): NO es un fallo de lectura, es "esta valla no
 * está disponible en este entorno" — el mismo contrato "ausente ⇒
 * comportamiento previo" que documenta `ApolloOrgsSearchOptions
 * .durablePageFence`. La escritura correspondiente (`upsertApolloPageFenceEntry`
 * sin cliente) sigue reportando `{kind:'failed'}` y por eso `beforeRequest`
 * bloquea igual la primera petición — la seguridad no depende de qué
 * devuelva la lectura en ese caso.
 */
export async function readApolloPageFenceEntries(
  batchId: string,
  identity: ApolloPageFenceIdentity,
  clientOverride?: CheckpointStoreClient | null,
): Promise<ApolloPageFenceReadOutcome> {
  const client = clientOverride ?? (tryGetAdminClientForTwoRound() as CheckpointStoreClient | null);
  if (!client) return { kind: 'read', entries: [] };
  try {
    const { data, error } = await client
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batchId)
      .maybeSingle();
    if (error) return { kind: 'failed', reason: error.message };
    if (!data) return { kind: 'failed', reason: 'batch_not_found' };
    const metadata = data.metadata;
    if (metadata === null || typeof metadata !== 'object') return { kind: 'read', entries: [] };
    const stored = (metadata as Record<string, unknown>)[APOLLO_PAGE_FENCE_METADATA_KEY];
    const doc = readApolloPageFenceDocument(stored ?? null, identity);
    return { kind: 'read', entries: doc?.entries ?? [] };
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : 'read_failed' };
  }
}

// ─── Escritura ────────────────────────────────────────────────────────────────

export type ApolloPageFenceWriteOutcome =
  | { kind: 'written' }
  | { kind: 'failed'; reason: string };

function readStoredFenceVersion(metadata: Record<string, unknown>): number | null {
  const stored = metadata[APOLLO_PAGE_FENCE_METADATA_KEY];
  if (stored === null || typeof stored !== 'object') return null;
  const version = (stored as { fence_version?: unknown }).fence_version;
  if (typeof version === 'number' && Number.isFinite(version)) return version;
  return 0;
}

function readStoredFenceEntries(
  metadata: Record<string, unknown>,
  identity: ApolloPageFenceIdentity,
): ApolloPageFenceEntry[] {
  const stored = metadata[APOLLO_PAGE_FENCE_METADATA_KEY];
  const doc = readApolloPageFenceDocument(stored ?? null, identity);
  return doc?.entries ?? [];
}

/**
 * Une `entry` (o vacía una ronda, si `clearRound` se da) dentro del documento
 * durable, con la MISMA disciplina de relectura + comparación-y-cambio que
 * `writeTwoRoundCheckpoint`.
 */
async function writeApolloPageFence(
  batchId: string,
  identity: ApolloPageFenceIdentity,
  apply: (existing: ApolloPageFenceEntry[]) => ApolloPageFenceEntry[],
  clientOverride?: CheckpointStoreClient | null,
): Promise<ApolloPageFenceWriteOutcome> {
  const client = clientOverride ?? (tryGetAdminClientForTwoRound() as CheckpointStoreClient | null);
  if (!client) return { kind: 'failed', reason: 'no_supabase_client' };

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    let current: Record<string, unknown> = {};
    let storedVersion: number | null = null;

    try {
      const { data, error } = await client
        .from('prospect_batches')
        .select('metadata')
        .eq('id', batchId)
        .maybeSingle();
      if (error) return { kind: 'failed', reason: error.message };
      if (!data) return { kind: 'failed', reason: 'batch_not_found' };
      current =
        data.metadata !== null && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : {};
      storedVersion = readStoredFenceVersion(current);
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : 'read_failed' };
    }

    const existingEntries = readStoredFenceEntries(current, identity);
    const nextEntries = apply(existingEntries);
    const nextDoc: ApolloPageFenceDocumentV1 = {
      version: APOLLO_PAGE_FENCE_CONTRACT_VERSION,
      fence_version: Math.max(1, (storedVersion ?? 0) + 1),
      idempotency_key: identity.idempotencyKey,
      request_fingerprint: identity.requestFingerprint,
      entries: nextEntries,
      compacted: false,
    };
    const compaction = compactApolloPageFenceForSize(nextDoc, APOLLO_PAGE_FENCE_MAX_SERIALIZED_BYTES);

    const nextMetadata = {
      ...current,
      [APOLLO_PAGE_FENCE_METADATA_KEY]: compaction.document,
    };

    try {
      const update = client
        .from('prospect_batches')
        .update({ metadata: nextMetadata })
        .eq('id', batchId);
      const guarded =
        storedVersion === null
          ? update.is(FENCE_PRESENCE_FILTER_PATH, null)
          : update.eq(FENCE_VERSION_FILTER_PATH, String(storedVersion));
      const { data, error } = await guarded.select('id');
      if (error) return { kind: 'failed', reason: error.message };
      if (Array.isArray(data) && data.length > 0) return { kind: 'written' };
      // Cero filas afectadas = otro proceso escribió entre la lectura y el
      // UPDATE. Se relee y se vuelve a fusionar, igual que el checkpoint.
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : 'update_failed' };
    }
  }

  return { kind: 'failed', reason: 'page_fence_write_conflict_retries_exhausted' };
}

/** Inserta/actualiza UNA entrada de página (upsert por ronda+huella+página). */
export async function upsertApolloPageFenceEntry(
  batchId: string,
  identity: ApolloPageFenceIdentity,
  entry: ApolloPageFenceEntry,
  clientOverride?: CheckpointStoreClient | null,
): Promise<ApolloPageFenceWriteOutcome> {
  return writeApolloPageFence(
    batchId,
    identity,
    (existing) => mergeApolloPageFenceEntries(existing, [entry]),
    clientOverride,
  );
}

/**
 * Limpia las entradas de UNA ronda ya cerrada (con éxito o indeterminada).
 *
 * A partir de ahí el checkpoint de ronda es la fuente de verdad; dejar las
 * entradas sólo ocuparía presupuesto de tamaño sin aportar nada que un
 * reintento necesite.
 */
export async function clearApolloPageFenceRoundDurable(
  batchId: string,
  identity: ApolloPageFenceIdentity,
  roundNumber: number,
  clientOverride?: CheckpointStoreClient | null,
): Promise<ApolloPageFenceWriteOutcome> {
  return writeApolloPageFence(
    batchId,
    identity,
    (existing) => clearApolloPageFenceRound(existing, roundNumber),
    clientOverride,
  );
}
