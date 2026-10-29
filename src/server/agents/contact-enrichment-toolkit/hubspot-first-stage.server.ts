// AGENT2-HUBSPOT-FIRST-1 — «Primero HubSpot» (etapa de servidor)
//
// Corre entre la creación del intento 1 y la llamada a Apollo: lee los contactos que HubSpot
// ya tiene de la empresa, los deja como candidatos `pending_review` de ESA corrida y dice si
// bastan para no gastar proveedores. Falla ABIERTO: cualquier error devuelve «no satisfecho»
// y el orquestador sigue con Apollo/Lusha como siempre. Sólo lee HubSpot; no escribe en él.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ExistingContactsSnapshotResult } from '@/modules/contact-enrichment/types';
import { resolveSellerHubSpotOwner } from '@/modules/prospect-batches/hubspot-free-pool-approval';
import { findHubSpotOwnerByEmail, getHubSpotToken } from '@/server/integrations/hubspot-company-create';
import { loadHubSpotOwnerDirectory } from '@/server/integrations/hubspot-free-company-pool.server';
import { readExistingContactsForCompany } from './existing-contacts-reader';
import {
  isSatisfiedByHubSpot,
  selectHubSpotFirstCandidates,
  type HubSpotFirstCandidateRow,
  type HubSpotFirstOwnership,
} from './hubspot-first-core';

export interface HubSpotFirstRunRef {
  accountId: string | null;
  hubspotCompanyId: string | null;
}

export interface HubSpotFirstStageDeps {
  loadRunRef?: (attemptId: string) => Promise<HubSpotFirstRunRef | null>;
  readSnapshot?: (ref: HubSpotFirstRunRef) => Promise<ExistingContactsSnapshotResult>;
  loadRunHubspotCandidates?: (attemptId: string) => Promise<Array<{ hubspotId: string; hasEmail: boolean }>>;
  insertRows?: (attemptId: string, rows: HubSpotFirstCandidateRow[]) => Promise<{ error?: string }>;
  /** AGENT2-HUBSPOT-FIRST-OWNERSHIP-1 — dueño de HubSpot del vendedor y directorio de dueños. */
  resolveOwnership?: (triggeredBy: string | null, accountId?: string | null) => Promise<HubSpotFirstOwnership>;
  now?: () => number;
}

/**
 * AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — exportada para que la búsqueda por correo aplique la
 * MISMA regla de dueño que «Primero HubSpot» antes de ofrecer un contacto de HubSpot.
 */
export async function resolveHubSpotFirstOwnership(
  triggeredBy: string | null,
  accountId?: string | null,
): Promise<HubSpotFirstOwnership> {
  return defaultResolveOwnership(triggeredBy, accountId);
}

async function defaultResolveOwnership(
  triggeredBy: string | null,
  accountId?: string | null,
): Promise<HubSpotFirstOwnership> {
  const admin = createSupabaseAdminClient();
  const token = await getHubSpotToken();

  const emailOfInternalUser = async (internalUserId: string | null): Promise<string | null> => {
    if (!internalUserId) return null;
    const { data } = await admin.from('internal_users').select('email').eq('id', internalUserId).maybeSingle();
    return typeof data?.email === 'string' ? data.email : null;
  };
  const hubspotOwnerIdFor = async (email: string | null): Promise<string | null> => {
    const resolved = await resolveSellerHubSpotOwner(email, {
      findMappedOwnerId: async (clean) => {
        const { data } = await admin
          .from('hubspot_owner_mappings')
          .select('hubspot_owner_id')
          .eq('internal_user_email', clean)
          .eq('is_active', true)
          .maybeSingle();
        return typeof data?.hubspot_owner_id === 'string' ? data.hubspot_owner_id : null;
      },
      findHubSpotOwnerIdByEmail: async (clean) => (token ? ((await findHubSpotOwnerByEmail(clean, token))?.id ?? null) : null),
    });
    return resolved.ownerId;
  };

  const sellerOwnerId = await hubspotOwnerIdFor(await emailOfInternalUser(triggeredBy));

  // El dueño de la ficha en SellUp: sus contactos de HubSpot también se ofrecen.
  let accountOwnerId: string | null = null;
  if (accountId) {
    const { data } = await admin.from('accounts').select('owner_id').eq('id', accountId).maybeSingle();
    const ownerInternalId = typeof data?.owner_id === 'string' ? data.owner_id : null;
    accountOwnerId =
      ownerInternalId && ownerInternalId !== triggeredBy
        ? await hubspotOwnerIdFor(await emailOfInternalUser(ownerInternalId))
        : null;
  }

  const directory = token ? await loadHubSpotOwnerDirectory(token).catch(() => null) : null;
  return { sellerOwnerId, accountOwnerId, directory };
}

/**
 * La lista de revisión se ordena por `created_at` descendente y una sola inserción les da a
 * todos el mismo instante: se escalonan por milisegundos para que lo más importante salga
 * primero sin tocar cada pantalla que lee candidatos.
 */
