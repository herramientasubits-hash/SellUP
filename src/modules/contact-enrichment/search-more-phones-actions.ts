'use server';

// Agente 2A — «Buscar más números»: las DOS server actions
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// ═══════════════════════════════════════════════════════════════════
// DOS ACCIONES, Y LA FRONTERA ENTRE ELLAS
// ═══════════════════════════════════════════════════════════════════
//
//   * `getSearchMorePhonesPreflightAction` — LECTURA. Dice si el CTA existe, con qué copy y
//     con qué techo. 0 llamadas a proveedor, 0 corridas, 0 reservas, 0 créditos, 0
//     escrituras. La UI la invoca al abrir el candidato y DESPUÉS de cada corrida terminal;
//     el sondeo la invoca en bucle, y por eso «sondear no gasta» tiene que ser una propiedad
//     de este archivo y no una intención.
//
//   * `searchMoreCandidatePhonesAction` — LA COMPRA. Sólo se invoca tras la confirmación
//     explícita del operador. Puede gastar hasta 5 créditos de Lusha.
//
// La lectura NO es un atajo de la compra: la compra vuelve a leer todo por su cuenta
// (`executeSearchMorePhonesForCandidate` recarga el preflight y recomputa el plan) y no
// confía en nada que el navegador le pase.
//
// ═══════════════════════════════════════════════════════════════════
// LO QUE EL CLIENTE NO PUEDE DECIDIR
// ═══════════════════════════════════════════════════════════════════
//
// La entrada de la compra es EXACTAMENTE `{ candidateId: string }`. No hay parámetro de
// proveedor, ni de techo de crédito, ni de id nativo, ni de estado de privacidad — así que no
// existe la forma de enviarlos. Los cuatro los DERIVA el servidor:
//
//   * proveedor  — `SEARCH_MORE_PROVIDER`, que es `'lusha'` y sólo `'lusha'`;
//   * techo      — `SEARCH_MORE_MAX_CREDITS` (5), la misma constante que reserva la pata;
//   * id nativo  — releído de la fila del candidato dentro del runtime;
//   * privacidad — resuelta por la puerta real, dos veces, y otra vez bajo el lock de la 122.
//
// Un tipo de entrada más ancho sería el defecto: el gate de rol de servidor impide que un no
// admin gaste, pero no impediría que un admin —o un script con su sesión— pidiera un techo de
// 50. La forma del argumento es la primera defensa, y aquí es una sola cadena.
//
// ═══════════════════════════════════════════════════════════════════
// AUTORIZACIÓN
// ═══════════════════════════════════════════════════════════════════
//
// Sesión válida, usuario interno ACTIVO, y el rol que el planificador exige (`admin`). Es un
// gate de SERVIDOR: que el botón no se pinte no es la protección — la protección es que estas
// funciones no hacen nada para quien no está autorizado, aunque las invoque directamente con
// un UUID en la mano.
//
// PRIVACIDAD: el resultado es PII-MINIMIZADO. Nunca devuelve el teléfono, el id nativo de
// Lusha, el id de la corrida ni el de la reserva. En éxito devuelve CUÁNTOS números
// adicionales se añadieron, y la UI recarga el resumen —que es quien muestra los números.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isLushaPhoneRevealFallbackEnabled } from '@/lib/feature-flags.server';
import { readSearchMorePreflight } from './search-more-phones-read';
import type { SearchMorePreflightSummary } from './search-more-phones-read';
import { executeSearchMorePhonesForCandidate } from './search-more-phones-runtime';
import type { SearchMoreRuntimeOutcome } from './search-more-phones-runtime';
import type { PhoneRevealWaterfallLushaOutcome } from './phone-reveal-waterfall-core';

/**
 * Lo que la UI recibe del preflight. `unavailable` NO es lo mismo que «no elegible»: el
 * primero dice que SellUp no pudo mirar, el segundo que miró y la respuesta es no. Colapsarlos
 * haría que un fallo de lectura se presentara como un veredicto sobre el candidato.
 *
 * Los dos deshabilitan el CTA. Ninguno habilita jamás una llamada a proveedor: un fallo de
 * LECTURA no es una razón para ir a BUSCAR.
 */
export type SearchMorePreflightActionResult =
  | { readonly status: 'ok'; readonly summary: SearchMorePreflightSummary }
  | { readonly status: 'unavailable' };

