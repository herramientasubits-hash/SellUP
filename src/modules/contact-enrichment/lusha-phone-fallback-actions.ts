'use server';

// Agente 2A — Lusha Phone Reveal Fallback: Server Action wrapper
// (LUSHA-PHONE-FALLBACK-1 · convergido en AGENT2A-PHONE-REVEAL-4O-F-R2)
//
// QUÉ ES ESTE ARCHIVO DESDE R2
//
// Un ADAPTADOR. Resuelve el actor autenticado, revalida los gates que no dependen de
// la base de datos y delega la operación completa en el MOTOR ECONÓMICO
// `legacy_lusha_only` (legacy-lusha-only-reveal-engine.ts). No cablea deps de
// proveedor, no llama a Lusha y no escribe en el candidato: todo eso ocurre dentro de
// una corrida real con su reserva atómica de créditos.
//
// POR QUÉ CAMBIÓ
//
// Hasta 4O-F este archivo cableaba su PROPIO camino pagado a Lusha, en paralelo al de
// la pata del waterfall. Las dos hacían la misma operación económica, pero sólo una
// tenía contabilidad: la auditoría 4O-F-M0 fijó que este disparo NO tenía gate
// presupuestal (`MANUAL_LUSHA_BUDGET_GATE = UNSAFE`), ni reserva atómica, ni
// single-flight — tres clics concurrentes sobre el mismo candidato pagaban tres veces,
// y la única mitigación era un `useRef` de la UI. R2 elimina esa segunda
// implementación en vez de darle una reserva propia.
//
// QUÉ NO CAMBIÓ (contrato de salida)
//
//   * mismo nombre, mismo input, mismo tipo de resultado, misma naturaleza SÍNCRONA;
//   * sigue siendo manual, admin-only y de UN candidato (el input es escalar);
//   * sigue exigiendo confirmación de costo;
//   * sigue siendo Lusha only — nunca Apollo, nunca HubSpot; no crea contacto oficial
//     ni aprueba el candidato;
//   * sigue gated tras `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`, y con el flag apagado sale
//     antes de resolver el actor y antes de tocar la infraestructura de corridas;
//   * NO requiere `ENABLE_PHONE_REVEAL_WATERFALL`, que sigue apagado en Producción: ese
//     flag gobierna la UX del waterfall Apollo→Lusha, no la existencia de la
//     contabilidad. La UI no cambia y no aparece ningún polling, modal ni drawer nuevo.
//
// El resultado sigue siendo PII-free: nunca devuelve el teléfono, la identidad, el id
// de contacto de Lusha ni el id de la corrida. En éxito la UI recarga el candidato.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isLushaPhoneRevealFallbackEnabled } from '@/lib/feature-flags.server';
import {
  LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
  type LushaPhoneFallbackActionInput,
  type LushaPhoneFallbackActionResult,
  type LushaPhoneFallbackActionStatus,
} from './lusha-phone-fallback-core';
import { executeLegacyLushaOnlyPhoneReveal } from './legacy-lusha-only-reveal-engine';
import type { StartLegacyPhoneRevealWaterfallRuntimeResult } from './phone-reveal-waterfall-deps';

// ── Auth + rol del actor ──────────────────────────────────────

/**
 * Resuelve el usuario interno activo y su role key. Redirige a /login si no
 * hay usuario. Espejo de resolveActorForReveal en phone-reveal-actions.ts.
 */
async function resolveActorForLushaFallback(): Promise<{
  internalUserId: string;
  roleKey: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');

  let roleKey: string | null = null;
  if (internalUser.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', internalUser.role_id)
      .single();
    roleKey = typeof role?.key === 'string' ? role.key : null;
  }

  return { internalUserId: internalUser.id, roleKey };
}

// ── Adaptación del desenlace del motor al contrato de la acción ──