export function withPriorityTimestamps<T extends object>(rows: readonly T[], nowMs: number): Array<T & { created_at: string }> {
  return rows.map((row, index) => ({ ...row, created_at: new Date(nowMs - index).toISOString() }));
}

export type HubSpotFirstStageResult =
  | { status: 'no_hubspot_company' | 'hubspot_unavailable' | 'error'; satisfied: false; inserted: 0; detail?: string }
  | {
      status: 'done';
      satisfied: boolean;
      inserted: number;
      relevantWithEmail: number;
      /**
       * Por qué los contactos de HubSpot no entraron (AGENT2-HUBSPOT-FIRST-WHY-ZERO-1). Antes se
       * contaba y se perdía: Grupo LALA (21-10) tenía ~100 contactos en HubSpot, dejó 0 y no se
       * podía saber si era por dueño, por cargo o porque ya estaban en SellUp.
       */
      breakdown?: HubSpotFirstBreakdown;
    };

export interface HubSpotFirstBreakdown {
  /** Contactos de la empresa que devolvió HubSpot. */
  hubspotContacts: number;
  otherSeller: number;
  knownInSellUp: number;
  notRelevant: number;
  noName: number;
  alreadyInRun: number;
}

async function defaultLoadRunRef(attemptId: string): Promise<HubSpotFirstRunRef | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_runs')
    .select('account_id, hubspot_company_id')
    .eq('id', attemptId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    accountId: (data.account_id as string | null) ?? null,
    hubspotCompanyId: (data.hubspot_company_id as string | null) ?? null,
  };
}

async function defaultLoadRunHubspotCandidates(attemptId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select('source_contact_id, email')
    .eq('enrichment_run_id', attemptId)
    .eq('source', 'hubspot');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    hubspotId: String(row.source_contact_id),
    hasEmail: typeof row.email === 'string' && row.email.trim().length > 0,
  }));
}

async function defaultInsertRows(
  attemptId: string,
  rows: Array<HubSpotFirstCandidateRow & { created_at?: string }>,
): Promise<{ error?: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('contact_enrichment_candidates')
    .insert(rows.map((row) => ({ ...row, enrichment_run_id: attemptId })));
  return { error: error?.message };
}

export async function runHubSpotFirstStage(
  input: { attemptId: string; triggeredBy?: string | null },
  deps: HubSpotFirstStageDeps = {},
): Promise<HubSpotFirstStageResult> {
  const {
    loadRunRef = defaultLoadRunRef,
    readSnapshot = (ref) =>
      readExistingContactsForCompany({ accountId: ref.accountId, hubspotCompanyId: ref.hubspotCompanyId }),
    loadRunHubspotCandidates = defaultLoadRunHubspotCandidates,
    insertRows = defaultInsertRows,
    resolveOwnership = defaultResolveOwnership,
    now = Date.now,
  } = deps;

  try {
    const ref = await loadRunRef(input.attemptId);
    if (!ref?.hubspotCompanyId) return { status: 'no_hubspot_company', satisfied: false, inserted: 0 };

    const snapshot = await readSnapshot(ref);
    if (snapshot.hubspot.status !== 'success') {
      return { status: 'hubspot_unavailable', satisfied: false, inserted: 0, detail: snapshot.hubspot.reason };
    }

    const inRun = await loadRunHubspotCandidates(input.attemptId);
    // Sin poder saber de quién es cada contacto, sólo pasan los sin dueño (falla cerrado).
    const ownership = await resolveOwnership(input.triggeredBy ?? null, ref.accountId).catch(
      (): HubSpotFirstOwnership => ({ sellerOwnerId: null, directory: null }),
    );
    const selection = selectHubSpotFirstCandidates({
      hubspotContacts: snapshot.hubspot.contacts,
      sellupContacts: snapshot.sellup.contacts,
      alreadyInRunHubspotIds: new Set(inRun.map((c) => c.hubspotId)),
      ownership,
    });

    if (selection.rows.length > 0) {
      const { error } = await insertRows(input.attemptId, withPriorityTimestamps(selection.rows, now()));
      if (error) return { status: 'error', satisfied: false, inserted: 0, detail: error };
    }

    // Lo que ya estaba en la corrida (reintento) también cuenta para «bastan».
    const alreadyWithEmail = inRun.filter((c) => c.hasEmail).length;
    const relevantWithEmail = alreadyWithEmail + selection.relevantWithEmail;
    return {
      status: 'done',
      satisfied: isSatisfiedByHubSpot(relevantWithEmail),
      inserted: selection.rows.length,
      relevantWithEmail,
      breakdown: {
        hubspotContacts: snapshot.hubspot.contacts.length,
        otherSeller: selection.skippedOtherSeller,
        knownInSellUp: selection.skippedKnownInSellUp,
        notRelevant: selection.skippedNotRelevant,
        noName: selection.skippedNoName,
        alreadyInRun: selection.skippedAlreadyInRun,
      },
    };
  } catch (err) {
    return { status: 'error', satisfied: false, inserted: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}
