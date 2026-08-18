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
//     (`contacts.metadata.source_candidate_id`) AND the stored phone came from a
//     PROVEN reveal path — an Apollo reveal, an Apollo cache hit or a Lusha reveal
//     (FIX 1 / FIX M1 / 4O-E4). A duplicate match — by name, email or linkedin —
//     never erases a contact in v1.
//
// ── 4O-E4: la erasure de teléfonos Lusha oficiales ─────────────
//
// `lusha_reveal` entra en la allowlist de procedencias borrables: hasta este hito el
// contacto OFICIAL conservaba el número revelado por Lusha aunque la DSAR limpiara la
// caché, el escalar del candidato y la colección canónica, y la operación se
// declaraba `ok` con el dato personal aún visible en la UI. La admisión se apoya en
// una cadena de procedencia explícita y completa (reveal → metadata del candidato →
// aprobación → `contacts.phone_source`), nunca en coincidencia de valor.
//
// Dos consecuencias que este archivo materializa:
//   * el UPDATE filtra por la procedencia EXACTA observada (`.eq`) y no por la
//     allowlist entera (`.in`): un reemplazo legítimo posterior a la lectura tiene
//     que sobrevivir a la escritura stale;
//   * `mobile_phone` NO se toca en NINGÚN camino (4O-E4.1). La columna no tiene
//     procedencia propia y sus únicos escritores —actuales e históricos— son los
//     formularios manuales, así que la erasure es declaradamente PARCIAL cuando ese
//     campo está poblado, venga el teléfono de Apollo o de Lusha.
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
import { DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE } from './official-contact-phone-suppression-core';
import { suppressOfficialContactPhoneSources } from './official-contact-phone-suppression-persistence';
import {
  hashProviderPersonId,
  PHONE_REVEAL_CACHE_TABLE,
} from './phone-cache-store';
import {
  resolveAllPhoneRevealProviderIdentities,
  type ProviderSuppressionIdentity,
} from './provider-suppression-core';
import {
  insertProviderSuppression,
  insertProviderSuppressionAudit,
} from './provider-suppression-store';
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
    officialPhoneSourcesSuppressed: 0,
    officialPhoneRowsTombstoned: 0,
    auditPersisted: false,
    providerSuppressionsCreated: 0,
    providerSuppressionsAlreadyPresent: 0,
    providerSuppressionsByProvider: { apollo: 0, lusha: 0 },
    providerSuppressionAuditPersisted: false,
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
    officialPhoneSourcesSuppressed: 0,
    officialPhoneRowsTombstoned: 0,
    auditPersisted: false,
    providerSuppressionsCreated: 0,
    providerSuppressionsAlreadyPresent: 0,
    providerSuppressionsByProvider: { apollo: 0, lusha: 0 },
    providerSuppressionAuditPersisted: false,
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

  // ── 0b. SUPRESIÓN NATIVA DEL PROVEEDOR (Fase 1, migración 120) ──
  //
  // Va PRIMERO, incluso antes del tombstone legado de la caché, y el orden es el
  // argumento: de las dos escrituras de bloqueo, ésta es la ÚNICA que bloquea a la
  // persona en todas partes. El tombstone legado sólo bloquea dentro de UNA cuenta, así
  // que si se escribiera primero y esto fallara, la operación habría dejado a la persona
  // revelable desde cualquier otra cuenta —y desde cualquier candidato sin cuenta— con
  // una supresión que parece completa.
  //
  // La identidad de esta primera escritura es la del PROPIO request: el
  // `providerPersonId` que el operador pidió suprimir es, por el contrato de esta acción,
  // un id de Apollo. No se deduce de nada.
  //
  // Un fallo aquí NO aborta el resto. Se registra como `provider_suppression_failed` y la
  // operación sigue borrando todo lo que sí puede borrar: una supresión parcial reportada
  // con precisión es mejor que un `return` temprano que además deja los números vivos.
  const providerSuppressionsByProvider = { apollo: 0, lusha: 0 };
  let providerSuppressionsCreated = 0;
  let providerSuppressionsAlreadyPresent = 0;
  let providerSuppressionAuditPersisted = true;
  const providerIdentitiesRecorded = new Set<string>();
  let providerSuppressionFailed = false;

  /**
   * Registra UNA identidad nativa + su evidencia durable. Idempotente por la clave única
   * de la 120, así que repetir la misma identidad en el fan-out no duplica nada.
   *
   * La auditoría se intenta SIEMPRE, también cuando la escritura falló: la constancia del
   * INTENTO es parte de la garantía, y una DSAR que no se pudo completar tiene que ser
   * visible en lugar de invisible.
   */
  const recordProviderSuppression = async (
    identity: ProviderSuppressionIdentity,
  ): Promise<void> => {
    const dedupeKey = `${identity.provider}::${identity.providerPersonId}`;
    if (providerIdentitiesRecorded.has(dedupeKey)) return;
    providerIdentitiesRecorded.add(dedupeKey);

    const written = await insertProviderSuppression({
      identity,
      suppressedAt: nowIso,
      suppressionReason: tombstone.reasonCode,
      suppressedBy: actor.internalUserId,
    });

    if (written.kind === 'created') providerSuppressionsCreated += 1;
    if (written.kind === 'already_present') providerSuppressionsAlreadyPresent += 1;
    if (written.kind === 'failed') {
      providerSuppressionFailed = true;
      // Sin el mensaje del driver junto al id: Postgres cita valores de la query en sus
      // errores y uno de esos valores es el identificador de la persona.
      console.error('[provider-suppression] write failed for', identity.provider);
    } else {
      providerSuppressionsByProvider[identity.provider] += 1;
    }

    const audited = await insertProviderSuppressionAudit({
      provider: identity.provider,
      providerPersonIdHash: hashProviderPersonId(identity.providerPersonId),
      operation:
        written.kind === 'already_present'
          ? 'suppression_reaffirmed'
          : 'suppression_created',
      result:
        written.kind === 'created'
          ? 'applied'
          : written.kind === 'already_present'
            ? 'already_present'
            : 'failed',
      reasonCode: tombstone.reasonCode,
      origin: 'dsar_action',
      actorUserId: actor.internalUserId,
      metadata: {
        actor_role_key: actor.roleKey,
        // El alcance de la operación se registra SIN la cuenta: esta evidencia no tiene
        // tenant a propósito (no hay FK ni cascada), y meter el id de cuenta en el jsonb
        // la volvería a atar a algo que un borrado puede llevarse.
        request_scope: 'single_person',
      },
    });
    if (!audited.persisted) providerSuppressionAuditPersisted = false;
  };

  await recordProviderSuppression({
    provider: PHONE_CACHE_PROVIDER,
    providerPersonId: tombstone.providerPersonId,
  });

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
  // 4O-H2 — superficie OFICIAL. Conteos separados de los del candidato a propósito: son
  // dos colecciones distintas con dos identidades distintas, y sumarlas haría imposible
  // saber si la que quedó sin borrar fue la de staging o la oficial.
  let officialPhoneSourcesSuppressed = 0;
  let officialPhoneRowsTombstoned = 0;
  let officialPhoneSurvivorCount = 0;
  let officialPhonePrimaryChanged = false;
  let officialPhoneScalarGuarded = 0;
  let plan: PhoneCacheSuppressionPlan = {
    ...tombstone,
    candidatePatches: [],
    contactPatches: [],
    // Plan VACÍO de arranque: si la lectura de candidatos o de contactos falla, no se
    // propaga a ninguna superficie. La colección oficial se comporta como las otras
    // dos — sin objetivos no se llama a la RPC, y el `failureCode` de la lectura ya
    // deja el resultado en `ok: false`.
    officialContactTargets: [],
  };

  // 2a. Candidatos que llevan ese Apollo person id. El filtro por cuenta lo
  //     aplica el core sobre `run.account_id` (los candidatos no tienen columna
  //     de cuenta).
  const { data: candidateRows, error: candidateError } = await admin
    .from('contact_enrichment_candidates')
    .select(
      // Fase 1: `source`, `source_contact_id` y `apollo_person_id` se leen para resolver
      // las identidades NATIVAS que ESTA MISMA fila declara. No se lee nombre, email ni
      // LinkedIn: el fan-out del §11 es por identidad declarada en el registro, nunca por
      // parecido entre registros.
      `id, enrichment_run_id, enrichment_metadata, source, source_contact_id,
       apollo_person_id, matched_contacts_id,
       run:contact_enrichment_runs ( account_id )`,
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
      // Fase 1 — identidades nativas declaradas por ESTA fila (fan-out del §11).
      source: (r.source as string | null) ?? null,
      sourceContactId: (r.source_contact_id as string | null) ?? null,
      apolloPersonId: (r.apollo_person_id as string | null) ?? null,
    };
  });

  // 2a-bis. FAN-OUT de identidades NATIVAS del MISMO registro (Fase 1, §11/§17).
  //
  // Un candidato puede llevar, EN SU PROPIA FILA, dos identidades de dos proveedores: la
  // columna `apollo_person_id` (que un enrichment de Apollo le escribió) y su
  // `source_contact_id` nativo de Lusha. Cuando eso ocurre, esta operación registra las
  // DOS supresiones.
  //
  // Esto NO es inferencia entre proveedores y no convierte la Fase 1 en supresión global:
  //
  //   * las dos identidades están escritas en la MISMA fila del MISMO candidato, que
  //     representa a UNA persona. Es el registro el que las declara juntas, no este código
  //     el que las empareja;
  //   * NO se mira nombre, email, LinkedIn, empresa ni dominio, y no se cruza con ningún
  //     otro registro. Dos candidatos distintos "con el mismo aspecto" no aportan ni una
  //     identidad;
  //   * dos identidades del mismo humano que nunca coincidieron en una fila siguen sin
  //     poder emparejarse. Eso es exactamente lo que queda para la Fase 2.
  //
  // Se acota a los candidatos que la lectura de 2a ya seleccionó por `apollo_person_id`,
  // que es el mismo conjunto que el resto de la operación propaga.
  for (const candidate of candidates) {
    if (candidate.accountId !== tombstone.accountId) continue;
    const identities = resolveAllPhoneRevealProviderIdentities({
      apolloPersonId: candidate.apolloPersonId,
      source: candidate.source,
      sourceContactId: candidate.sourceContactId,
    });
    for (const identity of identities) {
      await recordProviderSuppression(identity);
    }
  }

  if (providerSuppressionFailed) {
    failureCode = failureCode ?? 'provider_suppression_failed';
  }

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
      // 4O-H3-B: los candidatos cuya colección oficial se FUSIONÓ en esta fila. Se lee de la
      // metadata del propio contacto —igual que `source_candidate_id`— y autoriza el borrado con
      // la misma fuerza, porque también lo escribió la transacción que efectivamente escribió
      // los números. Un valor con forma inesperada se ignora en vez de asumirse.
      const mergedRaw = metadata?.merged_candidate_ids;
      const mergedCandidateIds = Array.isArray(mergedRaw)
        ? mergedRaw.filter((v): v is string => typeof v === 'string')
        : null;
      return {
        id: r.id as string,
        accountId: (r.account_id as string | null) ?? null,
        sourceCandidateId:
          typeof sourceCandidateId === 'string' ? sourceCandidateId : null,
        mergedCandidateIds,
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

  // 2d. Contactos oficiales enlazados: borrado duro del teléfono y de TODA su
  //     tupla de procedencia. El UPDATE repite el filtro de procedencia además del
  //     de cuenta, para que una carrera que cambie `phone_source` entre la lectura y
  //     la escritura no acabe borrando un número manual (FIX M1).
  //
  //     4O-E4: el predicado pasa de `.in(allowlist)` a `.eq(procedencia observada)`.
  //
  //     4O-E4.1: el patch volvió a ser UNO SOLO para todas las procedencias (ya no
  //     incluye `mobile_phone` en ninguna), pero el `.eq` NO se revierte a `.in` —
  //     su valor nunca dependió de que los patches divergieran. Lo que protege es la
  //     carrera del §11: la supresión LEE la fila como `apollo_reveal`, un escritor
  //     legítimo la reemplaza por un número MANUAL y commitea, y la escritura stale
  //     llega después. Con `.in(allowlist)` esa fila ya no casaría por ser `manual`,
  //     pero un cambio ENTRE procedencias admitidas (Apollo → Lusha) sí casaría y
  //     borraría una tupla que el operador no observó. Con `.eq` la carrera afecta 0
  //     filas y se ve como supresión incompleta, que es lo correcto.
  //
  //     El `.eq` es además estrictamente MÁS restrictivo que el `.in` anterior, así
  //     que ninguna fila que antes estuviera protegida deja de estarlo: `manual`,
  //     `unknown` y `NULL` nunca son un `observedPhoneSource` porque el core sólo
  //     emite patches para procedencias de la allowlist.
  for (const { contactId, patch, observedPhoneSource } of plan.contactPatches) {
    const { data: updated, error } = await admin
      .from('contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('account_id', tombstone.accountId)
      .eq('phone_source', observedPhoneSource)
      .select('id');
    if (error) {
      console.error('[phone-cache] suppression contact clear failed:', error.message);
      failureCode = 'contact_clear_failed';
      continue;
    }
    contactsCleared += updated?.length ?? 0;
  }

  // 2e. Colección OFICIAL de teléfonos del contacto (4O-H2): `contact_phones` +
  //     `contact_phone_sources` de la migración 114, borradas por la transacción de la
  //     115 — retirada de procedencia, tombstone del canónico que se quedó sin
  //     procedencia viva, reelección del principal sólo si el titular dejó de estar
  //     vivo, y reproyección del escalar heredado, todo en UNA transacción.
  //
  //     ── POR QUÉ VA **DESPUÉS** DE 2d, Y NO ANTES ──────────────────
  //     Porque así este hito es estrictamente ADITIVO. Con 2d primero, el borrado del
  //     escalar heredado ocurre exactamente como hoy —mismo patch, mismo predicado,
  //     mismos conteos— y la 115 encuentra `phone_source = NULL`, que no está en la
  //     allowlist, así que su guarda lo deja intacto en vez de reescribir una tupla
  //     que 4O-E4 acaba de dejar en el estado correcto. E1–E4.1 no cambian de
  //     comportamiento en una sola fila.
  //
  //     Al revés —la 115 primero— la reproyección oficial escribiría el escalar y el
  //     `.eq('phone_source', observado)` de 2d casaría 0 filas, dejando
  //     `contactsCleared = 0` en la auditoría sobre un escalar que SÍ se limpió. Es
  //     decir: el modelo oficial pasaría a ser autoritativo sobre el escalar ANTES de
  //     que H3 lo poblara y H4 lo leyera. Ese es el orden que hay que evitar.
  //
  //     Consecuencia DECLARADA: en el camino cableado la reproyección de la 115 casi
  //     siempre queda guardada, y la propiedad §23 —un escalar nunca afirma una
  //     procedencia retirada, Apollo → Lusha en la misma transacción— vive en la RPC y
  //     se mide contra PostgreSQL real, no aquí. Es infraestructura para H3/H4, y en
  //     H2 no se le deja mover lo que el producto muestra.
  //
  //     ── ALCANCE **DE PERSONA**, NO DE PROVEEDOR ───────────────────
  //     `DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE` = `all_suppressible_providers`, en
  //     espejo exacto de `DSAR_CANDIDATE_PHONE_SUPPRESSION_SCOPE` =
  //     `all_candidate_phones`. La clave de Apollo identifica a QUÉ PERSONA, no qué
  //     proveedor se borra: esta operación ya cruza proveedores hoy (2d limpia un
  //     escalar `lusha_reveal`). Cablearla a `single_provider = apollo` habría dejado
  //     viva la procedencia de Lusha y el número canónico con ella.
  //
  //     El conjunto de contactos es `officialContactTargets` y NO `contactPatches`:
  //     más ancho a propósito, porque la allowlist de `phone_source` protege el
  //     ESCALAR y no autoriza la colección oficial. Un contacto con un número manual
  //     puede tener filas oficiales de Apollo pagadas, y excluirlo las dejaría vivas.
  for (const { contactId } of plan.officialContactTargets) {
    try {
      const official = await suppressOfficialContactPhoneSources({
        contactId,
        scope: DSAR_OFFICIAL_PHONE_SUPPRESSION_SCOPE,
        provider: null,
        dedupeKey: null,
        suppressionReason: collectionReason,
        suppressedBy: plan.actorUserId,
        suppressedAt: nowIso,
      });
      officialPhoneSourcesSuppressed += official.sourcesSuppressed;
      officialPhoneRowsTombstoned += official.phonesTombstoned;
      officialPhoneSurvivorCount += official.survivorCount;
      officialPhonePrimaryChanged =
        officialPhonePrimaryChanged || official.primaryChanged;
      if (official.scalarGuardedByProvenance) officialPhoneScalarGuarded += 1;
      if (!official.contactSettled) {
        // `contact_settled` viene CRUZADO contra la lista de estados liquidados en el
        // parser, así que un `true` junto a un estado que no liquida no llega hasta
        // aquí. `no_official_collection` SÍ liquida: no había nada que borrar.
        failureCode = failureCode ?? 'official_phone_suppression_failed';
      }
    } catch {
      // Sin PII y sin el mensaje del driver: PostgreSQL cita valores de la query en
      // sus errores, y aquí uno de esos valores es un teléfono.
      console.error(
        '[phone-cache] suppression official phone propagation failed',
      );
      failureCode = failureCode ?? 'official_phone_suppression_failed';
    }
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
    officialPhoneSourcesSuppressed,
    officialPhoneRowsTombstoned,
    officialPhoneContactsTargeted: plan.officialContactTargets.length,
    officialPhoneSurvivorCount,
    officialPhonePrimaryChanged,
    officialPhoneScalarGuarded,
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
    officialPhoneSourcesSuppressed,
    officialPhoneRowsTombstoned,
    auditPersisted,
    providerSuppressionsCreated,
    providerSuppressionsAlreadyPresent,
    providerSuppressionsByProvider,
    providerSuppressionAuditPersisted,
  };
}
