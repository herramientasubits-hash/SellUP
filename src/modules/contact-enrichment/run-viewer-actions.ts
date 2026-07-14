'use server';

// Agente 2A — Read-only Contact Enrichment Run Viewer (Hito 17B.4X.7C.3E.2)
//
// Read-only server actions for /contact-enrichment/runs/[runId]. Every
// export here is a SELECT — no INSERT/UPDATE/DELETE, no Apollo/Lusha call,
// no HubSpot sync. Thin wrappers over run-viewer-read-model-core.ts, wiring
// real Supabase clients as the injected fetch deps.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUserForEnrichment } from './actions';
import {
  loadContactCandidatesByRunId,
  loadContactEnrichmentRunById,
  loadProviderUsageByAgentRunId,
} from './run-viewer-read-model-core';
import type {
  ContactEnrichmentRunCandidate,
  ContactEnrichmentRunDetail,
  ContactEnrichmentRunProviderUsage,
} from './run-viewer-types';

const RUN_DETAIL_SELECT =
  `id, status, company_name, company_domain, company_country_code, hubspot_company_id,
   account_id, agent_run_id, request_id, attempt_order, intended_provider, providers_used,
   estimated_cost_usd, real_cost_usd, summary, created_at, updated_at`;

const RUN_CANDIDATE_SELECT =
  `id, full_name, title, email, linkedin_url, phone, source, status,
   duplicate_status, confidence, enrichment_metadata, created_at`;

/** Historical run header by id. Returns null for an invalid UUID or a run
 *  that does not exist — the route renders a controlled not-found state. */
export async function getContactEnrichmentRunById(
  runId: string,
): Promise<ContactEnrichmentRunDetail | null> {
  await requireActiveUserForEnrichment();
  const supabase = await createClient();

  return loadContactEnrichmentRunById(runId, {
    fetchRunRow: async (id) => {
      const { data, error } = await supabase
        .from('contact_enrichment_runs')
        .select(RUN_DETAIL_SELECT)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`getContactEnrichmentRunById: ${error.message}`);
      return data ?? null;
    },
  });
}

/** All candidates for this run, any status — not filtered to pending_review.
 *  A run with zero candidates (e.g. Lusha filtered every result out) is a
 *  valid outcome, not an error: returns []. */
export async function getContactCandidatesByRunId(
  runId: string,
): Promise<ContactEnrichmentRunCandidate[]> {
  await requireActiveUserForEnrichment();
  const supabase = await createClient();

  return loadContactCandidatesByRunId(runId, {
    fetchCandidateRows: async (id) => {
      const { data, error } = await supabase
        .from('contact_enrichment_candidates')
        .select(RUN_CANDIDATE_SELECT)
        .eq('enrichment_run_id', id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(`getContactCandidatesByRunId: ${error.message}`);
      return data ?? [];
    },
  });
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

/** provider_usage_logs rows for this run's agent_run_id, oldest first.
 *  provider_usage_logs RLS restricts `authenticated` reads to admins, so
 *  this uses the service-role client for a read-only SELECT (same pattern
 *  as provider-effectiveness/queries.ts) — no write capability is used. */
export async function getContactEnrichmentRunProviderUsage(
  agentRunId: string | null,
): Promise<ContactEnrichmentRunProviderUsage[]> {
  await requireActiveUserForEnrichment();
  const admin = getAdminClient();

  return loadProviderUsageByAgentRunId(agentRunId, {
    fetchUsageRows: async (id) => {
      const { data, error } = await admin
        .from('provider_usage_logs')
        .select('provider_key, operation_key, status, credits_used, results_returned, metadata, error_message, created_at')
        .eq('agent_run_id', id)
        .order('created_at', { ascending: true })
        .limit(50);
      if (error) throw new Error(`getContactEnrichmentRunProviderUsage: ${error.message}`);
      return data ?? [];
    },
  });
}