/**
 * Motivos del arranque que NO se creó, traducidos al vocabulario que esta acción ya
 * publicaba. Declarado como TABLA y no como cadena de `if`s para que la
 * correspondencia sea legible y comprobable de un vistazo.
 *
 * Dos traducciones merecen justificación:
 *
 *   * `role_not_allowed` → `unauthorized_role`: el mismo hecho, con el nombre que esta
 *     acción ya usaba. El gate es del servidor, no de la UI.
 *   * `apollo_evidence_missing` y `apollo_outcome_not_closed` → `apollo_not_exhausted`:
 *     los tres significan «el intento previo de Apollo no está demostrado como
 *     terminado sin teléfono», que es el único código que esta acción tenía para ese
 *     hecho. Colapsarlos NO oculta un problema de saldo ni de infraestructura, que sí
 *     tienen su propio código.
 *
 * `active_run_exists` y `create_conflict` → `already_attempted`: son las DOS caras del
 * single-flight. La primera la ve quien llega cuando ya hay exposición viva; la segunda,
 * quien pierde la carrera dentro de la propia transacción. Ninguna llamó al proveedor.
 */
const NOT_STARTED_STATUS_BY_REASON: Readonly<
  Record<string, LushaPhoneFallbackActionStatus>
> = {
  feature_disabled: 'feature_disabled',
  role_not_allowed: 'unauthorized_role',
  invalid_candidate: 'invalid_candidate',
  candidate_not_found: 'candidate_not_found',

  // Elegibilidad sobre la evidencia persistida.
  apollo_not_exhausted: 'apollo_not_exhausted',
  apollo_evidence_missing: 'apollo_not_exhausted',
  apollo_outcome_not_closed: 'apollo_not_exhausted',
  existing_phone_present: 'existing_phone_present',
  candidate_not_editable: 'candidate_not_editable',
  missing_lusha_contact_id: 'missing_lusha_contact_id',
  incompatible_historical_run: 'apollo_not_exhausted',
  previous_run_revealed_phone: 'existing_phone_present',

  // Privacidad, evaluada ANTES de reservar: 0 corridas, 0 reservas, 0 créditos.
  blocked_suppressed: 'blocked_suppressed',
  do_not_contact: 'do_not_contact',
  suppression_check_unavailable: 'suppression_check_unavailable',

  // Presupuesto e infraestructura: 0 llamadas al proveedor.
  insufficient_credits: 'insufficient_credits',
  budget_not_configured: 'budget_not_configured',
  credit_balance_unavailable: 'credit_balance_unavailable',
  run_creation_unavailable: 'infrastructure_unavailable',
  legacy_run_creation_failed: 'infrastructure_unavailable',

  // Single-flight.
  active_run_exists: 'already_attempted',
  create_conflict: 'already_attempted',
};

/**
 * Motivos con los que la corrida se cerró SIN llegar a Lusha. Son los que escribe
 * `resolvePhoneRevealWaterfallSuppressionBlock`, y se traducen al mismo vocabulario de
 * privacidad que esta acción ya publicaba.
 */
const CLOSED_WITHOUT_LUSHA_STATUS_BY_REASON: Readonly<
  Record<string, LushaPhoneFallbackActionStatus>
> = {
  suppressed: 'blocked_suppressed',
  blocked_suppressed: 'blocked_suppressed',
  dnc: 'do_not_contact',
  do_not_contact: 'do_not_contact',
  suppression_check_unavailable: 'suppression_check_unavailable',
};

/**
 * Traduce el desenlace del motor al resultado que el llamador de esta acción ya
 * esperaba. Fail-closed por diseño: un desenlace o motivo DESCONOCIDO cae en `error`
 * —nunca en `revealed`— así que un valor nuevo del motor no puede presentarse como
 * éxito ante la UI.
 */
