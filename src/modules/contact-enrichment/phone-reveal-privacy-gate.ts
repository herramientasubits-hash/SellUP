// Agente 2A — PUERTA DE PRIVACIDAD previa a cualquier llamada de teléfono
// (AGENT2A-PHONE-REVEAL-4O-E3)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE MÓDULO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// La re-comprobación de supresión + `do_not_contact` inmediatamente anterior a la
// pata Lusha vivía dentro de `phone-reveal-waterfall-deps.ts`, así que solo la
// aplicaba el waterfall. El disparo MANUAL de Lusha —la acción de administración que
// un operador dispara desde el drawer— llamaba al proveedor sin consultar ninguna de
// las dos cosas: una persona con DSAR registrada, o marcada `do_not_contact`, se
// podía revelar igualmente, pagando el crédito.
//
// Este módulo es esa comprobación, extraída SIN cambios de comportamiento para que
// los dos caminos ejecuten LA MISMA función. No es una segunda puerta con las mismas
// reglas escritas dos veces: es la misma puerta. Esa es toda la diferencia entre
// «los dos caminos deberían coincidir» y «los dos caminos no pueden divergir».
//
// ═══════════════════════════════════════════════════════════════════
// PRECEDENCIA (determinista y documentada)
// ═══════════════════════════════════════════════════════════════════
//
//   check_unavailable  ⟵ cualquier fallo de lectura, en cualquier punto
//   do_not_contact     ⟵ se evalúa ANTES que la supresión
//   blocked_suppressed
//   clear
//
// El orden `do_not_contact` → supresión es el que el waterfall ya aplicaba y se
// conserva a propósito: cambiarlo alteraría la etiqueta que la corrida registra hoy
// sin cambiar ni una decisión (las dos bloquean la llamada por igual, con 0
// créditos). Lo que importa del orden no es cuál gana, sino que sea SIEMPRE el
// mismo: dos actores que evalúan al mismo candidato obtienen la misma razón.
//
// `not_evaluable` (sin Apollo person id resoluble o sin cuenta) se traduce a `clear`,
// exactamente como en el START, el webhook y el recovery (FIX 4): sin clave no hay
// tombstone que emparejar, y NO se bloquea por inferencia ni se hace matching difuso
// por teléfono, email, nombre o LinkedIn.
//
// ═══════════════════════════════════════════════════════════════════
// LÍMITES
// ═══════════════════════════════════════════════════════════════════
//
// Esta puerta corre ANTES de la llamada al proveedor, así que su efecto es 0
// llamadas y 0 créditos. NO sustituye a la re-comprobación TRANSACCIONAL de la
// migración 113: una supresión que se registre DESPUÉS de esta lectura la para la
// transacción de persistencia, no esta función. Las dos son necesarias y ninguna
// hace redundante a la otra.
//
// No escribe NADA: ni candidato, ni caché, ni contacto, ni HubSpot. No lee flags.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ContactSource } from './types';
import type { PhoneRevealWaterfallSuppressionState } from './phone-reveal-waterfall-core';
import {
  evaluateInFlightPhoneSuppression,
  resolveInFlightSuppressionPersonId,
} from './phone-reveal-suppression-guard';
import { readPhoneCacheSuppression } from './phone-cache-store';

/**
 * Vocabulario del veredicto. Alias del que ya define el core del waterfall: el
 * disparo manual NO estrena un vocabulario paralelo (`privacy_block`,
 * `manual_suppressed`…) para decir lo mismo.
 */
export type PhoneRevealPrivacyGateState = PhoneRevealWaterfallSuppressionState;

/**
 * Proyección para decidir la puerta. `phone` se lee solo para derivar `hasPhone`
 * — el número nunca sale de aquí. `apollo_person_id` + `run.account_id` son la clave
 * de la supresión; `email` / `linkedin_url` son las dos únicas identidades con las
 * que un `do_not_contact` es detectable.
 */
export const PRIVACY_GATE_CANDIDATE_SELECT = `id, source, source_contact_id, phone,
   email, linkedin_url, phone_reveal_status, apollo_person_id,
   run:contact_enrichment_runs ( account_id )`;

