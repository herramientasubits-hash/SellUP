// Agente 2A — Elegibilidad de IDENTIDAD para el reveal de teléfono
// (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-2, repuntada en la Fase 1 de
//  AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Desde AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1 (PR #289) la supresión es FAIL-CLOSED: sin
// clave que emparejar, el reveal se BLOQUEA en vez de continuar. La UI, en cambio,
// seguía ofreciendo «Revelar teléfono» habilitado a candidatos cuya clave no existía. El
// resultado era una promesa falsa: el operador hacía clic, el servidor bloqueaba
// fail-closed y el drawer devolvía un error rojo de privacidad por algo que se sabía
// imposible ANTES del clic. PR #291 cerró eso deshabilitando el botón.
//
// Este módulo es la ÚNICA fuente de esa decisión para el cliente, y su valor está en que
// NO inventa una segunda aproximación: reutiliza la MISMA función pura que usa el
// servidor, así que la regla del botón y la regla del servidor no pueden divergir. Aquí
// no se repite ninguna expresión regular ni ninguna condición de proveedor.
//
// ═══════════════════════════════════════════════════════════════════
// QUÉ CAMBIÓ EN LA FASE 1
// ═══════════════════════════════════════════════════════════════════
//
// El prerrequisito de #291 era:
//
//     identidad de Apollo resoluble  Y  account_id
//
// y quedó OBSOLETO en las dos mitades. El servidor ya no exige cuenta (la supresión vive
// en `provider_suppressions`, sin cuenta) y ya no exige que la identidad sea de Apollo
// (un candidato de Lusha usa su `source_contact_id` nativo). El nuevo prerrequisito es:
//
//     identidad NATIVA del proveedor resoluble
//
// Este archivo se repunta a `resolvePhoneRevealProviderIdentity`, que es exactamente la
// función que los cuatro gates del servidor usan. Si esta función dijera `eligible` y el
// servidor bloqueara —o al contrario— sería porque las dos leen la MISMA función con las
// MISMAS columnas, lo cual no puede ocurrir por construcción.
//
// ═══════════════════════════════════════════════════════════════════
// LÍMITES (deliberados)
// ═══════════════════════════════════════════════════════════════════
//
//   * es CONVENIENCIA de UI, NO una autorización. El backend sigue siendo la autoridad y
//     revalida la supresión de forma independiente en las cuatro fases. Que esta función
//     diga `eligible` no habilita nada por sí solo, y en particular NO afirma que la
//     persona no esté suprimida: sólo que la pregunta se puede formular;
//   * NO decide sobre créditos, rol, flag, re-reveal, `do_not_contact` ni sobre la
//     existencia real de una supresión. Sólo responde: «¿existe la IDENTIDAD con la que
//     la privacidad podría evaluarse?»;
//   * es PURA: sin I/O, sin env, sin reloj, sin Supabase. Segura en el bundle del cliente
//     y ejecutable offline en tests.

import { resolvePhoneRevealProviderIdentity } from './provider-suppression-core';

/**
 * Resultado de la elegibilidad de identidad.
 *
 * FASE 1 (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4): `missing_account` DESAPARECIÓ. No
 * se conserva como estado inalcanzable ni se deja como alias: mientras existiera, la
 * siguiente persona que leyera este módulo tendría que averiguar si la cuenta sigue
 * importando. Ya no importa, y el tipo lo dice.
 *
 * Queda una sola carencia posible: que el proveedor nunca haya dado una identidad
 * utilizable para esa persona.
 */
export type PhoneRevealIdentityEligibility =
  /** Hay identidad NATIVA del proveedor resoluble: la supresión es evaluable. */
  | 'eligible'
  /** Ni identidad de Apollo ni de Lusha resoluble en este candidato. */
  | 'missing_person_identity';

/**
 * Evalúa si la supresión de un candidato PODRÍA consultarse hoy.
 *
 * Espejo EXACTO —por reutilización, no por copia— de lo que hace el servidor:
 *
 *   identidad = resolvePhoneRevealProviderIdentity({ apolloPersonId, source, sourceContactId })
 *   evaluable ⟺ identidad != null
 *
 * La CUENTA ya no aparece en esa equivalencia. Antes de la Fase 1 el botón exigía
 * `accountId` porque el servidor exigía `accountId`; ahora ninguno de los dos lo exige,
 * así que el espejo se mantiene exacto quitándolo de los dos lados a la vez. El
 * parámetro se sigue aceptando y se IGNORA a propósito —ver abajo— para que ningún
 * llamador se rompa en silencio.
 *
 * Consecuencias visibles para el operador:
 *
 *   * candidato Apollo con id nativo de Apollo, SIN cuenta  ⇒ botón habilitado;
 *   * candidato Lusha con `source_contact_id` nativo, SIN cuenta ⇒ botón habilitado;
 *   * candidato sin ninguna de las dos identidades ⇒ botón deshabilitado, con el copy
 *     de #291 intacto.
 */
export function evaluatePhoneRevealIdentityEligibility(input: {
  /** Columna `contact_enrichment_candidates.apollo_person_id` (mig. 098). */
  apolloPersonId?: string | null;
  /** Origen del candidato. Apollo reenvía su `source_contact_id`; Lusha usa el suyo. */
  source?: string | null;
  /** Columna `contact_enrichment_candidates.source_contact_id`. */
  sourceContactId?: string | null;
  /**
   * `contact_enrichment_runs.account_id`. ACEPTADO Y NO USADO desde la Fase 1.
   *
   * Se mantiene en la firma en lugar de borrarse porque quitarlo obligaría a editar cada
   * llamador para no cambiar nada, y porque su presencia documenta el cambio mejor que
   * su ausencia: quien venga de #291 buscando por qué la cuenta ya no bloquea encuentra
   * la respuesta aquí, en el sitio donde la buscaría.
   */
  accountId?: string | null;
}): PhoneRevealIdentityEligibility {
  const identity = resolvePhoneRevealProviderIdentity({
    apolloPersonId: input.apolloPersonId ?? null,
    source: input.source ?? null,
    sourceContactId: input.sourceContactId ?? null,
  });
  return identity ? 'eligible' : 'missing_person_identity';
}

/**
 * Copy mostrado cuando el botón queda deshabilitado. SIN CAMBIOS respecto a #291, y eso
 * es deliberado: sigue sin nombrar proveedor y sigue sin invitar a reintentar, porque la
 * carencia que ahora describe es aún MÁS probablemente permanente que antes. Un
 * candidato al que ni Apollo ni Lusha le dieron identidad no adquiere una por esperar.
 *
 * Lo que sí desapareció es cualquier lectura relacionada con la CUENTA: ya no existe un
 * motivo de bloqueo que hable de cuentas, así que no hay copy que lo mencione.
 */
export const PHONE_REVEAL_IDENTITY_BLOCKED_COPY =
  'SellUp todavía no puede verificar las restricciones de privacidad necesarias para revelar este teléfono.';