/** Desenlace de la COMPRA tal como lo consume la UI. */
export interface SearchMorePhonesActionResult {
  readonly outcome: SearchMoreRuntimeOutcome;
  /** Código mecánico PII-free para diagnóstico. `null` en los caminos correctos. */
  readonly reason: string | null;
  /** Números ADICIONALES añadidos. 0 en todo lo que no sea éxito. */
  readonly newDistinctPhoneCount: number;
  /**
   * El desenlace que quedó en `lusha_outcome`. `null` si la pata nunca se intentó.
   *
   * Es lo ÚNICO que separa los dos casos de «0 números nuevos», y por eso cruza al
   * navegador: `no_phone_found` significa que Lusha no tiene teléfono para esa persona, y
   * `no_new_distinct_phone` que lo tiene, se le cobró, y ya estaba guardado. Decir el
   * primero cuando ocurrió el segundo sería afirmar algo falso sobre el contacto.
   *
   * PII-free: un valor de un vocabulario cerrado de cuatro cadenas.
   */
  readonly lushaOutcome: PhoneRevealWaterfallLushaOutcome | null;
  /** Tope que quedó autorizado (5), o `null` si no se creó corrida. */
  readonly maxCreditsAuthorized: number | null;
}

/**
 * Sesión + usuario interno activo + role key. Espejo EXACTO de
 * `resolveActorForLegacyWaterfall` y de `resolveActorRoleKey`: sin usuario redirige a
 * `/login`, y un actor sin rol conocido llega como `null` y queda no autorizado por el
 * planificador.
 */
async function resolveActorForSearchMore(): Promise<{
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

function cleanCandidateId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * ¿Puede este candidato buscar números adicionales, y a qué costo máximo?
 *
 * ── CONTRATO DE CERO GASTO ─────────────────────────────────────
 *
 * Un clic en el CTA no llega aquí; esto es lo que decide si el CTA EXISTE. Y es también lo
 * que el sondeo llama en bucle mientras una corrida está viva, así que su contrato es:
 *
 *   0 llamadas a Lusha · 0 llamadas a Apollo · 0 corridas · 0 reservas
 *   0 usage logs · 0 créditos · 0 escrituras de ningún tipo
 *
 * No es una promesa del comentario: la cadena entera —esta acción y
 * `readSearchMorePreflight`— sólo hace `SELECT`, no importa ningún cliente de proveedor y no
 * importa el reservador de créditos. Un test estático falla si alguna de esas importaciones
 * aparece.
 *
 * `unavailable` ante cualquier fallo. Fail-closed hacia «no ofrecer el CTA»: equivocarse por
 * defecto significa que el operador no ve un botón; equivocarse al revés significa ofrecerle
 * una compra que el servidor va a rechazar.
 */
export async function getSearchMorePhonesPreflightAction(input: {
  candidateId: string;
}): Promise<SearchMorePreflightActionResult> {
  const candidateId = cleanCandidateId(input?.candidateId);
  if (!candidateId) return { status: 'unavailable' };

  const actor = await resolveActorForSearchMore();

  try {
    const preflight = await readSearchMorePreflight({
      candidateId,
      // El permiso de PRODUCTO es el del fallback de Lusha —el kill switch real de cualquier
      // reveal de Lusha— y NO `ENABLE_PHONE_REVEAL_WATERFALL`, que gobierna la UX del
      // waterfall Apollo→Lusha. Misma distinción que fijó 4O-F-R2. Se resuelve aquí, en el
      // mismo sitio que lo resolverá la compra, para que el botón y el servidor no puedan
      // discrepar sobre si la función existe.
      featureEnabled: isLushaPhoneRevealFallbackEnabled(),
      actorRoleKey: actor.roleKey,
    });
    return { status: 'ok', summary: preflight.summary };
  } catch (err) {
    console.error(
      '[search-more-phones] preflight action failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { status: 'unavailable' };
  }
}

/**
 * AUTORIZA Y EJECUTA la búsqueda de números adicionales. UN candidato por invocación — la
 * entrada es escalar, así que no hay forma de pedir un lote.
 *
 * Sólo debe invocarse DESPUÉS de la confirmación explícita del operador. El primer clic del
 * CTA no llega aquí: abre el modal, que es gratis.
 *
 * Puede gastar hasta 5 créditos de LUSHA, y sólo si todos los gates pasan. Nunca gasta
 * créditos de Apollo. Todo lo que decide el gasto —plan, presupuesto, reserva, privacidad,
 * claim— lo recomputa el runtime sobre estado recargado; esta función sólo autentica y
 * delega.
 */
export async function searchMoreCandidatePhonesAction(input: {
  candidateId: string;
}): Promise<SearchMorePhonesActionResult> {
  const candidateId = cleanCandidateId(input?.candidateId);
  if (!candidateId) {
    return {
      outcome: 'not_started',
      reason: 'invalid_candidate',
      newDistinctPhoneCount: 0,
      lushaOutcome: null,
      maxCreditsAuthorized: null,
    };
  }

  const actor = await resolveActorForSearchMore();

  const result = await executeSearchMorePhonesForCandidate({ candidateId, actor });

  return {
    outcome: result.outcome,
    reason: result.reason,
    newDistinctPhoneCount: result.newDistinctPhoneCount,
    lushaOutcome: result.lushaOutcome,
    maxCreditsAuthorized: result.maxCreditsAuthorized,
  };
}
