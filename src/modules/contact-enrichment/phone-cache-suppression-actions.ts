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
//   * Contacts are only touched when the contact ITSELF proves it was
//     created/promoted from one of the suppressed candidates
//     (`contacts.metadata.source_candidate_id`) AND the stored phone came from an
//     Apollo reveal/cache hit (FIX 1 / FIX M1). A duplicate match — by name,
//     email or linkedin — never erases a contact in v1.
//   * Every write is counted from the rows the database actually returned, so
//     the durable audit reflects reality and not the plan (FIX M2).
//   * Never returns or logs a phone/email/name/linkedin — only counts and ids.
//
// ── 4O-E2: the candidate write is now TRANSACTIONAL ────────────
//
// Migration 109 added a fifth place the phone can live —
// `contact_enrichment_candidate_phones` — and this action did not know about it. The
// erasure cleared the cache, the candidate scalar and the contacts while leaving a
// LIVE `is_primary` row in the collection, which migrations 110/111 would then
// re-elect and write straight back into the visible scalar. The number came back
// through the seam between the two operations, not through a bug in either.
//
// So the per-candidate step is no longer an `UPDATE … SET phone = null` through
// PostgREST. It is one call to `suppress_candidate_phone_collection` (migration 112),
// which in a SINGLE transaction tombstones the numbers, demotes the old primary,
// promotes the surviving one (or none) and syncs the scalar plus
// `enrichment_metadata.phone` to THAT survivor. The transaction is the authority; this
// file does not write the candidate again afterwards, because a second writer would
// put `phone = null` on top of a legitimately re-elected survivor.
//
// The order of the surrounding steps is unchanged, and so is what is and is not
// atomic: the cache tombstone still goes FIRST (a later failure must not leave the
// person unblocked), the contacts erasure and the durable audit are still separate
// statements, and the audit is still attempted LAST and unconditionally. What is
// atomic is `collection + candidate scalar/primary`, which is the pair that could
// previously contradict each other. A failed propagation is reported as
// `candidate_phone_collection_failed` and the suppression is NOT reported as ok.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { PHONE_CACHE_PROVIDER } from './phone-cache-core';
import { DSAR_CANDIDATE_PHONE_SUPPRESSION_SCOPE } from './candidate-phone-collection-suppression-core';
import { suppressCandidatePhoneCollection } from './candidate-phone-collection-suppression-persistence';
import { mapSuppressionReasonToCandidatePhoneReason } from './candidate-phone-suppression-reason-mapping';
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
    candidatePhoneRowsSuppressed: 0,
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
    candidatePhoneRowsSuppressed: 0,
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

// ── Lectura del id de contacto para DESCUBRIR filas (sin PII) ───

/**
 * Extrae `enrichment_metadata.review.created_contact_id`: el id del contacto que
 * la aprobación creó desde este candidato. Se usa SOLO para localizar filas de
 * `contacts` que merezca la pena inspeccionar; la autorización del borrado la da
 * después la metadata del propio contacto (FIX 1). No lee nombre, email ni
 * teléfono, y ya NO lee `matched_by` ni `duplicate_status`: en v1 la evidencia de
 * duplicado no autoriza borrar nada, así que leerla solo invitaría a confusión.
 */
