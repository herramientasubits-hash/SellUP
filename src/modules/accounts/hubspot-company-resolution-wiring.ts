// Agente 2A — Cableado REAL de `resolveAccountHubSpotCompany`
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Construye las dependencias sobre Supabase (service role, vía la fábrica fail-closed
// `createSupabaseAdminClient` — NUNCA un `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, ...)`
// inline, ese patrón está deliberadamente cerrado en este repo) y sobre los DOS motores de
// HubSpot que ya existen y no se tocan: `checkHubSpotCompanyCommercialStatus` y
// `createHubSpotCompany`.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkHubSpotCompanyCommercialStatus } from '@/server/agents/prospecting-toolkit/hubspot-commercial-checker';
import { createHubSpotCompany } from '@/server/integrations/hubspot-company-create';
import {
  resolveAccountHubSpotCompany,
  type AccountForHubSpotResolution,
  type HubSpotCompanyMatchCheck,
  type HubSpotCompanyResolutionDeps,
  type HubSpotCompanyResolutionOutcome,
} from './hubspot-company-resolution-runtime';

const ACCOUNT_SELECT =
  'id, name, domain, country, country_code, city, region, tax_identifier, legal_name, company_size, hubspot_company_id, metadata';

function buildDeps(nowIso: string): HubSpotCompanyResolutionDeps {
  const admin = createSupabaseAdminClient();

  return {
    loadAccount: async (accountId): Promise<AccountForHubSpotResolution | null> => {
      const { data, error } = await admin
        .from('accounts')
        .select(ACCOUNT_SELECT)
        .eq('id', accountId)
        .maybeSingle();
      if (error) {
        console.error('[hubspot-company-resolution-wiring] loadAccount query failed', { accountId, error });
        return null;
      }
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        id: row.id as string,
        name: row.name as string,
        domain: (row.domain as string | null) ?? null,
        country: (row.country as string | null) ?? null,
        countryCode: (row.country_code as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        region: (row.region as string | null) ?? null,
        taxIdentifier: (row.tax_identifier as string | null) ?? null,
        legalName: (row.legal_name as string | null) ?? null,
        companySize: (row.company_size as string | null) ?? null,
        hubspotCompanyId: (row.hubspot_company_id as string | null) ?? null,
        metadata: (row.metadata as Record<string, unknown> | null) ?? {},
      };
    },

    checkCompanyMatch: async (account): Promise<HubSpotCompanyMatchCheck> => {
      const result = await checkHubSpotCompanyCommercialStatus({
        name: account.name,
        domain: account.domain,
        taxId: account.taxIdentifier,
        countryCode: account.countryCode,
      });
      return {
        hubspotMatchStatus: result.hubspotMatchStatus,
        match: result.match
          ? {
              hubspotCompanyId: result.match.hubspotCompanyId,
              name: result.match.name,
              domain: result.match.domain,
              matchMethod: result.match.matchMethod,
              confidence: result.match.matchConfidence,
              reason: result.match.recyclableReason ?? '',
            }
          : null,
      };
    },

    createCompany: async (account) => {
      const result = await createHubSpotCompany({
        name: account.name,
        country: account.country,
        countryCode: account.countryCode,
        taxIdentifier: account.taxIdentifier,
        domain: account.domain,
        city: account.city,
        region: account.region,
        legalName: account.legalName,
        numberOfEmployees: account.companySize,
      });
      return result.ok && result.hubspotCompanyId
        ? { ok: true, hubspotCompanyId: result.hubspotCompanyId }
        : { ok: false, error: result.error ?? 'HUBSPOT_CREATE_FAILED' };
    },

    updateAccount: async (accountId, patch) => {
      const { error } = await admin.from('accounts').update(patch).eq('id', accountId);
      if (error) {
        console.error('[hubspot-company-resolution-wiring] updateAccount failed', { accountId, error });
      }
    },

    nowIso,
  };
}

/**
 * Entrypoint real, invocado desde la aprobación de contacto (Task E1).
 * Nota: puede RECHAZAR (no sólo resolver) si `createSupabaseAdminClient()`
 * detecta configuración insegura/faltante — el caller debe manejarlo explícitamente.
 */
export async function resolveAccountHubSpotCompanyWired(
  accountId: string,
  nowIso: string,
): Promise<HubSpotCompanyResolutionOutcome> {
  return resolveAccountHubSpotCompany(accountId, buildDeps(nowIso));
}
