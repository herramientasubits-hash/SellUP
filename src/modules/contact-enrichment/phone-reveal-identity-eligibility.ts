// Agente 2A — Elegibilidad de IDENTIDAD para el reveal de teléfono
// (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-2)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Desde AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1 (PR #289) la supresión es
// FAIL-CLOSED: sin clave `(apollo, provider_person_id, account_id)` no hay
// tombstone que emparejar, así que el reveal se BLOQUEA en vez de continuar. Los
// cuatro llamadores —START, WEBHOOK, RECOVERY y la puerta previa a Lusha— aplican
// esa regla.
//
// La UI, en cambio, seguía ofreciendo «Revelar teléfono» habilitado a candidatos
// cuya clave no existe. El resultado era una promesa falsa: el operador hacía clic,
// el servidor bloqueaba fail-closed y el drawer devolvía un error rojo de privacidad
// por algo que se sabía imposible ANTES del clic.
//
// Este módulo es la ÚNICA fuente de esa decisión para el cliente. No inventa una
// segunda aproximación: reutiliza `resolvePhoneCachePersonId` —la misma función pura
// que usan `resolveStartSuppressionKey` (START) y `resolveInFlightSuppressionPersonId`
// (webhook / recovery / puerta Lusha)— así que la regla del botón y la regla del
// servidor no pueden divergir. Aquí no se repite ninguna expresión regular ni
// ninguna condición de proveedor.
//
// ═══════════════════════════════════════════════════════════════════
// LÍMITES (deliberados)
// ═══════════════════════════════════════════════════════════════════
//
//   * es CONVENIENCIA de UI, NO una autorización. El backend sigue siendo la
//     autoridad y revalida la supresión de forma independiente en las cuatro fases.
//     Que esta función diga `eligible` no habilita nada por sí solo;
//   * NO decide sobre créditos, rol, flag, re-reveal, `do_not_contact` ni sobre la
//     existencia real de un tombstone. Solo responde: «¿existe la CLAVE con la que
//     la supresión podría evaluarse?»;
//   * es PURA: sin I/O, sin env, sin reloj, sin Supabase. Segura en el bundle del
//     cliente y ejecutable offline en tests.

import { resolvePhoneCachePersonId } from './phone-cache-core';

/**
 * Resultado de la elegibilidad de identidad. Los dos motivos de bloqueo se
 * distinguen porque describen carencias DISTINTAS —una identidad de persona que el
 * proveedor nunca dio, frente a una cuenta de SellUp que todavía no se ha
 * materializado— aunque hoy la UI trate ambas igual: sin botón utilizable.
 */
export type PhoneRevealIdentityEligibility =
  /** Hay `provider_person_id` resoluble Y cuenta: la supresión es evaluable. */
  | 'eligible'
  /** Sin cuenta con la que acotar el tombstone. */
  | 'missing_account'
  /** Sin Apollo person id resoluble (columna propia ni `source_contact_id` Apollo). */
  | 'missing_person_identity';

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Evalúa si la supresión de un candidato PODRÍA consultarse hoy.
 *
 * Espejo EXACTO —por reutilización, no por copia— de lo que hace el servidor:
 *
 *   personId  = resolvePhoneCachePersonId({ apolloPersonId, source, sourceContactId })
 *   accountId = account_id del run (`contact_enrichment_runs.account_id`)
 *   evaluable ⟺ personId != null ∧ accountId != null
 *
 * El orden de los motivos también es el del servidor
 * (`enforcePhoneRevealSuppression`): la identidad de persona se comprueba ANTES que
 * la cuenta, así que un candidato al que le faltan las DOS cosas se reporta como
 * `missing_person_identity`. Mantener el mismo orden evita que la UI y la auditoría
 * técnica nombren de forma distinta al mismo candidato.
 */
export function evaluatePhoneRevealIdentityEligibility(input: {
  /** Columna `contact_enrichment_candidates.apollo_person_id` (mig. 098). */
  apolloPersonId?: string | null;
  /** Origen del candidato: solo `apollo` puede reenviar su `source_contact_id`. */
  source?: string | null;
  /** Columna `contact_enrichment_candidates.source_contact_id`. */
  sourceContactId?: string | null;
  /** `contact_enrichment_runs.account_id` del run que originó al candidato. */
  accountId?: string | null;
}): PhoneRevealIdentityEligibility {
  const personId = resolvePhoneCachePersonId({
    apolloPersonId: input.apolloPersonId ?? null,
    sourceProvider: input.source ?? null,
    sourceContactId: input.sourceContactId ?? null,
  });
  if (!personId) return 'missing_person_identity';
  if (!cleanText(input.accountId)) return 'missing_account';
  return 'eligible';
}

/**
 * Copy mostrado cuando el botón queda deshabilitado. Deliberadamente NO nombra a
 * ningún proveedor ni invita a reintentar: la carencia puede ser PERMANENTE (un
 * candidato de origen Lusha sin `apollo_person_id` no adquiere uno por esperar), así
 * que «Apollo falló» o «intenta en unos minutos» serían falsos. Un solo texto para
 * los dos motivos: al operador le cambia lo mismo —no puede revelar— y detallar cuál
 * de las dos identidades falta no le da ninguna acción que tomar.
 */
export const PHONE_REVEAL_IDENTITY_BLOCKED_COPY =
  'SellUp todavía no puede verificar las restricciones de privacidad necesarias para revelar este teléfono.';
