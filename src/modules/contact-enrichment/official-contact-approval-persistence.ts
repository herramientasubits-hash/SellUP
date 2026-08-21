// Agente 2A — Escritura TRANSACCIONAL de la aprobación (AGENT2A-PHONE-REVEAL-4O-H3)
//
// Server-only. Hace EXACTAMENTE UNA llamada a `approve_contact_candidate_with_phones`
// (migración 116), que dentro de UNA sola transacción de PostgreSQL bloquea el candidato,
// revalida que sigue siendo aprobable, revuelve a comprobar la supresión POR PERSONA bajo ese
// lock, crea el contacto, promueve TODA la colección de teléfonos con su procedencia, elige un
// principal, proyecta el escalar heredado y sólo entonces marca el candidato como aprobado.
//
// Este archivo no contiene ni un `.insert()`, ni un `.update()`, ni un `.delete()`. Esa es la
// razón por la que existe: partida en escrituras sueltas por PostgREST —que es como está
// hoy— la aprobación deja, si falla entre el paso 3 y el 4, un CONTACTO que nadie aprobó junto
// a un candidato que sigue `pending_review` y que el siguiente clic volverá a aprobar,
// creando un segundo contacto para la misma persona.
//
// ── SIN FALLBACK SECUENCIAL ────────────────────────────────────
// Si la RPC falla, este módulo LANZA y no intenta nada más. No reintenta: un reintento ciego no
// sabe si hubo COMMIT, y aquí un COMMIT invisible significa un contacto duplicado. La función
// es idempotente por construcción (un candidato ya `approved` devuelve su contacto sin
// escribir), así que un reproceso posterior converge; lo que no se hace es adivinar aquí.
//
// ── PRIVILEGIOS ────────────────────────────────────────────────
// La función es SECURITY INVOKER: corre bajo el techo que la 114 concedió al service role
// —SELECT/INSERT/UPDATE en la canónica SIN DELETE, y SELECT/INSERT en procedencias con UPDATE
// POR COLUMNA limitado a la tríada de supresión—. No puede borrar un tombstone ni reescribir
// una procedencia aunque quisiera.
//
// ── AUTORIZACIÓN ───────────────────────────────────────────────
// Que la RPC sea service-role NO sustituye a la autorización de la aplicación. La server action
// sigue comprobando el usuario activo ANTES de llamar, exactamente como hoy.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. El sobre lleva conteos, banderas, ids opacos y una `dedupe_key` (SHA-256 por
// diseño de la 114): ningún número, ningún nombre, ningún email. El mensaje del driver se
// recorta antes de propagarse, porque PostgreSQL cita valores de la query en sus errores y uno
// de ellos puede ser un teléfono.
//
// ── NI PROVEEDORES NI CRÉDITOS NI HUBSPOT ──────────────────────
// No llama a Apollo, ni a Lusha, ni a HubSpot. No reserva ni consume un crédito y no escribe
// usage log, reserva ni corrida: aprobar no gasta nada, porque cada número que promueve ya fue
// observado y ya fue pagado.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN,
  buildApproveCandidateWithPhonesParams,
  parseApproveCandidateWithPhonesEnvelope,
  type ApproveCandidateWithPhonesOutcome,
  type ApproveCandidateWithPhonesRequest,
} from './official-contact-approval-core';

/** Longitud máxima de un mensaje de error propagado. Corta antes de que crezca. */
const MAX_ERROR_DETAIL = 200;

/**
 * Aprueba un candidato y propaga su colección oficial de teléfonos, en UNA transacción.
 *
 * Devuelve lo que quedó realmente escrito (conteos de la base, no del plan). LANZA si la
 * transacción no llegó a completarse: el llamador lo trata como aprobación fallida y NO reporta
 * éxito.
 */
export async function approveContactCandidateWithPhones(
  request: ApproveCandidateWithPhonesRequest,
): Promise<ApproveCandidateWithPhonesOutcome> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN,
    buildApproveCandidateWithPhonesParams(request),
  );
  if (error) {
    // Un error REPORTADO por el servidor significa que la transacción se deshizo: no hay estado
    // a medias que limpiar y no hay nada que reintentar aquí.
    throw new Error(
      `official contact approval failed: ${error.message.slice(0, MAX_ERROR_DETAIL)}`,
    );
  }
  return parseApproveCandidateWithPhonesEnvelope(data);
}