function readCreatedContactId(
  metadata: ContactCandidateEnrichmentMetadata | null,
): string | null {
  const review = (metadata as Record<string, unknown> | null)?.review;
  if (!review || typeof review !== 'object') return null;
  const created = (review as Record<string, unknown>).created_contact_id;
  return typeof created === 'string' ? created : null;
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
 *   3. los contactos oficiales creados/promovidos desde esos candidatos.
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
  let candidatePhoneRowsSuppressed = 0;
  let candidatePhoneSurvivorCount = 0;
  let candidatePhonePrimaryChanged = false;
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
      `id, enrichment_run_id, enrichment_metadata,
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
    return {
      id: r.id as string,
      accountId: run?.account_id ?? null,
      enrichmentRunId: (r.enrichment_run_id as string | null) ?? null,
      createdContactId: readCreatedContactId(enrichmentMetadata),
      enrichmentMetadata,
      matchedContactId: (r.matched_contacts_id as string | null) ?? null,
    };
  });

  // 2b. Contactos oficiales candidatos a supresión. Se descubren por los ids que
  //     los propios candidatos ya referencian (FK `matched_contacts_id` y
  //     `review.created_contact_id`), NUNCA por un filtro JSON path sobre
  //     `contacts.metadata` (FIX M4: ese filtro no está probado contra la DB
  //     real). El camino de aprobación escribe ambos con el MISMO id, así que la
  //     cobertura es la misma; `metadata.source_candidate_id` se lee de la fila ya
  //     cargada y es lo ÚNICO que autoriza el borrado (FIX 1). No se hace
  //     matching difuso por teléfono/email/nombre en ningún caso.
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

  // 2c. Candidatos: borrado duro del número, del bloque phone de la metadata Y de la
  //     COLECCIÓN CANÓNICA, en UNA transacción por candidato (4O-E2, migración 112).
  //
  //     Antes de este hito aquí había un `UPDATE contact_enrichment_candidates` por
  //     PostgREST que dejaba `phone = null` y nada más. Eso bastaba mientras
  //     `contact_enrichment_candidate_phones` no existía; con la tabla poblada dejaba
  //     vivo el número en la colección, y las RPC 110/111 lo habrían vuelto a elegir
  //     como principal escribiéndolo de nuevo en el escalar. La transacción es ahora
  //     la AUTORIDAD sobre las cuatro cosas: tombstones, reelección del principal,
  //     escalar y metadata. Este bucle NO vuelve a escribir el candidato después —
  //     hacerlo pondría `phone = null` encima de un superviviente legítimamente
  //     reelegido, que es el defecto en espejo del que se está corrigiendo.
  //
  //     El alcance por RUN se conserva (FIX M2/M3): el run es lo que resolvió la
  //     cuenta, así que viaja a la transacción y allí se reafirma DENTRO del lock.
  //
  //     El motivo se TRADUCE: el vocabulario de la caché y el de la colección no
  //     comparten ni un valor, así que un pass-through fallaría la CHECK de la 109 en
  //     el 100% de las filas.
  const collectionReason = mapSuppressionReasonToCandidatePhoneReason(
    plan.reasonCode,
  );
  for (const { candidateId, enrichmentRunId } of plan.candidatePatches) {
    try {
      const propagated = await suppressCandidatePhoneCollection({
        candidateId,
        expectedEnrichmentRunId: enrichmentRunId,
        scope: DSAR_CANDIDATE_PHONE_SUPPRESSION_SCOPE,
        dedupeKey: null,
        reason: collectionReason,
        suppressedBy: plan.actorUserId,
        suppressedAt: nowIso,
      });
      candidatePhoneRowsSuppressed += propagated.suppressedCount;
      candidatePhoneSurvivorCount += propagated.survivorCount;
      candidatePhonePrimaryChanged =
        candidatePhonePrimaryChanged || propagated.primaryChanged;
      if (propagated.candidateSettled) {
        // Se cuenta el candidato ALCANZADO y dejado en el estado pedido, no el
        // UPDATE: una repetición idempotente no cambia valores y el UPDATE
        // incondicional anterior sí la contaba. Cambiar la semántica del conteo
        // haría que una segunda DSAR pareciera no haber tocado nada.
        candidatesCleared += 1;
      } else {
        failureCode = failureCode ?? 'candidate_phone_collection_failed';
      }
    } catch {
      // Sin PII y sin el mensaje del driver: PostgreSQL cita valores de la query en
      // sus errores, y aquí uno de esos valores es un teléfono.
      console.error(
        '[phone-cache] suppression candidate collection propagation failed',
      );
      failureCode = failureCode ?? 'candidate_phone_collection_failed';
    }
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
    candidatePhoneRowsSuppressed,
    candidatePhoneSurvivorCount,
    candidatePhonePrimaryChanged,
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
    candidatePhoneRowsSuppressed,
    contactsCleared,
    auditPersisted,
  };
}
