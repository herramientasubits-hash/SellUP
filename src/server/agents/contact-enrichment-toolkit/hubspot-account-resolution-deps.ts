// Agente 2A — Wiring Supabase de la resolución de cuenta desde HubSpot
// (AGENT2A-HUBSPOT-ID-RESOLUTION)
//
// Antes estas dependencias vivían en línea dentro de `approveContactCandidate`. Ahora
// las comparten la aprobación de candidatos y la creación de la request, para que las
// dos rutas resuelvan/creen la cuenta exactamente igual.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HubSpotAccountResolutionDeps } from '@/modules/contact-enrichment/hubspot-account-resolver';
import { syncAccountFromHubSpotProfile } from '@/modules/accounts/hubspot-company-profile-sync.server';
import { scheduleAccountOfficialEnrichment } from '@/modules/accounts/account-official-enrichment.server';

export type HubSpotAccountCreatedFrom =
  | 'contact_enrichment_approval'
  | 'contact_enrichment_request'
  // AGENT2A-CANDIDATE-COMPANY-REASSIGN-1: «Reasignar empresa» en la ficha del candidato.
  | 'contact_candidate_reassignment';

export function normalizeAccountName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildHubSpotAccountResolutionDeps(
  admin: SupabaseClient,
  internalUserId: string,
  createdFrom: HubSpotAccountCreatedFrom,
  /**
   * HUBSPOT-ACCOUNT-SYNC-1 — quien buscó los contactos (`triggered_by` de la búsqueda).
   * Queda como responsable si HubSpot no trae un dueño que sea usuario de SellUp. Por
   * defecto, quien ejecuta la acción.
   */
  searcherUserId: string | null = internalUserId,
): HubSpotAccountResolutionDeps {
  const fromApproval = createdFrom === 'contact_enrichment_approval';
  const fromReassignment = createdFrom === 'contact_candidate_reassignment';
  return {
    findByHubspotId: async (hid) => {
      // `limit(1)` y no `maybeSingle()` a secas: con dos cuentas vinculadas al mismo
      // ID, `maybeSingle()` devolvía error ⇒ `null` ⇒ se creaba una TERCERA cuenta.
      const { data } = await admin
        .from('accounts')
        .select('id')
        .eq('hubspot_company_id', hid)
        .is('archived_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      return data ? { id: data.id as string } : null;
    },
    findByDomain: async (domain) => {
      const { data } = await admin
        .from('accounts')
        .select('id, hubspot_company_id')
        .eq('domain', domain)
        .is('archived_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      return data
        ? { id: data.id as string, hubspot_company_id: (data.hubspot_company_id as string | null) ?? null }
        : null;
    },
    createAccount: async (input) => {
      const { data, error } = await admin
        .from('accounts')
        .insert({
          name: input.name,
          normalized_name: normalizeAccountName(input.name),
          domain: input.domain,
          website: input.website,
          hubspot_company_id: input.hubspot_company_id,
          country_code: input.country_code ?? null,
          source: 'hubspot',
          pipeline_status: 'new',
          metadata: {
            created_from: createdFrom,
            source_hubspot_company_id: input.hubspot_company_id,
            source_contact_enrichment_run_id: input.run_id ?? null,
            ...(fromApproval
              ? { created_from_candidate_approval: true }
              : fromReassignment
                ? { created_from_candidate_reassignment: true }
                : { created_before_enrichment: true }),
            country_resolution: {
              source: input.country_code
                ? fromApproval
                  ? 'contact_enrichment_run'
                  : 'hubspot_company'
                : 'unknown',
              resolved_country_code: input.country_code ?? null,
              ...(fromApproval ? { applied_on_candidate_approval: true } : {}),
            },
          },
          created_by: internalUserId,
          updated_by: internalUserId,
        })
        .select('id')
        .single();
      if (error) return { error: error.message };
      return { id: data.id as string };
    },
    linkHubspotId: async (accountId, hubspotId) => {
      await admin
        .from('accounts')
        .update({ hubspot_company_id: hubspotId, updated_by: internalUserId })
        .eq('id', accountId);
    },
    completeAccount: async (accountId, hubspotId) => {
      await syncAccountFromHubSpotProfile(admin, {
        accountId,
        hubspotCompanyId: hubspotId,
        searcherUserId,
        actorUserId: internalUserId,
        nowIso: new Date().toISOString(),
      });
      scheduleAccountOfficialEnrichment(accountId, internalUserId);
    },
    updateAccountCountryCode: async (accountId, countryCode) => {
      await admin
        .from('accounts')
        .update({ country_code: countryCode, updated_by: internalUserId })
        .eq('id', accountId)
        .is('country_code', null);
    },
  };
}

/**
 * HUBSPOT-ACCOUNT-SYNC-1 — quien lanzó la búsqueda de contactos (`triggered_by` de la
 * corrida). Se lee de la corrida o, si no hay, de la corrida del candidato. `null` si no
 * se encuentra: el llamador cae en quien ejecuta la acción.
 */
export async function loadContactSearchTriggeredBy(
  admin: SupabaseClient,
  ref: { runId?: string | null; candidateId?: string | null },
): Promise<string | null> {
  let runId = ref.runId ?? null;
  if (!runId && ref.candidateId) {
    const { data } = await admin
      .from('contact_enrichment_candidates')
      .select('enrichment_run_id')
      .eq('id', ref.candidateId)
      .maybeSingle();
    runId = (data?.enrichment_run_id as string | null | undefined) ?? null;
  }
  if (!runId) return null;
  const { data } = await admin
    .from('contact_enrichment_runs')
    .select('triggered_by')
    .eq('id', runId)
    .maybeSingle();
  return (data?.triggered_by as string | null | undefined) ?? null;
}
