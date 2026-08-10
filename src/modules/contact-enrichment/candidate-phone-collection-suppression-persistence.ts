// Agente 2A — Escritura TRANSACCIONAL de la propagación de la supresión
// (AGENT2A-PHONE-REVEAL-4O-E2)
//
// Implementación server-only de la propagación: hace EXACTAMENTE UNA llamada a
// `suppress_candidate_phone_collection` (migración 112), que dentro de una sola
// transacción de PostgreSQL bloquea el candidato, tombstonea los números en
// alcance, reelige el principal superviviente y sincroniza el escalar y su
// metadata.
//
// Este archivo no contiene ni un `.insert()`, ni un `.update()`, ni un `.delete()`,
// ni un `.select()`: si la propagación fuera una secuencia de escrituras por
// PostgREST, un fallo a mitad podría dejar un tombstone sin reelección —es decir,
// un candidato sin principal habiendo supervivientes— o supervivientes sin
// tombstone, que es literalmente el hueco que este hito cierra.
//
// ── SIN FALLBACK SECUENCIAL ────────────────────────────────────
// Si la RPC falla (error del servidor, transporte, función ausente, sobre con forma
// inesperada) este módulo LANZA y no intenta nada más. No reintenta: un reintento
// ciego no sabe si hubo COMMIT. La función es idempotente por construcción (una
// fila ya tombstoneada no la casa el `WHERE suppressed_at IS NULL`), así que un
// reproceso posterior converge; lo que no se hace es adivinar aquí.
//
// ── PRIVILEGIOS ────────────────────────────────────────────────
// La función es SECURITY INVOKER: corre con el sobre que la migración 109 concedió
// al service role —SELECT/INSERT/UPDATE en la tabla canónica, SIN DELETE, y
// SELECT/INSERT en procedencias, SIN UPDATE—. No se le regala nada, y en una
// operación de borrado eso es el control principal: no puede borrar un tombstone ni
// reescribir una procedencia.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. No recibe ni devuelve ningún número: el payload lleva ids
// opacos, un vocabulario cerrado y una fecha; la respuesta lleva conteos, banderas
// y una `dedupe_key` (SHA-256). El mensaje del driver se recorta antes de
// propagarse, porque PostgreSQL cita valores de la query en sus errores.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  buildCandidatePhoneCollectionSuppressionParams,
  parseCandidatePhoneCollectionSuppressionEnvelope,
  SUPPRESS_CANDIDATE_PHONE_COLLECTION_FN,
  type CandidatePhoneCollectionSuppressionRequest,
  type CandidatePhoneCollectionSuppressionResult,
} from './candidate-phone-collection-suppression-core';

/** Longitud máxima de un mensaje de error propagado. Corta antes de que crezca. */
const MAX_ERROR_DETAIL = 200;

/**
 * Propaga la supresión a la colección canónica del candidato en UNA transacción.
 *
 * Devuelve qué quedó realmente escrito (conteos de la base, no del plan). LANZA si
 * la transacción no llegó a completarse: el llamador lo trata como propagación
 * fallida y la supresión NO se reporta como éxito.
 */
export async function suppressCandidatePhoneCollection(
  request: CandidatePhoneCollectionSuppressionRequest,
): Promise<CandidatePhoneCollectionSuppressionResult> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    SUPPRESS_CANDIDATE_PHONE_COLLECTION_FN,
    buildCandidatePhoneCollectionSuppressionParams(request),
  );
  if (error) {
    // Un error REPORTADO por el servidor significa que la transacción se deshizo:
    // no hay estado a medias que limpiar y no hay nada que reintentar aquí.
    throw new Error(
      `candidate phone collection suppression failed: ${error.message.slice(
        0,
        MAX_ERROR_DETAIL,
      )}`,
    );
  }
  return parseCandidatePhoneCollectionSuppressionEnvelope(data);
}
