// Agente 2A — Escritura TRANSACCIONAL de la supresión sobre el modelo OFICIAL
// (AGENT2A-PHONE-REVEAL-4O-H2)
//
// Implementación server-only: hace EXACTAMENTE UNA llamada a
// `suppress_official_contact_phone_sources` (migración 115), que dentro de UNA sola
// transacción de PostgreSQL bloquea el contacto, retira las procedencias en alcance,
// tombstonea los números canónicos que se quedaron sin procedencia viva, reelige el
// principal SÓLO si el titular dejó de estar vivo, y reproyecta el escalar heredado.
//
// Este archivo no contiene ni un `.insert()`, ni un `.update()`, ni un `.delete()`, ni un
// `.select()`. La razón es la misma que en 4O-E2, y aquí es más dura: partido en escrituras
// sueltas por PostgREST, un fallo entre «retira la procedencia» y «tombstonea el número»
// deja una fila canónica VIVA con cero procedencias vivas —un número que el modelo declara
// borrado y la base sigue sirviendo— y un fallo antes de la reproyección deja
// `contacts.phone` afirmando una procedencia ya retirada.
//
// ── SIN FALLBACK SECUENCIAL ────────────────────────────────────
// Si la RPC falla (error del servidor, transporte, función ausente, sobre con forma
// inesperada) este módulo LANZA y no intenta nada más. No reintenta: un reintento ciego no
// sabe si hubo COMMIT. La función es idempotente por construcción (`suppressed_at IS NULL`
// no casa una procedencia ya retirada), así que un reproceso posterior converge; lo que no
// se hace es adivinar aquí.
//
// ── PRIVILEGIOS ────────────────────────────────────────────────
// La función es SECURITY INVOKER: corre bajo el techo que la migración 114 concedió al
// service role —SELECT/INSERT/UPDATE en la canónica SIN DELETE, y SELECT/INSERT en
// procedencias con UPDATE **POR COLUMNA** limitado a la tríada de supresión—. No se le regala
// nada, y en una operación de borrado eso ES el control principal: no puede borrar un
// tombstone (lo que desbloquearía el número suprimido) ni reescribir una procedencia.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
// No imprime nada. No recibe ni devuelve ningún número: el payload lleva ids opacos, un
// vocabulario cerrado y una fecha; la respuesta lleva conteos, banderas y una `dedupe_key`
// (SHA-256 por diseño de la 114). El mensaje del driver se recorta antes de propagarse,
// porque PostgreSQL cita valores de la query en sus errores y uno de ellos puede ser un
// teléfono.
//
// ── NI PROVEEDORES NI CRÉDITOS ─────────────────────────────────
// No llama a Apollo, ni a Lusha, ni a HubSpot. No lee un flag. No reserva ni consume un
// crédito y no escribe usage log, reserva ni corrida: al proveedor ya se le pagó, y la
// privacidad retiene el NÚMERO, nunca el coste.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  buildOfficialPhoneSuppressionParams,
  parseOfficialPhoneSuppressionEnvelope,
  SUPPRESS_OFFICIAL_CONTACT_PHONE_SOURCES_FN,
  type OfficialPhoneSuppressionOutcome,
  type OfficialPhoneSuppressionRequest,
} from './official-contact-phone-suppression-core';

/** Longitud máxima de un mensaje de error propagado. Corta antes de que crezca. */
const MAX_ERROR_DETAIL = 200;

/**
 * Suprime la procedencia oficial en alcance, en UNA transacción.
 *
 * Devuelve qué quedó realmente escrito (conteos de la base, no del plan). LANZA si la
 * transacción no llegó a completarse: el llamador lo trata como propagación fallida y la
 * supresión NO se reporta como éxito.
 */
export async function suppressOfficialContactPhoneSources(
  request: OfficialPhoneSuppressionRequest,
): Promise<OfficialPhoneSuppressionOutcome> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    SUPPRESS_OFFICIAL_CONTACT_PHONE_SOURCES_FN,
    buildOfficialPhoneSuppressionParams(request),
  );
  if (error) {
    // Un error REPORTADO por el servidor significa que la transacción se deshizo: no hay
    // estado a medias que limpiar y no hay nada que reintentar aquí.
    throw new Error(
      `official contact phone suppression failed: ${error.message.slice(
        0,
        MAX_ERROR_DETAIL,
      )}`,
    );
  }
  return parseOfficialPhoneSuppressionEnvelope(data);
}
