// Agente 2A — Escritura TRANSACCIONAL del merge hacia un contacto EXISTENTE
// (AGENT2A-PHONE-REVEAL-4O-H3-B)
//
// Server-only. Hace EXACTAMENTE UNA llamada a
// `merge_contact_candidate_into_existing_contact` (migración 117), que dentro de UNA sola
// transacción de PostgreSQL bloquea el candidato, revalida que sigue siendo el duplicado que
// era, comprueba que el contacto destino es el que el SERVIDOR registró, revuelve a comprobar la
// supresión POR PERSONA bajo ese lock, bloquea el contacto, bootstrappea su escalar heredado
// cuando la procedencia lo permite, añade la colección del candidato con su procedencia,
// conserva el principal existente y sólo entonces marca el candidato como duplicado FUSIONADO.
//
// Este archivo no contiene ni un `.insert()`, ni un `.update()`, ni un `.delete()`. Partido en
// escrituras sueltas, un merge dejaría números en un contacto cuyo candidato sigue diciendo que
// nadie los fusionó — y el siguiente clic los añadiría otra vez.
//
// ── SIN FALLBACK SECUENCIAL ────────────────────────────────────
// Si la RPC falla, este módulo LANZA y no intenta nada más. No reintenta: un reintento ciego no
// sabe si hubo COMMIT. La función es idempotente por construcción (un candidato ya fusionado
// devuelve su contacto sin escribir), así que un reproceso posterior converge; lo que no se hace
// es adivinar aquí.
//
// ── PRIVILEGIOS ────────────────────────────────────────────────
// La función es SECURITY INVOKER: corre bajo el techo que la 114 concedió al service role —sin
// DELETE en la canónica y con UPDATE POR COLUMNA en procedencias limitado a la tríada de
// supresión—. No puede borrar un tombstone ni reescribir una procedencia aunque quisiera.
//
// ── AUTORIZACIÓN ───────────────────────────────────────────────
// Que la RPC sea service-role NO sustituye a la autorización de la aplicación. La server action
// comprueba el usuario activo ANTES de llamar, exactamente igual que la aprobación.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. El sobre lleva conteos, banderas, ids opacos y una `dedupe_key` (SHA-256 por
// diseño de la 114): ningún número, ningún nombre, ningún email. El mensaje del driver se recorta
// antes de propagarse, porque PostgreSQL cita valores de la query en sus errores y uno de ellos
// puede ser un teléfono.
//
// ── NI PROVEEDORES NI CRÉDITOS NI HUBSPOT ──────────────────────
// No llama a Apollo, ni a Lusha, ni a HubSpot. No reserva ni consume un crédito y no escribe
// usage log, reserva ni corrida: fusionar no gasta nada, porque cada número que promueve ya fue
// observado y ya fue pagado.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN,
  buildMergeCandidateIntoExistingContactParams,
  parseMergeCandidateEnvelope,
  type MergeCandidateIntoExistingContactOutcome,
  type MergeCandidateIntoExistingContactRequest,
} from './existing-contact-merge-core';

/** Longitud máxima de un mensaje de error propagado. Corta antes de que crezca. */
const MAX_ERROR_DETAIL = 200;

/**
 * Fusiona la colección oficial de un candidato duplicado en un contacto EXISTENTE, en UNA
 * transacción.
 *
 * Devuelve lo que quedó realmente escrito (conteos de la base, no del plan). LANZA si la
 * transacción no llegó a completarse: el llamador lo trata como merge fallido y NO reporta éxito.
 */
export async function mergeCandidateIntoExistingContact(
  request: MergeCandidateIntoExistingContactRequest,
): Promise<MergeCandidateIntoExistingContactOutcome> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN,
    buildMergeCandidateIntoExistingContactParams(request),
  );
  if (error) {
    // Un error REPORTADO por el servidor significa que la transacción se deshizo: no hay estado
    // a medias que limpiar y no hay nada que reintentar aquí.
    throw new Error(
      `existing contact merge failed: ${error.message.slice(0, MAX_ERROR_DETAIL)}`,
    );
  }
  return parseMergeCandidateEnvelope(data);
}
