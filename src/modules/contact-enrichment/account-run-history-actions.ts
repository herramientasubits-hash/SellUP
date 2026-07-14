'use server';

// Agente 2A — Account Agents Tab: Contact Enrichment Run History (Hito 17B.4X.7C.3E.3)
//
// Read-only server action for the account "Agentes" tab. Every export here
// is a SELECT — no INSERT/UPDATE/DELETE, no Apollo/Lusha call, no HubSpot
// sync. Candidate counts and provider_usage_logs summaries are batched in
// two follow-up queries regardless of run count (mirrors
// getFilteredProviderUsageLogs in modules/budgets/provider-detail-queries.ts).

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUserForEnrichment } from './actions';
import { loadContactEnrichmentRunsByAccountId } from './account-run-history-read-model-core';
import type { AccountContactEnrichmentRun } from './account-run-history-types';

const RUN_SELECT =
  `id, status, company_name, company_domain, company_country_code, hubspot_company_id,
   account_id, agent_run_id, request_id, attempt_order, intended_provider, providers_used,
   estimated_cost_usd, real_cost_usd, summary, created_at, updated_at`;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

/** Contact enrichment run history for a single account, newest first. Every
 *  export here is a SELECT — no INSERT/UPDATE/DELETE, no provider call, no
 *  HubSpot sync. Returns [] for an invalid UUID or an account with no runs. */
export async function getContactEnrichmentRunsByAccountId(
  accountId: string,
): Promise<AccountContactEnrichmentRun[]> {
  await requireActiveUserForEnrichment();
  const supabase = await createClient();
  // provider_usage_logs RLS restricts `authenticated` reads to admins, so
  // summaries use the service-role client for a read-only SELECT (same
  // pattern as getContactEnrichmentRunProviderUsage in run-viewer-actions.ts).
  const admin = getAdminClient();

  return loadContactEnrichmentRunsByAccountId(accountId, {
    fetchRunRows: async (id) => {
      const { data, error } = await supabase
        .from('contact_enrichment_runs')
        .select(RUN_SELECT)
        .eq('account_id', id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(`getContactEnrichmentRunsByAccountId: ${error.message}`);
      return data ?? [];
    },
    fetchCandidateCountRows: async (runIds) => {
      const { data, error } = await supabase
        .from('contact_enrichment_candidates')
        .select('enrichment_run_id, status')
        .in('enrichment_run_id', runIds);
      if (error) throw new Error(`getContactEnrichmentRunsByAccountId candidates: ${error.message}`);
      return data ?? [];
    },
    fetchProviderUsageSummaryRows: async (agentRunIds) => {
      const { data, error } = await admin
        .from('provider_usage_logs')
        .select('agent_run_id, credits_used, status')
        .in('agent_run_id', agentRunIds);
      if (error) throw new Error(`getContactEnrichmentRunsByAccountId usage: ${error.message}`);
      return data ?? [];
    },
  });
}
