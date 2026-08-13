'use server';

// Agente 2A — «Ver más números» del contacto OFICIAL: las dos acciones de LECTURA
// (AGENT2A-PHONE-REVEAL-4O-H4)
//
// ── EL CONTRATO DE ESTE ARCHIVO ────────────────────────────────
//
// Un clic en «Ver más números» produce, de forma verificable:
//
//   0 llamadas a Apollo · 0 llamadas a Lusha · 0 corridas de reveal
//   0 reservas de crédito · 0 usage logs · 0 créditos
//   0 escrituras en el contacto · 0 escrituras en el candidato · 0 HubSpot
//   0 migraciones · 0 RPC
//
// Esto no es una promesa del comentario: este archivo no importa el cliente de
// Apollo, ni el de Lusha, ni el motor del waterfall, ni el reservador de créditos,
// ni el logger de uso de proveedor, ni la aprobación, ni el merge a contacto
// existente, ni la RPC de privacidad; y un test estático falla si alguna de esas
// importaciones aparece. La cadena entera —acción, lectura, núcleo— sólo hace
// `SELECT`.
//
// ── POR QUÉ «ACCIÓN» Y NO OTRA COSA ────────────────────────────
//
// La ficha del contacto es un componente cliente que ya lee así (`getContactById`,
// `getContactAudit`, `getAccountById`). Introducir aquí una ruta API o un loader
// nuevo sería un segundo patrón de lectura para la misma pantalla. Los nombres
// dicen lo que hacen —`get…`— y ninguna de las dos funciones muta nada.
//
// ── AUTORIZACIÓN: POR QUÉ **NO** ES `admin` ────────────────────
//
// 4O-G exigió rol `admin` porque la colección del CANDIDATO vive en la bandeja de
// revisión, que es una superficie de administración, y porque la 109 la dejó
// accesible sólo a `service_role`.
//
// Aquí la respuesta correcta es otra, y conviene que esté escrita para que nadie la
// «endurezca» por instinto. La ficha del contacto ya muestra `contacts.phone` y el
// escalar heredado de móvil a CUALQUIER usuario interno activo. Los números que
// esta acción devuelve son de la MISMA persona y de la misma naturaleza; son
// «adicionales» sólo en el sentido de que no caben en un escalar. Pedir `admin`
// para ellos escondería, en la misma pantalla y a la misma persona, una parte
// arbitraria de un dato que ya está viendo — y lo haría sin ganar nada, porque la
// 114 concede `SELECT` a `authenticated` bajo `has_active_access(auth.uid())`.
//
// El control es de SERVIDOR y es DOBLE:
//
//   1. esta acción exige sesión válida y usuario interno ACTIVO; y
//   2. la lectura usa el cliente de SESIÓN, así que las policies de la 114 se
//      evalúan dentro de PostgreSQL sobre cada fila.
//
// Que el botón no se pinte no es la protección. La protección es que estas dos
// funciones no devuelven nada a quien no está autorizado, aunque las invoque
// directamente con un UUID en la mano. No existe ninguna ruta pública que consulte
// teléfonos por id.
//
// ── FLAGS ──────────────────────────────────────────────────────
//
// A propósito NO se consulta `ENABLE_PHONE_REVEAL_WATERFALL` ni
// `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` ni `ENABLE_APOLLO_PHONE_REVEAL`. Esos flags
// gobiernan si SellUp puede GASTAR con un proveedor; aquí no se gasta. Un número
// que la operación ya pagó y ya guardó no puede volverse invisible porque el
// proveedor que lo trajo esté hoy apagado: la disponibilidad operativa de un
// proveedor y la visibilidad de un dato almacenado son cosas distintas, y atarlas
// escondería datos por los que ya se pagó.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// Los teléfonos son PII y viajan sólo cuando el operador los pide: el resumen
// (`…Summary…`) devuelve UN entero y ningún número, y la lista completa sólo se
// construye cuando el disclosure se abre. Nada se registra en logs: los `catch`
// imprimen el código de la operación y el mensaje del error, nunca la fila.
// El tombstone —de número y de procedencia— se obedece aguas abajo y no se expone
// en ninguna forma.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  countAdditionalStoredOfficialPhones,
  selectAdditionalStoredOfficialPhones,
  type StoredOfficialPhoneView,
} from './official-contact-stored-phones-core';
import { readOfficialContactStoredPhones } from './official-contact-stored-phones-read';

