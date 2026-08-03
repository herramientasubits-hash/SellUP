/**
 * checkpoint.server.ts — Lectura y escritura del checkpoint de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX · § 7.
 *
 * El checkpoint vive bajo UNA clave de `prospect_batches.metadata`, que ya es
 * JSONB y ya la escriben otros autores (routing, presupuesto, diagnósticos, el
 * writer de candidatos). El escritor anterior hacía un read-modify-write ciego:
 * leía el documento, le añadía su clave y lo reescribía entero. Dos problemas:
 *
 *   - un checkpoint viejo podía sobrescribir uno más nuevo (sin ningún control de
 *     versión, la última escritura ganaba aunque llevara menos información);
 *   - no había forma de detectar que otro autor había tocado el documento entre
 *     la lectura y la escritura.
 *
 * Lo que hace ahora:
 *
 *   1. relee el documento SIEMPRE, justo antes de escribir — nunca reutiliza una
 *      lectura anterior, así que las claves ajenas que se persistieron mientras
 *      corría la búsqueda se conservan;
 *   2. compara `checkpoint_version`: un checkpoint con versión MENOR que la
 *      almacenada se rechaza sin escribir (escritura stale);
 *   3. hace el UPDATE con un filtro de comparación-y-cambio sobre la versión
 *      almacenada, de modo que si otro proceso escribió un checkpoint entre la
 *      lectura y el UPDATE, el UPDATE no afecta ninguna fila;
 *   4. ante ese conflicto, relee y reintenta un número acotado de veces, fusionando
 *      sobre el documento más nuevo en cada intento.
 *
 * No hay migración: el control de versión vive DENTRO del propio JSONB y el
 * filtro usa la sintaxis de rutas JSON que PostgREST ya soporta. Añadir una tabla
 * o una función SQL para esto sería crear esquema nuevo para un dato que sólo
 * tiene sentido mientras el lote existe.
 *
 * Nada aquí lanza hacia la corrida: un fallo se reporta como resultado. Perder el
 * checkpoint degrada la recuperación —y el orquestador lo trata degradando la
 * operación a indeterminada—, pero romper una ejecución que ya gastó créditos por
 * no poder guardar un dato de recuperación sería peor que el problema que resuelve.
 *
 * Server-only. No importar desde componentes de cliente.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  APOLLO_TWO_ROUND_CHECKPOINT_KEY,
  APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
  compactCheckpointForSize,
  readCheckpoint,
  type ApolloTwoRoundCheckpointV1,
} from './checkpoint';

/** Cliente admin, o null cuando el entorno no lo permite. Nunca lanza. */
export function tryGetAdminClientForTwoRound(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    return createAdminClient(url, key);
  } catch {
    return null;
  }
}

// ─── Superficie mínima del cliente ────────────────────────────────────────────
//
// Deliberadamente estrecha: el cliente admin real la satisface, y un test la
// satisface sin base de datos y sin mockear el módulo.

type MetadataRow = { metadata?: unknown };

type SelectResult = { data: MetadataRow | null; error: { message: string; code?: string } | null };
type UpdateResult = { data: unknown[] | null; error: { message: string; code?: string } | null };

export type CheckpointStoreClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { maybeSingle(): PromiseLike<SelectResult> };
    };
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        eq(column: string, value: string): { select(columns: string): PromiseLike<UpdateResult> };
        is(column: string, value: null): { select(columns: string): PromiseLike<UpdateResult> };
      };
    };
  };
};

/** Ruta JSON del contador de versión, tal como PostgREST la filtra. */
const CHECKPOINT_VERSION_FILTER_PATH =
  `metadata->${APOLLO_TWO_ROUND_CHECKPOINT_KEY}->>checkpoint_version` as const;
const CHECKPOINT_PRESENCE_FILTER_PATH = `metadata->${APOLLO_TWO_ROUND_CHECKPOINT_KEY}` as const;

/** Intentos de fusión ante conflicto. Acotado: no es un candado distribuido. */
const MAX_WRITE_ATTEMPTS = 3;

// ─── Lectura ──────────────────────────────────────────────────────────────────

export async function readTwoRoundCheckpoint(
  batchId: string,
  identity: { idempotencyKey: string; requestFingerprint: string },
  clientOverride?: CheckpointStoreClient | null,
): Promise<ApolloTwoRoundCheckpointV1 | null> {
  const client = clientOverride ?? (tryGetAdminClientForTwoRound() as CheckpointStoreClient | null);
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batchId)
      .maybeSingle();
    if (error || !data) return null;
    const metadata = data.metadata;
    if (metadata === null || typeof metadata !== 'object') return null;
    const stored = (metadata as Record<string, unknown>)[APOLLO_TWO_ROUND_CHECKPOINT_KEY];
    return readCheckpoint(stored ?? null, identity);
  } catch {
    return null;
  }
}

