'use server';

// Agente 2A — Apollo Phone Cache: SUPPRESSION server action (APOLLO-PHONE-CACHE-1b)
//
// ADMIN-only backend capability to erase a cached Apollo phone everywhere it
// landed (DSAR / "borra mi teléfono"). This is the operational counterpart of
// the cache: the policy GO was granted on the condition that a reused number can
// actually be deleted, not merely hidden.
//
// It wires the real I/O around the pure suppression core
// (phone-cache-suppression-core.ts), which owns every decision: who may run it,
// which rows change, and what the PII-free audit looks like.
//
// Deliberate design choices:
//   * NOT gated by ENABLE_APOLLO_PHONE_CACHE. A privacy erasure must never be
//     blocked by a feature flag being off — cached rows may already exist from a
//     period when the flag was on.
//   * ADMIN-only (stricter than the reveal, which also allows
//     commercial_manager): erasing data is a different kind of authority than
//     revealing it.
//   * Single (person, account) per call. There is NO bulk suppression endpoint.
//   * Hard delete + tombstone: the phone value is nulled in the cache, in the
//     candidates and in the official contacts; the tombstone row survives and
//     blocks both a future cache hit and a future automatic reveal.
//   * No UI in this milestone: exposed as an action for a later, authorized step.
//   * Never returns or logs a phone/email/name/linkedin — only counts and ids.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { PHONE_CACHE_PROVIDER } from './phone-cache-core';
import {
  hashProviderPersonId,
  PHONE_REVEAL_CACHE_TABLE,
} from './phone-cache-store';
import {
  buildPhoneCacheSuppressionAudit,
  buildPhoneCacheSuppressionPlan,
  type PhoneCacheSuppressionRejection,
  type SuppressibleCandidate,
  type SuppressibleContact,
  type SuppressPhoneCacheEntryInput,
  type SuppressPhoneCacheEntryResult,
} from './phone-cache-suppression-core';
import type { ContactCandidateEnrichmentMetadata } from './types';

// ── Resultado (SIN PII) ────────────────────────────────────────

function rejected(
  rejection: PhoneCacheSuppressionRejection,
): SuppressPhoneCacheEntryResult {
  return {
    ok: false,
    rejection,
    cacheEntriesSuppressed: 0,
    candidatesCleared: 0,
    contactsCleared: 0,
  };
}

// ── Auth ADMIN-only ────────────────────────────────────────────

async function resolveActor(): Promise<{
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
  return { internalUserId: internalUser.id as string, roleKey };
}

// ── Server Action ──────────────────────────────────────────────

/**
 * Suprime (hard delete + tombstone) un teléfono Apollo cacheado y todas sus
 * copias trazables para UNA persona en UNA cuenta.
 *
 * Orden de escritura, elegido para que una interrupción a mitad NUNCA deje el
 * dato accesible: primero el tombstone en la caché (bloquea de inmediato
 * cualquier hit y cualquier reveal automático posterior), después los
 * candidatos, después los contactos oficiales. Si algo falla, lo que ya se borró
 * sigue borrado y el tombstone sigue bloqueando.
 */
export async function suppressPhoneCacheEntryAction(
  input: SuppressPhoneCacheEntryInput,
): Promise<SuppressPhoneCacheEntryResult> {
  const actor = await resolveActor();
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  // Candidatos que llevan ese Apollo person id. El filtro por cuenta lo aplica
  // el core sobre `run.account_id` (los candidatos no tienen columna de cuenta).
  const { data: candidateRows, error: candidateError } = await admin
    .from('contact_enrichment_candidates')
    .select(
      'id, enrichment_metadata, matched_contacts_id, run:contact_enrichment_runs ( account_id )',
    )
    .eq('apollo_person_id', input.providerPersonId);
  if (candidateError) throw new Error(candidateError.message);

  const candidates: SuppressibleCandidate[] = (candidateRows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const runRaw = r.run;
    const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
      | { account_id: string | null }
      | null
      | undefined;
    return {
      id: r.id as string,
      accountId: run?.account_id ?? null,
      enrichmentMetadata:
        (r.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
      matchedContactId: (r.matched_contacts_id as string | null) ?? null,
    };
  });

  // Contactos oficiales enlazados por procedencia (metadata.source_candidate_id).
  // NO se hace matching difuso por teléfono/email/nombre: solo se borra donde la
  // procedencia es demostrable.
  const candidateIds = candidates.map((c) => c.id);
  let contacts: SuppressibleContact[] = [];
  if (candidateIds.length > 0) {
    const { data: contactRows, error: contactError } = await admin
      .from('contacts')
      .select('id, account_id, metadata')
      .eq('account_id', input.accountId)
      .in('metadata->>source_candidate_id', candidateIds);
    if (contactError) throw new Error(contactError.message);
    contacts = (contactRows ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const metadata = (r.metadata as Record<string, unknown> | null) ?? null;
      const sourceCandidateId = metadata?.source_candidate_id;
      return {
        id: r.id as string,
        accountId: (r.account_id as string | null) ?? null,
        sourceCandidateId:
          typeof sourceCandidateId === 'string' ? sourceCandidateId : null,
      };
    });
  }

  const planned = buildPhoneCacheSuppressionPlan(
    {
      providerPersonId: input.providerPersonId,
      accountId: input.accountId,
      countryCode: input.countryCode ?? null,
      reason: input.reason,
      actorUserId: actor.internalUserId,
      actorRoleKey: actor.roleKey,
    },
    { nowIso, candidates, contacts },
  );
  if (!planned.ok) return rejected(planned.rejection);
  const { plan } = planned;

  // 1. Tombstone en la caché — PRIMERO: bloquea el hit y el reveal automático
  //    aunque los pasos siguientes fallaran.
  const { data: suppressedRows, error: cacheError } = await admin
    .from(PHONE_REVEAL_CACHE_TABLE)
    .update(plan.cacheEntryPatch)
    .eq('provider', PHONE_CACHE_PROVIDER)
    .eq('provider_person_id', plan.providerPersonId)
    .eq('account_id', plan.accountId)
    .select('id');
  if (cacheError) throw new Error(cacheError.message);

  // 2. Candidatos: borrado duro del número y del bloque phone de la metadata.
  for (const { candidateId, patch } of plan.candidatePatches) {
    const { error } = await admin
      .from('contact_enrichment_candidates')
      .update(patch)
      .eq('id', candidateId);
    if (error) throw new Error(error.message);
  }

  // 3. Contactos oficiales enlazados: borrado duro del teléfono y su procedencia.
  for (const { contactId, patch } of plan.contactPatches) {
    const { error } = await admin
      .from('contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('account_id', plan.accountId);
    if (error) throw new Error(error.message);
  }

  // 4. Auditoría sin PII: hash del person id, cuenta, motivo mecánico y conteos.
  const audit = buildPhoneCacheSuppressionAudit({
    plan,
    providerPersonIdHash: hashProviderPersonId(plan.providerPersonId),
    actorUserId: actor.internalUserId,
    reason: input.reason,
    cacheEntriesSuppressed: suppressedRows?.length ?? 0,
  });
  console.info('[phone-cache] suppression', JSON.stringify(audit));

  return {
    ok: true,
    rejection: null,
    cacheEntriesSuppressed: audit.metadata.cache_entries_suppressed,
    candidatesCleared: audit.metadata.candidates_cleared,
    contactsCleared: audit.metadata.contacts_cleared,
  };
}
