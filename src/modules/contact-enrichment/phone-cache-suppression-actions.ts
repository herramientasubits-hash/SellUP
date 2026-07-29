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
//   * Single (person, account) per call. There is NO batch suppression endpoint.
//   * Hard delete + tombstone: the phone value is nulled in the cache, in the
//     candidates and in the official contacts; the tombstone row survives and
//     blocks both a future cache hit and a future automatic reveal. If no cache
//     row exists, the tombstone is INSERTED (FIX B2) so an empty cache does not
//     turn a DSAR into a no-op.
//   * Contacts are only touched when the link is of provable provenance (or an
//     exact duplicate by email/linkedin) AND the stored phone came from an
//     Apollo reveal/cache hit (FIX B1 / FIX M1). A name-only match never erases.
//   * Every write is counted from the rows the database actually returned, so
//     the durable audit reflects reality and not the plan (FIX M2).
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
  buildPhoneCacheSuppressionAuditRow,
  buildPhoneCacheSuppressionPlan,
  buildPhoneCacheTombstoneDecision,
  PHONE_CACHE_SUPPRESSION_AUDIT_TABLE,
  type PhoneCacheSuppressionFailureCode,
  type PhoneCacheSuppressionPlan,
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
    failureCode: null,
    cacheEntriesSuppressed: 0,
    tombstoneCreated: false,
    candidatesCleared: 0,
    contactsCleared: 0,
    auditPersisted: false,
  };
}

