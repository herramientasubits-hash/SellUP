'use server';

// Agente 2A — Waterfall legacy (solo pata Lusha): Server Action de ESCRITURA
// (AGENT2A-PHONE-WATERFALL-2)
//
// Autoriza la pata Lusha para un candidato cuyo intento Apollo YA ocurrió y YA
// terminó `no_phone_found` ANTES de que existiera `phone_reveal_waterfall_runs`.
// Sin esta ruta, activar ENABLE_PHONE_REVEAL_WATERFALL dejaría a esos candidatos sin
// ninguna vía: el botón manual separado de Lusha desaparece con el flag encendido y
// el botón de reveal Apollo no se ofrece sobre un candidato ya `no_phone_found`.
//
// Vive en su PROPIO archivo y no en phone-reveal-waterfall-actions.ts porque ese
// módulo está documentado como de SOLO LECTURA (lee la auditoría de la corrida y no
// escribe nada). Mezclar una acción que crea corridas y puede gastar créditos
// rompería ese contrato justo donde alguien lo lee para confiar en él.
//
// Qué hace, en este orden:
//   1. Autentica y resuelve el rol del actor (redirige a /login sin usuario).
//   2. El core revalida TODO server-side: flag, rol admin, evidencia legacy
//      persistida, sin teléfono, candidato editable, id Lusha propio, sin corrida
//      activa y con un historial que admita una autorización nueva
//      (AGENT2A-PHONE-WATERFALL-2C: una corrida legacy terminal SIN teléfono es
//      reautorizable; una del flujo completo, o una que ya reveló, no lo es).
//      Cada reautorización revalida TODO otra vez, incluida la supresión/DNC.
//   3. Crea la corrida `legacy_lusha_only` (tope 5) ANTES de cualquier llamada.
//   4. Continúa con el MISMO core del waterfall: claim atómico, TTL de 24 h,
//      re-comprobación de supresión/DNC fail-closed y UNA sola llamada a Lusha.
//
// Qué NUNCA hace: llamar a Apollo, escribir un usage log de Apollo, inventar
// `apollo_attempted_at` / request id / costo, sumar los costos de las dos patas,
// escribir en HubSpot, aprobar el candidato, actuar en bulk o reintentar
// automáticamente.
//
// El gate de rol NO es de UI: `commercial_manager` (y cualquier rol no admin) es
// rechazado aquí, en el servidor, aunque el cliente invoque la acción directamente.
//
// Gated behind ENABLE_PHONE_REVEAL_WATERFALL: con el flag apagado el core sale en el
// primer gate sin leer el candidato, sin escribir y sin llamar a ningún proveedor.
//
// NOTA (2026-08-04, AGENT2A-PHONE-REVEAL-UI-STATE-1): antes se describía la variable
// como «AUSENTE en todos los entornos». Está registrada en Production y su valor es
// ilegible (`Encrypted`), así que la ausencia ya NO puede darse por supuesta — el
// candado efectivo es el gate de flag + rol de este archivo, no la inexistencia de la
// variable. Verificar el estado real en runtime con
// GET /api/debug/agent2a-phone-waterfall-config.
//
// El resultado es PII-free: nunca devuelve el teléfono, la identidad, el id de la
// corrida ni ningún id de proveedor. En éxito la UI recarga el candidato, que es
// quien muestra el número.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { startLegacyPhoneRevealWaterfallForCandidate } from './phone-reveal-waterfall-deps';

/**
 * Desenlace que ve la UI. Códigos mecánicos: la traducción a copy vive en
 * phone-reveal-waterfall-copy.ts.
 */
export type LegacyPhoneRevealWaterfallActionStatus =
  /** Lusha entregó el teléfono. La UI recarga el candidato. */
  | 'revealed'
  /** Lusha corrió y no encontró teléfono. El candidato NO se modifica. */
  | 'no_phone_found'
  /** Lusha corrió y falló técnicamente. No significa "no existe teléfono". */
  | 'error'
  /** Se cerró SIN llamar a Lusha (supresión, DNC, verificación no disponible…). */
  | 'closed_without_lusha'
  /** Otro disparador ya había tomado la pata en esta corrida. */
  | 'already_attempted'
  /** El candidato no entra en la ruta legacy (o el flag/rol no lo permiten). */
  | 'not_eligible';

export interface LegacyPhoneRevealWaterfallActionResult {
  status: LegacyPhoneRevealWaterfallActionStatus;
  /** Código mecánico sin PII para diagnóstico. null cuando no aplica. */
  reason: string | null;
  /** Tope que quedó autorizado (5) o null si no se creó corrida. */
  maxCreditsAuthorized: number | null;
}

/**
 * Resuelve el usuario interno activo y su role key. Espejo de
 * `resolveActorForReveal` en phone-reveal-actions.ts: sin usuario redirige a /login,
 * y un actor sin rol conocido llega al core como `null` y queda no autorizado.
 */
async function resolveActorForLegacyWaterfall(): Promise<{
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

/** Mapea el desenlace del runtime al status que consume la UI. */
function toActionStatus(
  outcome: Awaited<
    ReturnType<typeof startLegacyPhoneRevealWaterfallForCandidate>
  >['outcome'],
): LegacyPhoneRevealWaterfallActionStatus {
  switch (outcome) {
    case 'lusha_revealed':
      return 'revealed';
    case 'lusha_no_phone_found':
      return 'no_phone_found';
    case 'lusha_error':
      return 'error';
    case 'lusha_claim_lost':
      return 'already_attempted';
    case 'closed_without_lusha':
      return 'closed_without_lusha';
    case 'not_started':
      return 'not_eligible';
    // `noop` cubre los casos en los que la corrida se creó pero la continuación no
    // encontró nada que gastar (flag del fallback apagado en el intervalo, corrida ya
    // terminal…). Se reporta como cierre sin Lusha, no como éxito.
    case 'noop':
    default:
      return 'closed_without_lusha';
  }
}

/**
 * Autoriza y ejecuta la pata Lusha para un candidato legacy. UN candidato por
 * invocación — el input es escalar, así que no hay forma de pedir un lote.
 *
 * Puede gastar hasta 5 créditos de Lusha, y solo si TODOS los gates pasan. Nunca
 * gasta créditos de Apollo.
 */
export async function startLegacyPhoneRevealWaterfallAction(input: {
  candidateId: string;
}): Promise<LegacyPhoneRevealWaterfallActionResult> {
  const candidateId =
    typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  if (!candidateId) {
    return {
      status: 'not_eligible',
      reason: 'invalid_candidate',
      maxCreditsAuthorized: null,
    };
  }

  const actor = await resolveActorForLegacyWaterfall();

  const result = await startLegacyPhoneRevealWaterfallForCandidate(
    candidateId,
    actor,
  );

  return {
    status: toActionStatus(result.outcome),
    reason: result.reason,
    maxCreditsAuthorized: result.maxCreditsAuthorized,
  };
}
