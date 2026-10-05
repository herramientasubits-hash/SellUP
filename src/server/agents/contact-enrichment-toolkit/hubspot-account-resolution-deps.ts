// Agente 2A — Wiring Supabase de la resolución de cuenta desde HubSpot
// (AGENT2A-HUBSPOT-ID-RESOLUTION)
//
// Antes estas dependencias vivían en línea dentro de `approveContactCandidate`. Ahora
// las comparten la aprobación de candidatos y la creación de la request, para que las
// dos rutas resuelvan/creen la cuenta exactamente igual.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HubSpotAccountResolutionDeps } from '@/modules/contact-enrichment/hubspot-account-resolver';

export type HubSpotAccountCreatedFrom = 'contact_enrichment_approval' | 'contact_enrichment_request';

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
): HubSpotAccountResolutionDeps {
  const fromApproval = createdFrom === 'contact_enrichment_approval';
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
            ...(fromApproval ? { created_from_candidate_approval: true } : { created_before_enrichment: true }),
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
    updateAccountCountryCode: async (accountId, countryCode) => {
      await admin
        .from('accounts')
        .update({ country_code: countryCode, updated_by: internalUserId })
        .eq('id', accountId)
        .is('country_code', null);
    },
  };
}
