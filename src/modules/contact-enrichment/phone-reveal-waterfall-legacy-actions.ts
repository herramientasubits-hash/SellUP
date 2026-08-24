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
//   2. El core revalida TODO server-side: flag, rol autorizado para revelar
//      teléfono (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: la ruta legacy dejó
//      de ser admin-only y sigue la autoridad canónica del reveal), evidencia legacy
//      persistida, sin teléfono, candidato editable, id Lusha propio, sin corrida
//      activa y con un historial que admita una autorización nueva
//      (AGENT2A-PHONE-WATERFALL-2C: una corrida legacy terminal SIN teléfono es
//      reautorizable; una del flujo completo, o una que ya reveló, no lo es).
//      «Id Lusha propio» dejó de ser la única vía en
//      AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1: también vale una identidad
//      Lusha ya PERSISTIDA (migración 124) y, si no hay ninguna, un identificador
//      exacto con el que comprarla.
//      Cada reautorización revalida TODO otra vez, incluida la supresión/DNC.
//   3. Crea la corrida `legacy_lusha_only` ANTES de cualquier llamada, con el tope de
//      su modalidad REAL: 5 si Lusha ya sabe quién es esta persona, y 6 si además hay
//      que comprar esa identidad — búsqueda hasta 1 + teléfono hasta 5
//      (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). Los 8 de Apollo NUNCA
//      entran: ese gasto lo pagó la autorización histórica, no ésta. El tope que el
//      operador aceptó es un LÍMITE SUPERIOR DURO y se compara ANTES de reservar.
//   4. Continúa con el MISMO core del waterfall: claim atómico, TTL de 24 h,
//      re-comprobación de supresión/DNC fail-closed y UNA sola llamada a Lusha.
//
// Qué NUNCA hace: llamar a Apollo, escribir un usage log de Apollo, inventar
// `apollo_attempted_at` / request id / costo, sumar los costos de las dos patas,
// escribir en HubSpot, aprobar el candidato, actuar en bulk o reintentar
// automáticamente.
//
// El gate de rol NO es de UI: un actor sin permiso de revelar teléfono es rechazado
// aquí, en el servidor, aunque el cliente invoque la acción directamente. La autoridad
// es la canónica del reveal (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1), así que
// `commercial_manager` SÍ puede autorizar esta ruta — y `seller`, `lead` o cualquier
// rol que no pudiera revelar, no.
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
import {
  classifyLegacyPhoneRevealStartFailure,
  LEGACY_START_EXCEPTION_REASON,
} from './phone-reveal-waterfall-legacy-start-gate';
// El tipo se importa SOLO para anotar este archivo y NO se reexporta.
//
// AGENT2A-P342-PROD-CONTACTS-RUNTIME-HOTFIX-1 — aquí vivía
// `export type { LegacyPhoneRevealWaterfallActionStatus };`, y tumbó /contacts en
// Producción con `ReferenceError: LegacyPhoneRevealWaterfallActionStatus is not
// defined`. La causa no es TypeScript —que borra la reexportación de tipo— sino el
// flight loader de Next: para un módulo 'use server' emite
// `ensureServerEntryExports([...])` con los NOMBRES exportados del módulo, y en esa
// lista metió el del tipo, que en tiempo de ejecución no es ninguna ligadura. La
// llamada corre al EVALUAR el módulo, antes que cualquier acción, así que se llevó
// por delante el chunk entero de acciones de la página: los drawers de candidato
// fallaban antes siquiera de cargar el candidato.
//
// La forma CON especificador (`export type { X } from './y'`) sí se borra entera y
// no aparece en el bundle; la que rompe es ésta, la reexportación de una ligadura
// LOCAL. Quien necesite el tipo lo importa del módulo puro
// (`phone-reveal-waterfall-legacy-start-gate.ts`), que es donde se declara.
//
// No conviertas el tipo en enum ni en const para «arreglar» el bundling: eso crearía
// un valor en ejecución dentro de un 'use server', que es justo la violación que
// vigila src/__tests__/use-server-export-contract-p0-r4.test.ts.
import type { LegacyPhoneRevealWaterfallActionStatus } from './phone-reveal-waterfall-legacy-start-gate';