export interface PhoneRevealPrivacyGateCandidateRow {
  id: string;
  source: ContactSource | null;
  sourceContactId: string | null;
  hasPhone: boolean;
  phoneRevealStatus: string | null;
  email: string | null;
  linkedinUrl: string | null;
  apolloPersonId: string | null;
  accountId: string | null;
}

export function mapPhoneRevealPrivacyGateCandidateRow(
  row: Record<string, unknown>,
): PhoneRevealPrivacyGateCandidateRow {
  const runRaw = row.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | { account_id: string | null }
    | null
    | undefined;
  const phone = row.phone as string | null;
  return {
    id: row.id as string,
    source: (row.source as ContactSource | null) ?? null,
    sourceContactId: (row.source_contact_id as string | null) ?? null,
    hasPhone: typeof phone === 'string' && phone.trim().length > 0,
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    linkedinUrl: (row.linkedin_url as string | null) ?? null,
    apolloPersonId: (row.apollo_person_id as string | null) ?? null,
    accountId: run?.account_id ?? null,
  };
}

export async function loadPhoneRevealPrivacyGateCandidateRow(
  candidateId: string,
): Promise<PhoneRevealPrivacyGateCandidateRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select(PRIVACY_GATE_CANDIDATE_SELECT)
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data
    ? mapPhoneRevealPrivacyGateCandidateRow(data as Record<string, unknown>)
    : null;
}

/**
 * ¿Hay `do_not_contact` para este candidato? Espejo EXACTO de `isDoNotContact` en
 * phone-reveal-actions.ts: solo es detectable con cuenta + identidad
 * (email/linkedin); sin ellas NO se bloquea por inferencia. Ese es el mismo criterio
 * que ya gobierna el reveal Apollo, así que ninguna pata aplica una regla distinta a
 * la que el operador ya aceptó.
 */
export async function isPhoneRevealCandidateDoNotContact(
  row: PhoneRevealPrivacyGateCandidateRow,
): Promise<boolean> {
  if (!row.accountId) return false;
  const email = row.email?.trim().toLowerCase() || null;
  const linkedin = row.linkedinUrl?.trim().toLowerCase() || null;
  if (!email && !linkedin) return false;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contacts')
    .select('id, email, linkedin_url, contact_status')
    .eq('account_id', row.accountId)
    .eq('contact_status', 'do_not_contact');
  if (error) throw new Error(error.message);

  return (data ?? []).some((c) => {
    const cEmail = typeof c.email === 'string' ? c.email.toLowerCase() : null;
    const cLinkedin =
      typeof c.linkedin_url === 'string' ? c.linkedin_url.toLowerCase() : null;
    return (
      (email !== null && cEmail === email) ||
      (linkedin !== null && cLinkedin === linkedin)
    );
  });
}

/**
 * Re-comprueba supresión (tombstone) y do-not-contact INMEDIATAMENTE antes de una
 * llamada de teléfono a Lusha, la dispare el waterfall o un operador a mano.
 *
 * Fail-closed: cualquier fallo de lectura devuelve `check_unavailable`, que los dos
 * cores traducen en NO llamar al proveedor. Nunca lanza.
 */
export async function checkPhoneRevealPrivacyGate(
  candidateId: string,
): Promise<PhoneRevealPrivacyGateState> {
  let row: PhoneRevealPrivacyGateCandidateRow | null;
  try {
    row = await loadPhoneRevealPrivacyGateCandidateRow(candidateId);
  } catch {
    return 'check_unavailable';
  }
  if (!row) return 'check_unavailable';

  try {
    if (await isPhoneRevealCandidateDoNotContact(row)) return 'do_not_contact';
  } catch {
    return 'check_unavailable';
  }

  const suppression = await evaluateInFlightPhoneSuppression({
    personId: resolveInFlightSuppressionPersonId({
      candidateApolloPersonId: row.apolloPersonId,
      candidateSource: row.source,
      candidateSourceContactId: row.sourceContactId,
    }),
    accountId: row.accountId,
    lookup: readPhoneCacheSuppression,
  });

  switch (suppression.kind) {
    case 'blocked_suppressed':
      return 'blocked_suppressed';
    case 'check_unavailable':
      return 'check_unavailable';
    case 'not_evaluable':
    case 'allowed':
    default:
      return 'clear';
  }
}
