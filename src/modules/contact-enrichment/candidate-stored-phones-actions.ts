'use server';

// Agente 2A — «Ver más números»: las dos acciones de LECTURA
// (AGENT2A-PHONE-REVEAL-4O-G)
//
// ── EL CONTRATO DE ESTE ARCHIVO ────────────────────────────────
//
// Un clic en «Ver más números» produce, de forma verificable:
//
//   0 llamadas a Apollo · 0 llamadas a Lusha · 0 corridas de reveal
//   0 reservas de crédito · 0 usage logs · 0 créditos
//   0 escrituras en el candidato · 0 escrituras en el contacto
//
// Esto no es una promesa del comentario: este archivo no importa el cliente de
// Apollo, ni el de Lusha, ni el motor del waterfall, ni el reservador de créditos,
// ni el logger de uso de proveedor, y un test estático falla si alguna de esas
// importaciones aparece. La cadena entera —acción, lectura, núcleo— sólo hace
// `SELECT`.
//
// ── POR QUÉ «ACCIÓN» Y NO OTRA COSA ────────────────────────────
//
// El drawer es un componente cliente que ya lee así (`getPendingContactCandidateById`,
// `getPhoneRevealWaterfallAuditAction`). Introducir aquí una ruta API o un loader
// nuevo sería un segundo patrón de lectura para la misma pantalla. Los nombres
// dicen lo que hacen —`get…`— y ninguna de las dos funciones muta nada.
//
// ── AUTORIZACIÓN ───────────────────────────────────────────────
//
// Mismo control que el resto del subsistema: sesión válida, usuario interno
// activo, rol `admin`. Es un gate de SERVIDOR. Que el botón no se pinte no es la
// protección — la protección es que estas dos funciones no devuelven nada a quien
// no está autorizado, aunque las invoque directamente con un UUID en la mano. No
// existe ninguna ruta pública que consulte teléfonos por id.
//
// ── FLAGS ──────────────────────────────────────────────────────
//
// A propósito NO se consulta `ENABLE_PHONE_REVEAL_WATERFALL` ni
// `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`. Esos flags gobiernan si SellUp puede
// GASTAR con un proveedor; aquí no se gasta. Un número que la operación ya pagó y
// ya guardó no puede volverse invisible porque el proveedor que lo trajo esté hoy
// apagado: la disponibilidad operativa de un proveedor y la visibilidad de un dato
// almacenado son cosas distintas, y atarlas escondería datos por los que ya se
// pagó.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// Los teléfonos son PII y viajan sólo cuando el operador los pide: el resumen
// (`…Summary…`) devuelve UN entero y ningún número, y la lista completa sólo se
// construye cuando el disclosure se abre. Nada se registra en logs: los `catch`
// imprimen el código de la operación y el mensaje del error, nunca la fila.
// El tombstone se obedece aguas abajo y no se expone en ninguna forma.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  countAdditionalStoredPhones,
  selectAdditionalStoredPhones,
  type StoredCandidatePhoneView,
} from './candidate-stored-phones-core';
import { readCandidateStoredPhones } from './candidate-stored-phones-read';

/**
 * Roles que pueden ver los teléfonos almacenados de un candidato.
 *
 * Es la MISMA lista que gobierna la revisión del candidato y la auditoría del
 * waterfall (`['admin']`). Se declara aquí, y no se importa de
 * `phone-reveal-waterfall-core.ts`, para que el permiso de LEER no quede
 * encadenado a un módulo cuyo asunto es GASTAR: si mañana se ensancha quién puede
 * lanzar un waterfall, eso no debe ensanchar por accidente quién puede ver
 * números guardados. Un test estático fija que ambas listas coincidan hoy.
 */
export const CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS: readonly string[] = ['admin'];

/**
 * Resultado de pedir la lista. Se distingue `unavailable` de una lista vacía
 * porque son hechos distintos: «no hay más números» es una respuesta, y «no
 * pudimos leerlos» es un fallo. Colapsarlos haría que un error de base se
 * presentara al operador como la afirmación de que el candidato no tiene más
 * teléfonos — y esa afirmación sería falsa.
 *
 * Ninguno de los dos desenlaces habilita jamás una llamada a proveedor: un fallo
 * de LECTURA no es una razón para ir a BUSCAR.
 */
export type StoredCandidatePhonesResult =
  | { readonly status: 'ok'; readonly phones: readonly StoredCandidatePhoneView[] }
  | { readonly status: 'unavailable' };

/** Sesión + usuario interno activo + role key. Espejo del resto del subsistema. */
async function resolveActorRoleKey(): Promise<string | null> {
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
  if (!internalUser.role_id) return null;

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();
  return typeof role?.key === 'string' ? role.key : null;
}

function isAuthorized(roleKey: string | null): boolean {
  return (
    typeof roleKey === 'string' &&
    CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS.includes(roleKey.trim())
  );
}

function cleanCandidateId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * CUÁNTOS números adicionales tiene el candidato. Cero números en la respuesta:
 * esto es lo que decide si el CTA existe, y para eso basta un entero.
 *
 * Devuelve `0` —no un error— cuando el candidato no existe, cuando el rol no está
 * autorizado o cuando la lectura falla. Fail-closed hacia «no ofrecer el CTA»: la
 * consecuencia de equivocarse por defecto es que el operador no ve un botón; la de
 * equivocarse al revés es ofrecerle abrir algo que no se va a poder abrir.
 */
export async function getCandidateStoredPhoneSummaryAction(input: {
  candidateId: string;
}): Promise<{ additionalCount: number }> {
  const candidateId = cleanCandidateId(input?.candidateId);
  if (!candidateId) return { additionalCount: 0 };

  if (!isAuthorized(await resolveActorRoleKey())) return { additionalCount: 0 };

  try {
    const read = await readCandidateStoredPhones(candidateId);
    return { additionalCount: countAdditionalStoredPhones(read) };
  } catch (err) {
    console.error(
      '[candidate-stored-phones] summary read failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { additionalCount: 0 };
  }
}

/**
 * La lista de números adicionales, ya ordenada y ya proyectada a lo que la UI
 * puede mostrar. Se invoca cuando el operador abre el disclosure, no antes.
 *
 * Una lista vacía es un desenlace legítimo y esperado: entre el render que pintó
 * el CTA y el clic pueden haber desaparecido los extras (una DSAR que tombstonea
 * el número es exactamente ese caso). La UI lo dice con un estado vacío, y no con
 * un error.
 */
export async function getCandidateStoredPhonesAction(input: {
  candidateId: string;
}): Promise<StoredCandidatePhonesResult> {
  const candidateId = cleanCandidateId(input?.candidateId);
  if (!candidateId) return { status: 'ok', phones: [] };

  if (!isAuthorized(await resolveActorRoleKey())) return { status: 'unavailable' };

  try {
    const read = await readCandidateStoredPhones(candidateId);
    return { status: 'ok', phones: selectAdditionalStoredPhones(read) };
  } catch (err) {
    console.error(
      '[candidate-stored-phones] collection read failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { status: 'unavailable' };
  }
}