/** Fallo de escritura: nada de lo pedido pudo completarse. Sin PII. */
function failed(
  failureCode: PhoneCacheSuppressionFailureCode,
): SuppressPhoneCacheEntryResult {
  return {
    ok: false,
    rejection: null,
    failureCode,
    cacheEntriesSuppressed: 0,
    tombstoneCreated: false,
    candidatesCleared: 0,
    contactsCleared: 0,
    auditPersisted: false,
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

// ── Lectura de evidencia del vínculo (sin PII) ──────────────────

/**
 * Extrae de `enrichment_metadata.review` la evidencia que decide si el FK
 * `matched_contacts_id` es de procedencia probada. Solo lee dos campos
 * mecánicos: `matched_by` ('email' | 'linkedin' | 'name') y
 * `created_contact_id`. No lee ni copia nombre, email ni teléfono.
 */
function readReviewLinkEvidence(
  metadata: ContactCandidateEnrichmentMetadata | null,
): { matchedBy: string | null; createdContactId: string | null } {
  const review = (metadata as Record<string, unknown> | null)?.review;
  if (!review || typeof review !== 'object') {
    return { matchedBy: null, createdContactId: null };
  }
  const r = review as Record<string, unknown>;
  return {
    matchedBy: typeof r.matched_by === 'string' ? r.matched_by : null,
    createdContactId:
      typeof r.created_contact_id === 'string' ? r.created_contact_id : null,
  };
}

// ── Server Action ──────────────────────────────────────────────
// ── Server Action ──────────────────────────────────────────────

/**
 * Suprime (hard delete + tombstone) un teléfono Apollo cacheado y todas sus
 * copias trazables para UNA persona en UNA cuenta.
 *
 * Orden de escritura, elegido para que una interrupción a mitad NUNCA deje el
 * dato accesible ni impida el bloqueo futuro:
 *   1. el TOMBSTONE en la caché — antes de leer nada más, para que un fallo al
 *      cargar candidatos o contactos no pueda dejar la persona sin bloquear
 *      (FIX B2 / FIX M4). Se inserta si no existía fila.
 *   2. los candidatos que llevan ese Apollo person id en esa cuenta.
 *   3. los contactos oficiales con vínculo de procedencia probada.
 *   4. la auditoría durable — SIEMPRE se intenta, incluso si un paso anterior
 *      falló, para que quede constancia de la supresión parcial.
 *
 * Nunca lanza por un fallo de escritura: devuelve `failureCode` mecánico y los
 * conteos reales, de modo que el operador sepa exactamente qué quedó pendiente.
 */
export async function suppressPhoneCacheEntryAction(
  input: SuppressPhoneCacheEntryInput,
): Promise<SuppressPhoneCacheEntryResult> {
  const actor = await resolveActor();
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const request = {
    providerPersonId: input.providerPersonId,
    accountId: input.accountId,
    countryCode: input.countryCode ?? null,
    reason: input.reason,
    actorUserId: actor.internalUserId,
    actorRoleKey: actor.roleKey,
  };

  // 0. Validación fail-closed (rol, id, cuenta, país, motivo de la allowlist).
  //    No depende de ninguna lectura, así que un rechazo no escribe nada.
  const decided = buildPhoneCacheTombstoneDecision(request, nowIso);
  if (!decided.ok) return rejected(decided.rejection);
  const { tombstone } = decided;

  // 1. TOMBSTONE — lo primero que se escribe: bloquea el cache hit y el reveal
  //    automático posteriores aunque todo lo demás fallara.
  const { data: suppressedRows, error: cacheError } = await admin
    .from(PHONE_REVEAL_CACHE_TABLE)
    .update(tombstone.cacheEntryPatch)
    .eq('provider', PHONE_CACHE_PROVIDER)
    .eq('provider_person_id', tombstone.providerPersonId)
    .eq('account_id', tombstone.accountId)
    .select('id');
  if (cacheError) {
    console.error('[phone-cache] suppression tombstone failed:', cacheError.message);
    return failed('cache_tombstone_failed');
  }

  let cacheEntriesSuppressed = suppressedRows?.length ?? 0;
  let tombstoneCreated = false;

  // 1b. FIX B2: si no había fila de caché, el tombstone se CREA. Una DSAR sobre
  //     una caché vacía tiene que bloquear igualmente los hits futuros y el
  //     reveal automático futuro. El upsert por la clave única
  //     (provider, person, account) hace la operación idempotente y a prueba de
  //     una carrera con una escritura de caché concurrente.
  if (cacheEntriesSuppressed === 0) {
    const { data: insertedRows, error: insertError } = await admin
      .from(PHONE_REVEAL_CACHE_TABLE)
      .upsert(tombstone.tombstoneInsertRow, {
        onConflict: 'provider,provider_person_id,account_id',
      })
      .select('id');
    if (insertError) {
      console.error(
        '[phone-cache] suppression tombstone insert failed:',
        insertError.message,
      );
      return failed('cache_tombstone_failed');
    }
    cacheEntriesSuppressed = insertedRows?.length ?? 0;
    tombstoneCreated = cacheEntriesSuppressed > 0;
  }

  // 2. Copias del teléfono. Cualquier fallo a partir de aquí deja el tombstone
  //    en pie y se reporta como supresión INCOMPLETA, nunca como éxito.
  let failureCode: PhoneCacheSuppressionFailureCode | null = null;
  let candidatesCleared = 0;
  let contactsCleared = 0;
  let plan: PhoneCacheSuppressionPlan = {
    ...tombstone,
    candidatePatches: [],
    contactPatches: [],
  };

  // 2a. Candidatos que llevan ese Apollo person id. El filtro por cuenta lo
  //     aplica el core sobre `run.account_id` (los candidatos no tienen columna
  //     de cuenta).
  const { data: candidateRows, error: candidateError } = await admin
    .from('contact_enrichment_candidates')
    .select(
      `id, enrichment_run_id, status, duplicate_status, enrichment_metadata,
       matched_contacts_id, run:contact_enrichment_runs ( account_id )`,
    )
    .eq('apollo_person_id', tombstone.providerPersonId);
  if (candidateError) {
    console.error('[phone-cache] suppression candidate read failed:', candidateError.message);
    failureCode = 'candidate_clear_failed';
  }

  const candidates: SuppressibleCandidate[] = (candidateRows ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const runRaw = r.run;
    const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
      | { account_id: string | null }
      | null
      | undefined;
    const enrichmentMetadata =
      (r.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {};
    const evidence = readReviewLinkEvidence(enrichmentMetadata);
    return {
      id: r.id as string,
      accountId: run?.account_id ?? null,
      enrichmentRunId: (r.enrichment_run_id as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      duplicateStatus: (r.duplicate_status as string | null) ?? null,
      matchedBy: evidence.matchedBy,
      createdContactId: evidence.createdContactId,
      enrichmentMetadata,
      matchedContactId: (r.matched_contacts_id as string | null) ?? null,
    };
  });

  // 2b. Contactos oficiales candidatos a supresión. Se descubren por los ids que
  //     los propios candidatos ya referencian (FK `matched_contacts_id` y
  //     `review.created_contact_id`), NUNCA por un filtro JSON path sobre
  //     `contacts.metadata` (FIX M4: ese filtro no está probado contra la DB
  //     real). El camino de aprobación escribe ambos con el MISMO id, así que la
  //     cobertura es la misma; `metadata.source_candidate_id` se sigue leyendo,
  //     pero solo para CONFIRMAR la procedencia, no para descubrir filas. No se
  //     hace matching difuso por teléfono/email/nombre en ningún caso.
  const linkedContactIds = [
    ...new Set(
      candidates
        .flatMap((c) => [c.matchedContactId, c.createdContactId])
        .filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
    ),
  ];

  let contacts: SuppressibleContact[] = [];
  if (linkedContactIds.length > 0) {
    const { data: contactRows, error: contactError } = await admin
      .from('contacts')
      .select('id, account_id, phone_source, metadata')
      .eq('account_id', tombstone.accountId)
      .in('id', linkedContactIds);
    if (contactError) {
      console.error('[phone-cache] suppression contact read failed:', contactError.message);
      failureCode = 'contact_clear_failed';
    }
    contacts = (contactRows ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const metadata = (r.metadata as Record<string, unknown> | null) ?? null;
      const sourceCandidateId = metadata?.source_candidate_id;
      return {
        id: r.id as string,
        accountId: (r.account_id as string | null) ?? null,
        sourceCandidateId:
          typeof sourceCandidateId === 'string' ? sourceCandidateId : null,
        phoneSource: (r.phone_source as string | null) ?? null,
      };
    });
  }

  const planned = buildPhoneCacheSuppressionPlan(request, { nowIso, candidates, contacts });
  if (planned.ok) plan = planned.plan;

  // 2c. Candidatos: borrado duro del número y del bloque phone de la metadata.
  //     El UPDATE se acota además por el run del candidato (FIX M2/M3): el run es
  //     lo que resolvió la cuenta, así que scopearlo cierra el hueco de un id
  //     suelto sin alcance verificado.
  for (const { candidateId, enrichmentRunId, patch } of plan.candidatePatches) {
    let query = admin
      .from('contact_enrichment_candidates')
      .update(patch)
      .eq('id', candidateId);
    if (enrichmentRunId) query = query.eq('enrichment_run_id', enrichmentRunId);
    const { data: updated, error } = await query.select('id');
    if (error) {
      console.error('[phone-cache] suppression candidate clear failed:', error.message);
      failureCode = 'candidate_clear_failed';
      continue;
    }
    candidatesCleared += updated?.length ?? 0;
  }

  // 2d. Contactos oficiales enlazados: borrado duro del teléfono y su
  //     procedencia. El UPDATE repite el filtro de procedencia además del de
  //     cuenta, para que una carrera que cambie `phone_source` entre la lectura y
  //     la escritura no acabe borrando un número manual (FIX M1).
  for (const { contactId, patch } of plan.contactPatches) {
    const { data: updated, error } = await admin
      .from('contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('account_id', tombstone.accountId)
      .in('phone_source', ['apollo_reveal', 'apollo_cache'])
      .select('id');
    if (error) {
      console.error('[phone-cache] suppression contact clear failed:', error.message);
      failureCode = 'contact_clear_failed';
      continue;
    }
    contactsCleared += updated?.length ?? 0;
  }

  // 3. Auditoría DURABLE sin PII (FIX H3): hash del person id, cuenta, motivo de
  //    la allowlist y conteos REALES. Se intenta SIEMPRE — también tras un fallo
  //    parcial — porque la constancia de la supresión es parte de la garantía.
  const auditRow = buildPhoneCacheSuppressionAuditRow({
    plan,
    providerPersonIdHash: hashProviderPersonId(tombstone.providerPersonId),
    cacheRowsSuppressed: cacheEntriesSuppressed,
    tombstoneCreated,
    candidatesCleared,
    contactsCleared,
  });
  const { error: auditError } = await admin
    .from(PHONE_CACHE_SUPPRESSION_AUDIT_TABLE)
    .insert(auditRow);
  let auditPersisted = true;
  if (auditError) {
    console.error('[phone-cache] suppression audit write failed:', auditError.message);
    auditPersisted = false;
    failureCode = failureCode ?? 'audit_write_failed';
  }

  return {
    ok: failureCode === null,
    rejection: null,
    failureCode,
    cacheEntriesSuppressed,
    tombstoneCreated,
    candidatesCleared,
    contactsCleared,
    auditPersisted,
  };
}