/**
 * Resultado de pedir la lista. Se distingue `unavailable` de una lista vacía porque
 * son hechos distintos: «no hay más números» es una respuesta, y «no pudimos
 * leerlos» es un fallo. Colapsarlos haría que un error de base se presentara al
 * operador como la afirmación de que el contacto no tiene más teléfonos — y esa
 * afirmación sería falsa.
 *
 * Ninguno de los dos desenlaces habilita jamás una llamada a proveedor: un fallo de
 * LECTURA no es una razón para ir a BUSCAR.
 */
export type StoredOfficialPhonesResult =
  | { readonly status: 'ok'; readonly phones: readonly StoredOfficialPhoneView[] }
  | { readonly status: 'unavailable' };

/**
 * Sesión + usuario interno ACTIVO. Es el mismo gate que ya protege la ficha del
 * contacto (`requireActiveUser` en `modules/contacts/actions.ts`), replicado aquí
 * en vez de importado por la misma razón que 4O-G declaró su lista de roles en
 * local: el permiso de LEER teléfonos no debe quedar encadenado a un módulo cuyo
 * asunto es ESCRIBIR contactos.
 *
 * Devuelve `false` en vez de lanzar cuando el usuario no es interno activo; sólo
 * redirige cuando no hay sesión, que es lo que hace el resto de la aplicación.
 */
async function isActiveInternalUser(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .maybeSingle();

  return Boolean(internalUser);
}

function cleanContactId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * CUÁNTOS números adicionales tiene el contacto. Cero números en la respuesta: esto
 * es lo que decide si el CTA existe, y para eso basta un entero.
 *
 * Devuelve `0` —no un error— cuando el contacto no existe, cuando el usuario no
 * está autorizado o cuando la lectura falla. Fail-closed hacia «no ofrecer el CTA»:
 * la consecuencia de equivocarse por defecto es que el operador no ve un botón; la
 * de equivocarse al revés es ofrecerle abrir algo que no se va a poder abrir.
 */
export async function getOfficialContactStoredPhoneSummaryAction(input: {
  contactId: string;
}): Promise<{ additionalCount: number }> {
  const contactId = cleanContactId(input?.contactId);
  if (!contactId) return { additionalCount: 0 };

  if (!(await isActiveInternalUser())) return { additionalCount: 0 };

  try {
    const read = await readOfficialContactStoredPhones(contactId);
    return { additionalCount: countAdditionalStoredOfficialPhones(read) };
  } catch (err) {
    console.error(
      '[official-contact-stored-phones] summary read failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { additionalCount: 0 };
  }
}

/**
 * La lista de números adicionales, ya ordenada y ya proyectada a lo que la UI puede
 * mostrar. Se invoca cuando el operador abre el disclosure, no antes.
 *
 * Una lista vacía es un desenlace legítimo y esperado: entre el render que pintó el
 * CTA y el clic pueden haber desaparecido los extras (una DSAR que tombstonea el
 * número, o una retirada por proveedor que deja de justificarlo, son exactamente
 * esos casos). La UI lo dice con un estado vacío, y no con un error.
 */
export async function getOfficialContactStoredPhonesAction(input: {
  contactId: string;
}): Promise<StoredOfficialPhonesResult> {
  const contactId = cleanContactId(input?.contactId);
  if (!contactId) return { status: 'ok', phones: [] };

  if (!(await isActiveInternalUser())) return { status: 'unavailable' };

  try {
    const read = await readOfficialContactStoredPhones(contactId);
    return { status: 'ok', phones: selectAdditionalStoredOfficialPhones(read) };
  } catch (err) {
    console.error(
      '[official-contact-stored-phones] collection read failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { status: 'unavailable' };
  }
}