export interface LegacyPhoneRevealWaterfallActionResult {
  status: LegacyPhoneRevealWaterfallActionStatus;
  /** Código mecánico sin PII para diagnóstico. null cuando no aplica. */
  reason: string | null;
  /** Tope que quedó autorizado (5 o 6) o null si no se creó corrida. */
  maxCreditsAuthorized: number | null;
  /**
   * Solo en `authorization_changed`: el tope que la modalidad real exige. Es lo que la
   * UI necesita para volver a pedir la confirmación con la cifra correcta en vez de
   * repetir la obsoleta. `null` en cualquier otro camino.
   */
  requiredMaxCredits: number | null;
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

/**
 * Mapea el desenlace del runtime al status que consume la UI.
 *
 * Recibe el resultado COMPLETO y no solo el `outcome` porque el NO-arranque llega como
 * `not_started` + motivo: la corrida no se creó, así que el runtime no tiene un
 * desenlace propio que los distinga.
 *
 * AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1 — antes, TODOS esos motivos salvo
 * cuatro se colapsaban en `not_eligible`, y la UI los resolvía con una sola frase:
 * «este candidato ya no puede autorizarse por esta vía». Esa frase es una afirmación
 * sobre el CANDIDATO, así que era literalmente falsa para un bloqueo de privacidad,
 * para una corrida ya viva, para el flag apagado, para un rol sin permiso y —el peor
 * caso— para una LECTURA QUE FALLÓ, donde el candidato es perfectamente elegible y lo
 * roto es la infraestructura. Con eso, un rechazo en Producción era indiagnosticable:
 * el desenlace observable era el mismo para causas incompatibles entre sí.
 *
 * La traducción es ahora EXHAUSTIVA y vive en un módulo puro y testeable
 * (`phone-reveal-waterfall-legacy-start-gate.ts`). El `reason` mecánico sigue viajando
 * intacto en el resultado, y ninguna rama nueva expone PII.
 */
function toActionStatus(
  result: Awaited<ReturnType<typeof startLegacyPhoneRevealWaterfallForCandidate>>,
): LegacyPhoneRevealWaterfallActionStatus {
  if (result.outcome === 'not_started') {
    // El arranque LANZÓ: el core nunca llegó a responder, así que no hay ningún motivo
    // del candidato que clasificar. Infraestructura, jamás `not_eligible`.
    // Un `not_started` SIN motivo tampoco es un hecho del candidato: es un desenlace
    // que no sabemos nombrar, y el fail-closed honesto es infraestructura.
    if (
      result.reason === LEGACY_START_EXCEPTION_REASON ||
      result.reason === null
    ) {
      return 'infrastructure_unavailable';
    }
    return classifyLegacyPhoneRevealStartFailure(
      result.reason as Parameters<typeof classifyLegacyPhoneRevealStartFailure>[0],
    );
  }
  switch (result.outcome) {
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
  /**
   * Tope que el operador ACEPTÓ en la UI, tal cual lo calculó el copy
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
   *
   * Ausente o no finito ⇒ el servidor asume el suelo conservador de esta ruta (5),
   * NUNCA la modalidad requerida. Un cliente que no lo manda no puede acabar comprando
   * la búsqueda de identidad por omisión.
   */
  acceptedMaxCredits?: number;
}): Promise<LegacyPhoneRevealWaterfallActionResult> {
  const candidateId =
    typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  if (!candidateId) {
    return {
      status: 'not_eligible',
      reason: 'invalid_candidate',
      maxCreditsAuthorized: null,
      requiredMaxCredits: null,
    };
  }

  const actor = await resolveActorForLegacyWaterfall();

  const result = await startLegacyPhoneRevealWaterfallForCandidate(
    candidateId,
    actor,
    // Sin `options`: ESTA es la ruta legacy automática, no el disparo manual. Su
    // permiso es el flag del waterfall y su pata Lusha es la automática.
    undefined,
    input?.acceptedMaxCredits,
  );

  return {
    status: toActionStatus(result),
    reason: result.reason,
    maxCreditsAuthorized: result.maxCreditsAuthorized,
    requiredMaxCredits: result.requiredMaxCredits,
  };
}