function toLushaFallbackActionResult(
  runtime: StartLegacyPhoneRevealWaterfallRuntimeResult,
): LushaPhoneFallbackActionResult {
  const reason = runtime.reason ?? '';

  switch (runtime.outcome) {
    case 'lusha_revealed':
      return { ok: true, status: 'revealed', errorCode: null };

    case 'lusha_no_phone_found':
      return { ok: true, status: 'no_phone_found', errorCode: null };

    case 'lusha_claim_lost':
      // Otro disparador ya había tomado la pata de ESTA corrida. No se pagó dos veces.
      return { ok: false, status: 'already_attempted', errorCode: null };

    case 'closed_without_lusha': {
      const status = CLOSED_WITHOUT_LUSHA_STATUS_BY_REASON[reason];
      return status
        ? { ok: false, status, errorCode: status }
        : { ok: false, status: 'error', errorCode: reason || null };
    }

    case 'not_started': {
      const status = NOT_STARTED_STATUS_BY_REASON[reason];
      return status
        ? {
            ok: false,
            status,
            // Los códigos de privacidad viajan también como errorCode, igual que antes.
            errorCode:
              status === 'blocked_suppressed' ||
              status === 'do_not_contact' ||
              status === 'suppression_check_unavailable'
                ? status
                : null,
          }
        : { ok: false, status: 'error', errorCode: reason || null };
    }

    case 'lusha_error':
      return { ok: false, status: 'error', errorCode: reason || null };

    // `noop` cubre los casos en los que la corrida se creó pero la continuación no
    // encontró nada que gastar. No es éxito.
    case 'noop':
    default:
      return { ok: false, status: 'error', errorCode: reason || null };
  }
}

// ── Server Action ──────────────────────────────────────────────

/**
 * Revela el teléfono de UN candidato con Lusha (manual, admin-only, un solo
 * candidato, sólo después de que el reveal de Apollo devolviera `no_phone_found`).
 *
 * SÍNCRONA: `/v3/contacts/enrich` responde en la misma petición — sin webhook, sin
 * estado en vuelo y sin polling. Desde R2 la operación queda además representada de
 * forma duradera como una corrida `legacy_lusha_only` con su reserva de créditos, lo
 * que le da tres garantías que antes no tenía: presupuesto agotado ⇒ 0 llamadas;
 * invocaciones concurrentes sobre el mismo candidato ⇒ UNA sola operación pagada; y el
 * usage-log comparte identidad de corrida con la reserva confirmada, así que una
 * llamada de 5 créditos consume 5 y no 10.
 *
 * Nunca devuelve el teléfono, credenciales ni el id de contacto de Lusha: el número se
 * persiste server-side y la UI recarga el candidato para mostrarlo.
 */
export async function revealCandidatePhoneViaLushaFallbackAction(
  input: LushaPhoneFallbackActionInput,
): Promise<LushaPhoneFallbackActionResult> {
  // 1. Flag OFF ⇒ nada más corre: ni actor, ni candidato, ni infraestructura.
  if (!isLushaPhoneRevealFallbackEnabled()) {
    return { ok: false, status: 'feature_disabled', errorCode: null };
  }

  // 2. Un candidato, escalar. No hay forma de pedir un lote.
  const candidateId =
    typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  if (!candidateId) {
    return { ok: false, status: 'invalid_candidate', errorCode: null };
  }

  // 3. Confirmación de costo, revalidada en el SERVIDOR. Este gate vivía dentro del
  //    core del fallback; converger no lo elimina, lo adelanta — y sigue siendo el
  //    servidor quien lo aplica, así que una invocación directa sin confirmar se
  //    rechaza igual que antes, sin llegar a la infraestructura de corridas.
  const acceptedMax =
    typeof input?.expectedMaxCredits === 'number' &&
    Number.isFinite(input.expectedMaxCredits)
      ? input.expectedMaxCredits
      : LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS;
  if (
    input?.confirmCost !== true ||
    acceptedMax < LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS
  ) {
    return { ok: false, status: 'missing_cost_confirmation', errorCode: null };
  }

  // 4. Actor autenticado. El rol se revalida en el motor (admin-only), no aquí.
  const actor = await resolveActorForLushaFallback();

  // 5. Motor económico único. Todo lo caro —presupuesto, reserva atómica, corrida,
  //    privacidad, proveedor, persistencia multi-teléfono y liquidación— vive ahí.
  const runtime = await executeLegacyLushaOnlyPhoneReveal({ candidateId, actor });

  return toLushaFallbackActionResult(runtime);
}
