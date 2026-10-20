// AGENT2-HUBSPOT-FIRST-1 — «Primero HubSpot» (etapa de servidor)
//
// Corre entre la creación del intento 1 y la llamada a Apollo: lee los contactos que HubSpot
// ya tiene de la empresa, los deja como candidatos `pending_review` de ESA corrida y dice si
// bastan para no gastar proveedores. Falla ABIERTO: cualquier error devuelve «no satisfecho»
// y el orquestador sigue con Apollo/Lusha como siempre. Sólo lee HubSpot; no escribe en él.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ExistingContactsSnapshotResult } from '@/modules/contact-enrichment/types';
import { readExistingContactsForCompany } from './existing-contacts-reader';
import {
  isSatisfiedByHubSpot,
  selectHubSpotFirstCandidates,
  type HubSpotFirstCandidateRow,
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
}

export type HubSpotFirstStageResult =
  | { status: 'no_hubspot_company' | 'hubspot_unavailable' | 'error'; satisfied: false; inserted: 0; detail?: string }
  | { status: 'done'; satisfied: boolean; inserted: number; relevantWithEmail: number };

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

async function defaultInsertRows(attemptId: string, rows: HubSpotFirstCandidateRow[]): Promise<{ error?: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('contact_enrichment_candidates')
    .insert(rows.map((row) => ({ ...row, enrichment_run_id: attemptId })));
  return { error: error?.message };
}

export async function runHubSpotFirstStage(
  input: { attemptId: string },
  deps: HubSpotFirstStageDeps = {},
): Promise<HubSpotFirstStageResult> {
  const {
    loadRunRef = defaultLoadRunRef,
    readSnapshot = (ref) =>
      readExistingContactsForCompany({ accountId: ref.accountId, hubspotCompanyId: ref.hubspotCompanyId }),
    loadRunHubspotCandidates = defaultLoadRunHubspotCandidates,
    insertRows = defaultInsertRows,
  } = deps;

  try {
    const ref = await loadRunRef(input.attemptId);
    if (!ref?.hubspotCompanyId) return { status: 'no_hubspot_company', satisfied: false, inserted: 0 };

    const snapshot = await readSnapshot(ref);
    if (snapshot.hubspot.status !== 'success') {
      return { status: 'hubspot_unavailable', satisfied: false, inserted: 0, detail: snapshot.hubspot.reason };
    }

    const inRun = await loadRunHubspotCandidates(input.attemptId);
    const selection = selectHubSpotFirstCandidates({
      hubspotContacts: snapshot.hubspot.contacts,
      sellupContacts: snapshot.sellup.contacts,
      alreadyInRunHubspotIds: new Set(inRun.map((c) => c.hubspotId)),
    });

    if (selection.rows.length > 0) {
      const { error } = await insertRows(input.attemptId, selection.rows);
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
    };
  } catch (err) {
    return { status: 'error', satisfied: false, inserted: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}