// ─── Escritura ────────────────────────────────────────────────────────────────

export type CheckpointWriteOutcome =
  /** Escrito y durable. */
  | { kind: 'written'; checkpointVersion: number; serializedBytes: number; compacted: boolean }
  /** Ya había un checkpoint más nuevo: esta escritura no se aplica. */
  | { kind: 'stale_rejected'; storedCheckpointVersion: number }
  /** No cupo bajo el techo ni después de compactar. No se escribió. */
  | { kind: 'too_large'; serializedBytes: number; maxBytes: number }
  /** Sin cliente, sin fila, o la base rechazó la escritura. */
  | { kind: 'failed'; reason: string };

/**
 * Escribe el checkpoint conservando el resto de `metadata`.
 *
 * `checkpointVersion` lo asigna este escritor: recibe el checkpoint sin versión y
 * le pone `almacenada + 1`. Que la versión la ponga el escritor —y no el
 * llamador— es lo que hace que dos escrituras secuenciales no puedan colisionar
 * por un contador que el llamador no vio moverse.
 */
export async function writeTwoRoundCheckpoint(
  batchId: string,
  checkpoint: ApolloTwoRoundCheckpointV1,
  clientOverride?: CheckpointStoreClient | null,
  options?: { now?: () => string; maxBytes?: number },
): Promise<CheckpointWriteOutcome> {
  const client = clientOverride ?? (tryGetAdminClientForTwoRound() as CheckpointStoreClient | null);
  if (!client) return { kind: 'failed', reason: 'no_supabase_client' };

  const nowIso = options?.now ?? (() => new Date().toISOString());
  const maxBytes = options?.maxBytes ?? APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES;

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
      storedVersion = readStoredCheckpointVersion(current);
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : 'read_failed' };
    }

    // Escritura stale: el documento ya tiene un checkpoint igual o más nuevo que
    // el que se intenta escribir. Rechazar es lo correcto — reescribirlo perdería
    // información que otro intento ya consiguió persistir.
    if (storedVersion !== null && checkpoint.checkpoint_version <= storedVersion) {
      return { kind: 'stale_rejected', storedCheckpointVersion: storedVersion };
    }

    const versioned: ApolloTwoRoundCheckpointV1 = {
      ...checkpoint,
      checkpoint_version: Math.max(checkpoint.checkpoint_version, (storedVersion ?? 0) + 1),
      checkpoint_updated_at: nowIso(),
    };
    const compaction = compactCheckpointForSize(versioned, maxBytes);
    if (!compaction.withinLimit) {
      return { kind: 'too_large', serializedBytes: compaction.serializedBytes, maxBytes };
    }

    // El documento se fusiona sobre la lectura de ESTE intento, así que las claves
    // ajenas escritas mientras corría la búsqueda no se pierden.
    const nextMetadata = {
      ...current,
      [APOLLO_TWO_ROUND_CHECKPOINT_KEY]: compaction.checkpoint,
    };

    try {
      const update = client
        .from('prospect_batches')
        .update({ metadata: nextMetadata })
        .eq('id', batchId);
      const guarded =
        storedVersion === null
          ? update.is(CHECKPOINT_PRESENCE_FILTER_PATH, null)
          : update.eq(CHECKPOINT_VERSION_FILTER_PATH, String(storedVersion));
      const { data, error } = await guarded.select('id');
      if (error) return { kind: 'failed', reason: error.message };
      if (Array.isArray(data) && data.length > 0) {
        return {
          kind: 'written',
          checkpointVersion: compaction.checkpoint.checkpoint_version,
          serializedBytes: compaction.serializedBytes,
          compacted: compaction.checkpoint.compacted,
        };
      }
      // Cero filas afectadas = otro proceso escribió un checkpoint entre la
      // lectura y el UPDATE. Se relee y se vuelve a fusionar.
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : 'update_failed' };
    }
  }

  return { kind: 'failed', reason: 'checkpoint_write_conflict_retries_exhausted' };
}

function readStoredCheckpointVersion(metadata: Record<string, unknown>): number | null {
  const stored = metadata[APOLLO_TWO_ROUND_CHECKPOINT_KEY];
  if (stored === null || typeof stored !== 'object') return null;
  const version = (stored as { checkpoint_version?: unknown }).checkpoint_version;
  if (typeof version === 'number' && Number.isFinite(version)) return version;
  // Un checkpoint presente pero sin versión legible se trata como versión 0: la
  // siguiente escritura lo reemplaza, pero el filtro de comparación-y-cambio
  // seguirá exigiendo que nadie lo haya tocado en el intervalo.
  return 0;
}
